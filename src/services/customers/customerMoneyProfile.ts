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

function classifyLineBasis(
  item: SaleItem,
  settings: CanonicalMoneySettings,
  inventory: InventoryItem[],
): EconomicBasis {
  const kind = classifyItem(item);
  if (kind === 'phone_payment') {
    const stamped = (item as { commissionRate?: number }).commissionRate;
    if (typeof stamped === 'number' && stamped > 0) return 'exact_stamped_commission';
    // Mirror ONLY the source lookup (not the math): the canonical chain is
    // stamped → carrierCommissions[normalizeCarrier(...)] → defaultCommissionRate → 0.07.
    let rawCarrier = String((item as { carrier?: string }).carrier
      || (item as { carrierName?: string }).carrierName
      || (item as { provider?: string }).provider || '').trim();
    if (!rawCarrier && item.name) rawCarrier = item.name.split(/[-–]|Bill Payment/i)[0].trim();
    const normalized = normalizeCarrier(rawCarrier);
    if (normalized && typeof settings.carrierCommissions?.[normalized] === 'number') {
      return 'exact_configured_commission';
    }
    if (typeof settings.defaultCommissionRate === 'number' && settings.defaultCommissionRate > 0) {
      return 'exact_configured_commission'; // configured DEFAULT rate
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
  transactionCount: number;
  averageTicketCents: number;
  visitCount: number;
  avgDaysBetweenVisits: number | null;
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
  if (visitCount >= 2) {
    const times = visitSales
      .map((s) => new Date(s.createdAt as string | Date).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);
    if (times.length >= 2) {
      const spanDays = (times[times.length - 1] - times[0]) / 86_400_000;
      avgDaysBetweenVisits = Math.round(spanDays / (times.length - 1));
    }
  }
  let topCategoryByProfit: string | null = null;
  let topCategoryProfitCents = 0;
  const topCat = [...canonical.categoriesByRevenue].sort((a, b) => b.profitCents - a.profitCents)[0];
  if (topCat && topCat.profitCents > 0) {
    topCategoryByProfit = topCat.name;
    topCategoryProfitCents = topCat.profitCents;
  }

  const transactionCount = canonical.txCount;
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
    transactionCount,
    averageTicketCents: transactionCount > 0 ? Math.round(canonical.grossSalesCents / transactionCount) : 0,
    visitCount,
    avgDaysBetweenVisits,
    topCategoryByProfit,
    topCategoryProfitCents,
    invoiceEconomics,
    canonical,
  };
}
