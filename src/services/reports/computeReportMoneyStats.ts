// ============================================================
// CellHub Pro — Canonical Report Money Service
// (CELLHUB-INTELLIGENCE-I1 — extraction/characterization round)
//
// THE single source of truth for the Reports money pipeline. Every rule in
// this file was moved VERBATIM from src/modules/reports/ReportsModule.tsx
// (inclusion rules, void/refund/return treatment, tax buckets, fees, COGS,
// commission economics, category/provider/carrier totals, Z-tape recon).
// This round is an extraction, NOT a financial-policy change: the numbers
// this service produces are byte-identical to what the inline ReportsModule
// implementation produced before it.
//
// Core conventions (inherited from the Reports rewrite header):
//   - ALL money flows through this file in CENTS (integer).
//   - Conversion to dollars happens ONLY at display time (never here).
//   - Voided/refunded sales are filtered using the `status` enum.
//   - Tax/surcharges are NOT included in category revenue (pass-through).
//   - Profit margin is computed against subtotalBeforeTax (not gross).
//   - Standalone repairs use real parts/labor cost when available.
//
// This service is PURE: no React, no i18n (labels are injected), no UI
// formatting, no store writes, and it never mutates its input collections.
//
// Phase I-2 (separate round) will point Intelligence at this service. Do
// NOT add Intelligence-specific behavior here.
// ============================================================

import type {
  Sale, SaleItem, Repair, Unlock, SpecialOrder, Layaway, InventoryItem,
  CustomerReturn, StoreSettings,
} from '@/store/types';
import {
  classifyItem,
  lineRevenueCents,
  computePhonePaymentEconomics,
  aggregatePhoneActivity,
  reportCategoryOverride,
} from '@/services/reports/phonePaymentReporting';
import type { PhoneActivityAggregation } from '@/services/reports/phonePaymentReporting';
import { isWithinLocalDayRange } from '@/utils/reportRange';
import type { LocalDayRange } from '@/utils/reportRange';
import { getActivePortals } from '@/config/paymentPortals';

// ── Constants (moved verbatim from ReportsModule) ────────────

const REPAIR_COST_FALLBACK = 0.35;  // when parts/labor not tracked
const TOPUP_COST_RATE = 0.90;

// ── Date coercion (moved verbatim from ReportsModule) ────────

function isValidDate(d: Date): boolean {
  return !isNaN(d.getTime());
}

export function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isValidDate(v) ? v : null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return isValidDate(d) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return isValidDate(d) ? d : null;
  }
  return null;
}

// ── Inclusion rules (moved verbatim) ─────────────────────────

/** Sale counts as revenue iff status is not voided/refunded outright. */
export function isCountableSale(s: Sale): boolean {
  return s.status !== 'voided' && s.status !== 'refunded';
}

// ── CELLHUB-INTELLIGENCE-I1.1: canonical refund reconciliation ──
//
// Real refund representations found in the repository (all verified against
// the producing flows):
//   1. CustomerReturn records (ReturnsModule) — the AUTHORITATIVE money
//      record: totalCents/taxCents/subtotalCents + items, originalSaleId,
//      returnNumber, createdAt = the refund event date.
//   2. `REF-<returnNumber>` refund Sales (ReturnsModule Phase 4/R-STORE-
//      CREDIT-CERTIFICATE) — status='voided', isRefund:true, refundFor,
//      returnNumber. AUDIT/VISIBILITY ONLY; excluded by status everywhere.
//   3. Original sale marked status='refunded' (+refundedAt/refundReason) —
//      ReturnsModule Phase 8, cash/card resolutions.
//   4. Post-edit refund Sales (R-EDIT-AUDIT, Repair/Unlock/SO modules) —
//      invoice `REFUND-*`, status='completed', NEGATIVE total, NO
//      CustomerReturn record. The only countable refund-representation rows.
//   5. Entity-cancellation `REFUND-*` audit Sales — status='voided',
//      excluded by status (deposits tracked via cancellationsInPeriod).
//
// DEDUPLICATION PRECEDENCE (one business refund subtracts exactly once):
//   P1. CustomerReturn records win. Recognized in the period of the RETURN
//       date (r.createdAt) — this makes a same-period full refund net to 0
//       and a cross-period refund produce a legitimate negative period.
//   P2. A countable refund-audit sale (REFUND-*/isRefund/refundFor/
//       returnNumber marker + negative total) counts ONLY when no
//       CustomerReturn claims the same refund (matched by returnNumber,
//       then by refundFor ↔ return.originalInvoice). Recognized at its own
//       createdAt.
//   P3. A status='refunded' original with NO CustomerReturn (matched by
//       originalSaleId) and NO linked refund-audit sale is a LEGACY/manual
//       mark with no money record. Conservative deterministic fallback:
//       the original stays in gross activity and a SELF-REVERSAL adjustment
//       for its full amount is recognized in ITS OWN period → that period
//       nets to exactly 0 for the sale (never overstated, never negative).
//
// Stable identifiers only (returnNumber / originalSaleId / refundFor /
// invoice prefix) — never amount+date matching.

/** Countable refund-REPRESENTATION row (post-edit REFUND-* audit sales):
 *  negative total + an explicit refund marker. A negative-total sale with
 *  NO marker is NOT classified as a refund row (legacy pass-through: it
 *  stays in gross activity and subtracts once by its own sign). */
export function isRefundAuditSale(s: Sale): boolean {
  if ((s.total || 0) >= 0) return false;
  const inv = String(s.invoiceNumber || '');
  return (s as unknown as { isRefund?: boolean }).isRefund === true
    || /^REF(UND)?-/i.test(inv)
    || !!(s as unknown as { refundFor?: string }).refundFor
    || !!(s as unknown as { returnNumber?: string }).returnNumber;
}

/** Repair counts as completed revenue iff customer paid in full and picked up. */
export function isRepairCompleted(r: Repair): boolean {
  const status = String(r.status || '').toLowerCase();
  const completedStatuses = ['complete', 'completed', 'picked_up', 'pickedup'];
  return completedStatuses.includes(status) && (r.balance ?? 0) === 0;
}

export function isUnlockCompleted(u: Unlock): boolean {
  const status = String(u.status || '').toLowerCase();
  return status === 'completed' || status === 'complete';
}

/**
 * Round 10: case-insensitive category bucketing. Previously 'Products' and
 * 'products' would create separate rows and aggregation split across both,
 * masking the real totals (e.g. two -$25 refunds rolled to a single -$20 row).
 */
export function normalizeCategoryKey(raw: string): string {
  return String(raw || '').trim().toLowerCase() || 'products';
}

// ── Pseudo-items + proportional cost inheritance (moved verbatim) ──

/**
 * Round 10: pseudo-items (deposit/balance placeholders from linked entity flows)
 * inflate margin because they carry no cost. Excluded from margin numerator/
 * denominator but still counted for revenue & quantity display.
 */
const PSEUDO_ITEM_PREFIXES = [
  'layaway balance', 'layaway deposit',
  'repair balance', 'repair deposit',
  'so balance', 'so deposit',
  'unlock balance', 'unlock deposit',
];
// R-DASHBOARD-PROFIT-RECONCILE-V1: Dashboard.tsx reuses the SAME pseudo-item
// detection (single source of truth — no parallel accounting).
export function isPseudoItem(item: SaleItem): boolean {
  const n = String(item?.name || '').toLowerCase().trim();
  if (!n) return false;
  return PSEUDO_ITEM_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * Round 12: pseudo-item proportional cost inheritance.
 * Pseudo-items (Layaway/SO/Repair/Unlock Deposit|Balance) carry no direct cost
 * on the cart line, which previously forced them out of margin math entirely
 * (Round 10 fix 3). These helpers let a pseudo-item inherit a proportional
 * slice of the linked entity's real cost — only when reliable cost+price data
 * exists. Any missing field returns 0 → caller preserves Round 10 behavior.
 * Integer cents in / integer cents out; single final Math.round.
 */
export function getLayawayProportionalCost(entity: Layaway, inventory: InventoryItem[], paymentCents: number): number {
  if (!entity || !paymentCents) return 0;
  const denominator = entity.totalPrice || 0;
  if (denominator <= 0) return 0;
  let totalCostCents = 0;
  for (const li of (entity.items || [])) {
    if (!li.inventoryId) continue;
    const inv = inventory.find((i) => i.id === li.inventoryId);
    if (!inv) continue;
    totalCostCents += (inv.cost || 0) * (li.qty || 1);
  }
  if (totalCostCents <= 0) return 0;
  return Math.round(totalCostCents * (paymentCents / denominator));
}

export function getSpecialOrderProportionalCost(entity: SpecialOrder, _inventory: InventoryItem[], paymentCents: number): number {
  if (!entity || !paymentCents) return 0;
  const totalCostCents = entity.cost || 0;
  const denominator = entity.price || 0;
  if (totalCostCents <= 0 || denominator <= 0) return 0;
  return Math.round(totalCostCents * (paymentCents / denominator));
}

export function getRepairProportionalCost(entity: Repair, _inventory: InventoryItem[], paymentCents: number): number {
  if (!entity || !paymentCents) return 0;
  const partsCost = (entity.parts || []).reduce(
    (s, p) => s + (p.cost || 0) * (p.qty || (p as { quantity?: number }).quantity || 1),
    0,
  );
  // R-REPORTS-REPAIR-MARGIN-FIX-V1: labor is the shop's service margin, not COGS
  // (see the regular repair-item path for the full rationale). Only parts are a
  // real cost — keep the proportional pseudo-item path consistent.
  const totalCostCents = partsCost;
  const denominator = entity.total ?? entity.estimatedCost ?? 0;
  if (totalCostCents <= 0 || denominator <= 0) return 0;
  return Math.round(totalCostCents * (paymentCents / denominator));
}

export function getUnlockProportionalCost(entity: Unlock, _inventory: InventoryItem[], paymentCents: number): number {
  if (!entity || !paymentCents) return 0;
  const cost = entity.cost || 0;
  const denominator = entity.price || 0;
  if (cost <= 0 || denominator <= 0) return 0;
  return Math.round(cost * (paymentCents / denominator));
}

// ── Customer returns normalization (moved verbatim) ──────────

export interface NormalizedReturn {
  id: string;
  returnNumber: string;
  originalInvoice: string;
  originalSaleId: string | null;
  customerName: string;
  reason: string;
  resolution: string;
  createdAt: Date | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  // R-RETURNS-CREDIT-OWNER + STORE-CREDIT-CERTIFICATE
  employeeName?: string;
  certificateNumber?: string;
  recipientName?: string;
  recipientPhone?: string;
}

/** Live AppState returns → normalized cents rows (legacy dollar fallback). */
export function normalizeCustomerReturns(customerReturns: CustomerReturn[] | undefined | null): NormalizedReturn[] {
  const src = Array.isArray(customerReturns) ? customerReturns : [];
  return src.map((r) => ({
    id: r.id,
    returnNumber: r.returnNumber || '',
    originalInvoice: r.originalInvoice || '',
    originalSaleId: r.originalSaleId,
    customerName: r.customerName || '',
    reason: r.reason || '',
    resolution: r.resolution || '',
    createdAt: toDateSafe(r.createdAt),
    // Canonical cents fields always present on new records; fall back to
    // legacy dollar fields for old records created before Round 9 migration.
    subtotalCents: r.subtotalCents ?? Math.round((r.subtotal || 0) * 100),
    taxCents: r.taxCents ?? Math.round((r.taxRefunded || 0) * 100),
    totalCents: r.totalCents ?? Math.round((r.total || 0) * 100),
    // R-RETURNS-CREDIT-OWNER + STORE-CREDIT-CERTIFICATE (additive)
    employeeName: r.employeeName || '',
    certificateNumber: r.certificateNumber,
    recipientName: r.recipientName,
    recipientPhone: r.recipientPhone,
  }));
}

// ── Service contract ─────────────────────────────────────────

/** Injected display labels (the service has NO i18n dependency). */
export interface ReportMoneyLabels {
  noProvider: string;
  noCarrier: string;
  unknownEmployee: string;
}

export interface ReportMoneyStatsInput {
  sales: Sale[];
  repairs: Repair[];
  unlocks: Unlock[];
  specialOrders: SpecialOrder[];
  layaways: Layaway[];
  inventory: InventoryItem[];
  customerReturns: CustomerReturn[];
  /** Vendor returns reduce COGS; legacy records may carry dollars. */
  vendorReturns: unknown[];
  settings: StoreSettings;
  /** Canonical validated local-day range (normalizeLocalDayRange). */
  periodRange: LocalDayRange;
  labels: ReportMoneyLabels;
}

/** Derived period collections — the Reports inclusion rules. */
export interface ReportMoneyCollections {
  /** All sales in period (transactions table — includes voided/refunded for visibility). */
  allFilteredSales: Sale[];
  /** Countable sales — non-voided/non-refunded (legacy set; UI helpers). */
  filteredSales: Sale[];
  /** I1.1 GROSS ACTIVITY: non-voided sales EXCLUDING refund-audit rows but
   *  INCLUDING later-refunded originals — a legitimately completed sale
   *  stays in gross; its refund subtracts exactly once via adjustments. */
  grossActivitySales: Sale[];
  /** I1.1: countable refund-representation rows in period (post-edit
   *  REFUND-* sales). Fed to the adjustments engine, never to gross. */
  refundAuditSales: Sale[];
  filteredRepairs: Repair[];
  filteredUnlocks: Unlock[];
  filteredVendorReturns: unknown[];
  allReturns: NormalizedReturn[];
  /** Returns that happened during this period (net daily view). */
  returnsInPeriod: NormalizedReturn[];
  /** Returns whose original sale was in this period (gross→net adjustment view). */
  returnsFromPeriodSales: NormalizedReturn[];
  /** Standalone completed repairs not already counted in POS sales. */
  standaloneRepairs: Repair[];
  standaloneUnlocks: Unlock[];
}

export interface ReportCategoryRow {
  name: string;
  quantity: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
  marginPct: number | null;
}

export interface ReportMoneyStats {
  // ── I1.1 canonical relations ──
  //   netSalesCents        === grossSalesCents − returnAndRefundAdjustmentsCents
  //   netTaxCents          === grossTaxCollectedCents − taxRefundedCents
  //   totalProfitCents     === grossItemProfitCents + ccFeeProfitCents
  //                            − returnedProfitReversalCents
  //   (CellHub profit = Σ line (revenue − cost) over gross activity +
  //    standalone repairs/unlocks, + CC-fee pass-through profit, minus the
  //    exact/estimated profit of refunded goods. Taxes/CBE/screen fees are
  //    pass-through and never in profit; commission economics live inside
  //    the per-line cost. COGS side: totalCostCents already nets vendor
  //    returns and returned-goods cost reversal.)
  /** Gross sales: every legitimately completed period sale (INCLUDING later-
   *  refunded originals), excluding voided + refund-representation rows,
   *  plus standalone completed repairs/unlocks. */
  grossSalesCents: number;
  /** Deduplicated refund/return adjustments recognized in this period. */
  returnAndRefundAdjustmentsCents: number;
  netSalesCents: number;
  grossTaxCollectedCents: number;
  /** = ordinaryTaxRefundedCents + exchangeTaxRefundedCents (I1.3 split). */
  taxRefundedCents: number;
  /** Tax refunded by ordinary returns / refund rows / self-reversals. */
  ordinaryTaxRefundedCents: number;
  /** Tax embedded in tax-inclusive exchange credits (I1.3): reclassified
   *  from revenue to tax refund — never counted twice. */
  exchangeTaxRefundedCents: number;
  /** UNCLAMPED — a refund-only period is legitimately negative. */
  netTaxCents: number;
  /** Exact cost of returned goods reversed out of COGS (0 when unknown). */
  returnedCostReversalCents: number;
  /** Profit reversed for refunds (exact where derivable, else estimated). */
  returnedProfitReversalCents: number;
  /** True when ANY part of the profit reversal used the average-margin
   *  estimate instead of exact item costs. */
  profitAdjustmentEstimated: boolean;
  /** Σ line (revenue − cost) over gross activity + standalones (pre-reversal). */
  grossItemProfitCents: number;
  /** CC-fee pass-through profit included in totalProfitCents. */
  ccFeeProfitCents: number;
  // ── I1.2 exchange accounting (additive; gross presentation preserved —
  //    the credit already nets inside the replacement sale's total, matching
  //    the receipt/Z-tape records) ──
  /** Informational: Σ exchange-credit value recognized this period.
   *  I1.3 composition (proven): = exchangeCreditPreTaxCents
   *  + exchangeTaxRefundedCents + exchangeRefundedPassThroughCents. */
  exchangeCreditCents: number;
  /** Pre-tax merchandise portion of the exchange credits. */
  exchangeCreditPreTaxCents: number;
  /** Refundable pass-through (CBE/screen/utility/mobility) embedded in
   *  exchange credits — structurally 0: ReturnsModule never refunds fees
   *  (refund sales stamp them 0). Kept explicit for the invariant. */
  exchangeRefundedPassThroughCents: number;
  /** COGS of exchanged-away merchandise reversed out of this period
   *  (restocked goods are not a period cost; profit rises by the same). */
  exchangeReturnedCostReversalCents: number;
  // ── I1.2 net pre-tax margin basis ──
  //   netRevenueBeforeTaxCents === grossRevenueBeforeTaxCents
  //                                − returnRevenueBeforeTaxAdjustmentCents
  /** = subtotalBeforeTaxCents (gross pre-tax activity). */
  grossRevenueBeforeTaxCents: number;
  /** Pre-tax portion of the deduplicated refund adjustments. */
  returnRevenueBeforeTaxAdjustmentCents: number;
  netRevenueBeforeTaxCents: number;
  /** The margin denominator (= netRevenueBeforeTaxCents). */
  profitMarginBasisCents: number;
  /** False for zero/negative-revenue periods — margin is NOT meaningful and
   *  the compatibility profitMargin=0 must not be presented as a
   *  business conclusion. */
  profitMarginMeaningful: boolean;
  // ── Legacy aliases (same values as the canonical fields above) ──
  /** = grossSalesCents */
  grossRevenueCents: number;
  /** = netSalesCents */
  netRevenueCents: number;
  /** = returnAndRefundAdjustmentsCents */
  totalReturnsCents: number;
  totalProfitCents: number;
  totalCostCents: number;
  subtotalBeforeTaxCents: number;
  profitMargin: number;
  /** = netTaxCents (I1.1: no longer clamped at zero). */
  taxCollectedCents: number;
  productSalesTaxCents: number;
  utilityTaxCents: number;
  mobilitySurchargeCents: number;
  legacyTaxAmountCents: number;
  customerReturnTaxAdjustmentCents: number;
  cbeCollectedCents: number;
  screenFeeCents: number;
  recon: {
    grossCollectedCents: number;
    taxCollectedCents: number;
    feeCollectedCents: number;
    refundTaxAdjustmentCents: number;
    operationalRevenueCents: number;
    netRevenueCents: number;
    totalReturnsCents: number;
  };
  cashCents: number;
  cardCents: number;
  storeCreditCents: number;
  txCount: number;
  // I2B-0.1: standalone completed repairs/unlocks counted into GROSS revenue
  // (not represented in any POS sale). Pure count exposure of the existing
  // standalone populations — lets consumers form a financial-transaction
  // denominator consistent with grossSalesCents.
  standaloneRepairCount: number;
  standaloneUnlockCount: number;
  cleanSalesCount: number;
  refundSalesCount: number;
  voidedCount: number;
  refundedCount: number;
  repairCount: number;
  completedRepairCount: number;
  unlockCount: number;
  // ── Dimensional tables: GROSS ACTIVITY (I1.2 documented) ──
  // Categories / top items / employees / providers / carriers aggregate the
  // gross-activity population (incl. later-refunded originals). Returns are
  // NOT allocated per dimension — these tables are gross, never "net", and
  // no consumer may label them otherwise. Per-dimension net allocation is a
  // dedicated later phase.
  categoriesByRevenue: ReportCategoryRow[];
  topItems: Array<{ name: string; quantity: number; revenueCents: number }>;
  topEmployees: Array<{ name: string; transactions: number; revenueCents: number }>;
  phonePaymentsByProvider: PhoneActivityAggregation['phonePaymentsByProvider'];
  activationsByCarrier: PhoneActivityAggregation['activationsByCarrier'];
  // CELLHUB-INTELLIGENCE-I2B-0: PURE EXPOSURE of the existing internal
  // per-sale economics stash (saleEconomics) — zero new math, zero policy
  // change. itemProfit excludes the top-level CC-fee (exposed separately)
  // exactly as the internal stash records it. Consumers: invoice-level
  // customer economics (Customer 360).
  // I2B-0.1 hardening: costCents comes from a direct per-line accumulator
  // (lineCostCents) — NOT from the byId map — so legacy items without
  // item.id and duplicate-ID lines each contribute exactly once. `lines`
  // is the ordered per-line record (same-name lines stay distinct).
  perSaleEconomics: Record<string, {
    itemProfitCents: number;
    ccFeeProfitCents: number;
    costCents: number;
    taxCents: number;
    lines: Array<{ id?: string; name: string; costCents: number; qty: number; revenueCents: number; profitCents: number }>;
  }>;
}

// ── Derivation (inclusion rules — moved verbatim) ────────────

export function deriveReportCollections(input: ReportMoneyStatsInput): ReportMoneyCollections {
  const { periodRange } = input;
  const safeSales: Sale[] = Array.isArray(input.sales) ? input.sales : [];
  const safeRepairs: Repair[] = Array.isArray(input.repairs) ? input.repairs : [];
  const safeUnlocks: Unlock[] = Array.isArray(input.unlocks) ? input.unlocks : [];
  const safeVendorReturns = Array.isArray(input.vendorReturns) ? input.vendorReturns : [];

  const inRange = (createdAt: unknown): boolean =>
    isWithinLocalDayRange(toDateSafe(createdAt), periodRange);

  /** All sales in period (used by transactions table — includes voided/refunded for visibility). */
  const allFilteredSales = safeSales
    .filter((s) => inRange(s.createdAt))
    .sort((a, b) => {
      const da = toDateSafe(a.createdAt)?.getTime() || 0;
      const db = toDateSafe(b.createdAt)?.getTime() || 0;
      return db - da;
    });

  /** Countable sales — non-voided/non-refunded (legacy set; UI helpers). */
  const filteredSales = allFilteredSales.filter(isCountableSale);

  // I1.1: gross activity = non-voided, refund-audit rows carved out,
  // refunded originals kept (their refund subtracts once via adjustments).
  const grossActivitySales = allFilteredSales.filter(
    (s) => s.status !== 'voided' && !isRefundAuditSale(s),
  );
  const refundAuditSales = allFilteredSales.filter(
    (s) => s.status !== 'voided' && s.status !== 'refunded' && isRefundAuditSale(s),
  );

  const filteredRepairs = safeRepairs.filter((r) => inRange(r.createdAt));
  const filteredUnlocks = safeUnlocks.filter((u) => inRange(u.createdAt));
  const filteredVendorReturns = safeVendorReturns.filter((v) => inRange((v as { createdAt?: unknown }).createdAt));

  const allReturns = normalizeCustomerReturns(input.customerReturns);

  /** Returns that happened during this period (net daily view). */
  const returnsInPeriod = allReturns.filter(
    (r) => r.createdAt && r.createdAt >= periodRange.start && r.createdAt <= periodRange.end,
  );

  /** Returns whose original sale was in this period (gross→net adjustment view). */
  // Round 10.2: match returns against ALL sales in period, not just countable.
  // After R11 migration, original sales are marked refunded and get filtered
  // out of filteredSales, but their returns still belong to this period.
  const periodSaleIds = new Set(allFilteredSales.map((s) => s.id));
  const returnsFromPeriodSales = allReturns.filter(
    (r) => r.originalSaleId && periodSaleIds.has(r.originalSaleId),
  );

  // ── Repair-in-sale tracking (prevents double counting) ────
  // I1.1: tracking spans EVERY non-voided sale representation (gross
  // activity incl. refunded originals + refund-audit rows) — a repair or
  // unlock represented in ANY POS row is never also counted standalone.
  const trackingSales = grossActivitySales.concat(refundAuditSales);
  /** IDs and ticket numbers of repairs that were paid through POS in this period. */
  const repairsAlreadyInSales = new Set<string>();
  for (const sale of trackingSales) {
    for (const item of (sale.items || [])) {
      if (item.repairId) repairsAlreadyInSales.add(item.repairId);
      const ticket = (item as unknown as { ticketNumber?: string; meta?: { repairId?: string; ticketNumber?: string } }).ticketNumber
        || (item as unknown as { meta?: { ticketNumber?: string } }).meta?.ticketNumber;
      if (ticket) repairsAlreadyInSales.add(ticket);
      const metaRepairId = (item as unknown as { meta?: { repairId?: string } }).meta?.repairId;
      if (metaRepairId) repairsAlreadyInSales.add(metaRepairId);
    }
  }

  /** Standalone completed repairs not already counted in POS sales. */
  const standaloneRepairs = filteredRepairs.filter(
    (r) => isRepairCompleted(r) && !repairsAlreadyInSales.has(r.id),
  );

  // ── Unlock-in-sale tracking ───────────────────────────────
  const unlocksAlreadyInSales = new Set<string>();
  for (const sale of trackingSales) {
    for (const item of (sale.items || [])) {
      if (item.unlockId) unlocksAlreadyInSales.add(item.unlockId);
      const metaUnlockId = (item as unknown as { meta?: { unlockId?: string } }).meta?.unlockId;
      if (metaUnlockId) unlocksAlreadyInSales.add(metaUnlockId);
    }
  }

  const standaloneUnlocks = filteredUnlocks.filter(
    (u) => isUnlockCompleted(u) && !unlocksAlreadyInSales.has(u.id),
  );

  return {
    allFilteredSales,
    filteredSales,
    grossActivitySales,
    refundAuditSales,
    filteredRepairs,
    filteredUnlocks,
    filteredVendorReturns,
    allReturns,
    returnsInPeriod,
    returnsFromPeriodSales,
    standaloneRepairs,
    standaloneUnlocks,
  };
}

// ── Core stats (single loop, all cents — moved verbatim) ─────

export function computeReportMoneyStatsFromCollections(
  input: ReportMoneyStatsInput,
  c: ReportMoneyCollections,
): ReportMoneyStats {
  const { settings, inventory, labels } = input;
  const safeRepairs: Repair[] = Array.isArray(input.repairs) ? input.repairs : [];
  const safeUnlocks: Unlock[] = Array.isArray(input.unlocks) ? input.unlocks : [];
  const safeSpecialOrders: SpecialOrder[] = Array.isArray(input.specialOrders) ? input.specialOrders : [];
  const safeLayaways: Layaway[] = Array.isArray(input.layaways) ? input.layaways : [];
  const {
    allFilteredSales, filteredSales, grossActivitySales, refundAuditSales,
    filteredRepairs, filteredUnlocks,
    filteredVendorReturns, allReturns, returnsInPeriod, standaloneRepairs, standaloneUnlocks,
  } = c;
  // Silence legacy destructure (kept for interface stability).
  void filteredSales;

  let salesSubtotalCents = 0;
  let salesDiscountCents = 0;
  // R-FINANCIAL-BUCKET-PURITY-FIX P1: the previous `salesTaxCents`
  // accumulator was conflating salesTax + utilityTax + mobileSurcharge
  // (and on the legacy-fallback path, taxAmount). It's replaced with
  // four PURE buckets that match the Sale interface 1:1. The exposed
  // `taxCollectedCents` aggregate (computed below the loop) preserves
  // the prior display value as an explicit sum of these buckets.
  let productSalesTaxCents = 0;
  let utilityTaxCents = 0;
  let mobilitySurchargeCents = 0;
  let legacyTaxAmountCents = 0;
  let salesCbeCents = 0;
  let salesScreenFeeCents = 0;
  let totalCostCents = 0;
  let totalProfitCents = 0;
  // I1.1: CC-fee pass-through profit tracked separately so the documented
  // profit invariant (grossItemProfit + ccFeeProfit − reversal) is checkable.
  let ccFeeProfitCents = 0;
  let cashCents = 0;
  let cardCents = 0;
  let storeCreditCents = 0;

  // Round 10 fix 4: key is lowercase for case-insensitive bucketing; displayName
  // preserves the first spelling seen (Title-cased standard names always win
  // because we pass canonical literals like 'Products'/'Services'/'Repairs').
  const categoryStats: Record<string, {
    displayName: string;
    quantity: number;
    revenueCents: number;
    costCents: number;
    profitCents: number;
    pseudoRevenueCents: number;  // Round 10 fix 3: revenue from pseudo-items (excluded from margin calc)
    hasRealCostItem: boolean;    // true if any non-pseudo item contributed
  }> = {};
  const employeeStats: Record<string, { transactions: number; revenueCents: number }> = {};
  const itemStats: Record<string, { quantity: number; revenueCents: number }> = {};
  // R-REPORTS-PHONE-PROVIDER / R-ACTIVATIONS-BY-CARRIER-V1 →
  // R-2.1.4-REPORTS-ACTIVATION-CLASSIFICATION-V1: both buckets come from the
  // pure aggregation service (single source shared with tests). Bill payments
  // land ONLY under Phone Payments by Provider, genuine activations ONLY
  // under Activations by Carrier.
  const activePortals = getActivePortals(settings);
  const carrierPortalUrls = (settings as { carrierPortalUrls?: Record<string, string> }).carrierPortalUrls || {};
  // I1.1: providers/carriers aggregate over GROSS ACTIVITY so they reconcile
  // with the category table (both include later-refunded originals).
  const { phonePaymentsByProvider, activationsByCarrier } = aggregatePhoneActivity(
    grossActivitySales,
    settings,
    activePortals,
    carrierPortalUrls,
    { noProvider: labels.noProvider, noCarrier: labels.noCarrier },
  );

  const ensureCat = (name: string) => {
    const key = normalizeCategoryKey(name);
    if (!categoryStats[key]) {
      categoryStats[key] = {
        displayName: name || 'Products',
        quantity: 0, revenueCents: 0, costCents: 0, profitCents: 0,
        pseudoRevenueCents: 0, hasRealCostItem: false,
      };
    }
    return categoryStats[key];
  };

  // R-PERF-REPORTS-MAP-LOOKUP: O(1) Map.get() lookups (behavior identical to
  // the Array.find() they replaced).
  const repairsById = new Map(safeRepairs.map((r) => [r.id, r]));
  const unlocksById = new Map(safeUnlocks.map((u) => [u.id, u]));
  const layawaysById = new Map(safeLayaways.map((l) => [l.id, l]));
  const ordersById = new Map(safeSpecialOrders.map((o) => [o.id, o]));

  // I1.1: exact per-sale/per-item economics stash — powers exact (never
  // estimated) reversal for orphan refunded originals and for returned
  // items matched back to their original sale line.
  interface LineEconomics { costCents: number; qty: number; revenueCents: number; profitCents: number }
  interface SaleEconomics {
    taxCents: number;                       // pure buckets (or legacy aggregate)
    byId: Map<string, LineEconomics>;       // item.id → LOOKUP/refund matching only
    byName: Map<string, LineEconomics>;     // fallback match (first line wins)
    profitCents: number;                    // Σ line profits (excl. cc fee)
    ccFeeCents?: number;                    // I2B-0: top-level cc fee (exposure only)
    // I2B-0.1: direct accumulators — every processed line contributes exactly
    // once (no-ID and duplicate-ID lines included). Exposure-only; the P3
    // self-reversal keeps reading byId (financial policy untouched).
    lineCostCents: number;
    lines: Array<{ id?: string; name: string } & LineEconomics>;
  }
  const saleEconomics = new Map<string, SaleEconomics>();

  for (const sale of grossActivitySales) {
    const saleSubtotal = sale.subtotal || 0;
    const saleSubAfterDisc = sale.subtotalAfterDiscount ?? saleSubtotal;
    salesSubtotalCents += saleSubtotal;
    // Discount derived from subtotal - subtotalAfterDiscount (Sale type has no
    // standalone discountAmount field — it's implicit in the difference).
    salesDiscountCents += Math.max(0, saleSubtotal - saleSubAfterDisc);
    // v2 writes salesTax + utilityTax + mobileSurcharge separately;
    // legacy v1 data uses the aggregate taxAmount field. Read both.
    // R-FINANCIAL-BUCKET-PURITY-FIX P1: each tax bucket lands in its own
    // accumulator — productSalesTax is CA SALES TAX ONLY. Negative-total
    // refund-audit sales (status='completed', total<0) flow through this
    // same loop and naturally subtract from the matching bucket because
    // their own salesTax / utilityTax / mobileSurcharge fields are negative.
    productSalesTaxCents += (sale as unknown as { salesTax?: number }).salesTax || 0;
    utilityTaxCents += (sale as unknown as { utilityTax?: number }).utilityTax || 0;
    mobilitySurchargeCents += (sale as unknown as { mobileSurcharge?: number }).mobileSurcharge || 0;
    // Legacy fallback: only when ALL three v2 fields are zero on this
    // sale, route the legacy aggregate to its OWN bucket. Never mix into
    // productSalesTaxCents.
    const v2TaxSum = ((sale as unknown as { salesTax?: number }).salesTax || 0)
      + ((sale as unknown as { utilityTax?: number }).utilityTax || 0)
      + ((sale as unknown as { mobileSurcharge?: number }).mobileSurcharge || 0);
    if (v2TaxSum === 0 && (sale.taxAmount || 0) !== 0) {
      legacyTaxAmountCents += sale.taxAmount || 0;
    }
    salesCbeCents += sale.cbeTotal || 0;
    salesScreenFeeCents += sale.screenFeeTotal || 0;

    // I1.1 stash: this sale's own tax (same v2/legacy rule as the buckets).
    const econ: SaleEconomics = {
      taxCents: v2TaxSum !== 0 ? v2TaxSum : (sale.taxAmount || 0),
      byId: new Map(),
      byName: new Map(),
      profitCents: 0,
      lineCostCents: 0,
      lines: [],
    };
    saleEconomics.set(sale.id, econ);

    const pm = String(sale.paymentMethod || '').toLowerCase();
    const saleTotal = sale.total || 0;
    if (pm === 'cash') cashCents += saleTotal;
    else if (pm === 'card') cardCents += saleTotal;
    else if (pm === 'split') {
      const sp = sale.splitPayment;
      cashCents += sp?.cash ?? 0;
      cardCents += sp?.card ?? 0;
      storeCreditCents += sp?.storeCredit ?? 0;
    } else if (pm === 'store_credit' || pm === 'storecredit' || pm === 'store credit') {
      storeCreditCents += saleTotal;
    }

    const emp = sale.employeeName || labels.unknownEmployee;
    if (!employeeStats[emp]) employeeStats[emp] = { transactions: 0, revenueCents: 0 };
    employeeStats[emp].transactions++;
    employeeStats[emp].revenueCents += saleTotal;

    for (const item of (sale.items || [])) {
      // R-SPECIAL-ORDERS-TAX-SEPARATED-REPORTING-FIX: `let` so the SO branch
      // below can reverse-tax a tax-inclusive cart line into base for revenue
      // reporting. No other branch reassigns this.
      let revenueCents = lineRevenueCents(item);
      const qty = item.qty || (item as unknown as { quantity?: number }).quantity || 1;

      // R-SPECIAL-ORDERS-REPORT-PROFIT-FIX: hoisted classification + SO
      // override above the Top Selling Items aggregation. For SO-linked sale
      // items the linked SpecialOrder record's `price` and `cost` are the
      // source of truth; tax excess between the cart line and the SO's locked
      // price is routed to the productSalesTax bucket.
      const kind = classifyItem(item);
      let soOverrideCostCents: number | null = null;
      if (kind === 'special_order' && item.specialOrderId) {
        const linkedSO = ordersById.get(item.specialOrderId);
        if (linkedSO && (linkedSO.price || 0) > 0) {
          const soPrice = linkedSO.price;
          const soCost = linkedSO.cost || 0;
          // Any excess above SO.price on this line is tax embedded in
          // the cart line — extract it to the canonical bucket.
          if (revenueCents > soPrice) {
            productSalesTaxCents += (revenueCents - soPrice);
          }
          revenueCents = soPrice;
          soOverrideCostCents = soCost;
        }
      }

      if (!itemStats[item.name]) itemStats[item.name] = { quantity: 0, revenueCents: 0 };
      itemStats[item.name].quantity += qty;
      itemStats[item.name].revenueCents += revenueCents;

      let catName = 'Other';
      let costCents = 0;
      let profitCents = 0;

      if (kind === 'phone_payment') {
        catName = 'Phone Payments';
        // Commission/cost/profit math shared verbatim with the provider/
        // carrier aggregation (computePhonePaymentEconomics) so category
        // totals and provider buckets can never drift apart.
        const eco = computePhonePaymentEconomics(item, settings);
        costCents = eco.costCents;
        profitCents = eco.profitCents;
      } else if (kind === 'topup') {
        catName = 'Top-Ups';
        costCents = Math.round(revenueCents * TOPUP_COST_RATE);
        profitCents = revenueCents - costCents;
      } else if (kind === 'repair') {
        catName = 'Repairs';
        if (item.repairId) {
          const linkedRepair = repairsById.get(item.repairId);
          if (linkedRepair) {
            // R-REPORTS-REPAIR-MARGIN-FIX-V1: repair labor is the shop's own
            // SERVICE MARGIN, not cost of goods. Only PARTS are a real cost.
            const partsCost = (linkedRepair.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || (p as { quantity?: number }).quantity || 1), 0);
            costCents = partsCost;
            profitCents = revenueCents - costCents;
          } else {
            costCents = Math.round(revenueCents * REPAIR_COST_FALLBACK);
            profitCents = revenueCents - costCents;
          }
        } else {
          costCents = Math.round(revenueCents * REPAIR_COST_FALLBACK);
          profitCents = revenueCents - costCents;
        }
      } else if (kind === 'unlock') {
        catName = 'Unlocks';
        if (item.unlockId) {
          const linked = unlocksById.get(item.unlockId);
          costCents = linked?.cost || 0;
        }
        profitCents = revenueCents - costCents;
      } else if (kind === 'special_order') {
        catName = 'Special Orders';
        // Revenue already overridden to linkedSO.price by the hoisted block
        // above. Cost comes from the linked SO's locked `cost` field; falls
        // back to the cart line's stamped cost only when no SO record exists.
        costCents = soOverrideCostCents !== null
          ? soOverrideCostCents
          : (item.cost || 0) * qty;
        profitCents = revenueCents - costCents;
      } else if (kind === 'cc_fee') {
        catName = 'CC Fees';
        costCents = 0;
        profitCents = revenueCents;
      } else if (kind === 'service') {
        catName = 'Services';
        costCents = (item.cost || 0) * qty;
        profitCents = revenueCents - costCents;
      } else if (kind === 'exchange_credit') {
        catName = 'Returns';
        costCents = 0;
        profitCents = revenueCents;
      } else {
        catName = item.category || 'Products';
        // I1.1 zero-vs-missing cost policy: an explicit numeric cost of 0
        // means ZERO COST (POS always stamps the cart line's cost —
        // saleBuilder.ts `cost: item.cost` — so 0 is a real value, e.g. an
        // intentional giveaway). The inventory-name fallback fires ONLY when
        // the field is genuinely MISSING (undefined/null on legacy records).
        // Nullish check, never truthiness: 0 is never replaced.
        let unitCost: number;
        if (typeof item.cost === 'number' && !Number.isNaN(item.cost)) {
          unitCost = item.cost;
        } else {
          unitCost = 0;
          if (item.name) {
            const inv = inventory.find((i) => i.name?.toLowerCase() === item.name.toLowerCase());
            if (inv) unitCost = inv.cost || 0;
          }
        }
        costCents = unitCost * qty;
        profitCents = revenueCents - costCents;
      }

      // R-LAYAWAY-PROFIT-PROPORTIONAL-FIX: layaway-linked items represent
      // fractional payments toward a larger inventory item. Use the linked
      // layaway's parts cost scaled by payment/totalPrice. Only override
      // when proportional > 0 (otherwise existing math stands).
      if (item.layawayId && !isPseudoItem(item)) {
        const linked = layawaysById.get(item.layawayId);
        if (linked) {
          const proportional = getLayawayProportionalCost(linked, inventory, revenueCents);
          if (proportional > 0) {
            costCents = proportional;
            profitCents = revenueCents - proportional;
          }
        }
      }

      // R-2.1.4-CLOSEOUT: activation-flow lines (plan with isActivation,
      // fee 'activation', SIM 'sim') consolidate under 'Activations'.
      // Cost/profit math above is untouched; only the display bucket changes.
      const activationCat = reportCategoryOverride(item);
      if (activationCat) catName = activationCat;
      // R-REPORTS-LAYAWAY-CATEGORY-FIX: layaway-linked items always bucket
      // under 'Layaway' regardless of surface kind/category.
      if (item.layawayId) catName = 'Layaway';
      const cat = ensureCat(catName);
      cat.quantity += qty;
      cat.revenueCents += revenueCents;
      // Round 10 fix 3 + Round 12: pseudo-items contribute to revenue/qty
      // display but must NOT distort margin; with a reliable entity link they
      // inherit a proportional cost slice, else revenue-only.
      if (isPseudoItem(item)) {
        let realCost = 0;
        if (item.layawayId) {
          const linked = layawaysById.get(item.layawayId);
          if (linked) realCost = getLayawayProportionalCost(linked, inventory, revenueCents);
        } else if (item.specialOrderId) {
          const linked = ordersById.get(item.specialOrderId);
          if (linked) realCost = getSpecialOrderProportionalCost(linked, inventory, revenueCents);
        } else if (item.repairId) {
          const linked = repairsById.get(item.repairId);
          if (linked) realCost = getRepairProportionalCost(linked, inventory, revenueCents);
        } else if (item.unlockId) {
          const linked = unlocksById.get(item.unlockId);
          if (linked) realCost = getUnlockProportionalCost(linked, inventory, revenueCents);
        }
        if (realCost > 0) {
          const realProfit = revenueCents - realCost;
          cat.costCents += realCost;
          cat.profitCents += realProfit;
          cat.hasRealCostItem = true;
          totalCostCents += realCost;
          totalProfitCents += realProfit;
          econ.profitCents += realProfit;
          const line = { costCents: realCost, qty, revenueCents, profitCents: realProfit };
          if (item.id) econ.byId.set(item.id, line);
          const nameKey = String(item.name || '').toLowerCase();
          if (nameKey && !econ.byName.has(nameKey)) econ.byName.set(nameKey, line);
          econ.lineCostCents += line.costCents;
          econ.lines.push({ id: item.id, name: String(item.name || ''), ...line });
        } else {
          cat.pseudoRevenueCents += revenueCents;
          const line = { costCents: 0, qty, revenueCents, profitCents: 0 };
          if (item.id) econ.byId.set(item.id, line);
          const nameKey = String(item.name || '').toLowerCase();
          if (nameKey && !econ.byName.has(nameKey)) econ.byName.set(nameKey, line);
          econ.lines.push({ id: item.id, name: String(item.name || ''), ...line });
        }
      } else {
        cat.costCents += costCents;
        cat.profitCents += profitCents;
        cat.hasRealCostItem = true;
        totalCostCents += costCents;
        totalProfitCents += profitCents;
        econ.profitCents += profitCents;
        const line = { costCents, qty, revenueCents, profitCents };
        if (item.id) econ.byId.set(item.id, line);
        const nameKey = String(item.name || '').toLowerCase();
        if (nameKey && !econ.byName.has(nameKey)) econ.byName.set(nameKey, line);
        econ.lineCostCents += line.costCents;
        econ.lines.push({ id: item.id, name: String(item.name || ''), ...line });
      }
    }

    // ── CC Fee (round 15+): top-level field on Sale, pass-through surcharge.
    // 100% margin — cost=0, profit=revenue. Classified as its own category so
    // the owner can reconcile against processor statements.
    const ccFee = sale.creditCardFee || 0;
    const hasCcFeeLineItem = (sale.items || []).some((item) => classifyItem(item) === 'cc_fee');
    if (ccFee > 0 && !hasCcFeeLineItem) {
      const cat = ensureCat('CC Fees');
      cat.quantity += 1;
      cat.revenueCents += ccFee;
      // costCents stays 0 — 100% margin is real for CC fee pass-through.
      cat.profitCents += ccFee;
      cat.hasRealCostItem = true;
      totalProfitCents += ccFee;
      ccFeeProfitCents += ccFee;
      // I2B-0: per-sale exposure only — NOT added to econ.profitCents (the
      // P3 self-reversal reads that field; policy unchanged).
      econ.ccFeeCents = (econ.ccFeeCents || 0) + ccFee;
    }
  }

  // Standalone repairs (not in POS)
  // I1.1: a completed, fully-paid, in-period repair with no POS representation
  // now contributes to GROSS/NET revenue exactly like standalone unlocks —
  // previously it entered categories/profit but never gross (inconsistent).
  // No employee attribution: Repair has no seller field (documented).
  let standaloneRepairRevenueCents = 0;
  for (const r of standaloneRepairs) {
    const rev = r.total ?? r.estimatedCost ?? 0;
    const partsCost = (r.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || (p as { quantity?: number }).quantity || 1), 0);
    const labor = r.laborCost || 0;
    const cost = (partsCost + labor) || Math.round(rev * REPAIR_COST_FALLBACK);
    const profit = rev - cost;
    const cat = ensureCat('Repairs');
    cat.quantity += 1;
    cat.revenueCents += rev;
    cat.costCents += cost;
    cat.profitCents += profit;
    cat.hasRealCostItem = true;
    totalCostCents += cost;
    totalProfitCents += profit;
    standaloneRepairRevenueCents += rev;
  }

  // Standalone unlocks (not in POS)
  let standaloneUnlockRevenueCents = 0;
  for (const u of standaloneUnlocks) {
    const rev = u.price || 0;
    const cost = u.cost || 0;
    const profit = rev - cost;
    const cat = ensureCat('Unlocks');
    cat.quantity += 1;
    cat.revenueCents += rev;
    cat.costCents += cost;
    cat.profitCents += profit;
    cat.hasRealCostItem = true;
    totalCostCents += cost;
    totalProfitCents += profit;
    standaloneUnlockRevenueCents += rev;
  }

  // Fix 1: vendor returns reduce COGS (returned stock no longer a cost).
  const vendorReturnCogsCents = filteredVendorReturns.reduce(
    (s: number, v) => s + ((v as { totalValueCents?: number }).totalValueCents || Math.round(((v as { totalValue?: number }).totalValue || 0) * 100)),
    0,
  );
  totalCostCents = Math.max(0, totalCostCents - vendorReturnCogsCents);

  // ══ I1.1 CANONICAL GROSS / ADJUSTMENTS / NET ═══════════════
  // grossSales = every legitimately completed period sale (INCLUDING later-
  // refunded originals — they were real revenue when charged), excluding
  // voided + refund-representation rows, plus standalone completed
  // repairs/unlocks. A refund then subtracts EXACTLY ONCE via the
  // deduplicated adjustments below, recognized at the refund-event date.
  const grossSalesCents = grossActivitySales.reduce((s, sale) => s + (sale.total || 0), 0)
    + standaloneUnlockRevenueCents
    + standaloneRepairRevenueCents;

  const subtotalBeforeTaxCents = salesSubtotalCents - salesDiscountCents
    + standaloneUnlockRevenueCents
    + standaloneRepairRevenueCents;

  // Average-margin ratio — ONLY the estimate fallback (level 4) uses it.
  const avgMarginRatio = subtotalBeforeTaxCents > 0 ? totalProfitCents / subtotalBeforeTaxCents : 0;

  // ── Refund adjustments engine (dedup precedence P1→P3) ──
  interface RefundAdjustment { revenueCents: number; taxCents: number; subtotalCents: number; costCents: number; profitCents: number; estimated: boolean }
  const adjustments: RefundAdjustment[] = [];
  const allSales: Sale[] = Array.isArray(input.sales) ? input.sales : [];
  const salesById = new Map(allSales.map((s) => [s.id, s]));

  // Stable-link indexes (never amount+date matching).
  const returnNumbers = new Set(allReturns.map((r) => r.returnNumber).filter(Boolean));
  const returnInvoices = new Set(allReturns.map((r) => r.originalInvoice).filter(Boolean));
  const returnedSaleIds = new Set(allReturns.map((r) => r.originalSaleId).filter((x): x is string => !!x));
  const refundLinkedInvoices = new Set<string>();
  const refundLinkedSaleIds = new Set<string>();
  for (const s of allSales) {
    const rf = (s as unknown as { refundFor?: string }).refundFor;
    if (rf) refundLinkedInvoices.add(String(rf));
    const lr = (s as unknown as { linkedRefunds?: Array<{ type: string; id: string }> }).linkedRefunds;
    if (Array.isArray(lr)) {
      for (const ref of lr) {
        if (String(ref.type || '').toLowerCase().replace(/[_-]/g, '') === 'sale' && ref.id) refundLinkedSaleIds.add(ref.id);
      }
    }
  }

  // Returned-item cost hierarchy (documented):
  //   1. Cost on the returned item itself — structurally ABSENT
  //      (CustomerReturnItem carries no cost field; kept for future data).
  //   2. STORED cost on the matching original sale item (by item id, then
  //      case-insensitive name) — the exact path.
  //   3. Inventory cost where identity is reliable: original item's
  //      inventoryId, else the documented legacy name-match fallback.
  //   4. Average-margin estimate — flagged `estimated: true`, never
  //      silently presented as exact.
  const estimatedReversal = (subtotalCents: number): { costCents: number; profitCents: number } => {
    const profitCents = Math.round(subtotalCents * avgMarginRatio);
    return { costCents: subtotalCents - profitCents, profitCents };
  };

  /** Shared cost-matching hierarchy (ordinary returns AND exchanges):
   *  1. cost on the returned item (structurally absent today — kept first),
   *  2. STORED cost on the matching original sale item (stable id, then
   *     case-insensitive name), 3. inventory identity (inventoryId, then the
   *  documented legacy name match), 4. estimate — flagged, never exact. */
  const resolveReturnedLine = (
    ri: CustomerReturn['items'][number],
    orig: Sale | undefined,
  ): { costCents: number; subtotalCents: number; estimated: boolean } => {
    const riSubtotal = ri.subtotalCents ?? Math.round((ri.subtotal || 0) * 100);
    const riQty = ri.qty || 1;
    const riCost = (ri as unknown as { costCents?: number }).costCents;
    if (typeof riCost === 'number' && !Number.isNaN(riCost)) {
      return { costCents: riCost, subtotalCents: riSubtotal, estimated: false };
    }
    let origItem: SaleItem | undefined;
    if (orig) {
      origItem = (orig.items || []).find((oi) => !!ri.id && oi.id === ri.id)
        || (orig.items || []).find((oi) => String(oi.name || '').toLowerCase() === String(ri.name || '').toLowerCase());
    }
    let unitCost: number | null = null;
    if (origItem && typeof origItem.cost === 'number' && !Number.isNaN(origItem.cost)) {
      unitCost = origItem.cost;
    } else if (origItem) {
      const inv = (origItem.inventoryId
        ? inventory.find((i) => i.id === origItem!.inventoryId)
        : undefined)
        || (origItem.name ? inventory.find((i) => i.name?.toLowerCase() === origItem!.name.toLowerCase()) : undefined);
      if (inv && typeof inv.cost === 'number') unitCost = inv.cost || 0;
    }
    if (unitCost !== null) {
      return { costCents: unitCost * riQty, subtotalCents: riSubtotal, estimated: false };
    }
    const est = estimatedReversal(riSubtotal);
    return { costCents: est.costCents, subtotalCents: riSubtotal, estimated: riSubtotal !== 0 };
  };

  const reversalForReturn = (r: NormalizedReturn): RefundAdjustment => {
    const orig = r.originalSaleId ? salesById.get(r.originalSaleId) : undefined;
    const src = Array.isArray(input.customerReturns) ? input.customerReturns.find((cr) => cr.id === r.id) : undefined;
    const items = Array.isArray(src?.items) ? src!.items : [];
    if (items.length === 0) {
      // Legacy return without line items → estimate on the whole subtotal.
      const est = estimatedReversal(r.subtotalCents);
      return { revenueCents: r.totalCents, taxCents: r.taxCents, subtotalCents: r.subtotalCents, ...est, estimated: r.subtotalCents !== 0 };
    }
    let costCents = 0;
    let profitCents = 0;
    let estimated = false;
    for (const ri of items) {
      const line = resolveReturnedLine(ri, orig);
      costCents += line.costCents;
      profitCents += line.subtotalCents - line.costCents;
      if (line.estimated) estimated = true;
    }
    return { revenueCents: r.totalCents, taxCents: r.taxCents, subtotalCents: r.subtotalCents, costCents, profitCents, estimated };
  };

  // P1 — CustomerReturns recognized at the RETURN date within this period.
  // EXCHANGE returns take the dedicated path below: their REVENUE credit is
  // the negative `exchange_credit` line inside the replacement sale (already
  // in gross activity — counting the return record too would subtract the
  // same refund twice), but the returned merchandise's COGS must still be
  // reversed exactly once (I1.2). Tax: the exchange checkout computed the
  // transaction's real tax on the NEW items — no tax refund is fabricated.
  //
  // CANONICAL EXCHANGE POLICY (verified production contract):
  //   CustomerReturn{resolution:'exchange', originalSaleId, returnNumber,
  //   exchangeSaleId?/exchangeInvoiceNumber? (R-RETURNS-PHASE-2B)} ↔
  //   replacement Sale carrying the `exchange_credit` line ↔ original Sale
  //   (items marked returnedQty/fullyReturned). Returned goods restock via
  //   ReturnsModule Phase 3 (legacy immediate) or finalizeSaleCore's
  //   finalizeExchangeReturn (deferred 2B) — either way stock came back, so
  //   the returned merchandise cost LEAVES period COGS and profit rises by
  //   the same amount; the replacement merchandise cost stays in COGS.
  //   Recognition date = return.createdAt (== replacement checkout for 2B).
  // I1.3 EXCHANGE CREDIT COMPOSITION (proven at ReturnsModule.tsx:416-435,
  // 685): returnItem.taxCents = forwardTaxFromBase(subtotal) for taxable
  // items only; totalCents = subtotalCents + taxCents EXACTLY; the
  // exchange_credit line is `price: -totalCents` (tax-inclusive) and
  // non-taxable. CBE / screen fee / utility tax / mobility surcharge are
  // NEVER part of a return credit (the refund sale stamps them 0), so
  // exchangeRefundedPassThroughCents is structurally 0 — documented, no
  // invented behavior. The credit's embedded TAX must therefore be
  // reclassified: it is TAX REFUNDED (reduces net tax), not a reduction of
  // pre-tax merchandise revenue and not a merchandise loss in profit.
  // Safe fallback when taxCents is absent/zero on a legacy record: the
  // composition-derived difference max(0, totalCents − subtotalCents).
  let exchangeCreditCents = 0;
  let exchangeCreditPreTaxCents = 0;
  let exchangeTaxRefundedCents = 0;
  const exchangeRefundedPassThroughCents = 0;
  let exchangeReturnedCostReversalCents = 0;
  let exchangeEstimated = false;
  for (const r of returnsInPeriod) {
    if (String(r.resolution || '').toLowerCase() === 'exchange') {
      const orig = r.originalSaleId ? salesById.get(r.originalSaleId) : undefined;
      const src = Array.isArray(input.customerReturns) ? input.customerReturns.find((cr) => cr.id === r.id) : undefined;
      const items = Array.isArray(src?.items) ? src!.items : [];
      exchangeCreditCents += r.totalCents;
      const exTax = r.taxCents !== 0
        ? r.taxCents
        : Math.max(0, r.totalCents - r.subtotalCents);
      exchangeTaxRefundedCents += exTax;
      exchangeCreditPreTaxCents += r.totalCents - exTax;
      if (items.length === 0) {
        // Legacy exchange without line items → estimated cost, flagged.
        const est = estimatedReversal(r.subtotalCents);
        exchangeReturnedCostReversalCents += est.costCents;
        if (r.subtotalCents !== 0) exchangeEstimated = true;
      } else {
        for (const ri of items) {
          const line = resolveReturnedLine(ri, orig);
          exchangeReturnedCostReversalCents += line.costCents;
          if (line.estimated) exchangeEstimated = true;
        }
      }
      continue;
    }
    adjustments.push(reversalForReturn(r));
  }

  // P2 — countable refund-audit rows (post-edit REFUND-*) not represented
  // by any CustomerReturn. Their negative fields carry the exact money; the
  // refunded base is pure margin reversal (no goods returned) unless a line
  // carries a stamped cost.
  for (const s of refundAuditSales) {
    const rn = (s as unknown as { returnNumber?: string }).returnNumber;
    if (rn && returnNumbers.has(String(rn))) continue;
    const rf = (s as unknown as { refundFor?: string }).refundFor;
    if (rf && returnInvoices.has(String(rf))) continue;
    const revenueCents = -(s.total || 0);
    const v2 = ((s as unknown as { salesTax?: number }).salesTax || 0)
      + ((s as unknown as { utilityTax?: number }).utilityTax || 0)
      + ((s as unknown as { mobileSurcharge?: number }).mobileSurcharge || 0);
    const taxCents = -(v2 !== 0 ? v2 : (s.taxAmount || 0));
    let costCents = 0;
    for (const it of (s.items || [])) {
      if (typeof it.cost === 'number' && !Number.isNaN(it.cost)) costCents += Math.abs(it.cost) * (it.qty || 1);
    }
    adjustments.push({ revenueCents, taxCents, subtotalCents: revenueCents - taxCents, costCents, profitCents: (revenueCents - taxCents) - costCents, estimated: false });
  }

  // P3 — LEGACY refunded original with NO money record anywhere: exact
  // self-reversal in its own period (nets that period to zero — honest,
  // never overstated, never double-subtracted).
  for (const sale of grossActivitySales) {
    if (sale.status !== 'refunded') continue;
    if (returnedSaleIds.has(sale.id)) continue;
    if (refundLinkedSaleIds.has(sale.id)) continue;
    if (sale.invoiceNumber && (returnInvoices.has(sale.invoiceNumber) || refundLinkedInvoices.has(sale.invoiceNumber))) continue;
    const econ = saleEconomics.get(sale.id);
    const costCents = econ ? Array.from(econ.byId.values()).reduce((s2, l) => s2 + l.costCents, 0) : 0;
    adjustments.push({
      revenueCents: sale.total || 0,
      taxCents: econ ? econ.taxCents : 0,
      subtotalCents: sale.subtotalAfterDiscount ?? (sale.subtotal || 0),
      costCents,
      profitCents: econ ? econ.profitCents : 0,
      estimated: false,
    });
  }

  const returnAndRefundAdjustmentsCents = adjustments.reduce((s, a) => s + a.revenueCents, 0);
  // I1.3 tax-refund split: ordinary returns/refund-rows/self-reversals vs
  // the tax embedded in exchange credits. Never counted twice — ordinary
  // adjustments never include exchange returns (dedicated path above).
  const ordinaryTaxRefundedCents = adjustments.reduce((s, a) => s + a.taxCents, 0);
  const taxRefundedCents = ordinaryTaxRefundedCents + exchangeTaxRefundedCents;
  const returnedCostReversalCents = adjustments.reduce((s, a) => s + a.costCents, 0);
  const returnedProfitReversalCents = adjustments.reduce((s, a) => s + a.profitCents, 0);
  const profitAdjustmentEstimated = adjustments.some((a) => a.estimated) || exchangeEstimated;

  const netSalesCents = grossSalesCents - returnAndRefundAdjustmentsCents;
  const customerReturnTaxAdjustmentCents = taxRefundedCents; // legacy alias

  // Returned goods go back to stock → their cost leaves period COGS. This
  // covers BOTH ordinary returns and I1.2 exchanges (the exchanged-away
  // item's cost leaves COGS; the replacement item's cost stays in COGS,
  // accumulated by the main loop like any sold line).
  // totalProfitCents accumulated BOTH item profits and top-level CC fees in
  // the loop; grossItemProfit is the item-only component (invariant:
  // totalProfit === grossItemProfit + ccFeeProfit − returnReversal
  //                 + exchangeCostReversal).
  const grossItemProfitCents = totalProfitCents - ccFeeProfitCents;
  totalCostCents = totalCostCents - returnedCostReversalCents - exchangeReturnedCostReversalCents;
  // I1.3: the exchange credit's embedded TAX is a tax refund, not a
  // merchandise loss — add it back to profit (the credit line's full
  // tax-inclusive value flowed through item profits as −total).
  const adjustedTotalProfitCents = totalProfitCents - returnedProfitReversalCents
    + exchangeReturnedCostReversalCents
    + exchangeTaxRefundedCents
    + exchangeRefundedPassThroughCents;

  // ── I1.2 PART B: NET pre-tax margin basis ──
  //   netRevenueBeforeTax === grossRevenueBeforeTax
  //                           − returnRevenueBeforeTaxAdjustment
  //                           + exchangeTaxRefunded (+ passthrough)   (I1.3)
  // The margin denominator is the NET pre-tax revenue (post-returns), never
  // the gross subtotal. I1.3: the tax-INCLUSIVE exchange credit distorts the
  // raw sale subtotal by exactly its embedded tax (the non-taxable credit
  // line subtracts tax from a PRE-tax field) — add that tax back so net
  // pre-tax revenue reflects actual merchandise/service revenue.
  const grossRevenueBeforeTaxCents = subtotalBeforeTaxCents;
  const returnRevenueBeforeTaxAdjustmentCents = adjustments.reduce((s, a) => s + a.subtotalCents, 0);
  const netRevenueBeforeTaxCents = grossRevenueBeforeTaxCents
    - returnRevenueBeforeTaxAdjustmentCents
    + exchangeTaxRefundedCents
    + exchangeRefundedPassThroughCents;
  const profitMarginBasisCents = netRevenueBeforeTaxCents;
  // Meaningful only for a positive net basis: a zero/negative-revenue period
  // has NO meaningful margin — consumers must check profitMarginMeaningful
  // instead of presenting the compatibility 0 as a business conclusion.
  const profitMarginMeaningful = netRevenueBeforeTaxCents > 0;
  const profitMargin = profitMarginMeaningful
    ? (adjustedTotalProfitCents / netRevenueBeforeTaxCents) * 100
    : 0;

  const categoriesByRevenue = Object.entries(categoryStats)
    .sort((a, b) => b[1].revenueCents - a[1].revenueCents)
    .map(([, s]) => {
      // Round 10 fix 3: exclude pseudo-item revenue from margin denominator
      // (and profit numerator is already pseudo-free). If the category has no
      // real-cost items at all, marginPct is null → rendered as "—".
      const costBaseCents = s.revenueCents - s.pseudoRevenueCents;
      const marginPct = s.hasRealCostItem && costBaseCents > 0
        ? (s.profitCents / costBaseCents) * 100
        : null;
      return {
        name: s.displayName,
        quantity: s.quantity,
        revenueCents: s.revenueCents,
        costCents: s.costCents,
        profitCents: s.profitCents,
        marginPct,
      };
    });

  const topItems = Object.entries(itemStats)
    .sort((a, b) => b[1].revenueCents - a[1].revenueCents)
    .slice(0, 10)
    .map(([name, d]) => ({ name, quantity: d.quantity, revenueCents: d.revenueCents }));

  const topEmployees = Object.entries(employeeStats)
    .sort((a, b) => b[1].revenueCents - a[1].revenueCents)
    .map(([name, d]) => ({ name, transactions: d.transactions, revenueCents: d.revenueCents }));

  // ── Tax (I1.1 canonical): gross collected / refunded / net — UNCLAMPED. ──
  const grossTaxCollectedCents = productSalesTaxCents
    + utilityTaxCents
    + mobilitySurchargeCents
    + legacyTaxAmountCents;
  const netTaxCents = grossTaxCollectedCents - taxRefundedCents;

  // I1.1 transaction buckets: gross activity (incl. refunded originals) vs
  // refund-representation rows vs status counts.
  const cleanSalesCount = grossActivitySales.filter((s) => (s.total || 0) > 0).length;
  const refundSalesCount = refundAuditSales.length;

  // ── R-REPORT-ZTAPE-RECONCILIATION-FIX (I1.1 semantics) ────────────────
  // grossCollected = gross sales (a later-refunded original DID collect on
  // its day); refund outflows reconcile via refundTaxAdjustment/totalReturns
  // and the net line. Derived from the same accumulators — no parallel sums.
  const reconTaxCollectedCents = grossTaxCollectedCents;
  const reconFeeCollectedCents = salesCbeCents + salesScreenFeeCents;
  const reconGrossCollectedCents = grossSalesCents;
  const reconRefundTaxAdjustmentCents = taxRefundedCents;
  const reconOperationalRevenueCents = reconGrossCollectedCents
    - reconTaxCollectedCents
    - reconFeeCollectedCents;
  const reconNetRevenueCents = netSalesCents;

  return {
    // I1.1 canonical fields
    grossSalesCents,
    returnAndRefundAdjustmentsCents,
    netSalesCents,
    grossTaxCollectedCents,
    taxRefundedCents,
    ordinaryTaxRefundedCents,
    exchangeTaxRefundedCents,
    netTaxCents,
    returnedCostReversalCents,
    returnedProfitReversalCents,
    profitAdjustmentEstimated,
    grossItemProfitCents,
    ccFeeProfitCents,
    // I1.2 exchange + net margin basis
    exchangeCreditCents,
    exchangeCreditPreTaxCents,
    exchangeRefundedPassThroughCents,
    exchangeReturnedCostReversalCents,
    grossRevenueBeforeTaxCents,
    returnRevenueBeforeTaxAdjustmentCents,
    netRevenueBeforeTaxCents,
    profitMarginBasisCents,
    profitMarginMeaningful,
    // Legacy aliases (same values)
    grossRevenueCents: grossSalesCents,
    netRevenueCents: netSalesCents,
    totalReturnsCents: returnAndRefundAdjustmentsCents,
    totalProfitCents: adjustedTotalProfitCents,
    totalCostCents,
    subtotalBeforeTaxCents,
    profitMargin,
    // I1.1: taxCollectedCents = NET tax, no longer clamped at zero — a
    // refund-only period is legitimately negative.
    taxCollectedCents: netTaxCents,
    productSalesTaxCents,
    utilityTaxCents,
    mobilitySurchargeCents,
    legacyTaxAmountCents,
    customerReturnTaxAdjustmentCents,
    cbeCollectedCents: salesCbeCents,
    screenFeeCents: salesScreenFeeCents,
    recon: {
      grossCollectedCents: reconGrossCollectedCents,
      taxCollectedCents: reconTaxCollectedCents,
      feeCollectedCents: reconFeeCollectedCents,
      refundTaxAdjustmentCents: reconRefundTaxAdjustmentCents,
      operationalRevenueCents: reconOperationalRevenueCents,
      netRevenueCents: reconNetRevenueCents,
      totalReturnsCents: returnAndRefundAdjustmentsCents,
    },
    cashCents,
    cardCents,
    storeCreditCents,
    txCount: grossActivitySales.length,
    standaloneRepairCount: standaloneRepairs.length,
    standaloneUnlockCount: standaloneUnlocks.length,
    cleanSalesCount,
    refundSalesCount,
    voidedCount: allFilteredSales.filter((s) => s.status === 'voided').length,
    refundedCount: allFilteredSales.filter((s) => s.status === 'refunded').length,
    repairCount: filteredRepairs.length,
    completedRepairCount: filteredRepairs.filter(isRepairCompleted).length,
    unlockCount: filteredUnlocks.length,
    categoriesByRevenue,
    topItems,
    topEmployees,
    phonePaymentsByProvider,
    // R-ACTIVATIONS-BY-CARRIER-V1
    activationsByCarrier,
    // I2B-0: pure exposure of the internal stash (no new math).
    // I2B-0.1: costCents from the direct accumulator (no-ID / duplicate-ID
    // lines contribute exactly once); byId stays lookup-only.
    perSaleEconomics: Object.fromEntries(
      Array.from(saleEconomics.entries()).map(([saleId, e]) => [saleId, {
        itemProfitCents: e.profitCents,
        ccFeeProfitCents: e.ccFeeCents || 0,
        costCents: e.lineCostCents,
        taxCents: e.taxCents,
        lines: e.lines,
      }]),
    ),
  };
}

// ── I1.1 reconciliation invariants (reusable; tests + future consumers) ──
export interface ReportMoneyInvariants {
  netSalesOk: boolean;
  netTaxOk: boolean;
  taxSplitOk: boolean;
  exchangeCreditOk: boolean;
  profitOk: boolean;
  netBeforeTaxOk: boolean;
  ok: boolean;
}

/**
 * Canonical relations every ReportMoneyStats must satisfy:
 *   netSalesCents === grossSalesCents − returnAndRefundAdjustmentsCents
 *   taxRefundedCents === ordinaryTaxRefundedCents + exchangeTaxRefundedCents
 *   netTaxCents   === grossTaxCollectedCents − taxRefundedCents
 *   exchangeCreditCents === exchangeCreditPreTaxCents
 *                           + exchangeTaxRefundedCents
 *                           + exchangeRefundedPassThroughCents      (I1.3)
 *   totalProfitCents === grossItemProfitCents + ccFeeProfitCents
 *                        − returnedProfitReversalCents
 *                        + exchangeReturnedCostReversalCents
 *                        + exchangeTaxRefundedCents
 *                        + exchangeRefundedPassThroughCents         (I1.3)
 *   netRevenueBeforeTaxCents === grossRevenueBeforeTaxCents
 *                                − returnRevenueBeforeTaxAdjustmentCents
 *                                + exchangeTaxRefundedCents
 *                                + exchangeRefundedPassThroughCents (I1.3)
 * (CellHub profit definition: per-line revenue − cost, commission economics
 *  inside line cost, CC fees 100% margin, taxes/CBE/screen fees pass-through,
 *  refund reversal exact where derivable else flagged estimated; exchanged-
 *  away merchandise cost leaves COGS, replacement merchandise cost stays;
 *  tax embedded in a tax-inclusive exchange credit is TAX REFUNDED — never
 *  merchandise revenue and never merchandise loss.)
 */
export function checkReportMoneyInvariants(stats: ReportMoneyStats): ReportMoneyInvariants {
  const netSalesOk = stats.netSalesCents === stats.grossSalesCents - stats.returnAndRefundAdjustmentsCents;
  const taxSplitOk = stats.taxRefundedCents === stats.ordinaryTaxRefundedCents + stats.exchangeTaxRefundedCents;
  const netTaxOk = stats.netTaxCents === stats.grossTaxCollectedCents - stats.taxRefundedCents;
  const exchangeCreditOk = stats.exchangeCreditCents === stats.exchangeCreditPreTaxCents
    + stats.exchangeTaxRefundedCents + stats.exchangeRefundedPassThroughCents;
  const profitOk = stats.totalProfitCents === stats.grossItemProfitCents + stats.ccFeeProfitCents
    - stats.returnedProfitReversalCents + stats.exchangeReturnedCostReversalCents
    + stats.exchangeTaxRefundedCents + stats.exchangeRefundedPassThroughCents;
  const netBeforeTaxOk = stats.netRevenueBeforeTaxCents === stats.grossRevenueBeforeTaxCents
    - stats.returnRevenueBeforeTaxAdjustmentCents
    + stats.exchangeTaxRefundedCents + stats.exchangeRefundedPassThroughCents;
  return {
    netSalesOk, netTaxOk, taxSplitOk, exchangeCreditOk, profitOk, netBeforeTaxOk,
    ok: netSalesOk && netTaxOk && taxSplitOk && exchangeCreditOk && profitOk && netBeforeTaxOk,
  };
}

/** Full pipeline: inclusion rules + core stats in one call. */
export function computeReportMoney(input: ReportMoneyStatsInput): {
  collections: ReportMoneyCollections;
  stats: ReportMoneyStats;
} {
  const collections = deriveReportCollections(input);
  const stats = computeReportMoneyStatsFromCollections(input, collections);
  return { collections, stats };
}

/** Canonical contract (round spec): input → stats. */
export function computeReportMoneyStats(input: ReportMoneyStatsInput): ReportMoneyStats {
  return computeReportMoney(input).stats;
}
