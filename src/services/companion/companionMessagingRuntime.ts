// ============================================================
// CellHub Pro — Companion Messaging Runtime Store
// (R-COMPANION-MESSAGING-RUNTIME-V1)
//
// Passive read-model over Companion messaging events. Aggregates
// MESSAGE_SENT / MESSAGE_RECEIVED / MESSAGE_READ into per-message
// items plus a derived per-thread roll-up so the Companion Center
// can surface unread counts and latest thread activity without
// re-walking the bus log.
//
// Desktop remains the source of truth — this runtime owns cero
// real chat logic. Cero networking, cero persistence, cero
// websocket, cero polling, cero business logic. In-memory only.
// ============================================================

import { subscribe } from './companionEventBus';
import type {
  CompanionMessageDirection,
  CompanionMessagePayload,
  CompanionMessageRuntimeItem,
  CompanionMessageThread,
  CompanionMessagingRuntimeListener,
  CompanionMessagingRuntimeSnapshot,
} from './companionTypes';

// ── Module-private state ──────────────────────────────────

const messages = new Map<string, CompanionMessageRuntimeItem>();
const listeners = new Set<CompanionMessagingRuntimeListener>();

// ── Helpers ──────────────────────────────────────────────

/**
 * Derive a stable thread key for a payload. Emitters today don't
 * supply an explicit thread id, so the runtime synthesises one from
 * the participant pair + channel. The pair is sorted so an outbound
 * "A→B" and an inbound "B→A" land in the same thread.
 * Falls back to the channel name (or 'default') when participant
 * ids are missing.
 */
function deriveThreadKey(payload: CompanionMessagePayload): string {
  const channel = payload.channel ?? 'internal';
  const a = payload.fromEmployeeId ?? '';
  const b = payload.toEmployeeId ?? '';
  if (!a && !b) return `${channel}|default`;
  const pair = [a, b].filter((x) => !!x).sort().join('-');
  return `${channel}|${pair || 'default'}`;
}

/**
 * Direction resolution. The bus payload carries direction explicitly
 * (R-COMPANION-MESSAGING-EMITTERS-V1) but we also fall back to the
 * event type for older emitters that don't fill it in.
 */
function resolveDirection(
  eventType: 'MESSAGE_SENT' | 'MESSAGE_RECEIVED',
  payload: CompanionMessagePayload,
): CompanionMessageDirection {
  if (payload.direction === 'outbound' || payload.direction === 'inbound') {
    return payload.direction;
  }
  return eventType === 'MESSAGE_SENT' ? 'outbound' : 'inbound';
}

function buildSnapshot(): CompanionMessagingRuntimeSnapshot {
  if (messages.size === 0) {
    return { threads: [], totalUnread: 0, latestMessage: null, lastActivityAt: null, recentMessages: [] };
  }

  // Roll up per-thread state in a single pass. Map<threadKey, thread>.
  const threadAcc = new Map<string, CompanionMessageThread>();
  let latest: CompanionMessageRuntimeItem | null = null;

  messages.forEach((m) => {
    const existing = threadAcc.get(m.threadKey);
    if (!existing) {
      threadAcc.set(m.threadKey, {
        threadKey: m.threadKey,
        lastMessageId: m.messageId,
        lastDirection: m.direction,
        lastPreview: m.preview,
        lastChannel: m.channel,
        lastActivityAt: m.updatedAt,
        messageCount: 1,
        unreadCount: !m.isRead && m.direction === 'inbound' ? 1 : 0,
      });
    } else {
      existing.messageCount += 1;
      if (!m.isRead && m.direction === 'inbound') existing.unreadCount += 1;
      if (m.updatedAt > existing.lastActivityAt) {
        existing.lastActivityAt = m.updatedAt;
        existing.lastMessageId = m.messageId;
        existing.lastDirection = m.direction;
        existing.lastPreview = m.preview;
        existing.lastChannel = m.channel;
      }
    }
    if (!latest || m.updatedAt > latest.updatedAt) latest = m;
  });

  const threads = Array.from(threadAcc.values())
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((t) => ({ ...t }));

  let totalUnread = 0;
  for (const t of threads) totalUnread += t.unreadCount;

  const recentMessages = Array.from(messages.values())
    .map((m) => ({ ...m }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);

  return {
    threads,
    totalUnread,
    latestMessage: latest ? { ...(latest as CompanionMessageRuntimeItem) } : null,
    lastActivityAt: latest ? (latest as CompanionMessageRuntimeItem).updatedAt : null,
    recentMessages,
  };
}

function notify(): void {
  const snap = buildSnapshot();
  listeners.forEach((listener) => {
    try { listener(snap); } catch (err) {
      console.warn('[companion-messaging-runtime] listener threw', err);
    }
  });
}

// ── Event subscriptions (module-singleton) ───────────────
// Attached at file load. Each subscriber narrows the discriminated
// CompanionEvent union so payload typing is preserved.

function upsertMessage(
  eventType: 'MESSAGE_SENT' | 'MESSAGE_RECEIVED',
  payload: CompanionMessagePayload,
): void {
  if (!payload.messageId) return; // defensive — payload typed as string but bus is permissive
  const now = Date.now();
  const direction = resolveDirection(eventType, payload);
  const threadKey = deriveThreadKey(payload);
  const existing = messages.get(payload.messageId);
  messages.set(payload.messageId, {
    messageId: payload.messageId,
    threadKey,
    direction,
    channel: payload.channel,
    source: payload.source,
    fromEmployeeId: payload.fromEmployeeId,
    toEmployeeId: payload.toEmployeeId,
    senderRole: payload.senderRole,
    preview: payload.preview,
    body: payload.body,
    // Outbound is read by definition. Inbound starts unread unless an
    // earlier MESSAGE_READ already flipped it (late-arriving SENT).
    isRead: direction === 'outbound' ? true : (existing?.isRead ?? false),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  notify();
}

subscribe('MESSAGE_SENT', (event) => {
  if (event.type !== 'MESSAGE_SENT') return;
  upsertMessage('MESSAGE_SENT', event.payload);
});

subscribe('MESSAGE_RECEIVED', (event) => {
  if (event.type !== 'MESSAGE_RECEIVED') return;
  upsertMessage('MESSAGE_RECEIVED', event.payload);
});

subscribe('MESSAGE_READ', (event) => {
  if (event.type !== 'MESSAGE_READ') return;
  const p = event.payload;
  if (!p.messageId) return;
  const now = Date.now();
  const existing = messages.get(p.messageId);
  if (existing) {
    if (existing.isRead) return; // idempotent
    messages.set(p.messageId, { ...existing, isRead: true, updatedAt: now });
  } else {
    // Late-arriving READ before SENT/RECEIVED — synth an inbound,
    // already-read entry so the roll-up stays consistent if the
    // matching SENT/RECEIVED never arrives.
    const direction: CompanionMessageDirection = p.direction === 'outbound' ? 'outbound' : 'inbound';
    messages.set(p.messageId, {
      messageId: p.messageId,
      threadKey: deriveThreadKey(p),
      direction,
      channel: p.channel,
      source: p.source,
      fromEmployeeId: p.fromEmployeeId,
      toEmployeeId: p.toEmployeeId,
      senderRole: p.senderRole,
      preview: p.preview,
      isRead: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  notify();
});

// ── Public API ────────────────────────────────────────────

/** Read the current snapshot. Always a copy — safe for direct
 *  React useState seed. */
export function getMessagingRuntimeSnapshot(): CompanionMessagingRuntimeSnapshot {
  return buildSnapshot();
}

/** Subscribe to runtime changes. Returns an unsubscribe handle. */
export function subscribeMessagingRuntime(
  listener: CompanionMessagingRuntimeListener,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Drop the entire runtime view. Listeners untouched. Dev-only. */
export function clearMessagingRuntime(): void {
  if (messages.size === 0) return;
  messages.clear();
  notify();
}
