// ============================================================
// CellHub Intelligence — Strategic Insights UI
// R-INTELLIGENCE-STRATEGIC-OPERATOR-V1
//
// Compact premium rows. Observational, operational, trustworthy.
// No charts, no AI hype, no fortune telling.
// ============================================================

import type { StrategicInsight, StrategicCategory, StrategicSeverity } from '@/services/intelligence/strategy/strategicOperator';

const CAT_ICON: Record<StrategicCategory, string> = {
  revenue_recovery:       '💰',
  sales_opportunity:      '🎯',
  operational_efficiency: '↩️',
  customer_retention:     '💬',
  business_rhythm:        '🕑',
};

const SEV_COLOR: Record<StrategicSeverity, string> = {
  strategic: '#8B5CF6',
  attention: '#F59E0B',
  insight:   '#6B7280',
};

interface Props {
  insights: StrategicInsight[];
  lang: 'en' | 'es' | 'pt';
}

export default function StrategicInsightsSection({ insights, lang }: Props) {
  if (insights.length === 0) return null;

  const header =
    lang === 'es' ? 'Perspectivas Estratégicas'
    : lang === 'pt' ? 'Perspectivas Estratégicas'
    : 'Strategic Insights';

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
        📡 {header}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {insights.map((item, idx) => (
          <StrategicRow key={idx} item={item} />
        ))}
      </div>
    </div>
  );
}

function StrategicRow({ item }: { item: StrategicInsight }) {
  const color = SEV_COLOR[item.severity];
  const icon  = CAT_ICON[item.category];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '5px 6px',
      borderRadius: 5,
      background: item.severity === 'strategic' ? 'rgba(139,92,246,0.04)' : 'transparent',
    }}>
      {/* Severity dot */}
      <span style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        marginTop: 5,
        boxShadow: item.severity === 'strategic' ? `0 0 4px ${color}` : 'none',
      }} />

      {/* Category icon */}
      <span style={{ fontSize: 12, flexShrink: 0, opacity: 0.85 }}>{icon}</span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: item.severity === 'strategic' ? '#E2E8F0' : '#CBD5E1',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {item.title}
          </span>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color,
            background: color + '18',
            border: `1px solid ${color}30`,
            borderRadius: 4,
            padding: '1px 5px',
            flexShrink: 0,
          }}>
            {item.confidence}%
          </span>
        </div>

        <div style={{
          fontSize: 11,
          color: '#4B5563',
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {item.summary}
          {item.supportingSignal && (
            <span style={{ color: '#374151', marginLeft: 4 }}>· {item.supportingSignal}</span>
          )}
        </div>
      </div>
    </div>
  );
}
