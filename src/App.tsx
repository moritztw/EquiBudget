import React, { useState } from 'react';
import {
  initialAccounts,
  initialBudgets,
  initialImportTemplates,
  initialIncomes,
  initialMatchingRules,
  initialPersons,
  initialRecurringExpenses,
  initialSinkingFunds,
  initialTenants,
  initialUsers,
  sampleImportedTransactions,
} from './data/mockInitialData';
import {
  Account,
  Budget,
  IncomeSource,
  Person,
  RecurringExpense,
  Tenant,
  Transaction,
  User,
  VirtualSinkingFund,
} from './types/household';
import { Header } from './components/Header';
import { ProxyAuthModal } from './components/ProxyAuthModal';
import { CashflowView } from './components/views/CashflowView';
import { SinkingFundsView } from './components/views/SinkingFundsView';
import { TransactionImportView } from './components/views/TransactionImportView';
import { AccountsView } from './components/views/AccountsView';
import { BlueprintView } from './components/views/BlueprintView';
import { I18nProvider, useTranslation } from './i18n/I18nContext';

function BudgetAppContent() {
  const { t } = useTranslation();

  const [tenants] = useState<Tenant[]>(initialTenants);
  const [currentTenant, setCurrentTenant] = useState<Tenant>(initialTenants[0]);
  const [currentUser, setCurrentUser] = useState<User>(initialUsers[0]);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('cashflow');

  // Multi-Tenant Household State
  const [persons, setPersons] = useState<Person[]>(initialPersons);
  const [incomes, setIncomes] = useState<IncomeSource[]>(initialIncomes);
  const [budgets, setBudgets] = useState<Budget[]>(initialBudgets);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>(
    initialRecurringExpenses
  );
  const [sinkingFunds, setSinkingFunds] =
    useState<VirtualSinkingFund[]>(initialSinkingFunds);
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [transactions, setTransactions] = useState<Transaction[]>(
    sampleImportedTransactions
  );

  // Switch household
  const handleSelectTenant = (tenant: Tenant) => {
    setCurrentTenant(tenant);
    if (tenant.id === 'tenant-02') {
      // Switch to WG Kreuzberg data
      const wgPersons: Person[] = [
        {
          id: 'p-felix',
          tenantId: 'tenant-02',
          name: 'Felix',
          avatar: '🧑‍🎨',
          color: '#6366f1',
          isEarner: true,
          notes: 'UX Designer (Freelance)',
        },
        {
          id: 'p-maya',
          tenantId: 'tenant-02',
          name: 'Maya',
          avatar: '👩‍💼',
          color: '#10b981',
          isEarner: true,
          notes: 'Junior Product Manager',
        },
        {
          id: 'p-jonas',
          tenantId: 'tenant-02',
          name: 'Jonas',
          avatar: '👨‍🔧',
          color: '#f59e0b',
          isEarner: true,
          notes: 'Biotech Trainee',
        },
      ];
      const wgIncomes: IncomeSource[] = [
        {
          id: 'inc-felix',
          tenantId: 'tenant-02',
          personId: 'p-felix',
          name: 'Felix Net Monthly',
          grossAmount: 4200,
          netAmount: 2900,
          frequency: 'monthly',
          isActive: true,
        },
        {
          id: 'inc-maya',
          tenantId: 'tenant-02',
          personId: 'p-maya',
          name: 'Maya Net Monthly',
          grossAmount: 3600,
          netAmount: 2350,
          frequency: 'monthly',
          isActive: true,
        },
        {
          id: 'inc-jonas',
          tenantId: 'tenant-02',
          personId: 'p-jonas',
          name: 'Jonas Net Monthly',
          grossAmount: 2500,
          netAmount: 1800,
          frequency: 'monthly',
          isActive: true,
        },
      ];
      setPersons(wgPersons);
      setIncomes(wgIncomes);
    } else {
      // Revert to Miller-Schneider Household
      setPersons(initialPersons);
      setIncomes(initialIncomes);
    }
  };

  // Sinking Fund Offset Execution
  const handleOffsetSinkingFund = (fundId: string, amount: number) => {
    setSinkingFunds((prevFunds) =>
      prevFunds.map((fund) => {
        if (fund.id === fundId) {
          const remaining = Number((fund.currentBalance - amount).toFixed(2));
          return {
            ...fund,
            currentBalance: remaining,
            lastAccruedAt: new Date().toISOString(),
          };
        }
        return fund;
      })
    );
  };

  const unmatchedCount = transactions.filter((t) => t.status === 'unmatched').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <Header
        currentTenant={currentTenant}
        tenants={tenants}
        onSelectTenant={handleSelectTenant}
        currentUser={currentUser}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unmatchedTxCount={unmatchedCount}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {activeTab === 'cashflow' && (
          <CashflowView
            persons={persons}
            incomes={incomes}
            budgets={budgets}
            recurringExpenses={recurringExpenses}
            onUpdateIncomes={setIncomes}
          />
        )}

        {activeTab === 'sinking_funds' && (
          <SinkingFundsView
            recurringExpenses={recurringExpenses}
            sinkingFunds={sinkingFunds}
            onUpdateFunds={setSinkingFunds}
            onUpdateRecurring={setRecurringExpenses}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionImportView
            transactions={transactions}
            budgets={budgets}
            sinkingFunds={sinkingFunds}
            matchingRules={initialMatchingRules}
            importTemplates={initialImportTemplates}
            onUpdateTransactions={setTransactions}
            onOffsetSinkingFund={handleOffsetSinkingFund}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsView
            accounts={accounts}
            persons={persons}
            sinkingFunds={sinkingFunds}
          />
        )}

        {activeTab === 'blueprint' && <BlueprintView />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>
            {t('app.footer')}
          </p>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setActiveTab('blueprint')}
              className="hover:text-indigo-400 transition-colors cursor-pointer"
            >
              {t('nav.blueprint')}
            </button>
            <span>•</span>
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="hover:text-indigo-400 transition-colors cursor-pointer"
            >
              {t('auth.badgeTitle')}
            </button>
          </div>
        </div>
      </footer>

      {/* Reverse Proxy Forward-Auth Modal */}
      <ProxyAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onUpdateUser={setCurrentUser}
      />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BudgetAppContent />
    </I18nProvider>
  );
}
