from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import String, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database.base import Base

class Session(Base):
    """SQLAlchemy ORM model representing user/system interaction sessions.
    
    Attributes:
        id: Primary key UUID as string
        started_at: Timestamp when session began (auto-generated)
        ended_at: Timestamp when session concluded (nullable)
        status: Current state of the session
        current_risk_score: Numeric risk assessment
        current_risk_level: Categorized risk state
    """

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    current_risk_score: Mapped[int] = mapped_column(Integer, default=0)
    current_risk_level: Mapped[str] = mapped_column(String(20), default="SAFE")