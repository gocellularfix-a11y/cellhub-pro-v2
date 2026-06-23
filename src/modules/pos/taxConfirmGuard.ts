// ============================================================
// R-PRODUCTION-B4: pure predicate for the taxable-checkout confirmation gate.
//
// A fresh external install must not silently complete a taxable sale using the
// California starter defaults. This helper is the single source of truth for
// "should this checkout be blocked?" so the rule is deterministic + unit-
// testable, independent of the POS React component. It does NOT compute tax —
// it only reads the already-computed aggregate tax on the sale.
// ============================================================

/**
 * Block checkout only when tax was NOT explicitly confirmed AND the sale
 * actually carries tax (sales tax / utility users tax / mobile surcharge are
 * aggregated into `saleTaxAmountCents`). A non-taxable sale (0 tax) is never
 * blocked, regardless of confirmation state.
 *
 * `taxSettingsConfirmed` is `undefined` on installs that predate the flag /
 * have not been stamped yet; treated as NOT confirmed (`!== true`).
 */
export function isTaxableCheckoutBlocked(
  taxSettingsConfirmed: boolean | undefined,
  saleTaxAmountCents: number | undefined,
): boolean {
  return taxSettingsConfirmed !== true && (saleTaxAmountCents || 0) > 0;
}
