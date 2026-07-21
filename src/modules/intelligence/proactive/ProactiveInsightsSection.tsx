// ============================================================
// I6-C2 — "Today's Intelligence" — additive Business Manager section.
//
// First VISIBLE consumer of the I6-C1 presenter. Renders ONLY canonical
// PresentedInsights: it never re-orders, re-groups, re-words or re-scores.
// Coexists with the approved I4 Business Manager sections (additive — nothing
// existing is removed). No internal terminology (detector ids, fingerprints,
// cents, enum keys, diagnostics) is ever shown. Empty/insufficient-evidence
// states render the presenter's honest executive headline — silence is never
// dressed up as "everything is healthy".
//
// Pure helpers are exported for deterministic tests (the repo test env is
// node — no DOM renderer — so component logic is verified through them).
// ============================================================

import { useState } from 'react';
import type { InsightCard, PresentedInsights, PresenterLang } from '@/services/intelligence/presentation';
import { CARD, MUTED } from '../manager/surfaceStyles';
import { PUI, toneColorsFor } from './proactiveStrings';
import { shouldShowConfidence } from './proactiveViewModel';

function ExecutiveBlock({ presented }: { presented: PresentedInsights }) {
  return (
    <div style={{ marginBottom: presented.cards.length ? 12 : 0 }}>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0' }}>{presented.executive.headline}</div>
      {presented.executive.lines.length > 0 && (
        <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {presented.executive.lines.map((line, i) => (
            <li key={i} style={{ ...MUTED, fontSize: '0.85rem', display: 'flex', gap: 8 }}>
              <span aria-hidden="true">•</span><span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightCardRow({ card, lang }: { card: InsightCard; lang: PresenterLang }) {
  const [open, setOpen] = useState(false);
  const tone = toneColorsFor(card.priority);
  const hasDetails = card.expandableDetails.length > 0;
  return (
    <div style={{ border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span aria-hidden="true" style={{ fontSize: '1.1rem', lineHeight: 1.3 }}>{card.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.9rem' }}>{card.headline}</div>
          <div style={{ ...MUTED, fontSize: '0.82rem', marginTop: 2 }}>{card.summary}</div>
          {card.recommendation && (
            <div style={{ marginTop: 6, fontSize: '0.82rem', color: tone.fg, display: 'flex', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>{PUI.recommendation(lang)}:</span>
              <span style={{ color: '#cbd5e1' }}>{card.recommendation}</span>
            </div>
          )}
          {open && hasDetails && (
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {card.expandableDetails.map((d, i) => (
                <li key={i} style={{ ...MUTED, fontSize: '0.78rem' }}>{d}</li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {shouldShowConfidence(card) && (
            <span style={{ ...MUTED, fontSize: '0.68rem', whiteSpace: 'nowrap' }}>{PUI.evidenceConfidence(card.confidencePct, lang)}</span>
          )}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              style={{ background: 'transparent', border: `1px solid ${tone.border}`, color: tone.fg, borderRadius: 8, padding: '2px 8px', fontSize: '0.68rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {open ? PUI.hideDetails(lang) : PUI.showDetails(lang)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProactiveInsightsSection({ presented, lang }: { presented: PresentedInsights | null; lang: PresenterLang }) {
  // No presented model (engine error upstream) → render nothing; the host
  // page owns its own error notice. Never a fabricated card.
  if (!presented) return null;
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span aria-hidden="true">🧠</span>
        <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#e2e8f0', fontWeight: 700 }}>{PUI.sectionTitle(lang)}</h3>
        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#93c5fd', border: '1px solid #334155', borderRadius: 999, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {PUI.live(lang)}
        </span>
      </div>

      <ExecutiveBlock presented={presented} />

      {presented.cards.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {presented.cards.map((card) => (
            <InsightCardRow key={card.fingerprint} card={card} lang={lang} />
          ))}
        </div>
      )}

      {presented.suppressed.length > 0 && (
        <div style={{ ...MUTED, fontSize: '0.72rem', marginTop: 10 }}>
          {PUI.moreItems(presented.suppressed.length, lang)}
        </div>
      )}
    </div>
  );
}
