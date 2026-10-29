from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import (
    DuplicateMatchKind,
    ImportBatchStatus,
    ImportCommitMode,
    ImportRowStatus,
    MatchSource,
    RuleMatchField,
    TransactionDirection,
)
from app.schemas.api import SinkingFundLedgerEntryRead


class MatchingRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    priority: int = Field(default=100, ge=0, le=10000)
    match_field: RuleMatchField = RuleMatchField.COMBINED_TEXT
    regex_pattern: str = Field(min_length=1, max_length=500)
    case_sensitive: bool = False
    min_abs_amount: Decimal | None = Field(default=None, ge=Decimal("0.00"), decimal_places=2)
    max_abs_amount: Decimal | None = Field(default=None, ge=Decimal("0.00"), decimal_places=2)
    target_category_id: uuid.UUID | None = None
    target_sinking_fund_id: uuid.UUID | None = None
    target_person_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def validate_amount_bounds(self) -> MatchingRuleCreate:
        if (
            self.min_abs_amount is not None
            and self.max_abs_amount is not None
            and self.min_abs_amount > self.max_abs_amount
        ):
            raise ValueError("min_abs_amount must be less than or equal to max_abs_amount.")
        return self


class MatchingRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    priority: int
    match_field: RuleMatchField
    regex_pattern: str
    case_sensitive: bool
    min_abs_amount: Decimal | None
    max_abs_amount: Decimal | None
    target_category_id: uuid.UUID | None
    target_sinking_fund_id: uuid.UUID | None
    target_person_id: uuid.UUID | None
    is_active: bool


class VirtualPotReallocationRequest(BaseModel):
    """
    Purely virtual transfer of accrued reserves between two SinkingFunds.
    Does NOT generate a physical bank Transaction. Target pot may have a negative (overdrawn) balance.
    """

    source_sinking_fund_id: uuid.UUID
    target_sinking_fund_id: uuid.UUID
    amount: Decimal = Field(gt=Decimal("0.00"), decimal_places=2)
    effective_date: date = Field(default_factory=date.today)
    note: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def ensure_distinct_pots(self) -> VirtualPotReallocationRequest:
        if self.source_sinking_fund_id == self.target_sinking_fund_id:
            raise ValueError("source_sinking_fund_id and target_sinking_fund_id must differ.")
        return self


class VirtualPotReallocationResponse(BaseModel):
    reallocation_group_id: uuid.UUID
    debit_entry: SinkingFundLedgerEntryRead
    credit_entry: SinkingFundLedgerEntryRead
    source_remaining_balance: Decimal
    target_new_balance: Decimal


class ImportStagingRowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    row_number: int
    row_status: ImportRowStatus
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    counterparty_name: str | None
    counterparty_iban: str | None
    purpose_text: str
    duplicate_match_kind: DuplicateMatchKind
    duplicate_of_transaction_id: uuid.UUID | None
    duplicate_reason: str | None
    proposed_direction: TransactionDirection
    proposed_counterpart_account_id: uuid.UUID | None
    proposed_category_id: uuid.UUID | None
    proposed_sinking_fund_id: uuid.UUID | None
    proposed_person_id: uuid.UUID | None
    matched_rule_id: uuid.UUID | None
    match_source: MatchSource
    match_confidence: Decimal | None


class ImportStagingRowOverride(BaseModel):
    """Optional user adjustments per staged row when confirming a TWO_STAGE_PREVIEW batch."""

    staging_row_id: uuid.UUID
    exclude: bool = False
    force_commit_duplicate: bool = False
    direction: TransactionDirection | None = None
    counterpart_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    sinking_fund_id: uuid.UUID | None = None
    paid_by_person_id: uuid.UUID | None = None


class ImportBatchCommitRequest(BaseModel):
    """Confirmation payload for committing a staged preview batch to the ledger."""

    mark_needs_review: bool = False
    row_overrides: list[ImportStagingRowOverride] = Field(default_factory=list)


class TransactionManualCreate(BaseModel):
    """
    Manual entry of an actual bank/cash transaction into the ledger journal.
    Supports debiting an uncovered virtual sinking fund (`sinking_fund_id`) even if its balance <= 0.
    """

    account_id: uuid.UUID
    booking_date: date
    value_date: date | None = None
    amount: Decimal = Field(decimal_places=2)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    direction: TransactionDirection = TransactionDirection.OUTFLOW
    counterpart_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    sinking_fund_id: uuid.UUID | None = None
    paid_by_person_id: uuid.UUID | None = None
    counterparty_name: str | None = Field(default=None, max_length=200)
    counterparty_iban: str | None = Field(default=None, max_length=34)
    purpose_text: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def validate_nonzero_amount(self) -> TransactionManualCreate:
        if self.amount == Decimal("0.00"):
            raise ValueError("Transaction amount must be non-zero.")
        return self


class TransactionClassificationUpdate(BaseModel):
    """
    Inline reclassification or virtual pot assignment for an existing actual transaction.
    Synchronizes the 1:1 `SinkingFundLedgerEntry` automatically (including uncovered pots).
    """

    category_id: uuid.UUID | None = None
    sinking_fund_id: uuid.UUID | None = None
    paid_by_person_id: uuid.UUID | None = None
    needs_review: bool | None = None


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    account_id: uuid.UUID
    counterpart_account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    sinking_fund_id: uuid.UUID | None
    paid_by_person_id: uuid.UUID | None
    matched_rule_id: uuid.UUID | None
    import_batch_id: uuid.UUID | None
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    direction: TransactionDirection
    counterparty_name: str | None
    counterparty_iban: str | None
    purpose_text: str
    match_source: MatchSource
    match_confidence: Decimal | None
    needs_review: bool
    created_at: datetime


class ImportBatchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    account_id: uuid.UUID
    source_filename: str
    parser_key: str
    commit_mode: ImportCommitMode
    status: ImportBatchStatus
    total_rows_parsed: int
    duplicate_rows_skipped: int
    committed_rows_count: int
    created_at: datetime
    staging_rows: list[ImportStagingRowRead] = Field(default_factory=list)


class TransactionReviewApprovalResponse(BaseModel):
    transaction: TransactionRead
    settled_sinking_fund_entry: SinkingFundLedgerEntryRead | None = None
