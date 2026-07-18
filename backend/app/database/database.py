from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker, Session

from app.core.settings import settings
from app.core.logger import logger
from app.database.base import Base
from app.models.event import Event
from app.models.risk_assessment import RiskAssessment
from app.models.sessions import Session as SessionModel


engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {},
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_database() -> None:
    """Create database tables and initialize the engine."""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database initialized successfully")
    except SQLAlchemyError as exc:
        logger.critical(f"Database initialization failed: {exc}")
        raise


@contextmanager

def get_db_context() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



def get_db() -> Iterator[Session]:
    """FastAPI dependency for request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
