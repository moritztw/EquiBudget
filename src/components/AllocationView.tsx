import React, {useMemo} from 'react';
import {useI18n} from '../i18n/I18nContext';
import {useHouseholdStore} from '../store/useHouseholdStore';
import {
  buildMonthSlots,
  buildTwelveMonthScheduleMatrix,
  calculateMonthlyIncomeSplit,
} from '../domain/calculators';
import {SplitStrategy} from '../domain/types';

export const AllocationView: React.FC = () => {
  const {t, formatMoney, formatPercent, formatShortMonth} = useI18n();
  const {
    activeTenant,
    updateTenantStrategy,
    persons,
    monthlyIncomes,
    plannedPayments,
    ledgerEntries,
    categories,
    accounts,
    referenceMonthKey,
    setReferenceMonthKey,
    allowNegativeTransferCompensation,
    setAllowNegativeTransferCompensation,
    updatePersonMaster,
    upsertPersonMonthlyIncome,
    clearPersonMonthlyIncome,
  } = useHouseholdStore();

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

  const activeSplit = useMemo(
    () =>
      calculateMonthlyIncomeSplit(
        persons,
        monthlyIncomes,
        referenceMonthKey,
        matrix.monthlyDirectFixedSum,
        matrix.monthlyAccrualProvisionSum,
        activeTenant.defaultSplitStrategy,
        allowNegativeTransferCompensation
      ),
    [
      persons,
      monthlyIncomes,
      referenceMonthKey,
      matrix.monthlyDirectFixedSum,
      matrix.monthlyAccrualProvisionSum,
      activeTenant.defaultSplitStrategy,
      allowNegativeTransferCompensation,
    ]
  );

  // 6-Month rolling sheet (M-1 .. M+4) for rapid month-by-month real net income entry & split preview
  const sixMonthSlots = useMemo(
    () => buildMonthSlots(referenceMonthKey, 6, -1),
    [referenceMonthKey]
  );

  const sixMonthEvaluations = useMemo(() => {
    return sixMonthSlots.map((slot) => {
      const slotMatrix = buildTwelveMonthScheduleMatrix(
        plannedPayments,
        ledgerEntries,
        categories,
        accounts,
        slot.key
      );
      const split = calculateMonthlyIncomeSplit(
        persons,
        monthlyIncomes,
        slot.key,
        slotMatrix.monthlyDirectFixedSum,
        slotMatrix.monthlyAccrualProvisionSum,
        activeTenant.defaultSplitStrategy,
        allowNegativeTransferCompensation
      );
      return {slot, split};
    });
  }, [
    sixMonthSlots,
    plannedPayments,
    ledgerEntries,
    categories,
    accounts,
    persons,
    monthlyIncomes,
    activeTenant.defaultSplitStrategy,
    allowNegativeTransferCompensation,
  ]);

  const strategyComparison = useMemo(() => {
    const strategies: SplitStrategy[] = [
      SplitStrategy.EQUAL_REMAINING,
      SplitStrategy.PROPORTIONAL,
      SplitStrategy.FIFTY_FIFTY,
    ];
    return strategies.map((st) =>
      calculateMonthlyIncomeSplit(
        persons,
        monthlyIncomes,
        referenceMonthKey,
        matrix.monthlyDirectFixedSum,
        matrix.monthlyAccrualProvisionSum,
        st,
        allowNegativeTransferCompensation
      )
    );
  }, [
    persons,
    monthlyIncomes,
    referenceMonthKey,
    matrix.monthlyDirectFixedSum,
    matrix.monthlyAccrualProvisionSum,
    allowNegativeTransferCompensation,
  ]);

  const maxIncome = Math.max(
    1,
    ...activeSplit.shares.map((s) =>
      Math.max(s.monthlyNetIncome, s.totalJointContribution)
    )
  );

  const [refYear, refMonth] = referenceMonthKey.split('-').map(Number);
  const activeMonthLabel = formatShortMonth(refYear, refMonth - 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t('allocation.title')} ({activeMonthLabel})
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('allocation.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded border border-slate-300 dark:border-slate-700 overflow-hidden text-xs">
            {(
              [
                SplitStrategy.EQUAL_REMAINING,
                SplitStrategy.PROPORTIONAL,
                SplitStrategy.FIFTY_FIFTY,
                SplitStrategy.CUSTOM_WEIGHT,
              ] as const
            ).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => updateTenantStrategy(st)}
                className={`px-2.5 py-1.5 transition-colors cursor-pointer ${
                  activeTenant.defaultSplitStrategy === st
                    ? 'bg-teal-700 text-white font-medium'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {t(`strategy.${st}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Warning banner if current Plan Month still has unentered variable salaries */}
      {activeSplit.unenteredEmployedCount > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/35 border border-amber-300 dark:border-amber-800 rounded-md px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3">
          <span>
            Für <strong>{activeMonthLabel}</strong> ist bei{' '}
            {activeSplit.unenteredEmployedCount} erwerbstätigen Person(en) noch kein
            reales Monats-Netto eingetragen. Bitte unten das tatsächliche Auszahlungsnetto
            des Monats erfassen.
          </span>
          <span className="font-mono tabular-nums shrink-0">
            Monatslast {activeMonthLabel}: {formatMoney(activeSplit.totalJointRequirement)}
          </span>
        </div>
      )}

      {activeTenant.defaultSplitStrategy === SplitStrategy.EQUAL_REMAINING && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-4">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={allowNegativeTransferCompensation}
              onChange={(e) => setAllowNegativeTransferCompensation(e.target.checked)}
              className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
            />
            <span>{t('allocation.compensationToggle')}</span>
          </label>
          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
            Umlage {activeMonthLabel}: {formatMoney(activeSplit.totalJointRequirement)} (
            {formatMoney(activeSplit.totalDirectFixedExpenses)} Fix +{' '}
            {formatMoney(activeSplit.totalAccrualProvisions)} Töpfe)
          </span>
        </div>
      )}

      {/* Selected Month Fresh Income Entry & Cent-Exact Split Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                <th className="py-2 px-3 text-left">{t('allocation.colPerson')}</th>
                <th className="py-2 px-2 text-center">{t('allocation.colEmployed')}</th>
                <th className="py-2 px-2 text-left">{t('allocation.colMonthStatus')}</th>
                <th className="py-2 px-2.5 text-right">{t('allocation.colNetIncome')}</th>
                <th className="py-2 px-2.5 text-left">{t('allocation.colIncomeNote')}</th>
                <th className="py-2 px-2.5 text-right">{t('allocation.colPersonalDed')}</th>
                <th className="py-2 px-2.5 text-right">{t('allocation.colDisposable')}</th>
                <th className="py-2 px-2.5 text-right bg-teal-50/70 dark:bg-teal-950/30 text-teal-900 dark:text-teal-300">
                  {t('allocation.colTotalTransfer')}
                </th>
                <th className="py-2 px-2 text-right">{t('allocation.colSharePct')}</th>
                <th className="py-2 px-3 text-right">{t('allocation.colRemaining')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {activeSplit.shares.map((share) => {
                const monthRecord = monthlyIncomes.find(
                  (m) =>
                    m.personId === share.personId && m.monthKey === referenceMonthKey
                );

                return (
                  <tr
                    key={share.personId}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="py-2 px-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {share.displayName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {share.roleLabel}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={share.isEmployed}
                        onChange={(e) =>
                          updatePersonMaster(share.personId, {
                            isEmployed: e.target.checked,
                          })
                        }
                        aria-label={`${share.displayName} ${t('allocation.colEmployed')}`}
                        className="rounded border-slate-300 text-teal-700 cursor-pointer"
                      />
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      {!share.isEmployed ? (
                        <span className="text-slate-400">—</span>
                      ) : share.incomeRecordedForMonth ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            {t('allocation.statusRecorded')}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              clearPersonMonthlyIncome(
                                share.personId,
                                referenceMonthKey
                              )
                            }
                            title="Monatseintrag zurücksetzen"
                            className="text-[10px] text-slate-400 hover:text-rose-600 underline cursor-pointer"
                          >
                            Reset
                          </button>
                        </div>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 font-semibold">
                          {t('allocation.statusMissing')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums">
                      {share.isEmployed ? (
                        <input
                          type="number"
                          step="10"
                          min="0"
                          placeholder="0.00"
                          value={monthRecord ? monthRecord.actualNetIncome : ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '') {
                              clearPersonMonthlyIncome(
                                share.personId,
                                referenceMonthKey
                              );
                            } else {
                              upsertPersonMonthlyIncome(
                                share.personId,
                                referenceMonthKey,
                                Math.max(0, Number(raw) || 0),
                                share.personalFixedAllowance,
                                share.incomeNote
                              );
                            }
                          }}
                          className={`w-28 px-2 py-1 text-right rounded font-mono text-xs border ${
                            share.incomeRecordedForMonth
                              ? 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700'
                              : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-400 dark:border-amber-700'
                          }`}
                        />
                      ) : (
                        <span className="text-slate-400">0,00 €</span>
                      )}
                    </td>
                    <td className="py-2 px-2.5">
                      {share.isEmployed ? (
                        <input
                          type="text"
                          placeholder="z.B. Bonus, Überstunden, 13. Gehalt..."
                          value={share.incomeNote}
                          onChange={(e) =>
                            upsertPersonMonthlyIncome(
                              share.personId,
                              referenceMonthKey,
                              share.monthlyNetIncome,
                              share.personalFixedAllowance,
                              e.target.value
                            )
                          }
                          className="w-48 px-2 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
                        />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums">
                      {share.isEmployed ? (
                        <input
                          type="number"
                          step="10"
                          min="0"
                          value={share.personalFixedAllowance}
                          onChange={(e) =>
                            upsertPersonMonthlyIncome(
                              share.personId,
                              referenceMonthKey,
                              share.monthlyNetIncome,
                              Math.max(0, Number(e.target.value) || 0),
                              share.incomeNote
                            )
                          }
                          className="w-20 px-2 py-1 text-right bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded font-mono text-xs"
                        />
                      ) : (
                        <span className="text-slate-400">0,00 €</span>
                      )}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatMoney(share.disposableBeforeSplit)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold bg-teal-50/40 dark:bg-teal-950/20 text-teal-800 dark:text-teal-300">
                      <div>{formatMoney(share.totalJointContribution)}</div>
                      <div className="text-[10px] font-normal text-slate-500">
                        {formatMoney(share.directFixedShare)} Fix +{' '}
                        {formatMoney(share.accrualProvisionShare)} Topf
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatPercent(share.shareRatio)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatMoney(share.remainingPocketMoney)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-100 dark:bg-slate-800/90 border-t-2 border-slate-300 dark:border-slate-700 font-mono tabular-nums font-semibold text-[11px]">
              <tr>
                <td
                  colSpan={3}
                  className="py-2 px-3 font-sans text-slate-900 dark:text-slate-100"
                >
                  Σ Haushalt ({activeMonthLabel})
                </td>
                <td className="py-2 px-2.5 text-right text-slate-900 dark:text-slate-100">
                  {formatMoney(activeSplit.totalHouseholdNetIncome)}
                </td>
                <td />
                <td className="py-2 px-2.5 text-right text-slate-600 dark:text-slate-400">
                  {formatMoney(
                    activeSplit.totalHouseholdNetIncome -
                      activeSplit.totalDisposableBeforeSplit
                  )}
                </td>
                <td className="py-2 px-2.5 text-right text-slate-900 dark:text-slate-100">
                  {formatMoney(activeSplit.totalDisposableBeforeSplit)}
                </td>
                <td className="py-2 px-2.5 text-right text-teal-800 dark:text-teal-300 bg-teal-50/60 dark:bg-teal-950/30">
                  {formatMoney(activeSplit.totalJointRequirement)}
                </td>
                <td className="py-2 px-2 text-right text-slate-700 dark:text-slate-300">
                  100,0%
                </td>
                <td className="py-2 px-3 text-right text-emerald-700 dark:text-emerald-400">
                  {formatMoney(activeSplit.householdRemainingPocketMoney)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Multi-Month Variable Income & Split Matrix (Excel-Style 6-Month Sheet) */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {t('allocation.multiMonthMatrixTitle')}
          </h2>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Klick auf einen Monatskopf wechselt den aktiven Planmonat
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                <th className="py-2 px-3 text-left min-w-[210px] border-r border-slate-200 dark:border-slate-700">
                  Position / Person
                </th>
                {sixMonthEvaluations.map(({slot}) => {
                  const isCurrent = slot.key === referenceMonthKey;
                  return (
                    <th
                      key={slot.key}
                      className={`py-2 px-2.5 text-right font-mono min-w-[125px] ${
                        isCurrent
                          ? 'bg-teal-100/70 dark:bg-teal-950/50 text-teal-900 dark:text-teal-300'
                          : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setReferenceMonthKey(slot.key)}
                        className="hover:underline cursor-pointer"
                      >
                        {formatShortMonth(slot.year, slot.monthIndex)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {/* Editable Net Income rows per employed person */}
              {persons
                .filter((p) => p.isEmployed)
                .map((person) => (
                  <tr key={`net-${person.id}`}>
                    <td className="py-1.5 px-3 font-medium text-slate-900 dark:text-slate-100 border-r border-slate-200 dark:border-slate-800">
                      Reales Netto · {person.displayName}
                    </td>
                    {sixMonthEvaluations.map(({slot}) => {
                      const rec = monthlyIncomes.find(
                        (m) => m.personId === person.id && m.monthKey === slot.key
                      );
                      const isCurrent = slot.key === referenceMonthKey;
                      return (
                        <td
                          key={slot.key}
                          className={`py-1.5 px-2.5 text-right font-mono tabular-nums ${
                            isCurrent ? 'bg-teal-50/30 dark:bg-teal-950/15' : ''
                          }`}
                        >
                          <input
                            type="number"
                            step="10"
                            min="0"
                            placeholder="Offen (0 €)"
                            value={rec ? rec.actualNetIncome : ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') {
                                clearPersonMonthlyIncome(person.id, slot.key);
                              } else {
                                upsertPersonMonthlyIncome(
                                  person.id,
                                  slot.key,
                                  Math.max(0, Number(raw) || 0),
                                  rec?.personalFixedAllowance ??
                                    person.defaultPersonalAllowance,
                                  rec?.note ?? ''
                                );
                              }
                            }}
                            className={`w-28 px-2 py-0.5 text-right rounded font-mono text-xs border ${
                              rec
                                ? 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100'
                                : 'bg-amber-50/60 dark:bg-amber-950/25 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}

              {/* Monthly Joint Load Row */}
              <tr className="bg-slate-50/80 dark:bg-slate-800/40 font-mono tabular-nums text-[11px]">
                <td className="py-1.5 px-3 font-sans font-medium text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-800">
                  Gemeinsame Monatsumlage (Fix + Töpfe)
                </td>
                {sixMonthEvaluations.map(({slot, split}) => (
                  <td
                    key={slot.key}
                    className="py-1.5 px-2.5 text-right font-semibold text-slate-800 dark:text-slate-200"
                  >
                    {formatMoney(split.totalJointRequirement)}
                  </td>
                ))}
              </tr>

              {/* Resulting Monthly Transfer per Employed Person */}
              {persons
                .filter((p) => p.isEmployed)
                .map((person) => (
                  <tr
                    key={`tr-${person.id}`}
                    className="font-mono tabular-nums text-[11px]"
                  >
                    <td className="py-1.5 px-3 font-sans text-teal-800 dark:text-teal-300 font-medium border-r border-slate-200 dark:border-slate-800">
                      ↳ Überweisung {person.displayName.split(' ')[0]} (Frei danach)
                    </td>
                    {sixMonthEvaluations.map(({slot, split}) => {
                      const sh = split.shares.find((s) => s.personId === person.id);
                      return (
                        <td key={slot.key} className="py-1.5 px-2.5 text-right">
                          <span className="font-semibold text-teal-800 dark:text-teal-300">
                            {formatMoney(sh?.totalJointContribution ?? 0)}
                          </span>
                          <span className="block text-[10px] text-emerald-700 dark:text-emerald-400">
                            Frei: {formatMoney(sh?.remainingPocketMoney ?? 0)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Stacked Income Decomposition + Strategy Comparison Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5">
          <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-3">
            Visuelle Einkommenszerlegung ({activeMonthLabel})
          </h2>
          <div className="space-y-3">
            {activeSplit.shares
              .filter((s) => s.isEmployed || s.totalJointContribution > 0)
              .map((share) => {
                const personalW = (share.personalFixedAllowance / maxIncome) * 100;
                const jointW =
                  (Math.max(0, share.totalJointContribution) / maxIncome) * 100;
                const pocketW =
                  (Math.max(0, share.remainingPocketMoney) / maxIncome) * 100;

                return (
                  <div key={share.personId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {share.displayName}
                      </span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        Umlage {formatMoney(share.totalJointContribution)} · Frei{' '}
                        {formatMoney(share.remainingPocketMoney)}
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 100 10"
                      preserveAspectRatio="none"
                      className="w-full h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm overflow-hidden"
                    >
                      <rect
                        x="0"
                        y="0"
                        width={personalW}
                        height="10"
                        className="fill-slate-400 dark:fill-slate-600"
                      />
                      <rect
                        x={personalW}
                        y="0"
                        width={jointW}
                        height="10"
                        className="fill-teal-600 dark:fill-teal-500"
                      />
                      <rect
                        x={personalW + jointW}
                        y="0"
                        width={pocketW}
                        height="10"
                        className="fill-emerald-500 dark:fill-emerald-400"
                      />
                    </svg>
                  </div>
                );
              })}

            <div className="pt-2 flex flex-wrap gap-4 text-[11px] text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-slate-400 dark:bg-slate-600 inline-block" />
                Eigene Vorabzüge
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-teal-600 dark:bg-teal-500 inline-block" />
                Gemeinschaftskonto-Umlage ({activeMonthLabel})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-500 dark:bg-emerald-400 inline-block" />
                Freies Taschengeld
              </span>
            </div>
          </div>
        </section>

        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5">
          <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2.5">
            {t('allocation.compareTitle')} ({activeMonthLabel})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                  <th className="py-1.5 text-left">Modell</th>
                  {persons
                    .filter((p) => p.isEmployed)
                    .map((p) => (
                      <th key={p.id} className="py-1.5 px-2 text-right">
                        {p.displayName.split(' ')[0]} (Beitrag / Frei)
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {strategyComparison.map((sim) => {
                  const isCurrent = sim.strategy === activeTenant.defaultSplitStrategy;
                  return (
                    <tr
                      key={sim.strategy}
                      className={
                        isCurrent ? 'bg-teal-50/40 dark:bg-teal-950/20 font-medium' : ''
                      }
                    >
                      <td className="py-2 pr-2 text-slate-800 dark:text-slate-200">
                        {t(`strategy.${sim.strategy}`)}
                      </td>
                      {sim.shares
                        .filter((s) => s.isEmployed)
                        .map((s) => (
                          <td
                            key={s.personId}
                            className="py-2 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300"
                          >
                            {formatMoney(s.totalJointContribution)} /{' '}
                            <span className="text-emerald-700 dark:text-emerald-400">
                              {formatMoney(s.remainingPocketMoney)}
                            </span>
                          </td>
                        ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
