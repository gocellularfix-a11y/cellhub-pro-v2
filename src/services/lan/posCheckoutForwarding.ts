// ============================================================
// CellHub Pro — LAN POS checkout forwarding (R-LAN-POS-CHECKOUT-FORWARDING)
//
// Pure resolution layer for a forwarded checkout. Given a Secondary-built Sale,
// the operationId, and the PRIMARY's authoritative state, it:
//   1. enforces idempotency (a sale already finalized for this operationId →
//      duplicate, anti double-charge),
//   2. tags the sale with the operationId (double-cast; the Sale type has no
//      such field, so it persists as extra JSON — no src/store change),
//   3. resolves the customer from the PRIMARY's authoritative array (never the
//      Secondary's mirror),
//   4. runs the SAME finalizeSaleCore used by local POS — no second checkout
//      engine, no duplicated money/tax math.
//
// Pure + deterministic: NO setState, NO persist, NO electron, NO UI. The caller
// (LanOperationDispatcher on the Primary) applies the returned result headlessly.
// ============================================================

import type {
  Sale, InventoryItem, Customer, Repair, SpecialOrder, Unlock, Layaway,
  StoreCreditLedger, CustomerReturn, StoreSettings,
} from '@/store/types';
import { finalizeSaleCore, type FinalizeSaleCoreSuccess } from '@/modules/pos/finalizeSaleCore';

/** Tag field used for idempotency (stored as extra JSON on the persisted sale). */
export const LAN_CHECKOUT_OP_TAG = 'lanOperationId';

export interface PrimaryCheckoutState {
  sales: Sale[];
  inventory: InventoryItem[];
  customers: Customer[];
  repairs: Repair[];
  specialOrders: SpecialOrder[];
  unlocks: Unlock[];
  layaways: Layaway[];
  storeCreditLedger: StoreCreditLedger[];
  customerReturns: CustomerReturn[];
  settings: StoreSettings;
}

export type PosCheckoutResolution =
  // Already finalized for this operationId — return the existing saleId.
  | { ok: true; duplicate: true; saleId: string }
  // Apply this: the caller persists result.* and snapshots.
  | { ok: true; duplicate: false; saleId: string; taggedSale: Sale; result: FinalizeSaleCoreSuccess }
  // Rejected — the caller persists NOTHING and returns the error to the Secondary.
  | { ok: false; error: string };

function readTag(sale: Sale): string | undefined {
  const v = (sale as unknown as Record<string, unknown>)[LAN_CHECKOUT_OP_TAG];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Resolve a forwarded checkout against the Primary's authoritative state. Pure.
 */
export function resolvePosCheckout(
  sale: Sale | null | undefined,
  operationId: string,
  state: PrimaryCheckoutState,
): PosCheckoutResolution {
  if (!operationId) return { ok: false, error: 'bad_operation' };
  if (!sale || typeof sale !== 'object' || !Array.isArray((sale as Sale).items)) {
    return { ok: false, error: 'bad_payload' };
  }

  // Idempotency — dedup by BOTH sale.id AND the operationId tag. The
  // Secondary's sendPosCheckout() mints a fresh operationId per call, so a
  // re-forward of the SAME built Sale (PaymentModal double-fire, retry after a
  // lost ACK) arrives with a DIFFERENT operationId but the SAME sale.id. The
  // sale.id check is the authoritative guard against a double charge: a
  // committed sale.id is unique, so if the Primary already holds it we must NOT
  // append a second sale or re-apply any inventory/customer/repair/layaway/
  // store-credit/return mutation. Either match → duplicate, zero side effects.
  const existingById = sale.id ? state.sales.find((s) => s.id === sale.id) : undefined;
  if (existingById) return { ok: true, duplicate: true, saleId: existingById.id };
  const existingByOp = state.sales.find((s) => readTag(s) === operationId);
  if (existingByOp) return { ok: true, duplicate: true, saleId: existingByOp.id };

  // Tag for idempotency (extra JSON; Sale type has no field).
  const taggedSale = { ...sale, [LAN_CHECKOUT_OP_TAG]: operationId } as unknown as Sale;

  // Resolve the customer from the PRIMARY authoritative array (not the mirror).
  const selectedCustomer = sale.customerId
    ? (state.customers.find((c) => c.id === sale.customerId) ?? null)
    : null;

  const result = finalizeSaleCore({
    sale: taggedSale,
    sales: state.sales,
    inventory: state.inventory,
    customers: state.customers,
    repairs: state.repairs,
    specialOrders: state.specialOrders,
    unlocks: state.unlocks,
    layaways: state.layaways,
    storeCreditLedger: state.storeCreditLedger,
    customerReturns: state.customerReturns,
    settings: state.settings,
    selectedCustomer,
    currentEmployee: null,
  });

  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true, duplicate: false, saleId: taggedSale.id, taggedSale, result };
}

// ── R-LAN-POS-CHECKOUT-FORWARDING-FIX-2: forward outcome classification ──
// Reasons where the Primary DEFINITIVELY did not commit (a pre-send guard, a
// malformed payload, a never-mounted dispatcher, or a finalizeSaleCore pre-flight
// rejection). Safe to abandon the pending forward. Anything NOT in this set after
// an !ok ACK is INDETERMINATE — the Primary MAY have committed but the ACK was
// lost/timed out — so the pending forward MUST be kept and retried with the SAME
// sale.id + operationId (which the Primary then dedupes). Biased toward 'unknown'
// so an ambiguous transport error never permits a fresh sale.id that double-charges.
const DETERMINATE_NOT_COMMITTED = new Set<string>([
  // finalizeSaleCore pre-flight business rejections (no mutation applied)
  'tax_setup_required', 'repair_cancelled', 'repair_completed', 'layaway_cancelled', 'repair_overpayment',
  // never reached / never ran the finalize handler
  'bad_payload', 'bad_operation', 'not_paired', 'not_electron', 'not_primary', 'dispatch_unavailable',
]);

export type ForwardOutcome = 'committed' | 'rejected' | 'unknown';

/**
 * Classify a forwarded-checkout ACK. Pure.
 *   committed → the Primary finalized the sale (ack.ok).
 *   rejected  → the Primary definitively did NOT commit (safe to abandon/rebuild).
 *   unknown   → indeterminate transport/dispatch failure (KEEP pending; retry same id).
 */
export function classifyCheckoutAck(ack: LanOperationAck | null | undefined): ForwardOutcome {
  if (ack && ack.ok) return 'committed';
  const err = ack && typeof ack.error === 'string' ? ack.error : '';
  if (DETERMINATE_NOT_COMMITTED.has(err)) return 'rejected';
  return 'unknown';
}
