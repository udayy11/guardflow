from contextlib import contextmanager
from typing import Iterator
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker, Session

from app.core.settings import settings
from app.core.logger import logger
from app.database.base import Base
from app.models.event import Event
from app.models.sessions import Session as SessionModel  # noqa: F401 - imported for Base.metadata registration
from app.models.risk_assessment import RiskAssessment  # noqa: F401 - imported for Base.metadata registration
# Database engine

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,  # Checks connection health before use
    echo=settings.DEBUG,  # Log SQL queries in debug mode
)

print("=" * 60)
print("DATABASE URL:", settings.DATABASE_URL)
print("Working Directory:", Path.cwd())
print("Database Absolute Path:", Path("data/guardflow.db").resolve())
print("=" * 60)
print("=" * 50)
print("DATABASE URL:", settings.DATABASE_URL)
print("=" * 50)

# Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

@contextmanager
def get_db_context() -> Iterator[Session]:
    """Context-manager form of a DB session, for use outside FastAPI's DI
    system (e.g. the websocket handler, background jobs).

    Yields:
        Session: SQLAlchemy database session
    """
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError as e:
        logger.error(f"Database session error: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency that provides a database session.

    Plain generator function (no @contextmanager) - FastAPI's Depends()
    already detects and manages generator dependencies itself. Wrapping
    this in @contextmanager as well double-wraps it and breaks every request.

    Yields:
        Session: SQLAlchemy database session
    """
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError as e:
        logger.error(f"Database session error: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()

def init_database() -> None:
    """Initialize database tables.
    
    Creates all tables defined in models inheriting from Base.
    Logs success/failure using application logger.
    """
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully")
    except SQLAlchemyError as e:
        logger.critical(f"Database initialization failed: {str(e)}")
        raise