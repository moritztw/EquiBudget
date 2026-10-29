from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Query, status

from app.api.deps import HouseholdRepoDep
from app.domain.accrual_engine import AccrualEngine
from app.schemas.api import (
    AccountCreate,
    AccountLiquidityRead,
    AccountRead,
    BudgetCategoryCreate,
    BudgetCategoryRead,
    PersonCreate,
    PersonMonthlyIncomeRead,
    PersonMonthlyIncomeUpsert,
    PersonRead,
    PersonUpdate,
)

router = APIRouter(tags=["Master Data"])
_accrual_engine = AccrualEngine()


# --- Persons (Haushaltsmitglieder / Stammdaten) & Variable Monthly Incomes ---


@router.get("/persons", response_model=list[PersonRead])
async def list_persons(
    repo: HouseholdRepoDep,
    active_only: bool = Query(default=True),
) -> list[PersonRead]:
    persons = await repo.list_persons(active_only=active_only)
    return [PersonRead.model_validate(p) for p in persons]


@router.post("/persons", response_model=PersonRead, status_code=status.HTTP_201_CREATED)
async def create_person(
    payload: PersonCreate,
    repo: HouseholdRepoDep,
) -> PersonRead:
    person = await repo.create_person(payload)
    return PersonRead.model_validate(person)


@router.patch("/persons/{person_id}", response_model=PersonRead)
async def update_person(
    person_id: uuid.UUID,
    payload: PersonUpdate,
    repo: HouseholdRepoDep,
) -> PersonRead:
    person = await repo.update_person(person_id, payload)
    return PersonRead.model_validate(person)


@router.get("/persons/monthly-incomes", response_model=list[PersonMonthlyIncomeRead])
async def list_person_monthly_incomes(
    repo: HouseholdRepoDep,
    period_month: date | None = Query(default=None),
    person_id: uuid.UUID | None = Query(default=None),
) -> list[PersonMonthlyIncomeRead]:
    """List recorded actual monthly net incomes (fresh monthly entries for variable pay/bonuses)."""
    records = await repo.list_monthly_incomes(period_month=period_month, person_id=person_id)
    return [PersonMonthlyIncomeRead.model_validate(r) for r in records]


@router.put(
    "/persons/{person_id}/monthly-incomes/{period_month}",
    response_model=PersonMonthlyIncomeRead,
)
async def upsert_person_monthly_income(
    person_id: uuid.UUID,
    period_month: date,
    payload: PersonMonthlyIncomeUpsert,
    repo: HouseholdRepoDep,
) -> PersonMonthlyIncomeRead:
    """
    Record or overwrite the real monthly net income for `person_id` in `period_month` (YYYY-MM-01).
    Used for month-specific splits where actual variable income is entered anew each month.
    """
    record = await repo.upsert_person_monthly_income(person_id, period_month, payload)
    return PersonMonthlyIncomeRead.model_validate(record)


# --- Accounts & Virtual Reserve Reconciliation ---


@router.get("/accounts", response_model=list[AccountRead])
async def list_accounts(
    repo: HouseholdRepoDep,
    active_only: bool = Query(default=True),
) -> list[AccountRead]:
    accounts = await repo.list_accounts(active_only=active_only)
    return [AccountRead.model_validate(a) for a in accounts]


@router.post("/accounts", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: AccountCreate,
    repo: HouseholdRepoDep,
) -> AccountRead:
    account = await repo.create_account(payload)
    return AccountRead.model_validate(account)


@router.get("/accounts/{account_id}/liquidity", response_model=AccountLiquidityRead)
async def get_account_liquidity(
    account_id: uuid.UUID,
    repo: HouseholdRepoDep,
) -> AccountLiquidityRead:
    """
    Reconcile a physical bank account's balance against all virtual sinking funds
    (including residual balances of end-date-expired pots) backed by this account.
    """
    account = await repo.get_account(account_id)
    physical_balance = await repo.compute_physical_account_balance(account)
    funds_with_balances = await repo.list_sinking_funds_with_balances(
        active_only=False,
        backing_account_id=account.id,
    )
    snapshots = [
        repo.to_fund_snapshot(fund, balance) for fund, balance in funds_with_balances
    ]
    reconciliation = _accrual_engine.reconcile_account_liquidity(
        account_id=account.id,
        physical_account_balance=physical_balance,
        funds_on_account=snapshots,
    )
    return AccountLiquidityRead(
        account_id=account.id,
        account_name=account.name,
        currency=account.currency,
        physical_account_balance=reconciliation.physical_account_balance,
        reserved_sinking_funds_balance=reconciliation.reserved_sinking_funds_balance,
        overdrawn_sinking_funds_balance=reconciliation.overdrawn_sinking_funds_balance,
        free_disposable_liquidity=reconciliation.free_disposable_liquidity,
        is_fully_backed=reconciliation.is_fully_backed,
    )



# --- Budget Categories ---


@router.get("/categories", response_model=list[BudgetCategoryRead])
async def list_categories(
    repo: HouseholdRepoDep,
    active_only: bool = Query(default=True),
) -> list[BudgetCategoryRead]:
    categories = await repo.list_categories(active_only=active_only)
    return [BudgetCategoryRead.model_validate(c) for c in categories]


@router.post(
    "/categories",
    response_model=BudgetCategoryRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_category(
    payload: BudgetCategoryCreate,
    repo: HouseholdRepoDep,
    ) -> BudgetCategoryRead:
    category = await repo.create_category(payload)
    return BudgetCategoryRead.model_validate(category)
