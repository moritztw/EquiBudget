from __future__ import annotations

import calendar
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.domain.exceptions import InvalidAccrualScheduleError
from app.domain.money import ZERO, quantize_cents, quantize_ratio
from app.models.enums import AllocationStrategy, RecurrenceInterval


def normalize_to_month_start(value: date) -> date:
    """Normalize any calendar date to the first day of its month (YYYY-MM-01)."""
    return date(value.year, value.month, 1)


def add_months(source_date: date, months: int) -> date:
    """Advance `source_date` by `months` calendar months, clamping month-end days safely."""
    zero_based_month = (source_date.month - 1) + months
    target_year = source_date.year + (zero_based_month // 12)
    target_month = (zero_based_month % 12) + 1
    max_day = calendar.monthrange(target_year, target_month)[1]
    return date(target_year, target_month, min(source_date.day, max_day))


def count_inclusive_months_until_due(reference_month: date, next_due_date: date) -> int:
    """
    Return the number of monthly provision opportunities between `reference_month`
    and the month of `next_due_date` (inclusive of `reference_month`, minimum 1 if due now/overdue).
    """
    ref_start = normalize_to_month_start(reference_month)
    due_start = normalize_to_month_start(next_due_date)
    month_diff = (due_start.year - ref_start.year) * 12 + (due_start.month - ref_start.month)
    if month_diff <= 0:
        return 1
    return month_diff


@dataclass(frozen=True, slots=True)
class RateRevisionSnapshot:
    """Effective-dated payment amount adjustment (`Gültig-ab` Preisstaffel)."""

    valid_from: date
    amount: Decimal
    note: str | None = None


def resolve_effective_target_amount(
    base_amount: Decimal,
    rate_revisions: Sequence[RateRevisionSnapshot],
    effective_on: date,
) -> Decimal:
    """
    Resolve the scheduled payment amount valid on `effective_on`.
    Picks the latest revision with `valid_from <= effective_on`, falling back to `base_amount`.
    """
    applicable = [r for r in rate_revisions if r.valid_from <= effective_on]
    if not applicable:
        return quantize_cents(base_amount)
    latest = max(applicable, key=lambda r: r.valid_from)
    return quantize_cents(latest.amount)


@dataclass(frozen=True, slots=True)
class SinkingFundSnapshot:
    """Domain input representing a planned obligation / virtual sinking fund and its ledger balance."""

    sinking_fund_id: uuid.UUID
    backing_account_id: uuid.UUID
    name: str
    target_amount: Decimal
    recurrence_interval: RecurrenceInterval
    next_due_date: date
    current_virtual_balance: Decimal
    end_date: date | None = None
    auto_accrual: bool = True
    rate_revisions: tuple[RateRevisionSnapshot, ...] = ()
    is_shared_obligation: bool = True
    allocation_strategy_override: AllocationStrategy | None = None


@dataclass(frozen=True, slots=True)
class SinkingFundValuation:
    """Monthly accrual calculation result for a single planned payment / virtual sinking fund."""

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


@dataclass(frozen=True, slots=True)
class AccountLiquidityReconciliation:
    """Reconciles physical bank balance against positive virtual reserves and overdrawn pots."""

    account_id: uuid.UUID
    physical_account_balance: Decimal
    reserved_sinking_funds_balance: Decimal
    overdrawn_sinking_funds_balance: Decimal
    free_disposable_liquidity: Decimal
    is_fully_backed: bool


@dataclass(frozen=True, slots=True)
class ExpenseSettlementPlan:
    """
    Describes ledger impact and next cycle due date when a real bill is debited.
    Explicitly supports uncovered virtual pots (`allow_pot_overdraft=True`), allowing the
    virtual pot balance to become negative when a payment exceeds accrued reserves.
    """

    sinking_fund_id: uuid.UUID
    actual_invoice_amount: Decimal
    pot_balance_before_settlement: Decimal
    settlement_ledger_amount: Decimal
    pot_balance_after_settlement: Decimal
    unreserved_budget_shortfall: Decimal
    pot_overdraft_amount: Decimal
    remaining_pot_surplus: Decimal
    next_cycle_due_date: date
    reached_end_date: bool


class AccrualEngine:
    """
    Stateless domain engine for Accrual Accounting (Ansparraten & Virtuelle Töpfe).
    Enforces:
    - Effective-dated rate revisions (`Gültig-ab` amount schedules)
    - Immediate stop of monthly accruals once the last due date on or before `end_date` has passed
    - Retention of any residual or overdrawn virtual pot balance for manual reconciliation
    - Uncovered pot settlements: actual payments can debit a pot even if `current_virtual_balance <= 0`
      or `< actual_invoice_amount`, booking the full outflow onto the pot ledger (negative pot balance).
    """

    @staticmethod
    def is_expired_for_reference_date(fund: SinkingFundSnapshot, reference_date: date) -> bool:
        """
        Determine whether a planned payment has no remaining valid due dates on or before `end_date`.
        Once `next_due_date > end_date` (or `reference_month > end_date` month), saving stops immediately.
        """
        if fund.end_date is None:
            return False
        if fund.next_due_date > fund.end_date:
            return True
        if normalize_to_month_start(reference_date) > normalize_to_month_start(fund.end_date):
            return True
        return False

    def evaluate_fund(
        self,
        fund: SinkingFundSnapshot,
        *,
        reference_date: date,
    ) -> SinkingFundValuation:
        """Compute steady-state monthly accrual, catch-up rate (including pot overdraft recovery), and funding ratio."""
        effective_target = resolve_effective_target_amount(
            fund.target_amount,
            fund.rate_revisions,
            fund.next_due_date,
        )
        if effective_target <= ZERO:
            raise InvalidAccrualScheduleError(
                f"Sinking fund '{fund.name}' must have a strictly positive target_amount.",
                details={
                    "sinking_fund_id": str(fund.sinking_fund_id),
                    "target_amount": str(effective_target),
                },
            )

        current_balance = quantize_cents(fund.current_virtual_balance)
        is_overdrawn = current_balance < ZERO
        overdraft_amount = max(ZERO, -current_balance)
        is_expired = self.is_expired_for_reference_date(fund, reference_date)

        if is_expired:
            raw_ratio = Decimal("1.0000") if current_balance > ZERO else ZERO
            return SinkingFundValuation(
                sinking_fund_id=fund.sinking_fund_id,
                backing_account_id=fund.backing_account_id,
                name=fund.name,
                target_amount=effective_target,
                current_virtual_balance=current_balance,
                is_overdrawn=is_overdrawn,
                overdraft_amount=overdraft_amount,
                remaining_funding_gap=overdraft_amount,
                funded_ratio=quantize_ratio(raw_ratio),
                standard_cyclical_monthly_rate=ZERO,
                recommended_monthly_provision=ZERO,
                months_until_due=0,
                next_due_date=fund.next_due_date,
                end_date=fund.end_date,
                is_expired_by_end_date=True,
                has_unallocated_residual_balance=current_balance != ZERO,
                is_shared_obligation=fund.is_shared_obligation,
                is_catchup_required=is_overdrawn,
                allocation_strategy_override=fund.allocation_strategy_override,
            )

        months_until_due = count_inclusive_months_until_due(reference_date, fund.next_due_date)
        cycle_months = fund.recurrence_interval.months_in_cycle
        if cycle_months <= 0:
            standard_monthly_rate = quantize_cents(effective_target / Decimal(months_until_due))
        else:
            standard_monthly_rate = quantize_cents(effective_target / Decimal(cycle_months))

        # When current_balance < 0 (overdrawn pot), funding_gap automatically includes the deficit!
        funding_gap = max(ZERO, quantize_cents(effective_target - current_balance))

        if not fund.auto_accrual and fund.recurrence_interval != RecurrenceInterval.MONTHLY:
            recommended_provision = ZERO
        elif funding_gap == ZERO:
            recommended_provision = ZERO
        else:
            recommended_provision = quantize_cents(funding_gap / Decimal(months_until_due))

        raw_ratio = current_balance / effective_target if current_balance > ZERO else ZERO
        funded_ratio = quantize_ratio(min(Decimal("1.0000"), raw_ratio))

        return SinkingFundValuation(
            sinking_fund_id=fund.sinking_fund_id,
            backing_account_id=fund.backing_account_id,
            name=fund.name,
            target_amount=effective_target,
            current_virtual_balance=current_balance,
            is_overdrawn=is_overdrawn,
            overdraft_amount=overdraft_amount,
            remaining_funding_gap=funding_gap,
            funded_ratio=funded_ratio,
            standard_cyclical_monthly_rate=standard_monthly_rate,
            recommended_monthly_provision=recommended_provision,
            months_until_due=months_until_due,
            next_due_date=fund.next_due_date,
            end_date=fund.end_date,
            is_expired_by_end_date=False,
            has_unallocated_residual_balance=False,
            is_shared_obligation=fund.is_shared_obligation,
            is_catchup_required=recommended_provision > standard_monthly_rate,
            allocation_strategy_override=fund.allocation_strategy_override,
        )

    def reconcile_account_liquidity(
        self,
        *,
        account_id: uuid.UUID,
        physical_account_balance: Decimal,
        funds_on_account: Sequence[SinkingFundSnapshot],
    ) -> AccountLiquidityReconciliation:
        """
        Verify how much of a real bank account's balance is earmarked in positive virtual pots
        versus genuinely free liquidity, while explicitly surfacing any overdrawn (< 0) pots.
        """
        physical = quantize_cents(physical_account_balance)
        reserved = quantize_cents(
            sum(
                (max(ZERO, quantize_cents(f.current_virtual_balance)) for f in funds_on_account),
                start=ZERO,
            )
        )
        overdrawn = quantize_cents(
            sum(
                (max(ZERO, -quantize_cents(f.current_virtual_balance)) for f in funds_on_account),
                start=ZERO,
            )
        )
        free_liquidity = quantize_cents(physical - reserved)

        return AccountLiquidityReconciliation(
            account_id=account_id,
            physical_account_balance=physical,
            reserved_sinking_funds_balance=reserved,
            overdrawn_sinking_funds_balance=overdrawn,
            free_disposable_liquidity=free_liquidity,
            is_fully_backed=free_liquidity >= ZERO,
        )

    def plan_settlement(
        self,
        fund: SinkingFundSnapshot,
        *,
        actual_invoice_amount: Decimal,
        allow_pot_overdraft: bool = True,
    ) -> ExpenseSettlementPlan:
        """
        Calculate virtual pot debit when an actual invoice or CSV outflow is booked against the pot.
        When `allow_pot_overdraft=True` (default), the full `actual_invoice_amount` is debited from
        the pot even if `current_virtual_balance` is zero, insufficient, or already negative,
        leaving the pot in a transparent negative (overdrawn) state until replenished.
        """
        invoice = quantize_cents(abs(actual_invoice_amount))
        if invoice <= ZERO:
            raise InvalidAccrualScheduleError(
                "Settlement invoice amount must be strictly greater than zero.",
                details={"actual_invoice_amount": str(actual_invoice_amount)},
            )

        balance_before = quantize_cents(fund.current_virtual_balance)
        positive_reserve_before = max(ZERO, balance_before)

        if allow_pot_overdraft:
            settlement_ledger_amount = -invoice
        else:
            settlement_ledger_amount = -min(positive_reserve_before, invoice)

        balance_after = quantize_cents(balance_before + settlement_ledger_amount)
        shortfall = max(ZERO, quantize_cents(invoice - positive_reserve_before))
        overdraft_after = max(ZERO, -balance_after)
        surplus_after = max(ZERO, balance_after)

        cycle_months = fund.recurrence_interval.months_in_cycle
        if cycle_months <= 0:
            next_due = fund.next_due_date
            reached_end = True
        else:
            next_due = add_months(fund.next_due_date, cycle_months)
            reached_end = fund.end_date is not None and next_due > fund.end_date

        return ExpenseSettlementPlan(
            sinking_fund_id=fund.sinking_fund_id,
            actual_invoice_amount=invoice,
            pot_balance_before_settlement=balance_before,
            settlement_ledger_amount=settlement_ledger_amount,
            pot_balance_after_settlement=balance_after,
            unreserved_budget_shortfall=shortfall,
            pot_overdraft_amount=overdraft_after,
            remaining_pot_surplus=surplus_after,
            next_cycle_due_date=next_due,
            reached_end_date=reached_end,
        )
