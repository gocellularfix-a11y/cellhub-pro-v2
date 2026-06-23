// ============================================================
// R-INTELLIGENCE-F3C: Top 3 Actions Today — read-only display card.
//
// The first VISIBLE consumer of the canonical Track A pipeline (getTopActionsToday
// / F3B). Pure presentation: it renders the ranked recommendations and NOTHING
// else — no buttons, no onClick, no execution, no approval, no state mutation.
// The $ impact is redacted for non-owners when the decision is financialSensitive
// (Policy C — margin/cost stays owner-only).
// ============================================================

import type { TopAction } from '@/services/intelligence/decision/ranking/topActionsRanking';

import TopActionRow from './TopActionRow';

type TFn = (key: string, ...args: any[]) => string;

interface Props {
  actions: TopAction[];
  t: TFn;
  /** When false, financialSensitive $ impact is hidden (Policy C). */
  canSeeOwnerFinancials: boolean;
}

export default function TopActionsTodayCard({ actions, t, canSeeOwnerFinancials }: Props) {
  return (
    <div
      style={{
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 10,
        padding: '12px 14px',
        margin: '0 0 12px 0',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em', marginBottom: 8 }}>
        ⚡ {t('intelligence.topActions.title')}
      </div>

      {actions.length === 0 ? (
        <div style={{ fontSize: 12, color: '#64748b', padding: '6px 2px' }}>
          {t('intelligence.topActions.empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {actions.map((a, i) => (
            <TopActionRow
              key={a.decisionId}
              action={a}
              index={i}
              t={t}
              canSeeOwnerFinancials={canSeeOwnerFinancials}
              variant="card"
            />
          ))}
        </div>
      )}
    </div>
  );
}
