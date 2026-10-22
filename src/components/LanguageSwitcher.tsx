import React from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from '../i18n/I18nContext';

export const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale } = useTranslation();

  return (
    <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-lg p-0.5 text-xs">
      <div className="px-2 py-1 text-slate-400 flex items-center space-x-1.5 hidden sm:flex">
        <Globe className="w-3.5 h-3.5 text-indigo-400" />
      </div>

      <button
        type="button"
        onClick={() => setLocale('en')}
        className={`px-2 py-1 rounded-md font-medium text-xs transition-all cursor-pointer flex items-center space-x-1 ${
          locale === 'en'
            ? 'bg-indigo-600 text-white shadow-sm font-semibold'
            : 'text-slate-400 hover:text-slate-200'
        }`}
        title="Switch to English"
      >
        <span>EN</span>
      </button>

      <button
        type="button"
        onClick={() => setLocale('de')}
        className={`px-2 py-1 rounded-md font-medium text-xs transition-all cursor-pointer flex items-center space-x-1 ${
          locale === 'de'
            ? 'bg-indigo-600 text-white shadow-sm font-semibold'
            : 'text-slate-400 hover:text-slate-200'
        }`}
        title="Zu Deutsch wechseln"
      >
        <span>DE</span>
      </button>
    </div>
  );
};
