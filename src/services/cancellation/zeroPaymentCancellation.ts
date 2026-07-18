// ============================================================
// CellHub Pro — Zero-Payment Cancellation Policy (shared, pure)
//
// THE single authoritative eligibility rule for "simple" (PIN-protected,
// no-refund) cancellation of Repairs / Unlocks / Special Orders / Layaways.
// A record is eligible for simple cancellation ONLY when it has NEVER received
// any payment or deposit AND is not in a final/cancelled state. Eligibility
// depends on the REAL financial history, not the current balance — a record
// that was paid and later refunded to $0 still has payment history and MUST
// use the existing refund/resolution flow, never simple cancellation.
//
// Pure and deterministic (no store, no money math, no side effects) so the UI
// layers and tests share one policy. This module decides ELIGIBILITY only; it
// performs no mutation, creates no Sale/Payment, and touches no cart/inventory.
// ============================================================

export type CancellableType = 'repair' | 'unlock' | 'special_order' | 'layaway';

/** The minimal shape each record exposes; every field is optional so a partial
 *  record (or a legacy one) is handled defensively. No `any`. */
export interface CancellableRecord {
  status?: string;
  // Accumulated total paid (cents). For SpecialOrder/Repair/Unlock this is
  // INCREMENTED on every payment; > 0 means money was received at some point.
  depositAmount?: number;
  balance?: number;
  // Append-only per-payment logs (SpecialOrder / Layaway) — the strongest
  // "was there ever a payment" signal (survives refunds).
  payments?: ReadonlyArray<unknown>;
  // Layaway legacy fields.
  paidAmount?: number;
  depositMethod?: string;
  // Repair: original-deposit metadata captured ONCE on the first payment and
  // never overwritten — an authoritative historical payment marker.
  depositMeta?: unknown;
}

export type SimpleCancelEligibility =
  | { eligible: true; kind: 'simple_cancel' }
  | { eligible: false; kind: 'already_cancelled' | 'final_status' | 'payment_history'; reasonKey: string };

/** i18n keys the UI resolves for the blocked reasons. */
export const CANCEL_BLOCK_REASON_KEYS = {
  already_cancelled: 'cancel.blocked.alreadyCancelled',
  final_status: 'cancel.blocked.finalStatus',
  payment_history: 'cancel.blocked.paymentHistory',
} as const;

function norm(status: string | undefined): string {
  return String(status || '').trim().toLowerCase();
}

// Statuses from which a record can NEVER be simply cancelled (final / terminal
// / already resolved). Kept per-type because the modules differ.
const CANCELLED_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'canceled', 'void', 'voided']);

const FINAL_STATUSES: Record<CancellableType, ReadonlySet<string>> = {
  // Repair: picked up / completed are protected; refund states are terminal.
  repair: new Set(['picked_up', 'pickedup', 'complete', 'completed', 'refunded', 'refund_pending']),
  // Unlock: a completed unlock is protected. (failed is non-final — a failed
  // unlock with no payment may still be cancelled.)
  unlock: new Set(['completed', 'complete', 'picked_up']),
  // Special order: picked up / refund states are protected.
  special_order: new Set(['picked_up', 'pickedup', 'refunded', 'refund_pending']),
  // Layaway: completed / fulfilled / forfeited / picked up are protected.
  layaway: new Set(['completed', 'complete', 'fulfilled', 'forfeited', 'picked_up', 'pickedup']),
};

/** AUTHORITATIVE "has this record ever received a payment or deposit?" — based
 *  on financial HISTORY, not the current balance. A refunded-to-zero record
 *  still returns true (its payment log / accumulated-paid / history marker
 *  persists). */
export function hasPaymentHistory(type: CancellableType, record: CancellableRecord): boolean {
  const deposit = Number(record.depositAmount) || 0;
  const paymentsLen = Array.isArray(record.payments) ? record.payments.length : 0;
  switch (type) {
    case 'special_order':
      // Accumulated-paid deposit OR any logged payment.
      return deposit > 0 || paymentsLen > 0;
    case 'repair':
      // Accumulated-paid deposit OR the never-overwritten first-payment marker.
      return deposit > 0 || record.depositMeta != null;
    case 'unlock':
      // Unlocks have no history log; the accumulated-paid deposit is the source.
      return deposit > 0;
    case 'layaway':
      // Payment log OR legacy paidAmount OR a recorded deposit method.
      return paymentsLen > 0 || (Number(record.paidAmount) || 0) > 0 || !!(record.depositMethod && String(record.depositMethod).trim());
    default:
      return deposit > 0 || paymentsLen > 0;
  }
}

/** Eligibility for SIMPLE (PIN-protected, no-refund) cancellation. Order of
 *  checks: already cancelled → final/protected status → payment history →
 *  eligible. A record with payment history is NEVER simply cancellable even
 *  if its current balance is $0. */
export function getSimpleCancelEligibility(type: CancellableType, record: CancellableRecord): SimpleCancelEligibility {
  const s = norm(record.status);
  if (CANCELLED_STATUSES.has(s)) {
    return { eligible: false, kind: 'already_cancelled', reasonKey: CANCEL_BLOCK_REASON_KEYS.already_cancelled };
  }
  if (FINAL_STATUSES[type].has(s)) {
    return { eligible: false, kind: 'final_status', reasonKey: CANCEL_BLOCK_REASON_KEYS.final_status };
  }
  if (hasPaymentHistory(type, record)) {
    return { eligible: false, kind: 'payment_history', reasonKey: CANCEL_BLOCK_REASON_KEYS.payment_history };
  }
  return { eligible: true, kind: 'simple_cancel' };
}

/** Convenience: true only when a simple cancel is allowed. */
export function canSimplyCancel(type: CancellableType, record: CancellableRecord): boolean {
  return getSimpleCancelEligibility(type, record).eligible;
}

/** PURE plan for a simple (no-refund) cancellation. Rechecks eligibility, then
 *  returns the cancelled record + the cart with ONLY the linked line removed —
 *  it creates NO Sale, NO payment, NO store credit, and mutates nothing. The
 *  caller applies the returned values (setState + persist). Cart lines are
 *  removed by an EXACT source identifier (e.g. 'specialOrderId'), never by
 *  name / amount / index. */
export interface SimpleCancellationPlan<TRecord, TCartItem> {
  ok: true;
  updatedRecord: TRecord;
  nextCart: TCartItem[];
  removedCartCount: number;
}
export interface SimpleCancellationBlocked {
  ok: false;
  kind: 'already_cancelled' | 'final_status' | 'payment_history';
  reasonKey: string;
}

export function planSimpleCancellation<
  TRecord extends CancellableRecord & { id: string },
  TCartItem extends Record<string, unknown>,
>(params: {
  type: CancellableType;
  record: TRecord;
  cart: ReadonlyArray<TCartItem>;
  /** The cart-line field that stores this record's id (e.g. 'specialOrderId'). */
  cartLinkKey: string;
  now: string;
}): SimpleCancellationPlan<TRecord, TCartItem> | SimpleCancellationBlocked {
  const elig = getSimpleCancelEligibility(params.type, params.record);
  if (!elig.eligible) return { ok: false, kind: elig.kind, reasonKey: elig.reasonKey };

  const updatedRecord = {
    ...params.record,
    status: 'cancelled',
    cancelledAt: params.now,
    updatedAt: params.now,
  } as TRecord;

  const id = params.record.id;
  const nextCart = params.cart.filter((line) => line[params.cartLinkKey] !== id);
  return {
    ok: true,
    updatedRecord,
    nextCart,
    removedCartCount: params.cart.length - nextCart.length,
  };
}
