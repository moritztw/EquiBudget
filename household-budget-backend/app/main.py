from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import DbSessionDep
from app.api.errors import register_exception_handlers
from app.api.routers import imports, master_data, planning, setup, tenants
from app.core.config import get_settings
from app.db.session import engine
from app.schemas.api import HealthReadinessResponse


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Manage SQLAlchemy async connection pool disposal on graceful shutdown."""
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    """Construct and configure the production FastAPI application instance."""
    settings = get_settings()

    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Self-hosted multi-tenant household budgeting & accrual ERP API.",
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(application)

    v1_router = APIRouter(prefix="/api/v1")
    v1_router.include_router(setup.router)
    v1_router.include_router(tenants.router)
    v1_router.include_router(master_data.router)
    v1_router.include_router(planning.router)
    v1_router.include_router(imports.router)
    application.include_router(v1_router)

    @application.get("/health/live", tags=["Health"])
    async def liveness_probe() -> dict[str, str]:
        return {"status": "alive"}

    @application.get(
        "/health/ready",
        response_model=HealthReadinessResponse,
        tags=["Health"],
    )
    async def readiness_probe(
        response: Response,
        session: DbSessionDep,
    ) -> HealthReadinessResponse:
        try:
            await session.execute(text("SELECT 1"))
            return HealthReadinessResponse(
                status="ready",
                app_name=settings.app_name,
                database_reachable=True,
            )
        except SQLAlchemyError:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return HealthReadinessResponse(
                status="degraded",
                app_name=settings.app_name,
                database_reachable=False,
            )

    return application


app = create_app()
