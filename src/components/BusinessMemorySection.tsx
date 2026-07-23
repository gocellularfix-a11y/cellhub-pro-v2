// ============================================================
// CellHub Intelligence — Business Memory UI
// R-INTELLIGENCE-BUSINESS-MEMORY-V1
//
// Compact observational pattern rows. Calm, trustworthy tone.
// No charts, no AI prose, no fortune telling.
// ============================================================

import type { BusinessMemoryInsight, MemoryCategory } from '@/services/intelligence/memory/businessMemory';
// R-ORBITAL-CORE-IDENTITY-V1: canonical CellHub Intelligence seal.
import OrbitalCoreMark from '@/components/intelligence/OrbitalCoreMark';

const CAT_ICON: Record<MemoryCategory, string> = {
  sales_rhythm:     '🕑',
  repairs:          '🔧',
  customer_outreach:'💬',
  collections:      '💰',
  operational:      '↩️',
};

interface Props {
  insights: BusinessMemoryInsight[];
  lang: 'en' | 'es' | 'pt';
}

export default function BusinessMemorySection({ insights, lang }: Props) {
  if (insights.length === 0) return null;

  const header =
    lang === 'es' ? 'Patrones de Negocio'
    : lang === 'pt' ? 'Padrões do Negócio'
    : 'Business Patterns';

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
        <OrbitalCoreMark variant="seal" size={13} decorative />
        {' '}{header}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {insights.map((item, idx) => (
          <MemoryRow key={idx} item={item} lang={lang} />
        ))}
      </div>
    </div>
  );
}

function MemoryRow({ item, lang }: { item: BusinessMemoryInsight; lang: 'en' | 'es' | 'pt' }) {
  const icon = CAT_ICON[item.category];
  const confLabel =
    lang === 'es' ? `${item.confidence}%`
    : lang === 'pt' ? `${item.confidence}%`
    : `${item.confidence}%`;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 6px',
      borderRadius: 5,
    }}>
      {/* Category icon */}
      <span style={{ fontSize: 12, flexShrink: 0, opacity: 0.8 }}>{icon}</span>

      {/* Insight text */}
      <span style={{
        flex: 1,
        fontSize: 12,
        color: '#CBD5E1',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {item.insight}
      </span>

      {/* Supporting signal (optional, muted) */}
      {item.supportingSignal && (
        <span style={{
          fontSize: 10,
          color: '#4B5563',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {item.supportingSignal}
        </span>
      )}

      {/* Confidence badge */}
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        color: '#6EE7B7',
        background: 'rgba(110,231,183,0.08)',
        border: '1px solid rgba(110,231,183,0.18)',
        borderRadius: 4,
        padding: '1px 5px',
        flexShrink: 0,
      }}>
        {confLabel}
      </span>
    </div>
  );
}
