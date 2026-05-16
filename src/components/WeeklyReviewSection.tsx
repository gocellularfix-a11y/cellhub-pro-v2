// ============================================================
// CellHub Intelligence — Weekly Operator Review UI
// R-INTELLIGENCE-WEEKLY-REVIEW-V1
//
// Compact week-in-review card. No charts, no AI essays.
// Deterministic observation summary, attention-first ordering.
// ============================================================

import type { WeeklyReviewResult, ReviewSeverity, WeekStatus } from '@/services/intelligence/review/weeklyOperatorReview';

const SEV_COLOR: Record<ReviewSeverity, string> = {
  attention: '#F59E0B',
  positive:  '#10B981',
  neutral:   '#6B7280',
};

const SEV_ICON: Record<ReviewSeverity, string> = {
  attention: '⚠',
  positive:  '✓',
  neutral:   '·',
};

const WEEK_STATUS_COLOR: Record<WeekStatus, string> = {
  strong:    '#10B981',
  stable:    '#3B82F6',
  mixed:     '#F59E0B',
  difficult: '#EF4444',
};

const WEEK_STATUS_LABEL: Record<WeekStatus, Record<string, string>> = {
  strong:    { en: 'Strong Week',    es: 'Semana Fuerte',     pt: 'Semana Forte'     },
  stable:    { en: 'Stable Week',    es: 'Semana Estable',    pt: 'Semana Estável'   },
  mixed:     { en: 'Mixed Week',     es: 'Semana Mixta',      pt: 'Semana Mista'     },
  difficult: { en: 'Difficult Week', es: 'Semana Difícil',    pt: 'Semana Difícil'   },
};

interface Props {
  review: WeeklyReviewResult;
  lang: 'en' | 'es' | 'pt';
}

export default function WeeklyReviewSection({ review, lang }: Props) {
  if (review.reviewItems.length === 0) return null;

  const statusColor = WEEK_STATUS_COLOR[review.overallWeekStatus];
  const statusLabel = WEEK_STATUS_LABEL[review.overallWeekStatus][lang];
  const headerLabel = lang === 'es' ? 'Resumen Semanal' : lang === 'pt' ? 'Revisão Semanal' : 'Weekly Review';
  const focusLabel  = lang === 'es' ? 'Próxima semana' : lang === 'pt' ? 'Próxima semana' : 'Next week';

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
          📅 {headerLabel}
        </p>
        <div style={{
          background: statusColor + '14',
          border: `1px solid ${statusColor}28`,
          borderRadius: 6,
          padding: '2px 8px',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Review items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {review.reviewItems.map((item, i) => {
          const color = SEV_COLOR[item.severity];
          const icon  = SEV_ICON[item.severity];
          return (
            <div key={item.category + i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              padding: '3px 0',
              borderBottom: i < review.reviewItems.length - 1 ? '1px solid #1F2937' : 'none',
            }}>
              {/* Severity icon */}
              <span style={{
                fontSize: 11,
                color,
                fontWeight: 700,
                flexShrink: 0,
                marginTop: 1,
                width: 12,
                textAlign: 'center',
              }}>
                {icon}
              </span>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#D1D5DB',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {item.summary}
                </div>
                {item.supportingSignal && (
                  <div style={{
                    fontSize: 10,
                    color: '#4B5563',
                    marginTop: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.supportingSignal}
                  </div>
                )}
              </div>

              {/* Confidence badge */}
              <span style={{
                fontSize: 9,
                color: '#6B7280',
                flexShrink: 0,
                marginTop: 2,
              }}>
                {item.confidence}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Next week focus */}
      {review.nextWeekFocus && (
        <div style={{
          marginTop: 8,
          padding: '4px 8px',
          background: '#0F172A',
          borderRadius: 4,
          borderLeft: '2px solid #374151',
        }}>
          <span style={{ fontSize: 10, color: '#6B7280', fontWeight: 600 }}>
            {focusLabel}:{' '}
          </span>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>
            {review.nextWeekFocus}
          </span>
        </div>
      )}
    </div>
  );
}
