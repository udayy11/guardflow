from app.core.logger import logger
from app.repositories.event_repository import EventRepository
from app.schemas.event_schema import EventRequest, EventResponse
from app.models.event import Event


class EventProcessor:
    """Pure event ingestion service.

    Responsibility is intentionally limited to: validate (already done by
    the Pydantic schema before this is called) -> persist -> return status.

    No scoring, website analysis, or correlation happens here. All risk
    calculation lives exclusively in the /score/{session_id} endpoint
    (app/api/risk.py), which is the single source of truth for scoring.
    """

    def __init__(self, event_repository: EventRepository):
        self.event_repository = event_repository

    def process_event(self, event_data: EventRequest) -> EventResponse:
        """Persist an incoming event.

        Args:
            event_data: Validated incoming event data

        Returns:
            Standardized response indicating processing status
        """
        try:
            # Convert to ORM model
            event = Event(
                id=event_data.event_id,
                session_id=event_data.session_id,
                event_type=event_data.event_type,
                source_app=event_data.source_app,
                timestamp=event_data.timestamp,
                payload=event_data.payload,
            )

            # Persist event
            saved_event = self.event_repository.save(event)
            logger.info(f"Processed event {saved_event.event_type} for session {saved_event.session_id}")

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
