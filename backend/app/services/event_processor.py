from datetime import datetime
from app.schemas.event_schema import EventRequest, EventResponse
from app.repositories.event_repository import EventRepository
from app.repositories.session_repository import SessionRepository
from app.models.event import Event
from app.core.logger import logger

class EventProcessor:
    """Enhanced event processor with session handling."""

    def __init__(
    self,
    event_repository: EventRepository,
    session_repository: SessionRepository,
    ):
        self.event_repository = event_repository
        self.session_repository = session_repository

    def process_event(self, event_data: EventRequest) -> EventResponse:
        """Process an event with session validation and creation.
        
        Args:
            event_data: Validated incoming event data

        Returns:
            Standardized response indicating processing status
        """
        try:
            # Check/Create session first
            session = self.session_repository.get_session(event_data.session_id)
            if not session:
                logger.info(f"Creating new session for {event_data.session_id}")
                self.session_repository.create_session(
                    session_id=event_data.session_id,
                    started_at=event_data.timestamp
                )

            # Process event
            event = Event(
                id=event_data.event_id,
                session_id=event_data.session_id,
                event_type=event_data.event_type,
                source_app=event_data.source_app,
                timestamp=event_data.timestamp,
                payload=event_data.payload,
            )

            saved_event = self.event_repository.save(event)
            logger.info(f"Processed event {saved_event.event_type}")

            return EventResponse(
                status="success",
                message=f"Event {saved_event.id} processed"
            )

        except Exception as e:
            logger.error(f"Event processing failed: {str(e)}")
            return EventResponse(
                status="error",
                message="Event processing failed"
            )