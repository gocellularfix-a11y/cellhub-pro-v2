// ============================================================
// CellHub Pro — Approval Guard (R-APPROVAL-PIN-V1)
// Pure orchestration helper. Decides whether a restricted action
// needs approval, asks an injected `prompter` for the PIN, and
// validates / logs the result.
//
// Decoupled from React + DOM on purpose. The same function will
// drive the local PIN modal (current consumer) and a future
// remote-mobile approval flow (the prompter just becomes async
// and resolves when the phone responds).
// ============================================================

import type {
  ApprovalActionType,
  ApprovalEvent,
  Employee,
} from '@/store/types';
import {
  canCurrentEmployeeApproveSelf,
  categoryFor,
  requiresApproval,
} from './permissions';
import { verifyAdminPin, verifyApprovalPin } from './pin';
import { appendApprovalEvent } from '@/services/approvalLog';
// R-COMPANION-APPROVAL-EMITTERS-V1 — desktop-side companion events.
// Cero networking; the emitter writes to the in-memory bus only.
import {
  emitApprovalApproved,
  emitApprovalCreated,
  emitApprovalDenied,
} from '@/services/companion/emitters/approvalEmitter';
import { generateId } from '@/utils/dates';

// ── Public types ──────────────────────────────────────────

export interface ApprovalRequest {
  actionType: ApprovalActionType;
  requestedByEmployeeId: string;
  entityId?: string;
}

export type ApprovalDenialReason =
  | 'feature_disabled'
  | 'not_required'
  | 'cancelled'
  | 'timeout'
  | 'invalid_pin'
  | 'self_approval_blocked';

export interface ApprovalResult {
  approved: boolean;
  /** empId of the approver, or 'approver:admin' for admin-pin fallback. Empty when denied. */
  approvedByEmployeeId: string;
  reason?: ApprovalDenialReason;
}

/** What the prompter resolves with. `cancelled` covers ESC, X click, and the inactivity timeout. */
export type PrompterResponse =
  | { cancelled: true; reason?: 'cancelled' | 'timeout' }
  | { cancelled: false; pin: string };

/** Modal-agnostic PIN input. The local-modal wrapper and the future remote
 *  approver both implement this signature. */
export type ApprovalPrompter = (req: ApprovalRequest) => Promise<PrompterResponse>;

export interface ApprovalGuardContext {
  employees: Employee[];
  settings: { adminPin?: string | null; approvalsEnabled?: boolean } | null | undefined;
  prompter: ApprovalPrompter;
  /** Optional override — defaults to appendApprovalEvent. Useful for tests. */
  log?: (event: Omit<ApprovalEvent, 'id' | 'createdAt'>) => void;
}

const ADMIN_APPROVER_ID = 'approver:admin';

// ── Pure helpers ──────────────────────────────────────────

/** Does the requesting employee actually need approval for this action? */
export function isApprovalNeeded(
  request: ApprovalRequest,
  employees: Employee[],
  settings: { approvalsEnabled?: boolean } | null | undefined,
): boolean {
  const requester = (employees || []).find((e) => e && e.id === request.requestedByEmployeeId) || null;
  return requiresApproval(request.actionType, requester, settings);
}

// ── Main entry ────────────────────────────────────────────

/**
 * Run the approval flow for a restricted action. Returns once the
 * decision is made. Caller should ONLY proceed with the action
 * when result.approved is true.
 *
 * Self-approval guard: if the PIN belongs to the same employee that
 * requested the action, the attempt is denied. Owners are exempt
 * (per auditor spec — last-line-of-defense if no other approver
 * is on shift). Admin PIN fallback bypasses the self check by design,
 * since admin is treated as a separate principal.
 */
export async function requestApproval(
  request: ApprovalRequest,
  ctx: ApprovalGuardContext,
): Promise<ApprovalResult> {
  const { employees, settings, prompter } = ctx;
  const logger = ctx.log || ((evt) => { appendApprovalEvent(evt); });

  // Feature off → pass-through. Caller proceeds without prompt.
  if (!settings?.approvalsEnabled) {
    return { approved: true, approvedByEmployeeId: '', reason: 'feature_disabled' };
  }

  if (!isApprovalNeeded(request, employees, settings)) {
    return { approved: true, approvedByEmployeeId: '', reason: 'not_required' };
  }

  // R-COMPANION-APPROVAL-EMITTERS-V1: stable id reused across every
  // Companion event for THIS guard invocation. Different invocations
  // (e.g. the hook's invalid-PIN retry loop) get distinct ids — by
  // design, since each attempt is a separate request from the system's
  // perspective.
  const approvalId = generateId();
  emitApprovalCreated({
    approvalId,
    actionType: request.actionType,
    requestedByEmployeeId: request.requestedByEmployeeId,
  });

  const response = await prompter(request);
  if (response.cancelled) {
    const reason: ApprovalDenialReason = response.reason === 'timeout' ? 'timeout' : 'cancelled';
    logger({
      requestedByEmployeeId: request.requestedByEmployeeId,
      approvedByEmployeeId: '',
      actionType: request.actionType,
      category: categoryFor(request.actionType),
      status: 'denied',
      entityId: request.entityId,
    });
    emitApprovalDenied({
      approvalId,
      actionType: request.actionType,
      requestedByEmployeeId: request.requestedByEmployeeId,
      reason,
    });
    return { approved: false, approvedByEmployeeId: '', reason };
  }

  const pin = response.pin || '';

  // 1) Try employee approvers first.
  const matchedEmpId = verifyApprovalPin(pin, employees);
  if (matchedEmpId) {
    const allowed = canCurrentEmployeeApproveSelf({
      requestedByEmployeeId: request.requestedByEmployeeId,
      matchedApproverId: matchedEmpId,
      employees,
    });
    if (!allowed) {
      logger({
        requestedByEmployeeId: request.requestedByEmployeeId,
        approvedByEmployeeId: '',
        actionType: request.actionType,
        category: categoryFor(request.actionType),
        status: 'denied',
        entityId: request.entityId,
      });
      emitApprovalDenied({
        approvalId,
        actionType: request.actionType,
        requestedByEmployeeId: request.requestedByEmployeeId,
        reason: 'self_approval_blocked',
      });
      return { approved: false, approvedByEmployeeId: '', reason: 'self_approval_blocked' };
    }
    logger({
      requestedByEmployeeId: request.requestedByEmployeeId,
      approvedByEmployeeId: matchedEmpId,
      actionType: request.actionType,
      category: categoryFor(request.actionType),
      status: 'approved',
      entityId: request.entityId,
    });
    emitApprovalApproved({
      approvalId,
      actionType: request.actionType,
      requestedByEmployeeId: request.requestedByEmployeeId,
      approvedByEmployeeId: matchedEmpId,
    });
    return { approved: true, approvedByEmployeeId: matchedEmpId };
  }

  // 2) Admin PIN fallback. Treated as a distinct principal.
  if (verifyAdminPin(pin, settings)) {
    logger({
      requestedByEmployeeId: request.requestedByEmployeeId,
      approvedByEmployeeId: ADMIN_APPROVER_ID,
      actionType: request.actionType,
      category: categoryFor(request.actionType),
      status: 'approved',
      entityId: request.entityId,
    });
    emitApprovalApproved({
      approvalId,
      actionType: request.actionType,
      requestedByEmployeeId: request.requestedByEmployeeId,
      approvedByEmployeeId: ADMIN_APPROVER_ID,
    });
    return { approved: true, approvedByEmployeeId: ADMIN_APPROVER_ID };
  }

  // 3) Bad PIN.
  logger({
    requestedByEmployeeId: request.requestedByEmployeeId,
    approvedByEmployeeId: '',
    actionType: request.actionType,
    category: categoryFor(request.actionType),
    status: 'denied',
    entityId: request.entityId,
  });
  emitApprovalDenied({
    approvalId,
    actionType: request.actionType,
    requestedByEmployeeId: request.requestedByEmployeeId,
    reason: 'invalid_pin',
  });
  return { approved: false, approvedByEmployeeId: '', reason: 'invalid_pin' };
}
