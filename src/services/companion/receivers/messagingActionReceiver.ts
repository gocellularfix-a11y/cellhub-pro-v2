// ============================================================
// CellHub Pro — Companion Messaging Action Receiver Shell
// (R-COMPANION-MESSAGING-RECEIVER-V1)
//
// Reads pending send_message actions FROM the Companion Action
// Inbox and normalises them into a flat receiver-result shape that
// any future internal-messaging integration can consume. Today
// this is shell only — cero real message sending, cero WhatsApp /
// customer comms, cero PII storage.
//
// Cero networking. Cero persistence. Cero POS / financial /
// customer / employee touches.
// ============================================================

import {
  getPendingActions,
  markActionHandled,
} from '../companionActionInbox';
import type {
  CompanionInboxAction,
  CompanionSendMessagePayload,
} from '../companionTypes';

/**
 * Normalised view of a pending send_message action. The receiver
 * flattens the inbox envelope so downstream consumers don't have to
 * switch on action.type.
 */
export interface MessagingActionReceiverResult {
  /** Inbox actionId — pass back to markMessagingActionHandled() once
   *  the consumer has applied (or chosen to ignore) the action. */
  actionId: string;
  /** Companion-supplied message id — the canonical identity. */
  messageId: string;
  /** Sender id if Companion supplied one. */
  fromEmployeeId?: string;
  /** Transport class ('internal', 'whatsapp', etc.). Receiver
   *  doesn't validate the value — that's a future consumer's
   *  policy choice. */
  channel?: string;
  /** Short non-sensitive preview Companion supplied. Receiver
   *  passes it through verbatim — never logs or expands it. */
  preview?: string;
  /** ms epoch when the action arrived in the inbox. */
  receivedAt: number;
}

// ── Public API ────────────────────────────────────────────

/**
 * Read every pending send_message action from the inbox, validate,
 * and return normalised results. Actions that fail validation
 * (missing messageId) are dropped silently with console.warn —
 * the caller never sees a malformed result.
 *
 * Cero side effects: this does NOT mark anything handled. Use
 * processMessagingAction or markMessagingActionHandled when the
 * consumer has actually applied (or chosen to ignore) the action.
 */
export function readPendingMessagingActions(): MessagingActionReceiverResult[] {
  const pending = getPendingActions();
  const out: MessagingActionReceiverResult[] = [];
  for (const action of pending) {
    const result = normalize(action);
    if (result) out.push(result);
  }
  return out;
}

/**
 * Process a single inbox action by id. Looks it up among the
 * pending set, validates, marks handled, and returns the normalised
 * result. Returns null and is a no-op when:
 *   - the id is unknown
 *   - the action is not a send_message action
 *   - the action fails validation (missing messageId)
 *
 * IMPORTANT: "process" here means "translate + mark handled". It
 * does NOT send any real message, dispatch any WhatsApp link, or
 * mutate any customer/employee state. Real internal messaging
 * doesn't exist yet — when it does, the consumer code lives
 * elsewhere and opts into this receiver via subscribeActionInbox.
 */
export function processMessagingAction(inboxActionId: string): MessagingActionReceiverResult | null {
  const pending = getPendingActions();
  const action = pending.find((a) => a.actionId === inboxActionId);
  if (!action) return null;
  const result = normalize(action);
  if (!result) return null;
  markActionHandled(inboxActionId);
  return result;
}

/**
 * Mark a messaging action handled without re-normalising. Idempotent
 * passthrough to companionActionInbox.markActionHandled. Useful when
 * the consumer already inspected the result and explicitly decided
 * to ignore the action.
 */
export function markMessagingActionHandled(inboxActionId: string): void {
  markActionHandled(inboxActionId);
}

// ── Internal ─────────────────────────────────────────────

function normalize(action: CompanionInboxAction): MessagingActionReceiverResult | null {
  if (action.type !== 'send_message') return null;
  const payload = action.payload as CompanionSendMessagePayload;
  if (!payload || typeof payload.messageId !== 'string' || payload.messageId.length === 0) {
    console.warn(
      '[companion-messaging-receiver] dropping action — missing messageId',
      action.actionId,
    );
    return null;
  }
  return {
    actionId: action.actionId,
    messageId: payload.messageId,
    fromEmployeeId: payload.fromEmployeeId,
    channel: payload.channel,
    preview: payload.preview,
    receivedAt: action.receivedAt,
  };
}
