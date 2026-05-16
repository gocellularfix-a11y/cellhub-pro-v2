// ============================================================
// CellHub Intelligence — Execution Chain UI
// R-INTELLIGENCE-EXECUTION-CHAINING-V1
//
// Compact contextual "Suggested Next Steps" surface.
// Appears after operator actions. No modal, no spam.
// Dismissable, short-lived, action-oriented.
// ============================================================

import type { ExecutionChain, ChainedAction } from '@/services/intelligence/execution/executionChaining';

const NAV_ICON: Record<string, string> = {
  repairs:      '🔧',
  customers:    '👤',
  layaways:     '🏷',
  intelligence: '📡',
};

interface Props {
  chain: ExecutionChain;
  lang: 'en' | 'es' | 'pt';
  onDismiss: () => void;
  onAction: (action: ChainedAction) => void;
}

export default function ExecutionChainPanel({ chain, lang, onDismiss, onAction }: Props) {
  const headerLabel =
    lang === 'es' ? 'Siguientes Pasos Sugeridos'
    : lang === 'pt' ? 'Próximas Etapas Sugeridas'
    : 'Suggested Next Steps';

  const fromLabel =
    lang === 'es' ? 'Después de'
    : lang === 'pt' ? 'Depois de'
    : 'After';

  return (
    <div style={{
      background: '#0F172A',
      border: '1px solid #1E3A5F',
      borderLeft: '3px solid #3B82F6',
      borderRadius: 8,
      padding: '8px 10px',
      position: 'relative',
    }}>
      {/* Dismiss button */}
      <button
        onClick={onDismiss}
        style={{
          position: 'absolute',
          top: 6,
          right: 8,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#4B5563',
          fontSize: 14,
          lineHeight: 1,
          padding: '0 2px',
        }}
        title={lang === 'es' ? 'Descartar' : 'Dismiss'}
      >
        ×
      </button>

      {/* Header */}
      <div style={{ marginBottom: 6, paddingRight: 20 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#3B82F6',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          → {headerLabel}
        </span>
        <span style={{
          fontSize: 10,
          color: '#374151',
          marginLeft: 6,
        }}>
          {fromLabel}: {chain.sourceAction}
        </span>
      </div>

      {/* Action list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {chain.nextActions.map((action) => (
          <ActionRow
            key={action.type}
            action={action}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  );
}

function ActionRow({
  action,
  onAction,
}: {
  action: ChainedAction;
  onAction: (a: ChainedAction) => void;
}) {
  const navIcon = action.navigationTarget ? NAV_ICON[action.navigationTarget] : '→';
  const isNavigable = !!action.navigationTarget;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 0',
    }}>
      {/* Arrow indicator */}
      <span style={{
        fontSize: 10,
        color: '#374151',
        flexShrink: 0,
        width: 10,
      }}>
        →
      </span>

      {/* Text content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#CBD5E1',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'block',
        }}>
          {action.title}
        </span>
        <span style={{
          fontSize: 10,
          color: '#4B5563',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'block',
        }}>
          {action.summary}
        </span>
      </div>

      {/* Navigation button — only for navigable actions */}
      {isNavigable && (
        <button
          onClick={() => onAction(action)}
          style={{
            flexShrink: 0,
            background: 'rgba(59,130,246,0.08)',
            border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 10,
            color: '#60A5FA',
            cursor: 'pointer',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          {navIcon}
        </button>
      )}
    </div>
  );
}
