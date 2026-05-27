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
