// Business Manager surface (I5) — Performance Score + Evidence Confidence.
// Renders ONLY what the approved model provides: score and confidence are
// always adjacent and visibly distinct; opportunity-only periods show the
// honest performance-unavailable text instead — never a fabricated score.

import type { ManagerSurfaceModel } from './managerSurfaceModel';
import { CARD, SECTION_TITLE, MUTED } from './surfaceStyles';

export default function ManagerOverview({ model }: { model: ManagerSurfaceModel }) {
  if (!model.score || !model.confidence) {
    if (!model.performanceUnavailableText) return null;
    return (
      <div style={CARD}>
        <div style={{ ...MUTED, fontSize: '0.85rem' }}>{model.performanceUnavailableText}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ ...CARD, flex: '1 1 220px' }}>
        <div style={SECTION_TITLE}>{model.score.label}</div>
        <div style={{ fontSize: '2rem', fontWeight: 800, color: '#e2e8f0', lineHeight: 1.1 }}>
          {model.score.value}<span style={{ fontSize: '1rem', color: '#64748b', fontWeight: 600 }}>/100</span>
        </div>
      </div>
      <div style={{ ...CARD, flex: '1 1 220px' }}>
        <div style={SECTION_TITLE}>{model.confidence.label}</div>
        <div style={{ fontSize: '2rem', fontWeight: 800, color: '#e2e8f0', lineHeight: 1.1 }}>
          {model.confidence.pct}%
        </div>
        <div style={{ ...MUTED, marginTop: 4 }}>{model.confidence.hint}</div>
      </div>
    </div>
  );
}
