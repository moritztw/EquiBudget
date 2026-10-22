import React, { useState } from 'react';
import {
  Database,
  FolderTree,
  Code2,
  ListOrdered,
  LayoutGrid,
  Container,
  Copy,
  Check,
  Layers,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';

export const BlueprintView: React.FC = () => {
  const { t } = useTranslation();

  const [activeSection, setActiveSection] = useState<'erd' | 'backend' | 'engines' | 'api' | 'frontend' | 'docker' | 'errors'>('erd');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Section 1: ERD Text Diagram
  const erdContent = `+----------------------------------------------------------------------------------------------------+
|                                    EQUIVALENT BUDGET DOMAIN ERD                                     |
+----------------------------------------------------------------------------------------------------+

 [Tenants] (Household Multi-Tenancy Boundary)
    ├── id: UUID (PK)
    ├── name: VARCHAR(100)               "The Miller-Schneider Household"
    ├── currency: VARCHAR(3)             "EUR", "USD", "CHF"
    ├── timezone: VARCHAR(50)            "Europe/Berlin"
    └── created_at: TIMESTAMPTZ
         │
         ├── 1:N ── [Users] (Authenticated Logins)
         │           ├── id: UUID (PK)
         │           ├── tenant_id: UUID (FK -> Tenants.id)
         │           ├── email: VARCHAR(255) (UNIQUE)
         │           ├── auth_provider: ENUM ('proxy_header', 'jwt')
         │           ├── external_auth_id: VARCHAR(255) (e.g., OIDC sub / Authelia header)
         │           └── role: ENUM ('admin', 'member', 'viewer')
         │
         ├── 1:N ── [Persons] (Household Members / Spouses / Children)
         │           ├── id: UUID (PK)
         │           ├── tenant_id: UUID (FK -> Tenants.id)
         │           ├── user_id: UUID (FK -> Users.id, NULLABLE for non-user members/children)
         │           ├── name: VARCHAR(100)
         │           ├── avatar: VARCHAR(255)
         │           ├── is_earner: BOOLEAN (True for salary earners, False for dependents)
         │           └── color: VARCHAR(7)
         │                │
         │                ├── 1:N ── [IncomeSources]
         │                │           ├── id: UUID (PK)
         │                │           ├── tenant_id: UUID (FK -> Tenants.id)
         │                │           ├── person_id: UUID (FK -> Persons.id, NULLABLE: NULL = Global Household Income like Kindergeld)
         │                │           ├── name: VARCHAR(100)
         │                │           ├── gross_amount: NUMERIC(12,2)
         │                │           ├── net_amount: NUMERIC(12,2)
         │                │           ├── frequency: ENUM ('monthly', 'weekly', 'bi_weekly', 'annually')
         │                │           └── is_active: BOOLEAN
         │                │
         │                └── 1:N ── [Accounts] (Physical Bank Accounts)
         │                            ├── id: UUID (PK)
         │                            ├── tenant_id: UUID (FK -> Tenants.id)
         │                            ├── person_id: UUID (FK -> Persons.id, NULLABLE: NULL = Joint Checking Account)
         │                            ├── name: VARCHAR(100)
         │                            ├── institution: VARCHAR(100)
         │                            ├── type: ENUM ('checking', 'savings', 'credit_card', 'cash')
         │                            ├── iban_or_mask: VARCHAR(34)
         │                            ├── current_balance: NUMERIC(12,2)
         │                            └── currency: VARCHAR(3)
         │                                 │
         │                                 └── 1:N ── [Transactions] (Imported Bank Statement Lines)
         │                                             ├── id: UUID (PK)
         │                                             ├── tenant_id: UUID (FK -> Tenants.id)
         │                                             ├── account_id: UUID (FK -> Accounts.id)
         │                                             ├── date: DATE
         │                                             ├── amount: NUMERIC(12,2) (Negative = Expense, Positive = Income)
         │                                             ├── payee: VARCHAR(255)
         │                                             ├── purpose_text: TEXT
         │                                             ├── iban: VARCHAR(34)
         │                                             ├── status: ENUM ('unmatched', 'matched_budget', 'offset_sinking_fund', 'ignored')
         │                                             ├── matched_budget_id: UUID (FK -> Budgets.id, NULLABLE)
         │                                             ├── matched_sinking_fund_id: UUID (FK -> VirtualSinkingFunds.id, NULLABLE)
         │                                             ├── match_type: ENUM ('exact_rule', 'regex_pattern', 'ai_classified', 'manual')
         │                                             ├── ai_confidence: NUMERIC(4,3)
         │                                             └── ai_explanation: TEXT
         │
         ├── 1:N ── [Budgets] (Operational Monthly Categories)
         │           ├── id: UUID (PK)
         │           ├── tenant_id: UUID (FK -> Tenants.id)
         │           ├── name: VARCHAR(100)
         │           ├── category: VARCHAR(50)
         │           ├── monthly_limit: NUMERIC(12,2)
         │           ├── is_rollover: BOOLEAN
         │           └── current_carryover: NUMERIC(12,2)
         │
         ├── 1:N ── [AllocationRules] (Couples & Flatshare Spending Splits)
         │           ├── id: UUID (PK)
         │           ├── tenant_id: UUID (FK -> Tenants.id)
         │           ├── strategy: ENUM ('EQUAL_REMAINING_AMOUNT', 'PROPORTIONAL_INCOME', 'FIXED_RATIO', 'CUSTOM')
         │           ├── fixed_ratio_shares: JSONB (e.g. {"person_1": 60, "person_2": 40})
         │           └── custom_formula: TEXT
         │
         ├── 1:N ── [RecurringExpenses] (Accrual Master Records)
         │           ├── id: UUID (PK)
         │           ├── tenant_id: UUID (FK -> Tenants.id)
         │           ├── budget_id: UUID (FK -> Budgets.id)
         │           ├── name: VARCHAR(100)
         │           ├── payee: VARCHAR(255)
         │           ├── frequency: ENUM ('weekly', 'monthly', 'bi_monthly', 'quarterly', 'semi_annually', 'annually')
         │           ├── amount: NUMERIC(12,2)
         │           ├── current_monthly_provision: NUMERIC(12,2) (Calculated monthly reserve rate)
         │           ├── next_due_date: DATE
         │           └── start_date: DATE
         │                │
         │                └── 1:1 ── [VirtualSinkingFunds] (Accrued Virtual Buckets)
         │                            ├── id: UUID (PK)
         │                            ├── tenant_id: UUID (FK -> Tenants.id)
         │                            ├── recurring_expense_id: UUID (FK -> RecurringExpenses.id)
         │                            ├── name: VARCHAR(100)
         │                            ├── target_amount: NUMERIC(12,2)
         │                            ├── current_balance: NUMERIC(12,2)
         │                            ├── monthly_accrual_rate: NUMERIC(12,2)
         │                            ├── target_date: DATE
         │                            └── status: ENUM ('accruing', 'funded', 'depleted', 'rebalancing')
         │
         ├── 1:N ── [ImportTemplates] (Bank Column-Mapping Profiles)
         │           ├── id: UUID (PK)
         │           ├── tenant_id: UUID (FK -> Tenants.id)
         │           ├── bank_name: VARCHAR(100)
         │           ├── file_format: ENUM ('csv', 'camt053', 'xls')
         │           ├── delimiter: VARCHAR(5)
         │           ├── date_format: VARCHAR(20)
         │           └── column_mapping: JSONB { "dateCol": "...", "amountCol": "...", ... }
         │
         └── 1:N ── [MatchingRules] (Deterministic Ingestion Rules)
                     ├── id: UUID (PK)
                     ├── tenant_id: UUID (FK -> Tenants.id)
                     ├── priority: INTEGER
                     ├── pattern_type: ENUM ('payee_regex', 'iban_exact', 'purpose_contains', 'amount_exact')
                     ├── match_pattern: VARCHAR(255)
                     ├── target_budget_id: UUID (FK -> Budgets.id, NULLABLE)
                     └── target_sinking_fund_id: UUID (FK -> VirtualSinkingFunds.id, NULLABLE)`;

  // Section 2: Backend Folder Structure
  const backendStructure = `household-budget-backend/
├── Dockerfile
├── pyproject.toml / requirements.txt
├── alembic.ini
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       ├── 001_initial_multi_tenant_schema.py
│       └── 002_add_sinking_funds_and_ai_matcher.py
├── app/
│   ├── __init__.py
│   ├── main.py                          # FastAPI ASGI app bootstrap & CORS
│   ├── config.py                        # Pydantic v2 BaseSettings
│   │
│   ├── core/                            # Cross-Cutting Infrastructure
│   │   ├── auth/
│   │   │   ├── forward_auth.py          # Reverse-Proxy Header Inspector (X-Forwarded-User)
│   │   │   ├── jwt_handler.py           # Fallback Bearer JWT Token validator
│   │   │   └── dependencies.py          # get_current_user, get_current_tenant
│   │   ├── database.py                  # SQLAlchemy 2.0 AsyncEngine & sessionmaker
│   │   └── exceptions.py                # Standardized JSON Error Hierarchy & Handler
│   │
│   ├── domain/                          # Pure Domain Layer (Framework-Independent)
│   │   ├── entities/                    # Pydantic domain models
│   │   │   ├── tenant.py, user.py, person.py, income.py, budget.py, sinking_fund.py, transaction.py
│   │   └── engines/                     # High-Performance Domain Computation Engines
│   │       ├── allocation_engine.py     # Equal Remaining Amount ("Gleiches Taschengeld")
│   │       ├── accrual_calculator.py    # Sinking Fund provisions & debit offsets
│   │       └── transaction_matcher.py   # Pattern matcher + AI plugin interfaces
│   │
│   ├── infrastructure/                  # Adapters, Persistence & External Services
│   │   ├── models/                      # SQLAlchemy 2.0 ORM Declarative Models
│   │   ├── repositories/                # Repository Pattern implementations
│   │   └── plugins/                     # Extensible External Service Hooks
│   │       ├── ai_classifier_gemini.py  # Gemini / External AI Classification Plugin
│   │       └── csv_camt_parser.py       # Bank statement ingestion engine
│   │
│   ├── services/                        # Application Service Layer (Use Cases)
│   │   ├── cashflow_service.py          # Coordinates allocation calculations
│   │   ├── sinking_fund_service.py      # Monthly accruals & offset reconciliations
│   │   └── statement_import_service.py  # Ingests, normalizes, & runs matching pipeline
│   │
│   └── api/                             # REST API Controllers (FastAPI Routers)
│       ├── v1/
│       │   ├── auth_controller.py       # /api/v1/auth
│       │   ├── household_controller.py  # /api/v1/households & /persons
│       │   ├── cashflow_controller.py   # /api/v1/cashflow & /allocation
│       │   ├── sinking_funds_controller.py # /api/v1/sinking-funds
│       │   └── transactions_controller.py  # /api/v1/transactions & /import
│       └── schemas/                     # OpenAPI Request/Response DTOs
│           ├── error_response_dto.py    # Standardized error JSON { error_code, message, details }
│           ├── auth_dto.py
│           ├── cashflow_dto.py
│           ├── sinking_fund_dto.py
│           └── transaction_dto.py
└── tests/
    ├── conftest.py
    ├── test_allocation_engine.py
    ├── test_accrual_calculator.py
    └── test_transaction_matcher.py`;

  // Standardized Error Handler Python Code (Req 3.4)
  const backendErrorHandlerPython = `"""
app/core/exceptions.py: Standardized Error Response Architecture
Provides machine-readable error codes for client-side i18n translation.
"""
from fastapi import Request, status
from fastapi.responses import JSONResponse
from typing import Optional, Dict, Any
from pydantic import BaseModel

class ErrorResponseDTO(BaseModel):
    error_code: str
    message: str
    details: Dict[str, Any] = {}

class AppException(Exception):
    """Base domain exception with standardized error code."""
    def __init__(
        self,
        error_code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        status_code: int = status.HTTP_400_BAD_REQUEST
    ):
        self.error_code = error_code
        self.message = message
        self.details = details or {}
        self.status_code = status_code
        super().__init__(message)

# Specific Domain Exceptions with standardized codes
class AccountNotFoundException(AppException):
    def __init__(self, account_id: str):
        super().__init__(
            error_code="ERR_ACCOUNT_NOT_FOUND",
            message=f"Account with ID {account_id} does not exist.",
            details={"account_id": account_id},
            status_code=status.HTTP_404_NOT_FOUND
        )

class InsufficientFundBalanceException(AppException):
    def __init__(self, fund_id: str, available: float, requested: float):
        super().__init__(
            error_code="ERR_INSUFFICIENT_FUNDS",
            message=f"Virtual fund {fund_id} has insufficient balance.",
            details={"fund_id": fund_id, "available": available, "requested": requested},
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY
        )

class InvalidImportFormatException(AppException):
    def __init__(self, reason: str):
        super().__init__(
            error_code="ERR_INVALID_IMPORT_FORMAT",
            message=f"Invalid bank statement format: {reason}",
            details={"reason": reason},
            status_code=status.HTTP_400_BAD_REQUEST
        )

# Global FastAPI Exception Handler
async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """
    Serializes domain exceptions into standardized JSON format:
    {
      "error_code": "ERR_ACCOUNT_NOT_FOUND",
      "message": "Account with ID 123 does not exist",
      "details": { "account_id": "123" }
    }
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error_code": exc.error_code,
            "message": exc.message,
            "details": exc.details
        }
    )`;

  // Section 3: Engine Code
  const allocationEnginePython = `"""
AllocationEngine: Production Python (FastAPI / Pydantic v2) Implementation
Core Strategy: Equal Remaining Amount ("Gleiches Taschengeld")
"""
from typing import List, Dict, Optional
from decimal import Decimal, ROUND_HALF_UP
from pydantic import BaseModel, Field
from enum import Enum

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
            raise ValueError("Household must contain at least one active earner.")

        total_earners_net = sum((e.net_income for e in active_earners), Decimal("0.00"))
        total_net = total_earners_net + global_household_income
        net_expenses_to_cover = max(Decimal("0.00"), total_shared_expenses - global_household_income)
        total_discretionary_pool = total_net - total_shared_expenses

        splits: List[EarnerContributionResult] = []

        if strategy == AllocationStrategy.EQUAL_REMAINING_AMOUNT:
            # Formula:
            # Discretionary_Per_Earner = Total_Discretionary_Pool / N_earners
            # Contribution_i = Net_Income_i - Discretionary_Per_Earner
            target_discretionary = (total_discretionary_pool / Decimal(num_earners)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            audit.append(f"Global Household Income €{global_household_income} deducted from shared expenses.")
            audit.append(f"Net Shared Expenses to cover: €{net_expenses_to_cover}.")
            audit.append(f"Total Discretionary Pool €{total_discretionary_pool} divided among {num_earners} earners.")
            audit.append(f"Target Equal Pocket Money: €{target_discretionary} per partner.")

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
            )`;

  const accrualCalculatorPython = `"""
AccrualCalculator: Monthly Sinking Fund Provisions & Debit Offset Engine
"""
from decimal import Decimal, ROUND_HALF_UP
from enum import Enum
from typing import Tuple

class Frequency(str, Enum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    BI_MONTHLY = "bi_monthly"
    QUARTERLY = "quarterly"
    SEMI_ANNUALLY = "semi_annually"
    ANNUALLY = "annually"

class AccrualCalculator:
    @staticmethod
    def calculate_monthly_provision(amount: Decimal, frequency: Frequency) -> Decimal:
        if frequency == Frequency.WEEKLY:
            return ((amount * Decimal("52")) / Decimal("12")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif frequency == Frequency.MONTHLY:
            return amount
        elif frequency == Frequency.BI_MONTHLY:
            return (amount / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif frequency == Frequency.QUARTERLY:
            return (amount / Decimal("3")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif frequency == Frequency.SEMI_ANNUALLY:
            return (amount / Decimal("6")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif frequency == Frequency.ANNUALLY:
            return (amount / Decimal("12")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        raise ValueError(f"Unsupported frequency: {frequency}")

    @staticmethod
    def offset_bank_debit(current_virtual_balance: Decimal, actual_debit_amount: Decimal) -> Tuple[Decimal, bool]:
        remaining = current_virtual_balance - actual_debit_amount
        return (remaining.quantize(Decimal("0.01")), remaining >= Decimal("0.00"))`;

  // Section 4: REST API List
  const apiRoutes = [
    { method: 'POST', path: '/api/v1/auth/session', desc: 'Authenticate or validate reverse-proxy headers (X-Forwarded-User)' },
    { method: 'GET', path: '/api/v1/households', desc: 'List households/tenants accessible to authenticated user' },
    { method: 'GET', path: '/api/v1/households/{id}/persons', desc: 'Fetch household members, earners & dependents' },
    { method: 'POST', path: '/api/v1/households/{id}/incomes', desc: 'Register personal or global household income sources' },
    { method: 'POST', path: '/api/v1/cashflow/allocate', desc: 'Execute AllocationEngine (Equal Remaining Amount, Proportional, Fixed)' },
    { method: 'GET', path: '/api/v1/sinking-funds', desc: 'Fetch virtual buckets, accrued balances & upcoming debits' },
    { method: 'POST', path: '/api/v1/sinking-funds/provisions/accrue', desc: 'Trigger monthly accrual batch into virtual buckets' },
    { method: 'POST', path: '/api/v1/sinking-funds/{id}/offset-debit', desc: 'Offset a bank debit transaction against accumulated sinking fund' },
    { method: 'POST', path: '/api/v1/sinking-funds/reallocate', desc: 'Transfer accrued balance between virtual funds' },
    { method: 'POST', path: '/api/v1/transactions/import', desc: 'Upload CSV/CAMT.053 file and parse using template mapping' },
    { method: 'POST', path: '/api/v1/transactions/match-pipeline', desc: 'Execute 2-Stage matching pipeline (Regex Rules -> AI Hook)' },
    { method: 'GET', path: '/api/v1/accounts/reconciliation', desc: 'Physical bank cash vs virtual sinking fund earmarked balances' },
  ];

  const dockerComposeYaml = `services:
  # 1. PostgreSQL 16 Database
  db:
    image: postgres:16-alpine
    container_name: equibudget-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-equibudget}
      POSTGRES_USER: \${POSTGRES_USER:-equibudget}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-change_me_super_secret_db_pass}
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - equibudget-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-equibudget} -d \${POSTGRES_DB:-equibudget}"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

  # 2. FastAPI Backend Engine
  backend:
    build:
      context: ./household-budget-backend
      dockerfile: Dockerfile
    container_name: equibudget-backend
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql+asyncpg://\${POSTGRES_USER:-equibudget}:\${POSTGRES_PASSWORD:-change_me_super_secret_db_pass}@db:5432/\${POSTGRES_DB:-equibudget}
      AUTH_MODE: \${AUTH_MODE:-reverse_proxy} # 'reverse_proxy' oder 'standalone_jwt'
      FORWARDED_USER_HEADER: \${FORWARDED_USER_HEADER:-X-Forwarded-User}
      FORWARDED_EMAIL_HEADER: \${FORWARDED_EMAIL_HEADER:-X-Auth-Request-Email}
      FORWARDED_GROUPS_HEADER: \${FORWARDED_GROUPS_HEADER:-X-Forwarded-Groups}
      JWT_SECRET_KEY: \${JWT_SECRET_KEY:-insecure_dev_jwt_secret}
      AI_CLASSIFIER_PROVIDER: \${AI_CLASSIFIER_PROVIDER:-gemini}
      GEMINI_API_KEY: \${GEMINI_API_KEY:-}
    networks:
      - equibudget-network
    expose:
      - "8000"

  # 3. SPA Frontend (Nginx / Vite)
  frontend:
    build:
      context: ./household-budget-frontend
      dockerfile: Dockerfile
    container_name: equibudget-frontend
    restart: unless-stopped
    depends_on:
      - backend
    environment:
      VITE_API_URL: \${VITE_API_URL:-/api}
    networks:
      - equibudget-network
    ports:
      - "\${FRONTEND_PORT:-3000}:80"

volumes:
  postgres_data:
    name: equibudget_postgres_data
    driver: local

networks:
  equibudget-network:
    name: equibudget-network
    driver: bridge`;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
                {t('blueprint.bannerTag')}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {t('blueprint.bannerSubtag')}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              {t('blueprint.bannerTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              {t('blueprint.bannerDesc')}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() =>
                handleCopy(
                  'all',
                  `EQUIVALENT BUDGET ARCHITECTURE BLUEPRINT\n\n1. ERD:\n${erdContent}\n\n2. BACKEND:\n${backendStructure}\n\n3. DOCKER COMPOSE:\n${dockerComposeYaml}`
                )
              }
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md flex items-center space-x-2 transition-colors cursor-pointer"
            >
              {copiedKey === 'all' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedKey === 'all' ? t('blueprint.copiedFullBtn') : t('blueprint.copyFullBtn')}</span>
            </button>
          </div>
        </div>

        {/* Section Navigation Tabs */}
        <div className="flex space-x-2 overflow-x-auto pt-6 border-t border-slate-800/80 mt-5 no-scrollbar">
          {[
            { id: 'erd', label: t('blueprint.tabErd'), icon: Database },
            { id: 'backend', label: t('blueprint.tabBackend'), icon: FolderTree },
            { id: 'engines', label: t('blueprint.tabEngines'), icon: Code2 },
            { id: 'errors', label: 'Backend Error Codes (Req 3.4)', icon: AlertTriangle, highlight: true },
            { id: 'api', label: t('blueprint.tabApi'), icon: ListOrdered },
            { id: 'frontend', label: t('blueprint.tabFrontend'), icon: LayoutGrid },
            { id: 'docker', label: t('blueprint.tabDocker'), icon: Container },
          ].map((sec) => {
            const Icon = sec.icon;
            const isCurrent = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id as any)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isCurrent
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
                } ${sec.highlight && !isCurrent ? 'border-amber-500/40 text-amber-300' : ''}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 1: ERD */}
      {activeSection === 'erd' && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span>{t('blueprint.erdTitle')}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('blueprint.erdSubtitle')}
                </p>
              </div>
              <button
                onClick={() => handleCopy('erd', erdContent)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1.5 cursor-pointer"
              >
                {copiedKey === 'erd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'erd' ? t('blueprint.copied') : t('blueprint.copyCode')}</span>
              </button>
            </div>

            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-emerald-300 overflow-x-auto leading-relaxed">
              {erdContent}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 2: Backend Folder Structure */}
      {activeSection === 'backend' && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <FolderTree className="w-4 h-4 text-indigo-400" />
                  <span>{t('blueprint.backendTitle')}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('blueprint.backendSubtitle')}
                </p>
              </div>
              <button
                onClick={() => handleCopy('backend', backendStructure)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1.5 cursor-pointer"
              >
                {copiedKey === 'backend' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'backend' ? t('blueprint.copied') : t('blueprint.copyCode')}</span>
              </button>
            </div>

            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-indigo-300 overflow-x-auto leading-relaxed">
              {backendStructure}
            </pre>
          </div>
        </div>
      )}

      {/* Tab: Standardized Error Handlers (Req 3.4) */}
      {activeSection === 'errors' && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Backend Error Code Standard & i18n Mapping (app/core/exceptions.py)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Replaces plain-text error messages with structured JSON error keys (e.g. `ERR_ACCOUNT_NOT_FOUND`) mapped in `en.json` and `de.json`.
                </p>
              </div>
              <button
                onClick={() => handleCopy('errors-py', backendErrorHandlerPython)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1.5 cursor-pointer"
              >
                {copiedKey === 'errors-py' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'errors-py' ? t('blueprint.copied') : t('blueprint.copyCode')}</span>
              </button>
            </div>

            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-amber-300 overflow-x-auto leading-relaxed">
              {backendErrorHandlerPython}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 3: Core Domain Engine Code */}
      {activeSection === 'engines' && (
        <div className="space-y-6">
          {/* AllocationEngine */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>{t('blueprint.allocTitle')}</span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('blueprint.allocSubtitle')}
                </p>
              </div>
              <button
                onClick={() => handleCopy('engine-alloc', allocationEnginePython)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1.5 cursor-pointer"
              >
                {copiedKey === 'engine-alloc' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'engine-alloc' ? t('blueprint.copied') : t('blueprint.copyCode')}</span>
              </button>
            </div>
            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-slate-200 overflow-x-auto leading-relaxed">
              {allocationEnginePython}
            </pre>
          </div>

          {/* AccrualCalculator */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <Code2 className="w-4 h-4 text-indigo-400" />
                  <span>{t('blueprint.accrualTitle')}</span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('blueprint.accrualSubtitle')}
                </p>
              </div>
              <button
                onClick={() => handleCopy('engine-accrual', accrualCalculatorPython)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1.5 cursor-pointer"
              >
                {copiedKey === 'engine-accrual' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'engine-accrual' ? t('blueprint.copied') : t('blueprint.copyCode')}</span>
              </button>
            </div>
            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-slate-200 overflow-x-auto leading-relaxed">
              {accrualCalculatorPython}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 4: REST API List */}
      {activeSection === 'api' && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <ListOrdered className="w-4 h-4 text-indigo-400" />
                  <span>{t('blueprint.apiTitle')}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('blueprint.apiSubtitle')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {apiRoutes.map((r, i) => (
                <div
                  key={i}
                  className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                        r.method === 'GET'
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {r.method}
                    </span>
                    <span className="font-mono text-xs text-slate-200 font-medium">
                      {r.path}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Docker Compose */}
      {activeSection === 'docker' && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                  <Container className="w-4 h-4 text-indigo-400" />
                  <span>{t('blueprint.dockerTitle')}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('blueprint.dockerSubtitle')}
                </p>
              </div>
              <button
                onClick={() => handleCopy('docker', dockerComposeYaml)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1.5 cursor-pointer"
              >
                {copiedKey === 'docker' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'docker' ? t('blueprint.copied') : t('blueprint.copyCode')}</span>
              </button>
            </div>

            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-blue-300 overflow-x-auto leading-relaxed">
              {dockerComposeYaml}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
