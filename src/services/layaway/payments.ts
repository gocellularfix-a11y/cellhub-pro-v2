// ============================================================
// CellHub Pro — Layaway Multi-Payment Helpers (R-LAYAWAY-MULTIPAY-V1)
// Pure logic. No React, no DOM, no I/O. Safe to import from
// services, hooks, render code, or tests.
//
// Strategy:
//   - normalizeLayawayPayments: lazy in-memory migration. Synthesizes a
//     single payments[0] from legacy paidAmount/depositMethod when the
//     array is absent. Never touches storage.
//   - calculateLayawayTotals: single source of truth for paid/remaining/
//     count. Prefers payments[] when present (auditor: "Use computed
//     totals where safe") and falls back to legacy paidAmount only when
//     no payments[] exists.
//   - addLayawayPayment: appends a discrete payment record. Validates
//     positive cents only. Cap-to-remaining is the caller's responsibility
//     so we don't fight POSModule §4d's existing tolerant cap behaviour.
// ============================================================

import type { Layaway, LayawayPayment, PaymentMethod } from '@/store/types';
import { generateId } from '@/utils/dates';

export interface LayawayTotals {
  totalPaidCents: number;
  remainingBalanceCents: number;
  paymentCount: number;
}

const ZERO_TOTALS: LayawayTotals = {
  totalPaidCents: 0,
  remainingBalanceCents: 0,
  paymentCount: 0,
};

// ── normalize ────────────────────────────────────────────

/**
 * Returns the layaway's payment history. If the layaway already has a
 * payments[] array, that is returned as-is. Otherwise a single legacy
 * record is synthesized from paidAmount + depositMethod + createdAt so
 * old data renders without a migration script.
 *
 * Returns an empty array when the layaway has no recorded payments
 * (paidAmount === 0). This is the normal case for a brand-new layaway
 * at the moment of agreement creation.
 */
export function normalizeLayawayPayments(
  l: Layaway | null | undefined,
): LayawayPayment[] {
  if (!l) return [];
  const existing = (l as { payments?: LayawayPayment[] }).payments;
  if (Array.isArray(existing)) return existing;

  const paid = (l as { paidAmount?: number }).paidAmount || 0;
  if (paid <= 0) return [];

  const date = legacyDateToIso((l as { createdAt?: unknown }).createdAt);
  const method = (l as { depositMethod?: string }).depositMethod || 'Cash';

  return [
    {
      id: `${l.id || 'lay'}-pmt-legacy`,
      amount: paid,
      method: method as PaymentMethod,
      date,
      employeeId: l.employeeId,
    },
  ];
}

// ── totals ───────────────────────────────────────────────

/**
 * Compute paid / remaining / count from a layaway. Single source of
 * truth for any UI that needs to display payment progress.
 */
export function calculateLayawayTotals(
  l: Layaway | null | undefined,
): LayawayTotals {
  if (!l) return ZERO_TOTALS;
  const total = l.totalPrice || 0;
  const payments = normalizeLayawayPayments(l);

  // Prefer payments[] sum when present; fall back to stored paidAmount
  // only for the empty-history case so we don't desync from legacy data
  // that has paidAmount > 0 but no synthesized record (shouldn't happen
  // — normalize always synthesizes when paidAmount > 0 — but defensive).
  const totalPaidCents = payments.length > 0
    ? payments.reduce((sum, p) => sum + (p.amount || 0), 0)
    : (l.paidAmount || 0);

  const remainingBalanceCents = Math.max(0, total - totalPaidCents);

  return {
    totalPaidCents,
    remainingBalanceCents,
    paymentCount: payments.length,
  };
}

// ── add ──────────────────────────────────────────────────

export interface AddLayawayPaymentInput {
  amountCents: number;
  method: PaymentMethod;
  employeeId?: string;
  note?: string;
  /** ISO string. Defaults to now. */
  date?: string;
}

/**
 * Append a discrete payment record to a layaway. Returns a NEW layaway
 * object — caller persists. Always returns with `payments` populated
 * (either the existing/synthesized array, optionally extended with the
 * new record) so callers can derive aggregates without an Array.isArray
 * guard on the result.
 *
 * Audit invariant: appended amount is clamped to the layaway's remaining
 * balance — never produces a record that, when summed with prior records,
 * would exceed totalPrice. Caller is expected to set
 *   paidAmount := sum(returned.payments[].amount)
 * to keep aggregate fields reconciled with the discrete log.
 *
 * Throws ONLY on truly corrupt input (non-finite or non-positive amountCents)
 * — overpay is handled by clamping, never by throwing. POSModule §4d wraps
 * this in try/catch as defense-in-depth against future corruption sources.
 */
export function addLayawayPayment(
  l: Layaway,
  input: AddLayawayPaymentInput,
): Layaway {
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('addLayawayPayment: amountCents must be a positive integer');
  }

  // Lazy-normalize so legacy layaways pick up a synthesized record on
  // their first new write. Once we persist this returned object, the
  // legacy fallback path no longer fires for that layaway.
  const existing = normalizeLayawayPayments(l);

  // Clamp to remaining balance derived from the SAME payments[] view
  // we're about to extend, so the resulting sum can never exceed
  // totalPrice. Overpay portions (cashier physically collected more
  // than the layaway owes) are recorded as a Sale by POS but are NOT
  // reflected in the layaway log — preserving sum(payments)===paidAmount.
  const totals = calculateLayawayTotals(l);
  const safeAmount = Math.min(amount, totals.remainingBalanceCents);
  if (safeAmount <= 0) {
    // Layaway already fully reconciled. Persist the (possibly synthesized)
    // existing array so the caller's downstream
    //   sum(returned.payments) === paidAmount
    // contract still holds without extra guards.
    return { ...l, payments: existing };
  }

  const record: LayawayPayment = {
    id: generateId(),
    amount: safeAmount,
    method: input.method,
    date: input.date || new Date().toISOString(),
  };
  if (input.employeeId) record.employeeId = input.employeeId;
  if (input.note) record.note = input.note;

  return {
    ...l,
    payments: [...existing, record],
  };
}

// ── internal ─────────────────────────────────────────────

function legacyDateToIso(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (raw instanceof Date) return raw.toISOString();
  // Firestore Timestamp duck-type — has toDate()
  if (raw && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    try {
      const d = (raw as { toDate: () => Date }).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
    } catch {
      // fall through
    }
  }
  return new Date().toISOString();
}
