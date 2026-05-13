// ============================================================
// CellHub Pro — Companion Approval Action Receiver Shell
// (R-COMPANION-APPROVAL-RECEIVER-V1)
//
// Reads pending approval actions FROM the Companion Action Inbox
// (the reverse-direction queue) and normalises them into a flat
// receiver-result shape that any future approval-flow integration
// can consume. Today this is shell only — cero real approval
// mutation, cero PIN bypass, cero permission bypass. The receiver
// just validates structure and returns what Companion CLAIMS the
// action is, leaving the actual approval decision to whatever
// future component opts in.
//
// Cero networking. Cero persistence. Cero POS / financial /
// customer / employee touches.
// ============================================================

import {
  getPendingActions,
  markActionHandled,
} from '../companionActionInbox';
import type {
  CompanionApproveRequestPayload,
  CompanionDenyRequestPayload,
  CompanionInboxAction,
} from '../companionTypes';

export type ApprovalActionKind = 'approve' | 'deny';

/**
 * Normalised view of a pending approval action from the inbox.
 * The receiver flattens the {approve|deny}_request envelope so
 * downstream consumers don't have to switch on the inbox type.
 */
export interface ApprovalActionReceiverResult {
  /** Inbox actionId — pass back to markApprovalActionHandled() once
   *  the consumer has applied (or chosen to ignore) the action. */
  actionId: string;
  kind: ApprovalActionKind;
  /** Approval being acted on. */
  approvalId: string;
  /** Approver / denier id if Companion supplied one. */
  byEmployeeId?: string;
  /** Optional reason string supplied by the Companion side. */
  reason?: string;
  /** ms epoch when the action arrived in the inbox. */
  receivedAt: number;
}

// ── Public API ────────────────────────────────────────────

/**
 * Read every pending approval action from the inbox, validate, and
 * return normalised results. Actions that fail validation (missing
 * approvalId, wrong shape) are dropped silently with console.warn —
 * the caller never sees a malformed result.
 *
 * Cero side effects: this does NOT mark anything handled. Use
 * processApprovalAction or markApprovalActionHandled when the
 * consumer has actually applied (or chosen to ignore) the action.
 */
export function readPendingApprovalActions(): ApprovalActionReceiverResult[] {
  const pending = getPendingActions();
  const out: ApprovalActionReceiverResult[] = [];
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
 *   - the action is not an approval action
 *   - the action fails validation (missing approvalId, etc.)
 *
 * IMPORTANT: "process" here means "translate + mark handled". It
 * does NOT perform any real approval mutation, run any approval
 * guard, or bypass any PIN / permission. That work lives in
 * services/security/approvalGuard.ts and is intentionally not
 * called from this shell.
 */
export function processApprovalAction(inboxActionId: string): ApprovalActionReceiverResult | null {
  const pending = getPendingActions();
  const action = pending.find((a) => a.actionId === inboxActionId);
  if (!action) return null;
  const result = normalize(action);
  if (!result) return null;
  markActionHandled(inboxActionId);
  return result;
}

/**
 * Mark an approval action handled without re-normalising. Idempotent
 * passthrough to companionActionInbox.markActionHandled. Useful when
 * the consumer already inspected the result and explicitly decided
 * to ignore the action.
 */
export function markApprovalActionHandled(inboxActionId: string): void {
  markActionHandled(inboxActionId);
}

// ── Internal ─────────────────────────────────────────────

function normalize(action: CompanionInboxAction): ApprovalActionReceiverResult | null {
  if (action.type !== 'approve_request' && action.type !== 'deny_request') {
    return null;
  }
  const payload = action.payload as
    | CompanionApproveRequestPayload
    | CompanionDenyRequestPayload;
  if (!payload || typeof payload.approvalId !== 'string' || payload.approvalId.length === 0) {
    console.warn(
      '[companion-approval-receiver] dropping action — missing approvalId',
      action.actionId,
    );
    return null;
  }

  if (action.type === 'approve_request') {
    const p = action.payload as CompanionApproveRequestPayload;
    return {
      actionId: action.actionId,
      kind: 'approve',
      approvalId: p.approvalId,
      byEmployeeId: p.approvedByEmployeeId,
      reason: p.reason,
      receivedAt: action.receivedAt,
    };
  }

  // type === 'deny_request'
  const p = action.payload as CompanionDenyRequestPayload;
  return {
    actionId: action.actionId,
    kind: 'deny',
    approvalId: p.approvalId,
    byEmployeeId: p.deniedByEmployeeId,
    reason: p.reason,
    receivedAt: action.receivedAt,
  };
}
