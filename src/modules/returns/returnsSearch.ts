// ============================================================
// P0-RET-1 — canonical, pure Returns "Find Sale" search engine.
//
// THE single source of truth for locating a completed sale in the Returns
// module. Framework-free and deterministic (node-testable). Replaces the inline
// filter in ReturnsModule.handleSearch whose invoice/phone digit fallback used
// `q.replace(/\D/g,'')` as the needle — a product-name query has no/few digits
// ("SAMSUNG GALAXY A15" → "15", "AIRPODS" → ""), and `str.includes("")` is true
// for EVERY sale, so `any`-mode name searches leaked into invoice/phone digit
// matching and returned ~30 unrelated recent sales (incl. AirPods).
//
// Rules (see P0-RET-1 §4/§5):
//   • Filter FIRST, limit AFTER — a match older than the recent window is still
//     found before the cap applies.
//   • A non-empty query with zero matches returns []  (never a recent-sales
//     fallback). Recent sales only surface for a genuinely empty query.
//   • Identifiers are matched as STRINGS — never parsed as numbers, leading
//     zeros preserved.
//   • Digit-substring identifier matches require a real number (≥ MIN_ID_DIGITS)
//     so a product-name fragment ("A15" → "15") can't match invoices/phones.
//   • Phone uses canonical normalizePhone. Text is case-insensitive.
//   • Mode isolation: item-mode never matches a customer name; name-mode never
//     matches an item; invoice-mode never matches a SKU.
// ============================================================

import type { Sale } from '@/store/types';
import { normalizePhone } from '@/utils/normalize';

export type ReturnSearchMode = 'any' | 'invoice' | 'phone' | 'name' | 'item' | 'date';

export interface ReturnSearchCriteria {
  mode: ReturnSearchMode;
  query: string;
  /** 'YYYY-MM-DD' inclusive lower bound (optional). */
  dateFrom?: string;
  /** 'YYYY-MM-DD' inclusive upper bound (optional). */
  dateTo?: string;
}

/**
 * A digit-substring identifier match (invoice/phone formatting-variant, IMEI)
 * requires at least this many digits, so an incidental product-name number
 * ("A15" → "15", "iPhone 14" → "14") never matches an invoice or phone. Real
 * invoices/phones/IMEIs always exceed this.
 */
export const MIN_ID_DIGITS = 4;

/** Max results returned — applied AFTER filtering (a specific query yields few). */
export const RETURN_SEARCH_LIMIT = 30;

const lc = (s: unknown): string => String(s ?? '').toLowerCase();
const digitsOf = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

/** Robust ms timestamp from a Sale.createdAt (Date | ISO | Firestore Timestamp). */
export function saleTimeMs(s: Sale): number {
  const ca = (s as unknown as { createdAt?: unknown }).createdAt;
  if (!ca) return 0;
  try {
    const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
      ? (ca as { toDate: () => Date }).toDate()
      : (ca as string | number | Date);
    const ms = new Date(d).getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch { return 0; }
}

function matchInvoice(s: Sale, q: string, qDigits: string): boolean {
  const inv = lc(s.invoiceNumber);
  if (!inv) return false;
  if (inv.includes(q)) return true; // text substring (e.g. "inv-1015" ⊇ "1015")
  // formatting-variant (scanned with/without dashes) — real invoice numbers only
  if (qDigits.length >= MIN_ID_DIGITS && digitsOf(s.invoiceNumber).includes(qDigits)) return true;
  return false;
}

function matchPhone(s: Sale, qDigits: string): boolean {
  if (qDigits.length < MIN_ID_DIGITS) return false; // no short-fragment leakage
  const ph = normalizePhone(String(s.customerPhone || ''));
  if (!ph) return false;
  const needle = qDigits.length > 10 ? qDigits.slice(-10) : qDigits;
  return ph.includes(needle);
}

function matchName(s: Sale, q: string): boolean {
  return lc(s.customerName).includes(q); // partial, case-insensitive
}

function matchItem(s: Sale, q: string, qDigits: string): boolean {
  return (s.items || []).some((i) => {
    // Product/item name — partial, case-insensitive (the common UX).
    if (lc(i.name).includes(q)) return true;
    // SKU — exact, case-insensitive (preserves hyphens/leading zeros as string).
    if (i.sku && lc(i.sku) === q) return true;
    // IMEI — exact digit match (never coerced to a number → leading zeros kept).
    const imei = digitsOf((i as unknown as { imei?: string }).imei);
    if (imei && qDigits && imei === qDigits) return true;
    return false;
  });
}

/**
 * Find return-eligible sales matching the criteria. Pure. Voided sales are
 * excluded. When `query` is empty the query filter is skipped (date range still
 * applies); a non-empty query that matches nothing returns [].
 */
export function searchReturnSales(sales: Sale[], criteria: ReturnSearchCriteria): Sale[] {
  const mode = criteria.mode || 'any';
  const q = lc((criteria.query || '').trim());
  const qDigits = digitsOf(criteria.query);
  const from = criteria.dateFrom ? new Date(criteria.dateFrom).getTime() : null;
  const to = criteria.dateTo ? new Date(`${criteria.dateTo}T23:59:59`).getTime() : null;

  let matches = (sales || []).filter((s) => s.status !== 'voided');

  if (from !== null && Number.isFinite(from)) matches = matches.filter((s) => saleTimeMs(s) >= from);
  if (to !== null && Number.isFinite(to)) matches = matches.filter((s) => saleTimeMs(s) <= to);

  // Query filter (skipped only for a genuinely empty query; 'date' mode ignores
  // any typed text and relies on the date range applied above).
  if (q && mode !== 'date') {
    matches = matches.filter((s) => {
      switch (mode) {
        case 'invoice': return matchInvoice(s, q, qDigits);
        case 'phone':   return matchPhone(s, qDigits);
        case 'name':    return matchName(s, q);
        case 'item':    return matchItem(s, q, qDigits);
        case 'any':
        default:
          return matchInvoice(s, q, qDigits)
            || matchPhone(s, qDigits)
            || matchName(s, q)
            || matchItem(s, q, qDigits);
      }
    });
  }

  // Filter FIRST (above), then sort newest-first and cap. A match older than the
  // recent window is already in `matches` before the cap applies.
  return matches
    .slice()
    .sort((a, b) => saleTimeMs(b) - saleTimeMs(a))
    .slice(0, RETURN_SEARCH_LIMIT);
}
