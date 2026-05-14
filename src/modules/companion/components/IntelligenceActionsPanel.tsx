// R-COMPANION-INTELLIGENCE-ACTIONS-LIVE-V1: intelligence alert action panel.
import { useTranslation } from '@/i18n';
import {
  acknowledgeIntelligenceAlert,
} from '@/services/companion/companionIntelligenceRuntime';
import type {
  CompanionIntelligenceRuntimeItem,
  CompanionIntelligenceRuntimeSnapshot,
} from '@/services/companion/companionIntelligenceRuntime';
import { emitMessageSent } from '@/services/companion/emitters/messagingEmitter';
import type { CompanionOpCategory } from '@/services/companion/companionTypes';
import { auditRelTime } from './companionPanelUtils';

type IntelPriority = 'info' | 'warning' | 'critical' | 'opportunity';

const INTEL_CHIP: Record<IntelPriority, { bg: string; border: string; color: string }> = {
  info:        { bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.35)',  color: '#60a5fa' },
  warning:     { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.35)',  color: '#fbbf24' },
  critical:    { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', color: '#f87171' },
  opportunity: { bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)', color: '#a78bfa' },
};

function insightToOpCategory(insightType?: string): CompanionOpCategory {
  if (!insightType) return 'intelligence';
  const s = insightType.toLowerCase();
  if (s.includes('inventory')) return 'inventory';
  if (s.includes('repair'))    return 'repair';
  if (s.includes('customer') || s.includes('churn')) return 'customer';
  if (s.includes('operations') || s.includes('approval')) return 'operations';
  return 'intelligence';
}

function buildIntelMessageText(item: CompanionIntelligenceRuntimeItem): string {
  const title = item.title || item.kind || 'Intelligence alert';
  const body  = item.body ? ` — ${item.body.slice(0, 120)}` : '';
  return `${title}${body}`;
}

interface Props {
  intelligenceRuntime: CompanionIntelligenceRuntimeSnapshot;
  currentEmployeeId?: string;
  currentEmployeeName?: string;
}

export default function IntelligenceActionsPanel({ intelligenceRuntime, currentEmployeeId, currentEmployeeName }: Props) {
  const { t } = useTranslation();

  return (
    <div style={{
      marginTop: '0.75rem',
      background: 'linear-gradient(160deg, #0d1a2e 0%, #080f1c 100%)',
      border: '1px solid rgba(96,165,250,0.15)',
      borderRadius: '0.9rem',
      padding: '0.9rem 1.1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.6rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          🧠 {t('companion.intelligence.title')}
        </span>
        {intelligenceRuntime.unacknowledgedCount > 0 && (
          <span style={{
            background: 'rgba(96,165,250,0.18)',
            color: '#60a5fa',
            fontSize: '0.65rem',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 10,
            border: '1px solid rgba(96,165,250,0.3)',
          }}>
            {intelligenceRuntime.unacknowledgedCount}
          </span>
        )}
      </div>

      {intelligenceRuntime.items.filter((i) => !i.isAcknowledged).length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>
          {t('companion.intelligence.empty')}
        </p>
      ) : (
        <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {intelligenceRuntime.items.filter((i) => !i.isAcknowledged).slice(0, 10).map((item) => {
            const pri = (item.priority ?? item.severity ?? 'info') as IntelPriority;
            const chip = INTEL_CHIP[pri] ?? INTEL_CHIP.info;
            const opCat = insightToOpCategory(item.insightType);
            return (
              <div key={item.alertId} style={{
                padding: '0.5rem 0.6rem',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(96,165,250,0.1)',
                borderLeft: `3px solid ${chip.color}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                  <span style={{
                    display: 'inline-flex',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontSize: '0.58rem',
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    marginTop: 2,
                    background: chip.bg,
                    border: `1px solid ${chip.border}`,
                    color: chip.color,
                  }}>
                    {t(`companion.intelligence.priority.${pri}` as const)}
                  </span>
                  <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', lineHeight: 1.3 }}>
                    {item.title || item.kind || t('companion.approvals.action.fallback')}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: '#475569', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2 }}>
                    {auditRelTime(item.createdAt)}
                  </span>
                </div>

                {item.body && (
                  <p style={{ margin: 0, fontSize: '0.73rem', color: '#94a3b8', lineHeight: 1.4 }}>
                    {item.body}
                  </p>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: 2 }}>
                  {item.insightType && (
                    <span style={{
                      fontSize: '0.58rem',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(96,165,250,0.08)',
                      color: '#60a5fa',
                      border: '1px solid rgba(96,165,250,0.18)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}>
                      {item.insightType}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => {
                      const msgId = `intel-${item.alertId}-${Date.now().toString(36)}`;
                      emitMessageSent({
                        messageId: msgId,
                        senderType: 'desktop',
                        senderName: currentEmployeeName || 'Store',
                        fromEmployeeId: currentEmployeeId,
                        category: opCat,
                        conversationId: 'store-general',
                        channel: 'internal',
                        text: buildIntelMessageText(item),
                        preview: (item.title || '').slice(0, 80),
                      });
                    }}
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 5,
                      border: '1px solid rgba(96,165,250,0.3)',
                      background: 'rgba(96,165,250,0.08)',
                      color: '#60a5fa',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('companion.intelligence.createMsg')}
                  </button>
                  <button
                    type="button"
                    onClick={() => acknowledgeIntelligenceAlert(item.alertId)}
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 5,
                      border: '1px solid rgba(148,163,184,0.25)',
                      background: 'rgba(148,163,184,0.06)',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('companion.intelligence.ack')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
