// ============================================================
// CellHub Pro — Companion Approval Emitter
// (R-COMPANION-APPROVAL-EMITTERS-V1)
//
// Thin wrappers that translate desktop approval lifecycle moments
// into typed CompanionEvent emissions. Producers (approvalGuard) call
// these AFTER successful state mutation / logger so the event stream
// stays consistent with persisted state.
//
// Cero networking. Cero PII. Payloads carry IDs, action type, source
// module, and a terminal reason only.
// ============================================================

import type { ApprovalActionType } from '@/store/types';
import { emit } from '../companionEventBus';
import type { CompanionApprovalPayload } from '../companionTypes';

/**
 * Map an ApprovalActionType to the desktop module that "owns" it.
 * Used to populate `payload.source` so the Companion app / future
 * dashboards can filter approvals by origin without parsing
 * actionType strings.
 */
export function sourceFromActionType(actionType: ApprovalActionType | string | undefined): string {
  switch (actionType) {
    case 'CANCEL_LAYAWAY':         return 'layaways';
    case 'CANCEL_REPAIR':          return 'repairs';
    case 'CANCEL_UNLOCK':          return 'unlocks';
    case 'CANCEL_SPECIAL_ORDER':   return 'specialOrders';
    case 'PRICE_OVERRIDE':         return 'pos';
    case 'DISCOUNT_OVERRIDE':      return 'pos';
    case 'REFUND':                 return 'returns';
    default:                       return 'unknown';
  }
}

// ── Public emit helpers ──────────────────────────────────

export interface ApprovalEmitInput {
  approvalId: string;
  actionType?: string;
  requestedByEmployeeId?: string;
  approvedByEmployeeId?: string;
  reason?: string;
  /** Optional override; if omitted the source is derived from actionType. */
  source?: string;
}

/** Approval gate triggered — guard is about to prompt the user. */
export function emitApprovalCreated(input: ApprovalEmitInput): void {
  emit({
    type: 'APPROVAL_CREATED',
    category: 'approvals',
    payload: buildPayload(input, 'pending'),
    createdAt: Date.now(),
  });
}

/** Guard resolved with a valid approver (employee match or admin PIN). */
export function emitApprovalApproved(input: ApprovalEmitInput): void {
  emit({
    type: 'APPROVAL_APPROVED',
    category: 'approvals',
    payload: buildPayload(input, 'approved'),
    createdAt: Date.now(),
  });
}

/**
 * Guard resolved as denied. Reason carries the specific terminal
 * branch (cancelled / timeout / invalid_pin / self_approval_blocked).
 */
export function emitApprovalDenied(input: ApprovalEmitInput): void {
  emit({
    type: 'APPROVAL_DENIED',
    category: 'approvals',
    payload: buildPayload(input, 'denied'),
    createdAt: Date.now(),
  });
}

// ── Internal ─────────────────────────────────────────────

function buildPayload(
  input: ApprovalEmitInput,
  status: 'pending' | 'approved' | 'denied',
): CompanionApprovalPayload {
  const out: CompanionApprovalPayload = {
    approvalId: input.approvalId,
    status,
  };
  if (input.actionType)            out.actionType = input.actionType;
  if (input.requestedByEmployeeId) out.requestedByEmployeeId = input.requestedByEmployeeId;
  if (input.approvedByEmployeeId)  out.approvedByEmployeeId = input.approvedByEmployeeId;
  if (input.reason)                out.reason = input.reason;
  out.source = (input.source ?? sourceFromActionType(input.actionType)) || 'unknown';
  return out;
}
