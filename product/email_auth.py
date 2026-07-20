"""Email + password auth with OTP verification (market-style AI web)."""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import smtplib
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import GoogleWebUser

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
OTP_TTL_SEC = 600  # 10 minutes
OTP_COOLDOWN_SEC = 45
MAX_OTP_ATTEMPTS = 8


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(normalize_email(email)))


def email_subject_id(email: str) -> str:
    """Stable synthetic google_sub for email-only accounts."""
    e = normalize_email(email)
    h = hashlib.sha256(e.encode("utf-8")).hexdigest()[:40]
    return f"email:{h}"


def hash_password(password: str, salt: str | None = None) -> str:
    """PBKDF2-HMAC-SHA256 (stdlib only). Format: pbkdf2$iterations$salt$hash."""
    if not password or len(password) < 6:
        raise ValueError("Mat khau toi thieu 6 ky tu")
    if len(password) > 128:
        raise ValueError("Mat khau qua dai")
    salt = salt or secrets.token_hex(16)
    iterations = 120_000
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    )
    return f"pbkdf2${iterations}${salt}${dk.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not password or not stored:
        return False
    try:
        kind, it_s, salt, hx = stored.split("$", 3)
        if kind != "pbkdf2":
            return False
        iterations = int(it_s)
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        return hmac.compare_digest(dk.hex(), hx)
    except Exception:
        return False


class OtpStore:
    """In-memory OTP codes (restart clears pending codes)."""

    def __init__(self) -> None:
        self._data: dict[str, dict[str, Any]] = {}

    def _key(self, email: str, purpose: str) -> str:
        return f"{purpose}:{normalize_email(email)}"

    def create(self, email: str, purpose: str) -> str:
        email = normalize_email(email)
        key = self._key(email, purpose)
        now = time.time()
        prev = self._data.get(key)
        if prev and now - float(prev.get("created", 0)) < OTP_COOLDOWN_SEC:
            wait = int(OTP_COOLDOWN_SEC - (now - float(prev["created"])))
            raise ValueError(f"Vui long doi {wait}s roi gui ma lai")
        code = f"{secrets.randbelow(1_000_000):06d}"
        self._data[key] = {
            "code": code,
            "created": now,
            "expires": now + OTP_TTL_SEC,
            "attempts": 0,
            "email": email,
            "purpose": purpose,
        }
        return code

    def verify(self, email: str, purpose: str, code: str) -> bool:
        key = self._key(email, purpose)
        row = self._data.get(key)
        if not row:
            return False
        now = time.time()
        if now > float(row["expires"]):
            self._data.pop(key, None)
            return False
        row["attempts"] = int(row.get("attempts", 0)) + 1
        if row["attempts"] > MAX_OTP_ATTEMPTS:
            self._data.pop(key, None)
            return False
        ok = hmac.compare_digest(str(row["code"]), str(code or "").strip())
        if ok:
            self._data.pop(key, None)
        return ok


def _otp_email_copy(purpose: str, app_name: str) -> tuple[str, str, str]:
    """Return (purpose_vi, title, lead) for OTP mail."""
    if purpose == "register":
        return (
            "đăng ký",
            f"Xác nhận đăng ký {app_name}",
            "Chúng tôi sẽ gửi mã bảo mật để xác nhận đó thực sự là bạn. "
            "Nhập mã bên dưới trên trang đăng ký:",
        )
    if purpose == "login":
        return (
            "đăng nhập",
            f"Mã đăng nhập {app_name}",
            "Dùng mã sau để xác nhận đăng nhập. Không chia sẻ mã với bất kỳ ai.",
        )
    return (
        "xác thực",
        f"Mã xác thực {app_name}",
        "Nhập mã bên dưới để hoàn tất xác thực tài khoản.",
    )


def build_otp_email_html(
    *,
    code: str,
    purpose: str,
    app_name: str = "TungDevAI",
    to_email: str = "",
) -> str:
    """HTML OTP email — dark card, green accent (match web chat.css)."""
    purpose_vi, title, lead = _otp_email_copy(purpose, app_name)
    # Escape minimal user-controlled bits (code is digits; names fixed)
    safe_code = "".join(c for c in str(code) if c.isdigit())[:8] or str(code)[:8]
    safe_app = (
        str(app_name)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    greeting = "Xin chào,"
    if to_email and "@" in to_email:
        local = to_email.split("@", 1)[0].strip()
        if local:
            safe_local = (
                local.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            greeting = f"Xin chào {safe_local},"

    # Inline CSS only — email clients strip <style> / external CSS
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#212121;font-family:Inter,Segoe UI,system-ui,-apple-system,sans-serif;color:#ececec;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#212121;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#171717;border:1px solid rgba(255,255,255,0.10);border-radius:20px;overflow:hidden;">
          <!-- header accent -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#10a37f,#1a7f64);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;text-align:center;">
              <div style="display:inline-block;width:52px;height:52px;line-height:52px;border-radius:50%;background:rgba(16,163,127,0.18);border:1px solid rgba(16,163,127,0.35);color:#10a37f;font-weight:700;font-size:18px;letter-spacing:-0.02em;">
                TD
              </div>
              <h1 style="margin:14px 0 0;font-size:22px;font-weight:700;color:#ececec;letter-spacing:-0.02em;">
                {safe_app}
              </h1>
              <p style="margin:6px 0 0;font-size:13px;color:#9b9b9b;letter-spacing:0.04em;text-transform:uppercase;">
                Mã {purpose_vi}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 4px;">
              <h2 style="margin:0 0 10px;font-size:18px;font-weight:600;color:#ececec;text-align:left;">
                Confirm that it's you
              </h2>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#ececec;text-align:left;">
                {greeting}
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#9b9b9b;text-align:left;">
                {lead}
              </p>
            </td>
          </tr>
          <!-- OTP box -->
          <tr>
            <td style="padding:0 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(16,163,127,0.12);border:1px solid rgba(16,163,127,0.35);border-radius:14px;">
                <tr>
                  <td align="center" style="padding:22px 16px;">
                    <div style="font-size:12px;color:#9b9b9b;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px;">
                      Mã bảo mật
                    </div>
                    <div style="font-family:ui-monospace,Cascadia Code,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:0.28em;color:#ececec;line-height:1.2;">
                      {safe_code}
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;font-size:12px;color:#9b9b9b;text-align:center;">
                Don't share this code with anyone.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#2f2f2f;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                <tr>
                  <td style="padding:14px 16px;text-align:left;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#ececec;">
                      Nếu ai đó hỏi mã này
                    </p>
                    <p style="margin:0;font-size:12px;line-height:1.5;color:#9b9b9b;">
                      Đừng chia sẻ mã với bất kỳ ai — kể cả khi họ tự xưng là {safe_app}.
                      Mã có hiệu lực <strong style="color:#ececec;">10 phút</strong>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 28px;text-align:left;">
              <p style="margin:0 0 6px;font-size:12px;color:#9b9b9b;line-height:1.5;">
                Không yêu cầu mã? Bỏ qua email này — tài khoản vẫn an toàn.
              </p>
              <p style="margin:16px 0 0;font-size:12px;color:#6b6b6b;">
                — {safe_app}
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-size:11px;color:#6b6b6b;max-width:480px;line-height:1.45;">
          Email tự động từ hệ thống {safe_app}. Không trả lời thư này.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>"""


def build_otp_email_text(
    *,
    code: str,
    purpose: str,
    app_name: str = "TungDevAI",
    to_email: str = "",
) -> str:
    purpose_vi, title, lead = _otp_email_copy(purpose, app_name)
    greeting = "Xin chào,"
    if to_email and "@" in to_email:
        local = to_email.split("@", 1)[0].strip()
        if local:
            greeting = f"Xin chào {local},"
    return (
        f"{title}\n\n"
        f"{greeting}\n\n"
        f"{lead}\n\n"
        f"    {code}\n\n"
        f"Mã có hiệu lực 10 phút. Đừng chia sẻ mã với bất kỳ ai.\n"
        f"Nếu bạn không yêu cầu, hãy bỏ qua email này.\n\n"
        f"— {app_name}\n"
    )


def send_otp_email(
    *,
    to_email: str,
    code: str,
    purpose: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    smtp_from: str,
    smtp_tls: bool,
    app_name: str = "TungDevAI",
) -> None:
    """Send verification code via SMTP (HTML + plain text). Raises on failure."""
    purpose_vi, _title, _lead = _otp_email_copy(purpose, app_name)
    subject = f"[{app_name}] Mã {purpose_vi}: {code}"
    plain = build_otp_email_text(
        code=code, purpose=purpose, app_name=app_name, to_email=to_email
    )
    html = build_otp_email_html(
        code=code, purpose=purpose, app_name=app_name, to_email=to_email
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = smtp_from or smtp_user or "noreply@tungdevai.local"
    msg["To"] = to_email
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")

    host = (smtp_host or "").strip()
    if not host:
        raise RuntimeError("SMTP_HOST chua cau hinh")

    port = int(smtp_port or 587)
    if smtp_tls and port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=20) as s:
            if smtp_user:
                s.login(smtp_user, smtp_password or "")
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.ehlo()
            if smtp_tls:
                s.starttls()
                s.ehlo()
            if smtp_user:
                s.login(smtp_user, smtp_password or "")
            s.send_message(msg)


async def ensure_web_user_columns(conn) -> None:
    """Add password / plan / usage columns if missing (SQLite)."""

    def _sync(sync_conn) -> None:
        try:
            rows = sync_conn.execute(text("PRAGMA table_info(google_web_users)")).fetchall()
        except Exception:
            return
        cols = {r[1] for r in rows}  # name is index 1
        alters: list[str] = []
        if "password_hash" not in cols:
            alters.append(
                "ALTER TABLE google_web_users ADD COLUMN password_hash VARCHAR(256)"
            )
        if "email_verified" not in cols:
            alters.append(
                "ALTER TABLE google_web_users ADD COLUMN email_verified BOOLEAN DEFAULT 0"
            )
        if "plan_id" not in cols:
            alters.append(
                "ALTER TABLE google_web_users ADD COLUMN plan_id VARCHAR(32) DEFAULT 'trial'"
            )
        if "plan_expires_at" not in cols:
            alters.append(
                "ALTER TABLE google_web_users ADD COLUMN plan_expires_at DATETIME"
            )
        if "usage_day" not in cols:
            alters.append(
                "ALTER TABLE google_web_users ADD COLUMN usage_day VARCHAR(10)"
            )
        if "usage_count" not in cols:
            alters.append(
                "ALTER TABLE google_web_users ADD COLUMN usage_count INTEGER DEFAULT 0"
            )
        for sql in alters:
            sync_conn.execute(text(sql))

    await conn.run_sync(_sync)


async def find_user_by_email(
    session: AsyncSession, email: str
) -> GoogleWebUser | None:
    e = normalize_email(email)
    if not e:
        return None
    res = await session.execute(
        select(GoogleWebUser).where(GoogleWebUser.email == e)
    )
    user = res.scalar_one_or_none()
    if user:
        return user
    # also try synthetic sub
    sub = email_subject_id(e)
    res2 = await session.execute(
        select(GoogleWebUser).where(GoogleWebUser.google_sub == sub)
    )
    return res2.scalar_one_or_none()


async def register_email_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    name: str | None = None,
) -> GoogleWebUser:
    e = normalize_email(email)
    if not valid_email(e):
        raise ValueError("Email khong hop le")
    existing = await find_user_by_email(session, e)
    if existing and existing.password_hash:
        raise ValueError("Email da duoc dang ky. Hay dang nhap.")
    if existing and existing.google_sub and not str(existing.google_sub).startswith("email:"):
        raise ValueError("Email nay da dung Google. Hay dang nhap bang Google.")

    now = datetime.now(timezone.utc)
    pw = hash_password(password)
    display = (name or "").strip()[:120] or e.split("@")[0]

    if existing:
        existing.password_hash = pw
        existing.email_verified = True
        existing.email = e
        existing.name = display
        existing.last_login_at = now
        existing.active = True
        if not getattr(existing, "plan_id", None):
            existing.plan_id = "trial"
        if getattr(existing, "plan_expires_at", None) is None:
            from datetime import timedelta

            existing.plan_expires_at = now + timedelta(days=3)
        user = existing
    else:
        from datetime import timedelta

        user = GoogleWebUser(
            google_sub=email_subject_id(e),
            email=e,
            name=display,
            picture=None,
            active=True,
            password_hash=pw,
            email_verified=True,
            plan_id="trial",
            plan_expires_at=now + timedelta(days=3),
            usage_day=None,
            usage_count=0,
            last_login_at=now,
            created_at=now,
        )
        session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def login_email_user(
    session: AsyncSession, *, email: str, password: str
) -> GoogleWebUser:
    e = normalize_email(email)
    user = await find_user_by_email(session, e)
    if not user or not user.password_hash:
        raise ValueError("Email hoac mat khau khong dung")
    if not user.active:
        raise ValueError("Tai khoan da bi khoa")
    if not verify_password(password, user.password_hash):
        raise ValueError("Email hoac mat khau khong dung")
    if not getattr(user, "email_verified", True):
        raise ValueError("Email chua xac thuc")
    user.last_login_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(user)
    return user
