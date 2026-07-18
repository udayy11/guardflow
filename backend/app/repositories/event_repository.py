from typing import List
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.event import Event

class EventRepository:
    """Database operations for Event model using Repository pattern."""

    def __init__(self, db: Session):
        self.db = db

    def save(self, event: Event) -> Event:
        """Persist an event to database, tolerating duplicate ids.

        Clients may retry a send (e.g. after a lost ack) using the same
        event id. That's expected and should be treated as a no-op
        success rather than a crash: we attempt the insert, and if a row
        with that id already exists, we roll back and return the row
        that's already there instead of raising.

        Args:
            event: Event model instance to save
            
        Returns:
            The persisted Event with any database-generated values. If an
            event with the same id already existed, that existing row is
            returned instead of the one passed in.
        """
        self.db.add(event)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            existing = self.db.query(Event).filter(Event.id == event.id).first()
            if existing is not None:
                return existing
            # Constraint failure wasn't actually an id collision (or the
            # row vanished under us) -- surface the original problem.
            raise
        self.db.refresh(event)
        return event

    def find_by_session(self, session_id: str) -> List[Event]:
        """Retrieve all events for a given session.
        
        Args:
            session_id: Session identifier to filter by
            
        Returns:
            List of Event objects matching the session
        """
        return (
            self.db.query(Event)
            .filter(Event.session_id == session_id)
            .order_by(Event.timestamp.asc(), Event.created_at.asc())
            .all()
        )

    def delete(self, event_id: UUID) -> None:
        """Remove an event from database.
        
        Args:
            event_id: UUID of event to delete
        """
        event = self.db.query(Event).filter(Event.id == str(event_id)).first()
        if event:
            self.db.delete(event)
            self.db.commit()




    def find_by_time_range(self, start, end):
        """Retrieve events between two datetimes (inclusive)."""
        return (
            self.db.query(Event)
            .filter(Event.timestamp >= start)
            .filter(Event.timestamp <= end)
            .all()
        )

    def find_recent(self, limit: int = 100):
        """Return the most recent events up to `limit`."""
        return (
            self.db.query(Event)
            .order_by(Event.timestamp.desc())
            .limit(limit)
            .all()
        )
