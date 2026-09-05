"""Route LLM provider/model by subscription plan.

Default Flagship: TungDevAI Coder v1.0 (Flagship ⭐)
Optional Multi-Model Clusters: NVIDIA NIM Deep Reasoning / Ultra Fast / Vision
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from config import Settings

PAID_PLANS = frozenset({"basic", "pro", "business", "owner"})
PRO_PLANS = frozenset({"business", "owner"})

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
    return PROVIDER_DEFAULTS.get(provider) or PROVIDER_DEFAULTS["gemini"]

def _key_for_provider(settings: Settings, provider: str) -> str:
    p = (provider or "").strip().lower()
    if p == "gemini":
        return (settings.gemini_api_key or settings.ai_api_key or "").strip()
    if p == "nvidia":
        return (settings.nvidia_api_key or settings.ai_api_key or "").strip()
    if p == "groq":
        return (settings.groq_api_key or settings.ai_api_key or "").strip()
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
    """Pick model stack for this plan - Defaults to TungDevAI Coder v1.0 Flagship."""
    from config import PROVIDER_DEFAULTS

    pid = (plan_id or "trial").strip().lower()
    routing_on = getattr(settings, "plan_route_enabled", True)

    if not routing_on:
        provider = settings.provider
        defaults = _provider_defaults(provider)
        return ModelRoute(
            provider=provider,
            model=settings.resolved_model,
            base_url=settings.resolved_base_url,
            api_key=settings.resolved_api_key,
            label="👑 TungDevAI Coder v1.0 (Flagship ⭐)",
            tier="paid" if pid in PAID_PLANS else "free",
        )

    # All plans default to TungDevAI Coder v1.0
    provider = (settings.paid_ai_provider if pid in PAID_PLANS else settings.free_ai_provider) or "gemini"
    provider = provider.strip().lower()
    if provider not in PROVIDER_DEFAULTS:
        provider = "gemini"

    defaults = _provider_defaults(provider)
    model = (settings.paid_ai_model if pid in PAID_PLANS else settings.free_ai_model) or defaults["model"]
    model = model.strip() or defaults["model"]
    
    base_url = defaults["base_url"].rstrip("/")
    api_key = _key_for_provider(settings, provider)

    tier = "pro" if pid in PRO_PLANS else ("basic" if pid in PAID_PLANS else "free")
    label = "👑 TungDevAI Coder v1.0 (Flagship ⭐)"

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

def resolve_cli_strongest_route(settings: Settings) -> ModelRoute:
    """Default strongest CLI route -> Exclusively locked to Google Gemini 3.8 High (Deep Reasoning)."""
    defaults = _provider_defaults("gemini")
    key = _key_for_provider(settings, "gemini")
    return ModelRoute(
        provider="gemini",
        model="gemini-3.8-flash",
        base_url=defaults["base_url"].rstrip("/"),
        api_key=key,
        label="🧠 Google Gemini 3.8 High (Deep Reasoning ⚡)",
        tier="pro",
    )
