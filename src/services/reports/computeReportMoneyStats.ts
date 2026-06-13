// ============================================================
// CellHub Reports — Money-stats pipeline (single source of truth)
// R-REPORTS-MONEY-EXTRACT Phase A
//
// Pure, framework-free extraction of ReportsModule's daily money/profit
// computation so BOTH the Reports UI and the Intelligence layer (EOD brief)
// can call ONE pipeline — no duplicated cents math. Behavior is identical to
// the original inline ReportsModule `stats` useMemo; only its location moved.
// No money/tax/profit/reconciliation rule was changed in this extraction.
// ============================================================
import type { Sale, SaleItem, Repair, Unlock, SpecialOrder, Layaway, InventoryItem, StoreSettings, CustomerReturn } from '@/store/types';
import { normalizeCarrier } from '@/utils/normalize';
import { getActivePortals, getDefaultPortalId } from '@/config/paymentPortals';

const REPAIR_COST_FALLBACK = 0.35;  // when parts/labor not tracked
const REPAIR_PROFIT_FALLBACK = 0.65;
const TOPUP_COST_RATE = 0.90;
const TOPUP_PROFIT_RATE = 0.10;

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
// R-DASHBOARD-PROFIT-RECONCILE-V1: exported so Dashboard.tsx reuses the
// SAME pseudo-item detection (single source of truth — no parallel
// accounting). No behavior change.
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
// R-DASHBOARD-PROFIT-RECONCILE-V1: exported (with siblings below) so
// Dashboard.tsx applies the same proportional-cost slice for layaway-
// linked sale items. No behavior change.
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
    (s, p) => s + (p.cost || 0) * (p.qty || (p as any).quantity || 1),
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

/**
 * Round 10: case-insensitive category bucketing. Previously 'Products' and
 * 'products' would create separate rows and aggregation split across both,
 * masking the real totals (e.g. two -$25 refunds rolled to a single -$20 row).
 */
export function normalizeCategoryKey(raw: string): string {
  return String(raw || '').trim().toLowerCase() || 'products';
}

/** Repair counts as completed revenue iff customer paid in full and picked up. */
export function isRepairCompleted(r: Repair): boolean {
  const status = String(r.status || '').toLowerCase();
  const completedStatuses = ['complete', 'completed', 'picked_up', 'pickedup'];
  return completedStatuses.includes(status) && (r.balance ?? 0) === 0;
}

// R-REPORTS-MONEY-EXTRACT Phase A.2: pure helpers lifted VERBATIM from
// ReportsModule so the shared input builder AND the Reports UI (via import)
// use ONE definition. No logic change.

/** Unlock counts as completed revenue iff status is complete/completed. */
export function isUnlockCompleted(u: Unlock): boolean {
  const status = String(u.status || '').toLowerCase();
  return status === 'completed' || status === 'complete';
}

/** Sale counts as revenue iff status is not voided/refunded outright. */
export function isCountableSale(s: Sale): boolean {
  return s.status !== 'voided' && s.status !== 'refunded';
}

function isValidDate(d: Date): boolean {
  return !isNaN(d.getTime());
}

/** Tolerant timestamp parser → Date | null (Firestore Timestamp, ISO string,
 *  epoch number, or Date). null on anything unparseable. */
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

/** THE shared period predicate — single source of truth for "is this timestamp
 *  within [startDate 00:00:00 .. endDate 23:59:59.999]?". Both the Reports UI
 *  (via inRange) and buildReportMoneyInputs call this so the money brief can
 *  never drift from Reports on date boundaries. Equivalent to the former
 *  ReportsModule periodRange + inRange logic. */
export function isInPeriod(createdAt: unknown, startDate: string, endDate: string): boolean {
  const d = toDateSafe(createdAt);
  if (!d) return false;
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59.999');
  return d >= start && d <= end;
}

export function normalizeCarrierName(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase().replace(/\s+/g, '');
  if (s === 'T' || lower === 'tmobile' || lower === 't-mobile') return 'T-Mobile';
  if (s === 'V' || lower === 'verizon' || lower === 'vzw') return 'Verizon';
  if (s === 'A' || lower === 'at&t' || lower === 'att') return 'AT&T';
  if (lower.includes('h2o')) return 'H2O';
  if (lower.includes('pageplus')) return 'Page Plus';
  if (lower.includes('simplemobile')) return 'Simple Mobile';
  if (lower.includes('cricket')) return 'Cricket';
  if (lower.includes('ultra')) return 'Ultra Mobile';
  if (lower.includes('tracfone')) return 'Tracfone';
  if (lower.includes('telcel')) return 'Telcel';
  return s;
}

/** Item line revenue in CENTS. Single source of truth. */
export function lineRevenueCents(item: SaleItem): number {
  return (item.price || 0) * (item.qty || (item as any).quantity || 1);
}

/** Item type detection — handles legacy `type` and v2 `category` fields. */
export type ItemKind = 'phone_payment' | 'topup' | 'repair' | 'unlock' | 'special_order' | 'cc_fee' | 'service' | 'product' | 'exchange_credit';

export function classifyItem(item: SaleItem): ItemKind {
  const cat = String(item.category || '').toLowerCase();
  // legacy `type` field on sale items (not in TS type, but lives in real data)
  const type = String((item as unknown as { type?: string }).type || '').toLowerCase();

  if (type === 'phone_payment' || cat === 'phone_payment') return 'phone_payment';
  if (type === 'topup' || cat === 'topup' || cat === 'top_up' || cat === 'top-up') return 'topup';
  if (type === 'repair' || item.repairId) return 'repair';
  if (type === 'unlock' || item.unlockId) return 'unlock';
  if (type === 'special_order' || item.specialOrderId) return 'special_order';
  if (cat === 'exchange_credit') return 'exchange_credit';
  if (type === 'service' || cat === 'service' || cat === 'services') {
    // legacy services that are actually repairs
    const n = (item.name || '').toLowerCase();
    if (n.includes('exchange credit') || n.includes('crédito cambio') || n.includes('crédito troca')) return 'exchange_credit';
    if (n.includes('repair') || n.includes('reparación')) return 'repair';
    // R-REPORTS-LAYAWAY-CATEGORY-FIX: "UNLOCKED" in a product name (e.g.
    // "SAMSUNG GALAXY S24 ULTRA UNLOCKED — Layaway") is a product attribute,
    // NOT a service-category signal. Skip name-based unlock detection when
    // the item carries an explicit layawayId — those are layaway payments
    // and must bucket under 'Layaway' (catName override below).
    if (!item.layawayId && (n.includes('unlock') || n.includes('desbloqueo'))) {
      // R-LAYAWAY-GUARD: prevent false unlock classification for layaway-related items
      if (n.includes('layaway') || n.includes('apartado')) return 'service';
      return 'unlock';
    }
    return 'service';
  }
  return 'product';
}

/** Normalized customer-return row (canonical cents). Superset of the structural
 *  ReportPeriodReturn below — also carries the UI display fields ReportsModule
 *  renders. Lifted VERBATIM from ReportsModule. */
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

/** Normalize raw CustomerReturn records (live AppState) into NormalizedReturn[]
 *  with canonical cents. VERBATIM lift of ReportsModule's prior `allReturns`
 *  map body — prefers canonical *Cents fields, falls back to legacy dollar
 *  fields for pre-Round-9 records. */
export function normalizeReturns(customerReturns: CustomerReturn[]): NormalizedReturn[] {
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

/** Raw inputs for buildReportMoneyInputs — entity arrays + the period range. */
export interface BuildReportMoneyInputsArgs {
  sales: Sale[];
  repairs: Repair[];
  unlocks: Unlock[];
  vendorReturns: any[];
  customerReturns: CustomerReturn[];
  startDate: string;
  endDate: string;
}

/** The eight period-derived collections computeReportMoneyStats consumes. */
export interface ReportMoneyInputs {
  allFilteredSales: Sale[];
  filteredSales: Sale[];
  filteredRepairs: Repair[];
  filteredUnlocks: Unlock[];
  filteredVendorReturns: any[];
  returnsFromPeriodSales: NormalizedReturn[];
  standaloneRepairs: Repair[];
  standaloneUnlocks: Unlock[];
}

/**
 * Build the period-filtered money inputs that feed computeReportMoneyStats.
 * VERBATIM lift of ReportsModule's prior allFilteredSales / filteredSales /
 * filteredRepairs / filteredUnlocks / filteredVendorReturns /
 * returnsFromPeriodSales / standaloneRepairs / standaloneUnlocks useMemo
 * bodies — same filters, same double-count guards, same sort. The ONLY change
 * is location + the shared isInPeriod predicate (previously the inline
 * periodRange/inRange). Reports and the EOD brief MUST share this so the money
 * numbers can't diverge.
 */
export function buildReportMoneyInputs(args: BuildReportMoneyInputsArgs): ReportMoneyInputs {
  const { sales, repairs, unlocks, vendorReturns, customerReturns, startDate, endDate } = args;
  const safeSales: Sale[] = Array.isArray(sales) ? sales : [];
  const safeRepairs: Repair[] = Array.isArray(repairs) ? repairs : [];
  const safeUnlocks: Unlock[] = Array.isArray(unlocks) ? unlocks : [];
  const safeVendorReturns = Array.isArray(vendorReturns) ? vendorReturns : [];

  // All sales in period (includes voided/refunded for visibility), newest first.
  const allFilteredSales = safeSales
    .filter((s) => isInPeriod(s.createdAt, startDate, endDate))
    .sort((a, b) => {
      const da = toDateSafe(a.createdAt)?.getTime() || 0;
      const db = toDateSafe(b.createdAt)?.getTime() || 0;
      return db - da;
    });

  // Countable sales — used for ALL revenue/profit/tax calculations.
  const filteredSales = allFilteredSales.filter(isCountableSale);

  const filteredRepairs = safeRepairs.filter((r) => isInPeriod(r.createdAt, startDate, endDate));
  const filteredUnlocks = safeUnlocks.filter((u) => isInPeriod(u.createdAt, startDate, endDate));
  const filteredVendorReturns = safeVendorReturns.filter((v) => isInPeriod((v as any).createdAt, startDate, endDate));

  // Returns whose original sale was in this period (gross→net adjustment view).
  // Round 10.2: match against ALL sales in period (not just countable) — after
  // R11 migration the original sale is marked refunded and drops out of
  // filteredSales, but its return still belongs to this period.
  const allReturns = normalizeReturns(customerReturns);
  const periodSaleIds = new Set(allFilteredSales.map((s) => s.id));
  const returnsFromPeriodSales = allReturns.filter((r) => r.originalSaleId && periodSaleIds.has(r.originalSaleId));

  // Repair-in-sale tracking (prevents double counting): ids + ticket numbers of
  // repairs paid through POS in this period.
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
  // Standalone completed repairs not already counted in POS sales.
  const standaloneRepairs = filteredRepairs.filter((r) => isRepairCompleted(r) && !repairsAlreadyInSales.has(r.id));

  // Unlock-in-sale tracking.
  const unlocksAlreadyInSales = new Set<string>();
  for (const sale of filteredSales) {
    for (const item of (sale.items || [])) {
      if (item.unlockId) unlocksAlreadyInSales.add(item.unlockId);
      const metaUnlockId = (item as unknown as { meta?: { unlockId?: string } }).meta?.unlockId;
      if (metaUnlockId) unlocksAlreadyInSales.add(metaUnlockId);
    }
  }
  const standaloneUnlocks = filteredUnlocks.filter((u) => isUnlockCompleted(u) && !unlocksAlreadyInSales.has(u.id));

  return {
    allFilteredSales,
    filteredSales,
    filteredRepairs,
    filteredUnlocks,
    filteredVendorReturns,
    returnsFromPeriodSales,
    standaloneRepairs,
    standaloneUnlocks,
  };
}

/** Minimal structural shape of a period return row consumed by the pipeline
 *  (ReportsModule passes its NormalizedReturn[], a superset of this). */
export interface ReportPeriodReturn {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/** Explicit inputs the money pipeline reads — formerly component-scoped
 *  derived values inside ReportsModule. Same values, passed in by the caller. */
export interface ReportMoneyStatsInput {
  filteredSales: Sale[];
  allFilteredSales: Sale[];
  filteredRepairs: Repair[];
  filteredUnlocks: Unlock[];
  standaloneRepairs: Repair[];
  standaloneUnlocks: Unlock[];
  returnsFromPeriodSales: ReportPeriodReturn[];
  filteredVendorReturns: any[];
  inventory: InventoryItem[];
  settings: StoreSettings;
  safeRepairs: Repair[];
  safeUnlocks: Unlock[];
  safeSpecialOrders: SpecialOrder[];
  safeLayaways: Layaway[];
  t: (key: string) => string;
}

/** Compute the canonical Reports money/profit stats object. VERBATIM lift of
 *  ReportsModule's prior inline `stats` useMemo body — no rule changes. */
export function computeReportMoneyStats(input: ReportMoneyStatsInput) {
  const {
    filteredSales, allFilteredSales, filteredRepairs, filteredUnlocks,
    standaloneRepairs, standaloneUnlocks, returnsFromPeriodSales,
    filteredVendorReturns, inventory, settings,
    safeRepairs, safeUnlocks, safeSpecialOrders, safeLayaways, t,
  } = input;

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
    // R-REPORTS-PHONE-PROVIDER: group phone payments by PROVIDER (WebPOS,
    // QPay, VidaPay, H2O) instead of by carrier brand. `numbers` uses Set
    // internally so repeated payments to the same phone don't inflate
    // the displayed list — we expose a unique count + sample.
    // profitCents accumulates per-line profit (revenue × commRate), so a
    // single provider bucket can span multiple carriers with different
    // commission rates — each line contributes its own correct profit.
    const phonePaymentsByProvider: Record<string, {
      count: number;
      totalCents: number;
      profitCents: number;
      numbers: Set<string>;
    }> = {};
    // R-ACTIVATIONS-BY-CARRIER-V1: parallel bucket grouped by carrier
    // (AT&T, Verizon, T-Mobile, etc.) rather than by portal/provider. This
    // is the "how many activations per phone company" metric independent
    // of which top-up portal processed the payment. Pure additive — does
    // not touch the by-provider math.
    const activationsByCarrier: Record<string, {
      count: number;
      totalCents: number;
      profitCents: number;
      numbers: Set<string>;
    }> = {};
    const activePortals = getActivePortals(settings);
    const carrierPortalUrls = (settings as { carrierPortalUrls?: Record<string, string> }).carrierPortalUrls || {};

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

    // R-PERF-REPORTS-MAP-LOOKUP: replace per-item Array.find() lookups with
    // O(1) Map.get() lookups. With ~1200 sales × ~3 items × 4 entity finds
    // per item, the prior pattern was scanning safeRepairs/safeUnlocks/
    // safeLayaways/safeSpecialOrders thousands of times per render. Behavior
    // is identical: Map.get returns the same entity (or undefined) as
    // Array.find on the id key. Maps built once at the top of this useMemo
    // — they are recomputed only when the underlying arrays change (same
    // dep churn that already triggers this useMemo).
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
      // accumulator — productSalesTax is CA SALES TAX ONLY, never the
      // sum that conflated utility/mobility. Negative-total refund-audit
      // sales (status='completed', total<0) flow through this same loop
      // and naturally subtract from the matching bucket because their
      // own salesTax / utilityTax / mobileSurcharge fields are negative.
      // That's the per-bucket refund reversal P2 asked for — handled
      // automatically by the iteration without a global subtraction.
      productSalesTaxCents += (sale as any).salesTax || 0;
      utilityTaxCents += (sale as any).utilityTax || 0;
      mobilitySurchargeCents += (sale as any).mobileSurcharge || 0;
      // Legacy fallback: only when ALL three v2 fields are zero on this
      // sale, route the legacy aggregate to its OWN bucket. Never mix into
      // productSalesTaxCents (that's what corrupted the sales-tax bucket
      // before). Reports UI can surface legacyTaxAmountCents separately
      // for transparency, and the exposed `taxCollectedCents` aggregate
      // includes it so the displayed total still reconciles.
      const v2TaxSum = ((sale as any).salesTax || 0)
        + ((sale as any).utilityTax || 0)
        + ((sale as any).mobileSurcharge || 0);
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

      const emp = sale.employeeName || t('reports.unknownEmployee');
      if (!employeeStats[emp]) employeeStats[emp] = { transactions: 0, revenueCents: 0 };
      employeeStats[emp].transactions++;
      employeeStats[emp].revenueCents += saleTotal;

      for (const item of (sale.items || [])) {
        // R-SPECIAL-ORDERS-TAX-SEPARATED-REPORTING-FIX: changed const → let so
        // the SO branch below can reverse-tax a tax-inclusive cart line into
        // base for revenue reporting. No other branch reassigns this — pure
        // scope change, no semantic impact on other kinds.
        let revenueCents = lineRevenueCents(item);
        const qty = item.qty || (item as any).quantity || 1;

        // R-SPECIAL-ORDERS-REPORT-PROFIT-FIX: hoisted classification + SO
        // override above the Top Selling Items aggregation so the item row
        // also reflects the SO's locked base price (not the tax-inclusive
        // deposit). For SO-linked sale items we use the linked SpecialOrder
        // record's `price` and `cost` as the source of truth — the cart
        // line price can be inflated by tax or be a partial deposit, neither
        // of which represents the SO's revenue/profit math correctly.
        // Tax excess between the cart line and the SO's locked price is
        // routed to the existing productSalesTax bucket so it lands in
        // "Sales Tax / Total Taxes & Fees".
        const kind = classifyItem(item);
        let soOverrideCostCents: number | null = null;
        if (kind === 'special_order' && item.specialOrderId) {
          const linkedSO = ordersById.get(item.specialOrderId);
          if (linkedSO && (linkedSO.price || 0) > 0) {
            const soPrice = linkedSO.price;
            const soCost  = linkedSO.cost || 0;
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
          // R-COMMISSION-FIX-WRITE-AND-READ: align with TaxReportsModule.
          // Trust stamped item.commissionRate first (transaction-time
          // accounting standard). Recompute only if missing or invalid.
          let commRate = (item as any).commissionRate;
          if (commRate == null || commRate === 0) {
            let rawCarrier = ((item as any).carrier || (item as any).carrierName || (item as any).provider || '').trim();
            if (!rawCarrier && (item as any).name) {
              const match = String((item as any).name).match(/^([A-Za-z0-9\s&]+?)(?:\s*[-–]\s*|\s+Bill Payment)/i);
              if (match) rawCarrier = match[1].trim();
            }
            // BUG-3 (R-INV-BUGS): broader fallback for legacy phone_payment
            // sales whose carrier field is blank AND whose name doesn't fit
            // the "Carrier - phone" / "Carrier Bill Payment" prefix shape
            // (e.g. "H2O Wireless 25", "Verizon Refill"). Searches for any
            // known-carrier substring inside the item name; normalizeCarrier
            // below canonicalizes the match (h2o → 'H2O', etc.) so the
            // settings.carrierCommissions lookup hits.
            if (!rawCarrier && (item as any).name) {
              const knownMatch = String((item as any).name).match(
                /\b(h2o|t-?mobile|verizon|at&?t|cricket|tracfone|page\s*plus|simple\s*mobile|ultra(?:\s+mobile)?|telcel|boost|metro(?:\s*pcs)?|mint\s*mobile|visible)\b/i,
              );
              if (knownMatch) rawCarrier = knownMatch[1].trim();
            }
            const normalized = normalizeCarrier(rawCarrier);
            const carrierRate = normalized
              ? settings.carrierCommissions?.[normalized]
              : undefined;
            commRate = carrierRate
              ?? settings.defaultCommissionRate
              ?? 0.07;
          }
          // Carrier name is still computed (kept for provider lookup downstream)
          let carrierName = item.carrier || '';
          if (!carrierName && item.name) carrierName = item.name.split('-')[0].trim();
          const normalizedCarrier = normalizeCarrierName(carrierName);
          costCents = Math.round(revenueCents * (1 - commRate));
          profitCents = revenueCents - costCents;

          // Resolve provider: prefer item.portal (set by PhonePaymentModal
          // on new sales). For legacy sales without portal, derive it
          // from the carrier via the same matching logic the modal uses.
          let provider = (item.portal || '').trim();
          if (!provider && normalizedCarrier) {
            provider = getDefaultPortalId(normalizedCarrier, activePortals, carrierPortalUrls);
          }
          if (!provider) provider = t('reports.noProvider');

          if (!phonePaymentsByProvider[provider]) {
            phonePaymentsByProvider[provider] = { count: 0, totalCents: 0, profitCents: 0, numbers: new Set() };
          }
          phonePaymentsByProvider[provider].count += qty;
          phonePaymentsByProvider[provider].totalCents += revenueCents;
          phonePaymentsByProvider[provider].profitCents += profitCents;
          if (item.phoneNumber) phonePaymentsByProvider[provider].numbers.add(item.phoneNumber);

          // R-ACTIVATIONS-BY-CARRIER-V1: parallel bucket keyed by CARRIER
          // (not provider). Each phone_payment item = one activation event
          // (multi-line activations correctly count once per phone line).
          const carrierKey = normalizedCarrier || t('reports.noCarrier');
          if (!activationsByCarrier[carrierKey]) {
            activationsByCarrier[carrierKey] = { count: 0, totalCents: 0, profitCents: 0, numbers: new Set() };
          }
          activationsByCarrier[carrierKey].count += qty;
          activationsByCarrier[carrierKey].totalCents += revenueCents;
          activationsByCarrier[carrierKey].profitCents += profitCents;
          if (item.phoneNumber) activationsByCarrier[carrierKey].numbers.add(item.phoneNumber);
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
              // Adding laborCost here made every labor-bearing repair under-report
              // profit, and on a partial deposit/balance payment it swung the
              // margin to a false negative (e.g. -400% on the $25 balance of a
              // $125 labor-only / $0-parts repair). Cost basis = parts only.
              const partsCost = (linkedRepair.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || (p as any).quantity || 1), 0);
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
          // R-SPECIAL-ORDERS-REPORT-PROFIT-FIX: revenue already overridden
          // to linkedSO.price by the hoisted block above (and any tax
          // excess routed to productSalesTax). Cost comes from the linked
          // SO's locked `cost` field; falls back to the cart line's
          // stamped cost only when no SO record exists.
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
        // fractional payments toward a larger inventory item. Without this,
        // item.cost is rarely stamped on the cart line, so the kind branches
        // above leave costCents=0 and the full payment counts as 100% profit.
        // Use the linked layaway's parts cost scaled by payment/totalPrice
        // (round-half-to-even via Math.round inside the helper). Pseudo-item
        // path below already applies the same helper, so we only override
        // here when the item is NOT a pseudo-item (those paths are mutually
        // exclusive at the if/else below). No NaN risk: helper returns 0 for
        // any missing/zero denominator or missing inventory cost, and we
        // only override when proportional > 0 (otherwise existing math stands).
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

        // R-REPORTS-LAYAWAY-CATEGORY-FIX: layaway-linked items always bucket
        // under 'Layaway' regardless of surface kind/category. Cost/profit math
        // computed above is unchanged — only the bucket label shifts. The
        // pseudo-item proportional-cost path below uses `cat` after this rebind
        // so layaway pseudo-items also consolidate under 'Layaway'.
        if (item.layawayId) catName = 'Layaway';
        const cat = ensureCat(catName);
        cat.quantity += qty;
        cat.revenueCents += revenueCents;
        // Round 10 fix 3: pseudo-items (Layaway/Repair/SO/Unlock Deposit|Balance
        // placeholder cart lines) contribute to revenue/qty display but must NOT
        // distort margin — they carry no cost so they'd trivially hit 100% margin.
        // Round 12: when the pseudo-item has an entity link AND that linked
        // entity has reliable cost + price data, inherit a proportional slice of
        // cost (payment / totalPrice * totalCost). Falls back to Round 10
        // revenue-only behavior when the helper returns 0.
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
      // Jorge can reconcile against processor statements.
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
      const partsCost = (r.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || (p as any).quantity || 1), 0);
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
      (s, v) => s + ((v as any).totalValueCents || Math.round(((v as any).totalValue || 0) * 100)),
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
    // EXPOSED aggregate only — they no longer mutate any pure bucket.
    // customerReturn records carry a single `r.taxCents` aggregate without
    // a per-bucket breakdown, so the previous code (which forced the
    // adjustment into `salesTaxCents`) was the only way to apply it — but
    // that polluted the sales-tax bucket whenever the refund's tax was
    // really utility/mobility. The accumulator-level cleanup happens in
    // P1 above; here we just compute the customer-return adjustment as a
    // standalone number to subtract from the explicit `taxCollectedCents`
    // aggregate below. Negative-total refund-audit sales (R-EDIT-AUDIT
    // pattern, status='completed') reverse buckets in the main loop and
    // are NOT included in this adjustment.
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
    // - cleanSales: status!=='voided'/'refunded' AND total > 0 (real positive sales)
    // - refundedOriginals: status==='refunded' (original sale that customer returned)
    // - voided: status==='voided'
    // - refundSales: countable sale with total < 0 (REF-* audit rows from returns)
    const cleanSalesCount = filteredSales.filter((s) => (s.total || 0) > 0).length;
    const refundSalesCount = filteredSales.filter((s) => (s.total || 0) < 0).length;

    // ── R-REPORT-ZTAPE-RECONCILIATION-FIX ─────────────────────────────────
    // Additive reconciliation layer that does NOT mutate any of the legacy
    // report numbers above. Exposes the 6 explicit financial buckets the
    // shop's physical Z tape uses so the daily report can be cross-checked
    // line-by-line. Every value is derived from the same raw accumulators
    // the existing report already uses — no parallel summation, no new
    // refund handling, no behavioural change. Per-line conventions:
    //
    //   reconGrossCollected      = Σ sale.total for non-voided/non-refunded
    //                              sales (tax-included, negative refund-audit
    //                              rows already subtract) + standalone unlocks.
    //                              Matches Z tape NET2.
    //   reconTaxCollected        = Σ (salesTax + utilityTax + mobileSurcharge
    //                              + legacyTaxAmount) gross — pure-bucket sum,
    //                              not reduced by the customer-return tax
    //                              adjustment. Matches Z TTL TAX for a day
    //                              with no customer returns; on refund days
    //                              subtract reconRefundTaxAdjustment.
    //   reconFeeCollected        = Σ (cbeTotal + screenFeeTotal). Always
    //                              separate from tax because the Z tape's
    //                              TTL TAX line is sales-tax only.
    //   reconRefundTaxAdjustment = tax portion of returns in the period
    //                              (positive number, subtract to reconcile).
    //   reconOperationalRevenue  = grossCollected − taxCollected − feeCollected.
    //                              Pre-tax retail revenue. Matches Z NET1 on
    //                              days with no refunds; subtract returns'
    //                              non-tax subtotal to compare otherwise.
    //   reconNetRevenue          = grossCollected − totalReturns. Post-refund
    //                              gross. Same value as the existing
    //                              netRevenueCents above — re-exposed under
    //                              the recon namespace so the reconciliation
    //                              block reads self-consistently.
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
      // R-FINANCIAL-BUCKET-PURITY-FIX P1: `taxCollectedCents` is now an
      // EXPLICIT aggregate of the four pure tax buckets minus the
      // customer-return adjustment. Numeric value preserved versus the
      // previous accumulator (sum of the same fields, identical refund
      // subtraction) so every consumer reading this field — statCard
      // "Tax", "Total Fees" display, recon panel — sees the same dollar
      // amount it saw before. Pure buckets are exposed below for
      // bucket-level inspection.
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
      // into them. Remove this `recon` object only after the dedicated
      // reconciliation UI/section is removed too.
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
