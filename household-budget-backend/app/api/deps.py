from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import MissingTenantContextError, ResourceNotFoundError
from app.db.session import get_db_session, set_tenant_session_context
from app.models.enums import AllocationStrategy, ImportCommitMode, SupportedLocale
from app.repositories.budget_repository import HouseholdRepository, TenantRepository


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Resolved household tenant boundary for the active HTTP request."""

    tenant_id: uuid.UUID
    slug: str
    default_currency: str
    default_locale: SupportedLocale
    default_allocation_strategy: AllocationStrategy
    default_import_commit_mode: ImportCommitMode


DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]


async def get_tenant_context(
    session: DbSessionDep,
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
    )


TenantContextDep = Annotated[TenantContext, Depends(get_tenant_context)]


async def get_household_repository(
    session: DbSessionDep,
    tenant_ctx: TenantContextDep,
) -> HouseholdRepository:
    """Provide a tenant-isolated HouseholdRepository instance."""
    return HouseholdRepository(session=session, tenant_id=tenant_ctx.tenant_id)


HouseholdRepoDep = Annotated[HouseholdRepository, Depends(get_household_repository)]
