// Business Manager surface (I5) — supported opportunities.
// Absence of a supported opportunity finding renders the approved
// insufficient-evidence wording — never "there are no opportunities".

import type { ManagerSurfaceModel } from './managerSurfaceModel';
import { CARD, SECTION_TITLE, MUTED, TONE_COLORS } from './surfaceStyles';
import { ms, type ManagerLang } from './strings';

export default function ManagerOpportunities({ model, lang }: { model: ManagerSurfaceModel; lang: ManagerLang }) {
  return (
    <div style={CARD}>
      <div style={SECTION_TITLE}>💡 {ms('opportunities', lang)}</div>
      {model.opportunities.length > 0 ? model.opportunities.map((f, i) => (
        <div key={i} style={{ padding: '8px 10px', borderRadius: 8, background: TONE_COLORS.neutral.bg, border: `1px solid ${TONE_COLORS.neutral.border}`, marginBottom: 6 }}>
          <div style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{f.text}</div>
          {f.actionText && (
            <div style={{ fontSize: '0.78rem', color: '#93c5fd', marginTop: 3 }}>→ {f.actionText}</div>
          )}
        </div>
      )) : (
        <div style={MUTED}>{model.opportunitiesEmptyText}</div>
      )}
    </div>
  );
}
