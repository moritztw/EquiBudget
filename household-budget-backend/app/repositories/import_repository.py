from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.errors import ResourceConflictError, ResourceNotFoundError
from app.domain.accrual_engine import AccrualEngine, normalize_to_month_start
from app.domain.exceptions import DomainValidationError
from app.domain.money import ZERO, quantize_cents
from app.importers.base import StatementParseResult, normalize_iban
from app.matching.interfaces import TransactionCandidate, TransactionMatchDecision
from app.matching.matchers import (
    OwnHouseholdAccountTransferMatcher,
    RegexRuleMatcher,
    TransactionMatchingPipeline,
)
from app.models.entities import (
    Account,
    ImportBatch,
    ImportStagingRow,
    MatchingRule,
    SinkingFundLedgerEntry,
    Transaction,
)
from app.models.enums import (
    DuplicateMatchKind,
    ImportBatchStatus,
    ImportCommitMode,
    ImportRowStatus,
    MatchSource,
    SinkingFundEntryType,
    TransactionDirection,
)
from app.repositories.budget_repository import HouseholdRepository
from app.schemas.imports import (
    ImportBatchCommitRequest,
    ImportStagingRowOverride,
    MatchingRuleCreate,
    TransactionClassificationUpdate,
    TransactionManualCreate,
    VirtualPotReallocationRequest,
)

SEMANTIC_DUPLICATE_WINDOW_DAYS = 4


def _normalize_party_token(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.strip().lower().split())


class StatementImportRepository:
    """
    Transactional service-repository coordinating:
    1. MatchingRule management & pipeline assembly
    2. CSV Statement ingestion across all 3 ImportCommitModes with 2-layer deduplication:
       - Layer 1 (`EXACT_HASH`): SHA-256 fingerprint match on `(account_id, import_dedup_hash)`
       - Layer 2 (`SEMANTIC_MATCH`): Protects against double-booking manually entered payments or
         prior pot settlements (`booking_date ± 4 days`, identical signed amount, matching IBAN /
         counterparty / sinking fund).
    3. Uncovered virtual pot settlements: debits the full payment amount onto the virtual pot even
       when `current_virtual_balance <= 0` or `< invoice_amount` (negative pot balance / overdraft).
    4. Full ERP actual transactions query, manual booking, and inline pot/category reclassification.
    5. Purely virtual pot-to-pot reserve reallocations (`VIRTUAL_POT_REALLOCATION`).
    """

    def __init__(
        self,
        session: AsyncSession,
        household_repo: HouseholdRepository,
        accrual_engine: AccrualEngine | None = None,
    ) -> None:
        self._session = session
        self._household_repo = household_repo
        self._tenant_id = household_repo.tenant_id
        self._accrual_engine = accrual_engine or AccrualEngine()

    # --- Matching Rules ---

    async def list_matching_rules(self, *, active_only: bool = True) -> list[MatchingRule]:
        stmt = select(MatchingRule).where(MatchingRule.tenant_id == self._tenant_id)
        if active_only:
            stmt = stmt.where(MatchingRule.is_active.is_(True))
        stmt = stmt.order_by(MatchingRule.priority.asc(), MatchingRule.name.asc())
        result = await self._session.scalars(stmt)
        return list(result.all())

    async def create_matching_rule(self, data: MatchingRuleCreate) -> MatchingRule:
        if data.target_category_id is not None:
            await self._household_repo.get_category(data.target_category_id)
        if data.target_sinking_fund_id is not None:
            await self._household_repo.get_sinking_fund_with_balance(data.target_sinking_fund_id)
        if data.target_person_id is not None:
            await self._household_repo.get_person(data.target_person_id)

        RegexRuleMatcher.compile_rule(
            rule_id=uuid.uuid4(),
            priority=data.priority,
            match_field=data.match_field,
            regex_pattern=data.regex_pattern,
            case_sensitive=data.case_sensitive,
            min_abs_amount=data.min_abs_amount,
            max_abs_amount=data.max_abs_amount,
            target_category_id=data.target_category_id,
            target_sinking_fund_id=data.target_sinking_fund_id,
            target_person_id=data.target_person_id,
        )

        rule = MatchingRule(
            tenant_id=self._tenant_id,
            name=data.name,
            priority=data.priority,
            match_field=data.match_field,
            regex_pattern=data.regex_pattern,
            case_sensitive=data.case_sensitive,
            min_abs_amount=(
                quantize_cents(data.min_abs_amount) if data.min_abs_amount is not None else None
            ),
            max_abs_amount=(
                quantize_cents(data.max_abs_amount) if data.max_abs_amount is not None else None
            ),
            target_category_id=data.target_category_id,
            target_sinking_fund_id=data.target_sinking_fund_id,
            target_person_id=data.target_person_id,
        )
        self._session.add(rule)
        await self._session.flush()
        await self._session.refresh(rule)
        return rule

    async def _build_pipeline(self) -> TransactionMatchingPipeline:
        accounts = await self._household_repo.list_accounts(active_only=True)
        iban_map = {acc.iban: acc.id for acc in accounts if acc.iban is not None}
        own_transfer_stage = OwnHouseholdAccountTransferMatcher(iban_map)

        rules = await self.list_matching_rules(active_only=True)
        compiled_rules = [
            RegexRuleMatcher.compile_rule(
                rule_id=r.id,
                priority=r.priority,
                match_field=r.match_field,
                regex_pattern=r.regex_pattern,
                case_sensitive=r.case_sensitive,
                min_abs_amount=r.min_abs_amount,
                max_abs_amount=r.max_abs_amount,
                target_category_id=r.target_category_id,
                target_sinking_fund_id=r.target_sinking_fund_id,
                target_person_id=r.target_person_id,
            )
            for r in rules
        ]
        regex_stage = RegexRuleMatcher(compiled_rules)

        return TransactionMatchingPipeline([own_transfer_stage, regex_stage])

    # --- Virtual Pot Reallocation (Strictly distinct from Physical Transfers) ---

    async def reallocate_virtual_pots(
        self,
        payload: VirtualPotReallocationRequest,
    ) -> tuple[
        uuid.UUID,
        SinkingFundLedgerEntry,
        SinkingFundLedgerEntry,
        Decimal,
        Decimal,
    ]:
        """
        Shift virtual reserves from `source_sinking_fund_id` to `target_sinking_fund_id`.
        Source pot must hold sufficient positive virtual balance; target pot may be active,
        archived, or negative (overdrawn) to replenish an uncovered pot payment.
        """
        source_fund, source_balance = await self._household_repo.get_sinking_fund_with_balance(
            payload.source_sinking_fund_id
        )
        target_fund, target_balance = await self._household_repo.get_sinking_fund_with_balance(
            payload.target_sinking_fund_id
        )

        transfer_amount = quantize_cents(payload.amount)
        if source_balance < transfer_amount:
            raise DomainValidationError(
                f"Insufficient virtual reserve in '{source_fund.name}' for reallocation.",
                details={
                    "source_sinking_fund_id": str(source_fund.id),
                    "available_virtual_balance": str(source_balance),
                    "requested_amount": str(transfer_amount),
                },
            )

        group_id = uuid.uuid4()
        period_month = normalize_to_month_start(payload.effective_date)
        default_note = payload.note or f"Virtual reallocation: {source_fund.name} -> {target_fund.name}"

        debit_entry = SinkingFundLedgerEntry(
            tenant_id=self._tenant_id,
            sinking_fund_id=source_fund.id,
            reallocation_group_id=group_id,
            accrual_period_month=period_month,
            entry_type=SinkingFundEntryType.VIRTUAL_POT_REALLOCATION,
            amount=-transfer_amount,
            note=default_note,
        )
        credit_entry = SinkingFundLedgerEntry(
            tenant_id=self._tenant_id,
            sinking_fund_id=target_fund.id,
            reallocation_group_id=group_id,
            accrual_period_month=period_month,
            entry_type=SinkingFundEntryType.VIRTUAL_POT_REALLOCATION,
            amount=transfer_amount,
            note=default_note,
        )

        self._session.add_all([debit_entry, credit_entry])
        await self._session.flush()
        await self._session.refresh(debit_entry)
        await self._session.refresh(credit_entry)

        new_source_balance = quantize_cents(source_balance - transfer_amount)
        new_target_balance = quantize_cents(target_balance + transfer_amount)
        return group_id, debit_entry, credit_entry, new_source_balance, new_target_balance

    # --- 2-Layer Statement Deduplication Helper ---

    @staticmethod
    def _evaluate_duplicate_against_ledger(
        *,
        import_dedup_hash: str,
        booking_date: date,
        amount: Decimal,
        counterparty_name: str | None,
        counterparty_iban: str | None,
        proposed_sinking_fund_id: uuid.UUID | None,
        existing_by_hash: dict[str, Transaction],
        window_transactions: list[Transaction],
        consumed_semantic_tx_ids: set[uuid.UUID],
    ) -> tuple[DuplicateMatchKind, uuid.UUID | None, str | None]:
        exact_tx = existing_by_hash.get(import_dedup_hash)
        if exact_tx is not None:
            return (
                DuplicateMatchKind.EXACT_HASH,
                exact_tx.id,
                f"Exakter CSV-Hash bereits am {exact_tx.booking_date.isoformat()} verbucht.",
            )

        norm_iban = normalize_iban(counterparty_iban)
        norm_party = _normalize_party_token(counterparty_name)
        quant_amt = quantize_cents(amount)

        for candidate in window_transactions:
            if candidate.id in consumed_semantic_tx_ids:
                continue
            if quantize_cents(candidate.amount) != quant_amt:
                continue
            day_delta = abs((candidate.booking_date - booking_date).days)
            if day_delta > SEMANTIC_DUPLICATE_WINDOW_DAYS:
                continue

            cand_iban = normalize_iban(candidate.counterparty_iban)
            cand_party = _normalize_party_token(candidate.counterparty_name)

            iban_match = bool(norm_iban and cand_iban and norm_iban == cand_iban)
            party_match = bool(
                norm_party
                and cand_party
                and (norm_party in cand_party or cand_party in norm_party)
            )
            fund_match = bool(
                proposed_sinking_fund_id is not None
                and candidate.sinking_fund_id == proposed_sinking_fund_id
            )

            if iban_match or party_match or fund_match:
                consumed_semantic_tx_ids.add(candidate.id)
                return (
                    DuplicateMatchKind.SEMANTIC_MATCH,
                    candidate.id,
                    f"Mögliche Doppelbuchung zu Zahlung vom {candidate.booking_date.isoformat()} "
                    f"({candidate.counterparty_name or 'gleicher Betrag'}).",
                )

        return (DuplicateMatchKind.NONE, None, None)

    # --- Statement Import Orchestration ---

    async def ingest_parsed_statement(
        self,
        *,
        account: Account,
        source_filename: str,
        parse_result: StatementParseResult,
        commit_mode: ImportCommitMode,
    ) -> ImportBatch:
        candidate_hashes = [r.import_dedup_hash for r in parse_result.rows]
        existing_by_hash: dict[str, Transaction] = {}
        if candidate_hashes:
            existing_stmt = select(Transaction).where(
                Transaction.tenant_id == self._tenant_id,
                Transaction.account_id == account.id,
                Transaction.import_dedup_hash.in_(candidate_hashes),
            )
            for tx in (await self._session.scalars(existing_stmt)).all():
                if tx.import_dedup_hash is not None:
                    existing_by_hash[tx.import_dedup_hash] = tx

        window_transactions: list[Transaction] = []
        if parse_result.rows:
            min_dt = min(r.booking_date for r in parse_result.rows) - timedelta(
                days=SEMANTIC_DUPLICATE_WINDOW_DAYS
            )
            max_dt = max(r.booking_date for r in parse_result.rows) + timedelta(
                days=SEMANTIC_DUPLICATE_WINDOW_DAYS
            )
            window_stmt = select(Transaction).where(
                Transaction.tenant_id == self._tenant_id,
                Transaction.account_id == account.id,
                Transaction.booking_date >= min_dt,
                Transaction.booking_date <= max_dt,
            )
            window_transactions = list((await self._session.scalars(window_stmt)).all())

        pipeline = await self._build_pipeline()

        batch = ImportBatch(
            tenant_id=self._tenant_id,
            account_id=account.id,
            source_filename=source_filename,
            parser_key=parse_result.parser_key,
            commit_mode=commit_mode,
            status=(
                ImportBatchStatus.PENDING_CONFIRMATION
                if commit_mode == ImportCommitMode.TWO_STAGE_PREVIEW
                else ImportBatchStatus.COMMITTED
            ),
            total_rows_parsed=len(parse_result.rows),
            duplicate_rows_skipped=0,
            committed_rows_count=0,
        )
        self._session.add(batch)
        await self._session.flush()

        duplicates = 0
        committed = 0
        consumed_semantic_tx_ids: set[uuid.UUID] = set()

        for parsed_row in parse_result.rows:
            decision = await pipeline.classify(
                TransactionCandidate(
                    account_id=account.id,
                    booking_date=parsed_row.booking_date,
                    amount=parsed_row.amount,
                    currency=parsed_row.currency,
                    counterparty_name=parsed_row.counterparty_name,
                    counterparty_iban=parsed_row.counterparty_iban,
                    purpose_text=parsed_row.purpose_text,
                )
            )

            dup_kind, dup_tx_id, dup_reason = self._evaluate_duplicate_against_ledger(
                import_dedup_hash=parsed_row.import_dedup_hash,
                booking_date=parsed_row.booking_date,
                amount=parsed_row.amount,
                counterparty_name=parsed_row.counterparty_name,
                counterparty_iban=parsed_row.counterparty_iban,
                proposed_sinking_fund_id=decision.sinking_fund_id,
                existing_by_hash=existing_by_hash,
                window_transactions=window_transactions,
                consumed_semantic_tx_ids=consumed_semantic_tx_ids,
            )
            is_dup = dup_kind != DuplicateMatchKind.NONE
            if is_dup:
                duplicates += 1

            if commit_mode == ImportCommitMode.TWO_STAGE_PREVIEW:
                staging_row = ImportStagingRow(
                    tenant_id=self._tenant_id,
                    batch_id=batch.id,
                    row_number=parsed_row.row_number,
                    row_status=(
                        ImportRowStatus.DUPLICATE_SKIPPED
                        if is_dup
                        else ImportRowStatus.READY
                    ),
                    booking_date=parsed_row.booking_date,
                    value_date=parsed_row.value_date,
                    amount=parsed_row.amount,
                    currency=parsed_row.currency,
                    counterparty_name=parsed_row.counterparty_name,
                    counterparty_iban=parsed_row.counterparty_iban,
                    purpose_text=parsed_row.purpose_text,
                    import_dedup_hash=parsed_row.import_dedup_hash,
                    duplicate_match_kind=dup_kind,
                    duplicate_of_transaction_id=dup_tx_id,
                    duplicate_reason=dup_reason,
                    proposed_direction=decision.direction,
                    proposed_counterpart_account_id=decision.counterpart_account_id,
                    proposed_category_id=decision.category_id,
                    proposed_sinking_fund_id=decision.sinking_fund_id,
                    proposed_person_id=decision.paid_by_person_id,
                    matched_rule_id=decision.matched_rule_id,
                    match_source=decision.match_source,
                    match_confidence=decision.confidence,
                )
                self._session.add(staging_row)
            elif not is_dup:
                needs_review = commit_mode == ImportCommitMode.DIRECT_WITH_REVIEW_FLAG
                tx = await self._persist_transaction_and_optional_settlement(
                    account_id=account.id,
                    batch_id=batch.id,
                    booking_date=parsed_row.booking_date,
                    value_date=parsed_row.value_date,
                    amount=parsed_row.amount,
                    currency=parsed_row.currency,
                    counterparty_name=parsed_row.counterparty_name,
                    counterparty_iban=parsed_row.counterparty_iban,
                    purpose_text=parsed_row.purpose_text,
                    import_dedup_hash=parsed_row.import_dedup_hash,
                    decision=decision,
                    needs_review=needs_review,
                )
                existing_by_hash[parsed_row.import_dedup_hash] = tx
                window_transactions.append(tx)
                committed += 1

        batch.duplicate_rows_skipped = duplicates
        batch.committed_rows_count = committed
        await self._session.flush()
        return await self.get_import_batch(batch.id)

    async def get_import_batch(self, batch_id: uuid.UUID) -> ImportBatch:
        stmt = (
            select(ImportBatch)
            .options(selectinload(ImportBatch.staging_rows))
            .where(
                ImportBatch.tenant_id == self._tenant_id,
                ImportBatch.id == batch_id,
            )
        )
        batch = await self._session.scalar(stmt)
        if batch is None:
            raise ResourceNotFoundError("ImportBatch", str(batch_id))
        return batch

    async def commit_staged_batch(
        self,
        batch_id: uuid.UUID,
        request: ImportBatchCommitRequest,
    ) -> ImportBatch:
        batch = await self.get_import_batch(batch_id)
        if batch.status != ImportBatchStatus.PENDING_CONFIRMATION:
            raise ResourceConflictError(
                f"ImportBatch '{batch_id}' is already in status '{batch.status}'.",
                context={"batch_id": str(batch.id), "status": batch.status.value},
            )

        overrides_by_id: dict[uuid.UUID, ImportStagingRowOverride] = {
            ov.staging_row_id: ov for ov in request.row_overrides
        }

        candidate_hashes = [r.import_dedup_hash for r in batch.staging_rows]
        existing_hashes: set[str] = set()
        if candidate_hashes:
            existing_stmt = select(Transaction.import_dedup_hash).where(
                Transaction.tenant_id == self._tenant_id,
                Transaction.account_id == batch.account_id,
                Transaction.import_dedup_hash.in_(candidate_hashes),
            )
            existing_hashes = {
                h for h in (await self._session.scalars(existing_stmt)).all() if h is not None
            }

        committed_count = 0
        for row in batch.staging_rows:
            override = overrides_by_id.get(row.id)
            allow_semantic_override = (
                row.row_status == ImportRowStatus.DUPLICATE_SKIPPED
                and row.duplicate_match_kind == DuplicateMatchKind.SEMANTIC_MATCH
                and override is not None
                and override.force_commit_duplicate
            )

            if row.row_status != ImportRowStatus.READY and not allow_semantic_override:
                continue

            if row.import_dedup_hash in existing_hashes:
                row.row_status = ImportRowStatus.DUPLICATE_SKIPPED
                row.duplicate_match_kind = DuplicateMatchKind.EXACT_HASH
                batch.duplicate_rows_skipped += 1
                continue

            if override is not None and override.exclude:
                row.row_status = ImportRowStatus.EXCLUDED
                continue

            has_manual_override = override is not None and (
                override.direction is not None
                or override.counterpart_account_id is not None
                or override.category_id is not None
                or override.sinking_fund_id is not None
                or override.paid_by_person_id is not None
            )

            effective_direction = (
                override.direction
                if override is not None and override.direction is not None
                else row.proposed_direction
            )
            effective_counterpart = (
                override.counterpart_account_id
                if override is not None and override.counterpart_account_id is not None
                else row.proposed_counterpart_account_id
            )
            effective_category = (
                override.category_id
                if override is not None and override.category_id is not None
                else row.proposed_category_id
            )
            effective_fund = (
                override.sinking_fund_id
                if override is not None and override.sinking_fund_id is not None
                else row.proposed_sinking_fund_id
            )
            effective_person = (
                override.paid_by_person_id
                if override is not None and override.paid_by_person_id is not None
                else row.proposed_person_id
            )

            decision = TransactionMatchDecision(
                direction=effective_direction,
                match_source=MatchSource.MANUAL if has_manual_override else row.match_source,
                confidence=(
                    Decimal("1.000")
                    if has_manual_override
                    else (row.match_confidence or ZERO)
                ),
                counterpart_account_id=effective_counterpart,
                category_id=effective_category,
                sinking_fund_id=effective_fund,
                paid_by_person_id=effective_person,
                matched_rule_id=None if has_manual_override else row.matched_rule_id,
            )

            await self._persist_transaction_and_optional_settlement(
                account_id=batch.account_id,
                batch_id=batch.id,
                booking_date=row.booking_date,
                value_date=row.value_date,
                amount=row.amount,
                currency=row.currency,
                counterparty_name=row.counterparty_name,
                counterparty_iban=row.counterparty_iban,
                purpose_text=row.purpose_text,
                import_dedup_hash=row.import_dedup_hash,
                decision=decision,
                needs_review=request.mark_needs_review,
            )
            existing_hashes.add(row.import_dedup_hash)
            row.row_status = ImportRowStatus.COMMITTED
            if allow_semantic_override and batch.duplicate_rows_skipped > 0:
                batch.duplicate_rows_skipped -= 1
            committed_count += 1

        batch.committed_rows_count = committed_count
        batch.status = ImportBatchStatus.COMMITTED
        await self._session.flush()
        return await self.get_import_batch(batch.id)

    # --- Actual Payments Journal (Query, Manual Booking & Reclassification) ---

    async def list_transactions(
        self,
        *,
        account_id: uuid.UUID | None = None,
        category_id: uuid.UUID | None = None,
        sinking_fund_id: uuid.UUID | None = None,
        direction: TransactionDirection | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        search: str | None = None,
        needs_review_only: bool = False,
        limit: int = 300,
    ) -> list[Transaction]:
        stmt = select(Transaction).where(Transaction.tenant_id == self._tenant_id)
        if account_id is not None:
            stmt = stmt.where(Transaction.account_id == account_id)
        if category_id is not None:
            stmt = stmt.where(Transaction.category_id == category_id)
        if sinking_fund_id is not None:
            stmt = stmt.where(Transaction.sinking_fund_id == sinking_fund_id)
        if direction is not None:
            stmt = stmt.where(Transaction.direction == direction)
        if date_from is not None:
            stmt = stmt.where(Transaction.booking_date >= date_from)
        if date_to is not None:
            stmt = stmt.where(Transaction.booking_date <= date_to)
        if needs_review_only:
            stmt = stmt.where(Transaction.needs_review.is_(True))
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    Transaction.counterparty_name.ilike(pattern),
                    Transaction.purpose_text.ilike(pattern),
                    Transaction.counterparty_iban.ilike(pattern),
                )
            )
        stmt = stmt.order_by(Transaction.booking_date.desc(), Transaction.created_at.desc()).limit(
            limit
        )
        result = await self._session.scalars(stmt)
        return list(result.all())

    async def create_manual_transaction(self, payload: TransactionManualCreate) -> Transaction:
        """
        Record an actual payment manually in the ledger journal.
        If `sinking_fund_id` is provided on an OUTFLOW, debits the full payment from the virtual
        pot even when the pot is uncovered (`current_virtual_balance <= 0` or `< abs(amount)`).
        """
        await self._household_repo.get_account(payload.account_id)
        if payload.category_id is not None:
            await self._household_repo.get_category(payload.category_id)
        if payload.sinking_fund_id is not None:
            await self._household_repo.get_sinking_fund_with_balance(payload.sinking_fund_id)
        if payload.paid_by_person_id is not None:
            await self._household_repo.get_person(payload.paid_by_person_id)

        signed_amount = quantize_cents(payload.amount)
        if payload.direction == TransactionDirection.OUTFLOW and signed_amount > ZERO:
            signed_amount = -signed_amount
        elif payload.direction == TransactionDirection.INFLOW and signed_amount < ZERO:
            signed_amount = abs(signed_amount)

        decision = TransactionMatchDecision(
            direction=payload.direction,
            match_source=MatchSource.MANUAL,
            confidence=Decimal("1.000"),
            counterpart_account_id=payload.counterpart_account_id,
            category_id=payload.category_id,
            sinking_fund_id=payload.sinking_fund_id,
            paid_by_person_id=payload.paid_by_person_id,
            matched_rule_id=None,
        )

        return await self._persist_transaction_and_optional_settlement(
            account_id=payload.account_id,
            batch_id=None,
            booking_date=payload.booking_date,
            value_date=payload.value_date or payload.booking_date,
            amount=signed_amount,
            currency=payload.currency,
            counterparty_name=payload.counterparty_name,
            counterparty_iban=normalize_iban(payload.counterparty_iban),
            purpose_text=payload.purpose_text,
            import_dedup_hash=None,
            decision=decision,
            needs_review=False,
        )

    async def update_transaction_classification(
        self,
        transaction_id: uuid.UUID,
        payload: TransactionClassificationUpdate,
    ) -> Transaction:
        """
        Update category, person, review state, or virtual pot assignment on an existing transaction.
        Maintains strict 1:1 synchronization with `SinkingFundLedgerEntry` (`linked_transaction_id`)
        and allows assigning outflows to uncovered virtual pots.
        """
        stmt = (
            select(Transaction)
            .options(selectinload(Transaction.sinking_ledger_entry))
            .where(
                Transaction.tenant_id == self._tenant_id,
                Transaction.id == transaction_id,
            )
        )
        tx = await self._session.scalar(stmt)
        if tx is None:
            raise ResourceNotFoundError("Transaction", str(transaction_id))

        updates = payload.model_dump(exclude_unset=True)
        if "category_id" in updates:
            if updates["category_id"] is not None:
                await self._household_repo.get_category(updates["category_id"])
            tx.category_id = updates["category_id"]

        if "paid_by_person_id" in updates:
            if updates["paid_by_person_id"] is not None:
                await self._household_repo.get_person(updates["paid_by_person_id"])
            tx.paid_by_person_id = updates["paid_by_person_id"]

        if "needs_review" in updates and updates["needs_review"] is not None:
            tx.needs_review = updates["needs_review"]

        if "sinking_fund_id" in updates:
            new_fund_id = (
                None
                if tx.direction == TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER
                else updates["sinking_fund_id"]
            )
            if new_fund_id is not None:
                await self._household_repo.get_sinking_fund_with_balance(new_fund_id)
            tx.sinking_fund_id = new_fund_id

        tx.match_source = MatchSource.MANUAL
        tx.match_confidence = Decimal("1.000")

        # Synchronize 1:1 SinkingFundLedgerEntry
        existing_entry = tx.sinking_ledger_entry
        should_have_pot_entry = (
            not tx.needs_review
            and tx.sinking_fund_id is not None
            and tx.amount < ZERO
            and tx.direction == TransactionDirection.OUTFLOW
        )

        if not should_have_pot_entry:
            if existing_entry is not None:
                await self._session.delete(existing_entry)
        else:
            assert tx.sinking_fund_id is not None
            if existing_entry is not None:
                existing_entry.sinking_fund_id = tx.sinking_fund_id
                existing_entry.amount = -quantize_cents(abs(tx.amount))
                existing_entry.accrual_period_month = normalize_to_month_start(tx.booking_date)
            else:
                await self._settle_linked_sinking_fund(
                    tx=tx,
                    sinking_fund_id=tx.sinking_fund_id,
                )

        await self._session.flush()
        await self._session.refresh(tx)
        return tx

    async def approve_transaction_review(
        self,
        transaction_id: uuid.UUID,
    ) -> tuple[Transaction, SinkingFundLedgerEntry | None]:
        """
        Clear `needs_review` on a transaction imported via `DIRECT_WITH_REVIEW_FLAG` and
        trigger any deferred virtual sinking fund settlement (even if the pot is uncovered).
        """
        stmt = (
            select(Transaction)
            .options(selectinload(Transaction.sinking_ledger_entry))
            .where(
                Transaction.tenant_id == self._tenant_id,
                Transaction.id == transaction_id,
            )
        )
        tx = await self._session.scalar(stmt)
        if tx is None:
            raise ResourceNotFoundError("Transaction", str(transaction_id))

        tx.needs_review = False
        created_ledger_entry: SinkingFundLedgerEntry | None = None

        if (
            tx.sinking_fund_id is not None
            and tx.sinking_ledger_entry is None
            and tx.amount < ZERO
            and tx.direction == TransactionDirection.OUTFLOW
        ):
            created_ledger_entry = await self._settle_linked_sinking_fund(
                tx=tx,
                sinking_fund_id=tx.sinking_fund_id,
            )

        await self._session.flush()
        await self._session.refresh(tx)
        return tx, created_ledger_entry

    async def _persist_transaction_and_optional_settlement(
        self,
        *,
        account_id: uuid.UUID,
        batch_id: uuid.UUID | None,
        booking_date: date,
        value_date: date | None,
        amount: Decimal,
        currency: str,
        counterparty_name: str | None,
        counterparty_iban: str | None,
        purpose_text: str,
        import_dedup_hash: str | None,
        decision: TransactionMatchDecision,
        needs_review: bool,
    ) -> Transaction:
        effective_fund_id = (
            None
            if decision.direction == TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER
            else decision.sinking_fund_id
        )

        tx = Transaction(
            tenant_id=self._tenant_id,
            account_id=account_id,
            counterpart_account_id=decision.counterpart_account_id,
            category_id=decision.category_id,
            sinking_fund_id=effective_fund_id,
            paid_by_person_id=decision.paid_by_person_id,
            matched_rule_id=decision.matched_rule_id,
            import_batch_id=batch_id,
            booking_date=booking_date,
            value_date=value_date,
            amount=quantize_cents(amount),
            currency=currency.upper(),
            direction=decision.direction,
            counterparty_name=counterparty_name,
            counterparty_iban=counterparty_iban,
            purpose_text=purpose_text,
            match_source=decision.match_source,
            match_confidence=decision.confidence,
            needs_review=needs_review,
            import_dedup_hash=import_dedup_hash,
        )
        self._session.add(tx)
        await self._session.flush()

        if (
            not needs_review
            and effective_fund_id is not None
            and amount < ZERO
            and decision.direction == TransactionDirection.OUTFLOW
        ):
            await self._settle_linked_sinking_fund(tx=tx, sinking_fund_id=effective_fund_id)

        await self._session.refresh(tx)
        return tx

    async def _settle_linked_sinking_fund(
        self,
        *,
        tx: Transaction,
        sinking_fund_id: uuid.UUID,
    ) -> SinkingFundLedgerEntry | None:
        fund, current_balance = await self._household_repo.get_sinking_fund_with_balance(
            sinking_fund_id
        )
        snapshot = self._household_repo.to_fund_snapshot(fund, current_balance)
        plan = self._accrual_engine.plan_settlement(
            snapshot,
            actual_invoice_amount=abs(tx.amount),
            allow_pot_overdraft=True,
        )
        fund.next_due_date = plan.next_cycle_due_date

        entry = SinkingFundLedgerEntry(
            tenant_id=self._tenant_id,
            sinking_fund_id=fund.id,
            linked_transaction_id=tx.id,
            accrual_period_month=normalize_to_month_start(tx.booking_date),
            entry_type=SinkingFundEntryType.EXPENSE_SETTLEMENT,
            amount=plan.settlement_ledger_amount,
            note=f"Statement settlement: {tx.purpose_text[:180]}",
        )
        self._session.add(entry)
        await self._session.flush()
        await self._session.refresh(entry)
        return entry
