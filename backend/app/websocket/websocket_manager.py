from pydantic import ValidationError

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.logger import logger
from app.database.database import get_db_context
from app.repositories.event_repository import EventRepository
from app.schemas.event_schema import EventRequest
from app.services.event_processor import EventProcessor
from app.websocket.connection_manager import manager

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):

    await manager.connect(websocket)

    logger.info("WebSocket client connected")

    try:

        while True:

            data = await websocket.receive_json()

            logger.debug(f"WebSocket message received: {data}")

            try:
                event_data = EventRequest.model_validate(data)
            except ValidationError as e:
                # Don't crash the connection on a malformed message - report
                # it back to the client and keep listening.
                logger.warning(f"Invalid event payload over websocket: {e}")
                await manager.send_personal_message(
                    {"status": "error", "message": "Invalid event payload"},
                    websocket,
                )
                continue

            with get_db_context() as db:
                processor = EventProcessor(EventRepository(db))
                result = processor.process_event(event_data)

            await manager.send_personal_message(
                result.model_dump(),
                websocket,
            )

    except WebSocketDisconnect:

        manager.disconnect(websocket)

        logger.info("Disconnected")