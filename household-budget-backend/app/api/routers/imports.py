from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status

from app.api.deps import DbSessionDep, HouseholdRepoDep, TenantContextDep
from app.importers.base import StatementParseError, StatementParserRegistry
from app.importers.dkb_csv import DkbCsvStatementParser
from app.models.enums import ImportCommitMode, TransactionDirection
from app.repositories.import_repository import StatementImportRepository
from app.schemas.api import SinkingFundLedgerEntryRead
from app.schemas.imports import (
    ImportBatchCommitRequest,
    ImportBatchRead,
    MatchingRuleCreate,
    MatchingRuleRead,
    TransactionClassificationUpdate,
    TransactionManualCreate,
    TransactionRead,
    TransactionReviewApprovalResponse,
    VirtualPotReallocationRequest,
    VirtualPotReallocationResponse,
)

router = APIRouter(tags=["Statement Import, Actual Payments & Reallocation"])

_parser_registry = StatementParserRegistry()
_parser_registry.register(DkbCsvStatementParser())

MAX_STATEMENT_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MiB


async def get_import_repository(
    session: DbSessionDep,
    household_repo: HouseholdRepoDep,
) -> StatementImportRepository:
    return StatementImportRepository(session=session, household_repo=household_repo)


ImportRepoDep = Annotated[StatementImportRepository, Depends(get_import_repository)]


# --- Deterministic Matching Rules ---


@router.get("/matching-rules", response_model=list[MatchingRuleRead])
async def list_matching_rules(
    import_repo: ImportRepoDep,
    active_only: bool = Query(default=True),
) -> list[MatchingRuleRead]:
    rules = await import_repo.list_matching_rules(active_only=active_only)
    return [MatchingRuleRead.model_validate(r) for r in rules]


@router.post(
    "/matching-rules",
    response_model=MatchingRuleRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_matching_rule(
    payload: MatchingRuleCreate,
    import_repo: ImportRepoDep,
) -> MatchingRuleRead:
    rule = await import_repo.create_matching_rule(payload)
    return MatchingRuleRead.model_validate(rule)


# --- Bank Statement Upload & Configurable 2-Stage / Direct Modes ---


@router.post(
    "/imports/statements",
    response_model=ImportBatchRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_bank_statement(
    household_repo: HouseholdRepoDep,
    import_repo: ImportRepoDep,
    tenant_ctx: TenantContextDep,
    account_id: Annotated[uuid.UUID, Form()],
    file: Annotated[UploadFile, File()],
    parser_key: Annotated[str, Form()] = "dkb_csv",
    commit_mode: Annotated[ImportCommitMode | None, Form()] = None,
    include_pending: Annotated[bool, Form()] = False,
) -> ImportBatchRead:
    """
    Upload a bank CSV statement (default: DKB CSV).
    Applies two-layer deduplication (`EXACT_HASH` + `SEMANTIC_MATCH`) to prevent double-booking
    of overlapping CSV exports or previously recorded manual pot settlements.
    """
    account = await household_repo.get_account(account_id)
    raw_bytes = await file.read(MAX_STATEMENT_UPLOAD_BYTES + 1)
    if len(raw_bytes) > MAX_STATEMENT_UPLOAD_BYTES:
        raise StatementParseError("Uploaded statement exceeds the 10 MiB size limit.")

    filename = file.filename or "statement.csv"
    parser = _parser_registry.resolve(
        parser_key=parser_key,
        filename=filename,
        raw_bytes=raw_bytes,
    )
    parse_result = parser.parse(raw_bytes, include_pending=include_pending)

    effective_mode = commit_mode or tenant_ctx.default_import_commit_mode
    batch = await import_repo.ingest_parsed_statement(
        account=account,
        source_filename=filename,
        parse_result=parse_result,
        commit_mode=effective_mode,
    )
    return ImportBatchRead.model_validate(batch)


@router.get("/imports/batches/{batch_id}", response_model=ImportBatchRead)
async def get_import_batch(
    batch_id: uuid.UUID,
    import_repo: ImportRepoDep,
) -> ImportBatchRead:
    batch = await import_repo.get_import_batch(batch_id)
    return ImportBatchRead.model_validate(batch)


@router.post("/imports/batches/{batch_id}/commit", response_model=ImportBatchRead)
async def commit_staged_import_batch(
    batch_id: uuid.UUID,
    payload: ImportBatchCommitRequest,
    import_repo: ImportRepoDep,
) -> ImportBatchRead:
    """Confirm and commit a `TWO_STAGE_PREVIEW` batch into final ledger transactions."""
    batch = await import_repo.commit_staged_batch(batch_id, payload)
    return ImportBatchRead.model_validate(batch)


# --- Actual Payments Journal (Übersicht tatsächlicher Zahlungen) ---


@router.get("/transactions", response_model=list[TransactionRead])
async def list_transactions(
    import_repo: ImportRepoDep,
    account_id: uuid.UUID | None = Query(default=None),
    category_id: uuid.UUID | None = Query(default=None),
    sinking_fund_id: uuid.UUID | None = Query(default=None),
    direction: TransactionDirection | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    search: str | None = Query(default=None, max_length=120),
    needs_review_only: bool = Query(default=False),
    limit: int = Query(default=300, ge=1, le=1000),
) -> list[TransactionRead]:
    """List actual ledger transactions (CSV-imported or manually recorded) with ERP filters."""
    txs = await import_repo.list_transactions(
        account_id=account_id,
        category_id=category_id,
        sinking_fund_id=sinking_fund_id,
        direction=direction,
        date_from=date_from,
        date_to=date_to,
        search=search,
        needs_review_only=needs_review_only,
        limit=limit,
    )
    return [TransactionRead.model_validate(t) for t in txs]


@router.post(
    "/transactions",
    response_model=TransactionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_manual_transaction(
    payload: TransactionManualCreate,
    import_repo: ImportRepoDep,
) -> TransactionRead:
    """Record a manual actual payment, optionally debiting any (covered or uncovered) virtual pot."""
    tx = await import_repo.create_manual_transaction(payload)
    return TransactionRead.model_validate(tx)


@router.patch(
    "/transactions/{transaction_id}",
    response_model=TransactionRead,
)
async def update_transaction_classification(
    transaction_id: uuid.UUID,
    payload: TransactionClassificationUpdate,
    import_repo: ImportRepoDep,
) -> TransactionRead:
    """Reclassify an existing actual transaction and synchronize its 1:1 virtual pot settlement."""
    tx = await import_repo.update_transaction_classification(transaction_id, payload)
    return TransactionRead.model_validate(tx)


@router.post(
    "/transactions/{transaction_id}/approve-review",
    response_model=TransactionReviewApprovalResponse,
)
async def approve_transaction_review(
    transaction_id: uuid.UUID,
    import_repo: ImportRepoDep,
) -> TransactionReviewApprovalResponse:
    """
    Approve a transaction flagged with `needs_review=True` and execute any deferred
    virtual sinking fund settlement (including uncovered pots).
    """
    tx, ledger_entry = await import_repo.approve_transaction_review(transaction_id)
    return TransactionReviewApprovalResponse(
        transaction=TransactionRead.model_validate(tx),
        settled_sinking_fund_entry=(
            SinkingFundLedgerEntryRead.model_validate(ledger_entry)
            if ledger_entry is not None
            else None
        ),
    )


# --- Virtual Sinking Fund Reallocation (Virtuelle Topf-Umbuchung) ---


@router.post(
    "/sinking-funds/reallocate",
    response_model=VirtualPotReallocationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def reallocate_between_virtual_pots(
    payload: VirtualPotReallocationRequest,
    import_repo: ImportRepoDep,
) -> VirtualPotReallocationResponse:
    """
    Move virtual accrued reserve from one SinkingFund to another (`VIRTUAL_POT_REALLOCATION`).
    Does NOT generate any physical bank account transaction.
    """
    (
        group_id,
        debit_entry,
        credit_entry,
        source_remaining,
        target_new,
    ) = await import_repo.reallocate_virtual_pots(payload)
    return VirtualPotReallocationResponse(
        reallocation_group_id=group_id,
        debit_entry=SinkingFundLedgerEntryRead.model_validate(debit_entry),
        credit_entry=SinkingFundLedgerEntryRead.model_validate(credit_entry),
        source_remaining_balance=source_remaining,
        target_new_balance=target_new,
    )
