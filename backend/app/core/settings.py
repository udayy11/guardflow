from pathlib import Path
from typing import Optional, Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """Centralized application configuration.
    
    Reads configuration from a .env file or environment variables.
    Uses pydantic-settings for validation and type safety.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        frozen=True,
    )

    #Environment Config

    # Application Config
    APP_NAME: str = "GuardFlow"
    APP_VERSION: str = "0.1.0"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # Database Config
    DATABASE_URL: str = "sqlite:///./data/guardflow.db"

    # Logging Config
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    LOG_DIR: Path = Path("logs")

    # AI Config (Ollama)
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3:latest"

    SERIAL_PORT: Optional[str] = None
    SERIAL_BAUDRATE: int = 9600
    SERIAL_TIMEOUT: float = 1.0

    SECRET_KEY: str = "change-me"
    
    ENVIRONMENT: Literal["development","testing","production"] = "development"
    #CORS
    ALLOWED_ORIGINS: list[str] = ["http://localhost:5173"]

    # Serial Config


# Singleton settings object
settings = Settings()