from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from pydantic import BaseModel, field_validator, Field

class EventRequest(BaseModel):
    """Pydantic model representing an event payload from Android client.

    Matches exactly with the Android app's JSON contract.

    Attributes:
        event_id: Unique string identifier for the event
        session_id: Session identifier string
        event_type: Type/category of the event
        timestamp: ISO 8601 formatted datetime string
        source_app: Name of the originating application
        payload: Dictionary containing event-specific data
    """
    event_id: str = Field(..., min_length=1)
    session_id: str = Field(..., min_length=1)
    event_type: str = Field(..., min_length=1)
    timestamp: datetime
    source_app: str = Field(..., min_length=1)
    payload: dict = Field(default_factory=dict)

    @field_validator('timestamp')
    def validate_timestamp_not_future(cls, value: datetime) -> datetime:
        """Ensure the event timestamp isn't in the future (with small clock-skew tolerance)."""
        now = datetime.now(timezone.utc)
        # Android devices report either naive or tz-aware ISO timestamps; normalize
        # to aware UTC before comparing, otherwise mixing naive/aware datetimes
        # raises TypeError instead of a clean 422 validation error.
        check_value = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        if check_value > now + timedelta(minutes=1):
            raise ValueError("timestamp cannot be in the future")
        return value

class EventResponse(BaseModel):
    """Standardized response for event processing operations.

    Attributes:
        status: Success/failure indicator
        message: Optional human-readable message
    """
    status: Literal["success", "error"]
    message: Optional[str] = None