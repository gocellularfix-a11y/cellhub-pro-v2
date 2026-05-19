// R-PERMISSION-GATE-V1 — Operational action permission gate.
// Deterministic gate that evaluates whether an action can execute directly,
// requires approval, or must be blocked. No UI, no execution, no side effects.
// Callers decide how to surface the decision (toast, modal, disable button, etc.)

import type { PermissionDecision, PermissionGateInput } from './types';

// ── Role capability sets ──────────────────────────────────────────────────────
// Each set is an array of "entityKind:actionKey" strings for O(1) lookup.

const TECHNICIAN_ALLOWED = new Set([
  'repair:open',
  'repair:notify_customer',
  'repair:escalate_delayed',
  'inventory:open',
  'customer:open',
]);

const CASHIER_ALLOWED = new Set([
  'customer:open',
  'customer:whatsapp',
  'customer:collect_payment',
  'layaway:open',
  'layaway:collect_payment',
  'sale:open',
  'sale:view_receipt',
  'inventory:open',
]);

// ── Gate ──────────────────────────────────────────────────────────────────────

/**
 * Evaluates whether an action is allowed, requires approval, or is blocked.
 *
 * Decision order:
 *   1. null descriptor          → blocked / unsupported_action
 *   2. safeReadOnly             → allowed / safe_read_only  (any role, including unknown)
 *   3. owner / manager          → allowed / role_allowed
 *   4. technician / cashier     → role set check + requiresApproval gate
 *   5. unknown / undefined role → requiresApproval → requires_approval, else blocked
 */
export function evaluateActionPermission(
  input: PermissionGateInput,
): PermissionDecision {
  const { role = 'unknown', descriptor, entityKind, actionKey } = input;

  // 1. Unknown action
  if (!descriptor) {
    return { status: 'blocked', reason: 'unsupported_action' };
  }

  // 2. Read-only actions are safe for all roles
  if (descriptor.safeReadOnly) {
    return { status: 'allowed', reason: 'safe_read_only' };
  }

  // 3. Owners and managers are fully trusted
  if (role === 'owner' || role === 'manager') {
    return { status: 'allowed', reason: 'role_allowed' };
  }

  const actionSlot = `${entityKind}:${actionKey}`;

  // 4. Technician
  if (role === 'technician') {
    if (TECHNICIAN_ALLOWED.has(actionSlot)) {
      if (descriptor.requiresApproval) {
        return { status: 'requires_approval', reason: 'descriptor_requires_approval' };
      }
      return { status: 'allowed', reason: 'role_allowed' };
    }
    return { status: 'requires_approval', reason: 'role_requires_approval' };
  }

  // 5. Cashier
  if (role === 'cashier') {
    if (CASHIER_ALLOWED.has(actionSlot)) {
      if (descriptor.requiresApproval) {
        return { status: 'requires_approval', reason: 'descriptor_requires_approval' };
      }
      return { status: 'allowed', reason: 'role_allowed' };
    }
    return { status: 'requires_approval', reason: 'role_requires_approval' };
  }

  // 6. Unknown role
  if (descriptor.requiresApproval) {
    return { status: 'requires_approval', reason: 'descriptor_requires_approval' };
  }
  return { status: 'blocked', reason: 'unknown_role' };
}

/** Shorthand: returns true only when decision is 'allowed'. */
export function canExecuteAction(input: PermissionGateInput): boolean {
  return evaluateActionPermission(input).status === 'allowed';
}

/** Shorthand: returns true when decision is 'requires_approval'. */
export function requiresActionApproval(input: PermissionGateInput): boolean {
  return evaluateActionPermission(input).status === 'requires_approval';
}
