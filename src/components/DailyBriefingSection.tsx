// ============================================================
// CellHub Intelligence — Daily Operations Briefing UI
// R-INTELLIGENCE-DAILY-BRIEFING-V1
//
// Compact operational briefing. Readable in under 10 seconds.
// No charts, no scrolling, no AI prose. Severity-sorted rows.
// ============================================================

import type { BriefingItem, BriefingSeverity, BriefingCategory } from '@/services/intelligence/briefing/dailyBriefing';

const SEV_COLOR: Record<BriefingSeverity, string> = {
  urgent:    '#EF4444',
  attention: '#F59E0B',
  info:      '#6B7280',
};

const SEV_DOT_BG: Record<BriefingSeverity, string> = {
  urgent:    'rgba(239,68,68,0.15)',
  attention: 'rgba(245,158,11,0.15)',
  info:      'rgba(107,114,128,0.12)',
};

const CAT_ICON: Record<BriefingCategory, string> = {
  sales_rhythm:          '📊',
  repairs:               '🔧',
  customer_opportunities:'🎯',
  collections:           '💰',
  operational_continuity:'↩️',
};

interface Props {
  items: BriefingItem[];
  lang: 'en' | 'es' | 'pt';
}

export default function DailyBriefingSection({ items, lang }: Props) {
  if (items.length === 0) return null;

  const header =
    lang === 'es' ? 'Resumen Operacional'
    : lang === 'pt' ? 'Resumo Operacional'
    : 'Operational Briefing';

  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1F2937',
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      {/* Section header */}
      <p style={{
        margin: '0 0 8px',
        fontSize: 11,
        fontWeight: 700,
        color: '#9CA3AF',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        📋 {header}
      </p>

      {/* Briefing rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item) => (
          <BriefingRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function BriefingRow({ item }: { item: BriefingItem }) {
  const color  = SEV_COLOR[item.severity];
  const dotBg  = SEV_DOT_BG[item.severity];
  const icon   = CAT_ICON[item.category];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '5px 8px',
      borderRadius: 5,
      background: item.severity === 'urgent' ? 'rgba(239,68,68,0.04)' : 'transparent',
    }}>
      {/* Severity dot */}
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        boxShadow: item.severity === 'urgent' ? `0 0 4px ${color}` : 'none',
      }} />

      {/* Category icon */}
      <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>

      {/* Summary */}
      <span style={{
        flex: 1,
        fontSize: 12,
        color: item.severity === 'urgent' ? '#F9FAFB' : '#D1D5DB',
        fontWeight: item.severity === 'urgent' ? 600 : 400,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {item.summary}
      </span>

      {/* Supporting metric chip */}
      {item.supportingMetric && (
        <span style={{
          fontSize: 10,
          color,
          background: dotBg,
          borderRadius: 4,
          padding: '1px 6px',
          fontWeight: 600,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {item.supportingMetric}
        </span>
      )}
    </div>
  );
}
