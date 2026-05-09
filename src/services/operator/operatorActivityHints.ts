// ============================================================
// CellHub Pro — Operator Activity Hints (R-OPERATOR-FLOATING-BUBBLE-AWARE-V1)
// Pure rules. No React, no DOM, no I/O. Safe to import from the bubble
// component, hooks, or tests.
//
// Strategy:
//   - Hints are SELECTED, not generated. Every hint references a fixed
//     i18n key plus deterministic numeric/string args. No random, no AI.
//   - Inputs are read-only snapshots of already-available global state
//     (AppState slices) plus optional bridge events for module-local
//     contexts. Any computation here is O(N) over already-loaded
//     collections — no fetches, no engine instantiation, no analyzer pass.
//   - The same `OperatorHint` shape is consumed by both global-state
//     derivation and bridge-event derivation, so the bubble's hint
//     pipeline doesn't care where a hint came from.
// ============================================================

import type {
  AppState,
  Customer,
  Layaway,
  Repair,
  Sale,
} from '@/store/types';
import { calculateLayawayTotals } from '@/services/layaway/payments';

// ── Public types ──────────────────────────────────────────

/** Lifecycle of the bubble's awareness. Drives visuals only. */
export type OperatorBubbleState =
  | 'sleeping'   // idle, no activity detected
  | 'watching'   // activity ping just arrived; debounce in flight
  | 'thinking'   // computing hint (reserved for >sync work; v1 is sync)
  | 'ready'      // hint available, pill displayed
  | 'alert';     // important issue (currently unused — reserved for v2)

/** Categorical kind for the hint. UI uses it for icon/color tinting. */
export type OperatorHintKind =
  | 'phone_services_customer'
  | 'pos_cart_with_customer'
  | 'sale_scanned'
  | 'layaway_open'
  | 'repair_open'
  | 'customer_history_opened';

/**
 * Minimal hint shape. The bubble component runs the i18n key + args
 * through its `t()` to produce the visible string.
 */
export interface OperatorHint {
  kind: OperatorHintKind;
  i18nKey: string;
  args: Array<string | number>;
  severity: 'info' | 'alert';
}

/**
 * Bridge event the bubble listens for on `window`:
 *   window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
 *     detail: { type: 'layaway.opened', payload: { layawayId } }
 *   }))
 *
 * Payload must be small + non-sensitive (IDs only — bubble looks up the
 * record from in-memory state). No phone numbers, no addresses.
 */
export const OPERATOR_ACTIVITY_EVENT = 'cellhub:operator-activity';

export interface OperatorActivityEventDetail {
  type:
    | 'layaway.opened'
    | 'repair.opened'
    | 'customer.history_opened'
    | string; // forward-compat
  payload?: {
    layawayId?: string;
    repairId?: string;
    customerId?: string;
  };
}

// ── Internal helpers ──────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function daysAgo(iso: unknown): number | null {
  if (!iso) return null;
  let ts: number;
  if (typeof iso === 'number') ts = iso;
  else if (typeof iso === 'string') {
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return null;
    ts = parsed;
  } else if (iso instanceof Date) {
    ts = iso.getTime();
  } else if (iso && typeof (iso as { toDate?: () => Date }).toDate === 'function') {
    try { ts = (iso as { toDate: () => Date }).toDate().getTime(); } catch { return null; }
  } else {
    return null;
  }
  const delta = Date.now() - ts;
  if (delta < 0) return 0;
  return Math.floor(delta / MS_PER_DAY);
}

function findCustomer(customers: Customer[] | null | undefined, id: string): Customer | null {
  if (!id || !Array.isArray(customers)) return null;
  return customers.find((c) => c && c.id === id) || null;
}

function findSaleByInvoice(sales: Sale[] | null | undefined, invoice: string): Sale | null {
  if (!invoice || !Array.isArray(sales)) return null;
  const wanted = invoice.toLowerCase();
  return sales.find((s) => (s.invoiceNumber || '').toLowerCase() === wanted) || null;
}

function latestSaleForCustomer(sales: Sale[] | null | undefined, customerId: string): Sale | null {
  if (!customerId || !Array.isArray(sales)) return null;
  let best: Sale | null = null;
  let bestTs = -Infinity;
  for (const s of sales) {
    if (!s || s.customerId !== customerId) continue;
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ts = (() => {
      const ca = s.createdAt;
      if (typeof ca === 'string') { const p = Date.parse(ca); return Number.isFinite(p) ? p : -Infinity; }
      if (typeof ca === 'number') return ca;
      if (ca instanceof Date) return ca.getTime();
      if (ca && typeof (ca as { toDate?: () => Date }).toDate === 'function') {
        try { return (ca as { toDate: () => Date }).toDate().getTime(); } catch { return -Infinity; }
      }
      return -Infinity;
    })();
    if (ts > bestTs) { best = s; bestTs = ts; }
  }
  return best;
}

function shortName(c: Customer | null): string {
  if (!c) return '';
  const fn = (c.firstName || '').trim();
  const ln = (c.lastName || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return (c.name || '').trim();
}

// ── Public API ────────────────────────────────────────────

/**
 * Snapshot of state slices the rules need. Keeping this narrow keeps
 * the rule set honest about what it actually depends on and makes the
 * memo dependency list in the consumer obvious.
 */
export interface OperatorActivityInputs {
  activeTab: string;
  cart: AppState['cart'];
  customers: AppState['customers'];
  sales: AppState['sales'];
  layaways: AppState['layaways'];
  repairs: AppState['repairs'];
  pendingPosCustomer: string;
  pendingPhonePaymentCustomerId: string;
  pendingBarcodeInvoice: string;
}

/**
 * Pick at most ONE hint based on the highest-priority active signal.
 * Priority (most specific first):
 *   1. Sale scan (BarcodeActionModal context)
 *   2. Phone-services customer flow (POS sub-flow)
 *   3. POS cart with customer attached
 * Returns null if no signal applies.
 */
export function computeHintFromGlobalState(
  inputs: OperatorActivityInputs,
): OperatorHint | null {
  // 1) Receipt barcode scanned → sale lookup.
  if (inputs.pendingBarcodeInvoice) {
    const sale = findSaleByInvoice(inputs.sales, inputs.pendingBarcodeInvoice);
    if (sale) {
      const totalDollars = ((sale.total || 0) / 100).toFixed(2);
      return {
        kind: 'sale_scanned',
        i18nKey: 'operator.hint.saleScanned',
        args: [sale.invoiceNumber || '', totalDollars],
        severity: 'info',
      };
    }
  }

  // 2) Phone-services customer.
  if (inputs.pendingPhonePaymentCustomerId) {
    const cust = findCustomer(inputs.customers, inputs.pendingPhonePaymentCustomerId);
    if (cust) {
      const lines = Array.isArray(cust.phones) && cust.phones.length > 0
        ? cust.phones.length
        : (cust.phone ? 1 : 0);
      return {
        kind: 'phone_services_customer',
        i18nKey: 'operator.hint.phoneServices',
        args: [shortName(cust), lines],
        severity: 'info',
      };
    }
  }

  // 3) POS cart with customer attached.
  if (Array.isArray(inputs.cart) && inputs.cart.length > 0 && inputs.pendingPosCustomer) {
    const cust = findCustomer(inputs.customers, inputs.pendingPosCustomer);
    if (cust) {
      const last = latestSaleForCustomer(inputs.sales, cust.id);
      const days = last ? daysAgo(last.createdAt) : null;
      if (days !== null) {
        return {
          kind: 'pos_cart_with_customer',
          i18nKey: 'operator.hint.posCustomerLastVisit',
          args: [shortName(cust), days],
          severity: 'info',
        };
      }
      return {
        kind: 'pos_cart_with_customer',
        i18nKey: 'operator.hint.posCustomerNew',
        args: [shortName(cust)],
        severity: 'info',
      };
    }
  }

  return null;
}

/**
 * Optional bridge for module-local activity (e.g. "layaway detail
 * modal opened"). Modules dispatch CustomEvent on `window` and the
 * bubble feeds the detail through here. V1 wires the contract end —
 * future rounds can dispatch from each module without touching the
 * bubble component.
 */
export function computeHintFromEvent(
  detail: OperatorActivityEventDetail | null | undefined,
  inputs: OperatorActivityInputs,
): OperatorHint | null {
  if (!detail || !detail.type) return null;
  const payload = detail.payload || {};

  if (detail.type === 'layaway.opened' && payload.layawayId) {
    const layaway: Layaway | undefined = (inputs.layaways || []).find((l) => l && l.id === payload.layawayId);
    if (!layaway) return null;
    const totals = calculateLayawayTotals(layaway);
    return {
      kind: 'layaway_open',
      i18nKey: 'operator.hint.layawayOpen',
      args: [
        ((totals.totalPaidCents || 0) / 100).toFixed(2),
        ((totals.remainingBalanceCents || 0) / 100).toFixed(2),
      ],
      severity: totals.remainingBalanceCents > 0 ? 'info' : 'info',
    };
  }

  if (detail.type === 'repair.opened' && payload.repairId) {
    const repair: Repair | undefined = (inputs.repairs || []).find((r) => r && r.id === payload.repairId);
    if (!repair) return null;
    return {
      kind: 'repair_open',
      i18nKey: 'operator.hint.repairOpen',
      args: [
        (repair as { ticketNumber?: string }).ticketNumber || repair.id.slice(-6).toUpperCase(),
        String(repair.status || ''),
      ],
      severity: 'info',
    };
  }

  if (detail.type === 'customer.history_opened' && payload.customerId) {
    const cust = findCustomer(inputs.customers, payload.customerId);
    if (!cust) return null;
    const last = latestSaleForCustomer(inputs.sales, cust.id);
    const days = last ? daysAgo(last.createdAt) : null;
    if (days !== null) {
      return {
        kind: 'customer_history_opened',
        i18nKey: 'operator.hint.customerLastVisit',
        args: [shortName(cust), days],
        severity: 'info',
      };
    }
    return {
      kind: 'customer_history_opened',
      i18nKey: 'operator.hint.customerNew',
      args: [shortName(cust)],
      severity: 'info',
    };
  }

  return null;
}
