"""Initial EquiBudget multi-tenant ERP schema

Revision ID: 20261029_0001
Revises: None
Create Date: 2026-10-29 03:35:00+00:00
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261029_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. tenants
    op.create_table(
        "tenants",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("default_currency", sa.String(length=3), nullable=False, server_default="EUR"),
        sa.Column("default_locale", sa.String(length=16), nullable=False, server_default="de-DE"),
        sa.Column(
            "default_allocation_strategy",
            sa.String(length=32),
            nullable=False,
            server_default="EQUAL_REMAINING",
        ),
        sa.Column(
            "default_import_commit_mode",
            sa.String(length=32),
            nullable=False,
            server_default="TWO_STAGE_PREVIEW",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(default_currency) = 3",
            name="ck_tenants_currency_iso4217_len",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_tenants"),
        sa.UniqueConstraint("slug", name="uq_tenants_slug"),
    )
    op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=True)

    # 2. persons
    op.create_table(
        "persons",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("is_employed", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "participates_in_shared_split",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "monthly_net_income",
            sa.Numeric(precision=14, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column(
            "fixed_personal_deductions",
            sa.Numeric(precision=14, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column("custom_allocation_weight", sa.Numeric(precision=6, scale=5), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("monthly_net_income >= 0", name="ck_persons_net_income_non_negative"),
        sa.CheckConstraint(
            "fixed_personal_deductions >= 0",
            name="ck_persons_personal_deductions_non_negative",
        ),
        sa.CheckConstraint(
            "custom_allocation_weight IS NULL OR (custom_allocation_weight >= 0 AND custom_allocation_weight <= 1)",
            name="ck_persons_custom_weight_unit_interval",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_persons_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_persons"),
        sa.UniqueConstraint(
            "tenant_id",
            "display_name",
            name="uq_persons_tenant_display_name",
        ),
    )
    op.create_index("ix_persons_tenant_id", "persons", ["tenant_id"], unique=False)

    # 3. person_monthly_incomes
    op.create_table(
        "person_monthly_incomes",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("person_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("period_month", sa.Date(), nullable=False),
        sa.Column("actual_net_income", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "personal_fixed_deductions",
            sa.Numeric(precision=14, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "actual_net_income >= 0",
            name="ck_person_monthly_incomes_monthly_actual_net_non_negative",
        ),
        sa.CheckConstraint(
            "personal_fixed_deductions >= 0",
            name="ck_person_monthly_incomes_monthly_personal_ded_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["person_id"],
            ["persons.id"],
            name="fk_person_monthly_incomes_person_id_persons",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_person_monthly_incomes_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_person_monthly_incomes"),
        sa.UniqueConstraint(
            "tenant_id",
            "person_id",
            "period_month",
            name="uq_person_monthly_income_period",
        ),
    )
    op.create_index(
        "ix_person_monthly_incomes_tenant_id",
        "person_monthly_incomes",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        "ix_person_monthly_incomes_person_id",
        "person_monthly_incomes",
        ["person_id"],
        unique=False,
    )
    op.create_index(
        "ix_person_monthly_incomes_tenant_period",
        "person_monthly_incomes",
        ["tenant_id", "period_month"],
        unique=False,
    )

    # 4. users
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("person_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("external_subject", sa.String(length=150), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=24), nullable=False, server_default="MEMBER"),
        sa.Column(
            "preferred_locale",
            sa.String(length=16),
            nullable=False,
            server_default="de-DE",
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["person_id"],
            ["persons.id"],
            name="fk_users_person_id_persons",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_users_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("external_subject", name="uq_users_external_subject"),
        sa.UniqueConstraint("person_id", name="uq_users_person_id"),
        sa.UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
    )
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"], unique=False)
    op.create_index("ix_users_external_subject", "users", ["external_subject"], unique=False)

    # 5. accounts
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("owner_person_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("institution_name", sa.String(length=120), nullable=True),
        sa.Column("iban", sa.String(length=34), nullable=True),
        sa.Column(
            "account_type",
            sa.String(length=32),
            nullable=False,
            server_default="JOINT_CHECKING",
        ),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EUR"),
        sa.Column(
            "opening_balance",
            sa.Numeric(precision=14, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column("opening_balance_date", sa.Date(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(currency) = 3",
            name="ck_accounts_account_currency_iso4217_len",
        ),
        sa.ForeignKeyConstraint(
            ["owner_person_id"],
            ["persons.id"],
            name="fk_accounts_owner_person_id_persons",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_accounts_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_accounts"),
        sa.UniqueConstraint("tenant_id", "iban", name="uq_accounts_tenant_iban"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_accounts_tenant_name"),
    )
    op.create_index("ix_accounts_tenant_id", "accounts", ["tenant_id"], unique=False)
    op.create_index("ix_accounts_owner_person_id", "accounts", ["owner_person_id"], unique=False)

    # 6. budget_categories
    op.create_table(
        "budget_categories",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("parent_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "is_shared_expense",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "monthly_target_amount",
            sa.Numeric(precision=14, scale=2),
            nullable=False,
            server_default="0.00",
        ),
        sa.Column("allocation_strategy_override", sa.String(length=32), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "monthly_target_amount >= 0",
            name="ck_budget_categories_category_monthly_target_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["budget_categories.id"],
            name="fk_budget_categories_parent_id_budget_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_budget_categories_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_budget_categories"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_budget_categories_tenant_name"),
    )
    op.create_index(
        "ix_budget_categories_tenant_id",
        "budget_categories",
        ["tenant_id"],
        unique=False,
    )

    # 7. sinking_funds
    op.create_table(
        "sinking_funds",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("backing_account_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("payee", sa.String(length=160), nullable=True),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("target_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "recurrence_interval",
            sa.String(length=24),
            nullable=False,
            server_default="ANNUAL",
        ),
        sa.Column("next_due_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("auto_accrual", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "is_shared_obligation",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("allocation_strategy_override", sa.String(length=32), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "target_amount > 0",
            name="ck_sinking_funds_sinking_fund_target_positive",
        ),
        sa.ForeignKeyConstraint(
            ["backing_account_id"],
            ["accounts.id"],
            name="fk_sinking_funds_backing_account_id_accounts",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["budget_categories.id"],
            name="fk_sinking_funds_category_id_budget_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_sinking_funds_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sinking_funds"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_sinking_funds_tenant_name"),
    )
    op.create_index("ix_sinking_funds_tenant_id", "sinking_funds", ["tenant_id"], unique=False)
    op.create_index(
        "ix_sinking_funds_backing_account_id",
        "sinking_funds",
        ["backing_account_id"],
        unique=False,
    )
    op.create_index(
        "ix_sinking_funds_next_due_date",
        "sinking_funds",
        ["next_due_date"],
        unique=False,
    )
    op.create_index("ix_sinking_funds_end_date", "sinking_funds", ["end_date"], unique=False)

    # 8. sinking_fund_rate_revisions
    op.create_table(
        "sinking_fund_rate_revisions",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("sinking_fund_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "amount > 0",
            name="ck_sinking_fund_rate_revisions_sinking_fund_revision_amount_positive",
        ),
        sa.ForeignKeyConstraint(
            ["sinking_fund_id"],
            ["sinking_funds.id"],
            name="fk_sinking_fund_rate_revisions_sinking_fund_id_sinking_funds",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_sinking_fund_rate_revisions_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sinking_fund_rate_revisions"),
        sa.UniqueConstraint(
            "sinking_fund_id",
            "valid_from",
            name="uq_sinking_fund_rate_revision_valid_from",
        ),
    )
    op.create_index(
        "ix_sinking_fund_rate_revisions_tenant_id",
        "sinking_fund_rate_revisions",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        "ix_sinking_fund_rate_revisions_sinking_fund_id",
        "sinking_fund_rate_revisions",
        ["sinking_fund_id"],
        unique=False,
    )

    # 9. matching_rules
    op.create_table(
        "matching_rules",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column(
            "match_field",
            sa.String(length=32),
            nullable=False,
            server_default="COMBINED_TEXT",
        ),
        sa.Column("regex_pattern", sa.String(length=500), nullable=False),
        sa.Column(
            "case_sensitive",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("min_abs_amount", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("max_abs_amount", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("target_category_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("target_sinking_fund_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("target_person_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "priority >= 0",
            name="ck_matching_rules_matching_rule_priority_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["target_category_id"],
            ["budget_categories.id"],
            name="fk_matching_rules_target_category_id_budget_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["target_person_id"],
            ["persons.id"],
            name="fk_matching_rules_target_person_id_persons",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["target_sinking_fund_id"],
            ["sinking_funds.id"],
            name="fk_matching_rules_target_sinking_fund_id_sinking_funds",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_matching_rules_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_matching_rules"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_matching_rules_tenant_name"),
    )
    op.create_index("ix_matching_rules_tenant_id", "matching_rules", ["tenant_id"], unique=False)

    # 10. import_batches
    op.create_table(
        "import_batches",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("account_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("source_filename", sa.String(length=255), nullable=False),
        sa.Column("parser_key", sa.String(length=64), nullable=False),
        sa.Column("commit_mode", sa.String(length=32), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="PENDING_CONFIRMATION",
        ),
        sa.Column("total_rows_parsed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duplicate_rows_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("committed_rows_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_import_batches_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_import_batches_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_import_batches"),
    )
    op.create_index("ix_import_batches_tenant_id", "import_batches", ["tenant_id"], unique=False)
    op.create_index("ix_import_batches_account_id", "import_batches", ["account_id"], unique=False)

    # 11. transactions
    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("account_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("counterpart_account_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("sinking_fund_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("paid_by_person_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("matched_rule_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("import_batch_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("booking_date", sa.Date(), nullable=False),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EUR"),
        sa.Column("direction", sa.String(length=32), nullable=False),
        sa.Column("counterparty_name", sa.String(length=200), nullable=True),
        sa.Column("counterparty_iban", sa.String(length=34), nullable=True),
        sa.Column("purpose_text", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "match_source",
            sa.String(length=24),
            nullable=False,
            server_default="UNMATCHED",
        ),
        sa.Column("match_confidence", sa.Numeric(precision=4, scale=3), nullable=True),
        sa.Column(
            "needs_review",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("import_dedup_hash", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(currency) = 3",
            name="ck_transactions_tx_currency_iso4217_len",
        ),
        sa.CheckConstraint("amount <> 0", name="ck_transactions_tx_nonzero_amount"),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_transactions_account_id_accounts",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["budget_categories.id"],
            name="fk_transactions_category_id_budget_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["counterpart_account_id"],
            ["accounts.id"],
            name="fk_transactions_counterpart_account_id_accounts",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["import_batch_id"],
            ["import_batches.id"],
            name="fk_transactions_import_batch_id_import_batches",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["matched_rule_id"],
            ["matching_rules.id"],
            name="fk_transactions_matched_rule_id_matching_rules",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["paid_by_person_id"],
            ["persons.id"],
            name="fk_transactions_paid_by_person_id_persons",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["sinking_fund_id"],
            ["sinking_funds.id"],
            name="fk_transactions_sinking_fund_id_sinking_funds",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_transactions_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_transactions"),
        sa.UniqueConstraint(
            "tenant_id",
            "account_id",
            "import_dedup_hash",
            name="uq_transactions_account_dedup_hash",
        ),
    )
    op.create_index("ix_transactions_tenant_id", "transactions", ["tenant_id"], unique=False)
    op.create_index("ix_transactions_account_id", "transactions", ["account_id"], unique=False)
    op.create_index("ix_transactions_category_id", "transactions", ["category_id"], unique=False)
    op.create_index(
        "ix_transactions_sinking_fund_id",
        "transactions",
        ["sinking_fund_id"],
        unique=False,
    )
    op.create_index(
        "ix_transactions_tenant_booking_date",
        "transactions",
        ["tenant_id", "booking_date"],
        unique=False,
    )
    op.create_index(
        "ix_transactions_tenant_needs_review",
        "transactions",
        ["tenant_id", "needs_review"],
        unique=False,
    )

    # 12. sinking_fund_ledger_entries
    op.create_table(
        "sinking_fund_ledger_entries",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("sinking_fund_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("linked_transaction_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("reallocation_group_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("accrual_period_month", sa.Date(), nullable=False),
        sa.Column("entry_type", sa.String(length=32), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "amount <> 0",
            name="ck_sinking_fund_ledger_entries_sinking_ledger_nonzero_amount",
        ),
        sa.ForeignKeyConstraint(
            ["linked_transaction_id"],
            ["transactions.id"],
            name="fk_sinking_fund_ledger_entries_linked_transaction_id_transactions",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["sinking_fund_id"],
            ["sinking_funds.id"],
            name="fk_sinking_fund_ledger_entries_sinking_fund_id_sinking_funds",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_sinking_fund_ledger_entries_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sinking_fund_ledger_entries"),
        sa.UniqueConstraint(
            "linked_transaction_id",
            name="uq_sinking_fund_ledger_entries_linked_transaction_id",
        ),
    )
    op.create_index(
        "ix_sinking_fund_ledger_entries_tenant_id",
        "sinking_fund_ledger_entries",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        "ix_sinking_fund_ledger_entries_sinking_fund_id",
        "sinking_fund_ledger_entries",
        ["sinking_fund_id"],
        unique=False,
    )
    op.create_index(
        "ix_sinking_fund_ledger_entries_reallocation_group_id",
        "sinking_fund_ledger_entries",
        ["reallocation_group_id"],
        unique=False,
    )
    op.create_index(
        "ix_sinking_ledger_fund_period",
        "sinking_fund_ledger_entries",
        ["tenant_id", "sinking_fund_id", "accrual_period_month"],
        unique=False,
    )

    # 13. import_staging_rows
    op.create_table(
        "import_staging_rows",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("batch_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("row_status", sa.String(length=32), nullable=False, server_default="READY"),
        sa.Column("booking_date", sa.Date(), nullable=False),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EUR"),
        sa.Column("counterparty_name", sa.String(length=200), nullable=True),
        sa.Column("counterparty_iban", sa.String(length=34), nullable=True),
        sa.Column("purpose_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("import_dedup_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "duplicate_match_kind",
            sa.String(length=24),
            nullable=False,
            server_default="NONE",
        ),
        sa.Column("duplicate_of_transaction_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("duplicate_reason", sa.String(length=255), nullable=True),
        sa.Column("proposed_direction", sa.String(length=32), nullable=False),
        sa.Column("proposed_counterpart_account_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("proposed_category_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("proposed_sinking_fund_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("proposed_person_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("matched_rule_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "match_source",
            sa.String(length=24),
            nullable=False,
            server_default="UNMATCHED",
        ),
        sa.Column("match_confidence", sa.Numeric(precision=4, scale=3), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["import_batches.id"],
            name="fk_import_staging_rows_batch_id_import_batches",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["duplicate_of_transaction_id"],
            ["transactions.id"],
            name="fk_import_staging_rows_duplicate_of_transaction_id_transactions",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["matched_rule_id"],
            ["matching_rules.id"],
            name="fk_import_staging_rows_matched_rule_id_matching_rules",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["proposed_category_id"],
            ["budget_categories.id"],
            name="fk_import_staging_rows_proposed_category_id_budget_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["proposed_counterpart_account_id"],
            ["accounts.id"],
            name="fk_import_staging_rows_proposed_counterpart_account_id_accounts",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["proposed_person_id"],
            ["persons.id"],
            name="fk_import_staging_rows_proposed_person_id_persons",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["proposed_sinking_fund_id"],
            ["sinking_funds.id"],
            name="fk_import_staging_rows_proposed_sinking_fund_id_sinking_funds",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_import_staging_rows_tenant_id_tenants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_import_staging_rows"),
        sa.UniqueConstraint(
            "batch_id",
            "row_number",
            name="uq_staging_batch_row_number",
        ),
    )
    op.create_index(
        "ix_import_staging_rows_tenant_id",
        "import_staging_rows",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        "ix_import_staging_rows_batch_id",
        "import_staging_rows",
        ["batch_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("import_staging_rows")
    op.drop_table("sinking_fund_ledger_entries")
    op.drop_table("transactions")
    op.drop_table("import_batches")
    op.drop_table("matching_rules")
    op.drop_table("sinking_fund_rate_revisions")
    op.drop_table("sinking_funds")
    op.drop_table("budget_categories")
    op.drop_table("accounts")
    op.drop_table("users")
    op.drop_table("person_monthly_incomes")
    op.drop_table("persons")
    op.drop_table("tenants")
