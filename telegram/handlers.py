"""Aiogram routers: auth, sales, admin, chat."""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware, F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import BufferedInputFile, CallbackQuery, FSInputFile, Message, TelegramObject

from ai.coder import CoderAgent
from ai.debugger import DebuggerAgent
from ai.grok import GrokClient, GrokError
from ai.memory import ConversationMemory
from ai.modes import (
    MODES,
    MODEL_PRESETS,
    get_user_mode,
    list_modes_text,
    list_model_presets_text,
    merge_prompt_layers,
    set_user_mode,
)
from ai.pipeline import AgentPipeline
from ai.planner import PlannerAgent
from ai.reviewer import ReviewerAgent
from config import Settings
from database.sqlite import get_db
from product.access_codes import create_access_code, redeem_access_code
from product.payment_qr import (
    has_qr_source,
    local_qr_path,
    order_payment_caption,
    payment_caption,
    vietqr_url,
)
from product.plans import PLANS, format_price_list, get_plan
from product.projects import (
    add_note_line,
    format_project,
    format_project_list,
    new_project,
    project_detail,
    remove_project,
    user_projects,
)
from product.teachings import (
    format_teachings_for_prompt,
    format_teachings_list,
    owner_teaching_count,
    owner_teachings,
    remove_teaching,
    teach,
    wipe_teachings,
)
from product.users import (
    check_quota,
    deactivate_user,
    ensure_owner_users,
    get_daily_usage,
    get_user,
    increment_usage,
    is_admin,
    is_allowed,
    list_users,
    set_user_plan,
    stats_summary,
)
from product.vietqr_client import (
    create_pay_order,
    health_check,
    vietqr_pay_enabled,
)
from telegram.commands import help_text
from telegram.keyboards import (
    confirm_clear_memory,
    main_menu,
    payment_order_keyboard,
    plan_qr_keyboard,
    pricing_menu,
)

logger = logging.getLogger(__name__)

TELEGRAM_MAX = 4000

# user_id → order_id: chờ ảnh bill xác nhận
_pending_bill: dict[int, str] = {}


def split_message(text: str, limit: int = TELEGRAM_MAX) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    while text:
        if len(text) <= limit:
            chunks.append(text)
            break
        cut = text.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = limit
        chunks.append(text[:cut])
        text = text[cut:].lstrip("\n")
    return chunks


class AuthMiddleware(BaseMiddleware):
    """Allow owners + activated users; others only public commands."""

    PUBLIC_COMMANDS = {
        "/start",
        "/help",
        "/buy",
        "/pricing",
        "/qr",
        "/activate",
        "/support",
    }

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = data.get("event_from_user")
        if user is None:
            return None

        # Public commands always pass
        if isinstance(event, Message) and event.text:
            cmd = event.text.split()[0].split("@")[0].lower()
            if cmd in self.PUBLIC_COMMANDS:
                return await handler(event, data)

        # Public callbacks: pricing / QR / bill / menu (khách chưa mua vẫn xem được)
        if isinstance(event, CallbackQuery) and event.data:
            if event.data.startswith(("qr:", "buy:", "bill:", "menu:")):
                return await handler(event, data)

        # Cho phép gửi ảnh bill (khi đang chờ) dù chưa active
        if isinstance(event, Message) and event.photo and event.from_user:
            if event.from_user.id in _pending_bill:
                return await handler(event, data)

        db = get_db()
        async with db.session() as session:
            ok, reason = await is_allowed(session, self.settings, user.id)

        if not ok:
            logger.warning("Denied user=%s reason=%s", user.id, reason)
            msg = {
                "not_registered": (
                    f"👋 Chào bạn!\n\n"
                    f"*{self.settings.app_name}* là dịch vụ AI có bản quyền.\n"
                    f"Xem gói: /buy\n"
                    f"Có mã: /activate MÃ\n"
                    f"Hỗ trợ: {self.settings.support_contact}"
                ),
                "disabled": "⛔ Tài khoản đã bị khóa. Liên hệ " + self.settings.support_contact,
                "expired": "⏰ Gói đã hết hạn. Gia hạn: /buy hoặc /activate MÃ",
            }.get(reason, "⛔ Không có quyền.")
            if isinstance(event, Message):
                await event.answer(msg, parse_mode="Markdown")
            elif isinstance(event, CallbackQuery):
                await event.answer("Không có quyền / hết hạn", show_alert=True)
            return None

        return await handler(event, data)


def build_router(
    settings: Settings,
    grok: GrokClient,
    memory: ConversationMemory,
) -> Router:
    router = Router(name="tungdevai")
    planner = PlannerAgent(grok)
    coder = CoderAgent(grok)
    reviewer = ReviewerAgent(grok)
    debugger = DebuggerAgent(grok)
    pipeline = AgentPipeline(grok)

    async def _safe_callback_answer(callback: CallbackQuery, *args: Any, **kwargs: Any) -> None:
        try:
            await callback.answer(*args, **kwargs)
        except Exception:
            # query too old / already answered
            pass

    async def _consume_quota(uid: int) -> tuple[bool, str]:
        """Return (ok, error_msg). On ok, caller should increment after success."""
        db = get_db()
        async with db.session() as session:
            ok, msg, _, _ = await check_quota(session, settings, uid)
            return ok, msg

    async def _bump_usage(uid: int) -> int:
        db = get_db()
        async with db.session() as session:
            return await increment_usage(session, uid)

    async def require_admin(message: Message) -> bool:
        if not message.from_user:
            return False
        db = get_db()
        async with db.session() as session:
            ok = await is_admin(session, settings, message.from_user.id)
        if not ok:
            await message.answer("⛔ Chỉ admin.")
        return ok

    @router.message(CommandStart())
    async def cmd_start(message: Message) -> None:
        name = message.from_user.first_name if message.from_user else "bạn"
        uid = message.from_user.id if message.from_user else 0
        db = get_db()
        async with db.session() as session:
            allowed, reason = await is_allowed(session, settings, uid)
            user = await get_user(session, uid)
        if allowed:
            plan = get_plan(user.plan_id if user else "owner")
            await message.answer(
                f"Xin chào *{name}* 👋\n"
                f"*{settings.app_name}* — {settings.product_tagline}\n\n"
                f"Gói: *{plan.name}*\n"
                f"Gửi tin nhắn để chat AI, hoặc /help · /account · /buy",
                parse_mode="Markdown",
                reply_markup=main_menu(),
            )
        else:
            await message.answer(
                f"Xin chào *{name}* 👋\n"
                f"*{settings.app_name}*\n"
                f"_{settings.product_tagline}_\n\n"
                f"Bạn chưa kích hoạt.\n"
                f"• Xem giá: /buy\n"
                f"• Nhập mã: /activate MÃ\n"
                f"• Support: {settings.support_contact}",
                parse_mode="Markdown",
                reply_markup=pricing_menu(),
            )

    @router.message(Command("help"))
    async def cmd_help(message: Message) -> None:
        await message.answer(help_text(settings), parse_mode="Markdown")

    @router.message(Command("support"))
    async def cmd_support(message: Message) -> None:
        await message.answer(
            f"🆘 *Hỗ trợ*\n{settings.support_contact}\n\n{settings.payment_info}",
            parse_mode="Markdown",
        )

    async def send_order_via_pay(
        message: Message,
        *,
        plan_id: str,
        telegram_id: int,
    ) -> None:
        """Tạo đơn trên vietqr-pay + gửi QR; paid → webhook auto-active."""
        plan = get_plan(plan_id)
        if plan.price_vnd <= 0:
            await message.answer(
                f"Gói *{plan.name}* miễn phí. Dùng `/gencode trial` (admin) "
                f"hoặc liên hệ {settings.support_contact}.",
                parse_mode="Markdown",
            )
            return

        try:
            # Mỗi user / mỗi lần mua → nội dung CK khác nhau (AI{telegramId}xxx)
            order = await create_pay_order(
                settings,
                amount=plan.price_vnd,
                plan=plan.id,
                telegram_id=telegram_id,
                note=f"tg:{telegram_id}",
            )
        except Exception as exc:
            logger.exception("create_pay_order failed")
            await message.answer(
                "⚠️ Không tạo được đơn vietqr-pay.\n"
                f"Lỗi: `{exc}`\n"
                "Kiểm tra `VIETQR_PAY_URL` và `npm start` trong vietqr-pay.",
                parse_mode="Markdown",
            )
            return

        # Ưu tiên STK text từ .env bot (chuẩn chủ bot), fallback order
        bank_code = settings.bank_id or order.bank_code
        bank_acc = settings.bank_account or order.bank_account
        bank_name = settings.bank_account_name or order.bank_name
        # Nội dung CK = mã đơn (để đối soát) + gợi ý AI TUNGDEV
        transfer_content = order.content

        caption = order_payment_caption(
            plan_name=plan.name,
            amount=order.amount,
            bank_code=bank_code,
            bank_account=bank_acc,
            bank_name=bank_name,
            content=transfer_content,
            order_id=order.order_id,
            currency=settings.currency,
            support=settings.support_contact,
        )
        markup = payment_order_keyboard(order.order_id)

        # Ảnh: ƯU TIÊN QR của chủ bot (PAYMENT_QR_PATH), không dùng ảnh auto vietqr.io
        local = local_qr_path(settings)
        try:
            if local is not None:
                await message.answer_photo(
                    FSInputFile(str(local)),
                    caption=caption,
                    parse_mode="Markdown",
                    reply_markup=markup,
                )
            elif order.qr_image_url:
                import httpx

                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(order.qr_image_url)
                    resp.raise_for_status()
                    photo = BufferedInputFile(resp.content, filename="vietqr.png")
                await message.answer_photo(
                    photo,
                    caption=caption,
                    parse_mode="Markdown",
                    reply_markup=markup,
                )
            else:
                await message.answer(
                    caption, parse_mode="Markdown", reply_markup=markup
                )
        except Exception:
            logger.exception("Failed to send pay order QR")
            await message.answer(
                caption, parse_mode="Markdown", reply_markup=markup
            )

    @router.callback_query(F.data.startswith("bill:"))
    async def cb_bill(callback: CallbackQuery) -> None:
        if not callback.from_user:
            await _safe_callback_answer(callback)
            return
        order_id = (callback.data or "bill:").split(":", 1)[-1]
        _pending_bill[callback.from_user.id] = order_id
        await _safe_callback_answer(callback)
        await callback.message.answer(  # type: ignore[union-attr]
            "📷 *Gửi ảnh bill xác nhận*\n\n"
            f"Mã đơn: `{order_id}`\n"
            "Gửi *ảnh chụp màn hình* chuyển khoản thành công ngay tin nhắn tiếp theo.\n"
            f"Admin sẽ nhận bill và duyệt nhanh ({settings.support_contact}).",
            parse_mode="Markdown",
        )

    @router.callback_query(F.data == "menu:main")
    async def cb_menu_main(callback: CallbackQuery) -> None:
        await _safe_callback_answer(callback)
        if callback.message:
            await callback.message.answer(
                f"🏠 *Menu chính* — {settings.app_name}\n\n"
                f"/buy — mua gói\n"
                f"/account — tài khoản\n"
                f"/project — project notes\n"
                f"/build — agent pipeline\n"
                f"/help — hướng dẫn\n"
                f"/support — hỗ trợ",
                parse_mode="Markdown",
                reply_markup=main_menu(),
            )

    @router.message(F.photo)
    async def on_bill_photo(message: Message) -> None:
        """Nhận ảnh bill khi user bấm 'Gửi ảnh bill'."""
        if not message.from_user:
            return
        uid = message.from_user.id
        order_id = _pending_bill.pop(uid, None)
        if not order_id:
            # Không phải luồng bill — bỏ qua (chat ảnh thường có thể sau)
            return

        user = message.from_user
        caption = (
            f"🧾 *Bill thanh toán*\n"
            f"User: `{uid}` @{user.username or '—'}\n"
            f"Tên: {user.full_name or '—'}\n"
            f"Order: `{order_id}`\n"
            f"Admin: check tiền rồi `/gencode` + gửi mã cho khách (hoặc đợi webhook auto)."
        )
        # Gửi admin
        for admin_id in settings.owner_ids:
            try:
                await message.bot.copy_message(
                    chat_id=admin_id,
                    from_chat_id=message.chat.id,
                    message_id=message.message_id,
                )
                await message.bot.send_message(
                    admin_id, caption, parse_mode="Markdown"
                )
            except Exception:
                logger.exception("Forward bill to admin %s failed", admin_id)

        await message.answer(
            f"✅ Đã gửi bill cho Admin (đơn `{order_id}`).\n"
            "Vui lòng chờ duyệt 5–30 phút. Bạn sẽ được kích hoạt khi OK.",
            parse_mode="Markdown",
        )

    async def send_payment_qr(
        message: Message,
        *,
        plan_id: str | None = None,
        with_amount: bool = True,
        telegram_id: int | None = None,
    ) -> None:
        """Send bank QR via vietqr-pay (preferred) or local/VietQR image."""
        # Preferred path: paid plan + vietqr-pay running
        if (
            vietqr_pay_enabled(settings)
            and plan_id
            and plan_id in PLANS
            and plan_id != "owner"
            and with_amount
            and telegram_id
        ):
            await send_order_via_pay(
                message, plan_id=plan_id, telegram_id=telegram_id
            )
            return

        plan = get_plan(plan_id) if plan_id and plan_id in PLANS else None
        amount = plan.price_vnd if (plan and with_amount and plan.price_vnd > 0) else None
        plan_name = plan.name if plan else ""
        add_info = settings.bank_transfer_content
        if plan:
            add_info = f"{settings.bank_transfer_content} {plan.id}".strip()

        caption = payment_caption(
            settings, plan_name=plan_name, amount=amount if with_amount else None
        )
        local = local_qr_path(settings)
        try:
            if local is not None:
                await message.answer_photo(
                    FSInputFile(str(local)),
                    caption=caption,
                    parse_mode="Markdown",
                )
                return
            url = vietqr_url(
                settings,
                amount=amount if with_amount else None,
                add_info=add_info,
            )
            if url:
                import httpx

                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    photo = BufferedInputFile(resp.content, filename="vietqr.png")
                await message.answer_photo(
                    photo,
                    caption=caption,
                    parse_mode="Markdown",
                )
                return
        except Exception:
            logger.exception("Failed to send payment QR")
            await message.answer(
                "⚠️ Không gửi được ảnh QR. Kiểm tra BANK_* hoặc PAYMENT_QR_PATH.\n\n"
                + caption,
                parse_mode="Markdown",
            )
            return

        await message.answer(
            "⚠️ Chưa cấu hình QR.\n"
            "Thêm `VIETQR_PAY_URL=http://127.0.0.1:3000` (khuyến nghị)\n"
            "hoặc `BANK_ID` + `BANK_ACCOUNT` trong `.env`.\n\n"
            + caption,
            parse_mode="Markdown",
        )

    def _can_show_buy_buttons() -> bool:
        return vietqr_pay_enabled(settings) or has_qr_source(settings)

    @router.message(Command("buy", "pricing"))
    async def cmd_buy(message: Message) -> None:
        if not settings.public_buy_enabled:
            await message.answer("Tạm đóng bán gói. Liên hệ " + settings.support_contact)
            return
        text = format_price_list(settings.currency)
        text += f"\n\n💳 *Thanh toán:*\n{settings.payment_info}\n"
        text += f"\n🆘 {settings.support_contact}"
        if vietqr_pay_enabled(settings):
            text += (
                "\n\nBấm nút gói bên dưới → bot tạo *đơn + QR*.\n"
                "CK xong → *tự kích hoạt* (khi webhook nhận tiền)."
            )
        elif has_qr_source(settings):
            text += "\n\nBấm nút bên dưới để hiện *QR chuyển khoản*."
        await message.answer(
            text,
            parse_mode="Markdown",
            reply_markup=plan_qr_keyboard() if _can_show_buy_buttons() else pricing_menu(),
        )

    @router.message(Command("qr"))
    async def cmd_qr(message: Message, command: CommandObject) -> None:
        """ /qr  or /qr basic """
        if not settings.public_buy_enabled:
            await message.answer("Tạm đóng bán gói.")
            return
        arg = (command.args or "").strip().lower()
        plan_id = arg if arg in PLANS and arg != "owner" else None
        tid = message.from_user.id if message.from_user else None
        await send_payment_qr(
            message,
            plan_id=plan_id,
            with_amount=bool(plan_id),
            telegram_id=tid,
        )

    @router.callback_query(F.data.startswith("qr:"))
    async def cb_qr(callback: CallbackQuery) -> None:
        if not callback.message:
            await callback.answer()
            return
        kind = (callback.data or "qr:any").split(":", 1)[-1]
        tid = callback.from_user.id if callback.from_user else None
        if kind == "any":
            await send_payment_qr(
                callback.message, plan_id=None, with_amount=False, telegram_id=tid
            )
        elif kind in PLANS and kind != "owner":
            await send_payment_qr(
                callback.message, plan_id=kind, with_amount=True, telegram_id=tid
            )
        else:
            await callback.answer("Gói không hợp lệ", show_alert=True)
            return
        await callback.answer("Đã gửi QR")

    @router.message(Command("payhealth"))
    async def cmd_payhealth(message: Message) -> None:
        if not await require_admin(message):
            return
        if not vietqr_pay_enabled(settings):
            await message.answer("VIETQR_PAY_URL chưa set.")
            return
        try:
            h = await health_check(settings)
            await message.answer(
                f"🟢 vietqr-pay OK\n"
                f"`{settings.vietqr_pay_url}`\n"
                f"mode=`{h.get('mode')}` bank=`{h.get('bank')}` "
                f"account=`{h.get('hasAccount')}`",
                parse_mode="Markdown",
            )
        except Exception as exc:
            await message.answer(f"🔴 vietqr-pay down: `{exc}`", parse_mode="Markdown")

    @router.message(Command("activate"))
    async def cmd_activate(message: Message, command: CommandObject) -> None:
        code = (command.args or "").strip()
        if not code:
            await message.answer("Dùng: `/activate MÃ-CỦA-BẠN`", parse_mode="Markdown")
            return
        u = message.from_user
        if not u:
            return
        db = get_db()
        async with db.session() as session:
            ok, msg = await redeem_access_code(
                session,
                code_str=code,
                telegram_id=u.id,
                username=u.username,
                full_name=u.full_name,
            )
        await message.answer(msg, parse_mode="Markdown", reply_markup=main_menu() if ok else None)

    @router.message(Command("account"))
    async def cmd_account(message: Message) -> None:
        u = message.from_user
        if not u:
            return
        db = get_db()
        async with db.session() as session:
            user = await get_user(session, u.id)
            used = await get_daily_usage(session, u.id)
            admin = await is_admin(session, settings, u.id)
        if u.id in settings.owner_ids:
            await message.answer(
                f"👤 *Owner*\nID: `{u.id}`\nQuota: ∞\nHôm nay: {used} tin\nAdmin: yes",
                parse_mode="Markdown",
            )
            return
        if not user:
            await message.answer("Chưa kích hoạt. /buy hoặc /activate MÃ")
            return
        plan = get_plan(user.plan_id)
        limit = "∞" if plan.daily_messages < 0 else str(plan.daily_messages)
        exp = user.expires_at.date().isoformat() if user.expires_at else "∞"
        await message.answer(
            f"👤 *Tài khoản*\n"
            f"ID: `{u.id}`\n"
            f"Gói: *{plan.name}* (`{plan.id}`)\n"
            f"Hôm nay: {used}/{limit}\n"
            f"Hết hạn: {exp}\n"
            f"Active: {user.active}\n"
            f"Admin: {admin}",
            parse_mode="Markdown",
        )

    @router.message(Command("status"))
    async def cmd_status(message: Message) -> None:
        uid = message.from_user.id if message.from_user else 0
        n = memory.snapshot(uid)
        db = get_db()
        async with db.session() as session:
            ok_q, _, used, limit = await check_quota(session, settings, uid)
            n_db = await memory.snapshot_db(session, uid)
            projs = await user_projects(session, uid, limit=5)
            n_teach = await owner_teaching_count(session, settings.owner_ids)
        lim = "∞" if limit < 0 else str(limit)
        text = (
            f"🟢 *{settings.app_name}* online\n"
            f"• Provider: `{settings.provider}`\n"
            f"• Model: `{settings.resolved_model}`\n"
            f"• Quota hôm nay: {used}/{lim}\n"
            f"• Memory RAM: {n}/{settings.max_history_messages}\n"
            f"• Memory DB: {n_db} tin\n"
            f"• Model: `{grok.active_model}`\n"
            f"• Mode: `{get_user_mode(uid).id}`\n"
            f"• Luật chủ bot: {n_teach}"
            + (" (`/teach list`)" if uid in settings.owner_ids else "")
            + "\n"
            f"• Projects: {len(projs)}\n"
            f"• Support: {settings.support_contact}"
        )
        await message.answer(text, parse_mode="Markdown")

    @router.message(Command("model"))
    async def cmd_model(message: Message) -> None:
        uid = message.from_user.id if message.from_user else 0
        mode = get_user_mode(uid)
        await message.answer(
            f"Provider: `{settings.provider}`\n"
            f"Model: `{grok.active_model}`\n"
            f"Base: `{settings.resolved_base_url}`\n"
            f"Mode: `{mode.id}` ({mode.name})\n"
            f"Đổi mode: /mode · Owner đổi model: /setmodel",
            parse_mode="Markdown",
        )

    @router.message(Command("mode"))
    async def cmd_mode(message: Message, command: CommandObject) -> None:
        """ /mode  |  /mode coder|security|sales|research|default """
        uid = message.from_user.id if message.from_user else 0
        arg = (command.args or "").strip().lower()
        if not arg:
            cur = get_user_mode(uid)
            await message.answer(
                f"Mode hiện tại: *{cur.name}* (`{cur.id}`)\n\n{list_modes_text()}",
                parse_mode="Markdown",
            )
            return
        if arg not in MODES:
            await message.answer(
                f"Không có mode `{arg}`.\n\n{list_modes_text()}",
                parse_mode="Markdown",
            )
            return
        mode = set_user_mode(uid, arg)
        await message.answer(
            f"✅ Mode → *{mode.name}* (`{mode.id}`)\n{mode.description}\n\n"
            "Chat tiếp — AI dùng chuyên môn mode này.",
            parse_mode="Markdown",
        )

    @router.message(Command("setmodel"))
    async def cmd_setmodel(message: Message, command: CommandObject) -> None:
        """Owner-only runtime model switch (same provider unless raw matches)."""
        uid = message.from_user.id if message.from_user else 0
        if uid not in settings.owner_ids:
            await message.answer("⛔ Chỉ chủ bot được /setmodel.")
            return
        raw = (command.args or "").strip()
        if not raw:
            await message.answer(
                f"Model hiện tại: `{grok.active_model}`\n\n{list_model_presets_text()}",
                parse_mode="Markdown",
            )
            return
        parts = raw.split()
        head = parts[0].lower()
        if head in {"reset", "default", "env"}:
            m = grok.set_model_override(None)
            await message.answer(f"↺ Model về .env: `{m}`", parse_mode="Markdown")
            return
        if head in MODEL_PRESETS:
            preset = MODEL_PRESETS[head]
            if preset["provider"] != settings.provider:
                await message.answer(
                    f"⚠️ Preset `{head}` cần provider *{preset['provider']}*, "
                    f"bot đang *{settings.provider}*.\n"
                    f"Sửa `.env` → `AI_PROVIDER={preset['provider']}` + API key rồi restart.\n"
                    f"Hoặc dùng model cùng provider: `/setmodel raw {settings.provider} <model_id>`",
                    parse_mode="Markdown",
                )
                return
            m = grok.set_model_override(preset["model"])
            await message.answer(
                f"✅ Model → `{m}`\n_{preset['label']}_",
                parse_mode="Markdown",
            )
            return
        if head == "raw" and len(parts) >= 3:
            # /setmodel raw <provider> <model> — only model applied if provider matches
            want_p, want_m = parts[1].lower(), parts[2]
            if want_p != settings.provider:
                await message.answer(
                    f"Bot provider=`{settings.provider}`, bạn chọn `{want_p}`.\n"
                    "Đổi AI_PROVIDER trong .env + key rồi restart để dùng provider khác.",
                    parse_mode="Markdown",
                )
                return
            m = grok.set_model_override(want_m)
            await message.answer(f"✅ Model → `{m}`", parse_mode="Markdown")
            return
        # bare model id on current provider
        m = grok.set_model_override(raw)
        await message.answer(
            f"✅ Model override → `{m}`\n(reset: `/setmodel reset`)",
            parse_mode="Markdown",
        )

    @router.message(Command("clear"))
    async def cmd_clear(message: Message) -> None:
        await message.answer(
            "Xóa toàn bộ memory hội thoại (RAM + SQLite)?",
            reply_markup=confirm_clear_memory(),
        )

    @router.callback_query(F.data == "memory:clear")
    async def cb_clear(callback: CallbackQuery) -> None:
        uid = callback.from_user.id if callback.from_user else 0
        db = get_db()
        async with db.session() as session:
            n = await memory.clear_persist(session, uid)
        if callback.message:
            await callback.message.edit_text(f"🧹 Đã xóa memory ({n} tin trong DB).")
        await _safe_callback_answer(callback, "Cleared")

    @router.callback_query(F.data == "memory:cancel")
    async def cb_cancel(callback: CallbackQuery) -> None:
        if callback.message:
            await callback.message.edit_text("Đã hủy.")
        await _safe_callback_answer(callback)

    # ── Admin ─────────────────────────────────────────────

    @router.message(Command("admin"))
    async def cmd_admin(message: Message) -> None:
        if not await require_admin(message):
            return
        await message.answer(
            "🛠 *Admin*\n"
            "/stats — thống kê\n"
            "/users — danh sách user\n"
            "/gencode `<plan>` [days] — tạo mã bán\n"
            "  plan: trial|basic|pro|business\n"
            "/adduser `<telegram_id>` `<plan>` [days]\n"
            "/deluser `<telegram_id>`\n"
            "/setplan `<telegram_id>` `<plan>` [days]",
            parse_mode="Markdown",
        )

    @router.message(Command("stats"))
    async def cmd_stats(message: Message) -> None:
        if not await require_admin(message):
            return
        db = get_db()
        async with db.session() as session:
            s = await stats_summary(session)
        await message.answer(
            f"📊 *Stats*\n"
            f"Users: {s['users']} (active {s['active']})\n"
            f"Messages today: {s['messages_today']}",
            parse_mode="Markdown",
        )

    @router.message(Command("users"))
    async def cmd_users(message: Message) -> None:
        if not await require_admin(message):
            return
        db = get_db()
        async with db.session() as session:
            rows = await list_users(session, 40)
        if not rows:
            await message.answer("Chưa có user.")
            return
        lines = ["👥 *Users* (mới nhất):"]
        for u in rows:
            exp = u.expires_at.date().isoformat() if u.expires_at else "∞"
            flag = "ON" if u.active else "OFF"
            un = f"@{u.username}" if u.username else "-"
            lines.append(
                f"`{u.telegram_id}` {un} {u.plan_id} {flag} exp={exp}"
            )
        for chunk in split_message("\n".join(lines)):
            await message.answer(chunk, parse_mode="Markdown")

    @router.message(Command("gencode"))
    async def cmd_gencode(message: Message, command: CommandObject) -> None:
        if not await require_admin(message):
            return
        parts = (command.args or "").split()
        if not parts:
            await message.answer(
                "Dùng: `/gencode basic` hoặc `/gencode pro 30`\n"
                f"Plans: {', '.join(p for p in PLANS if p != 'owner')}",
                parse_mode="Markdown",
            )
            return
        plan_id = parts[0].lower()
        if plan_id not in PLANS or plan_id == "owner":
            await message.answer("Plan không hợp lệ.")
            return
        days = int(parts[1]) if len(parts) > 1 else None
        db = get_db()
        async with db.session() as session:
            code = await create_access_code(
                session,
                plan_id=plan_id,
                days=days,
                created_by=message.from_user.id if message.from_user else None,
                note="admin_gencode",
            )
        plan = get_plan(plan_id)
        await message.answer(
            f"🎟 *Mã kích hoạt*\n"
            f"`{code.code}`\n"
            f"Gói: {plan.name} · {code.days} ngày · {code.max_uses} lượt\n\n"
            f"Khách gõ:\n`/activate {code.code}`",
            parse_mode="Markdown",
        )

    @router.message(Command("adduser"))
    async def cmd_adduser(message: Message, command: CommandObject) -> None:
        if not await require_admin(message):
            return
        parts = (command.args or "").split()
        if len(parts) < 2:
            await message.answer("Dùng: `/adduser 123456789 basic 30`", parse_mode="Markdown")
            return
        tid = int(parts[0])
        plan_id = parts[1].lower()
        days = int(parts[2]) if len(parts) > 2 else None
        db = get_db()
        async with db.session() as session:
            user = await set_user_plan(session, tid, plan_id, days)
        await message.answer(
            f"✅ User `{user.telegram_id}` → plan *{user.plan_id}*",
            parse_mode="Markdown",
        )

    @router.message(Command("setplan"))
    async def cmd_setplan(message: Message, command: CommandObject) -> None:
        await cmd_adduser(message, command)

    @router.message(Command("deluser"))
    async def cmd_deluser(message: Message, command: CommandObject) -> None:
        if not await require_admin(message):
            return
        arg = (command.args or "").strip()
        if not arg:
            await message.answer("Dùng: `/deluser 123456789`", parse_mode="Markdown")
            return
        tid = int(arg)
        db = get_db()
        async with db.session() as session:
            ok = await deactivate_user(session, tid)
        await message.answer("✅ Đã khóa." if ok else "Không tìm thấy user.")

    @router.message(Command("plan"))
    async def cmd_plan(message: Message, command: CommandObject) -> None:
        goal = (command.args or "").strip()
        if not goal:
            await message.answer("Dùng: `/plan mô tả task`", parse_mode="Markdown")
            return
        uid = message.from_user.id if message.from_user else 0
        ok, msg = await _consume_quota(uid)
        if not ok:
            await message.answer(msg)
            return
        wait = await message.answer("📋 Đang lập kế hoạch…")
        try:
            result = await planner.plan(goal)
        except GrokError as exc:
            await wait.edit_text(f"❌ AI error: {exc}")
            return
        await _bump_usage(uid)
        await wait.delete()
        for chunk in split_message(f"📋 Plan\n\n{result}"):
            await message.answer(chunk)

    @router.message(Command("code"))
    async def cmd_code(message: Message, command: CommandObject) -> None:
        spec = (command.args or "").strip()
        if not spec:
            await message.answer(
                "Dùng: `/code mô tả / spec cần code`", parse_mode="Markdown"
            )
            return
        uid = message.from_user.id if message.from_user else 0
        ok, msg = await _consume_quota(uid)
        if not ok:
            await message.answer(msg)
            return
        wait = await message.answer("💻 Đang sinh code…")
        try:
            result = await coder.code(spec)
        except GrokError as exc:
            await wait.edit_text(f"❌ AI error: {exc}")
            return
        await _bump_usage(uid)
        await wait.delete()
        for chunk in split_message(f"💻 Code\n\n{result}"):
            await message.answer(chunk)

    @router.message(Command("review"))
    async def cmd_review(message: Message, command: CommandObject) -> None:
        code = (command.args or "").strip()
        if not code and message.reply_to_message and message.reply_to_message.text:
            code = message.reply_to_message.text
        if not code:
            await message.answer(
                "Dùng: `/review code…` hoặc reply tin có code rồi `/review`",
                parse_mode="Markdown",
            )
            return
        uid = message.from_user.id if message.from_user else 0
        ok, msg = await _consume_quota(uid)
        if not ok:
            await message.answer(msg)
            return
        wait = await message.answer("🔎 Đang review…")
        try:
            result = await reviewer.review(code)
        except GrokError as exc:
            await wait.edit_text(f"❌ AI error: {exc}")
            return
        await _bump_usage(uid)
        await wait.delete()
        for chunk in split_message(f"🔎 Review\n\n{result}"):
            await message.answer(chunk)

    @router.message(Command("debug"))
    async def cmd_debug(message: Message, command: CommandObject) -> None:
        report = (command.args or "").strip()
        if not report and message.reply_to_message and message.reply_to_message.text:
            report = message.reply_to_message.text
        if not report:
            await message.answer(
                "Dùng: `/debug traceback/log…` hoặc reply tin lỗi + `/debug`",
                parse_mode="Markdown",
            )
            return
        uid = message.from_user.id if message.from_user else 0
        ok, msg = await _consume_quota(uid)
        if not ok:
            await message.answer(msg)
            return
        wait = await message.answer("🐛 Đang phân tích…")
        try:
            result = await debugger.debug(report)
        except GrokError as exc:
            await wait.edit_text(f"❌ AI error: {exc}")
            return
        await _bump_usage(uid)
        await wait.delete()
        for chunk in split_message(f"🐛 Debug\n\n{result}"):
            await message.answer(chunk)

    @router.message(Command("build"))
    async def cmd_build(message: Message, command: CommandObject) -> None:
        goal = (command.args or "").strip()
        if not goal:
            await message.answer(
                "Dùng: `/build mô tả task`\n"
                "Pipeline: plan → code → review (3 lượt AI).",
                parse_mode="Markdown",
            )
            return
        uid = message.from_user.id if message.from_user else 0
        ok, msg = await _consume_quota(uid)
        if not ok:
            await message.answer(msg)
            return
        wait = await message.answer("🔧 Pipeline: plan → code → review…")
        try:
            result = await pipeline.run(goal, do_plan=True, do_code=True, do_review=True)
        except GrokError as exc:
            await wait.edit_text(f"❌ AI error: {exc}")
            return
        # Pipeline uses ~3 calls — count as 1 usage unit for UX (quota still 1)
        await _bump_usage(uid)
        await wait.delete()
        text = result.format_telegram()
        for chunk in split_message(text):
            try:
                await message.answer(chunk, parse_mode="Markdown")
            except Exception:
                await message.answer(chunk)

    # ── Projects (Phase 2) ────────────────────────────────

    @router.message(Command("projects"))
    async def cmd_projects(message: Message) -> None:
        uid = message.from_user.id if message.from_user else 0
        db = get_db()
        async with db.session() as session:
            rows = await user_projects(session, uid)
        await message.answer(format_project_list(rows), parse_mode="Markdown")

    @router.message(Command("project"))
    async def cmd_project(message: Message, command: CommandObject) -> None:
        """
        /project new <name>
        /project show <id>
        /project note <id> <text>
        /project del <id>
        /project  (help)
        """
        uid = message.from_user.id if message.from_user else 0
        raw = (command.args or "").strip()
        if not raw:
            await message.answer(
                "📂 *Project notes*\n"
                "`/projects` — list\n"
                "`/project new tên` — tạo\n"
                "`/project show ID` — xem\n"
                "`/project note ID nội dung` — ghi note\n"
                "`/project del ID` — xóa",
                parse_mode="Markdown",
            )
            return

        parts = raw.split(maxsplit=2)
        action = parts[0].lower()
        db = get_db()

        if action == "new":
            name = parts[1] if len(parts) > 1 else ""
            if not name:
                await message.answer("Dùng: `/project new tên-project`", parse_mode="Markdown")
                return
            extra = parts[2] if len(parts) > 2 else None
            async with db.session() as session:
                proj = await new_project(session, uid, name, notes=extra)
            await message.answer(
                f"✅ Tạo project\n{format_project(proj)}",
                parse_mode="Markdown",
            )
            return

        if action in {"show", "get", "view"}:
            if len(parts) < 2 or not parts[1].isdigit():
                await message.answer("Dùng: `/project show ID`", parse_mode="Markdown")
                return
            pid = int(parts[1])
            async with db.session() as session:
                proj = await project_detail(session, uid, pid)
            if not proj:
                await message.answer("Không tìm thấy project.")
                return
            await message.answer(
                format_project(proj, full_notes=True),
                parse_mode="Markdown",
            )
            return

        if action in {"note", "notes", "add"}:
            if len(parts) < 2 or not parts[1].isdigit():
                await message.answer(
                    "Dùng: `/project note ID nội dung`", parse_mode="Markdown"
                )
                return
            pid = int(parts[1])
            note = parts[2] if len(parts) > 2 else ""
            if not note:
                await message.answer("Thiếu nội dung note.")
                return
            async with db.session() as session:
                proj = await add_note_line(session, uid, pid, note)
            if not proj:
                await message.answer("Không tìm thấy project.")
                return
            await message.answer(
                f"✅ Đã ghi note\n{format_project(proj)}",
                parse_mode="Markdown",
            )
            return

        if action in {"del", "delete", "rm"}:
            if len(parts) < 2 or not parts[1].isdigit():
                await message.answer("Dùng: `/project del ID`", parse_mode="Markdown")
                return
            pid = int(parts[1])
            async with db.session() as session:
                ok = await remove_project(session, uid, pid)
            await message.answer("✅ Đã xóa." if ok else "Không tìm thấy project.")
            return

        await message.answer(
            "Lệnh không rõ. Gõ `/project` để xem hướng dẫn.",
            parse_mode="Markdown",
        )

    @router.message(F.text.in_({"ℹ️ Help", "Help"}))
    async def btn_help(message: Message) -> None:
        await cmd_help(message)

    @router.message(F.text.in_({"🧠 Memory", "Memory"}))
    async def btn_memory(message: Message) -> None:
        uid = message.from_user.id if message.from_user else 0
        n = memory.snapshot(uid)
        db = get_db()
        async with db.session() as session:
            n_db = await memory.snapshot_db(session, uid)
        await message.answer(
            f"Memory RAM: *{n}* tin · DB: *{n_db}* tin.\n/clear để xóa cả hai.",
            parse_mode="Markdown",
            reply_markup=confirm_clear_memory(),
        )

    @router.message(F.text.in_({"💬 Chat", "Chat"}))
    async def btn_chat(message: Message) -> None:
        await message.answer("Gửi tin nhắn bất kỳ — AI sẽ trả lời (memory lưu SQLite).")

    @router.message(F.text.in_({"📋 Plan", "Plan"}))
    async def btn_plan(message: Message) -> None:
        await message.answer(
            "Gõ: `/plan <task>` · `/code <spec>` · `/build <task>`",
            parse_mode="Markdown",
        )

    @router.message(F.text.in_({"🔧 Build", "Build"}))
    async def btn_build(message: Message) -> None:
        await message.answer(
            "Pipeline plan→code→review.\nGõ: `/build <mô tả task>`",
            parse_mode="Markdown",
        )

    @router.message(F.text.in_({"📂 Projects", "Projects"}))
    async def btn_projects(message: Message) -> None:
        await cmd_projects(message)

    @router.message(F.text.in_({"💎 Mua gói", "Mua gói", "💰 Pricing"}))
    async def btn_buy(message: Message) -> None:
        await cmd_buy(message)

    # ── Teach AI ──────────────────────────────────────────

    @router.message(Command("teach"))
    async def cmd_teach(message: Message, command: CommandObject) -> None:
        """
        Owner-only. Global rules for every customer chat.
        /teach <luật>
        /teach style <phong cách>
        /teach fact <sự thật>
        /teach list | /teach del ID | /teach clear
        """
        uid = message.from_user.id if message.from_user else 0
        if uid not in settings.owner_ids:
            await message.answer(
                "⛔ Chỉ *chủ bot* mới được thêm/sửa luật AI.\n"
                f"Hỗ trợ: {settings.support_contact}",
                parse_mode="Markdown",
            )
            return

        raw = (command.args or "").strip()
        db = get_db()

        if not raw:
            async with db.session() as session:
                rows = await owner_teachings(session, settings.owner_ids)
            await message.answer(
                "🧠 *Dạy AI* (chỉ chủ bot)\n\n"
                "Luật gắn vào *mọi* chat khách + của bạn.\n\n"
                + format_teachings_list(rows),
                parse_mode="Markdown",
            )
            return

        parts = raw.split(maxsplit=1)
        head = parts[0].lower()

        if head in {"list", "ls", "show"}:
            async with db.session() as session:
                rows = await owner_teachings(session, settings.owner_ids)
            await message.answer(format_teachings_list(rows), parse_mode="Markdown")
            return

        if head in {"clear", "reset", "wipe"}:
            async with db.session() as session:
                n = await wipe_teachings(session, uid)
            await message.answer(
                f"🧹 Đã xóa {n} luật của bạn. AI về mặc định (cho phần bạn đã dạy)."
            )
            return

        if head in {"del", "delete", "rm", "remove"}:
            arg = parts[1].strip() if len(parts) > 1 else ""
            if not arg.isdigit():
                await message.answer(
                    "Dùng: `/teach del ID` (xem ID bằng `/teach list`)",
                    parse_mode="Markdown",
                )
                return
            async with db.session() as session:
                ok = await remove_teaching(session, uid, int(arg))
            await message.answer(
                f"✅ Đã xóa `#{arg}`." if ok else "Không tìm thấy ID đó (hoặc không phải của bạn).",
                parse_mode="Markdown",
            )
            return

        kind = "rule"
        content = raw
        if head in {"style", "tone", "voice"}:
            kind = "style"
            content = parts[1].strip() if len(parts) > 1 else ""
        elif head in {"fact", "info", "about"}:
            kind = "fact"
            content = parts[1].strip() if len(parts) > 1 else ""
        elif head == "rule":
            kind = "rule"
            content = parts[1].strip() if len(parts) > 1 else ""

        if not content:
            await message.answer(
                "Thiếu nội dung.\n"
                "VD: `/teach luôn trả lời bằng tiếng Việt, ngắn`",
                parse_mode="Markdown",
            )
            return

        try:
            async with db.session() as session:
                row = await teach(session, uid, content, kind=kind)
                total = await owner_teaching_count(session, settings.owner_ids)
        except ValueError:
            await message.answer("Nội dung trống.")
            return

        label = {"rule": "📌 Luật", "style": "🎨 Style", "fact": "📝 Fact"}.get(
            kind, kind
        )
        await message.answer(
            f"✅ Luật {label} `#{row.id}` đã lưu (toàn bot)\n"
            f"_{content[:200]}{'…' if len(content) > 200 else ''}_\n\n"
            f"Tổng luật chủ bot: {total}. Mọi khách chat sẽ theo.",
            parse_mode="Markdown",
        )

    @router.message(F.text)
    async def on_text(message: Message) -> None:
        user = message.from_user
        if not user or not message.text:
            return
        text = message.text.strip()
        if not text or text.startswith("/"):
            return

        uid = user.id
        db = get_db()
        teach_extra: str | None = None
        async with db.session() as session:
            ok, msg, used, limit = await check_quota(session, settings, uid)
            if not ok:
                await message.answer(msg)
                return
            await memory.ensure_hydrated(session, uid)
            # Global: only owner-written rules apply to every user
            rows = await owner_teachings(session, settings.owner_ids)
            teach_extra = format_teachings_for_prompt(rows)

        mode = get_user_mode(uid)
        system_extra = merge_prompt_layers(
            mode_prompt=mode.prompt or None,
            teachings=teach_extra,
        )
        temp = mode.temperature

        wait = await message.answer(
            f"⏳ Đang nghĩ… _(mode: {mode.id})_" if mode.id != "default" else "⏳ Đang nghĩ…"
        )

        try:
            plan_id = "trial"
            plan_expired = False
            async with db.session() as session:
                await memory.add_persist(session, uid, "user", text)
                # Route model by Telegram plan (owner → GPT, trial → Groq)
                from product.users import get_user

                bu = await get_user(session, uid)
                if uid in settings.owner_ids:
                    plan_id = "owner"
                elif bu is not None:
                    plan_id = bu.plan_id or "trial"
                    if bu.expires_at is not None:
                        from datetime import datetime, timezone

                        exp = bu.expires_at
                        if exp.tzinfo is None:
                            exp = exp.replace(tzinfo=timezone.utc)
                        plan_expired = exp < datetime.now(timezone.utc)
            reply = await grok.chat(
                memory.get_messages(uid),
                system=system_extra,
                temperature=temp,
                plan_id=plan_id,
                plan_expired=plan_expired,
            )
            async with db.session() as session:
                await memory.add_persist(session, uid, "assistant", reply)
                new_used = await increment_usage(session, uid)
        except GrokError as exc:
            logger.error("AI failed for user=%s: %s", uid, exc)
            memory.add(uid, "assistant", f"[error] {exc}")
            await wait.edit_text(f"❌ Lỗi AI API:\n{exc}")
            return
        except Exception:
            logger.exception("Unexpected chat error user=%s", uid)
            await wait.edit_text("❌ Lỗi nội bộ. Xem logs.")
            return

        await wait.delete()
        for chunk in split_message(reply):
            await message.answer(chunk)

        if limit >= 0 and new_used >= max(1, limit - 3):
            await message.answer(f"ℹ️ Quota hôm nay: {new_used}/{limit}")

        logger.info(
            "chat user=%s in=%d out=%d used=%d teachings=%s",
            uid,
            len(text),
            len(reply),
            new_used,
            bool(teach_extra),
        )

    return router


async def bootstrap_product(settings: Settings) -> None:
    db = get_db()
    async with db.session() as session:
        await ensure_owner_users(session, settings)
    logger.info("Product bootstrap: owners=%s", sorted(settings.owner_ids))
