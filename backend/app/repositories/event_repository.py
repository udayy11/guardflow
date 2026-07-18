from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.event import Event

class EventRepository:
    """Database operations for Event model using Repository pattern."""

    def __init__(self, db: Session):
        self.db = db

    def save(self, event: Event) -> Event:
        """Persist an event to database.
        
        Args:
            event: Event model instance to save
            
        Returns:
            The persisted Event with any database-generated values
        """
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event

    def find_by_session(self, session_id: str) -> List[Event]:
        """Retrieve all events for a given session.
        
        Args:
            session_id: Session identifier to filter by
            
        Returns:
            List of Event objects matching the session
        """
        return self.db.query(Event).filter(Event.session_id == session_id).all()

    def delete(self, event_id: UUID) -> None:
        """Remove an event from database.
        
        Args:
            event_id: UUID of event to delete
        """
        event = self.db.query(Event).filter(Event.id == str(event_id)).first()
        if event:
            self.db.delete(event)
            self.db.commit()