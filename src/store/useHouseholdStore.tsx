import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Account,
  AccountType,
  BudgetCategory,
  DuplicateMatchKind,
  ImportCommitMode,
  ImportStagingBatch,
  InstanceBootstrapPayload,
  InstanceMode,
  MatchSource,
  MatchingRule,
  Person,
  PersonMonthlyIncome,
  PlannedPayment,
  PlannedPaymentAmountRevision,
  RecurrenceInterval,
  SinkingFundEntryType,
  SinkingFundLedgerEntry,
  SplitStrategy,
  Tenant,
  Transaction,
  TransactionDirection,
} from '../domain/types';
import {
  buildSampleDkbCsv,
  computeCanonicalImportHash,
  normalizeIban,
  parseAndMatchDkbCsv,
} from '../domain/calculators';
import {equiBudgetApi} from '../api/apiClient';

const STORAGE_KEY = 'equibudget.instance.v1';

interface PersistedEquiBudgetSnapshot {
  instanceMode: InstanceMode;
  activeTenantId: string;
  referenceMonthKey: string;
  allowNegativeTransferCompensation: boolean;
  tenants: Tenant[];
  persons: Person[];
  monthlyIncomes: PersonMonthlyIncome[];
  accounts: Account[];
  categories: BudgetCategory[];
  plannedPayments: PlannedPayment[];
  ledgerEntries: SinkingFundLedgerEntry[];
  matchingRules: MatchingRule[];
  transactions: Transaction[];
}

function loadPersistedSnapshot(): PersistedEquiBudgetSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEquiBudgetSnapshot;
    if (!Array.isArray(parsed.tenants) || parsed.tenants.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const TENANT_WEBER_ID = 't-weber-01';
const TENANT_WG_ID = 't-wg-02';

const INITIAL_TENANTS: Tenant[] = [
  {
    id: TENANT_WEBER_ID,
    name: 'Haushalt Weber / Lindner (4 Pers.)',
    slug: 'haushalt-weber-lindner',
    defaultCurrency: 'EUR',
    locale: 'de-DE',
    defaultSplitStrategy: SplitStrategy.EQUAL_REMAINING,
  },
  {
    id: TENANT_WG_ID,
    name: 'Paarhaushalt Becker (2 Pers.)',
    slug: 'paarhaushalt-becker',
    defaultCurrency: 'EUR',
    locale: 'de-DE',
    defaultSplitStrategy: SplitStrategy.PROPORTIONAL,
  },
];

const INITIAL_PERSONS: Person[] = [
  {
    id: 'p-markus',
    tenantId: TENANT_WEBER_ID,
    displayName: 'Markus Weber',
    roleLabel: 'Vollzeit IT · Rufbereitschaft & Quartalsbonus',
    isEmployed: true,
    participatesInHouseholdSplit: true,
    defaultPersonalAllowance: 220.0,
    customSplitWeight: 60,
  },
  {
    id: 'p-julia',
    tenantId: TENANT_WEBER_ID,
    displayName: 'Julia Lindner',
    roleLabel: 'Teilzeit (75%) · Architektur + Projekthonorare',
    isEmployed: true,
    participatesInHouseholdSplit: true,
    defaultPersonalAllowance: 180.0,
    customSplitWeight: 40,
  },
  {
    id: 'p-leo',
    tenantId: TENANT_WEBER_ID,
    displayName: 'Leo Weber (Kind)',
    roleLabel: 'Kind · Kita bis 08/2026 (kein Erwerbseinkommen)',
    isEmployed: false,
    participatesInHouseholdSplit: true,
    defaultPersonalAllowance: 0,
    customSplitWeight: 0,
  },
  {
    id: 'p-becker-1',
    tenantId: TENANT_WG_ID,
    displayName: 'Hannah Becker',
    roleLabel: 'Ingenieurin · Vollzeit + Schichtzulagen',
    isEmployed: true,
    participatesInHouseholdSplit: true,
    defaultPersonalAllowance: 150.0,
    customSplitWeight: 50,
  },
  {
    id: 'p-becker-2',
    tenantId: TENANT_WG_ID,
    displayName: 'Lukas Becker',
    roleLabel: 'Lehrer · Vollzeit',
    isEmployed: true,
    participatesInHouseholdSplit: true,
    defaultPersonalAllowance: 150.0,
    customSplitWeight: 50,
  },
];

const INITIAL_MONTHLY_INCOMES: PersonMonthlyIncome[] = [
  {
    id: 'mi-m-2026-03',
    tenantId: TENANT_WEBER_ID,
    personId: 'p-markus',
    monthKey: '2026-03',
    actualNetIncome: 4120.0,
    personalFixedAllowance: 220.0,
    note: 'Grundgehalt März ohne Rufbereitschaft',
  },
  {
    id: 'mi-j-2026-03',
    tenantId: TENANT_WEBER_ID,
    personId: 'p-julia',
    monthKey: '2026-03',
    actualNetIncome: 2640.0,
    personalFixedAllowance: 180.0,
    note: 'Reguläre Abrechnung 03/2026',
  },
  {
    id: 'mi-m-2026-04',
    tenantId: TENANT_WEBER_ID,
    personId: 'p-markus',
    monthKey: '2026-04',
    actualNetIncome: 4510.0,
    personalFixedAllowance: 220.0,
    note: 'Inkl. Q1-Prämie (+390 € netto)',
  },
  {
    id: 'mi-j-2026-04',
    tenantId: TENANT_WEBER_ID,
    personId: 'p-julia',
    monthKey: '2026-04',
    actualNetIncome: 2680.0,
    personalFixedAllowance: 180.0,
    note: 'Gehalt + Überstundenauszahlung',
  },
  {
    id: 'mi-m-2026-05',
    tenantId: TENANT_WEBER_ID,
    personId: 'p-markus',
    monthKey: '2026-05',
    actualNetIncome: 4235.0,
    personalFixedAllowance: 220.0,
    note: 'Inkl. 1x Wochenend-Rufbereitschaft',
  },
  {
    id: 'mi-j-2026-05',
    tenantId: TENANT_WEBER_ID,
    personId: 'p-julia',
    monthKey: '2026-05',
    actualNetIncome: 2990.0,
    personalFixedAllowance: 180.0,
    note: 'Inkl. Projektabschluss-Bonus',
  },
  {
    id: 'mi-m-2026-06',
    tenantId: TENANT_WEBER_ID,
    personId: 'p-markus',
    monthKey: '2026-06',
    actualNetIncome: 4890.0,
    personalFixedAllowance: 220.0,
    note: 'Inkl. Urlaubsgeld Juni',
  },
  {
    id: 'mi-j-2026-06',
    tenantId: TENANT_WEBER_ID,
    personId: 'p-julia',
    monthKey: '2026-06',
    actualNetIncome: 2640.0,
    personalFixedAllowance: 180.0,
    note: 'Reguläres Juni-Netto',
  },
  {
    id: 'mi-b1-2026-04',
    tenantId: TENANT_WG_ID,
    personId: 'p-becker-1',
    monthKey: '2026-04',
    actualNetIncome: 3740.0,
    personalFixedAllowance: 150.0,
    note: 'Inkl. Schichtzulage April',
  },
  {
    id: 'mi-b2-2026-04',
    tenantId: TENANT_WG_ID,
    personId: 'p-becker-2',
    monthKey: '2026-04',
    actualNetIncome: 3120.0,
    personalFixedAllowance: 150.0,
    note: 'Besoldung 04/2026',
  },
];

const INITIAL_ACCOUNTS: Account[] = [
  {
    id: 'acc-dkb-joint',
    tenantId: TENANT_WEBER_ID,
    ownerPersonId: null,
    name: 'DKB Gemeinschaftskonto (Fixkosten)',
    institutionName: 'Deutsche Kreditbank (DKB)',
    iban: 'DE84 1203 0000 1020 3040 50',
    currency: 'EUR',
    accountType: AccountType.JOINT_CHECKING,
    currentBalance: 4180.0,
    includeInHouseholdLiquidity: true,
  },
  {
    id: 'acc-dkb-reserve',
    tenantId: TENANT_WEBER_ID,
    ownerPersonId: null,
    name: 'DKB Tagesgeld (Rückstellungen / Töpfe)',
    institutionName: 'Deutsche Kreditbank (DKB)',
    iban: 'DE84 1203 0000 1020 3099 88',
    currency: 'EUR',
    accountType: AccountType.SAVINGS_RESERVE,
    currentBalance: 5465.0,
    includeInHouseholdLiquidity: true,
  },
  {
    id: 'acc-dkb-markus',
    tenantId: TENANT_WEBER_ID,
    ownerPersonId: 'p-markus',
    name: 'DKB Girokonto Markus',
    institutionName: 'Deutsche Kreditbank (DKB)',
    iban: 'DE12 1203 0000 9080 7060 11',
    currency: 'EUR',
    accountType: AccountType.PERSONAL_CHECKING,
    currentBalance: 1940.0,
    includeInHouseholdLiquidity: false,
  },
  {
    id: 'acc-becker-joint',
    tenantId: TENANT_WG_ID,
    ownerPersonId: null,
    name: 'DKB Haushaltskonto Becker',
    institutionName: 'Deutsche Kreditbank (DKB)',
    iban: 'DE55 1203 0000 4455 6677 00',
    currency: 'EUR',
    accountType: AccountType.JOINT_CHECKING,
    currentBalance: 3420.0,
    includeInHouseholdLiquidity: true,
  },
];

const INITIAL_CATEGORIES: BudgetCategory[] = [
  {
    id: 'cat-housing',
    tenantId: TENANT_WEBER_ID,
    code: 'WOHNEN',
    name: 'Wohnen & Nebenkosten',
    isSharedDefault: true,
    monthlyBudgetLimit: 1850,
  },
  {
    id: 'cat-insurance',
    tenantId: TENANT_WEBER_ID,
    code: 'VERSICHERUNG',
    name: 'Versicherungen & Abgaben',
    isSharedDefault: true,
    monthlyBudgetLimit: 250,
  },
  {
    id: 'cat-mobility',
    tenantId: TENANT_WEBER_ID,
    code: 'MOBILITAET',
    name: 'Mobilität & KFZ',
    isSharedDefault: true,
    monthlyBudgetLimit: 320,
  },
  {
    id: 'cat-family',
    tenantId: TENANT_WEBER_ID,
    code: 'FAMILIE',
    name: 'Kita, Familie & Urlaub',
    isSharedDefault: true,
    monthlyBudgetLimit: 680,
  },
  {
    id: 'cat-groceries',
    tenantId: TENANT_WEBER_ID,
    code: 'LEBENSMITTEL',
    name: 'Lebensmittel & Drogerie',
    isSharedDefault: true,
    monthlyBudgetLimit: 650,
  },
  {
    id: 'cat-media',
    tenantId: TENANT_WEBER_ID,
    code: 'MEDIEN',
    name: 'Internet, Rundfunk & IT',
    isSharedDefault: true,
    monthlyBudgetLimit: 95,
  },
  {
    id: 'cat-b-housing',
    tenantId: TENANT_WG_ID,
    code: 'WOHNEN',
    name: 'Miete & Energie',
    isSharedDefault: true,
    monthlyBudgetLimit: 1500,
  },
  {
    id: 'cat-b-ins',
    tenantId: TENANT_WG_ID,
    code: 'VERSICHERUNG',
    name: 'Versicherungen & Rücklagen',
    isSharedDefault: true,
    monthlyBudgetLimit: 350,
  },
];

const INITIAL_PLANNED_PAYMENTS: PlannedPayment[] = [
  {
    id: 'pp-rent',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    categoryId: 'cat-housing',
    name: 'Warmmiete inkl. Tiefgarage',
    payee: 'Hausverwaltung Süd GmbH',
    amount: 1480.0,
    currency: 'EUR',
    interval: RecurrenceInterval.MONTHLY,
    nextDueDate: '2026-05-03',
    endDate: null,
    dayOfMonth: 3,
    amountRevisions: [
      {
        id: 'rev-rent-2026-08',
        validFrom: '2026-08-01',
        amount: 1545.0,
        note: 'Indexmiete Staffel ab 08/2026',
      },
    ],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: false,
  },
  {
    id: 'pp-energy',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    categoryId: 'cat-housing',
    name: 'Strom & Fernwärme Abschlag',
    payee: 'Stadtwerke München',
    amount: 165.0,
    currency: 'EUR',
    interval: RecurrenceInterval.MONTHLY,
    nextDueDate: '2026-05-05',
    endDate: null,
    dayOfMonth: 5,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: false,
  },
  {
    id: 'pp-kita',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    categoryId: 'cat-family',
    name: 'Kita-Gebühr & Essensgeld Leo',
    payee: 'Trägerverein Sonnenschein e.V.',
    amount: 245.0,
    currency: 'EUR',
    interval: RecurrenceInterval.MONTHLY,
    nextDueDate: '2026-05-02',
    endDate: '2026-08-31',
    dayOfMonth: 2,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: false,
  },
  {
    id: 'pp-groceries',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    categoryId: 'cat-groceries',
    name: 'Haushaltsbudget Wocheneinkauf',
    payee: 'REWE / Biomarkt / dm',
    amount: 600.0,
    currency: 'EUR',
    interval: RecurrenceInterval.MONTHLY,
    nextDueDate: '2026-05-01',
    endDate: null,
    dayOfMonth: 1,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: false,
  },
  {
    id: 'pp-fiber',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    categoryId: 'cat-media',
    name: 'Glasfaser 500 + Familien-Cloud',
    payee: 'M-net Telekommunikation',
    amount: 49.9,
    currency: 'EUR',
    interval: RecurrenceInterval.MONTHLY,
    nextDueDate: '2026-05-12',
    endDate: null,
    dayOfMonth: 12,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: false,
  },
  {
    id: 'pp-gez',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    categoryId: 'cat-media',
    name: 'Rundfunkbeitrag (ARD/ZDF)',
    payee: 'ARD ZDF Deutschlandradio',
    amount: 55.08,
    currency: 'EUR',
    interval: RecurrenceInterval.QUARTERLY,
    nextDueDate: '2026-07-15',
    endDate: null,
    dayOfMonth: 15,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: true,
  },
  {
    id: 'pp-home-ins',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-reserve',
    categoryId: 'cat-insurance',
    name: 'Wohngebäude-, Hausrat- & Haftpflicht',
    payee: 'HUK-COBURG Versicherung',
    amount: 780.0,
    currency: 'EUR',
    interval: RecurrenceInterval.ANNUAL,
    nextDueDate: '2027-04-10',
    endDate: null,
    dayOfMonth: 10,
    amountRevisions: [
      {
        id: 'rev-huk-2027',
        validFrom: '2027-01-01',
        amount: 816.0,
        note: 'Beitragsanpassung ab 2027',
      },
    ],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: true,
  },
  {
    id: 'pp-car-ins',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-reserve',
    categoryId: 'cat-mobility',
    name: 'KFZ-Vollkasko & Schutzbrief',
    payee: 'Allianz Direkt',
    amount: 468.0,
    currency: 'EUR',
    interval: RecurrenceInterval.SEMI_ANNUAL,
    nextDueDate: '2026-07-01',
    endDate: '2026-12-31',
    dayOfMonth: 1,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: true,
  },
  {
    id: 'pp-car-service',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-reserve',
    categoryId: 'cat-mobility',
    name: 'KFZ-Inspektion, TÜV & Reifenrücklage',
    payee: 'Autohaus Hofmann',
    amount: 960.0,
    currency: 'EUR',
    interval: RecurrenceInterval.ANNUAL,
    nextDueDate: '2026-11-15',
    endDate: null,
    dayOfMonth: 15,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: true,
  },
  {
    id: 'pp-vacation',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-reserve',
    categoryId: 'cat-family',
    name: 'Familienurlaub Sommer (Südtirol)',
    payee: 'Anspartopf Familienreise',
    amount: 2400.0,
    currency: 'EUR',
    interval: RecurrenceInterval.ANNUAL,
    nextDueDate: '2026-08-01',
    endDate: null,
    dayOfMonth: 1,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: true,
  },
  {
    id: 'pp-heating-buffer',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-reserve',
    categoryId: 'cat-housing',
    name: 'Nebenkosten-Nachzahlungspuffer 2026',
    payee: 'Hausverwaltung Süd GmbH',
    amount: 600.0,
    currency: 'EUR',
    interval: RecurrenceInterval.ONE_TIME,
    nextDueDate: '2026-10-15',
    endDate: '2026-10-31',
    dayOfMonth: 15,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: true,
  },
  {
    id: 'pp-expired-club',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-reserve',
    categoryId: 'cat-family',
    name: 'Altes Sportstudio-Jahresabo (gekündigt)',
    payee: 'FitPlus GmbH',
    amount: 480.0,
    currency: 'EUR',
    interval: RecurrenceInterval.ANNUAL,
    nextDueDate: '2026-12-01',
    endDate: '2026-03-31',
    dayOfMonth: 1,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: true,
  },
  {
    id: 'pp-b-rent',
    tenantId: TENANT_WG_ID,
    accountId: 'acc-becker-joint',
    categoryId: 'cat-b-housing',
    name: 'Warmmiete Stadtwohnung',
    payee: 'Wohnbau Nord',
    amount: 1320.0,
    currency: 'EUR',
    interval: RecurrenceInterval.MONTHLY,
    nextDueDate: '2026-05-01',
    endDate: null,
    dayOfMonth: 1,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: false,
  },
  {
    id: 'pp-b-ins',
    tenantId: TENANT_WG_ID,
    accountId: 'acc-becker-joint',
    categoryId: 'cat-b-ins',
    name: 'Jahrespolice Hausrat & Rechtsschutz',
    payee: 'ARAG / Haftpflichtkasse',
    amount: 540.0,
    currency: 'EUR',
    interval: RecurrenceInterval.ANNUAL,
    nextDueDate: '2026-09-01',
    endDate: null,
    dayOfMonth: 1,
    amountRevisions: [],
    splitStrategyOverride: null,
    isShared: true,
    isActive: true,
    autoAccrual: true,
  },
];

// Deterministic hash for April rent so loading the sample DKB CSV triggers an EXACT_HASH duplicate block!
const APRIL_RENT_EXACT_HASH = computeCanonicalImportHash(
  'acc-dkb-joint',
  '2026-04-03',
  -1480.0,
  'Hausverwaltung Süd GmbH',
  'DE44500105175407324931',
  'Warmmiete April 2026 Whg 14',
  1
);

const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-seed-apr-review',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    counterpartyAccountId: null,
    categoryId: 'cat-groceries',
    plannedPaymentId: 'pp-groceries',
    bookingDate: '2026-04-14',
    valueDate: '2026-04-14',
    amount: -38.4,
    currency: 'EUR',
    direction: TransactionDirection.OUTFLOW,
    counterpartyName: 'DM-DROGERIE MARKT GMBH',
    counterpartyIban: 'DE89370400440532013001',
    remittanceInfo: 'Drogerieeinkauf Windeln & Haushalt',
    matchSource: MatchSource.REGEX_RULE,
    matchConfidence: 0.95,
    needsReview: true,
    importHash: 'seed-hash-apr-dm',
  },
  {
    id: 'tx-seed-apr-huk',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    counterpartyAccountId: null,
    categoryId: 'cat-insurance',
    plannedPaymentId: 'pp-home-ins',
    bookingDate: '2026-04-10',
    valueDate: '2026-04-10',
    amount: -780.0,
    currency: 'EUR',
    direction: TransactionDirection.OUTFLOW,
    counterpartyName: 'HUK-COBURG Versicherung',
    counterpartyIban: 'DE62763500000000019283',
    remittanceInfo: 'Manuelle Topf-Abrechnung Jahrespolice 99412',
    matchSource: MatchSource.MANUAL,
    matchConfidence: 1.0,
    needsReview: false,
    importHash: 'manual-settlement-huk-2026',
  },
  {
    id: 'tx-seed-apr-car-overdraft',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-reserve',
    counterpartyAccountId: null,
    categoryId: 'cat-mobility',
    plannedPaymentId: 'pp-car-service',
    bookingDate: '2026-04-08',
    valueDate: '2026-04-08',
    amount: -520.0,
    currency: 'EUR',
    direction: TransactionDirection.OUTFLOW,
    counterpartyName: 'Autohaus Hofmann',
    counterpartyIban: 'DE51700202700015829100',
    remittanceInfo: 'Ungeplante Bremsen-Reparatur vorne (aus Topf abgerechnet trotz Unterdeckung)',
    matchSource: MatchSource.REGEX_RULE,
    matchConfidence: 0.95,
    needsReview: false,
    importHash: 'seed-hash-apr-car-520',
  },
  {
    id: 'tx-seed-apr-swm',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    counterpartyAccountId: null,
    categoryId: 'cat-housing',
    plannedPaymentId: 'pp-energy',
    bookingDate: '2026-04-05',
    valueDate: '2026-04-05',
    amount: -165.0,
    currency: 'EUR',
    direction: TransactionDirection.OUTFLOW,
    counterpartyName: 'Stadtwerke München',
    counterpartyIban: 'DE19700500000000024510',
    remittanceInfo: 'Abschlag Strom + Fernwärme 04/2026',
    matchSource: MatchSource.REGEX_RULE,
    matchConfidence: 0.95,
    needsReview: false,
    importHash: 'seed-hash-apr-swm',
  },
  {
    id: 'tx-seed-apr-rent',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    counterpartyAccountId: null,
    categoryId: 'cat-housing',
    plannedPaymentId: 'pp-rent',
    bookingDate: '2026-04-03',
    valueDate: '2026-04-03',
    amount: -1480.0,
    currency: 'EUR',
    direction: TransactionDirection.OUTFLOW,
    counterpartyName: 'Hausverwaltung Süd GmbH',
    counterpartyIban: 'DE44500105175407324931',
    remittanceInfo: 'Warmmiete April 2026 Whg 14',
    matchSource: MatchSource.REGEX_RULE,
    matchConfidence: 0.95,
    needsReview: false,
    importHash: APRIL_RENT_EXACT_HASH,
  },
  {
    id: 'tx-seed-apr-kita',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    counterpartyAccountId: null,
    categoryId: 'cat-family',
    plannedPaymentId: 'pp-kita',
    bookingDate: '2026-04-02',
    valueDate: '2026-04-02',
    amount: -245.0,
    currency: 'EUR',
    direction: TransactionDirection.OUTFLOW,
    counterpartyName: 'Trägerverein Sonnenschein e.V.',
    counterpartyIban: 'DE77701500000011223344',
    remittanceInfo: 'Kita-Beitrag & Essensgeld Leo 04/2026',
    matchSource: MatchSource.MANUAL,
    matchConfidence: 1.0,
    needsReview: false,
    importHash: 'seed-hash-apr-kita',
  },
  {
    id: 'tx-seed-apr-transfer-markus',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    counterpartyAccountId: 'acc-dkb-markus',
    categoryId: null,
    plannedPaymentId: null,
    bookingDate: '2026-04-02',
    valueDate: '2026-04-02',
    amount: 2290.0,
    currency: 'EUR',
    direction: TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER,
    counterpartyName: 'Markus Weber',
    counterpartyIban: 'DE12120300009080706011',
    remittanceInfo: 'Dauerauftrag Haushaltsumlage April',
    matchSource: MatchSource.OWN_IBAN_TRANSFER,
    matchConfidence: 1.0,
    needsReview: false,
    importHash: 'seed-hash-apr-trf-m',
  },
  {
    id: 'tx-seed-mar-rent',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    counterpartyAccountId: null,
    categoryId: 'cat-housing',
    plannedPaymentId: 'pp-rent',
    bookingDate: '2026-03-03',
    valueDate: '2026-03-03',
    amount: -1480.0,
    currency: 'EUR',
    direction: TransactionDirection.OUTFLOW,
    counterpartyName: 'Hausverwaltung Süd GmbH',
    counterpartyIban: 'DE44500105175407324931',
    remittanceInfo: 'Warmmiete März 2026 Whg 14',
    matchSource: MatchSource.REGEX_RULE,
    matchConfidence: 0.95,
    needsReview: false,
    importHash: 'seed-hash-mar-rent',
  },
  {
    id: 'tx-seed-mar-transfer',
    tenantId: TENANT_WEBER_ID,
    accountId: 'acc-dkb-joint',
    counterpartyAccountId: 'acc-dkb-markus',
    categoryId: null,
    plannedPaymentId: null,
    bookingDate: '2026-03-02',
    valueDate: '2026-03-02',
    amount: 1890.0,
    currency: 'EUR',
    direction: TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER,
    counterpartyName: 'Markus Weber',
    counterpartyIban: 'DE12120300009080706011',
    remittanceInfo: 'Dauerauftrag Haushaltsumlage März',
    matchSource: MatchSource.OWN_IBAN_TRANSFER,
    matchConfidence: 1.0,
    needsReview: false,
    importHash: 'seed-hash-mar-trf',
  },
];

const INITIAL_LEDGER_ENTRIES: SinkingFundLedgerEntry[] = [
  {
    id: 'led-1',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-gez',
    linkedTransactionId: null,
    entryDate: '2026-04-01',
    entryType: SinkingFundEntryType.MONTHLY_PROVISION,
    amount: 18.36,
    reallocationGroupId: null,
    note: 'Monatliche Rückstellung 04/2026',
  },
  {
    id: 'led-2-accrued',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-home-ins',
    linkedTransactionId: null,
    entryDate: '2026-03-01',
    entryType: SinkingFundEntryType.MONTHLY_PROVISION,
    amount: 780.0,
    reallocationGroupId: null,
    note: 'Angespartes Guthaben 12/12 Raten',
  },
  {
    id: 'led-2-settled',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-home-ins',
    linkedTransactionId: 'tx-seed-apr-huk',
    entryDate: '2026-04-10',
    entryType: SinkingFundEntryType.INVOICE_SETTLEMENT,
    amount: -780.0,
    reallocationGroupId: null,
    note: 'Jahrespolice HUK-COBURG abgerechnet',
  },
  {
    id: 'led-3',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-car-ins',
    linkedTransactionId: null,
    entryDate: '2026-04-01',
    entryType: SinkingFundEntryType.MONTHLY_PROVISION,
    amount: 234.0,
    reallocationGroupId: null,
    note: 'Kumulierte Rückstellung (3/6 Monate)',
  },
  {
    id: 'led-4-accrued',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-car-service',
    linkedTransactionId: null,
    entryDate: '2026-04-01',
    entryType: SinkingFundEntryType.MONTHLY_PROVISION,
    amount: 400.0,
    reallocationGroupId: null,
    note: 'Kumulierte Rückstellung (5/12 Monate)',
  },
  {
    id: 'led-4-overdraft-settlement',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-car-service',
    linkedTransactionId: 'tx-seed-apr-car-overdraft',
    entryDate: '2026-04-08',
    entryType: SinkingFundEntryType.INVOICE_SETTLEMENT,
    amount: -520.0, // Full debit even though only 400 € was saved -> Pot stands at -120.00 €!
    reallocationGroupId: null,
    note: 'Bremsen-Reparatur Autohaus Hofmann (Topf um -120,00 € überzogen)',
  },
  {
    id: 'led-5',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-vacation',
    linkedTransactionId: null,
    entryDate: '2026-04-01',
    entryType: SinkingFundEntryType.MONTHLY_PROVISION,
    amount: 1450.0,
    reallocationGroupId: null,
    note: 'Kumulierte Rückstellung Familienurlaub',
  },
  {
    id: 'led-6',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-heating-buffer',
    linkedTransactionId: null,
    entryDate: '2026-04-01',
    entryType: SinkingFundEntryType.MONTHLY_PROVISION,
    amount: 240.0,
    reallocationGroupId: null,
    note: 'Startpuffer Nebenkosten',
  },
  {
    id: 'led-expired-surplus',
    tenantId: TENANT_WEBER_ID,
    plannedPaymentId: 'pp-expired-club',
    linkedTransactionId: null,
    entryDate: '2026-02-01',
    entryType: SinkingFundEntryType.MONTHLY_PROVISION,
    amount: 95.0,
    reallocationGroupId: null,
    note: 'Verbliebenes Restguthaben nach Vertragsende 03/2026',
  },
  {
    id: 'led-b-1',
    tenantId: TENANT_WG_ID,
    plannedPaymentId: 'pp-b-ins',
    linkedTransactionId: null,
    entryDate: '2026-04-01',
    entryType: SinkingFundEntryType.MONTHLY_PROVISION,
    amount: 270.0,
    reallocationGroupId: null,
    note: 'Kumulierte Rückstellung 6/12',
  },
];

const INITIAL_RULES: MatchingRule[] = [
  {
    id: 'rule-rent',
    tenantId: TENANT_WEBER_ID,
    name: 'Warmmiete Hausverwaltung Süd',
    priority: 10,
    counterpartyPattern: 'Hausverwaltung\\s+Süd',
    remittancePattern: 'Warmmiete|Miete',
    targetCategoryId: 'cat-housing',
    targetPlannedPaymentId: 'pp-rent',
    isActive: true,
  },
  {
    id: 'rule-swm',
    tenantId: TENANT_WEBER_ID,
    name: 'Stadtwerke Strom & Fernwärme',
    priority: 20,
    counterpartyPattern: 'Stadtwerke',
    remittancePattern: 'Abschlag|Strom',
    targetCategoryId: 'cat-housing',
    targetPlannedPaymentId: 'pp-energy',
    isActive: true,
  },
  {
    id: 'rule-huk',
    tenantId: TENANT_WEBER_ID,
    name: 'HUK-COBURG Jahrespolice (Sinking Fund)',
    priority: 30,
    counterpartyPattern: 'HUK-COBURG',
    remittancePattern: 'Wohngebäude|Hausrat|Police',
    targetCategoryId: 'cat-insurance',
    targetPlannedPaymentId: 'pp-home-ins',
    isActive: true,
  },
  {
    id: 'rule-gez',
    tenantId: TENANT_WEBER_ID,
    name: 'ARD/ZDF Rundfunkbeitrag Quartal',
    priority: 40,
    counterpartyPattern: 'ARD\\s+ZDF',
    remittancePattern: 'Rundfunkbeitrag',
    targetCategoryId: 'cat-media',
    targetPlannedPaymentId: 'pp-gez',
    isActive: true,
  },
  {
    id: 'rule-rewe',
    tenantId: TENANT_WEBER_ID,
    name: 'Supermarkt & Wocheneinkauf',
    priority: 50,
    counterpartyPattern: 'REWE|EDEKA|ALDI|LIDL|DM-DROGERIE',
    remittancePattern: null,
    targetCategoryId: 'cat-groceries',
    targetPlannedPaymentId: 'pp-groceries',
    isActive: true,
  },
  {
    id: 'rule-car',
    tenantId: TENANT_WEBER_ID,
    name: 'Werkstatt / Autohaus Inspektion',
    priority: 60,
    counterpartyPattern: 'Autohaus|Werkstatt',
    remittancePattern: 'Inspektion|TÜV|Reifen|Wischer',
    targetCategoryId: 'cat-mobility',
    targetPlannedPaymentId: 'pp-car-service',
    isActive: true,
  },
];

export interface PlannedPaymentFormPayload {
  name: string;
  payee: string;
  amount: number;
  interval: RecurrenceInterval;
  nextDueDate: string;
  endDate: string | null;
  accountId: string;
  categoryId: string;
  autoAccrual: boolean;
  isActive: boolean;
  amountRevisions: PlannedPaymentAmountRevision[];
  initialPotBalance?: number;
}

export interface ManualTransactionPayload {
  accountId: string;
  bookingDate: string;
  amount: number; // positive or signed; normalized by direction
  direction: TransactionDirection;
  counterpartyName: string;
  remittanceInfo: string;
  categoryId: string | null;
  plannedPaymentId: string | null;
}

interface HouseholdStoreValue {
  instanceMode: InstanceMode;
  isSetupWizardOpen: boolean;
  openSetupWizard: () => void;
  closeSetupWizard: () => void;
  bootstrapCleanInstance: (payload: InstanceBootstrapPayload) => void;
  activateDemoMode: () => void;

  tenants: Tenant[];
  activeTenant: Tenant;
  setActiveTenantId: (id: string) => void;
  updateTenantStrategy: (strategy: SplitStrategy) => void;
  referenceMonthKey: string;
  setReferenceMonthKey: (monthKey: string) => void;
  allowNegativeTransferCompensation: boolean;
  setAllowNegativeTransferCompensation: (val: boolean) => void;

  persons: Person[];
  monthlyIncomes: PersonMonthlyIncome[];
  accounts: Account[];
  categories: BudgetCategory[];
  plannedPayments: PlannedPayment[];
  ledgerEntries: SinkingFundLedgerEntry[];
  matchingRules: MatchingRule[];
  transactions: Transaction[];
  stagingBatch: ImportStagingBatch | null;

  updatePersonMaster: (
    personId: string,
    patch: Partial<
      Pick<
        Person,
        | 'displayName'
        | 'roleLabel'
        | 'isEmployed'
        | 'defaultPersonalAllowance'
        | 'customSplitWeight'
      >
    >
  ) => void;
  upsertPersonMonthlyIncome: (
    personId: string,
    monthKey: string,
    actualNetIncome: number,
    personalFixedAllowance: number,
    note?: string
  ) => void;
  clearPersonMonthlyIncome: (personId: string, monthKey: string) => void;
  addPerson: (
    displayName: string,
    roleLabel: string,
    isEmployed: boolean,
    initialMonthNetIncome: number,
    defaultPersonalAllowance: number
  ) => void;
  addAccount: (
    name: string,
    iban: string,
    accountType: AccountType,
    currentBalance: number
  ) => void;
  addCategory: (
    code: string,
    name: string,
    monthlyBudgetLimit?: number | null
  ) => void;

  addPlannedPayment: (input: PlannedPaymentFormPayload) => void;
  updatePlannedPayment: (
    paymentId: string,
    patch: Partial<PlannedPaymentFormPayload>
  ) => void;
  deletePlannedPayment: (paymentId: string) => {ok: boolean; error?: string};

  bookMonthlyProvision: (paymentId: string, amount: number) => void;
  settlePlannedPaymentInvoice: (
    paymentId: string,
    invoiceAmount: number,
    bookingDate?: string,
    note?: string
  ) => {potBalanceBefore: number; potBalanceAfter: number};
  reallocateVirtualPots: (
    fromPaymentId: string,
    toPaymentId: string,
    amount: number,
    note: string
  ) => {ok: boolean; error?: string};

  addManualTransaction: (input: ManualTransactionPayload) => void;
  updateTransactionClassification: (
    transactionId: string,
    patch: {categoryId?: string | null; plannedPaymentId?: string | null}
  ) => void;

  processDkbCsvImport: (
    accountId: string,
    filename: string,
    csvText: string,
    commitMode: ImportCommitMode
  ) => {importedCount: number; stagedCount: number; duplicateCount: number};
  loadSampleDkbImport: (
    accountId: string,
    commitMode: ImportCommitMode
  ) => {importedCount: number; stagedCount: number; duplicateCount: number};
  updateStagingRowSelection: (rowNumber: number, selected: boolean) => void;
  updateStagingRowOverride: (
    rowNumber: number,
    patch: {suggestedCategoryId?: string | null; suggestedPlannedPaymentId?: string | null}
  ) => void;
  commitStagingBatch: () => {committedCount: number; skippedDuplicates: number};
  discardStagingBatch: () => void;
  approveTransactionReview: (transactionId: string) => void;
  addMatchingRule: (
    name: string,
    counterpartyPattern: string,
    remittancePattern: string,
    targetCategoryId: string | null,
    targetPlannedPaymentId: string | null
  ) => void;
}

const HouseholdContext = createContext<HouseholdStoreValue | null>(null);

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function advanceDueDateIso(currentIso: string, interval: RecurrenceInterval): string {
  const [y, m, d] = currentIso.split('-').map(Number);
  const stepMap: Record<RecurrenceInterval, number> = {
    [RecurrenceInterval.MONTHLY]: 1,
    [RecurrenceInterval.QUARTERLY]: 3,
    [RecurrenceInterval.SEMI_ANNUAL]: 6,
    [RecurrenceInterval.ANNUAL]: 12,
    [RecurrenceInterval.BIENNIAL]: 24,
    [RecurrenceInterval.ONE_TIME]: 0,
  };
  const step = stepMap[interval];
  if (step === 0) return currentIso;
  const nextDt = new Date(y, m - 1 + step, Math.min(28, d));
  return `${nextDt.getFullYear()}-${String(nextDt.getMonth() + 1).padStart(2, '0')}-${String(
    nextDt.getDate()
  ).padStart(2, '0')}`;
}

export const HouseholdProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const initialPersisted = useMemo(() => loadPersistedSnapshot(), []);

  const [instanceMode, setInstanceMode] = useState<InstanceMode>(
    () => initialPersisted?.instanceMode ?? 'UNINITIALIZED'
  );
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState<boolean>(
    () => !initialPersisted
  );

  const [tenants, setTenants] = useState<Tenant[]>(
    () => initialPersisted?.tenants ?? INITIAL_TENANTS
  );
  const [activeTenantId, setActiveTenantId] = useState<string>(
    () => initialPersisted?.activeTenantId ?? TENANT_WEBER_ID
  );
  const [referenceMonthKey, setReferenceMonthKey] = useState<string>(
    () => initialPersisted?.referenceMonthKey ?? '2026-04'
  );
  const [allowNegativeTransferCompensation, setAllowNegativeTransferCompensation] =
    useState<boolean>(
      () => initialPersisted?.allowNegativeTransferCompensation ?? false
    );

  const [allPersons, setAllPersons] = useState<Person[]>(
    () => initialPersisted?.persons ?? INITIAL_PERSONS
  );
  const [allMonthlyIncomes, setAllMonthlyIncomes] = useState<PersonMonthlyIncome[]>(
    () => initialPersisted?.monthlyIncomes ?? INITIAL_MONTHLY_INCOMES
  );
  const [allAccounts, setAllAccounts] = useState<Account[]>(
    () => initialPersisted?.accounts ?? INITIAL_ACCOUNTS
  );
  const [allCategories, setAllCategories] = useState<BudgetCategory[]>(
    () => initialPersisted?.categories ?? INITIAL_CATEGORIES
  );
  const [allPayments, setAllPayments] = useState<PlannedPayment[]>(
    () => initialPersisted?.plannedPayments ?? INITIAL_PLANNED_PAYMENTS
  );
  const [allLedger, setAllLedger] = useState<SinkingFundLedgerEntry[]>(
    () => initialPersisted?.ledgerEntries ?? INITIAL_LEDGER_ENTRIES
  );
  const [allRules, setAllRules] = useState<MatchingRule[]>(
    () => initialPersisted?.matchingRules ?? INITIAL_RULES
  );
  const [allTransactions, setAllTransactions] = useState<Transaction[]>(
    () => initialPersisted?.transactions ?? INITIAL_TRANSACTIONS
  );
  const [stagingBatch, setStagingBatch] = useState<ImportStagingBatch | null>(null);

  const activeTenant = useMemo(
    () => tenants.find((t) => t.id === activeTenantId) ?? tenants[0],
    [tenants, activeTenantId]
  );

  useEffect(() => {
    equiBudgetApi.setTenantId(activeTenant?.id ?? null);
  }, [activeTenant?.id]);

  useEffect(() => {
    if (instanceMode === 'UNINITIALIZED' || typeof window === 'undefined') {
      return;
    }
    try {
      const snapshot: PersistedEquiBudgetSnapshot = {
        instanceMode,
        activeTenantId,
        referenceMonthKey,
        allowNegativeTransferCompensation,
        tenants,
        persons: allPersons,
        monthlyIncomes: allMonthlyIncomes,
        accounts: allAccounts,
        categories: allCategories,
        plannedPayments: allPayments,
        ledgerEntries: allLedger,
        matchingRules: allRules,
        transactions: allTransactions,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore quota errors in restricted browsing modes
    }
  }, [
    instanceMode,
    activeTenantId,
    referenceMonthKey,
    allowNegativeTransferCompensation,
    tenants,
    allPersons,
    allMonthlyIncomes,
    allAccounts,
    allCategories,
    allPayments,
    allLedger,
    allRules,
    allTransactions,
  ]);

  const persons = useMemo(
    () => allPersons.filter((p) => p.tenantId === activeTenant.id),
    [allPersons, activeTenant.id]
  );
  const monthlyIncomes = useMemo(
    () => allMonthlyIncomes.filter((mi) => mi.tenantId === activeTenant.id),
    [allMonthlyIncomes, activeTenant.id]
  );
  const accounts = useMemo(
    () => allAccounts.filter((a) => a.tenantId === activeTenant.id),
    [allAccounts, activeTenant.id]
  );
  const categories = useMemo(
    () => allCategories.filter((c) => c.tenantId === activeTenant.id),
    [allCategories, activeTenant.id]
  );
  const plannedPayments = useMemo(
    () => allPayments.filter((p) => p.tenantId === activeTenant.id),
    [allPayments, activeTenant.id]
  );
  const ledgerEntries = useMemo(
    () => allLedger.filter((l) => l.tenantId === activeTenant.id),
    [allLedger, activeTenant.id]
  );
  const matchingRules = useMemo(
    () => allRules.filter((r) => r.tenantId === activeTenant.id),
    [allRules, activeTenant.id]
  );
  const transactions = useMemo(
    () =>
      allTransactions
        .filter((tx) => tx.tenantId === activeTenant.id)
        .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate)),
    [allTransactions, activeTenant.id]
  );

  const updateTenantStrategy = useCallback(
    (strategy: SplitStrategy) => {
      setTenants((prev) =>
        prev.map((t) =>
          t.id === activeTenant.id ? {...t, defaultSplitStrategy: strategy} : t
        )
      );
    },
    [activeTenant.id]
  );

  const updatePersonMaster = useCallback(
    (
      personId: string,
      patch: Partial<
        Pick<
          Person,
          | 'displayName'
          | 'roleLabel'
          | 'isEmployed'
          | 'defaultPersonalAllowance'
          | 'customSplitWeight'
        >
      >
    ) => {
      setAllPersons((prev) =>
        prev.map((p) => (p.id === personId ? {...p, ...patch} : p))
      );
    },
    []
  );

  const upsertPersonMonthlyIncome = useCallback(
    (
      personId: string,
      monthKey: string,
      actualNetIncome: number,
      personalFixedAllowance: number,
      note?: string
    ) => {
      setAllMonthlyIncomes((prev) => {
        const existingIdx = prev.findIndex(
          (r) =>
            r.tenantId === activeTenant.id &&
            r.personId === personId &&
            r.monthKey === monthKey
        );
        const cleanNet = Math.max(0, Math.round(actualNetIncome * 100) / 100);
        const cleanDed = Math.max(0, Math.round(personalFixedAllowance * 100) / 100);

        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            actualNetIncome: cleanNet,
            personalFixedAllowance: cleanDed,
            note: note !== undefined ? note : updated[existingIdx].note,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: makeId('mi'),
            tenantId: activeTenant.id,
            personId,
            monthKey,
            actualNetIncome: cleanNet,
            personalFixedAllowance: cleanDed,
            note: note ?? '',
          },
        ];
      });
    },
    [activeTenant.id]
  );

  const clearPersonMonthlyIncome = useCallback(
    (personId: string, monthKey: string) => {
      setAllMonthlyIncomes((prev) =>
        prev.filter(
          (r) =>
            !(
              r.tenantId === activeTenant.id &&
              r.personId === personId &&
              r.monthKey === monthKey
            )
        )
      );
    },
    [activeTenant.id]
  );

  const addPerson = useCallback(
    (
      displayName: string,
      roleLabel: string,
      isEmployed: boolean,
      initialMonthNetIncome: number,
      defaultPersonalAllowance: number
    ) => {
      const personId = makeId('p');
      const next: Person = {
        id: personId,
        tenantId: activeTenant.id,
        displayName,
        roleLabel,
        isEmployed,
        participatesInHouseholdSplit: true,
        defaultPersonalAllowance,
        customSplitWeight: isEmployed ? 50 : 0,
      };
      setAllPersons((prev) => [...prev, next]);

      if (isEmployed && initialMonthNetIncome > 0) {
        setAllMonthlyIncomes((prev) => [
          ...prev,
          {
            id: makeId('mi'),
            tenantId: activeTenant.id,
            personId,
            monthKey: referenceMonthKey,
            actualNetIncome: initialMonthNetIncome,
            personalFixedAllowance: defaultPersonalAllowance,
            note: 'Erst-Eintrag',
          },
        ]);
      }
    },
    [activeTenant.id, referenceMonthKey]
  );

  const addAccount = useCallback(
    (
      name: string,
      iban: string,
      accountType: AccountType,
      currentBalance: number
    ) => {
      const next: Account = {
        id: makeId('acc'),
        tenantId: activeTenant.id,
        ownerPersonId: null,
        name,
        institutionName: 'DKB / Hausbank',
        iban: normalizeIban(iban) || iban,
        currency: 'EUR',
        accountType,
        currentBalance,
        includeInHouseholdLiquidity: accountType !== AccountType.PERSONAL_CHECKING,
      };
      setAllAccounts((prev) => [...prev, next]);
    },
    [activeTenant.id]
  );

  const addCategory = useCallback(
    (code: string, name: string, monthlyBudgetLimit: number | null = null) => {
      const next: BudgetCategory = {
        id: makeId('cat'),
        tenantId: activeTenant.id,
        code: code.trim().toUpperCase() || 'SONSTIGES',
        name: name.trim(),
        isSharedDefault: true,
        monthlyBudgetLimit,
      };
      setAllCategories((prev) => [...prev, next]);
    },
    [activeTenant.id]
  );

  const addPlannedPayment = useCallback(
    (input: PlannedPaymentFormPayload) => {
      const day = Number(input.nextDueDate.split('-')[2] ?? 1) || 1;
      const sortedRevs = [...input.amountRevisions].sort((a, b) =>
        a.validFrom.localeCompare(b.validFrom)
      );
      const effectiveAutoAccrual =
        input.interval === RecurrenceInterval.MONTHLY ? false : input.autoAccrual;
      const createdId = makeId('pp');

      const created: PlannedPayment = {
        id: createdId,
        tenantId: activeTenant.id,
        accountId: input.accountId,
        categoryId: input.categoryId,
        name: input.name,
        payee: input.payee,
        amount: Math.round(input.amount * 100) / 100,
        currency: 'EUR',
        interval: input.interval,
        nextDueDate: input.nextDueDate,
        endDate: input.endDate || null,
        dayOfMonth: Math.min(28, Math.max(1, day)),
        amountRevisions: sortedRevs,
        splitStrategyOverride: null,
        isShared: true,
        isActive: input.isActive,
        autoAccrual: effectiveAutoAccrual,
      };
      setAllPayments((prev) => [created, ...prev]);

      const cleanInitialPot =
        input.initialPotBalance !== undefined && input.initialPotBalance > 0
          ? Math.round(input.initialPotBalance * 100) / 100
          : 0;

      if (cleanInitialPot > 0 && effectiveAutoAccrual) {
        setAllLedger((prev) => [
          ...prev,
          {
            id: makeId('led'),
            tenantId: activeTenant.id,
            plannedPaymentId: createdId,
            linkedTransactionId: null,
            entryDate: `${referenceMonthKey}-01`,
            entryType: SinkingFundEntryType.INITIAL_CARRYOVER,
            amount: cleanInitialPot,
            reallocationGroupId: null,
            note: 'Startguthaben (Initial Carryover)',
          },
        ]);
      }
    },
    [activeTenant.id, referenceMonthKey]
  );

  const updatePlannedPayment = useCallback(
    (paymentId: string, patch: Partial<PlannedPaymentFormPayload>) => {
      setAllPayments((prev) =>
        prev.map((p) => {
          if (p.id !== paymentId) return p;
          const nextDue = patch.nextDueDate ?? p.nextDueDate;
          const nextInterval = patch.interval ?? p.interval;
          const day = Number(nextDue.split('-')[2] ?? p.dayOfMonth) || p.dayOfMonth;
          const nextRevisions = patch.amountRevisions
            ? [...patch.amountRevisions].sort((a, b) =>
                a.validFrom.localeCompare(b.validFrom)
              )
            : p.amountRevisions;

          return {
            ...p,
            ...patch,
            amount:
              patch.amount !== undefined && patch.amount > 0
                ? Math.round(patch.amount * 100) / 100
                : p.amount,
            endDate: patch.endDate !== undefined ? patch.endDate || null : p.endDate,
            dayOfMonth: Math.min(28, Math.max(1, day)),
            amountRevisions: nextRevisions,
            autoAccrual:
              nextInterval === RecurrenceInterval.MONTHLY
                ? false
                : patch.autoAccrual ?? p.autoAccrual,
          };
        })
      );
    },
    []
  );

  const deletePlannedPayment = useCallback(
    (paymentId: string): {ok: boolean; error?: string} => {
      const potBalance = allLedger
        .filter((e) => e.plannedPaymentId === paymentId)
        .reduce((acc, e) => acc + e.amount, 0);

      if (Math.abs(potBalance) > 0.005) {
        return {
          ok: false,
          error: `Im virtuellen Topf besteht noch ein Saldo von ${potBalance.toFixed(
            2
          )} EUR. Bitte das Restguthaben oder die Überziehung erst unter „Konten & Töpfe“ ausgleichen.`,
        };
      }
      setAllPayments((prev) => prev.filter((p) => p.id !== paymentId));
      return {ok: true};
    },
    [allLedger]
  );

  const bookMonthlyProvision = useCallback(
    (paymentId: string, amount: number) => {
      if (amount <= 0) return;
      const entry: SinkingFundLedgerEntry = {
        id: makeId('led'),
        tenantId: activeTenant.id,
        plannedPaymentId: paymentId,
        linkedTransactionId: null,
        entryDate: `${referenceMonthKey}-01`,
        entryType: SinkingFundEntryType.MONTHLY_PROVISION,
        amount: Math.round(amount * 100) / 100,
        reallocationGroupId: null,
        note: `Monatsrate ${referenceMonthKey}`,
      };
      setAllLedger((prev) => [...prev, entry]);
    },
    [activeTenant.id, referenceMonthKey]
  );

  /**
   * Settle an actual payment from a virtual pot — explicitly allows uncovered pots!
   * Records BOTH the real bank `Transaction` (in Actual Payments journal) AND the full
   * `-invoiceAmount` debit in `SinkingFundLedgerEntry`, allowing the pot balance to go negative.
   */
  const settlePlannedPaymentInvoice = useCallback(
    (
      paymentId: string,
      invoiceAmount: number,
      bookingDate?: string,
      note?: string
    ): {potBalanceBefore: number; potBalanceAfter: number} => {
      const payment = allPayments.find((p) => p.id === paymentId);
      const cleanAmt = Math.round(Math.abs(invoiceAmount) * 100) / 100;
      if (!payment || cleanAmt <= 0) {
        return {potBalanceBefore: 0, potBalanceAfter: 0};
      }

      const currentPot = Math.round(
        allLedger
          .filter((e) => e.plannedPaymentId === paymentId)
          .reduce((acc, e) => acc + e.amount, 0) * 100
      ) / 100;

      const potAfter = Math.round((currentPot - cleanAmt) * 100) / 100;
      const effDate = bookingDate || `${referenceMonthKey}-15`;
      const txId = makeId('tx');
      const purpose =
        note?.trim() ||
        (potAfter < 0
          ? `Topf-Zahlung ${payment.name} (ungedeckt gebucht, Topf ${potAfter.toFixed(2)} €)`
          : `Topf-Abrechnung ${payment.name}`);

      const createdTx: Transaction = {
        id: txId,
        tenantId: activeTenant.id,
        accountId: payment.accountId,
        counterpartyAccountId: null,
        categoryId: payment.categoryId,
        plannedPaymentId: payment.id,
        bookingDate: effDate,
        valueDate: effDate,
        amount: -cleanAmt,
        currency: payment.currency,
        direction: TransactionDirection.OUTFLOW,
        counterpartyName: payment.payee || payment.name,
        counterpartyIban: null,
        remittanceInfo: purpose,
        matchSource: MatchSource.MANUAL,
        matchConfidence: 1.0,
        needsReview: false,
        importHash: `manual-pot-${txId}`,
      };

      const ledgerEntry: SinkingFundLedgerEntry = {
        id: makeId('led'),
        tenantId: activeTenant.id,
        plannedPaymentId: paymentId,
        linkedTransactionId: txId,
        entryDate: effDate,
        entryType: SinkingFundEntryType.INVOICE_SETTLEMENT,
        amount: -cleanAmt,
        reallocationGroupId: null,
        note: purpose,
      };

      setAllTransactions((prev) => [createdTx, ...prev]);
      setAllLedger((prev) => [...prev, ledgerEntry]);

      setAllAccounts((prev) =>
        prev.map((acc) =>
          acc.id === payment.accountId
            ? {
                ...acc,
                currentBalance:
                  Math.round((acc.currentBalance - cleanAmt) * 100) / 100,
              }
            : acc
        )
      );

      setAllPayments((prev) =>
        prev.map((p) =>
          p.id === paymentId
            ? {
                ...p,
                nextDueDate: advanceDueDateIso(p.nextDueDate, p.interval),
                isActive:
                  p.interval === RecurrenceInterval.ONE_TIME ? false : p.isActive,
              }
            : p
        )
      );

      return {potBalanceBefore: currentPot, potBalanceAfter: potAfter};
    },
    [allPayments, allLedger, activeTenant.id, referenceMonthKey]
  );

  const reallocateVirtualPots = useCallback(
    (
      fromPaymentId: string,
      toPaymentId: string,
      amount: number,
      note: string
    ): {ok: boolean; error?: string} => {
      if (fromPaymentId === toPaymentId) {
        return {ok: false, error: 'Quell- und Ziel-Topf müssen unterschiedlich sein.'};
      }
      if (amount <= 0) {
        return {ok: false, error: 'Betrag muss größer als 0,00 EUR sein.'};
      }
      const sourcePot = allLedger
        .filter((e) => e.plannedPaymentId === fromPaymentId)
        .reduce((acc, e) => acc + e.amount, 0);

      if (sourcePot + 0.001 < amount) {
        return {
          ok: false,
          error: `Unzureichendes Guthaben im Quell-Topf (${sourcePot.toFixed(2)} EUR verfügbar).`,
        };
      }

      const groupId = makeId('realloc');
      const cleanAmt = Math.round(amount * 100) / 100;
      const debit: SinkingFundLedgerEntry = {
        id: makeId('led'),
        tenantId: activeTenant.id,
        plannedPaymentId: fromPaymentId,
        linkedTransactionId: null,
        entryDate: `${referenceMonthKey}-15`,
        entryType: SinkingFundEntryType.VIRTUAL_POT_REALLOCATION,
        amount: -cleanAmt,
        reallocationGroupId: groupId,
        note: note || 'Virtuelle Umbuchung (Abgang)',
      };
      const credit: SinkingFundLedgerEntry = {
        id: makeId('led'),
        tenantId: activeTenant.id,
        plannedPaymentId: toPaymentId,
        linkedTransactionId: null,
        entryDate: `${referenceMonthKey}-15`,
        entryType: SinkingFundEntryType.VIRTUAL_POT_REALLOCATION,
        amount: cleanAmt,
        reallocationGroupId: groupId,
        note: note || 'Virtuelle Umbuchung (Zugang / Ausgleich)',
      };
      setAllLedger((prev) => [...prev, debit, credit]);
      return {ok: true};
    },
    [allLedger, activeTenant.id, referenceMonthKey]
  );

  const addManualTransaction = useCallback(
    (input: ManualTransactionPayload) => {
      const absAmt = Math.round(Math.abs(input.amount) * 100) / 100;
      if (absAmt <= 0) return;

      const signedAmount =
        input.direction === TransactionDirection.OUTFLOW
          ? -absAmt
          : input.direction === TransactionDirection.INFLOW
            ? absAmt
            : input.amount;

      const effectivePotId =
        input.direction === TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER
          ? null
          : input.plannedPaymentId;

      const txId = makeId('tx');
      const createdTx: Transaction = {
        id: txId,
        tenantId: activeTenant.id,
        accountId: input.accountId,
        counterpartyAccountId: null,
        categoryId: input.categoryId,
        plannedPaymentId: effectivePotId,
        bookingDate: input.bookingDate,
        valueDate: input.bookingDate,
        amount: signedAmount,
        currency: 'EUR',
        direction: input.direction,
        counterpartyName: input.counterpartyName.trim() || 'Manuelle Buchung',
        counterpartyIban: null,
        remittanceInfo: input.remittanceInfo.trim(),
        matchSource: MatchSource.MANUAL,
        matchConfidence: 1.0,
        needsReview: false,
        importHash: `manual-${txId}`,
      };

      setAllTransactions((prev) => [createdTx, ...prev]);
      setAllAccounts((prev) =>
        prev.map((acc) =>
          acc.id === input.accountId
            ? {
                ...acc,
                currentBalance:
                  Math.round((acc.currentBalance + signedAmount) * 100) / 100,
              }
            : acc
        )
      );

      if (effectivePotId && signedAmount < 0) {
        const linked = allPayments.find((p) => p.id === effectivePotId);
        if (linked && linked.interval !== RecurrenceInterval.MONTHLY) {
          setAllLedger((prev) => [
            ...prev,
            {
              id: makeId('led'),
              tenantId: activeTenant.id,
              plannedPaymentId: linked.id,
              linkedTransactionId: txId,
              entryDate: input.bookingDate,
              entryType: SinkingFundEntryType.INVOICE_SETTLEMENT,
              amount: -absAmt, // Full debit even if pot is uncovered!
              reallocationGroupId: null,
              note:
                input.remittanceInfo.trim() ||
                `Manuelle Zahlung (${createdTx.counterpartyName})`,
            },
          ]);
        }
      }
    },
    [activeTenant.id, allPayments]
  );

  const updateTransactionClassification = useCallback(
    (
      transactionId: string,
      patch: {categoryId?: string | null; plannedPaymentId?: string | null}
    ) => {
      const targetTx = allTransactions.find((t) => t.id === transactionId);
      if (!targetTx) return;

      const nextCategoryId =
        patch.categoryId !== undefined ? patch.categoryId : targetTx.categoryId;
      const nextPaymentId =
        targetTx.direction === TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER
          ? null
          : patch.plannedPaymentId !== undefined
            ? patch.plannedPaymentId
            : targetTx.plannedPaymentId;

      setAllTransactions((prev) =>
        prev.map((tx) =>
          tx.id === transactionId
            ? {
                ...tx,
                categoryId: nextCategoryId,
                plannedPaymentId: nextPaymentId,
                matchSource: MatchSource.MANUAL,
                matchConfidence: 1.0,
              }
            : tx
        )
      );

      // Synchronize 1:1 SinkingFundLedgerEntry for non-monthly pots (allows uncovered negative pot!)
      const linkedPayment = nextPaymentId
        ? allPayments.find((p) => p.id === nextPaymentId) ?? null
        : null;
      const shouldDebitPot = Boolean(
        !targetTx.needsReview &&
          linkedPayment &&
          linkedPayment.interval !== RecurrenceInterval.MONTHLY &&
          targetTx.direction === TransactionDirection.OUTFLOW &&
          targetTx.amount < 0
      );

      setAllLedger((prev) => {
        const withoutExisting = prev.filter(
          (e) => e.linkedTransactionId !== transactionId
        );
        if (!shouldDebitPot || !linkedPayment) {
          return withoutExisting;
        }
        return [
          ...withoutExisting,
          {
            id: makeId('led'),
            tenantId: activeTenant.id,
            plannedPaymentId: linkedPayment.id,
            linkedTransactionId: transactionId,
            entryDate: targetTx.bookingDate,
            entryType: SinkingFundEntryType.INVOICE_SETTLEMENT,
            amount: -Math.round(Math.abs(targetTx.amount) * 100) / 100,
            reallocationGroupId: null,
            note: `Verrechnet mit Ist-Zahlung: ${targetTx.counterpartyName}`,
          },
        ];
      });
    },
    [allTransactions, allPayments, activeTenant.id]
  );

  const commitRowsInternal = useCallback(
    (
      accountId: string,
      rowsToCommit: ImportStagingBatch['rows'],
      needsReviewFlag: boolean,
      settleSinkingFundsImmediately: boolean
    ): {committedCount: number; skippedDuplicates: number} => {
      if (rowsToCommit.length === 0) {
        return {committedCount: 0, skippedDuplicates: 0};
      }

      // Hard deduplication guard at commit time: never double-book an importHash on the same account!
      const existingHashesOnAccount = new Set(
        allTransactions
          .filter((tx) => tx.accountId === accountId)
          .map((tx) => tx.importHash)
      );

      const deduplicatedRows: ImportStagingBatch['rows'] = [];
      let skippedDuplicates = 0;

      for (const r of rowsToCommit) {
        if (existingHashesOnAccount.has(r.importHash)) {
          skippedDuplicates += 1;
          continue;
        }
        existingHashesOnAccount.add(r.importHash);
        deduplicatedRows.push(r);
      }

      if (deduplicatedRows.length === 0) {
        return {committedCount: 0, skippedDuplicates};
      }

      const createdTxs: Transaction[] = deduplicatedRows.map((r) => ({
        id: makeId('tx'),
        tenantId: activeTenant.id,
        accountId,
        counterpartyAccountId: r.counterpartyAccountId,
        categoryId: r.suggestedCategoryId,
        plannedPaymentId:
          r.detectedDirection === TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER
            ? null
            : r.suggestedPlannedPaymentId,
        bookingDate: r.bookingDate,
        valueDate: r.valueDate,
        amount: r.amount,
        currency: r.currency,
        direction: r.detectedDirection,
        counterpartyName: r.counterpartyName,
        counterpartyIban: r.counterpartyIban,
        remittanceInfo: r.remittanceInfo,
        matchSource: r.matchSource,
        matchConfidence: r.matchConfidence,
        needsReview: needsReviewFlag,
        importHash: r.importHash,
      }));

      setAllTransactions((prev) => [...createdTxs, ...prev]);

      const netDelta = createdTxs.reduce((acc, t) => acc + t.amount, 0);
      setAllAccounts((prev) =>
        prev.map((acc) =>
          acc.id === accountId
            ? {
                ...acc,
                currentBalance: Math.round((acc.currentBalance + netDelta) * 100) / 100,
              }
            : acc
        )
      );

      if (settleSinkingFundsImmediately) {
        const newLedgerEntries: SinkingFundLedgerEntry[] = [];
        const settledPaymentIds = new Set<string>();

        for (const tx of createdTxs) {
          if (tx.direction === TransactionDirection.OUTFLOW && tx.plannedPaymentId) {
            const linked = allPayments.find((p) => p.id === tx.plannedPaymentId);
            if (linked && linked.interval !== RecurrenceInterval.MONTHLY) {
              // Full invoice debit even if the pot is uncovered (balance <= 0 or < abs(tx.amount))!
              const fullDebit = -Math.round(Math.abs(tx.amount) * 100) / 100;
              newLedgerEntries.push({
                id: makeId('led'),
                tenantId: activeTenant.id,
                plannedPaymentId: linked.id,
                linkedTransactionId: tx.id,
                entryDate: tx.bookingDate,
                entryType: SinkingFundEntryType.INVOICE_SETTLEMENT,
                amount: fullDebit,
                reallocationGroupId: null,
                note: `CSV-Verrechnung (${tx.counterpartyName})`,
              });
              settledPaymentIds.add(linked.id);
            }
          }
        }

        if (newLedgerEntries.length > 0) {
          setAllLedger((prev) => [...prev, ...newLedgerEntries]);
        }
        if (settledPaymentIds.size > 0) {
          setAllPayments((prev) =>
            prev.map((p) =>
              settledPaymentIds.has(p.id)
                ? {
                    ...p,
                    nextDueDate: advanceDueDateIso(p.nextDueDate, p.interval),
                    isActive:
                      p.interval === RecurrenceInterval.ONE_TIME ? false : p.isActive,
                  }
                : p
            )
          );
        }
      }

      return {committedCount: createdTxs.length, skippedDuplicates};
    },
    [activeTenant.id, allTransactions, allPayments]
  );

  const processDkbCsvImport = useCallback(
    (
      accountId: string,
      filename: string,
      csvText: string,
      commitMode: ImportCommitMode
    ): {importedCount: number; stagedCount: number; duplicateCount: number} => {
      const {parserVariant, rows} = parseAndMatchDkbCsv(
        csvText,
        accountId,
        accounts,
        matchingRules,
        transactions
      );

      const duplicateCount = rows.filter(
        (r) => r.duplicateKind !== DuplicateMatchKind.NONE
      ).length;

      if (commitMode === ImportCommitMode.TWO_STAGE_PREVIEW) {
        setStagingBatch({
          id: makeId('batch'),
          tenantId: activeTenant.id,
          accountId,
          sourceFilename: filename,
          parserVariant,
          createdAt: new Date().toISOString(),
          rows,
        });
        return {importedCount: 0, stagedCount: rows.length, duplicateCount};
      }

      // Direct modes automatically skip BOTH exact hash duplicates and semantic double-bookings!
      const nonDuplicateRows = rows.filter(
        (r) => r.duplicateKind === DuplicateMatchKind.NONE
      );
      const isReviewMode = commitMode === ImportCommitMode.DIRECT_WITH_REVIEW_FLAG;
      const {committedCount} = commitRowsInternal(
        accountId,
        nonDuplicateRows,
        isReviewMode,
        !isReviewMode
      );
      setStagingBatch(null);
      return {importedCount: committedCount, stagedCount: 0, duplicateCount};
    },
    [accounts, matchingRules, transactions, activeTenant.id, commitRowsInternal]
  );

  const loadSampleDkbImport = useCallback(
    (
      accountId: string,
      commitMode: ImportCommitMode
    ): {importedCount: number; stagedCount: number; duplicateCount: number} => {
      const ownPersonal =
        accounts.find((a) => a.accountType === AccountType.PERSONAL_CHECKING)?.iban ??
        'DE12120300009080706011';
      const csv = buildSampleDkbCsv(normalizeIban(ownPersonal));
      return processDkbCsvImport(
        accountId,
        'DKB_Umsatzliste_2026-04.csv',
        csv,
        commitMode
      );
    },
    [accounts, processDkbCsvImport]
  );

  const updateStagingRowSelection = useCallback(
    (rowNumber: number, selected: boolean) => {
      setStagingBatch((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.rowNumber === rowNumber && !r.isDuplicate
              ? {...r, selectedForCommit: selected}
              : r
          ),
        };
      });
    },
    []
  );

  const updateStagingRowOverride = useCallback(
    (
      rowNumber: number,
      patch: {
        suggestedCategoryId?: string | null;
        suggestedPlannedPaymentId?: string | null;
      }
    ) => {
      setStagingBatch((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.rowNumber === rowNumber
              ? {
                  ...r,
                  ...patch,
                  matchSource: MatchSource.MANUAL,
                  matchConfidence: 1.0,
                }
              : r
          ),
        };
      });
    },
    []
  );

  const commitStagingBatch = useCallback((): {
    committedCount: number;
    skippedDuplicates: number;
  } => {
    if (!stagingBatch) return {committedCount: 0, skippedDuplicates: 0};
    const selected = stagingBatch.rows.filter(
      (r) => r.selectedForCommit && !r.isDuplicate
    );
    const skippedInBatch = stagingBatch.rows.filter(
      (r) => r.duplicateKind !== DuplicateMatchKind.NONE && !r.selectedForCommit
    ).length;
    const res = commitRowsInternal(stagingBatch.accountId, selected, false, true);
    setStagingBatch(null);
    return {
      committedCount: res.committedCount,
      skippedDuplicates: skippedInBatch + res.skippedDuplicates,
    };
  }, [stagingBatch, commitRowsInternal]);

  const discardStagingBatch = useCallback(() => {
    setStagingBatch(null);
  }, []);

  const approveTransactionReview = useCallback(
    (transactionId: string) => {
      const tx = allTransactions.find((t) => t.id === transactionId);
      if (!tx || !tx.needsReview) return;

      setAllTransactions((prev) =>
        prev.map((t) => (t.id === transactionId ? {...t, needsReview: false} : t))
      );

      if (tx.direction === TransactionDirection.OUTFLOW && tx.plannedPaymentId) {
        const linked = allPayments.find((p) => p.id === tx.plannedPaymentId);
        const alreadySettled = allLedger.some(
          (e) => e.linkedTransactionId === transactionId
        );
        if (linked && linked.interval !== RecurrenceInterval.MONTHLY && !alreadySettled) {
          const fullDebit = -Math.round(Math.abs(tx.amount) * 100) / 100;
          setAllLedger((prev) => [
            ...prev,
            {
              id: makeId('led'),
              tenantId: activeTenant.id,
              plannedPaymentId: linked.id,
              linkedTransactionId: transactionId,
              entryDate: tx.bookingDate,
              entryType: SinkingFundEntryType.INVOICE_SETTLEMENT,
              amount: fullDebit,
              reallocationGroupId: null,
              note: `Freigabe needs_review (${tx.counterpartyName})`,
            },
          ]);
        }
      }
    },
    [allTransactions, allPayments, allLedger, activeTenant.id]
  );

  const addMatchingRule = useCallback(
    (
      name: string,
      counterpartyPattern: string,
      remittancePattern: string,
      targetCategoryId: string | null,
      targetPlannedPaymentId: string | null
    ) => {
      const nextRule: MatchingRule = {
        id: makeId('rule'),
        tenantId: activeTenant.id,
        name,
        priority: (matchingRules.length + 1) * 10,
        counterpartyPattern: counterpartyPattern.trim() || null,
        remittancePattern: remittancePattern.trim() || null,
        targetCategoryId,
        targetPlannedPaymentId,
        isActive: true,
      };
      setAllRules((prev) => [...prev, nextRule]);
    },
    [activeTenant.id, matchingRules.length]
  );

  const openSetupWizard = useCallback(() => {
    setIsSetupWizardOpen(true);
  }, []);

  const closeSetupWizard = useCallback(() => {
    setIsSetupWizardOpen(false);
  }, []);

  const activateDemoMode = useCallback(() => {
    setTenants(INITIAL_TENANTS);
    setActiveTenantId(TENANT_WEBER_ID);
    setReferenceMonthKey('2026-04');
    setAllowNegativeTransferCompensation(false);
    setAllPersons(INITIAL_PERSONS);
    setAllMonthlyIncomes(INITIAL_MONTHLY_INCOMES);
    setAllAccounts(INITIAL_ACCOUNTS);
    setAllCategories(INITIAL_CATEGORIES);
    setAllPayments(INITIAL_PLANNED_PAYMENTS);
    setAllLedger(INITIAL_LEDGER_ENTRIES);
    setAllRules(INITIAL_RULES);
    setAllTransactions(INITIAL_TRANSACTIONS);
    setStagingBatch(null);
    setInstanceMode('DEMO');
    setIsSetupWizardOpen(false);
  }, []);

  const bootstrapCleanInstance = useCallback(
    (payload: InstanceBootstrapPayload) => {
      const newTenantId = makeId('tenant');
      const createdTenant: Tenant = {
        id: newTenantId,
        name: payload.householdName.trim(),
        slug: payload.slug.trim(),
        defaultCurrency: payload.defaultCurrency.toUpperCase() || 'EUR',
        locale: payload.locale,
        defaultSplitStrategy: payload.defaultSplitStrategy,
      };

      const personRefMap = new Map<string, string>();
      const createdPersons: Person[] = [];
      const createdMonthlyIncomes: PersonMonthlyIncome[] = [];

      for (const pDraft of payload.persons) {
        const pid = makeId('p');
        personRefMap.set(pDraft.clientRef, pid);
        const cleanNet = Math.max(
          0,
          Math.round(pDraft.initialMonthlyNetIncome * 100) / 100
        );
        const cleanDed = Math.max(
          0,
          Math.round(pDraft.defaultPersonalAllowance * 100) / 100
        );

        createdPersons.push({
          id: pid,
          tenantId: newTenantId,
          displayName: pDraft.displayName.trim(),
          roleLabel: pDraft.roleLabel.trim() || 'Haushaltsmitglied',
          isEmployed: pDraft.isEmployed,
          participatesInHouseholdSplit: true,
          defaultPersonalAllowance: cleanDed,
          customSplitWeight: Math.max(0, pDraft.customSplitWeight),
        });

        if (pDraft.isEmployed && cleanNet > 0) {
          createdMonthlyIncomes.push({
            id: makeId('mi'),
            tenantId: newTenantId,
            personId: pid,
            monthKey: payload.startMonthKey,
            actualNetIncome: cleanNet,
            personalFixedAllowance: cleanDed,
            note: 'Startmonat (Ersteinrichtung)',
          });
        }
      }

      const accountRefMap = new Map<string, string>();
      const createdAccounts: Account[] = [];

      for (const aDraft of payload.accounts) {
        const aid = makeId('acc');
        accountRefMap.set(aDraft.clientRef, aid);
        const ownerId = aDraft.ownerPersonRef
          ? personRefMap.get(aDraft.ownerPersonRef) ?? null
          : null;
        const cleanBal = Math.round(aDraft.openingBalance * 100) / 100;

        createdAccounts.push({
          id: aid,
          tenantId: newTenantId,
          ownerPersonId: ownerId,
          name: aDraft.name.trim(),
          institutionName: aDraft.institutionName.trim() || 'Hausbank',
          iban: normalizeIban(aDraft.iban) || aDraft.iban.trim(),
          currency: createdTenant.defaultCurrency,
          accountType: aDraft.accountType,
          currentBalance: cleanBal,
          includeInHouseholdLiquidity:
            aDraft.accountType !== AccountType.PERSONAL_CHECKING,
        });
      }

      const categoryRefMap = new Map<string, string>();
      const createdCategories: BudgetCategory[] = [];

      for (const cDraft of payload.categories) {
        const cid = makeId('cat');
        categoryRefMap.set(cDraft.clientRef, cid);
        createdCategories.push({
          id: cid,
          tenantId: newTenantId,
          code: cDraft.code.trim().toUpperCase() || 'ALLGEMEIN',
          name: cDraft.name.trim(),
          isSharedDefault: cDraft.isSharedDefault,
          monthlyBudgetLimit: cDraft.monthlyBudgetLimit,
        });
      }

      const fallbackAccountId = createdAccounts[0]?.id ?? '';
      const fallbackCategoryId = createdCategories[0]?.id ?? '';

      const createdPayments: PlannedPayment[] = [];
      const createdLedger: SinkingFundLedgerEntry[] = [];

      for (const ppDraft of payload.plannedPayments) {
        const ppId = makeId('pp');
        const resolvedAccountId =
          accountRefMap.get(ppDraft.backingAccountRef) ?? fallbackAccountId;
        const resolvedCategoryId =
          categoryRefMap.get(ppDraft.categoryRef) ?? fallbackCategoryId;
        const day = Number(ppDraft.nextDueDate.split('-')[2] ?? 1) || 1;
        const effectiveAutoAccrual =
          ppDraft.interval === RecurrenceInterval.MONTHLY
            ? false
            : ppDraft.autoAccrual;

        createdPayments.push({
          id: ppId,
          tenantId: newTenantId,
          accountId: resolvedAccountId,
          categoryId: resolvedCategoryId,
          name: ppDraft.name.trim(),
          payee: ppDraft.payee.trim() || ppDraft.name.trim(),
          amount: Math.round(ppDraft.amount * 100) / 100,
          currency: createdTenant.defaultCurrency,
          interval: ppDraft.interval,
          nextDueDate: ppDraft.nextDueDate,
          endDate: ppDraft.endDate || null,
          dayOfMonth: Math.min(28, Math.max(1, day)),
          amountRevisions: [],
          splitStrategyOverride: null,
          isActive: true,
          isShared: true,
          autoAccrual: effectiveAutoAccrual,
        });

        const cleanInitialPot = Math.max(
          0,
          Math.round(ppDraft.initialPotBalance * 100) / 100
        );
        if (cleanInitialPot > 0 && effectiveAutoAccrual) {
          createdLedger.push({
            id: makeId('led'),
            tenantId: newTenantId,
            plannedPaymentId: ppId,
            linkedTransactionId: null,
            entryDate: `${payload.startMonthKey}-01`,
            entryType: SinkingFundEntryType.INITIAL_CARRYOVER,
            amount: cleanInitialPot,
            reallocationGroupId: null,
            note: 'Startguthaben (Ersteinrichtung)',
          });
        }
      }

      // Completely wipe all sample/demo tenants, transactions, rules, and demo pots
      setTenants([createdTenant]);
      setActiveTenantId(newTenantId);
      setReferenceMonthKey(payload.startMonthKey);
      setAllowNegativeTransferCompensation(false);
      setAllPersons(createdPersons);
      setAllMonthlyIncomes(createdMonthlyIncomes);
      setAllAccounts(createdAccounts);
      setAllCategories(createdCategories);
      setAllPayments(createdPayments);
      setAllLedger(createdLedger);
      setAllRules([]);
      setAllTransactions([]);
      setStagingBatch(null);
      setInstanceMode('PRODUCTION');
      setIsSetupWizardOpen(false);

      // Best-effort sync to FastAPI backend when running in connected full-stack mode
      void equiBudgetApi.bootstrapInstanceOnServer(payload).catch(() => {
        // Offline / standalone preview mode falls back cleanly to localStorage state
      });
    },
    []
  );

  const value = useMemo<HouseholdStoreValue>(
    () => ({
      instanceMode,
      isSetupWizardOpen,
      openSetupWizard,
      closeSetupWizard,
      bootstrapCleanInstance,
      activateDemoMode,
      tenants,
      activeTenant,
      setActiveTenantId,
      updateTenantStrategy,
      referenceMonthKey,
      setReferenceMonthKey,
      allowNegativeTransferCompensation,
      setAllowNegativeTransferCompensation,
      persons,
      monthlyIncomes,
      accounts,
      categories,
      plannedPayments,
      ledgerEntries,
      matchingRules,
      transactions,
      stagingBatch,
      updatePersonMaster,
      upsertPersonMonthlyIncome,
      clearPersonMonthlyIncome,
      addPerson,
      addAccount,
      addCategory,
      addPlannedPayment,
      updatePlannedPayment,
      deletePlannedPayment,
      bookMonthlyProvision,
      settlePlannedPaymentInvoice,
      reallocateVirtualPots,
      addManualTransaction,
      updateTransactionClassification,
      processDkbCsvImport,
      loadSampleDkbImport,
      updateStagingRowSelection,
      updateStagingRowOverride,
      commitStagingBatch,
      discardStagingBatch,
      approveTransactionReview,
      addMatchingRule,
    }),
    [
      instanceMode,
      isSetupWizardOpen,
      openSetupWizard,
      closeSetupWizard,
      bootstrapCleanInstance,
      activateDemoMode,
      tenants,
      activeTenant,
      updateTenantStrategy,
      referenceMonthKey,
      allowNegativeTransferCompensation,
      persons,
      monthlyIncomes,
      accounts,
      categories,
      plannedPayments,
      ledgerEntries,
      matchingRules,
      transactions,
      stagingBatch,
      updatePersonMaster,
      upsertPersonMonthlyIncome,
      clearPersonMonthlyIncome,
      addPerson,
      addAccount,
      addCategory,
      addPlannedPayment,
      updatePlannedPayment,
      deletePlannedPayment,
      bookMonthlyProvision,
      settlePlannedPaymentInvoice,
      reallocateVirtualPots,
      addManualTransaction,
      updateTransactionClassification,
      processDkbCsvImport,
      loadSampleDkbImport,
      updateStagingRowSelection,
      updateStagingRowOverride,
      commitStagingBatch,
      discardStagingBatch,
      approveTransactionReview,
      addMatchingRule,
    ]
  );

  return (
    <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
  );
};

export function useHouseholdStore(): HouseholdStoreValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) {
    throw new Error('useHouseholdStore must be used inside HouseholdProvider');
  }
  return ctx;
}
