// ============================================================
// CellHub Pro — Approval Permissions (R-APPROVAL-PIN-V1)
// Pure logic. No React, no DOM, no I/O. Safe to import from
// services, hooks, or tests.
//
// Per-employee permission flags fall back to role-level defaults
// when undefined. Action categorisation is centralised here so
// the future audit viewer + log filters share one source.
// ============================================================

import type {
  ApprovalActionType,
  ApprovalCategory,
  Employee,
  EmployeePermissions,
  EmployeeRole,
} from '@/store/types';

// ── Defaults per role ─────────────────────────────────────
// Auditor-locked (R-APPROVAL-PIN-F1):
//   owner / manager   → can approve, nothing requires approval for them
//   technician        → cannot approve; repair+unlock free; financial gated
//   sales / cashier   → cannot approve; everything gated
const DEFAULT_OWNER: EmployeePermissions = {
  canApprove: true,
  requireApprovalForPriceChange: false,
  requireApprovalForDiscount: false,
  requireApprovalForLayawayCancel: false,
  requireApprovalForRepairCancel: false,
  requireApprovalForUnlockCancel: false,
  requireApprovalForSpecialOrderCancel: false,
  requireApprovalForRefund: false,
};

const DEFAULT_MANAGER: EmployeePermissions = { ...DEFAULT_OWNER };

const DEFAULT_TECHNICIAN: EmployeePermissions = {
  canApprove: false,
  requireApprovalForPriceChange: true,
  requireApprovalForDiscount: true,
  requireApprovalForLayawayCancel: true,
  requireApprovalForRepairCancel: false,
  requireApprovalForUnlockCancel: false,
  requireApprovalForSpecialOrderCancel: true,
  requireApprovalForRefund: true,
};

const DEFAULT_GATED: EmployeePermissions = {
  canApprove: false,
  requireApprovalForPriceChange: true,
  requireApprovalForDiscount: true,
  requireApprovalForLayawayCancel: true,
  requireApprovalForRepairCancel: true,
  requireApprovalForUnlockCancel: true,
  requireApprovalForSpecialOrderCancel: true,
  requireApprovalForRefund: true,
};

export const ROLE_PERMISSION_DEFAULTS: Record<EmployeeRole, EmployeePermissions> = {
  owner:      DEFAULT_OWNER,
  manager:    DEFAULT_MANAGER,
  technician: DEFAULT_TECHNICIAN,
  sales:      DEFAULT_GATED,
  cashier:    DEFAULT_GATED,
};

/**
 * Merge employee-level overrides on top of role defaults. Returns
 * a fully-populated permission object (no undefined fields), so
 * callers can read flags directly without nullish-coalescing.
 */
export function getEffectivePermissions(
  employee: Pick<Employee, 'role' | 'permissions'> | null | undefined,
): Required<EmployeePermissions> {
  const role: EmployeeRole = (employee?.role as EmployeeRole) || 'sales';
  const defaults = ROLE_PERMISSION_DEFAULTS[role] || DEFAULT_GATED;
  const overrides = employee?.permissions || {};
  return {
    canApprove:                          overrides.canApprove                          ?? !!defaults.canApprove,
    requireApprovalForPriceChange:       overrides.requireApprovalForPriceChange       ?? !!defaults.requireApprovalForPriceChange,
    requireApprovalForDiscount:          overrides.requireApprovalForDiscount          ?? !!defaults.requireApprovalForDiscount,
    requireApprovalForLayawayCancel:     overrides.requireApprovalForLayawayCancel     ?? !!defaults.requireApprovalForLayawayCancel,
    requireApprovalForRepairCancel:      overrides.requireApprovalForRepairCancel      ?? !!defaults.requireApprovalForRepairCancel,
    requireApprovalForUnlockCancel:      overrides.requireApprovalForUnlockCancel      ?? !!defaults.requireApprovalForUnlockCancel,
    requireApprovalForSpecialOrderCancel:overrides.requireApprovalForSpecialOrderCancel?? !!defaults.requireApprovalForSpecialOrderCancel,
    requireApprovalForRefund:            overrides.requireApprovalForRefund            ?? !!defaults.requireApprovalForRefund,
  };
}

/**
 * Map an action type to the per-employee flag that gates it.
 * Centralised so the guard, the settings UI, and any future viewer
 * agree on the mapping.
 */
export function getRequireFlagFor(actionType: ApprovalActionType): keyof EmployeePermissions {
  switch (actionType) {
    case 'PRICE_OVERRIDE':         return 'requireApprovalForPriceChange';
    case 'DISCOUNT_OVERRIDE':      return 'requireApprovalForDiscount';
    case 'CANCEL_LAYAWAY':         return 'requireApprovalForLayawayCancel';
    case 'CANCEL_REPAIR':          return 'requireApprovalForRepairCancel';
    case 'CANCEL_UNLOCK':          return 'requireApprovalForUnlockCancel';
    case 'CANCEL_SPECIAL_ORDER':   return 'requireApprovalForSpecialOrderCancel';
    case 'REFUND':                 return 'requireApprovalForRefund';
  }
}

/**
 * Decide whether `employee` needs approval for `actionType` given the
 * current global setting. Returns false (no gate) when the feature is
 * disabled at the store level — keeps the system dormant by default.
 */
export function requiresApproval(
  actionType: ApprovalActionType,
  employee: Pick<Employee, 'role' | 'permissions'> | null | undefined,
  settings: { approvalsEnabled?: boolean } | null | undefined,
): boolean {
  if (!settings?.approvalsEnabled) return false;
  if (!employee) return false;
  const perms = getEffectivePermissions(employee);
  const flag = getRequireFlagFor(actionType);
  return !!perms[flag];
}

// ── Self-approval policy ──────────────────────────────────
// Centralised so future hooks (owner bypass refinements, emergency
// override flag, remote approver sessions, delegated approvals) live
// in one place instead of being duplicated by each module.

/**
 * Approver identity prefix used for non-employee principals (e.g. admin PIN
 * fallback emits 'approver:admin'; future remote/mobile sessions will emit
 * 'approver:remote:<sessionId>'). Treated as a distinct principal — never
 * counts as self-approval regardless of the requesting employee.
 */
export const SYSTEM_APPROVER_PREFIX = 'approver:';

export interface SelfApprovalContext {
  requestedByEmployeeId: string;
  /** Approver identity returned by verifyApprovalPin / admin fallback. */
  matchedApproverId: string;
  employees: Pick<Employee, 'id' | 'role'>[];
}

/**
 * Decide whether the matched approver is allowed to authorize their own
 * pending action. Returns true when the match is NOT a self-approval
 * (different employee, or system approver), or when policy permits the
 * specific self-match (owner today; future delegations/emergencies later).
 *
 * Keep this function pure — no React, no I/O — so the guard, future
 * remote-approval orchestrator, and tests all share the same rule.
 */
export function canCurrentEmployeeApproveSelf(ctx: SelfApprovalContext): boolean {
  const { requestedByEmployeeId, matchedApproverId, employees } = ctx;

  // System approvers (admin pin, future remote/delegated) are distinct
  // principals — they cannot trigger a self-approval scenario.
  if (matchedApproverId.startsWith(SYSTEM_APPROVER_PREFIX)) return true;

  // Different employee → not self-approving. Allow.
  if (matchedApproverId !== requestedByEmployeeId) return true;

  // Self-match path. Today only owners may self-approve. Future hooks
  // for emergency override / delegated approvals / remote sessions
  // should land here so callers don't grow their own copy of this logic.
  const emp = employees.find((e) => e && e.id === requestedByEmployeeId);
  return emp?.role === 'owner';
}

/** Categorise an action for log/filter purposes. */
export function categoryFor(actionType: ApprovalActionType): ApprovalCategory {
  switch (actionType) {
    case 'PRICE_OVERRIDE':
    case 'DISCOUNT_OVERRIDE':
    case 'CANCEL_LAYAWAY':
    case 'CANCEL_SPECIAL_ORDER':
    case 'REFUND':
      return 'financial';
    case 'CANCEL_REPAIR':
    case 'CANCEL_UNLOCK':
      return 'service';
  }
}
