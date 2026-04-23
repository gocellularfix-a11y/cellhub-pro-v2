// ============================================================
// CellHub Intelligence — Chat Interface
// R-INTEL-CHAT-F5
//
// Ask-the-shop chat. Pure client-side intent routing + template
// responses. No LLM calls, no API cost. Handles ~80% of common
// owner questions deterministically.
// ============================================================

import { useState, useRef, useEffect } from 'react';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer } from '@/store/types';
import { classifyIntent } from '@/services/intelligence/chat/intentRouter';
import { handleIntent } from '@/services/intelligence/chat/handlers';

interface Props {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  kind?: 'answer' | 'disambiguation' | 'error' | 'help';
}

export default function IntelligenceChat({ engine, customers, lang }: Props) {
  const es = lang === 'es';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

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
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
  };

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
            💬 {es ? 'Pregúntale a tu Tienda' : 'Ask Your Shop'}
          </h3>
          <p className="text-xs text-slate-400">
            {es
              ? 'Respuestas locales, sin APIs externas. Escribe "ayuda" para ver qué puedo responder.'
              : 'Local answers, no external APIs. Type "help" to see what I can answer.'}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-300"
          >
            {es ? 'Limpiar' : 'Clear'}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <EmptyState es={es} onSuggestion={handleSuggestion} />
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} es={es} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-surface-700 p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={es
            ? 'Ej: "historial de Juan" o "cómo van las ventas"'
            : 'Ex: "history of John" or "how are sales"'}
          className="flex-1 bg-surface-700 text-slate-200 rounded px-3 py-2 text-sm border border-surface-600 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-surface-700 disabled:text-slate-500 text-white text-sm font-medium"
        >
          {es ? 'Enviar' : 'Send'}
        </button>
      </form>
    </div>
  );
}

// ── Message bubble ──────────────────────────────────────────
function MessageBubble({ msg, es }: { msg: ChatMessage; es: boolean }) {
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
      </div>
    </div>
  );
}

// ── Empty state with suggestions ────────────────────────────
function EmptyState({ es, onSuggestion }: { es: boolean; onSuggestion: (s: string) => void }) {
  const suggestions = es
    ? [
      'cómo van las ventas',
      'qué vendo más',
      'qué me falta',
      'cómo está la tienda',
      'reparaciones atrasadas',
      'ayuda',
    ]
    : [
      'how are sales',
      'top items',
      'what do I need',
      'store health',
      'overdue repairs',
      'help',
    ];

  return (
    <div className="text-center py-6">
      <div className="text-4xl mb-2">💬</div>
      <p className="text-sm text-slate-300 mb-4">
        {es ? 'Prueba con una pregunta:' : 'Try a question:'}
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
