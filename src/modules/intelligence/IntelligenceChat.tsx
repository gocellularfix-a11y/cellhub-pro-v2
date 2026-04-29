// ============================================================
// CellHub Intelligence — Chat Interface
// R-INTEL-CHAT-F5
//
// Ask-the-shop chat. Pure client-side intent routing + template
// responses. No LLM calls, no API cost. Handles ~80% of common
// owner questions deterministically.
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer } from '@/store/types';
import { classifyIntent } from '@/services/intelligence/chat/intentRouter';
import { handleIntent } from '@/services/intelligence/chat/handlers';
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';
import { executeActionPayload } from '@/services/intelligence/actions/actionExecutor';
import { Modal } from '@/components/ui';
import { useTranslation } from '@/i18n';

interface Props {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es';
  // When this changes (new seq), the chat auto-submits the query text.
  externalQuery?: { text: string; seq: number };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  kind?: 'answer' | 'disambiguation' | 'error' | 'help';
  actions?: ChatActionUI[];
}

export default function IntelligenceChat({ engine, customers, lang, externalQuery }: Props) {
  const { locale, t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pendingWaAction, setPendingWaAction] = useState<{ action: ChatActionUI; url: string } | null>(null);
  const [actionFeedbackById, setActionFeedbackById] = useState<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevExternalSeq = useRef(-1);

  // Auto-submit when parent fires a quick-action chip.
  const engineRef = useRef(engine);
  const customersRef = useRef(customers);
  const langRef = useRef(lang);
  useEffect(() => { engineRef.current = engine; }, [engine]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { langRef.current = lang; }, [lang]);

  function setFeedbackForAction(actionId: string, message: string) {
    setActionFeedbackById((prev) => ({ ...prev, [actionId]: message }));
  }

  function clearActionFeedback() {
    setActionFeedbackById({});
  }

  const fireQuery = useCallback((query: string) => {
    const match = classifyIntent(query, customersRef.current, langRef.current);
    const response = handleIntent(match, engineRef.current, langRef.current);
    clearActionFeedback();
    setMessages(prev => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: query, timestamp: new Date() },
      { id: `a-${Date.now() + 1}`, role: 'assistant', content: response.text, timestamp: new Date(), kind: response.kind, actions: response.actions },
    ]);
  }, []);

  useEffect(() => {
    if (!externalQuery || externalQuery.seq === prevExternalSeq.current) return;
    prevExternalSeq.current = externalQuery.seq;
    fireQuery(externalQuery.text);
  }, [externalQuery, fireQuery]);

  // Scroll to bottom on new message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = input.trim();
    if (!query) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date(),
    };

    const match = classifyIntent(query, customers, lang);
    const response = handleIntent(match, engine, lang);

    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: response.text,
      timestamp: new Date(),
      kind: response.kind,
      actions: response.actions,
    };

    clearActionFeedback();
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
  };

  function handleActionClick(action: ChatActionUI) {
    const result = executeActionPayload(action.payload);
    if (!result.ok) {
      setFeedbackForAction(action.id, `Action not available: ${result.reason}`);
      return;
    }
    switch (result.type) {
      case 'whatsapp_url':
        setPendingWaAction({ action, url: result.url });
        return;
      case 'pos_discount':
        setFeedbackForAction(action.id, `Discount flow triggered for SKU: ${result.sku}`);
        break;
      case 'pos_bundle':
        setFeedbackForAction(action.id, `Bundle flow triggered for SKU: ${result.sku}`);
        break;
      case 'review_panel':
        setFeedbackForAction(action.id, 'Review panel opened.');
        break;
      case 'reminder_queue':
        setFeedbackForAction(action.id, `Reminder queued for ${result.customerName ?? 'customer'}.`);
        break;
    }
  }

  const handleSuggestion = (suggestion: string) => {
    setInput(suggestion);
  };

  const clearChat = () => setMessages([]);

  return (
    <div className="bg-surface-800 rounded-lg border border-surface-700 overflow-hidden flex flex-col" style={{ minHeight: '400px', maxHeight: '600px' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-700 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-200">
            💬 {t('intelligence.askYourShop')}
          </h3>
          <p className="text-xs text-slate-400">
            {t('intelligence.chatDescription')}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-300"
          >
            {t('intelligence.clear')}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <EmptyState onSuggestion={handleSuggestion} />
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} es={locale === 'es'} onAction={handleActionClick} feedbackById={actionFeedbackById} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-surface-700 p-3 flex gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('intelligence.chatPlaceholder')}
          className="flex-1 bg-surface-700 text-slate-200 rounded px-3 py-2 text-sm border border-surface-600 focus:outline-none focus:border-blue-500"
          style={{ transform: 'translateZ(0)' }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-surface-700 disabled:text-slate-500 text-white text-sm font-medium"
        >
          {t('intelligence.send')}
        </button>
      </form>

      <Modal
        open={!!pendingWaAction}
        onClose={() => setPendingWaAction(null)}
        title="Open WhatsApp?"
        size="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setPendingWaAction(null)}
              className="px-4 py-2 rounded bg-surface-700 hover:bg-surface-600 text-slate-300 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (pendingWaAction) {
                  window.open(pendingWaAction.url, '_blank');
                  setFeedbackForAction(pendingWaAction.action.id, 'WhatsApp opened.');
                }
                setPendingWaAction(null);
              }}
              className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
            >
              Open WhatsApp
            </button>
          </>
        }
      >
        <p className="text-slate-300 text-sm mb-2">
          This will open WhatsApp with a prepared message.
        </p>
        <p className="text-slate-200 text-sm font-medium">
          {pendingWaAction?.action.payload.customerName ?? 'Customer'}
        </p>
      </Modal>
    </div>
  );
}

// ── Message bubble ──────────────────────────────────────────
function MessageBubble({ msg, es, onAction, feedbackById }: { msg: ChatMessage; es: boolean; onAction: (action: ChatActionUI) => void; feedbackById: Record<string, string> }) {
  const isUser = msg.role === 'user';
  const kindColor = {
    answer: 'border-blue-500/30 bg-blue-500/5',
    disambiguation: 'border-amber-500/30 bg-amber-500/5',
    error: 'border-red-500/30 bg-red-500/5',
    help: 'border-slate-500/30 bg-slate-500/5',
  };
  const colorClass = !isUser && msg.kind ? kindColor[msg.kind] : '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-blue-600 text-white'
            : `bg-surface-700 text-slate-200 border ${colorClass}`
        }`}
      >
        {!isUser && <div className="text-xs text-slate-400 mb-1">🤖 {es ? 'Intelligence' : 'Intelligence'}</div>}
        {msg.content}
        {!isUser && msg.actions && msg.actions.length > 0 && (
          <div className="flex flex-wrap mt-2">
            {msg.actions.map(action => (
              <div key={action.id} className="inline-block mr-2 mt-2 align-top">
                <button
                  onClick={() => onAction(action)}
                  disabled={!action.payload.executable}
                  title={action.payload.executable ? '' : 'Missing data to execute'}
                  className="px-3 py-1 rounded border border-slate-600 text-xs text-slate-300 hover:bg-surface-600 active:scale-[0.98] disabled:opacity-50"
                >
                  {action.label}
                  {action.actionType && (
                    <span className="ml-1 text-[10px] opacity-60">[{action.actionType}]</span>
                  )}
                </button>
                {feedbackById[action.id] && (
                  <div className="mt-1 text-[11px] text-slate-400">
                    {feedbackById[action.id]}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state with suggestions ────────────────────────────
function EmptyState({ onSuggestion }: { es?: boolean; onSuggestion: (s: string) => void }) {
  const { t, locale } = useTranslation();
  const suggestions = locale === 'es'
    ? ['cómo van las ventas', 'qué vendo más', 'qué me falta', 'cómo está la tienda', 'reparaciones atrasadas', 'ayuda']
    : locale === 'pt'
    ? ['como estão as vendas', 'itens mais vendidos', 'o que preciso', 'saúde da loja', 'reparos atrasados', 'ajuda']
    : ['how are sales', 'top items', 'what do I need', 'store health', 'overdue repairs', 'help'];

  return (
    <div className="text-center py-6">
      <div className="text-4xl mb-2">💬</div>
      <p className="text-sm text-slate-300 mb-4">
        {t('intelligence.tryQuestion')}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestion(s)}
            className="px-3 py-1 text-xs rounded-full bg-surface-700 hover:bg-surface-600 text-slate-300 border border-surface-600"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
