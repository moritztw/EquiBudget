import React, {useMemo, useState} from 'react';
import {Search} from 'lucide-react';
import {useI18n} from '../i18n/I18nContext';
import {useHouseholdStore} from '../store/useHouseholdStore';
import {buildTwelveMonthScheduleMatrix} from '../domain/calculators';
import {PlannedPayment, RecurrenceInterval} from '../domain/types';

type ScheduleLayoutMode = 'combined' | 'master' | 'matrix';
type IntervalFilterMode = 'all' | 'accrual' | 'monthly';
type LifecycleMode = 'active' | 'archive';

interface ScheduleMatrixViewProps {
  onOpenEditModal: (payment: PlannedPayment) => void;
  onJumpToReallocatePot: (sourcePaymentId: string) => void;
}

export const ScheduleMatrixView: React.FC<ScheduleMatrixViewProps> = ({
  onOpenEditModal,
  onJumpToReallocatePot,
}) => {
  const {
    t,
    formatMoney,
    formatCompactMoney,
    formatPercent,
    formatDate,
    formatShortMonth,
  } = useI18n();
  const {
    plannedPayments,
    ledgerEntries,
    categories,
    accounts,
    referenceMonthKey,
    updatePlannedPayment,
    bookMonthlyProvision,
    settlePlannedPaymentInvoice,
  } = useHouseholdStore();

  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode>('active');
  const [layoutMode, setLayoutMode] = useState<ScheduleLayoutMode>('combined');
  const [intervalFilter, setIntervalFilter] = useState<IntervalFilterMode>('all');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Inline editing states for rapid Excel-like cell edits
  const [inlineCell, setInlineCell] = useState<{
    paymentId: string;
    field: 'name' | 'amount' | 'nextDueDate' | 'endDate';
  } | null>(null);
  const [draftPrimary, setDraftPrimary] = useState<string>('');
  const [draftSecondary, setDraftSecondary] = useState<string>('');

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

  const sourceRows = lifecycleMode === 'active' ? matrix.rows : matrix.archivedRows;

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sourceRows.filter((r) => {
      if (intervalFilter === 'accrual' && !r.isSinkingFund) return false;
      if (
        intervalFilter === 'monthly' &&
        r.payment.interval !== RecurrenceInterval.MONTHLY
      ) {
        return false;
      }
      if (selectedCategoryId !== 'ALL' && r.payment.categoryId !== selectedCategoryId) {
        return false;
      }
      if (q.length > 0) {
        const hay =
          `${r.payment.name} ${r.payment.payee} ${r.categoryName} ${r.accountName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sourceRows, intervalFilter, selectedCategoryId, searchQuery]);

  const chartMaxY = useMemo(() => {
    const maxVal = Math.max(
      ...matrix.slots.map((s) =>
        Math.max(
          matrix.actualCashOutTotalsByMonth[s.key] ?? 0,
          matrix.smoothedLoadTotalsByMonth[s.key] ?? 0
        )
      ),
      100
    );
    return Math.ceil(maxVal / 500) * 500;
  }, [matrix]);

  const peakSlot = matrix.slots.find((s) => s.key === matrix.peakMonthKey);
  const peakLabel = peakSlot
    ? formatShortMonth(peakSlot.year, peakSlot.monthIndex)
    : matrix.peakMonthKey;

  const beginInlineEdit = (
    p: PlannedPayment,
    field: 'name' | 'amount' | 'nextDueDate' | 'endDate',
    effectiveAmt: number
  ) => {
    setInlineCell({paymentId: p.id, field});
    if (field === 'name') {
      setDraftPrimary(p.name);
      setDraftSecondary(p.payee);
    } else if (field === 'amount') {
      setDraftPrimary(effectiveAmt.toFixed(2));
    } else if (field === 'nextDueDate') {
      setDraftPrimary(p.nextDueDate);
    } else {
      setDraftPrimary(p.endDate ?? '');
    }
  };

  const commitInlineEdit = (p: PlannedPayment) => {
    if (!inlineCell || inlineCell.paymentId !== p.id) return;
    if (inlineCell.field === 'name') {
      if (draftPrimary.trim()) {
        updatePlannedPayment(p.id, {
          name: draftPrimary.trim(),
          payee: draftSecondary.trim() || draftPrimary.trim(),
        });
      }
    } else if (inlineCell.field === 'amount') {
      const parsed = Number(draftPrimary.replace(',', '.'));
      if (Number.isFinite(parsed) && parsed > 0) {
        updatePlannedPayment(p.id, {amount: Math.round(parsed * 100) / 100});
      }
    } else if (inlineCell.field === 'nextDueDate') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(draftPrimary)) {
        updatePlannedPayment(p.id, {nextDueDate: draftPrimary});
      }
    } else if (inlineCell.field === 'endDate') {
      updatePlannedPayment(p.id, {
        endDate: draftPrimary.trim() ? draftPrimary.trim() : null,
      });
    }
    setInlineCell(null);
  };

  const showMasterCols = layoutMode === 'combined' || layoutMode === 'master';
  const showMatrixCols = layoutMode === 'combined' || layoutMode === 'matrix';

  const smoothedPolylinePoints = matrix.slots
    .map((slot, idx) => {
      const xCenter = 78 + idx * 54;
      const loadVal = matrix.smoothedLoadTotalsByMonth[slot.key] ?? 0;
      const y = 136 - (loadVal / chartMaxY) * 116;
      return `${xCenter},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="space-y-4">
      {/* Page Title & High-Density KPI Strip */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t('schedule.title')}
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('schedule.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
          <div className="bg-white dark:bg-slate-900 px-3 py-2">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('schedule.kpiMonthlyTotal')}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-teal-700 dark:text-teal-400">
              {formatMoney(matrix.smoothedMonthlyTotal)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 px-3 py-2">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('schedule.kpiDirectMonthly')}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatMoney(matrix.monthlyDirectFixedSum)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 px-3 py-2">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('schedule.kpiAccrualMonthly')}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatMoney(matrix.monthlyAccrualProvisionSum)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 px-3 py-2">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('schedule.kpiAnnualTotal')}
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCompactMoney(matrix.twelveMonthTotalCashOut)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 px-3 py-2 col-span-2 sm:col-span-1">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('schedule.kpiPeakMonth')} ({peakLabel})
            </div>
            <div className="text-sm font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {formatMoney(matrix.peakMonthAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* Dual Visualizations: 12-Month Cashflow Chart + Category Monthly Rate Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {t('schedule.chartCashflowTitle')}
            </h2>
            <div className="flex items-center gap-4 text-[11px] text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-slate-700 dark:bg-slate-400 inline-block" />
                Cash-Out (Reale Fälligkeit)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-teal-600 dark:bg-teal-400 inline-block" />
                Dynamische Monatsumlage (inkl. Staffeln & Enddaten)
              </span>
            </div>
          </div>

          <svg
            viewBox="0 0 720 168"
            className="w-full h-40 select-none"
            role="img"
            aria-label={t('schedule.chartCashflowTitle')}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((step) => {
              const y = 136 - step * 116;
              const val = Math.round(step * chartMaxY);
              return (
                <g key={step}>
                  <line
                    x1="52"
                    y1={y}
                    x2="710"
                    y2={y}
                    className="stroke-slate-200 dark:stroke-slate-800"
                    strokeWidth="1"
                  />
                  <text
                    x="46"
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono"
                  >
                    {val}€
                  </text>
                </g>
              );
            })}

            {matrix.slots.map((slot, idx) => {
              const actual = matrix.actualCashOutTotalsByMonth[slot.key] ?? 0;
              const slotLoad = matrix.smoothedLoadTotalsByMonth[slot.key] ?? 0;
              const barHeight = Math.max(2, (actual / chartMaxY) * 116);
              const xCenter = 78 + idx * 54;
              const barY = 136 - barHeight;
              const isPeak = actual > slotLoad + 1;

              return (
                <g key={slot.key}>
                  <rect
                    x={xCenter - 15}
                    y={barY}
                    width="30"
                    height={barHeight}
                    rx="2"
                    className={
                      isPeak
                        ? 'fill-amber-600/85 dark:fill-amber-500/80'
                        : 'fill-slate-700 dark:fill-slate-400'
                    }
                  />
                  <text
                    x={xCenter}
                    y={barY - 4}
                    textAnchor="middle"
                    className="fill-slate-700 dark:fill-slate-300 text-[8.5px] font-mono"
                  >
                    {Math.round(actual)}
                  </text>
                  <text
                    x={xCenter}
                    y="153"
                    textAnchor="middle"
                    className="fill-slate-600 dark:fill-slate-400 text-[9.5px] font-mono"
                  >
                    {formatShortMonth(slot.year, slot.monthIndex)}
                  </text>
                </g>
              );
            })}

            {/* Dynamic monthly load polyline reflecting Gültig-ab revisions & end_date stops */}
            <polyline
              fill="none"
              points={smoothedPolylinePoints}
              className="stroke-teal-600 dark:stroke-teal-400"
              strokeWidth="2.2"
              strokeDasharray="5 3"
            />
          </svg>
        </section>

        <section className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5 flex flex-col justify-between">
          <div>
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2.5">
              {t('schedule.chartCategoryTitle')}
            </h2>
            <div className="space-y-2">
              {matrix.categoryBreakdown.map((cat) => {
                const pctWidth = Math.max(2, Math.min(100, cat.shareRatio * 100));
                return (
                  <div key={cat.categoryId} className="space-y-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-700 dark:text-slate-300 truncate pr-2">
                        {cat.categoryName}
                      </span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                        {formatMoney(cat.monthlyTotal)} · {formatPercent(cat.shareRatio)}
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 100 5"
                      preserveAspectRatio="none"
                      className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-sm overflow-hidden"
                    >
                      <rect
                        x="0"
                        y="0"
                        width={pctWidth}
                        height="5"
                        className="fill-teal-600 dark:fill-teal-500"
                      />
                    </svg>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-400">
              {t('schedule.kpiMonthlyTotal')}
            </span>
            <span className="font-semibold font-mono tabular-nums text-teal-700 dark:text-teal-400">
              {formatMoney(matrix.smoothedMonthlyTotal)} / Monat
            </span>
          </div>
        </section>
      </div>

      {/* Filter, Archive Switcher & Spreadsheet Layout Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-2.5 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Active vs Archive Filter */}
          <div className="inline-flex rounded border border-slate-300 dark:border-slate-700 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setLifecycleMode('active')}
              className={`px-2.5 py-1 transition-colors cursor-pointer ${
                lifecycleMode === 'active'
                  ? 'bg-teal-700 text-white font-medium'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t('schedule.lifecycleActive')} ({matrix.rows.length})
            </button>
            <button
              type="button"
              onClick={() => setLifecycleMode('archive')}
              className={`px-2.5 py-1 transition-colors cursor-pointer ${
                lifecycleMode === 'archive'
                  ? 'bg-amber-700 text-white font-medium'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t('schedule.lifecycleArchive')} ({matrix.archivedRows.length})
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('schedule.searchPlaceholder')}
              className="pl-8 pr-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600 w-52"
            />
          </div>

          <select
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            aria-label={t('schedule.colCategory')}
            className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">{t('schedule.colCategory')}: Alle</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded border border-slate-300 dark:border-slate-700 overflow-hidden text-xs">
            {(
              [
                ['all', t('schedule.filterAll')],
                ['accrual', t('schedule.filterAccrualOnly')],
                ['monthly', t('schedule.filterMonthlyOnly')],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setIntervalFilter(mode)}
                className={`px-2.5 py-1 transition-colors cursor-pointer ${
                  intervalFilter === mode
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="inline-flex rounded border border-slate-300 dark:border-slate-700 overflow-hidden text-xs">
          {(
            [
              ['combined', t('schedule.viewCombined')],
              ['master', t('schedule.viewMasterOnly')],
              ['matrix', t('schedule.viewMatrixOnly')],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setLayoutMode(mode)}
              className={`px-2.5 py-1 transition-colors cursor-pointer ${
                layoutMode === mode
                  ? 'bg-teal-700 text-white font-medium'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* High-Density Excel / ERP Master Schedule + 12-Month Matrix Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                <th className="sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 py-2 px-2.5 text-left min-w-[235px] border-r border-slate-200 dark:border-slate-700">
                  {t('schedule.colName')}
                </th>
                {showMasterCols && (
                  <>
                    <th className="py-2 px-2 text-left whitespace-nowrap">
                      {t('schedule.colCategory')}
                    </th>
                    <th className="py-2 px-2 text-left whitespace-nowrap">
                      {t('schedule.colInterval')}
                    </th>
                    <th className="py-2 px-2 text-left whitespace-nowrap">
                      {t('schedule.colNextDue')}
                    </th>
                    <th className="py-2 px-2 text-left whitespace-nowrap">
                      {t('schedule.colEndDate')}
                    </th>
                    <th className="py-2 px-2 text-right whitespace-nowrap">
                      {t('schedule.colInvoiceAmount')}
                    </th>
                    <th className="py-2 px-2 text-right whitespace-nowrap bg-teal-50/70 dark:bg-teal-950/30 text-teal-900 dark:text-teal-300">
                      {t('schedule.colMonthlyRate')}
                    </th>
                    <th className="py-2 px-2.5 text-right whitespace-nowrap min-w-[138px]">
                      {t('schedule.colPotBalance')}
                    </th>
                    <th className="py-2 px-2 text-left whitespace-nowrap border-r border-slate-200 dark:border-slate-700">
                      {t('schedule.colStatus')}
                    </th>
                  </>
                )}
                {showMatrixCols &&
                  matrix.slots.map((slot) => (
                    <th
                      key={slot.key}
                      className="py-2 px-2 text-right font-mono whitespace-nowrap min-w-[66px]"
                    >
                      {formatShortMonth(slot.year, slot.monthIndex)}
                    </th>
                  ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={22}
                    className="py-6 px-4 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    Keine Einträge für den gewählten Filter vorhanden.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const p = row.payment;
                  const fillPct = Math.round(row.fillRatio * 100);
                  const isEditingThis = inlineCell?.paymentId === p.id;

                  const statusText =
                    row.status === 'EXPIRED'
                      ? t('schedule.statusExpired')
                      : row.status === 'DUE_NOW'
                        ? t('schedule.statusDueNow')
                        : row.status === 'CATCH_UP'
                          ? t('schedule.statusCatchup')
                          : row.status === 'PAID'
                            ? t('schedule.statusPaid')
                            : t('schedule.statusAccruing');

                  const statusTone =
                    row.status === 'EXPIRED'
                      ? 'text-slate-500 dark:text-slate-400 font-medium'
                      : row.status === 'DUE_NOW'
                        ? 'text-amber-700 dark:text-amber-400 font-semibold'
                        : row.status === 'CATCH_UP'
                          ? 'text-rose-700 dark:text-rose-400 font-medium'
                          : 'text-slate-600 dark:text-slate-400';

                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Sticky Name / Payee + Edit Modal Trigger */}
                      <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 py-1.5 px-2.5 border-r border-slate-200 dark:border-slate-800">
                        {isEditingThis && inlineCell.field === 'name' ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={draftPrimary}
                              onChange={(e) => setDraftPrimary(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit(p);
                                if (e.key === 'Escape') setInlineCell(null);
                              }}
                              autoFocus
                              className="w-full px-1.5 py-0.5 text-xs bg-white dark:bg-slate-950 border border-teal-600 rounded"
                            />
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={draftSecondary}
                                onChange={(e) => setDraftSecondary(e.target.value)}
                                onBlur={() => commitInlineEdit(p)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitInlineEdit(p);
                                  if (e.key === 'Escape') setInlineCell(null);
                                }}
                                placeholder="Empfänger"
                                className="w-full px-1.5 py-0.5 text-[11px] bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                beginInlineEdit(p, 'name', row.effectiveInvoiceAmount)
                              }
                              title="Klicken zum direkten Bearbeiten von Bezeichnung & Empfänger"
                              className="text-left group cursor-pointer"
                            >
                              <div className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-teal-700 dark:group-hover:text-teal-400 leading-tight">
                                {p.name}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                                {p.payee} · {row.accountName.split(' ')[0]}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenEditModal(p)}
                              className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
                            >
                              {t('schedule.editBtn')}
                            </button>
                          </div>
                        )}
                      </td>

                      {showMasterCols && (
                        <>
                          {/* Inline Category Select */}
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            <select
                              value={p.categoryId}
                              onChange={(e) =>
                                updatePlannedPayment(p.id, {
                                  categoryId: e.target.value,
                                })
                              }
                              aria-label={t('schedule.colCategory')}
                              className="bg-transparent text-slate-700 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-400 focus:bg-white dark:focus:bg-slate-950 rounded px-1 py-0.5 cursor-pointer"
                            >
                              {categories.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.name}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Inline Cadence Select */}
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            <select
                              value={p.interval}
                              onChange={(e) => {
                                const nextInt = e.target.value as RecurrenceInterval;
                                updatePlannedPayment(p.id, {
                                  interval: nextInt,
                                  autoAccrual:
                                    nextInt !== RecurrenceInterval.MONTHLY
                                      ? true
                                      : false,
                                });
                              }}
                              aria-label={t('schedule.colInterval')}
                              className="bg-transparent text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400 focus:bg-white dark:focus:bg-slate-950 rounded px-1 py-0.5 cursor-pointer"
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

                          {/* Inline Next Due Date */}
                          <td className="py-1.5 px-2 font-mono tabular-nums whitespace-nowrap">
                            {isEditingThis && inlineCell.field === 'nextDueDate' ? (
                              <input
                                type="date"
                                value={draftPrimary}
                                onChange={(e) => setDraftPrimary(e.target.value)}
                                onBlur={() => commitInlineEdit(p)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitInlineEdit(p);
                                  if (e.key === 'Escape') setInlineCell(null);
                                }}
                                autoFocus
                                className="px-1.5 py-0.5 text-xs font-mono bg-white dark:bg-slate-950 border border-teal-600 rounded"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  beginInlineEdit(
                                    p,
                                    'nextDueDate',
                                    row.effectiveInvoiceAmount
                                  )
                                }
                                className="text-slate-700 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-400 underline decoration-dotted underline-offset-2 cursor-pointer"
                              >
                                {formatDate(p.nextDueDate)}
                              </button>
                            )}
                          </td>

                          {/* Inline End Date */}
                          <td className="py-1.5 px-2 font-mono tabular-nums whitespace-nowrap">
                            {isEditingThis && inlineCell.field === 'endDate' ? (
                              <div className="inline-flex items-center gap-1">
                                <input
                                  type="date"
                                  value={draftPrimary}
                                  onChange={(e) => setDraftPrimary(e.target.value)}
                                  onBlur={() => commitInlineEdit(p)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitInlineEdit(p);
                                    if (e.key === 'Escape') setInlineCell(null);
                                  }}
                                  autoFocus
                                  className="px-1.5 py-0.5 text-xs font-mono bg-white dark:bg-slate-950 border border-teal-600 rounded"
                                />
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  beginInlineEdit(
                                    p,
                                    'endDate',
                                    row.effectiveInvoiceAmount
                                  )
                                }
                                title="Enddatum setzen oder ändern"
                                className={`underline decoration-dotted underline-offset-2 cursor-pointer ${
                                  p.endDate
                                    ? 'text-amber-800 dark:text-amber-300 font-medium'
                                    : 'text-slate-400 dark:text-slate-500 font-sans'
                                }`}
                              >
                                {p.endDate
                                  ? formatDate(p.endDate)
                                  : t('schedule.unbounded')}
                              </button>
                            )}
                          </td>

                          {/* Inline Effective Invoice Amount + Rate Step Indicator */}
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                            {isEditingThis && inlineCell.field === 'amount' ? (
                              <input
                                type="text"
                                value={draftPrimary}
                                onChange={(e) => setDraftPrimary(e.target.value)}
                                onBlur={() => commitInlineEdit(p)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitInlineEdit(p);
                                  if (e.key === 'Escape') setInlineCell(null);
                                }}
                                autoFocus
                                className="w-20 px-1.5 py-0.5 text-right text-xs font-mono bg-white dark:bg-slate-950 border border-teal-600 rounded"
                              />
                            ) : (
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    beginInlineEdit(
                                      p,
                                      'amount',
                                      row.effectiveInvoiceAmount
                                    )
                                  }
                                  title="Basisbetrag direkt ändern (oder über Bearbeiten Preisstaffeln pflegen)"
                                  className="text-slate-900 dark:text-slate-100 hover:text-teal-700 dark:hover:text-teal-400 underline decoration-dotted underline-offset-2 cursor-pointer"
                                >
                                  {formatMoney(row.effectiveInvoiceAmount)}
                                </button>
                                {(p.amountRevisions.length > 0 ||
                                  row.hasFutureRateRevisions) && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenEditModal(p)}
                                    className="block ml-auto text-[10px] font-sans text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                                  >
                                    {p.amountRevisions.length} Staffel(n)
                                  </button>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium bg-teal-50/40 dark:bg-teal-950/20 text-teal-800 dark:text-teal-300 whitespace-nowrap">
                            {formatMoney(row.effectiveMonthlyRate)}
                          </td>

                          <td className="py-1.5 px-2.5 text-right whitespace-nowrap">
                            {row.isSinkingFund || row.potBalance !== 0 ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2 font-mono tabular-nums text-[11px]">
                                  <span
                                    className={
                                      row.isOverdrawnPot
                                        ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                        : 'text-slate-500 dark:text-slate-400'
                                    }
                                  >
                                    {row.isOverdrawnPot
                                      ? 'Überzogen'
                                      : row.isExpiredOrArchived
                                        ? 'Rest'
                                        : `${fillPct}%`}
                                  </span>
                                  <span
                                    className={
                                      row.isOverdrawnPot
                                        ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                        : 'text-slate-800 dark:text-slate-200 font-medium'
                                    }
                                  >
                                    {formatMoney(row.potBalance)}
                                  </span>
                                </div>
                                <svg
                                  viewBox="0 0 100 4"
                                  preserveAspectRatio="none"
                                  className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-sm overflow-hidden"
                                >
                                  <rect
                                    x="0"
                                    y="0"
                                    width={
                                      row.isOverdrawnPot
                                        ? 100
                                        : Math.max(2, fillPct)
                                    }
                                    height="4"
                                    className={
                                      row.isOverdrawnPot
                                        ? 'fill-rose-600 dark:fill-rose-400'
                                        : row.hasResidualPotBalance
                                          ? 'fill-amber-600 dark:fill-amber-400'
                                          : fillPct >= 100
                                            ? 'fill-emerald-600 dark:fill-emerald-400'
                                            : 'fill-teal-600 dark:fill-teal-400'
                                    }
                                  />
                                </svg>
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600 font-mono">
                                —
                              </span>
                            )}
                          </td>

                          <td className="py-1.5 px-2 whitespace-nowrap border-r border-slate-200 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-2">
                              <span className={statusTone}>{statusText}</span>
                              {row.hasResidualPotBalance ? (
                                <button
                                  type="button"
                                  onClick={() => onJumpToReallocatePot(p.id)}
                                  className="px-1.5 py-0.5 text-[11px] font-medium rounded border border-amber-500/70 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 cursor-pointer"
                                >
                                  {t('schedule.reallocateResidual')}
                                </button>
                              ) : row.isOverdrawnPot ? (
                                <button
                                  type="button"
                                  onClick={() => onJumpToReallocatePot(p.id)}
                                  className="px-1.5 py-0.5 text-[11px] font-medium rounded border border-rose-500/70 text-rose-800 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                                >
                                  Ausgleichen
                                </button>
                              ) : (
                                !row.isExpiredOrArchived &&
                                row.isSinkingFund &&
                                (row.status === 'DUE_NOW' ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      settlePlannedPaymentInvoice(
                                        p.id,
                                        row.effectiveInvoiceAmount
                                      )
                                    }
                                    className="px-1.5 py-0.5 text-[11px] font-medium rounded border border-amber-500/60 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 cursor-pointer"
                                  >
                                    {t('pots.settleInvoice')}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      bookMonthlyProvision(
                                        p.id,
                                        row.effectiveMonthlyRate
                                      )
                                    }
                                    className="px-1.5 py-0.5 text-[11px] text-teal-700 dark:text-teal-300 hover:underline cursor-pointer"
                                  >
                                    +Rate
                                  </button>
                                ))
                              )}
                            </div>
                          </td>
                        </>
                      )}

                      {showMatrixCols &&
                        matrix.slots.map((slot) => {
                          const val = row.cashOutByMonth[slot.key] ?? 0;
                          const isAfterEndDate =
                            p.endDate !== null && slot.key > p.endDate.slice(0, 7);
                          const isSpike =
                            val > 0 && p.interval !== RecurrenceInterval.MONTHLY;
                          return (
                            <td
                              key={slot.key}
                              className={`py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap ${
                                isAfterEndDate
                                  ? 'bg-slate-50/80 dark:bg-slate-950/40 text-slate-300 dark:text-slate-700'
                                  : isSpike
                                    ? 'bg-amber-50/70 dark:bg-amber-950/25 font-semibold text-amber-900 dark:text-amber-300'
                                    : val > 0
                                      ? 'text-slate-700 dark:text-slate-300'
                                      : 'text-slate-300 dark:text-slate-700'
                              }`}
                            >
                              {val > 0 ? Math.round(val) : '·'}
                            </td>
                          );
                        })}
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Spreadsheet Footer Totals */}
            <tfoot className="bg-slate-100 dark:bg-slate-800/90 border-t-2 border-slate-300 dark:border-slate-700 font-mono tabular-nums text-[11px]">
              <tr>
                <td className="sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 py-2 px-2.5 font-sans font-semibold text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-700">
                  {t('schedule.sumActualOutflow')}
                </td>
                {showMasterCols && (
                  <>
                    <td colSpan={4} className="py-2 px-2 font-sans text-slate-500">
                      {matrix.rows.length} aktiv · {matrix.archivedRows.length} im Archiv
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-900 dark:text-slate-100">
                      {formatCompactMoney(matrix.twelveMonthTotalCashOut)}/J
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-teal-800 dark:text-teal-300 bg-teal-50/60 dark:bg-teal-950/30">
                      {formatMoney(matrix.smoothedMonthlyTotal)}
                    </td>
                    <td
                      colSpan={2}
                      className="border-r border-slate-200 dark:border-slate-700"
                    />
                  </>
                )}
                {showMatrixCols &&
                  matrix.slots.map((slot) => {
                    const sum = matrix.actualCashOutTotalsByMonth[slot.key] ?? 0;
                    return (
                      <td
                        key={slot.key}
                        className="py-2 px-2 text-right font-semibold text-slate-900 dark:text-slate-100"
                      >
                        {Math.round(sum)}
                      </td>
                    );
                  })}
              </tr>

              {showMatrixCols && (
                <>
                  <tr className="border-t border-slate-200 dark:border-slate-700 text-teal-800 dark:text-teal-300">
                    <td className="sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 py-1.5 px-2.5 font-sans font-medium border-r border-slate-200 dark:border-slate-700">
                      {t('schedule.sumSmoothedAccrual')}
                    </td>
                    {showMasterCols && (
                      <td
                        colSpan={8}
                        className="border-r border-slate-200 dark:border-slate-700"
                      />
                    )}
                    {matrix.slots.map((slot) => (
                      <td key={slot.key} className="py-1.5 px-2 text-right">
                        {Math.round(matrix.smoothedLoadTotalsByMonth[slot.key] ?? 0)}
                      </td>
                    ))}
                  </tr>

                  <tr className="border-t border-slate-200 dark:border-slate-700">
                    <td className="sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 py-1.5 px-2.5 font-sans font-medium text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-700">
                      {t('schedule.sumNetLiquidityDelta')}
                    </td>
                    {showMasterCols && (
                      <td
                        colSpan={8}
                        className="border-r border-slate-200 dark:border-slate-700"
                      />
                    )}
                    {matrix.slots.map((slot) => {
                      const delta = matrix.netLiquidityDeltaByMonth[slot.key] ?? 0;
                      return (
                        <td
                          key={slot.key}
                          className={`py-1.5 px-2 text-right font-semibold ${
                            delta >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {delta >= 0 ? `+${Math.round(delta)}` : Math.round(delta)}
                        </td>
                      );
                    })}
                  </tr>
                </>
              )}
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
