"""Route LLM provider/model by subscription plan.

Free (trial / expired): Groq — nhanh, rẻ/free tier
Paid (basic/pro/business/owner): NVIDIA GPT-OSS (hoặc provider trả phí khác)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from config import Settings

# Plans that unlock paid model (GPT / NVIDIA)
PAID_PLANS = frozenset({"basic", "pro", "business", "owner"})


@dataclass(frozen=True)
class ModelRoute:
    provider: str
    model: str
    base_url: str
    api_key: str
    label: str
    tier: str  # "free" | "paid"


def _provider_defaults(provider: str) -> dict[str, str]:
    from config import PROVIDER_DEFAULTS

    return PROVIDER_DEFAULTS.get(provider) or PROVIDER_DEFAULTS["groq"]


def _key_for_provider(settings: Settings, provider: str) -> str:
    p = (provider or "").strip().lower()
    if p == "groq":
        return (settings.groq_api_key or settings.ai_api_key or "").strip()
    if p == "nvidia":
        return (settings.nvidia_api_key or settings.ai_api_key or "").strip()
    if p == "openrouter":
        return (settings.openrouter_api_key or settings.ai_api_key or "").strip()
    if p == "xai":
        return (settings.xai_api_key or settings.ai_api_key or "").strip()
    if p == "ollama":
        return (settings.ai_api_key or "ollama").strip()
    return (settings.ai_api_key or "").strip()


def is_paid_plan(plan_id: str | None, *, plan_expired: bool = False) -> bool:
    pid = (plan_id or "trial").strip().lower()
    if plan_expired and pid != "owner":
        return False
    return pid in PAID_PLANS


def resolve_route(
    settings: Settings,
    plan_id: str | None = None,
    *,
    plan_expired: bool = False,
) -> ModelRoute:
    """Pick free (Groq) or paid (GPT/NVIDIA) stack for this plan."""
    from config import PROVIDER_DEFAULTS

    paid = is_paid_plan(plan_id, plan_expired=plan_expired) and getattr(
        settings, "plan_route_enabled", True
    )

    if paid:
        provider = (settings.paid_ai_provider or "nvidia").strip().lower()
        model = (settings.paid_ai_model or "").strip()
        tier = "paid"
        label = "GPT (gói trả phí)"
    else:
        provider = (settings.free_ai_provider or "groq").strip().lower()
        model = (settings.free_ai_model or "").strip()
        tier = "free"
        label = "Groq (gói free)"

    if provider not in PROVIDER_DEFAULTS:
        provider = "groq" if tier == "free" else "nvidia"
        if provider not in PROVIDER_DEFAULTS:
            provider = "groq"

    defaults = _provider_defaults(provider)
    if not model:
        model = defaults["model"]
    base_url = defaults["base_url"].rstrip("/")
    api_key = _key_for_provider(settings, provider)

    # Fallback: paid key missing → free route so chat still works
    if paid and not api_key:
        free_p = (settings.free_ai_provider or "groq").strip().lower()
        if free_p not in PROVIDER_DEFAULTS:
            free_p = "groq"
        fd = _provider_defaults(free_p)
        return ModelRoute(
            provider=free_p,
            model=(settings.free_ai_model or fd["model"]).strip() or fd["model"],
            base_url=fd["base_url"].rstrip("/"),
            api_key=_key_for_provider(settings, free_p),
            label="Groq (fallback — thiếu key GPT)",
            tier="free",
        )

    return ModelRoute(
        provider=provider,
        model=model,
        base_url=base_url,
        api_key=api_key,
        label=label if paid else "Groq (free / Trial)",
        tier=tier,
    )


def route_public_dict(route: ModelRoute) -> dict[str, str]:
    return {
        "ai_tier": route.tier,
        "ai_provider": route.provider,
        "ai_model": route.model,
        "ai_label": route.label,
    }
