// Business Manager surface (I5) — read-only proposed actions.
// Display only: priority, description, status "Proposed", created date.
// NO accept / dismiss / start / resolve / edit / assign controls — the
// action lifecycle stays engine-side and nothing is persisted.

import type { ManagerSurfaceModel } from './managerSurfaceModel';
import { CARD, SECTION_TITLE, MUTED, TONE_COLORS } from './surfaceStyles';
import { ms, type ManagerLang } from './strings';

const PRIORITY_TONE = { critical: 'critical', high: 'warning', medium: 'neutral', low: 'neutral' } as const;

export default function ProposedActions({ model, lang }: { model: ManagerSurfaceModel; lang: ManagerLang }) {
  return (
    <div style={CARD}>
      <div style={SECTION_TITLE}>📌 {ms('proposedActions', lang)}</div>
      {model.actions.length > 0 ? model.actions.map((a, i) => {
        const tone = TONE_COLORS[PRIORITY_TONE[a.priority]];
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, border: '1px solid #1F2937', marginBottom: 6 }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: tone.fg, border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
              {a.priorityLabel}
            </span>
            <span style={{ flex: 1, color: '#e2e8f0', fontSize: '0.85rem' }}>{a.text}</span>
            <span style={{ fontSize: '0.7rem', color: '#64748b', whiteSpace: 'nowrap' }}>
              {a.statusLabel} · {a.createdYMD}
            </span>
          </div>
        );
      }) : (
        <div style={MUTED}>{model.actionsEmptyText}</div>
      )}
    </div>
  );
}
