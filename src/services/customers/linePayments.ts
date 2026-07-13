// ============================================================
// R-CUSTOMER-LINE-PAYMENTS-V1
// Single source of truth for reading a customer's monthly payment(s)
// under the per-phone model, with a deterministic legacy fallback.
//
// Model (src/store/types.ts):
//   phones?: string[]                    — one entry per line
//   carriers?: string[]                  — parallel to phones[]
//   monthlyPaymentsCents?: (number|null)[] — parallel to phones[], INTEGER CENTS
//   monthlyPayment?: string              — LEGACY customer-level dollars-string
//
// Compatibility rules (all deterministic, no mutation, never throws):
//   1. Per-line values are authoritative when ANY exist.
//   2. The legacy amount is a ONE-TIME fallback: it maps to the single line
//      of a single-line record, or counts once in the aggregate of a record
//      with no per-line values. It is NEVER copied to every line and NEVER
//      multiplied by the line count.
//   3. Per-line values and the legacy fallback are never counted together.
//   4. Reading any old/partial record shape must not crash.
// ============================================================

import type { Customer } from '@/store/types';

/** Parse a dollars value ('50', '50.00', 50) into integer cents, or null. */
export function parseDollarsToCents(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Integer cents → dollars string for form inputs ('50.00'). */
export function centsToDollarsString(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return '';
  return (cents / 100).toFixed(2);
}

/** Number of phone lines on the record (legacy single `phone` counts as one). */
export function getLineCount(c: Partial<Customer> | null | undefined): number {
  if (!c) return 0;
  const phones = Array.isArray(c.phones) ? c.phones.filter((p) => String(p || '').trim()) : [];
  if (phones.length > 0) return phones.length;
  return String(c.phone || '').trim() ? 1 : 0;
}

/** True when the record has at least one usable per-line amount. */
export function hasPerLinePayments(c: Partial<Customer> | null | undefined): boolean {
  const arr = c?.monthlyPaymentsCents;
  return Array.isArray(arr) && arr.some((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
}

/**
 * Monthly payment for one line (by phones[] index), integer cents or null.
 * Legacy fallback applies ONLY to line 0 of a single-line record with no
 * per-line values — a multi-line legacy amount is never auto-assigned.
 */
export function getLinePaymentCents(
  c: Partial<Customer> | null | undefined,
  index: number,
): number | null {
  if (!c || index < 0) return null;
  const arr = c.monthlyPaymentsCents;
  if (Array.isArray(arr)) {
    const v = arr[index];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  }
  if (hasPerLinePayments(c)) return null; // per-line model is authoritative
  if (index === 0 && getLineCount(c) <= 1) return parseDollarsToCents(c.monthlyPayment);
  return null;
}

/**
 * Aggregate monthly value for the customer, integer cents or null.
 * Exact sum of per-line values when any exist; otherwise the legacy amount
 * counted ONCE (regardless of line count); never both.
 */
export function getMonthlyTotalCents(c: Partial<Customer> | null | undefined): number | null {
  if (!c) return null;
  if (hasPerLinePayments(c)) {
    let sum = 0;
    for (const v of c.monthlyPaymentsCents as (number | null)[]) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) sum += Math.round(v);
    }
    return sum > 0 ? sum : null;
  }
  return parseDollarsToCents(c.monthlyPayment);
}

/**
 * True when a legacy customer-level amount exists on a MULTI-line record
 * with no per-line values — the owner must assign the amount to the right
 * line (we never guess the allocation).
 */
export function hasUnassignedLegacyPayment(c: Partial<Customer> | null | undefined): boolean {
  if (!c || hasPerLinePayments(c)) return false;
  if (getLineCount(c) <= 1) return false;
  return parseDollarsToCents(c.monthlyPayment) != null;
}

const digits = (p: unknown): string => String(p || '').replace(/\D/g, '');

/**
 * Monthly payment for a specific phone NUMBER (matched by digits against
 * phones[]/legacy phone), integer cents or null. Used by POS phone-payment
 * prefill so each line prefills its own amount.
 */
export function getPaymentCentsForPhone(
  c: Partial<Customer> | null | undefined,
  phone: unknown,
): number | null {
  if (!c) return null;
  const target = digits(phone);
  if (!target) return null;
  const t10 = target.slice(-10);
  const phones = Array.isArray(c.phones) ? c.phones : (c.phone ? [c.phone] : []);
  for (let i = 0; i < phones.length; i++) {
    const d = digits(phones[i]);
    if (d && d.slice(-10) === t10) return getLinePaymentCents(c, i);
  }
  // Legacy primary phone not mirrored into phones[]
  if (digits(c.phone).slice(-10) === t10) return getLinePaymentCents(c, 0);
  return null;
}

/** Convenience for POS prefill inputs: dollars string ('' when unknown). */
export function getPaymentDollarsForPhone(
  c: Partial<Customer> | null | undefined,
  phone: unknown,
): string {
  return centsToDollarsString(getPaymentCentsForPhone(c, phone));
}
