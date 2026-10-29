from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.domain.exceptions import DomainError
from app.schemas.api import ProblemDetails


class ApplicationError(Exception):
    """Base HTTP-aware application exception."""

    def __init__(
        self,
        detail: str,
        *,
        status_code: int,
        title: str,
        error_code: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.title = title
        self.error_code = error_code
        self.context: dict[str, Any] = context if context is not None else {}


class ResourceNotFoundError(ApplicationError):
    """Raised when an entity does not exist inside the current tenant boundary."""

    def __init__(self, resource: str, identifier: str) -> None:
        super().__init__(
            f"{resource} '{identifier}' was not found in the active household tenant.",
            status_code=status.HTTP_404_NOT_FOUND,
            title="Resource Not Found",
            error_code="RESOURCE_NOT_FOUND",
            context={"resource": resource, "identifier": identifier},
        )


class ResourceConflictError(ApplicationError):
    """Raised when an operation violates uniqueness or idempotency constraints."""

    def __init__(self, detail: str, *, context: dict[str, Any] | None = None) -> None:
        super().__init__(
            detail,
            status_code=status.HTTP_409_CONFLICT,
            title="Resource Conflict",
            error_code="RESOURCE_CONFLICT",
            context=context,
        )


class MissingTenantContextError(ApplicationError):
    """Raised when no valid tenant header or default household could be resolved."""

    def __init__(self, detail: str) -> None:
        super().__init__(
            detail,
            status_code=status.HTTP_400_BAD_REQUEST,
            title="Missing or Invalid Tenant Context",
            error_code="MISSING_TENANT_CONTEXT",
        )


class UnauthorizedError(ApplicationError):
    """Raised when a supplied JWT Bearer token is malformed, expired, or invalid."""

    def __init__(self, detail: str) -> None:
        super().__init__(
            detail,
            status_code=status.HTTP_401_UNAUTHORIZED,
            title="Authentication Failed",
            error_code="AUTHENTICATION_FAILED",
        )


def register_exception_handlers(app: FastAPI) -> None:
    """Attach RFC 7807 ProblemDetails handlers for domain, application, and DB integrity errors."""

    @app.exception_handler(ApplicationError)
    async def handle_application_error(
        _request: Request,
        exc: ApplicationError,
    ) -> JSONResponse:
        payload = ProblemDetails(
            title=exc.title,
            status=exc.status_code,
            detail=exc.detail,
            error_code=exc.error_code,
            context=exc.context,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=payload.model_dump(mode="json"),
        )

    @app.exception_handler(DomainError)
    async def handle_domain_error(
        _request: Request,
        exc: DomainError,
    ) -> JSONResponse:
        payload = ProblemDetails(
            title="Business Rule Violation",
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.message,
            error_code=exc.error_code,
            context=exc.details,
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=payload.model_dump(mode="json"),
        )

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(
        _request: Request,
        _exc: IntegrityError,
    ) -> JSONResponse:
        payload = ProblemDetails(
            title="Database Constraint Violation",
            status=status.HTTP_409_CONFLICT,
            detail="The requested change conflicts with an existing record or foreign key constraint.",
            error_code="DATABASE_INTEGRITY_CONFLICT",
        )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=payload.model_dump(mode="json"),
        )
