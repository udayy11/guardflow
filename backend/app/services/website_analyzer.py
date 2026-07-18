"""Deterministic interpretation of normalized website observations."""

from __future__ import annotations

from typing import Any


class WebsiteAnalyzer:
    """Derive explainable website observations without producing a score."""

    def analyze(self, features: dict[str, Any]) -> dict[str, Any]:
        url = features.get("url_features") or {}
        content = features.get("content_features") or {}

        suspicious_url = any(
            (
                url.get("is_ip_address"),
                url.get("is_punycode"),
                url.get("suspicious_tld"),
                url.get("excessive_hyphens"),
                url.get("is_shortener"),
                (url.get("url_length") or 0) >= 100,
            )
        )
        credential_collection = any(
            (
                (content.get("sensitive_form_count") or 0) > 0,
                (content.get("sensitive_field_count") or 0) > 0,
                (content.get("password_field_count") or 0) > 0,
            )
        )
        payment_request = any(
            (
                content.get("registration_fee_detected"),
                content.get("upi_detected"),
                content.get("qr_payment_prompt"),
                (content.get("payment_button_count") or 0) > 0,
            )
        )
        urgency = bool(content.get("countdown_detected"))
        government_claim = (content.get("government_reference_count") or 0) > 0
        keyword_cluster = (
            (content.get("scam_keyword_count") or 0) >= 3
            or (content.get("scam_keyword_occurrences") or 0) >= 5
        )
        qr_payment_request = bool(
            content.get("qr_present")
            and (content.get("qr_payment_prompt") or content.get("upi_detected"))
        )
        suspicious_links = any(
            (
                (content.get("shortened_link_count") or 0) > 0,
                (content.get("suspicious_domain_count") or 0) > 0,
                (content.get("text_href_mismatch_count") or 0) > 0,
            )
        )
        social_engineering = any(
            (
                urgency and payment_request,
                government_claim and credential_collection,
                content.get("registration_fee_detected") and keyword_cluster,
            )
        )

        observations = {
            "explicit_http": url.get("https") is False,
            "suspicious_url_structure": suspicious_url,
            "credential_collection": credential_collection,
            "payment_request": payment_request,
            "registration_fee_request": bool(content.get("registration_fee_detected")),
            "urgency_language": urgency,
            "government_reference": government_claim,
            "qr_payment_request": qr_payment_request,
            "high_risk_keyword_cluster": keyword_cluster,
            "suspicious_link_pattern": suspicious_links,
            "social_engineering_pattern": social_engineering,
        }

        return {
            "observations": observations,
            "evidence": self._build_evidence(url, content, observations),
        }

    def _build_evidence(
        self,
        url: dict[str, Any],
        content: dict[str, Any],
        observations: dict[str, bool],
    ) -> list[str]:
        evidence: list[str] = []

        if observations["explicit_http"]:
            evidence.append("The analyzed page explicitly uses HTTP instead of HTTPS")
        if url.get("is_ip_address"):
            evidence.append("The URL uses a raw IP address")
        if url.get("is_punycode"):
            evidence.append("The hostname contains punycode")
        if url.get("suspicious_tld"):
            evidence.append("The URL uses a watched high-abuse TLD")
        if content.get("registration_fee_detected"):
            evidence.append("Registration-fee language was detected")
        if content.get("upi_detected"):
            evidence.append("UPI payment language or an identifier was detected")
        if observations["qr_payment_request"]:
            evidence.append("QR evidence appears together with payment language")
        if observations["credential_collection"]:
            evidence.append("The page requests sensitive or credential-related fields")
        if observations["urgency_language"]:
            evidence.append("Countdown or urgency language was detected")
        if observations["government_reference"]:
            evidence.append("Government-related references were detected")
        if observations["suspicious_link_pattern"]:
            evidence.append("Suspicious link characteristics were detected")

        matched = [str(item) for item in content.get("matched_keywords", []) if item]
        if matched:
            evidence.append(f"Matched page keywords: {', '.join(matched[:5])}")

        return evidence[:12]

