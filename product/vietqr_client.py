"""Client gọi vietqr-pay server + fallback tạo QR trực tiếp (STK shop)."""

from __future__ import annotations

import logging
import secrets
import string
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import httpx

from config import Settings

logger = logging.getLogger(__name__)

# In-memory fallback orders when Node vietqr-pay is down
_local_orders: dict[str, dict[str, Any]] = {}

BANK_BIN = {
    "mb": "970422",
    "mbbank": "970422",
    "vcb": "970436",
    "vietcombank": "970436",
    "tcb": "970407",
    "techcombank": "970407",
    "acb": "970416",
    "bidv": "970418",
    "vpb": "970432",
    "vpbank": "970432",
    "tpb": "970423",
    "tpbank": "970423",
    "vib": "970441",
    "msb": "970426",
    "agribank": "970405",
    "vietinbank": "970415",
    "ctg": "970415",
    "sacombank": "970403",
    "hdbank": "970437",
    "hdb": "970437",
    "hd": "970437",
}


@dataclass
class PayOrder:
    order_id: str
    amount: int
    plan: str
    status: str
    content: str
    qr_image_url: str | None
    pay_page: str | None
    bank_code: str
    bank_account: str
    bank_name: str
    raw: dict[str, Any] = field(default_factory=dict)


def vietqr_pay_enabled(settings: Settings) -> bool:
    # Enabled if Node URL set OR bank account present for local QR fallback
    if (settings.vietqr_pay_url or "").strip():
        return True
    return bool((settings.bank_account or "").strip())


def _resolve_bin(bank_code: str) -> str:
    b = (bank_code or "").strip().lower()
    if not b:
        return ""
    if b.isdigit() and len(b) >= 6:
        return b
    return BANK_BIN.get(b, b)


def make_user_transfer_content(telegram_id: int) -> str:
    """Nội dung CK riêng mỗi người: AI + telegram_id + random (không dấu)."""
    tid = "".join(c for c in str(telegram_id) if c.isdigit())[:12]
    r = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(3))
    return f"AI{tid}{r}"[:25]


def make_web_transfer_content(web_user_id: int | None) -> str:
    wid = "".join(c for c in str(web_user_id or "") if c.isdigit())[:10]
    r = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(3))
    if wid:
        return f"AIW{wid}{r}"[:25]
    return f"AI{int(time.time()) % 10_000_000:x}{r}".upper()[:25]


def build_qr_image_url(
    settings: Settings,
    *,
    amount: int,
    content: str,
    template: str | None = None,
) -> str:
    """QR VietQR gắn STK trong .env (template Ar2xlTX nếu set)."""
    bank = (settings.bank_id or "hdbank").strip()
    acc = (settings.bank_account or "").replace(" ", "")
    name = (settings.bank_account_name or "").strip()
    bin_code = _resolve_bin(bank)
    # Prefer env-like template via optional attrs; default user template
    tpl = (template or settings.vietqr_template or "rRpDP7W").strip()
    tpl = "".join(c for c in tpl if c.isalnum() or c in "_-") or "compact2"
    host = (settings.vietqr_image_host or "api.vietqr.io").strip()
    host = host.replace("https://", "").replace("http://", "").rstrip("/")
    ext = "jpg" if "api.vietqr.io" in host else "png"
    base = f"https://{host}/image/{bin_code}-{acc}-{tpl}.{ext}"
    params: list[str] = []
    if amount and int(amount) > 0:
        params.append(f"amount={int(amount)}")
    if content:
        params.append(f"addInfo={quote(str(content)[:25])}")
    if name:
        params.append(f"accountName={quote(name)}")
    return base + ("?" + "&".join(params) if params else "")


def _make_order_id() -> str:
    t = format(int(time.time() * 1000), "x").upper()
    r = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
    return f"JV{t}{r}"[:13]


async def create_pay_order(
    settings: Settings,
    *,
    amount: int,
    plan: str,
    telegram_id: int | None = None,
    web_user_id: int | None = None,
    web_email: str | None = None,
    note: str = "",
    content: str | None = None,
) -> PayOrder:
    """Create QR order — prefer Node server, fallback local VietQR image URL."""
    if content:
        transfer = content.strip()
    elif telegram_id:
        transfer = make_user_transfer_content(int(telegram_id))
    else:
        transfer = make_web_transfer_content(web_user_id)

    payload: dict[str, Any] = {
        "amount": int(amount),
        "plan": plan,
        "note": note
        or (
            f"tg:{telegram_id}:{plan}"
            if telegram_id
            else f"web:{web_email or web_user_id}:{plan}"
        ),
        "content": transfer,
    }
    if telegram_id is not None:
        payload["telegramId"] = str(telegram_id)
    if web_user_id is not None:
        payload["webUserId"] = int(web_user_id)
    if web_email:
        payload["webEmail"] = str(web_email).strip().lower()

    base = (settings.vietqr_pay_url or "").rstrip("/")
    if base:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(f"{base}/api/orders", json=payload)
                data = res.json() if res.content else {}
                if res.status_code < 400 and data:
                    return _parse_order(data)
                logger.warning(
                    "vietqr-pay create failed %s: %s — using local QR",
                    res.status_code,
                    data,
                )
        except Exception as exc:
            # VPS thuong gap: vietqr-pay chua chay tren :3000
            logger.warning("vietqr-pay unreachable (%s) — local QR fallback", exc)

    # ----- Local fallback: still show QR with shop STK (khong can Node) -----
    if not (settings.bank_account or "").strip():
        raise RuntimeError(
            "Không tạo được QR: vietqr-pay (port 3000) không chạy và thiếu BANK_ACCOUNT. "
            "Tren VPS: systemctl start vietqr-pay  HOAC  dien BANK_ACCOUNT trong .env"
        )

    order_id = _make_order_id()
    qr_url = build_qr_image_url(settings, amount=int(amount), content=transfer)
    order = {
        "orderId": order_id,
        "content": transfer,
        "amount": int(amount),
        "plan": plan,
        "status": "pending",
        "qrImageUrl": qr_url,
        "payPage": None,
        "bank": {
            "code": settings.bank_id or "hdbank",
            "account": settings.bank_account,
            "name": settings.bank_account_name,
        },
        "webUserId": web_user_id,
        "webEmail": web_email,
        "telegramId": telegram_id,
        "createdAt": int(time.time() * 1000),
        "local": True,
    }
    _local_orders[order_id] = order
    _local_orders[f"content:{transfer}"] = order
    logger.info("Local QR order %s amount=%s content=%s", order_id, amount, transfer)
    return _parse_order(order)


async def get_order_status(settings: Settings, order_id: str) -> dict[str, Any]:
    oid = (order_id or "").strip()
    base = (settings.vietqr_pay_url or "").rstrip("/")
    if base:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(f"{base}/api/orders/{oid}/status")
                data = res.json() if res.content else {}
                if res.status_code < 400:
                    return data
        except Exception as exc:
            logger.warning("vietqr status fail: %s", exc)

    local = _local_orders.get(oid) or _local_orders.get(f"content:{oid}")
    if local:
        return {
            "orderId": local["orderId"],
            "status": local.get("status") or "pending",
            "amount": local.get("amount"),
            "plan": local.get("plan"),
            "content": local.get("content"),
            "qrImageUrl": local.get("qrImageUrl"),
            "local": True,
        }
    raise RuntimeError("Không tìm thấy đơn (vietqr-pay tắt hoặc order_id sai)")


async def health_check(settings: Settings) -> dict[str, Any]:
    base = (settings.vietqr_pay_url or "").rstrip("/")
    if not base:
        return {"ok": True, "mode": "local-fallback", "hasAccount": bool(settings.bank_account)}
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(f"{base}/api/health")
        res.raise_for_status()
        return res.json()


def mark_local_paid(order_id: str) -> dict[str, Any] | None:
    """Dev helper: mark local fallback order paid."""
    o = _local_orders.get(order_id)
    if not o:
        return None
    o["status"] = "paid"
    o["paidAt"] = int(time.time() * 1000)
    return o


def _parse_order(data: dict[str, Any]) -> PayOrder:
    bank = data.get("bank") or {}
    return PayOrder(
        order_id=str(data.get("orderId") or ""),
        amount=int(data.get("amount") or 0),
        plan=str(data.get("plan") or ""),
        status=str(data.get("status") or "pending"),
        content=str(data.get("content") or data.get("orderId") or ""),
        qr_image_url=data.get("qrImageUrl"),
        pay_page=data.get("payPage"),
        bank_code=str(bank.get("code") or ""),
        bank_account=str(bank.get("account") or ""),
        bank_name=str(bank.get("name") or ""),
        raw=data,
    )
