from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.risk_assessment import RiskAssessment


class RiskRepository:
    """Database operations for RiskAssessment model using Repository pattern.

    Mirrors EventRepository's shape for consistency with the rest of the codebase.
    """

    def __init__(self, db: Session):
        self.db = db

    def save(self, assessment: RiskAssessment) -> RiskAssessment:
        """Persist a risk assessment to the database.

        Args:
            assessment: RiskAssessment model instance to save

        Returns:
            The persisted RiskAssessment with any database-generated values
        """
        self.db.add(assessment)
        self.db.commit()
        self.db.refresh(assessment)
        return assessment

    def get_latest_by_session(self, session_id: str) -> Optional[RiskAssessment]:
        """Retrieve the most recent risk assessment for a session.

        Args:
            session_id: Session identifier to filter by

        Returns:
            The latest RiskAssessment for the session, or None if none exist
        """
        stmt = (
            select(RiskAssessment)
            .where(RiskAssessment.session_id == session_id)
            .order_by(RiskAssessment.created_at.desc())
            .limit(1)
        )
        return self.db.execute(stmt).scalar_one_or_none()
