"""GuardFlow's single deterministic and explainable scoring authority."""

from __future__ import annotations

from typing import Any, Callable


Rule = tuple[str, int, str, Callable[[dict[str, Any]], bool]]


class RiskEngine:
    """Calculate component scores, correlations, confidence, and final risk."""

    CATEGORY_WEIGHTS = {
        "url_features": 0.30,
        "website_content": 0.30,
        "domain_reputation": 0.20,
        "behaviour": 0.10,
        "transaction": 0.10,
    }

    URL_RULES: tuple[Rule, ...] = (
        ("url.explicit_http", 20, "The page explicitly uses HTTP", lambda c: c["observations"].get("explicit_http", False)),
        ("url.ip_address", 30, "The URL uses a raw IP address", lambda c: c["url"].get("is_ip_address", False)),
        ("url.punycode", 25, "The URL contains punycode", lambda c: c["url"].get("is_punycode", False)),
        ("url.suspicious_tld", 15, "The URL uses a watched high-abuse TLD", lambda c: c["url"].get("suspicious_tld", False)),
        ("url.shortener", 15, "The URL uses a shortening service", lambda c: c["url"].get("is_shortener", False)),
        ("url.excessive_hyphens", 10, "The hostname has excessive hyphenation", lambda c: c["url"].get("excessive_hyphens", False)),
        ("url.unusually_long", 10, "The URL is unusually long", lambda c: (c["url"].get("url_length") or 0) >= 100),
        ("url.deep_subdomain", 10, "The hostname has unusually deep subdomains", lambda c: (c["url"].get("subdomain_depth") or 0) >= 4),
        ("url.excessive_query", 5, "The URL contains many query parameters", lambda c: (c["url"].get("query_parameter_count") or 0) >= 8),
    )

    CONTENT_RULES: tuple[Rule, ...] = (
        ("content.registration_fee", 30, "Registration-fee language was detected", lambda c: c["observations"].get("registration_fee_request", False)),
        ("content.credential_collection", 25, "Sensitive credential fields were detected", lambda c: c["observations"].get("credential_collection", False)),
        ("content.social_engineering", 20, "Multiple social-engineering signals occur together", lambda c: c["observations"].get("social_engineering_pattern", False)),
        ("content.urgency", 15, "Countdown or urgency language was detected", lambda c: c["observations"].get("urgency_language", False)),
        ("content.qr_payment", 15, "QR evidence occurs with payment language", lambda c: c["observations"].get("qr_payment_request", False)),
        ("content.keyword_cluster", 15, "A cluster of scam-adjacent keywords was detected", lambda c: c["observations"].get("high_risk_keyword_cluster", False)),
        ("content.suspicious_links", 10, "Suspicious link characteristics were detected", lambda c: c["observations"].get("suspicious_link_pattern", False)),
        ("content.upi_request", 10, "UPI payment language was detected", lambda c: c["content"].get("upi_detected", False)),
        ("content.government_reference", 5, "Government-related references were detected", lambda c: c["observations"].get("government_reference", False)),
        # Ordinary payment content is weak evidence because legitimate stores
        # also contain it; stronger payment combinations are scored above.
        ("content.payment_request", 5, "A payment request was detected on the page", lambda c: c["observations"].get("payment_request", False)),
    )

    BEHAVIOUR_RULES: tuple[Rule, ...] = (
        ("behaviour.rapid_linking", 25, "Many links were followed in a short window", lambda c: (c["behaviour"].get("rapid_link_count") or 0) >= 10),
        ("behaviour.link_burst", 10, "Several links were followed in a short window", lambda c: 5 <= (c["behaviour"].get("rapid_link_count") or 0) < 10),
        ("behaviour.many_destinations", 20, "Many distinct websites appeared in the recent flow", lambda c: (c["behaviour"].get("unique_url_count") or 0) >= 8),
        ("behaviour.app_switching", 10, "Frequent app switching was detected", lambda c: (c["behaviour"].get("app_switch_count") or 0) >= 5),
        ("behaviour.repeated_payments", 25, "Repeated payment attempts were detected", lambda c: (c["behaviour"].get("payment_attempt_count") or 0) >= 3),
        ("behaviour.screen_share_payment", 35, "Screen sharing occurred during a payment flow", lambda c: c["behaviour"].get("screen_share_during_payment", False)),
        ("behaviour.call_payment", 25, "A call was active during a payment flow", lambda c: c["behaviour"].get("call_during_payment", False)),
        ("behaviour.website_to_payment", 10, "A website visit was followed quickly by payment", lambda c: c["behaviour"].get("website_to_payment_flow", False)),
    )

    TRANSACTION_RULES: tuple[Rule, ...] = (
        ("transaction.very_large_amount", 25, "The payment amount is very large", lambda c: (c["transaction"].get("amount") or 0) >= 100_000),
        ("transaction.large_amount", 15, "The payment amount is large", lambda c: 25_000 <= (c["transaction"].get("amount") or 0) < 100_000),
        ("transaction.moderate_amount", 8, "The payment amount is notable", lambda c: 5_000 <= (c["transaction"].get("amount") or 0) < 25_000),
        ("transaction.receiver_missing", 20, "Receiver information is unavailable", lambda c: c["transaction"].get("available", False) and c["transaction"].get("receiver_present") is False),
        ("transaction.repeated_attempts", 20, "Multiple payment events occurred", lambda c: (c["transaction"].get("attempt_count") or 0) >= 3),
    )

    def calculate(
        self,
        features: dict[str, Any],
        website_analysis: dict[str, Any],
    ) -> dict[str, Any]:
        context = {
            "url": features.get("url_features") or {},
            "content": features.get("content_features") or {},
            "behaviour": features.get("behaviour_features") or {},
            "transaction": features.get("transaction_features") or {},
            "observations": website_analysis.get("observations") or {},
        }

        url_score, url_rules, url_evidence = self._apply_rules(self.URL_RULES, context)
        content_score, content_rules, content_evidence = self._apply_rules(self.CONTENT_RULES, context)
        behaviour_score, behaviour_rules, behaviour_evidence = self._apply_rules(self.BEHAVIOUR_RULES, context)
        transaction_score, transaction_rules, transaction_evidence = self._apply_rules(self.TRANSACTION_RULES, context)

        component_scores: dict[str, int | None] = {
            "url_features": url_score,
            "website_content": content_score,
            "domain_reputation": None,
            "behaviour": behaviour_score,
            "transaction": transaction_score,
        }
        availability = features.get("availability") or {}
        base_score = self._weighted_score(component_scores, availability)
        correlation_bonus, correlation_rules, correlation_evidence = self._correlations(
            context,
            component_scores,
        )
        overall = int(round(min(100.0, base_score + correlation_bonus)))
        level = self._risk_level(overall)

        triggered_rules = (
            url_rules
            + content_rules
            + behaviour_rules
            + transaction_rules
            + correlation_rules
        )
        evidence = self._deduplicate(
            list(website_analysis.get("evidence") or [])
            + url_evidence
            + content_evidence
            + behaviour_evidence
            + transaction_evidence
            + correlation_evidence
        )

        return {
            "risk_score": overall,
            "overall_score": overall,
            "risk_level": level,
            "confidence": self._confidence(availability),
            "component_scores": component_scores,
            "correlation_bonus": correlation_bonus,
            "triggered_rules": triggered_rules,
            "evidence": evidence[:15],
            "recommendations": self._recommendations(level, triggered_rules),
            "requires_physical_confirmation": level in {"HIGH", "CRITICAL"},
        }

    @staticmethod
    def _apply_rules(rules: tuple[Rule, ...], context: dict[str, Any]) -> tuple[int, list[str], list[str]]:
        score = 0
        rule_ids: list[str] = []
        evidence: list[str] = []
        for rule_id, points, description, condition in rules:
            if condition(context):
                score += points
                rule_ids.append(rule_id)
                evidence.append(description)
        return min(100, score), rule_ids, evidence

    def _weighted_score(
        self,
        scores: dict[str, int | None],
        availability: dict[str, bool],
    ) -> float:
        weighted_total = 0.0
        available_weight = 0.0
        for category, weight in self.CATEGORY_WEIGHTS.items():
            score = scores.get(category)
            if availability.get(category, False) and score is not None:
                weighted_total += float(score) * weight
                available_weight += weight
        return weighted_total / available_weight if available_weight else 0.0

    @staticmethod
    def _correlations(
        context: dict[str, Any],
        scores: dict[str, int | None],
    ) -> tuple[int, list[str], list[str]]:
        observations = context["observations"]
        behaviour = context["behaviour"]
        transaction = context["transaction"]
        candidates: list[tuple[str, int, str, bool]] = [
            (
                "correlation.suspicious_url_credentials",
                12,
                "Suspicious URL characteristics occur with credential collection",
                observations.get("suspicious_url_structure", False)
                and observations.get("credential_collection", False),
            ),
            (
                "correlation.registration_fee_payment",
                12,
                "A registration-fee request occurs in an active payment flow",
                observations.get("registration_fee_request", False)
                and transaction.get("available", False),
            ),
            (
                "correlation.social_engineering_payment",
                10,
                "Social-engineering indicators occur in an active payment flow",
                observations.get("social_engineering_pattern", False)
                and transaction.get("available", False),
            ),
            (
                "correlation.high_risk_page_payment",
                10,
                "High-risk website content occurs with a payment event",
                (scores.get("website_content") or 0) >= 60
                and transaction.get("available", False),
            ),
            (
                "correlation.screen_share_payment",
                15,
                "Screen sharing and payment activity occur together",
                behaviour.get("screen_share_during_payment", False),
            ),
        ]

        active = [item for item in candidates if item[3]]
        bonus = min(15, sum(item[1] for item in active))
        return bonus, [item[0] for item in active], [item[2] for item in active]

    @staticmethod
    def _confidence(availability: dict[str, bool]) -> int:
        confidence = 35
        confidence += 15 if availability.get("url_features") else 0
        confidence += 20 if availability.get("website_content") else 0
        confidence += 10 if availability.get("behaviour") else 0
        confidence += 10 if availability.get("transaction") else 0
        confidence += 10 if availability.get("domain_reputation") else 0
        return max(20, min(95, confidence))

    @staticmethod
    def _risk_level(score: int) -> str:
        if score >= 85:
            return "CRITICAL"
        if score >= 60:
            return "HIGH"
        if score >= 30:
            return "MEDIUM"
        return "LOW"

    @staticmethod
    def _recommendations(level: str, rule_ids: list[str]) -> list[str]:
        recommendations: list[str] = []
        if level in {"HIGH", "CRITICAL"}:
            recommendations.append("Pause the payment and verify the website and receiver independently")
        elif level == "MEDIUM":
            recommendations.append("Verify the domain and payment request before continuing")

        if any(rule.startswith("content.credential") for rule in rule_ids):
            recommendations.append("Do not enter passwords, OTPs, PINs, or banking details")
        if any("receiver_missing" in rule for rule in rule_ids):
            recommendations.append("Confirm the receiver identity through a trusted channel")
        if any("screen_share" in rule or "call_payment" in rule for rule in rule_ids):
            recommendations.append("Stop screen sharing or the call before opening a payment application")
        if not recommendations:
            recommendations.append("No strong fraud indicators were detected; continue normal verification")
        return recommendations[:4]

    @staticmethod
    def _deduplicate(items: list[Any]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for item in items:
            text = str(item).strip()
            if text and text not in seen:
                result.append(text)
                seen.add(text)
        return result

