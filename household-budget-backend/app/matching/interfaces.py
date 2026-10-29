from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Protocol, runtime_checkable

from app.models.enums import MatchSource, TransactionDirection


@dataclass(frozen=True, slots=True)
class TransactionCandidate:
    """Normalized statement transaction passed into TransactionMatcherInterface stages."""

    account_id: uuid.UUID
    booking_date: date
    amount: Decimal
    currency: str
    counterparty_name: str | None
    counterparty_iban: str | None
    purpose_text: str


@dataclass(frozen=True, slots=True)
class TransactionMatchDecision:
    """Classification output produced by a TransactionMatcherInterface implementation."""

    direction: TransactionDirection
    match_source: MatchSource
    confidence: Decimal
    counterpart_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    sinking_fund_id: uuid.UUID | None = None
    paid_by_person_id: uuid.UUID | None = None
    matched_rule_id: uuid.UUID | None = None


@runtime_checkable
class TransactionMatcherInterface(Protocol):
    """
    Asynchronous contract for transaction classification stages.
    Async by design so deterministic in-memory matchers (Own-IBAN, Regex) and future
    external I/O matchers (LLM / AI categorization) share the exact same pipeline.
    """

    async def match(
        self,
        candidate: TransactionCandidate,
    ) -> TransactionMatchDecision | None:
        """Return a classification decision if matched, or None to pass to the next stage."""
        raise NotImplementedError
