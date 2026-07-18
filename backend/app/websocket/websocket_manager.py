from datetime import datetime, timezone

from pydantic import ValidationError

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.logger import logger
from app.database.database import get_db_context
from app.models.event import Event
from app.repositories.event_repository import EventRepository
from app.schemas.event_schema import EventRequest
from app.services.event_processor import EventProcessor
from app.websocket.connection_manager import manager

router = APIRouter()


def _persist_page_analysis(data: dict) -> None:
    """Store an inbound PAGE_ANALYSIS message as an Event row.

    Persisting it through the same EventRepository/Event model the HTTP
    /events path uses means /score/{session_id} (which already iterates
    every stored event for a session) picks it up with no separate storage
    mechanism - the minimal way to make extension signals visible to the
    risk engine without introducing a new table or redesigning storage.
    """
    session_id = data.get("session_id")
    if not session_id:
        logger.warning("PAGE_ANALYSIS message missing session_id")
        return

    event = Event(
        session_id=session_id,
        event_type="PAGE_ANALYSIS",
        source_app="browser_extension",
        timestamp=datetime.now(timezone.utc),
        payload={
            "url": data.get("url"),
            "signals": data.get("signals"),
        },
    )
    with get_db_context() as db:
        EventRepository(db).save(event)
    logger.info(f"Stored PAGE_ANALYSIS for session {session_id} (url={data.get('url')})")


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected")
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception as e:
                # Malformed/non-JSON frame from the client - drop this one
                # message and keep the connection alive rather than tearing
                # down the whole socket over a single bad frame.
                logger.warning(f"Failed to parse websocket message: {e}")
                continue

            message_type = data.get("type")

            # Extension identifies itself so the backend knows which
            # connection can receive ANALYZE_URL dispatches.
            if message_type == "REGISTER_EXTENSION":
                if data.get("client") == "browser_extension":
                    await manager.register_extension(websocket)
                    await websocket.send_json({
                        "type": "REGISTERED",
                        "status": "success"
                    })
                else:
                    logger.warning(f"REGISTER_EXTENSION from unrecognized client: {data.get('client')!r}")
                continue

            # Signals extracted by the extension for a previously-requested
            # ANALYZE_URL. Persisted as an event and consumed by
            # the deterministic scoring pipeline in app/api/risk.py.
            if message_type == "PAGE_ANALYSIS":
                _persist_page_analysis(data)
                continue

            if message_type == "PAGE_ANALYSIS_ERROR":
                logger.warning(f"Extension reported analysis error for session {data.get('session_id')}: {data.get('error')}")
                continue

            if message_type == "HEARTBEAT":
                await websocket.send_json({"type": "HEARTBEAT"})
                continue

            if message_type == "ERROR":
                logger.warning(f"Extension reported error for session {data.get('session_id')}: {data.get('error')}")
                continue

            # Fallback: legacy path for a raw EventRequest sent directly
            # over this socket (not currently used by Android, which posts
            # via HTTP, but kept for backward compatibility).
            try:
                event_data = EventRequest(**data)
            except ValidationError as e:
                logger.warning(f"Unrecognized/invalid websocket message type={message_type!r}: {e}")
                continue

            with get_db_context() as db:
                processor = EventProcessor(EventRepository(db))
                processor.process_event(event_data)

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        # Any other failure (e.g. a send on a half-closed socket) should
        # still release the extension slot instead of leaving a dead
        # connection registered until the process restarts.
        logger.error(f"WebSocket connection terminated unexpectedly: {e}")
    finally:
        if manager.get_extension() == websocket:
            await manager.remove_extension()
