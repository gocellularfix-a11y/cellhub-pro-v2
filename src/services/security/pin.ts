// ============================================================
// CellHub Pro — Approval PIN verification (R-APPROVAL-PIN-V1)
// Pure logic. Hashed-PIN comparisons via @/utils/pinHash.
// Never persists, logs, or caches plaintext PINs.
//
// Two PIN namespaces are intentionally distinct:
//   - employee.pin         (4 digits, login / clock-in)
//   - employee.approvalPin (6 digits, manager authorization)
// ============================================================

import { comparePin } from '@/utils/pinHash';
import { getEffectivePermissions } from './permissions';
import type { Employee } from '@/store/types';

/** Reject obviously bad input fast — guards against accidental empty/long submits. */
export function isApprovalPinFormat(plain: string | null | undefined): boolean {
  if (!plain) return false;
  return /^\d{6}$/.test(plain);
}

/**
 * Find an active employee whose `approvalPin` matches `plainPin` AND
 * who is allowed to approve (canApprove). Returns the employee id
 * on match, otherwise null. NEVER returns the matched record itself
 * — callers only need the id for logging.
 */
export function verifyApprovalPin(
  plainPin: string,
  employees: Employee[] | null | undefined,
): string | null {
  if (!isApprovalPinFormat(plainPin)) return null;
  if (!Array.isArray(employees)) return null;
  for (const emp of employees) {
    if (!emp || !emp.active) continue;
    const perms = getEffectivePermissions(emp);
    if (!perms.canApprove) continue;
    const stored = emp.approvalPin;
    if (!stored) continue;
    if (comparePin(plainPin, stored)) return emp.id;
  }
  return null;
}

/**
 * Admin PIN fallback. Uses the global settings.adminPin. Same hashed
 * comparison rules as everywhere else. Returns true on match.
 */
export function verifyAdminPin(
  plainPin: string,
  settings: { adminPin?: string | null } | null | undefined,
): boolean {
  if (!plainPin) return false;
  const stored = settings?.adminPin;
  if (!stored) return false;
  return comparePin(plainPin, stored);
}
