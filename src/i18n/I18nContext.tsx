import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';
import deMessages from './de.json';
import enMessages from './en.json';

export type SupportedLocale = 'de-DE' | 'en-US';
export type TranslationKey = keyof typeof deMessages;

const DICTIONARIES: Record<SupportedLocale, Record<TranslationKey, string>> = {
  'de-DE': deMessages,
  'en-US': enMessages,
};

interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: TranslationKey) => string;
  formatMoney: (amount: number, currency?: string) => string;
  formatCompactMoney: (amount: number, currency?: string) => string;
  formatPercent: (ratio: number) => string;
  formatDate: (isoDate: string) => string;
  formatShortMonth: (year: number, monthZeroIndexed: number) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [locale, setLocale] = useState<SupportedLocale>('de-DE');

  const t = useCallback(
    (key: TranslationKey): string => {
      return DICTIONARIES[locale][key] ?? key;
    },
    [locale]
  );

  const formatMoney = useCallback(
    (amount: number, currency = 'EUR'): string => {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    },
    [locale]
  );

  const formatCompactMoney = useCallback(
    (amount: number, currency = 'EUR'): string => {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    },
    [locale]
  );

  const formatPercent = useCallback(
    (ratio: number): string => {
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(ratio);
    },
    [locale]
  );

  const formatDate = useCallback(
    (isoDate: string): string => {
      const parts = isoDate.split('-').map(Number);
      if (parts.length !== 3 || parts.some(Number.isNaN)) return isoDate;
      const dt = new Date(parts[0], parts[1] - 1, parts[2]);
      return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(dt);
    },
    [locale]
  );

  const formatShortMonth = useCallback(
    (year: number, monthZeroIndexed: number): string => {
      const dt = new Date(year, monthZeroIndexed, 1);
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: '2-digit',
      }).format(dt);
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      formatMoney,
      formatCompactMoney,
      formatPercent,
      formatDate,
      formatShortMonth,
    }),
    [
      locale,
      t,
      formatMoney,
      formatCompactMoney,
      formatPercent,
      formatDate,
      formatShortMonth,
    ]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}
