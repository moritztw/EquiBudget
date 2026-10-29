from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    AccountType,
    AllocationStrategy,
    ImportCommitMode,
    RecurrenceInterval,
    SinkingFundEntryType,
    SupportedLocale,
)
from app.schemas.domain import (
    AllocationCalculationResponse,
    RateRevisionSchema,
    SinkingFundValuationSchema,
)


class ProblemDetails(BaseModel):
    """RFC 7807 compliant API error payload."""

    type: str = "about:blank"
    title: str
    status: int
    detail: str
    error_code: str
    context: dict[str, Any] = Field(default_factory=dict)


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    default_currency: str = Field(default="EUR", min_length=3, max_length=3)
    default_locale: SupportedLocale = SupportedLocale.DE
    default_allocation_strategy: AllocationStrategy = AllocationStrategy.EQUAL_REMAINING
    default_import_commit_mode: ImportCommitMode = ImportCommitMode.TWO_STAGE_PREVIEW


class TenantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    default_currency: str
    default_locale: SupportedLocale
    default_allocation_strategy: AllocationStrategy
    default_import_commit_mode: ImportCommitMode
    is_active: bool
    created_at: datetime


class PersonCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=100)
    is_employed: bool = True
    participates_in_shared_split: bool = True
    monthly_net_income: Decimal = Field(default=Decimal("0.00"), ge=Decimal("0.00"), decimal_places=2)
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


class PersonUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    is_employed: bool | None = None
    participates_in_shared_split: bool | None = None
    monthly_net_income: Decimal | None = Field(default=None, ge=Decimal("0.00"), decimal_places=2)
    fixed_personal_deductions: Decimal | None = Field(
        default=None,
        ge=Decimal("0.00"),
        decimal_places=2,
    )
    custom_allocation_weight: Decimal | None = Field(
        default=None,
        ge=Decimal("0.00000"),
        le=Decimal("1.00000"),
    )
    is_active: bool | None = None


class PersonRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    display_name: str
    is_employed: bool
    participates_in_shared_split: bool
    monthly_net_income: Decimal
    fixed_personal_deductions: Decimal
    custom_allocation_weight: Decimal | None
    is_active: bool
    created_at: datetime


class PersonMonthlyIncomeUpsert(BaseModel):
    """Fresh monthly entry of actual net income (including variable components/bonuses)."""

    actual_net_income: Decimal = Field(ge=Decimal("0.00"), decimal_places=2)
    personal_fixed_deductions: Decimal = Field(
        default=Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
    )
    note: str | None = Field(default=None, max_length=255)


class PersonMonthlyIncomeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    person_id: uuid.UUID
    period_month: date
    actual_net_income: Decimal
    personal_fixed_deductions: Decimal
    note: str | None
    updated_at: datetime


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    owner_person_id: uuid.UUID | None = None
    institution_name: str | None = Field(default=None, max_length=120)
    iban: str | None = Field(default=None, min_length=15, max_length=34)
    account_type: AccountType = AccountType.JOINT_CHECKING
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    opening_balance: Decimal = Field(default=Decimal("0.00"), decimal_places=2)
    opening_balance_date: date = Field(default_factory=date.today)


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    owner_person_id: uuid.UUID | None
    name: str
    institution_name: str | None
    iban: str | None
    account_type: AccountType
    currency: str
    opening_balance: Decimal
    opening_balance_date: date
    is_active: bool


class AccountLiquidityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_id: uuid.UUID
    account_name: str
    currency: str
    physical_account_balance: Decimal
    reserved_sinking_funds_balance: Decimal
    overdrawn_sinking_funds_balance: Decimal
    free_disposable_liquidity: Decimal
    is_fully_backed: bool


class BudgetCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: uuid.UUID | None = None
    is_shared_expense: bool = True
    monthly_target_amount: Decimal = Field(
        default=Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
    )
    allocation_strategy_override: AllocationStrategy | None = None


class BudgetCategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    is_shared_expense: bool
    monthly_target_amount: Decimal
    allocation_strategy_override: AllocationStrategy | None
    is_active: bool


class SinkingFundCreate(BaseModel):
    backing_account_id: uuid.UUID
    category_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=120)
    payee: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=255)
    target_amount: Decimal = Field(gt=Decimal("0.00"), decimal_places=2)
    recurrence_interval: RecurrenceInterval = RecurrenceInterval.ANNUAL
    next_due_date: date
    end_date: date | None = None
    auto_accrual: bool = True
    rate_revisions: list[RateRevisionSchema] = Field(default_factory=list)
    is_shared_obligation: bool = True
    allocation_strategy_override: AllocationStrategy | None = None
    initial_carryover_amount: Decimal = Field(
        default=Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
    )


class SinkingFundUpdate(BaseModel):
    """Full or partial edit payload for PlannedPayments / SinkingFunds including end_date and rate revisions."""

    backing_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    payee: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=255)
    target_amount: Decimal | None = Field(default=None, gt=Decimal("0.00"), decimal_places=2)
    recurrence_interval: RecurrenceInterval | None = None
    next_due_date: date | None = None
    end_date: date | None = None
    auto_accrual: bool | None = None
    rate_revisions: list[RateRevisionSchema] | None = None
    is_shared_obligation: bool | None = None
    allocation_strategy_override: AllocationStrategy | None = None
    is_active: bool | None = None


class SinkingFundProvisionCreate(BaseModel):
    accrual_period_month: date
    amount: Decimal = Field(gt=Decimal("0.00"), decimal_places=2)
    entry_type: SinkingFundEntryType = SinkingFundEntryType.MONTHLY_PROVISION
    note: str | None = Field(default=None, max_length=255)


class SinkingFundSettlementRequest(BaseModel):
    booking_date: date = Field(default_factory=date.today)
    actual_invoice_amount: Decimal = Field(gt=Decimal("0.00"), decimal_places=2)
    counterparty_name: str | None = Field(default=None, max_length=200)
    purpose_text: str = Field(default="", max_length=500)
    record_bank_transaction: bool = True
    allow_pot_overdraft: bool = True


class SinkingFundLedgerEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sinking_fund_id: uuid.UUID
    linked_transaction_id: uuid.UUID | None
    accrual_period_month: date
    entry_type: SinkingFundEntryType
    amount: Decimal
    note: str | None
    created_at: datetime


class SinkingFundSettlementResponse(BaseModel):
    sinking_fund_id: uuid.UUID
    ledger_entry_id: uuid.UUID | None
    created_transaction_id: uuid.UUID | None
    actual_invoice_amount: Decimal
    pot_balance_before_settlement: Decimal
    settlement_ledger_amount: Decimal
    pot_balance_after_settlement: Decimal
    unreserved_budget_shortfall: Decimal
    pot_overdraft_amount: Decimal
    remaining_pot_surplus: Decimal
    next_cycle_due_date: date
    reached_end_date: bool


class SinkingFundWithValuationRead(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    backing_account_id: uuid.UUID
    category_id: uuid.UUID | None
    name: str
    payee: str | None
    description: str | None
    base_target_amount: Decimal
    recurrence_interval: RecurrenceInterval
    end_date: date | None
    auto_accrual: bool
    is_active: bool
    rate_revisions: list[RateRevisionSchema]
    valuation: SinkingFundValuationSchema


class PersonMonthlyPlanSummarySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    person_id: uuid.UUID
    display_name: str
    income_recorded_for_month: bool
    actual_monthly_net_income: Decimal
    personal_fixed_deductions: Decimal
    disposable_income: Decimal
    fixed_budget_contribution: Decimal
    sinking_fund_provision_contribution: Decimal
    total_monthly_contribution: Decimal
    remaining_pocket_money: Decimal


class HouseholdMonthlyPlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reference_date: date
    default_strategy: AllocationStrategy
    total_monthly_budgets: Decimal
    total_monthly_sinking_provisions: Decimal
    total_shared_obligation: Decimal
    sinking_fund_valuations: list[SinkingFundValuationSchema]
    strategy_breakdowns: list[AllocationCalculationResponse]
    person_summaries: list[PersonMonthlyPlanSummarySchema]


class HealthReadinessResponse(BaseModel):
    status: str
    app_name: str
    database_reachable: bool
