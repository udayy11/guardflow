from fastapi import WebSocket
from typing import Any

from app.core.logger import logger


class ConnectionManager:
    def __init__(self):
        self.active_extension: WebSocket | None = None

    async def register_extension(self, websocket: WebSocket):
        if self.active_extension is not None and self.active_extension is not websocket:
            try:
                await self.active_extension.close()
            except Exception:
                pass  # already closed/dead - fine, we're replacing it anyway
        self.active_extension = websocket

    def get_extension(self) -> WebSocket | None:
        return self.active_extension

    async def remove_extension(self):
        self.active_extension = None

    def has_extension(self) -> bool:
        return self.active_extension is not None

    async def send_analyze_url(self, url: str, session_id: str) -> bool:
        """Push an ANALYZE_URL request to the registered browser extension.

        Returns True if a message was actually sent, False if no extension
        is currently registered (e.g. it hasn't connected yet) or the send
        failed. This is best-effort by design: a missing/dead extension
        connection must never break event ingestion for Android.
        """
        if not self.has_extension():
            logger.warning(
                f"No browser extension connected - cannot dispatch ANALYZE_URL for session {session_id}"
            )
            return False

        try:
            await self.active_extension.send_json({
                "type": "ANALYZE_URL",
                "session_id": session_id,
                "url": url,
            })
            logger.info(f"Sent ANALYZE_URL to extension for session {session_id}: {url}")
            return True
        except Exception as e:
            logger.error(f"Failed to send ANALYZE_URL to extension: {e}")
            # Connection is likely dead; drop it so has_extension() reflects reality.
            self.active_extension = None
            return False


manager = ConnectionManager()