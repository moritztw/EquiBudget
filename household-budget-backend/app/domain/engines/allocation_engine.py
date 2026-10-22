from typing import List, Dict, Optional
from decimal import Decimal, ROUND_HALF_UP
from pydantic import BaseModel, Field
from enum import Enum
from app.core.exceptions import NoActiveEarnersException

class AllocationStrategy(str, Enum):
    EQUAL_REMAINING_AMOUNT = "EQUAL_REMAINING_AMOUNT"
    PROPORTIONAL_INCOME = "PROPORTIONAL_INCOME"
    FIXED_RATIO = "FIXED_RATIO"

class PersonNetIncome(BaseModel):
    person_id: str
    person_name: str
    net_income: Decimal = Field(..., ge=0)
    is_earner: bool = True

class EarnerContributionResult(BaseModel):
    person_id: str
    person_name: str
    net_income: Decimal
    income_share_pct: Decimal
    contribution_amount: Decimal
    contribution_pct_of_income: Decimal
    discretionary_remaining: Decimal
    is_deficit_subsidized: bool = False

class AllocationResult(BaseModel):
    strategy: AllocationStrategy
    total_earners_net_income: Decimal
    total_global_income: Decimal
    total_net_income: Decimal
    total_shared_expenses: Decimal
    net_expenses_to_cover: Decimal
    total_discretionary_pool: Decimal
    target_discretionary_per_earner: Decimal
    earner_splits: List[EarnerContributionResult]
    audit_trail: List[str]

class AllocationEngine:
    @staticmethod
    def calculate(
        strategy: AllocationStrategy,
        earners: List[PersonNetIncome],
        global_household_income: Decimal,
        total_shared_expenses: Decimal,
        fixed_ratio_shares: Optional[Dict[str, Decimal]] = None
    ) -> AllocationResult:
        active_earners = [e for e in earners if e.is_earner]
        num_earners = len(active_earners)
        audit: List[str] = []

        if num_earners == 0:
            raise NoActiveEarnersException()

        total_earners_net = sum((e.net_income for e in active_earners), Decimal("0.00"))
        total_net = total_earners_net + global_household_income
        net_expenses_to_cover = max(Decimal("0.00"), total_shared_expenses - global_household_income)
        total_discretionary_pool = total_net - total_shared_expenses

        splits: List[EarnerContributionResult] = []

        if strategy == AllocationStrategy.EQUAL_REMAINING_AMOUNT:
            # Target pocket money per earner = Total Pool / N_earners
            target_discretionary = (total_discretionary_pool / Decimal(num_earners)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            audit.append(f"Global Household Income: €{global_household_income:.2f} credited to shared expenses.")
            audit.append(f"Net Shared Expenses to cover: €{net_expenses_to_cover:.2f}.")
            audit.append(f"Discretionary pool: €{total_discretionary_pool:.2f} divided equally by {num_earners} earner(s).")
            audit.append(f"Target Equal Pocket Money: €{target_discretionary:.2f} per partner.")

            for earner in active_earners:
                income_share = (earner.net_income / total_earners_net * 100) if total_earners_net > 0 else Decimal("0")
                raw_contribution = earner.net_income - target_discretionary
                is_subsidized = raw_contribution < 0
                contribution = raw_contribution.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                contrib_pct = (contribution / earner.net_income * 100) if earner.net_income > 0 else Decimal("0")

                splits.append(EarnerContributionResult(
                    person_id=earner.person_id,
                    person_name=earner.person_name,
                    net_income=earner.net_income,
                    income_share_pct=income_share.quantize(Decimal("0.1")),
                    contribution_amount=contribution,
                    contribution_pct_of_income=contrib_pct.quantize(Decimal("0.1")),
                    discretionary_remaining=target_discretionary,
                    is_deficit_subsidized=is_subsidized
                ))

            return AllocationResult(
                strategy=strategy,
                total_earners_net_income=total_earners_net,
                total_global_income=global_household_income,
                total_net_income=total_net,
                total_shared_expenses=total_shared_expenses,
                net_expenses_to_cover=net_expenses_to_cover,
                total_discretionary_pool=total_discretionary_pool,
                target_discretionary_per_earner=target_discretionary,
                earner_splits=splits,
                audit_trail=audit
            )

        elif strategy == AllocationStrategy.PROPORTIONAL_INCOME:
            target_disc = (total_discretionary_pool / Decimal(num_earners)).quantize(Decimal("0.01"))
            for earner in active_earners:
                share_pct = earner.net_income / total_earners_net if total_earners_net > 0 else Decimal("0")
                contrib = (share_pct * net_expenses_to_cover).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                disc = earner.net_income - contrib
                splits.append(EarnerContributionResult(
                    person_id=earner.person_id,
                    person_name=earner.person_name,
                    net_income=earner.net_income,
                    income_share_pct=(share_pct * 100).quantize(Decimal("0.1")),
                    contribution_amount=contrib,
                    contribution_pct_of_income=((contrib / earner.net_income) * 100).quantize(Decimal("0.1")),
                    discretionary_remaining=disc.quantize(Decimal("0.01")),
                    is_deficit_subsidized=False
                ))

            return AllocationResult(
                strategy=strategy,
                total_earners_net_income=total_earners_net,
                total_global_income=global_household_income,
                total_net_income=total_net,
                total_shared_expenses=total_shared_expenses,
                net_expenses_to_cover=net_expenses_to_cover,
                total_discretionary_pool=total_discretionary_pool,
                target_discretionary_per_earner=target_disc,
                earner_splits=splits,
                audit_trail=["Proportional net split applied."]
            )

        else: # FIXED_RATIO
            default_share = Decimal("100") / Decimal(num_earners)
            target_disc = (total_discretionary_pool / Decimal(num_earners)).quantize(Decimal("0.01"))
            for earner in active_earners:
                share_pct = (fixed_ratio_shares.get(earner.person_id, default_share) / 100) if fixed_ratio_shares else (default_share / 100)
                contrib = (share_pct * net_expenses_to_cover).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                disc = earner.net_income - contrib
                splits.append(EarnerContributionResult(
                    person_id=earner.person_id,
                    person_name=earner.person_name,
                    net_income=earner.net_income,
                    income_share_pct=(share_pct * 100).quantize(Decimal("0.1")),
                    contribution_amount=contrib,
                    contribution_pct_of_income=((contrib / earner.net_income) * 100).quantize(Decimal("0.1")),
                    discretionary_remaining=disc.quantize(Decimal("0.01")),
                    is_deficit_subsidized=False
                ))

            return AllocationResult(
                strategy=strategy,
                total_earners_net_income=total_earners_net,
                total_global_income=global_household_income,
                total_net_income=total_net,
                total_shared_expenses=total_shared_expenses,
                net_expenses_to_cover=net_expenses_to_cover,
                total_discretionary_pool=total_discretionary_pool,
                target_discretionary_per_earner=target_disc,
                earner_splits=splits,
                audit_trail=["Fixed ratio split applied."]
            )
