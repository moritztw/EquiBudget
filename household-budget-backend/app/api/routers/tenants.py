from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import DbSessionDep, TenantContextDep
from app.api.errors import ResourceNotFoundError
from app.repositories.budget_repository import TenantRepository
from app.schemas.api import TenantCreate, TenantRead

router = APIRouter(prefix="/tenants", tags=["Tenants"])


@router.get("", response_model=list[TenantRead])
async def list_tenants(session: DbSessionDep) -> list[TenantRead]:
    """List all active household tenants registered on this EquiBudget instance."""
    repo = TenantRepository(session)
    tenants = await repo.list_tenants()
    return [TenantRead.model_validate(t) for t in tenants]


@router.post("", response_model=TenantRead, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    payload: TenantCreate,
    session: DbSessionDep,
) -> TenantRead:
    """Provision a new isolated household tenant."""
    repo = TenantRepository(session)
    tenant = await repo.create_tenant(payload)
    return TenantRead.model_validate(tenant)


@router.get("/current", response_model=TenantRead)
async def get_current_tenant(
    session: DbSessionDep,
    tenant_ctx: TenantContextDep,
) -> TenantRead:
    """Return metadata for the currently active household tenant."""
    repo = TenantRepository(session)
    tenant = await repo.get_active_tenant(tenant_ctx.tenant_id)
    if tenant is None:
        raise ResourceNotFoundError("Tenant", str(tenant_ctx.tenant_id))
    return TenantRead.model_validate(tenant)
