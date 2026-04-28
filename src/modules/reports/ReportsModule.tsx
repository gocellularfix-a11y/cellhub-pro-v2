// ============================================================
// CellHub Pro — Reports Module (REWRITE — Plan A)
// Built from scratch using the HTML legacy as accounting blueprint,
// adjusted to v2's CENTS-based store schema.
//
// Core conventions:
//   - ALL money flows through this file in CENTS (integer).
//   - Conversion to dollars happens ONLY at display time via formatCurrency().
//   - Voided/refunded sales are filtered using `status` enum, NOT booleans.
//   - Tax/surcharges are NOT included in category revenue (pass-through).
//   - Profit margin is computed against subtotalBeforeTax (not gross).
//   - Standalone repairs use real parts/labor cost when available.
// ============================================================

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { formatDate, formatDateTime } from '@/utils/dates';
import { loadLocal } from '@/services/storage';
import { SearchInput } from '@/components/ui';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { usePrint, openPrintWindow } from '@/hooks/usePrint';
import { generateReceiptHtml, renderBarcodeSvg } from '@/modules/pos/ReceiptModal';
import { normalizeCarrier } from '@/utils/normalize';
import type { Sale, SaleItem, Repair, Unlock, SpecialOrder, Layaway, InventoryItem } from '@/store/types';
import { buildCancellationReceiptHtml } from './printCancellationReceipt';
import { getActivePortals, getDefaultPortalId } from '@/config/paymentPortals';

// ── Constants & helpers ──────────────────────────────────────

const REPAIR_COST_FALLBACK = 0.35;  // when parts/labor not tracked
const REPAIR_PROFIT_FALLBACK = 0.65;
const TOPUP_COST_RATE = 0.90;
const TOPUP_PROFIT_RATE = 0.10;

function toLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isValidDate(d: Date): boolean {
  return !isNaN(d.getTime());
}

function toDateSafe(v: unknown): Date | null {
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

/**
 * HTML escape for print window interpolation. Used by printReport to sanitize
 * all user-controlled fields (store name, item names, employee names, etc.)
 * before injecting into the document. Same pattern as ReceiptModal (round 12).
 * DO NOT use for React render paths — React escapes automatically.
 */
function escHtml(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sale counts as revenue iff status is not voided/refunded outright. */
function isCountableSale(s: Sale): boolean {
  return s.status !== 'voided' && s.status !== 'refunded';
}

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
function isPseudoItem(item: SaleItem): boolean {
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
function getLayawayProportionalCost(entity: Layaway, inventory: InventoryItem[], paymentCents: number): number {
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

function getSpecialOrderProportionalCost(entity: SpecialOrder, _inventory: InventoryItem[], paymentCents: number): number {
  if (!entity || !paymentCents) return 0;
  const totalCostCents = entity.cost || 0;
  const denominator = entity.price || 0;
  if (totalCostCents <= 0 || denominator <= 0) return 0;
  return Math.round(totalCostCents * (paymentCents / denominator));
}

function getRepairProportionalCost(entity: Repair, _inventory: InventoryItem[], paymentCents: number): number {
  if (!entity || !paymentCents) return 0;
  const partsCost = (entity.parts || []).reduce(
    (s, p) => s + (p.cost || 0) * (p.qty || (p as any).quantity || 1),
    0,
  );
  const laborCost = entity.laborCost || 0;
  const totalCostCents = partsCost + laborCost;
  const denominator = entity.total ?? entity.estimatedCost ?? 0;
  if (totalCostCents <= 0 || denominator <= 0) return 0;
  return Math.round(totalCostCents * (paymentCents / denominator));
}

function getUnlockProportionalCost(entity: Unlock, _inventory: InventoryItem[], paymentCents: number): number {
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
function normalizeCategoryKey(raw: string): string {
  return String(raw || '').trim().toLowerCase() || 'products';
}

/** Repair counts as completed revenue iff customer paid in full and picked up. */
function isRepairCompleted(r: Repair): boolean {
  const status = String(r.status || '').toLowerCase();
  const completedStatuses = ['complete', 'completed', 'picked_up', 'pickedup'];
  return completedStatuses.includes(status) && (r.balance ?? 0) === 0;
}

function isUnlockCompleted(u: Unlock): boolean {
  const status = String(u.status || '').toLowerCase();
  return status === 'completed' || status === 'complete';
}

function normalizeCarrierName(raw: string): string {
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
function lineRevenueCents(item: SaleItem): number {
  return (item.price || 0) * (item.qty || (item as any).quantity || 1);
}

/** Item type detection — handles legacy `type` and v2 `category` fields. */
type ItemKind = 'phone_payment' | 'topup' | 'repair' | 'unlock' | 'special_order' | 'cc_fee' | 'service' | 'product';

function classifyItem(item: SaleItem): ItemKind {
  const cat = String(item.category || '').toLowerCase();
  // legacy `type` field on sale items (not in TS type, but lives in real data)
  const type = String((item as unknown as { type?: string }).type || '').toLowerCase();

  if (type === 'phone_payment' || cat === 'phone_payment') return 'phone_payment';
  if (type === 'topup' || cat === 'topup' || cat === 'top_up' || cat === 'top-up') return 'topup';
  if (type === 'repair' || item.repairId) return 'repair';
  if (type === 'unlock' || item.unlockId) return 'unlock';
  if (type === 'special_order' || item.specialOrderId) return 'special_order';
  if (type === 'service' || cat === 'service' || cat === 'services') {
    // legacy services that are actually repairs
    const n = (item.name || '').toLowerCase();
    if (n.includes('repair') || n.includes('reparación')) return 'repair';
    if (n.includes('unlock') || n.includes('desbloqueo')) return 'unlock';
    return 'service';
  }
  return 'product';
}

// ── Returns: bridge legacy localStorage (DOLLARS) to cents ───

interface CustomerReturnRecord {
  id: string;
  returnNumber: string;
  originalInvoice: string;
  originalSaleId: string | null;
  customerName: string;
  customerPhone: string;
  employeeName: string;
  createdAt: string;
  reason: string;
  resolution: string;
  notes: string;
  items: Array<{ id: string; name: string; price: number; qty: number; subtotal: number; tax: number; total: number }>;
  subtotal: number;     // DOLLARS in storage
  taxRefunded: number;  // DOLLARS in storage
  total: number;        // DOLLARS in storage
}

interface NormalizedReturn {
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
}

function loadReturns(): NormalizedReturn[] {
  const raw = loadLocal<CustomerReturnRecord[]>('customer_returns', []);
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    id: r.id,
    returnNumber: r.returnNumber || '',
    originalInvoice: r.originalInvoice || '',
    originalSaleId: r.originalSaleId,
    customerName: r.customerName || '',
    reason: r.reason || '',
    resolution: r.resolution || '',
    createdAt: toDateSafe(r.createdAt),
    // CustomerReturn amounts are always DOLLARS (per types.ts). Convert to cents.
    subtotalCents: Math.round((r.subtotal || 0) * 100),
    taxCents: Math.round((r.taxRefunded || 0) * 100),
    totalCents: Math.round((r.total || 0) * 100),
  }));
}

// ============================================================
//  Component
// ============================================================

export default function ReportsModule() {
  const {
    state: { sales, repairs, unlocks, specialOrders, layaways, inventory, customers, settings, globalSearchTerm, currentEmployee, customerReturns, vendorReturns },
    dispatch,
  } = useApp();

  const { t, locale } = useTranslation();
  const { printHtml } = usePrint();
  // Round 10.1 fix 4: grammatical singular/plural. n===1 → singular, else plural
  // (0 uses plural in both EN/ES).
  const pluralize = (n: number, singular: string, plural: string) => (n === 1 ? singular : plural);

  // r-global-search: useHighlightRecord wires the flash+scroll behavior when
  // a Sale row in the GlobalSearchBar dropdown is clicked from another module.
  // The dropdown dispatches SET_HIGHLIGHT_RECORD with the sale id, this hook
  // scrolls the matching row into view and isHighlighted() applies the outline.
  const { highlightRef, isHighlighted } = useHighlightRecord<HTMLTableRowElement>();

  const safeSales: Sale[] = Array.isArray(sales) ? sales : [];
  const safeRepairs: Repair[] = Array.isArray(repairs) ? repairs : [];
  const safeUnlocks: Unlock[] = Array.isArray(unlocks) ? unlocks : [];
  const safeSpecialOrders: SpecialOrder[] = Array.isArray(specialOrders) ? specialOrders : [];
  const safeLayaways: Layaway[] = Array.isArray(layaways) ? layaways : [];
  const safeVendorReturns = Array.isArray(vendorReturns) ? vendorReturns : [];

  // ── State ─────────────────────────────────────────────────
  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly' | 'range' | 'returning'>('daily');
  const [startDate, setStartDate] = useState(toLocalYMD(new Date()));
  const [endDate, setEndDate] = useState(toLocalYMD(new Date()));
  const [txSearch, setTxSearch] = useState('');
  const [searchDateFrom, setSearchDateFrom] = useState('');
  const [searchDateTo, setSearchDateTo] = useState('');
  const [drilldownCategory, setDrilldownCategory] = useState<string | null>(null);
  const [reprintSale, setReprintSale] = useState<Sale | null>(null);

  // ── Consume globalSearchTerm ──────────────────────────────
  useEffect(() => {
    if (!globalSearchTerm) return;
    setTxSearch(globalSearchTerm);
    dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    setTimeout(() => {
      document.getElementById('reports-transactions-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSearchTerm]);

  // ── Quick date setters ────────────────────────────────────
  const setQuick = useCallback((type: 'daily' | 'weekly' | 'monthly') => {
    const today = new Date();
    if (type === 'daily') {
      const ymd = toLocalYMD(today);
      setStartDate(ymd); setEndDate(ymd);
    } else if (type === 'weekly') {
      const start = new Date(today);
      start.setDate(today.getDate() - 6);
      setStartDate(toLocalYMD(start)); setEndDate(toLocalYMD(today));
    } else if (type === 'monthly') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(toLocalYMD(start)); setEndDate(toLocalYMD(today));
    }
    setReportType(type);
  }, []);

  // ── Period range ──────────────────────────────────────────
  const periodRange = useMemo(() => ({
    start: new Date(startDate + 'T00:00:00'),
    end: new Date(endDate + 'T23:59:59.999'),
  }), [startDate, endDate]);

  const inRange = useCallback((createdAt: unknown): boolean => {
    const d = toDateSafe(createdAt);
    if (!d) return false;
    return d >= periodRange.start && d <= periodRange.end;
  }, [periodRange]);

  // ── Filtered collections ──────────────────────────────────
  /** All sales in period (used by transactions table — includes voided/refunded for visibility). */
  const allFilteredSales = useMemo(() =>
    safeSales
      .filter((s) => inRange(s.createdAt))
      .sort((a, b) => {
        const da = toDateSafe(a.createdAt)?.getTime() || 0;
        const db = toDateSafe(b.createdAt)?.getTime() || 0;
        return db - da;
      }),
    [safeSales, inRange]
  );

  /** Countable sales — used for ALL revenue/profit/tax calculations. */
  const filteredSales = useMemo(() =>
    allFilteredSales.filter(isCountableSale),
    [allFilteredSales]
  );

  const filteredRepairs = useMemo(() =>
    safeRepairs.filter((r) => inRange(r.createdAt)),
    [safeRepairs, inRange]
  );

  const filteredUnlocks = useMemo(() =>
    safeUnlocks.filter((u) => inRange(u.createdAt)),
    [safeUnlocks, inRange]
  );

  const filteredVendorReturns = useMemo(() =>
    safeVendorReturns.filter((v) => inRange((v as any).createdAt)),
    [safeVendorReturns, inRange]
  );

  // ── Returns (live AppState — replaces legacy localStorage bridge) ──
  const allReturns = useMemo((): NormalizedReturn[] => {
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
    }));
  }, [customerReturns]);

  /** Returns that happened during this period (net daily view). */
  const returnsInPeriod = useMemo(() =>
    allReturns.filter((r) => r.createdAt && r.createdAt >= periodRange.start && r.createdAt <= periodRange.end),
    [allReturns, periodRange]
  );

  /** Returns whose original sale was in this period (gross→net adjustment view). */
  const returnsFromPeriodSales = useMemo(() => {
    // Round 10.2: match returns against ALL sales in period, not just countable.
    // After R11 migration, original sales are marked refunded and get filtered
    // out of filteredSales, but their returns still belong to this period.
    const periodSaleIds = new Set(allFilteredSales.map((s) => s.id));
    return allReturns.filter((r) => r.originalSaleId && periodSaleIds.has(r.originalSaleId));
  }, [allReturns, allFilteredSales]);

  // ── Repair-in-sale tracking (prevents double counting) ────
  /** IDs and ticket numbers of repairs that were paid through POS in this period. */
  const repairsAlreadyInSales = useMemo(() => {
    const ids = new Set<string>();
    for (const sale of filteredSales) {
      for (const item of (sale.items || [])) {
        if (item.repairId) ids.add(item.repairId);
        const ticket = (item as unknown as { ticketNumber?: string; meta?: { repairId?: string; ticketNumber?: string } }).ticketNumber
          || (item as unknown as { meta?: { ticketNumber?: string } }).meta?.ticketNumber;
        if (ticket) ids.add(ticket);
        const metaRepairId = (item as unknown as { meta?: { repairId?: string } }).meta?.repairId;
        if (metaRepairId) ids.add(metaRepairId);
      }
    }
    return ids;
  }, [filteredSales]);

  /** Standalone completed repairs not already counted in POS sales. */
  const standaloneRepairs = useMemo(() =>
    filteredRepairs.filter((r) => isRepairCompleted(r) && !repairsAlreadyInSales.has(r.id)),
    [filteredRepairs, repairsAlreadyInSales]
  );

  // ── Unlock-in-sale tracking ───────────────────────────────
  const unlocksAlreadyInSales = useMemo(() => {
    const ids = new Set<string>();
    for (const sale of filteredSales) {
      for (const item of (sale.items || [])) {
        if (item.unlockId) ids.add(item.unlockId);
        const metaUnlockId = (item as unknown as { meta?: { unlockId?: string } }).meta?.unlockId;
        if (metaUnlockId) ids.add(metaUnlockId);
      }
    }
    return ids;
  }, [filteredSales]);

  const standaloneUnlocks = useMemo(() =>
    filteredUnlocks.filter((u) => isUnlockCompleted(u) && !unlocksAlreadyInSales.has(u.id)),
    [filteredUnlocks, unlocksAlreadyInSales]
  );

  // ── r-new-8: Cancellations in period ─────────────────────
  // Rows sourced from entity state (SO/Repair/Unlock) using the cancellation
  // metadata fields introduced in Rounds 1/5/6: depositRefundMethod,
  // depositRefundAmount, cancellationNote, cancelledAt. Voided sales from
  // the cash refund path are NOT used here — entity state is the source of
  // truth for disposition context (customer, reason, method).
  type CancellationRow = {
    id: string;
    type: 'special_order' | 'repair' | 'unlock';
    typeLabel: string;
    reference: string;
    customerName: string;
    itemDescription: string;
    refundAmountCents: number;
    refundMethod: 'store_credit' | 'cash' | 'forfeit' | 'unknown';
    cancelledAt: unknown;
    cancellationNote: string;
  };

  const cancellationsInPeriod = useMemo(() => {
    const rows: CancellationRow[] = [];

    for (const so of safeSpecialOrders) {
      const status = String(so.status || '').toLowerCase();
      if (status !== 'cancelled') continue;
      const cancelledAt = (so as any).cancelledAt || so.updatedAt;
      if (!inRange(cancelledAt)) continue;
      rows.push({
        id: so.id,
        type: 'special_order',
        typeLabel: locale === 'es' ? 'Pedido Especial' : 'Special Order',
        reference: so.id.slice(-8).toUpperCase(),
        customerName: so.customerName || (locale === 'es' ? 'Sin nombre' : 'No name'),
        itemDescription: so.itemDescription || '',
        refundAmountCents: (so as any).depositRefundAmount || 0,
        refundMethod: (so as any).depositRefundMethod || 'unknown',
        cancelledAt,
        cancellationNote: (so as any).cancellationNote || '',
      });
    }

    for (const r of safeRepairs) {
      const status = String(r.status || '').toLowerCase();
      if (status !== 'cancelled') continue;
      const cancelledAt = (r as any).cancelledAt || r.updatedAt;
      if (!inRange(cancelledAt)) continue;
      rows.push({
        id: r.id,
        type: 'repair',
        typeLabel: locale === 'es' ? 'Reparación' : 'Repair',
        reference: ((r as any).ticketNumber || r.id.slice(-8)).toString().toUpperCase(),
        customerName: r.customerName || (locale === 'es' ? 'Sin nombre' : 'No name'),
        itemDescription: [r.device, r.issue].filter(Boolean).join(' — '),
        refundAmountCents: (r as any).depositRefundAmount || 0,
        refundMethod: (r as any).depositRefundMethod || 'unknown',
        cancelledAt,
        cancellationNote: (r as any).cancellationNote || '',
      });
    }

    for (const u of safeUnlocks) {
      const status = String(u.status || '').toLowerCase();
      if (status !== 'cancelled') continue;
      const cancelledAt = (u as any).cancelledAt || u.updatedAt;
      if (!inRange(cancelledAt)) continue;
      rows.push({
        id: u.id,
        type: 'unlock',
        typeLabel: locale === 'es' ? 'Desbloqueo' : 'Unlock',
        reference: u.id.slice(-8).toUpperCase(),
        customerName: u.customerName || (locale === 'es' ? 'Sin nombre' : 'No name'),
        itemDescription: `${u.device || ''} ${u.carrier ? `(${u.carrier})` : ''}`.trim(),
        refundAmountCents: (u as any).depositRefundAmount || 0,
        refundMethod: (u as any).depositRefundMethod || 'unknown',
        cancelledAt,
        cancellationNote: (u as any).cancellationNote || '',
      });
    }

    rows.sort((a, b) => {
      const da = toDateSafe(a.cancelledAt)?.getTime() || 0;
      const db = toDateSafe(b.cancelledAt)?.getTime() || 0;
      return db - da;
    });

    return rows;
  }, [safeSpecialOrders, safeRepairs, safeUnlocks, inRange, locale]);

  const cancellationTotals = useMemo(() => {
    let storeCredit = 0;
    let cash = 0;
    let forfeit = 0;
    for (const c of cancellationsInPeriod) {
      if (c.refundMethod === 'store_credit') storeCredit += c.refundAmountCents;
      else if (c.refundMethod === 'cash') cash += c.refundAmountCents;
      else if (c.refundMethod === 'forfeit') forfeit += c.refundAmountCents;
    }
    return { storeCredit, cash, forfeit, count: cancellationsInPeriod.length };
  }, [cancellationsInPeriod]);

  // ============================================================
  //  CORE STATS — single loop, all cents, single source of truth
  // ============================================================
  const stats = useMemo(() => {
    let salesSubtotalCents = 0;
    let salesDiscountCents = 0;
    let salesTaxCents = 0;
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

    for (const sale of filteredSales) {
      const saleSubtotal = sale.subtotal || 0;
      const saleSubAfterDisc = sale.subtotalAfterDiscount ?? saleSubtotal;
      salesSubtotalCents += saleSubtotal;
      // Discount derived from subtotal - subtotalAfterDiscount (Sale type has no
      // standalone discountAmount field — it's implicit in the difference).
      salesDiscountCents += Math.max(0, saleSubtotal - saleSubAfterDisc);
      // v2 writes salesTax + utilityTax + mobileSurcharge separately;
      // legacy v1 data uses the aggregate taxAmount field. Read both.
      const saleTax = ((sale as any).salesTax || 0)
        + ((sale as any).utilityTax || 0)
        + ((sale as any).mobileSurcharge || 0);
      salesTaxCents += saleTax > 0 ? saleTax : (sale.taxAmount || 0);
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

      const emp = sale.employeeName || (locale === 'es' ? 'Sin nombre' : 'Unknown');
      if (!employeeStats[emp]) employeeStats[emp] = { transactions: 0, revenueCents: 0 };
      employeeStats[emp].transactions++;
      employeeStats[emp].revenueCents += saleTotal;

      for (const item of (sale.items || [])) {
        const revenueCents = lineRevenueCents(item);
        const qty = item.qty || (item as any).quantity || 1;

        if (!itemStats[item.name]) itemStats[item.name] = { quantity: 0, revenueCents: 0 };
        itemStats[item.name].quantity += qty;
        itemStats[item.name].revenueCents += revenueCents;

        const kind = classifyItem(item);
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
            let rawCarrier = ((item as any).carrier || (item as any).carrierName || '').trim();
            if (!rawCarrier && (item as any).name) {
              const match = String((item as any).name).match(/^([A-Za-z0-9\s&]+?)(?:\s*[-–]\s*|\s+Bill Payment)/i);
              if (match) rawCarrier = match[1].trim();
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
          if (!provider) provider = locale === 'es' ? '(Sin proveedor)' : '(No provider)';

          if (!phonePaymentsByProvider[provider]) {
            phonePaymentsByProvider[provider] = { count: 0, totalCents: 0, profitCents: 0, numbers: new Set() };
          }
          phonePaymentsByProvider[provider].count += qty;
          phonePaymentsByProvider[provider].totalCents += revenueCents;
          phonePaymentsByProvider[provider].profitCents += profitCents;
          if (item.phoneNumber) phonePaymentsByProvider[provider].numbers.add(item.phoneNumber);
        } else if (kind === 'topup') {
          catName = 'Top-Ups';
          costCents = Math.round(revenueCents * TOPUP_COST_RATE);
          profitCents = revenueCents - costCents;
        } else if (kind === 'repair') {
          catName = 'Repairs';
          if (item.repairId) {
            const linkedRepair = safeRepairs.find((r) => r.id === item.repairId);
            if (linkedRepair) {
              const partsCost = (linkedRepair.parts || []).reduce((s, p) => s + (p.cost || 0) * (p.qty || (p as any).quantity || 1), 0);
              const labor = linkedRepair.laborCost || 0;
              costCents = partsCost + labor;
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
            const linked = safeUnlocks.find((u) => u.id === item.unlockId);
            costCents = linked?.cost || 0;
          }
          profitCents = revenueCents - costCents;
        } else if (kind === 'special_order') {
          catName = 'Special Orders';
          costCents = (item.cost || 0) * qty;
          profitCents = revenueCents - costCents;
        } else if (kind === 'cc_fee') {
          catName = 'CC Fees';
          costCents = 0;
          profitCents = revenueCents;
        } else if (kind === 'service') {
          catName = 'Services';
          costCents = (item.cost || 0) * qty;
          profitCents = revenueCents - costCents;
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
            const linked = safeLayaways.find((l) => l.id === item.layawayId);
            if (linked) realCost = getLayawayProportionalCost(linked, inventory, revenueCents);
          } else if (item.specialOrderId) {
            const linked = safeSpecialOrders.find((o) => o.id === item.specialOrderId);
            if (linked) realCost = getSpecialOrderProportionalCost(linked, inventory, revenueCents);
          } else if (item.repairId) {
            const linked = safeRepairs.find((r) => r.id === item.repairId);
            if (linked) realCost = getRepairProportionalCost(linked, inventory, revenueCents);
          } else if (item.unlockId) {
            const linked = safeUnlocks.find((u) => u.id === item.unlockId);
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

    // Fix 3: tax collected must net out the tax that was refunded on returns.
    const returnsTaxCents = returnsFromPeriodSales.reduce((s, r) => s + r.taxCents, 0);
    salesTaxCents = Math.max(0, salesTaxCents - returnsTaxCents);

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

    return {
      grossRevenueCents,
      netRevenueCents,
      totalReturnsCents,
      totalProfitCents: adjustedTotalProfitCents,
      totalCostCents,
      subtotalBeforeTaxCents,
      profitMargin,
      taxCollectedCents: salesTaxCents,
      cbeCollectedCents: salesCbeCents,
      screenFeeCents: salesScreenFeeCents,
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
    };
  }, [filteredSales, allFilteredSales, filteredRepairs, filteredUnlocks, standaloneRepairs, standaloneUnlocks, returnsFromPeriodSales, filteredVendorReturns, inventory, settings, safeRepairs, safeUnlocks, safeSpecialOrders, safeLayaways, locale]);

  // ── Round 10 fix 1: Cash tripartite (In / Out / Net) ──────
  // Gross "Cash" previously equalled "Cash In" only, hiding real cash drawer
  // outflows from returns + cancellation deposit refunds. Split into:
  //   Cash In  = positive-total non-refunded sales paid cash (or split.cash)
  //   Cash Out = customerReturn refunds (resolution='cash') + cancellations
  //              across SO/Repair/Unlock/Layaway with depositRefundMethod='cash'
  //   Net      = Cash In − Cash Out  (colored green/red in render)
  const cashBreakdown = useMemo(() => {
    let cashIn = 0;
    for (const sale of allFilteredSales) {
      if (sale.status === 'refunded' || sale.status === 'voided') continue;
      if ((sale.total || 0) <= 0) continue;
      const pm = String(sale.paymentMethod || '').toLowerCase();
      if (pm === 'cash') cashIn += sale.total || 0;
      else if (pm === 'split') cashIn += sale.splitPayment?.cash ?? 0;
    }

    // Round 10.1 fix 1: R9-1 cash-out dedup. When a customerReturn with
    // resolution='cash' is processed by ReturnsModule and cascades to cancel
    // linked entities (repair/unlock/specialOrder/layaway), those entities end
    // up with depositRefundMethod='cash' AND the refund sale carries a
    // linkedRefunds[] ref back to each entity. The customerReturn is the
    // authoritative source for that cash outflow, so we must skip the entity
    // cancellation row to avoid double-counting.
    // Match strictly by entity type+id from persisted linkedRefunds (no fuzzy
    // matching on amount/name/timestamp). Dedup only against records already
    // in the current period filter.
    const dedupKey = (type: string, id: string) =>
      `${String(type).toLowerCase().replace(/[_-]/g, '')}:${id}`;
    const countedViaReturnKeys = new Set<string>();
    const periodReturnNumbers = new Set(
      returnsInPeriod
        .filter((r) => String(r.resolution || '').toLowerCase() === 'cash')
        .map((r) => r.returnNumber),
    );
    for (const sale of allFilteredSales) {
      const linked = (sale as any).linkedRefunds as
        | { type: string; id: string; depositCents: number }[]
        | undefined;
      if (!linked || linked.length === 0) continue;
      const refReturnNumber = String((sale as any).returnNumber || '')
        || String(sale.invoiceNumber || '').replace(/^REF-/i, '');
      if (!periodReturnNumbers.has(refReturnNumber)) continue;
      for (const ref of linked) countedViaReturnKeys.add(dedupKey(ref.type, ref.id));
    }

    let cashOut = 0;
    // Customer returns refunded in cash during this period.
    for (const r of returnsInPeriod) {
      if (String(r.resolution || '').toLowerCase() === 'cash') {
        cashOut += Math.abs(r.totalCents);
      }
    }
    // Entity cancellations with cash deposit refund (SO/Repair/Unlock are in
    // cancellationsInPeriod; Layaways aren't, iterated separately). Skip any
    // whose id is already represented by a counted customerReturn.
    for (const c of cancellationsInPeriod) {
      if (c.refundMethod !== 'cash') continue;
      if (countedViaReturnKeys.has(dedupKey(c.type, c.id))) continue;
      cashOut += c.refundAmountCents;
    }
    for (const l of safeLayaways) {
      const status = String(l.status || '').toLowerCase();
      if (status !== 'cancelled') continue;
      const cancelledAt = (l as any).cancelledAt || l.updatedAt;
      if (!inRange(cancelledAt)) continue;
      if ((l as any).depositRefundMethod !== 'cash') continue;
      if (countedViaReturnKeys.has(dedupKey('layaway', l.id))) continue;
      cashOut += (l as any).depositRefundAmount || 0;
    }

    return { cashIn, cashOut, net: cashIn - cashOut };
  }, [allFilteredSales, returnsInPeriod, cancellationsInPeriod, safeLayaways, inRange]);

  // ── Phone payment per-line rows (for portal report and detail table) ──
  const phonePaymentRows = useMemo(() => {
    const rows: Array<{
      id: string; createdAt: unknown; invoiceNumber: string;
      customerName: string; employeeName: string;
      carrier: string; phoneNumber: string;
      amountCents: number; voided: boolean; refunded: boolean;
    }> = [];
    for (const sale of allFilteredSales) {
      if (!sale || !Array.isArray(sale.items)) continue;
      const isVoided = sale.status === 'voided';
      const isRefunded = sale.status === 'refunded';
      for (const item of sale.items) {
        if (classifyItem(item) !== 'phone_payment') continue;
        const amountCents = lineRevenueCents(item);
        let carrierName = item.carrier || '';
        if (!carrierName && item.name) carrierName = String(item.name).split('-')[0].trim();
        let phoneNum = String(item.phoneNumber || '').trim();
        if (!phoneNum && item.name) {
          const m = String(item.name).match(/(\+?1)?\D*(\d{3})\D*(\d{3})\D*(\d{4})/);
          if (m) phoneNum = `${m[2]}${m[3]}${m[4]}`;
        }
        rows.push({
          // Stable key — falls back to index if item.id missing (no Math.random
          // which would remount on every render and thrash React state).
          id: `${sale.id}-${item.id || `idx${(sale.items || []).indexOf(item)}`}`,
          createdAt: sale.createdAt,
          invoiceNumber: sale.invoiceNumber || sale.id || '',
          customerName: sale.customerName || (locale === 'es' ? 'Walk-in' : 'Walk-in'),
          employeeName: sale.employeeName || '',
          carrier: normalizeCarrierName(carrierName),
          phoneNumber: phoneNum,
          amountCents,
          voided: isVoided,
          refunded: isRefunded,
        });
      }
    }
    rows.sort((a, b) => {
      const da = toDateSafe(a.createdAt)?.getTime() || 0;
      const db = toDateSafe(b.createdAt)?.getTime() || 0;
      return db - da;
    });
    return rows;
  }, [allFilteredSales, locale]);

  // ── Transactions display (search + secondary date filter) ──
  const displayedTx = useMemo(() => {
    return allFilteredSales.filter((s) => {
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase();
        const fields = [s.invoiceNumber, s.customerName, s.employeeName, s.customerPhone].filter(Boolean).join(' ').toLowerCase();
        const itemMatch = (s.items || []).some((i) => (i.name || '').toLowerCase().includes(q));
        if (!fields.includes(q) && !itemMatch) return false;
      }
      if (searchDateFrom) {
        const from = new Date(searchDateFrom + 'T00:00:00');
        const d = toDateSafe(s.createdAt);
        if (!d || d < from) return false;
      }
      if (searchDateTo) {
        const to = new Date(searchDateTo + 'T23:59:59.999');
        const d = toDateSafe(s.createdAt);
        if (!d || d > to) return false;
      }
      return true;
    });
  }, [allFilteredSales, txSearch, searchDateFrom, searchDateTo]);

  // ── Drilldown items ───────────────────────────────────────
  const drilldownItems = useMemo(() => {
    if (!drilldownCategory) return null;
    const wantKey = normalizeCategoryKey(drilldownCategory);
    const items: Array<{ name: string; qty: number; revenueCents: number; saleInvoice: string; date: unknown }> = [];
    for (const sale of filteredSales) {
      for (const item of (sale.items || [])) {
        const kind = classifyItem(item);
        const catGuess = kind === 'phone_payment' ? 'Phone Payments'
          : kind === 'topup' ? 'Top-Ups'
          : kind === 'repair' ? 'Repairs'
          : kind === 'unlock' ? 'Unlocks'
          : kind === 'special_order' ? 'Special Orders'
          : kind === 'cc_fee' ? 'CC Fees'
          : kind === 'service' ? 'Services'
          : (item.category || 'Products');
        // Round 10 fix 4: compare on normalized key so case variants match.
        if (normalizeCategoryKey(catGuess) !== wantKey) continue;
        items.push({
          name: item.name || '—',
          qty: item.qty || (item as any).quantity || 1,
          revenueCents: lineRevenueCents(item),
          saleInvoice: sale.invoiceNumber || '',
          date: sale.createdAt,
        });
      }
    }
    items.sort((a, b) => b.revenueCents - a.revenueCents);
    return items;
  }, [drilldownCategory, filteredSales]);

  // ── Returning customers analysis ──────────────────────────
  const customerAnalysis = useMemo(() => {
    if (reportType !== 'returning') return null;
    const buckets: Record<string, {
      phone: string; name: string;
      visits: Array<{ date: Date; type: string; amountCents: number; invoice: string }>;
      totalSpentCents: number; lastVisit: Date | null;
    }> = {};
    const norm = (p: string) => String(p || '').replace(/\D/g, '');
    const phoneFromId = (id: string | undefined) => {
      if (!id) return null;
      const c = customers.find((cu) => cu.id === id);
      return c ? c.phone : null;
    };
    const upsert = (rawPhone: string, name: string, visit: { date: Date; type: string; amountCents: number; invoice: string }) => {
      const key = norm(rawPhone);
      if (!key) return;
      if (!buckets[key]) buckets[key] = { phone: rawPhone, name, visits: [], totalSpentCents: 0, lastVisit: null };
      buckets[key].visits.push(visit);
      buckets[key].totalSpentCents += visit.amountCents;
      if (!buckets[key].lastVisit || visit.date > buckets[key].lastVisit) buckets[key].lastVisit = visit.date;
    };

    for (const sale of filteredSales) {
      let phone = sale.customerPhone || '';
      if (!phone && sale.customerId) phone = phoneFromId(sale.customerId) || '';
      if (!phone) continue;
      const d = toDateSafe(sale.createdAt);
      if (!d) continue;
      upsert(phone, sale.customerName || 'Unknown', {
        date: d, type: 'Sale', amountCents: sale.total || 0, invoice: sale.invoiceNumber || '',
      });
    }
    for (const r of filteredRepairs) {
      if (!isRepairCompleted(r) || !r.customerPhone) continue;
      const d = toDateSafe(r.updatedAt || r.createdAt);
      if (!d) continue;
      upsert(r.customerPhone, r.customerName || 'Unknown', {
        date: d, type: 'Repair', amountCents: r.total ?? r.estimatedCost ?? 0, invoice: (r as unknown as { ticketNumber?: string }).ticketNumber || r.id,
      });
    }
    for (const u of filteredUnlocks) {
      if (!isUnlockCompleted(u) || !u.customerPhone) continue;
      const d = toDateSafe(u.createdAt);
      if (!d) continue;
      upsert(u.customerPhone, u.customerName || 'Unknown', {
        date: d, type: 'Unlock', amountCents: u.price || 0, invoice: u.imei || u.id,
      });
    }

    const all = Object.values(buckets);
    const returning = all.filter((c) => c.visits.length >= 2).sort((a, b) => b.visits.length - a.visits.length);
    const newOnes = all.filter((c) => c.visits.length === 1);
    const total = all.length;
    const returningRate = total > 0 ? (returning.length / total) * 100 : 0;
    const avgVisitsReturning = returning.length > 0 ? returning.reduce((s, c) => s + c.visits.length, 0) / returning.length : 0;
    const totalRevenueReturningCents = returning.reduce((s, c) => s + c.totalSpentCents, 0);
    const avgSpendReturningCents = returning.length > 0 ? Math.round(totalRevenueReturningCents / returning.length) : 0;

    return {
      allCustomers: all,
      returningCustomers: returning,
      newCustomers: newOnes,
      totalCustomers: total,
      returningCount: returning.length,
      newCount: newOnes.length,
      returningRate,
      avgVisitsReturning,
      totalRevenueReturningCents,
      avgSpendReturningCents,
    };
  }, [reportType, filteredSales, filteredRepairs, filteredUnlocks, customers]);

  // ── Print report ──────────────────────────────────────────
  const printReport = useCallback(() => {
    const storeName = settings.storeName || 'CellHub Pro';
    const dateLabel = startDate === endDate
      ? new Date(startDate + 'T12:00:00').toLocaleDateString()
      : `${new Date(startDate + 'T12:00:00').toLocaleDateString()} – ${new Date(endDate + 'T12:00:00').toLocaleDateString()}`;

    // All user-controlled strings below MUST go through escHtml (round 17 XSS fix).
    // formatCurrency output is safe (pure numeric), same for quantities and percentages.
    const ppRows = Object.entries(stats.phonePaymentsByProvider)
      .sort((a, b) => b[1].totalCents - a[1].totalCents)
      .map(([c, d]) => {
        const margin = d.totalCents > 0 ? (d.profitCents / d.totalCents) * 100 : 0;
        return `<tr><td>${escHtml(c)}</td><td>${d.count}</td><td>${formatCurrency(d.totalCents)}</td><td>${formatCurrency(d.profitCents)}</td><td>${margin.toFixed(1)}%</td></tr>`;
      })
      .join('');
    const ppTotal = {
      count: Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.count, 0),
      revenue: Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.totalCents, 0),
      profit: Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.profitCents, 0),
    };
    const ppMargin = ppTotal.revenue > 0 ? (ppTotal.profit / ppTotal.revenue) * 100 : 0;
    const ppTotalRow = `<tr class="total"><td>TOTAL</td><td>${ppTotal.count}</td><td>${formatCurrency(ppTotal.revenue)}</td><td>${formatCurrency(ppTotal.profit)}</td><td>${ppMargin.toFixed(1)}%</td></tr>`;
    const catRows = stats.categoriesByRevenue
      .map((c) => `<tr><td>${escHtml(c.name)}</td><td>${c.quantity}</td><td>${formatCurrency(c.revenueCents)}</td><td>${formatCurrency(c.profitCents)}</td><td>${c.marginPct === null ? '—' : `${c.marginPct.toFixed(1)}%`}</td></tr>`)
      .join('');
    const empRows = stats.topEmployees
      .map((e) => `<tr><td>${escHtml(e.name)}</td><td>${e.transactions}</td><td>${formatCurrency(e.revenueCents)}</td></tr>`)
      .join('');
    const itemRows = stats.topItems
      .map((i) => `<tr><td>${escHtml(i.name)}</td><td>${i.quantity}</td><td>${formatCurrency(i.revenueCents)}</td></tr>`)
      .join('');

    const html = `<!DOCTYPE html><html><head><title>Sales Report</title><style>
@page{size:letter;margin:0.5in}*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:9pt;line-height:1.4}
h1{font-size:14pt;margin-bottom:4px}h2{font-size:10pt;margin:10px 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th,td{padding:2px 5px;text-align:left;border-bottom:1px solid #eee;font-size:8.5pt}
th{background:#f5f5f5;font-weight:700}.total{font-weight:700;background:#f0f0f0}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
.summary-box{border:1px solid #ddd;padding:6px 8px;border-radius:4px}
.summary-box .label{font-size:7.5pt;color:#666;text-transform:uppercase}
.summary-box .value{font-size:12pt;font-weight:700;margin-top:2px}
.grand{background:#1a1a2e;color:#fff;padding:8px 12px;font-size:12pt;font-weight:700;text-align:right;margin-top:12px;border-radius:4px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h1>Sales Report — ${escHtml(storeName)}</h1>
<p style="color:#666;margin-bottom:12px">${escHtml(dateLabel)} | Generated: ${escHtml(new Date().toLocaleString())}</p>
<div class="summary">
  <div class="summary-box"><div class="label">${locale === 'es' ? 'Bruto' : 'Gross'}</div><div class="value">${formatCurrency(stats.grossRevenueCents)}</div></div>
  <div class="summary-box"><div class="label">${locale === 'es' ? 'Devoluciones' : 'Returns'}</div><div class="value" style="color:#dc2626">-${formatCurrency(stats.totalReturnsCents)}</div></div>
  <div class="summary-box"><div class="label">${locale === 'es' ? 'Neto' : 'Net'}</div><div class="value">${formatCurrency(stats.netRevenueCents)}</div></div>
  <div class="summary-box"><div class="label">${locale === 'es' ? 'Ganancia' : 'Profit'}</div><div class="value" style="color:#16a34a">${formatCurrency(stats.totalProfitCents)}</div></div>
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;font-size:8.5pt">
  <div><span style="color:#666">${locale === 'es' ? 'Impuesto:' : 'Tax:'}</span> <strong>${formatCurrency(stats.taxCollectedCents)}</strong></div>
  <div><span style="color:#666">${locale === 'es' ? 'Efectivo:' : 'Cash:'}</span> <strong>${formatCurrency(stats.cashCents)}</strong></div>
  <div><span style="color:#666">${locale === 'es' ? 'Tarjeta:' : 'Card:'}</span> <strong>${formatCurrency(stats.cardCents)}</strong></div>
</div>
<h2>${locale === 'es' ? 'Pagos por Proveedor' : 'Phone Payments by Provider'}</h2>
<table><thead><tr><th>${locale === 'es' ? 'Proveedor' : 'Provider'}</th><th>${locale === 'es' ? 'Cant.' : 'Count'}</th><th>Total</th><th>${locale === 'es' ? 'Ganancia' : 'Profit'}</th><th>${locale === 'es' ? 'Margen' : 'Margin'}</th></tr></thead>
<tbody>${ppRows}${ppTotalRow}</tbody></table>
<h2>${locale === 'es' ? 'Ventas por Categoría' : 'Sales by Category'}</h2>
<table><thead><tr><th>${locale === 'es' ? 'Categoría' : 'Category'}</th><th>Qty</th><th>${locale === 'es' ? 'Ingresos' : 'Revenue'}</th><th>${locale === 'es' ? 'Ganancia' : 'Profit'}</th><th>Margin</th></tr></thead>
<tbody>${catRows}</tbody></table>
<h2>${locale === 'es' ? 'Empleados' : 'Employees'}</h2>
<table><thead><tr><th>${locale === 'es' ? 'Empleado' : 'Employee'}</th><th>${locale === 'es' ? 'Trans.' : 'Trans.'}</th><th>${locale === 'es' ? 'Ventas' : 'Revenue'}</th></tr></thead>
<tbody>${empRows}</tbody></table>
<h2>${locale === 'es' ? 'Más Vendidos' : 'Top Items'}</h2>
<table><thead><tr><th>${locale === 'es' ? 'Artículo' : 'Item'}</th><th>Qty</th><th>${locale === 'es' ? 'Ingresos' : 'Revenue'}</th></tr></thead>
<tbody>${itemRows}</tbody></table>
<div class="grand">${locale === 'es' ? 'TOTAL NETO' : 'NET TOTAL'}: ${formatCurrency(stats.netRevenueCents)}</div>
<p style="font-size:7.5pt;color:#999;margin-top:8px;text-align:center">${escHtml(storeName)} | CellHub Pro</p>
</body></html>`;
    openPrintWindow(html);
  }, [stats, settings, startDate, endDate, locale]);

  // ── Export Report (JSON) ──────────────────────────────────
  const exportReport = useCallback(() => {
    const report = {
      reportType,
      dateRange: { start: startDate, end: endDate },
      generated: new Date().toISOString(),
      summary: {
        gross: formatCurrency(stats.grossRevenueCents),
        returns: formatCurrency(stats.totalReturnsCents),
        net: formatCurrency(stats.netRevenueCents),
        profit: formatCurrency(stats.totalProfitCents),
        profitMargin: `${stats.profitMargin.toFixed(2)}%`,
        tax: formatCurrency(stats.taxCollectedCents),
        cbe: formatCurrency(stats.cbeCollectedCents),
        cash: formatCurrency(stats.cashCents),
        card: formatCurrency(stats.cardCents),
        storeCredit: formatCurrency(stats.storeCreditCents),
        transactions: stats.txCount,
        voided: stats.voidedCount,
        refunded: stats.refundedCount,
        repairs: stats.completedRepairCount,
        unlocks: stats.unlockCount,
      },
      categories: stats.categoriesByRevenue.map((c) => ({
        name: c.name,
        quantity: c.quantity,
        revenue: formatCurrency(c.revenueCents),
        cost: formatCurrency(c.costCents),
        profit: formatCurrency(c.profitCents),
        margin: c.marginPct === null ? '—' : `${c.marginPct.toFixed(1)}%`,
      })),
      phonePaymentsByProvider: Object.entries(stats.phonePaymentsByProvider).map(([provider, d]) => ({
        provider,
        count: d.count,
        total: formatCurrency(d.totalCents),
        profit: formatCurrency(d.profitCents),
        marginPct: d.totalCents > 0 ? Number(((d.profitCents / d.totalCents) * 100).toFixed(2)) : 0,
        uniqueNumbers: d.numbers.size,
      })),
      employees: stats.topEmployees.map((e) => ({
        name: e.name, transactions: e.transactions, revenue: formatCurrency(e.revenueCents),
      })),
      topItems: stats.topItems.map((i) => ({
        name: i.name, quantity: i.quantity, revenue: formatCurrency(i.revenueCents),
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${startDate}-to-${endDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [stats, reportType, startDate, endDate]);

  // ============================================================
  //  RENDER
  // ============================================================
  const statCard = (label: string, valueCents: number, sub: string, color: string, isNegative = false) => (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem 1.25rem' }}>
      <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color, marginTop: '0.25rem' }}>
        {isNegative && valueCents > 0 ? '-' : ''}{formatCurrency(valueCents)}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', margin: 0 }}>{t('reports.title')}</h1>
          <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0.25rem 0 0' }}>{t('reports.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={exportReport} className="btn" style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#93c5fd', padding: '0.45rem 0.9rem', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
            📥 {t('reports.export')}
          </button>
          <button onClick={printReport} className="btn" style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', padding: '0.45rem 0.9rem', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
            🖨️ {t('print')}
          </button>
        </div>
      </div>

      {/* ── Date controls ── */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '0.875rem 1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {(['daily', 'weekly', 'monthly'] as const).map((type) => (
            <button key={type} onClick={() => setQuick(type)} style={{
              padding: '0.4rem 0.8rem', borderRadius: '0.4rem',
              background: reportType === type ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
              color: reportType === type ? '#818cf8' : '#64748b',
              border: '1px solid ' + (reportType === type ? 'rgba(129,140,248,0.4)' : 'rgba(255,255,255,0.08)'),
              cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize',
            }}>{locale === 'es' ? (type === 'daily' ? 'Hoy' : type === 'weekly' ? 'Semana' : 'Mes') : locale === 'pt' ? (type === 'daily' ? 'Hoje' : type === 'weekly' ? 'Semana' : 'Mês') : type}</button>
          ))}
          <button onClick={() => setReportType('returning')} style={{
            padding: '0.4rem 0.8rem', borderRadius: '0.4rem',
            background: reportType === 'returning' ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)',
            color: reportType === 'returning' ? '#c084fc' : '#64748b',
            border: '1px solid ' + (reportType === 'returning' ? 'rgba(192,132,252,0.4)' : 'rgba(255,255,255,0.08)'),
            cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
          }}>👥 {t('reports.returning')}</button>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="date" className="input" value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setReportType('range'); if (reportType === 'daily') setEndDate(e.target.value); }}
            style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem' }} />
          <span style={{ color: '#64748b' }}>—</span>
          <input type="date" className="input" value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setReportType('range'); }}
            style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem' }} />
        </div>
        {/* Round 10 fix 2: transactions header now shows real buckets instead of a
            single "4 transactions" lump that included refund sales as if they were
            sales. Sale = clean positive, Refunded = original marked refunded,
            Void = status voided, Refund = negative-total audit refund sale.
            Round 10.1 fix 4: singular/plural-correct labels. */}
        <div style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#475569' }}>
          {stats.cleanSalesCount} {pluralize(stats.cleanSalesCount, locale === 'es' ? 'venta' : locale === 'pt' ? 'venda' : 'sale', locale === 'es' ? 'ventas' : locale === 'pt' ? 'vendas' : 'sales')}
          {stats.refundedCount > 0 && <span style={{ color: '#f97316', marginLeft: '0.5rem' }}>• {stats.refundedCount} {pluralize(stats.refundedCount, locale === 'es' ? 'reembolsada' : locale === 'pt' ? 'reembolsada' : 'refunded', locale === 'es' ? 'reembolsadas' : locale === 'pt' ? 'reembolsadas' : 'refunded')}</span>}
          {stats.voidedCount > 0 && <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>• {stats.voidedCount} {pluralize(stats.voidedCount, locale === 'es' ? 'anulación' : locale === 'pt' ? 'anulação' : 'void', locale === 'es' ? 'anulaciones' : locale === 'pt' ? 'anulações' : 'voids')}</span>}
          {stats.refundSalesCount > 0 && <span style={{ color: '#fb923c', marginLeft: '0.5rem' }}>• {stats.refundSalesCount} {pluralize(stats.refundSalesCount, locale === 'es' ? 'reembolso' : locale === 'pt' ? 'reembolso' : 'refund', locale === 'es' ? 'reembolsos' : locale === 'pt' ? 'reembolsos' : 'refunds')}</span>}
        </div>
      </div>

      {reportType === 'returning' && customerAnalysis ? (
        // ── RETURNING CUSTOMERS REPORT ──
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {/* Count cards — NOT monetary, don't use statCard/formatCurrency */}
            {(() => {
              const countCard = (label: string, value: number | string, sub: string, color: string) => (
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem 1.25rem' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color, marginTop: '0.25rem' }}>{value}</div>
                  {sub && <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: '0.2rem' }}>{sub}</div>}
                </div>
              );
              return (
                <>
                  {countCard(t('reports.totalCustomers'), customerAnalysis.totalCustomers, '', '#e2e8f0')}
                  {countCard(t('reports.returning'), customerAnalysis.returningCount, `${customerAnalysis.returningRate.toFixed(1)}%`, '#22c55e')}
                  {countCard(t('reports.new'), customerAnalysis.newCount, '', '#60a5fa')}
                  {countCard(t('reports.avgVisits'), customerAnalysis.avgVisitsReturning.toFixed(1), locale === 'es' ? 'recurrentes' : locale === 'pt' ? 'recorrentes' : 'returning', '#a78bfa')}
                  {statCard(t('reports.returningRev'), customerAnalysis.totalRevenueReturningCents, '', '#22c55e')}
                  {statCard(t('reports.avgSpend'), customerAnalysis.avgSpendReturningCents, locale === 'es' ? 'recurrentes' : locale === 'pt' ? 'recorrentes' : 'returning', '#fb923c')}
                </>
              );
            })()}
          </div>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
              🏆 {t('reports.topReturningCustomers')}
            </div>
            <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    {[locale === 'es' ? 'Cliente' : locale === 'pt' ? 'Cliente' : 'Customer', locale === 'es' ? 'Teléfono' : locale === 'pt' ? 'Telefone' : 'Phone', locale === 'es' ? 'Visitas' : locale === 'pt' ? 'Visitas' : 'Visits', locale === 'es' ? 'Total Gastado' : locale === 'pt' ? 'Total Gasto' : 'Total Spent', locale === 'es' ? 'Última' : locale === 'pt' ? 'Última' : 'Last'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.875rem', color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customerAnalysis.returningCustomers.slice(0, 50).map((c) => (
                    <tr key={c.phone} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#e2e8f0' }}>{c.name}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.75rem' }}>{c.phone}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#a5b4fc', fontWeight: 700 }}>{c.visits.length}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#22c55e', fontWeight: 700 }}>{formatCurrency(c.totalSpentCents)}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#475569', fontSize: '0.75rem' }}>{c.lastVisit ? formatDate(c.lastVisit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* ── Stat cards: Gross / Returns / Net / Profit / Tax / Cash (tripartite) / Card ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {statCard(t('reports.grossRevenue'), stats.grossRevenueCents, `${stats.cleanSalesCount} ${pluralize(stats.cleanSalesCount, locale === 'es' ? 'venta' : locale === 'pt' ? 'venda' : 'sale', locale === 'es' ? 'ventas' : locale === 'pt' ? 'vendas' : 'sales')}`, '#e2e8f0')}
            {statCard(t('reports.returns'), stats.totalReturnsCents, `${returnsFromPeriodSales.length} ${pluralize(returnsFromPeriodSales.length, locale === 'es' ? 'devolución' : locale === 'pt' ? 'devolução' : 'return', locale === 'es' ? 'devoluciones' : locale === 'pt' ? 'devoluções' : 'returns')}`, stats.totalReturnsCents > 0 ? '#ef4444' : '#64748b', true)}
            {statCard(t('reports.netRevenue'), stats.netRevenueCents, stats.grossRevenueCents > 0 ? `${((stats.netRevenueCents / stats.grossRevenueCents) * 100).toFixed(1)}% ${locale === 'es' ? 'retenido' : locale === 'pt' ? 'retido' : 'retained'}` : '—', '#22c55e')}
            {statCard(t('reports.profit'), stats.totalProfitCents, `${stats.profitMargin.toFixed(1)}% margin`, '#22c55e')}
            {statCard(t('reports.taxStat'), stats.taxCollectedCents, 'CDTFA', '#60a5fa')}
            {/* Round 10 fix 1: Cash tripartite (In / Out / Net) single card — amber chrome preserved. */}
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '0.75rem', padding: '0.85rem 1rem' }}>
              <div style={{ fontSize: '0.72rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                💵 {t('reports.cashStat')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t('reports.cashIn')}</span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fbbf24' }}>{formatCurrency(cashBreakdown.cashIn)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t('reports.cashOut')}</span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: cashBreakdown.cashOut > 0 ? '#ef4444' : '#64748b' }}>
                    {cashBreakdown.cashOut > 0 ? '-' : ''}{formatCurrency(cashBreakdown.cashOut)}
                  </span>
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  paddingTop: '0.3rem', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.15rem',
                }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#e2e8f0' }}>{t('reports.cashNet')}</span>
                  <span style={{
                    fontSize: '1.05rem', fontWeight: 800,
                    color: cashBreakdown.net >= 0 ? '#22c55e' : '#ef4444',
                  }}>
                    {cashBreakdown.net < 0 ? '-' : ''}{formatCurrency(Math.abs(cashBreakdown.net))}
                  </span>
                </div>
              </div>
            </div>
            {statCard(t('reports.card'), stats.cardCents, '', '#a78bfa')}
            {stats.storeCreditCents > 0 && statCard(t('reports.storeCredit'), stats.storeCreditCents, '', '#c084fc')}
          </div>

          {/* ── Diagnosis Conversion (when repairs have outcomes) ── */}
          {filteredRepairs.length > 0 && (() => {
            const withOutcome = filteredRepairs.filter((r) => (r as unknown as { diagnosisOutcome?: string }).diagnosisOutcome);
            if (withOutcome.length === 0) return null;
            const accepted = withOutcome.filter((r) => (r as unknown as { diagnosisOutcome?: string }).diagnosisOutcome === 'accepted').length;
            const declined = withOutcome.filter((r) => (r as unknown as { diagnosisOutcome?: string }).diagnosisOutcome === 'declined').length;
            const pending = withOutcome.filter((r) => (r as unknown as { diagnosisOutcome?: string }).diagnosisOutcome === 'pending').length;
            const convRate = ((accepted / withOutcome.length) * 100).toFixed(0);
            return (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '0.875rem 1rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                  📊 {t('reports.diagnosisConversion')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                  {[
                    { v: `${convRate}%`, l: locale === 'es' ? 'Conversión' : locale === 'pt' ? 'Conversão' : 'Conv. rate', c: parseInt(convRate) >= 70 ? '#22c55e' : parseInt(convRate) >= 50 ? '#f59e0b' : '#ef4444' },
                    { v: accepted, l: locale === 'es' ? 'Aceptados' : locale === 'pt' ? 'Aceitos' : 'Accepted', c: '#22c55e' },
                    { v: pending, l: locale === 'es' ? 'Pendientes' : locale === 'pt' ? 'Pendentes' : 'Pending', c: '#f59e0b' },
                    { v: declined, l: locale === 'es' ? 'Rechazados' : locale === 'pt' ? 'Recusados' : 'Declined', c: '#ef4444' },
                  ].map((m, i) => (
                    <div key={i} style={{ textAlign: 'center', padding: '0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: m.c }}>{m.v}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.2rem' }}>{m.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Returns Detail Table ── */}
          {returnsFromPeriodSales.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(239,68,68,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#fca5a5' }}>
                  ↩️ {t('reports.returnsThisPeriod')}
                </span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fca5a5' }}>-{formatCurrency(stats.totalReturnsCents)}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
                    {[locale === 'es' ? '# Return' : locale === 'pt' ? '# Devolução' : 'Return #', locale === 'es' ? 'Factura Orig.' : locale === 'pt' ? 'Fatura Orig.' : 'Original Invoice', locale === 'es' ? 'Cliente' : locale === 'pt' ? 'Cliente' : 'Customer', locale === 'es' ? 'Razón' : locale === 'pt' ? 'Motivo' : 'Reason', locale === 'es' ? 'Fecha' : locale === 'pt' ? 'Data' : 'Date', locale === 'es' ? 'Reembolso' : locale === 'pt' ? 'Reembolso' : 'Refund'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.875rem', color: '#94a3b8', fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {returnsFromPeriodSales.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(239,68,68,0.08)' }}>
                      <td style={{ padding: '0.5rem 0.875rem', fontFamily: 'monospace', color: '#fca5a5', fontWeight: 600 }}>{r.returnNumber}</td>
                      <td style={{ padding: '0.5rem 0.875rem', fontFamily: 'monospace', color: '#94a3b8' }}>{r.originalInvoice}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#e2e8f0' }}>{r.customerName}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#94a3b8', fontSize: '0.75rem' }}>{r.reason}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#64748b', fontSize: '0.72rem' }}>{r.createdAt ? formatDate(r.createdAt) : '—'}</td>
                      <td style={{ padding: '0.5rem 0.875rem', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>-{formatCurrency(r.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Phone Payments by Provider (R-REPORTS-PHONE-PROVIDER) ── */}
          {Object.keys(stats.phonePaymentsByProvider).length > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                📱 {t('reports.phonePaymentsByProvider')}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {[
                      locale === 'es' ? 'Proveedor' : locale === 'pt' ? 'Operadora' : 'Provider',
                      locale === 'es' ? 'Pagos' : locale === 'pt' ? 'Pagamentos' : 'Count',
                      'Total',
                      locale === 'es' ? 'Ganancia' : locale === 'pt' ? 'Lucro' : 'Profit',
                      locale === 'es' ? 'Margen' : locale === 'pt' ? 'Margem' : 'Margin',
                      locale === 'es' ? 'Números únicos' : locale === 'pt' ? 'Números únicos' : 'Unique Numbers',
                    ].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.875rem', color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.phonePaymentsByProvider)
                    .sort((a, b) => b[1].totalCents - a[1].totalCents)
                    .map(([provider, d]) => {
                      const uniqueNums = Array.from(d.numbers);
                      const preview = uniqueNums.slice(0, 5).join(', ');
                      const more = uniqueNums.length > 5 ? ` +${uniqueNums.length - 5}` : '';
                      const marginPct = d.totalCents > 0
                        ? (d.profitCents / d.totalCents) * 100
                        : 0;
                      return (
                        <tr key={provider} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '0.5rem 0.875rem', fontWeight: 600, color: '#e2e8f0' }}>{provider}</td>
                          <td style={{ padding: '0.5rem 0.875rem', color: '#94a3b8' }}>{d.count}</td>
                          <td style={{ padding: '0.5rem 0.875rem', fontWeight: 700, color: '#22c55e' }}>{formatCurrency(d.totalCents)}</td>
                          <td style={{ padding: '0.5rem 0.875rem', fontWeight: 700, color: d.profitCents < 0 ? '#ef4444' : '#86efac' }}>
                            {formatCurrency(d.profitCents)}
                          </td>
                          <td style={{ padding: '0.5rem 0.875rem', fontSize: '0.75rem', color: marginPct >= 5 ? '#86efac' : marginPct >= 0 ? '#fbbf24' : '#ef4444' }}>
                            {marginPct.toFixed(1)}%
                          </td>
                          <td style={{ padding: '0.5rem 0.875rem', fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
                            <span style={{ color: '#94a3b8', fontWeight: 700 }}>{uniqueNums.length}</span>
                            {uniqueNums.length > 0 && <span style={{ marginLeft: '0.5rem' }}>— {preview}{more}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  {(() => {
                    const totalCount = Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.count, 0);
                    const totalRevenue = Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.totalCents, 0);
                    const totalProfit = Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.profitCents, 0);
                    const totalMarginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
                    const allUnique = new Set<string>();
                    for (const d of Object.values(stats.phonePaymentsByProvider)) {
                      for (const n of d.numbers) allUnique.add(n);
                    }
                    return (
                      <tr style={{ borderTop: '2px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '0.5rem 0.875rem', fontWeight: 800, color: '#fff' }}>TOTAL</td>
                        <td style={{ padding: '0.5rem 0.875rem', fontWeight: 700, color: '#fff' }}>{totalCount}</td>
                        <td style={{ padding: '0.5rem 0.875rem', fontWeight: 800, color: '#22c55e', fontSize: '0.95rem' }}>
                          {formatCurrency(totalRevenue)}
                        </td>
                        <td style={{ padding: '0.5rem 0.875rem', fontWeight: 800, color: totalProfit < 0 ? '#ef4444' : '#86efac', fontSize: '0.95rem' }}>
                          {formatCurrency(totalProfit)}
                        </td>
                        <td style={{ padding: '0.5rem 0.875rem', fontWeight: 700, color: totalMarginPct >= 5 ? '#86efac' : totalMarginPct >= 0 ? '#fbbf24' : '#ef4444' }}>
                          {totalMarginPct.toFixed(1)}%
                        </td>
                        <td style={{ padding: '0.5rem 0.875rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.72rem' }}>
                          {allUnique.size} {locale === 'es' ? 'únicos' : locale === 'pt' ? 'únicos' : 'unique'}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Category Breakdown + Employee Performance ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                📊 {t('reports.categoryBreakdown')}
              </div>
              <div style={{ padding: '0.75rem' }}>
                {stats.categoriesByRevenue.length === 0 ? (
                  // Round 10.1 fix 3: clearer empty-state copy; card chrome stays.
                  <p style={{ fontSize: '0.82rem', color: '#475569', textAlign: 'center', padding: '1rem' }}>{t('reports.noTransactions')}</p>
                ) : (() => {
                  const maxRev = Math.max(...stats.categoriesByRevenue.map((c) => c.revenueCents), 1);
                  return stats.categoriesByRevenue.map((cat) => (
                    <div key={cat.name} onClick={() => setDrilldownCategory(cat.name)}
                      style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
                      title={locale === 'es' ? 'Clic para detalle' : 'Click to drill down'}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <div>
                          <span style={{ fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600 }}>{cat.name}</span>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: '0.5rem' }}>×{cat.quantity}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>{formatCurrency(cat.revenueCents)}</div>
                          {/* Round 10 fix 3: null marginPct → all items in this category were pseudo-items. */}
                          <div style={{ fontSize: '0.68rem', color: cat.marginPct === null ? '#64748b' : (cat.marginPct > 40 ? '#22c55e' : '#f59e0b') }}>
                            {cat.marginPct === null ? '—' : `${cat.marginPct.toFixed(1)}% margin`}
                          </div>
                        </div>
                      </div>
                      <div style={{ height: '5px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(Math.abs(cat.revenueCents) / maxRev) * 100}%`,
                          background: cat.marginPct === null
                            ? 'linear-gradient(90deg,#475569,#64748b)'
                            : (cat.marginPct > 40 ? 'linear-gradient(90deg,#10b981,#22c55e)' : 'linear-gradient(90deg,#f59e0b,#fbbf24)') }} />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                👥 {t('reports.employeePerf')}
              </div>
              <div style={{ padding: '0.75rem' }}>
                {stats.topEmployees.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: '#475569', textAlign: 'center', padding: '1rem' }}>{t('reports.noData')}</p>
                ) : stats.topEmployees.map((e) => (
                  <div key={e.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600 }}>{e.name || '—'}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{e.transactions} {locale === 'es' ? 'trans.' : 'trans.'}</div>
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#22c55e' }}>{formatCurrency(e.revenueCents)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Top Items ── */}
          {stats.topItems.length > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                🏆 {t('reports.topItems')}
              </div>
              <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {stats.topItems.map((item, i) => (
                  <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ color: '#64748b', minWidth: '18px', fontWeight: 700 }}>{i + 1}.</span>
                      <span style={{ color: '#e2e8f0' }}>{item.name}</span>
                      <span style={{ color: '#64748b', fontSize: '0.72rem' }}>×{item.quantity}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: '#a5b4fc' }}>{formatCurrency(item.revenueCents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── r-new-8: Cancellations (SO / Repair / Unlock) ── */}
          {cancellationsInPeriod.length > 0 && (
            <div style={{ background: 'rgba(239, 68, 68, 0.04)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(239, 68, 68, 0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#fca5a5' }}>
                  ❌ {t('reports.cancellations')}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                  {cancellationsInPeriod.length} {locale === 'es' ? 'cancelaciones' : locale === 'pt' ? 'cancelamentos' : 'cancellations'}
                </span>
              </div>

              {/* Summary row */}
              <div style={{
                padding: '0.75rem 1rem',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                gap: '1.5rem',
                fontSize: '0.82rem',
                flexWrap: 'wrap',
              }}>
                {cancellationTotals.storeCredit > 0 && (
                  <div>
                    <span style={{ color: '#9ca3af' }}>💳 {t('reports.storeCreditRefund')}: </span>
                    <span style={{ fontWeight: 700, color: '#60a5fa' }}>{formatCurrency(cancellationTotals.storeCredit)}</span>
                  </div>
                )}
                {cancellationTotals.cash > 0 && (
                  <div>
                    <span style={{ color: '#9ca3af' }}>💵 {t('reports.cashRefund')}: </span>
                    <span style={{ fontWeight: 700, color: '#fbbf24' }}>{formatCurrency(cancellationTotals.cash)}</span>
                  </div>
                )}
                {cancellationTotals.forfeit > 0 && (
                  <div>
                    <span style={{ color: '#9ca3af' }}>💰 {t('reports.forfeit')}: </span>
                    <span style={{ fontWeight: 700, color: '#a3e635' }}>{formatCurrency(cancellationTotals.forfeit)}</span>
                  </div>
                )}
              </div>

              {/* Rows */}
              <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'rgba(15, 23, 42, 0.95)' }}>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      {[
                        locale === 'es' ? 'Tipo' : locale === 'pt' ? 'Tipo' : 'Type',
                        'Ref.',
                        locale === 'es' ? 'Cliente' : locale === 'pt' ? 'Cliente' : 'Customer',
                        locale === 'es' ? 'Artículo' : locale === 'pt' ? 'Item' : 'Item',
                        locale === 'es' ? 'Método' : locale === 'pt' ? 'Método' : 'Method',
                        locale === 'es' ? 'Monto' : locale === 'pt' ? 'Valor' : 'Amount',
                        locale === 'es' ? 'Fecha' : locale === 'pt' ? 'Data' : 'Date',
                        '',
                      ].map((h, i) => (
                        <th key={h + i} style={{
                          textAlign: h === (locale === 'es' ? 'Monto' : locale === 'pt' ? 'Valor' : 'Amount') ? 'right' : 'left',
                          padding: '0.5rem 0.75rem',
                          color: '#9ca3af',
                          fontSize: '0.66rem',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cancellationsInPeriod.map((c) => {
                      const methodLabel = ({
                        store_credit: { text: locale === 'es' ? 'Crédito' : locale === 'pt' ? 'Crédito' : 'Credit', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
                        cash: { text: locale === 'es' ? 'Efectivo' : locale === 'pt' ? 'Dinheiro' : 'Cash', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
                        forfeit: { text: locale === 'es' ? 'Retenido' : locale === 'pt' ? 'Retido' : 'Forfeit', color: '#a3e635', bg: 'rgba(163, 230, 53, 0.15)' },
                        unknown: { text: locale === 'es' ? 'Desconocido' : locale === 'pt' ? 'Desconhecido' : 'Unknown', color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.15)' },
                      } as const)[c.refundMethod] || { text: '?', color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.15)' };

                      const dateStr = toDateSafe(c.cancelledAt)?.toLocaleString(locale === 'es' ? 'es-MX' : locale === 'pt' ? 'pt-BR' : 'en-US', {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      }) || '';

                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#d1d5db' }}>{c.typeLabel}</td>
                          <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.72rem', color: '#a5b4fc' }}>{c.reference}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#e5e7eb' }}>{c.customerName}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#9ca3af', fontSize: '0.74rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.itemDescription}>
                            {c.itemDescription}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <span style={{
                              padding: '0.15rem 0.5rem',
                              borderRadius: '0.3rem',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              background: methodLabel.bg,
                              color: methodLabel.color,
                            }}>
                              {methodLabel.text}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: c.refundMethod === 'forfeit' ? '#a3e635' : '#fca5a5' }}>
                            {c.refundMethod === 'forfeit' ? '+' : '-'}{formatCurrency(c.refundAmountCents)}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#9ca3af', fontSize: '0.72rem' }}>{dateStr}</td>
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                            <button
                              onClick={() => {
                                const html = buildCancellationReceiptHtml(
                                  { ...c, cancelledAt: typeof c.cancelledAt === 'string' ? c.cancelledAt : (toDateSafe(c.cancelledAt)?.toISOString() || new Date().toISOString()) },
                                  settings,
                                  locale,
                                  currentEmployee?.name,
                                );
                                const printer = localStorage.getItem('receiptModal.lastPrinter') || ((settings as any).detectedPrinters as string[] | undefined)?.[0];
                                printHtml(html, { silent: true, printer, pageSize: '4x6', copies: 1 });
                              }}
                              style={{
                                background: 'transparent',
                                border: '1px solid rgba(255,255,255,0.2)',
                                color: '#9ca3af',
                                cursor: 'pointer',
                                padding: '0.3rem 0.5rem',
                                borderRadius: '0.3rem',
                                fontSize: '0.85rem',
                              }}
                              title={locale === 'es' ? 'Imprimir recibo' : 'Print receipt'}
                            >
                              🖨
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Phone Payment Detail (per-line) ── */}
          {phonePaymentRows.length > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                  📞 {locale === 'es' ? 'Detalle de Pagos (Línea por Línea)' : 'Phone Payments Detail'}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{phonePaymentRows.length} {locale === 'es' ? 'líneas' : 'lines'}</span>
              </div>
              <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      {[locale === 'es' ? 'Cliente' : 'Customer', locale === 'es' ? 'Teléfono' : 'Phone', 'Carrier', 'Invoice', locale === 'es' ? 'Empleado' : 'Employee', 'Time', 'Amount'].map((h) => (
                        <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '0.45rem 0.75rem', color: '#64748b', fontSize: '0.66rem', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {phonePaymentRows.slice(0, 200).map((p) => (
                      <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: p.voided || p.refunded ? 0.5 : 1, textDecoration: p.voided || p.refunded ? 'line-through' : 'none' }}>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#e2e8f0' }}>{p.customerName}</td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.72rem' }}>{p.phoneNumber || '—'}</td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#a5b4fc', fontWeight: 600 }}>{p.carrier || '—'}</td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#818cf8', fontFamily: 'monospace', fontSize: '0.7rem' }}>{p.invoiceNumber}</td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#64748b', fontSize: '0.72rem' }}>{p.employeeName || '—'}</td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#475569', fontSize: '0.7rem' }}>{(() => { const d = toDateSafe(p.createdAt); return d ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'; })()}</td>
                        <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>{formatCurrency(p.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {phonePaymentRows.length > 200 && (
                  <div style={{ padding: '0.5rem', textAlign: 'center', fontSize: '0.72rem', color: '#475569' }}>
                    {locale === 'es' ? `Mostrando 200 de ${phonePaymentRows.length}` : `Showing 200 of ${phonePaymentRows.length}`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Transactions list ── */}
          <div id="reports-transactions-section" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                🧾 {t('reports.transactions')} ({displayedTx.length})
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ width: '220px' }}>
                  <SearchInput
                    value={txSearch}
                    onChange={setTxSearch}
                    placeholder={locale === 'es' ? 'Buscar invoice, cliente, item...' : 'Search invoice, customer, item...'}
                  />
                </div>
                <input type="date" className="input" style={{ width: '130px', fontSize: '0.78rem', padding: '0.35rem 0.5rem' }}
                  value={searchDateFrom} onChange={(e) => setSearchDateFrom(e.target.value)} />
                <input type="date" className="input" style={{ width: '130px', fontSize: '0.78rem', padding: '0.35rem 0.5rem' }}
                  value={searchDateTo} onChange={(e) => setSearchDateTo(e.target.value)} />
              </div>
            </div>
            <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
              {displayedTx.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2.5rem', color: '#475569', fontSize: '0.875rem' }}>
                  {t('reports.noTransactions')}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      {['Invoice', locale === 'es' ? 'Cliente' : 'Customer', locale === 'es' ? 'Items' : 'Items', locale === 'es' ? 'Pago' : 'Payment', locale === 'es' ? 'Empleado' : 'Employee', 'Total', locale === 'es' ? 'Hora' : 'Time', ''].map((h, i) => (
                        <th key={h + i} style={{ textAlign: h === 'Total' ? 'right' : 'left', padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedTx.map((sale) => {
                      const isVoided = sale.status === 'voided';
                      const isRefunded = sale.status === 'refunded';
                      const highlighted = isHighlighted(sale.id);
                      return (
                        <tr
                          key={sale.id}
                          ref={highlighted ? highlightRef : null}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            opacity: isVoided ? 0.5 : 1,
                            ...(highlighted ? { outline: '2px solid #667eea', background: 'rgba(102,126,234,0.08)' } : {}),
                          }}
                        >
                          <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#818cf8', fontWeight: 600 }}>
                            {sale.invoiceNumber}
                            {isVoided && <span style={{ marginLeft: '4px', fontSize: '0.65rem', color: '#ef4444', fontWeight: 700 }}>VOID</span>}
                            {isRefunded && <span style={{ marginLeft: '4px', fontSize: '0.65rem', color: '#f97316', fontWeight: 700 }}>REF</span>}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#e2e8f0' }}>{sale.customerName || (locale === 'es' ? 'Walk-in' : 'Walk-in')}</td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{(sale.items || []).length}</td>
                          <td style={{ padding: '0.5rem 0.75rem' }}>
                            <span style={{ padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', textTransform: 'capitalize' }}>{sale.paymentMethod}</span>
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.75rem' }}>{sale.employeeName || '—'}</td>
                          {/* R-EDIT-AUDIT F7-COSMETIC: negative-total refund sales render red alongside voided/refunded. */}
                          <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: ((sale.total || 0) < 0 || isVoided || isRefunded) ? '#ef4444' : '#22c55e' }}>
                            {(isVoided || isRefunded) ? `-${formatCurrency(Math.abs(sale.total || 0))}` : formatCurrency(sale.total)}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', color: '#475569', fontSize: '0.72rem' }}>{formatDateTime(sale.createdAt)}</td>
                          <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right' }}>
                            <button onClick={() => setReprintSale(sale)}
                              style={{ padding: '0.25rem 0.45rem', borderRadius: '0.35rem', border: '1px solid rgba(102,126,234,0.3)', background: 'rgba(102,126,234,0.1)', color: '#a5b4fc', cursor: 'pointer', fontSize: '0.75rem' }}
                              title={locale === 'es' ? 'Reimprimir' : 'Reprint'}>🖨️</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Drilldown modal ── */}
      {drilldownCategory && drilldownItems && (
        <div onClick={() => setDrilldownCategory(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', maxWidth: '700px', width: '100%', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, color: '#fff' }}>{drilldownCategory} — {drilldownItems.length} {locale === 'es' ? 'artículos' : 'items'}</span>
              <button onClick={() => setDrilldownCategory(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '0.5rem' }}>
              {drilldownItems.length === 0 ? (
                <p style={{ padding: '2rem', textAlign: 'center', color: '#475569' }}>{locale === 'es' ? 'Sin datos' : 'No data'}</p>
              ) : (
                <table style={{ width: '100%', fontSize: '0.82rem' }}>
                  <tbody>
                    {drilldownItems.map((it, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', color: '#e2e8f0' }}>{it.name}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: '#64748b' }}>×{it.qty}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.72rem' }}>{it.saleInvoice}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>{formatCurrency(it.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Reprint sale modal (placeholder — opens existing receipt logic) ── */}
      {reprintSale && (
        <div onClick={() => setReprintSale(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', padding: '1.5rem', maxWidth: '420px' }}>
            <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.75rem' }}>{t('reports.reprintReceipt')}</div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Invoice: <strong style={{ color: '#a5b4fc', fontFamily: 'monospace' }}>{reprintSale.invoiceNumber}</strong><br />
              Total: <strong style={{ color: '#22c55e' }}>{formatCurrency(reprintSale.total)}</strong>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setReprintSale(null)}
                style={{ padding: '0.5rem 1rem', borderRadius: '0.4rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer' }}>
                {locale === 'es' ? 'Cerrar' : 'Close'}
              </button>
              <button onClick={() => {
                // Round 17: real reprint via generateReceiptHtml (hardened in round 12)
                // + usePrint hook (Electron thermal silent / browser window fallback).
                // Previously this called window.print() which printed the entire Reports page.
                const bsvg = renderBarcodeSvg(reprintSale.invoiceNumber);
                const html = generateReceiptHtml(reprintSale, settings, locale, undefined, bsvg);
                printHtml(html, {
                  silent: false,
                  printer: settings.detectedPrinters?.[0],
                });
                setReprintSale(null);
              }}
                style={{ padding: '0.5rem 1rem', borderRadius: '0.4rem', background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 600 }}>
                🖨️ {locale === 'es' ? 'Imprimir' : 'Print'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
