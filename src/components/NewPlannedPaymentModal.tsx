import React, {useEffect, useState} from 'react';
import {Trash2} from 'lucide-react';
import {useI18n} from '../i18n/I18nContext';
import {useHouseholdStore} from '../store/useHouseholdStore';
import {
  PlannedPayment,
  PlannedPaymentAmountRevision,
  RecurrenceInterval,
} from '../domain/types';

interface PlannedPaymentModalProps {
  isOpen: boolean;
  editingPayment: PlannedPayment | null;
  onClose: () => void;
}

export const NewPlannedPaymentModal: React.FC<PlannedPaymentModalProps> = ({
  isOpen,
  editingPayment,
  onClose,
}) => {
  const {t} = useI18n();
  const {
    accounts,
    categories,
    addPlannedPayment,
    updatePlannedPayment,
    deletePlannedPayment,
  } = useHouseholdStore();

  const [name, setName] = useState('');
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('120.00');
  const [interval, setInterval] = useState<RecurrenceInterval>(
    RecurrenceInterval.ANNUAL
  );
  const [nextDueDate, setNextDueDate] = useState('2026-09-15');
  const [endDate, setEndDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [autoAccrual, setAutoAccrual] = useState(true);
  const [initialPotBalance, setInitialPotBalance] = useState('0.00');
  const [isActive, setIsActive] = useState(true);
  const [revisions, setRevisions] = useState<PlannedPaymentAmountRevision[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);
    if (editingPayment) {
      setName(editingPayment.name);
      setPayee(editingPayment.payee);
      setAmount(editingPayment.amount.toFixed(2));
      setInterval(editingPayment.interval);
      setNextDueDate(editingPayment.nextDueDate);
      setEndDate(editingPayment.endDate ?? '');
      setAccountId(editingPayment.accountId);
      setCategoryId(editingPayment.categoryId);
      setAutoAccrual(editingPayment.autoAccrual);
      setIsActive(editingPayment.isActive);
      setRevisions(editingPayment.amountRevisions.map((r) => ({...r})));
    } else {
      setName('');
      setPayee('');
      setAmount('120.00');
      setInterval(RecurrenceInterval.ANNUAL);
      setNextDueDate('2026-09-15');
      setEndDate('');
      setAccountId(accounts[0]?.id ?? '');
      setCategoryId(categories[0]?.id ?? '');
      setAutoAccrual(true);
      setInitialPotBalance('0.00');
      setIsActive(true);
      setRevisions([]);
    }
  }, [isOpen, editingPayment, accounts, categories]);

  if (!isOpen) return null;

  const handleAddRevision = () => {
    setRevisions((prev) => [
      ...prev,
      {
        id: `rev-${Math.random().toString(36).slice(2, 8)}`,
        validFrom: '2026-10-01',
        amount: Number(amount.replace(',', '.')) || 100,
        note: '',
      },
    ]);
  };

  const handleUpdateRevision = (
    idx: number,
    patch: Partial<PlannedPaymentAmountRevision>
  ) => {
    setRevisions((prev) =>
      prev.map((item, i) => (i === idx ? {...item, ...patch} : item))
    );
  };

  const handleRemoveRevision = (idx: number) => {
    setRevisions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmt = Number(amount.replace(',', '.'));
    if (!name.trim() || !Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      setErrorMessage('Bitte Bezeichnung und gültigen Basisbetrag (> 0 EUR) angeben.');
      return;
    }

    const cleanedRevisions = revisions
      .filter((r) => r.validFrom && Number.isFinite(r.amount) && r.amount > 0)
      .map((r) => ({
        ...r,
        amount: Math.round(r.amount * 100) / 100,
      }));

    const parsedInitialPot = Math.max(
      0,
      Number(initialPotBalance.replace(',', '.')) || 0
    );

    const payload = {
      name: name.trim(),
      payee: payee.trim() || name.trim(),
      amount: Math.round(parsedAmt * 100) / 100,
      interval,
      nextDueDate,
      endDate: endDate.trim() ? endDate.trim() : null,
      accountId: accountId || accounts[0]?.id || '',
      categoryId: categoryId || categories[0]?.id || '',
      autoAccrual: interval === RecurrenceInterval.MONTHLY ? false : autoAccrual,
      isActive,
      amountRevisions: cleanedRevisions,
      initialPotBalance:
        !editingPayment &&
        interval !== RecurrenceInterval.MONTHLY &&
        autoAccrual
          ? Math.round(parsedInitialPot * 100) / 100
          : 0,
    };

    if (editingPayment) {
      updatePlannedPayment(editingPayment.id, payload);
    } else {
      addPlannedPayment(payload);
    }
    onClose();
  };

  const handleDelete = () => {
    if (!editingPayment) return;
    const res = deletePlannedPayment(editingPayment.id);
    if (!res.ok) {
      setErrorMessage(res.error ?? t('modal.deleteBlockedByPot'));
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={
        editingPayment ? t('modal.editPaymentTitle') : t('modal.newPaymentTitle')
      }
    >
      <div className="w-full max-w-2xl rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden my-auto">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {editingPayment
              ? t('modal.editPaymentTitle')
              : t('modal.newPaymentTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
          >
            ESC
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Bezeichnung der Zahlung
              </label>
              <input
                type="text"
                required
                placeholder="z.B. Warmmiete / KFZ-Vollkasko"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Zahlungsempfänger
              </label>
              <input
                type="text"
                placeholder="z.B. Hausverwaltung Süd GmbH"
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Basis-Zahlbetrag (EUR)
              </label>
              <input
                type="text"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Zahlungsturnus
              </label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value as RecurrenceInterval)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              >
                <option value={RecurrenceInterval.MONTHLY}>
                  {t('interval.MONTHLY')}
                </option>
                <option value={RecurrenceInterval.QUARTERLY}>
                  {t('interval.QUARTERLY')}
                </option>
                <option value={RecurrenceInterval.SEMI_ANNUAL}>
                  {t('interval.SEMI_ANNUAL')}
                </option>
                <option value={RecurrenceInterval.ANNUAL}>
                  {t('interval.ANNUAL')}
                </option>
                <option value={RecurrenceInterval.BIENNIAL}>
                  {t('interval.BIENNIAL')}
                </option>
                <option value={RecurrenceInterval.ONE_TIME}>
                  {t('interval.ONE_TIME')}
                </option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nächste Fälligkeit
              </label>
              <input
                type="date"
                required
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  Enddatum (optional)
                </label>
                {endDate && (
                  <button
                    type="button"
                    onClick={() => setEndDate('')}
                    className="text-[10px] text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    Unbefristet
                  </button>
                )}
              </div>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-2.5 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Belastungskonto / Rücklagenkonto
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Kostenkategorie
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 pt-0.5">
            {interval !== RecurrenceInterval.MONTHLY && (
              <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoAccrual}
                  onChange={(e) => setAutoAccrual(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700"
                />
                <span>
                  Als virtuellen Anspartopf (Sinking Fund) monatlich vorab zurückstellen
                </span>
              </label>
            )}

            {editingPayment && (
              <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700"
                />
                <span>Zahlungsplan aktiv (Deaktivieren verschiebt ins Archiv)</span>
              </label>
            )}
          </div>

          {!editingPayment &&
            interval !== RecurrenceInterval.MONTHLY &&
            autoAccrual && (
              <div className="p-3 rounded border border-teal-300/70 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-950/25 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-8">
                  <label className="block text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t('modal.initialPotBalance')}
                  </label>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    {t('modal.initialPotBalanceHint')}
                  </p>
                </div>
                <div className="sm:col-span-4">
                  <input
                    type="text"
                    value={initialPotBalance}
                    onChange={(e) => setInitialPotBalance(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-2.5 py-1.5 text-right font-mono font-semibold bg-white dark:bg-slate-900 border border-teal-600/70 rounded text-teal-900 dark:text-teal-200"
                  />
                </div>
              </div>
            )}

          {/* Effective-Dated Rate Revisions (Gültig-ab Preisstaffeln) */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {t('modal.revisionsTitle')}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Ändert Zahlbeträge und Ansparraten ab dem Stichtag automatisch, ohne vergangene Monate zu überschreiben.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddRevision}
                className="px-2.5 py-1 text-xs font-medium rounded border border-teal-600/60 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 cursor-pointer"
              >
                {t('modal.revisionsAdd')}
              </button>
            </div>

            {revisions.length > 0 && (
              <div className="space-y-1.5">
                {revisions.map((rev, idx) => (
                  <div
                    key={rev.id}
                    className="grid grid-cols-12 gap-2 items-center bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800"
                  >
                    <div className="col-span-4">
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        {t('modal.validFrom')}
                      </label>
                      <input
                        type="date"
                        required
                        value={rev.validFrom}
                        onChange={(e) =>
                          handleUpdateRevision(idx, {validFrom: e.target.value})
                        }
                        className="w-full px-2 py-1 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        {t('modal.revisionAmount')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={rev.amount}
                        onChange={(e) =>
                          handleUpdateRevision(idx, {
                            amount: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full px-2 py-1 font-mono text-right bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                      />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-[10px] text-slate-500 mb-0.5">
                        {t('modal.revisionNote')}
                      </label>
                      <input
                        type="text"
                        placeholder="z.B. Mieterhöhung / Tarif"
                        value={rev.note}
                        onChange={(e) =>
                          handleUpdateRevision(idx, {note: e.target.value})
                        }
                        className="w-full px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded"
                      />
                    </div>
                    <div className="col-span-1 pt-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveRevision(idx)}
                        title="Staffel entfernen"
                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs">
              {errorMessage}
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              {editingPayment && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-3 py-1.5 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                >
                  {t('modal.delete')}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t('modal.cancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded bg-teal-700 hover:bg-teal-800 text-white font-medium cursor-pointer"
              >
                {t('modal.save')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
