"""SQLAlchemy models — users, codes, usage, conversation, audit."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class BotUser(Base):
    """Paying / activated Telegram customer."""

    __tablename__ = "bot_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    plan_id: Mapped[str] = mapped_column(String(32), default="trial", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class AccessCode(Base):
    """Redeemable codes sold to customers."""

    __tablename__ = "access_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    plan_id: Mapped[str] = mapped_column(String(32), nullable=False)
    days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    max_uses: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    uses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    note: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class UsageCounter(Base):
    """Per-user daily message counters for quotas."""

    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("telegram_id", "day", name="uq_usage_user_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    day: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class UserTeaching(Base):
    """Per-user custom rules so the AI follows the user's style/preferences.

    kind:
      - rule   : always-on instruction ("luôn trả lời ngắn", …)
      - style  : tone / format preference
      - fact   : fact about user or project to remember
    """

    __tablename__ = "user_teachings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="rule", nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class GoogleWebUser(Base):
    """Web users: Google Sign-In and/or email+password (OTP verified)."""

    __tablename__ = "google_web_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Google sub OR synthetic "email:<hash>" for email-only accounts
    google_sub: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    picture: Mapped[str | None] = mapped_column(String(512), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(256), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # SaaS plan for web chat (same plan ids as Telegram: trial/basic/pro/business)
    plan_id: Mapped[str] = mapped_column(String(32), default="trial", nullable=False)
    plan_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    usage_day: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
