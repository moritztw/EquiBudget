export type Frequency =
  | 'weekly'
  | 'monthly'
  | 'bi_monthly'
  | 'quarterly'
  | 'semi_annually'
  | 'annually';

export type AllocationStrategyType =
  | 'EQUAL_REMAINING_AMOUNT'
  | 'PROPORTIONAL_INCOME'
  | 'FIXED_RATIO'
  | 'CUSTOM_FORMULA';

export interface Tenant {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'viewer';
  authMethod: 'proxy_header' | 'jwt';
  externalAuthId?: string;
}

export interface Person {
  id: string;
  tenantId: string;
  userId?: string;
  name: string;
  avatar: string;
  color: string;
  isEarner: boolean;
  notes?: string;
}

export interface IncomeSource {
  id: string;
  tenantId: string;
  personId: string | null; // null = global household income (e.g., Kindergeld / Child allowance)
  name: string;
  grossAmount: number;
  netAmount: number;
  frequency: Frequency;
  isActive: boolean;
}

export interface Budget {
  id: string;
  tenantId: string;
  name: string;
  category: string;
  monthlyLimit: number;
  isRollover: boolean;
  currentCarryover: number;
  icon: string;
  color: string;
}

export interface RecurringExpense {
  id: string;
  tenantId: string;
  budgetId: string;
  name: string;
  payee: string;
  frequency: Frequency;
  amount: number;
  currentMonthlyProvision: number;
  nextDueDate: string;
  startDate: string;
  endDate?: string;
  sinkingFundId?: string;
}

export interface VirtualSinkingFund {
  id: string;
  tenantId: string;
  recurringExpenseId: string;
  name: string;
  targetAmount: number;
  currentBalance: number;
  monthlyAccrualRate: number;
  targetDate: string;
  lastAccruedAt: string;
  status: 'accruing' | 'funded' | 'depleted' | 'rebalancing';
  icon: string;
}

export interface Account {
  id: string;
  tenantId: string;
  personId: string | null; // null = Joint / Shared household account
  name: string;
  type: 'checking' | 'savings' | 'credit_card' | 'cash';
  ibanOrMask: string;
  currentBalance: number;
  currency: string;
  institution: string;
}

export type TransactionStatus =
  | 'unmatched'
  | 'matched_budget'
  | 'offset_sinking_fund'
  | 'ignored';

export interface Transaction {
  id: string;
  tenantId: string;
  accountId: string;
  date: string;
  amount: number; // negative for expense, positive for income
  payee: string;
  purposeText: string;
  iban?: string;
  category?: string;
  status: TransactionStatus;
  matchedBudgetId?: string;
  matchedSinkingFundId?: string;
  matchedRuleId?: string;
  matchType?: 'exact_rule' | 'regex_pattern' | 'ai_classified' | 'manual';
  aiConfidence?: number;
  aiExplanation?: string;
}

export interface ImportTemplate {
  id: string;
  tenantId: string;
  bankName: string;
  fileFormat: 'csv' | 'camt053' | 'xls';
  delimiter: string;
  dateFormat: string;
  columnMapping: {
    dateCol: string;
    amountCol: string;
    payeeCol: string;
    purposeCol: string;
    ibanCol?: string;
  };
}

export interface MatchingRule {
  id: string;
  tenantId: string;
  name: string;
  priority: number;
  matchPattern: string; // regex or keyword
  patternType: 'payee_regex' | 'iban_exact' | 'purpose_contains' | 'amount_exact';
  targetBudgetId?: string;
  targetSinkingFundId?: string;
  targetCategory: string;
}

export interface EarnerSplitBreakdown {
  personId: string;
  personName: string;
  netIncome: number;
  incomeSharePercent: number; // relative to total earners income
  contributionAmount: number;
  contributionPercentOfIncome: number;
  discretionaryRemaining: number; // "Taschengeld"
  isDeficitSubsidized?: boolean;
}

export interface AllocationCalculationResult {
  strategy: AllocationStrategyType;
  totalEarnersNetIncome: number;
  totalGlobalHouseholdIncome: number;
  totalNetIncome: number;
  totalSharedExpenses: number;
  netExpensesToCover: number; // totalSharedExpenses - totalGlobalHouseholdIncome
  totalDiscretionaryPool: number; // totalNetIncome - totalSharedExpenses
  perEarnerDiscretionaryTarget: number;
  earnerSplits: EarnerSplitBreakdown[];
  mathematicalExplanation: string[];
}
