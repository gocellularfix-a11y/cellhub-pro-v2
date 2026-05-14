// R-COMPANION-NOTIFICATION-INFRA-V1: operational notification center panel.
import { useTranslation } from '@/i18n';
import {
  clearReadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/companion/companionNotificationRuntime';
import type {
  CompanionNotificationPriority,
  CompanionNotificationSnapshot,
} from '@/services/companion/companionTypes';
import { auditRelTime } from './companionPanelUtils';

const NOTIF_CHIP: Record<CompanionNotificationPriority, { bg: string; border: string; color: string }> = {
  info:        { bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.3)',   color: '#60a5fa' },
  warning:     { bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.3)',   color: '#fbbf24' },
  critical:    { bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.3)',  color: '#f87171' },
  opportunity: { bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.3)',  color: '#a78bfa' },
};

interface Props {
  notificationSnap: CompanionNotificationSnapshot;
}

export default function NotificationCenterPanel({ notificationSnap }: Props) {
  const { t } = useTranslation();

  return (
    <div style={{
      marginTop: '0.75rem',
      background: 'rgba(255,255,255,0.018)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '0.9rem',
      padding: '0.9rem 1.1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.6rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
          🔔 {t('companion.notifications.title')}
        </span>
        {notificationSnap.unreadCount > 0 && (
          <span style={{
            background: 'rgba(248,113,113,0.18)',
            color: '#f87171',
            fontSize: '0.65rem',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 10,
            border: '1px solid rgba(248,113,113,0.35)',
            animation: 'cellhubCompanionApprovalBadgePulse 2s ease-in-out infinite',
          }}>
            {t('companion.notifications.unreadBadge', notificationSnap.unreadCount)}
          </span>
        )}
        {notificationSnap.notifications.some((n) => n.isRead) && (
          <button
            type="button"
            onClick={() => clearReadNotifications()}
            style={{
              fontSize: '0.62rem',
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 5,
              border: '1px solid rgba(148,163,184,0.2)',
              background: 'transparent',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            {t('companion.notifications.clearRead')}
          </button>
        )}
        {notificationSnap.unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllNotificationsRead()}
            style={{
              fontSize: '0.62rem',
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 5,
              border: '1px solid rgba(148,163,184,0.2)',
              background: 'transparent',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            {t('companion.notifications.markAllRead')}
          </button>
        )}
      </div>

      {notificationSnap.notifications.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>
          {t('companion.notifications.empty')}
        </p>
      ) : (
        <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {notificationSnap.notifications.slice(0, 15).map((notif) => {
            const chip = NOTIF_CHIP[notif.priority] ?? NOTIF_CHIP.info;
            const isUnread = !notif.isRead;
            const typeKey = `companion.notifications.type.${notif.type}` as const;
            const priorityKey = `companion.notifications.priority.${notif.priority}` as const;
            return (
              <div key={notif.notificationId} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.45rem',
                padding: '0.4rem 0.5rem',
                borderRadius: 7,
                background: isUnread ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)',
                borderLeft: `2px solid ${isUnread ? chip.color : 'rgba(148,163,184,0.2)'}`,
                opacity: isUnread ? 1 : 0.65,
                transition: 'opacity 0.2s',
              }}>
                <span style={{
                  display: 'inline-flex',
                  padding: '1px 5px',
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
                  {t(priorityKey)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.77rem', fontWeight: isUnread ? 700 : 500, color: isUnread ? '#e2e8f0' : '#94a3b8', lineHeight: 1.3 }}>
                    {notif.title}
                  </div>
                  {notif.body && (
                    <div style={{ fontSize: '0.68rem', color: '#64748b', lineHeight: 1.4, marginTop: 1 }}>
                      {notif.body.length > 100 ? `${notif.body.slice(0, 97)}…` : notif.body}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: 2 }}>
                    <span style={{
                      fontSize: '0.58rem',
                      fontWeight: 600,
                      padding: '1px 4px',
                      borderRadius: 3,
                      background: 'rgba(148,163,184,0.1)',
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}>
                      {t(typeKey)}
                    </span>
                    <span style={{ fontSize: '0.62rem', color: '#475569' }}>
                      {auditRelTime(notif.createdAt)}
                    </span>
                  </div>
                </div>
                {isUnread && (
                  <button
                    type="button"
                    onClick={() => markNotificationRead(notif.notificationId)}
                    style={{
                      fontSize: '0.58rem',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: '1px solid rgba(148,163,184,0.2)',
                      background: 'transparent',
                      color: '#64748b',
                      cursor: 'pointer',
                      flexShrink: 0,
                      marginTop: 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('companion.notifications.ack')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
