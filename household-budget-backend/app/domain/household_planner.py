from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.domain.accrual_engine import (
    AccrualEngine,
    SinkingFundSnapshot,
    SinkingFundValuation,
)
from app.domain.allocation_engine import (
    AllocationEngine,
    AllocationResult,
    ParticipantFinancialProfile,
)
from app.domain.money import ZERO, distribute_cents_by_weights, quantize_cents
from app.models.enums import AllocationStrategy


@dataclass(frozen=True, slots=True)
class SharedBudgetItem:
    """Monthly shared budget category obligation."""

    category_id: uuid.UUID
    name: str
    monthly_target_amount: Decimal
    allocation_strategy_override: AllocationStrategy | None = None


@dataclass(frozen=True, slots=True)
class PersonMonthlyPlanSummary:
    """Aggregated monthly transfer obligation and remaining pocket money for one Person."""

    person_id: uuid.UUID
    display_name: str
    disposable_income: Decimal
    fixed_budget_contribution: Decimal
    sinking_fund_provision_contribution: Decimal
    total_monthly_contribution: Decimal
    remaining_pocket_money: Decimal


@dataclass(frozen=True, slots=True)
class HouseholdMonthlyPlan:
    """Unified monthly household plan combining recurring budgets and sinking fund provisions."""

    reference_date: date
    default_strategy: AllocationStrategy
    total_monthly_budgets: Decimal
    total_monthly_sinking_provisions: Decimal
    total_shared_obligation: Decimal
    sinking_fund_valuations: tuple[SinkingFundValuation, ...]
    strategy_breakdowns: tuple[AllocationResult, ...]
    person_summaries: tuple[PersonMonthlyPlanSummary, ...]


class HouseholdBudgetPlanner:
    """
    High-level domain service combining monthly shared categories and virtual sinking fund
    provisions into per-person monthly contribution plans.

    Important ordering invariant for `EQUAL_REMAINING`:
    Buckets using explicit strategy overrides (`FIFTY_FIFTY`, `PROPORTIONAL`, `CUSTOM_WEIGHT`)
    are evaluated *before* `EQUAL_REMAINING`, deducting those prior contributions from each
    participant's available income so that the final remaining pocket money is truly equalized.
    """

    def __init__(
        self,
        allocation_engine: AllocationEngine | None = None,
        accrual_engine: AccrualEngine | None = None,
    ) -> None:
        self._allocation_engine = allocation_engine or AllocationEngine()
        self._accrual_engine = accrual_engine or AccrualEngine()

    def build_monthly_plan(
        self,
        *,
        reference_date: date,
        default_strategy: AllocationStrategy,
        participants: Sequence[ParticipantFinancialProfile],
        shared_budgets: Sequence[SharedBudgetItem],
        sinking_funds: Sequence[SinkingFundSnapshot],
        use_recommended_catchup_rate: bool = True,
        allow_compensation_transfer: bool = False,
    ) -> HouseholdMonthlyPlan:
        valuations = tuple(
            self._accrual_engine.evaluate_fund(fund, reference_date=reference_date)
            for fund in sinking_funds
        )

        budget_bucket_totals: dict[AllocationStrategy, Decimal] = defaultdict(lambda: ZERO)
        sinking_bucket_totals: dict[AllocationStrategy, Decimal] = defaultdict(lambda: ZERO)

        for item in shared_budgets:
            amount = quantize_cents(item.monthly_target_amount)
            if amount > ZERO:
                strat = item.allocation_strategy_override or default_strategy
                budget_bucket_totals[strat] = quantize_cents(budget_bucket_totals[strat] + amount)

        for val in valuations:
            if not val.is_shared_obligation:
                continue
            rate = (
                val.recommended_monthly_provision
                if use_recommended_catchup_rate
                else val.standard_cyclical_monthly_rate
            )
            if rate > ZERO:
                strat = val.allocation_strategy_override or default_strategy
                sinking_bucket_totals[strat] = quantize_cents(sinking_bucket_totals[strat] + rate)

        all_strategies = set(budget_bucket_totals.keys()) | set(sinking_bucket_totals.keys())
        ordered_strategies = sorted(
            all_strategies,
            key=lambda s: (1 if s == AllocationStrategy.EQUAL_REMAINING else 0, s.value),
        )

        fixed_contrib_by_person: dict[uuid.UUID, Decimal] = defaultdict(lambda: ZERO)
        sinking_contrib_by_person: dict[uuid.UUID, Decimal] = defaultdict(lambda: ZERO)
        prior_contributions_by_person: dict[uuid.UUID, Decimal] = defaultdict(lambda: ZERO)
        breakdowns: list[AllocationResult] = []

        for strat in ordered_strategies:
            cat_amt = budget_bucket_totals[strat]
            sink_amt = sinking_bucket_totals[strat]
            combined_bucket = quantize_cents(cat_amt + sink_amt)

            adjusted_participants: list[ParticipantFinancialProfile] = []
            for p in participants:
                remaining_before_bucket = quantize_cents(
                    p.disposable_income - prior_contributions_by_person[p.person_id]
                )
                adjusted_participants.append(
                    ParticipantFinancialProfile(
                        person_id=p.person_id,
                        display_name=p.display_name,
                        is_employed=p.is_employed,
                        participates_in_shared_split=p.participates_in_shared_split,
                        monthly_net_income=max(ZERO, remaining_before_bucket),
                        fixed_personal_deductions=ZERO,
                        custom_allocation_weight=p.custom_allocation_weight,
                    )
                )

            result = self._allocation_engine.calculate(
                strategy=strat,
                total_shared_expenses=combined_bucket,
                participants=adjusted_participants,
                allow_compensation_transfer=allow_compensation_transfer,
            )
            breakdowns.append(result)

            positive_weights = {
                s.person_id: s.contribution_amount
                for s in result.shares
                if s.contribution_amount > ZERO
            }
            has_negative_share = any(s.contribution_amount < ZERO for s in result.shares)

            if combined_bucket > ZERO and sink_amt > ZERO and not has_negative_share and positive_weights:
                sinking_by_person = distribute_cents_by_weights(sink_amt, positive_weights)
            else:
                sinking_by_person = {}

            for share in result.shares:
                prior_contributions_by_person[share.person_id] = quantize_cents(
                    prior_contributions_by_person[share.person_id] + share.contribution_amount
                )
                if share.person_id in sinking_by_person:
                    sinking_part = sinking_by_person[share.person_id]
                elif combined_bucket > ZERO and sink_amt > ZERO:
                    sinking_part = quantize_cents(
                        (share.contribution_amount * sink_amt) / combined_bucket
                    )
                else:
                    sinking_part = ZERO

                budget_part = quantize_cents(share.contribution_amount - sinking_part)
                fixed_contrib_by_person[share.person_id] = quantize_cents(
                    fixed_contrib_by_person[share.person_id] + budget_part
                )
                sinking_contrib_by_person[share.person_id] = quantize_cents(
                    sinking_contrib_by_person[share.person_id] + sinking_part
                )

        summaries: list[PersonMonthlyPlanSummary] = []
        for p in participants:
            if not p.participates_in_shared_split:
                continue
            fixed_c = fixed_contrib_by_person[p.person_id]
            sink_c = sinking_contrib_by_person[p.person_id]
            total_c = quantize_cents(fixed_c + sink_c)
            summaries.append(
                PersonMonthlyPlanSummary(
                    person_id=p.person_id,
                    display_name=p.display_name,
                    disposable_income=p.disposable_income,
                    fixed_budget_contribution=fixed_c,
                    sinking_fund_provision_contribution=sink_c,
                    total_monthly_contribution=total_c,
                    remaining_pocket_money=quantize_cents(p.disposable_income - total_c),
                )
            )

        total_budgets = quantize_cents(sum(budget_bucket_totals.values(), start=ZERO))
        total_sinking = quantize_cents(sum(sinking_bucket_totals.values(), start=ZERO))

        return HouseholdMonthlyPlan(
            reference_date=reference_date,
            default_strategy=default_strategy,
            total_monthly_budgets=total_budgets,
            total_monthly_sinking_provisions=total_sinking,
            total_shared_obligation=quantize_cents(total_budgets + total_sinking),
            sinking_fund_valuations=valuations,
            strategy_breakdowns=tuple(breakdowns),
            person_summaries=tuple(summaries),
        )
