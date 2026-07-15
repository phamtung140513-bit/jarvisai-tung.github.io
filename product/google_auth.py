"""Google Sign-In helpers for web chat."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import GoogleWebUser

logger = logging.getLogger(__name__)


def verify_google_id_token(id_token: str, client_id: str) -> dict[str, Any]:
    """Verify Google GIS credential JWT. Raises ValueError if invalid."""
    if not client_id:
        raise ValueError("GOOGLE_CLIENT_ID chua cau hinh")
    if not id_token:
        raise ValueError("Thieu id_token")

    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    # clock_skew: may Windows dong ho lech Google (loi "Token used too early")
    info = google_id_token.verify_oauth2_token(
        id_token,
        google_requests.Request(),
        audience=client_id,
        clock_skew_in_seconds=600,
    )
    # Optional: check iss
    iss = info.get("iss", "")
    if iss not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("Iss khong hop le")
    if not info.get("sub"):
        raise ValueError("Token thieu sub")
    return info


async def upsert_google_user(session: AsyncSession, info: dict[str, Any]) -> GoogleWebUser:
    sub = str(info["sub"])
    res = await session.execute(
        select(GoogleWebUser).where(GoogleWebUser.google_sub == sub)
    )
    user = res.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if user is None:
        from datetime import timedelta

        user = GoogleWebUser(
            google_sub=sub,
            email=info.get("email"),
            name=info.get("name"),
            picture=info.get("picture"),
            active=True,
            email_verified=True,
            plan_id="trial",
            plan_expires_at=now + timedelta(days=3),
            usage_day=None,
            usage_count=0,
            last_login_at=now,
            created_at=now,
        )
        session.add(user)
    else:
        user.email = info.get("email") or user.email
        user.name = info.get("name") or user.name
        user.picture = info.get("picture") or user.picture
        user.email_verified = True
        user.last_login_at = now
        if not getattr(user, "plan_id", None):
            user.plan_id = "trial"
        if not user.active:
            raise ValueError("Tài khoản đã bị khóa")
    await session.commit()
    await session.refresh(user)
    return user
