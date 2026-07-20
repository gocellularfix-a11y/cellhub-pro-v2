// Business Manager surface (I5) — critical alerts + risks/warnings.
// Critical and warning stay visually distinct; refusal/data-quality findings
// never appear here (the approved brief already keeps them out).

import type { ManagerSurfaceModel, FindingView } from './managerSurfaceModel';
import { CARD, SECTION_TITLE, MUTED, TONE_COLORS } from './surfaceStyles';
import { ms, type ManagerLang } from './strings';

function FindingRow({ item, tone }: { item: FindingView; tone: 'critical' | 'warning' | 'positive' | 'neutral' }) {
  const c = TONE_COLORS[tone];
  return (
    <div style={{ padding: '8px 10px', borderRadius: 8, background: c.bg, border: `1px solid ${c.border}`, marginBottom: 6 }}>
      <div style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{item.text}</div>
      {item.actionText && (
        <div style={{ fontSize: '0.78rem', color: '#93c5fd', marginTop: 3 }}>→ {item.actionText}</div>
      )}
    </div>
  );
}

export default function ManagerAlerts({ model, lang }: { model: ManagerSurfaceModel; lang: ManagerLang }) {
  const hasAny = model.criticalAlerts.length + model.warnings.length > 0;
  return (
    <div style={CARD}>
      {model.criticalAlerts.length > 0 && (
        <>
          <div style={{ ...SECTION_TITLE, color: TONE_COLORS.critical.fg }}>🚨 {ms('criticalAlerts', lang)}</div>
          {model.criticalAlerts.map((f, i) => <FindingRow key={`c${i}`} item={f} tone="critical" />)}
        </>
      )}
      <div style={{ ...SECTION_TITLE, color: TONE_COLORS.warning.fg, marginTop: model.criticalAlerts.length > 0 ? 10 : 0 }}>
        ⚠️ {ms('risksAndWarnings', lang)}
      </div>
      {model.warnings.map((f, i) => <FindingRow key={`w${i}`} item={f} tone="warning" />)}
      {!hasAny && <div style={MUTED}>{model.alertsEmptyText}</div>}
    </div>
  );
}
