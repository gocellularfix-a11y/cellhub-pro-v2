// ============================================================
// I6-C2 — Recommendation Bubble.
//
// A calm, always-available entry point to proactive intelligence — NOT a
// second Business Manager. Consumes ONLY canonical PresentedInsights (via the
// shared hook → engine.getPresentedInsights → I6-C1 presenter): it never
// sorts, groups, words or scores on its own. Collapsed = one summary line +
// count, tone from the highest visible insight. Expanded = executive headline
// + the top one-to-three presented groups + "Open Business Manager".
//
// Distinct from FloatingOperatorBubble (a different feature). Anchored bottom-
// LEFT (fixed, non-draggable) — a deterministic, collision-free corner away
// from the operator orb and cart pill (both bottom-right). Admin-gated by the
// AppShell mount. Fails safe: on engine error it renders nothing. Dismiss is
// SESSION-ONLY (component state) — no persistence introduced this round.
//
// Pure helpers are exported for deterministic tests (node test env, no DOM).
// ============================================================

import { useEffect, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import type { PresenterLang } from '@/services/intelligence/presentation';
import { usePresentedProactiveInsights } from './usePresentedProactiveInsights';
import { PUI, toneColorsFor } from './proactiveStrings';
import { bubbleCollapsedModel, bubbleTopGroups } from './proactiveViewModel';
// R-ORBITAL-CORE-IDENTITY-V1: canonical CellHub Intelligence seal.
import OrbitalCoreMark from '@/components/intelligence/OrbitalCoreMark';

const Z_INDEX = 850; // below the operator orb (880); different corner anyway.

export default function RecommendationBubble() {
  const { dispatch } = useApp();
  const { locale } = useTranslation();
  const lang = locale as PresenterLang;
  const { ok, presented } = usePresentedProactiveInsights();

  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // ESC collapses the expanded panel (keyboard accessibility).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Fail safe: engine error / no model / dismissed → nothing renders.
  if (!ok || !presented || dismissed) return null;

  const collapsed = bubbleCollapsedModel(presented, lang);
  const tone = collapsed.priority ? toneColorsFor(collapsed.priority) : { fg: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.35)' };
  const topGroups = bubbleTopGroups(presented);

  const openManager = () => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'manager' });
    setOpen(false);
  };

  return (
    <div style={{ position: 'fixed', left: 20, bottom: 20, zIndex: Z_INDEX, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      {open && (
        <div
          data-cellhub-recommendation-panel
          role="dialog"
          aria-label={PUI.sectionTitle(lang)}
          style={{
            width: 320, maxWidth: '86vw', maxHeight: '60vh', overflowY: 'auto',
            background: '#0f172a', border: `1px solid ${tone.border}`, borderRadius: 14,
            boxShadow: '0 18px 48px rgba(0,0,0,0.55)', padding: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <OrbitalCoreMark variant="seal" size={15} decorative />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>{PUI.sectionTitle(lang)}</span>
            </div>
            <button type="button" onClick={() => setDismissed(true)} aria-label={PUI.dismiss(lang)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>{presented.executive.headline}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topGroups.map((g) => {
              const gTone = toneColorsFor(g.priority);
              return (
                <div key={g.groupKey} style={{ border: `1px solid ${gTone.border}`, background: gTone.bg, borderRadius: 10, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span aria-hidden="true">{g.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.84rem' }}>{g.headline}</div>
                      {g.recommendation && (
                        <div style={{ color: gTone.fg, fontSize: '0.78rem', marginTop: 4 }}>{g.recommendation}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={openManager}
            style={{ marginTop: 12, width: '100%', background: '#1e293b', color: '#93c5fd', border: '1px solid #334155', borderRadius: 10, padding: '8px 12px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
          >
            {PUI.openManager(lang)} →
          </button>
        </div>
      )}

      <button
        type="button"
        data-cellhub-recommendation-bubble
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${PUI.intelligence(lang)}: ${collapsed.label}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#0f172a', border: `1.5px solid ${tone.border}`, color: '#e2e8f0',
          borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', fontSize: '0.82rem', fontWeight: 600,
        }}
      >
        <OrbitalCoreMark variant="seal" size={16} decorative />
        <span>{collapsed.label}</span>
        {collapsed.count > 0 && (
          <span style={{ background: tone.fg, color: '#0f172a', borderRadius: 999, minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, padding: '0 5px' }}>
            {collapsed.count}
          </span>
        )}
      </button>
    </div>
  );
}
