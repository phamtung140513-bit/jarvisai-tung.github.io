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
from datetime import datetime, timezone, timedelta

import asyncio
import hashlib
import json
import logging
import os
import secrets
import sys
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Deque

from fastapi import FastAPI, Header, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai.coder import CoderAgent  # noqa: E402
from ai.doc_parser import parse_uploaded_document  # noqa: E402
from ai.web_search import extract_urls, fetch_url_content, execute_web_search  # noqa: E402
from ai.debugger import DebuggerAgent  # noqa: E402
from ai.grok import GrokClient, GrokError  # noqa: E402
from ai.modes import MODES, get_mode, merge_prompt_layers  # noqa: E402
from ai.pipeline import AgentPipeline  # noqa: E402
from ai.planner import PlannerAgent  # noqa: E402
from ai.prompts import SYSTEM_PROMPT  # noqa: E402
from ai.reviewer import ReviewerAgent  # noqa: E402
from config import get_settings  # noqa: E402
from database.sqlite import Database, get_db, set_db  # noqa: E402
from product.access_codes import create_access_code  # noqa: E402
from product.plans import PLANS, get_plan
from product.cmd_keys import activate_cmd_key  # noqa: E402
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
from product.vietqr_client import (  # noqa: E402
    create_pay_order,
    get_order_status,
    vietqr_pay_enabled,
)
from database.models import GoogleWebUser, WebSession, DiscountCoupon, CmdLicenseKey  # noqa: E402
from sqlalchemy import select, delete  # noqa: E402


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
    model_config = {"extra": "allow"}
    message: str = Field(..., min_length=1)
    session_id: str = Field(default="")
    stream: bool = True
    mode: str = Field(default="default")
    model: str | None = Field(default=None)
    history: list[dict[str, Any]] | None = Field(default=None)



WEB_HELP = """\
## 🎛 TUNGAI.FUN Web — lệnh nhanh

| Lệnh | Mô tả |
|------|--------|
| `/help` | Trợ giúp này |
| `/mode <id>` | Đổi chế độ: `default` · `coder` · `security` · `research` · `sales` |
| `/plan <task>` | Agent Planner — lập kế hoạch |
| `/code <spec>` | Agent Coder — sinh code |
| `/review <code>` | Agent Reviewer |
| `/debug <error>` | Agent Debugger |
| `/build <task>` | Pipeline plan → code → review |
| `/activate MÃ` | Kích hoạt gói (xử lý client) |

**Tip:** chọn mode **Coder** trên thanh công cụ để code production-ready mặc định.
"""


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


class WebBuyBody(BaseModel):
    model_config = {"extra": "allow"}
    plan: str = Field(default="basic")
    coupon_code: str | None = None


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

    # Browser rejects allow_credentials=True together with Allow-Origin: *
    # (common cause of "Failed to fetch" from github.io → API).
    _cors_star = cors_origins == ["*"] or (len(cors_origins) == 1 and cors_origins[0] == "*")
    # Always allow GitHub Pages + common local dev even if env is narrow
    _extra = [
        "https://jarvisai-tung.github.io",
        "https://phamtung140513-bit.github.io",
        "http://127.0.0.1:7860",
        "http://localhost:7860",
    ]
    if _cors_star:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        merged = list(dict.fromkeys([*cors_origins, *_extra]))
        app.add_middleware(
            CORSMiddleware,
            allow_origins=merged,
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

    async def _check_user_token(
        authorization: str | None,
        x_token: str | None,
        x_user_session: str | None = None,
    ) -> dict[str, Any] | None:
        """Validate optional WEB_ACCESS_TOKEN and/or persistent user session."""
        bearer = _bearer(authorization)
        sess_token = (x_user_session or "").strip()
        if not sess_token and bearer and bearer != access_token:
            sess_token = bearer

        guser = await _get_session(sess_token)
        
        # If legacy access token required
        if access_token:
            got = (x_token or bearer or "").strip()
            if got != access_token and not guser:
                raise HTTPException(status_code=401, detail="Sai user access token")

        if auth_required:
            if not guser:
                raise HTTPException(
                    status_code=401,
                    detail="Cần đăng nhập (email hoặc Google)",
                )
            return guser
        return guser

    async def _issue_session(user: Any) -> dict[str, Any]:
        sess = secrets.token_urlsafe(32)
        pub = user_public(user)
        uid = getattr(user, "id", None) or pub.get("id")
        email = getattr(user, "email", None) or pub.get("email")
        payload = {
            "id": uid,
            "google_sub": getattr(user, "google_sub", None) or pub.get("google_sub"),
            "email": email,
            "name": getattr(user, "name", None) or pub.get("name"),
            "picture": getattr(user, "picture", None) or pub.get("picture"),
            "plan_id": pub.get("plan_id"),
            "plan_name": pub.get("plan_name"),
            "daily_limit": pub.get("daily_limit"),
            "used_today": pub.get("used_today"),
            "remaining_today": pub.get("remaining_today"),
            "plan_expires_at": pub.get("plan_expires_at"),
            "plan_expired": pub.get("plan_expired"),
        }
        user_sessions[sess] = payload
        if uid and email:
            try:
                await _save_session(sess, int(uid), str(email), days=90)
            except Exception as e:
                logger.warning("Failed to save session to DB: %s", e)
        return {
            "ok": True,
            "session_token": sess,
            "user": pub,
        }



    async def _save_session(tok: str, uid: int, email: str, days: int = 90) -> None:
        """Persist session token to SQLite DB for 90 days surviving server restarts."""
        if not tok or not uid:
            return
        now = datetime.now(timezone.utc)
        exp = now + timedelta(days=days)
        database = get_db()
        async with database.session() as session:
            res = await session.execute(select(WebSession).where(WebSession.token == tok))
            ws = res.scalar_one_or_none()
            if not ws:
                ws = WebSession(
                    token=tok,
                    user_id=int(uid),
                    email=(email or "").lower().strip(),
                    expires_at=exp,
                )
                session.add(ws)
            else:
                ws.expires_at = exp
            await session.commit()

    async def _delete_session(tok: str | None) -> None:
        """Delete session from memory and DB upon logout."""
        if not tok:
            return
        user_sessions.pop(tok, None)
        database = get_db()
        async with database.session() as session:
            await session.execute(delete(WebSession).where(WebSession.token == tok))
            await session.commit()

    async def _get_session(tok: str | None) -> dict[str, Any] | None:
        """Fetch session: checks memory cache first, falls back to SQLite DB."""
        if not tok or not tok.strip():
            return None
        token = tok.strip()
        
        # 1. Memory cache check
        if token in user_sessions:
            return user_sessions[token]

        # 2. SQLite DB lookup
        try:
            database = get_db()
            async with database.session() as session:
                res = await session.execute(select(WebSession).where(WebSession.token == token))
                ws = res.scalar_one_or_none()
                if not ws:
                    return None

                # Check expiration
                now = datetime.now(timezone.utc)
                ws_exp = ws.expires_at
                if ws_exp and ws_exp.tzinfo is None:
                    ws_exp = ws_exp.replace(tzinfo=timezone.utc)
                if ws_exp and ws_exp < now:
                    return None

                # Load full user by ID or Email
                res_u = await session.execute(
                    select(GoogleWebUser).where(
                        (GoogleWebUser.id == ws.user_id) | (GoogleWebUser.email == (ws.email or "").lower().strip())
                    )
                )
                db_user = res_u.scalar_one_or_none()
                if not db_user or not db_user.active:
                    return None

                db_user = await ensure_plan_defaults(session, db_user)
                pub = user_public(db_user)
                user_sessions[token] = pub
                return pub
        except Exception as exc:
            logger.warning("_get_session DB lookup failed: %s", exc)
            return None

    async def _load_web_user(guser: dict[str, Any] | None) -> GoogleWebUser | None:
        """Load DB row by id, else email, else google_sub (so plan always fresh)."""
        if not guser:
            return None
        async with db.session() as session:
            user = None
            uid = guser.get("id")
            if uid is not None and str(uid).strip() != "":
                try:
                    res = await session.execute(
                        select(GoogleWebUser).where(GoogleWebUser.id == int(uid))
                    )
                    user = res.scalar_one_or_none()
                except (TypeError, ValueError):
                    user = None
            if user is None:
                email = (guser.get("email") or "").strip().lower()
                if email:
                    res = await session.execute(
                        select(GoogleWebUser).where(GoogleWebUser.email == email)
                    )
                    user = res.scalar_one_or_none()
            if user is None:
                sub = (guser.get("google_sub") or "").strip()
                if sub:
                    res = await session.execute(
                        select(GoogleWebUser).where(GoogleWebUser.google_sub == sub)
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

    def _file_nocache(path: Path, media_type: str | None = None) -> FileResponse:
        """Serve docs/* without browser cache (avoid stale plan UI)."""
        headers = {
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        }
        if media_type:
            return FileResponse(path, media_type=media_type, headers=headers)
        return FileResponse(path, headers=headers)

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
            return _file_nocache(p)
        # legacy fallback
        for candidate in (STATIC_DIR / "index.html",):
            if candidate.is_file():
                return _file_nocache(candidate)
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
        p = _docs_file("chat.html")
        return _file_nocache(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/pricing.html", response_model=None)
    async def pricing_page():
        p = _docs_file("pricing.html")
        return _file_nocache(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/pricing.css", response_model=None)
    async def pricing_css():
        p = _docs_file("pricing.css")
        return _file_nocache(p, "text/css") if p else HTMLResponse("x", status_code=404)


    @app.get("/install-cmd.ps1", response_model=None)
    async def install_cmd_ps1():
        """Serve 1-click PowerShell installer."""
        p = _docs_file("install-cmd.ps1")
        if p and p.is_file():
            return FileResponse(p, media_type="text/plain; charset=utf-8")
        return HTMLResponse("Not found", status_code=404)

    @app.get("/downloads/{filename}", response_model=None)
    async def download_file(filename: str):
        """Serve downloadable files (e.g. TUNGAI.FUN-CMD.zip)."""
        if not filename or ".." in filename or "/" in filename:
            raise HTTPException(400, "Bad filename")
        p = (DOCS_DIR / "downloads" / filename).resolve()
        try:
            if p.is_file() and p.relative_to(DOCS_DIR.resolve()):
                return FileResponse(p, filename=filename)
        except ValueError:
            pass
        return HTMLResponse("Not found", status_code=404)

    @app.get("/pricing-billing.js", response_model=None)
    async def pricing_billing_js():
        p = _docs_file("pricing-billing.js")
        return (
            _file_nocache(p, "application/javascript")
            if p
            else HTMLResponse("x", status_code=404)
        )

    @app.get("/HUONG_DAN_VIETQR_STK.html", response_model=None)
    @app.get("/huong-dan-vietqr-stk.html", response_model=None)
    @app.get("/huong-dan-stk.html", response_model=None)
    async def huong_dan_vietqr_stk():
        p = _docs_file("HUONG_DAN_VIETQR_STK.html")
        return _file_nocache(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/login.html", response_model=None)
    async def login_page():
        p = _docs_file("login.html")
        return _file_nocache(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/register.html", response_model=None)
    async def register_page():
        p = _docs_file("register.html")
        return _file_nocache(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/google-callback.html", response_model=None)
    async def google_callback_page():
        p = _docs_file("google-callback.html")
        return _file_nocache(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/workspace_engine.js", response_model=None)
    async def workspace_engine_js():
        p = _docs_file("workspace_engine.js")
        return (
            _file_nocache(p, "application/javascript")
            if p
            else HTMLResponse("x", status_code=404)
        )

    @app.get("/{js_name}.js", response_model=None)
    async def docs_js_file(js_name: str):
        if not js_name or "/" in js_name or ".." in js_name:
            return HTMLResponse("Not found", status_code=404)
        p = _docs_file(f"{js_name}.js")
        return (
            _file_nocache(p, "application/javascript")
            if p
            else HTMLResponse("Not found", status_code=404)
        )

    @app.get("/auth.js", response_model=None)
    async def auth_js():
        p = _docs_file("auth.js")
        return (
            _file_nocache(p, "application/javascript")
            if p
            else HTMLResponse("x", status_code=404)
        )

    @app.get("/boot-redirect.js", response_model=None)
    async def boot_redirect_js():
        p = _docs_file("boot-redirect.js")
        return (
            _file_nocache(p, "application/javascript")
            if p
            else HTMLResponse("x", status_code=404)
        )

    @app.get("/config.json")
    async def config_json() -> dict[str, Any]:
        # Same-domain: empty apiBase => frontend uses location.origin
        # google_client_id public — de hien nut Google ngay, khong doi /api/config
        return {
            "apiBase": "",
            "telegramBot": "https://t.me/grokapiai_bot",
            "appName": settings.app_name,
            "sameOrigin": True,
            "google_client_id": google_client_id or "",
        }

    @app.get("/chat.js", response_model=None)
    async def chat_js():
        p = _docs_file("chat.js")
        return (
            _file_nocache(p, "application/javascript")
            if p
            else HTMLResponse("x", status_code=404)
        )

    @app.get("/chat.css", response_model=None)
    async def chat_css():
        p = _docs_file("chat.css")
        return _file_nocache(p, "text/css") if p else HTMLResponse("x", status_code=404)

    @app.get("/styles.css", response_model=None)
    async def styles_css():
        p = _docs_file("styles.css")
        return _file_nocache(p, "text/css") if p else HTMLResponse("x", status_code=404)

    # Secret admin page — not linked from user chat UI
    @app.get("/j-panel.html", response_model=None)
    async def admin_panel_page():
        p = _docs_file("j-panel.html")
        return _file_nocache(p) if p else HTMLResponse("Not found", status_code=404)

    @app.get("/admin.js", response_model=None)
    async def admin_js():
        p = _docs_file("admin.js")
        return (
            _file_nocache(p, "application/javascript")
            if p
            else HTMLResponse("x", status_code=404)
        )

    # Catch-all HTML guides — MUST be after all specific .html routes
    @app.get("/{page_name}.html", response_model=None)
    async def docs_html_page(page_name: str):
        if not page_name or "/" in page_name or ".." in page_name:
            return HTMLResponse("Not found", status_code=404)
        for candidate in (
            f"{page_name}.html",
            f"{page_name.upper()}.html",
        ):
            p = _docs_file(candidate)
            if p:
                return _file_nocache(p)
        return HTMLResponse("Not found", status_code=404)


    @app.post("/api/upload-doc")
    async def api_upload_doc(
        file: UploadFile = File(...),
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        """Upload and parse text from PDF, DOCX, TXT, CSV, JSON, and source code files."""
        try:
            content_bytes = await file.read()
            if len(content_bytes) > 25 * 1024 * 1024:
                raise HTTPException(400, "Tệp vượt quá giới hạn 25MB.")
            extracted_text, meta_info = parse_uploaded_document(file.filename or "unknown", content_bytes)
            return {
                "ok": True,
                "filename": file.filename,
                "meta": meta_info,
                "chars": len(extracted_text),
                "content": extracted_text,
            }
        except Exception as exc:
            logger.exception("Upload doc parse error")
            raise HTTPException(400, f"Lỗi đọc tệp tài liệu: {exc}") from exc

    @app.post("/api/run-code")
    async def api_run_code(request: Request) -> dict[str, Any]:
        """Execute sandboxed C++, Python, or JavaScript code asynchronously."""
        import tempfile, asyncio, shutil

        import html as _html_mod
        data = await request.json()
        lang = str(data.get("lang") or "cpp").lower().strip()
        code = _html_mod.unescape(str(data.get("code") or ""))
        stdin_data = _html_mod.unescape(str(data.get("stdin") or ""))

        if not code.strip():
            return {"ok": True, "stdout": "", "stderr": "", "execution_time_ms": 0, "lang": lang.upper()}

        t0 = time.perf_counter()
        tmp_dir = tempfile.mkdtemp(prefix="tung_exec_")

        try:
            if lang in ("cpp", "c++", "c", "cc", "hpp"):
                src_file = os.path.join(tmp_dir, "main.cpp")
                exe_file = os.path.join(tmp_dir, "main.exe" if os.name == "nt" else "main.out")
                with open(src_file, "w", encoding="utf-8") as f:
                    f.write(code)

                # Compile with G++ -O3
                comp_proc = await asyncio.create_subprocess_exec(
                    "g++", "-O3", "-std=c++20", src_file, "-o", exe_file,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                try:
                    c_out, c_err = await asyncio.wait_for(comp_proc.communicate(), timeout=30.0)
                except asyncio.TimeoutError:
                    return {
                        "ok": False,
                        "lang": "C++ (G++ 11.4)",
                        "stderr": "Biên dịch C++ quá thời gian 30 giây.",
                        "stdout": "",
                        "exit_code": -1,
                        "execution_time_ms": int((time.perf_counter() - t0) * 1000)
                    }

                if comp_proc.returncode != 0:
                    return {
                        "ok": False,
                        "lang": "C++ (G++ 11.4)",
                        "stderr": c_err.decode("utf-8", errors="replace"),
                        "stdout": "",
                        "exit_code": comp_proc.returncode,
                        "execution_time_ms": int((time.perf_counter() - t0) * 1000)
                    }

                # Execute binary
                run_proc = await asyncio.create_subprocess_exec(
                    exe_file,
                    stdin=asyncio.subprocess.PIPE if stdin_data else None,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                try:
                    r_out, r_err = await asyncio.wait_for(
                        run_proc.communicate(input=stdin_data.encode("utf-8") if stdin_data else None),
                        timeout=300.0
                    )
                    t_dur = int((time.perf_counter() - t0) * 1000)
                    return {
                        "ok": run_proc.returncode == 0,
                        "lang": "C++ (G++ 11.4)",
                        "stdout": r_out.decode("utf-8", errors="replace"),
                        "stderr": r_err.decode("utf-8", errors="replace"),
                        "exit_code": run_proc.returncode,
                        "execution_time_ms": t_dur
                    }
                except asyncio.TimeoutError:
                    return {
                        "ok": False,
                        "lang": "C++ (G++ 11.4)",
                        "stderr": "Chương trình C++ chạy quá giới hạn thời gian (5 phút / 300 giây).",
                        "stdout": "",
                        "exit_code": -1,
                        "execution_time_ms": int((time.perf_counter() - t0) * 1000)
                    }

            elif lang in ("python", "py", "python3"):
                src_file = os.path.join(tmp_dir, "main.py")
                with open(src_file, "w", encoding="utf-8") as f:
                    f.write(code)

                py_bin = sys.executable or "python3"
                run_proc = await asyncio.create_subprocess_exec(
                    py_bin, "-u", src_file,
                    stdin=asyncio.subprocess.PIPE if stdin_data else None,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                try:
                    r_out, r_err = await asyncio.wait_for(
                        run_proc.communicate(input=stdin_data.encode("utf-8") if stdin_data else None),
                        timeout=300.0
                    )
                    t_dur = int((time.perf_counter() - t0) * 1000)
                    return {
                        "ok": run_proc.returncode == 0,
                        "lang": "Python 3",
                        "stdout": r_out.decode("utf-8", errors="replace"),
                        "stderr": r_err.decode("utf-8", errors="replace"),
                        "exit_code": run_proc.returncode,
                        "execution_time_ms": t_dur
                    }
                except asyncio.TimeoutError:
                    return {
                        "ok": False,
                        "lang": "Python 3",
                        "stderr": "Chương trình Python chạy quá giới hạn thời gian (5 phút / 300 giây).",
                        "stdout": "",
                        "exit_code": -1,
                        "execution_time_ms": int((time.perf_counter() - t0) * 1000)
                    }

            elif lang in ("js", "javascript", "node"):
                src_file = os.path.join(tmp_dir, "main.js")
                with open(src_file, "w", encoding="utf-8") as f:
                    f.write(code)

                run_proc = await asyncio.create_subprocess_exec(
                    "node", src_file,
                    stdin=asyncio.subprocess.PIPE if stdin_data else None,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                try:
                    r_out, r_err = await asyncio.wait_for(
                        run_proc.communicate(input=stdin_data.encode("utf-8") if stdin_data else None),
                        timeout=300.0
                    )
                    t_dur = int((time.perf_counter() - t0) * 1000)
                    return {
                        "ok": run_proc.returncode == 0,
                        "lang": "Node.js v20",
                        "stdout": r_out.decode("utf-8", errors="replace"),
                        "stderr": r_err.decode("utf-8", errors="replace"),
                        "exit_code": run_proc.returncode,
                        "execution_time_ms": t_dur
                    }
                except asyncio.TimeoutError:
                    return {
                        "ok": False,
                        "lang": "Node.js v20",
                        "stderr": "Chương trình JavaScript chạy quá 6 giây.",
                        "stdout": "",
                        "exit_code": -1,
                        "execution_time_ms": int((time.perf_counter() - t0) * 1000)
                    }

            else:
                raise HTTPException(400, f"Ngôn ngữ {lang} chưa được hỗ trợ thực thi.")

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

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
        modes = [
            {
                "id": m.id,
                "name": m.name,
                "description": m.description,
            }
            for m in MODES.values()
        ]
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
            "modes": modes,
            "slash_commands": [
                "help",
                "mode",
                "plan",
                "code",
                "review",
                "debug",
                "build",
                "activate",
            ],
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

        if not sent:
            # Production: khong tra ma ra trinh duyet (tranh tu dien form)
            detail = (
                "Không gửi được email. "
                "Kiểm tra SMTP_HOST/SMTP_USER/SMTP_PASSWORD (Gmail App Password) trên server, "
                "rồi systemctl restart tungdevai-web."
            )
            if err_msg:
                detail = f"SMTP lỗi: {err_msg}"
            if auth_dev_show_code:
                # Chi log server — van co the hien ma neu bat AUTH_DEV_SHOW_CODE=true
                logger.warning("DEV OTP %s (%s): %s", email, purpose, code)
                return {
                    "ok": True,
                    "email": email,
                    "purpose": purpose,
                    "sent": False,
                    "message": (
                        f"SMTP chưa gửi mail. Mã dev (chi khi AUTH_DEV_SHOW_CODE): {code}"
                    ),
                    "dev_code": code,
                    "expires_in": 600,
                    "smtp_error": err_msg or "SMTP not configured",
                }
            raise HTTPException(503, detail)

        return {
            "ok": True,
            "email": email,
            "purpose": purpose,
            "sent": True,
            "message": f"Đã gửi mã xác thực tới {email}. Kiểm tra hộp thư và Spam.",
            "expires_in": 600,
        }

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
        return await _issue_session(user)

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
        return await _issue_session(user)

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

        return await _issue_session(user)

    @app.get("/api/auth/me")
    async def auth_me(
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        sess_token = (x_user_session or "").strip()
        if not sess_token and authorization and authorization.lower().startswith("bearer "):
            sess_token = authorization[7:].strip()
        guser = await _get_session(sess_token)
        if not guser:
            raise HTTPException(401, "Chưa đăng nhập")
        db_user = await _load_web_user(guser)
        if db_user is not None:
            pub = user_public(db_user)
            guser.update(pub)
            user_sessions[x_user_session] = guser
            return {"ok": True, "user": pub}
        return {"ok": True, "user": guser}

    @app.post("/api/billing/validate-coupon")
    async def billing_validate_coupon(
        request: Request,
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        """Validate coupon code and return discount details."""
        b = {}
        try:
            b = await request.json()
        except Exception:
            pass
        code = str(b.get("code", "")).strip().upper()
        plan_id = str(b.get("plan", "basic")).strip().lower()
        if not code:
            raise HTTPException(400, "Vui lòng nhập mã giảm giá")

        plan = get_plan(plan_id)
        if not plan:
            raise HTTPException(400, f"Gói {plan_id} không hợp lệ")

        base_price = int(plan.price_vnd or 0)
        now = datetime.now(timezone.utc)

        async with db.session() as session:
            res = await session.execute(
                select(DiscountCoupon).where(DiscountCoupon.code == code)
            )
            cp = res.scalar_one_or_none()
            if not cp:
                raise HTTPException(404, f"Mã giảm giá '{code}' không tồn tại")
            if not cp.active:
                raise HTTPException(400, f"Mã giảm giá '{code}' đã bị tạm dừng")
            if cp.expires_at and (cp.expires_at.replace(tzinfo=timezone.utc) if cp.expires_at.tzinfo is None else cp.expires_at) < datetime.now(timezone.utc):
                raise HTTPException(400, f"Mã giảm giá '{code}' đã hết hạn")
            if cp.max_uses > 0 and cp.uses >= cp.max_uses:
                raise HTTPException(400, f"Mã giảm giá '{code}' đã hết lượt sử dụng ({cp.uses}/{cp.max_uses})")
            if cp.plan_id != "all" and cp.plan_id.lower() != plan_id:
                raise HTTPException(400, f"Mã '{code}' chỉ áp dụng cho gói {cp.plan_id.upper()}")

            discount_vnd = 0
            if cp.discount_percent >= 100 or cp.discount_amount >= base_price:
                discount_vnd = base_price
                final_price = 0
            elif cp.discount_percent > 0:
                discount_vnd = int(base_price * cp.discount_percent / 100)
                final_price = max(0, base_price - discount_vnd)
            elif cp.discount_amount > 0:
                discount_vnd = int(cp.discount_amount)
                final_price = max(0, base_price - discount_vnd)

            return {
                "ok": True,
                "code": cp.code,
                "discount_percent": cp.discount_percent,
                "discount_amount": discount_vnd,
                "final_price": final_price,
                "base_price": base_price,
            }

    @app.post("/api/billing/create-order")
    async def billing_create_order(
        body: WebBuyBody,
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        """Logged-in web user creates VietQR order (autobank → auto activate)."""
        if not x_user_session or x_user_session not in user_sessions:
            raise HTTPException(401, "Cần đăng nhập trước khi mua gói")
        if not vietqr_pay_enabled(settings):
            raise HTTPException(
                503,
                "Chưa bật autobank. Set VIETQR_PAY_URL + chạy vietqr-pay (port 3000).",
            )
        guser = user_sessions[x_user_session]
        db_user = await _load_web_user(guser)
        if db_user is None:
            raise HTTPException(401, "Phiên đăng nhập không hợp lệ")

        plan_id = (body.plan or "basic").lower().strip()
        if plan_id not in PLANS or plan_id in ("owner", "trial"):
            raise HTTPException(400, "Gói không hợp lệ (basic/pro/business)")
        plan = get_plan(plan_id)
        amount = int(plan.price_vnd or 0)
        if amount <= 0:
            raise HTTPException(400, "Gói này không bán (giá 0)")

        # Apply coupon if provided
        coupon_code = str(getattr(body, "coupon_code", "") or "").strip().upper()
        if coupon_code:
            now = datetime.now(timezone.utc)
            async with db.session() as session:
                res = await session.execute(
                    select(DiscountCoupon).where(DiscountCoupon.code == coupon_code)
                )
                cp = res.scalar_one_or_none()
                if (
                    cp
                    and cp.active
                    and (
                        not cp.expires_at
                        or (
                            cp.expires_at.replace(tzinfo=timezone.utc)
                            if cp.expires_at.tzinfo is None
                            else cp.expires_at
                        )
                        >= now
                    )
                    and (cp.max_uses <= 0 or cp.uses < cp.max_uses)
                    and (cp.plan_id == "all" or cp.plan_id.lower() == plan_id)
                ):
                    discount_vnd = 0
                    if cp.discount_percent >= 100 or cp.discount_amount >= amount:
                        discount_vnd = amount
                        amount = 0
                    elif cp.discount_percent > 0:
                        discount_vnd = int(amount * cp.discount_percent / 100)
                        amount = max(0, amount - discount_vnd)
                    elif cp.discount_amount > 0:
                        discount_vnd = int(cp.discount_amount)
                        amount = max(0, amount - discount_vnd)

                    cp.uses += 1
                    await session.commit()

        # If 0d (100% Free Coupon), activate immediately without VietQR bank transfer!
        if amount <= 0:
            async with db.session() as session:
                updated_user = await set_web_user_plan(
                    session,
                    user_id=int(db_user.id),
                    plan_id=plan.id,
                    days=30,
                )
                pub = user_public(updated_user)
                guser.update(pub)
                user_sessions[x_user_session] = guser
                return {
                    "ok": True,
                    "free": True,
                    "status": "paid",
                    "amount": 0,
                    "plan": plan.id,
                    "plan_name": plan.name,
                    "user": pub,
                    "message": f"🎉 Chúc mừng bạn! Gói {plan.name} đã được kích hoạt thành công miễn phí 100%!",
                }

        try:
            order = await create_pay_order(
                settings,
                amount=amount,
                plan=plan.id,
                web_user_id=int(db_user.id),
                web_email=(db_user.email or "").strip().lower() or None,
                note=f"web:{db_user.email}:{plan.id}",
            )
        except Exception as exc:
            logger.exception("create web pay order failed")
            raise HTTPException(502, f"Không tạo được QR: {exc}") from exc

        return {
            "ok": True,
            "orderId": order.order_id,
            "plan": plan.id,
            "plan_name": plan.name,
            "amount": order.amount,
            "content": order.content,
            "status": order.status,
            "qrImageUrl": order.qr_image_url,
            "payPage": order.pay_page,
            "bank": {
                "code": order.bank_code,
                "account": order.bank_account,
                "name": order.bank_name,
            },
            "hint": "Chuyển khoản đúng số tiền + nội dung. Hệ thống auto kích hoạt khi nhận CK.",
        }

    @app.get("/api/billing/order-status")
    async def billing_order_status(
        order_id: str = "",
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        if not x_user_session or x_user_session not in user_sessions:
            raise HTTPException(401, "Cần đăng nhập")
        oid = (order_id or "").strip()
        if not oid:
            raise HTTPException(400, "Thiếu order_id")
        if not vietqr_pay_enabled(settings):
            raise HTTPException(503, "VIETQR_PAY_URL chưa cấu hình")
        try:
            data = await get_order_status(settings, oid)
        except Exception as exc:
            raise HTTPException(502, str(exc)) from exc

        # When paid, refresh session plan from DB
        if str(data.get("status") or "").lower() == "paid":
            guser = user_sessions.get(x_user_session or "")
            db_user = await _load_web_user(guser)
            if db_user is not None:
                pub = user_public(db_user)
                if guser is not None:
                    guser.update(pub)
                    user_sessions[x_user_session] = guser  # type: ignore[index]
                data["user"] = pub
        return {"ok": True, **data}

    @app.get("/api/billing/config")
    async def billing_config() -> dict[str, Any]:
        return {
            "ok": True,
            "autobank": vietqr_pay_enabled(settings),
            "vietqr_pay_url": (settings.vietqr_pay_url or "").rstrip("/"),
            "currency": settings.currency,
            "plans": [
                {
                    "id": p.id,
                    "name": p.name,
                    "price_vnd": p.price_vnd,
                    "daily_messages": p.daily_messages,
                    "days": p.days,
                }
                for p in PLANS.values()
                if p.id not in ("owner", "trial")
            ],
        }


    # =========================================================================
    # DEDICATED CMD LICENSE KEY PRICING & VIETQR BILLING
    # =========================================================================

    CMD_PLANS = {
        "cmd_7d": {
            "id": "cmd_7d",
            "name": "CMD Trải Nghiệm (7 Ngày)",
            "days": 7,
            "price_vnd": 29000,
            "max_uses": 1,
            "badge": "⚡ Trải Nghiệm",
            "desc": "Thử nghiệm sức mạnh AI Terminal với đầy đủ 4 siêu mô hình lập trình.",
        },
        "cmd_30d": {
            "id": "cmd_30d",
            "name": "CMD Pro Standard (30 Ngày)",
            "days": 30,
            "price_vnd": 89000,
            "max_uses": 1,
            "badge": "🔥 Bán Chạy Nhất",
            "desc": "Gói tiêu chuẩn cho Developer chinh chiến dự án thực tế hàng ngày.",
        },
        "cmd_90d": {
            "id": "cmd_90d",
            "name": "CMD Quarter Master (90 Ngày)",
            "days": 90,
            "price_vnd": 199000,
            "max_uses": 2,
            "badge": "💎 Tiết Kiệm 40%",
            "desc": "3 tháng sử dụng liên tục, hỗ trợ 2 thiết bị và cập nhật sớm nhất.",
        },
        "cmd_365d": {
            "id": "cmd_365d",
            "name": "CMD Enterprise Lifetime (365 Ngày)",
            "days": 365,
            "price_vnd": 499000,
            "max_uses": 3,
            "badge": "👑 Siêu VIP 1 Năm",
            "desc": "Bản quyền tối thượng 1 năm, kích hoạt 3 thiết bị và hỗ trợ kỹ thuật 1-1.",
        },
    }

    _cmd_orders: dict[str, dict[str, Any]] = {}

    @app.get("/api/cmd/pricing")
    async def api_cmd_pricing() -> dict[str, Any]:
        """Return list of dedicated CMD key pricing plans."""
        return {
            "ok": True,
            "plans": list(CMD_PLANS.values()),
            "currency": settings.currency,
        }

    @app.post("/api/billing/create-cmd-order")
    async def billing_create_cmd_order(request: Request) -> dict[str, Any]:
        """Create VietQR order specifically for CMD License Key."""
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass

        plan_id = str(body.get("plan", "cmd_30d")).lower().strip()
        if plan_id not in CMD_PLANS:
            raise HTTPException(400, "Gói CMD không hợp lệ (cmd_7d, cmd_30d, cmd_90d, cmd_365d)")

        plan_info = CMD_PLANS[plan_id]
        amount = int(plan_info["price_vnd"])
        email = str(body.get("email", "")).strip().lower()
        coupon_code = str(body.get("coupon_code", "")).strip().upper()

        # Handle discount coupon if applicable
        if coupon_code:
            async with db.session() as session:
                res = await session.execute(
                    select(DiscountCoupon).where(DiscountCoupon.code == coupon_code)
                )
                cp = res.scalar_one_or_none()
                if cp and cp.active:
                    if cp.discount_percent > 0:
                        disc = int(amount * cp.discount_percent / 100)
                        amount = max(0, amount - disc)
                    elif cp.discount_amount > 0:
                        amount = max(0, amount - cp.discount_amount)

        # 0d Instant Free Activation
        if amount == 0:
            key_code = f"CMD-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"
            async with db.session() as session:
                k = CmdLicenseKey(
                    code=key_code,
                    days=plan_info["days"],
                    max_uses=plan_info["max_uses"],
                    note=f"Free/Coupon ({email or 'free'})",
                    active=True,
                )
                session.add(k)
                await session.commit()
            return {
                "ok": True,
                "free": True,
                "status": "paid",
                "plan": plan_id,
                "plan_name": plan_info["name"],
                "key_code": key_code,
                "days": plan_info["days"],
                "amount": 0,
                "message": "🎉 Chúc mừng bạn! Key bản quyền đã được kích hoạt miễn phí 100%!",
            }

        try:
            order = await create_pay_order(
                settings,
                amount=amount,
                plan=plan_id,
                note=f"cmd:{email or 'anon'}:{plan_id}",
            )
        except Exception as exc:
            logger.exception("create cmd pay order failed")
            raise HTTPException(502, f"Không tạo được mã QR: {exc}") from exc

        _cmd_orders[order.order_id] = {
            "plan_id": plan_id,
            "plan_info": plan_info,
            "days": plan_info["days"],
            "max_uses": plan_info["max_uses"],
            "email": email,
            "amount": amount,
            "key_code": None,
            "created_at": time.time(),
        }

        return {
            "ok": True,
            "orderId": order.order_id,
            "plan": plan_id,
            "plan_name": plan_info["name"],
            "days": plan_info["days"],
            "amount": order.amount,
            "content": order.content,
            "status": order.status,
            "qrImageUrl": order.qr_image_url,
            "payPage": order.pay_page,
            "bank": {
                "code": order.bank_code,
                "account": order.bank_account,
                "name": order.bank_name,
            },
            "hint": "Chuyển khoản đúng số tiền + nội dung. Hệ thống auto cấp Key bản quyền ngay khi nhận tiền.",
        }

    @app.get("/api/billing/cmd-order-status")
    async def billing_cmd_order_status(order_id: str = "") -> dict[str, Any]:
        """Poll VietQR status for CMD order and auto-generate license key upon payment."""
        oid = (order_id or "").strip()
        if not oid:
            raise HTTPException(400, "Thiếu order_id")

        cmd_info = _cmd_orders.get(oid)
        # If already generated key previously
        if cmd_info and cmd_info.get("key_code"):
            return {
                "ok": True,
                "status": "paid",
                "key_code": cmd_info["key_code"],
                "days": cmd_info["days"],
                "plan_name": cmd_info["plan_info"]["name"],
                "message": "Đã nhận thanh toán thành công! Key bản quyền của bạn đã sẵn sàng.",
            }

        try:
            data = await get_order_status(settings, oid)
        except Exception as exc:
            raise HTTPException(502, str(exc)) from exc

        st = str(data.get("status") or "").lower()
        if st == "paid":
            plan_days = 30
            max_uses = 1
            email = "customer"
            plan_name = "CMD Pro"
            if cmd_info:
                plan_days = cmd_info.get("days", 30)
                max_uses = cmd_info.get("max_uses", 1)
                email = cmd_info.get("email") or "customer"
                plan_name = cmd_info.get("plan_info", {}).get("name", "CMD Pro")

            key_code = f"CMD-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"
            async with db.session() as session:
                k = CmdLicenseKey(
                    code=key_code,
                    days=plan_days,
                    max_uses=max_uses,
                    note=f"VietQR Order {oid} ({email})",
                    active=True,
                )
                session.add(k)
                await session.commit()

            if cmd_info:
                cmd_info["key_code"] = key_code

            return {
                "ok": True,
                "status": "paid",
                "key_code": key_code,
                "days": plan_days,
                "plan_name": plan_name,
                "message": "Đã nhận thanh toán thành công! Key bản quyền của bạn đã sẵn sàng.",
            }

        return {"ok": True, "status": st or "pending", "orderId": oid}

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

    # =========================================================================
    # DISCOUNT COUPON MANAGEMENT ENDPOINTS
    # =========================================================================


    @app.get("/api/admin/coupons")
    async def admin_get_coupons(
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        async with db.session() as session:
            res = await session.execute(
                select(DiscountCoupon).order_by(DiscountCoupon.id.desc())
            )
            rows = res.scalars().all()
            return {
                "ok": True,
                "coupons": [
                    {
                        "id": c.id,
                        "code": c.code,
                        "discount_percent": c.discount_percent,
                        "discount_amount": c.discount_amount,
                        "plan_id": c.plan_id,
                        "max_uses": c.max_uses,
                        "uses": c.uses,
                        "note": c.note,
                        "active": c.active,
                        "expires_at": c.expires_at.isoformat() if c.expires_at else None,
                        "created_at": c.created_at.isoformat() if c.created_at else None,
                    }
                    for c in rows
                ],
            }

    @app.post("/api/admin/coupons")
    async def admin_create_coupon(
        request: Request,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        b = {}
        try:
            b = await request.json()
        except Exception:
            pass
        code_clean = str(b.get("code", "")).strip().upper()
        if not code_clean:
            raise HTTPException(400, "Mã code không được rỗng")
        days = int(b.get("days", 30))
        now = datetime.now(timezone.utc)
        exp = now + timedelta(days=days) if days > 0 else None
        async with db.session() as session:
            res = await session.execute(
                select(DiscountCoupon).where(DiscountCoupon.code == code_clean)
            )
            existing = res.scalar_one_or_none()
            if existing:
                raise HTTPException(400, f"Mã {code_clean} đã tồn tại")
            cp = DiscountCoupon(
                code=code_clean,
                discount_percent=int(b.get("discount_percent", 0)),
                discount_amount=int(b.get("discount_amount", 0)),
                plan_id=str(b.get("plan_id", "all")),
                max_uses=int(b.get("max_uses", 100)),
                note=str(b.get("note", "")),
                expires_at=exp,
                active=True,
            )
            session.add(cp)
            await session.commit()
            await session.refresh(cp)
            return {
                "ok": True,
                "coupon": {
                    "id": cp.id,
                    "code": cp.code,
                    "discount_percent": cp.discount_percent,
                    "discount_amount": cp.discount_amount,
                    "plan_id": cp.plan_id,
                    "max_uses": cp.max_uses,
                    "uses": cp.uses,
                    "note": cp.note,
                    "active": cp.active,
                    "expires_at": cp.expires_at.isoformat() if cp.expires_at else None,
                },
            }

    @app.post("/api/admin/coupons/toggle")
    async def admin_toggle_coupon(
        request: Request,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        b = {}
        try:
            b = await request.json()
        except Exception:
            pass
        code_clean = str(b.get("code", "")).strip().upper()
        active_val = bool(b.get("active", True))
        async with db.session() as session:
            res = await session.execute(
                select(DiscountCoupon).where(DiscountCoupon.code == code_clean)
            )
            cp = res.scalar_one_or_none()
            if not cp:
                raise HTTPException(404, f"Không tìm thấy mã {code_clean}")
            cp.active = active_val
            await session.commit()
            return {"ok": True, "code": cp.code, "active": cp.active}

    @app.post("/api/admin/coupons/delete")
    async def admin_delete_coupon(
        request: Request,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        b = {}
        try:
            b = await request.json()
        except Exception:
            pass
        code_clean = str(b.get("code", "")).strip().upper()
        async with db.session() as session:
            res = await session.execute(
                select(DiscountCoupon).where(DiscountCoupon.code == code_clean)
            )
            cp = res.scalar_one_or_none()
            if not cp:
                raise HTTPException(404, f"Không tìm thấy mã {code_clean}")
            await session.delete(cp)
            await session.commit()
            return {"ok": True, "deleted": code_clean}

    # =========================================================================
    # CMD LICENSE KEYS MANAGEMENT ENDPOINTS
    # =========================================================================


    @app.get("/api/admin/cmd-keys")
    async def admin_get_cmd_keys(
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        async with db.session() as session:
            res = await session.execute(
                select(CmdLicenseKey).order_by(CmdLicenseKey.id.desc()).limit(100)
            )
            rows = res.scalars().all()
            return {
                "ok": True,
                "keys": [
                    {
                        "id": k.id,
                        "code": k.code,
                        "days": k.days,
                        "max_uses": k.max_uses,
                        "uses": k.uses,
                        "note": k.note,
                        "last_machine": k.last_machine,
                        "last_activated_at": k.last_activated_at.isoformat() if k.last_activated_at else None,
                        "active": k.active,
                        "created_at": k.created_at.isoformat() if k.created_at else None,
                    }
                    for k in rows
                ],
            }

    @app.post("/api/admin/cmd-keys")
    async def admin_create_cmd_key(
        request: Request,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        days = int(body.get("days", 30))
        max_uses = int(body.get("max_uses", 1))
        note = str(body.get("note", "Admin Created"))
        code = f"CMD-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"
        async with db.session() as session:
            k = CmdLicenseKey(
                code=code,
                days=days,
                max_uses=max_uses,
                note=note,
                active=True,
            )
            session.add(k)
            await session.commit()
            await session.refresh(k)
            return {
                "ok": True,
                "key": {
                    "code": k.code,
                    "days": k.days,
                    "max_uses": k.max_uses,
                    "note": k.note,
                    "active": k.active,
                }
            }

    @app.post("/api/admin/cmd-keys/revoke")
    async def admin_revoke_cmd_key(
        request: Request,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        _check_admin(authorization, x_admin_token)
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        code_clean = str(body.get("code", "")).strip()
        async with db.session() as session:
            res = await session.execute(
                select(CmdLicenseKey).where(CmdLicenseKey.code == code_clean)
            )
            k = res.scalar_one_or_none()
            if not k:
                raise HTTPException(404, "Không tìm thấy key")
            k.active = False
            await session.commit()
            return {"ok": True, "code": k.code, "active": False}




    # =========================================================================
    # PUBLIC CMD LICENSE VERIFICATION & ACTIVATION
    # =========================================================================

    @app.post("/api/cmd/verify-license")
    async def api_cmd_verify_license(request: Request) -> dict[str, Any]:
        """Verify CMD license against database (checks deleted, revoked, expired)."""
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        code = str(body.get("code", "")).strip().upper()
        machine = str(body.get("machine", "")).strip()
        payment_url = "https://tungai.fun/cmd-pricing.html"
        
        if not code:
            return {
                "ok": False,
                "reason": "no_code",
                "message": "Chưa có mã bản quyền CMD.",
                "payment_url": payment_url,
            }

        async with db.session() as session:
            res = await session.execute(
                select(CmdLicenseKey).where(CmdLicenseKey.code == code)
            )
            row = res.scalar_one_or_none()
            if not row:
                return {
                    "ok": False,
                    "reason": "deleted",
                    "message": "Key bản quyền không tồn tại hoặc đã bị xóa trên hệ thống.",
                    "payment_url": payment_url,
                }
            if not row.active:
                return {
                    "ok": False,
                    "reason": "revoked",
                    "message": "Key bản quyền đã bị vô hiệu hóa hoặc thu hồi bởi Quản trị viên.",
                    "payment_url": payment_url,
                }
            
            # Check expiration
            now = datetime.now(timezone.utc)
            if row.last_activated_at:
                last_act = row.last_activated_at
                if last_act.tzinfo is None:
                    last_act = last_act.replace(tzinfo=timezone.utc)
                exp = last_act + timedelta(days=int(row.days or 30))
                if exp < now:
                    return {
                        "ok": False,
                        "reason": "expired",
                        "message": f"Key bản quyền đã hết hạn vào ngày {exp.strftime('%d/%m/%Y')}.",
                        "payment_url": payment_url,
                    }
                days_left = max(0, (exp - now).days)
            else:
                days_left = int(row.days or 30)

            return {
                "ok": True,
                "code": row.code,
                "days_left": days_left,
                "message": f"Key hợp lệ (còn {days_left} ngày)",
                "payment_url": payment_url,
            }

    @app.post("/api/cmd/activate")
    async def api_cmd_activate(request: Request) -> dict[str, Any]:
        """Activate a CMD key and return license details."""
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        code = str(body.get("code", "")).strip().upper()
        machine = str(body.get("machine", "")).strip()
        payment_url = "https://tungai.fun/cmd-pricing.html"
        if not code:
            return {
                "ok": False,
                "message": "Vui lòng nhập mã key.",
                "payment_url": payment_url,
            }

        async with db.session() as session:
            ok, msg, payload = await activate_cmd_key(session, code, machine=machine)
            return {
                "ok": ok,
                "message": msg,
                "license": payload,
                "payment_url": payment_url,
            }

    @app.post("/api/admin/cmd-keys/delete")
    async def admin_delete_cmd_key(
        request: Request,
        authorization: str | None = Header(default=None),
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> dict[str, Any]:
        """Delete a CMD key permanently from database."""
        _check_admin(authorization, x_admin_token)
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        code_clean = str(body.get("code", "")).strip().upper()
        async with db.session() as session:
            res = await session.execute(
                select(CmdLicenseKey).where(CmdLicenseKey.code == code_clean)
            )
            k = res.scalar_one_or_none()
            if not k:
                raise HTTPException(404, "Không tìm thấy key")
            await session.delete(k)
            await session.commit()
            return {"ok": True, "code": code_clean, "deleted": True}

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

    def _parse_slash(text: str) -> tuple[str | None, str]:
        """Return (command, args). command is lowercased without leading /."""
        raw = (text or "").strip()
        if not raw.startswith("/"):
            return None, raw
        # First token only; rest is args
        parts = raw.split(None, 1)
        cmd = parts[0][1:].lower().split("@", 1)[0]
        args = parts[1].strip() if len(parts) > 1 else ""
        return cmd, args

    def _resolve_mode(mode_id: str | None) -> Any:
        return get_mode((mode_id or "default").strip().lower())

    def _system_for_mode(mode_id: str | None) -> str | None:
        mode = _resolve_mode(mode_id)
        return merge_prompt_layers(mode_prompt=mode.prompt or None, teachings=None)

    def _temp_for_mode(mode_id: str | None, default: float = 0.25) -> float:
        mode = _resolve_mode(mode_id)
        if mode.temperature is not None:
            return float(mode.temperature)
        return default

    @app.post("/api/chat")
    async def chat(
        body: ChatBody,
        request: Request,
        authorization: str | None = Header(default=None),
        x_web_token: str | None = Header(default=None, alias="X-Web-Token"),
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ):
        guser = await _check_user_token(authorization, x_web_token, x_user_session)
        text = body.message.strip()
        if not text:
            raise HTTPException(400, "Tin nhắn trống")

        mode_id = (body.mode or "default").strip().lower()
        if mode_id not in MODES:
            mode_id = "default"
        mode_obj = get_mode(mode_id)

        # Plan / daily quota for logged-in web users
        web_user_id: int | None = None
        plan_id: str = "trial"
        plan_expired: bool = False
        if guser:
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
                pub = user_public(db_user)
                plan_id = pub.get("plan_id") or "trial"
                plan_expired = bool(pub.get("plan_expired"))

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
        # Map frontend model selectors to real backend models
        target_model = getattr(body, "model", None)
        target_label = None

        MODEL_SPECS = {
            "gemini-3.8-high": ("gemini-3.8-flash", "🧠 TUNGAI.FUN 3.8 High (Deep Reasoning)"),
            "3.8-high": ("gemini-3.8-flash", "🧠 TUNGAI.FUN 3.8 High (Deep Reasoning)"),
            "3.8": ("gemini-3.8-flash", "🧠 TUNGAI.FUN 3.8 High (Deep Reasoning)"),
            "coder-v1": ("gemini-3.8-flash", "👑 TUNGAI.FUN Coder v1.0 (Flagship ⭐)"),
            "coder": ("gemini-3.8-flash", "👑 TUNGAI.FUN Coder v1.0 (Flagship ⭐)"),
            "deepseek": ("gemini-3.8-flash", "💻 TUNGAI.FUN Coder Pro (Chuyên Code ⚡)"),
            "coder-pro": ("gemini-3.8-flash", "💻 TUNGAI.FUN Coder Pro (Chuyên Code ⚡)"),
            "fast": ("gemini-3.1-flash-lite", "⚡ TUNGAI.FUN Ultra Fast (Siêu Tốc 🚀)"),
            "ultra-fast": ("gemini-3.1-flash-lite", "⚡ TUNGAI.FUN Ultra Fast (Siêu Tốc 🚀)"),
            "flash-lite": ("gemini-3.1-flash-lite", "⚡ TUNGAI.FUN Ultra Fast (Siêu Tốc 🚀)"),
            "gemini-3.1-flash-lite": ("gemini-3.1-flash-lite", "⚡ TUNGAI.FUN Ultra Fast (Siêu Tốc 🚀)"),
            "default": ("gemini-3.8-flash", "👑 TUNGAI.FUN Coder v1.0 (Flagship ⭐)"),
        }

        if target_model in MODEL_SPECS:
            actual_model, target_label = MODEL_SPECS[target_model]
            target_model = actual_model
        elif target_model and not target_model.startswith("gemini-"):
            target_model = "gemini-3.8-flash"
            target_label = "🧠 TUNGAI.FUN 3.8 High (Deep Reasoning)"

        route = client.route_for_plan(plan_id, plan_expired=plan_expired)
        planner = PlannerAgent(client)
        coder = CoderAgent(client)
        reviewer = ReviewerAgent(client)
        debugger = DebuggerAgent(client)
        pipeline = AgentPipeline(client)

        # Check Image Studio (Vision 1.5)
        from ai.image_gen import is_image_request, generate_image_markdown
        if is_image_request(text, mode=mode_id, model=getattr(body, "model", None)):
            img_reply = generate_image_markdown(text)
            await _hydrate_session(sid)
            mem.add(sid, "user", text)
            await _persist(sid, "user", text)
            mem.add(sid, "assistant", img_reply)
            await _persist(sid, "assistant", img_reply)

            async def img_gen():
                yield _sse({
                    "type": "meta",
                    "session_id": sid,
                    "plan_id": plan_id,
                    "mode": mode_id,
                    "agent": "vision_1.5",
                    "ai_tier": "pro",
                    "ai_provider": "vision",
                    "ai_model": "TUNGAI.FUN Vision 1.5 (Image Studio 🖼️)",
                    "ai_label": "🎨 TUNGAI.FUN Vision 1.5 (Image Studio 🖼️)",
                })
                yield _sse({"type": "delta", "text": img_reply})
                yield _sse({"type": "done", "session_id": sid})

            if body.stream:
                return StreamingResponse(
                    img_gen(),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )
            return {
                "session_id": sid,
                "reply": img_reply,
                "plan_id": plan_id,
                "mode": mode_id,
                "agent": "vision_1.5",
                "ai_tier": "pro",
                "ai_model": "TUNGAI.FUN Vision 1.5 (Image Studio 🖼️)",
                "ai_label": "🎨 TUNGAI.FUN Vision 1.5 (Image Studio 🖼️)",
            }

        cmd, args = _parse_slash(text)

        # Local meta commands (no quota / no LLM)
        if cmd in ("help", "h", "?"):
            reply = WEB_HELP
            await _hydrate_session(sid)
            mem.add(sid, "user", text)
            await _persist(sid, "user", text)
            mem.add(sid, "assistant", reply)
            await _persist(sid, "assistant", reply)

            async def help_gen():
                yield _sse(
                    {
                        "type": "meta",
                        "session_id": sid,
                        "plan_id": plan_id,
                        "mode": mode_id,
                        "agent": "help",
                        "ai_tier": route.tier,
                        "ai_provider": route.provider,
                        "ai_model": route.model,
                        "ai_label": route.label,
                    }
                )
                yield _sse({"type": "delta", "text": reply})
                yield _sse({"type": "done", "session_id": sid})

            if body.stream:
                return StreamingResponse(
                    help_gen(),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )
            return {
                "session_id": sid,
                "reply": reply,
                "plan_id": plan_id,
                "mode": mode_id,
                "agent": "help",
                "ai_tier": route.tier,
                "ai_model": route.model,
                "ai_label": route.label,
            }

        if cmd == "mode":
            new_mode = (args or "default").strip().lower() or "default"
            if new_mode not in MODES:
                reply = (
                    f"Mode không hợp lệ: `{new_mode}`\n\n"
                    + "Chọn: "
                    + " · ".join(f"`{m}`" for m in MODES)
                    + "\n\nVD: `/mode coder`"
                )
            else:
                m = get_mode(new_mode)
                mode_id = m.id
                mode_obj = m
                reply = (
                    f"✅ Đã chọn mode **{m.name}** (`{m.id}`)\n\n"
                    f"{m.description}\n\n"
                    "Gửi tin tiếp theo sẽ dùng mode này (client cũng nên gửi `mode`)."
                )
            await _hydrate_session(sid)
            mem.add(sid, "user", text)
            await _persist(sid, "user", text)
            mem.add(sid, "assistant", reply)
            await _persist(sid, "assistant", reply)

            async def mode_gen():
                yield _sse(
                    {
                        "type": "meta",
                        "session_id": sid,
                        "plan_id": plan_id,
                        "mode": mode_id,
                        "agent": "mode",
                        "ai_tier": route.tier,
                        "ai_provider": route.provider,
                        "ai_model": route.model,
                        "ai_label": route.label,
                    }
                )
                yield _sse({"type": "delta", "text": reply})
                yield _sse({"type": "done", "session_id": sid, "mode": mode_id})

            if body.stream:
                return StreamingResponse(
                    mode_gen(),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )
            return {
                "session_id": sid,
                "reply": reply,
                "plan_id": plan_id,
                "mode": mode_id,
                "agent": "mode",
                "ai_tier": route.tier,
                "ai_model": route.model,
                "ai_label": route.label,
            }

        # Agent slash commands
        agent_cmds = {"plan", "code", "review", "debug", "build"}
        is_agent = cmd in agent_cmds

        if is_agent and not args:
            hints = {
                "plan": "Dùng: `/plan mô tả task`",
                "code": "Dùng: `/code mô tả / spec cần code`",
                "review": "Dùng: `/review dán code…`",
                "debug": "Dùng: `/debug traceback / log lỗi…`",
                "build": "Dùng: `/build mô tả task` (plan→code→review)",
            }
            raise HTTPException(400, hints.get(cmd or "", "Thiếu tham số lệnh"))

        # 1. Process document attachments
        doc_contexts = []
        if getattr(body, "attachments", None) and isinstance(body.attachments, list):
            for att in body.attachments:
                fn = att.get("filename") or "Tệp đính kèm"
                cnt = att.get("content") or ""
                meta = att.get("meta") or ""
                if cnt.strip():
                    doc_contexts.append(f"\n\n[TÀI LIỆU ĐÍNH KÈM: {fn} ({meta})]:\n{cnt}\n[HẾT TÀI LIỆU {fn}]")

        # 2. Process Web Search & URL extraction
        search_context = ""
        is_search_requested = getattr(body, "web_search", False) or text.lower().startswith(("/search", "/timkiem", "tìm kiếm:", "tra cứu:"))
        detected_urls = extract_urls(text)

        if detected_urls and not is_search_requested:
            target_url = detected_urls[0]
            url_res = await fetch_url_content(target_url)
            if url_res.get("ok"):
                search_context = f"\n\n[NỘI DUNG TRÍCH XUẤT TỪ ĐƯỜNG DẪN WEB {target_url}]:\nTiêu đề: {url_res.get('title')}\n{url_res.get('content')}\n[HẾT NỘI DUNG WEB]\n"

        elif is_search_requested:
            search_query = re.sub(r"^(/(?:search|timkiem)|tìm\s*kiếm:?|tra\s*cứu:?)\s*", "", text, flags=re.IGNORECASE).strip()
            if not search_query:
                search_query = text
            s_ctx, _ = await execute_web_search(search_query)
            if s_ctx:
                search_context = f"\n\n{s_ctx}\n"

        augmented_text = text
        if doc_contexts:
            augmented_text += "".join(doc_contexts)
        if search_context:
            augmented_text += search_context

        payload_text = augmented_text


        await _hydrate_session(sid)
        mem.add(sid, "user", text)
        await _persist(sid, "user", text)
        
        if body.history and len(body.history) > 0:
            history = [dict(m) for m in body.history]
            if history and history[-1].get("role") == "user":
                history[-1]["content"] = payload_text
            else:
                history.append({"role": "user", "content": payload_text})
        else:
            history = [dict(m) for m in mem.get(sid)]
            if history and history[-1].get("role") == "user":
                history[-1]["content"] = payload_text
            else:
                history.append({"role": "user", "content": payload_text})

        async def _after_success() -> None:
            if web_user_id is None:
                return
            try:
                async with db.session() as session:
                    await bump_web_usage(session, web_user_id)
            except Exception:
                logger.exception("bump web usage failed")

        system_extra = _system_for_mode(mode_id)
        temperature = _temp_for_mode(mode_id, 0.25)
        # Agent modes: slightly cooler for code quality
        if is_agent:
            temperature = min(temperature, 0.25)

        meta_base = {
            "type": "meta",
            "session_id": sid,
            "plan_id": plan_id,
            "mode": mode_id,
            "mode_name": mode_obj.name,
            "agent": cmd if is_agent else "chat",
            "ai_tier": route.tier,
            "ai_provider": route.provider,
            "ai_model": target_model or route.model,
            "ai_label": target_label or route.label,
        }

        async def _run_agent() -> str:
            assert cmd is not None
            if cmd == "plan":
                return await planner.plan(
                    args, plan_id=plan_id, plan_expired=plan_expired
                )
            if cmd == "code":
                return await coder.code(
                    args, plan_id=plan_id, plan_expired=plan_expired
                )
            if cmd == "review":
                return await reviewer.review(
                    args, plan_id=plan_id, plan_expired=plan_expired
                )
            if cmd == "debug":
                return await debugger.debug(
                    args, plan_id=plan_id, plan_expired=plan_expired
                )
            if cmd == "build":
                # Progress via coroutine queue on pipeline is handled in stream path
                result = await pipeline.run(
                    args,
                    do_plan=True,
                    do_code=True,
                    do_review=True,
                    plan_id=plan_id,
                    plan_expired=plan_expired,
                )
                return result.format_web()
            return "Unknown agent"

        if body.stream:

            async def event_gen():
                yield _sse(meta_base)
                parts: list[str] = []
                try:
                    if is_agent:
                        labels = {
                            "plan": "📋 Đang lập kế hoạch…",
                            "code": "💻 Đang sinh code…",
                            "review": "🔎 Đang review…",
                            "debug": "🐛 Đang phân tích…",
                            "build": "🔧 Pipeline plan → code → review…",
                        }
                        yield _sse(
                            {
                                "type": "status",
                                "step": cmd,
                                "text": labels.get(cmd or "", "Đang xử lý…"),
                            }
                        )
                        if cmd == "build":
                            # Emit status between real steps (not after the whole run)
                            yield _sse(
                                {
                                    "type": "status",
                                    "step": "plan",
                                    "text": "📋 Bước 1/3 — lập kế hoạch…",
                                }
                            )
                            plan_txt = await planner.plan(
                                args, plan_id=plan_id, plan_expired=plan_expired
                            )
                            yield _sse(
                                {
                                    "type": "status",
                                    "step": "code",
                                    "text": "💻 Bước 2/3 — sinh code…",
                                }
                            )
                            code_txt = await coder.code(
                                (
                                    f"Goal:\n{args}\n\n"
                                    f"Plan to implement:\n{plan_txt}\n\n"
                                    "Implement the solution based on the plan."
                                ),
                                plan_id=plan_id,
                                plan_expired=plan_expired,
                            )
                            yield _sse(
                                {
                                    "type": "status",
                                    "step": "review",
                                    "text": "🔎 Bước 3/3 — review…",
                                }
                            )
                            review_txt = await reviewer.review(
                                code_txt,
                                plan_id=plan_id,
                                plan_expired=plan_expired,
                            )
                            from ai.pipeline import PipelineResult

                            full = PipelineResult(
                                goal=args,
                                plan=plan_txt,
                                code=code_txt,
                                review=review_txt,
                                steps_done=["plan", "code", "review"],
                            ).format_web()
                            if full:
                                yield _sse({"type": "delta", "text": full})
                                parts.append(full)
                        else:
                            full = await _run_agent()
                            if full:
                                yield _sse({"type": "delta", "text": full})
                                parts.append(full)
                    else:
                        async for delta in client.chat_stream(
                            history,
                            system=system_extra,
                            temperature=temperature,
                            plan_id=plan_id,
                            plan_expired=plan_expired,
                            model=target_model,
                        ):
                            parts.append(delta)
                            yield _sse({"type": "delta", "text": delta})
                    full = "".join(parts).strip()
                    if full:
                        mem.add(sid, "assistant", full)
                        await _persist(sid, "assistant", full)
                        await _after_success()
                    yield _sse(
                        {
                            "type": "done",
                            "session_id": sid,
                            "mode": mode_id,
                            "agent": cmd if is_agent else "chat",
                        }
                    )
                except GrokError as exc:
                    logger.exception("web chat stream error")
                    yield _sse({"type": "error", "message": str(exc)})
                except Exception as exc:
                    logger.exception("web chat agent error")
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
            if is_agent:
                reply = await _run_agent()
            else:
                reply = await client.chat(
                    history,
                    system=system_extra,
                    temperature=temperature,
                    plan_id=plan_id,
                    plan_expired=plan_expired,
                    model=target_model,
                )
        except GrokError as exc:
            raise HTTPException(502, str(exc)) from exc
        mem.add(sid, "assistant", reply)
        await _persist(sid, "assistant", reply)
        await _after_success()
        return {
            "session_id": sid,
            "reply": reply,
            "plan_id": plan_id,
            "mode": mode_id,
            "agent": cmd if is_agent else "chat",
            "ai_tier": route.tier,
            "ai_model": route.model,
            "ai_label": route.label,
        }

    @app.get("/api/chat/history")
    async def chat_history(
        session_id: str = "",
        authorization: str | None = Header(default=None),
        x_web_token: str | None = Header(default=None, alias="X-Web-Token"),
        x_user_session: str | None = Header(default=None, alias="X-User-Session"),
    ) -> dict[str, Any]:
        """Load persisted messages for a browser session (after tab close / restart)."""
        await _check_user_token(authorization, x_web_token, x_user_session)
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
        await _check_user_token(authorization, x_web_token, x_user_session)
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
    print(f"[OK] TUNGAI.FUN Web -> http://127.0.0.1:{port}")
    uvicorn.run(
        "webapp.server:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
