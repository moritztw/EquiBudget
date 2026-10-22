import React from 'react';
import {
  Wallet,
} from 'lucide-react';
import { Account, Person, VirtualSinkingFund } from '../../types/household';
import { useTranslation } from '../../i18n/I18nContext';

interface AccountsViewProps {
  accounts: Account[];
  persons: Person[];
  sinkingFunds: VirtualSinkingFund[];
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  accounts,
  persons,
  sinkingFunds,
}) => {
  const { t, formatCurrency } = useTranslation();

  const totalVirtualEarmarked = sinkingFunds.reduce((sum, f) => sum + f.currentBalance, 0);

  // Joint physical accounts total
  const jointPhysicalAccounts = accounts.filter((a) => a.personId === null);
  const jointPhysicalCash = jointPhysicalAccounts.reduce(
    (sum, a) => sum + a.currentBalance,
    0
  );

  const freeUncommittedCash = jointPhysicalCash - totalVirtualEarmarked;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900 border border-indigo-500/20 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
                {t('accounts.bannerTag')}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {t('accounts.bannerSubtag')}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              {t('accounts.bannerTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              {t('accounts.bannerDesc')}
            </p>
          </div>
        </div>

        {/* 3-Stat Reconciliation Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-5 border-t border-slate-800">
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
            <span className="text-xs text-slate-400">{t('accounts.totalJointPhysical')}</span>
            <div className="text-xl font-bold font-mono text-slate-100 mt-0.5">
              {formatCurrency(jointPhysicalCash)}
            </div>
            <span className="text-[10px] text-slate-500">
              {t('accounts.jointAccountsNotice')}
            </span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
            <span className="text-xs text-slate-400">{t('accounts.earmarkedInSinking')}</span>
            <div className="text-xl font-bold font-mono text-indigo-400 mt-0.5">
              {formatCurrency(totalVirtualEarmarked)}
            </div>
            <span className="text-[10px] text-slate-500">
              {t('accounts.lockedForUpcoming')}
            </span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
            <span className="text-xs text-slate-400">{t('accounts.freeOperationalBuffer')}</span>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
              {formatCurrency(freeUncommittedCash)}
            </div>
            <span className="text-[10px] text-emerald-500/80">
              {t('accounts.uncommittedReady')}
            </span>
          </div>
        </div>
      </div>

      {/* Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((acc) => {
          const person = persons.find((p) => p.id === acc.personId);
          const isJoint = acc.personId === null;

          return (
            <div
              key={acc.id}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all shadow-sm"
            >
              <div className="flex items-start justify-between pb-3 border-b border-slate-800 mb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-indigo-400">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100">{acc.name}</h4>
                    <span className="text-xs text-slate-400 font-mono">
                      {acc.institution} • {acc.type.toUpperCase()}
                    </span>
                  </div>
                </div>

                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    isJoint
                      ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'
                      : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  }`}
                >
                  {isJoint
                    ? t('accounts.jointHousehold')
                    : t('accounts.personalAccount', { name: person?.name || '' })}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-slate-400">{t('accounts.currentBalance')}</span>
                    <div className="text-2xl font-bold font-mono text-slate-100">
                      {formatCurrency(acc.currentBalance)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-500 font-mono block">{t('accounts.iban')}</span>
                    <span className="text-xs text-slate-400 font-mono">{acc.ibanOrMask}</span>
                  </div>
                </div>

                {isJoint && (
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-400 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span>{t('accounts.backingVirtualFunds')}</span>
                      <span className="font-mono text-indigo-300">
                        {formatCurrency(totalVirtualEarmarked)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span>{t('accounts.freeUnallocatedBuffer')}</span>
                      <span className="font-mono text-emerald-400">
                        {formatCurrency(freeUncommittedCash)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
