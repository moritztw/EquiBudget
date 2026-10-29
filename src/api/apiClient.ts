import {
  ImportCommitMode,
  InstanceBootstrapPayload,
  PlannedPaymentAmountRevision,
  RecurrenceInterval,
  SplitStrategy,
  TransactionDirection,
} from '../domain/types';

export interface ApiHealthStatus {
  status: string;
  service: string;
  version: string;
}

const DEFAULT_API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export class EquiBudgetApiClient {
  private readonly baseUrl: string;
  private tenantId: string | null;

  constructor(baseUrl = DEFAULT_API_BASE, tenantId: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.tenantId = tenantId;
  }

  public setTenantId(tenantId: string | null): void {
    this.tenantId = tenantId;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private buildHeaders(isJson = true): HeadersInit {
    const headers: Record<string, string> = {};
    if (isJson) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.tenantId) {
      headers['X-Tenant-ID'] = this.tenantId;
    }
    return headers;
  }

  public async checkBackendHealth(): Promise<ApiHealthStatus | null> {
    try {
      const rootOrigin = this.baseUrl.replace(/\/api\/v1$/, '');
      const res = await fetch(`${rootOrigin}/health/live`, {
        method: 'GET',
        headers: this.buildHeaders(false),
      });
      if (!res.ok) return null;
      return (await res.json()) as ApiHealthStatus;
    } catch {
      return null;
    }
  }

  public async fetchSetupStatus(): Promise<{
    is_initialized: boolean;
    active_tenant_count: number;
    default_tenant_id: string | null;
  } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/setup/status`, {
        method: 'GET',
        headers: this.buildHeaders(false),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  public async bootstrapInstanceOnServer(
    payload: InstanceBootstrapPayload
  ): Promise<unknown> {
    const startPeriodDate = `${payload.startMonthKey}-01`;
    const body = {
      tenant: {
        name: payload.householdName,
        slug: payload.slug,
        default_currency: payload.defaultCurrency,
        default_locale: payload.locale,
        default_allocation_strategy: payload.defaultSplitStrategy,
        default_import_commit_mode: payload.defaultImportCommitMode,
      },
      start_period_month: startPeriodDate,
      persons: payload.persons.map((p) => ({
        client_ref: p.clientRef,
        display_name: p.displayName,
        is_employed: p.isEmployed,
        participates_in_shared_split: true,
        initial_monthly_net_income: p.initialMonthlyNetIncome.toFixed(2),
        fixed_personal_deductions: p.defaultPersonalAllowance.toFixed(2),
        custom_allocation_weight:
          p.customSplitWeight > 0
            ? (Math.min(100, p.customSplitWeight) / 100).toFixed(5)
            : null,
      })),
      accounts: payload.accounts.map((a) => ({
        client_ref: a.clientRef,
        owner_person_ref: a.ownerPersonRef,
        name: a.name,
        institution_name: a.institutionName || null,
        iban: a.iban ? a.iban.replace(/\s+/g, '').toUpperCase() : null,
        account_type: a.accountType,
        currency: payload.defaultCurrency,
        opening_balance: a.openingBalance.toFixed(2),
        opening_balance_date: startPeriodDate,
      })),
      categories: payload.categories.map((c) => ({
        client_ref: c.clientRef,
        name: c.name,
        is_shared_expense: c.isSharedDefault,
        monthly_target_amount: (c.monthlyBudgetLimit ?? 0).toFixed(2),
      })),
      planned_payments: payload.plannedPayments.map((pp) => ({
        backing_account_ref: pp.backingAccountRef,
        category_ref: pp.categoryRef || null,
        name: pp.name,
        payee: pp.payee || null,
        target_amount: pp.amount.toFixed(2),
        recurrence_interval: pp.interval,
        next_due_date: pp.nextDueDate,
        end_date: pp.endDate || null,
        auto_accrual: pp.autoAccrual,
        is_shared_obligation: true,
        initial_pot_balance: pp.initialPotBalance.toFixed(2),
      })),
    };

    const res = await fetch(`${this.baseUrl}/setup/bootstrap`, {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  public async upsertMonthlyIncome(
    personId: string,
    monthKey: string,
    actualNetIncome: number,
    personalFixedDeductions: number,
    note: string
  ): Promise<unknown> {
    const periodMonth = `${monthKey}-01`;
    const res = await fetch(
      `${this.baseUrl}/persons/${personId}/monthly-incomes/${periodMonth}`,
      {
        method: 'PUT',
        headers: this.buildHeaders(true),
        body: JSON.stringify({
          actual_net_income: actualNetIncome.toFixed(2),
          personal_fixed_deductions: personalFixedDeductions.toFixed(2),
          note: note || null,
        }),
      }
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  public async updatePlannedPaymentOnServer(
    fundId: string,
    payload: {
      name?: string;
      payee?: string;
      target_amount?: number;
      recurrence_interval?: RecurrenceInterval;
      next_due_date?: string;
      end_date?: string | null;
      backing_account_id?: string;
      category_id?: string;
      auto_accrual?: boolean;
      is_active?: boolean;
      rate_revisions?: PlannedPaymentAmountRevision[];
    }
  ): Promise<unknown> {
    const body: Record<string, unknown> = {...payload};
    if (payload.rate_revisions) {
      body.rate_revisions = payload.rate_revisions.map((r) => ({
        valid_from: r.validFrom,
        amount: r.amount.toFixed(2),
        note: r.note || null,
      }));
    }
    const res = await fetch(`${this.baseUrl}/sinking-funds/${fundId}`, {
      method: 'PATCH',
      headers: this.buildHeaders(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  public async deletePlannedPaymentOnServer(fundId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sinking-funds/${fundId}`, {
      method: 'DELETE',
      headers: this.buildHeaders(false),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  public async fetchAllocationSimulation(
    referenceDate: string,
    strategyOverride?: SplitStrategy,
    allowNegativeTransferCompensation = false
  ): Promise<unknown> {
    const params = new URLSearchParams({
      reference_date: referenceDate,
      allow_compensation_transfer: String(allowNegativeTransferCompensation),
    });
    if (strategyOverride) {
      params.set('strategy_override', strategyOverride);
    }
    const res = await fetch(
      `${this.baseUrl}/allocations/monthly-plan?${params.toString()}`,
      {
        method: 'GET',
        headers: this.buildHeaders(false),
      }
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  public async listTransactions(filters?: {
    accountId?: string;
    categoryId?: string;
    sinkingFundId?: string;
    direction?: TransactionDirection;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    needsReviewOnly?: boolean;
  }): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters?.accountId) params.set('account_id', filters.accountId);
    if (filters?.categoryId) params.set('category_id', filters.categoryId);
    if (filters?.sinkingFundId) params.set('sinking_fund_id', filters.sinkingFundId);
    if (filters?.direction) params.set('direction', filters.direction);
    if (filters?.dateFrom) params.set('date_from', filters.dateFrom);
    if (filters?.dateTo) params.set('date_to', filters.dateTo);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.needsReviewOnly) params.set('needs_review_only', 'true');

    const qs = params.toString();
    const res = await fetch(
      `${this.baseUrl}/transactions${qs ? `?${qs}` : ''}`,
      {
        method: 'GET',
        headers: this.buildHeaders(false),
      }
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  public async createManualTransaction(payload: {
    accountId: string;
    bookingDate: string;
    amount: number;
    direction: TransactionDirection;
    categoryId?: string | null;
    sinkingFundId?: string | null;
    counterpartyName?: string;
    purposeText?: string;
  }): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/transactions`, {
      method: 'POST',
      headers: this.buildHeaders(true),
      body: JSON.stringify({
        account_id: payload.accountId,
        booking_date: payload.bookingDate,
        amount: payload.amount.toFixed(2),
        direction: payload.direction,
        category_id: payload.categoryId ?? null,
        sinking_fund_id: payload.sinkingFundId ?? null,
        counterparty_name: payload.counterpartyName ?? null,
        purpose_text: payload.purposeText ?? '',
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  public async updateTransactionClassification(
    transactionId: string,
    payload: {
      categoryId?: string | null;
      sinkingFundId?: string | null;
      needsReview?: boolean;
    }
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: this.buildHeaders(true),
      body: JSON.stringify({
        category_id: payload.categoryId,
        sinking_fund_id: payload.sinkingFundId,
        needs_review: payload.needsReview,
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  public async uploadDkbStatementCsv(
    accountId: string,
    file: File,
    commitMode: ImportCommitMode
  ): Promise<unknown> {
    const form = new FormData();
    form.append('account_id', accountId);
    form.append('commit_mode', commitMode);
    form.append('file', file);

    const res = await fetch(`${this.baseUrl}/imports/statements`, {
      method: 'POST',
      headers: this.buildHeaders(false),
      body: form,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }
}

export const equiBudgetApi = new EquiBudgetApiClient();
