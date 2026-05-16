// ============================================================
// CellHub Intelligence — Operational Continuity Panel
// R-INTELLIGENCE-CONTINUITY-V1
//
// Compact "Continue Working" section. Shows up to 3 items
// that represent started-but-unfinished operational flows.
// Resume reopens the right context. Dismiss hides for 4h.
// ============================================================

import type { ContinuityItem, ContinuityType } from '@/services/intelligence/continuity/continuityEngine';

const TYPE_ICON: Record<ContinuityType, string> = {
  repair_followup_pending: '🔔',
  approval_pending:        '⚠️',
  outreach_pending:        '📱',
  interrupted_workflow:    '↩️',
};

const TYPE_COLOR: Record<ContinuityType, string> = {
  repair_followup_pending: '#60A5FA',   // blue
  approval_pending:        '#FCD34D',   // amber
  outreach_pending:        '#6EE7B7',   // green
  interrupted_workflow:    '#C4B5FD',   // purple
};

interface Props {
  items: ContinuityItem[];
  lang: 'en' | 'es' | 'pt';
  onResume: (item: ContinuityItem) => void;
  onDismiss: (id: string) => void;
}

export default function ContinuityPanel({ items, lang, onResume, onDismiss }: Props) {
  if (items.length === 0) return null;

  const header =
    lang === 'es' ? 'Continúa donde ibas' :
    lang === 'pt' ? 'Continue de onde parou' :
    'Continue Working';

  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1F2937',
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <p style={{
        margin: '0 0 8px',
        fontSize: 11,
        fontWeight: 700,
        color: '#9CA3AF',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        ↩️ {header}
        <span style={{ marginLeft: 6, fontWeight: 400, color: '#6B7280' }}>
          ({items.length})
        </span>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item) => (
          <ContinuityCard
            key={item.id}
            item={item}
            lang={lang}
            onResume={onResume}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}

function ContinuityCard({
  item, lang, onResume, onDismiss,
}: {
  item: ContinuityItem;
  lang: 'en' | 'es' | 'pt';
  onResume: (item: ContinuityItem) => void;
  onDismiss: (id: string) => void;
}) {
  const color  = TYPE_COLOR[item.type];
  const icon   = TYPE_ICON[item.type];

  const resumeLabel =
    lang === 'es'
      ? (item.type === 'repair_followup_pending' ? 'Ver reparación' :
         item.type === 'approval_pending'        ? 'Revisar' :
         item.type === 'outreach_pending'        ? (item.phone ? 'Mensaje' : 'Ver') :
         'Ir a POS')
      : lang === 'pt'
      ? (item.type === 'repair_followup_pending' ? 'Ver reparo' :
         item.type === 'approval_pending'        ? 'Revisar' :
         item.type === 'outreach_pending'        ? (item.phone ? 'Mensagem' : 'Ver') :
         'Ir ao POS')
      : (item.suggestedAction || 'Resume');

  const dismissLabel = lang === 'es' ? 'Ignorar' : lang === 'pt' ? 'Ignorar' : 'Dismiss';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '7px 10px',
      background: '#0F172A',
      borderRadius: 6,
      border: '1px solid #1E293B',
    }}>
      {/* Icon */}
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icon}</span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 600,
          color,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.title}
        </p>
        <p style={{
          margin: '2px 0 0',
          fontSize: 11,
          color: '#9CA3AF',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.summary}
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
        <button
          onClick={() => onResume(item)}
          style={{
            background: 'rgba(255,255,255,0.06)',
            color: color,
            border: `1px solid ${color}40`,
            borderRadius: 5,
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {resumeLabel}
        </button>
        <button
          onClick={() => onDismiss(item.id)}
          style={{
            background: 'transparent',
            color: '#4B5563',
            border: 'none',
            padding: '3px 4px',
            fontSize: 11,
            cursor: 'pointer',
          }}
          title={dismissLabel}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
