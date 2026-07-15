"""
Web chat server (FastAPI) — dung chung GrokClient voi bot Telegram.

Chay:
  python -m webapp.server
  uvicorn webapp.server:app --host 0.0.0.0 --port 7860

.env:
  WEB_ADMIN_KEY=...     # bat buoc cho tab Admin tren web
  WEB_ACCESS_TOKEN=...  # tuy chon: user can token de chat
  WEB_CORS_ORIGINS=*    # hoac https://user.github.io
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Deque

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai.grok import GrokClient, GrokError  # noqa: E402
from ai.prompts import SYSTEM_PROMPT  # noqa: E402
from config import get_settings  # noqa: E402
from database.sqlite import Database, set_db  # noqa: E402
from product.access_codes import create_access_code  # noqa: E402
from product.plans import PLANS, get_plan  # noqa: E402
from database.repos import load_recent_messages, save_message  # noqa: E402
from product.email_auth import (  # noqa: E402
    OtpStore,
    ensure_web_user_columns,
    find_user_by_email,
    login_email_user,
    normalize_email,
    register_email_user,
    send_otp_email,
    valid_email,
)
from product.google_auth import upsert_google_user, verify_google_id_token  # noqa: E402
from product.users import (  # noqa: E402
    deactivate_user,
    list_users,
    set_user_plan,
    stats_summary,
)
from product.web_plans import (  # noqa: E402
    bump_web_usage,
    check_web_quota,
    ensure_plan_defaults,
    list_web_users,
    redeem_web_access_code,
    set_web_user_plan,
    user_public,
)
from database.models import GoogleWebUser  # noqa: E402
from sqlalchemy import select  # noqa: E402


def _session_uid(session_id: str) -> int:
    """Map web session string → stable positive int for SQLite storage."""
    h = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:15]
    return int(h, 16)

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"
# Same-domain UI: serve GitHub Pages chat (docs/) + /api on one host
DOCS_DIR = ROOT / "docs"

# Coding-first system (same spirit as Telegram)
WEB_SYSTEM = SYSTEM_PROMPT


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=32000)
    session_id: str = Field(default="", max_length=64)
    stream: bool = True


class AdminLoginBody(BaseModel):
    key: str = Field(..., min_length=1, max_length=256)


class GenCodeBody(BaseModel):
    plan: str = Field(default="basic")
    days: int | None = Field(default=None)
    note: str = Field(default="web_admin")


class SetPlanBody(BaseModel):
    telegram_id: int
    plan: str = Field(default="basic")
    days: int | None = Field(default=None)


class DelUserBody(BaseModel):
    telegram_id: int


class ActivateBody(BaseModel):
    code: str = Field(..., min_length=4, max_length=64)


class WebSetPlanBody(BaseModel):
    email: str = Field(default="")
    user_id: int | None = Field(default=None)
    plan: str = Field(default="basic")
    days: int | None = Field(default=None)


class GoogleLoginBody(BaseModel):
    credential: str = Field(..., min_length=10, description="Google GIS ID token JWT")


class SendCodeBody(BaseModel):
    email: str = Field(..., min_length=5, max_length=256)
    purpose: str = Field(default="register", max_length=32)  # register | reset


class RegisterBody(BaseModel):
    email: str = Field(..., min_length=5, max_length=256)
    password: str = Field(..., min_length=6, max_length=128)
    code: str = Field(..., min_length=4, max_length=12)
    name: str = Field(default="", max_length=120)


class EmailLoginBody(BaseModel):
    email: str = Field(..., min_length=5, max_length=256)
    password: str = Field(..., min_length=1, max_length=128)


class SessionMemory:
    def __init__(self, max_messages: int = 40) -> None:
        self._max = max_messages
        self._store: dict[str, Deque[dict[str, str]]] = defaultdict(
            lambda: deque(maxlen=self._max)
        )

    def get(self, sid: str) -> list[dict[str, str]]:
        return list(self._store[sid])

    def add(self, sid: str, role: str, content: str) -> None:
        self._store[sid].append({"role": role, "content": content})

    def clear(self, sid: str) -> None:
        self._store.pop(sid, None)


def create_app() -> FastAPI:
    settings = get_settings()
    memory = SessionMemory(settings.max_history_messages)
    grok = GrokClient(settings)
    db = Database(settings)

    access_token = (settings.web_access_token or os.getenv("WEB_ACCESS_TOKEN") or "").strip()
    admin_key = (settings.web_admin_key or os.getenv("WEB_ADMIN_KEY") or "").strip()
    google_client_id = (settings.google_client_id or os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    # WEB_AUTH_REQUIRED wins; else GOOGLE_AUTH_REQUIRED (legacy)
    if settings.web_auth_required is not None:
        auth_required = bool(settings.web_auth_required)
    else:
        auth_required = bool(settings.google_auth_required)
    google_auth_required = auth_required  # keep name for older clients
    cors_raw = (settings.web_cors_origins or os.getenv("WEB_CORS_ORIGINS") or "*").strip()
    cors_origins = [o.strip() for o in cors_raw.split(",") if o.strip()]

    smtp_host = (settings.smtp_host or os.getenv("SMTP_HOST") or "").strip()
    smtp_port = int(settings.smtp_port or 587)
    smtp_user = (settings.smtp_user or os.getenv("SMTP_USER") or "").strip()
    smtp_password = (settings.smtp_password or os.getenv("SMTP_PASSWORD") or "").strip()
    smtp_from = (settings.smtp_from or os.getenv("SMTP_FROM") or smtp_user or "").strip()
    smtp_tls = bool(settings.smtp_tls)
    auth_dev_show_code = bool(settings.auth_dev_show_code)

    # Admin session tokens (in-memory; restart invalidates)
    admin_sessions: set[str] = set()
    # User sessions: token -> user dict (Google + email)
    user_sessions: dict[str, dict[str, Any]] = {}
    otp_store = OtpStore()

    app = FastAPI(title=f"{settings.app_name} Web", version="1.4")
    app.state.settings = settings
    app.state.memory = memory
    app.state.grok = grok
    app.state.db = db
    app.state.access_token = access_token
    app.state.admin_key = admin_key
    app.state.admin_sessions = admin_sessions
    app.state.user_sessions = user_sessions
    app.state.google_client_id = google_client_id
    app.state.google_auth_required = google_auth_required
    app.state.auth_required = auth_required

    @app.on_event("startup")
    async def _startup() -> None:
        await db.init()
        # Migrate email-auth columns on existing DBs
        async with db.engine.begin() as conn:
            await ensure_web_user_columns(conn)
        set_db(db)
        logger.info("Web DB ready (email + Google auth)")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins if cors_origins != ["*"] else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # Assets for docs/ chat UI (same origin as API)
    if (DOCS_DIR / "assets").is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(DOCS_DIR / "assets")),
            name="docs-assets",
        )

    def _bearer(authorization: str | None) -> str:
        if authorization and authorization.lower().startswith("bearer "):
            return authorization[7:].strip()
        return ""

    def _check_user_token(
        authorization: str | None,
        x_token: str | None,
        x_user_session: str | None = None,
    ) -> dict[str, Any] | None:
        """Validate optional WEB_ACCESS_TOKEN and/or Google session."""
        # Legacy shared token
        if access_token:
            bearer = _bearer(authorization)
            got = (x_token or bearer or "").strip()
            if got != access_token:
                # allow Google session instead of access token
                if not (x_user_session and x_user_session in user_sessions):
                    raise HTTPException(status_code=401, detail="Sai user access token")

        if auth_required:
            sess = (x_user_session or "").strip()
            if not sess or sess not in user_sessions:
                raise HTTPException(
                    status_code=401,
                    detail="Cần đăng nhập (email hoặc Google)",
                )
            return user_sessions[sess]
        if x_user_session and x_user_session in user_sessions:
            return user_sessions[x_user_session]
        return None

    def _issue_session(user: Any) -> dict[str, Any]:
        sess = secrets.token_urlsafe(32)
        pub = user_public(user)
        payload = {
            "id": getattr(user, "id", None),
            "google_sub": getattr(user, "google_sub", None),
            "email": getattr(user, "email", None),
            "name": getattr(user, "name", None),
            "picture": getattr(user, "picture", None),
            "plan_id": pub.get("plan_id"),
            "plan_name": pub.get("plan_name"),
            "daily_limit": pub.get("daily_limit"),
            "used_today": pub.get("used_today"),
            "remaining_today": pub.get("remaining_today"),
            "plan_expires_at": pub.get("plan_expires_at"),
            "plan_expired": pub.get("plan_expired"),
        }
        user_sessions[sess] = payload
        return {
            "ok": True,
            "session_token": sess,
            "user": pub,
        }

    async def _load_web_user(guser: dict[str, Any] | None) -> GoogleWebUser | None:
        if not guser or not guser.get("id"):
            return None
        async with db.session() as session:
            res = await session.execute(
                select(GoogleWebUser).where(GoogleWebUser.id == int(guser["id"]))
            )
            user = res.scalar_one_or_none()
            if user is None:
                return None
            return await ensure_plan_defaults(session, user)

    def _check_admin(
        authorization: str | None,
        x_admin: str | None,
    ) -> None:
        if not admin_key:
            raise HTTPException(
                status_code=503,
                detail="WEB_ADMIN_KEY chua cau hinh tren server",
            )
        bearer = ""
        if authorization and authorization.lower().startswith("bearer "):
            bearer = authorization[7:].strip()
        got = (x_admin or bearer or "").strip()
        if got == admin_key or got in admin_sessions:
            return
        raise HTTPException(status_code=401, detail="Sai admin key")

    def _docs_file(name: str) -> Path | None:
        path = (DOCS_DIR / name).resolve()
        try:
            path.relative_to(DOCS_DIR.resolve())
        except ValueError:
            return None
        return path if path.is_file() else None

    def _serve_landing():
        """Marketing page. Prefer landing.html (index.html only redirects)."""
        p = _docs_file("landing.html")
        if p:
            return FileResponse(p)
        p2 = _docs_file("index.html")
        if p2:
            return FileResponse(p2)
        return HTMLResponse("<h1>Missing landing</h1>", status_code=500)

    def _serve_chat():
        p = _docs_file("chat.html")
        if p:
            return FileResponse(p)
        # legacy fallback
        for candidate in (STATIC_DIR / "index.html",):
            if candidate.is_file():
                return FileResponse(candidate)
        return HTMLResponse("<h1>Missing chat.html</h1>", status_code=500)

    @app.get("/", response_model=None)
    async def index():
        return _serve_landing()

    @app.get("/index.html", response_model=None)
    async def index_html():
        return _serve_landing()

    @app.get("/landing.html", response_model=None)
    async def landing():
        # Keep old URL; same as root landing
        return _serve_landing()

    @app.get("/chat.html", response_model=None)
    async def chat_page():
        return _serve_chat()

    @app.get("/pricing.html", response_model=None)
    async def pricing_page():
        p = _docs_file("pricing.html")
        return FileResponse(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/pricing.css", response_model=None)
    async def pricing_css():
        p = _docs_file("pricing.css")
        return FileResponse(p, media_type="text/css") if p else HTMLResponse("x", status_code=404)

    @app.get("/login.html", response_model=None)
    async def login_page():
        p = _docs_file("login.html")
        return FileResponse(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/register.html", response_model=None)
    async def register_page():
        p = _docs_file("register.html")
        return FileResponse(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/google-callback.html", response_model=None)
    async def google_callback_page():
        p = _docs_file("google-callback.html")
        return FileResponse(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/auth.js", response_model=None)
    async def auth_js():
        p = _docs_file("auth.js")
        return (
            FileResponse(p, media_type="application/javascript")
            if p
            else HTMLResponse("x", status_code=404)
        )

    @app.get("/config.json")
    async def config_json() -> dict[str, Any]:
        # Same-domain: empty apiBase => frontend uses location.origin
        return {
            "apiBase": "",
            "telegramBot": "https://t.me/grokapiai_bot",
            "appName": settings.app_name,
            "sameOrigin": True,
        }

    @app.get("/chat.js", response_model=None)
    async def chat_js():
        p = _docs_file("chat.js")
        return FileResponse(p, media_type="application/javascript") if p else HTMLResponse("x", status_code=404)

    @app.get("/chat.css", response_model=None)
    async def chat_css():
        p = _docs_file("chat.css")
        return FileResponse(p, media_type="text/css") if p else HTMLResponse("x", status_code=404)

    @app.get("/styles.css", response_model=None)
    async def styles_css():
        p = _docs_file("styles.css")
        return FileResponse(p, media_type="text/css") if p else HTMLResponse("x", status_code=404)

    # Secret admin page — not linked from user chat UI
    @app.get("/j-panel.html", response_model=None)
    async def admin_panel_page():
        p = _docs_file("j-panel.html")
        return FileResponse(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/admin.js", response_model=None)
    async def admin_js():
        p = _docs_file("admin.js")
        return (
            FileResponse(p, media_type="application/javascript")
            if p
            else HTMLResponse("x", status_code=404)
        )

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "service": "tungdevai-web",
            "app": settings.app_name,
            "provider": settings.provider,
            "model": settings.resolved_model,
            "auth_required": bool(access_token) or auth_required,
            "email_auth": True,
            "smtp_configured": bool(smtp_host),
            "google_auth": bool(google_client_id),
            "google_auth_required": auth_required,
            "admin_enabled": bool(admin_key),
            "same_origin_ui": True,
        }

    @app.get("/api/config")
    async def public_config() -> dict[str, Any]:
        # Public: no secrets (client_id is public by design for GIS)
        return {
            "app_name": settings.app_name,
            "tagline": settings.product_tagline,
            "provider": settings.provider,
            "model": settings.resolved_model,
            "auth_required": bool(access_token) or auth_required,
            "email_auth": True,
            "smtp_configured": bool(smtp_host),
            "google_client_id": google_client_id,
            "google_auth": bool(google_client_id),
            "google_auth_required": auth_required,
            "admin_enabled": bool(admin_key),
            "telegram_bot": "https://t.me/grokapiai_bot",
            "role": "coder",
            "apiBase": "",
            "same_origin": True,
        }

    @app.post("/api/auth/send-code")
    async def auth_send_code(body: SendCodeBody) -> dict[str, Any]:
        """Send 6-digit verification code to email (register flow)."""
        email = normalize_email(body.email)
        purpose = (body.purpose or "register").strip().lower()
        if purpose not in ("register", "reset"):
            purpose = "register"
        if not valid_email(email):
            raise HTTPException(400, "Email không hợp lệ")

        if purpose == "register":
            async with db.session() as session:
                existing = await find_user_by_email(session, email)
                if existing and existing.password_hash:
                    raise HTTPException(400, "Email đã được đăng ký. Hãy đăng nhập.")

        try:
            code = otp_store.create(email, purpose)
        except ValueError as exc:
            raise HTTPException(429, str(exc)) from exc

        sent = False
        err_msg = ""
        if smtp_host:
            try:
                send_otp_email(
                    to_email=email,
                    code=code,
                    purpose=purpose,
                    smtp_host=smtp_host,
                    smtp_port=smtp_port,
                    smtp_user=smtp_user,
                    smtp_password=smtp_password,
                    smtp_from=smtp_from,
                    smtp_tls=smtp_tls,
                    app_name=settings.app_name,
                )
                sent = True
            except Exception as exc:
                logger.exception("SMTP send failed")
                err_msg = str(exc)
        else:
            logger.warning(
                "SMTP not configured — OTP for %s (%s): %s", email, purpose, code
            )

        if not sent and not auth_dev_show_code:
            raise HTTPException(
                503,
                "Khong gui duoc email. Cau hinh SMTP_HOST/SMTP_USER/SMTP_PASSWORD trong .env",
            )

        out: dict[str, Any] = {
            "ok": True,
            "email": email,
            "purpose": purpose,
            "sent": sent,
            "message": (
                "Đã gửi mã xác thực tới email của bạn."
                if sent
                else "SMTP chưa cấu hình — dùng mã dev (xem bên dưới / log server)."
            ),
            "expires_in": 600,
        }
        # Local/dev: return code so you can test without Gmail SMTP
        if auth_dev_show_code and not sent:
            out["dev_code"] = code
            out["message"] = f"Mã xác thực (dev): {code} — cấu hình SMTP để gửi thật."
        if err_msg and auth_dev_show_code:
            out["dev_code"] = code
            out["smtp_error"] = err_msg
            out["message"] = f"SMTP lỗi, mã dev: {code}"
        return out

    @app.post("/api/auth/register")
    async def auth_register(body: RegisterBody) -> dict[str, Any]:
        """Register with email + password after OTP verification."""
        email = normalize_email(body.email)
        if not valid_email(email):
            raise HTTPException(400, "Email không hợp lệ")
        if not otp_store.verify(email, "register", body.code):
            raise HTTPException(400, "Mã xác thực sai hoặc đã hết hạn")
        try:
            async with db.session() as session:
                user = await register_email_user(
                    session,
                    email=email,
                    password=body.password,
                    name=body.name,
                )
                user = await ensure_plan_defaults(session, user)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return _issue_session(user)

    @app.post("/api/auth/login")
    async def auth_login_email(body: EmailLoginBody) -> dict[str, Any]:
        """Login with email + password."""
        try:
            async with db.session() as session:
                user = await login_email_user(
                    session, email=body.email, password=body.password
                )
                user = await ensure_plan_defaults(session, user)
        except ValueError as exc:
            raise HTTPException(401, str(exc)) from exc
        return _issue_session(user)

    @app.post("/api/auth/google")
    async def auth_google(body: GoogleLoginBody) -> dict[str, Any]:
        """Exchange Google ID token for app session (Sign in with Google)."""
        if not google_client_id:
            raise HTTPException(
                503,
                "GOOGLE_CLIENT_ID chưa cấu hình. Xem docs/HUONG_DAN_GOOGLE_LOGIN.md",
            )
        try:
            info = verify_google_id_token(body.credential, google_client_id)
        except Exception as exc:
            logger.warning("Google token invalid: %s", exc)
            raise HTTPException(401, f"Google token không hợp lệ: {exc}") from exc

        async with db.session() as session:
            try:
                user = await upsert_google_user(session, info)
                user = await ensure_plan_defaults(session, user)
            except ValueError as exc:
                raise HTTPException(403, str(exc)) from exc

        return _issue_session(user)

    @app.get("/api/auth/me")
    async def auth_me(
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        if not x_user_session or x_user_session not in user_sessions:
            raise HTTPException(401, "Chưa đăng nhập")
        guser = user_sessions[x_user_session]
        db_user = await _load_web_user(guser)
        if db_user is not None:
            pub = user_public(db_user)
            guser.update(pub)
            user_sessions[x_user_session] = guser
            return {"ok": True, "user": pub}
        return {"ok": True, "user": guser}

    @app.post("/api/auth/activate")
    async def auth_activate(
        body: ActivateBody,
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        """Redeem access code (same as Telegram /activate) for logged-in web user."""
        if not x_user_session or x_user_session not in user_sessions:
            raise HTTPException(401, "Cần đăng nhập trước khi kích hoạt mã")
        guser = user_sessions[x_user_session]
        db_user = await _load_web_user(guser)
        if db_user is None:
            raise HTTPException(401, "Phiên đăng nhập không hợp lệ")
        async with db.session() as session:
            # re-fetch in this session
            res = await session.execute(
                select(GoogleWebUser).where(GoogleWebUser.id == db_user.id)
            )
            user = res.scalar_one_or_none()
            if user is None:
                raise HTTPException(401, "User không tồn tại")
            ok, msg = await redeem_web_access_code(
                session, code_str=body.code, user=user
            )
            if not ok:
                raise HTTPException(400, msg)
            await session.refresh(user)
            pub = user_public(user)
        guser.update(pub)
        user_sessions[x_user_session] = guser
        return {"ok": True, "message": msg, "user": pub}

    @app.post("/api/auth/logout")
    async def auth_logout(
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        if x_user_session and x_user_session in user_sessions:
            user_sessions.pop(x_user_session, None)
        return {"ok": True}

    @app.post("/api/admin/login")
    async def admin_login(body: AdminLoginBody) -> dict[str, Any]:
        if not admin_key:
            raise HTTPException(503, "WEB_ADMIN_KEY chua set trong .env")
        if body.key.strip() != admin_key:
            raise HTTPException(401, "Sai admin key")
        token = secrets.token_urlsafe(24)
        admin_sessions.add(token)
        return {
            "ok": True,
            "admin_token": token,
            "provider": settings.provider,
            "model": settings.resolved_model,
        }

    @app.get("/api/admin/status")
    async def admin_status(
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        async with db.session() as session:
            stats = await stats_summary(session)
        return {
            "ok": True,
            "app": settings.app_name,
            "provider": settings.provider,
            "model": settings.resolved_model,
            "base_url": settings.resolved_base_url,
            "user_auth_required": bool(access_token),
            "web_sessions": len(memory._store),  # noqa: SLF001
            "stats": stats,
            "plans": [
                {
                    "id": p.id,
                    "name": p.name,
                    "price_vnd": p.price_vnd,
                    "days": p.days,
                    "daily_messages": p.daily_messages,
                }
                for p in PLANS.values()
                if p.id != "owner"
            ],
        }

    @app.get("/api/admin/users")
    async def admin_users(
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
        limit: int = 50,
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        async with db.session() as session:
            rows = await list_users(session, min(max(limit, 1), 100))
        users = []
        for u in rows:
            users.append(
                {
                    "telegram_id": u.telegram_id,
                    "username": u.username,
                    "full_name": u.full_name,
                    "plan_id": u.plan_id,
                    "active": u.active,
                    "is_admin": u.is_admin,
                    "expires_at": u.expires_at.isoformat() if u.expires_at else None,
                    "created_at": u.created_at.isoformat() if u.created_at else None,
                }
            )
        return {"ok": True, "users": users}

    @app.post("/api/admin/gencode")
    async def admin_gencode(
        body: GenCodeBody,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        plan_id = (body.plan or "basic").lower().strip()
        if plan_id not in PLANS or plan_id == "owner":
            raise HTTPException(400, "Plan khong hop le")
        async with db.session() as session:
            code = await create_access_code(
                session,
                plan_id=plan_id,
                days=body.days,
                note=body.note or "web_admin",
                created_by=None,
            )
        plan = get_plan(plan_id)
        return {
            "ok": True,
            "code": code.code,
            "plan": plan.id,
            "plan_name": plan.name,
            "days": code.days,
            "max_uses": code.max_uses,
            "activate": f"/activate {code.code}",
        }

    @app.post("/api/admin/setplan")
    async def admin_setplan(
        body: SetPlanBody,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        plan_id = (body.plan or "basic").lower().strip()
        if plan_id not in PLANS:
            raise HTTPException(400, "Plan khong hop le")
        async with db.session() as session:
            user = await set_user_plan(
                session, body.telegram_id, plan_id, body.days
            )
        return {
            "ok": True,
            "telegram_id": user.telegram_id,
            "plan_id": user.plan_id,
            "active": user.active,
            "expires_at": user.expires_at.isoformat() if user.expires_at else None,
        }

    @app.get("/api/admin/web-users")
    async def admin_web_users(
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        async with db.session() as session:
            rows = await list_web_users(session)
        return {
            "ok": True,
            "users": [
                {
                    "id": u.id,
                    "email": u.email,
                    "name": u.name,
                    "plan_id": getattr(u, "plan_id", "trial") or "trial",
                    "active": u.active,
                    "plan_expires_at": (
                        u.plan_expires_at.isoformat()
                        if getattr(u, "plan_expires_at", None)
                        else None
                    ),
                    "usage_day": getattr(u, "usage_day", None),
                    "usage_count": int(getattr(u, "usage_count", 0) or 0),
                    "created_at": u.created_at.isoformat() if u.created_at else None,
                }
                for u in rows
            ],
        }

    @app.post("/api/admin/web-setplan")
    async def admin_web_setplan(
        body: WebSetPlanBody,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        plan_id = (body.plan or "basic").lower().strip()
        if plan_id not in PLANS:
            raise HTTPException(400, "Gói không hợp lệ")
        try:
            async with db.session() as session:
                user = await set_web_user_plan(
                    session,
                    email=body.email or None,
                    user_id=body.user_id,
                    plan_id=plan_id,
                    days=body.days,
                )
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
        return {"ok": True, "user": user_public(user)}

    @app.post("/api/admin/deluser")
    async def admin_deluser(
        body: DelUserBody,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        async with db.session() as session:
            ok = await deactivate_user(session, body.telegram_id)
        return {"ok": ok, "telegram_id": body.telegram_id}

    async def _hydrate_session(sid: str) -> list[dict[str, str]]:
        """Load history: RAM first, else SQLite (survives server restart)."""
        mem: SessionMemory = app.state.memory
        if not mem.get(sid):
            try:
                async with db.session() as session:
                    rows = await load_recent_messages(
                        session, _session_uid(sid), limit=settings.max_history_messages
                    )
                for m in rows:
                    mem.add(sid, m["role"], m["content"])
            except Exception:
                logger.exception("hydrate session failed sid=%s", sid[:12])
        return mem.get(sid)

    async def _persist(sid: str, role: str, content: str) -> None:
        try:
            async with db.session() as session:
                await save_message(session, _session_uid(sid), role, content)
        except Exception:
            logger.exception("persist message failed")

    @app.post("/api/chat")
    async def chat(
        body: ChatBody,
        request: Request,
        authorization: str | None = Header(default=None),
        x_web_token: str | None = Header(default=None, alias="X-Web-Token"),
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ):
        guser = _check_user_token(authorization, x_web_token, x_user_session)
        text = body.message.strip()
        if not text:
            raise HTTPException(400, "Tin nhắn trống")

        # Plan / daily quota for logged-in web users
        web_user_id: int | None = None
        if guser and guser.get("id"):
            db_user = await _load_web_user(guser)
            if db_user is not None:
                ok_q, qmsg, used, limit = check_web_quota(db_user)
                if not ok_q:
                    raise HTTPException(
                        status_code=429,
                        detail={
                            "message": qmsg,
                            "used": used,
                            "limit": limit,
                            "upgrade_url": "pricing.html",
                            "plan_id": db_user.plan_id,
                        },
                    )
                web_user_id = int(db_user.id)

        # Prefer stable session per Google account when logged in
        sid = (body.session_id or "").strip()
        if not sid and guser:
            sid = "g_" + hashlib.sha256(
                str(guser.get("google_sub", "")).encode()
            ).hexdigest()[:16]
        if not sid:
            sid = secrets.token_hex(8)

        mem: SessionMemory = request.app.state.memory
        client: GrokClient = request.app.state.grok

        await _hydrate_session(sid)
        mem.add(sid, "user", text)
        await _persist(sid, "user", text)
        history = mem.get(sid)

        async def _after_success() -> None:
            if web_user_id is None:
                return
            try:
                async with db.session() as session:
                    await bump_web_usage(session, web_user_id)
            except Exception:
                logger.exception("bump web usage failed")

        if body.stream:

            async def event_gen():
                yield _sse({"type": "meta", "session_id": sid})
                parts: list[str] = []
                try:
                    async for delta in client.chat_stream(
                        history, system=WEB_SYSTEM, temperature=0.25
                    ):
                        parts.append(delta)
                        yield _sse({"type": "delta", "text": delta})
                    full = "".join(parts).strip()
                    if full:
                        mem.add(sid, "assistant", full)
                        await _persist(sid, "assistant", full)
                        await _after_success()
                    yield _sse({"type": "done", "session_id": sid})
                except GrokError as exc:
                    logger.exception("web chat stream error")
                    yield _sse({"type": "error", "message": str(exc)})

            return StreamingResponse(
                event_gen(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )

        try:
            reply = await client.chat(
                history, system=WEB_SYSTEM, temperature=0.25
            )
        except GrokError as exc:
            raise HTTPException(502, str(exc)) from exc
        mem.add(sid, "assistant", reply)
        await _persist(sid, "assistant", reply)
        await _after_success()
        return {"session_id": sid, "reply": reply}

    @app.get("/api/chat/history")
    async def chat_history(
        session_id: str = "",
        authorization: str | None = Header(default=None),
        x_web_token: str | None = Header(default=None, alias="X-Web-Token"),
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        """Load persisted messages for a browser session (after tab close / restart)."""
        _check_user_token(authorization, x_web_token, x_user_session)
        sid = (session_id or "").strip()
        if not sid:
            return {"ok": True, "session_id": "", "messages": []}
        msgs = await _hydrate_session(sid)
        return {"ok": True, "session_id": sid, "messages": msgs}

    @app.post("/api/clear")
    async def clear(
        request: Request,
        body: dict[str, str] | None = None,
        authorization: str | None = Header(default=None),
        x_web_token: str | None = Header(default=None, alias="X-Web-Token"),
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        _check_user_token(authorization, x_web_token, x_user_session)
        sid = (body or {}).get("session_id", "").strip()
        if sid:
            request.app.state.memory.clear(sid)
            try:
                from database.repos import clear_messages

                async with db.session() as session:
                    await clear_messages(session, _session_uid(sid))
            except Exception:
                logger.exception("clear db history failed")
        return {"ok": True}

    return app


def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


app = create_app()


def main() -> None:
    import os

    import uvicorn

    host = os.getenv("WEB_HOST", "0.0.0.0")
    port = int(os.getenv("WEB_PORT", "7860"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    print(f"🌐 TungDevAI Web → http://127.0.0.1:{port}")
    uvicorn.run(
        "webapp.server:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
