"""Normalize GuardFlow's stored events into deterministic scoring features.

The browser extension already performs DOM extraction and detector work.  This
module only reads that structured PAGE_ANALYSIS payload; it never re-scrapes a
page or repeats extension detector logic.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import urlparse


PAYMENT_STARTED_TYPES = {"PAYMENT_STARTED", "PAYMENT_INITIATED"}
PAYMENT_CONFIRMED_TYPES = {"PAYMENT_COMPLETED", "PAYMENT_CONFIRMED"}
PAYMENT_EVENT_TYPES = PAYMENT_STARTED_TYPES | PAYMENT_CONFIRMED_TYPES

BEHAVIOUR_EVENT_TYPES = {
    "LINK_CLICKED",
    "WEBSITE_OPENED",
    "APP_OPENED",
    "APP_SWITCHED",
    "PAYMENT_APP_OPENED",
    "CALL_STARTED",
    "CALL_ACTIVE",
    "SCREEN_SHARE_STARTED",
    "SCREEN_SHARING_STARTED",
} | PAYMENT_EVENT_TYPES


class FeatureExtractor:
    """Extract objective URL, content, behaviour, and transaction features."""

    recent_window = timedelta(minutes=10)
    website_to_payment_window = timedelta(minutes=5)

    def extract(
        self,
        page_analysis: dict[str, Any] | None,
        events: Iterable[Any] | None,
    ) -> dict[str, Any]:
        ordered_events = sorted(list(events or []), key=self._event_time)
        payload = page_analysis if isinstance(page_analysis, dict) else {}
        if not payload:
            # The extension may still be analyzing when Android requests a
            # score. Preserve a URL-only deterministic fallback without
            # attempting any backend web scraping.
            for event in reversed(ordered_events):
                if self._event_type(event) in {"LINK_CLICKED", "WEBSITE_OPENED"}:
                    fallback_url = self._text(self._payload(event).get("url"))
                    if fallback_url:
                        payload = {"url": fallback_url}
                        break
        signals = self._dict(payload.get("signals"))

        url_features = self._extract_url_features(payload, signals)
        content_features = self._extract_content_features(signals)
        behaviour_features = self._extract_behaviour_features(ordered_events)
        transaction_features = self._extract_transaction_features(ordered_events)

        return {
            "url_features": url_features,
            "content_features": content_features,
            "behaviour_features": behaviour_features,
            "transaction_features": transaction_features,
            # No genuine reputation provider is connected yet. None means
            # unavailable; it must never be interpreted as a trusted score of 0.
            "domain_reputation": None,
            "availability": {
                "url_features": bool(url_features.get("url")),
                "website_content": bool(signals),
                "domain_reputation": False,
                "behaviour": behaviour_features["available"],
                "transaction": transaction_features["available"],
            },
        }

    def _extract_url_features(
        self,
        payload: dict[str, Any],
        signals: dict[str, Any],
    ) -> dict[str, Any]:
        detector = self._dict(signals.get("detector_findings"))
        analysis = self._dict(detector.get("url_analysis"))
        components = self._dict(analysis.get("components"))
        observations = self._dict(analysis.get("observations"))

        # signals.url is window.location.href and therefore represents the
        # page actually loaded after redirects. The outer URL is only the URL
        # originally requested by Android/backend.
        url = self._text(signals.get("url")) or self._text(payload.get("url"))
        parsed = self._parse_url(url)
        explicit_scheme = (components.get("protocol") or parsed.scheme or "").lower()

        https: bool | None
        if explicit_scheme == "https":
            https = True
        elif explicit_scheme == "http":
            https = False
        else:
            https = None

        return {
            "url": url,
            "domain": self._text(signals.get("domain"))
            or self._text(components.get("hostname"))
            or parsed.hostname,
            "https": https,
            "url_length": self._integer(observations.get("url_length"), len(url)),
            "is_ip_address": self._boolean(observations.get("is_ip_address_url")),
            "is_punycode": self._boolean(observations.get("is_punycode")),
            "suspicious_tld": self._boolean(observations.get("has_suspicious_tld")),
            "excessive_hyphens": self._boolean(observations.get("has_excessive_hyphens")),
            "is_shortener": self._boolean(observations.get("is_url_shortener")),
            "query_parameter_count": self._integer(observations.get("query_parameter_count")),
            "subdomain_depth": self._integer(observations.get("subdomain_depth")),
            "special_character_count": self._integer(observations.get("special_character_count")),
        }

    def _extract_content_features(self, signals: dict[str, Any]) -> dict[str, Any]:
        detector = self._dict(signals.get("detector_findings"))
        summary = self._dict(signals.get("summary"))

        keywords = self._dict(detector.get("scam_keywords"))
        countdown = self._dict(detector.get("countdown_timers"))
        payment = self._dict(detector.get("payment_signals"))
        if not payment:
            payment = self._dict(detector.get("registration_fee_requests"))
        qr = self._dict(detector.get("qr_candidates"))
        buttons = self._dict(detector.get("buttons"))
        link_analysis = self._dict(detector.get("link_analysis"))
        link_summary = self._dict(link_analysis.get("summary"))
        government = self._list(detector.get("government_references"))
        classified_forms = self._list(detector.get("form_field_classification"))

        sensitive_form_count = sum(
            1 for form in classified_forms if self._dict(form).get("has_sensitive_fields") is True
        )
        sensitive_field_count = sum(
            self._integer(self._dict(form).get("sensitive_field_count"))
            for form in classified_forms
        )

        registration_requests = self._list(payment.get("registration_fee_requests"))
        upi_mentions = self._list(payment.get("upi_mentions"))
        qr_prompts = self._list(payment.get("qr_payment_prompts"))
        amount_mentions = self._list(payment.get("amount_mentions"))
        payment_buttons = self._list(buttons.get("payment_buttons"))

        return {
            "matched_keywords": [self._text(item) for item in self._list(keywords.get("matched_keywords"))[:10]],
            "scam_keyword_count": self._integer(keywords.get("keyword_count")),
            "scam_keyword_occurrences": self._integer(
                keywords.get("total_keyword_occurences"),
                self._integer(keywords.get("total_keyword_occurrences")),
            ),
            "countdown_detected": self._boolean(countdown.get("detected")),
            "registration_fee_detected": bool(registration_requests),
            "registration_fee_count": len(registration_requests),
            "upi_detected": bool(upi_mentions),
            "upi_mention_count": len(upi_mentions),
            "qr_payment_prompt": bool(qr_prompts),
            "qr_present": self._boolean(qr.get("qr_present")),
            "amount_mention_count": len(amount_mentions),
            "government_reference_count": len(government),
            "sensitive_form_count": sensitive_form_count,
            "sensitive_field_count": sensitive_field_count,
            "password_field_count": self._integer(
                summary.get("password_field_count"),
                self._integer(signals.get("password_fields")),
            ),
            "payment_button_count": len(payment_buttons),
            "shortened_link_count": self._integer(link_summary.get("shortenedUrlCount")),
            "suspicious_domain_count": self._integer(link_summary.get("suspiciousDomainCount")),
            "text_href_mismatch_count": self._integer(link_summary.get("textHrefMismatchCount")),
        }

    def _extract_behaviour_features(self, events: list[Any]) -> dict[str, Any]:
        relevant = [event for event in events if self._event_type(event) in BEHAVIOUR_EVENT_TYPES]
        if not relevant:
            return {
                "available": False,
                "recent_event_count": 0,
                "rapid_link_count": 0,
                "unique_url_count": 0,
                "app_switch_count": 0,
                "payment_attempt_count": 0,
                "screen_share_during_payment": False,
                "call_during_payment": False,
                "website_to_payment_flow": False,
            }

        latest_time = max(self._event_time(event) for event in relevant)
        cutoff = latest_time - self.recent_window
        recent = [event for event in relevant if self._event_time(event) >= cutoff]

        link_events = [event for event in recent if self._event_type(event) == "LINK_CLICKED"]
        urls = {
            self._text(self._payload(event).get("url"))
            for event in recent
            if self._text(self._payload(event).get("url"))
        }
        app_switch_count = sum(
            self._event_type(event) in {"APP_OPENED", "APP_SWITCHED", "PAYMENT_APP_OPENED"}
            for event in recent
        )
        payment_events = [event for event in recent if self._event_type(event) in PAYMENT_EVENT_TYPES]
        started_count = sum(self._event_type(event) in PAYMENT_STARTED_TYPES for event in payment_events)
        confirmed_count = sum(self._event_type(event) in PAYMENT_CONFIRMED_TYPES for event in payment_events)
        screen_share = any(
            self._event_type(event) in {"SCREEN_SHARE_STARTED", "SCREEN_SHARING_STARTED"}
            for event in recent
        )
        call_active = any(
            self._event_type(event) in {"CALL_STARTED", "CALL_ACTIVE"} for event in recent
        )

        website_times = [
            self._event_time(event)
            for event in recent
            if self._event_type(event) in {"LINK_CLICKED", "WEBSITE_OPENED"}
        ]
        payment_times = [self._event_time(event) for event in payment_events]
        website_to_payment = any(
            timedelta(0) <= payment_time - website_time <= self.website_to_payment_window
            for website_time in website_times
            for payment_time in payment_times
        )

        return {
            "available": True,
            "recent_event_count": len(recent),
            "rapid_link_count": len(link_events),
            "unique_url_count": len(urls),
            "app_switch_count": app_switch_count,
            # Initiated and confirmed are normally two states of the same
            # payment, not two separate attempts.
            "payment_attempt_count": max(started_count, confirmed_count),
            "screen_share_during_payment": bool(screen_share and payment_events),
            "call_during_payment": bool(call_active and payment_events),
            "website_to_payment_flow": website_to_payment,
        }

    def _extract_transaction_features(self, events: list[Any]) -> dict[str, Any]:
        payments = [event for event in events if self._event_type(event) in PAYMENT_EVENT_TYPES]
        if not payments:
            return {
                "available": False,
                "amount": None,
                "receiver": None,
                "receiver_present": None,
                "payment_started": False,
                "payment_confirmed": False,
                "attempt_count": 0,
            }

        latest = payments[-1]
        payload = self._payload(latest)
        amount = self._number_from_keys(payload, "amount", "transaction_amount", "payment_amount")
        receiver = self._text_from_keys(
            payload,
            "receiver",
            "receiver_name",
            "upi_id",
            "payee",
            "recipient",
        )
        # Confirmation events may contain only a status. Reuse the newest
        # amount/receiver present in the same payment flow when necessary.
        for event in reversed(payments[:-1]):
            earlier_payload = self._payload(event)
            if amount is None:
                amount = self._number_from_keys(
                    earlier_payload,
                    "amount",
                    "transaction_amount",
                    "payment_amount",
                )
            if not receiver:
                receiver = self._text_from_keys(
                    earlier_payload,
                    "receiver",
                    "receiver_name",
                    "upi_id",
                    "payee",
                    "recipient",
                )
            if amount is not None and receiver:
                break

        started_count = sum(self._event_type(event) in PAYMENT_STARTED_TYPES for event in payments)
        confirmed_count = sum(self._event_type(event) in PAYMENT_CONFIRMED_TYPES for event in payments)

        return {
            "available": True,
            "amount": amount,
            "receiver": receiver or None,
            "receiver_present": bool(receiver),
            "payment_started": any(self._event_type(event) in PAYMENT_STARTED_TYPES for event in payments),
            "payment_confirmed": any(self._event_type(event) in PAYMENT_CONFIRMED_TYPES for event in payments),
            "attempt_count": max(started_count, confirmed_count),
        }

    @staticmethod
    def _dict(value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _list(value: Any) -> list[Any]:
        return value if isinstance(value, list) else []

    @staticmethod
    def _text(value: Any) -> str:
        return str(value).strip() if value is not None else ""

    @classmethod
    def _text_from_keys(cls, payload: dict[str, Any], *keys: str) -> str:
        for key in keys:
            value = payload.get(key)
            if isinstance(value, dict):
                value = value.get("name") or value.get("id") or value.get("upi_id")
            text = cls._text(value)
            if text:
                return text
        return ""

    @staticmethod
    def _boolean(value: Any) -> bool:
        return value is True

    @staticmethod
    def _integer(value: Any, default: int = 0) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return max(0, int(default))

    @classmethod
    def _number_from_keys(cls, payload: dict[str, Any], *keys: str) -> float | None:
        for key in keys:
            value = payload.get(key)
            if value is None:
                continue
            if isinstance(value, (int, float)):
                return max(0.0, float(value))
            cleaned = "".join(char for char in str(value) if char.isdigit() or char == ".")
            try:
                return max(0.0, float(cleaned))
            except ValueError:
                continue
        return None

    @staticmethod
    def _payload(event: Any) -> dict[str, Any]:
        payload = getattr(event, "payload", {}) or {}
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _event_type(event: Any) -> str:
        return str(getattr(event, "event_type", "") or "").upper()

    @staticmethod
    def _event_time(event: Any) -> datetime:
        value = getattr(event, "timestamp", None) or getattr(event, "created_at", None)
        if not isinstance(value, datetime):
            return datetime.min.replace(tzinfo=timezone.utc)
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @staticmethod
    def _parse_url(url: str):
        if not url:
            return urlparse("")
        return urlparse(url if "://" in url else f"//{url}")
