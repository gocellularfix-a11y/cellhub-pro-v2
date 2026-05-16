// ============================================================
// CellHub Intelligence — Operational Health UI
// R-INTELLIGENCE-OPERATIONAL-HEALTH-V1
//
// Compact grounded health view. No gauges, no speedometers,
// no charts. Trustworthy, calm, executive tone.
// ============================================================

import type { OperationalHealthResult, HealthStatus, HealthDimensionKey } from '@/services/intelligence/health/operationalHealth';
import { DIMENSION_LABEL } from '@/services/intelligence/health/operationalHealth';

const STATUS_COLOR: Record<HealthStatus, string> = {
  strong:   '#10B981',
  stable:   '#3B82F6',
  weak:     '#F59E0B',
  critical: '#EF4444',
};

const STATUS_LABEL: Record<HealthStatus, Record<string, string>> = {
  strong:   { en: 'Strong',         es: 'Fuerte',          pt: 'Forte'         },
  stable:   { en: 'Stable',         es: 'Estable',         pt: 'Estável'       },
  weak:     { en: 'Under Pressure', es: 'Bajo Presión',    pt: 'Sob Pressão'   },
  critical: { en: 'Critical',       es: 'Crítico',         pt: 'Crítico'       },
};

const DIM_LABEL_LOCALIZED: Record<HealthDimensionKey, Record<string, string>> = {
  execution_health:      { en: 'Execution',          es: 'Ejecución',           pt: 'Execução'          },
  customer_health:       { en: 'Customer Outreach',  es: 'Contacto Clientes',   pt: 'Contato Clientes'  },
  repair_health:         { en: 'Repair Backlog',     es: 'Backlog Reparaciones', pt: 'Backlog Reparos'   },
  collection_health:     { en: 'Collections',        es: 'Cobranza',            pt: 'Cobrança'          },
  operational_stability: { en: 'Stability',          es: 'Estabilidad',         pt: 'Estabilidade'      },
};

interface Props {
  health: OperationalHealthResult;
  lang: 'en' | 'es' | 'pt';
}

export default function OperationalHealthSection({ health, lang }: Props) {
  const overallColor  = STATUS_COLOR[health.overallStatus];
  const overallLabel  = STATUS_LABEL[health.overallStatus][lang];
  const headerLabel   = lang === 'es' ? 'Salud Operacional' : lang === 'pt' ? 'Saúde Operacional' : 'Operational Health';
  const strongestLabel = lang === 'es' ? 'Mayor fortaleza' : lang === 'pt' ? 'Maior força' : 'Strongest';
  const weakestLabel   = lang === 'es' ? 'Mayor presión'   : lang === 'pt' ? 'Maior pressão' : 'Most pressure';

  // Show up to 3 dimensions — worst first, then mid, then best
  const sorted = [...health.dimensions].sort((a, b) => a.score - b.score);
  const visible = sorted.slice(0, 3);

  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1F2937',
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 700,
          color: '#9CA3AF',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          🏥 {headerLabel}
        </p>
        {/* Overall score chip */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: overallColor + '14',
          border: `1px solid ${overallColor}28`,
          borderRadius: 6,
          padding: '2px 8px',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: overallColor }}>
            {overallLabel}
          </span>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            color: overallColor,
            opacity: 0.75,
          }}>
            {health.overallScore}
          </span>
        </div>
      </div>

      {/* Strongest / Weakest chips */}
      {(health.strongestArea || health.weakestArea) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {health.strongestArea && (
            <span style={{ fontSize: 10, color: '#10B981', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: 4, padding: '1px 6px' }}>
              ↑ {strongestLabel}: {DIM_LABEL_LOCALIZED[health.strongestArea][lang]}
            </span>
          )}
          {health.weakestArea && health.weakestArea !== health.strongestArea && (
            <span style={{ fontSize: 10, color: '#F59E0B', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: 4, padding: '1px 6px' }}>
              ↓ {weakestLabel}: {DIM_LABEL_LOCALIZED[health.weakestArea][lang]}
            </span>
          )}
        </div>
      )}

      {/* Dimension rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visible.map((dim) => (
          <DimensionRow key={dim.dimension} dim={dim} lang={lang} />
        ))}
      </div>
    </div>
  );
}

function DimensionRow({
  dim, lang,
}: {
  dim: OperationalHealthResult['dimensions'][number];
  lang: 'en' | 'es' | 'pt';
}) {
  const color = STATUS_COLOR[dim.status];
  const label = DIM_LABEL_LOCALIZED[dim.dimension][lang];
  const statusLabel = STATUS_LABEL[dim.status][lang];

  // Score bar width
  const barWidth = `${dim.score}%`;

  return (
    <div style={{ padding: '3px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {/* Dimension name */}
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#94A3B8',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>

        {/* Status label */}
        <span style={{
          fontSize: 10,
          color,
          fontWeight: 600,
          flexShrink: 0,
        }}>
          {statusLabel} · {dim.score}
        </span>
      </div>

      {/* Thin score bar */}
      <div style={{
        height: 3,
        background: '#1F2937',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: barWidth,
          background: color,
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Reason text */}
      <div style={{
        fontSize: 10,
        color: '#4B5563',
        marginTop: 2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {dim.reason}
      </div>
    </div>
  );
}
