"""Route LLM provider/model by subscription plan.

Trial / expired → Groq (free)
Basic          → GPT (openai/gpt-oss-120b on NVIDIA NIM)
Pro / Business / Owner → DeepSeek-V4-Pro (strongest coding)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from config import Settings

# Plans that unlock paid models (not free Groq)
PAID_PLANS = frozenset({"basic", "pro", "business", "owner"})
# Higher tier: strongest coding model
PRO_PLANS = frozenset({"pro", "business", "owner"})


@dataclass(frozen=True)
class ModelRoute:
    provider: str
    model: str
    base_url: str
    api_key: str
    label: str
    tier: str  # "free" | "basic" | "pro"


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
    """Pick model stack for this plan."""
    from config import PROVIDER_DEFAULTS

    pid = (plan_id or "trial").strip().lower()
    routing_on = getattr(settings, "plan_route_enabled", True)

    if not routing_on:
        # Single stack from AI_PROVIDER
        provider = settings.provider
        defaults = _provider_defaults(provider)
        return ModelRoute(
            provider=provider,
            model=settings.resolved_model,
            base_url=settings.resolved_base_url,
            api_key=settings.resolved_api_key,
            label=defaults.get("label", provider),
            tier="paid" if pid in PAID_PLANS else "free",
        )

    # Expired non-owner → free
    if plan_expired and pid != "owner":
        pid = "trial"

    if pid in PRO_PLANS:
        provider = (settings.paid_ai_provider or "nvidia").strip().lower()
        model = (settings.paid_ai_model or "deepseek-ai/deepseek-v4-pro").strip()
        tier = "pro"
        label = "DeepSeek-V4-Pro (Pro+)"
    elif pid == "basic":
        provider = (settings.basic_ai_provider or "nvidia").strip().lower()
        model = (settings.basic_ai_model or "openai/gpt-oss-120b").strip()
        tier = "basic"
        label = "GPT-OSS-120B (Basic)"
    else:
        provider = (settings.free_ai_provider or "groq").strip().lower()
        model = (settings.free_ai_model or "").strip()
        tier = "free"
        label = "Groq (free / Trial)"

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
    if tier != "free" and not api_key:
        free_p = (settings.free_ai_provider or "groq").strip().lower()
        if free_p not in PROVIDER_DEFAULTS:
            free_p = "groq"
        fd = _provider_defaults(free_p)
        return ModelRoute(
            provider=free_p,
            model=(settings.free_ai_model or fd["model"]).strip() or fd["model"],
            base_url=fd["base_url"].rstrip("/"),
            api_key=_key_for_provider(settings, free_p),
            label="Groq (fallback — thiếu key VIP)",
            tier="free",
        )

    return ModelRoute(
        provider=provider,
        model=model,
        base_url=base_url,
        api_key=api_key,
        label=label,
        tier=tier,
    )


def route_public_dict(route: ModelRoute) -> dict[str, str]:
    return {
        "ai_tier": route.tier,
        "ai_provider": route.provider,
        "ai_model": route.model,
        "ai_label": route.label,
    }
