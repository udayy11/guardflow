from pathlib import Path
from typing import Literal

from loguru import logger
from app.core.settings import settings

def configure_logger() -> None:
    """Configures Loguru logger for the application.

    - Removes default Loguru handlers to avoid duplicate logs.
    - Configures console and file logging based on settings.
    - Uses settings.LOG_DIR as the directory for log files.
    - Rotates logs daily at midnight, retains logs for 30 days, and compresses archives.
    - Uses enqueue=True for thread-safe logging.
    - Enables backtrace and diagnose in DEBUG mode.

    Raises:
        OSError: If log directory creation fails.
    """
    # Remove default Loguru handler to ensure custom configuration is applied
    logger.remove()

    # Ensure log directory exists
    log_dir = Path(settings.LOG_DIR)
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "guardflow.log"

    # Configure file logger
    logger.add(
        log_file,
        rotation="00:00",  # Rotate logs every midnight
        retention="30 days",  # Retain logs for 30 days
        compression="zip",  # Compress archived logs
        enqueue=True,  # Ensure thread-safe logging
        backtrace=settings.DEBUG,  # Include stack traces in DEBUG mode
        diagnose=settings.DEBUG,  # Include diagnostic info in DEBUG mode
        level=settings.LOG_LEVEL,  # Use LOG_LEVEL from settings
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{module}</cyan>.<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        ),
    )

    # Configure console logger
    logger.add(
        lambda msg: print(msg, end=""),  # Avoid direct print() usage
        level=settings.LOG_LEVEL,
        backtrace=settings.DEBUG,
        diagnose=settings.DEBUG,
        format=(
            "<green>{time:HH:mm:ss.SSS}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{module}</cyan>.<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        ),
    )