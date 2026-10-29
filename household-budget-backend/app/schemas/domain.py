from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AllocationStrategy, RecurrenceInterval


class ParticipantProfileSchema(BaseModel):
    """Pydantic v2 input schema for a household Person in allocation simulations."""

    model_config = ConfigDict(from_attributes=True)

    person_id: uuid.UUID
    display_name: str = Field(min_length=1, max_length=100)
    is_employed: bool = True
    participates_in_shared_split: bool = True
    monthly_net_income: Decimal = Field(ge=Decimal("0.00"), decimal_places=2)
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


class AllocationCalculationRequest(BaseModel):
    """Request payload for standalone AllocationEngine calculation."""

    strategy: AllocationStrategy
    total_shared_expenses: Decimal = Field(ge=Decimal("0.00"), decimal_places=2)
    allow_compensation_transfer: bool = False
    participants: list[ParticipantProfileSchema] = Field(min_length=1)


class PersonAllocationShareSchema(BaseModel):
    """Serialized per-person result from AllocationEngine."""

    model_config = ConfigDict(from_attributes=True)

    person_id: uuid.UUID
    display_name: str
    monthly_net_income: Decimal
    fixed_personal_deductions: Decimal
    disposable_income: Decimal
    contribution_amount: Decimal
    effective_share_ratio: Decimal
    remaining_pocket_money: Decimal
    requires_compensation_transfer: bool


class AllocationCalculationResponse(BaseModel):
    """Serialized household split calculation response."""

    model_config = ConfigDict(from_attributes=True)

    strategy: AllocationStrategy
    total_shared_expenses: Decimal
    combined_disposable_income: Decimal
    combined_remaining_pocket_money: Decimal
    shares: list[PersonAllocationShareSchema]


class RateRevisionSchema(BaseModel):
    """Effective-dated payment amount revision (`Gültig-ab` Preisstaffel)."""

    model_config = ConfigDict(from_attributes=True)

    valid_from: date
    amount: Decimal = Field(gt=Decimal("0.00"), decimal_places=2)
    note: str | None = Field(default=None, max_length=255)


class SinkingFundValuationSchema(BaseModel):
    """Serialized monthly valuation of a planned payment / virtual sinking fund."""

    model_config = ConfigDict(from_attributes=True)

    sinking_fund_id: uuid.UUID
    backing_account_id: uuid.UUID
    name: str
    target_amount: Decimal
    current_virtual_balance: Decimal
    is_overdrawn: bool
    overdraft_amount: Decimal
    remaining_funding_gap: Decimal
    funded_ratio: Decimal
    standard_cyclical_monthly_rate: Decimal
    recommended_monthly_provision: Decimal
    months_until_due: int
    next_due_date: date
    end_date: date | None
    is_expired_by_end_date: bool
    has_unallocated_residual_balance: bool
    is_shared_obligation: bool
    is_catchup_required: bool
    allocation_strategy_override: AllocationStrategy | None



class SinkingFundInputSchema(BaseModel):
    """Input schema for evaluating a virtual sinking fund."""

    model_config = ConfigDict(from_attributes=True)

    sinking_fund_id: uuid.UUID
    backing_account_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    target_amount: Decimal = Field(gt=Decimal("0.00"), decimal_places=2)
    recurrence_interval: RecurrenceInterval
    next_due_date: date
    end_date: date | None = None
    auto_accrual: bool = True
    rate_revisions: list[RateRevisionSchema] = Field(default_factory=list)
    current_virtual_balance: Decimal = Field(default=Decimal("0.00"), decimal_places=2)
    is_shared_obligation: bool = True
    allocation_strategy_override: AllocationStrategy | None = None
