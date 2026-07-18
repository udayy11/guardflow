from datetime import datetime
from uuid import uuid4
from typing import Dict, Any

from sqlalchemy import JSON, String, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database.base import Base

class Event(Base):
    """SQLAlchemy ORM model representing system events.
    
    Attributes:
        id: Primary key UUID as string
        session_id: Associated session identifier (indexed)
        event_type: Type/category of event (indexed)
        source_app: Originating application name
        timestamp: When event occurred in source system
        payload: Event-specific data structure
        created_at: When record was persisted in database
    """

    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_session_id", "session_id"),
        Index("ix_events_event_type", "event_type"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    session_id: Mapped[str] = mapped_column(String(255))
    event_type: Mapped[str] = mapped_column(String(100))
    source_app: Mapped[str] = mapped_column(String(100))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )