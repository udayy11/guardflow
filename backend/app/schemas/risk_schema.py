from typing import List, Literal
from pydantic import BaseModel, Field, field_validator

class RiskResponse(BaseModel):
    """Risk assessment response matching Android client expectations.
    
    Attributes:
        score: Numeric risk valuation (0-100)
        level: Categorical risk classification
        confidence: Assessment certainty percentage (0-100)
        triggered_rules: List of rule IDs that contributed to the score
        requires_physical_confirmation: Whether human approval needed
    """

    score: int = Field(..., ge=0, le=100, examples=[95])
    level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(..., examples=["HIGH"])
    confidence: int = Field(..., gt=0, le=100, examples=[96])
    triggered_rules: List[str] = Field(default_factory=list)
    requires_physical_confirmation: bool = Field(default=False)

    @field_validator('triggered_rules')
    def validate_rule_ids(cls, value: List[str]) -> List[str]:
        """Ensure rule IDs are non-empty strings."""
        if any(not rule_id for rule_id in value):
            raise ValueError("rule IDs cannot be empty")
        return value