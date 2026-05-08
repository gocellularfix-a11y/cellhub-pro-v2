/**
 * Phone-aware search helper layered on top of `matchesSearch`.
 *
 * Existing `matchesSearch(query, ...fields)` does a case-insensitive
 * substring match. That works for names, SKUs, IMEIs, etc. but breaks
 * for phone numbers when the user's query and the stored value use
 * different formats — typing "8055551234" against "(805) 555-1234"
 * has no literal substring overlap.
 *
 * `matchesSearchPhones` keeps the existing literal-substring behavior
 * (so all current callers stay correct) and adds a digit-only fallback:
 * if the literal pass misses, strip non-digits from the query and from
 * the listed phone fields, then re-test with includes(). Only fires
 * when the query has ≥3 digits, so short alphanumeric queries do not
 * false-positive against any record whose phone happens to contain "1".
 *
 * Use it for any list that filters by phone — customers, repairs,
 * unlocks, layaways, special orders, appointments, sales transactions.
 * For phone-less domains (inventory, expenses, POs), keep using
 * `matchesSearch` directly.
 */
import { matchesSearch } from './fuzzyMatch';

export function matchesSearchPhones(
  query: string,
  phoneFields: (string | undefined | null)[],
  ...textFields: (string | undefined | null)[]
): boolean {
  if (!query || !query.trim()) return true;
  if (matchesSearch(query, ...textFields, ...phoneFields)) return true;
  const qDigits = query.replace(/\D/g, '');
  if (qDigits.length < 3) return false;
  return phoneFields.some((p) => {
    if (!p) return false;
    const pDigits = String(p).replace(/\D/g, '');
    return pDigits.length > 0 && pDigits.includes(qDigits);
  });
}
