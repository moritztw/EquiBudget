from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import ResourceConflictError, ResourceNotFoundError
from app.domain.accrual_engine import (
    ExpenseSettlementPlan,
    RateRevisionSnapshot,
    SinkingFundSnapshot,
    normalize_to_month_start,
)
from app.domain.money import ZERO, quantize_cents
from app.models.entities import (
    Account,
    BudgetCategory,
    Person,
    PersonMonthlyIncome,
    SinkingFund,
    SinkingFundLedgerEntry,
    SinkingFundRateRevision,
    Tenant,
    Transaction,
)
from app.models.enums import (
    MatchSource,
    SinkingFundEntryType,
    TransactionDirection,
)
from app.schemas.api import (
    AccountCreate,
    BudgetCategoryCreate,
    PersonCreate,
    PersonMonthlyIncomeUpsert,
    PersonUpdate,
    SinkingFundCreate,
    SinkingFundProvisionCreate,
    SinkingFundUpdate,
    TenantCreate,
)


class HouseholdRepository:
    """
    Async data-access repository enforcing strict `tenant_id` isolation across all queries.
    """

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID) -> None:
        self._session = session
        self._tenant_id = tenant_id

    @property
    def tenant_id(self) -> uuid.UUID:
        return self._tenant_id

    # --- Persons & Month-Specific Variable Incomes ---

    async def list_persons(self, *, active_only: bool = True) -> list[Person]:
        stmt = select(Person).where(Person.tenant_id == self._tenant_id)
        if active_only:
            stmt = stmt.where(Person.is_active.is_(True))
        stmt = stmt.order_by(Person.display_name.asc())
        result = await self._session.scalars(stmt)
        return list(result.all())

    async def get_person(self, person_id: uuid.UUID) -> Person:
        stmt = select(Person).where(
            Person.tenant_id == self._tenant_id,
            Person.id == person_id,
        )
        person = await self._session.scalar(stmt)
        if person is None:
            raise ResourceNotFoundError("Person", str(person_id))
        return person

    async def create_person(self, data: PersonCreate) -> Person:
        person = Person(
            tenant_id=self._tenant_id,
            display_name=data.display_name,
            is_employed=data.is_employed,
            participates_in_shared_split=data.participates_in_shared_split,
            monthly_net_income=quantize_cents(data.monthly_net_income),
            fixed_personal_deductions=quantize_cents(data.fixed_personal_deductions),
            custom_allocation_weight=data.custom_allocation_weight,
        )
        self._session.add(person)
        await self._session.flush()
        await self._session.refresh(person)
        return person

    async def update_person(self, person_id: uuid.UUID, data: PersonUpdate) -> Person:
        person = await self.get_person(person_id)
        updates = data.model_dump(exclude_unset=True)
        for field_name, value in updates.items():
            if field_name in {"monthly_net_income", "fixed_personal_deductions"} and value is not None:
                setattr(person, field_name, quantize_cents(value))
            else:
                setattr(person, field_name, value)
        await self._session.flush()
        await self._session.refresh(person)
        return person

    async def list_monthly_incomes(
        self,
        *,
        period_month: date | None = None,
        person_id: uuid.UUID | None = None,
    ) -> list[PersonMonthlyIncome]:
        stmt = select(PersonMonthlyIncome).where(PersonMonthlyIncome.tenant_id == self._tenant_id)
        if period_month is not None:
            stmt = stmt.where(
                PersonMonthlyIncome.period_month == normalize_to_month_start(period_month)
            )
        if person_id is not None:
            stmt = stmt.where(PersonMonthlyIncome.person_id == person_id)
        stmt = stmt.order_by(PersonMonthlyIncome.period_month.desc())
        result = await self._session.scalars(stmt)
        return list(result.all())

    async def upsert_person_monthly_income(
        self,
        person_id: uuid.UUID,
        period_month: date,
        data: PersonMonthlyIncomeUpsert,
    ) -> PersonMonthlyIncome:
        """Idempotently record or update the real monthly net income for `(person_id, YYYY-MM-01)`."""
        await self.get_person(person_id)
        normalized_month = normalize_to_month_start(period_month)

        stmt = select(PersonMonthlyIncome).where(
            PersonMonthlyIncome.tenant_id == self._tenant_id,
            PersonMonthlyIncome.person_id == person_id,
            PersonMonthlyIncome.period_month == normalized_month,
        )
        record = await self._session.scalar(stmt)
        if record is None:
            record = PersonMonthlyIncome(
                tenant_id=self._tenant_id,
                person_id=person_id,
                period_month=normalized_month,
                actual_net_income=quantize_cents(data.actual_net_income),
                personal_fixed_deductions=quantize_cents(data.personal_fixed_deductions),
                note=data.note,
            )
            self._session.add(record)
        else:
            record.actual_net_income = quantize_cents(data.actual_net_income)
            record.personal_fixed_deductions = quantize_cents(data.personal_fixed_deductions)
            record.note = data.note

        await self._session.flush()
        await self._session.refresh(record)
        return record

    # --- Accounts & Physical Balances ---

    async def list_accounts(self, *, active_only: bool = True) -> list[Account]:
        stmt = select(Account).where(Account.tenant_id == self._tenant_id)
        if active_only:
            stmt = stmt.where(Account.is_active.is_(True))
        stmt = stmt.order_by(Account.name.asc())
        result = await self._session.scalars(stmt)
        return list(result.all())

    async def get_account(self, account_id: uuid.UUID) -> Account:
        stmt = select(Account).where(
            Account.tenant_id == self._tenant_id,
            Account.id == account_id,
        )
        account = await self._session.scalar(stmt)
        if account is None:
            raise ResourceNotFoundError("Account", str(account_id))
        return account

    async def create_account(self, data: AccountCreate) -> Account:
        if data.owner_person_id is not None:
            await self.get_person(data.owner_person_id)

        account = Account(
            tenant_id=self._tenant_id,
            owner_person_id=data.owner_person_id,
            name=data.name,
            institution_name=data.institution_name,
            iban=data.iban,
            account_type=data.account_type,
            currency=data.currency.upper(),
            opening_balance=quantize_cents(data.opening_balance),
            opening_balance_date=data.opening_balance_date,
        )
        self._session.add(account)
        await self._session.flush()
        await self._session.refresh(account)
        return account

    async def compute_physical_account_balance(self, account: Account) -> Decimal:
        """Compute opening_balance + SUM(transactions.amount) in a single SQL query."""
        stmt = select(func.coalesce(func.sum(Transaction.amount), ZERO)).where(
            Transaction.tenant_id == self._tenant_id,
            Transaction.account_id == account.id,
        )
        tx_sum = await self._session.scalar(stmt)
        movement = Decimal(tx_sum) if tx_sum is not None else ZERO
        return quantize_cents(account.opening_balance + movement)

    # --- Budget Categories ---

    async def list_categories(self, *, active_only: bool = True) -> list[BudgetCategory]:
        stmt = select(BudgetCategory).where(BudgetCategory.tenant_id == self._tenant_id)
        if active_only:
            stmt = stmt.where(BudgetCategory.is_active.is_(True))
        stmt = stmt.order_by(BudgetCategory.name.asc())
        result = await self._session.scalars(stmt)
        return list(result.all())

    async def get_category(self, category_id: uuid.UUID) -> BudgetCategory:
        stmt = select(BudgetCategory).where(
            BudgetCategory.tenant_id == self._tenant_id,
            BudgetCategory.id == category_id,
        )
        category = await self._session.scalar(stmt)
        if category is None:
            raise ResourceNotFoundError("BudgetCategory", str(category_id))
        return category

    async def create_category(self, data: BudgetCategoryCreate) -> BudgetCategory:
        if data.parent_id is not None:
            await self.get_category(data.parent_id)

        category = BudgetCategory(
            tenant_id=self._tenant_id,
            parent_id=data.parent_id,
            name=data.name,
            is_shared_expense=data.is_shared_expense,
            monthly_target_amount=quantize_cents(data.monthly_target_amount),
            allocation_strategy_override=data.allocation_strategy_override,
        )
        self._session.add(category)
        await self._session.flush()
        await self._session.refresh(category)
        return category

    # --- Planned Payments / Sinking Funds & Virtual Ledger ---

    async def list_sinking_funds_with_balances(
        self,
        *,
        active_only: bool = False,
        backing_account_id: uuid.UUID | None = None,
    ) -> list[tuple[SinkingFund, Decimal]]:
        """Fetch planned payments / sinking funds joined with their virtual ledger balances."""
        balance_expr = func.coalesce(func.sum(SinkingFundLedgerEntry.amount), ZERO)
        stmt = (
            select(SinkingFund, balance_expr)
            .outerjoin(
                SinkingFundLedgerEntry,
                (SinkingFundLedgerEntry.sinking_fund_id == SinkingFund.id)
                & (SinkingFundLedgerEntry.tenant_id == self._tenant_id),
            )
            .where(SinkingFund.tenant_id == self._tenant_id)
            .group_by(SinkingFund.id)
            .order_by(SinkingFund.next_due_date.asc(), SinkingFund.name.asc())
        )
        if active_only:
            stmt = stmt.where(SinkingFund.is_active.is_(True))
        if backing_account_id is not None:
            stmt = stmt.where(SinkingFund.backing_account_id == backing_account_id)

        rows = (await self._session.execute(stmt)).all()
        return [(row[0], quantize_cents(Decimal(row[1]))) for row in rows]

    async def get_sinking_fund_with_balance(
        self,
        fund_id: uuid.UUID,
    ) -> tuple[SinkingFund, Decimal]:
        balance_expr = func.coalesce(func.sum(SinkingFundLedgerEntry.amount), ZERO)
        stmt = (
            select(SinkingFund, balance_expr)
            .outerjoin(
                SinkingFundLedgerEntry,
                (SinkingFundLedgerEntry.sinking_fund_id == SinkingFund.id)
                & (SinkingFundLedgerEntry.tenant_id == self._tenant_id),
            )
            .where(
                SinkingFund.tenant_id == self._tenant_id,
                SinkingFund.id == fund_id,
            )
            .group_by(SinkingFund.id)
        )
        row = (await self._session.execute(stmt)).first()
        if row is None:
            raise ResourceNotFoundError("SinkingFund", str(fund_id))
        return row[0], quantize_cents(Decimal(row[1]))

    async def create_sinking_fund(
        self,
        data: SinkingFundCreate,
        *,
        carryover_period_month: date | None = None,
        carryover_note: str | None = None,
    ) -> tuple[SinkingFund, Decimal]:
        await self.get_account(data.backing_account_id)
        if data.category_id is not None:
            await self.get_category(data.category_id)

        fund = SinkingFund(
            tenant_id=self._tenant_id,
            backing_account_id=data.backing_account_id,
            category_id=data.category_id,
            name=data.name,
            payee=data.payee,
            description=data.description,
            target_amount=quantize_cents(data.target_amount),
            recurrence_interval=data.recurrence_interval,
            next_due_date=data.next_due_date,
            end_date=data.end_date,
            auto_accrual=data.auto_accrual,
            is_shared_obligation=data.is_shared_obligation,
            allocation_strategy_override=data.allocation_strategy_override,
        )
        self._session.add(fund)
        await self._session.flush()

        for rev in data.rate_revisions:
            self._session.add(
                SinkingFundRateRevision(
                    tenant_id=self._tenant_id,
                    sinking_fund_id=fund.id,
                    valid_from=rev.valid_from,
                    amount=quantize_cents(rev.amount),
                    note=rev.note,
                )
            )

        initial_balance = quantize_cents(data.initial_carryover_amount)
        if initial_balance > ZERO:
            period_anchor = normalize_to_month_start(carryover_period_month or date.today())
            carryover_entry = SinkingFundLedgerEntry(
                tenant_id=self._tenant_id,
                sinking_fund_id=fund.id,
                accrual_period_month=period_anchor,
                entry_type=SinkingFundEntryType.INITIAL_CARRYOVER,
                amount=initial_balance,
                note=carryover_note or "Startguthaben (Initial Carryover)",
            )
            self._session.add(carryover_entry)

        await self._session.flush()
        await self._session.refresh(fund)
        return fund, initial_balance

    async def update_sinking_fund(
        self,
        fund_id: uuid.UUID,
        data: SinkingFundUpdate,
    ) -> tuple[SinkingFund, Decimal]:
        """Update all editable properties, `end_date`, and effective-dated `rate_revisions`."""
        fund, current_balance = await self.get_sinking_fund_with_balance(fund_id)
        updates = data.model_dump(exclude_unset=True)

        if "backing_account_id" in updates and updates["backing_account_id"] is not None:
            await self.get_account(updates["backing_account_id"])
        if "category_id" in updates and updates["category_id"] is not None:
            await self.get_category(updates["category_id"])

        revisions_payload = updates.pop("rate_revisions", None)
        for field_name, value in updates.items():
            if field_name == "target_amount" and value is not None:
                setattr(fund, field_name, quantize_cents(value))
            else:
                setattr(fund, field_name, value)

        if revisions_payload is not None:
            await self._session.execute(
                delete(SinkingFundRateRevision).where(
                    SinkingFundRateRevision.tenant_id == self._tenant_id,
                    SinkingFundRateRevision.sinking_fund_id == fund.id,
                )
            )
            for rev in data.rate_revisions or []:
                self._session.add(
                    SinkingFundRateRevision(
                        tenant_id=self._tenant_id,
                        sinking_fund_id=fund.id,
                        valid_from=rev.valid_from,
                        amount=quantize_cents(rev.amount),
                        note=rev.note,
                    )
                )

        await self._session.flush()
        await self._session.refresh(fund)
        return fund, current_balance

    async def delete_sinking_fund(self, fund_id: uuid.UUID) -> None:
        """
        Safely delete a planned payment / sinking fund.
        Protects virtual pot ledger integrity: if virtual balance is non-zero (positive residual
        or negative overdraft), raises a conflict so the pot is manually reallocated/settled first.
        """
        fund, current_balance = await self.get_sinking_fund_with_balance(fund_id)
        if current_balance != ZERO:
            raise ResourceConflictError(
                f"Cannot delete '{fund.name}' while virtual pot balance ({current_balance} EUR) is non-zero. "
                "Please reallocate or balance the virtual pot first.",
                context={
                    "sinking_fund_id": str(fund.id),
                    "current_virtual_balance": str(current_balance),
                },
            )
        await self._session.delete(fund)
        await self._session.flush()


    async def add_sinking_fund_provision(
        self,
        fund_id: uuid.UUID,
        data: SinkingFundProvisionCreate,
    ) -> SinkingFundLedgerEntry:
        fund, _ = await self.get_sinking_fund_with_balance(fund_id)
        normalized_period = normalize_to_month_start(data.accrual_period_month)

        if data.entry_type == SinkingFundEntryType.MONTHLY_PROVISION:
            duplicate_stmt = select(SinkingFundLedgerEntry.id).where(
                SinkingFundLedgerEntry.tenant_id == self._tenant_id,
                SinkingFundLedgerEntry.sinking_fund_id == fund.id,
                SinkingFundLedgerEntry.accrual_period_month == normalized_period,
                SinkingFundLedgerEntry.entry_type == SinkingFundEntryType.MONTHLY_PROVISION,
            )
            existing_id = await self._session.scalar(duplicate_stmt)
            if existing_id is not None:
                raise ResourceConflictError(
                    f"Monthly provision for '{fund.name}' in period {normalized_period.isoformat()} already exists.",
                    context={
                        "sinking_fund_id": str(fund.id),
                        "accrual_period_month": normalized_period.isoformat(),
                    },
                )

        entry = SinkingFundLedgerEntry(
            tenant_id=self._tenant_id,
            sinking_fund_id=fund.id,
            accrual_period_month=normalized_period,
            entry_type=data.entry_type,
            amount=quantize_cents(data.amount),
            note=data.note,
        )
        self._session.add(entry)
        await self._session.flush()
        await self._session.refresh(entry)
        return entry

    async def execute_sinking_fund_settlement(
        self,
        *,
        fund: SinkingFund,
        settlement_plan: ExpenseSettlementPlan,
        booking_date: date,
        counterparty_name: str | None,
        purpose_text: str,
        record_bank_transaction: bool,
    ) -> tuple[SinkingFundLedgerEntry | None, Transaction | None]:
        """
        Atomically record optional physical bank outflow transaction, release available virtual
        pot reserve if non-zero, and advance `next_due_date` to the next billing cycle.
        Any remaining pot surplus stays intact in the virtual pot for manual reallocation.
        """
        account = await self.get_account(fund.backing_account_id)
        created_tx: Transaction | None = None

        if record_bank_transaction:
            created_tx = Transaction(
                tenant_id=self._tenant_id,
                account_id=account.id,
                category_id=fund.category_id,
                sinking_fund_id=fund.id,
                booking_date=booking_date,
                value_date=booking_date,
                amount=-quantize_cents(settlement_plan.actual_invoice_amount),
                currency=account.currency,
                direction=TransactionDirection.OUTFLOW,
                counterparty_name=counterparty_name or fund.payee,
                purpose_text=purpose_text or f"Settlement: {fund.name}",
                match_source=MatchSource.MANUAL,
            )
            self._session.add(created_tx)
            await self._session.flush()

        ledger_entry: SinkingFundLedgerEntry | None = None
        if settlement_plan.settlement_ledger_amount != ZERO:
            ledger_entry = SinkingFundLedgerEntry(
                tenant_id=self._tenant_id,
                sinking_fund_id=fund.id,
                linked_transaction_id=created_tx.id if created_tx is not None else None,
                accrual_period_month=normalize_to_month_start(booking_date),
                entry_type=SinkingFundEntryType.EXPENSE_SETTLEMENT,
                amount=settlement_plan.settlement_ledger_amount,
                note=purpose_text or f"Invoice settlement ({booking_date.isoformat()})",
            )
            self._session.add(ledger_entry)

        fund.next_due_date = settlement_plan.next_cycle_due_date
        await self._session.flush()
        if ledger_entry is not None:
            await self._session.refresh(ledger_entry)
        return ledger_entry, created_tx

    @staticmethod
    def to_fund_snapshot(fund: SinkingFund, balance: Decimal) -> SinkingFundSnapshot:
        revisions = tuple(
            RateRevisionSnapshot(
                valid_from=r.valid_from,
                amount=r.amount,
                note=r.note,
            )
            for r in fund.rate_revisions
        )
        return SinkingFundSnapshot(
            sinking_fund_id=fund.id,
            backing_account_id=fund.backing_account_id,
            name=fund.name,
            target_amount=fund.target_amount,
            recurrence_interval=fund.recurrence_interval,
            next_due_date=fund.next_due_date,
            end_date=fund.end_date,
            auto_accrual=fund.auto_accrual,
            rate_revisions=revisions,
            current_virtual_balance=balance,
            is_shared_obligation=fund.is_shared_obligation,
            allocation_strategy_override=fund.allocation_strategy_override,
        )


class TenantRepository:
    """System-level repository for household tenant provisioning and lookup."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_tenants(self) -> list[Tenant]:
        stmt = select(Tenant).where(Tenant.is_active.is_(True)).order_by(Tenant.name.asc())
        result = await self._session.scalars(stmt)
        return list(result.all())

    async def get_active_tenant(self, tenant_id: uuid.UUID) -> Tenant | None:
        stmt = select(Tenant).where(
            Tenant.id == tenant_id,
            Tenant.is_active.is_(True),
        )
        return await self._session.scalar(stmt)

    async def get_single_default_tenant(self) -> Tenant | None:
        stmt = select(Tenant).where(Tenant.is_active.is_(True)).order_by(Tenant.created_at.asc()).limit(2)
        tenants = list((await self._session.scalars(stmt)).all())
        if len(tenants) == 1:
            return tenants[0]
        return None

    async def create_tenant(self, data: TenantCreate) -> Tenant:
        existing_slug = await self._session.scalar(
            select(Tenant.id).where(Tenant.slug == data.slug)
        )
        if existing_slug is not None:
            raise ResourceConflictError(
                f"Tenant with slug '{data.slug}' already exists.",
                context={"slug": data.slug},
            )

        tenant = Tenant(
            name=data.name,
            slug=data.slug,
            default_currency=data.default_currency.upper(),
            default_locale=data.default_locale,
            default_allocation_strategy=data.default_allocation_strategy,
            default_import_commit_mode=data.default_import_commit_mode,
        )
        self._session.add(tenant)
        await self._session.flush()
        await self._session.refresh(tenant)
        return tenant
