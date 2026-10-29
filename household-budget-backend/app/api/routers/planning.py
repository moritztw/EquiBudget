from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Query, Response, status

from app.api.deps import HouseholdRepoDep, TenantContextDep
from app.domain.accrual_engine import AccrualEngine, normalize_to_month_start
from app.domain.allocation_engine import AllocationEngine, ParticipantFinancialProfile
from app.domain.household_planner import HouseholdBudgetPlanner, SharedBudgetItem
from app.domain.money import ZERO
from app.models.entities import SinkingFund
from app.models.enums import AllocationStrategy, SinkingFundLifecycleFilter
from app.schemas.api import (
    HouseholdMonthlyPlanResponse,
    PersonMonthlyPlanSummarySchema,
    SinkingFundCreate,
    SinkingFundLedgerEntryRead,
    SinkingFundProvisionCreate,
    SinkingFundSettlementRequest,
    SinkingFundSettlementResponse,
    SinkingFundUpdate,
    SinkingFundWithValuationRead,
)
from app.schemas.domain import (
    AllocationCalculationRequest,
    AllocationCalculationResponse,
    PersonAllocationShareSchema,
    RateRevisionSchema,
    SinkingFundValuationSchema,
)

router = APIRouter(tags=["Budget Planning & Accruals"])

_allocation_engine = AllocationEngine()
_accrual_engine = AccrualEngine()
_budget_planner = HouseholdBudgetPlanner(
    allocation_engine=_allocation_engine,
    accrual_engine=_accrual_engine,
)


def _serialize_fund_with_valuation(
    fund: SinkingFund,
    current_balance: Decimal,
    reference_date: date,
    repo: HouseholdRepoDep,
) -> SinkingFundWithValuationRead:
    snapshot = repo.to_fund_snapshot(fund, current_balance)
    valuation = _accrual_engine.evaluate_fund(snapshot, reference_date=reference_date)
    return SinkingFundWithValuationRead(
        id=fund.id,
        tenant_id=fund.tenant_id,
        backing_account_id=fund.backing_account_id,
        category_id=fund.category_id,
        name=fund.name,
        payee=fund.payee,
        description=fund.description,
        base_target_amount=fund.target_amount,
        recurrence_interval=fund.recurrence_interval,
        end_date=fund.end_date,
        auto_accrual=fund.auto_accrual,
        is_active=fund.is_active,
        rate_revisions=[RateRevisionSchema.model_validate(r) for r in fund.rate_revisions],
        valuation=SinkingFundValuationSchema.model_validate(valuation),
    )


# --- Planned Payments & Virtual Sinking Funds ---


@router.get("/sinking-funds", response_model=list[SinkingFundWithValuationRead])
async def list_sinking_funds(
    repo: HouseholdRepoDep,
    reference_date: date = Query(default_factory=date.today),
    lifecycle_filter: SinkingFundLifecycleFilter = Query(
        default=SinkingFundLifecycleFilter.ACTIVE
    ),
) -> list[SinkingFundWithValuationRead]:
    """
    List planned obligations / virtual sinking funds filtered by lifecycle:
    - ACTIVE: Active items whose `end_date` has not expired.
    - ARCHIVED: Items that reached their `end_date` or were manually deactivated (retains residual pot balance!).
    - ALL: Both active and archived items.
    """
    funds_with_balances = await repo.list_sinking_funds_with_balances(active_only=False)
    response: list[SinkingFundWithValuationRead] = []
    for fund, current_balance in funds_with_balances:
        item = _serialize_fund_with_valuation(fund, current_balance, reference_date, repo)
        is_archived = (not fund.is_active) or item.valuation.is_expired_by_end_date
        if lifecycle_filter == SinkingFundLifecycleFilter.ACTIVE and is_archived:
            continue
        if lifecycle_filter == SinkingFundLifecycleFilter.ARCHIVED and not is_archived:
            continue
        response.append(item)
    return response


@router.post(
    "/sinking-funds",
    response_model=SinkingFundWithValuationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_sinking_fund(
    payload: SinkingFundCreate,
    repo: HouseholdRepoDep,
) -> SinkingFundWithValuationRead:
    fund, initial_balance = await repo.create_sinking_fund(payload)
    return _serialize_fund_with_valuation(fund, initial_balance, date.today(), repo)


@router.patch(
    "/sinking-funds/{fund_id}",
    response_model=SinkingFundWithValuationRead,
)
async def update_sinking_fund(
    fund_id: uuid.UUID,
    payload: SinkingFundUpdate,
    repo: HouseholdRepoDep,
    reference_date: date = Query(default_factory=date.today),
) -> SinkingFundWithValuationRead:
    """Edit any field of a planned payment / sinking fund including `end_date` and `rate_revisions`."""
    fund, current_balance = await repo.update_sinking_fund(fund_id, payload)
    return _serialize_fund_with_valuation(fund, current_balance, reference_date, repo)


@router.delete(
    "/sinking-funds/{fund_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_sinking_fund(
    fund_id: uuid.UUID,
    repo: HouseholdRepoDep,
) -> Response:
    """Delete a planned payment / sinking fund (requires virtual pot balance == 0.00)."""
    await repo.delete_sinking_fund(fund_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/sinking-funds/{fund_id}/provisions",
    response_model=SinkingFundLedgerEntryRead,
    status_code=status.HTTP_201_CREATED,
)
async def post_sinking_fund_provision(
    fund_id: uuid.UUID,
    payload: SinkingFundProvisionCreate,
    repo: HouseholdRepoDep,
) -> SinkingFundLedgerEntryRead:
    """Book a monthly accrual provision or manual adjustment into a virtual sinking fund."""
    entry = await repo.add_sinking_fund_provision(fund_id, payload)
    return SinkingFundLedgerEntryRead.model_validate(entry)


@router.post(
    "/sinking-funds/{fund_id}/settle",
    response_model=SinkingFundSettlementResponse,
)
async def settle_sinking_fund_invoice(
    fund_id: uuid.UUID,
    payload: SinkingFundSettlementRequest,
    repo: HouseholdRepoDep,
) -> SinkingFundSettlementResponse:
    """
    Settle an actual quarterly/annual invoice against its virtual sinking fund reserve,
    optionally booking the corresponding physical bank outflow transaction and rolling
    `next_due_date` forward to the next billing cycle.
    """
    fund, current_balance = await repo.get_sinking_fund_with_balance(fund_id)
    snapshot = repo.to_fund_snapshot(fund, current_balance)
    plan = _accrual_engine.plan_settlement(
        snapshot,
        actual_invoice_amount=payload.actual_invoice_amount,
        allow_pot_overdraft=payload.allow_pot_overdraft,
    )
    ledger_entry, created_tx = await repo.execute_sinking_fund_settlement(
        fund=fund,
        settlement_plan=plan,
        booking_date=payload.booking_date,
        counterparty_name=payload.counterparty_name,
        purpose_text=payload.purpose_text,
        record_bank_transaction=payload.record_bank_transaction,
    )
    return SinkingFundSettlementResponse(
        sinking_fund_id=fund.id,
        ledger_entry_id=ledger_entry.id if ledger_entry is not None else None,
        created_transaction_id=created_tx.id if created_tx is not None else None,
        actual_invoice_amount=plan.actual_invoice_amount,
        pot_balance_before_settlement=plan.pot_balance_before_settlement,
        settlement_ledger_amount=plan.settlement_ledger_amount,
        pot_balance_after_settlement=plan.pot_balance_after_settlement,
        unreserved_budget_shortfall=plan.unreserved_budget_shortfall,
        pot_overdraft_amount=plan.pot_overdraft_amount,
        remaining_pot_surplus=plan.remaining_pot_surplus,
        next_cycle_due_date=plan.next_cycle_due_date,
        reached_end_date=plan.reached_end_date,
    )



# --- Income Split & Month-Specific Household Budget Plan ---


@router.post("/allocations/simulate", response_model=AllocationCalculationResponse)
async def simulate_allocation(
    payload: AllocationCalculationRequest,
) -> AllocationCalculationResponse:
    """Stateless dry-run simulation of any AllocationStrategy without modifying DB state."""
    profiles = [
        ParticipantFinancialProfile(
            person_id=p.person_id,
            display_name=p.display_name,
            is_employed=p.is_employed,
            participates_in_shared_split=p.participates_in_shared_split,
            monthly_net_income=p.monthly_net_income,
            fixed_personal_deductions=p.fixed_personal_deductions,
            custom_allocation_weight=p.custom_allocation_weight,
        )
        for p in payload.participants
    ]
    result = _allocation_engine.calculate(
        strategy=payload.strategy,
        total_shared_expenses=payload.total_shared_expenses,
        participants=profiles,
        allow_compensation_transfer=payload.allow_compensation_transfer,
    )
    return AllocationCalculationResponse(
        strategy=result.strategy,
        total_shared_expenses=result.total_shared_expenses,
        combined_disposable_income=result.combined_disposable_income,
        combined_remaining_pocket_money=result.combined_remaining_pocket_money,
        shares=[PersonAllocationShareSchema.model_validate(s) for s in result.shares],
    )


@router.get("/allocations/monthly-plan", response_model=HouseholdMonthlyPlanResponse)
async def get_household_monthly_plan(
    repo: HouseholdRepoDep,
    tenant_ctx: TenantContextDep,
    reference_date: date = Query(default_factory=date.today),
    strategy_override: AllocationStrategy | None = Query(default=None),
    use_recommended_catchup_rate: bool = Query(default=True),
    allow_compensation_transfer: bool = Query(default=False),
) -> HouseholdMonthlyPlanResponse:
    """
    Compute the month-specific contribution plan for `reference_date`:
    - Resolves each Person's freshly entered `PersonMonthlyIncome` for `YYYY-MM-01` (0.00 if not entered yet).
    - Evaluates active SinkingFunds using effective-dated `rate_revisions` and stops saving immediately
      for obligations past their `end_date`.
    - Splits 100% of the month's actual net income across the month's shared obligations.
    """
    normalized_month = normalize_to_month_start(reference_date)
    persons = await repo.list_persons(active_only=True)
    monthly_incomes = await repo.list_monthly_incomes(period_month=normalized_month)
    income_by_person = {inc.person_id: inc for inc in monthly_incomes}

    categories = await repo.list_categories(active_only=True)
    funds_with_balances = await repo.list_sinking_funds_with_balances(active_only=True)

    participants: list[ParticipantFinancialProfile] = []
    for p in persons:
        m_inc = income_by_person.get(p.id)
        actual_net = m_inc.actual_net_income if m_inc is not None else ZERO
        personal_ded = (
            m_inc.personal_fixed_deductions
            if m_inc is not None
            else p.fixed_personal_deductions
        )
        participants.append(
            ParticipantFinancialProfile(
                person_id=p.id,
                display_name=p.display_name,
                is_employed=p.is_employed,
                participates_in_shared_split=p.participates_in_shared_split,
                monthly_net_income=actual_net,
                fixed_personal_deductions=personal_ded,
                custom_allocation_weight=p.custom_allocation_weight,
            )
        )

    shared_budgets = [
        SharedBudgetItem(
            category_id=c.id,
            name=c.name,
            monthly_target_amount=c.monthly_target_amount,
            allocation_strategy_override=c.allocation_strategy_override,
        )
        for c in categories
        if c.is_shared_expense
    ]

    fund_snapshots = [
        repo.to_fund_snapshot(fund, balance) for fund, balance in funds_with_balances
    ]

    effective_default_strategy = strategy_override or tenant_ctx.default_allocation_strategy
    plan = _budget_planner.build_monthly_plan(
        reference_date=reference_date,
        default_strategy=effective_default_strategy,
        participants=participants,
        shared_budgets=shared_budgets,
        sinking_funds=fund_snapshots,
        use_recommended_catchup_rate=use_recommended_catchup_rate,
        allow_compensation_transfer=allow_compensation_transfer,
    )

    person_profile_map = {pt.person_id: pt for pt in participants}

    return HouseholdMonthlyPlanResponse(
        reference_date=plan.reference_date,
        default_strategy=plan.default_strategy,
        total_monthly_budgets=plan.total_monthly_budgets,
        total_monthly_sinking_provisions=plan.total_monthly_sinking_provisions,
        total_shared_obligation=plan.total_shared_obligation,
        sinking_fund_valuations=[
            SinkingFundValuationSchema.model_validate(v) for v in plan.sinking_fund_valuations
        ],
        strategy_breakdowns=[
            AllocationCalculationResponse(
                strategy=b.strategy,
                total_shared_expenses=b.total_shared_expenses,
                combined_disposable_income=b.combined_disposable_income,
                combined_remaining_pocket_money=b.combined_remaining_pocket_money,
                shares=[PersonAllocationShareSchema.model_validate(s) for s in b.shares],
            )
            for b in plan.strategy_breakdowns
        ],
        person_summaries=[
            PersonMonthlyPlanSummarySchema(
                person_id=ps.person_id,
                display_name=ps.display_name,
                income_recorded_for_month=ps.person_id in income_by_person,
                actual_monthly_net_income=person_profile_map[ps.person_id].monthly_net_income,
                personal_fixed_deductions=person_profile_map[ps.person_id].fixed_personal_deductions,
                disposable_income=ps.disposable_income,
                fixed_budget_contribution=ps.fixed_budget_contribution,
                sinking_fund_provision_contribution=ps.sinking_fund_provision_contribution,
                total_monthly_contribution=ps.total_monthly_contribution,
                remaining_pocket_money=ps.remaining_pocket_money,
            )
            for ps in plan.person_summaries
        ],
    )
