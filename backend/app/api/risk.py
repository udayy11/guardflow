from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.logger import logger
from app.database.database import get_db
from app.models.risk_assessment import RiskAssessment
from app.repositories.event_repository import EventRepository
from app.repositories.risk_repository import RiskRepository
from app.schemas.risk_schema import RiskResponse
from app.services.risk_engine import RuleEngine

# NOTE: no prefix here - main.py already mounts this router under "/api/v1".
# The previous version set prefix="/api/v1" on both this router AND on the
# include_router() call in main.py, which produced "/api/v1/api/v1/score/..."
router = APIRouter(
    tags=["Risk Assessment"],
    responses={
        status.HTTP_404_NOT_FOUND: {"description": "Resource not found"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Server error"},
    },
)

_rule_engine = RuleEngine()


@router.post(
    "/score/{session_id}",
    response_model=RiskResponse,
    status_code=status.HTTP_200_OK,
    summary="Compute (and persist) the risk assessment for a session",
    responses={
        status.HTTP_200_OK: {"description": "Risk assessment computed successfully"},
        status.HTTP_404_NOT_FOUND: {"description": "No events found for session"},
    },
)
def get_risk_score(
    session_id: str,
    db: Session = Depends(get_db),
) -> RiskResponse:
    """Compute a risk assessment for a session from its stored events.

    Pulls every event recorded for the session, runs it through the rule
    engine, persists the resulting RiskAssessment row, and returns the score.

    Args:
        session_id: ID of the session to assess
        db: Database session dependency

    Returns:
        RiskResponse: Freshly computed risk assessment data

    Raises:
        HTTPException: 404 if no events exist for this session
    """
    events = EventRepository(db).find_by_session(session_id)

    if not events:
        logger.warning(f"No events found for session {session_id}, cannot score")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No events found for this session",
        )

    result = _rule_engine.evaluate(events)

    assessment = RiskAssessment(
        session_id=session_id,
        score=result.score,
        level=result.level,
        confidence=result.confidence,
        triggered_rules=result.triggered_rules,
        requires_physical_confirmation=result.requires_physical_confirmation,
    )
    RiskRepository(db).save(assessment)

    logger.info(
        f"Risk assessment for session {session_id}: "
        f"{result.score}/{result.level} (rules: {result.triggered_rules})"
    )

    return RiskResponse(
        score=result.score,
        level=result.level,
        confidence=result.confidence,
        triggered_rules=result.triggered_rules,
        requires_physical_confirmation=result.requires_physical_confirmation,
    )