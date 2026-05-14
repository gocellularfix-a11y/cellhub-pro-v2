// R-COMPANION-MESSAGING-LIVE-V1: operational dispatch panel.
import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { sendCompanionMessage } from '@/services/companion/companionBridgeAdapter';
import { markMessageRead } from '@/services/companion/companionMessagingRuntime';
import type { CompanionMessagingRuntimeSnapshot, CompanionOpCategory } from '@/services/companion/companionTypes';
import type { PosBridgeStatus } from '@/services/companion/sdk/posBridgeClient';
import { auditRelTime } from './companionPanelUtils';

interface Props {
  messagingRuntime: CompanionMessagingRuntimeSnapshot;
  employees: Array<{ id: string; name?: string }>;
  currentEmployeeId?: string;
  currentEmployeeName?: string;
  bridgeStatus: PosBridgeStatus;
}

export default function OperationsMessagingPanel({
  messagingRuntime,
  employees,
  currentEmployeeId,
  currentEmployeeName,
  bridgeStatus,
}: Props) {
  const { t } = useTranslation();
  const [msgDraft, setMsgDraft] = useState('');
  const [msgCategory, setMsgCategory] = useState<CompanionOpCategory>('operations');

  return (
    <div style={{
      marginTop: '0.75rem',
      background: 'linear-gradient(160deg, #120820 0%, #0b0516 100%)',
      border: '1px solid rgba(192,132,252,0.18)',
      borderRadius: '0.9rem',
      padding: '1rem 1.1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          📡 {t('companion.messaging.panelTitle')}
        </span>
        {messagingRuntime.totalUnread > 0 && (
          <span style={{
            background: 'rgba(192,132,252,0.25)',
            color: '#c084fc',
            fontSize: '0.65rem',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 10,
            border: '1px solid rgba(192,132,252,0.4)',
            animation: 'cellhubCompanionApprovalBadgePulse 2s ease-in-out infinite',
          }}>
            {t('companion.messaging.unreadBadge', messagingRuntime.totalUnread)}
          </span>
        )}
      </div>

      <div style={{
        maxHeight: 260,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}>
        {messagingRuntime.recentMessages.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>
            {t('companion.messaging.empty')}
          </p>
        ) : (
          [...messagingRuntime.recentMessages].reverse().map((msg) => {
            const isOut = msg.direction === 'outbound';
            const isUnread = !msg.isRead && !isOut;
            const senderLabel = msg.senderName
              || (isOut
                ? (employees.find((e) => e.id === msg.fromEmployeeId)?.name || currentEmployeeName || t('companion.messaging.you'))
                : (employees.find((e) => e.id === msg.fromEmployeeId)?.name || t('companion.messaging.manager')));
            const msgText = msg.text || msg.body || msg.preview || '';
            const catKey = msg.category ? `companion.messaging.cat.${msg.category}` as const : null;
            return (
              <div key={msg.messageId} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isOut ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '82%',
                  background: isOut
                    ? 'rgba(192,132,252,0.18)'
                    : isUnread
                      ? 'rgba(255,255,255,0.09)'
                      : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${isOut ? 'rgba(192,132,252,0.3)' : isUnread ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: isOut ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  padding: '0.45rem 0.65rem',
                  fontSize: '0.78rem',
                  color: '#e2e8f0',
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}>
                  {msgText}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: 2, paddingInline: 4 }}>
                  <span style={{ fontSize: '0.62rem', color: '#475569' }}>
                    {senderLabel} · {auditRelTime(msg.updatedAt)}
                  </span>
                  {catKey && (
                    <span style={{
                      fontSize: '0.58rem',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(192,132,252,0.12)',
                      color: '#a78bfa',
                      border: '1px solid rgba(192,132,252,0.2)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}>
                      {t(catKey)}
                    </span>
                  )}
                  {isUnread && (
                    <button
                      type="button"
                      onClick={() => markMessageRead(msg.messageId)}
                      style={{
                        fontSize: '0.58rem',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'rgba(34,197,94,0.10)',
                        color: '#86efac',
                        border: '1px solid rgba(34,197,94,0.25)',
                        cursor: 'pointer',
                        lineHeight: 1.5,
                      }}
                    >
                      {t('companion.messaging.ack')}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
        {(['operations','repair','customer','inventory','approval','intelligence'] as CompanionOpCategory[]).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setMsgCategory(cat)}
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 5,
              border: msgCategory === cat
                ? '1px solid rgba(192,132,252,0.55)'
                : '1px solid rgba(148,163,184,0.2)',
              background: msgCategory === cat
                ? 'rgba(192,132,252,0.18)'
                : 'rgba(255,255,255,0.03)',
              color: msgCategory === cat ? '#c084fc' : '#64748b',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              transition: 'background 0.12s, border-color 0.12s',
            }}
          >
            {t(`companion.messaging.cat.${cat}` as const)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={msgDraft}
          onChange={(e) => setMsgDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && msgDraft.trim() && bridgeStatus === 'connected') {
              sendCompanionMessage(msgDraft.trim(), currentEmployeeId || '', currentEmployeeName || 'Store', msgCategory);
              setMsgDraft('');
            }
          }}
          placeholder={bridgeStatus === 'connected'
            ? t('companion.messaging.placeholder')
            : t('companion.messaging.placeholderOff')}
          disabled={bridgeStatus !== 'connected'}
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(192,132,252,0.25)',
            borderRadius: 8,
            color: '#e2e8f0',
            fontSize: '0.82rem',
            padding: '0.45rem 0.65rem',
            outline: 'none',
            opacity: bridgeStatus !== 'connected' ? 0.5 : 1,
          }}
        />
        <button
          type="button"
          disabled={!msgDraft.trim() || bridgeStatus !== 'connected'}
          onClick={() => {
            if (msgDraft.trim()) {
              sendCompanionMessage(msgDraft.trim(), currentEmployeeId || '', currentEmployeeName || 'Store', msgCategory);
              setMsgDraft('');
            }
          }}
          style={{
            padding: '0.45rem 0.9rem',
            background: msgDraft.trim() && bridgeStatus === 'connected'
              ? 'rgba(192,132,252,0.22)'
              : 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(192,132,252,0.35)',
            borderRadius: 8,
            color: '#c084fc',
            fontSize: '0.8rem',
            fontWeight: 700,
            cursor: msgDraft.trim() && bridgeStatus === 'connected' ? 'pointer' : 'default',
            opacity: msgDraft.trim() && bridgeStatus === 'connected' ? 1 : 0.4,
            transition: 'background 0.15s, opacity 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {t('companion.messaging.send')}
        </button>
      </div>
    </div>
  );
}
