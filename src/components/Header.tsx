import React from 'react';
import {
  ShieldCheck,
  Users,
  Wallet,
  CalendarClock,
  ArrowRightLeft,
  BookOpen,
  Building2,
  Layers,
} from 'lucide-react';
import { Tenant, User } from '../types/household';
import { useTranslation } from '../i18n/I18nContext';
import { LanguageSwitcher } from './LanguageSwitcher';

interface HeaderProps {
  currentTenant: Tenant;
  tenants: Tenant[];
  onSelectTenant: (tenant: Tenant) => void;
  currentUser: User;
  onOpenAuthModal: () => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  unmatchedTxCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTenant,
  tenants,
  onSelectTenant,
  currentUser,
  onOpenAuthModal,
  activeTab,
  onSelectTab,
  unmatchedTxCount,
}) => {
  const { t } = useTranslation();

  const tabs = [
    {
      id: 'cashflow',
      label: t('nav.cashflow'),
      icon: ArrowRightLeft,
      badge: t('nav.equalRemainingBadge'),
    },
    {
      id: 'sinking_funds',
      label: t('nav.sinkingFunds'),
      icon: CalendarClock,
      badge: t('nav.provisionsBadge'),
    },
    {
      id: 'transactions',
      label: t('nav.transactions'),
      icon: Layers,
      badge:
        unmatchedTxCount > 0
          ? t('nav.pendingBadge', { count: unmatchedTxCount })
          : undefined,
    },
    {
      id: 'accounts',
      label: t('nav.accounts'),
      icon: Wallet,
    },
    {
      id: 'blueprint',
      label: t('nav.blueprint'),
      icon: BookOpen,
      badge: t('nav.specBadge'),
      highlight: true,
    },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-900/95 sticky top-0 z-30 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top bar */}
        <div className="flex items-center justify-between h-16 border-b border-slate-800/60">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-400 p-[1.5px] flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <div className="h-full w-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <span className="font-extrabold text-transparent bg-clip-text bg-gradient-to-tr from-indigo-400 to-emerald-300 text-base">
                  Eq
                </span>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-bold text-slate-100 tracking-tight text-base sm:text-lg">
                  {t('app.title')}
                </h1>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  {t('app.version')}
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                {t('app.subtitle')}
              </p>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Language Switcher (EN / DE) */}
            <LanguageSwitcher />

            {/* Household / Tenant selector */}
            <div className="relative flex items-center bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
              <Building2 className="w-3.5 h-3.5 text-indigo-400 mr-2" />
              <select
                aria-label="Select active household"
                value={currentTenant.id}
                onChange={(e) => {
                  const found = tenants.find((t) => t.id === e.target.value);
                  if (found) onSelectTenant(found);
                }}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer pr-3 font-medium text-xs"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id} className="bg-slate-900 text-slate-200">
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Reverse Proxy / Forward Auth Badge */}
            <button
              onClick={onOpenAuthModal}
              className="group flex items-center space-x-2 px-2.5 sm:px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-900/50 hover:border-indigo-400/50 transition-all text-xs cursor-pointer shadow-sm"
              title="Inspect Forward-Auth Proxy Headers"
            >
              <div className="relative">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </div>
              <span className="font-mono text-[11px] max-w-[130px] truncate hidden md:inline">
                {currentUser.email}
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                {t('auth.badgeTitle')}
              </span>
            </button>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex space-x-1 sm:space-x-2 overflow-x-auto py-2 no-scrollbar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                } ${tab.highlight && !isActive ? 'border border-indigo-500/30 text-indigo-300' : ''}`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-medium ${
                      isActive
                        ? 'bg-indigo-950 text-indigo-200'
                        : tab.badge.includes('offen') || tab.badge.includes('pending')
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
