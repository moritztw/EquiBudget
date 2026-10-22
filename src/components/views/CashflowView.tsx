import React, { useState } from 'react';
import {
  Sparkles,
  Sliders,
  Percent,
  AlertCircle,
  Coins,
  Info,
  AlertTriangle,
  Bug,
} from 'lucide-react';
import {
  AllocationCalculationResult,
  AllocationStrategyType,
  Budget,
  IncomeSource,
  Person,
  RecurringExpense,
} from '../../types/household';
import { AllocationEngine } from '../../engines/allocationEngine';
import { CashflowSankey } from '../CashflowSankey';
import { useTranslation } from '../../i18n/I18nContext';

interface CashflowViewProps {
  persons: Person[];
  incomes: IncomeSource[];
  budgets: Budget[];
  recurringExpenses: RecurringExpense[];
  onUpdateIncomes: (incomes: IncomeSource[]) => void;
}

export const CashflowView: React.FC<CashflowViewProps> = ({
  persons,
  incomes,
  budgets,
  recurringExpenses,
  onUpdateIncomes,
}) => {
  const { t, formatCurrency, formatPercent, translateError } = useTranslation();

  const [selectedStrategy, setSelectedStrategy] =
    useState<AllocationStrategyType>('EQUAL_REMAINING_AMOUNT');
  const [simulatedError, setSimulatedError] = useState<string | null>(null);

  // Compute operational budgets monthly total
  const operationalBudgetsTotal = budgets.reduce((sum, b) => sum + b.monthlyLimit, 0);

  // Compute sinking funds monthly provision total
  const sinkingFundsMonthlyProvisionTotal = recurringExpenses.reduce(
    (sum, r) => sum + r.currentMonthlyProvision,
    0
  );

  const totalSharedExpenses = operationalBudgetsTotal + sinkingFundsMonthlyProvisionTotal;

  // Run Allocation Engine
  const calculation: AllocationCalculationResult = AllocationEngine.calculate({
    strategy: selectedStrategy,
    persons,
    incomes,
    totalSharedExpenses,
  });

  const handleIncomeChange = (incomeId: string, newNetAmount: number) => {
    const updated = incomes.map((inc) =>
      inc.id === incomeId ? { ...inc, netAmount: Math.max(0, newNetAmount) } : inc
    );
    onUpdateIncomes(updated);
  };

  const handleSimulateError = (code: string) => {
    setSimulatedError(code);
    setTimeout(() => setSimulatedError(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Simulated Error Alert */}
      {simulatedError && (
        <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-500/40 text-rose-200 text-xs flex items-start space-x-3 shadow-lg animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="font-mono font-bold text-rose-300">[{simulatedError}]</span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                Backend API Error Key
              </span>
            </div>
            <p className="font-medium text-slate-100">
              {translateError(simulatedError)}
            </p>
          </div>
        </div>
      )}

      {/* Top Banner explaining the Model */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
                {t('cashflow.bannerTag')}
              </span>
              <span className="text-xs text-slate-400">
                {t('cashflow.bannerSubtag')}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              {t('cashflow.bannerTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              {t('cashflow.bannerDesc')}
            </p>
          </div>

          {/* Strategy Selector Pills */}
          <div className="flex flex-wrap items-center gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800 self-start lg:self-center">
            <button
              onClick={() => setSelectedStrategy('EQUAL_REMAINING_AMOUNT')}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                selectedStrategy === 'EQUAL_REMAINING_AMOUNT'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('strategies.equalRemaining')}</span>
            </button>
            <button
              onClick={() => setSelectedStrategy('PROPORTIONAL_INCOME')}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                selectedStrategy === 'PROPORTIONAL_INCOME'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Percent className="w-3.5 h-3.5" />
              <span>{t('strategies.proportional')}</span>
            </button>
            <button
              onClick={() => setSelectedStrategy('FIXED_RATIO')}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1.5 ${
                selectedStrategy === 'FIXED_RATIO'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{t('strategies.fixedRatio')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Reactive Visual Sankey Flow */}
      <CashflowSankey
        calculation={calculation}
        incomes={incomes}
        persons={persons}
      />

      {/* Two Column Layout: Interactive Simulator Sliders & Earner Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Live Income Sliders */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center space-x-2">
                <Coins className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-100">
                  {t('cashflow.incomeSourcesTitle')}
                </h3>
              </div>
              <span className="text-xs text-slate-400">{t('cashflow.monthlyNet')}</span>
            </div>

            <div className="space-y-4">
              {incomes.map((inc) => {
                const person = persons.find((p) => p.id === inc.personId);
                const isGlobal = inc.personId === null;
                const maxRange = isGlobal ? 1000 : 7000;

                return (
                  <div
                    key={inc.id}
                    className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="text-base">{person?.avatar || '🏛️'}</span>
                        <div>
                          <p className="text-xs font-semibold text-slate-200">
                            {inc.name}
                          </p>
                          <span className="text-[10px] text-slate-400">
                            {isGlobal
                              ? t('cashflow.householdGlobal')
                              : t('cashflow.personalNet', { name: person?.name || '' })}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-sm font-bold text-emerald-400">
                          {formatCurrency(inc.netAmount)}
                        </span>
                      </div>
                    </div>

                    {/* Interactive Slider */}
                    <div className="mt-2 flex items-center space-x-3">
                      <input
                        type="range"
                        min="0"
                        max={maxRange}
                        step="50"
                        value={inc.netAmount}
                        onChange={(e) =>
                          handleIncomeChange(inc.id, parseFloat(e.target.value))
                        }
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Expenses Summary Box */}
            <div className="mt-5 p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t('cashflow.monthlySharedBudgets')}</span>
                <span className="font-mono text-slate-200">
                  {formatCurrency(operationalBudgetsTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t('cashflow.monthlySinkingProvisions')}</span>
                <span className="font-mono text-indigo-400">
                  +{formatCurrency(sinkingFundsMonthlyProvisionTotal)}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs font-semibold text-slate-200">
                <span>{t('cashflow.totalSharedMonthlyCommitment')}</span>
                <span className="font-mono text-emerald-400">
                  {formatCurrency(totalSharedExpenses)}
                </span>
              </div>
            </div>

            {/* Error Code Standard Demo Button */}
            <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center space-x-1">
                <Bug className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t('common.errorDemoTitle')}:</span>
              </span>
              <button
                type="button"
                onClick={() => handleSimulateError('ERR_NO_ACTIVE_EARNERS')}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 font-mono text-[10px] border border-slate-700 cursor-pointer"
              >
                Test ERR_NO_ACTIVE_EARNERS
              </button>
            </div>
          </div>
        </div>

        {/* Right: Allocation Breakdown Cards & Math Log */}
        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {calculation.earnerSplits.map((split) => {
              const person = persons.find((p) => p.id === split.personId);
              return (
                <div
                  key={split.personId}
                  className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 relative overflow-hidden shadow-sm"
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: person?.color || '#6366f1' }}
                  />

                  <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
                    <div className="flex items-center space-x-2.5">
                      <span className="text-2xl p-1.5 rounded-xl bg-slate-950 border border-slate-800">
                        {person?.avatar}
                      </span>
                      <div>
                        <h4 className="text-sm font-bold text-slate-100">
                          {split.personName}
                        </h4>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {t('cashflow.incomeShare', {
                            amount: formatCurrency(split.netIncome),
                            percent: split.incomeSharePercent.toFixed(1),
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Contribution */}
                    <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-400">{t('cashflow.transferToJoint')}</span>
                        <span className="font-mono text-xs text-indigo-400 font-semibold">
                          {formatPercent(split.contributionPercentOfIncome)}
                        </span>
                      </div>
                      <div className="text-xl font-bold font-mono text-slate-100">
                        {formatCurrency(split.contributionAmount)}
                        <span className="text-xs text-slate-400 font-normal">
                          {' '}
                          {t('cashflow.perMonth')}
                        </span>
                      </div>
                    </div>

                    {/* Retained Pocket Money */}
                    <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/20">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-emerald-300 font-medium">
                          {t('cashflow.retainedPocketMoney')}
                        </span>
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                          {t('cashflow.discretionaryBadge')}
                        </span>
                      </div>
                      <div className="text-xl font-bold font-mono text-emerald-400">
                        {formatCurrency(split.discretionaryRemaining)}
                        <span className="text-xs text-slate-400 font-normal">
                          {' '}
                          {t('cashflow.perMonth')}
                        </span>
                      </div>
                    </div>

                    {split.isDeficitSubsidized && (
                      <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] flex items-center space-x-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{t('cashflow.subsidizedNotice')}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mathematical Audit Trail */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center space-x-2 pb-2.5 border-b border-slate-800/80 mb-3 text-xs font-semibold text-slate-300">
              <Info className="w-4 h-4 text-indigo-400" />
              <span>{t('cashflow.auditTrailTitle')}</span>
            </div>
            <ul className="space-y-1.5 text-xs font-mono text-slate-400">
              {calculation.mathematicalExplanation.map((step, idx) => (
                <li key={idx} className="flex items-start space-x-2">
                  <span className="text-indigo-400 select-none">[{idx + 1}]</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
