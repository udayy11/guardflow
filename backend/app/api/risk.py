"""Risk-scoring API orchestration.

This route preserves the Android/API response contract. It selects the latest
stored extension analysis, extracts deterministic features once, calculates
the final score, and persists the assessment. Ollama is not part of this path.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.logger import logger
from app.database.database import get_db
from app.models.risk_assessment import RiskAssessment
from app.models.sessions import Session as SessionModel
from app.repositories.event_repository import EventRepository
from app.repositories.risk_repository import RiskRepository
from app.schemas.risk_schema import RiskResponse
from app.services.feature_extractor import FeatureExtractor
from app.services.risk_engine import RiskEngine
from app.services.website_analyzer import WebsiteAnalyzer


router = APIRouter(
    tags=["Risk Assessment"],
    responses={
        status.HTTP_404_NOT_FOUND: {"description": "Resource not found"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Server error"},
    },
)

_feature_extractor = FeatureExtractor()
_website_analyzer = WebsiteAnalyzer()
_risk_engine = RiskEngine()


@router.post(
    "/score/{session_id}",
    response_model=RiskResponse,
    status_code=status.HTTP_200_OK,
    summary="Compute and persist a deterministic session risk assessment",
    responses={
        status.HTTP_200_OK: {"description": "Risk assessment computed successfully"},
        status.HTTP_404_NOT_FOUND: {"description": "No events found for session"},
    },
)
def get_risk_score(
    session_id: str,
    db: Session = Depends(get_db),
) -> RiskResponse:
    events = EventRepository(db).find_by_session(session_id)
    if not events:
        logger.warning("No events found for session_id={}", session_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No events found for this session",
        )

    # EventRepository returns chronological order, so the first match while
    # walking backward is the most recent analysis. Historical pages never
    # override the page currently being assessed.
    latest_page_event = next(
        (
            event
            for event in reversed(events)
            if str(event.event_type or "").upper() == "PAGE_ANALYSIS"
            and isinstance(event.payload, dict)
        ),
        None,
    )
    page_payload = latest_page_event.payload if latest_page_event is not None else None

    features = _feature_extractor.extract(page_payload, events)
    website_analysis = _website_analyzer.analyze(features)
    result = _risk_engine.calculate(features, website_analysis)

    session_row = db.get(SessionModel, session_id)
    if session_row is None:
        session_row = SessionModel(id=session_id)
        db.add(session_row)
    session_row.current_risk_score = result["risk_score"]
    session_row.current_risk_level = result["risk_level"]
    db.commit()

    assessment = RiskAssessment(
        session_id=session_id,
        score=result["risk_score"],
        level=result["risk_level"],
        confidence=result["confidence"],
        triggered_rules=result["triggered_rules"],
        requires_physical_confirmation=result["requires_physical_confirmation"],
    )
    RiskRepository(db).save(assessment)

    selected_url = features["url_features"].get("url") or "n/a"
    logger.info(
        "Risk assessment session_id={} selected_url={} final_score={} confidence={} level={}",
        session_id,
        selected_url,
        result["risk_score"],
        result["confidence"],
        result["risk_level"],
    )

    return RiskResponse(
        score=result["risk_score"],
        level=result["risk_level"],
        confidence=result["confidence"],
        triggered_rules=result["triggered_rules"],
        requires_physical_confirmation=result["requires_physical_confirmation"],
    )

