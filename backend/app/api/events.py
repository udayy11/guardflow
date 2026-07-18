import anyio.from_thread

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.logger import logger
from app.database.database import get_db
from app.schemas.event_schema import EventRequest, EventResponse
from app.services.event_processor import EventProcessor
from app.repositories.event_repository import EventRepository
from app.websocket.connection_manager import manager

router = APIRouter(prefix="/events", tags=["events"])

# Event types that carry a URL worth having the browser extension inspect.
URL_ANALYSIS_EVENT_TYPES = {"LINK_CLICKED", "WEBSITE_OPENED","APP_OPENED"}


@router.post(
    "",
    response_model=EventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Process an event",
    responses={
        201: {"description": "Event processed successfully"},
        400: {"description": "Invalid request data"},
        500: {"description": "Internal processing error"},
    },
)
def create_event(
    event_data: EventRequest,
    db: Session = Depends(get_db),
) -> EventResponse:
    """Endpoint for submitting system events.
    
    Args:
        event_data: Validated event payload
        db: Database session dependency
        
    Returns:
        Standardized response with processing status
    """
    processor = EventProcessor(EventRepository(db))
    result = processor.process_event(event_data)

    if result.status == "error":
        # process_event() already logs and swallows the underlying exception,
        # returning an error-shaped EventResponse rather than raising - surface
        # that as a real error status instead of always returning 201.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result.message or "Event processing failed",
        )

    # Notify the browser extension if this event carries a URL worth
    # inspecting. Best-effort and non-blocking for the caller: if no
    # extension is connected, send_analyze_url() just returns False.
    event_type = (event_data.event_type or "").upper()
    if event_type in URL_ANALYSIS_EVENT_TYPES:
        url = (event_data.payload or {}).get("url")
        if url:
            try:
                anyio.from_thread.run(manager.send_analyze_url, url, event_data.session_id)
            except Exception as e:
                # Never let a WS-dispatch failure turn an already-persisted
                # event into an error response for Android.
                logger.warning(f"Failed to dispatch ANALYZE_URL for session {event_data.session_id}: {e}")

    return result