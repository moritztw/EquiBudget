from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from app.api.deps import DbSessionDep
from app.domain.accrual_engine import AccrualEngine, normalize_to_month_start
from app.domain.exceptions import DomainValidationError
from app.domain.money import ZERO, quantize_cents
from app.models.enums import RecurrenceInterval
from app.repositories.budget_repository import HouseholdRepository, TenantRepository
from app.schemas.api import (
    AccountCreate,
    AccountLiquidityRead,
    BudgetCategoryCreate,
    PersonCreate,
    PersonMonthlyIncomeUpsert,
    SinkingFundCreate,
    TenantRead,
)
from app.schemas.setup import (
    InstanceBootstrapRequest,
    InstanceBootstrapResponse,
    InstanceSetupStatusResponse,
)

router = APIRouter(prefix="/setup", tags=["First-Run Setup"])
_accrual_engine = AccrualEngine()


@router.get("/status", response_model=InstanceSetupStatusResponse)
async def get_instance_setup_status(
    session: DbSessionDep,
) -> InstanceSetupStatusResponse:
    """
    Check whether this self-hosted EquiBudget deployment has already been initialized
    with at least one active household tenant. Callable without X-Tenant-ID header.
    """
    tenant_repo = TenantRepository(session)
    tenants = await tenant_repo.list_tenants()
    default_id = tenants[0].id if len(tenants) == 1 else None
    return InstanceSetupStatusResponse(
        is_initialized=len(tenants) > 0,
        active_tenant_count=len(tenants),
        default_tenant_id=default_id,
    )


@router.post(
    "/bootstrap",
    response_model=InstanceBootstrapResponse,
    status_code=status.HTTP_201_CREATED,
)
async def bootstrap_clean_instance(
    payload: InstanceBootstrapRequest,
    session: DbSessionDep,
) -> InstanceBootstrapResponse:
    """
    Atomically provision a clean household tenant with its master data (persons, monthly incomes,
    physical bank accounts, categories, and planned payments / sinking funds including initial
    pot opening balances via `INITIAL_CARRYOVER`) without any test or demo data.
    """
    tenant_repo = TenantRepository(session)
    tenant = await tenant_repo.create_tenant(payload.tenant)

    household_repo = HouseholdRepository(session, tenant.id)
    period_month = normalize_to_month_start(payload.start_period_month)

    person_ref_map: dict[str, uuid.UUID] = {}
    for person_seed in payload.persons:
        if person_seed.client_ref in person_ref_map:
            raise DomainValidationError(
                f"Duplicate person client_ref '{person_seed.client_ref}' in setup payload."
            )
        person = await household_repo.create_person(
            PersonCreate(
                display_name=person_seed.display_name,
                is_employed=person_seed.is_employed,
                participates_in_shared_split=person_seed.participates_in_shared_split,
                monthly_net_income=person_seed.initial_monthly_net_income,
                fixed_personal_deductions=person_seed.fixed_personal_deductions,
                custom_allocation_weight=person_seed.custom_allocation_weight,
            )
        )
        person_ref_map[person_seed.client_ref] = person.id

        if person_seed.is_employed and person_seed.initial_monthly_net_income > ZERO:
            await household_repo.upsert_person_monthly_income(
                person.id,
                period_month,
                PersonMonthlyIncomeUpsert(
                    actual_net_income=person_seed.initial_monthly_net_income,
                    personal_fixed_deductions=person_seed.fixed_personal_deductions,
                    note="Startmonat (Ersteinrichtung)",
                ),
            )

    account_ref_map: dict[str, uuid.UUID] = {}
    created_accounts = []
    for account_seed in payload.accounts:
        if account_seed.client_ref in account_ref_map:
            raise DomainValidationError(
                f"Duplicate account client_ref '{account_seed.client_ref}' in setup payload."
            )
        owner_id: uuid.UUID | None = None
        if account_seed.owner_person_ref is not None:
            owner_id = person_ref_map.get(account_seed.owner_person_ref)
            if owner_id is None:
                raise DomainValidationError(
                    f"Unknown owner_person_ref '{account_seed.owner_person_ref}' on account '{account_seed.name}'."
                )

        clean_iban = (
            account_seed.iban.replace(" ", "").upper()
            if account_seed.iban and account_seed.iban.strip()
            else None
        )
        if clean_iban is not None and len(clean_iban) < 15:
            clean_iban = None

        account = await household_repo.create_account(
            AccountCreate(
                name=account_seed.name,
                owner_person_id=owner_id,
                institution_name=account_seed.institution_name,
                iban=clean_iban,
                account_type=account_seed.account_type,
                currency=account_seed.currency,
                opening_balance=account_seed.opening_balance,
                opening_balance_date=account_seed.opening_balance_date,
            )
        )
        account_ref_map[account_seed.client_ref] = account.id
        created_accounts.append(account)

    category_ref_map: dict[str, uuid.UUID] = {}
    for category_seed in payload.categories:
        if category_seed.client_ref in category_ref_map:
            raise DomainValidationError(
                f"Duplicate category client_ref '{category_seed.client_ref}' in setup payload."
            )
        category = await household_repo.create_category(
            BudgetCategoryCreate(
                name=category_seed.name,
                is_shared_expense=category_seed.is_shared_expense,
                monthly_target_amount=category_seed.monthly_target_amount,
            )
        )
        category_ref_map[category_seed.client_ref] = category.id

    total_carryover = ZERO
    for payment_seed in payload.planned_payments:
        backing_account_id = account_ref_map.get(payment_seed.backing_account_ref)
        if backing_account_id is None:
            raise DomainValidationError(
                f"Unknown backing_account_ref '{payment_seed.backing_account_ref}' on planned payment '{payment_seed.name}'."
            )
        category_id: uuid.UUID | None = None
        if payment_seed.category_ref is not None:
            category_id = category_ref_map.get(payment_seed.category_ref)
            if category_id is None:
                raise DomainValidationError(
                    f"Unknown category_ref '{payment_seed.category_ref}' on planned payment '{payment_seed.name}'."
                )

        effective_auto_accrual = (
            False
            if payment_seed.recurrence_interval == RecurrenceInterval.MONTHLY
            else payment_seed.auto_accrual
        )
        pot_carryover = (
            quantize_cents(payment_seed.initial_pot_balance)
            if effective_auto_accrual or payment_seed.initial_pot_balance > ZERO
            else ZERO
        )

        _, booked_carryover = await household_repo.create_sinking_fund(
            SinkingFundCreate(
                backing_account_id=backing_account_id,
                category_id=category_id,
                name=payment_seed.name,
                payee=payment_seed.payee,
                target_amount=payment_seed.target_amount,
                recurrence_interval=payment_seed.recurrence_interval,
                next_due_date=payment_seed.next_due_date,
                end_date=payment_seed.end_date,
                auto_accrual=effective_auto_accrual,
                is_shared_obligation=payment_seed.is_shared_obligation,
                initial_carryover_amount=pot_carryover,
            ),
            carryover_period_month=period_month,
            carryover_note="Startguthaben (Ersteinrichtung)",
        )
        total_carryover = quantize_cents(total_carryover + booked_carryover)

    liquidity_rows: list[AccountLiquidityRead] = []
    for account in created_accounts:
        physical_balance = await household_repo.compute_physical_account_balance(account)
        funds_with_balances = await household_repo.list_sinking_funds_with_balances(
            active_only=False,
            backing_account_id=account.id,
        )
        snapshots = [
            household_repo.to_fund_snapshot(fund, balance)
            for fund, balance in funds_with_balances
        ]
        reconciliation = _accrual_engine.reconcile_account_liquidity(
            account_id=account.id,
            physical_account_balance=physical_balance,
            funds_on_account=snapshots,
        )
        liquidity_rows.append(
            AccountLiquidityRead(
                account_id=account.id,
                account_name=account.name,
                currency=account.currency,
                physical_account_balance=reconciliation.physical_account_balance,
                reserved_sinking_funds_balance=reconciliation.reserved_sinking_funds_balance,
                overdrawn_sinking_funds_balance=reconciliation.overdrawn_sinking_funds_balance,
                free_disposable_liquidity=reconciliation.free_disposable_liquidity,
                is_fully_backed=reconciliation.is_fully_backed,
            )
        )

    await session.commit()

    return InstanceBootstrapResponse(
        tenant=TenantRead.model_validate(tenant),
        persons_created=len(payload.persons),
        accounts_created=len(payload.accounts),
        categories_created=len(payload.categories),
        planned_payments_created=len(payload.planned_payments),
        total_initial_pot_carryover=total_carryover,
        account_liquidity=liquidity_rows,
    )
