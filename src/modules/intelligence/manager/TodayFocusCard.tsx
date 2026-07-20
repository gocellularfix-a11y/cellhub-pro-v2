// Business Manager surface (I5) — Today's Focus (approved dashboard focus
// only; the UI never picks a fallback focus).

import type { ManagerSurfaceModel } from './managerSurfaceModel';
import { CARD, SECTION_TITLE, MUTED } from './surfaceStyles';
import { ms, type ManagerLang } from './strings';

export default function TodayFocusCard({ model, lang }: { model: ManagerSurfaceModel; lang: ManagerLang }) {
  return (
    <div style={{ ...CARD, borderColor: '#334155' }}>
      <div style={SECTION_TITLE}>🎯 {ms('todaysFocus', lang)}</div>
      {model.focus ? (
        <>
          <div style={{ color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 600 }}>{model.focus.text}</div>
          <div style={{ ...MUTED, marginTop: 4 }}>{model.focus.why}</div>
          {model.focus.actionText && (
            <div style={{ marginTop: 8, fontSize: '0.85rem', color: '#93c5fd' }}>
              → {ms('proposedActionLabel', lang)}: {model.focus.actionText}
            </div>
          )}
        </>
      ) : (
        <div style={MUTED}>{model.focusEmptyText}</div>
      )}
    </div>
  );
}
