from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    APP_NAME: str = "EquiBudget Backend API"
    ENVIRONMENT: str = "production"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://equibudget:change_me_super_secret_db_pass@db:5432/equibudget"

    # Authentication
    AUTH_MODE: str = "reverse_proxy" # 'reverse_proxy' or 'standalone_jwt'
    FORWARDED_USER_HEADER: str = "X-Forwarded-User"
    FORWARDED_EMAIL_HEADER: str = "X-Auth-Request-Email"
    FORWARDED_GROUPS_HEADER: str = "X-Forwarded-Groups"
    JWT_SECRET_KEY: str = "insecure_dev_jwt_secret_change_in_prod"

    # AI Integration
    AI_CLASSIFIER_PROVIDER: str = "gemini" # 'gemini', 'ollama', or 'heuristic'
    GEMINI_API_KEY: Optional[str] = None

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
