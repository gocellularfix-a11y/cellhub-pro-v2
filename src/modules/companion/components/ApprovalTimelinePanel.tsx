// R-COMPANION-APPROVAL-HISTORY-TIMELINE-V1: approval history timeline panel.
import { useTranslation } from '@/i18n';
import type { CompanionApprovalRuntimeSnapshot } from '@/services/companion/companionTypes';
import { auditRelTime, auditFmtAmt } from './companionPanelUtils';

type TimelineStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired';

function resolveTimelineStatus(
  status: 'pending' | 'approved' | 'denied',
  reason: string | undefined,
): TimelineStatus {
  if (status === 'approved') return 'approved';
  if (status === 'pending')  return 'pending';
  if (reason === 'cancelled') return 'cancelled';
  if (reason === 'timeout')   return 'expired';
  return 'denied';
}

const TIMELINE_CHIP: Record<TimelineStatus, { bg: string; border: string; color: string }> = {
  pending:   { bg: 'rgba(251,191,36,0.15)',  border: 'rgba(251,191,36,0.4)',   color: '#fbbf24' },
  approved:  { bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.35)', color: '#4ade80' },
  denied:    { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', color: '#f87171' },
  cancelled: { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.3)', color: '#94a3b8' },
  expired:   { bg: 'rgba(251,146,60,0.12)',  border: 'rgba(251,146,60,0.35)', color: '#fb923c' },
};

interface Props {
  approvalRuntime: CompanionApprovalRuntimeSnapshot;
  employees: Array<{ id: string; name?: string }>;
}

export default function ApprovalTimelinePanel({ approvalRuntime, employees }: Props) {
  const { t } = useTranslation();

  return (
    <div style={{
      marginTop: '0.75rem',
      background: 'rgba(255,255,255,0.015)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '0.75rem',
      padding: '0.75rem 1rem',
    }}>
      <div style={{
        fontSize: '0.72rem',
        fontWeight: 700,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        marginBottom: '0.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}>
        {t('companion.approvals.title')}
        {approvalRuntime.items.length > 0 && (
          <span style={{
            background: 'rgba(148,163,184,0.15)',
            color: '#94a3b8',
            fontSize: '0.65rem',
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 4,
          }}>
            {Math.min(approvalRuntime.items.length, 20)}
          </span>
        )}
      </div>

      {approvalRuntime.items.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>
          {t('companion.approvals.empty')}
        </p>
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {approvalRuntime.items.slice(0, 20).map((item) => {
            const displayStatus = resolveTimelineStatus(item.status, item.reason);
            const chip = TIMELINE_CHIP[displayStatus];
            const actionKey = `companion.approvals.action.${item.actionType}` as const;
            const actionLabel = (
              item.actionType && [
                'CANCEL_LAYAWAY','CANCEL_REPAIR','CANCEL_UNLOCK','CANCEL_SPECIAL_ORDER',
                'PRICE_OVERRIDE','DISCOUNT_OVERRIDE','REFUND',
              ].includes(item.actionType)
                ? t(actionKey)
                : item.actionType || t('companion.approvals.action.fallback')
            ) + auditFmtAmt(item.affectedAmount);
            const reqEmp = employees.find((e) => e.id === item.requestedByEmployeeId);
            const reqName = reqEmp?.name
              || (item.requestedByEmployeeId ? item.requestedByEmployeeId.slice(-6) : null);
            const approverRaw = item.approvedByEmployeeId;
            const approverName = approverRaw === 'approver:admin'
              ? t('companion.approvals.adminPin')
              : approverRaw
                ? (employees.find((e) => e.id === approverRaw)?.name || approverRaw.slice(-6))
                : null;
            return (
              <div key={item.approvalId} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                padding: '0.4rem 0.5rem',
                borderRadius: 7,
                background: 'rgba(255,255,255,0.03)',
                fontSize: '0.75rem',
                borderLeft: `2px solid ${chip.color}`,
              }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontSize: '0.6rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  background: chip.bg,
                  border: `1px solid ${chip.border}`,
                  color: chip.color,
                  marginTop: 1,
                  flexShrink: 0,
                }}>
                  {t(`companion.approvals.status.${displayStatus}` as const)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, lineHeight: 1.3 }}>
                    {actionLabel}
                  </div>
                  {(reqName || approverName) && (
                    <div style={{ color: '#64748b', fontSize: '0.68rem', lineHeight: 1.4, marginTop: 1 }}>
                      {reqName && <span>{reqName}</span>}
                      {approverName && (
                        <span>
                          {reqName ? ' → ' : ''}{approverName}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <span style={{ color: '#475569', fontSize: '0.63rem', whiteSpace: 'nowrap', lineHeight: 1.8, flexShrink: 0 }}>
                  {auditRelTime(item.updatedAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
