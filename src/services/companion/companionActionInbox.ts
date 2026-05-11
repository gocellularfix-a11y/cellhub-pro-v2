// ============================================================
// CellHub Pro — Companion Action Inbox
// (R-COMPANION-ACTION-INBOX-V1)
//
// Reverse path for the future Companion mobile app: actions FROM
// Companion INTO the desktop. Today this is a shell — no producer
// wires real mutations and consumers don't apply approvals /
// messages / acknowledgements yet. The service exists so a future
// bridge can route incoming Companion actions through one typed
// entry point without recursively touching approval / messaging /
// intelligence call-sites.
//
// Cero networking. Cero persistence. Cero real approval mutation,
// cero real message sending, cero real alert acknowledgement.
// ============================================================

import { generateId } from '@/utils/dates';
import type {
  CompanionAcknowledgeAlertPayload,
  CompanionActionInboxListener,
  CompanionActionInboxSnapshot,
  CompanionApproveRequestPayload,
  CompanionDenyRequestPayload,
  CompanionInboxAction,
  CompanionSendMessagePayload,
} from './companionTypes';

// ── Module-private state ──────────────────────────────────

const INBOX_CAP = 200;
const inbox: CompanionInboxAction[] = [];
const listeners = new Set<CompanionActionInboxListener>();

// ── Submit-input shape (caller doesn't supply envelope fields) ──

export type SubmitActionInput =
  | { type: 'approve_request';                payload: CompanionApproveRequestPayload }
  | { type: 'deny_request';                   payload: CompanionDenyRequestPayload }
  | { type: 'send_message';                   payload: CompanionSendMessagePayload }
  | { type: 'acknowledge_intelligence_alert'; payload: CompanionAcknowledgeAlertPayload };

// ── Helpers ──────────────────────────────────────────────

function buildSnapshot(): CompanionActionInboxSnapshot {
  // Most-recent first so the dev panel renders newest at the top.
  // Shallow-copy each entry so consumers can't mutate inbox state.
  const sorted = [...inbox].sort((a, b) => b.receivedAt - a.receivedAt);
  let pending = 0;
  for (const a of inbox) if (a.status === 'pending') pending += 1;
  return {
    actions: sorted.map((a) => ({ ...a })),
    pendingCount: pending,
  };
}

function notify(): void {
  const snap = buildSnapshot();
  listeners.forEach((listener) => {
    try { listener(snap); } catch (err) {
      console.warn('[companion-inbox] listener threw', err);
    }
  });
}

// ── Public API ────────────────────────────────────────────

/**
 * Submit a new action to the inbox. Caller passes type + payload;
 * the service generates actionId, sets receivedAt and initial
 * status='pending'. Returns the persisted envelope.
 *
 * Bounded queue: oldest entries are dropped (with console.warn) when
 * the cap is reached, so a runaway producer can't exhaust memory.
 */
export function submitAction(input: SubmitActionInput): CompanionInboxAction {
  const action = {
    ...input,
    actionId: generateId(),
    receivedAt: Date.now(),
    status: 'pending' as const,
  } as CompanionInboxAction;
  inbox.push(action);
  if (inbox.length > INBOX_CAP) {
    inbox.splice(0, inbox.length - INBOX_CAP);
    console.warn('[companion-inbox] queue cap reached, dropping oldest actions');
  }
  notify();
  return { ...action } as CompanionInboxAction;
}

/** Snapshot of pending actions only. Most-recent first. */
export function getPendingActions(): CompanionInboxAction[] {
  return inbox
    .filter((a) => a.status === 'pending')
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .map((a) => ({ ...a } as CompanionInboxAction));
}

/** Snapshot of every inbox entry (pending + handled). */
export function getAllActions(): CompanionInboxAction[] {
  return [...inbox]
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .map((a) => ({ ...a } as CompanionInboxAction));
}

/**
 * Mark an action handled. Sets status='handled' and stamps handledAt.
 * No-op when the id is unknown or the action is already handled, so
 * idempotent callers don't have to guard.
 */
export function markActionHandled(actionId: string): void {
  const idx = inbox.findIndex((a) => a.actionId === actionId);
  if (idx < 0) return;
  const existing = inbox[idx];
  if (existing.status === 'handled') return;
  inbox[idx] = {
    ...existing,
    status: 'handled',
    handledAt: Date.now(),
  } as CompanionInboxAction;
  notify();
}

/** Drop every entry. Listener registrations are untouched. */
export function clearInbox(): void {
  if (inbox.length === 0) return;
  inbox.length = 0;
  notify();
}

/**
 * R-COMPANION-RUNTIME-TEST-PANEL-V1: drop only handled entries.
 * Pending actions stay in the queue. Safer than clearInbox for the
 * dev test panel where the owner may want to clean up handled noise
 * without losing in-flight work.
 */
export function clearHandledActions(): void {
  const before = inbox.length;
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i].status === 'handled') inbox.splice(i, 1);
  }
  if (inbox.length !== before) notify();
}

/** Full snapshot — drives any dev panel that subscribes. */
export function getInboxSnapshot(): CompanionActionInboxSnapshot {
  return buildSnapshot();
}

/** Subscribe to inbox changes. Returns an unsubscribe handle. */
export function subscribeActionInbox(listener: CompanionActionInboxListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
