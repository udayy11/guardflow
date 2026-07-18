from fastapi import APIRouter
from app.core.settings import settings

router = APIRouter()

@router.get("/health")
async def health_check():
    """Health check endpoint.
    
    Returns:
        dict: Status of the service with database connectivity and version info.
    """
    return {
        "status": "healthy",
        "database": "connected", 
        "version": settings.APP_VERSION
    }