import React from 'react';
import { AllocationCalculationResult, IncomeSource, Person } from '../types/household';
import { useTranslation } from '../i18n/I18nContext';

interface CashflowSankeyProps {
  calculation: AllocationCalculationResult;
  incomes: IncomeSource[];
  persons: Person[];
}

export const CashflowSankey: React.FC<CashflowSankeyProps> = ({
  calculation,
  incomes,
  persons,
}) => {
  const { t, formatCurrency } = useTranslation();

  const {
    totalNetIncome,
    totalSharedExpenses,
    totalDiscretionaryPool,
    earnerSplits,
  } = calculation;

  if (totalNetIncome <= 0) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        No income data available to render cashflow diagram.
      </div>
    );
  }

  // Width & height coordinate system
  const width = 860;
  const height = 340;

  // X Coordinates of the 3 columns
  const col1X = 20; // Incomes
  const col2X = 350; // Joint Household Pool
  const col3X = 660; // Destinations (Shared Expenses + Individual Discretionary)
  const nodeWidth = 140;

  // Vertical distributions
  const activeIncomes = incomes.filter((i) => i.isActive);
  const leftNodeHeight = 44;
  const leftSpacing = 16;
  const leftTotalHeight = activeIncomes.length * leftNodeHeight + (activeIncomes.length - 1) * leftSpacing;
  const leftStartY = Math.max(20, (height - leftTotalHeight) / 2);

  // Center node: Household Pool
  const centerNodeHeight = 110;
  const centerY = (height - centerNodeHeight) / 2;

  // Right nodes
  const rightItems = [
    {
      id: 'shared-expenses',
      label: t('cashflow.sharedExpensesLabel'),
      amount: totalSharedExpenses,
      color: '#3b82f6', // Blue
      sub: t('cashflow.sharedSub', {
        percent: ((totalSharedExpenses / totalNetIncome) * 100).toFixed(1),
      }),
    },
    ...earnerSplits.map((split) => {
      const person = persons.find((p) => p.id === split.personId);
      return {
        id: `pocket-${split.personId}`,
        label: t('cashflow.discretionaryLabel', { name: split.personName }),
        amount: split.discretionaryRemaining,
        color: person?.color || '#10b981',
        sub: t('cashflow.pocketMoneySub'),
      };
    }),
  ];

  const rightNodeHeight = 46;
  const rightSpacing = 12;
  const rightTotalHeight = rightItems.length * rightNodeHeight + (rightItems.length - 1) * rightSpacing;
  const rightStartY = Math.max(16, (height - rightTotalHeight) / 2);

  const makeCurvedPath = (
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ) => {
    const cx1 = x1 + (x2 - x1) * 0.45;
    const cy1 = y1;
    const cx2 = x1 + (x2 - x1) * 0.55;
    const cy2 = y2;
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  };

  return (
    <div className="w-full bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 sm:p-6 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800/60 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center space-x-2">
            <span>{t('cashflow.sankeyTitle')}</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {t('cashflow.sankeyBadge')}
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {t('cashflow.sankeyDesc')}
          </p>
        </div>
        <div className="mt-2 sm:mt-0 flex items-center space-x-4 text-xs font-mono text-slate-400">
          <div>
            {t('cashflow.totalPool')}:{' '}
            <span className="text-emerald-400 font-bold">
              {formatCurrency(totalNetIncome)}
            </span>
          </div>
          <div>
            {t('cashflow.discretionaryPool')}:{' '}
            <span className="text-indigo-400 font-bold">
              {formatCurrency(totalDiscretionaryPool)}
            </span>
          </div>
        </div>
      </div>

      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-w-[760px] select-none"
          style={{ maxHeight: '380px' }}
        >
          <defs>
            <linearGradient id="grad-left-center" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="grad-center-right-shared" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.4" />
            </linearGradient>
            <linearGradient id="grad-center-right-pocket" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.4" />
            </linearGradient>
          </defs>

          {/* Left -> Center Links */}
          {activeIncomes.map((inc, index) => {
            const startY = leftStartY + index * (leftNodeHeight + leftSpacing) + leftNodeHeight / 2;
            const targetY = centerY + 20 + (index / Math.max(1, activeIncomes.length - 1)) * (centerNodeHeight - 40);
            return (
              <path
                key={`left-path-${inc.id}`}
                d={makeCurvedPath(col1X + nodeWidth, startY, col2X, targetY)}
                fill="none"
                stroke="url(#grad-left-center)"
                strokeWidth={Math.max(3, (inc.netAmount / totalNetIncome) * 36)}
                strokeLinecap="round"
                className="transition-all duration-300 hover:opacity-90 opacity-70"
              />
            );
          })}

          {/* Center -> Right Links */}
          {rightItems.map((item, index) => {
            const startY = centerY + 20 + (index / Math.max(1, rightItems.length - 1)) * (centerNodeHeight - 40);
            const targetY = rightStartY + index * (rightNodeHeight + rightSpacing) + rightNodeHeight / 2;
            const isShared = item.id === 'shared-expenses';
            return (
              <path
                key={`right-path-${item.id}`}
                d={makeCurvedPath(col2X + nodeWidth + 20, startY, col3X, targetY)}
                fill="none"
                stroke={isShared ? 'url(#grad-center-right-shared)' : 'url(#grad-center-right-pocket)'}
                strokeWidth={Math.max(3, (Math.max(0, item.amount) / totalNetIncome) * 36)}
                strokeLinecap="round"
                className="transition-all duration-300 hover:opacity-90 opacity-70"
              />
            );
          })}

          {/* Left Nodes: Income Sources */}
          {activeIncomes.map((inc, index) => {
            const y = leftStartY + index * (leftNodeHeight + leftSpacing);
            const isGlobal = inc.personId === null;
            return (
              <g key={`income-node-${inc.id}`} transform={`translate(${col1X}, ${y})`}>
                <rect
                  width={nodeWidth}
                  height={leftNodeHeight}
                  rx={8}
                  className="fill-slate-900 stroke-slate-700/80 hover:stroke-indigo-500/80 transition-colors"
                  strokeWidth={1.5}
                />
                <text x={10} y={18} className="fill-slate-200 text-[11px] font-semibold">
                  {inc.name.length > 17 ? inc.name.slice(0, 16) + '…' : inc.name}
                </text>
                <text x={10} y={34} className="fill-emerald-400 font-mono text-[11px] font-bold">
                  +{formatCurrency(inc.netAmount)}
                </text>
                <text x={nodeWidth - 10} y={34} textAnchor="end" className="fill-slate-500 font-mono text-[9px]">
                  {isGlobal ? 'Global' : 'Net'}
                </text>
              </g>
            );
          })}

          {/* Center Node: Joint Household Pool */}
          <g transform={`translate(${col2X}, ${centerY})`}>
            <rect
              width={nodeWidth + 20}
              height={centerNodeHeight}
              rx={12}
              className="fill-indigo-950/60 stroke-indigo-500/60"
              strokeWidth={2}
            />
            <text x={(nodeWidth + 20) / 2} y={26} textAnchor="middle" className="fill-indigo-300 text-xs font-bold uppercase tracking-wider">
              {t('cashflow.bannerTag')}
            </text>
            <text x={(nodeWidth + 20) / 2} y={54} textAnchor="middle" className="fill-slate-100 font-mono text-lg font-extrabold">
              {formatCurrency(totalNetIncome)}
            </text>
            <text x={(nodeWidth + 20) / 2} y={72} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {t('cashflow.pooledInflow')}
            </text>
            <line
              x1={15}
              y1={82}
              x2={nodeWidth + 5}
              y2={82}
              className="stroke-indigo-500/30"
              strokeWidth={1}
            />
            <text x={(nodeWidth + 20) / 2} y={98} textAnchor="middle" className="fill-emerald-400 font-mono text-[10px]">
              {t('cashflow.earnersCount', { count: earnerSplits.length })}
            </text>
          </g>

          {/* Right Nodes: Destinations */}
          {rightItems.map((item, index) => {
            const y = rightStartY + index * (rightNodeHeight + rightSpacing);
            const isShared = item.id === 'shared-expenses';
            return (
              <g key={`dest-node-${item.id}`} transform={`translate(${col3X}, ${y})`}>
                <rect
                  width={nodeWidth + 40}
                  height={rightNodeHeight}
                  rx={8}
                  className={`fill-slate-900 transition-colors ${
                    isShared
                      ? 'stroke-blue-500/60 hover:stroke-blue-400'
                      : 'stroke-emerald-500/60 hover:stroke-emerald-400'
                  }`}
                  strokeWidth={1.5}
                />
                <text x={10} y={18} className="fill-slate-200 text-[11px] font-semibold">
                  {item.label.length > 21 ? item.label.slice(0, 20) + '…' : item.label}
                </text>
                <text
                  x={10}
                  y={34}
                  className={`font-mono text-[11px] font-bold ${
                    isShared ? 'fill-blue-400' : 'fill-emerald-400'
                  }`}
                >
                  {formatCurrency(Math.max(0, item.amount))}
                </text>
                <text
                  x={nodeWidth + 30}
                  y={34}
                  textAnchor="end"
                  className="fill-slate-500 font-mono text-[9px]"
                >
                  {isShared ? 'Shared' : 'Pocket'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
