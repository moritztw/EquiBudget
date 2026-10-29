from __future__ import annotations

import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal

from app.domain.exceptions import DomainValidationError
from app.domain.money import ZERO
from app.importers.base import normalize_iban
from app.matching.interfaces import (
    TransactionCandidate,
    TransactionMatchDecision,
    TransactionMatcherInterface,
)
from app.models.enums import MatchSource, RuleMatchField, TransactionDirection

FULL_CONFIDENCE = Decimal("1.000")


@dataclass(frozen=True, slots=True)
class CompiledMatchingRule:
    """Pre-compiled deterministic regex rule ready for fast batch statement evaluation."""

    rule_id: uuid.UUID
    priority: int
    match_field: RuleMatchField
    pattern: re.Pattern[str]
    min_abs_amount: Decimal | None
    max_abs_amount: Decimal | None
    target_category_id: uuid.UUID | None
    target_sinking_fund_id: uuid.UUID | None
    target_person_id: uuid.UUID | None


class OwnHouseholdAccountTransferMatcher:
    """
    Stage 1 Matcher: Detects physical transfers between own household bank accounts
    (`PHYSICAL_ACCOUNT_TRANSFER`) by matching `counterparty_iban` against other active
    physical `Account` IBANs of the same Tenant.

    Note: Strictly handles physical bank-to-bank transfers only; virtual pot reallocations
    never appear on bank statements and are handled separately on SinkingFundLedgerEntry.
    """

    def __init__(self, household_iban_to_account_id: Mapping[str, uuid.UUID]) -> None:
        self._iban_lookup: dict[str, uuid.UUID] = {
            normalized: acc_id
            for raw_iban, acc_id in household_iban_to_account_id.items()
            if (normalized := normalize_iban(raw_iban)) is not None
        }

    async def match(
        self,
        candidate: TransactionCandidate,
    ) -> TransactionMatchDecision | None:
        candidate_iban = normalize_iban(candidate.counterparty_iban)
        if candidate_iban is None:
            return None

        matched_account_id = self._iban_lookup.get(candidate_iban)
        if matched_account_id is None or matched_account_id == candidate.account_id:
            return None

        return TransactionMatchDecision(
            direction=TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER,
            match_source=MatchSource.OWN_IBAN_DETECTOR,
            confidence=FULL_CONFIDENCE,
            counterpart_account_id=matched_account_id,
        )


class RegexRuleMatcher:
    """
    Stage 2 Matcher: Deterministic priority-ordered Regular Expression & amount-range matcher.
    """

    def __init__(self, rules: Sequence[CompiledMatchingRule]) -> None:
        self._ordered_rules = tuple(sorted(rules, key=lambda r: r.priority))

    @staticmethod
    def compile_rule(
        *,
        rule_id: uuid.UUID,
        priority: int,
        match_field: RuleMatchField,
        regex_pattern: str,
        case_sensitive: bool,
        min_abs_amount: Decimal | None,
        max_abs_amount: Decimal | None,
        target_category_id: uuid.UUID | None,
        target_sinking_fund_id: uuid.UUID | None,
        target_person_id: uuid.UUID | None,
    ) -> CompiledMatchingRule:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            compiled = re.compile(regex_pattern, flags=flags)
        except re.error as exc:
            raise DomainValidationError(
                f"Invalid regular expression pattern '{regex_pattern}': {exc}",
                details={"rule_id": str(rule_id), "regex_pattern": regex_pattern},
            ) from exc

        return CompiledMatchingRule(
            rule_id=rule_id,
            priority=priority,
            match_field=match_field,
            pattern=compiled,
            min_abs_amount=min_abs_amount,
            max_abs_amount=max_abs_amount,
            target_category_id=target_category_id,
            target_sinking_fund_id=target_sinking_fund_id,
            target_person_id=target_person_id,
        )

    async def match(
        self,
        candidate: TransactionCandidate,
    ) -> TransactionMatchDecision | None:
        abs_amount = abs(candidate.amount)
        direction = (
            TransactionDirection.INFLOW
            if candidate.amount > ZERO
            else TransactionDirection.OUTFLOW
        )

        for rule in self._ordered_rules:
            if rule.min_abs_amount is not None and abs_amount < rule.min_abs_amount:
                continue
            if rule.max_abs_amount is not None and abs_amount > rule.max_abs_amount:
                continue

            haystack = self._extract_field_text(candidate, rule.match_field)
            if rule.pattern.search(haystack):
                return TransactionMatchDecision(
                    direction=direction,
                    match_source=MatchSource.REGEX_RULE,
                    confidence=FULL_CONFIDENCE,
                    category_id=rule.target_category_id,
                    sinking_fund_id=rule.target_sinking_fund_id,
                    paid_by_person_id=rule.target_person_id,
                    matched_rule_id=rule.rule_id,
                )

        return None

    @staticmethod
    def _extract_field_text(
        candidate: TransactionCandidate,
        field: RuleMatchField,
    ) -> str:
        if field == RuleMatchField.COUNTERPARTY_NAME:
            return candidate.counterparty_name or ""
        if field == RuleMatchField.COUNTERPARTY_IBAN:
            return candidate.counterparty_iban or ""
        if field == RuleMatchField.PURPOSE_TEXT:
            return candidate.purpose_text
        parts = [
            candidate.counterparty_name or "",
            candidate.counterparty_iban or "",
            candidate.purpose_text,
        ]
        return " | ".join(part for part in parts if part)


class TransactionMatchingPipeline:
    """
    Executes an ordered chain of TransactionMatcherInterface stages (e.g.
    OwnHouseholdAccountTransferMatcher -> RegexRuleMatcher -> optional AiClassifierMatcher)
    and returns a guaranteed classification decision.
    """

    def __init__(self, stages: Sequence[TransactionMatcherInterface]) -> None:
        self._stages = tuple(stages)

    async def classify(self, candidate: TransactionCandidate) -> TransactionMatchDecision:
        for stage in self._stages:
            decision = await stage.match(candidate)
            if decision is not None:
                return decision

        fallback_direction = (
            TransactionDirection.INFLOW
            if candidate.amount > ZERO
            else TransactionDirection.OUTFLOW
        )
        return TransactionMatchDecision(
            direction=fallback_direction,
            match_source=MatchSource.UNMATCHED,
            confidence=ZERO,
        )
