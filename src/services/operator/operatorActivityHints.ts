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
  | 'phone_payment_customer_selected'
  | 'phone_payment_line_selected'
  | 'phone_payment_number_no_match'
  | 'phone_payment_customer_created'
  | 'phone_payment_customer_updated'
  | 'phone_payment_recorded'
  | 'phone_payment_number_linked'
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

// ── Active context (R-OPERATOR-ACTIVITY-CONTEXT-V1) ───────
// The bubble keeps a longer-lived "what is the cashier working on
// right now?" state that survives the hint's auto-dismiss timer.
// Hints are short-lived nudges; activeContext is the persistent
// reference the overlay reads when the user explicitly opens it.
export interface OperatorActiveContext {
  contextType: 'phone_payment' | 'customer' | 'sale' | 'layaway' | 'repair' | 'unknown_phone';
  customerId?: string;
  phone?: string;
  lineCount?: number;
  amountCents?: number;
  lastPaymentCents?: number;
  /** ms epoch — tells the bubble "I last touched this at T". */
  updatedAt: number;
}

// ── Operational insights (R-OPERATOR-AMBIENT-AWARENESS-V1) ──
// An insight is a short, deterministic observation about the current
// activeContext. Multiple insights can apply to the same context; the
// overlay renders them as a small list. Insights NEVER auto-display
// as ambient pills — they're only visible when the cashier opens the
// overlay, so they don't generate UI noise.
export type OperatorInsightTone = 'info' | 'positive' | 'warning';

export interface OperatorInsight {
  id: string;               // stable string for React keys
  i18nKey: string;
  args: Array<string | number>;
  tone: OperatorInsightTone;
}

// Tuning knobs. Conservative defaults — tunable in a future round.
const VIP_THRESHOLD_CENTS  = 50_000;  // $500 lifetime sales = VIP
const INACTIVE_DAYS        = 90;       // days since last sale = "inactive"
const REPEAT_SALES_COUNT   = 3;        // ≥3 non-voided sales = "repeat"
const MULTI_LINE_COUNT     = 3;        // ≥3 phones = "multi-line"
const NEAR_COMPLETE_FRAC   = 0.2;      // remaining ≤ 20% of total = near-complete

export interface OperatorActivityEventDetail {
  type:
    | 'layaway.opened'
    | 'repair.opened'
    | 'customer.history_opened'
    | 'phone.payment.customer_selected'
    | 'phone.payment.known_line_selected'
    | 'phone.payment.number_entered'
    // R-OPERATOR-ACTIVITY-OUTCOME-AWARE-V1 — outcome events fired AFTER
    // a successful save/persist. Consumed by computeHintFromEvent to
    // surface short next-step confirmations.
    | 'phone.payment.customer_created'
    | 'phone.payment.customer_updated'
    | 'phone.payment.payment_recorded'
    | 'phone.payment.number_linked_to_customer'
    | string; // forward-compat
  payload?: {
    // Generic IDs / values reused across event types. Always minimal —
    // no full customer record, no notes, no addresses, no emails.
    customerId?: string;
    layawayId?: string;
    repairId?: string;
    phone?: string;
    lineCount?: number;
    amountCents?: number;
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

function normalizeDigits(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/\D/g, '');
}

function lineCountFor(c: Customer | null): number {
  if (!c) return 0;
  const phones = (c as { phones?: string[] }).phones;
  if (Array.isArray(phones) && phones.length > 0) return phones.length;
  return c.phone ? 1 : 0;
}

function findCustomerByPhone(customers: Customer[] | null | undefined, phone: string): Customer | null {
  if (!phone || !Array.isArray(customers)) return null;
  const wanted = normalizeDigits(phone);
  if (wanted.length === 0) return null;
  for (const c of customers) {
    if (!c) continue;
    if (normalizeDigits(c.phone || '') === wanted) return c;
    const phones = (c as { phones?: string[] }).phones;
    if (Array.isArray(phones) && phones.some((p) => normalizeDigits(p) === wanted)) return c;
  }
  return null;
}

/**
 * Scan sales for the most recent phone_payment item matching `phone`.
 * Returns the line item's price (cents) or null. O(N) over sales — not
 * cheap on huge histories but bounded for typical retail volumes and
 * called only on a discrete activity event, never on every render.
 */
function lastPhonePaymentCentsForNumber(
  sales: Sale[] | null | undefined,
  phone: string,
): number | null {
  if (!Array.isArray(sales)) return null;
  const norm = normalizeDigits(phone);
  if (!norm) return null;
  let bestTs = -Infinity;
  let bestCents: number | null = null;
  for (const s of sales) {
    if (!s || s.status === 'voided' || s.status === 'refunded') continue;
    const items = (s as { items?: Array<{ category?: string; phoneNumber?: string; price?: number }> }).items;
    if (!Array.isArray(items)) continue;
    let ts = -Infinity;
    let priceCents: number | null = null;
    for (const it of items) {
      if (!it) continue;
      if (it.category !== 'phone_payment') continue;
      if (normalizeDigits(it.phoneNumber || '') !== norm) continue;
      if (typeof it.price === 'number') priceCents = it.price;
    }
    if (priceCents === null) continue;
    const ca = (s as { createdAt?: unknown }).createdAt;
    if (typeof ca === 'string') { const p = Date.parse(ca); if (Number.isFinite(p)) ts = p; }
    else if (typeof ca === 'number') ts = ca;
    else if (ca instanceof Date) ts = ca.getTime();
    else if (ca && typeof (ca as { toDate?: () => Date }).toDate === 'function') {
      try { ts = (ca as { toDate: () => Date }).toDate().getTime(); } catch { /* skip */ }
    }
    if (ts > bestTs) {
      bestTs = ts;
      bestCents = priceCents;
    }
  }
  return bestCents;
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

  // ── Phone-payment bridge events (R-OPERATOR-LIVE-BUBBLE-OVERLAY-V2 fix)
  // Modal-local state (PhonePaymentModal) is not in AppState, so the
  // module dispatches lightweight events when the cashier interacts
  // with customer / known-line / phone-number inputs. Payload is IDs +
  // phone digits + numeric values only — never names or notes.

  if (detail.type === 'phone.payment.customer_selected') {
    const cust = payload.customerId
      ? findCustomer(inputs.customers, payload.customerId)
      : (payload.phone ? findCustomerByPhone(inputs.customers, payload.phone) : null);
    if (!cust) return null;
    const lines = typeof payload.lineCount === 'number' && payload.lineCount > 0
      ? payload.lineCount
      : lineCountFor(cust);
    const lastCents = payload.phone
      ? lastPhonePaymentCentsForNumber(inputs.sales, payload.phone)
      : null;
    if (lastCents !== null && lastCents > 0) {
      return {
        kind: 'phone_payment_customer_selected',
        i18nKey: 'operator.hint.phonePaymentCustomerWithHistory',
        args: [shortName(cust), lines, (lastCents / 100).toFixed(2)],
        severity: 'info',
      };
    }
    return {
      kind: 'phone_payment_customer_selected',
      i18nKey: 'operator.hint.phonePaymentCustomerNoHistory',
      args: [shortName(cust), lines],
      severity: 'info',
    };
  }

  if (detail.type === 'phone.payment.known_line_selected' && payload.phone) {
    const lastCents = lastPhonePaymentCentsForNumber(inputs.sales, payload.phone);
    if (lastCents !== null && lastCents > 0) {
      return {
        kind: 'phone_payment_line_selected',
        i18nKey: 'operator.hint.phonePaymentLineSelectedWithHistory',
        args: [payload.phone, (lastCents / 100).toFixed(2)],
        severity: 'info',
      };
    }
    return {
      kind: 'phone_payment_line_selected',
      i18nKey: 'operator.hint.phonePaymentLineSelected',
      args: [payload.phone],
      severity: 'info',
    };
  }

  if (detail.type === 'phone.payment.number_entered' && payload.phone) {
    // Prefer explicit customerId, otherwise scan customers by normalized phone.
    const cust = payload.customerId
      ? findCustomer(inputs.customers, payload.customerId)
      : findCustomerByPhone(inputs.customers, payload.phone);
    if (cust) {
      const lastCents = lastPhonePaymentCentsForNumber(inputs.sales, payload.phone);
      if (lastCents !== null && lastCents > 0) {
        return {
          kind: 'phone_payment_customer_selected',
          i18nKey: 'operator.hint.phonePaymentCustomerWithHistory',
          args: [shortName(cust), lineCountFor(cust), (lastCents / 100).toFixed(2)],
          severity: 'info',
        };
      }
      return {
        kind: 'phone_payment_customer_selected',
        i18nKey: 'operator.hint.phonePaymentCustomerNoHistory',
        args: [shortName(cust), lineCountFor(cust)],
        severity: 'info',
      };
    }
    // No customer match — surface an ambient cue so the cashier knows
    // the system already checked. Sales-only history match is a
    // possibility too, but for V1 we keep this branch as the simple
    // "no record on file" cue.
    return {
      kind: 'phone_payment_number_no_match',
      i18nKey: 'operator.hint.phonePaymentNoHistory',
      args: [payload.phone],
      severity: 'info',
    };
  }

  // ── Phone-payment outcome events (R-OPERATOR-ACTIVITY-OUTCOME-AWARE-V1)
  // Fired by PhonePaymentModal after a successful save/persist. These
  // win priority over typing/no-history hints by virtue of arriving
  // later — the bubble's bridge listener clears any in-flight debounce
  // / dismiss timers before processing the new event.

  if (detail.type === 'phone.payment.customer_created' && payload.customerId) {
    const cust = findCustomer(inputs.customers, payload.customerId);
    if (!cust) return null;
    return {
      kind: 'phone_payment_customer_created',
      i18nKey: 'operator.hint.phonePaymentCustomerCreated',
      args: [shortName(cust)],
      severity: 'info',
    };
  }

  if (detail.type === 'phone.payment.customer_updated' && payload.customerId) {
    const cust = findCustomer(inputs.customers, payload.customerId);
    if (!cust) return null;
    return {
      kind: 'phone_payment_customer_updated',
      i18nKey: 'operator.hint.phonePaymentCustomerUpdated',
      args: [shortName(cust)],
      severity: 'info',
    };
  }

  if (detail.type === 'phone.payment.payment_recorded' && payload.phone) {
    return {
      kind: 'phone_payment_recorded',
      i18nKey: 'operator.hint.phonePaymentRecorded',
      args: [payload.phone],
      severity: 'info',
    };
  }

  if (detail.type === 'phone.payment.number_linked_to_customer' && payload.phone) {
    return {
      kind: 'phone_payment_number_linked',
      i18nKey: 'operator.hint.phonePaymentNumberLinked',
      args: [payload.phone],
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

// ── Active context derivation (R-OPERATOR-ACTIVITY-CONTEXT-V1) ──

/**
 * Translate a bridge event into a persistent context snapshot. Returns
 * null when the event doesn't carry enough signal to be context-worthy
 * (e.g. number_entered for a number with no customer match — caller
 * should keep any prior context instead of clobbering it with a
 * "watching unknown number" placeholder).
 */
export function computeOperatorContextFromEvent(
  detail: OperatorActivityEventDetail | null | undefined,
  inputs: OperatorActivityInputs,
): OperatorActiveContext | null {
  if (!detail || !detail.type) return null;
  const payload = detail.payload || {};
  const now = Date.now();

  // Customer-anchored phone-payment events.
  if (
    detail.type === 'phone.payment.customer_selected'
    || detail.type === 'phone.payment.customer_created'
    || detail.type === 'phone.payment.customer_updated'
  ) {
    if (!payload.customerId) return null;
    const cust = findCustomer(inputs.customers, payload.customerId);
    if (!cust) return null;
    const lines = typeof payload.lineCount === 'number' && payload.lineCount > 0
      ? payload.lineCount : lineCountFor(cust);
    const lastCents = payload.phone
      ? lastPhonePaymentCentsForNumber(inputs.sales, payload.phone) : null;
    return {
      contextType: 'phone_payment',
      customerId: cust.id,
      phone: payload.phone,
      lineCount: lines,
      lastPaymentCents: lastCents !== null && lastCents > 0 ? lastCents : undefined,
      updatedAt: now,
    };
  }

  if (detail.type === 'phone.payment.known_line_selected' && payload.phone) {
    const lastCents = lastPhonePaymentCentsForNumber(inputs.sales, payload.phone);
    return {
      contextType: 'phone_payment',
      customerId: payload.customerId,
      phone: payload.phone,
      amountCents: payload.amountCents,
      lastPaymentCents: lastCents !== null && lastCents > 0 ? lastCents : undefined,
      updatedAt: now,
    };
  }

  if (detail.type === 'phone.payment.number_entered' && payload.phone) {
    const cust = payload.customerId
      ? findCustomer(inputs.customers, payload.customerId)
      : findCustomerByPhone(inputs.customers, payload.phone);
    if (!cust) {
      // R-OPERATOR-AMBIENT-AWARENESS-V1 PART 2B: unknown phone now
      // creates an actionable context (was null before — bubble felt
      // dead after typing an unrecognised number). Insights surface
      // "first-time customer" + Create Customer quick action.
      return {
        contextType: 'unknown_phone',
        phone: payload.phone,
        updatedAt: now,
      };
    }
    const lastCents = lastPhonePaymentCentsForNumber(inputs.sales, payload.phone);
    return {
      contextType: 'phone_payment',
      customerId: cust.id,
      phone: payload.phone,
      lineCount: lineCountFor(cust),
      lastPaymentCents: lastCents !== null && lastCents > 0 ? lastCents : undefined,
      updatedAt: now,
    };
  }

  if (detail.type === 'phone.payment.payment_recorded' && payload.phone) {
    return {
      contextType: 'phone_payment',
      customerId: payload.customerId,
      phone: payload.phone,
      amountCents: payload.amountCents,
      updatedAt: now,
    };
  }

  // Module-local entity contexts dispatched from future emitters.
  if (detail.type === 'layaway.opened' && payload.layawayId) {
    return { contextType: 'layaway', updatedAt: now };
  }
  if (detail.type === 'repair.opened' && payload.repairId) {
    return { contextType: 'repair', updatedAt: now };
  }
  if (detail.type === 'customer.history_opened' && payload.customerId) {
    return { contextType: 'customer', customerId: payload.customerId, updatedAt: now };
  }

  return null;
}

/**
 * Derive context from already-loaded global state. Used to seed
 * context when the cashier arrives at a tab via barcode-scan etc.
 * Same priority chain as computeHintFromGlobalState — most specific
 * signal wins.
 */
export function computeOperatorContextFromGlobalState(
  inputs: OperatorActivityInputs,
): OperatorActiveContext | null {
  const now = Date.now();

  if (inputs.pendingBarcodeInvoice) {
    const sale = findSaleByInvoice(inputs.sales, inputs.pendingBarcodeInvoice);
    if (sale) {
      return {
        contextType: 'sale',
        customerId: sale.customerId,
        amountCents: sale.total || 0,
        updatedAt: now,
      };
    }
  }

  if (inputs.pendingPhonePaymentCustomerId) {
    const cust = findCustomer(inputs.customers, inputs.pendingPhonePaymentCustomerId);
    if (cust) {
      return {
        contextType: 'phone_payment',
        customerId: cust.id,
        phone: cust.phone,
        lineCount: lineCountFor(cust),
        updatedAt: now,
      };
    }
  }

  if (Array.isArray(inputs.cart) && inputs.cart.length > 0 && inputs.pendingPosCustomer) {
    const cust = findCustomer(inputs.customers, inputs.pendingPosCustomer);
    if (cust) {
      return {
        contextType: 'customer',
        customerId: cust.id,
        updatedAt: now,
      };
    }
  }

  return null;
}

// ── Insights (R-OPERATOR-AMBIENT-AWARENESS-V1) ────────────

function totalSpendCentsForCustomer(
  sales: Sale[] | null | undefined,
  customerId: string,
): number {
  if (!Array.isArray(sales) || !customerId) return 0;
  let total = 0;
  for (const s of sales) {
    if (!s || s.customerId !== customerId) continue;
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const t = typeof s.total === 'number' ? s.total : 0;
    if (t > 0) total += t;
  }
  return total;
}

function countActiveSalesForCustomer(
  sales: Sale[] | null | undefined,
  customerId: string,
): number {
  if (!Array.isArray(sales) || !customerId) return 0;
  let n = 0;
  for (const s of sales) {
    if (!s || s.customerId !== customerId) continue;
    if (s.status === 'voided' || s.status === 'refunded') continue;
    n += 1;
  }
  return n;
}

function findNearCompleteLayawayForCustomer(
  layaways: { customerId?: string; status?: string; totalPrice?: number; balance?: number }[] | null | undefined,
  customerId: string,
): { totalPrice: number; balance: number } | null {
  if (!Array.isArray(layaways) || !customerId) return null;
  for (const l of layaways) {
    if (!l) continue;
    if ((l as { customerId?: string }).customerId !== customerId) continue;
    const status = String((l as { status?: string }).status || '').toLowerCase();
    if (status !== 'active') continue;
    const total = (l.totalPrice || 0);
    const bal = (l.balance || 0);
    if (total > 0 && bal > 0 && bal / total <= NEAR_COMPLETE_FRAC) {
      return { totalPrice: total, balance: bal };
    }
  }
  return null;
}

/**
 * Compute the deterministic insight list for the current activeContext.
 * Returns up to ~3 short observations the overlay can render. The list
 * is intentionally small + curated — too many insights becomes noise.
 *
 * Pure function: O(N) over already-loaded slices, no I/O, no fetches,
 * no random, no AI text generation. Called only when the overlay opens
 * OR when the context object changes — never on every render.
 */
export function computeInsightsForContext(
  context: OperatorActiveContext | null,
  inputs: OperatorActivityInputs,
): OperatorInsight[] {
  if (!context) return [];
  const out: OperatorInsight[] = [];

  // Unknown phone — the entire awareness pivots to "new customer" prompts.
  if (context.contextType === 'unknown_phone') {
    out.push({
      id: 'first_time',
      i18nKey: 'operator.insight.firstTimeCustomer',
      args: [],
      tone: 'positive',
    });
    out.push({
      id: 'create_profile_prompt',
      i18nKey: 'operator.insight.createProfilePrompt',
      args: [],
      tone: 'info',
    });
    return out;
  }

  // Customer-anchored contexts get the full rule sweep.
  if (context.customerId) {
    const cust = findCustomer(inputs.customers, context.customerId);
    if (!cust) return out;

    // 1. VIP: lifetime non-voided spend ≥ threshold.
    const spend = totalSpendCentsForCustomer(inputs.sales, cust.id);
    if (spend >= VIP_THRESHOLD_CENTS) {
      out.push({
        id: 'vip',
        i18nKey: 'operator.insight.vipCustomer',
        args: [(spend / 100).toFixed(0)],
        tone: 'positive',
      });
    }

    // 2. Repeat vs Inactive — mutually exclusive on the time axis.
    const last = latestSaleForCustomer(inputs.sales, cust.id);
    const lastDays = last ? daysAgo(last.createdAt) : null;
    if (lastDays !== null && lastDays > INACTIVE_DAYS) {
      out.push({
        id: 'inactive',
        i18nKey: 'operator.insight.inactiveDays',
        args: [lastDays],
        tone: 'warning',
      });
    } else {
      const salesCount = countActiveSalesForCustomer(inputs.sales, cust.id);
      if (salesCount >= REPEAT_SALES_COUNT) {
        out.push({
          id: 'repeat',
          i18nKey: 'operator.insight.repeatBuyer',
          args: [salesCount],
          tone: 'positive',
        });
      }
    }

    // 3. Multi-line.
    const lines = lineCountFor(cust);
    if (lines >= MULTI_LINE_COUNT) {
      out.push({
        id: 'multi_line',
        i18nKey: 'operator.insight.multiLineCustomer',
        args: [lines],
        tone: 'info',
      });
    }

    // 4. Near-complete layaway — useful nudge in any context that
    //    knows the customer.
    const nearLay = findNearCompleteLayawayForCustomer(inputs.layaways, cust.id);
    if (nearLay) {
      out.push({
        id: 'near_complete_layaway',
        i18nKey: 'operator.insight.nearCompleteLayaway',
        args: [(nearLay.balance / 100).toFixed(2)],
        tone: 'info',
      });
    }
  }

  return out;
}
