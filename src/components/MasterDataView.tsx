import React, {useState} from 'react';
import {useI18n} from '../i18n/I18nContext';
import {useHouseholdStore} from '../store/useHouseholdStore';
import {AccountType} from '../domain/types';
import {equiBudgetApi} from '../api/apiClient';

export const MasterDataView: React.FC = () => {
  const {t, formatMoney} = useI18n();
  const {
    instanceMode,
    openSetupWizard,
    activateDemoMode,
    activeTenant,
    referenceMonthKey,
    persons,
    monthlyIncomes,
    accounts,
    categories,
    addPerson,
    addAccount,
    addCategory,
  } = useHouseholdStore();

  const [pName, setPName] = useState('');
  const [pRole, setPRole] = useState('');
  const [pEmployed, setPEmployed] = useState(true);
  const [pIncome, setPIncome] = useState('2500');
  const [pDed, setPDed] = useState('150');

  const [accName, setAccName] = useState('');
  const [accIban, setAccIban] = useState('');
  const [accType, setAccType] = useState<AccountType>(
    AccountType.JOINT_CHECKING
  );
  const [accBal, setAccBal] = useState('1000');

  const [catCode, setCatCode] = useState('');
  const [catName, setCatName] = useState('');

  const handleAddPerson = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName.trim()) return;
    addPerson(
      pName.trim(),
      pRole.trim() || 'Haushaltsmitglied',
      pEmployed,
      Math.max(0, Number(pIncome) || 0),
      Math.max(0, Number(pDed) || 0)
    );
    setPName('');
    setPRole('');
  };

  const handleAddAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) return;
    addAccount(
      accName.trim(),
      accIban.trim(),
      accType,
      Number(accBal.replace(',', '.')) || 0
    );
    setAccName('');
    setAccIban('');
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    addCategory(catCode.trim() || catName.trim().slice(0, 10), catName.trim());
    setCatCode('');
    setCatName('');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {t('master.title')}
        </h1>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {t('master.subtitle')}
        </p>
      </div>

      {/* Instance Setup & Clean-Slate Onboarding Control */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            Instanz-Modus:{' '}
            <span
              className={
                instanceMode === 'PRODUCTION'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }
            >
              {instanceMode === 'PRODUCTION'
                ? 'Eigene Produktiv-Instanz (ohne Testdaten)'
                : 'Demo-Umgebung mit Beispieldaten'}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
            Über den Setup-Assistenten kannst du die Instanz jederzeit komplett ohne Testdaten mit deinen eigenen Konten, Personen und Topf-Startguthaben neu initialisieren.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {instanceMode === 'PRODUCTION' && (
            <button
              type="button"
              onClick={activateDemoMode}
              className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Demo-Beispieldaten laden
            </button>
          )}
          <button
            type="button"
            onClick={openSetupWizard}
            className="px-3.5 py-1.5 rounded bg-teal-700 hover:bg-teal-800 text-white font-semibold cursor-pointer"
          >
            Setup-Assistent starten (Eigene Stammdaten & Topf-Startguthaben)
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Persons Master Data */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Personen im Haushalt ({persons.length})
            </h2>
            <span className="text-[11px] text-slate-500">
              Mandant: {activeTenant.slug}
            </span>
          </div>

          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                <th className="py-1.5 text-left">Name / Rolle</th>
                <th className="py-1.5 text-left">Status</th>
                <th className="py-1.5 text-right">
                  Netto ({referenceMonthKey})
                </th>
                <th className="py-1.5 text-right">Standard-Vorabzug</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {persons.map((p) => {
                const monthEntry = monthlyIncomes.find(
                  (m) =>
                    m.personId === p.id && m.monthKey === referenceMonthKey
                );
                return (
                  <tr key={p.id}>
                    <td className="py-2 pr-2">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {p.displayName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {p.roleLabel}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-slate-600 dark:text-slate-400">
                      {p.isEmployed ? 'Erwerbstätig' : 'Nicht erwerbstätig'}
                    </td>
                    <td className="py-2 px-1 text-right font-mono tabular-nums">
                      {monthEntry ? (
                        formatMoney(monthEntry.actualNetIncome)
                      ) : p.isEmployed ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          Offen
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pl-1 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatMoney(p.defaultPersonalAllowance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <form
            onSubmit={handleAddPerson}
            className="pt-2.5 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-2 text-xs"
          >
            <input
              type="text"
              placeholder="Anzeigename (z.B. Clara Weber)"
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            />
            <input
              type="text"
              placeholder="Rolle / Notiz"
              value={pRole}
              onChange={(e) => setPRole(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            />
            <input
              type="number"
              placeholder={`Start-Netto (${referenceMonthKey}) EUR`}
              value={pIncome}
              onChange={(e) => setPIncome(e.target.value)}
              className="px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            />
            <input
              type="number"
              placeholder="Standard-Vorabzug EUR"
              value={pDed}
              onChange={(e) => setPDed(e.target.value)}
              className="px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            />
            <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={pEmployed}
                onChange={(e) => setPEmployed(e.target.checked)}
                className="rounded border-slate-300 text-teal-700"
              />
              <span>Erwerbstätig</span>
            </label>
            <button
              type="submit"
              className="py-1.5 px-3 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium cursor-pointer"
            >
              Person anlegen
            </button>
          </form>
        </section>

        {/* Physical Bank Accounts Master Data */}
        <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Physische Bankkonten & Eigene IBANs ({accounts.length})
            </h2>
            <span className="text-[11px] text-slate-500">
              Basis für Own-IBAN-Transfer-Erkennung
            </span>
          </div>

          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                <th className="py-1.5 text-left">Kontobezeichnung</th>
                <th className="py-1.5 text-left">IBAN</th>
                <th className="py-1.5 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {accounts.map((acc) => (
                <tr key={acc.id}>
                  <td className="py-2 pr-2">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {acc.name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {acc.accountType}
                    </div>
                  </td>
                  <td className="py-2 pr-2 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    {acc.iban || '—'}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums font-medium">
                    {formatMoney(acc.currentBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form
            onSubmit={handleAddAccount}
            className="pt-2.5 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-2 text-xs"
          >
            <input
              type="text"
              placeholder="Kontoname (z.B. DKB Giro)"
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            />
            <input
              type="text"
              placeholder="IBAN (optional, DE...)"
              value={accIban}
              onChange={(e) => setAccIban(e.target.value)}
              className="px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            />
            <select
              value={accType}
              onChange={(e) => setAccType(e.target.value as AccountType)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
            >
              <option value={AccountType.JOINT_CHECKING}>
                Gemeinschaftskonto
              </option>
              <option value={AccountType.SAVINGS_RESERVE}>
                Tagesgeld / Rücklage
              </option>
              <option value={AccountType.PERSONAL_CHECKING}>
                Einzelkonto (Privat)
              </option>
            </select>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Startsaldo"
                value={accBal}
                onChange={(e) => setAccBal(e.target.value)}
                className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium whitespace-nowrap cursor-pointer"
              >
                Konto +
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Categories & Architecture Reference */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-3 text-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Kostenkategorien ({categories.length}):{' '}
            </span>
            <span className="text-slate-600 dark:text-slate-400">
              {categories.map((c) => `${c.code} (${c.name})`).join(' · ')}
            </span>
          </div>
          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
            FastAPI Endpoint Base: {equiBudgetApi.getBaseUrl()} · Header X-Tenant-ID:{' '}
            {activeTenant.id}
          </div>
        </div>

        <form
          onSubmit={handleAddCategory}
          className="pt-2.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            placeholder="Code (z.B. GESUNDHEIT)"
            value={catCode}
            onChange={(e) => setCatCode(e.target.value.toUpperCase())}
            className="w-40 px-2.5 py-1 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
          />
          <input
            type="text"
            placeholder="Neue Kostenkategorie (z.B. Gesundheit & Apotheke)"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            className="flex-1 min-w-[220px] px-2.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
          />
          <button
            type="submit"
            className="px-3 py-1 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium cursor-pointer"
          >
            Kategorie anlegen
          </button>
        </form>
      </section>
    </div>
  );
};
