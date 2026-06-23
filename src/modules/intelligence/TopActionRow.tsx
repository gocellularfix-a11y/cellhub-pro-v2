// ============================================================
// R-INTELLIGENCE-F3D3: shared TopAction row renderer.
//
// Single source of DATA rendering for a Top 3 Actions Today item — used by both
// the Intelligence-panel card (TopActionsTodayCard) and the operator Daily Brief
// (OperatorTodayBriefing). The data shown (title, reason, confidence, $ impact
// with Policy-C redaction, approval indicator) is identical across surfaces;
// only LAYOUT differs via the `variant` prop ('card' | 'brief'). Read-only — no
// buttons, no execution, no state mutation.
// ============================================================

import type { TopAction } from '@/services/intelligence/decision/ranking/topActionsRanking';

type TFn = (key: string, ...args: any[]) => string;
export type TopActionVariant = 'card' | 'brief';

/** Whether the $ impact may be shown — redacted for non-owners on financialSensitive items (Policy C). */
export function shouldShowImpact(a: TopAction, canSeeOwnerFinancials: boolean): boolean {
  return a.impactCents !== undefined && a.impactCents > 0 && (!a.financialSensitive || canSeeOwnerFinancials);
}

/** Canonical $ impact format (whole dollars). */
export function formatImpact(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

interface Props {
  action: TopAction;
  index: number;
  /** Translator — `t` from useTranslation (card) or tChat(locale) (brief). */
  t: TFn;
  canSeeOwnerFinancials: boolean;
  variant?: TopActionVariant;
}

export default function TopActionRow({ action: a, index, t, canSeeOwnerFinancials, variant = 'card' }: Props) {
  const showImpact = shouldShowImpact(a, canSeeOwnerFinancials);
  const isBrief = variant === 'brief';

  return (
    <div style={{ display: 'flex', gap: isBrief ? 8 : 10, alignItems: 'flex-start', ...(isBrief ? { fontSize: 12.5 } : {}) }}>
      {isBrief ? (
        <span style={{ flexShrink: 0, color: '#64748B', fontWeight: 700 }}>{index + 1}.</span>
      ) : (
        <span style={{
          flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
          background: '#0f172a', color: '#94A3B8', fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{index + 1}</span>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...(isBrief ? {} : { fontSize: 13 }), fontWeight: 600, color: '#E2E8F0' }}>{a.title}</div>
        <div style={{ fontSize: isBrief ? 11.5 : 12, color: '#94A3B8', marginTop: 1 }}>{a.reason}</div>
        <div style={{
          fontSize: isBrief ? 10.5 : 11, color: '#64748B', marginTop: isBrief ? 2 : 3,
          display: 'flex', flexWrap: 'wrap', gap: isBrief ? 6 : 8,
        }}>
          <span>{t('intelligence.topActions.confidence')}: {a.confidence}%</span>
          {showImpact && <span>· {formatImpact(a.impactCents as number)}</span>}
          {a.approvalRequired && (
            <span style={{ color: '#FBBF24' }}>· 🔒 {t('intelligence.topActions.approvalRequired')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
