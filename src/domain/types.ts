export enum SplitStrategy {
  FIFTY_FIFTY = 'FIFTY_FIFTY',
  PROPORTIONAL = 'PROPORTIONAL',
  EQUAL_REMAINING = 'EQUAL_REMAINING',
  CUSTOM_WEIGHT = 'CUSTOM_WEIGHT',
}

export enum RecurrenceInterval {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEMI_ANNUAL = 'SEMI_ANNUAL',
  ANNUAL = 'ANNUAL',
  BIENNIAL = 'BIENNIAL',
  ONE_TIME = 'ONE_TIME',
}

export enum AccountType {
  JOINT_CHECKING = 'JOINT_CHECKING',
  PERSONAL_CHECKING = 'PERSONAL_CHECKING',
  SAVINGS_RESERVE = 'SAVINGS_RESERVE',
  CREDIT_CARD = 'CREDIT_CARD',
}

export enum TransactionDirection {
  INFLOW = 'INFLOW',
  OUTFLOW = 'OUTFLOW',
  PHYSICAL_ACCOUNT_TRANSFER = 'PHYSICAL_ACCOUNT_TRANSFER',
}

export enum MatchSource {
  UNMATCHED = 'UNMATCHED',
  MANUAL = 'MANUAL',
  OWN_IBAN_TRANSFER = 'OWN_IBAN_TRANSFER',
  REGEX_RULE = 'REGEX_RULE',
  AI_CLASSIFIER = 'AI_CLASSIFIER',
}

export enum ImportCommitMode {
  TWO_STAGE_PREVIEW = 'TWO_STAGE_PREVIEW',
  DIRECT_WITH_REVIEW_FLAG = 'DIRECT_WITH_REVIEW_FLAG',
  DIRECT_AUTO_COMMIT = 'DIRECT_AUTO_COMMIT',
}

export enum DuplicateMatchKind {
  NONE = 'NONE',
  EXACT_HASH = 'EXACT_HASH',
  SEMANTIC_MATCH = 'SEMANTIC_MATCH',
}

export enum SinkingFundEntryType {
  INITIAL_CARRYOVER = 'INITIAL_CARRYOVER',
  MONTHLY_PROVISION = 'MONTHLY_PROVISION',
  MANUAL_DEPOSIT = 'MANUAL_DEPOSIT',
  INVOICE_SETTLEMENT = 'INVOICE_SETTLEMENT',
  VIRTUAL_POT_REALLOCATION = 'VIRTUAL_POT_REALLOCATION',
  RECONCILIATION_ADJUSTMENT = 'RECONCILIATION_ADJUSTMENT',
}

export type InstanceMode = 'UNINITIALIZED' | 'PRODUCTION' | 'DEMO';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  defaultCurrency: string;
  locale: 'de-DE' | 'en-US';
  defaultSplitStrategy: SplitStrategy;
}

export interface Person {
  id: string;
  tenantId: string;
  displayName: string;
  roleLabel: string;
  isEmployed: boolean;
  participatesInHouseholdSplit: boolean;
  defaultPersonalAllowance: number;
  customSplitWeight: number;
}

export interface PersonMonthlyIncome {
  id: string;
  tenantId: string;
  personId: string;
  monthKey: string; // YYYY-MM
  actualNetIncome: number;
  personalFixedAllowance: number;
  note: string;
}

export interface Account {
  id: string;
  tenantId: string;
  ownerPersonId: string | null;
  name: string;
  institutionName: string;
  iban: string;
  currency: string;
  accountType: AccountType;
  currentBalance: number;
  includeInHouseholdLiquidity: boolean;
}

export interface BudgetCategory {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isSharedDefault: boolean;
  monthlyBudgetLimit: number | null;
}

export interface PlannedPaymentAmountRevision {
  id: string;
  validFrom: string; // YYYY-MM-DD
  amount: number;
  note: string;
}

export interface PlannedPayment {
  id: string;
  tenantId: string;
  accountId: string;
  categoryId: string;
  name: string;
  payee: string;
  amount: number; // Base amount before or without effective-dated revisions
  currency: string;
  interval: RecurrenceInterval;
  nextDueDate: string; // YYYY-MM-DD
  endDate: string | null; // Optional YYYY-MM-DD contract/payment end date
  dayOfMonth: number;
  amountRevisions: PlannedPaymentAmountRevision[];
  splitStrategyOverride: SplitStrategy | null;
  isActive: boolean;
  isShared: boolean;
  autoAccrual: boolean;
}

export interface SinkingFundLedgerEntry {
  id: string;
  tenantId: string;
  plannedPaymentId: string;
  linkedTransactionId: string | null;
  entryDate: string;
  entryType: SinkingFundEntryType;
  amount: number; // positive = reserve deposit, negative = full payment release (may overdraw pot < 0)
  reallocationGroupId: string | null;
  note: string;
}

export interface MatchingRule {
  id: string;
  tenantId: string;
  name: string;
  priority: number;
  counterpartyPattern: string | null;
  remittancePattern: string | null;
  targetCategoryId: string | null;
  targetPlannedPaymentId: string | null;
  isActive: boolean;
}

export interface Transaction {
  id: string;
  tenantId: string;
  accountId: string;
  counterpartyAccountId: string | null;
  categoryId: string | null;
  plannedPaymentId: string | null;
  bookingDate: string;
  valueDate: string;
  amount: number;
  currency: string;
  direction: TransactionDirection;
  counterpartyName: string;
  counterpartyIban: string | null;
  remittanceInfo: string;
  matchSource: MatchSource;
  matchConfidence: number;
  needsReview: boolean;
  importHash: string;
}

export interface ImportStagingRow {
  rowNumber: number;
  bookingDate: string;
  valueDate: string;
  amount: number;
  currency: string;
  counterpartyName: string;
  counterpartyIban: string | null;
  remittanceInfo: string;
  detectedDirection: TransactionDirection;
  counterpartyAccountId: string | null;
  suggestedCategoryId: string | null;
  suggestedPlannedPaymentId: string | null;
  matchSource: MatchSource;
  matchConfidence: number;
  matchedRuleName: string | null;
  isDuplicate: boolean;
  duplicateKind: DuplicateMatchKind;
  duplicateOfTransactionId: string | null;
  duplicateReason: string | null;
  selectedForCommit: boolean;
  importHash: string;
}

export interface ImportStagingBatch {
  id: string;
  tenantId: string;
  accountId: string;
  sourceFilename: string;
  parserVariant: string;
  createdAt: string;
  rows: ImportStagingRow[];
}

export interface SetupPersonDraft {
  clientRef: string;
  displayName: string;
  roleLabel: string;
  isEmployed: boolean;
  initialMonthlyNetIncome: number;
  defaultPersonalAllowance: number;
  customSplitWeight: number;
}

export interface SetupAccountDraft {
  clientRef: string;
  ownerPersonRef: string | null;
  name: string;
  institutionName: string;
  iban: string;
  accountType: AccountType;
  openingBalance: number;
}

export interface SetupCategoryDraft {
  clientRef: string;
  code: string;
  name: string;
  isSharedDefault: boolean;
  monthlyBudgetLimit: number | null;
}

export interface SetupPlannedPaymentDraft {
  clientRef: string;
  backingAccountRef: string;
  categoryRef: string;
  name: string;
  payee: string;
  amount: number;
  interval: RecurrenceInterval;
  nextDueDate: string;
  endDate: string | null;
  autoAccrual: boolean;
  initialPotBalance: number; // Startguthaben im virtuellen Topf (INITIAL_CARRYOVER)
}

export interface InstanceBootstrapPayload {
  householdName: string;
  slug: string;
  defaultCurrency: string;
  locale: 'de-DE' | 'en-US';
  defaultSplitStrategy: SplitStrategy;
  defaultImportCommitMode: ImportCommitMode;
  startMonthKey: string; // YYYY-MM
  persons: SetupPersonDraft[];
  accounts: SetupAccountDraft[];
  categories: SetupCategoryDraft[];
  plannedPayments: SetupPlannedPaymentDraft[];
}

