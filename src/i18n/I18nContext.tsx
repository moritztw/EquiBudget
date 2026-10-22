import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import enTranslations from '../locales/en.json';
import deTranslations from '../locales/de.json';
import { LocaleFormatter, SupportedLocale } from '../services/localeFormatter';

type TranslationDictionary = typeof enTranslations;

interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (loc: SupportedLocale) => void;
  currency: string;
  setCurrency: (cur: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  translateError: (errorCode: string) => string;
  formatCurrency: (amount: number, overrideCurrency?: string) => string;
  formatDate: (date: string | Date, style?: 'short' | 'medium' | 'long') => string;
  formatNumber: (val: number, decimals?: number) => string;
  formatPercent: (val: number) => string;
}

const translations: Record<SupportedLocale, any> = {
  en: enTranslations,
  de: deTranslations,
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_LOCALE_KEY = 'equibudget_locale';
const STORAGE_CURRENCY_KEY = 'equibudget_currency';

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Detect browser language or stored choice
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_LOCALE_KEY);
      if (stored === 'de' || stored === 'en') return stored;
      if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de')) {
        return 'de';
      }
    } catch {
      // fallback
    }
    return 'en';
  });

  const [currency, setCurrencyState] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_CURRENCY_KEY);
      if (stored) return stored;
    } catch {
      // fallback
    }
    return 'EUR';
  });

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_LOCALE_KEY, newLocale);
      document.documentElement.lang = newLocale;
    } catch {}
  }, []);

  const setCurrency = useCallback((newCur: string) => {
    setCurrencyState(newCur);
    try {
      localStorage.setItem(STORAGE_CURRENCY_KEY, newCur);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Nested property lookup with parameter interpolation
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const parts = key.split('.');
      let current: any = translations[locale];

      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          current = undefined;
          break;
        }
      }

      // Fallback to English if not found in German
      if (current === undefined && locale !== 'en') {
        let fallback: any = translations.en;
        for (const part of parts) {
          if (fallback && typeof fallback === 'object' && part in fallback) {
            fallback = fallback[part];
          } else {
            fallback = undefined;
            break;
          }
        }
        current = fallback;
      }

      if (typeof current !== 'string') {
        return key; // return key if missing
      }

      let result = current;
      if (params) {
        Object.entries(params).forEach(([paramKey, val]) => {
          result = result.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(val));
        });
      }

      return result;
    },
    [locale]
  );

  // Error code translation helper
  const translateError = useCallback(
    (errorCode: string): string => {
      const key = `errors.${errorCode}`;
      const translated = t(key);
      if (translated !== key) {
        return translated;
      }
      return `${errorCode}: An unexpected error occurred.`;
    },
    [t]
  );

  const formatCurrency = useCallback(
    (amount: number, overrideCurrency?: string) => {
      return LocaleFormatter.formatCurrency(amount, {
        locale,
        currencyCode: overrideCurrency || currency,
      });
    },
    [locale, currency]
  );

  const formatDate = useCallback(
    (date: string | Date, style?: 'short' | 'medium' | 'long') => {
      return LocaleFormatter.formatDate(date, { locale, style });
    },
    [locale]
  );

  const formatNumber = useCallback(
    (val: number, decimals: number = 2) => {
      return LocaleFormatter.formatNumber(val, {
        locale,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    },
    [locale]
  );

  const formatPercent = useCallback(
    (val: number) => {
      return LocaleFormatter.formatPercent(val, { locale });
    },
    [locale]
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        currency,
        setCurrency,
        t,
        translateError,
        formatCurrency,
        formatDate,
        formatNumber,
        formatPercent,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
};
