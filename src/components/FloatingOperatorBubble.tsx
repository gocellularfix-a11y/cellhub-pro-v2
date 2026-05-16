// R-INTELLIGENCE-LIVE-OPERATING-ASSISTANT-V1
// Non-blocking suggestion pill. z-index 400 — below payment/checkout modals.
// Auto-hides after 15s. Records cooldown on action or dismiss.

import { useEffect, useRef, useState } from 'react';
import type { LiveAssistSuggestion } from '@/services/intelligence/live/types';
import { writeCooldown } from '@/services/intelligence/live/liveOperatingAssistant';
import { recordAttentionSignal } from '@/services/intelligence/attention/store';

const PRIORITY_STYLE: Record<string, { border: string; badge: string; text: string }> = {
  critical: { border: '#EF4444', badge: '#EF444422', text: '#FCA5A5' },
  high:     { border: '#F59E0B', badge: '#F59E0B22', text: '#FCD34D' },
  medium:   { border: '#6366F1', badge: '#6366F122', text: '#A5B4FC' },
};

const AUTO_HIDE_MS = 15_000;

interface Props {
  suggestion: LiveAssistSuggestion | null;
  lang: 'en' | 'es' | 'pt';
  onAction:  (suggestion: LiveAssistSuggestion) => void;
  onDismiss: (suggestion: LiveAssistSuggestion) => void;
}

export default function FloatingOperatorBubble({ suggestion, lang, onAction, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<LiveAssistSuggestion | null>(null);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    if (!suggestion) return;
    if (shown?.id === suggestion.id) return;

    setShown(suggestion);
    setVisible(true);

    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      // Suggestion auto-hid without operator action — record as ignored.
      recordAttentionSignal('suggestion_ignored', { trigger: suggestion.trigger });
      setVisible(false);
    }, AUTO_HIDE_MS);

    return () => window.clearTimeout(timerRef.current);
  }, [suggestion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible || !shown) return null;

  const style = PRIORITY_STYLE[shown.priority] ?? PRIORITY_STYLE.medium;
  const es = lang === 'es';
  const viewLabel    = es ? 'Ver'    : 'View';
  const dismissLabel = es ? 'Cerrar' : 'Dismiss';

  function handleAction() {
    writeCooldown(shown!.id, shown!.trigger, 'suggestion_accepted');
    setVisible(false);
    onAction(shown!);
  }

  function handleDismiss() {
    writeCooldown(shown!.id, shown!.trigger);
    setVisible(false);
    onDismiss(shown!);
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '72px',
        right: '16px',
        zIndex: 400,
        maxWidth: '300px',
        background: '#111827',
        border: `1px solid ${style.border}44`,
        borderLeftWidth: 3,
        borderLeftColor: style.border,
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        pointerEvents: 'auto',
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug" style={{ color: style.text }}>
            {shown.headline}
          </p>
          {shown.subline && (
            <p className="text-xs text-slate-400 mt-0.5 leading-snug truncate">
              {shown.subline}
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="text-slate-500 hover:text-slate-300 text-xs shrink-0 ml-1 leading-none pt-0.5 transition"
          aria-label={dismissLabel}
        >
          ✕
        </button>
      </div>
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleAction}
          className="px-2.5 py-1 text-xs font-semibold rounded transition"
          style={{
            background: style.badge,
            color: style.text,
            border: `1px solid ${style.border}44`,
          }}
        >
          {viewLabel}
        </button>
        <button
          onClick={handleDismiss}
          className="px-2.5 py-1 text-xs font-medium rounded text-slate-400 hover:text-slate-300 transition"
          style={{ background: '#37415133', border: '1px solid #37415166' }}
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}
