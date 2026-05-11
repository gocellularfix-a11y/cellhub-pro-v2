// ============================================================
// CellHub Pro — Companion Intelligence Ack Receiver Shell
// (R-COMPANION-INTELLIGENCE-ACK-RECEIVER-V1)
//
// Reads pending acknowledge_intelligence_alert actions FROM the
// Companion Action Inbox and normalises them into a flat
// receiver-result shape that any future Intelligence integration
// can consume. Today this is shell only — cero real alert
// mutation, cero scoring changes, cero AlertEngine touches.
//
// Cero networking. Cero persistence. Cero POS / financial /
// customer / employee touches.
// ============================================================

import {
  getPendingActions,
  markActionHandled,
} from '../companionActionInbox';
import type {
  CompanionAcknowledgeAlertPayload,
  CompanionInboxAction,
} from '../companionTypes';

/**
 * Normalised view of a pending acknowledge_intelligence_alert
 * action. Flattens the inbox envelope so downstream consumers
 * don't have to switch on action.type.
 */
export interface IntelligenceAckReceiverResult {
  /** Inbox actionId — pass back to markIntelligenceAckHandled() once
   *  the consumer has applied (or chosen to ignore) the action. */
  actionId: string;
  /** Companion-supplied alert id — the canonical identity. Maps to
   *  Alert.id from services/intelligence/alerts/AlertTypes. */
  alertId: string;
  /** Employee id who acknowledged on the Companion side, if
   *  supplied. */
  acknowledgedByEmployeeId?: string;
  /** ms epoch when the action arrived in the inbox. */
  receivedAt: number;
}

// ── Public API ────────────────────────────────────────────

/**
 * Read every pending acknowledge_intelligence_alert action from the
 * inbox, validate, and return normalised results. Actions that fail
 * validation (missing alertId) are dropped silently with
 * console.warn — the caller never sees a malformed result.
 *
 * Cero side effects: this does NOT mark anything handled. Use
 * processIntelligenceAck or markIntelligenceAckHandled when the
 * consumer has actually applied (or chosen to ignore) the action.
 */
export function readPendingIntelligenceAcks(): IntelligenceAckReceiverResult[] {
  const pending = getPendingActions();
  const out: IntelligenceAckReceiverResult[] = [];
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
 *   - the action is not an acknowledge_intelligence_alert action
 *   - the action fails validation (missing alertId)
 *
 * IMPORTANT: "process" here means "translate + mark handled". It
 * does NOT call AlertEngine.acknowledge(), does NOT mutate any
 * Alert.status, does NOT touch intelligence scoring or AlertEngine
 * state. That work stays in services/intelligence and is
 * intentionally not invoked from this shell — the real consumer
 * will opt in when its policy is approved.
 */
export function processIntelligenceAck(inboxActionId: string): IntelligenceAckReceiverResult | null {
  const pending = getPendingActions();
  const action = pending.find((a) => a.actionId === inboxActionId);
  if (!action) return null;
  const result = normalize(action);
  if (!result) return null;
  markActionHandled(inboxActionId);
  return result;
}

/**
 * Mark an intelligence ack action handled without re-normalising.
 * Idempotent passthrough to companionActionInbox.markActionHandled.
 * Useful when the consumer already inspected the result and
 * explicitly decided to ignore the action.
 */
export function markIntelligenceAckHandled(inboxActionId: string): void {
  markActionHandled(inboxActionId);
}

// ── Internal ─────────────────────────────────────────────

function normalize(action: CompanionInboxAction): IntelligenceAckReceiverResult | null {
  if (action.type !== 'acknowledge_intelligence_alert') return null;
  const payload = action.payload as CompanionAcknowledgeAlertPayload;
  if (!payload || typeof payload.alertId !== 'string' || payload.alertId.length === 0) {
    console.warn(
      '[companion-intelligence-ack-receiver] dropping action — missing alertId',
      action.actionId,
    );
    return null;
  }
  return {
    actionId: action.actionId,
    alertId: payload.alertId,
    acknowledgedByEmployeeId: payload.acknowledgedByEmployeeId,
    receivedAt: action.receivedAt,
  };
}
