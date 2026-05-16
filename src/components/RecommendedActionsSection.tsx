// ============================================================
// CellHub Intelligence — Recommended Actions UI
// R-INTELLIGENCE-DECISION-RECOMMENDATION-V1
//
// Compact action-oriented rows. Practical, operational, grounded.
// No charts, no AI hype, no motivational language.
// ============================================================

import type { OperatorRecommendation, RecommendationSeverity, RecommendationAction } from '@/services/intelligence/recommendations/operatorRecommendations';

const SEV_COLOR: Record<RecommendationSeverity, string> = {
  critical: '#EF4444',
  high:     '#F59E0B',
  medium:   '#3B82F6',
  low:      '#6B7280',
};

const ACTION_LABEL: Record<RecommendationAction, { en: string; es: string; pt: string }> = {
  open_repairs:   { en: '→ Repairs',   es: '→ Reparaciones', pt: '→ Reparos'    },
  open_customers: { en: '→ Customers', es: '→ Clientes',      pt: '→ Clientes'   },
  open_missions:  { en: '→ Missions',  es: '→ Misiones',      pt: '→ Missões'    },
  open_queue:     { en: '→ Queue',     es: '→ Cola',          pt: '→ Fila'       },
};

// Only surface navigation shortcuts for tabs that require leaving Intelligence.
const NAVIGABLE_ACTIONS = new Set<RecommendationAction>(['open_repairs', 'open_customers']);

interface Props {
  recommendations: OperatorRecommendation[];
  lang: 'en' | 'es' | 'pt';
  onAction: (action: RecommendationAction) => void;
}

export default function RecommendedActionsSection({ recommendations, lang, onAction }: Props) {
  if (recommendations.length === 0) return null;

  const header =
    lang === 'es' ? 'Acciones Recomendadas'
    : lang === 'pt' ? 'Ações Recomendadas'
    : 'Recommended Actions';

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
        ⚡ {header}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {recommendations.map((rec, idx) => (
          <RecommendationRow
            key={idx}
            rec={rec}
            lang={lang}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  );
}

function RecommendationRow({
  rec, lang, onAction,
}: {
  rec: OperatorRecommendation;
  lang: 'en' | 'es' | 'pt';
  onAction: (action: RecommendationAction) => void;
}) {
  const color    = SEV_COLOR[rec.severity];
  const showNav  = rec.relatedAction && NAVIGABLE_ACTIONS.has(rec.relatedAction);
  const navLabel = rec.relatedAction ? ACTION_LABEL[rec.relatedAction][lang] : '';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '6px 8px',
      borderRadius: 6,
      background: rec.severity === 'critical' ? `${color}06` : 'transparent',
      borderLeft: `2px solid ${color}`,
    }}>
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 12,
            fontWeight: 700,
            color: rec.severity === 'critical' ? '#F1F5F9' : '#CBD5E1',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {rec.title}
          </span>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color,
            background: color + '18',
            border: `1px solid ${color}28`,
            borderRadius: 4,
            padding: '1px 5px',
            flexShrink: 0,
          }}>
            {rec.confidence}%
          </span>
        </div>

        {/* Recommendation text */}
        <div style={{
          fontSize: 11,
          color: '#94A3B8',
          marginTop: 2,
          lineHeight: 1.4,
        }}>
          {rec.recommendation}
        </div>

        {/* Supporting reason + nav button row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 4,
        }}>
          <span style={{
            fontSize: 10,
            color: '#4B5563',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {rec.supportingReason}
          </span>
          {showNav && rec.relatedAction && (
            <button
              onClick={() => onAction(rec.relatedAction!)}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color,
                background: 'transparent',
                border: `1px solid ${color}40`,
                borderRadius: 4,
                padding: '1px 6px',
                cursor: 'pointer',
                flexShrink: 0,
                lineHeight: '16px',
              }}
            >
              {navLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
