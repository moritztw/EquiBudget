import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Filter,
  Search,
  Tag,
  PiggyBank,
} from 'lucide-react';
import {
  Budget,
  ImportTemplate,
  MatchingRule,
  Transaction,
  VirtualSinkingFund,
} from '../../types/household';
import {
  TransactionMatcherEngine,
} from '../../engines/transactionMatcher';
import { useTranslation } from '../../i18n/I18nContext';

interface TransactionImportViewProps {
  transactions: Transaction[];
  budgets: Budget[];
  sinkingFunds: VirtualSinkingFund[];
  matchingRules: MatchingRule[];
  importTemplates: ImportTemplate[];
  onUpdateTransactions: (transactions: Transaction[]) => void;
  onOffsetSinkingFund: (fundId: string, amount: number) => void;
}

export const TransactionImportView: React.FC<TransactionImportViewProps> = ({
  transactions,
  budgets,
  sinkingFunds,
  matchingRules,
  importTemplates,
  onUpdateTransactions,
  onOffsetSinkingFund,
}) => {
  const { t, formatCurrency, formatDate } = useTranslation();

  const [selectedTemplate, setSelectedTemplate] = useState<ImportTemplate>(
    importTemplates[0]
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineLog, setPipelineLog] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const matcher = new TransactionMatcherEngine(matchingRules);

  const runPipeline = async () => {
    setIsProcessing(true);
    setPipelineLog(['[Stage 1] Initializing deterministic rule engine & IBAN registry...']);

    // Run Stage 1 & 2
    const results = await matcher.processPipeline({
      transactions,
      budgets,
      sinkingFunds,
    });

    const updated = transactions.map((tx) => {
      const match = results.find((r) => r.transactionId === tx.id);
      if (!match) return tx;

      return {
        ...tx,
        status: match.matchedStatus,
        matchedBudgetId: match.matchedBudgetId,
        matchedSinkingFundId: match.matchedSinkingFundId,
        matchedRuleId: match.matchedRuleId,
        matchType: match.matchType,
        aiConfidence: match.confidence,
        aiExplanation: match.explanation,
        category: match.categoryName || tx.category,
      };
    });

    const stage1Count = results.filter((r) => r.matchType !== 'ai_classified' && r.matchedStatus !== 'unmatched').length;
    const aiCount = results.filter((r) => r.matchType === 'ai_classified' && r.matchedStatus !== 'unmatched').length;
    const offsetCount = results.filter((r) => r.matchedStatus === 'offset_sinking_fund').length;

    setPipelineLog((prev) => [
      ...prev,
      `[Stage 1 Complete] Matched ${stage1Count} transactions using Regex and IBAN rules.`,
      `[Stage 2] Invoking AI-Classification Plugin Hook for remaining unmatched records...`,
      `[Stage 2 Complete] AI classified ${aiCount} transactions with high confidence scores.`,
      `[Pipeline Summary] Detected ${offsetCount} candidate transactions for virtual Sinking Fund offsets!`,
    ]);

    onUpdateTransactions(updated);
    setIsProcessing(false);
  };

  const handleApproveMatch = (txId: string) => {
    const updated = transactions.map((t) =>
      t.id === txId
        ? {
            ...t,
            status: (t.matchedSinkingFundId ? 'offset_sinking_fund' : 'matched_budget') as any,
          }
        : t
    );
    onUpdateTransactions(updated);
  };

  const handleExecuteSinkingFundOffset = (tx: Transaction) => {
    if (!tx.matchedSinkingFundId) return;
    onOffsetSinkingFund(tx.matchedSinkingFundId, Math.abs(tx.amount));

    const updated = transactions.map((t) =>
      t.id === tx.id
        ? {
            ...t,
            status: 'offset_sinking_fund' as any,
            aiExplanation: `Debit offset executed against Virtual Sinking Fund.`,
          }
        : t
    );
    onUpdateTransactions(updated);
  };

  const filteredTransactions = transactions.filter((tx) => {
    if (filterStatus !== 'all' && tx.status !== filterStatus) return false;
    if (
      searchTerm &&
      !tx.payee.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !tx.purposeText.toLowerCase().includes(searchTerm.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900 border border-indigo-500/20 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
                {t('transactions.bannerTag')}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {t('transactions.bannerSubtag')}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              {t('transactions.bannerTitle')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              {t('transactions.bannerDesc')}
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={runPipeline}
              disabled={isProcessing}
              className={`px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm flex items-center space-x-2 shadow-lg transition-all cursor-pointer ${
                isProcessing
                  ? 'bg-indigo-950 text-indigo-400 border border-indigo-500/40 cursor-wait'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
              }`}
            >
              <Cpu className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
              <span>
                {isProcessing
                  ? t('transactions.runningPipeline')
                  : t('transactions.runPipelineBtn')}
              </span>
            </button>
          </div>
        </div>

        {/* Bank Template Preset Bar */}
        <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2 text-slate-400">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>{t('transactions.activePreset')}</span>
            <select
              aria-label="Active Bank Import Preset"
              value={selectedTemplate.id}
              onChange={(e) => {
                const found = importTemplates.find((t) => t.id === e.target.value);
                if (found) setSelectedTemplate(found);
              }}
              className="bg-slate-950 text-slate-200 border border-slate-800 rounded px-2.5 py-1 focus:outline-none cursor-pointer font-medium"
            >
              {importTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.bankName} ({t.delimiter === ';' ? 'Semicolon' : 'Comma'} CSV)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-3 text-slate-400 font-mono text-[11px]">
            <span>
              {t('transactions.format')}: {selectedTemplate.fileFormat.toUpperCase()}
            </span>
            <span>•</span>
            <span>
              {t('transactions.dateFormat')}: {selectedTemplate.dateFormat}
            </span>
            <span>•</span>
            <span className="text-indigo-400">
              {t('transactions.rulesActive', { count: matchingRules.length })}
            </span>
          </div>
        </div>
      </div>

      {/* Pipeline Execution Log (if any) */}
      {pipelineLog.length > 0 && (
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 space-y-1">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80 text-indigo-400 font-semibold">
            <span>{t('transactions.pipelineTrace')}</span>
            <span className="text-[10px] text-emerald-400">{t('transactions.success')}</span>
          </div>
          {pipelineLog.map((log, i) => (
            <div key={i} className="flex items-start space-x-2">
              <span className="text-slate-600">&gt;</span>
              <span className={log.includes('Complete') ? 'text-emerald-300' : 'text-slate-300'}>
                {log}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Transaction Table Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t('transactions.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto justify-end text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">{t('transactions.statusFilter')}</span>
          {[
            { id: 'all', label: t('transactions.all') },
            { id: 'unmatched', label: t('transactions.unmatched') },
            { id: 'matched_budget', label: t('transactions.matchedBudget') },
            { id: 'offset_sinking_fund', label: t('transactions.offsetSinkingFund') },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => setFilterStatus(st.id)}
              className={`px-2.5 py-1 rounded-lg text-xs capitalize transition-colors cursor-pointer ${
                filterStatus === st.id
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 font-semibold">
              <tr>
                <th className="py-3 px-4">{t('transactions.thDatePayee')}</th>
                <th className="py-3 px-4">{t('transactions.thDescription')}</th>
                <th className="py-3 px-4 text-right">{t('transactions.thAmount')}</th>
                <th className="py-3 px-4">{t('transactions.thMatchStatus')}</th>
                <th className="py-3 px-4">{t('transactions.thAssignedTarget')}</th>
                <th className="py-3 px-4 text-right">{t('transactions.thActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredTransactions.map((tx) => {
                const isExpense = tx.amount < 0;
                const isMatched = tx.status !== 'unmatched';
                const isOffset = tx.status === 'offset_sinking_fund';

                return (
                  <tr
                    key={tx.id}
                    className="hover:bg-slate-800/40 transition-colors group"
                  >
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-semibold text-slate-200">{tx.payee}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {formatDate(tx.date)}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 max-w-xs truncate text-slate-300">
                      <div>{tx.purposeText}</div>
                      {tx.iban && (
                        <div className="text-[10px] text-slate-500 font-mono">
                          IBAN: {tx.iban}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono font-bold">
                      <span className={isExpense ? 'text-slate-200' : 'text-emerald-400'}>
                        {formatCurrency(Math.abs(tx.amount))}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {tx.status === 'unmatched' ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] border border-slate-700">
                          <AlertCircle className="w-3 h-3 text-amber-400" />
                          <span>{t('transactions.unmatched')}</span>
                        </span>
                      ) : isOffset ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 text-[10px] border border-amber-500/30">
                          <PiggyBank className="w-3 h-3 text-amber-400" />
                          <span>{t('transactions.offsetSinkingFund')}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 text-[10px] border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>{t('transactions.matchedBudget')}</span>
                        </span>
                      )}

                      {tx.matchType && (
                        <div className="text-[10px] text-slate-400 mt-1 flex items-center space-x-1">
                          {tx.matchType === 'ai_classified' ? (
                            <span className="text-indigo-400 font-medium flex items-center space-x-1">
                              <Sparkles className="w-2.5 h-2.5" />
                              <span>
                                {t('transactions.aiHook', {
                                  percent: (tx.aiConfidence! * 100).toFixed(0),
                                })}
                              </span>
                            </span>
                          ) : tx.matchType === 'regex_pattern' ? (
                            <span className="text-slate-400 font-mono">
                              {t('transactions.ruleRegex')}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono">
                              {t('transactions.directOffset')}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 max-w-xs">
                      {tx.category ? (
                        <div>
                          <div className="font-semibold text-slate-200 flex items-center space-x-1.5">
                            <Tag className="w-3 h-3 text-indigo-400" />
                            <span>{tx.category}</span>
                          </div>
                          {tx.aiExplanation && (
                            <div className="text-[10px] text-slate-400 mt-0.5 leading-snug truncate" title={tx.aiExplanation}>
                              {tx.aiExplanation}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">
                          {t('transactions.noCategoryAssigned')}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {isOffset && (
                        <button
                          onClick={() => handleExecuteSinkingFundOffset(tx)}
                          className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[11px] font-medium transition-colors cursor-pointer mr-2"
                        >
                          {t('transactions.executeOffsetBtn')}
                        </button>
                      )}

                      {!isMatched && (
                        <button
                          onClick={() => handleApproveMatch(tx.id)}
                          className="px-2.5 py-1 rounded bg-indigo-600/80 hover:bg-indigo-600 text-white text-[11px] font-medium transition-colors cursor-pointer"
                        >
                          {t('transactions.acceptBtn')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
