// Business Manager surface (I5) — compact executive summary (approved
// presenter lines only; hidden for opportunity-only periods so the page
// never implies a completed performance evaluation).

import type { ManagerSurfaceModel } from './managerSurfaceModel';
import { CARD, SECTION_TITLE } from './surfaceStyles';
import { ms, type ManagerLang } from './strings';

export default function ExecutiveSummary({ model, lang }: { model: ManagerSurfaceModel; lang: ManagerLang }) {
  if (model.executiveSummary.length === 0) return null;
  return (
    <div style={CARD}>
      <div style={SECTION_TITLE}>📋 {ms('executiveSummary', lang)}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {model.executiveSummary.map((line, i) => (
          <li key={i} style={{ color: '#e2e8f0', fontSize: '0.85rem', marginBottom: 3 }}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
