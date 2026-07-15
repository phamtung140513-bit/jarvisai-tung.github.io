"""Async OpenAI-compatible chat client (Groq / OpenRouter / xAI / NVIDIA / Ollama)."""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Sequence

import httpx

from ai.prompts import build_system_prompt
from ai.routing import ModelRoute, resolve_route
from config import Settings, get_settings

logger = logging.getLogger(__name__)


class GrokError(RuntimeError):
    """Raised when the LLM API returns an error."""


class GrokClient:
    """Thin async wrapper around POST /chat/completions (any OpenAI-compatible API).

    Supports per-request routing by subscription plan:
      trial/free → Groq
      basic/pro/business → paid GPT (NVIDIA by default)
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        # Runtime override (owner /setmodel) — does not rewrite .env
        self._model_override: str | None = None
        self._clients: dict[str, httpx.AsyncClient] = {}
        # Default client = env AI_PROVIDER (CLI / legacy)
        default = resolve_route(self.settings, "owner")  # not used for key only
        # Build default from settings.provider (legacy single-stack)
        self._default_provider = self.settings.provider
        self._client = self._make_client(
            self.settings.resolved_base_url,
            self.settings.resolved_api_key,
            self._default_provider,
        )
        self._clients[self._default_provider] = self._client
        logger.info(
            "LLM client: default provider=%s model=%s url=%s | plan_route=%s free=%s/%s paid=%s/%s",
            self.settings.provider,
            self.active_model,
            self.settings.resolved_base_url,
            getattr(self.settings, "plan_route_enabled", True),
            self.settings.free_ai_provider,
            self.settings.free_ai_model,
            self.settings.paid_ai_provider,
            self.settings.paid_ai_model,
        )

    def _make_client(self, base_url: str, api_key: str, provider: str) -> httpx.AsyncClient:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if provider == "openrouter":
            headers["HTTP-Referer"] = "https://github.com/TungDevAI"
            headers["X-Title"] = self.settings.app_name
        return httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(120.0, connect=15.0),
        )

    def _client_for_route(self, route: ModelRoute) -> httpx.AsyncClient:
        key = f"{route.provider}|{route.base_url}|{route.api_key[:12]}"
        if key not in self._clients:
            self._clients[key] = self._make_client(
                route.base_url, route.api_key, route.provider
            )
        return self._clients[key]

    def route_for_plan(
        self,
        plan_id: str | None = None,
        *,
        plan_expired: bool = False,
    ) -> ModelRoute:
        return resolve_route(
            self.settings, plan_id, plan_expired=plan_expired
        )

    @property
    def active_model(self) -> str:
        return (self._model_override or self.settings.resolved_model).strip()

    def set_model_override(self, model: str | None) -> str:
        """Set runtime model id (same provider/base_url). Empty = back to .env default."""
        if model is None or not str(model).strip():
            self._model_override = None
        else:
            self._model_override = str(model).strip()
        logger.info("Model override → %s", self.active_model)
        return self.active_model

    async def aclose(self) -> None:
        for c in self._clients.values():
            await c.aclose()
        self._clients.clear()

    async def __aenter__(self) -> GrokClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    def _build_payload(
        self,
        messages: Sequence[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        stream: bool = False,
        model: str | None = None,
    ) -> dict[str, Any]:
        sys_content = build_system_prompt(system)
        full: list[dict[str, str]] = [{"role": "system", "content": sys_content}]
        full.extend(messages)
        return {
            "model": (model or self.active_model).strip(),
            "messages": full,
            "temperature": temperature
            if temperature is not None
            else self.settings.temperature,
            "max_tokens": max_tokens
            if max_tokens is not None
            else self.settings.max_tokens,
            "stream": stream,
        }

    def _resolve_call(
        self,
        *,
        plan_id: str | None,
        plan_expired: bool,
        model: str | None,
    ) -> tuple[httpx.AsyncClient, str, ModelRoute | None]:
        """Return (client, model_id, route_or_none)."""
        if plan_id is not None or getattr(self.settings, "plan_route_enabled", True):
            # Explicit plan routing when plan_id provided; when plan_id is None
            # and routing on, treat as free/trial for safety on web.
            route = self.route_for_plan(plan_id, plan_expired=plan_expired)
            if self._model_override and plan_id and plan_id in ("owner",):
                # Owner may /setmodel — keep override on default client
                return self._client, self.active_model, route
            client = self._client_for_route(route)
            mid = model or route.model
            if self._model_override and plan_id == "owner":
                mid = self.active_model
            return client, mid, route
        return self._client, model or self.active_model, None

    def _extract_content(self, data: dict[str, Any]) -> str:
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise GrokError(f"Unexpected response shape: {data!r}") from exc

        content = msg.get("content") if isinstance(msg, dict) else None
        reasoning = msg.get("reasoning_content") if isinstance(msg, dict) else None
        if content is None and not isinstance(msg, dict):
            content = getattr(msg, "content", None)
            reasoning = getattr(msg, "reasoning_content", None)

        text = content if isinstance(content, str) and content.strip() else ""
        if not text and isinstance(reasoning, str) and reasoning.strip():
            text = reasoning
        if not isinstance(text, str):
            text = str(text or "")
        if not text.strip():
            raise GrokError(f"Empty assistant content: {data!r}")
        return text.strip()

    async def chat(
        self,
        messages: Sequence[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        plan_id: str | None = None,
        plan_expired: bool = False,
        model: str | None = None,
    ) -> str:
        """Send a chat completion request and return assistant text."""
        client, model_id, route = self._resolve_call(
            plan_id=plan_id, plan_expired=plan_expired, model=model
        )
        # If plan_id not passed, use default single-stack (CLI / legacy)
        if plan_id is None and not getattr(self.settings, "plan_route_enabled", True):
            client, model_id = self._client, model or self.active_model
            route = None
        elif plan_id is None:
            # No plan → free tier
            route = self.route_for_plan("trial")
            client = self._client_for_route(route)
            model_id = model or route.model

        payload = self._build_payload(
            messages,
            system=system,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=False,
            model=model_id,
        )
        logger.info(
            "LLM request tier=%s provider=%s model=%s msgs=%d",
            route.tier if route else "default",
            route.provider if route else self.settings.provider,
            payload["model"],
            len(payload["messages"]),
        )
        try:
            resp = await client.post("/chat/completions", json=payload)
        except httpx.HTTPError as exc:
            logger.exception("LLM network error")
            raise GrokError(f"Network error: {exc}") from exc

        if resp.status_code >= 400:
            body = resp.text[:500]
            logger.error("LLM API %s: %s", resp.status_code, body)
            raise GrokError(f"API {resp.status_code}: {body}")

        return self._extract_content(resp.json())

    async def chat_stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        plan_id: str | None = None,
        plan_expired: bool = False,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        """Stream assistant tokens (SSE). Yields text deltas."""
        import json

        if plan_id is None:
            route = self.route_for_plan("trial")
            client = self._client_for_route(route)
            model_id = model or route.model
        else:
            client, model_id, route = self._resolve_call(
                plan_id=plan_id, plan_expired=plan_expired, model=model
            )

        payload = self._build_payload(
            messages,
            system=system,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
            model=model_id,
        )
        logger.info(
            "LLM stream tier=%s provider=%s model=%s",
            route.tier if route else "default",
            route.provider if route else self.settings.provider,
            payload["model"],
        )
        try:
            async with client.stream("POST", "/chat/completions", json=payload) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode(errors="replace")[:500]
                    raise GrokError(f"API {resp.status_code}: {body}")
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta_obj = chunk["choices"][0].get("delta", {}) or {}
                        delta = delta_obj.get("content") or delta_obj.get(
                            "reasoning_content"
                        )
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                        continue
        except httpx.HTTPError as exc:
            raise GrokError(f"Network error: {exc}") from exc


# Alias for clarity in new code
LLMClient = GrokClient
LLMError = GrokError
