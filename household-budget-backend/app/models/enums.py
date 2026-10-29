from __future__ import annotations

from enum import StrEnum


class SupportedLocale(StrEnum):
    """Supported application locales for i18n and Intl formatting."""

    DE = "de-DE"
    EN = "en-US"


class UserRole(StrEnum):
    """Authorization role of a system login within a household tenant."""

    ADMIN = "ADMIN"
    MEMBER = "MEMBER"
    VIEWER = "VIEWER"


class AllocationStrategy(StrEnum):
    """Supported expense split algorithms for shared household obligations."""

    FIFTY_FIFTY = "FIFTY_FIFTY"
    PROPORTIONAL = "PROPORTIONAL"
    EQUAL_REMAINING = "EQUAL_REMAINING"
    CUSTOM_WEIGHT = "CUSTOM_WEIGHT"


class AccountType(StrEnum):
    """Classification of physical or clearing accounts within a household."""

    JOINT_CHECKING = "JOINT_CHECKING"
    PERSONAL_CHECKING = "PERSONAL_CHECKING"
    SAVINGS_RESERVE = "SAVINGS_RESERVE"
    CASH_CLEARING = "CASH_CLEARING"


class RecurrenceInterval(StrEnum):
    """Billing cadence for recurring expenses, one-time targets, and sinking fund accruals."""

    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    SEMI_ANNUAL = "SEMI_ANNUAL"
    ANNUAL = "ANNUAL"
    BIENNIAL = "BIENNIAL"
    ONE_TIME = "ONE_TIME"

    @property
    def months_in_cycle(self) -> int:
        mapping: dict[RecurrenceInterval, int] = {
            RecurrenceInterval.MONTHLY: 1,
            RecurrenceInterval.QUARTERLY: 3,
            RecurrenceInterval.SEMI_ANNUAL: 6,
            RecurrenceInterval.ANNUAL: 12,
            RecurrenceInterval.BIENNIAL: 24,
            RecurrenceInterval.ONE_TIME: 0,
        }
        return mapping[self]


class SinkingFundLifecycleFilter(StrEnum):
    """Filter state for active versus end-date-expired/archived planned obligations."""

    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"
    ALL = "ALL"


class SinkingFundEntryType(StrEnum):
    """
    Movement type inside a virtual sinking fund (virtueller Anspartopf).
    Note: VIRTUAL_POT_REALLOCATION shifts virtual reserves between pots without
    any physical bank account money movement.
    """

    MONTHLY_PROVISION = "MONTHLY_PROVISION"
    INITIAL_CARRYOVER = "INITIAL_CARRYOVER"
    MANUAL_ADJUSTMENT = "MANUAL_ADJUSTMENT"
    VIRTUAL_POT_REALLOCATION = "VIRTUAL_POT_REALLOCATION"
    EXPENSE_SETTLEMENT = "EXPENSE_SETTLEMENT"


class TransactionDirection(StrEnum):
    """
    Accounting flow direction of a physical bank or cash ledger transaction.
    PHYSICAL_ACCOUNT_TRANSFER denotes real money moving between two household bank accounts,
    strictly distinct from virtual sinking fund reallocations.
    """

    INFLOW = "INFLOW"
    OUTFLOW = "OUTFLOW"
    PHYSICAL_ACCOUNT_TRANSFER = "PHYSICAL_ACCOUNT_TRANSFER"


class MatchSource(StrEnum):
    """Origin of classification on an imported or manual transaction."""

    UNMATCHED = "UNMATCHED"
    MANUAL = "MANUAL"
    OWN_IBAN_DETECTOR = "OWN_IBAN_DETECTOR"
    REGEX_RULE = "REGEX_RULE"
    AI_CLASSIFIER = "AI_CLASSIFIER"


class RuleMatchField(StrEnum):
    """Statement field inspected by a deterministic Regex matching rule."""

    COUNTERPARTY_NAME = "COUNTERPARTY_NAME"
    COUNTERPARTY_IBAN = "COUNTERPARTY_IBAN"
    PURPOSE_TEXT = "PURPOSE_TEXT"
    COMBINED_TEXT = "COMBINED_TEXT"


class ImportCommitMode(StrEnum):
    """
    Configurable workflow behavior when importing bank statements:
    - TWO_STAGE_PREVIEW: Stage rows first; require explicit confirmation before ledger commit (Default).
    - DIRECT_WITH_REVIEW_FLAG: Commit transactions immediately with `needs_review=True` and defer pot release.
    - DIRECT_AUTO_COMMIT: Commit transactions immediately (`needs_review=False`) and settle matched pots.
    """

    TWO_STAGE_PREVIEW = "TWO_STAGE_PREVIEW"
    DIRECT_WITH_REVIEW_FLAG = "DIRECT_WITH_REVIEW_FLAG"
    DIRECT_AUTO_COMMIT = "DIRECT_AUTO_COMMIT"


class ImportBatchStatus(StrEnum):
    """Lifecycle state of a bank statement import batch."""

    PENDING_CONFIRMATION = "PENDING_CONFIRMATION"
    COMMITTED = "COMMITTED"
    DISCARDED = "DISCARDED"


class ImportRowStatus(StrEnum):
    """Disposition of an individual parsed row within an ImportBatch."""

    READY = "READY"
    DUPLICATE_SKIPPED = "DUPLICATE_SKIPPED"
    EXCLUDED = "EXCLUDED"
    COMMITTED = "COMMITTED"


class DuplicateMatchKind(StrEnum):
    """Distinguishes exact SHA-256 fingerprint duplicates from semantic double-booking matches."""

    NONE = "NONE"
    EXACT_HASH = "EXACT_HASH"
    SEMANTIC_MATCH = "SEMANTIC_MATCH"

