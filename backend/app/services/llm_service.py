"""Dormant Ollama adapter reserved for future semantic explanations.

The active GuardFlow scoring route does not import or call this service.  When
explicitly enabled in the future, it may describe supplied evidence but it is
not allowed to calculate, replace, or adjust any risk score.
"""

from __future__ import annotations

import json
from hashlib import sha256
from typing import Any

import httpx

from app.core.logger import logger
from app.core.settings import settings


class LLMService:
    """Optional semantic-analysis client; disabled unless explicitly enabled."""

    def __init__(self, enabled: bool = False, client: httpx.Client | None = None):
        self.enabled = enabled
        self.client = client or httpx.Client(timeout=httpx.Timeout(settings.OLLAMA_TIMEOUT))
        self.generate_url = f"{settings.OLLAMA_URL.rstrip('/')}/api/generate"
        self._cache: dict[str, dict[str, Any]] = {}

    def analyze_semantics(self, compact_evidence: dict[str, Any]) -> dict[str, Any]:
        """Return semantic flags only; never return or modify a numeric score."""
        if not self.enabled:
            return self._fallback("LLM analysis is paused")

        cache_key = self._fingerprint("semantics", compact_evidence)
        if cache_key in self._cache:
            return dict(self._cache[cache_key])

        prompt = self._build_semantic_prompt(compact_evidence)
        result = self._generate(prompt)
        if result.get("available"):
            self._cache[cache_key] = dict(result)
        return result

    def explain_result(self, risk_result: dict[str, Any]) -> dict[str, Any]:
        """Explain an already-calculated result without changing its values."""
        if not self.enabled:
            return {
                "available": False,
                "explanation": "LLM explanation is paused",
            }

        safe_result = {
            "risk_score": risk_result.get("risk_score"),
            "risk_level": risk_result.get("risk_level"),
            "triggered_rules": list(risk_result.get("triggered_rules") or [])[:12],
            "evidence": list(risk_result.get("evidence") or [])[:12],
            "recommendations": list(risk_result.get("recommendations") or [])[:4],
        }
        prompt = self._build_explanation_prompt(safe_result)
        generated = self._generate_raw(prompt)
        return {
            "available": generated is not None,
            "explanation": generated or "LLM explanation unavailable",
        }

    def _generate(self, prompt: str) -> dict[str, Any]:
        raw = self._generate_raw(prompt)
        if raw is None:
            return self._fallback("Ollama unavailable or returned an invalid response")

        parsed = self._parse_json(raw)
        if not isinstance(parsed, dict):
            return self._fallback("Ollama did not return valid JSON")

        # Scores are deliberately discarded even if a model invents them.
        return {
            "available": True,
            "phishing_intent": bool(parsed.get("phishing_intent")),
            "fake_branding": bool(parsed.get("fake_branding")),
            "urgency_language": bool(parsed.get("urgency_language")),
            "social_engineering": bool(parsed.get("social_engineering")),
            "trustworthiness": self._trustworthiness(parsed.get("trustworthiness")),
            "evidence": self._string_list(parsed.get("evidence"), 8),
        }

    def _generate_raw(self, prompt: str) -> str | None:
        payload = {
            "model": settings.OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0, "num_predict": 256},
        }
        try:
            response = self.client.post(self.generate_url, json=payload)
            response.raise_for_status()
            body = response.json()
            text = body.get("response") if isinstance(body, dict) else None
            return text.strip() if isinstance(text, str) and text.strip() else None
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("LLM fallback reason={}", type(exc).__name__)
            return None

    @staticmethod
    def _build_semantic_prompt(evidence: dict[str, Any]) -> str:
        compact = json.dumps(evidence, ensure_ascii=False, sort_keys=True)
        return (
            "Analyze only the supplied website evidence. Return JSON with exactly "
            "phishing_intent, fake_branding, urgency_language, social_engineering, "
            "trustworthiness, and evidence. The first four values must be booleans; "
            "trustworthiness must be trusted, suspicious, or unknown; evidence must "
            "be short strings grounded in the input. Do not calculate or return a "
            f"risk score. Evidence: {compact}"
        )

    @staticmethod
    def _build_explanation_prompt(result: dict[str, Any]) -> str:
        compact = json.dumps(result, ensure_ascii=False, sort_keys=True)
        return (
            "Explain this deterministic GuardFlow result in at most 80 words. Use "
            "only the supplied facts. Do not change, recalculate, or introduce any "
            f"score, rule, or evidence. Result: {compact}"
        )

    @staticmethod
    def _parse_json(text: str) -> dict[str, Any] | None:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`\n ")
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].strip()
        try:
            value = json.loads(cleaned)
            return value if isinstance(value, dict) else None
        except json.JSONDecodeError:
            start, end = cleaned.find("{"), cleaned.rfind("}")
            if start < 0 or end <= start:
                return None
            try:
                value = json.loads(cleaned[start : end + 1])
                return value if isinstance(value, dict) else None
            except json.JSONDecodeError:
                return None

    @staticmethod
    def _fallback(reason: str) -> dict[str, Any]:
        return {
            "available": False,
            "phishing_intent": False,
            "fake_branding": False,
            "urgency_language": False,
            "social_engineering": False,
            "trustworthiness": "unknown",
            "evidence": [],
            "fallback_reason": reason,
        }

    @staticmethod
    def _trustworthiness(value: Any) -> str:
        normalized = str(value or "unknown").lower()
        return normalized if normalized in {"trusted", "suspicious", "unknown"} else "unknown"

    @staticmethod
    def _string_list(value: Any, limit: int) -> list[str]:
        items = value if isinstance(value, list) else [value] if value else []
        return [str(item).strip() for item in items if str(item).strip()][:limit]

    @staticmethod
    def _fingerprint(kind: str, value: dict[str, Any]) -> str:
        stable = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return sha256(f"{kind}:{stable}".encode("utf-8")).hexdigest()

