from dataclasses import dataclass, field
from typing import Sequence

from app.models.event import Event

# NOTE: This is an intentionally simple, transparent heuristic rule engine so
# that "group by session -> calculate risk -> return a score" is functional
# end-to-end for the hackathon. It is not meant to be the final fraud-detection
# logic - see README "Suggested next sprint" for where to take this next
# (weighted rules config, ML scoring, per-app rule sets, etc).

SUSPICIOUS_KEYWORDS: tuple[str, ...] = (
    "otp", "verify now", "urgent", "kyc", "refund",
    "lottery", "prize", "gift card", "upi pin", "cvv",
)

RAPID_EVENT_THRESHOLD = 5  # events in one session before we flag "high volume"


@dataclass(frozen=True)
class RiskResult:
    score: int
    level: str
    confidence: int
    triggered_rules: list[str] = field(default_factory=list)
    requires_physical_confirmation: bool = False


class RuleEngine:
    """Evaluates a session's events against a small set of heuristic rules."""

    def evaluate(self, events: Sequence[Event]) -> RiskResult:
        """Compute a risk result for all events belonging to one session."""
        if not events:
            return RiskResult(score=0, level="LOW", confidence=60, triggered_rules=[])

        triggered: list[str] = []
        score = 0

        # Rule 1: unusually high event volume in a single session
        if len(events) >= RAPID_EVENT_THRESHOLD:
            triggered.append("RULE_HIGH_EVENT_VOLUME")
            score += 20

        # Rule 2: suspicious keywords in event_type or string payload values
        haystack_parts: list[str] = []
        for event in events:
            haystack_parts.append(event.event_type.lower())
            for value in (event.payload or {}).values():
                if isinstance(value, str):
                    haystack_parts.append(value.lower())
        haystack = " ".join(haystack_parts)

        for keyword in SUSPICIOUS_KEYWORDS:
            if keyword in haystack:
                rule_id = f"RULE_KEYWORD_{keyword.upper().replace(' ', '_')}"
                triggered.append(rule_id)
                score += 15

        # Rule 3: multiple payment-related events in one session
        payment_events = [e for e in events if "payment" in e.event_type.lower()]
        if len(payment_events) >= 2:
            triggered.append("RULE_MULTIPLE_PAYMENT_EVENTS")
            score += 25

        score = min(score, 100)

        if score >= 75:
            level = "CRITICAL"
        elif score >= 50:
            level = "HIGH"
        elif score >= 25:
            level = "MEDIUM"
        else:
            level = "LOW"

        # More events observed -> more confident in the score, capped at 100.
        confidence = min(60 + min(len(events), 8) * 5, 100)

        return RiskResult(
            score=score,
            level=level,
            confidence=confidence,
            triggered_rules=triggered,
            requires_physical_confirmation=level in ("HIGH", "CRITICAL"),
        )
