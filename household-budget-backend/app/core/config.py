from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Centralized runtime configuration for EquiBudget backend."""

    model_config = SettingsConfigDict(
        env_prefix="EQUIBUDGET_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    environment: Literal["development", "staging", "production"] = "production"
    app_name: str = "EquiBudget API"
    debug_sql: bool = False

    database_url: PostgresDsn = Field(
        default="postgresql+asyncpg://equibudget:equibudget@localhost:5432/equibudget",
        description="Async PostgreSQL connection string using asyncpg driver.",
    )
    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=20, ge=0, le=200)
    db_pool_timeout_seconds: int = Field(default=30, ge=5, le=120)
    db_pool_recycle_seconds: int = Field(default=1800, ge=60)

    forward_auth_enabled: bool = True
    forward_auth_user_header: str = "X-Forwarded-User"
    forward_auth_email_header: str = "X-Forwarded-Email"
    forward_auth_trusted_proxies: list[str] = Field(
        default_factory=lambda: ["127.0.0.1/32", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    )

    jwt_secret_key: str = Field(
        default="change-this-secret-to-at-least-32-bytes-in-production",
        min_length=32,
    )
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = Field(default=480, ge=5, le=43200)

    @field_validator("database_url")
    @classmethod
    def ensure_asyncpg_scheme(cls, value: PostgresDsn) -> PostgresDsn:
        scheme = str(value).split("://", maxsplit=1)[0]
        if scheme != "postgresql+asyncpg":
            raise ValueError(
                f"database_url must use 'postgresql+asyncpg://' driver scheme, got '{scheme}://'"
            )
        return value

    @property
    def sqlalchemy_database_uri(self) -> str:
        return str(self.database_url)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    return Settings()
