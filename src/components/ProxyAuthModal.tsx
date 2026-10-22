import React, { useState } from 'react';
import {
  Shield,
  Key,
  Server,
  Check,
  Copy,
  X,
  Info,
  Lock,
} from 'lucide-react';
import { User } from '../types/household';
import { useTranslation } from '../i18n/I18nContext';

interface ProxyAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUpdateUser: (user: User) => void;
}

export const ProxyAuthModal: React.FC<ProxyAuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUpdateUser,
}) => {
  const { t } = useTranslation();

  const [authMode, setAuthMode] = useState<'proxy_header' | 'jwt'>('proxy_header');
  const [copied, setCopied] = useState(false);
  const [proxyEmail, setProxyEmail] = useState(currentUser.email);
  const [proxyUser, setProxyUser] = useState(currentUser.name);

  if (!isOpen) return null;

  const mockHeaders = {
    'X-Forwarded-User': proxyUser.toLowerCase().replace(/\s+/g, '.'),
    'X-Auth-Request-Email': proxyEmail,
    'X-Forwarded-Groups': 'household-admin, finance-manager',
    'X-Forwarded-Proto': 'https',
    'X-Forwarded-Host': 'budget.internal.homelab',
  };

  const mockJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTAxIiwiaG91c2Vob2xkX2lkIjoidGVuYW50LTAxIiwicm9sZSI6ImFkbWluIiwiZXhwIjoxNzk4MDk1MjAwfQ.demo_signature_hash';

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyChanges = () => {
    onUpdateUser({
      ...currentUser,
      email: proxyEmail,
      name: proxyUser,
      authMethod: authMode,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                {t('auth.modalTitle')}
              </h2>
              <p className="text-xs text-slate-400">
                {t('auth.modalSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-3 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              onClick={() => setAuthMode('proxy_header')}
              className={`flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                authMode === 'proxy_header'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-4 h-4" />
              <span>{t('auth.forwardAuthTab')}</span>
            </button>
            <button
              onClick={() => setAuthMode('jwt')}
              className={`flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                authMode === 'jwt'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Key className="w-4 h-4" />
              <span>{t('auth.jwtTab')}</span>
            </button>
          </div>

          {authMode === 'proxy_header' ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-start space-x-3">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                <p>
                  <strong>{t('auth.proxyNoticeTitle')}</strong> {t('auth.proxyNoticeBody')}
                </p>
              </div>

              {/* Injected Header Simulation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="font-semibold">{t('auth.simulatedHeadersTitle')}</span>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(mockHeaders, null, 2))}
                    className="flex items-center space-x-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? t('auth.copied') : t('auth.copyHeaders')}</span>
                  </button>
                </div>
                <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 space-y-1.5">
                  {Object.entries(mockHeaders).map(([k, v]) => (
                    <div key={k} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-0.5 border-b border-slate-900/60 last:border-0">
                      <span className="text-indigo-400 font-medium">{k}:</span>
                      <span className="text-emerald-300 text-[11px] break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Change proxy identity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {t('auth.simulateUser')}
                  </label>
                  <input
                    type="text"
                    value={proxyUser}
                    onChange={(e) => setProxyUser(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {t('auth.simulateEmail')}
                  </label>
                  <input
                    type="email"
                    value={proxyEmail}
                    onChange={(e) => setProxyEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start space-x-3">
                <Lock className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                <p>
                  <strong>{t('auth.jwtNoticeTitle')}</strong> {t('auth.jwtNoticeBody')}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  {t('auth.activeJwtToken')}
                </label>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-400 break-all leading-relaxed">
                  {mockJwt}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            {t('auth.cancel')}
          </button>
          <button
            onClick={handleApplyChanges}
            className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-md transition-colors cursor-pointer"
          >
            {t('auth.applyContext')}
          </button>
        </div>
      </div>
    </div>
  );
};
