import React, {useMemo, useState} from 'react';
import {Check, Plus, Trash2} from 'lucide-react';
import {useI18n} from '../i18n/I18nContext';
import {useHouseholdStore} from '../store/useHouseholdStore';
import {
  AccountType,
  ImportCommitMode,
  RecurrenceInterval,
  SplitStrategy,
} from '../domain/types';

interface WizardPersonRow {
  clientRef: string;
  displayName: string;
  roleLabel: string;
  isEmployed: boolean;
  initialMonthlyNetIncome: string;
  defaultPersonalAllowance: string;
  customSplitWeight: string;
}

interface WizardAccountRow {
  clientRef: string;
  ownerPersonRef: string;
  name: string;
  institutionName: string;
  iban: string;
  accountType: AccountType;
  openingBalance: string;
}

interface WizardCategoryRow {
  clientRef: string;
  selected: boolean;
  code: string;
  name: string;
}

interface WizardPaymentRow {
  clientRef: string;
  backingAccountRef: string;
  categoryRef: string;
  name: string;
  payee: string;
  amount: string;
  interval: RecurrenceInterval;
  nextDueDate: string;
  endDate: string;
  autoAccrual: boolean;
  initialPotBalance: string;
}

function slugifyHousehold(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length >= 2 ? normalized.slice(0, 64) : 'mein-haushalt';
}

function parseDecimalInput(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function getDefaultStartMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function addMonthsIsoDate(monthKey: string, addMonths: number, day = 15): string {
  const [y, m] = monthKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1 + addMonths, Math.min(28, day));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

function computePreviewMonthlyRate(
  amount: number,
  initialPotBalance: number,
  interval: RecurrenceInterval,
  autoAccrual: boolean,
  startMonthKey: string,
  nextDueDate: string
): number {
  if (amount <= 0) return 0;
  if (interval === RecurrenceInterval.MONTHLY || !autoAccrual) {
    return interval === RecurrenceInterval.MONTHLY ? amount : 0;
  }
  const remainingTarget = Math.max(0, amount - Math.max(0, initialPotBalance));
  if (remainingTarget <= 0) return 0;

  const [sy, sm] = startMonthKey.split('-').map(Number);
  const [dy, dm] = nextDueDate.split('-').map(Number);
  if (!sy || !sm || !dy || !dm) return remainingTarget;

  const monthsDiff = (dy - sy) * 12 + (dm - sm);
  const divisor = Math.max(1, monthsDiff);
  return Math.round((remainingTarget / divisor) * 100) / 100;
}

export const InitialSetupWizard: React.FC = () => {
  const {locale, setLocale, formatMoney, t} = useI18n();
  const {
    instanceMode,
    isSetupWizardOpen,
    closeSetupWizard,
    bootstrapCleanInstance,
    activateDemoMode,
  } = useHouseholdStore();

  const defaultMonth = useMemo(() => getDefaultStartMonth(), []);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Step 1: Household & Defaults
  const [householdName, setHouseholdName] = useState<string>('Mein Haushalt');
  const [customSlug, setCustomSlug] = useState<string>('');
  const [startMonthKey, setStartMonthKey] = useState<string>(defaultMonth);
  const [defaultCurrency, setDefaultCurrency] = useState<string>('EUR');
  const [defaultStrategy, setDefaultStrategy] = useState<SplitStrategy>(
    SplitStrategy.EQUAL_REMAINING
  );
  const [defaultCommitMode, setDefaultCommitMode] = useState<ImportCommitMode>(
    ImportCommitMode.TWO_STAGE_PREVIEW
  );

  // Step 2: Household Members (Persons)
  const [persons, setPersons] = useState<WizardPersonRow[]>([
    {
      clientRef: 'p-1',
      displayName: '',
      roleLabel: 'Hauptverdiener / Partner 1',
      isEmployed: true,
      initialMonthlyNetIncome: '',
      defaultPersonalAllowance: '0',
      customSplitWeight: '50',
    },
    {
      clientRef: 'p-2',
      displayName: '',
      roleLabel: 'Partner 2',
      isEmployed: true,
      initialMonthlyNetIncome: '',
      defaultPersonalAllowance: '0',
      customSplitWeight: '50',
    },
  ]);

  // Step 3: Physical Bank Accounts & Real Balances
  const [accounts, setAccounts] = useState<WizardAccountRow[]>([
    {
      clientRef: 'acc-1',
      ownerPersonRef: '',
      name: 'Gemeinschaftskonto',
      institutionName: 'DKB',
      iban: '',
      accountType: AccountType.JOINT_CHECKING,
      openingBalance: '0,00',
    },
    {
      clientRef: 'acc-2',
      ownerPersonRef: '',
      name: 'Tagesgeld Rücklagen',
      institutionName: 'DKB',
      iban: '',
      accountType: AccountType.SAVINGS_RESERVE,
      openingBalance: '0,00',
    },
  ]);

  // Step 4: Expense Categories
  const [categories, setCategories] = useState<WizardCategoryRow[]>([
    {clientRef: 'cat-1', selected: true, code: 'WOHNEN', name: 'Wohnen & Nebenkosten'},
    {
      clientRef: 'cat-2',
      selected: true,
      code: 'VERSICHERUNG',
      name: 'Versicherungen & Vorsorge',
    },
    {clientRef: 'cat-3', selected: true, code: 'MOBILITAET', name: 'Mobilität & KFZ'},
    {
      clientRef: 'cat-4',
      selected: true,
      code: 'ALLTAG',
      name: 'Lebensmittel & Haushalt',
    },
    {clientRef: 'cat-5', selected: true, code: 'MEDIEN', name: 'Medien, Internet & GEZ'},
    {
      clientRef: 'cat-6',
      selected: true,
      code: 'RUECKLAGEN',
      name: 'Urlaub & Anschaffungen',
    },
  ]);

  // Step 5: Planned Payments & Virtual Sinking Funds (with Startguthaben!)
  const [payments, setPayments] = useState<WizardPaymentRow[]>([
    {
      clientRef: 'pp-1',
      backingAccountRef: 'acc-1',
      categoryRef: 'cat-2',
      name: '',
      payee: '',
      amount: '',
      interval: RecurrenceInterval.ANNUAL,
      nextDueDate: addMonthsIsoDate(defaultMonth, 6, 1),
      endDate: '',
      autoAccrual: true,
      initialPotBalance: '0,00',
    },
  ]);

  const effectiveSlug = customSlug.trim()
    ? slugifyHousehold(customSlug)
    : slugifyHousehold(householdName);

  const selectedCategories = useMemo(
    () => categories.filter((c) => c.selected && c.name.trim().length > 0),
    [categories]
  );

  // Live Reconciliation of Physical Account Opening Balances vs. Assigned Pot Opening Balances (Startguthaben)
  const accountPreviewReconciliation = useMemo(() => {
    return accounts
      .filter((a) => a.name.trim().length > 0)
      .map((acc) => {
        const physicalBalance = parseDecimalInput(acc.openingBalance);
        const assignedPotStartBalance = payments
          .filter(
            (pp) =>
              pp.name.trim().length > 0 &&
              pp.backingAccountRef === acc.clientRef &&
              pp.interval !== RecurrenceInterval.MONTHLY &&
              pp.autoAccrual
          )
          .reduce(
            (sum, pp) => sum + Math.max(0, parseDecimalInput(pp.initialPotBalance)),
            0
          );
        const freeLiquidity =
          Math.round((physicalBalance - assignedPotStartBalance) * 100) / 100;
        return {
          clientRef: acc.clientRef,
          name: acc.name.trim(),
          physicalBalance,
          assignedPotStartBalance:
            Math.round(assignedPotStartBalance * 100) / 100,
          freeLiquidity,
          isFullyBacked: freeLiquidity >= 0,
        };
      });
  }, [accounts, payments]);

  if (!isSetupWizardOpen) return null;

  const makeNextRef = (prefix: string) =>
    `${prefix}-${Math.random().toString(36).slice(2, 7)}`;

  const handleAddPersonRow = () => {
    setPersons((prev) => [
      ...prev,
      {
        clientRef: makeNextRef('p'),
        displayName: '',
        roleLabel: 'Haushaltsmitglied',
        isEmployed: true,
        initialMonthlyNetIncome: '',
        defaultPersonalAllowance: '0',
        customSplitWeight: '50',
      },
    ]);
  };

  const handleAddAccountRow = () => {
    setAccounts((prev) => [
      ...prev,
      {
        clientRef: makeNextRef('acc'),
        ownerPersonRef: '',
        name: '',
        institutionName: '',
        iban: '',
        accountType: AccountType.JOINT_CHECKING,
        openingBalance: '0,00',
      },
    ]);
  };

  const handleAddCategoryRow = () => {
    setCategories((prev) => [
      ...prev,
      {
        clientRef: makeNextRef('cat'),
        selected: true,
        code: 'EIGEN',
        name: '',
      },
    ]);
  };

  const handleAddPaymentRow = (intervalType: RecurrenceInterval) => {
    const defaultAcc = accounts.find((a) => a.name.trim())?.clientRef ?? 'acc-1';
    const defaultCat = selectedCategories[0]?.clientRef ?? 'cat-1';
    setPayments((prev) => [
      ...prev,
      {
        clientRef: makeNextRef('pp'),
        backingAccountRef: defaultAcc,
        categoryRef: defaultCat,
        name: '',
        payee: '',
        amount: '',
        interval: intervalType,
        nextDueDate:
          intervalType === RecurrenceInterval.MONTHLY
            ? `${startMonthKey}-01`
            : addMonthsIsoDate(startMonthKey, 6, 1),
        endDate: '',
        autoAccrual: intervalType !== RecurrenceInterval.MONTHLY,
        initialPotBalance: '0,00',
      },
    ]);
  };

  const validateCurrentStep = (targetStep: number): boolean => {
    setValidationError(null);
    if (step === 1 && targetStep > 1) {
      if (!householdName.trim()) {
        setValidationError('Bitte gib in Schritt 1 einen Haushaltsnamen ein.');
        return false;
      }
      if (!/^\d{4}-\d{2}$/.test(startMonthKey)) {
        setValidationError('Bitte wähle einen gültigen Startmonat (YYYY-MM).');
        return false;
      }
    }
    if (step === 2 && targetStep > 2) {
      const validPersons = persons.filter((p) => p.displayName.trim().length > 0);
      if (validPersons.length === 0) {
        setValidationError(
          'Bitte lege mindestens eine Person mit Namen im Haushalt an.'
        );
        return false;
      }
    }
    if (step === 3 && targetStep > 3) {
      const validAccounts = accounts.filter((a) => a.name.trim().length > 0);
      if (validAccounts.length === 0) {
        setValidationError(
          'Bitte lege mindestens ein physisches Bankkonto (z.B. Gemeinschaftskonto) an.'
        );
        return false;
      }
    }
    if (step === 4 && targetStep > 4) {
      if (selectedCategories.length === 0) {
        setValidationError(
          'Bitte wähle oder erstelle mindestens eine aktive Kostenkategorie.'
        );
        return false;
      }
    }
    return true;
  };

  const handleGoToStep = (nextStep: 1 | 2 | 3 | 4 | 5) => {
    if (nextStep > step && !validateCurrentStep(nextStep)) {
      return;
    }
    setValidationError(null);
    setStep(nextStep);
  };

  const handleFinishCleanSetup = () => {
    setValidationError(null);

    const validPersons = persons.filter((p) => p.displayName.trim().length > 0);
    if (validPersons.length === 0) {
      setValidationError('Mindestens eine Person mit Namen ist erforderlich.');
      setStep(2);
      return;
    }

    const validAccounts = accounts.filter((a) => a.name.trim().length > 0);
    if (validAccounts.length === 0) {
      setValidationError('Mindestens ein physisches Bankkonto ist erforderlich.');
      setStep(3);
      return;
    }

    if (selectedCategories.length === 0) {
      setValidationError('Mindestens eine Kostenkategorie ist erforderlich.');
      setStep(4);
      return;
    }

    const nonEmptyPayments = payments.filter((pp) => pp.name.trim().length > 0);
    for (const pp of nonEmptyPayments) {
      const amt = parseDecimalInput(pp.amount);
      if (amt <= 0) {
        setValidationError(
          `Bitte gib für „${pp.name.trim()}“ einen Zahlbetrag größer 0,00 EUR an (oder entferne die Zeile).`
        );
        return;
      }
    }

    bootstrapCleanInstance({
      householdName: householdName.trim(),
      slug: effectiveSlug,
      defaultCurrency: defaultCurrency.trim().toUpperCase() || 'EUR',
      locale,
      defaultSplitStrategy: defaultStrategy,
      defaultImportCommitMode: defaultCommitMode,
      startMonthKey,
      persons: validPersons.map((p) => ({
        clientRef: p.clientRef,
        displayName: p.displayName.trim(),
        roleLabel: p.roleLabel.trim() || 'Haushaltsmitglied',
        isEmployed: p.isEmployed,
        initialMonthlyNetIncome: Math.max(
          0,
          parseDecimalInput(p.initialMonthlyNetIncome)
        ),
        defaultPersonalAllowance: Math.max(
          0,
          parseDecimalInput(p.defaultPersonalAllowance)
        ),
        customSplitWeight: Math.max(0, parseDecimalInput(p.customSplitWeight)),
      })),
      accounts: validAccounts.map((a) => ({
        clientRef: a.clientRef,
        ownerPersonRef: a.ownerPersonRef || null,
        name: a.name.trim(),
        institutionName: a.institutionName.trim() || 'Hausbank',
        iban: a.iban.trim(),
        accountType: a.accountType,
        openingBalance: parseDecimalInput(a.openingBalance),
      })),
      categories: selectedCategories.map((c) => ({
        clientRef: c.clientRef,
        code: c.code.trim().toUpperCase() || 'KATEGORIE',
        name: c.name.trim(),
        isSharedDefault: true,
        monthlyBudgetLimit: null,
      })),
      plannedPayments: nonEmptyPayments.map((pp) => {
        const isMonthly = pp.interval === RecurrenceInterval.MONTHLY;
        const autoAccrual = isMonthly ? false : pp.autoAccrual;
        return {
          clientRef: pp.clientRef,
          backingAccountRef:
            pp.backingAccountRef || validAccounts[0].clientRef,
          categoryRef: pp.categoryRef || selectedCategories[0].clientRef,
          name: pp.name.trim(),
          payee: pp.payee.trim() || pp.name.trim(),
          amount: Math.max(0.01, parseDecimalInput(pp.amount)),
          interval: pp.interval,
          nextDueDate: pp.nextDueDate || `${startMonthKey}-01`,
          endDate: pp.endDate.trim() || null,
          autoAccrual,
          initialPotBalance: autoAccrual
            ? Math.max(0, parseDecimalInput(pp.initialPotBalance))
            : 0,
        };
      }),
    });
  };

  const stepDefinitions: Array<{num: 1 | 2 | 3 | 4 | 5; label: string}> = [
    {num: 1, label: '1. Haushalt & Basis'},
    {num: 2, label: '2. Personen & Netto'},
    {num: 3, label: '3. Konten & Salden'},
    {num: 4, label: '4. Kategorien'},
    {num: 5, label: '5. Töpfe & Startguthaben'},
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={t('setup.title')}
    >
      <div className="w-full max-w-5xl rounded-md bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              {t('setup.title')}
            </h2>
            <p className="text-[11px] text-slate-300 mt-0.5">
              {t('setup.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {instanceMode !== 'UNINITIALIZED' && (
              <button
                type="button"
                onClick={closeSetupWizard}
                className="px-2.5 py-1 text-xs rounded border border-slate-600 text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                Abbrechen
              </button>
            )}
          </div>
        </div>

        {/* Stepper Bar */}
        <div className="bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-5 py-2 flex flex-wrap items-center gap-2 text-xs">
          {stepDefinitions.map((s) => {
            const isCurrent = step === s.num;
            const isDone = step > s.num;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => handleGoToStep(s.num)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                  isCurrent
                    ? 'bg-teal-700 border-teal-700 text-white font-semibold'
                    : isDone
                      ? 'bg-white dark:bg-slate-900 border-teal-600/50 text-teal-800 dark:text-teal-300 font-medium'
                      : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {isDone && <Check className="w-3 h-3" />}
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Step Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          {validationError && (
            <div className="p-2.5 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 font-medium">
              {validationError}
            </div>
          )}

          {/* =============================================================== */}
          {/* STEP 1: HOUSEHOLD & DEFAULTS                                    */}
          {/* =============================================================== */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Schritt 1: Eigener Haushalts-Mandant & Standardregeln
                </h3>
                <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                  Legt einen vollständig isolierten Produktiv-Mandanten ohne jegliche Testbuchungen an.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Haushaltsname
                  </label>
                  <input
                    type="text"
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    placeholder="z.B. Haushalt Müller"
                    className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Technischer Mandanten-Slug
                  </label>
                  <input
                    type="text"
                    value={customSlug}
                    onChange={(e) => setCustomSlug(e.target.value)}
                    placeholder={effectiveSlug}
                    className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Start- / Eröffnungsmonat
                  </label>
                  <input
                    type="month"
                    value={startMonthKey}
                    onChange={(e) =>
                      e.target.value && setStartMonthKey(e.target.value)
                    }
                    className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Standard-Aufteilungsmodell
                  </label>
                  <select
                    value={defaultStrategy}
                    onChange={(e) =>
                      setDefaultStrategy(e.target.value as SplitStrategy)
                    }
                    className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                  >
                    <option value={SplitStrategy.EQUAL_REMAINING}>
                      {t('strategy.EQUAL_REMAINING')}
                    </option>
                    <option value={SplitStrategy.PROPORTIONAL}>
                      {t('strategy.PROPORTIONAL')}
                    </option>
                    <option value={SplitStrategy.FIFTY_FIFTY}>
                      {t('strategy.FIFTY_FIFTY')}
                    </option>
                    <option value={SplitStrategy.CUSTOM_WEIGHT}>
                      {t('strategy.CUSTOM_WEIGHT')}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Standard-CSV-Importmodus
                  </label>
                  <select
                    value={defaultCommitMode}
                    onChange={(e) =>
                      setDefaultCommitMode(e.target.value as ImportCommitMode)
                    }
                    className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                  >
                    <option value={ImportCommitMode.TWO_STAGE_PREVIEW}>
                      {t('imports.mode.TWO_STAGE_PREVIEW')}
                    </option>
                    <option value={ImportCommitMode.DIRECT_WITH_REVIEW_FLAG}>
                      {t('imports.mode.DIRECT_WITH_REVIEW_FLAG')}
                    </option>
                    <option value={ImportCommitMode.DIRECT_AUTO_COMMIT}>
                      {t('imports.mode.DIRECT_AUTO_COMMIT')}
                    </option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Währung
                    </label>
                    <input
                      type="text"
                      maxLength={3}
                      value={defaultCurrency}
                      onChange={(e) =>
                        setDefaultCurrency(e.target.value.toUpperCase())
                      }
                      className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Sprache / Format
                    </label>
                    <select
                      value={locale}
                      onChange={(e) =>
                        setLocale(e.target.value as 'de-DE' | 'en-US')
                      }
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                    >
                      <option value="de-DE">Deutsch (1.234,56 €)</option>
                      <option value="en-US">English (1,234.56 €)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* STEP 2: PERSONS & INITIAL MONTHLY NET INCOMES                   */}
          {/* =============================================================== */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Schritt 2: Personen im Haushalt & reales Netto für {startMonthKey}
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                    Auch nicht erwerbstätige Mitglieder (z.B. Kinder) können als Stammdaten miterfasst werden. Einkommen werden später jeden Monat frisch eingetragen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddPersonRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-teal-600/70 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 font-medium cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Person hinzufügen</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      <th className="py-2 px-2.5 text-left">Name</th>
                      <th className="py-2 px-2.5 text-left">Rolle / Hinweis</th>
                      <th className="py-2 px-2 text-center">Erwerbstätig</th>
                      <th className="py-2 px-2.5 text-right">
                        Netto ({startMonthKey}) EUR
                      </th>
                      <th className="py-2 px-2.5 text-right">
                        Pers. Vorabzug EUR
                      </th>
                      <th className="py-2 px-2 text-right">Quote %</th>
                      <th className="py-2 px-2 text-center">Aktion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {persons.map((p, idx) => (
                      <tr key={p.clientRef}>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder={`z.B. Person ${idx + 1}`}
                            value={p.displayName}
                            onChange={(e) =>
                              setPersons((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {...row, displayName: e.target.value}
                                    : row
                                )
                              )
                            }
                            className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="Vollzeit / Teilzeit / Kind"
                            value={p.roleLabel}
                            onChange={(e) =>
                              setPersons((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {...row, roleLabel: e.target.value}
                                    : row
                                )
                              )
                            }
                            className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            checked={p.isEmployed}
                            onChange={(e) =>
                              setPersons((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {...row, isEmployed: e.target.checked}
                                    : row
                                )
                              )
                            }
                            className="rounded border-slate-300 text-teal-700 cursor-pointer"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            disabled={!p.isEmployed}
                            placeholder="z.B. 3200,00"
                            value={p.initialMonthlyNetIncome}
                            onChange={(e) =>
                              setPersons((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {
                                        ...row,
                                        initialMonthlyNetIncome: e.target.value,
                                      }
                                    : row
                                )
                              )
                            }
                            className="w-full px-2 py-1 text-right font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded disabled:opacity-40"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="0,00"
                            value={p.defaultPersonalAllowance}
                            onChange={(e) =>
                              setPersons((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {
                                        ...row,
                                        defaultPersonalAllowance: e.target.value,
                                      }
                                    : row
                                )
                              )
                            }
                            className="w-full px-2 py-1 text-right font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={p.customSplitWeight}
                            onChange={(e) =>
                              setPersons((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {...row, customSplitWeight: e.target.value}
                                    : row
                                )
                              )
                            }
                            className="w-16 ml-auto block px-2 py-1 text-right font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </td>
                        <td className="p-2 text-center">
                          {persons.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setPersons((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* STEP 3: PHYSICAL BANK ACCOUNTS & REAL BALANCES                  */}
          {/* =============================================================== */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Schritt 3: Physische Bankkonten & aktueller realer Kontostand
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                    Trage hier den echten aktuellen Kontostand deiner Bankkonten ein. Im Schritt 5 kannst du Teile dieses realen Guthabens als Startguthaben auf deine virtuellen Töpfe verteilen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddAccountRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-teal-600/70 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 font-medium cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Bankkonto hinzufügen</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      <th className="py-2 px-2.5 text-left">Kontobezeichnung</th>
                      <th className="py-2 px-2 text-left">Bank</th>
                      <th className="py-2 px-2.5 text-left">
                        IBAN (für Transfer-Erkennung)
                      </th>
                      <th className="py-2 px-2 text-left">Kontotyp</th>
                      <th className="py-2 px-2 text-left">Inhaber (optional)</th>
                      <th className="py-2 px-2.5 text-right">
                        Realer Kontostand (EUR)
                      </th>
                      <th className="py-2 px-2 text-center">Aktion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {accounts.map((acc, idx) => (
                      <tr key={acc.clientRef}>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="z.B. DKB Gemeinschaftskonto"
                            value={acc.name}
                            onChange={(e) =>
                              setAccounts((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? {...row, name: e.target.value} : row
                                )
                              )
                            }
                            className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="DKB"
                            value={acc.institutionName}
                            onChange={(e) =>
                              setAccounts((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {...row, institutionName: e.target.value}
                                    : row
                                )
                              )
                            }
                            className="w-28 px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="DE..."
                            value={acc.iban}
                            onChange={(e) =>
                              setAccounts((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? {...row, iban: e.target.value} : row
                                )
                              )
                            }
                            className="w-full px-2 py-1 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={acc.accountType}
                            onChange={(e) =>
                              setAccounts((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {
                                        ...row,
                                        accountType: e.target.value as AccountType,
                                      }
                                    : row
                                )
                              )
                            }
                            className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          >
                            <option value={AccountType.JOINT_CHECKING}>
                              Gemeinschaftskonto
                            </option>
                            <option value={AccountType.SAVINGS_RESERVE}>
                              Tagesgeld / Rücklagen
                            </option>
                            <option value={AccountType.PERSONAL_CHECKING}>
                              Einzelkonto (Privat)
                            </option>
                          </select>
                        </td>
                        <td className="p-2">
                          <select
                            value={acc.ownerPersonRef}
                            onChange={(e) =>
                              setAccounts((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {...row, ownerPersonRef: e.target.value}
                                    : row
                                )
                              )
                            }
                            className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          >
                            <option value="">Gemeinsam / Haushalt</option>
                            {persons
                              .filter((p) => p.displayName.trim())
                              .map((p) => (
                                <option key={p.clientRef} value={p.clientRef}>
                                  {p.displayName}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            placeholder="z.B. 4500,00"
                            value={acc.openingBalance}
                            onChange={(e) =>
                              setAccounts((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {...row, openingBalance: e.target.value}
                                    : row
                                )
                              )
                            }
                            className="w-32 ml-auto block px-2 py-1 text-right font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                          />
                        </td>
                        <td className="p-2 text-center">
                          {accounts.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setAccounts((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* STEP 4: BUDGET CATEGORIES                                       */}
          {/* =============================================================== */}
          {step === 4 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Schritt 4: Eigene Kostenkategorien
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                    Wähle benötigte Kategorien aus, passe Bezeichnungen an oder ergänze eigene Kategorien.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddCategoryRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-teal-600/70 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 font-medium cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Eigene Kategorie hinzufügen</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {categories.map((cat, idx) => (
                  <div
                    key={cat.clientRef}
                    className={`flex items-center gap-2 p-2 rounded border ${
                      cat.selected
                        ? 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={cat.selected}
                      onChange={(e) =>
                        setCategories((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {...row, selected: e.target.checked}
                              : row
                          )
                        )
                      }
                      className="rounded border-slate-300 text-teal-700 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={cat.code}
                      onChange={(e) =>
                        setCategories((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? {...row, code: e.target.value.toUpperCase()}
                              : row
                          )
                        )
                      }
                      placeholder="CODE"
                      className="w-28 px-2 py-1 font-mono text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    />
                    <input
                      type="text"
                      value={cat.name}
                      onChange={(e) =>
                        setCategories((prev) =>
                          prev.map((row, i) =>
                            i === idx ? {...row, name: e.target.value} : row
                          )
                        )
                      }
                      placeholder="Kategoriename"
                      className="flex-1 px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* STEP 5: PLANNED PAYMENTS & POT OPENING BALANCES (STARTGUTHABEN) */}
          {/* =============================================================== */}
          {step === 5 && (
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Schritt 5: Geplante Zahlungen, Töpfe & Startguthaben zuweisen
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                    Hier kannst du bereits vorhandene Rücklagen direkt als{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Startguthaben
                    </span>{' '}
                    in deine virtuellen Töpfe legen. Die monatliche Ansparrate reduziert sich sofort auf den Restbetrag. Du kannst Zahlungen auch später jederzeit ergänzen.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAddPaymentRow(RecurrenceInterval.ANNUAL)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-teal-700 hover:bg-teal-800 text-white font-medium cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Anspartopf (+ Startguthaben)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleAddPaymentRow(RecurrenceInterval.MONTHLY)
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Monatliche Fixzahlung</span>
                  </button>
                </div>
              </div>

              {/* Live Account Backing Reconciliation Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {accountPreviewReconciliation.map((rec) => (
                  <div
                    key={rec.clientRef}
                    className={`p-2.5 rounded border ${
                      rec.isFullyBacked
                        ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950'
                        : 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30'
                    }`}
                  >
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {rec.name}
                    </div>
                    <div className="mt-1 space-y-0.5 font-mono tabular-nums text-[11px]">
                      <div className="flex justify-between text-slate-600 dark:text-slate-400">
                        <span>Realer Kontostand:</span>
                        <span>{formatMoney(rec.physicalBalance)}</span>
                      </div>
                      <div className="flex justify-between text-teal-800 dark:text-teal-300">
                        <span>− Σ Topf-Startguthaben:</span>
                        <span>{formatMoney(rec.assignedPotStartBalance)}</span>
                      </div>
                      <div
                        className={`pt-0.5 border-t border-slate-200 dark:border-slate-800 flex justify-between font-semibold ${
                          rec.isFullyBacked
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        <span>= Freie Liquidität:</span>
                        <span>{formatMoney(rec.freeLiquidity)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Planned Payments & Pot Opening Balance Table */}
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      <th className="py-2 px-2 text-left">
                        Bezeichnung / Empfänger
                      </th>
                      <th className="py-2 px-2 text-left">Konto & Kategorie</th>
                      <th className="py-2 px-2 text-left">Turnus</th>
                      <th className="py-2 px-2 text-left">Nächste Fälligkeit</th>
                      <th className="py-2 px-2 text-right">
                        Zahlbetrag (EUR)
                      </th>
                      <th className="py-2 px-2 text-right bg-teal-50/70 dark:bg-teal-950/30 text-teal-900 dark:text-teal-200">
                        Startguthaben Topf (EUR)
                      </th>
                      <th className="py-2 px-2 text-right">
                        Monatsrate (Vorschau)
                      </th>
                      <th className="py-2 px-1.5 text-center">Weg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {payments.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="py-6 text-center text-slate-500 dark:text-slate-400"
                        >
                          Noch keine geplanten Zahlungen eingetragen — du kannst direkt mit einer leeren Tabelle starten oder oben Zeilen hinzufügen.
                        </td>
                      </tr>
                    ) : (
                      payments.map((pp, idx) => {
                        const isMonthly =
                          pp.interval === RecurrenceInterval.MONTHLY;
                        const amtVal = parseDecimalInput(pp.amount);
                        const startPotVal = isMonthly
                          ? 0
                          : Math.max(0, parseDecimalInput(pp.initialPotBalance));
                        const previewRate = computePreviewMonthlyRate(
                          amtVal,
                          startPotVal,
                          pp.interval,
                          pp.autoAccrual,
                          startMonthKey,
                          pp.nextDueDate
                        );

                        return (
                          <tr key={pp.clientRef}>
                            <td className="p-2 space-y-1 min-w-[180px]">
                              <input
                                type="text"
                                placeholder="z.B. KFZ-Versicherung / Miete"
                                value={pp.name}
                                onChange={(e) =>
                                  setPayments((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? {...row, name: e.target.value}
                                        : row
                                    )
                                  )
                                }
                                className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                              />
                              <input
                                type="text"
                                placeholder="Empfänger (optional)"
                                value={pp.payee}
                                onChange={(e) =>
                                  setPayments((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? {...row, payee: e.target.value}
                                        : row
                                    )
                                  )
                                }
                                className="w-full px-2 py-0.5 text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded"
                              />
                            </td>

                            <td className="p-2 space-y-1 min-w-[165px]">
                              <select
                                value={pp.backingAccountRef}
                                onChange={(e) =>
                                  setPayments((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? {
                                            ...row,
                                            backingAccountRef: e.target.value,
                                          }
                                        : row
                                    )
                                  )
                                }
                                className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                              >
                                {accounts
                                  .filter((a) => a.name.trim())
                                  .map((a) => (
                                    <option key={a.clientRef} value={a.clientRef}>
                                      {a.name}
                                    </option>
                                  ))}
                              </select>
                              <select
                                value={pp.categoryRef}
                                onChange={(e) =>
                                  setPayments((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? {...row, categoryRef: e.target.value}
                                        : row
                                    )
                                  )
                                }
                                className="w-full px-2 py-0.5 text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded"
                              >
                                {selectedCategories.map((c) => (
                                  <option key={c.clientRef} value={c.clientRef}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="p-2">
                              <select
                                value={pp.interval}
                                onChange={(e) => {
                                  const nextInt = e.target
                                    .value as RecurrenceInterval;
                                  setPayments((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? {
                                            ...row,
                                            interval: nextInt,
                                            autoAccrual:
                                              nextInt !==
                                              RecurrenceInterval.MONTHLY,
                                          }
                                        : row
                                    )
                                  );
                                }}
                                className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                              >
                                <option value={RecurrenceInterval.MONTHLY}>
                                  {t('interval.MONTHLY')}
                                </option>
                                <option value={RecurrenceInterval.QUARTERLY}>
                                  {t('interval.QUARTERLY')}
                                </option>
                                <option value={RecurrenceInterval.SEMI_ANNUAL}>
                                  {t('interval.SEMI_ANNUAL')}
                                </option>
                                <option value={RecurrenceInterval.ANNUAL}>
                                  {t('interval.ANNUAL')}
                                </option>
                                <option value={RecurrenceInterval.BIENNIAL}>
                                  {t('interval.BIENNIAL')}
                                </option>
                                <option value={RecurrenceInterval.ONE_TIME}>
                                  {t('interval.ONE_TIME')}
                                </option>
                              </select>
                            </td>

                            <td className="p-2">
                              <input
                                type="date"
                                value={pp.nextDueDate}
                                onChange={(e) =>
                                  setPayments((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? {...row, nextDueDate: e.target.value}
                                        : row
                                    )
                                  )
                                }
                                className="px-2 py-1 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                              />
                            </td>

                            <td className="p-2">
                              <input
                                type="text"
                                placeholder="z.B. 720,00"
                                value={pp.amount}
                                onChange={(e) =>
                                  setPayments((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? {...row, amount: e.target.value}
                                        : row
                                    )
                                  )
                                }
                                className="w-24 ml-auto block px-2 py-1 text-right font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                              />
                            </td>

                            <td className="p-2 bg-teal-50/40 dark:bg-teal-950/20">
                              {isMonthly ? (
                                <span className="block text-right text-[11px] text-slate-400">
                                  Direkt monatl.
                                </span>
                              ) : (
                                <input
                                  type="text"
                                  placeholder="0,00"
                                  value={pp.initialPotBalance}
                                  onChange={(e) =>
                                    setPayments((prev) =>
                                      prev.map((row, i) =>
                                        i === idx
                                          ? {
                                              ...row,
                                              initialPotBalance: e.target.value,
                                            }
                                          : row
                                      )
                                    )
                                  }
                                  className="w-28 ml-auto block px-2 py-1 text-right font-mono font-semibold bg-white dark:bg-slate-900 border border-teal-500/70 rounded text-teal-900 dark:text-teal-200"
                                />
                              )}
                            </td>

                            <td className="p-2 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="font-semibold text-slate-800 dark:text-slate-200">
                                {formatMoney(previewRate)}
                              </div>
                              {!isMonthly && startPotVal > 0 && amtVal > 0 && (
                                <div className="text-[10px] text-teal-700 dark:text-teal-400">
                                  Restziel {formatMoney(Math.max(0, amtVal - startPotVal))}
                                </div>
                              )}
                            </td>

                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setPayments((prev) =>
                                    prev.filter((_, i) => i !== idx)
                                  )
                                }
                                className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Wizard Footer */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <button
              type="button"
              onClick={activateDemoMode}
              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 underline decoration-dotted underline-offset-4 cursor-pointer"
            >
              Vorerst mit Demo-Testdaten starten (kann jederzeit unter Stammdaten gelöscht werden)
            </button>
          </div>

          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() =>
                  setStep((prev) => Math.max(1, prev - 1) as 1 | 2 | 3 | 4 | 5)
                }
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Zurück
              </button>
            )}

            {step < 5 ? (
              <button
                type="button"
                onClick={() =>
                  handleGoToStep((step + 1) as 1 | 2 | 3 | 4 | 5)
                }
                className="px-4 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold cursor-pointer"
              >
                Weiter zu Schritt {step + 1}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinishCleanSetup}
                className="px-4 py-1.5 rounded bg-teal-700 hover:bg-teal-800 text-white font-semibold cursor-pointer"
              >
                Saubere Instanz ohne Testdaten starten
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
