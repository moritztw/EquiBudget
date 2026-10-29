import React, {useMemo, useRef, useState} from 'react';
import {Plus, Search, Upload} from 'lucide-react';
import {useI18n} from '../i18n/I18nContext';
import {useHouseholdStore} from '../store/useHouseholdStore';
import {
  DuplicateMatchKind,
  ImportCommitMode,
  MatchSource,
  SinkingFundEntryType,
  TransactionDirection,
} from '../domain/types';
import {buildTwelveMonthScheduleMatrix} from '../domain/calculators';

type WorkspaceSubTab = 'journal' | 'csv' | 'rules';
type PotFilterMode = 'ALL' | 'LINKED' | 'OVERDRAWN_POT' | 'UNLINKED';
type DirectionFilterMode =
  | 'ALL'
  | 'OUTFLOW'
  | 'INFLOW'
  | 'TRANSFER'
  | 'NEEDS_REVIEW';

export const StatementImportView: React.FC = () => {
  const {t, formatMoney, formatDate} = useI18n();
  const {
    accounts,
    categories,
    plannedPayments,
    ledgerEntries,
    matchingRules,
    transactions,
    stagingBatch,
    referenceMonthKey,
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
  } = useHouseholdStore();

  const [activeSubTab, setActiveSubTab] = useState<WorkspaceSubTab>('journal');

  // Journal Filters
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [accountFilter, setAccountFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [potFilter, setPotFilter] = useState<PotFilterMode>('ALL');
  const [directionFilter, setDirectionFilter] =
    useState<DirectionFilterMode>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Inline Manual Actual Payment Form
  const [isManualFormOpen, setIsManualFormOpen] = useState<boolean>(false);
  const [manualAccountId, setManualAccountId] = useState<string>(
    () => accounts[0]?.id ?? ''
  );
  const [manualDate, setManualDate] = useState<string>(
    () => `${referenceMonthKey}-15`
  );
  const [manualDirection, setManualDirection] = useState<TransactionDirection>(
    TransactionDirection.OUTFLOW
  );
  const [manualCounterparty, setManualCounterparty] = useState<string>('');
  const [manualPurpose, setManualPurpose] = useState<string>('');
  const [manualAmount, setManualAmount] = useState<string>('');
  const [manualCategoryId, setManualCategoryId] = useState<string>('');
  const [manualPaymentId, setManualPaymentId] = useState<string>('');
  const [journalFeedback, setJournalFeedback] = useState<string | null>(null);

  // CSV Import State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [targetAccountId, setTargetAccountId] = useState<string>(
    () => accounts[0]?.id ?? ''
  );
  const [commitMode, setCommitMode] = useState<ImportCommitMode>(
    ImportCommitMode.TWO_STAGE_PREVIEW
  );
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Regex Rule Form State
  const [ruleName, setRuleName] = useState<string>('');
  const [cpRegex, setCpRegex] = useState<string>('');
  const [remRegex, setRemRegex] = useState<string>('');
  const [ruleCatId, setRuleCatId] = useState<string>('');
  const [rulePaymentId, setRulePaymentId] = useState<string>('');

  // Evaluate all Planned Payments & Virtual Sinking Fund Balances
  const matrix = useMemo(
    () =>
      buildTwelveMonthScheduleMatrix(
        plannedPayments,
        ledgerEntries,
        categories,
        accounts,
        referenceMonthKey
      ),
    [plannedPayments, ledgerEntries, categories, accounts, referenceMonthKey]
  );

  const evaluatedByPaymentId = useMemo(
    () => new Map(matrix.allEvaluatedRows.map((row) => [row.payment.id, row])),
    [matrix.allEvaluatedRows]
  );

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  const ledgerByTxId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of ledgerEntries) {
      if (
        entry.linkedTransactionId &&
        entry.entryType === SinkingFundEntryType.INVOICE_SETTLEMENT
      ) {
        map.set(entry.linkedTransactionId, entry.amount);
      }
    }
    return map;
  }, [ledgerEntries]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>([referenceMonthKey]);
    for (const tx of transactions) {
      if (tx.bookingDate.length >= 7) {
        set.add(tx.bookingDate.slice(0, 7));
      }
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [transactions, referenceMonthKey]);

  const overdrawnPotsSummary = useMemo(() => {
    const overdrawn = matrix.allEvaluatedRows.filter((r) => r.isOverdrawnPot);
    const totalDeficit = overdrawn.reduce(
      (acc, r) => acc + r.potOverdraftAmount,
      0
    );
    return {count: overdrawn.length, totalDeficit};
  }, [matrix.allEvaluatedRows]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions
      .filter((tx) => {
        if (monthFilter !== 'ALL' && !tx.bookingDate.startsWith(monthFilter)) {
          return false;
        }
        if (accountFilter !== 'ALL' && tx.accountId !== accountFilter) {
          return false;
        }
        if (categoryFilter === 'NONE' && tx.categoryId !== null) {
          return false;
        }
        if (
          categoryFilter !== 'ALL' &&
          categoryFilter !== 'NONE' &&
          tx.categoryId !== categoryFilter
        ) {
          return false;
        }
        if (potFilter === 'LINKED' && !tx.plannedPaymentId) {
          return false;
        }
        if (potFilter === 'UNLINKED' && tx.plannedPaymentId !== null) {
          return false;
        }
        if (potFilter === 'OVERDRAWN_POT') {
          if (!tx.plannedPaymentId) return false;
          const ev = evaluatedByPaymentId.get(tx.plannedPaymentId);
          if (!ev || !ev.isOverdrawnPot) return false;
        }
        if (
          directionFilter === 'OUTFLOW' &&
          tx.direction !== TransactionDirection.OUTFLOW
        ) {
          return false;
        }
        if (
          directionFilter === 'INFLOW' &&
          tx.direction !== TransactionDirection.INFLOW
        ) {
          return false;
        }
        if (
          directionFilter === 'TRANSFER' &&
          tx.direction !== TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER
        ) {
          return false;
        }
        if (directionFilter === 'NEEDS_REVIEW' && !tx.needsReview) {
          return false;
        }
        if (q) {
          const accName = accountMap.get(tx.accountId)?.name ?? '';
          const catName = tx.categoryId ? categoryMap.get(tx.categoryId) ?? '' : '';
          const potName = tx.plannedPaymentId
            ? evaluatedByPaymentId.get(tx.plannedPaymentId)?.payment.name ?? ''
            : '';
          const haystack =
            `${tx.counterpartyName} ${tx.remittanceInfo} ${tx.counterpartyIban ?? ''} ${accName} ${catName} ${potName}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
  }, [
    transactions,
    monthFilter,
    accountFilter,
    categoryFilter,
    potFilter,
    directionFilter,
    searchQuery,
    evaluatedByPaymentId,
    accountMap,
    categoryMap,
  ]);

  const journalKpis = useMemo(() => {
    let realOutflows = 0;
    let outflowCount = 0;
    let realInflows = 0;
    let inflowCount = 0;
    let potWithdrawals = 0;
    let potTxCount = 0;
    let reviewCount = 0;

    for (const tx of filteredTransactions) {
      if (tx.needsReview) reviewCount += 1;
      if (tx.direction === TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER) {
        continue;
      }
      if (tx.amount < 0) {
        realOutflows += Math.abs(tx.amount);
        outflowCount += 1;
      } else if (tx.amount > 0) {
        realInflows += tx.amount;
        inflowCount += 1;
      }
      const linkedDebit = ledgerByTxId.get(tx.id);
      if (linkedDebit !== undefined && linkedDebit < 0) {
        potWithdrawals += Math.abs(linkedDebit);
        potTxCount += 1;
      }
    }

    return {
      realOutflows,
      outflowCount,
      realInflows,
      inflowCount,
      potWithdrawals,
      potTxCount,
      reviewCount,
    };
  }, [filteredTransactions, ledgerByTxId]);

  const stagingMetrics = useMemo(() => {
    if (!stagingBatch) return null;
    let selected = 0;
    let exactCount = 0;
    let semanticCount = 0;
    let uncoveredPotDebits = 0;

    for (const row of stagingBatch.rows) {
      if (row.selectedForCommit) selected += 1;
      if (row.duplicateKind === DuplicateMatchKind.EXACT_HASH) exactCount += 1;
      if (row.duplicateKind === DuplicateMatchKind.SEMANTIC_MATCH) {
        semanticCount += 1;
      }
      if (
        row.selectedForCommit &&
        row.amount < 0 &&
        row.suggestedPlannedPaymentId
      ) {
        const ev = evaluatedByPaymentId.get(row.suggestedPlannedPaymentId);
        if (ev && ev.isSinkingFund && ev.potBalance + row.amount < -0.005) {
          uncoveredPotDebits += 1;
        }
      }
    }
    return {
      total: stagingBatch.rows.length,
      selected,
      exactCount,
      semanticCount,
      uncoveredPotDebits,
    };
  }, [stagingBatch, evaluatedByPaymentId]);

  // Live preview of pot coverage inside Manual Payment Form
  const manualPotPreview = useMemo(() => {
    if (!manualPaymentId) return null;
    const ev = evaluatedByPaymentId.get(manualPaymentId);
    if (!ev || !ev.isSinkingFund) return null;
    const parsedAmt = Math.abs(Number(manualAmount.replace(',', '.')) || 0);
    const afterBalance =
      manualDirection === TransactionDirection.OUTFLOW
        ? Math.round((ev.potBalance - parsedAmt) * 100) / 100
        : ev.potBalance;
    return {
      potName: ev.payment.name,
      currentBalance: ev.potBalance,
      afterBalance,
      willOverdraw:
        manualDirection === TransactionDirection.OUTFLOW &&
        parsedAmt > 0 &&
        afterBalance < 0,
    };
  }, [manualPaymentId, manualAmount, manualDirection, evaluatedByPaymentId]);

  const handleSubmitManualTx = (e: React.FormEvent) => {
    e.preventDefault();
    const accId = manualAccountId || accounts[0]?.id;
    const parsedAmt = Math.abs(Number(manualAmount.replace(',', '.')));
    if (!accId || !Number.isFinite(parsedAmt) || parsedAmt <= 0) return;
    if (!manualCounterparty.trim()) return;

    addManualTransaction({
      accountId: accId,
      bookingDate: manualDate,
      amount: parsedAmt,
      direction: manualDirection,
      counterpartyName: manualCounterparty.trim(),
      remittanceInfo:
        manualPurpose.trim() || 'Manuell erfasste Ist-Zahlung',
      categoryId: manualCategoryId || null,
      plannedPaymentId: manualPaymentId || null,
    });

    const overdrawNote =
      manualPotPreview && manualPotPreview.willOverdraw
        ? ` — Topf „${manualPotPreview.potName}“ wurde planmäßig auf ${formatMoney(manualPotPreview.afterBalance)} überzogen.`
        : '';

    setJournalFeedback(
      `Ist-Zahlung (${formatMoney(manualDirection === TransactionDirection.OUTFLOW ? -parsedAmt : parsedAmt)} · ${manualCounterparty.trim()}) gebucht${overdrawNote}`
    );
    setManualCounterparty('');
    setManualPurpose('');
    setManualAmount('');
    setIsManualFormOpen(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetAccountId) return;
    const text = await file.text();
    const res = processDkbCsvImport(targetAccountId, file.name, text, commitMode);
    if (commitMode === ImportCommitMode.TWO_STAGE_PREVIEW) {
      setStatusBanner(
        `${res.stagedCount} DKB-Zeilen geladen — davon ${res.duplicateCount} potenzielle oder exakte Duplikate automatisch erkannt und geschützt.`
      );
    } else {
      setStatusBanner(
        `${res.importedCount} neue DKB-Buchungen ins Journal übernommen (${res.duplicateCount} Duplikate automatisch übersprungen).`
      );
      setActiveSubTab('journal');
    }
    e.target.value = '';
  };

  const handleLoadSample = () => {
    const accId = targetAccountId || accounts[0]?.id;
    if (!accId) return;
    const res = loadSampleDkbImport(accId, commitMode);
    if (commitMode === ImportCommitMode.TWO_STAGE_PREVIEW) {
      setStatusBanner(
        `DKB-Beispielauszug (${res.stagedCount} gebuchte Zeilen; vorgemerkte Zahlung ausgefiltert): ${res.duplicateCount} Duplikate erkannt (1× Exakter Hash Warmmiete gesperrt, 1× Semantischer Abgleich HUK-COBURG ±4 Tage vorab abgewählt) sowie ungedeckte GEZ-Topf-Abbuchung (−55,08 € bei 18,36 € Topf-Stand) bereitgestellt.`
      );
      setActiveSubTab('csv');
    } else {
      setStatusBanner(
        `${res.importedCount} neue Buchungen direkt übernommen (${res.duplicateCount} Duplikate automatisch übersprungen).`
      );
      setActiveSubTab('journal');
    }
  };

  const handleCommitBatch = () => {
    const res = commitStagingBatch();
    const skippedNote =
      res.skippedDuplicates > 0
        ? ` (${res.skippedDuplicates} exakte Hash-Duplikate gesperrt)`
        : '';
    setJournalFeedback(
      `${res.committedCount} Ist-Zahlungen verbindlich ins Buchungsjournal übernommen und mit den virtuellen Töpfen verrechnet${skippedNote}.`
    );
    setStatusBanner(null);
    setActiveSubTab('journal');
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) return;
    addMatchingRule(
      ruleName.trim(),
      cpRegex,
      remRegex,
      ruleCatId || null,
      rulePaymentId || null
    );
    setRuleName('');
    setCpRegex('');
    setRemRegex('');
  };

  const formatSourceLabel = (source: MatchSource): string => {
    switch (source) {
      case MatchSource.REGEX_RULE:
        return 'CSV · Regex';
      case MatchSource.OWN_IBAN_TRANSFER:
        return 'Eigene IBAN';
      case MatchSource.MANUAL:
        return 'Manuell / Topf';
      default:
        return 'CSV · Offen';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header + Sub-Navigation */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t('imports.title')}
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('imports.subtitle')}
          </p>
        </div>

        <div className="inline-flex rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setActiveSubTab('journal')}
            className={`px-3 py-1.5 font-medium transition-colors cursor-pointer ${
              activeSubTab === 'journal'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t('imports.tabJournal')} ({transactions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('csv')}
            className={`px-3 py-1.5 font-medium border-l border-slate-300 dark:border-slate-700 transition-colors cursor-pointer ${
              activeSubTab === 'csv'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t('imports.tabCsvImport')}
            {stagingBatch ? ` [${stagingBatch.rows.length}]` : ''}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('rules')}
            className={`px-3 py-1.5 font-medium border-l border-slate-300 dark:border-slate-700 transition-colors cursor-pointer ${
              activeSubTab === 'rules'
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t('imports.tabRules')} ({matchingRules.length})
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SUB-TAB 1: BUCHUNGSJOURNAL (IST-ZAHLUNGEN)                             */}
      {/* ===================================================================== */}
      {activeSubTab === 'journal' && (
        <div className="space-y-3.5">
          {/* 4-Column ERP KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Reale Ausgaben (aktiver Filter, ohne Kontotransfers)
              </div>
              <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatMoney(-journalKpis.realOutflows)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {journalKpis.outflowCount} gebuchte Lastschriften / Ausgaben
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Reale Eingänge (exkl. eigene IBAN-Umbuchung)
              </div>
              <div className="mt-1 text-base font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatMoney(journalKpis.realInflows)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {journalKpis.inflowCount} reale Gutschriften im Zeitraum
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Topf-Entnahmen & ungedeckte Überziehungen
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-base font-semibold font-mono tabular-nums text-teal-800 dark:text-teal-300">
                  {formatMoney(-journalKpis.potWithdrawals)}
                </span>
                {overdrawnPotsSummary.count > 0 && (
                  <span className="text-xs font-mono tabular-nums font-semibold text-rose-700 dark:text-rose-400">
                    {overdrawnPotsSummary.count} Topf überzogen (
                    {formatMoney(-overdrawnPotsSummary.totalDeficit)})
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {journalKpis.potTxCount} Ist-Zahlung(en) direkt gegen Sinking Funds gebucht
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Prüfbedarf & aktiver Duplikat-Schutz
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span
                  className={`text-base font-semibold font-mono tabular-nums ${
                    journalKpis.reviewCount > 0
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {journalKpis.reviewCount} offen
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  {transactions.length} Hash-Referenzen
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Abgleich über Kanonischen Hash + ±4-Tage-Semantik
              </div>
            </div>
          </div>

          {journalFeedback && (
            <div className="px-3 py-2 rounded border border-teal-300 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40 text-xs text-teal-900 dark:text-teal-200 flex items-center justify-between gap-2">
              <span>{journalFeedback}</span>
              <button
                type="button"
                onClick={() => setJournalFeedback(null)}
                className="text-[11px] underline cursor-pointer"
              >
                Ausblenden
              </button>
            </div>
          )}

          {/* Dense ERP Filter & Action Bar */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 items-end">
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Buchungsmonat
                </label>
                <select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">Alle Monate</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Bankkonto
                </label>
                <select
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">Alle Konten</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Kategorie
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">Alle Kategorien</option>
                  <option value="NONE">— Ohne Kategorie —</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Topf- / Plan-Bezug
                </label>
                <select
                  value={potFilter}
                  onChange={(e) => setPotFilter(e.target.value as PotFilterMode)}
                  className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">Alle Zuordnungen</option>
                  <option value="LINKED">Mit Plan-/Topf-Bezug</option>
                  <option value="OVERDRAWN_POT">
                    Überzogener Topf (Saldo &lt; 0 €)
                  </option>
                  <option value="UNLINKED">Ohne Plan-Verknüpfung</option>
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Richtung / Status
                </label>
                <select
                  value={directionFilter}
                  onChange={(e) =>
                    setDirectionFilter(e.target.value as DirectionFilterMode)
                  }
                  className="w-full px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">Alle Buchungsarten</option>
                  <option value="OUTFLOW">Nur Ausgaben (−)</option>
                  <option value="INFLOW">Nur Eingänge (+)</option>
                  <option value="TRANSFER">Eigene Kontotransfers</option>
                  <option value="NEEDS_REVIEW">Prüfbedarf offen</option>
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Volltextsuche
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Empfänger, Zweck..."
                    className="w-full pl-7 pr-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Zeige <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{filteredTransactions.length}</span> von{' '}
                <span className="font-mono">{transactions.length}</span> tatsächlichen Zahlungen. Topf-Zuordnungen können direkt in der Zeile geändert werden (auch bei ungedeckten Töpfen).
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsManualFormOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {isManualFormOpen
                      ? 'Manuelle Buchung schließen'
                      : 'Ist-Zahlung manuell erfassen'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('csv')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-teal-700 hover:bg-teal-800 text-white cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>DKB CSV-Import & Duplikat-Check</span>
                </button>
              </div>
            </div>

            {/* Collapsible Manual Actual Payment Entry (allows uncovered pot debits!) */}
            {isManualFormOpen && (
              <form
                onSubmit={handleSubmitManualTx}
                className="mt-2 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs"
              >
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Manuelle Ist-Zahlung buchen (inkl. direkter Topf-Entnahme auch ohne volle Deckung)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 items-end">
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Konto
                    </label>
                    <select
                      value={manualAccountId}
                      onChange={(e) => setManualAccountId(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    >
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Buchungsdatum
                    </label>
                    <input
                      type="date"
                      value={manualDate}
                      onChange={(e) => setManualDate(e.target.value)}
                      required
                      className="w-full px-2 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Art
                    </label>
                    <select
                      value={manualDirection}
                      onChange={(e) =>
                        setManualDirection(e.target.value as TransactionDirection)
                      }
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    >
                      <option value={TransactionDirection.OUTFLOW}>
                        Ausgabe / Lastschrift (−)
                      </option>
                      <option value={TransactionDirection.INFLOW}>
                        Eingang / Gutschrift (+)
                      </option>
                    </select>
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Betrag (EUR)
                    </label>
                    <input
                      type="text"
                      placeholder="z.B. 340,00"
                      value={manualAmount}
                      onChange={(e) => setManualAmount(e.target.value)}
                      required
                      className="w-full px-2 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    />
                  </div>

                  <div className="lg:col-span-4">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Empfänger / Gegenpartei
                    </label>
                    <input
                      type="text"
                      placeholder="z.B. Tierarztpraxis Dr. König / Stadtwerke"
                      value={manualCounterparty}
                      onChange={(e) => setManualCounterparty(e.target.value)}
                      required
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    />
                  </div>

                  <div className="lg:col-span-4">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Verwendungszweck
                    </label>
                    <input
                      type="text"
                      placeholder="Rechnungsnummer / Buchungstext"
                      value={manualPurpose}
                      onChange={(e) => setManualPurpose(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    />
                  </div>

                  <div className="lg:col-span-3">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Kategorie
                    </label>
                    <select
                      value={manualCategoryId}
                      onChange={(e) => setManualCategoryId(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    >
                      <option value="">— Keine Kategorie —</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="lg:col-span-3">
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Geplante Zahlung / Virtueller Topf
                    </label>
                    <select
                      value={manualPaymentId}
                      onChange={(e) => setManualPaymentId(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                    >
                      <option value="">— Ohne Topf-Verknüpfung —</option>
                      {matrix.allEvaluatedRows.map((ev) => (
                        <option key={ev.payment.id} value={ev.payment.id}>
                          {ev.payment.name}
                          {ev.isSinkingFund
                            ? ` (Topf: ${formatMoney(ev.potBalance)})`
                            : ` (Monatl.: ${formatMoney(ev.effectiveInvoiceAmount)})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="lg:col-span-2 flex justify-end">
                    <button
                      type="submit"
                      className="w-full py-1.5 px-3 rounded bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 font-medium cursor-pointer"
                    >
                      Zahlung buchen
                    </button>
                  </div>
                </div>

                {manualPotPreview && (
                  <div
                    className={`px-2.5 py-1.5 rounded border text-[11px] font-mono ${
                      manualPotPreview.willOverdraw
                        ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    Topf „{manualPotPreview.potName}“ aktuell:{' '}
                    {formatMoney(manualPotPreview.currentBalance)} → Saldo nach
                    Buchung: {formatMoney(manualPotPreview.afterBalance)}
                    {manualPotPreview.willOverdraw
                      ? ' (Topf nicht gedeckt — Buchung zulässig, Topf geht ins Minus und erhöht automatisch die künftige Aufholrate).'
                      : ''}
                  </div>
                )}
              </form>
            )}
          </section>

          {/* Full-Width ERP Actual Payments Table */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <th className="py-2 px-2.5 text-left whitespace-nowrap">
                      Buchung
                    </th>
                    <th className="py-2 px-2.5 text-left whitespace-nowrap">
                      Konto
                    </th>
                    <th className="py-2 px-2.5 text-left">
                      Gegenpartei / Verwendungszweck
                    </th>
                    <th className="py-2 px-2.5 text-left">
                      Kategorie (Direktzuordnung)
                    </th>
                    <th className="py-2 px-2.5 text-left">
                      Geplante Zahlung / Topf
                    </th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">
                      Soll / Topf-Saldo
                    </th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">
                      Ist-Betrag
                    </th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap">
                      Herkunft & Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 px-4 text-center text-xs text-slate-500 dark:text-slate-400"
                      >
                        Keine tatsächlichen Zahlungen für die gewählte Filterkombination vorhanden.
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => {
                      const isTransfer =
                        tx.direction ===
                        TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER;
                      const account = accountMap.get(tx.accountId);
                      const linkedEval = tx.plannedPaymentId
                        ? evaluatedByPaymentId.get(tx.plannedPaymentId)
                        : undefined;
                      const potDebit = ledgerByTxId.get(tx.id);

                      return (
                        <tr
                          key={tx.id}
                          className={
                            tx.needsReview
                              ? 'bg-amber-50/40 dark:bg-amber-950/15 hover:bg-amber-50/70 dark:hover:bg-amber-950/25'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="py-1.5 px-2.5 font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                            {formatDate(tx.bookingDate)}
                          </td>

                          <td className="py-1.5 px-2.5 whitespace-nowrap text-slate-700 dark:text-slate-300">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              {account?.name ?? tx.accountId}
                            </div>
                          </td>

                          <td className="py-1.5 px-2.5">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {tx.counterpartyName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[290px]">
                              {tx.remittanceInfo}
                            </div>
                          </td>

                          <td className="py-1.5 px-2.5">
                            {isTransfer ? (
                              <span className="text-[11px] font-medium text-teal-800 dark:text-teal-300">
                                {t('imports.physicalTransfer')}
                              </span>
                            ) : (
                              <select
                                value={tx.categoryId ?? ''}
                                onChange={(e) =>
                                  updateTransactionClassification(tx.id, {
                                    categoryId: e.target.value || null,
                                  })
                                }
                                className="w-full max-w-[180px] px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                              >
                                <option value="">— Offen —</option>
                                {categories.map((cat) => (
                                  <option key={cat.id} value={cat.id}>
                                    {cat.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          <td className="py-1.5 px-2.5">
                            {isTransfer ? (
                              <span className="text-[11px] text-slate-400">
                                Kein Topf berührt
                              </span>
                            ) : (
                              <select
                                value={tx.plannedPaymentId ?? ''}
                                onChange={(e) =>
                                  updateTransactionClassification(tx.id, {
                                    plannedPaymentId: e.target.value || null,
                                  })
                                }
                                className="w-full max-w-[230px] px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                              >
                                <option value="">— Keine Verknüpfung —</option>
                                {matrix.allEvaluatedRows.map((ev) => (
                                  <option key={ev.payment.id} value={ev.payment.id}>
                                    {ev.payment.name}
                                    {ev.isSinkingFund
                                      ? ` [Topf ${formatMoney(ev.potBalance)}]`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Soll / Topf-Deckung */}
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                            {isTransfer ? (
                              <span className="text-[11px] text-slate-400">
                                Neutral
                              </span>
                            ) : linkedEval ? (
                              linkedEval.isSinkingFund ? (
                                <div>
                                  <div
                                    className={
                                      linkedEval.isOverdrawnPot
                                        ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                        : 'text-teal-800 dark:text-teal-300 font-medium'
                                    }
                                  >
                                    Topf: {formatMoney(linkedEval.potBalance)}
                                  </div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                    {linkedEval.isOverdrawnPot
                                      ? 'Überzogen (ungedeckt gebucht)'
                                      : potDebit !== undefined
                                        ? `Topf-Buchung ${formatMoney(potDebit)}`
                                        : `Ziel ${formatMoney(linkedEval.effectiveInvoiceAmount)}`}
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="text-slate-700 dark:text-slate-300">
                                    Plan: {formatMoney(-linkedEval.effectiveInvoiceAmount)}
                                  </div>
                                  {Math.abs(
                                    Math.abs(tx.amount) -
                                      linkedEval.effectiveInvoiceAmount
                                  ) > 0.009 && (
                                    <div className="text-[10px] text-amber-700 dark:text-amber-400">
                                      Abw.:{' '}
                                      {formatMoney(
                                        tx.amount + linkedEval.effectiveInvoiceAmount
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            ) : (
                              <span className="text-[11px] font-sans text-slate-400">
                                Freie Buchung
                              </span>
                            )}
                          </td>

                          {/* Ist-Betrag */}
                          <td
                            className={`py-1.5 px-2.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                              isTransfer
                                ? 'text-teal-800 dark:text-teal-300'
                                : tx.amount >= 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {formatMoney(tx.amount)}
                          </td>

                          {/* Herkunft & Review */}
                          <td className="py-1.5 px-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-2">
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                {formatSourceLabel(tx.matchSource)}
                              </span>
                              {tx.needsReview ? (
                                <button
                                  type="button"
                                  onClick={() => approveTransactionReview(tx.id)}
                                  className="px-2 py-0.5 text-[11px] font-medium rounded border border-amber-500 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 cursor-pointer"
                                >
                                  {t('imports.approveReview')}
                                </button>
                              ) : (
                                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                                  Gebucht
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 2: DKB CSV-IMPORT & ZWEISTUFIGER DUPLIKAT-ABGLEICH            */}
      {/* ===================================================================== */}
      {activeSubTab === 'csv' && (
        <div className="space-y-4">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
              <div className="lg:col-span-3">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t('imports.targetAccount')}
                </label>
                <select
                  value={targetAccountId}
                  onChange={(e) => setTargetAccountId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.iban})
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-5">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t('imports.commitMode')}
                </label>
                <select
                  value={commitMode}
                  onChange={(e) => setCommitMode(e.target.value as ImportCommitMode)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
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

              <div className="lg:col-span-4 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-teal-700 hover:bg-teal-800 text-white transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t('imports.uploadCsv')}</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="px-3 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {t('imports.loadSampleDkb')}
                </button>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-slate-600 dark:text-slate-400">
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Stufe A · Exakter Hash-Schutz:
                </span>{' '}
                Überlappende CSV-Zeiträume werden über Konto, Buchungstag, Betrag, IBAN, Zweck und Tages-Index erkannt und hart gesperrt.
              </div>
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Stufe B · Semantischer ±4-Tage-Abgleich:
                </span>{' '}
                Bereits manuell oder aus einem Topf abgerechnete Zahlungen mit identischem Betrag (±4 Kalendertage) werden automatisch abgewählt.
              </div>
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Ungedeckte Töpfe erlaubt:
                </span>{' '}
                Reale Abbuchungen werden auch dann voll gegen den verknüpften Topf gebucht, wenn dessen Guthaben 0 € oder zu niedrig ist.
              </div>
            </div>

            {statusBanner && (
              <div className="mt-3 px-3 py-2 rounded bg-slate-100 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200">
                {statusBanner}
              </div>
            )}
          </section>

          {stagingBatch && stagingMetrics ? (
            <section className="bg-white dark:bg-slate-900 border-2 border-teal-600/60 dark:border-teal-500/60 rounded-md overflow-hidden">
              <div className="px-3.5 py-2.5 bg-teal-50/60 dark:bg-teal-950/30 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t('imports.stagingTitle')} — {stagingBatch.sourceFilename} (
                    {stagingBatch.parserVariant})
                  </h2>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                    Gesamt: {stagingMetrics.total} · Ausgewählt: {stagingMetrics.selected} · Exakt-Duplikat gesperrt: {stagingMetrics.exactCount} · Semantik-Treffer (±4d): {stagingMetrics.semanticCount} · Ungedeckte Topf-Entnahmen: {stagingMetrics.uncoveredPotDebits}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={discardStagingBatch}
                    className="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {t('imports.discardBatch')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCommitBatch}
                    disabled={stagingMetrics.selected === 0}
                    className="px-3 py-1 text-xs font-medium rounded bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white cursor-pointer"
                  >
                    {t('imports.commitBatch')} ({stagingMetrics.selected})
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      <th className="py-2 px-2.5 text-center">Buchen</th>
                      <th className="py-2 px-2 text-left">Buchung</th>
                      <th className="py-2 px-2.5 text-left">
                        Beteiligter / Verwendungszweck
                      </th>
                      <th className="py-2 px-2.5 text-right">Betrag</th>
                      <th className="py-2 px-2.5 text-left">
                        Duplikat-Prüfung & Regel-Erkennung
                      </th>
                      <th className="py-2 px-2.5 text-left">
                        Kategorie (Override)
                      </th>
                      <th className="py-2 px-2.5 text-left">
                        Geplante Zahlung / Topf (inkl. Deckung)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {stagingBatch.rows.map((r) => {
                      const isTransfer =
                        r.detectedDirection ===
                        TransactionDirection.PHYSICAL_ACCOUNT_TRANSFER;
                      const isExactDup =
                        r.duplicateKind === DuplicateMatchKind.EXACT_HASH;
                      const isSemanticDup =
                        r.duplicateKind === DuplicateMatchKind.SEMANTIC_MATCH;

                      const linkedEval = r.suggestedPlannedPaymentId
                        ? evaluatedByPaymentId.get(r.suggestedPlannedPaymentId)
                        : undefined;
                      const potAfterCommit =
                        linkedEval && linkedEval.isSinkingFund && r.amount < 0
                          ? Math.round((linkedEval.potBalance + r.amount) * 100) /
                            100
                          : null;
                      const isUncoveredDebit =
                        potAfterCommit !== null && potAfterCommit < 0;

                      return (
                        <tr
                          key={r.rowNumber}
                          className={
                            isExactDup
                              ? 'opacity-55 bg-slate-100/80 dark:bg-slate-900/90'
                              : isSemanticDup && !r.selectedForCommit
                                ? 'bg-amber-50/50 dark:bg-amber-950/20'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="py-1.5 px-2.5 text-center">
                            <input
                              type="checkbox"
                              disabled={isExactDup}
                              checked={r.selectedForCommit}
                              onChange={(e) =>
                                updateStagingRowSelection(
                                  r.rowNumber,
                                  e.target.checked
                                )
                              }
                              title={
                                isExactDup
                                  ? 'Exaktes Hash-Duplikat — Buchung gesperrt'
                                  : isSemanticDup
                                    ? 'Potenzielle Doppelbuchung — nur anhaken, wenn es sich wirklich um eine zweite separate Zahlung handelt'
                                    : 'Für Buchungsübernahme auswählen'
                              }
                              className="rounded border-slate-300 text-teal-700 cursor-pointer disabled:cursor-not-allowed"
                            />
                          </td>

                          <td className="py-1.5 px-2 font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                            {formatDate(r.bookingDate)}
                          </td>

                          <td className="py-1.5 px-2.5">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {r.counterpartyName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[270px]">
                              {r.remittanceInfo}
                            </div>
                          </td>

                          <td
                            className={`py-1.5 px-2.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                              r.amount >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {formatMoney(r.amount)}
                          </td>

                          <td className="py-1.5 px-2.5 text-[11px]">
                            {isExactDup ? (
                              <div className="text-rose-700 dark:text-rose-400 font-medium">
                                <div>Gesperrt: Exaktes Duplikat</div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                  {r.duplicateReason}
                                </div>
                              </div>
                            ) : isSemanticDup ? (
                              <div className="text-amber-800 dark:text-amber-300 font-medium">
                                <div>
                                  Abgewählt: Semantisches Duplikat (±4 Tage)
                                </div>
                                <div className="text-[10px] text-amber-700/90 dark:text-amber-400/90">
                                  {r.duplicateReason}
                                </div>
                              </div>
                            ) : isTransfer ? (
                              <span className="font-medium text-teal-800 dark:text-teal-300">
                                {t('imports.physicalTransfer')}
                              </span>
                            ) : r.matchedRuleName ? (
                              <span className="text-slate-700 dark:text-slate-300">
                                Regex: {r.matchedRuleName}
                              </span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">
                                Unzugeordnet (Manuell prüfen)
                              </span>
                            )}
                          </td>

                          <td className="py-1.5 px-2.5">
                            {isTransfer ? (
                              <span className="text-[11px] text-slate-400">
                                Neutral (Physischer Umbuchungstransfer)
                              </span>
                            ) : (
                              <select
                                disabled={isExactDup}
                                value={r.suggestedCategoryId ?? ''}
                                onChange={(e) =>
                                  updateStagingRowOverride(r.rowNumber, {
                                    suggestedCategoryId: e.target.value || null,
                                  })
                                }
                                className="w-full px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded disabled:opacity-50"
                              >
                                <option value="">— Keine Kategorie —</option>
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          <td className="py-1.5 px-2.5">
                            {isTransfer ? (
                              <span className="text-[11px] text-slate-400">
                                Kein virtueller Topf berührt
                              </span>
                            ) : (
                              <div className="space-y-0.5">
                                <select
                                  disabled={isExactDup}
                                  value={r.suggestedPlannedPaymentId ?? ''}
                                  onChange={(e) =>
                                    updateStagingRowOverride(r.rowNumber, {
                                      suggestedPlannedPaymentId:
                                        e.target.value || null,
                                    })
                                  }
                                  className="w-full px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded disabled:opacity-50"
                                >
                                  <option value="">— Keine Verknüpfung —</option>
                                  {matrix.allEvaluatedRows.map((ev) => (
                                    <option
                                      key={ev.payment.id}
                                      value={ev.payment.id}
                                    >
                                      {ev.payment.name}
                                      {ev.isSinkingFund
                                        ? ` (Topf: ${formatMoney(ev.potBalance)})`
                                        : ''}
                                    </option>
                                  ))}
                                </select>
                                {!isExactDup && isUncoveredDebit && linkedEval && (
                                  <div className="text-[10px] font-mono text-rose-700 dark:text-rose-400">
                                    Ungedeckt: Topf {formatMoney(linkedEval.potBalance)}{' '}
                                    → danach {formatMoney(potAfterCommit)} (erlaubt)
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-6 text-center space-y-2">
              <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                Aktuell ist keine Import-Vorschau geöffnet.
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
                Lade eine DKB-CSV-Datei hoch oder klicke oben auf „DKB-Beispielauszug laden (inkl. Duplikat-Test)“, um den zweistufigen Duplikat-Abgleich (Exakter Hash + ±4-Tage-Semantik) sowie eine Abbuchung aus einem ungedeckten Topf live zu prüfen.
              </p>
            </section>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 3: REGEX-ZUORDNUNGSREGELN                                     */}
      {/* ===================================================================== */}
      {activeSubTab === 'rules' && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-3">
          <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {t('imports.rulesTitle')}
          </h2>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded">
            {matchingRules.map((rule) => {
              const targetEv = rule.targetPlannedPaymentId
                ? evaluatedByPaymentId.get(rule.targetPlannedPaymentId)
                : undefined;
              return (
                <div key={rule.id} className="p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      Prio {rule.priority} · {rule.name}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {rule.targetCategoryId
                        ? categoryMap.get(rule.targetCategoryId)
                        : '—'}
                      {targetEv ? ` → ${targetEv.payment.name}` : ''}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    Empfänger: /{rule.counterpartyPattern ?? '.*'}/i · Zweck: /
                    {rule.remittancePattern ?? '.*'}/i
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleCreateRule} className="pt-2 space-y-2 text-xs">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              Neue Regex-Regel hinzufügen
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <input
                type="text"
                placeholder="Regelname (z.B. Telekom Mobilfunk)"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
              <input
                type="text"
                placeholder="Empfänger-Regex (z.B. Telekom)"
                value={cpRegex}
                onChange={(e) => setCpRegex(e.target.value)}
                className="px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
              <input
                type="text"
                placeholder="Verwendungszweck-Regex (optional)"
                value={remRegex}
                onChange={(e) => setRemRegex(e.target.value)}
                className="px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
              <select
                value={ruleCatId}
                onChange={(e) => setRuleCatId(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              >
                <option value="">Ziel-Kategorie wählen</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={rulePaymentId}
                onChange={(e) => setRulePaymentId(e.target.value)}
                className="flex-1 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              >
                <option value="">Geplante Zahlung / Topf verknüpfen (optional)</option>
                {plannedPayments.map((pp) => (
                  <option key={pp.id} value={pp.id}>
                    {pp.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium cursor-pointer"
              >
                Regel anlegen
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
};
