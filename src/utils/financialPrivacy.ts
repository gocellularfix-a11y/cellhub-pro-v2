// ============================================================
// CellHub Pro — Financial Privacy helper
// R-FINANCIAL-PRIVACY-V1
//
// Single source of truth for "can the current viewer see owner-only
// financial fields (profit, cost, margin, markup, COGS, net income)?".
//
// Pure read; no enforcement, no side effects. UI components, intelligence
// handlers, and report/export paths import this and check it before
// rendering profit-sensitive data. The audit (R-FINANCIAL-PRIVACY-V1
// audit pass) catalogued ~13 display surfaces that will adopt this
// helper in follow-up rounds; this file ships only the setting + helper.
//
// Setting key lives on StoreSettings via the double-cast pattern (see
// CLAUDE.md "Double-cast para new settings fields") — no type extension
// required. Default value is `false` so existing installations keep
// their current behavior until the owner explicitly enables the flag.
// ============================================================

import type { StoreSettings } from '@/store/types';

/**
 * Canonical settings key for the "hide profit/cost from employees" flag.
 * Exported as a const so consumers can reference the exact key without
 * stringly typing it across multiple files.
 */
export const FINANCIAL_PRIVACY_SETTING_KEY = 'hideOwnerFinancialsFromEmployees' as const;

/**
 * Returns `true` when the current viewer is allowed to see owner-only
 * financial fields (profit, cost, margin, markup, COGS, net income).
 *
 * Decision matrix:
 *   - setting OFF (default)              → true   (preserve current behavior)
 *   - setting ON  + viewer is admin/owner → true   (owner sees everything)
 *   - setting ON  + viewer is NOT admin   → false  (hide owner financials)
 *   - settings missing/null               → true   (defensive: no setting = no hide)
 *
 * @param settings        Current StoreSettings (or null/undefined during boot).
 * @param isAdminOrOwner  Caller-computed boolean. Typical sources:
 *                        `state.isAdminMode || currentEmployee?.role === 'owner'`.
 */
export function canViewOwnerFinancials(
  settings: StoreSettings | Record<string, unknown> | null | undefined,
  isAdminOrOwner: boolean,
): boolean {
  if (!settings) return true;
  const raw = (settings as Record<string, unknown>)[FINANCIAL_PRIVACY_SETTING_KEY];
  const hideEnabled = !!raw;
  if (!hideEnabled) return true;
  return !!isAdminOrOwner;
}

// ============================================================
// R-FINANCIAL-PRIVACY-POLICY-C (C1: helper + tests only)
//
// Single source of truth for role-aware owner-financial visibility.
// Decouples financial visibility from `isAdminMode` (admin/module unlock):
// admin/PIN unlock alone must NEVER grant profit/cost/margin visibility to a
// manager or employee. Owner sees by ROLE; managers see only when the owner
// opts in via `managersCanViewFinancials`.
//
// C1 ships the helper + tests ONLY. No call site uses it yet, so behavior is
// unchanged until a later phase (C3+) migrates call sites onto it.
// ============================================================

/**
 * Canonical settings key for the "managers may view owner financials" opt-in.
 * Default behavior when missing is `false` (managers restricted) — owner must
 * explicitly enable it. Stored on StoreSettings via the double-cast pattern
 * (not formally typed), same as FINANCIAL_PRIVACY_SETTING_KEY.
 */
export const MANAGERS_CAN_VIEW_FINANCIALS_SETTING_KEY = 'managersCanViewFinancials' as const;

/**
 * Role-aware resolution of "can THIS viewer see owner-only financial fields?"
 *
 * Decision matrix (Financial Privacy = `hideOwnerFinancialsFromEmployees`):
 *   - settings null/undefined                      → true  (legacy fallback)
 *   - Financial Privacy OFF / missing              → true  (legacy behavior)
 *   - role === 'owner'                             → true  (owner sees all)
 *   - role null/undefined (solo/unregistered)      → true  (solo-owner fallback)
 *   - role === 'manager'                           → managersCanViewFinancials === true
 *   - any other role (cashier/technician/sales/…)  → false (restricted)
 *
 * IMPORTANT: `isAdminMode` is accepted ONLY for caller convenience / debug
 * context. It is intentionally NEVER consulted to grant access — an admin/PIN
 * unlock must not silently turn a manager or employee into a financial viewer.
 *
 * @param args.settings        Current StoreSettings (or null during boot).
 * @param args.currentEmployee The logged-in employee (or null for solo owner).
 * @param args.isAdminMode     Accepted for compatibility/debug only; ignored.
 */
export function resolveOwnerFinancialAccess(args: {
  settings: StoreSettings | Record<string, unknown> | null | undefined;
  currentEmployee?: { role?: string | null } | null;
  isAdminMode?: boolean;
}): boolean {
  const { settings, currentEmployee, isAdminMode } = args;
  // Accepted for compatibility/debug context only — NEVER grants access.
  void isAdminMode;

  if (!settings) return true; // rule 1: legacy fallback
  const hideEnabled = !!(settings as Record<string, unknown>)[FINANCIAL_PRIVACY_SETTING_KEY];
  if (!hideEnabled) return true; // rule 2: privacy OFF → legacy behavior

  const role = currentEmployee?.role;
  if (role === 'owner') return true;        // rule 3
  if (role == null) return true;            // rule 4: solo-owner / unregistered
  if (role === 'manager') {                 // rule 5: owner-controlled opt-in
    return (settings as Record<string, unknown>)[MANAGERS_CAN_VIEW_FINANCIALS_SETTING_KEY] === true;
  }
  return false;                             // rule 6: cashier/technician/sales/etc.
}
