// Business Manager surface (I5) — the eight approved health sections.
// Status text comes from the approved presenter; unavailable renders with a
// NEUTRAL/informational treatment — never success green, never failure red,
// and never anything implying a completed healthy evaluation.

import type { ManagerSurfaceModel } from './managerSurfaceModel';
import { healthTone } from './managerSurfaceModel';
import { CARD, SECTION_TITLE, TONE_COLORS } from './surfaceStyles';
import { ms, type ManagerLang } from './strings';

export default function BusinessHealthGrid({ model, lang }: { model: ManagerSurfaceModel; lang: ManagerLang }) {
  return (
    <div style={CARD}>
      <div style={SECTION_TITLE}>🩺 {ms('businessHealth', lang)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {model.health.map((h, i) => {
          const tone = TONE_COLORS[healthTone(h.status)];
          return (
            <div key={i} style={{ padding: '8px 10px', borderRadius: 8, background: tone.bg, border: `1px solid ${tone.border}` }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0' }}>{h.label}</div>
              <div style={{ fontSize: '0.75rem', color: tone.fg, marginTop: 2 }}>{h.statusLabel}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
