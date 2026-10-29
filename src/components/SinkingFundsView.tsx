import React, {useEffect, useMemo, useState} from 'react';
import {useI18n} from '../i18n/I18nContext';
import {useHouseholdStore} from '../store/useHouseholdStore';
import {
  buildTwelveMonthScheduleMatrix,
  reconcileAccountLiquidity,
} from '../domain/calculators';

interface SinkingFundsViewProps {
  preselectedSourcePotId?: string | null;
}

export const SinkingFundsView: React.FC<SinkingFundsViewProps> = ({
  preselectedSourcePotId,
}) => {
  const {t, formatMoney, formatDate} = useI18n();
  const {
    accounts,
    plannedPayments,
    ledgerEntries,
    categories,
    referenceMonthKey,
    bookMonthlyProvision,
    settlePlannedPaymentInvoice,
    reallocateVirtualPots,
  } = useHouseholdStore();

  const reconciliationRows = useMemo(
    () => reconcileAccountLiquidity(accounts, plannedPayments, ledgerEntries),
    [accounts, plannedPayments, ledgerEntries]
  );

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

  // Include active sinking funds, expired pots with positive residual balance, AND overdrawn (negative) pots
  const sinkingFundRows = useMemo(
    () =>
      matrix.allEvaluatedRows.filter(
        (r) =>
          (r.isSinkingFund && !r.isExpiredOrArchived) ||
          r.hasResidualPotBalance ||
          r.isOverdrawnPot
      ),
    [matrix.allEvaluatedRows]
  );

  // Source pots for reallocation must hold positive funds (> 0 €)
  const positiveSourceRows = useMemo(
    () => sinkingFundRows.filter((r) => r.potBalance > 0),
    [sinkingFundRows]
  );

  // Target pots can be any active sinking fund OR any overdrawn pot (even if expired) to cover deficit
  const targetPotRows = useMemo(
    () =>
      sinkingFundRows.filter(
        (r) => !r.isExpiredOrArchived || r.isOverdrawnPot
      ),
    [sinkingFundRows]
  );

  const [fromPotId, setFromPotId] = useState<string>(
    () => preselectedSourcePotId || positiveSourceRows[0]?.payment.id || ''
  );
  const [toPotId, setToPotId] = useState<string>(
    () =>
      targetPotRows.find((r) => r.isOverdrawnPot)?.payment.id ||
      targetPotRows[0]?.payment.id ||
      ''
  );
  const [reallocAmount, setReallocAmount] = useState<string>('120.00');
  const [reallocNote, setReallocNote] = useState<string>(
    'Manuelle Umbuchung zum Ausgleich / Umschichten zwischen virtuellen Töpfen'
  );
  const [feedback, setFeedback] = useState<{ok: boolean; text: string} | null>(
    null
  );

  // Inline Invoice Settlement State (supports arbitrary / uncovered amounts!)
  const [settlingPotId, setSettlingPotId] = useState<string | null>(null);
  const [settleAmountDraft, setSettleAmountDraft] = useState<string>('');
  const [settleNoteDraft, setSettleNoteDraft] = useState<string>('');
  const [potBanner, setPotBanner] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedSourcePotId) {
      const selectedRow = sinkingFundRows.find(
        (r) => r.payment.id === preselectedSourcePotId
      );
      if (selectedRow && selectedRow.isOverdrawnPot) {
        setToPotId(selectedRow.payment.id);
        setReallocAmount(selectedRow.potOverdraftAmount.toFixed(2));
        const bestSource = positiveSourceRows.find(
          (r) => r.payment.id !== selectedRow.payment.id
        );
        if (bestSource) setFromPotId(bestSource.payment.id);
      } else if (selectedRow && selectedRow.potBalance > 0) {
        setFromPotId(preselectedSourcePotId);
        setReallocAmount(selectedRow.potBalance.toFixed(2));
        const firstDifferentTarget = targetPotRows.find(
          (r) => r.payment.id !== preselectedSourcePotId
        );
        if (firstDifferentTarget) {
          setToPotId(firstDifferentTarget.payment.id);
        }
      }
    }
  }, [preselectedSourcePotId, sinkingFundRows, positiveSourceRows, targetPotRows]);

  const handleOpenSettleInline = (
    paymentId: string,
    defaultAmount: number,
    paymentName: string
  ) => {
    setSettlingPotId(paymentId);
    setSettleAmountDraft(defaultAmount.toFixed(2));
    setSettleNoteDraft(`Ist-Zahlung ${paymentName}`);
  };

  const handleConfirmSettleInline = (paymentId: string, paymentName: string) => {
    const cleanAmt = Math.abs(Number(settleAmountDraft.replace(',', '.')));
    if (!Number.isFinite(cleanAmt) || cleanAmt <= 0) return;
    const res = settlePlannedPaymentInvoice(
      paymentId,
      cleanAmt,
      undefined,
      settleNoteDraft.trim() || undefined
    );
    setSettlingPotId(null);
    if (res.potBalanceAfter < 0) {
      setPotBanner(
        `Zahlung über ${formatMoney(cleanAmt)} aus Topf „${paymentName}“ gebucht (auch im Journal unter Ist-Zahlungen erfasst). Topf war nicht voll gedeckt: Saldo wechselte von ${formatMoney(res.potBalanceBefore)} auf ${formatMoney(res.potBalanceAfter)} (Überziehung aktiv).`
      );
    } else {
      setPotBanner(
        `Zahlung über ${formatMoney(cleanAmt)} aus Topf „${paymentName}“ gebucht und als Ist-Zahlung im Buchungsjournal erfasst. Neuer Topf-Stand: ${formatMoney(res.potBalanceAfter)}.`
      );
    }
  };

  const handleReallocate = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(reallocAmount.replace(',', '.'));
    const res = reallocateVirtualPots(fromPotId, toPotId, amt, reallocNote);
    if (!res.ok) {
      setFeedback({ok: false, text: res.error ?? 'Umbuchung fehlgeschlagen.'});
    } else {
      setFeedback({
        ok: true,
        text: `${formatMoney(amt)} rein buchhalterisch zwischen virtuellen Töpfen umgeschichtet (keine Banktransaktion ausgelöst).`,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {t('pots.title')}
        </h1>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {t('pots.subtitle')}
        </p>
      </div>

      {potBanner && (
        <div className="px-3 py-2 rounded border border-teal-300 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40 text-xs text-teal-900 dark:text-teal-200 flex items-center justify-between gap-2">
          <span>{potBanner}</span>
          <button
            type="button"
            onClick={() => setPotBanner(null)}
            className="text-[11px] underline cursor-pointer"
          >
            Ausblenden
          </button>
        </div>
      )}

      {/* Section 1: Physical Account Liquidity Reconciliation */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {t('pots.reconcileTitle')}
          </h2>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Realer Kontostand − Positive Topf-Rückstellungen = Frei verfügbare Liquidität (überzogene Töpfe mindern direkt den realen Kontostand, ohne fremde Töpfe anzutasten)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                <th className="py-2 px-3 text-left">{t('pots.colAccount')}</th>
                <th className="py-2 px-2.5 text-left">{t('pots.colIban')}</th>
                <th className="py-2 px-2.5 text-right">
                  {t('pots.colPhysicalBalance')}
                </th>
                <th className="py-2 px-2.5 text-right">
                  {t('pots.colReservedPots')}
                </th>
                <th className="py-2 px-2.5 text-right">
                  {t('pots.colOverdrawnPots')}
                </th>
                <th className="py-2 px-2.5 text-right">
                  {t('pots.colFreeLiquidity')}
                </th>
                <th className="py-2 px-3 text-left">
                  {t('pots.colBackingStatus')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {reconciliationRows.map((row) => (
                <tr
                  key={row.account.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                    {row.account.name}
                  </td>
                  <td className="py-2 px-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    {row.account.iban}
                  </td>
                  <td className="py-2 px-2.5 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {formatMoney(row.physicalBalance)}
                  </td>
                  <td className="py-2 px-2.5 text-right font-mono tabular-nums text-teal-800 dark:text-teal-300">
                    {formatMoney(row.reservedInVirtualPots)}
                  </td>
                  <td
                    className={`py-2 px-2.5 text-right font-mono tabular-nums ${
                      row.overdrawnInVirtualPots > 0
                        ? 'text-rose-700 dark:text-rose-400 font-semibold'
                        : 'text-slate-400 dark:text-slate-600'
                    }`}
                  >
                    {row.overdrawnInVirtualPots > 0
                      ? formatMoney(-row.overdrawnInVirtualPots)
                      : formatMoney(0)}
                  </td>
                  <td
                    className={`py-2 px-2.5 text-right font-mono tabular-nums font-semibold ${
                      row.isFullyBacked
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatMoney(row.freeDisposableLiquidity)}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={
                        row.isFullyBacked
                          ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                          : 'text-rose-700 dark:text-rose-400 font-semibold'
                      }
                    >
                      {row.isFullyBacked
                        ? t('pots.backedOk')
                        : t('pots.backedShortfall')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Virtual Sinking Funds Ledger + Virtual Pot Reallocation */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <section className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Virtuelle Anspartöpfe, ungedeckte Überziehungen & verbliebene Restguthaben
            </h2>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Zahlungen sind jederzeit auch über den aktuellen Topf-Stand hinaus buchbar
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  <th className="py-2 px-3 text-left">Virtueller Topf</th>
                  <th className="py-2 px-2 text-left">Fälligkeit / Ende</th>
                  <th className="py-2 px-2 text-right">Zielbetrag</th>
                  <th className="py-2 px-2 text-right">Topf-Stand</th>
                  <th className="py-2 px-2 text-right">Monatsrate</th>
                  <th className="py-2 px-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sinkingFundRows.map((row) => {
                  const pct = Math.round(row.fillRatio * 100);
                  const isSettlingThis = settlingPotId === row.payment.id;
                  const draftNum = Math.abs(
                    Number(settleAmountDraft.replace(',', '.')) || 0
                  );
                  const afterSettleBalance =
                    Math.round((row.potBalance - draftNum) * 100) / 100;

                  return (
                    <React.Fragment key={row.payment.id}>
                      <tr
                        className={
                          row.isOverdrawnPot
                            ? 'bg-rose-50/40 dark:bg-rose-950/20'
                            : row.hasResidualPotBalance
                              ? 'bg-amber-50/40 dark:bg-amber-950/20'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }
                      >
                        <td className="py-2 px-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {row.payment.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {row.accountName} · {t(`interval.${row.payment.interval}`)}
                            {row.isOverdrawnPot
                              ? ' · Topf überzogen (ungedeckte Zahlung)'
                              : row.hasResidualPotBalance
                                ? ' · Beendet (Restguthaben im Topf)'
                                : ''}
                          </div>
                        </td>

                        <td className="py-2 px-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {row.hasResidualPotBalance && row.payment.endDate ? (
                            <span className="text-amber-800 dark:text-amber-300">
                              Ende {formatDate(row.payment.endDate)}
                            </span>
                          ) : (
                            formatDate(row.payment.nextDueDate)
                          )}
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {row.hasResidualPotBalance
                            ? '—'
                            : formatMoney(row.effectiveInvoiceAmount)}
                        </td>

                        <td className="py-2 px-2 text-right">
                          <div
                            className={`font-mono tabular-nums font-semibold ${
                              row.isOverdrawnPot
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-teal-800 dark:text-teal-300'
                            }`}
                          >
                            {formatMoney(row.potBalance)}{' '}
                            {row.isOverdrawnPot
                              ? '(Überzogen)'
                              : row.hasResidualPotBalance
                                ? '(Rest)'
                                : `(${pct}%)`}
                          </div>
                          <svg
                            viewBox="0 0 100 4"
                            preserveAspectRatio="none"
                            className="w-28 ml-auto mt-1 h-1 bg-slate-200 dark:bg-slate-800 rounded-sm overflow-hidden"
                          >
                            <rect
                              x="0"
                              y="0"
                              width={
                                row.isOverdrawnPot ? 100 : Math.max(2, pct)
                              }
                              height="4"
                              className={
                                row.isOverdrawnPot
                                  ? 'fill-rose-600 dark:fill-rose-400'
                                  : row.hasResidualPotBalance
                                    ? 'fill-amber-600 dark:fill-amber-400'
                                    : 'fill-teal-600 dark:fill-teal-400'
                              }
                            />
                          </svg>
                        </td>

                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          <div>{formatMoney(row.effectiveMonthlyRate)}</div>
                          {row.isOverdrawnPot && (
                            <div className="text-[10px] text-rose-700 dark:text-rose-400">
                              inkl. Defizit-Aufholung
                            </div>
                          )}
                        </td>

                        <td className="py-2 px-3 text-right whitespace-nowrap space-x-1.5">
                          {row.hasResidualPotBalance ? (
                            <button
                              type="button"
                              onClick={() => {
                                setFromPotId(row.payment.id);
                                setReallocAmount(row.potBalance.toFixed(2));
                              }}
                              className="px-2 py-1 text-[11px] font-medium rounded border border-amber-500/70 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 cursor-pointer"
                            >
                              Als Quell-Topf wählen
                            </button>
                          ) : (
                            <>
                              {row.isOverdrawnPot && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setToPotId(row.payment.id);
                                    setReallocAmount(
                                      row.potOverdraftAmount.toFixed(2)
                                    );
                                    setReallocNote(
                                      `Ausgleich Topf-Unterdeckung ${row.payment.name}`
                                    );
                                    const src = positiveSourceRows.find(
                                      (s) => s.payment.id !== row.payment.id
                                    );
                                    if (src) setFromPotId(src.payment.id);
                                  }}
                                  className="px-2 py-1 text-[11px] font-medium rounded border border-rose-500/70 text-rose-800 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                                >
                                  Defizit ausgleichen
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  bookMonthlyProvision(
                                    row.payment.id,
                                    row.effectiveMonthlyRate ||
                                      row.standardMonthlyRate
                                  )
                                }
                                className="px-2 py-1 text-[11px] font-medium rounded border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                {t('pots.bookProvision')}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  isSettlingThis
                                    ? setSettlingPotId(null)
                                    : handleOpenSettleInline(
                                        row.payment.id,
                                        row.effectiveInvoiceAmount,
                                        row.payment.name
                                      )
                                }
                                className="px-2 py-1 text-[11px] font-medium rounded border border-teal-600/60 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/50 cursor-pointer"
                              >
                                {t('pots.settleInvoice')}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>

                      {/* Inline Payment-from-Pot Drawer (supports uncovered/overdraft amounts!) */}
                      {isSettlingThis && (
                        <tr className="bg-slate-50 dark:bg-slate-950/80">
                          <td colSpan={6} className="px-3 py-2.5">
                            <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
                              <div className="flex flex-wrap items-end gap-2">
                                <div>
                                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                                    Realer Zahlbetrag (EUR)
                                  </label>
                                  <input
                                    type="text"
                                    value={settleAmountDraft}
                                    onChange={(e) =>
                                      setSettleAmountDraft(e.target.value)
                                    }
                                    className="w-28 px-2 py-1 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                                    Buchungstext (Journal & Topf)
                                  </label>
                                  <input
                                    type="text"
                                    value={settleNoteDraft}
                                    onChange={(e) =>
                                      setSettleNoteDraft(e.target.value)
                                    }
                                    className="w-60 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                                  />
                                </div>
                                <div
                                  className={`py-1 font-mono text-[11px] ${
                                    afterSettleBalance < 0
                                      ? 'text-rose-700 dark:text-rose-400 font-medium'
                                      : 'text-slate-600 dark:text-slate-400'
                                  }`}
                                >
                                  Topf danach: {formatMoney(afterSettleBalance)}
                                  {afterSettleBalance < 0
                                    ? ' (Topf nicht voll gedeckt — Überziehung zulässig)'
                                    : ''}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSettlingPotId(null)}
                                  className="px-2.5 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer"
                                >
                                  Abbrechen
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleConfirmSettleInline(
                                      row.payment.id,
                                      row.payment.name
                                    )
                                  }
                                  className="px-3 py-1 text-[11px] font-medium rounded bg-teal-700 hover:bg-teal-800 text-white cursor-pointer"
                                >
                                  Ist-Zahlung jetzt buchen
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5">
          <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {t('pots.reallocateTitle')}
          </h2>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {t('pots.reallocateHint')}
          </p>

          <form onSubmit={handleReallocate} className="mt-3 space-y-2.5 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('pots.fromPot')}
              </label>
              <select
                value={fromPotId}
                onChange={(e) => setFromPotId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
              >
                {positiveSourceRows.map((r) => (
                  <option key={r.payment.id} value={r.payment.id}>
                    {r.payment.name} ({formatMoney(r.potBalance)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('pots.toPot')}
              </label>
              <select
                value={toPotId}
                onChange={(e) => setToPotId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
              >
                {targetPotRows.map((r) => (
                  <option key={r.payment.id} value={r.payment.id}>
                    {r.payment.name} ({formatMoney(r.potBalance)}
                    {r.isOverdrawnPot ? ' · Überzogen' : ''})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('pots.amount')}
              </label>
              <input
                type="text"
                value={reallocAmount}
                onChange={(e) => setReallocAmount(e.target.value)}
                className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Buchungsvermerk
              </label>
              <input
                type="text"
                value={reallocNote}
                onChange={(e) => setReallocNote(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
              />
            </div>

            {feedback && (
              <div
                className={`p-2 rounded text-[11px] ${
                  feedback.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2 px-3 rounded bg-teal-700 hover:bg-teal-800 text-white font-medium transition-colors cursor-pointer"
            >
              {t('pots.executeReallocation')}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
