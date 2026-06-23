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

type TFn = (key: string, ...args: any[]) => string;

interface Props {
  actions: TopAction[];
  t: TFn;
  /** When false, financialSensitive $ impact is hidden (Policy C). */
  canSeeOwnerFinancials: boolean;
}

function formatImpact(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
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
          {actions.map((a, i) => {
            const showImpact = a.impactCents !== undefined && a.impactCents > 0
              && (!a.financialSensitive || canSeeOwnerFinancials);
            return (
              <div key={a.decisionId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{
                  flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                  background: '#0f172a', color: '#94A3B8', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{i + 1}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 1 }}>{a.reason}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <span>{t('intelligence.topActions.confidence')}: {a.confidence}%</span>
                    {showImpact && <span>· {formatImpact(a.impactCents as number)}</span>}
                    {a.approvalRequired && (
                      <span style={{ color: '#fbbf24' }}>· 🔒 {t('intelligence.topActions.approvalRequired')}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
