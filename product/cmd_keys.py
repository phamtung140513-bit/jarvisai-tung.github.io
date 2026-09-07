"""CMD / CLI license keys — generate, activate, list, revoke."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import secrets
import string
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import ROOT_DIR
from database.models import CmdLicenseKey

LICENSE_FILE = ROOT_DIR / "cache" / "cli_license.json"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def generate_cmd_code(prefix: str = "TD-CMD") -> str:
    alphabet = string.ascii_uppercase + string.digits
    body = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"{prefix}-{body[:4]}-{body[4:8]}-{body[8:]}"


def machine_fingerprint() -> str:
    raw = f"{platform.node()}|{os.environ.get('USERNAME') or os.environ.get('USER') or ''}|{platform.system()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


async def create_cmd_key(
    session: AsyncSession,
    *,
    days: int = 30,
    max_uses: int = 1,
    note: str = "",
) -> CmdLicenseKey:
    days = max(1, int(days or 30))
    max_uses = max(1, int(max_uses or 1))
    row = CmdLicenseKey(
        code=generate_cmd_code(),
        days=days,
        max_uses=max_uses,
        uses=0,
        note=(note or "").strip() or None,
        active=True,
        created_at=_utcnow(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def list_cmd_keys(session: AsyncSession, limit: int = 100) -> list[CmdLicenseKey]:
    res = await session.execute(
        select(CmdLicenseKey)
        .order_by(CmdLicenseKey.id.desc())
        .limit(min(max(limit, 1), 200))
    )
    return list(res.scalars().all())


async def revoke_cmd_key(session: AsyncSession, code: str) -> CmdLicenseKey | None:
    code = (code or "").strip().upper()
    res = await session.execute(select(CmdLicenseKey).where(CmdLicenseKey.code == code))
    row = res.scalar_one_or_none()
    if row is None:
        return None
    row.active = False
    await session.commit()
    await session.refresh(row)
    return row


async def activate_cmd_key(
    session: AsyncSession,
    code_str: str,
    *,
    machine: str | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    """Redeem a CMD key and return local license payload."""
    code_str = (code_str or "").strip().upper()
    if not code_str:
        return False, "Thieu ma key.", None

    res = await session.execute(
        select(CmdLicenseKey).where(CmdLicenseKey.code == code_str)
    )
    row = res.scalar_one_or_none()
    if row is None or not row.active:
        return False, "Key khong hop le hoac da bi thu hoi.", None
    if row.uses >= row.max_uses:
        # Same machine re-activate allowed if already used here
        mid = machine or machine_fingerprint()
        if row.last_machine and row.last_machine == mid and row.uses > 0:
            pass  # allow re-issue local license
        else:
            return False, "Key da het luot su dung.", None
    else:
        mid = machine or machine_fingerprint()
        row.uses = int(row.uses or 0) + 1
        row.last_machine = mid
        row.last_activated_at = _utcnow()
        await session.commit()
        await session.refresh(row)

    now = _utcnow()
    expires = now + timedelta(days=int(row.days or 30))
    payload = {
        "code": row.code,
        "days": row.days,
        "activated_at": now.isoformat(),
        "expires_at": expires.isoformat(),
        "machine": machine or machine_fingerprint(),
        "note": row.note or "",
    }
    save_local_license(payload)
    return True, f"Kich hoat OK — het han {expires.date().isoformat()}", payload


def save_local_license(payload: dict[str, Any]) -> Path:
    LICENSE_FILE.parent.mkdir(parents=True, exist_ok=True)
    LICENSE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return LICENSE_FILE


def load_local_license() -> dict[str, Any] | None:
    if not LICENSE_FILE.is_file():
        return None
    try:
        data = json.loads(LICENSE_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not data.get("code"):
            return None
        return data
    except Exception:
        return None


def clear_local_license() -> None:
    try:
        if LICENSE_FILE.is_file():
            LICENSE_FILE.unlink()
    except Exception:
        pass


def local_license_status() -> dict[str, Any]:
    """Check local license file only (fast, offline)."""
    data = load_local_license()
    if not data:
        return {"ok": False, "reason": "no_license", "message": "Chua kich hoat key CMD."}
    exp_s = str(data.get("expires_at") or "")
    try:
        exp = datetime.fromisoformat(exp_s)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    except Exception:
        return {"ok": False, "reason": "bad_file", "message": "File license hong."}
    now = _utcnow()
    if exp < now:
        return {
            "ok": False,
            "reason": "expired",
            "message": f"Key het han ({exp.date().isoformat()}).",
            "license": data,
        }
    days_left = max(0, (exp - now).days)
    return {
        "ok": True,
        "reason": "ok",
        "message": f"Hop le — con {days_left} ngay (het {exp.date().isoformat()}).",
        "days_left": days_left,
        "license": data,
    }


async def verify_local_against_db(session: AsyncSession) -> dict[str, Any]:
    """Optional re-check: local key still active in DB (not revoked)."""
    st = local_license_status()
    if not st.get("ok"):
        return st
    data = st.get("license") or {}
    code = str(data.get("code") or "").upper()
    res = await session.execute(select(CmdLicenseKey).where(CmdLicenseKey.code == code))
    row = res.scalar_one_or_none()
    if row is None or not row.active:
        clear_local_license()
        return {
            "ok": False,
            "reason": "revoked",
            "message": "Key da bi admin thu hoi.",
        }
    return st


def key_public_dict(row: CmdLicenseKey) -> dict[str, Any]:
    return {
        "id": row.id,
        "code": row.code,
        "days": row.days,
        "max_uses": row.max_uses,
        "uses": row.uses,
        "note": row.note,
        "active": row.active,
        "last_machine": row.last_machine,
        "last_activated_at": (
            row.last_activated_at.isoformat() if row.last_activated_at else None
        ),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "remaining_uses": max(0, int(row.max_uses or 0) - int(row.uses or 0)),
    }


def verify_remote_cmd_license(server_url: str = "https://tungai.fun") -> dict[str, Any]:
    """Verify license with remote TungDevAI server (checks deleted/revoked/expired)."""
    import urllib.request
    import urllib.error

    payment_url = f"{server_url.rstrip('/')}/cmd-pricing.html"
    local_data = load_local_license()
    if not local_data or not local_data.get("code"):
        return {
            "ok": False,
            "reason": "no_license",
            "message": "Bạn chưa kích hoạt key bản quyền TUNGAI.FUN CMD.",
            "payment_url": payment_url,
        }

    key_code = str(local_data.get("code") or "").strip().upper()
    mid = machine_fingerprint()

    # Call verify API on server
    verify_url = f"{server_url.rstrip('/')}/api/cmd/verify-license"
    req_body = json.dumps({"code": key_code, "machine": mid}).encode("utf-8")
    req = urllib.request.Request(
        verify_url,
        data=req_body,
        headers={"Content-Type": "application/json", "User-Agent": "TUNGAI.FUN-CMD/1.0"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if not data.get("ok"):
                # Key revoked or deleted by admin! Wipe local file immediately
                clear_local_license()
                return {
                    "ok": False,
                    "reason": data.get("reason", "invalid"),
                    "message": data.get("message", "Key bản quyền không hợp lệ hoặc đã bị thu hồi."),
                    "payment_url": payment_url,
                }
            return {
                "ok": True,
                "code": key_code,
                "days_left": data.get("days_left", 30),
                "message": data.get("message", f"Key hợp lệ."),
                "payment_url": payment_url,
                "license": local_data,
            }
    except Exception as exc:
        # Offline fallback: Check local expiration if server unreachable
        local_st = local_license_status()
        if not local_st.get("ok"):
            clear_local_license()
            return {
                "ok": False,
                "reason": local_st.get("reason", "expired"),
                "message": local_st.get("message", "Key bản quyền đã hết hạn."),
                "payment_url": payment_url,
            }
        local_st["payment_url"] = payment_url
        return local_st


def activate_remote_cmd_key(code_str: str, server_url: str = "https://tungai.fun") -> tuple[bool, str, dict[str, Any] | None]:
    """Activate key with remote TungDevAI server and store locally."""
    import urllib.request
    import urllib.error

    payment_url = f"{server_url.rstrip('/')}/cmd-pricing.html"
    code_str = (code_str or "").strip().upper()
    if not code_str:
        return False, "Vui lòng nhập mã key bản quyền.", None

    mid = machine_fingerprint()
    act_url = f"{server_url.rstrip('/')}/api/cmd/activate"
    req_body = json.dumps({"code": code_str, "machine": mid}).encode("utf-8")
    req = urllib.request.Request(
        act_url,
        data=req_body,
        headers={"Content-Type": "application/json", "User-Agent": "TUNGAI.FUN-CMD/1.0"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok") and data.get("license"):
                save_local_license(data["license"])
                return True, data.get("message", "Kích hoạt thành công!"), data["license"]
            return False, data.get("message", "Mã key không hợp lệ hoặc đã hết lượt sử dụng."), None
    except Exception as exc:
        return False, f"Không thể kết nối đến máy chủ xác thực: {exc}", None
