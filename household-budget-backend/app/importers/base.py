from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Protocol, runtime_checkable

from app.domain.exceptions import DomainError


class StatementParseError(DomainError):
    """Raised when an uploaded bank statement cannot be decoded or fails structural checks."""

    def __init__(self, message: str, *, line_number: int | None = None) -> None:
        details: dict[str, int] = {}
        if line_number is not None:
            details["line_number"] = line_number
        super().__init__(
            message,
            error_code="STATEMENT_PARSE_ERROR",
            details=details,
        )


def normalize_iban(raw_iban: str | None) -> str | None:
    """Strip whitespace and uppercase an IBAN string; return None if blank."""
    if raw_iban is None:
        return None
    cleaned = "".join(raw_iban.split()).upper()
    return cleaned if cleaned else None


def compute_statement_dedup_hash(
    *,
    booking_date: date,
    value_date: date | None,
    amount: Decimal,
    currency: str,
    counterparty_name: str | None,
    counterparty_iban: str | None,
    purpose_text: str,
    occurrence_index: int,
) -> str:
    """
    Generate a deterministic SHA-256 fingerprint for idempotent CSV imports.
    `occurrence_index` (1-based among identical rows in the same statement day)
    allows two genuinely identical same-day card payments to coexist while still
    skipping both if an overlapping CSV export is uploaded again later.
    """
    canonical = "|".join(
        [
            booking_date.isoformat(),
            value_date.isoformat() if value_date is not None else "",
            f"{amount:.2f}",
            currency.upper().strip(),
            (counterparty_name or "").strip().lower(),
            (normalize_iban(counterparty_iban) or ""),
            " ".join(purpose_text.split()).lower(),
            str(occurrence_index),
        ]
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class NormalizedStatementRow:
    """Canonical bank statement record independent of source file format."""

    row_number: int
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    counterparty_name: str | None
    counterparty_iban: str | None
    purpose_text: str
    import_dedup_hash: str


@dataclass(frozen=True, slots=True)
class StatementParseResult:
    """Output of a StatementParserInterface implementation."""

    parser_key: str
    detected_account_iban: str | None
    rows: tuple[NormalizedStatementRow, ...]
    skipped_pending_or_zero_count: int


@runtime_checkable
class StatementParserInterface(Protocol):
    """
    Pluggable parser contract for bank statements.
    Starts with DKB CSV; additional CSV profiles, XLSX, or CAMT.053 parsers implement this protocol.
    """

    @property
    def parser_key(self) -> str:
        """Unique identifier for this parser (e.g. 'dkb_csv')."""
        raise NotImplementedError

    def can_parse(self, filename: str, raw_bytes: bytes) -> bool:
        """Inspect filename and header bytes to detect format compatibility."""
        raise NotImplementedError

    def parse(
        self,
        raw_bytes: bytes,
        *,
        include_pending: bool = False,
    ) -> StatementParseResult:
        """Parse raw uploaded bytes into normalized, deduplication-hashed rows."""
        raise NotImplementedError


class StatementParserRegistry:
    """Registry managing pluggable bank statement parsers with explicit or auto-detected routing."""

    def __init__(self) -> None:
        self._parsers: dict[str, StatementParserInterface] = {}

    def register(self, parser: StatementParserInterface) -> None:
        self._parsers[parser.parser_key] = parser

    def resolve(
        self,
        *,
        parser_key: str | None,
        filename: str,
        raw_bytes: bytes,
    ) -> StatementParserInterface:
        if parser_key and parser_key != "auto":
            parser = self._parsers.get(parser_key)
            if parser is None:
                raise StatementParseError(
                    f"Unknown statement parser '{parser_key}'. Registered parsers: {sorted(self._parsers.keys())}."
                )
            return parser

        for candidate in self._parsers.values():
            if candidate.can_parse(filename, raw_bytes):
                return candidate

        raise StatementParseError(
            f"Could not automatically detect statement format for '{filename}'."
        )
