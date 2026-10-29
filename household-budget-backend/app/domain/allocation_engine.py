from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from app.domain.exceptions import (
    DomainValidationError,
    InsufficientHouseholdIncomeError,
    InvalidAllocationWeightsError,
    NoEligibleParticipantsError,
)
from app.domain.money import (
    ZERO,
    distribute_cents_by_weights,
    quantize_cents,
    quantize_ratio,
)
from app.models.enums import AllocationStrategy

WEIGHT_SUM_TOLERANCE = Decimal("0.0001")


@dataclass(frozen=True, slots=True)
class ParticipantFinancialProfile:
    """Immutable financial snapshot of a household Person for allocation calculation."""

    person_id: uuid.UUID
    display_name: str
    is_employed: bool
    participates_in_shared_split: bool
    monthly_net_income: Decimal
    fixed_personal_deductions: Decimal = ZERO
    custom_allocation_weight: Decimal | None = None

    @property
    def disposable_income(self) -> Decimal:
        """Net income available before shared household contributions."""
        raw = quantize_cents(self.monthly_net_income) - quantize_cents(
            self.fixed_personal_deductions
        )
        return max(ZERO, raw)


@dataclass(frozen=True, slots=True)
class PersonAllocationShare:
    """Calculated monthly contribution and remaining free amount for one Person."""

    person_id: uuid.UUID
    display_name: str
    monthly_net_income: Decimal
    fixed_personal_deductions: Decimal
    disposable_income: Decimal
    contribution_amount: Decimal
    effective_share_ratio: Decimal
    remaining_pocket_money: Decimal
    requires_compensation_transfer: bool


@dataclass(frozen=True, slots=True)
class AllocationResult:
    """Complete cent-reconciled allocation breakdown across all participating persons."""

    strategy: AllocationStrategy
    total_shared_expenses: Decimal
    combined_disposable_income: Decimal
    combined_remaining_pocket_money: Decimal
    shares: tuple[PersonAllocationShare, ...]


class AllocationEngine:
    """
    Stateless domain calculator for household expense splitting:
    - FIFTY_FIFTY (Equal split across participating members)
    - PROPORTIONAL (Weighted by disposable net income)
    - EQUAL_REMAINING ('Gleiches Taschengeld' / Equal Remaining Amount)
    - CUSTOM_WEIGHT (Explicit user-defined percentages)
    """

    def calculate(
        self,
        *,
        strategy: AllocationStrategy,
        total_shared_expenses: Decimal,
        participants: Sequence[ParticipantFinancialProfile],
        allow_compensation_transfer: bool = False,
    ) -> AllocationResult:
        """
        Compute per-person contributions so `sum(contribution_amount) == total_shared_expenses`.

        When `strategy == AllocationStrategy.EQUAL_REMAINING`:
        - `allow_compensation_transfer=False` (default): Iterative waterfilling caps any lower-earning
          person's contribution at 0.00 EUR so nobody pays into the pot when their income is already
          below the target pocket money; higher earners split the remaining cost so their pocket money
          equalizes.
        - `allow_compensation_transfer=True`: Strict mathematical equalization where lower-earning
          employed persons can receive a negative contribution (direct payout from joint pot) so all
          earners finish with the exact same pocket money down to the cent.
        """
        normalized_expenses = quantize_cents(total_shared_expenses)
        if normalized_expenses < ZERO:
            raise DomainValidationError(
                "total_shared_expenses must not be negative.",
                details={"total_shared_expenses": str(normalized_expenses)},
            )

        active_members = [p for p in participants if p.participates_in_shared_split]
        if not active_members:
            raise NoEligibleParticipantsError(
                "At least one person must have participates_in_shared_split=True."
            )

        if strategy == AllocationStrategy.FIFTY_FIFTY:
            contributions = self._compute_equal_split(normalized_expenses, active_members)
        elif strategy == AllocationStrategy.PROPORTIONAL:
            contributions = self._compute_proportional_split(normalized_expenses, active_members)
        elif strategy == AllocationStrategy.EQUAL_REMAINING:
            contributions = self._compute_equal_remaining_split(
                normalized_expenses,
                active_members,
                allow_compensation_transfer=allow_compensation_transfer,
            )
        elif strategy == AllocationStrategy.CUSTOM_WEIGHT:
            contributions = self._compute_custom_weight_split(normalized_expenses, active_members)
        else:
            raise DomainValidationError(
                f"Unsupported allocation strategy: {strategy}",
                details={"strategy": str(strategy)},
            )

        shares: list[PersonAllocationShare] = []
        for member in active_members:
            contrib = contributions.get(member.person_id, ZERO)
            disposable = member.disposable_income
            remaining = quantize_cents(disposable - contrib)
            ratio = (
                quantize_ratio(contrib / normalized_expenses)
                if normalized_expenses > ZERO
                else ZERO
            )
            shares.append(
                PersonAllocationShare(
                    person_id=member.person_id,
                    display_name=member.display_name,
                    monthly_net_income=quantize_cents(member.monthly_net_income),
                    fixed_personal_deductions=quantize_cents(member.fixed_personal_deductions),
                    disposable_income=disposable,
                    contribution_amount=contrib,
                    effective_share_ratio=ratio,
                    remaining_pocket_money=remaining,
                    requires_compensation_transfer=contrib < ZERO,
                )
            )

        combined_disposable = sum((s.disposable_income for s in shares), start=ZERO)
        combined_remaining = sum((s.remaining_pocket_money for s in shares), start=ZERO)

        return AllocationResult(
            strategy=strategy,
            total_shared_expenses=normalized_expenses,
            combined_disposable_income=quantize_cents(combined_disposable),
            combined_remaining_pocket_money=quantize_cents(combined_remaining),
            shares=tuple(shares),
        )

    def _compute_equal_split(
        self,
        total_expenses: Decimal,
        members: Sequence[ParticipantFinancialProfile],
    ) -> dict[uuid.UUID, Decimal]:
        equal_weights = {member.person_id: Decimal("1") for member in members}
        return distribute_cents_by_weights(total_expenses, equal_weights)

    def _compute_proportional_split(
        self,
        total_expenses: Decimal,
        members: Sequence[ParticipantFinancialProfile],
    ) -> dict[uuid.UUID, Decimal]:
        earning_members = [m for m in members if m.disposable_income > ZERO]
        if not earning_members:
            if total_expenses == ZERO:
                return {m.person_id: ZERO for m in members}
            raise InsufficientHouseholdIncomeError(
                "Proportional allocation requires positive disposable household income.",
                details={"total_shared_expenses": str(total_expenses)},
            )

        weights = {m.person_id: m.disposable_income for m in earning_members}
        allocated = distribute_cents_by_weights(total_expenses, weights)
        return {m.person_id: allocated.get(m.person_id, ZERO) for m in members}

    def _compute_custom_weight_split(
        self,
        total_expenses: Decimal,
        members: Sequence[ParticipantFinancialProfile],
    ) -> dict[uuid.UUID, Decimal]:
        weights: dict[uuid.UUID, Decimal] = {}
        for member in members:
            if member.custom_allocation_weight is None:
                raise InvalidAllocationWeightsError(
                    f"Missing custom_allocation_weight for '{member.display_name}'.",
                    details={"person_id": str(member.person_id)},
                )
            if member.custom_allocation_weight < ZERO:
                raise InvalidAllocationWeightsError(
                    f"Negative custom_allocation_weight for '{member.display_name}'.",
                    details={
                        "person_id": str(member.person_id),
                        "weight": str(member.custom_allocation_weight),
                    },
                )
            weights[member.person_id] = member.custom_allocation_weight

        weight_sum = sum(weights.values(), start=ZERO)
        if abs(weight_sum - Decimal("1")) > WEIGHT_SUM_TOLERANCE:
            raise InvalidAllocationWeightsError(
                "Custom allocation weights across participating members must sum to 1.0.",
                details={"weight_sum": str(weight_sum)},
            )

        return distribute_cents_by_weights(total_expenses, weights)

    def _compute_equal_remaining_split(
        self,
        total_expenses: Decimal,
        members: Sequence[ParticipantFinancialProfile],
        *,
        allow_compensation_transfer: bool,
    ) -> dict[uuid.UUID, Decimal]:
        """
        Gleiches Taschengeld ('Equal Remaining Amount'):
        Distributes shared expenses among employed participants (`is_employed=True`) so that
        every contributing earner retains the exact same personal pocket money.
        Non-employed members receive a 0.00 contribution obligation.
        """
        earners = [m for m in members if m.is_employed]
        if not earners:
            raise NoEligibleParticipantsError(
                "Strategy EQUAL_REMAINING requires at least one employed participant (is_employed=True)."
            )

        if total_expenses == ZERO:
            return {m.person_id: ZERO for m in members}

        combined_earner_income = sum((m.disposable_income for m in earners), start=ZERO)
        if total_expenses > combined_earner_income:
            shortfall = quantize_cents(total_expenses - combined_earner_income)
            raise InsufficientHouseholdIncomeError(
                "Shared expenses exceed combined disposable income of employed household members.",
                details={
                    "total_shared_expenses": str(total_expenses),
                    "combined_disposable_income": str(combined_earner_income),
                    "shortfall": str(shortfall),
                },
            )

        if allow_compensation_transfer:
            remaining_pool = quantize_cents(combined_earner_income - total_expenses)
            equal_weights = {
                m.person_id: Decimal("1") for m in earners
            }
            target_pocket_by_id = distribute_cents_by_weights(remaining_pool, equal_weights)
            contributions: dict[uuid.UUID, Decimal] = {m.person_id: ZERO for m in members}
            for earner in earners:
                contributions[earner.person_id] = quantize_cents(
                    earner.disposable_income - target_pocket_by_id[earner.person_id]
                )
            return contributions

        # Iterative waterfilling without negative contributions:
        # Any earner whose disposable income is <= the equal target pocket money pays 0.00 EUR,
        # and the remaining higher earners absorb the shared expenses with equal remaining amounts.
        active_pool: list[ParticipantFinancialProfile] = list(earners)
        exempt_ids: set[uuid.UUID] = set()

        while active_pool:
            pool_income = sum((m.disposable_income for m in active_pool), start=ZERO)
            pool_remaining = quantize_cents(pool_income - total_expenses)
            avg_pocket = pool_remaining / Decimal(len(active_pool))

            newly_exempt = [
                m for m in active_pool if Decimal(m.disposable_income) <= avg_pocket
            ]
            if not newly_exempt:
                break

            for m in newly_exempt:
                exempt_ids.add(m.person_id)
            active_pool = [m for m in active_pool if m.person_id not in exempt_ids]

        if not active_pool:
            # Boundary case: total_expenses == combined_earner_income (avg_pocket == 0)
            return {
                m.person_id: (m.disposable_income if m.is_employed else ZERO)
                for m in members
            }

        final_pool_income = sum((m.disposable_income for m in active_pool), start=ZERO)
        final_remaining_pool = quantize_cents(final_pool_income - total_expenses)
        # Higher income breaks 1-cent pocket-money rounding ties in favor of slightly higher contribution
        equal_weights = {m.person_id: Decimal("1") for m in active_pool}
        pocket_money_map = distribute_cents_by_weights(final_remaining_pool, equal_weights)

        result: dict[uuid.UUID, Decimal] = {m.person_id: ZERO for m in members}
        for earner in active_pool:
            result[earner.person_id] = quantize_cents(
                earner.disposable_income - pocket_money_map[earner.person_id]
            )
        return result
