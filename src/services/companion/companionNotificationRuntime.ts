// ============================================================
// CellHub Pro — Companion Notification Runtime
// (R-COMPANION-NOTIFICATION-INFRA-V1)
//
// In-memory operational notification layer. Fans out from the
// Companion Event Bus into a typed notification feed that the
// Companion Center Notification Panel consumes.
//
// Fanout sources:
//   APPROVAL_CREATED          → type: 'approval',      priority: 'warning'
//   APPROVAL_DENIED           → type: 'approval',      priority: 'warning'
//   MESSAGE_RECEIVED          → type: 'message',       priority: 'info'
//   INTELLIGENCE_ALERT_CREATED→ type: 'intelligence',  priority: from payload
//   STORE_STATUS_UPDATED      → type: 'store_status',  warning/critical only
//
// Dedup: identical (type + title + body) within 15 s are dropped.
// Max retention: 50 items — oldest evicted on overflow.
//
// Cero networking. Cero persistence. Cero mutation of existing flows.
// ============================================================

import { subscribe } from './companionEventBus';
import type {
  CompanionNotification,
  CompanionNotificationListener,
  CompanionNotificationPriority,
  CompanionNotificationSnapshot,
  CompanionNotificationType,
} from './companionTypes';

// ── Constants ────────────────────────────────────────────

const MAX_ITEMS    = 50;
const DEDUP_WINDOW = 15_000; // 15 s

// ── Module-private state ──────────────────────────────────

const notifications = new Map<string, CompanionNotification>();
const listeners     = new Set<CompanionNotificationListener>();
const dedupKeys     = new Map<string, number>(); // key → last-fired ms

// ── Helpers ──────────────────────────────────────────────

function buildSnapshot(): CompanionNotificationSnapshot {
  const items = Array.from(notifications.values())
    .sort((a, b) => b.createdAt - a.createdAt);
  let unreadCount = 0;
  for (const n of items) if (!n.isRead) unreadCount += 1;
  return { notifications: items.map((n) => ({ ...n })), unreadCount };
}

function notify(): void {
  const snap = buildSnapshot();
  listeners.forEach((l) => { try { l(snap); } catch { /* isolated */ } });
}

function dedupKey(type: CompanionNotificationType, title: string, body?: string): string {
  return `${type}:${title}:${body ?? ''}`;
}

function isDupe(key: string): boolean {
  const last = dedupKeys.get(key);
  return !!last && (Date.now() - last) < DEDUP_WINDOW;
}

function addNotification(n: Omit<CompanionNotification, 'notificationId' | 'createdAt' | 'isRead'>): void {
  const key = dedupKey(n.type, n.title, n.body);
  if (isDupe(key)) return;
  dedupKeys.set(key, Date.now());

  // Evict oldest if at cap
  if (notifications.size >= MAX_ITEMS) {
    let oldest: CompanionNotification | null = null;
    notifications.forEach((item) => {
      if (!oldest || item.createdAt < oldest.createdAt) oldest = item;
    });
    if (oldest) notifications.delete((oldest as CompanionNotification).notificationId);
  }

  const notificationId = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  notifications.set(notificationId, {
    ...n,
    notificationId,
    createdAt: Date.now(),
    isRead: false,
  });
  notify();
}

// Derive a short, readable label from an approval action type.
function actionLabel(actionType?: string): string {
  switch (actionType) {
    case 'CANCEL_LAYAWAY':       return 'Layaway cancel';
    case 'CANCEL_REPAIR':        return 'Repair cancel';
    case 'CANCEL_UNLOCK':        return 'Unlock cancel';
    case 'CANCEL_SPECIAL_ORDER': return 'Special order cancel';
    case 'PRICE_OVERRIDE':       return 'Price override';
    case 'DISCOUNT_OVERRIDE':    return 'Discount';
    case 'REFUND':               return 'Refund';
    default:                     return actionType || 'Approval';
  }
}

// ── Event fanout subscriptions ────────────────────────────

subscribe('APPROVAL_CREATED', (event) => {
  if (event.type !== 'APPROVAL_CREATED') return;
  const p = event.payload;
  addNotification({
    type: 'approval',
    priority: 'warning',
    title: `Approval request: ${actionLabel(p.actionType)}`,
    relatedEntityId: p.approvalId,
    relatedEntityType: 'approval',
  });
});

subscribe('APPROVAL_DENIED', (event) => {
  if (event.type !== 'APPROVAL_DENIED') return;
  const p = event.payload;
  const reason = p.reason ?? '';
  const isCancelled = reason === 'cancelled' || reason === 'timeout';
  const priority: CompanionNotificationPriority = isCancelled ? 'info' : 'warning';
  const reasonLabel = reason === 'cancelled' ? 'Cancelled'
    : reason === 'timeout' ? 'Timed out'
    : reason === 'self_approval_blocked' ? 'Self-approval blocked'
    : 'Denied';
  addNotification({
    type: 'approval',
    priority,
    title: `Approval ${reasonLabel.toLowerCase()}: ${actionLabel(p.actionType)}`,
    relatedEntityId: p.approvalId,
    relatedEntityType: 'approval',
  });
});

subscribe('MESSAGE_RECEIVED', (event) => {
  if (event.type !== 'MESSAGE_RECEIVED') return;
  const p = event.payload;
  addNotification({
    type: 'message',
    priority: 'info',
    title: 'New message',
    body: p.text ?? p.body ?? p.preview,
    relatedEntityId: p.messageId,
    relatedEntityType: 'message',
  });
});

subscribe('INTELLIGENCE_ALERT_CREATED', (event) => {
  if (event.type !== 'INTELLIGENCE_ALERT_CREATED') return;
  const p = event.payload;
  const raw = p.priority ?? p.severity ?? 'info';
  const priority: CompanionNotificationPriority =
    raw === 'critical' || raw === 'warning' || raw === 'opportunity' ? raw : 'info';
  addNotification({
    type: 'intelligence',
    priority,
    title: p.title ?? p.kind ?? 'Intelligence alert',
    body: p.body,
    relatedEntityId: p.alertId,
    relatedEntityType: 'intelligence_alert',
  });
});

subscribe('STORE_STATUS_UPDATED', (event) => {
  if (event.type !== 'STORE_STATUS_UPDATED') return;
  const p = event.payload;
  // Only generate notifications for notable status changes — closed or
  // explicit emergency reasons. Open / unknown with no reason → skip.
  if (p.status !== 'closed' && p.status !== 'unknown') return;
  const priority: CompanionNotificationPriority = p.status === 'closed' ? 'warning' : 'critical';
  const title = p.status === 'closed' ? 'Store closed' : 'Store status unknown';
  addNotification({
    type: 'store_status',
    priority,
    title,
    body: p.reason,
  });
});

// ── Public API ────────────────────────────────────────────

export function getNotificationSnapshot(): CompanionNotificationSnapshot {
  return buildSnapshot();
}

export function subscribeNotifications(listener: CompanionNotificationListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Mark a single notification read. Idempotent. */
export function markNotificationRead(notificationId: string): void {
  const n = notifications.get(notificationId);
  if (!n || n.isRead) return;
  notifications.set(notificationId, { ...n, isRead: true });
  notify();
}

/** Mark every notification read. */
export function markAllNotificationsRead(): void {
  let changed = false;
  notifications.forEach((n, id) => {
    if (!n.isRead) { notifications.set(id, { ...n, isRead: true }); changed = true; }
  });
  if (changed) notify();
}

/** Remove all already-read notifications. */
export function clearReadNotifications(): void {
  let changed = false;
  notifications.forEach((n, id) => {
    if (n.isRead) { notifications.delete(id); changed = true; }
  });
  if (changed) notify();
}
