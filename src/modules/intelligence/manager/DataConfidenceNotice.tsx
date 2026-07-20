// Business Manager surface (I5) — data-confidence notices.
// Lists every area the approved dashboard marked unavailable, with an honest
// explanation. Informational styling only — a data limitation is not a
// business failure.

import type { ManagerSurfaceModel } from './managerSurfaceModel';
import { CARD, SECTION_TITLE, MUTED, TONE_COLORS } from './surfaceStyles';

export default function DataConfidenceNotice({ model }: { model: ManagerSurfaceModel }) {
  if (!model.notices) return null;
  const tone = TONE_COLORS.neutral;
  return (
    <div style={{ ...CARD, background: tone.bg, borderColor: tone.border }}>
      <div style={SECTION_TITLE}>ℹ️ {model.notices.title}</div>
      <div style={{ ...MUTED, marginBottom: 6 }}>{model.notices.explain}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {model.notices.areas.map((area, i) => (
          <span key={i} style={{ fontSize: '0.75rem', color: tone.fg, border: `1px solid ${tone.border}`, borderRadius: 999, padding: '2px 10px' }}>
            {area}
          </span>
        ))}
      </div>
    </div>
  );
}
