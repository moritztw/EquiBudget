import React, {useEffect, useState} from 'react';
import {I18nProvider, useI18n} from './i18n/I18nContext';
import {HouseholdProvider, useHouseholdStore} from './store/useHouseholdStore';
import {ScheduleMatrixView} from './components/ScheduleMatrixView';
import {AllocationView} from './components/AllocationView';
import {SinkingFundsView} from './components/SinkingFundsView';
import {StatementImportView} from './components/StatementImportView';
import {MasterDataView} from './components/MasterDataView';
import {NewPlannedPaymentModal} from './components/NewPlannedPaymentModal';
import {InitialSetupWizard} from './components/InitialSetupWizard';
import {OfflineIndicator, PWAInstallButton} from './pwa/PWAWidgets';
import {PlannedPayment, SplitStrategy} from './domain/types';

type ActiveRoute =
  | 'schedule'
  | 'transactions'
  | 'allocation'
  | 'pots'
  | 'master';

const EquiBudgetShell: React.FC = () => {
  const {locale, setLocale, t} = useI18n();
  const {
    instanceMode,
    openSetupWizard,
    tenants,
    activeTenant,
    setActiveTenantId,
    updateTenantStrategy,
    referenceMonthKey,
    setReferenceMonthKey,
  } = useHouseholdStore();

  const [activeRoute, setActiveRoute] = useState<ActiveRoute>('schedule');
  const [isDark, setIsDark] = useState<boolean>(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [editingPayment, setEditingPayment] = useState<PlannedPayment | null>(null);
  const [preselectedSourcePotId, setPreselectedSourcePotId] = useState<string | null>(
    null
  );

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  const navItems: Array<{id: ActiveRoute; label: string}> = [
    {id: 'schedule', label: t('nav.schedule')},
    {id: 'transactions', label: t('nav.transactions')},
    {id: 'allocation', label: t('nav.allocation')},
    {id: 'pots', label: t('nav.pots')},
    {id: 'master', label: t('nav.master')},
  ];

  const handleOpenCreateModal = () => {
    setEditingPayment(null);
    setIsPaymentModalOpen(true);
  };

  const handleOpenEditModal = (payment: PlannedPayment) => {
    setEditingPayment(payment);
    setIsPaymentModalOpen(true);
  };

  const handleJumpToReallocatePot = (sourcePaymentId: string) => {
    setPreselectedSourcePotId(sourcePaymentId);
    setActiveRoute('pots');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar: [Brand] — [Primary Nav] — [Single Primary CTA] */}
      <header className="sticky top-0 z-30 h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1600px] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveRoute('schedule')}
            className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            EquiBudget
          </button>

          <nav
            aria-label="Hauptnavigation"
            className="flex items-center gap-6 overflow-x-auto no-scrollbar"
          >
            {navItems.map((item) => {
              const active = activeRoute === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveRoute(item.id)}
                  className={`py-4 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                    active
                      ? 'border-teal-700 dark:border-teal-400 text-teal-800 dark:text-teal-300 font-semibold'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-3.5 py-1.5 text-xs font-semibold rounded bg-teal-700 hover:bg-teal-800 text-white whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            {t('cta.newPayment')}
          </button>
        </div>
      </header>

      {/* Secondary ERP Workspace Context Bar (Tenant, Plan Month, Strategy, Locale, Theme, PWA) */}
      <div className="bg-slate-100/90 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span className="font-medium">{t('toolbar.household')}:</span>
              <select
                value={activeTenant.id}
                onChange={(e) => setActiveTenantId(e.target.value)}
                className="px-2 py-0.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100 font-medium"
              >
                {tenants.map((ten) => (
                  <option key={ten.id} value={ten.id}>
                    {ten.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span className="font-medium">{t('toolbar.referenceMonth')}:</span>
              <input
                type="month"
                value={referenceMonthKey}
                onChange={(e) =>
                  e.target.value && setReferenceMonthKey(e.target.value)
                }
                className="px-2 py-0.5 font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="hidden md:inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span className="font-medium">{t('toolbar.strategy')}:</span>
              <select
                value={activeTenant.defaultSplitStrategy}
                onChange={(e) =>
                  updateTenantStrategy(e.target.value as SplitStrategy)
                }
                className="px-2 py-0.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
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
            </label>
          </div>

          <div className="flex items-center gap-2">
            {instanceMode !== 'PRODUCTION' && (
              <button
                type="button"
                onClick={openSetupWizard}
                className="px-2.5 py-0.5 text-[11px] font-semibold rounded border border-teal-600/70 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/50 cursor-pointer"
              >
                {t('setup.toolbarLaunch')}
              </button>
            )}

            <PWAInstallButton />

            <div className="inline-flex rounded border border-slate-300 dark:border-slate-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setLocale('de-DE')}
                className={`px-2 py-0.5 text-[11px] font-mono cursor-pointer ${
                  locale === 'de-DE'
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 font-semibold'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                }`}
              >
                DE
              </button>
              <button
                type="button"
                onClick={() => setLocale('en-US')}
                className={`px-2 py-0.5 text-[11px] font-mono cursor-pointer ${
                  locale === 'en-US'
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 font-semibold'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                }`}
              >
                EN
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsDark((prev) => !prev)}
              className="px-2.5 py-0.5 text-[11px] font-medium rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {isDark ? t('toolbar.themeLight') : t('toolbar.themeDark')}
            </button>
          </div>
        </div>
      </div>

      {/* Main ERP Workspace Viewport */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-4">
        {activeRoute === 'schedule' && (
          <ScheduleMatrixView
            onOpenEditModal={handleOpenEditModal}
            onJumpToReallocatePot={handleJumpToReallocatePot}
          />
        )}
        {activeRoute === 'transactions' && <StatementImportView />}
        {activeRoute === 'allocation' && <AllocationView />}
        {activeRoute === 'pots' && (
          <SinkingFundsView preselectedSourcePotId={preselectedSourcePotId} />
        )}
        {activeRoute === 'master' && <MasterDataView />}
      </main>

      <NewPlannedPaymentModal
        isOpen={isPaymentModalOpen}
        editingPayment={editingPayment}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setEditingPayment(null);
        }}
      />
      <InitialSetupWizard />
      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <I18nProvider>
      <HouseholdProvider>
        <EquiBudgetShell />
      </HouseholdProvider>
    </I18nProvider>
  );
}
