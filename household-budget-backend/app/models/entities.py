from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import (
    AccountType,
    AllocationStrategy,
    DuplicateMatchKind,
    ImportBatchStatus,
    ImportCommitMode,
    ImportRowStatus,
    MatchSource,
    RecurrenceInterval,
    RuleMatchField,
    SinkingFundEntryType,
    SupportedLocale,
    TransactionDirection,
    UserRole,
)

MONEY_PRECISION = 14
MONEY_SCALE = 2


class Tenant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """
    Root multi-tenancy boundary representing a single self-contained Household.
    Separates master data Persons from authenticated system Users.
    """

    __tablename__ = "tenants"
    __table_args__ = (
        CheckConstraint("char_length(default_currency) = 3", name="currency_iso4217_len"),
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    default_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    default_locale: Mapped[SupportedLocale] = mapped_column(
        SqlEnum(SupportedLocale, native_enum=False, length=16),
        nullable=False,
        default=SupportedLocale.DE,
    )
    default_allocation_strategy: Mapped[AllocationStrategy] = mapped_column(
        SqlEnum(AllocationStrategy, native_enum=False, length=32),
        nullable=False,
        default=AllocationStrategy.EQUAL_REMAINING,
    )
    default_import_commit_mode: Mapped[ImportCommitMode] = mapped_column(
        SqlEnum(ImportCommitMode, native_enum=False, length=32),
        nullable=False,
        default=ImportCommitMode.TWO_STAGE_PREVIEW,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    persons: Mapped[list[Person]] = relationship(
        back_populates="tenant",
        cascade="all, delete-orphan",
    )
    users: Mapped[list[User]] = relationship(
        back_populates="tenant",
        cascade="all, delete-orphan",
    )
    accounts: Mapped[list[Account]] = relationship(
        back_populates="tenant",
        cascade="all, delete-orphan",
    )
    categories: Mapped[list[BudgetCategory]] = relationship(
        back_populates="tenant",
        cascade="all, delete-orphan",
    )
    sinking_funds: Mapped[list[SinkingFund]] = relationship(
        back_populates="tenant",
        cascade="all, delete-orphan",
    )


class Person(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Household member master record (Stammdaten).
    Exists independently of system logins so non-login members or dependents can be modeled.
    Actual variable monthly net income is recorded month-by-month in `PersonMonthlyIncome`.
    """

    __tablename__ = "persons"
    __table_args__ = (
        UniqueConstraint("tenant_id", "display_name", name="uq_persons_tenant_display_name"),
        CheckConstraint("monthly_net_income >= 0", name="net_income_non_negative"),
        CheckConstraint(
            "fixed_personal_deductions >= 0",
            name="personal_deductions_non_negative",
        ),
        CheckConstraint(
            "custom_allocation_weight IS NULL OR (custom_allocation_weight >= 0 AND custom_allocation_weight <= 1)",
            name="custom_weight_unit_interval",
        ),
    )

    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_employed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    participates_in_shared_split: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    monthly_net_income: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
        default=Decimal("0.00"),
        doc="Optional reference value; month-specific splits prioritize PersonMonthlyIncome.",
    )
    fixed_personal_deductions: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
        default=Decimal("0.00"),
    )
    custom_allocation_weight: Mapped[Decimal | None] = mapped_column(
        Numeric(6, 5),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    tenant: Mapped[Tenant] = relationship(back_populates="persons")
    user_account: Mapped[User | None] = relationship(
        back_populates="person",
        uselist=False,
    )
    monthly_incomes: Mapped[list[PersonMonthlyIncome]] = relationship(
        back_populates="person",
        cascade="all, delete-orphan",
        order_by="PersonMonthlyIncome.period_month.desc()",
    )
    owned_accounts: Mapped[list[Account]] = relationship(back_populates="owner_person")
    paid_transactions: Mapped[list[Transaction]] = relationship(back_populates="paid_by_person")


class PersonMonthlyIncome(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Month-specific actual net income record (YYYY-MM-01) for a household Person.
    Enables fresh monthly entry of variable salaries, bonuses, overtime, or parental benefit
    and drives exact month-by-month household expense splits.
    """

    __tablename__ = "person_monthly_incomes"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "person_id",
            "period_month",
            name="uq_person_monthly_income_period",
        ),
        CheckConstraint("actual_net_income >= 0", name="monthly_actual_net_non_negative"),
        CheckConstraint(
            "personal_fixed_deductions >= 0",
            name="monthly_personal_ded_non_negative",
        ),
        Index(
            "ix_person_monthly_incomes_tenant_period",
            "tenant_id",
            "period_month",
        ),
    )

    person_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("persons.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    period_month: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        doc="Normalized to the first day of the calendar month (YYYY-MM-01).",
    )
    actual_net_income: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
    )
    personal_fixed_deductions: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
        default=Decimal("0.00"),
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    person: Mapped[Person] = relationship(back_populates="monthly_incomes")


class User(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Authenticated system login identity.
    Supports Forward-Auth via Reverse Proxy ('X-Forwarded-User' -> external_subject)
    as well as local JWT authentication via password_hash.
    """

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("external_subject", name="uq_users_external_subject"),
        UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
        UniqueConstraint("person_id", name="uq_users_person_id"),
    )

    person_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("persons.id", ondelete="SET NULL"),
        nullable=True,
    )
    external_subject: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
        index=True,
        doc="Identifier matched against X-Forwarded-User header (Pangolin/Newt) or JWT sub.",
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        SqlEnum(UserRole, native_enum=False, length=24),
        nullable=False,
        default=UserRole.MEMBER,
    )
    preferred_locale: Mapped[SupportedLocale] = mapped_column(
        SqlEnum(SupportedLocale, native_enum=False, length=16),
        nullable=False,
        default=SupportedLocale.DE,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    tenant: Mapped[Tenant] = relationship(back_populates="users")
    person: Mapped[Person | None] = relationship(back_populates="user_account")


class Account(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Physical bank account or household clearing account.
    When owner_person_id is NULL, the account is treated as a shared household account.
    """

    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_accounts_tenant_name"),
        UniqueConstraint("tenant_id", "iban", name="uq_accounts_tenant_iban"),
        CheckConstraint("char_length(currency) = 3", name="account_currency_iso4217_len"),
    )

    owner_person_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("persons.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    institution_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    iban: Mapped[str | None] = mapped_column(String(34), nullable=True)
    account_type: Mapped[AccountType] = mapped_column(
        SqlEnum(AccountType, native_enum=False, length=32),
        nullable=False,
        default=AccountType.JOINT_CHECKING,
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    opening_balance: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
        default=Decimal("0.00"),
    )
    opening_balance_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    tenant: Mapped[Tenant] = relationship(back_populates="accounts")
    owner_person: Mapped[Person | None] = relationship(back_populates="owned_accounts")
    sinking_funds: Mapped[list[SinkingFund]] = relationship(back_populates="backing_account")
    transactions: Mapped[list[Transaction]] = relationship(
        back_populates="account",
        foreign_keys="Transaction.account_id",
        cascade="all, delete-orphan",
    )


class BudgetCategory(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """Hierarchical budget category for monthly recurring household or personal budgets."""

    __tablename__ = "budget_categories"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_budget_categories_tenant_name"),
        CheckConstraint(
            "monthly_target_amount >= 0",
            name="category_monthly_target_non_negative",
        ),
    )

    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_shared_expense: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    monthly_target_amount: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
        default=Decimal("0.00"),
    )
    allocation_strategy_override: Mapped[AllocationStrategy | None] = mapped_column(
        SqlEnum(AllocationStrategy, native_enum=False, length=32),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    tenant: Mapped[Tenant] = relationship(back_populates="categories")
    parent: Mapped[BudgetCategory | None] = relationship(
        remote_side="BudgetCategory.id",
        back_populates="children",
    )
    children: Mapped[list[BudgetCategory]] = relationship(back_populates="parent")
    sinking_funds: Mapped[list[SinkingFund]] = relationship(back_populates="category")
    transactions: Mapped[list[Transaction]] = relationship(back_populates="category")


class SinkingFund(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Planned payment & virtual savings pot (Geplante Zahlung / Virtueller Anspartopf).
    Supports optional `end_date` (stops provisions immediately after the last due date
    on or before `end_date` while retaining residual pot balance for manual reallocation)
    and effective-dated `rate_revisions` (`Gültig-ab` amount changes).
    """

    __tablename__ = "sinking_funds"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_sinking_funds_tenant_name"),
        CheckConstraint("target_amount > 0", name="sinking_fund_target_positive"),
    )

    backing_account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    payee: Mapped[str | None] = mapped_column(String(160), nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_amount: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
    )
    recurrence_interval: Mapped[RecurrenceInterval] = mapped_column(
        SqlEnum(RecurrenceInterval, native_enum=False, length=24),
        nullable=False,
        default=RecurrenceInterval.ANNUAL,
    )
    next_due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
        index=True,
        doc="Optional contract/payment end date. Once next_due_date > end_date, saving stops immediately.",
    )
    auto_accrual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_shared_obligation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allocation_strategy_override: Mapped[AllocationStrategy | None] = mapped_column(
        SqlEnum(AllocationStrategy, native_enum=False, length=32),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    tenant: Mapped[Tenant] = relationship(back_populates="sinking_funds")
    backing_account: Mapped[Account] = relationship(back_populates="sinking_funds")
    category: Mapped[BudgetCategory | None] = relationship(back_populates="sinking_funds")
    rate_revisions: Mapped[list[SinkingFundRateRevision]] = relationship(
        back_populates="sinking_fund",
        cascade="all, delete-orphan",
        order_by="SinkingFundRateRevision.valid_from.asc()",
        lazy="selectin",
    )
    ledger_entries: Mapped[list[SinkingFundLedgerEntry]] = relationship(
        back_populates="sinking_fund",
        cascade="all, delete-orphan",
    )
    settled_transactions: Mapped[list[Transaction]] = relationship(back_populates="sinking_fund")


class SinkingFundRateRevision(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Effective-dated amount revision (`Gültig-ab` Preisstaffel) for a PlannedPayment / SinkingFund.
    Allows scheduling future rent, insurance, or fee adjustments without overwriting past months.
    """

    __tablename__ = "sinking_fund_rate_revisions"
    __table_args__ = (
        UniqueConstraint(
            "sinking_fund_id",
            "valid_from",
            name="uq_sinking_fund_rate_revision_valid_from",
        ),
        CheckConstraint("amount > 0", name="sinking_fund_revision_amount_positive"),
    )

    sinking_fund_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sinking_funds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    sinking_fund: Mapped[SinkingFund] = relationship(back_populates="rate_revisions")


class SinkingFundLedgerEntry(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Immutable accrual ledger entry inside a SinkingFund virtual pot.
    Supports VIRTUAL_POT_REALLOCATION via `reallocation_group_id` (paired -/+ entries across
    two virtual pots without any physical bank transaction).
    """

    __tablename__ = "sinking_fund_ledger_entries"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="sinking_ledger_nonzero_amount"),
        Index(
            "ix_sinking_ledger_fund_period",
            "tenant_id",
            "sinking_fund_id",
            "accrual_period_month",
        ),
    )

    sinking_fund_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sinking_funds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    linked_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("transactions.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    reallocation_group_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
        index=True,
        doc="Shared UUID linking the debit and credit leg of a virtual pot-to-pot reallocation.",
    )
    accrual_period_month: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        doc="Normalized to the first day of the calendar month (YYYY-MM-01).",
    )
    entry_type: Mapped[SinkingFundEntryType] = mapped_column(
        SqlEnum(SinkingFundEntryType, native_enum=False, length=32),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    sinking_fund: Mapped[SinkingFund] = relationship(back_populates="ledger_entries")
    linked_transaction: Mapped[Transaction | None] = relationship(
        back_populates="sinking_ledger_entry",
    )


class MatchingRule(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Deterministic Regex/amount rule evaluated by TransactionMatcherInterface
    during bank statement imports before optional AI classification.
    """

    __tablename__ = "matching_rules"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_matching_rules_tenant_name"),
        CheckConstraint("priority >= 0", name="matching_rule_priority_non_negative"),
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    priority: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=100,
        doc="Lower integer values are evaluated first.",
    )
    match_field: Mapped[RuleMatchField] = mapped_column(
        SqlEnum(RuleMatchField, native_enum=False, length=32),
        nullable=False,
        default=RuleMatchField.COMBINED_TEXT,
    )
    regex_pattern: Mapped[str] = mapped_column(String(500), nullable=False)
    case_sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    min_abs_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=True,
    )
    max_abs_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=True,
    )
    target_category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_sinking_fund_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sinking_funds.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_person_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("persons.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Transaction(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Physical bank statement or cashflow transaction.
    Distinguishes real inter-account bank transfers (`counterpart_account_id` +
    `direction=PHYSICAL_ACCOUNT_TRANSFER`) from virtual sinking fund movements.
    """

    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "account_id",
            "import_dedup_hash",
            name="uq_transactions_account_dedup_hash",
        ),
        CheckConstraint("char_length(currency) = 3", name="tx_currency_iso4217_len"),
        CheckConstraint("amount <> 0", name="tx_nonzero_amount"),
        Index("ix_transactions_tenant_booking_date", "tenant_id", "booking_date"),
        Index("ix_transactions_tenant_needs_review", "tenant_id", "needs_review"),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    counterpart_account_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("accounts.id", ondelete="SET NULL"),
        nullable=True,
        doc="Populated when direction is PHYSICAL_ACCOUNT_TRANSFER between own household accounts.",
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sinking_fund_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sinking_funds.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    paid_by_person_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("persons.id", ondelete="SET NULL"),
        nullable=True,
    )
    matched_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("matching_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("import_batches.id", ondelete="SET NULL"),
        nullable=True,
    )

    booking_date: Mapped[date] = mapped_column(Date, nullable=False)
    value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal] = mapped_column(
        Numeric(MONEY_PRECISION, MONEY_SCALE),
        nullable=False,
        doc="Signed monetary value: negative for outflows, positive for inflows.",
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    direction: Mapped[TransactionDirection] = mapped_column(
        SqlEnum(TransactionDirection, native_enum=False, length=32),
        nullable=False,
    )

    counterparty_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    counterparty_iban: Mapped[str | None] = mapped_column(String(34), nullable=True)
    purpose_text: Mapped[str] = mapped_column(Text, nullable=False, default="")

    match_source: Mapped[MatchSource] = mapped_column(
        SqlEnum(MatchSource, native_enum=False, length=24),
        nullable=False,
        default=MatchSource.UNMATCHED,
    )
    match_confidence: Mapped[Decimal | None] = mapped_column(
        Numeric(4, 3),
        nullable=True,
    )
    needs_review: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        doc="True when imported via DIRECT_WITH_REVIEW_FLAG; defers virtual pot settlement until approved.",
    )
    import_dedup_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    account: Mapped[Account] = relationship(
        back_populates="transactions",
        foreign_keys=[account_id],
    )
    counterpart_account: Mapped[Account | None] = relationship(
        foreign_keys=[counterpart_account_id],
    )
    category: Mapped[BudgetCategory | None] = relationship(back_populates="transactions")
    sinking_fund: Mapped[SinkingFund | None] = relationship(
        back_populates="settled_transactions",
    )
    paid_by_person: Mapped[Person | None] = relationship(back_populates="paid_transactions")
    sinking_ledger_entry: Mapped[SinkingFundLedgerEntry | None] = relationship(
        back_populates="linked_transaction",
        uselist=False,
    )


class ImportBatch(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Represents a statement file upload session supporting two-stage preview (`TWO_STAGE_PREVIEW`)
    as well as audit tracking for direct commit modes.
    """

    __tablename__ = "import_batches"

    account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    parser_key: Mapped[str] = mapped_column(String(64), nullable=False)
    commit_mode: Mapped[ImportCommitMode] = mapped_column(
        SqlEnum(ImportCommitMode, native_enum=False, length=32),
        nullable=False,
    )
    status: Mapped[ImportBatchStatus] = mapped_column(
        SqlEnum(ImportBatchStatus, native_enum=False, length=32),
        nullable=False,
        default=ImportBatchStatus.PENDING_CONFIRMATION,
    )
    total_rows_parsed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duplicate_rows_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    committed_rows_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    staging_rows: Mapped[list[ImportStagingRow]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="ImportStagingRow.row_number.asc()",
    )


class ImportStagingRow(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """
    Staged statement row produced during `TWO_STAGE_PREVIEW` before final ledger commit.
    """

    __tablename__ = "import_staging_rows"
    __table_args__ = (
        UniqueConstraint("batch_id", "row_number", name="uq_staging_batch_row_number"),
    )

    batch_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("import_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    row_status: Mapped[ImportRowStatus] = mapped_column(
        SqlEnum(ImportRowStatus, native_enum=False, length=32),
        nullable=False,
        default=ImportRowStatus.READY,
    )

    booking_date: Mapped[date] = mapped_column(Date, nullable=False)
    value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(MONEY_PRECISION, MONEY_SCALE), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    counterparty_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    counterparty_iban: Mapped[str | None] = mapped_column(String(34), nullable=True)
    purpose_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    import_dedup_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    duplicate_match_kind: Mapped[DuplicateMatchKind] = mapped_column(
        SqlEnum(DuplicateMatchKind, native_enum=False, length=24),
        nullable=False,
        default=DuplicateMatchKind.NONE,
    )
    duplicate_of_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("transactions.id", ondelete="SET NULL"),
        nullable=True,
    )
    duplicate_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    proposed_direction: Mapped[TransactionDirection] = mapped_column(
        SqlEnum(TransactionDirection, native_enum=False, length=32),
        nullable=False,
    )
    proposed_counterpart_account_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("accounts.id", ondelete="SET NULL"),
        nullable=True,
    )
    proposed_category_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("budget_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    proposed_sinking_fund_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sinking_funds.id", ondelete="SET NULL"),
        nullable=True,
    )
    proposed_person_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("persons.id", ondelete="SET NULL"),
        nullable=True,
    )
    matched_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("matching_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    match_source: Mapped[MatchSource] = mapped_column(
        SqlEnum(MatchSource, native_enum=False, length=24),
        nullable=False,
        default=MatchSource.UNMATCHED,
    )
    match_confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3), nullable=True)

    batch: Mapped[ImportBatch] = relationship(back_populates="staging_rows")
