from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session
from app.core.logger import logger
from app.models.sessions import Session

class SessionRepository:
    """Repository for Session database operations following the repository pattern.
    
    Handles all CRUD operations for Session model with proper isolation from business logic.
    """

    def __init__(self, db: Session):
        """Initialize with database session dependency.
        
        Args:
            db: SQLAlchemy session injected via dependency
        """
        self.db = db

    def get_session(self, session_id: str) -> Optional[Session]:
        """Retrieve a session by its ID.
        
        Args:
            session_id: UUID string identifier for the session
            
        Returns:
            Session object if found, None otherwise
        """
        try:
            session = self.db.query(Session).filter(Session.id == session_id).first()
            if not session:
                logger.debug(f"Session not found: {session_id}")
            return session
        except Exception as e:
            logger.error(f"Failed to fetch session {session_id}: {str(e)}")
            raise

    def create_session(
        self,
        session_id: str,
        started_at: datetime
    ) -> Session:
        """Create a new session with default risk values.
        
        Args:
            session_id: UUID string identifier for the new session
            started_at: Timestamp when the session began
            
        Returns:
            The newly created Session object
            
        Raises:
            Exception: If creation fails
        """
        try:
            new_session = Session(
                id=session_id,
                started_at=started_at,
                status="ACTIVE",
                current_risk_score=0,
                current_risk_level="SAFE"
            )
            self.db.add(new_session)
            self.db.commit()
            self.db.refresh(new_session)
            logger.info(f"Created new session: {session_id}")
            return new_session
        except Exception as e:
            self.db.rollback()
            logger.error(f"Failed to create session {session_id}: {str(e)}")
            raise

    def update_session(self, session: Session) -> Session:
        """Persist changes to an existing session.
        
        Args:
            session: Modified Session object to update
            
        Returns:
            The updated Session object
            
        Raises:
            Exception: If update fails
        """
        try:
            self.db.add(session)
            self.db.commit()
            self.db.refresh(session)
            logger.debug(f"Updated session: {session.id}")
            return session
        except Exception as e:
            self.db.rollback()
            logger.error(f"Failed to update session {session.id}: {str(e)}")
            raise