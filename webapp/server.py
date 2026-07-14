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

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"

# Coding-first system (same spirit as Telegram)
WEB_SYSTEM = SYSTEM_PROMPT


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=32000)
    session_id: str = Field(default="", max_length=64)
    stream: bool = True


class AdminLoginBody(BaseModel):
    key: str = Field(..., min_length=1, max_length=256)


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

    access_token = (settings.web_access_token or os.getenv("WEB_ACCESS_TOKEN") or "").strip()
    admin_key = (settings.web_admin_key or os.getenv("WEB_ADMIN_KEY") or "").strip()
    cors_raw = (settings.web_cors_origins or os.getenv("WEB_CORS_ORIGINS") or "*").strip()
    cors_origins = [o.strip() for o in cors_raw.split(",") if o.strip()]

    # Admin session tokens (in-memory; restart invalidates)
    admin_sessions: set[str] = set()

    app = FastAPI(title=f"{settings.app_name} Web", version="1.1")
    app.state.settings = settings
    app.state.memory = memory
    app.state.grok = grok
    app.state.access_token = access_token
    app.state.admin_key = admin_key
    app.state.admin_sessions = admin_sessions

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins if cors_origins != ["*"] else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    def _check_user_token(authorization: str | None, x_token: str | None) -> None:
        if not access_token:
            return
        bearer = ""
        if authorization and authorization.lower().startswith("bearer "):
            bearer = authorization[7:].strip()
        got = (x_token or bearer or "").strip()
        if got != access_token:
            raise HTTPException(status_code=401, detail="Sai user access token")

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

    @app.get("/", response_class=HTMLResponse)
    async def index() -> FileResponse:
        index_path = STATIC_DIR / "index.html"
        if not index_path.is_file():
            return HTMLResponse("<h1>Missing webapp/static/index.html</h1>", status_code=500)
        return FileResponse(index_path)

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "service": "jarvis-web",
            "app": settings.app_name,
            "provider": settings.provider,
            "model": settings.resolved_model,
            "auth_required": bool(access_token),
            "admin_enabled": bool(admin_key),
        }

    @app.get("/api/config")
    async def public_config() -> dict[str, Any]:
        # Public: no secrets
        return {
            "app_name": settings.app_name,
            "tagline": settings.product_tagline,
            "provider": settings.provider,
            "model": settings.resolved_model,
            "auth_required": bool(access_token),
            "admin_enabled": bool(admin_key),
            "telegram_bot": "https://t.me/grokapiai_bot",
            "role": "coder",
        }

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
        return {
            "ok": True,
            "app": settings.app_name,
            "provider": settings.provider,
            "model": settings.resolved_model,
            "base_url": settings.resolved_base_url,
            "user_auth_required": bool(access_token),
            "sessions": len(memory._store),  # noqa: SLF001
        }

    @app.post("/api/chat")
    async def chat(
        body: ChatBody,
        request: Request,
        authorization: str | None = Header(default=None),
        x_web_token: str | None = Header(default=None, alias="X-Web-Token"),
    ):
        _check_user_token(authorization, x_web_token)
        text = body.message.strip()
        if not text:
            raise HTTPException(400, "Tin nhan trong")

        sid = (body.session_id or "").strip() or secrets.token_hex(8)
        mem: SessionMemory = request.app.state.memory
        client: GrokClient = request.app.state.grok

        mem.add(sid, "user", text)
        history = mem.get(sid)

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
        return {"session_id": sid, "reply": reply}

    @app.post("/api/clear")
    async def clear(
        request: Request,
        body: dict[str, str] | None = None,
        authorization: str | None = Header(default=None),
        x_web_token: str | None = Header(default=None, alias="X-Web-Token"),
    ) -> dict[str, Any]:
        _check_user_token(authorization, x_web_token)
        sid = (body or {}).get("session_id", "").strip()
        if sid:
            request.app.state.memory.clear(sid)
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
    print(f"🌐 Jarvis Web → http://127.0.0.1:{port}")
    uvicorn.run(
        "webapp.server:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
