from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

import jwt
from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import (
    MissingTenantContextError,
    ResourceNotFoundError,
    UnauthorizedError,
)
from app.core.config import get_settings
from app.db.session import get_db_session, set_tenant_session_context
from app.models.enums import AllocationStrategy, ImportCommitMode, SupportedLocale
from app.repositories.budget_repository import HouseholdRepository, TenantRepository


@dataclass(frozen=True, slots=True)
class PrincipalContext:
    """Resolved caller identity via Pangolin/Newt Forward-Auth header, JWT fallback, or local LAN."""

    subject: str
    email: str | None
    auth_method: Literal["forward_auth", "jwt", "local"]


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Resolved household tenant boundary for the active HTTP request."""

    tenant_id: uuid.UUID
    slug: str
    default_currency: str
    default_locale: SupportedLocale
    default_allocation_strategy: AllocationStrategy
    default_import_commit_mode: ImportCommitMode
    principal: PrincipalContext


def create_access_token(subject: str, *, email: str | None = None) -> str:
    """Issue a signed HS256 JWT fallback access token."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    claims: dict[str, object] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    if email:
        claims["email"] = email
    return jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


async def get_principal_context(
    request: Request,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> PrincipalContext:
    """
    Resolve caller identity in priority order:
    1. Reverse-Proxy Forward-Auth (`X-Forwarded-User` / `X-Forwarded-Email` from Pangolin/Newt)
    2. Standard `Authorization: Bearer <jwt>` fallback token
    3. Local self-hosted single-household context (`local`)
    """
    settings = get_settings()

    if settings.forward_auth_enabled:
        forwarded_user = request.headers.get(settings.forward_auth_user_header)
        if forwarded_user and forwarded_user.strip():
            forwarded_email = request.headers.get(settings.forward_auth_email_header)
            return PrincipalContext(
                subject=forwarded_user.strip(),
                email=forwarded_email.strip() if forwarded_email else None,
                auth_method="forward_auth",
            )

    if authorization and authorization.lower().startswith("bearer "):
        raw_token = authorization[7:].strip()
        try:
            payload = jwt.decode(
                raw_token,
                settings.jwt_secret_key,
                algorithms=[settings.jwt_algorithm],
            )
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("Invalid or expired Bearer JWT token.") from exc

        subject = str(payload.get("sub") or "").strip()
        if not subject:
            raise UnauthorizedError("Bearer JWT token is missing subject ('sub') claim.")
        email_claim = payload.get("email")
        return PrincipalContext(
            subject=subject,
            email=str(email_claim) if isinstance(email_claim, str) else None,
            auth_method="jwt",
        )

    return PrincipalContext(subject="local-household", email=None, auth_method="local")


PrincipalDep = Annotated[PrincipalContext, Depends(get_principal_context)]
DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]


async def get_tenant_context(
    session: DbSessionDep,
    principal: PrincipalDep,
    x_tenant_id: Annotated[
        uuid.UUID | None,
        Header(alias="X-Tenant-ID", description="Active Household Tenant UUID"),
    ] = None,
) -> TenantContext:
    """
    Resolve active TenantContext via `X-Tenant-ID` header or automatic single-household fallback.
    Binds `app.current_tenant_id` on the PostgreSQL transaction for RLS isolation.
    """
    tenant_repo = TenantRepository(session)

    if x_tenant_id is not None:
        tenant = await tenant_repo.get_active_tenant(x_tenant_id)
        if tenant is None:
            raise ResourceNotFoundError("Tenant", str(x_tenant_id))
    else:
        tenant = await tenant_repo.get_single_default_tenant()
        if tenant is None:
            raise MissingTenantContextError(
                "Provide the 'X-Tenant-ID' header when zero or multiple households exist."
            )

    await set_tenant_session_context(session, tenant.id)

    return TenantContext(
        tenant_id=tenant.id,
        slug=tenant.slug,
        default_currency=tenant.default_currency,
        default_locale=tenant.default_locale,
        default_allocation_strategy=tenant.default_allocation_strategy,
        default_import_commit_mode=tenant.default_import_commit_mode,
        principal=principal,
    )


TenantContextDep = Annotated[TenantContext, Depends(get_tenant_context)]


async def get_household_repository(
    session: DbSessionDep,
    tenant_ctx: TenantContextDep,
) -> HouseholdRepository:
    """Provide a tenant-isolated HouseholdRepository instance."""
    return HouseholdRepository(session=session, tenant_id=tenant_ctx.tenant_id)


HouseholdRepoDep = Annotated[HouseholdRepository, Depends(get_household_repository)]
