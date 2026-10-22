from fastapi import APIRouter, Depends
from typing import List, Optional
from decimal import Decimal
from pydantic import BaseModel
from app.core.auth.forward_auth import get_current_user, AuthenticatedUser
from app.domain.engines.allocation_engine import (
    AllocationEngine,
    AllocationStrategy,
    PersonNetIncome,
    AllocationResult,
)
from app.domain.engines.accrual_calculator import AccrualCalculator, Frequency

api_router = APIRouter()

class AllocationRequestDTO(BaseModel):
    strategy: AllocationStrategy = AllocationStrategy.EQUAL_REMAINING_AMOUNT
    earners: List[PersonNetIncome]
    global_household_income: Decimal = Decimal("0.00")
    total_shared_expenses: Decimal

class ProvisionRequestDTO(BaseModel):
    amount: Decimal
    frequency: Frequency

@api_router.get("/health")
async def health_check():
    return {"status": "ok", "service": "equibudget-backend", "version": "1.4.0"}

@api_router.get("/auth/session")
async def get_session(current_user: AuthenticatedUser = Depends(get_current_user)):
    return {
        "authenticated": True,
        "user": current_user,
    }

@api_router.post("/cashflow/allocate", response_model=AllocationResult)
async def allocate_cashflow(
    payload: AllocationRequestDTO,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    return AllocationEngine.calculate(
        strategy=payload.strategy,
        earners=payload.earners,
        global_household_income=payload.global_household_income,
        total_shared_expenses=payload.total_shared_expenses,
    )

@api_router.post("/sinking-funds/calculate-provision")
async def calculate_provision(payload: ProvisionRequestDTO):
    monthly_provision = AccrualCalculator.calculate_monthly_provision(
        payload.amount, payload.frequency
    )
    return {
        "target_amount": payload.amount,
        "frequency": payload.frequency,
        "monthly_provision": monthly_provision,
    }

@api_router.get("/households")
async def list_households(current_user: AuthenticatedUser = Depends(get_current_user)):
    return [
        {
            "id": "tenant-01",
            "name": "The Miller-Schneider Household",
            "currency": "EUR",
            "timezone": "Europe/Berlin",
        }
    ]
