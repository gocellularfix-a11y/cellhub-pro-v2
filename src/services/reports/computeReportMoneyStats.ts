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
  /** Countable sales — used for ALL revenue/profit/tax calculations. */
  filteredSales: Sale[];
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
  grossRevenueCents: number;
  netRevenueCents: number;
  totalReturnsCents: number;
  totalProfitCents: number;
  totalCostCents: number;
  subtotalBeforeTaxCents: number;
  profitMargin: number;
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
  cleanSalesCount: number;
  refundSalesCount: number;
  voidedCount: number;
  refundedCount: number;
  repairCount: number;
  completedRepairCount: number;
  unlockCount: number;
  categoriesByRevenue: ReportCategoryRow[];
  topItems: Array<{ name: string; quantity: number; revenueCents: number }>;
  topEmployees: Array<{ name: string; transactions: number; revenueCents: number }>;
  phonePaymentsByProvider: PhoneActivityAggregation['phonePaymentsByProvider'];
  activationsByCarrier: PhoneActivityAggregation['activationsByCarrier'];
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

  /** Countable sales — used for ALL revenue/profit/tax calculations. */
  const filteredSales = allFilteredSales.filter(isCountableSale);

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
  /** IDs and ticket numbers of repairs that were paid through POS in this period. */
  const repairsAlreadyInSales = new Set<string>();
  for (const sale of filteredSales) {
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
  for (const sale of filteredSales) {
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
    allFilteredSales, filteredSales, filteredRepairs, filteredUnlocks,
    filteredVendorReturns, returnsFromPeriodSales, standaloneRepairs, standaloneUnlocks,
  } = c;

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
  const { phonePaymentsByProvider, activationsByCarrier } = aggregatePhoneActivity(
    filteredSales,
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

  for (const sale of filteredSales) {
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
        let unitCost = item.cost || 0;
        if (!unitCost && item.name) {
          const inv = inventory.find((i) => i.name?.toLowerCase() === item.name.toLowerCase());
          if (inv) unitCost = inv.cost || 0;
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
        } else {
          cat.pseudoRevenueCents += revenueCents;
        }
      } else {
        cat.costCents += costCents;
        cat.profitCents += profitCents;
        cat.hasRealCostItem = true;
        totalCostCents += costCents;
        totalProfitCents += profitCents;
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
    }
  }

  // Standalone repairs (not in POS)
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

  // Round 10.1 fix 2: Gross excludes status==='refunded' AND negative-total
  // refund audit sales. Returns are subtracted separately via returnsFromPeriodSales,
  // so including refund sales here would double-deduct.
  const grossRevenueCents = allFilteredSales.reduce((s, sale) => {
    if (sale.status === 'refunded' || sale.status === 'voided') return s;
    const t = sale.total || 0;
    // R-EDIT-AUDIT F7-FIX-v2: allow negative totals so post-edit refund
    // sales (REFUND-* with status='completed') subtract from gross.
    return s + t;
  }, 0) + standaloneUnlockRevenueCents;
  const totalReturnsCents = returnsFromPeriodSales.reduce((s, r) => s + r.totalCents, 0);
  const netRevenueCents = grossRevenueCents - totalReturnsCents;

  // R-FINANCIAL-BUCKET-PURITY-FIX P2: customer-return refunds adjust the
  // EXPOSED aggregate only — they never mutate any pure bucket.
  const customerReturnTaxAdjustmentCents = returnsFromPeriodSales.reduce(
    (s, r) => s + r.taxCents,
    0,
  );

  const subtotalBeforeTaxCents = salesSubtotalCents - salesDiscountCents + standaloneUnlockRevenueCents;

  // Profit-adjusted-for-returns: assume returns carried average margin
  const returnsSubtotalCents = returnsFromPeriodSales.reduce((s, r) => s + r.subtotalCents, 0);
  const returnsProfitAdjustmentCents = subtotalBeforeTaxCents > 0
    ? Math.round((totalProfitCents / subtotalBeforeTaxCents) * returnsSubtotalCents)
    : 0;
  const adjustedTotalProfitCents = totalProfitCents - returnsProfitAdjustmentCents;

  const profitMargin = subtotalBeforeTaxCents > 0
    ? (adjustedTotalProfitCents / subtotalBeforeTaxCents) * 100
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

  // Round 10 fix 2: bucketize transactions rather than lumping them as "txCount".
  const cleanSalesCount = filteredSales.filter((s) => (s.total || 0) > 0).length;
  const refundSalesCount = filteredSales.filter((s) => (s.total || 0) < 0).length;

  // ── R-REPORT-ZTAPE-RECONCILIATION-FIX ─────────────────────────────────
  // Additive reconciliation layer derived from the same raw accumulators the
  // report already uses — no parallel summation, no new refund handling.
  const reconTaxCollectedCents = productSalesTaxCents
    + utilityTaxCents
    + mobilitySurchargeCents
    + legacyTaxAmountCents;
  const reconFeeCollectedCents = salesCbeCents + salesScreenFeeCents;
  const reconGrossCollectedCents = grossRevenueCents;
  const reconRefundTaxAdjustmentCents = customerReturnTaxAdjustmentCents;
  const reconOperationalRevenueCents = reconGrossCollectedCents
    - reconTaxCollectedCents
    - reconFeeCollectedCents;
  const reconNetRevenueCents = netRevenueCents;

  return {
    grossRevenueCents,
    netRevenueCents,
    totalReturnsCents,
    totalProfitCents: adjustedTotalProfitCents,
    totalCostCents,
    subtotalBeforeTaxCents,
    profitMargin,
    // R-FINANCIAL-BUCKET-PURITY-FIX P1: `taxCollectedCents` is an EXPLICIT
    // aggregate of the four pure tax buckets minus the customer-return
    // adjustment (numeric value preserved vs the pre-P1 accumulator).
    taxCollectedCents: Math.max(0,
      productSalesTaxCents
      + utilityTaxCents
      + mobilitySurchargeCents
      + legacyTaxAmountCents
      - customerReturnTaxAdjustmentCents,
    ),
    productSalesTaxCents,
    utilityTaxCents,
    mobilitySurchargeCents,
    legacyTaxAmountCents,
    customerReturnTaxAdjustmentCents,
    cbeCollectedCents: salesCbeCents,
    screenFeeCents: salesScreenFeeCents,
    // R-REPORT-ZTAPE-RECONCILIATION-FIX: explicit Z-tape reconciliation
    // bucket. Additive — never replaces legacy fields, never feeds back
    // into them.
    recon: {
      grossCollectedCents: reconGrossCollectedCents,
      taxCollectedCents: reconTaxCollectedCents,
      feeCollectedCents: reconFeeCollectedCents,
      refundTaxAdjustmentCents: reconRefundTaxAdjustmentCents,
      operationalRevenueCents: reconOperationalRevenueCents,
      netRevenueCents: reconNetRevenueCents,
      totalReturnsCents,
    },
    cashCents,
    cardCents,
    storeCreditCents,
    txCount: filteredSales.length,
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
