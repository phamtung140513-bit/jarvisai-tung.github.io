"""Central configuration loaded from environment / .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import FrozenSet

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent

# OpenAI-compatible providers (chat/completions)
PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
        "label": "Groq (free tier)",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "openrouter/free",
        "label": "OpenRouter free",
    },
    "xai": {
        "base_url": "https://api.x.ai/v1",
        "model": "grok-3-mini",
        "label": "xAI Grok",
    },
    # NVIDIA NIM — OpenAI-compatible (build.nvidia.com / integrate.api.nvidia.com)
    "nvidia": {
        "base_url": "https://integrate.api.nvidia.com/v1",
        "model": "openai/gpt-oss-20b",
        "label": "NVIDIA NIM (gpt-oss-20b)",
    },
    "ollama": {
        "base_url": "http://127.0.0.1:11434/v1",
        "model": "llama3.2",
        "label": "Ollama local",
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Telegram
    telegram_bot_token: str = Field(..., alias="TELEGRAM_BOT_TOKEN")
    # Bootstrap owners (always admin). Comma-separated.
    allowed_telegram_ids: str = Field("", alias="ALLOWED_TELEGRAM_IDS")
    owner_telegram_ids: str = Field("", alias="OWNER_TELEGRAM_IDS")

    # Product / sales (white-label)
    product_tagline: str = Field(
        "Trợ lý AI coding trên Telegram — bán gói & white-label",
        alias="PRODUCT_TAGLINE",
    )
    support_contact: str = Field("@your_support", alias="SUPPORT_CONTACT")
    payment_info: str = Field(
        "Chuyển khoản rồi nhắn admin để nhận mã /activate",
        alias="PAYMENT_INFO",
    )
    currency: str = Field("VND", alias="CURRENCY")
    public_buy_enabled: bool = Field(True, alias="PUBLIC_BUY_ENABLED")
    # Bank QR — option A: file ảnh local
    payment_qr_path: str = Field("", alias="PAYMENT_QR_PATH")
    # Bank QR — option B: VietQR tự sinh (khuyến nghị VN)
    # BANK_ID: mb | vcb | tcb | acb | bidv | ... hoặc mã BIN 970422
    bank_id: str = Field("", alias="BANK_ID")
    bank_account: str = Field("", alias="BANK_ACCOUNT")
    bank_account_name: str = Field("", alias="BANK_ACCOUNT_NAME")
    bank_transfer_content: str = Field("AI TUNGDEV", alias="BANK_TRANSFER_CONTENT")
    # vietqr-pay integration (Node server)
    # VIETQR_PAY_URL=http://127.0.0.1:3000  → /buy tạo đơn + QR qua server
    vietqr_pay_url: str = Field("", alias="VIETQR_PAY_URL")
    # Webhook nhận "paid" từ vietqr-pay → auto kích hoạt gói
    payment_webhook_enabled: bool = Field(True, alias="PAYMENT_WEBHOOK_ENABLED")
    payment_webhook_host: str = Field("127.0.0.1", alias="PAYMENT_WEBHOOK_HOST")
    payment_webhook_port: int = Field(8787, alias="PAYMENT_WEBHOOK_PORT")
    payment_webhook_secret: str = Field("", alias="PAYMENT_WEBHOOK_SECRET")
    # Optional software license (when selling source installs)
    license_secret: str = Field("", alias="LICENSE_SECRET")
    software_license_key: str = Field("", alias="SOFTWARE_LICENSE_KEY")
    require_software_license: bool = Field(False, alias="REQUIRE_SOFTWARE_LICENSE")

    # Provider: groq | openrouter | xai | nvidia | ollama
    # Default stack (CLI / fallback). Plan routing overrides per-user chat.
    ai_provider: str = Field("groq", alias="AI_PROVIDER")

    # Preferred single key (works for any provider)
    ai_api_key: str = Field("", alias="AI_API_KEY")
    # Per-provider keys (optional)
    groq_api_key: str = Field("", alias="GROQ_API_KEY")
    openrouter_api_key: str = Field("", alias="OPENROUTER_API_KEY")
    xai_api_key: str = Field("", alias="XAI_API_KEY")
    nvidia_api_key: str = Field("", alias="NVIDIA_API_KEY")

    # Optional overrides (empty = use provider default)
    ai_base_url: str = Field("", alias="AI_BASE_URL")
    ai_model: str = Field("", alias="AI_MODEL")
    # Legacy aliases still accepted
    xai_base_url: str = Field("", alias="XAI_BASE_URL")
    xai_model: str = Field("", alias="XAI_MODEL")

    # Plan → model routing (Trial=Groq free, paid=GPT/NVIDIA)
    plan_route_enabled: bool = Field(True, alias="PLAN_ROUTE_ENABLED")
    free_ai_provider: str = Field("groq", alias="FREE_AI_PROVIDER")
    free_ai_model: str = Field("llama-3.3-70b-versatile", alias="FREE_AI_MODEL")
    paid_ai_provider: str = Field("nvidia", alias="PAID_AI_PROVIDER")
    paid_ai_model: str = Field("openai/gpt-oss-20b", alias="PAID_AI_MODEL")

    ai_temperature: float = Field(0.7, alias="AI_TEMPERATURE")
    ai_max_tokens: int = Field(4096, alias="AI_MAX_TOKENS")
    # Legacy names map in properties
    xai_temperature: float | None = Field(None, alias="XAI_TEMPERATURE")
    xai_max_tokens: int | None = Field(None, alias="XAI_MAX_TOKENS")

    # App
    app_name: str = Field("TungDevAI", alias="APP_NAME")
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    database_url: str = Field(
        "sqlite+aiosqlite:///./cache/jarvis.db",
        alias="DATABASE_URL",
    )
    workspace_dir: Path = Field(default=ROOT_DIR / "workspace", alias="WORKSPACE_DIR")
    max_history_messages: int = Field(40, alias="MAX_HISTORY_MESSAGES")

    # Web chat (GitHub Pages frontend → this backend)
    web_host: str = Field("0.0.0.0", alias="WEB_HOST")
    web_port: int = Field(7860, alias="WEB_PORT")
    web_access_token: str = Field("", alias="WEB_ACCESS_TOKEN")
    web_admin_key: str = Field("", alias="WEB_ADMIN_KEY")
    web_cors_origins: str = Field("*", alias="WEB_CORS_ORIGINS")
    # Google Sign-In (OAuth client ID from Google Cloud Console)
    google_client_id: str = Field("", alias="GOOGLE_CLIENT_ID")
    # If true, web chat requires login (Google and/or email) first
    google_auth_required: bool = Field(True, alias="GOOGLE_AUTH_REQUIRED")
    # Prefer WEB_AUTH_REQUIRED; falls back to GOOGLE_AUTH_REQUIRED
    web_auth_required: bool | None = Field(None, alias="WEB_AUTH_REQUIRED")
    # SMTP for email verification codes (register like ChatGPT/Claude)
    smtp_host: str = Field("", alias="SMTP_HOST")
    smtp_port: int = Field(587, alias="SMTP_PORT")
    smtp_user: str = Field("", alias="SMTP_USER")
    smtp_password: str = Field("", alias="SMTP_PASSWORD")
    smtp_from: str = Field("", alias="SMTP_FROM")
    smtp_tls: bool = Field(True, alias="SMTP_TLS")
    # When SMTP not set: log OTP to server console and return dev_code in API
    auth_dev_show_code: bool = Field(True, alias="AUTH_DEV_SHOW_CODE")

    @field_validator("workspace_dir", mode="before")
    @classmethod
    def _resolve_workspace(cls, v: str | Path) -> Path:
        path = Path(v)
        if not path.is_absolute():
            path = ROOT_DIR / path
        return path.resolve()

    @field_validator("ai_provider", mode="before")
    @classmethod
    def _norm_provider(cls, v: str) -> str:
        return (v or "groq").strip().lower()

    @model_validator(mode="after")
    def _check_api_key(self) -> Settings:
        # Ollama often needs no key
        if self.provider == "ollama":
            return self
        if not self.resolved_api_key:
            raise ValueError(
                f"Thiếu API key cho provider '{self.provider}'. "
                "Điền AI_API_KEY (hoặc GROQ_API_KEY / OPENROUTER_API_KEY / "
                "XAI_API_KEY / NVIDIA_API_KEY) trong .env"
            )
        if not self.owner_ids and not self.allowed_ids:
            raise ValueError(
                "Cần OWNER_TELEGRAM_IDS hoặc ALLOWED_TELEGRAM_IDS (Telegram ID chủ bot)"
            )
        if self.require_software_license:
            from product.license_keys import verify_software_license

            info = verify_software_license(
                self.license_secret, self.software_license_key
            )
            if not info.valid:
                raise ValueError(
                    f"SOFTWARE_LICENSE_KEY không hợp lệ: {info.reason}. "
                    "Tạo key bằng: python tools/gen_license.py"
                )
        return self

    @property
    def provider(self) -> str:
        p = self.ai_provider
        if p not in PROVIDER_DEFAULTS:
            return "groq"
        return p

    @property
    def provider_label(self) -> str:
        return PROVIDER_DEFAULTS[self.provider]["label"]

    @property
    def resolved_api_key(self) -> str:
        """Key for the active provider (provider-specific first, then AI_API_KEY)."""
        p = self.provider
        if p == "ollama":
            return self.ai_api_key.strip() or "ollama"
        # Prefer the key that matches the active provider so switching
        # AI_PROVIDER=nvidia does not accidentally send a Groq gsk_ key.
        specific = ""
        if p == "groq":
            specific = self.groq_api_key.strip()
        elif p == "openrouter":
            specific = self.openrouter_api_key.strip()
        elif p == "xai":
            specific = self.xai_api_key.strip()
        elif p == "nvidia":
            specific = self.nvidia_api_key.strip()
        if specific:
            return specific
        return self.ai_api_key.strip()

    @property
    def resolved_base_url(self) -> str:
        if self.ai_base_url.strip():
            return self.ai_base_url.strip().rstrip("/")
        if self.provider == "xai" and self.xai_base_url.strip():
            return self.xai_base_url.strip().rstrip("/")
        return PROVIDER_DEFAULTS[self.provider]["base_url"].rstrip("/")

    @property
    def resolved_model(self) -> str:
        if self.ai_model.strip():
            return self.ai_model.strip()
        if self.provider == "xai" and self.xai_model.strip():
            return self.xai_model.strip()
        return PROVIDER_DEFAULTS[self.provider]["model"]

    @property
    def temperature(self) -> float:
        if self.xai_temperature is not None:
            return self.xai_temperature
        return self.ai_temperature

    @property
    def max_tokens(self) -> int:
        if self.xai_max_tokens is not None:
            return self.xai_max_tokens
        return self.ai_max_tokens

    # Back-compat names used by older code
    @property
    def xai_api_key_compat(self) -> str:
        return self.resolved_api_key

    @staticmethod
    def _parse_ids(raw: str) -> FrozenSet[int]:
        ids: set[int] = set()
        for part in (raw or "").split(","):
            part = part.strip()
            if part:
                ids.add(int(part))
        return frozenset(ids)

    @property
    def allowed_ids(self) -> FrozenSet[int]:
        """Bootstrap allow-list (treated as owners for back-compat)."""
        return self._parse_ids(self.allowed_telegram_ids)

    @property
    def owner_ids(self) -> FrozenSet[int]:
        owners = set(self._parse_ids(self.owner_telegram_ids))
        owners |= set(self.allowed_ids)
        return frozenset(owners)

    @property
    def logs_dir(self) -> Path:
        return ROOT_DIR / "logs"

    @property
    def cache_dir(self) -> Path:
        return ROOT_DIR / "cache"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


def ensure_directories(settings: Settings | None = None) -> None:
    s = settings or get_settings()
    for path in (s.workspace_dir, s.logs_dir, s.cache_dir):
        path.mkdir(parents=True, exist_ok=True)


def clear_settings_cache() -> None:
    get_settings.cache_clear()
