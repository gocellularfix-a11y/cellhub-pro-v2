// ============================================================
// CellHub Pro — Customer Money Profile (CELLHUB-INTELLIGENCE-I2B-0)
//
// THE customer-attributable money truth for Customer 360. Financial
// calculations are owned by computeReportMoneyStats — this service
// performs ATTRIBUTION, snapshot filtering, field mapping and SOURCE
// CLASSIFICATION only. It copies no commission, refund, exchange, tax or
// COGS formula.
//
// Metric definitions (canonical mapping):
//   Total Collected        = grossSalesCents (everything the customer paid:
//                            merchandise + sales/utility/mobility taxes +
//                            CBE/screen fees; standalone repairs/unlocks
//                            included by the canonical rules)
//   Profit-Bearing Revenue = netRevenueBeforeTaxCents (the commissionable /
//                            pre-tax merchandise base — taxes and
//                            pass-through fees NEVER enter this number)
//   Profit                 = totalProfitCents (canonical economics:
//                            commission precedence stamped → configured
//                            carrier → configured default; exact refund/
//                            exchange reversal; negative preserved)
//   Margin                 = profitMargin (profit ÷ profit-bearing revenue,
//                            meaningful only when the basis is positive).
//   For a pure carrier-payment history this IS the commission margin: a
//   customer with only AT&T payments at 10% shows 10.0%.
//
// Store-wide adjustments that cannot be attributed to one customer
// (vendor returns) are EXCLUDED from the snapshot.
// ============================================================

import type {
  Customer, Sale, SaleItem, Repair, Unlock, Layaway, SpecialOrder,
  CustomerReturn, InventoryItem,
} from '@/store/types';
import { computeReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { ReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import type { CanonicalMoneySettings } from '@/services/intelligence/adapters/reportMoneyAdapter';
import { classifyItem, lineRevenueCents } from '@/services/reports/phonePaymentReporting';
import { normalizeLocalDayRange } from '@/utils/reportRange';
import type { LocalDayRange } from '@/utils/reportRange';
import { normalizePhone, normalizeCarrier } from '@/utils/normalize';

// ── Attribution (stable identity precedence — never name-only) ──
//   1. customerId
//   2. returns: originalSaleId linking to an attributed sale
//   3. normalized phone (the repository-established fallback for unlinked
//      legacy records; same rule CustomerModule has always used)
// Two customers with the same NAME can never inherit each other's records.

function phoneKey(raw: string | undefined | null): string {
  const p = normalizePhone(String(raw || ''));
  return p.length >= 10 ? p.slice(-10) : '';
}

export interface CustomerCollectionsInput {
  sales: Sale[];
  repairs: Repair[];
  unlocks: Unlock[];
  layaways: Layaway[];
  specialOrders: SpecialOrder[];
  customerReturns: CustomerReturn[];
}

export interface AttributedCustomerCollections {
  sales: Sale[];
  repairs: Repair[];
  unlocks: Unlock[];
  layaways: Layaway[];
  specialOrders: SpecialOrder[];
  customerReturns: CustomerReturn[];
}

export function attributeCustomerCollections(
  customer: Customer,
  input: CustomerCollectionsInput,
): AttributedCustomerCollections {
  const id = customer.id;
  const custPhone = phoneKey(customer.phone);
  const belongs = (recId: string | undefined, recPhone: string | undefined | null): boolean => {
    if (recId && recId === id) return true;
    if (recId && recId !== id) return false; // linked to ANOTHER customer — never inherit
    const p = phoneKey(recPhone);
    return !!custPhone && !!p && p === custPhone;
  };

  const sales = (input.sales || []).filter((s) => belongs(s.customerId, s.customerPhone));
  const saleIds = new Set(sales.map((s) => s.id));

  const customerReturns = (input.customerReturns || []).filter((r) => {
    if (r.originalSaleId && saleIds.has(r.originalSaleId)) return true;
    const rid = (r as { customerId?: string }).customerId;
    return belongs(rid, r.customerPhone);
  });

  // Entities: attributable by identity OR referenced by the customer's own
  // sale lines (a linked entity on their sale is economically theirs — the
  // canonical service needs it for exact linked-entity costs).
  const referencedRepairIds = new Set<string>();
  const referencedUnlockIds = new Set<string>();
  const referencedLayawayIds = new Set<string>();
  const referencedSOIds = new Set<string>();
  for (const s of sales) {
    for (const it of (s.items || [])) {
      if (it.repairId) referencedRepairIds.add(it.repairId);
      if (it.unlockId) referencedUnlockIds.add(it.unlockId);
      if (it.layawayId) referencedLayawayIds.add(it.layawayId);
      if (it.specialOrderId) referencedSOIds.add(it.specialOrderId);
    }
  }
  const repairs = (input.repairs || []).filter((r) =>
    referencedRepairIds.has(r.id) || belongs((r as { customerId?: string }).customerId, r.customerPhone));
  const unlocks = (input.unlocks || []).filter((u) =>
    referencedUnlockIds.has(u.id) || belongs((u as { customerId?: string }).customerId, u.customerPhone));
  const layaways = (input.layaways || []).filter((l) =>
    referencedLayawayIds.has(l.id) || belongs((l as { customerId?: string }).customerId, (l as { customerPhone?: string }).customerPhone));
  const specialOrders = (input.specialOrders || []).filter((o) =>
    referencedSOIds.has(o.id) || belongs((o as { customerId?: string }).customerId, (o as { customerPhone?: string }).customerPhone));

  return { sales, repairs, unlocks, layaways, specialOrders, customerReturns };
}

// ── Coverage / rate-source classification (descriptive only — the MONEY
//    comes from the canonical service; this layer never alters it) ──

export type EconomicBasis =
  | 'exact_stamped_cost'
  | 'exact_stamped_commission'
  | 'exact_configured_commission'
  | 'exact_linked_entity_cost'
  | 'inventory_fallback'
  | 'estimated'
  | 'unavailable';

/** I2B-0.1: phone-payment rate provenance — mirrors ONLY the canonical
 *  source LOOKUP (stamped → carrierCommissions[normalizeCarrier(...)] →
 *  defaultCommissionRate → hardcoded 0.07 tail), never the math. Shared by
 *  classification and the owner diagnostic trace. */
export type CommissionRateSource =
  | 'stamped' | 'configured_carrier' | 'configured_default' | 'estimated_fallback';

export function describePhonePaymentRate(
  item: SaleItem,
  settings: CanonicalMoneySettings,
): { rate: number; source: CommissionRateSource; carrier: string | null } {
  let rawCarrier = String((item as { carrier?: string }).carrier
    || (item as { carrierName?: string }).carrierName
    || (item as { provider?: string }).provider || '').trim();
  if (!rawCarrier && item.name) rawCarrier = item.name.split(/[-–]|Bill Payment/i)[0].trim();
  const normalized = normalizeCarrier(rawCarrier);
  const carrier = normalized || rawCarrier || null;
  const stamped = (item as { commissionRate?: number }).commissionRate;
  if (typeof stamped === 'number' && stamped > 0) return { rate: stamped, source: 'stamped', carrier };
  const configured = normalized ? settings.carrierCommissions?.[normalized] : undefined;
  if (typeof configured === 'number') return { rate: configured, source: 'configured_carrier', carrier };
  if (typeof settings.defaultCommissionRate === 'number' && settings.defaultCommissionRate > 0) {
    return { rate: settings.defaultCommissionRate, source: 'configured_default', carrier };
  }
  return { rate: 0.07, source: 'estimated_fallback', carrier }; // canonical hardcoded tail
}

function classifyLineBasis(
  item: SaleItem,
  settings: CanonicalMoneySettings,
  inventory: InventoryItem[],
): EconomicBasis {
  const kind = classifyItem(item);
  if (kind === 'phone_payment') {
    const { source } = describePhonePaymentRate(item, settings);
    if (source === 'stamped') return 'exact_stamped_commission';
    if (source === 'configured_carrier' || source === 'configured_default') {
      return 'exact_configured_commission';
    }
    return 'estimated'; // canonical hardcoded 0.07 tail — not a configured value
  }
  if (kind === 'topup') return 'estimated';           // fixed 90% heuristic
  if (kind === 'cc_fee' || kind === 'exchange_credit') return 'exact_stamped_cost'; // definitional (cost 0)
  if (kind === 'repair') {
    return item.repairId ? 'exact_linked_entity_cost' : 'estimated'; // 35% fallback when unlinked
  }
  if (kind === 'unlock' || kind === 'special_order') {
    return (item.unlockId || item.specialOrderId) ? 'exact_linked_entity_cost'
      : (typeof item.cost === 'number' ? 'exact_stamped_cost' : 'unavailable');
  }
  // product / service
  if (typeof item.cost === 'number' && !Number.isNaN(item.cost)) return 'exact_stamped_cost';
  if (item.name && inventory.some((i) => i.name?.toLowerCase() === item.name.toLowerCase())) {
    return 'inventory_fallback';
  }
  return 'unavailable';
}

const EXACT_BASES: ReadonlySet<EconomicBasis> = new Set([
  'exact_stamped_cost', 'exact_stamped_commission', 'exact_configured_commission',
  'exact_linked_entity_cost', 'inventory_fallback',
]);

// ── Profile contract ─────────────────────────────────────────

export interface InvoiceEconomics {
  saleId: string;
  invoiceNumber: string;
  createdAt: unknown;
  status: string;
  /** Everything paid on this invoice (sale.total). */
  totalCollectedCents: number;
  /** Pre-tax profit-bearing base (subtotalAfterDiscount ?? subtotal). */
  profitBearingCents: number;
  /** Taxes + pass-through on this invoice (salesTax+utility+mobility(+legacy) + CBE + screen). */
  taxAndPassThroughCents: number;
  /** Exact canonical per-sale profit (items + top-level CC fee). */
  profitCents: number;
  /** Worst (least-exact) economic basis among this invoice's lines. */
  basis: EconomicBasis;
}

export interface CustomerMoneyProfile {
  totalCollectedCents: number;
  profitBearingRevenueCents: number;
  profitCents: number;
  marginPercent: number;
  marginMeaningful: boolean;
  profitEstimated: boolean;
  /** % of profit-bearing revenue with a determinable EXACT economic basis. */
  exactCoveragePercent: number;
  estimatedPercent: number;
  unavailablePercent: number;
  returnsCents: number;
  /** I2B-0.1: canonical net after returns/refunds (tax-inclusive netSalesCents). */
  netAfterReturnsCents: number;
  /** FINANCIAL transactions: countable sales + standalone completed
   *  repairs/unlocks — the exact population behind totalCollectedCents.
   *  Appointments and returns NEVER count; POS-linked entities count once. */
  transactionCount: number;
  averageTicketCents: number;
  visitCount: number;
  avgDaysBetweenVisits: number | null;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  topCategoryByProfit: string | null;
  topCategoryProfitCents: number;
  invoiceEconomics: InvoiceEconomics[];
  /** The full canonical stats for advanced consumers/tests. */
  canonical: ReportMoneyStats;
}

export interface CustomerMoneyProfileInput extends CustomerCollectionsInput {
  customer: Customer;
  inventory: InventoryItem[];
  settings: CanonicalMoneySettings;
  /** Default: all-time (1970-01-01 → today, local days). */
  periodRange?: LocalDayRange;
}

const NEUTRAL_LABELS = { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' };

function toLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeCustomerMoneyProfile(input: CustomerMoneyProfileInput): CustomerMoneyProfile {
  const attributed = attributeCustomerCollections(input.customer, input);
  return computeProfileFromAttributed(attributed, input);
}

/** Core compute over PRE-ATTRIBUTED collections. Shared by the single-customer
 *  path, the batched customer-list path and the IntelligenceEngine chat path
 *  (I2B-0.2) — one implementation, no drift. Callers MUST obtain the
 *  attributed collections from attributeCustomerCollections (or the batch
 *  bucketing, which replicates it) — never from an ad-hoc filter. */
export function computeProfileFromAttributed(
  attributed: AttributedCustomerCollections,
  input: Omit<CustomerMoneyProfileInput, keyof CustomerCollectionsInput> & Partial<CustomerCollectionsInput>,
): CustomerMoneyProfile {
  const periodRange = input.periodRange
    ?? normalizeLocalDayRange('1970-01-01', toLocalYMD(new Date()));

  // Canonical money on the customer-attributable snapshot. Vendor returns
  // are STORE-WIDE COGS adjustments — never attributable to one customer.
  const canonical = computeReportMoneyStats({
    sales: attributed.sales,
    repairs: attributed.repairs,
    unlocks: attributed.unlocks,
    specialOrders: attributed.specialOrders,
    layaways: attributed.layaways,
    inventory: input.inventory || [],
    customerReturns: attributed.customerReturns,
    vendorReturns: [],
    settings: (input.settings || {}) as CustomerMoneyProfileInput['settings'] & import('@/store/types').StoreSettings,
    periodRange,
    labels: NEUTRAL_LABELS,
  });

  // ── Coverage classification over the gross-activity sales ──
  const inRangeCountable = attributed.sales.filter((s) => {
    const id = s.id;
    return Object.prototype.hasOwnProperty.call(canonical.perSaleEconomics, id);
  });
  let exactRev = 0, estimatedRev = 0, unavailableRev = 0;
  const invoiceEconomics: InvoiceEconomics[] = [];
  const basisRank: Record<EconomicBasis, number> = {
    exact_stamped_cost: 0, exact_stamped_commission: 0, exact_configured_commission: 0,
    exact_linked_entity_cost: 0, inventory_fallback: 1, estimated: 2, unavailable: 3,
  };
  for (const sale of inRangeCountable) {
    // Representative basis = the first line's classification, downgraded to
    // the WORST (least-exact) tier found among the invoice's lines.
    let worst: EconomicBasis | null = null;
    for (const item of (sale.items || [])) {
      const rev = Math.abs(lineRevenueCents(item));
      const basis = classifyLineBasis(item, input.settings || {}, input.inventory || []);
      if (EXACT_BASES.has(basis)) exactRev += rev;
      else if (basis === 'estimated') estimatedRev += rev;
      else unavailableRev += rev;
      if (worst === null || basisRank[basis] > basisRank[worst]) worst = basis;
    }
    const e = canonical.perSaleEconomics[sale.id];
    const v2Tax = ((sale as unknown as { salesTax?: number }).salesTax || 0)
      + ((sale as unknown as { utilityTax?: number }).utilityTax || 0)
      + ((sale as unknown as { mobileSurcharge?: number }).mobileSurcharge || 0);
    const taxPart = v2Tax !== 0 ? v2Tax : (sale.taxAmount || 0);
    invoiceEconomics.push({
      saleId: sale.id,
      invoiceNumber: sale.invoiceNumber || '',
      createdAt: sale.createdAt,
      status: String(sale.status || ''),
      totalCollectedCents: sale.total || 0,
      profitBearingCents: sale.subtotalAfterDiscount ?? (sale.subtotal || 0),
      taxAndPassThroughCents: taxPart + (sale.cbeTotal || 0) + (sale.screenFeeTotal || 0),
      profitCents: e ? e.itemProfitCents + e.ccFeeProfitCents : 0,
      basis: worst ?? 'exact_stamped_cost',
    });
  }
  const classifiedRev = exactRev + estimatedRev + unavailableRev;
  const pct = (part: number) => (classifiedRev > 0 ? Math.round((part / classifiedRev) * 100) : 100);
  const exactCoveragePercent = classifiedRev > 0 ? pct(exactRev) : 100;
  const estimatedPercent = classifiedRev > 0 ? pct(estimatedRev) : 0;
  const unavailablePercent = classifiedRev > 0 ? Math.max(0, 100 - pct(exactRev) - pct(estimatedRev)) : 0;

  // ── Visit stats (non-money; mirrors the legacy definitions) ──
  const visitSales = inRangeCountable;
  const visitCount = visitSales.length;
  let avgDaysBetweenVisits: number | null = null;
  const visitTimes = visitSales
    .map((s) => new Date(s.createdAt as string | Date).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (visitTimes.length >= 2) {
    const spanDays = (visitTimes[visitTimes.length - 1] - visitTimes[0]) / 86_400_000;
    avgDaysBetweenVisits = Math.round(spanDays / (visitTimes.length - 1));
  }
  const firstVisitAt = visitTimes.length > 0 ? new Date(visitTimes[0]) : null;
  const lastVisitAt = visitTimes.length > 0 ? new Date(visitTimes[visitTimes.length - 1]) : null;
  let topCategoryByProfit: string | null = null;
  let topCategoryProfitCents = 0;
  const topCat = [...canonical.categoriesByRevenue].sort((a, b) => b.profitCents - a.profitCents)[0];
  if (topCat && topCat.profitCents > 0) {
    topCategoryByProfit = topCat.name;
    topCategoryProfitCents = topCat.profitCents;
  }

  // I2B-0.1: FINANCIAL transactions = the exact population that produced
  // grossSalesCents — countable sales + standalone completed repairs/unlocks.
  // Appointments/returns never count; POS-linked entities are already
  // excluded from the standalone counts (never double-counted).
  const transactionCount = canonical.txCount
    + canonical.standaloneRepairCount + canonical.standaloneUnlockCount;
  return {
    totalCollectedCents: canonical.grossSalesCents,
    profitBearingRevenueCents: canonical.netRevenueBeforeTaxCents,
    profitCents: canonical.totalProfitCents,
    marginPercent: canonical.profitMargin,
    marginMeaningful: canonical.profitMarginMeaningful,
    profitEstimated: canonical.profitAdjustmentEstimated || estimatedRev > 0,
    exactCoveragePercent,
    estimatedPercent,
    unavailablePercent,
    returnsCents: canonical.returnAndRefundAdjustmentsCents,
    netAfterReturnsCents: canonical.netSalesCents,
    transactionCount,
    averageTicketCents: transactionCount > 0 ? Math.round(canonical.grossSalesCents / transactionCount) : 0,
    visitCount,
    avgDaysBetweenVisits,
    firstVisitAt,
    lastVisitAt,
    topCategoryByProfit,
    topCategoryProfitCents,
    invoiceEconomics,
    canonical,
  };
}

// ══ I2B-0.1: BATCHED customer-list profiles ══════════════════
// One pass over every collection pre-buckets records per customer with the
// SAME attribution precedence as attributeCustomerCollections (customerId →
// originalSaleId linkage → normalized phone; a record linked to ANOTHER
// customer is never inherited; two customers sharing a phone both match
// unlinked records — identical to the per-customer filter semantics). Then
// the shared core runs per customer over its small bucket. Replaces the
// legacy O(customers × sales) list reduce.

export interface CustomerProfilesBatchInput extends CustomerCollectionsInput {
  inventory: InventoryItem[];
  settings: CanonicalMoneySettings;
  periodRange?: LocalDayRange;
}

export function computeCustomerMoneyProfiles(
  customers: Customer[],
  input: CustomerProfilesBatchInput,
): Map<string, CustomerMoneyProfile> {
  const ids = new Set(customers.map((c) => c.id));
  const phoneOwners = new Map<string, string[]>(); // phoneKey → customerIds
  for (const c of customers) {
    const p = phoneKey(c.phone);
    if (!p) continue;
    const list = phoneOwners.get(p);
    if (list) list.push(c.id); else phoneOwners.set(p, [c.id]);
  }
  // Owners of one record under the belongs() precedence.
  const ownersOf = (recId: string | undefined, recPhone: string | undefined | null): string[] => {
    if (recId) return ids.has(recId) ? [recId] : []; // linked → that customer only (or nobody)
    const p = phoneKey(recPhone);
    return p ? (phoneOwners.get(p) || []) : [];
  };

  interface Bucket extends AttributedCustomerCollections { refRepairs: Set<string>; refUnlocks: Set<string>; refLayaways: Set<string>; refSOs: Set<string> }
  const buckets = new Map<string, Bucket>();
  const bucketFor = (cid: string): Bucket => {
    let b = buckets.get(cid);
    if (!b) {
      b = { sales: [], repairs: [], unlocks: [], layaways: [], specialOrders: [], customerReturns: [],
        refRepairs: new Set(), refUnlocks: new Set(), refLayaways: new Set(), refSOs: new Set() };
      buckets.set(cid, b);
    }
    return b;
  };

  const saleOwners = new Map<string, string[]>(); // saleId → owner customerIds
  for (const s of (input.sales || [])) {
    const owners = ownersOf(s.customerId, s.customerPhone);
    if (owners.length === 0) continue;
    saleOwners.set(s.id, owners);
    for (const cid of owners) {
      const b = bucketFor(cid);
      b.sales.push(s);
      for (const it of (s.items || [])) {
        if (it.repairId) b.refRepairs.add(it.repairId);
        if (it.unlockId) b.refUnlocks.add(it.unlockId);
        if (it.layawayId) b.refLayaways.add(it.layawayId);
        if (it.specialOrderId) b.refSOs.add(it.specialOrderId);
      }
    }
  }
  for (const r of (input.customerReturns || [])) {
    const linked = r.originalSaleId ? (saleOwners.get(r.originalSaleId) || []) : [];
    const own = ownersOf((r as { customerId?: string }).customerId, r.customerPhone);
    const all = new Set([...linked, ...own]);
    for (const cid of all) bucketFor(cid).customerReturns.push(r);
  }
  for (const rec of (input.repairs || [])) {
    const own = ownersOf((rec as { customerId?: string }).customerId, rec.customerPhone);
    const set = new Set(own);
    for (const [cid, b] of buckets) if (b.refRepairs.has(rec.id)) set.add(cid);
    for (const cid of set) bucketFor(cid).repairs.push(rec);
  }
  for (const rec of (input.unlocks || [])) {
    const own = ownersOf((rec as { customerId?: string }).customerId, rec.customerPhone);
    const set = new Set(own);
    for (const [cid, b] of buckets) if (b.refUnlocks.has(rec.id)) set.add(cid);
    for (const cid of set) bucketFor(cid).unlocks.push(rec);
  }
  for (const rec of (input.layaways || [])) {
    const own = ownersOf((rec as { customerId?: string }).customerId, (rec as { customerPhone?: string }).customerPhone);
    const set = new Set(own);
    for (const [cid, b] of buckets) if (b.refLayaways.has(rec.id)) set.add(cid);
    for (const cid of set) bucketFor(cid).layaways.push(rec);
  }
  for (const rec of (input.specialOrders || [])) {
    const own = ownersOf((rec as { customerId?: string }).customerId, (rec as { customerPhone?: string }).customerPhone);
    const set = new Set(own);
    for (const [cid, b] of buckets) if (b.refSOs.has(rec.id)) set.add(cid);
    for (const cid of set) bucketFor(cid).specialOrders.push(rec);
  }

  // One shared periodRange so every profile in the batch is consistent.
  const periodRange = input.periodRange
    ?? normalizeLocalDayRange('1970-01-01', toLocalYMD(new Date()));

  const out = new Map<string, CustomerMoneyProfile>();
  const EMPTY: AttributedCustomerCollections = { sales: [], repairs: [], unlocks: [], layaways: [], specialOrders: [], customerReturns: [] };
  for (const c of customers) {
    const b = buckets.get(c.id);
    out.set(c.id, computeProfileFromAttributed(b ?? EMPTY, {
      customer: c, inventory: input.inventory || [], settings: input.settings || {}, periodRange,
    }));
  }
  return out;
}

/** Reference-keyed memo for the batched profiles. Any changed input
 *  reference (store switch → new scoped arrays; any transaction update →
 *  new collection array; settings change) invalidates the cache. Array
 *  LENGTH is never consulted — identity only, so an in-place-equal-length
 *  replacement still recomputes. Correctness is never traded for caching. */
export function createCustomerProfilesCache(): {
  get(customers: Customer[], input: CustomerProfilesBatchInput): Map<string, CustomerMoneyProfile>;
} {
  let last: { customers: Customer[]; input: CustomerProfilesBatchInput; result: Map<string, CustomerMoneyProfile> } | null = null;
  return {
    get(customers, input) {
      if (last
        && last.customers === customers
        && last.input.sales === input.sales
        && last.input.repairs === input.repairs
        && last.input.unlocks === input.unlocks
        && last.input.layaways === input.layaways
        && last.input.specialOrders === input.specialOrders
        && last.input.customerReturns === input.customerReturns
        && last.input.inventory === input.inventory
        && last.input.settings === input.settings
        && last.input.periodRange === input.periodRange) {
        return last.result;
      }
      const result = computeCustomerMoneyProfiles(customers, input);
      last = { customers, input, result };
      return result;
    },
  };
}

// ══ I2B-0.1 Part G: owner/development diagnostic trace ═══════
// Pure, read-only invoice-level economics trace over live records. Never
// mutates transactions, never logs — callers decide what to do with the
// rows. Money comes from the canonical profile; rate provenance mirrors the
// canonical source lookup (describePhonePaymentRate), never the math.

export interface CustomerInvoiceTraceRow {
  customerId: string;
  invoiceNumber: string;
  createdAt: unknown;
  totalCollectedCents: number;
  profitBearingCents: number;
  taxAndPassThroughCents: number;
  profitCents: number;
  /** Commission rate resolved for the invoice's phone-payment line(s); null when none. */
  commissionRate: number | null;
  economicBasis: EconomicBasis;
  rateSource: CommissionRateSource | null;
  carrier: string | null;
  warnings: string[];
}

export function traceCustomerInvoiceEconomics(
  input: CustomerMoneyProfileInput,
): { customerId: string; summary: Pick<CustomerMoneyProfile,
      'totalCollectedCents' | 'profitBearingRevenueCents' | 'profitCents' | 'marginPercent'
      | 'marginMeaningful' | 'returnsCents' | 'netAfterReturnsCents' | 'transactionCount'
      | 'exactCoveragePercent' | 'estimatedPercent' | 'unavailablePercent'>;
    invoices: CustomerInvoiceTraceRow[] } {
  const profile = computeCustomerMoneyProfile(input);
  const salesById = new Map((input.sales || []).map((s) => [s.id, s]));
  const invoices: CustomerInvoiceTraceRow[] = profile.invoiceEconomics.map((inv) => {
    const sale = salesById.get(inv.saleId);
    const warnings: string[] = [];
    const rates: Array<{ rate: number; source: CommissionRateSource; carrier: string | null }> = [];
    for (const it of (sale?.items || [])) {
      if (classifyItem(it) === 'phone_payment') rates.push(describePhonePaymentRate(it, input.settings || {}));
    }
    const first = rates[0] || null;
    if (rates.length > 1 && rates.some((r) => r.rate !== first!.rate || r.source !== first!.source)) {
      warnings.push('multiple_distinct_commission_rates_on_invoice');
    }
    if (first?.source === 'estimated_fallback') warnings.push('no_configured_commission_rate_hardcoded_7pct_tail');
    if (inv.basis === 'estimated') warnings.push('estimated_economic_basis');
    if (inv.basis === 'unavailable') warnings.push('unavailable_economic_basis');
    if ((sale?.items || []).length === 0) warnings.push('invoice_has_no_line_items');
    return {
      customerId: input.customer.id,
      invoiceNumber: inv.invoiceNumber,
      createdAt: inv.createdAt,
      totalCollectedCents: inv.totalCollectedCents,
      profitBearingCents: inv.profitBearingCents,
      taxAndPassThroughCents: inv.taxAndPassThroughCents,
      profitCents: inv.profitCents,
      commissionRate: first ? first.rate : null,
      economicBasis: inv.basis,
      rateSource: first ? first.source : null,
      carrier: first ? first.carrier : null,
      warnings,
    };
  });
  return {
    customerId: input.customer.id,
    summary: {
      totalCollectedCents: profile.totalCollectedCents,
      profitBearingRevenueCents: profile.profitBearingRevenueCents,
      profitCents: profile.profitCents,
      marginPercent: profile.marginPercent,
      marginMeaningful: profile.marginMeaningful,
      returnsCents: profile.returnsCents,
      netAfterReturnsCents: profile.netAfterReturnsCents,
      transactionCount: profile.transactionCount,
      exactCoveragePercent: profile.exactCoveragePercent,
      estimatedPercent: profile.estimatedPercent,
      unavailablePercent: profile.unavailablePercent,
    },
    invoices,
  };
}
