import React, { useState } from 'react';
import {
  CalendarClock,
  PiggyBank,
  CheckCircle,
  Plus,
  ArrowRightLeft,
  Flame,
  Car,
  Palmtree,
  Landmark,
  Play,
  RotateCcw,
} from 'lucide-react';
import {
  Frequency,
  RecurringExpense,
  VirtualSinkingFund,
} from '../../types/household';
import { AccrualCalculator } from '../../engines/accrualCalculator';
import { useTranslation } from '../../i18n/I18nContext';

interface SinkingFundsViewProps {
  recurringExpenses: RecurringExpense[];
  sinkingFunds: VirtualSinkingFund[];
  onUpdateFunds: (funds: VirtualSinkingFund[]) => void;
  onUpdateRecurring: (expenses: RecurringExpense[]) => void;
}

export const SinkingFundsView: React.FC<SinkingFundsViewProps> = ({
  recurringExpenses,
  sinkingFunds,
  onUpdateFunds,
  onUpdateRecurring,
}) => {
  const { t, formatCurrency, formatDate } = useTranslation();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRebalanceModalOpen, setIsRebalanceModalOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // New Fund State
  const [newName, setNewName] = useState('');
  const [newPayee, setNewPayee] = useState('');
  const [newAmount, setNewAmount] = useState(600);
  const [newFrequency, setNewFrequency] = useState<Frequency>('annually');
  const [newTargetDate, setNewTargetDate] = useState('2027-04-15');

  // Rebalance State
  const [sourceFundId, setSourceFundId] = useState(sinkingFunds[0]?.id || '');
  const [targetFundId, setTargetFundId] = useState(sinkingFunds[1]?.id || '');
  const [rebalanceAmount, setRebalanceAmount] = useState(100);

  const totalVaultBalance = sinkingFunds.reduce((sum, f) => sum + f.currentBalance, 0);
  const totalMonthlyProvisions = sinkingFunds.reduce(
    (sum, f) => sum + f.monthlyAccrualRate,
    0
  );

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  // Simulate an incoming annual bank debit offset
  const handleSimulateDebit = (fundId: string) => {
    const fund = sinkingFunds.find((f) => f.id === fundId);
    if (!fund) return;

    const nextYear = new Date(fund.targetDate);
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const nextTargetDate = nextYear.toISOString().split('T')[0];

    const result = AccrualCalculator.offsetDebit(
      fund,
      fund.targetAmount,
      nextTargetDate
    );

    const updatedList = sinkingFunds.map((f) =>
      f.id === fundId ? result.updatedFund : f
    );
    onUpdateFunds(updatedList);

    showNotification(
      t('notifications.debitOffsetSuccess', {
        amount: formatCurrency(fund.targetAmount),
        fund: fund.name,
        remaining: formatCurrency(result.remainingBalance),
        nextDate: formatDate(nextTargetDate),
      })
    );
  };

  // Add a monthly accrual step (+1 month provision to all funds)
  const handleSimulateMonthlyAccrual = () => {
    const updated = sinkingFunds.map((f) => ({
      ...f,
      currentBalance: Number((f.currentBalance + f.monthlyAccrualRate).toFixed(2)),
      lastAccruedAt: new Date().toISOString(),
    }));
    onUpdateFunds(updated);
    showNotification(
      t('notifications.monthlyAccrualSuccess', {
        amount: formatCurrency(totalMonthlyProvisions),
      })
    );
  };

  // Rebalance
  const handleRebalance = () => {
    const source = sinkingFunds.find((f) => f.id === sourceFundId);
    const target = sinkingFunds.find((f) => f.id === targetFundId);
    if (!source || !target || source.id === target.id) return;

    try {
      const { source: newSource, target: newTarget } = AccrualCalculator.reallocate(
        source,
        target,
        rebalanceAmount
      );
      const updated = sinkingFunds.map((f) => {
        if (f.id === newSource.id) return newSource;
        if (f.id === newTarget.id) return newTarget;
        return f;
      });
      onUpdateFunds(updated);
      setIsRebalanceModalOpen(false);
      showNotification(
        t('notifications.rebalanceSuccess', {
          amount: formatCurrency(rebalanceAmount),
          source: source.name,
          target: target.name,
        })
      );
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Create new fund
  const handleCreateFund = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;

    const monthlyProvision = AccrualCalculator.calculateMonthlyEquivalent(
      newAmount,
      newFrequency
    );

    const recId = `rec-${Date.now()}`;
    const fundId = `fund-${Date.now()}`;

    const newRec: RecurringExpense = {
      id: recId,
      tenantId: 'tenant-01',
      budgetId: 'b-sinking',
      name: newName,
      payee: newPayee || newName,
      frequency: newFrequency,
      amount: newAmount,
      currentMonthlyProvision: monthlyProvision,
      nextDueDate: newTargetDate,
      startDate: new Date().toISOString().split('T')[0],
      sinkingFundId: fundId,
    };

    const newFund: VirtualSinkingFund = {
      id: fundId,
      tenantId: 'tenant-01',
      recurringExpenseId: recId,
      name: newName,
      targetAmount: newAmount,
      currentBalance: 0,
      monthlyAccrualRate: monthlyProvision,
      targetDate: newTargetDate,
      lastAccruedAt: new Date().toISOString(),
      status: 'accruing',
      icon: 'PiggyBank',
    };

    onUpdateRecurring([...recurringExpenses, newRec]);
    onUpdateFunds([...sinkingFunds, newFund]);
    setIsAddModalOpen(false);
    setNewName('');
    showNotification(
      t('notifications.createdFundSuccess', {
        name: newName,
        rate: formatCurrency(monthlyProvision),
      })
    );
  };

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case 'Car':
        return Car;
      case 'Flame':
        return Flame;
      case 'Palmtree':
        return Palmtree;
      case 'Landmark':
        return Landmark;
      default:
        return PiggyBank;
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-40 max-w-md bg-emerald-950 border border-emerald-500/30 text-emerald-200 text-xs p-4 rounded-xl shadow-2xl flex items-start space-x-2 animate-in slide-in-from-bottom duration-200">
          <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900 border border-indigo-500/20 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold uppercase tracking-wider">
                {t('sinkingFunds.bannerTag')}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {t('sinkingFunds.bannerSubtag')}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              {t('sinkingFunds.bannerTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              {t('sinkingFunds.bannerDesc')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSimulateMonthlyAccrual}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Simulate 1 month passing and accruing provisions"
            >
              <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t('sinkingFunds.simulateAccrualBtn')}</span>
            </button>
            <button
              onClick={() => setIsRebalanceModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t('sinkingFunds.rebalanceBtn')}</span>
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('sinkingFunds.newFundBtn')}</span>
            </button>
          </div>
        </div>

        {/* Global Summary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-5 border-t border-slate-800/80">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
            <span className="text-xs text-slate-400">{t('sinkingFunds.totalVaultReserve')}</span>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
              {formatCurrency(totalVaultBalance)}
            </div>
            <span className="text-[10px] text-slate-500">
              {t('sinkingFunds.earmarkedAcross', { count: sinkingFunds.length })}
            </span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
            <span className="text-xs text-slate-400">{t('sinkingFunds.monthlyAccrualRate')}</span>
            <div className="text-xl font-bold font-mono text-indigo-400 mt-0.5">
              {formatCurrency(totalMonthlyProvisions)}
              <span className="text-xs text-slate-400 font-normal"> / month</span>
            </div>
            <span className="text-[10px] text-slate-500">
              {t('sinkingFunds.smoothlyAbsorbed')}
            </span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
            <span className="text-xs text-slate-400">{t('sinkingFunds.nextUpcomingDebit')}</span>
            <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">
              {formatDate('2026-11-15', 'medium')}
            </div>
            <span className="text-[10px] text-emerald-400 font-medium">
              {t('sinkingFunds.districtHeatingNotice')}
            </span>
          </div>
        </div>
      </div>

      {/* Sinking Funds Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sinkingFunds.map((fund) => {
          const rec = recurringExpenses.find((r) => r.id === fund.recurringExpenseId);
          const projection = AccrualCalculator.projectFund(fund);
          const Icon = getIconComponent(fund.icon);

          return (
            <div
              key={fund.id}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all shadow-sm flex flex-col justify-between"
            >
              <div>
                {/* Card Header */}
                <div className="flex items-start justify-between pb-3 border-b border-slate-800 mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-100">{fund.name}</h4>
                      <p className="text-xs text-slate-400 font-mono">
                        {t('sinkingFunds.frequency')}: {rec?.frequency || 'annually'} • {t('sinkingFunds.payee')}: {rec?.payee || fund.name}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-medium ${
                      fund.currentBalance >= fund.targetAmount
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                    }`}
                  >
                    {t('sinkingFunds.fundedPercent', { percent: projection.percentageFunded })}
                  </span>
                </div>

                {/* Balance & Progress */}
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-xs text-slate-400">{t('sinkingFunds.accruedVirtualBalance')}</span>
                      <div className="text-2xl font-extrabold font-mono text-slate-100">
                        {formatCurrency(fund.currentBalance)}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-400">{t('sinkingFunds.targetBill')}</span>
                      <div className="text-sm font-mono text-slate-300 font-semibold">
                        {formatCurrency(fund.targetAmount)}
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        projection.percentageFunded >= 100
                          ? 'bg-emerald-500'
                          : 'bg-gradient-to-r from-indigo-500 to-emerald-400'
                      }`}
                      style={{ width: `${Math.min(100, projection.percentageFunded)}%` }}
                    />
                  </div>

                  {/* Metrics Row */}
                  <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                    <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                      <span className="text-slate-400 block text-[11px]">{t('sinkingFunds.monthlyProvision')}</span>
                      <span className="font-mono text-indigo-400 font-semibold">
                        +{formatCurrency(fund.monthlyAccrualRate)} / mo
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                      <span className="text-slate-400 block text-[11px]">{t('sinkingFunds.dueDate')}</span>
                      <span className="font-mono text-slate-300 font-medium">
                        {formatDate(fund.targetDate)} ({t('sinkingFunds.monthsLeft', { count: projection.monthsUntilDue })})
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Offset Action */}
              <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {t('sinkingFunds.billArrivesPrompt')}
                </span>
                <button
                  onClick={() => handleSimulateDebit(fund.id)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Play className="w-3 h-3 text-indigo-400" />
                  <span>{t('sinkingFunds.simulateDebitOffsetBtn')}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Sinking Fund Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6">
            <h3 className="text-base font-bold text-slate-100 mb-1 flex items-center space-x-2">
              <CalendarClock className="w-5 h-5 text-indigo-400" />
              <span>{t('sinkingFunds.createModalTitle')}</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              {t('sinkingFunds.createModalSubtitle')}
            </p>

            <form onSubmit={handleCreateFund} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('sinkingFunds.fundNameLabel')}
                </label>
                <input
                  type="text"
                  placeholder={t('sinkingFunds.fundNamePlaceholder')}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('sinkingFunds.targetAmountLabel')}
                  </label>
                  <input
                    type="number"
                    step="10"
                    value={newAmount}
                    onChange={(e) => setNewAmount(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('sinkingFunds.frequencyLabel')}
                  </label>
                  <select
                    value={newFrequency}
                    onChange={(e) => setNewFrequency(e.target.value as Frequency)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="weekly">Weekly (x52/12)</option>
                    <option value="bi_monthly">Bi-Monthly (/2)</option>
                    <option value="quarterly">Quarterly (/3)</option>
                    <option value="semi_annually">Semi-Annually (/6)</option>
                    <option value="annually">Annually (/12)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('sinkingFunds.targetDueDateLabel')}
                </label>
                <input
                  type="date"
                  value={newTargetDate}
                  onChange={(e) => setNewTargetDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              {/* Live Computed Monthly Provision */}
              <div className="p-3 bg-indigo-950/40 border border-indigo-500/20 rounded-xl text-xs text-slate-300 flex items-center justify-between">
                <span>{t('sinkingFunds.calculatedMonthlyProvision')}</span>
                <span className="font-mono text-sm font-bold text-emerald-400">
                  {formatCurrency(
                    AccrualCalculator.calculateMonthlyEquivalent(
                      newAmount,
                      newFrequency
                    )
                  )}{' '}
                  / month
                </span>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {t('sinkingFunds.cancelBtn')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow cursor-pointer"
                >
                  {t('sinkingFunds.saveFundBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rebalance Modal */}
      {isRebalanceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6">
            <h3 className="text-base font-bold text-slate-100 mb-1 flex items-center space-x-2">
              <ArrowRightLeft className="w-5 h-5 text-indigo-400" />
              <span>{t('sinkingFunds.rebalanceModalTitle')}</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              {t('sinkingFunds.rebalanceModalSubtitle')}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('sinkingFunds.sourceFundLabel')}
                </label>
                <select
                  value={sourceFundId}
                  onChange={(e) => setSourceFundId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
                >
                  {sinkingFunds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({t('sinkingFunds.balance')}: {formatCurrency(f.currentBalance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('sinkingFunds.targetFundLabel')}
                </label>
                <select
                  value={targetFundId}
                  onChange={(e) => setTargetFundId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
                >
                  {sinkingFunds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({t('sinkingFunds.balance')}: {formatCurrency(f.currentBalance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('sinkingFunds.transferAmountLabel')}
                </label>
                <input
                  type="number"
                  step="25"
                  value={rebalanceAmount}
                  onChange={(e) => setRebalanceAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 font-mono"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRebalanceModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {t('sinkingFunds.cancelBtn')}
                </button>
                <button
                  type="button"
                  onClick={handleRebalance}
                  className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow cursor-pointer"
                >
                  {t('sinkingFunds.confirmTransferBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
