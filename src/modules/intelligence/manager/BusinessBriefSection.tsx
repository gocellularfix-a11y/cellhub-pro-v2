// Business Manager surface (I5) — expandable full Business Brief.
// Renders the APPROVED formatBusinessBrief presenter output verbatim, so the
// full brief always preserves score + evidence confidence + warnings +
// unavailable notices exactly as the I4 contract emits them. Opportunity-only
// periods render the honest no-data text instead of a completed brief.

import { useState } from 'react';
import type { ManagerSurfaceModel } from './managerSurfaceModel';
import { CARD, SECTION_TITLE, MUTED } from './surfaceStyles';
import { ms, type ManagerLang } from './strings';

export default function BusinessBriefSection({ model, lang }: { model: ManagerSurfaceModel; lang: ManagerLang }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ ...SECTION_TITLE, marginBottom: 0 }}>🗂️ {ms('fullBrief', lang)}</div>
        {model.briefText && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#93c5fd', fontSize: '0.75rem', padding: '4px 10px', cursor: 'pointer' }}
          >
            {open ? ms('hideBrief', lang) : ms('showBrief', lang)}
          </button>
        )}
      </div>
      {!model.briefText && <div style={{ ...MUTED, marginTop: 8 }}>{model.briefUnavailableText}</div>}
      {model.briefText && open && (
        <pre style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.5 }}>
          {model.briefText}
        </pre>
      )}
      {model.questions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...MUTED, marginBottom: 6 }}>{ms('suggestedQuestions', lang)}:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {model.questions.map((q, i) => (
              <span key={i} style={{ fontSize: '0.78rem', color: '#93c5fd', border: '1px solid #1e3a5f', background: 'rgba(56,189,248,0.06)', borderRadius: 999, padding: '3px 10px' }}>
                {q}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
