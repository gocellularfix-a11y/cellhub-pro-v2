// ============================================================
// CellHub Pro — Remote Approval Trust Boundary
// (R-COMPANION-MANAGER-TRUST-BOUNDARY-PREFLIGHT-V1)
//
// HELPER ONLY. No caller in this round. This module defines the
// authorisation check that the future hybrid prompter (Phase 2B) MUST
// run before resolving any pending approval gate from a Companion
// mobile-supplied response. Bridge auth already validates the
// identity at the transport layer (R-BRIDGE-AUTH-HARDENING-V1); this
// helper validates the *managerId payload field* against the local
// employees + permission model so the desktop never trusts a
// remote-supplied id directly.
//
// What this file does NOT do:
//   - call approvalGuard
//   - call useApprovalGate
//   - mutate any approval / store / money / inventory state
//   - resolve any pending PIN modal promise
//   - bypass the local PIN authority
//
// What Phase 2B will do (separate round):
//   - the inbound approval-response receiver will call
//     validateRemoteApprovalActor(...) BEFORE forwarding to the
//     hybrid prompter's resolver
//   - reasons returned here drive the AUTH_REJECTED-style audit row
//     and the Companion-side UX correction
//
// See docs/companion-remote-approval-authority.md §3 (security rules)
// and docs/companion-phase-2b-preflight.md §4.2–4.3.
// ============================================================

import type { ApprovalActionType, Employee } from '@/store/types';
import {
  canCurrentEmployeeApproveSelf,
  getEffectivePermissions,
  requiresApproval,
  SYSTEM_APPROVER_PREFIX,
} from '@/services/security/permissions';

/** Stable reason codes. Phase 2B will surface these in audit rows and
 *  in the Companion-side error UX. Order matches the spec checklist. */
export type RemoteApprovalTrustReason =
  | 'remote_approval_disabled'
  | 'missing_manager_id'
  | 'admin_approver_not_allowed_remote'
  | 'manager_not_found'
  | 'manager_not_authorized'
  | 'self_approval_blocked'
  | 'approval_rule_failed'
  | 'invalid_gate_context';

/** Pending-gate context the helper needs to re-run the existing
 *  permission rules. Both fields required when the gate exists — if
 *  the caller has neither, this is `invalid_gate_context`. */
export interface RemoteApprovalGateContext {
  actionType: ApprovalActionType;
  requestedByEmployeeId: string;
}

export interface RemoteApprovalTrustInput {
  /** Live (response-time) read of settings.companionRemoteApprovalEnabled.
   *  Phase 2B note: must NOT be a value snapshot captured at gate-open
   *  time — toggling the setting off mid-gate must take effect on the
   *  very next response. Pass a getter that reads from a live source
   *  (e.g. a ref or a selector). */
  isRemoteEnabled: () => boolean;
  /** managerId claimed by the mobile Companion payload. Untrusted —
   *  cross-checked against the local employees list inside this helper. */
  managerId: string | undefined | null;
  /** Live employees list from the local store. Helper is non-mutating;
   *  declared as mutable only to match the upstream
   *  canCurrentEmployeeApproveSelf signature. */
  employees: Employee[];
  /** Settings snapshot for requiresApproval (only adminPin + approvalsEnabled
   *  are consulted; the helper does not need the full settings object). */
  settings: { adminPin?: string | null; approvalsEnabled?: boolean } | null | undefined;
  /** Pending gate context. Required — the helper rejects with
   *  `invalid_gate_context` when missing or incomplete because the
   *  self-approval block + permission re-check cannot run without it. */
  gate?: RemoteApprovalGateContext;
}

export type RemoteApprovalTrustResult =
  | { valid: true; manager: Employee }
  | { valid: false; reason: RemoteApprovalTrustReason };

/**
 * Deterministic remote-approval-actor validator.
 *
 * Runs all checks listed in the design doc §3 (security rules) in a
 * fixed order. No I/O, no React, no DOM — safe to call from any layer.
 * The same helper will drive Phase 2B's resolver and future unit tests.
 */
export function validateRemoteApprovalActor(
  input: RemoteApprovalTrustInput,
): RemoteApprovalTrustResult {
  // 7. companionRemoteApprovalEnabled — checked at RESPONSE time.
  if (!input.isRemoteEnabled()) {
    return { valid: false, reason: 'remote_approval_disabled' };
  }

  // 1. managerId exists + non-empty.
  const managerId = (input.managerId ?? '').toString().trim();
  if (!managerId) {
    return { valid: false, reason: 'missing_manager_id' };
  }

  // 2. System approver prefix (admin sentinel 'approver:admin' + any
  // future 'approver:remote:<sessionId>' style identity) NEVER accepted
  // from a mobile-supplied managerId. Mobile must claim a real employee
  // id; system principals are local-only.
  if (managerId.startsWith(SYSTEM_APPROVER_PREFIX)) {
    return { valid: false, reason: 'admin_approver_not_allowed_remote' };
  }

  // 3. manager exists in the local employees list.
  const manager = (input.employees || []).find((e) => e && e.id === managerId) ?? null;
  if (!manager) {
    return { valid: false, reason: 'manager_not_found' };
  }

  // 4. manager has approval privileges per the existing permission model.
  // getEffectivePermissions merges per-employee overrides on top of role
  // defaults — same source the local PIN flow uses, so behavior is
  // consistent across both authority paths.
  const perms = getEffectivePermissions(manager);
  if (!perms.canApprove) {
    return { valid: false, reason: 'manager_not_authorized' };
  }

  // Gate context required for #5 + #6. Without it we cannot validate
  // self-approval or re-run requiresApproval.
  if (
    !input.gate
    || typeof input.gate.actionType !== 'string'
    || !input.gate.actionType
    || typeof input.gate.requestedByEmployeeId !== 'string'
    || !input.gate.requestedByEmployeeId
  ) {
    return { valid: false, reason: 'invalid_gate_context' };
  }

  // 6. Re-run existing requiresApproval against the manager as the actor.
  // If THIS action would require approval for this manager (e.g., a
  // technician with canApprove overridden true but action-specific gate
  // still on), they cannot authorise it remotely. Same rule the local
  // PIN flow would apply at the prompter level.
  if (requiresApproval(input.gate.actionType, manager, input.settings)) {
    return { valid: false, reason: 'approval_rule_failed' };
  }

  // 5. Self-approval block — uses the same canCurrentEmployeeApproveSelf
  // helper the local PIN flow uses. Owner exemption (or any future
  // policy hook added there) flows through unchanged.
  const allowed = canCurrentEmployeeApproveSelf({
    requestedByEmployeeId: input.gate.requestedByEmployeeId,
    matchedApproverId: manager.id,
    employees: input.employees,
  });
  if (!allowed) {
    return { valid: false, reason: 'self_approval_blocked' };
  }

  return { valid: true, manager };
}
