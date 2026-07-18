from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.settings import settings
from app.core.logger import logger, configure_logger
from app.database.database import init_database

from app.api.events import router as events_router
from app.api.risk import router as risk_router
from app.api.health import router as health_router

from app.websocket.websocket_manager import router as websocket_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle.

    Replaces the deprecated @app.on_event("startup"/"shutdown") hooks with
    FastAPI's recommended lifespan context manager.
    """
    configure_logger()  # Initialize logger first
    logger.info("Starting application")
    try:
        init_database()  # Initialize database tables
        logger.info("Application startup completed")
    except Exception as e:
        logger.critical(f"Startup failed: {str(e)}")
        raise  # Crash the app if startup fails

    yield

    logger.info("Shutting down application")


# Initialize FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan,
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Root endpoint
@app.get("/")
async def root():
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION
    }

@app.get("/health")
async def health_check():
    return {"status": "OK"}


# Register routers
app.include_router(
    events_router,
    prefix="/api/v1",
    tags=["Events"],
)

app.include_router(
    risk_router,
    prefix="/api/v1",
    tags=["Risk"],
)

app.include_router(
    health_router,
    prefix="/api",
    tags=["Health"],
)

app.include_router(websocket_router)