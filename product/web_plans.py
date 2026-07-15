"""Web user plans, daily quota, and activation-code redeem."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import AccessCode, GoogleWebUser
from product.plans import PLANS, get_plan


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> str:
    return _utcnow().strftime("%Y-%m-%d")


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def user_public(user: GoogleWebUser) -> dict[str, Any]:
    plan = get_plan(getattr(user, "plan_id", None) or "trial")
    expires = _aware(getattr(user, "plan_expires_at", None))
    day = getattr(user, "usage_day", None)
    used = int(getattr(user, "usage_count", 0) or 0)
    if day != _today():
        used = 0
    limit = plan.daily_messages
    remaining = None if limit < 0 else max(0, limit - used)
    expired = bool(expires and expires < _utcnow() and plan.id != "owner")
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "plan_id": plan.id,
        "plan_name": plan.name,
        "daily_limit": limit,
        "used_today": used,
        "remaining_today": remaining,
        "plan_expires_at": expires.isoformat() if expires else None,
        "plan_expired": expired,
        "upgrade_url": "pricing.html",
    }


async def ensure_plan_defaults(session: AsyncSession, user: GoogleWebUser) -> GoogleWebUser:
    """Ensure new/legacy rows have plan fields + trial window."""
    changed = False
    plan_id = (getattr(user, "plan_id", None) or "").strip() or "trial"
    if plan_id not in PLANS:
        plan_id = "trial"
        user.plan_id = plan_id
        changed = True
    if not getattr(user, "plan_id", None):
        user.plan_id = "trial"
        changed = True
    if getattr(user, "plan_expires_at", None) is None and user.plan_id == "trial":
        # 3-day trial from now (or from created_at if present)
        base = user.created_at or _utcnow()
        if base.tzinfo is None:
            base = base.replace(tzinfo=timezone.utc)
        # If account older than trial days without expiry, still grant a short window once
        plan = get_plan("trial")
        user.plan_expires_at = _utcnow() + timedelta(days=plan.days)
        changed = True
    if getattr(user, "usage_count", None) is None:
        user.usage_count = 0
        changed = True
    if changed:
        await session.commit()
        await session.refresh(user)
    return user


def check_web_quota(user: GoogleWebUser) -> tuple[bool, str, int, int]:
    """Return (ok, message, used, limit). Does not mutate DB."""
    if not user.active:
        return False, "Tài khoản đã bị khóa. Liên hệ support.", 0, 0

    plan = get_plan(getattr(user, "plan_id", None) or "trial")
    expires = _aware(getattr(user, "plan_expires_at", None))
    now = _utcnow()
    if expires is not None and expires < now and plan.id != "owner":
        return (
            False,
            "Gói đã hết hạn. Mở Bảng giá → thanh toán qua bot → nhập mã kích hoạt trong chat.",
            0,
            plan.daily_messages if plan.daily_messages >= 0 else 0,
        )

    day = getattr(user, "usage_day", None)
    used = int(getattr(user, "usage_count", 0) or 0)
    if day != _today():
        used = 0

    limit = plan.daily_messages
    if limit < 0:
        return True, "", used, -1
    if used >= limit:
        return (
            False,
            f"Hết quota hôm nay ({used}/{limit} tin). Nâng gói tại pricing.html hoặc đợi ngày mai.",
            used,
            limit,
        )
    return True, "", used, limit


async def bump_web_usage(session: AsyncSession, user_id: int) -> int:
    res = await session.execute(
        select(GoogleWebUser).where(GoogleWebUser.id == user_id)
    )
    user = res.scalar_one_or_none()
    if user is None:
        return 0
    today = _today()
    if getattr(user, "usage_day", None) != today:
        user.usage_day = today
        user.usage_count = 1
    else:
        user.usage_count = int(user.usage_count or 0) + 1
    await session.commit()
    return int(user.usage_count)


async def set_web_user_plan(
    session: AsyncSession,
    *,
    email: str | None = None,
    user_id: int | None = None,
    plan_id: str,
    days: int | None = None,
) -> GoogleWebUser:
    plan = get_plan(plan_id)
    user: GoogleWebUser | None = None
    if user_id is not None:
        res = await session.execute(
            select(GoogleWebUser).where(GoogleWebUser.id == int(user_id))
        )
        user = res.scalar_one_or_none()
    elif email:
        e = (email or "").strip().lower()
        res = await session.execute(
            select(GoogleWebUser).where(GoogleWebUser.email == e)
        )
        user = res.scalar_one_or_none()
    if user is None:
        raise ValueError("Không tìm thấy user web")

    now = _utcnow()
    user.plan_id = plan.id
    user.active = True
    d = days if days is not None else plan.days
    user.plan_expires_at = now + timedelta(days=int(d))
    await session.commit()
    await session.refresh(user)
    return user


async def list_web_users(session: AsyncSession, limit: int = 200) -> list[GoogleWebUser]:
    res = await session.execute(
        select(GoogleWebUser).order_by(GoogleWebUser.id.desc()).limit(limit)
    )
    return list(res.scalars().all())


async def redeem_web_access_code(
    session: AsyncSession,
    *,
    code_str: str,
    user: GoogleWebUser,
) -> tuple[bool, str]:
    """Redeem the same JV-XXXXX codes used on Telegram, for a web user."""
    code_str = (code_str or "").strip().upper()
    result = await session.execute(
        select(AccessCode).where(AccessCode.code == code_str)
    )
    row = result.scalar_one_or_none()
    if row is None or not row.active:
        return False, "Mã không hợp lệ hoặc đã tắt."
    if row.uses >= row.max_uses:
        return False, "Mã đã hết lượt sử dụng."

    plan = get_plan(row.plan_id)
    now = _utcnow()
    cur_exp = _aware(getattr(user, "plan_expires_at", None))
    base = cur_exp if cur_exp and cur_exp > now else now
    # If upgrading from different plan, start fresh window from now
    if (getattr(user, "plan_id", None) or "trial") != plan.id:
        base = now
    user.plan_id = plan.id
    user.plan_expires_at = base + timedelta(days=row.days)
    user.active = True
    row.uses = int(row.uses or 0) + 1
    if row.uses >= row.max_uses:
        row.active = False
    await session.commit()
    await session.refresh(user)
    return (
        True,
        f"Đã kích hoạt gói {plan.name} đến {user.plan_expires_at.strftime('%d/%m/%Y')}.",
    )
