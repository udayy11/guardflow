from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database.base import Base

class RiskAssessment(Base):
    """Risk assessment model for tracking security evaluations.
    
    Attributes:
        id: Primary key UUID
        session_id: Associated session (FK)
        score: Numeric risk valuation (0-100)
        level: Risk category (low/medium/high/critical)
        confidence: Scoring certainty percentage (0-100)
        triggered_rules: JSON array of rule IDs that fired
        requires_physical_confirmation: Whether human approval needed
        created_at: Assessment timestamp
    """

    __tablename__ = "risk_assessments"
    __table_args__ = (
        Index("ix_risk_assessments_session_id", "session_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.id"))
    score: Mapped[float]
    level: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[float]
    triggered_rules: Mapped[list[str]] = mapped_column(JSON)
    requires_physical_confirmation: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    def __repr__(self):
        return f"<RiskAssessment {self.score}/{self.level} (session:{self.session_id})>"