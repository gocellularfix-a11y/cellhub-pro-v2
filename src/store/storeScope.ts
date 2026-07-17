// ============================================================
// CellHub Pro — Canonical store-scope policy (CELLHUB-INTELLIGENCE-I2A.1)
//
// THE single store-scoping rule, extracted VERBATIM from AppProvider's
// filteredState memo (r-multi-m2) so Reports, Intelligence and the
// multi-store parity tests all consume ONE policy that cannot drift:
//
//   - Per-store collections are filtered by currentStoreId UNLESS
//     consolidatedView is on, or currentStoreId is ''/null/'default'
//     (single-store mode) — those return the input unfiltered.
//   - A record belongs to the selected store when its storeId matches OR
//     when it has NO storeId (legacy records are visible in EVERY store —
//     the established policy from BUG-1 R-INVENTORY-SEARCH: a bad
//     HYDRATE/import can leave ids missing and records must never vanish).
//   - Customers, employees and settings are GLOBAL (never scoped).
//
// Pure functions, no React, no mutation.
// ============================================================

/** True when scoping is a no-op: consolidated view, or single-store mode
 *  (''/null/'default' currentStoreId — see BUG-1 note above). */
export function isUnscopedView(currentStoreId: string | null | undefined, consolidatedView: boolean): boolean {
  return consolidatedView || !currentStoreId || currentStoreId === 'default';
}

/** VERBATIM belongs() rule from AppProvider: match, or legacy no-storeId. */
export function belongsToStore(recordStoreId: string | undefined, currentStoreId: string): boolean {
  return !recordStoreId || recordStoreId === currentStoreId;
}

/** Scope one per-store collection. Returns the SAME array reference when
 *  unscoped (consolidated/single-store) — preserves AppProvider's
 *  identity-stability contract for ref-equality consumers. */
export function scopeCollection<T extends { storeId?: string }>(
  items: T[],
  currentStoreId: string | null | undefined,
  consolidatedView: boolean,
): T[] {
  if (isUnscopedView(currentStoreId, consolidatedView)) return items;
  return items.filter((i) => belongsToStore(i.storeId, currentStoreId as string));
}
