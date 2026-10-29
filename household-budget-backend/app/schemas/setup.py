from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.enums import AccountType, RecurrenceInterval
from app.schemas.api import AccountLiquidityRead, TenantCreate, TenantRead


class InstanceSetupStatusResponse(BaseModel):
    """Indicates whether this self-hosted EquiBudget instance already has an active tenant."""

    is_initialized: bool
    active_tenant_count: int
    default_tenant_id: uuid.UUID | None = None


class SetupPersonSeed(BaseModel):
    """Household member created during initial clean-slate onboarding."""

    client_ref: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=100)
    is_employed: bool = True
    participates_in_shared_split: bool = True
    initial_monthly_net_income: Decimal = Field(
        default=Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
    )
    fixed_personal_deductions: Decimal = Field(
        default=Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
    )
    custom_allocation_weight: Decimal | None = Field(
        default=None,
        ge=Decimal("0.00000"),
        le=Decimal("1.00000"),
    )


class SetupAccountSeed(BaseModel):
    """Physical bank or reserve account created during initial onboarding."""

    client_ref: str = Field(min_length=1, max_length=64)
    owner_person_ref: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    institution_name: str | None = Field(default=None, max_length=120)
    iban: str | None = Field(default=None, max_length=34)
    account_type: AccountType = AccountType.JOINT_CHECKING
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    opening_balance: Decimal = Field(default=Decimal("0.00"), decimal_places=2)
    opening_balance_date: date = Field(default_factory=date.today)


class SetupCategorySeed(BaseModel):
    """Expense category created during initial onboarding."""

    client_ref: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=100)
    is_shared_expense: bool = True
    monthly_target_amount: Decimal = Field(
        default=Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
    )


class SetupPlannedPaymentSeed(BaseModel):
    """
    Planned payment or virtual sinking fund created during initial onboarding,
    including optional `initial_pot_balance` (Startguthaben / INITIAL_CARRYOVER).
    """

    backing_account_ref: str = Field(min_length=1, max_length=64)
    category_ref: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    payee: str | None = Field(default=None, max_length=160)
    target_amount: Decimal = Field(gt=Decimal("0.00"), decimal_places=2)
    recurrence_interval: RecurrenceInterval = RecurrenceInterval.ANNUAL
    next_due_date: date
    end_date: date | None = None
    auto_accrual: bool = True
    is_shared_obligation: bool = True
    initial_pot_balance: Decimal = Field(
        default=Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
    )


class InstanceBootstrapRequest(BaseModel):
    """Atomic clean-slate onboarding payload without any sample/demo records."""

    tenant: TenantCreate
    start_period_month: date = Field(default_factory=lambda: date.today().replace(day=1))
    persons: list[SetupPersonSeed] = Field(min_length=1)
    accounts: list[SetupAccountSeed] = Field(min_length=1)
    categories: list[SetupCategorySeed] = Field(min_length=1)
    planned_payments: list[SetupPlannedPaymentSeed] = Field(default_factory=list)


class InstanceBootstrapResponse(BaseModel):
    """Summary and initial liquidity reconciliation of the newly initialized household."""

    tenant: TenantRead
    persons_created: int
    accounts_created: int
    categories_created: int
    planned_payments_created: int
    total_initial_pot_carryover: Decimal
    account_liquidity: list[AccountLiquidityRead]
