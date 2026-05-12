// R-BRIDGE-V1 — Centralized event registry
// Both Desktop POS and Mobile Companion must import from this module.

export const EVENTS = {
  // ─── Approval lifecycle ───────────────────────────────────────────────────
  APPROVAL_CREATED:              'approval:created',
  APPROVAL_UPDATED:              'approval:updated',
  APPROVAL_RESPONDED:            'approval:responded',
  APPROVAL_APPROVED:             'approval:approved',
  APPROVAL_DENIED:               'approval:denied',
  APPROVAL_EXPLANATION_REQUESTED:'approval:explanation_requested',
  APPROVAL_EXPIRED:              'approval:expired',

  // ─── Messaging ────────────────────────────────────────────────────────────
  MESSAGE_NEW:                   'message:new',
  MESSAGE_READ:                  'message:read',
  THREAD_UPDATED:                'thread:updated',
  TYPING_START:                  'typing:start',
  TYPING_STOP:                   'typing:stop',

  // ─── Intelligence / Operator feed ─────────────────────────────────────────
  INTELLIGENCE_ALERT:            'intelligence:alert',
  INTELLIGENCE_DISMISSED:        'intelligence:dismissed',
  INTELLIGENCE_ACTIONED:         'intelligence:actioned',

  // ─── Employee status ──────────────────────────────────────────────────────
  EMPLOYEE_ONLINE:               'employee:online',
  EMPLOYEE_OFFLINE:              'employee:offline',
  EMPLOYEE_ACTIVITY:             'employee:activity',

  // ─── Dashboard sync ───────────────────────────────────────────────────────
  DASHBOARD_STATS_UPDATED:       'dashboard:stats_updated',

  // ─── Auth / Session (bridge level) ────────────────────────────────────────
  AUTH_REGISTER:                 'auth:register',
  AUTH_REGISTERED:               'auth:registered',
  AUTH_REJECTED:                 'auth:rejected',

  // ─── System ───────────────────────────────────────────────────────────────
  SYSTEM_CONNECTED:              'system:connected',
  SYSTEM_DISCONNECTED:           'system:disconnected',
  SYSTEM_ERROR:                  'system:error',
  SYSTEM_HEARTBEAT:              'system:heartbeat',
  SYSTEM_HEARTBEAT_ACK:          'system:heartbeat_ack',
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];
