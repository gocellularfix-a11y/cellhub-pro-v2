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
// R-SPECIAL-ORDERS-TAX-SEPARATED-REPORTING-FIX: reverse-tax helper to split
// a tax-inclusive cart-line price into base + tax for reporting only.
import { reverseTaxFromPayment } from '@/utils/depositTax';
import { formatDate, formatDateTime } from '@/utils/dates';
import { loadLocal } from '@/services/storage';
import { SearchInput, Modal, useToast } from '@/components/ui';
// R-OPERATIONS-VOID-SALE-AND-LOSSES-AUDIT-V1: void-sale flow uses the
// canonical admin-PIN gate + persist surface used elsewhere in the app.
import AdminPinGate from '@/components/shared/AdminPinGate';
import { persist } from '@/services/persist';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { usePrint, openPrintWindow } from '@/hooks/usePrint';
import type { PrintPageSizeKey } from '@/hooks/usePrint';
import { generateReceiptHtml, renderBarcodeSvg } from '@/modules/pos/ReceiptModal';
import { buildReceiptBarcodePayload } from '@/services/barcode/receiptPayload';
import { normalizeCarrier } from '@/utils/normalize';
import { matchesSearchPhones } from '@/utils/search';
import type { Sale, SaleItem, Repair, Unlock, SpecialOrder, Layaway, InventoryItem, CartItem, StoreCreditLedger } from '@/store/types';
import { summarizeLedger, voidLedgerEntry } from '@/services/storeCredit/ledger';
import { buildCancellationReceiptHtml } from './printCancellationReceipt';
import { getActivePortals, getDefaultPortalId } from '@/config/paymentPortals';
// R-REPORTS-EDIT-SALE-ITEM-V1: shared totals helper + audit trail helpers.
// calculateCartTotals re-derives subtotal/salesTax/total from the modified
// items so we don't reimplement tax math here. captureSnapshot/appendEditEntry
// match the audit conventions used by repair/unlock/SO modules.
import { calculateCartTotals } from '@/modules/pos/types';
import { captureSnapshot, appendEditEntry } from '@/services/editAudit';

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
  const laborCost = entity.laborCost || 0;
  const totalCostCents = partsCost + laborCost;
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
type ItemKind = 'phone_payment' | 'topup' | 'repair' | 'unlock' | 'special_order' | 'cc_fee' | 'service' | 'product' | 'exchange_credit';

function classifyItem(item: SaleItem): ItemKind {
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
  // R-RETURNS-CREDIT-OWNER + STORE-CREDIT-CERTIFICATE
  employeeName?: string;
  certificateNumber?: string;
  recipientName?: string;
  recipientPhone?: string;
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
    state: { sales, repairs, unlocks, specialOrders, layaways, inventory, customers, settings, globalSearchTerm, pendingReportDate, currentEmployee, customerReturns, vendorReturns, inventoryLosses, storeCreditLedger },
    dispatch,
    setStoreCreditLedger,
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

  // R-OPERATIONS-VOID-SALE-AND-LOSSES-AUDIT-V1: void-sale flow state.
  // The sale is voided as a STATUS CHANGE (status='voided' + voidedAt +
  // voidedBy + voidReason). Existing isCountableSale / dashboard /
  // intelligence filters already exclude voided sales from active
  // totals/profit/KPIs. Inventory restored only for stockable line
  // items (skips phone_payment / top_up / service / cc_fee / etc.).
  // External payment refund is NOT triggered — owner handles payment-
  // processor refund separately.
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState<string>('');
  const [voidPinOpen, setVoidPinOpen] = useState(false);
  const [voiding, setVoiding] = useState(false);
  // R-REPORTS-EDIT-SALE-ITEM-V1: edit-sale-item flow state. Owner clicks ✏️
  // on a sale row → modal lists items → click an item → edit price/qty +
  // pick reason + add notes → PIN gate → recalc + persist + audit.
  const [editTarget, setEditTarget] = useState<Sale | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [editQty, setEditQty] = useState<string>('1');
  const [editReason, setEditReason] = useState<'refund' | 'absorbed' | 'typo_correction' | ''>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editPinOpen, setEditPinOpen] = useState(false);
  const [editingSale, setEditingSale] = useState(false);
  const [reprintAfterEdit, setReprintAfterEdit] = useState<Sale | null>(null);
  const { toast } = useToast();

  // R-OPERATIONS-VOID-SALE-AND-LOSSES-AUDIT-V1: stockable item filter.
  // Mirrors POSModule's decrement: only items with an inventoryId AND
  // a non-service category get inventory restored on void. Phone-
  // payments, top-ups, services, CC fees, fees and pseudo deposits/
  // balances are NOT in inventory, so we don't touch stock for them.
  const isStockableForVoid = useCallback((item: SaleItem): boolean => {
    if (!item.inventoryId) return false;
    const cat = String(item.category || '').toLowerCase();
    if (cat === 'phone_payment' || cat === 'top_up' || cat === 'topup') return false;
    if (cat === 'service' || cat === 'services') return false;
    if (cat === 'cc_fee' || cat === 'fee') return false;
    return true;
  }, []);

  const handleVoidSale = useCallback((sale: Sale, reason: string) => {
    if (voiding) return;
    if (sale.status === 'voided') {
      toast(t('reports.voidAlreadyVoided'), 'warning');
      return;
    }
    if (sale.status === 'refunded') {
      toast(t('reports.voidAlreadyRefunded'), 'warning');
      return;
    }
    if (!reason || !reason.trim()) {
      toast(t('reports.voidReasonRequired'), 'warning');
      return;
    }
    setVoiding(true);
    try {
      const now = new Date().toISOString();
      // Build the voided sale record — full spread per persist contract.
      const voidedSale: Sale = {
        ...sale,
        status: 'voided',
        voidedAt: now,
        voidedBy: currentEmployee?.name || '—',
        voidReason: reason.trim(),
      };
      // Restore inventory for stockable line items only.
      const inventoryUpdates: { id: string; data: InventoryItem }[] = [];
      const nextInventory = inventory.map((inv) => {
        const restoreItems = (sale.items || []).filter(
          (it) => isStockableForVoid(it) && it.inventoryId === inv.id,
        );
        if (restoreItems.length === 0) return inv;
        const restoreQty = restoreItems.reduce(
          (sum, it) => sum + (it.qty || (it as { quantity?: number }).quantity || 0),
          0,
        );
        if (restoreQty <= 0) return inv;
        const updated: InventoryItem = { ...inv, qty: (inv.qty || 0) + restoreQty };
        inventoryUpdates.push({ id: inv.id, data: updated });
        return updated;
      });
      // Persist sale + each touched inventory item via the existing
      // persist surface. Full record spread per CLAUDE.md / persist
      // contract — no partial writes.
      const nextSales = sales.map((s) => (s.id === sale.id ? voidedSale : s));
      dispatch({ type: 'SET_SALES', payload: nextSales });
      persist.sale(voidedSale.id, voidedSale as unknown as Record<string, unknown>);
      if (inventoryUpdates.length > 0) {
        dispatch({ type: 'SET_INVENTORY', payload: nextInventory });
        for (const upd of inventoryUpdates) {
          persist.inventory(upd.id, upd.data as unknown as Record<string, unknown>);
        }
      }
      toast(t('reports.voidedToast', sale.invoiceNumber), 'success');
      // Show the manual-refund warning as a follow-up toast so the
      // owner is reminded that no payment processor was contacted.
      window.setTimeout(() => {
        toast(t('reports.voidPaymentReminder'), 'info');
      }, 600);
      setVoidTarget(null);
      setVoidReason('');
      setVoidPinOpen(false);
    } catch (err) {
      console.error('[void-sale] failed', err);
      toast(t('reports.voidFailed'), 'error');
    } finally {
      setVoiding(false);
    }
  }, [voiding, sales, inventory, currentEmployee, dispatch, isStockableForVoid, t, toast]);

  // R-REPORTS-EDIT-SALE-ITEM-V1: edit a single sale item's price + qty after
  // checkout. Owner-only via AdminPinGate. Mutates the sale's items array
  // and recalculates subtotal/salesTax/total via calculateCartTotals (single
  // source of truth, same code POS uses). Preserves the original cart-level
  // discount as a flat dollar amount, all phone-payment fees (utility tax,
  // mobility surcharge), CC fees, CBE fee, screen fee. Appends to
  // editHistory; captures originalSnapshot on first edit. NO new sale
  // record, NO inventory mutation, NO refund-record creation. The audit
  // log is the single record of the edit; cash drawer reconciliation is
  // owner-handled per the chosen reason.
  const handleEditSaleItem = useCallback((
    sale: Sale,
    itemId: string,
    newPriceCents: number,
    newQty: number,
    reason: 'refund' | 'absorbed' | 'typo_correction',
    notes: string,
  ) => {
    if (editingSale) return;
    if (sale.status === 'voided' || sale.status === 'refunded') {
      toast(t('reports.editSale.blockTerminal'), 'warning');
      return;
    }
    const fresh = sales.find((s) => s.id === sale.id);
    if (!fresh) {
      toast(t('reports.editSale.notFound'), 'error');
      return;
    }
    const item = fresh.items.find((it) => it.id === itemId);
    if (!item) {
      toast(t('reports.editSale.itemNotFound'), 'error');
      return;
    }
    if ((item.returnedQty || 0) > 0 || item.fullyReturned) {
      toast(t('reports.editSale.blockReturned'), 'warning');
      return;
    }
    if (!Number.isFinite(newPriceCents) || newPriceCents < 0) {
      toast(t('reports.editSale.invalidPrice'), 'warning');
      return;
    }
    if (!Number.isFinite(newQty) || newQty < 1) {
      toast(t('reports.editSale.invalidQty'), 'warning');
      return;
    }
    if (!reason) {
      toast(t('reports.editSale.reasonRequired'), 'warning');
      return;
    }
    const history = fresh.editHistory ?? [];
    if (history.length >= 100) {
      toast(t('reports.editSale.historyFull'), 'error');
      return;
    }

    setEditingSale(true);
    try {
      const now = new Date().toISOString();
      // Build modified items: replace target with new price + qty.
      const oldItem = item;
      const newItem: SaleItem = { ...oldItem, price: newPriceCents, qty: newQty };
      const modifiedItems = fresh.items.map((it) => (it.id === itemId ? newItem : it));

      // Preserve the original cart-level discount as a flat dollar amount so
      // calculateCartTotals reproduces it on the new subtotal. type='dollar'
      // amount in DOLLARS (the helper multiplies by 100 internally).
      const originalDiscountCents = Math.max(
        0,
        (fresh.subtotal || 0) - (fresh.subtotalAfterDiscount ?? fresh.subtotal ?? 0),
      );
      const recalc = calculateCartTotals(
        modifiedItems as unknown as CartItem[],
        settings,
        { type: 'dollar' as const, amount: originalDiscountCents / 100, reason: '' },
        fresh.paymentMethod,
        (fresh.creditCardFee ?? 0) > 0,
        undefined,
        fresh.creditCardFee ?? 0,
      );

      // Build edit-audit entry. fieldsChanged captures what changed; sideEffects
      // carries the dollar delta + reason-specific fields.
      const totalDelta = (fresh.total || 0) - (recalc.total || 0); // positive = customer owed back
      const fieldsChanged: { field: string; oldValue: unknown; newValue: unknown }[] = [];
      if (oldItem.price !== newItem.price) {
        fieldsChanged.push({ field: `items[${itemId}].price`, oldValue: oldItem.price, newValue: newItem.price });
      }
      if (oldItem.qty !== newItem.qty) {
        fieldsChanged.push({ field: `items[${itemId}].qty`, oldValue: oldItem.qty, newValue: newItem.qty });
      }

      const sideEffects: { refundOwedAmount?: number; absorbedAmount?: number } = {};
      if (reason === 'refund' && totalDelta > 0) sideEffects.refundOwedAmount = totalDelta;
      if (reason === 'absorbed' && totalDelta > 0) sideEffects.absorbedAmount = totalDelta;

      const entry = {
        editedAt: now,
        editedBy: currentEmployee?.name || '—',
        pinUsedBy: currentEmployee?.name || '—',
        reason,
        fieldsChanged,
        note: notes.trim() || undefined,
        sideEffects: Object.keys(sideEffects).length > 0 ? sideEffects : undefined,
      };
      const newHistory = appendEditEntry(history, entry);
      if (newHistory === null) {
        toast(t('reports.editSale.historyFull'), 'error');
        setEditingSale(false);
        return;
      }

      const editedSale: Sale = {
        ...fresh,
        items: modifiedItems,
        subtotal: recalc.subtotal,
        subtotalAfterDiscount: recalc.subtotalAfterDiscount,
        salesTax: recalc.salesTax,
        utilityTax: recalc.utilityTax,
        mobileSurcharge: recalc.mobileSurcharge,
        cbeTotal: recalc.cbeFee,
        screenFeeTotal: recalc.screenFee,
        // taxAmount kept as legacy aggregate.
        taxAmount: (recalc.salesTax || 0) + (recalc.utilityTax || 0) + (recalc.mobileSurcharge || 0),
        total: recalc.total,
        editHistory: newHistory,
        // Capture originalSnapshot ONCE on the first edit (never overwritten).
        originalSnapshot: fresh.originalSnapshot ?? captureSnapshot(fresh as unknown as Record<string, unknown>),
      };

      const nextSales = sales.map((s) => (s.id === sale.id ? editedSale : s));
      dispatch({ type: 'SET_SALES', payload: nextSales });
      persist.sale(editedSale.id, editedSale as unknown as Record<string, unknown>);

      toast(t('reports.editSale.savedToast', editedSale.invoiceNumber), 'success');
      // Offer a corrected-receipt reprint for non-typo edits (typo doesn't
      // change money — no need to reissue). Owner can decline.
      if (reason !== 'typo_correction') {
        setReprintAfterEdit(editedSale);
      }
      setEditTarget(null);
      setEditItemId(null);
      setEditPrice('');
      setEditQty('1');
      setEditReason('');
      setEditNotes('');
      setEditPinOpen(false);
    } catch (err) {
      console.error('[edit-sale-item] failed', err);
      toast(t('reports.editSale.failed'), 'error');
    } finally {
      setEditingSale(false);
    }
  }, [editingSale, sales, settings, currentEmployee, dispatch, t, toast]);

  // ── Consume globalSearchTerm (+ pendingReportDate for invoice navigation) ──
  useEffect(() => {
    if (!globalSearchTerm) return;
    setTxSearch(globalSearchTerm);
    dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    // If a specific sale date was passed (e.g. from BarcodeActionModal), jump
    // to that date so the invoice is inside the filtered window. Without this
    // the user lands on today's date and the old invoice is invisible.
    if (pendingReportDate) {
      setStartDate(pendingReportDate);
      setEndDate(pendingReportDate);
      setReportType('daily');
      dispatch({ type: 'SET_PENDING_REPORT_DATE', payload: '' });
    }
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

  // R-LOSSES-SHRINKAGE-V1: filtered losses + summary for the Losses /
  // Shrinkage section. Newest first. Losses are NOT sales / refunds /
  // voids — they don't contribute to revenue, tax, or COGS in V1, just
  // their own audit + total. Net-profit integration is documented as a
  // follow-up so we don't hack a fake sale/refund pathway.
  const filteredLosses = useMemo(() => {
    const src = Array.isArray(inventoryLosses) ? inventoryLosses : [];
    return src
      .filter((l) => inRange(l.createdAt))
      .sort((a, b) => {
        const da = toDateSafe(a.createdAt)?.getTime() || 0;
        const db = toDateSafe(b.createdAt)?.getTime() || 0;
        return db - da;
      });
  }, [inventoryLosses, inRange]);

  const lossesSummary = useMemo(() => {
    let totalLossCents = 0;
    let totalQty = 0;
    for (const l of filteredLosses) {
      totalLossCents += l.totalLoss || 0;
      totalQty += l.qty || 0;
    }
    return {
      count: filteredLosses.length,
      totalLossCents,
      totalQty,
    };
  }, [filteredLosses]);

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
      // R-RETURNS-CREDIT-OWNER + STORE-CREDIT-CERTIFICATE (additive)
      employeeName: r.employeeName || '',
      certificateNumber: r.certificateNumber,
      recipientName: r.recipientName,
      recipientPhone: r.recipientPhone,
    }));
  }, [customerReturns]);

  // R-STORE-CREDIT-REDEMPTION-SYSTEM: ledger summary + void wiring.
  const ledgerSummary = useMemo(() => summarizeLedger(storeCreditLedger), [storeCreditLedger]);
  const [voidCertTarget, setVoidCertTarget] = useState<StoreCreditLedger | null>(null);
  const [voidCertReason, setVoidCertReason] = useState('');
  const [voidCertPinOpen, setVoidCertPinOpen] = useState(false);

  const handleVoidCertificate = useCallback((target: StoreCreditLedger, reason: string) => {
    try {
      const next = voidLedgerEntry(target, {
        employeeId: currentEmployee?.id,
        employeeName: currentEmployee?.name || '',
        reason: reason.trim() || undefined,
      });
      const updated = (storeCreditLedger || []).map((l) => (l.id === target.id ? next : l));
      setStoreCreditLedger(updated);
      persist.storeCreditLedger(next.id, next as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn('[Reports] void cert failed:', err);
    }
    setVoidCertPinOpen(false);
    setVoidCertTarget(null);
    setVoidCertReason('');
  }, [storeCreditLedger, setStoreCreditLedger, currentEmployee]);

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
        typeLabel: t('reports.typeSpecialOrder'),
        reference: so.id.slice(-8).toUpperCase(),
        customerName: so.customerName || t('reports.noName'),
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
        typeLabel: t('reports.typeRepair'),
        reference: ((r as any).ticketNumber || r.id.slice(-8)).toString().toUpperCase(),
        customerName: r.customerName || t('reports.noName'),
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
        typeLabel: t('reports.typeUnlock'),
        reference: u.id.slice(-8).toUpperCase(),
        customerName: u.customerName || t('reports.noName'),
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
            const linked = unlocksById.get(item.unlockId);
            costCents = linked?.cost || 0;
          }
          profitCents = revenueCents - costCents;
        } else if (kind === 'special_order') {
          catName = 'Special Orders';
          // R-SPECIAL-ORDERS-TAX-SEPARATED-REPORTING-FIX:
          // When the SO deposit/balance cart line was added with
          // `taxable: false` but the underlying SpecialOrder entity is
          // marked taxable, the line's `price` is a tax-INCLUSIVE total
          // and sale.salesTax is $0 for it. That inflates the SO category
          // revenue (and profit) by the tax portion. Reverse-calc the
          // base + tax using the canonical helper, then route the
          // extracted tax to the existing productSalesTax bucket so it
          // lands in "Sales Tax / Total Taxes & Fees".
          //
          // Conservative trigger: only kicks in when BOTH (a) the cart
          // line is non-taxable (so its tax wasn't already split into
          // sale.salesTax) AND (b) the linked SpecialOrder record was
          // marked taxable. If the SO record has no taxable field, we
          // do NOT fabricate tax — revenue stays as-is.
          const linkedSO = item.specialOrderId ? ordersById.get(item.specialOrderId) : undefined;
          const linkedSoTaxable = !!(linkedSO as unknown as { taxable?: boolean } | undefined)?.taxable;
          if (!item.taxable && linkedSoTaxable && revenueCents > 0) {
            const rate = settings.taxRate ?? 0.0925;
            const split = reverseTaxFromPayment(revenueCents, rate, true);
            revenueCents = split.baseCents;
            productSalesTaxCents += split.taxCents;
          }
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
  }, [filteredSales, allFilteredSales, filteredRepairs, filteredUnlocks, standaloneRepairs, standaloneUnlocks, returnsFromPeriodSales, filteredVendorReturns, inventory, settings, safeRepairs, safeUnlocks, safeSpecialOrders, safeLayaways, locale, t]);

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

  // ── R-REPORT-ZTAPE-RECONCILIATION-FIX: temporary debug ──────────────────
  // Logs the 6 reconciliation buckets to the devtools console whenever the
  // stats memo recomputes. Intended to be left on while Jorge reconciles a
  // few days of reports against the physical Z tape; rip out the useEffect
  // (and the corresponding console.table call) once the reconciliation UI
  // has been verified to match.
  useEffect(() => {
    if (!stats?.recon) return;
    const r = stats.recon;
    const fmt = (c: number) => (c / 100).toFixed(2);
    // eslint-disable-next-line no-console
    console.table({
      'Gross Collected (~Z NET2)':       fmt(r.grossCollectedCents),
      'Tax Collected (bruto, ~Z TTL TAX)': fmt(r.taxCollectedCents),
      'Fee Collected (cbe + screen)':    fmt(r.feeCollectedCents),
      'Refund Tax Adjustment':           fmt(r.refundTaxAdjustmentCents),
      'Operational Revenue (~Z NET1)':   fmt(r.operationalRevenueCents),
      'Net Revenue (gross − returns)':   fmt(r.netRevenueCents),
      'Returns Total':                   fmt(r.totalReturnsCents),
    });

    // R-FINANCIAL-BUCKET-PURITY-FIX P3: reconciliation assertion.
    // Σ category line revenue must equal subtotalBeforeTax within ±1 cent.
    // Drift here means a discount or pseudo-item revenue didn't allocate
    // properly to its line, OR an item carries a price that diverges from
    // the sale's subtotal contribution. Debug-warning only — never crashes
    // and never blocks the UI. Remove this block when the production data
    // has reconciled cleanly across multiple days.
    const categoryPreTaxTotalCents = stats.categoriesByRevenue.reduce(
      (s, c) => s + c.revenueCents,
      0,
    );
    const reconDeltaCents = categoryPreTaxTotalCents - stats.subtotalBeforeTaxCents;
    if (Math.abs(reconDeltaCents) > 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `[finance-recon] categoryPreTaxTotal vs subtotalBeforeTax drift: ${(reconDeltaCents / 100).toFixed(2)} `
        + `(categoryTotal=${(categoryPreTaxTotalCents / 100).toFixed(2)}, `
        + `subtotalBeforeTax=${(stats.subtotalBeforeTaxCents / 100).toFixed(2)}, `
        + `period=${periodRange})`,
      );
    }
  }, [stats, periodRange]);

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
          customerName: sale.customerName || t('reports.walkIn'),
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

  // ── R-REPORT-FEES-BREAKDOWN: per-category counts/revenue for the
  // Transaction Breakdown table. A sale is counted in both Product and
  // Phone columns when mixed (matches TaxReportsModule semantics).
  const breakdownRows = useMemo(() => {
    let productCount = 0, productRevenue = 0;
    let phoneCount = 0, phoneRevenue = 0;
    for (const sale of filteredSales) {
      let saleProductRev = 0;
      let salePhoneRev = 0;
      for (const item of (sale.items || [])) {
        const kind = classifyItem(item);
        const rev = lineRevenueCents(item);
        if (kind === 'phone_payment') salePhoneRev += rev;
        else if (kind !== 'repair' && kind !== 'unlock') saleProductRev += rev;
      }
      if (saleProductRev > 0) { productCount++; productRevenue += saleProductRev; }
      if (salePhoneRev > 0) { phoneCount++; phoneRevenue += salePhoneRev; }
    }
    const repairCat = stats.categoriesByRevenue.find((c) => normalizeCategoryKey(c.name) === normalizeCategoryKey('Repairs'));
    const unlockCat = stats.categoriesByRevenue.find((c) => normalizeCategoryKey(c.name) === normalizeCategoryKey('Unlocks'));
    return {
      productCount, productRevenue,
      phoneCount, phoneRevenue,
      repairCount: stats.completedRepairCount,
      repairRevenue: repairCat?.revenueCents || 0,
      unlockCount: stats.unlockCount,
      unlockRevenue: unlockCat?.revenueCents || 0,
    };
  }, [filteredSales, stats]);

  // ── Transactions display (search + secondary date filter) ──
  const displayedTx = useMemo(() => {
    return allFilteredSales.filter((s) => {
      if (txSearch.trim()) {
        // R-SEARCH-NORMALIZE-V1: replace inline includes() with the
        // shared phone-aware helper so "(805) 555-1234" matches a sale
        // whose stored customerPhone is "8055551234". Item names are
        // folded into the textFields list so item-text search still
        // works. Financial math is NOT touched — this filter only
        // gates which already-computed rows render.
        const itemNames = (s.items || []).map((i) => i.name || '');
        if (!matchesSearchPhones(
          txSearch,
          [s.customerPhone],
          s.invoiceNumber, s.customerName, s.employeeName,
          ...itemNames,
        )) return false;
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
        let catGuess = kind === 'phone_payment' ? 'Phone Payments'
          : kind === 'topup' ? 'Top-Ups'
          : kind === 'repair' ? 'Repairs'
          : kind === 'unlock' ? 'Unlocks'
          : kind === 'special_order' ? 'Special Orders'
          : kind === 'cc_fee' ? 'CC Fees'
          : kind === 'service' ? 'Services'
          : kind === 'exchange_credit' ? 'Returns'
          : (item.category || 'Products');
        // R-REPORTS-ANALYTICS-FINANCIAL-AUDIT-V1: mirror the aggregation
        // rule at line ~828 — layaway-linked items always bucket under
        // 'Layaway'. Without this, the breakdown shows "Layaway × 1" but
        // clicking the row finds 0 items because the drilldown filter
        // here was using item.category (e.g., 'cellphones') instead of
        // the layaway override. Pure presentation alignment; no math.
        if (item.layawayId) catGuess = 'Layaway';
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

    // R-REPORT-PRINT-REDESIGN: trilingual labels hoisted out of the template
    // literal so the HTML stays readable. Section headers carry emojis to
    // mirror the on-screen module nav. EN / ES / PT preserved per spec.
    const L = {
      title:        locale === 'es' ? 'Reporte de Ventas'        : locale === 'pt' ? 'Relatório de Vendas'           : 'Sales Report',
      generated:    locale === 'es' ? 'Generado'                  : locale === 'pt' ? 'Gerado'                         : 'Generated',
      gross:        locale === 'es' ? 'Ingreso Bruto'             : locale === 'pt' ? 'Receita Bruta'                  : 'Gross Revenue',
      returns:      locale === 'es' ? 'Devoluciones'              : locale === 'pt' ? 'Devoluções'                     : 'Returns',
      net:          locale === 'es' ? 'Ingreso Neto'              : locale === 'pt' ? 'Receita Líquida'                : 'Net Revenue',
      profit:       locale === 'es' ? 'Ganancia'                  : locale === 'pt' ? 'Lucro'                          : 'Profit',
      sales:        locale === 'es' ? 'ventas'                    : locale === 'pt' ? 'vendas'                         : 'sales',
      returnsCount: locale === 'es' ? 'devoluciones'              : locale === 'pt' ? 'devoluções'                     : 'returns',
      retained:     locale === 'es' ? 'retenido'                  : locale === 'pt' ? 'retido'                         : 'retained',
      marginLower:  locale === 'es' ? 'margen'                    : locale === 'pt' ? 'margem'                         : 'margin',
      tax:          locale === 'es' ? 'Impuesto (CDTFA)'          : locale === 'pt' ? 'Imposto (CDTFA)'                : 'Tax (CDTFA)',
      salesTax:     locale === 'es' ? 'Impuesto de Venta'         : locale === 'pt' ? 'Imposto sobre Vendas'           : 'Sales Tax',
      utilityTax:   locale === 'es' ? 'Impuesto de Utilidad'      : locale === 'pt' ? 'Taxa de Utilidade'              : 'Utility Tax',
      mobilityFee:  locale === 'es' ? 'Cargo de Movilidad CA'     : locale === 'pt' ? 'Taxa de Mobilidade CA'          : 'CA Mobility Fee',
      cbeFee:       locale === 'es' ? 'Cargo CBE'                  : locale === 'pt' ? 'Taxa CBE'                        : 'CBE Fee',
      screenFee:    locale === 'es' ? 'Cargo de Pantalla'         : locale === 'pt' ? 'Taxa de Tela'                    : 'Screen Fee',
      totalFees:    locale === 'es' ? 'Total Impuestos y Cargos'  : locale === 'pt' ? 'Total Impostos e Taxas'         : 'Total Taxes & Fees',
      cash:         locale === 'es' ? 'Efectivo'                  : locale === 'pt' ? 'Dinheiro'                       : 'Cash',
      card:         locale === 'es' ? 'Tarjeta'                   : locale === 'pt' ? 'Cartão'                         : 'Card',
      ppHeader:     locale === 'es' ? '📞 Pagos por Proveedor'   : locale === 'pt' ? '📞 Pagamentos por Provedor'    : '📞 Phone Payments by Provider',
      catHeader:    locale === 'es' ? '📦 Ventas por Categoría'  : locale === 'pt' ? '📦 Vendas por Categoria'       : '📦 Sales by Category',
      empHeader:    locale === 'es' ? '👥 Desempeño de Empleados': locale === 'pt' ? '👥 Desempenho de Funcionários' : '👥 Employee Performance',
      itemHeader:   locale === 'es' ? '⭐ Artículos Más Vendidos' : locale === 'pt' ? '⭐ Itens Mais Vendidos'         : '⭐ Top Selling Items',
      provider:     locale === 'es' ? 'Proveedor'                 : locale === 'pt' ? 'Provedor'                       : 'Provider',
      count:        locale === 'es' ? 'Cant.'                     : locale === 'pt' ? 'Qtd.'                           : 'Count',
      total:        'TOTAL',
      category:     locale === 'es' ? 'Categoría'                 : locale === 'pt' ? 'Categoria'                      : 'Category',
      qty:          'Qty',
      revenue:      locale === 'es' ? 'Ingresos'                  : locale === 'pt' ? 'Receita'                        : 'Revenue',
      marginCol:    locale === 'es' ? 'Margen'                    : locale === 'pt' ? 'Margem'                         : 'Margin',
      employee:     locale === 'es' ? 'Empleado'                  : locale === 'pt' ? 'Funcionário'                    : 'Employee',
      trans:        'Trans.',
      item:         locale === 'es' ? 'Artículo'                  : locale === 'pt' ? 'Item'                           : 'Item',
      netTotal:     locale === 'es' ? 'TOTAL NETO'                : locale === 'pt' ? 'TOTAL LÍQUIDO'                  : 'NET TOTAL',
    };

    // All user-controlled strings below MUST go through escHtml (round 17 XSS fix).
    // formatCurrency output is safe (pure numeric), same for quantities and percentages.
    const ppRows = Object.entries(stats.phonePaymentsByProvider)
      .sort((a, b) => b[1].totalCents - a[1].totalCents)
      .map(([c, d]) => {
        const margin = d.totalCents > 0 ? (d.profitCents / d.totalCents) * 100 : 0;
        return `<tr><td>${escHtml(c)}</td><td class="text-right">${d.count}</td><td class="text-right">${formatCurrency(d.totalCents)}</td><td class="text-right text-green">${formatCurrency(d.profitCents)}</td><td class="text-right">${margin.toFixed(1)}%</td></tr>`;
      })
      .join('');
    const ppTotal = {
      count: Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.count, 0),
      revenue: Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.totalCents, 0),
      profit: Object.values(stats.phonePaymentsByProvider).reduce((s, d) => s + d.profitCents, 0),
    };
    const ppMargin = ppTotal.revenue > 0 ? (ppTotal.profit / ppTotal.revenue) * 100 : 0;
    const ppTotalRow = `<tr class="row-total"><td>${L.total}</td><td class="text-right">${ppTotal.count}</td><td class="text-right text-green">${formatCurrency(ppTotal.revenue)}</td><td class="text-right text-green">${formatCurrency(ppTotal.profit)}</td><td class="text-right">${ppMargin.toFixed(1)}%</td></tr>`;

    const catRows = stats.categoriesByRevenue
      .map((c) => `<tr><td>${escHtml(c.name)}</td><td class="text-right">${c.quantity}</td><td class="text-right">${formatCurrency(c.revenueCents)}</td><td class="text-right text-green">${formatCurrency(c.profitCents)}</td><td class="text-right">${c.marginPct === null ? '—' : `${c.marginPct.toFixed(1)}%`}</td></tr>`)
      .join('');
    // R-REPORT-PRINT-REDESIGN: TOTAL row for Sales by Category. Margin uses
    // revenue as denominator (consistent with phone payments TOTAL above);
    // per-row margins still use their own pseudoRevenue-aware denominator
    // from the data prep memo so they don't drift.
    const catTotal = stats.categoriesByRevenue.reduce(
      (acc, c) => ({
        qty: acc.qty + c.quantity,
        revenue: acc.revenue + c.revenueCents,
        profit: acc.profit + c.profitCents,
      }),
      { qty: 0, revenue: 0, profit: 0 },
    );
    const catMargin = catTotal.revenue > 0 ? (catTotal.profit / catTotal.revenue) * 100 : 0;
    const catTotalRow = `<tr class="row-total"><td>${L.total}</td><td class="text-right">${catTotal.qty}</td><td class="text-right text-green">${formatCurrency(catTotal.revenue)}</td><td class="text-right text-green">${formatCurrency(catTotal.profit)}</td><td class="text-right">${catMargin.toFixed(1)}%</td></tr>`;

    const empRows = stats.topEmployees
      .map((e) => `<tr><td>${escHtml(e.name)}</td><td class="text-right">${e.transactions}</td><td class="text-right text-green">${formatCurrency(e.revenueCents)}</td></tr>`)
      .join('');
    // R-REPORT-PRINT-REDESIGN: TOTAL row for Employees.
    const empTotal = stats.topEmployees.reduce(
      (acc, e) => ({ trans: acc.trans + e.transactions, revenue: acc.revenue + e.revenueCents }),
      { trans: 0, revenue: 0 },
    );
    const empTotalRow = `<tr class="row-total"><td>${L.total}</td><td class="text-right">${empTotal.trans}</td><td class="text-right text-green">${formatCurrency(empTotal.revenue)}</td></tr>`;

    const itemRows = stats.topItems
      .map((i) => `<tr><td>${escHtml(i.name)}</td><td class="text-right">${i.quantity}</td><td class="text-right text-green">${formatCurrency(i.revenueCents)}</td></tr>`)
      .join('');

    // Summary card sub-counters / percentages.
    const retainedPct = stats.grossRevenueCents > 0
      ? Math.round((stats.netRevenueCents / stats.grossRevenueCents) * 100)
      : 0;
    const marginPct = (stats.profitMargin || 0).toFixed(1);

    const html = `<!DOCTYPE html><html><head><title>${escHtml(L.title)}</title><style>
@page { size: letter; margin: 0.5in; }
* { box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 9pt; color: #1a1a2e; margin: 0; }

.report-header { margin-bottom: 16px; border-bottom: 2px solid #1a1a2e; padding-bottom: 8px; }
.report-title { font-size: 18pt; font-weight: 900; margin: 0; }
.report-meta { font-size: 8pt; color: #666; margin-top: 2px; }

.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
.summary-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
.summary-card .label { font-size: 7pt; color: #666; text-transform: uppercase; font-weight: 600; margin-bottom: 2px; }
.summary-card .value { font-size: 14pt; font-weight: 900; }
.summary-card .sub { font-size: 7pt; color: #888; margin-top: 2px; }
.value-green { color: #16a34a; }
.value-red { color: #dc2626; }
.value-blue { color: #2563eb; }

.meta-row { display: flex; gap: 24px; margin-bottom: 16px; font-size: 8pt; color: #444; }
.meta-row span { font-weight: 700; color: #1a1a2e; }

.section { margin-bottom: 16px; }
.section-header { background: #1a1a2e; color: #fff; padding: 6px 10px; border-radius: 4px 4px 0 0; font-size: 9pt; font-weight: 700; margin-bottom: 0; }

table { width: 100%; border-collapse: collapse; font-size: 8pt; }
th { background: #f1f5f9; padding: 5px 8px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 7pt; color: #475569; border-bottom: 1px solid #e2e8f0; }
td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; }
tr:last-child td { border-bottom: none; }
.row-total td { font-weight: 900; background: #f8fafc; border-top: 2px solid #1a1a2e; }
.text-right { text-align: right; }
.text-green { color: #16a34a; font-weight: 700; }
.text-red { color: #dc2626; font-weight: 700; }

.net-banner { background: #1a1a2e; color: #fff; padding: 10px 16px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 12pt; font-weight: 900; }

.report-footer { text-align: center; margin-top: 12px; font-size: 7pt; color: #aaa; }

@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<!-- HEADER -->
<div class="report-header">
  <h1 class="report-title">📊 ${escHtml(L.title)} — ${escHtml(storeName)}</h1>
  <div class="report-meta">${escHtml(dateLabel)} | ${escHtml(L.generated)}: ${escHtml(new Date().toLocaleString())}</div>
</div>

<!-- SUMMARY CARDS -->
<div class="summary-grid">
  <div class="summary-card">
    <div class="label">$ ${escHtml(L.gross)}</div>
    <div class="value">${formatCurrency(stats.grossRevenueCents)}</div>
    <div class="sub">${stats.cleanSalesCount} ${L.sales}</div>
  </div>
  <div class="summary-card">
    <div class="label">↓ ${escHtml(L.returns)}</div>
    <div class="value value-red">-${formatCurrency(stats.totalReturnsCents)}</div>
    <div class="sub">${stats.refundSalesCount} ${L.returnsCount}</div>
  </div>
  <div class="summary-card">
    <div class="label">📊 ${escHtml(L.net)}</div>
    <div class="value value-green">${formatCurrency(stats.netRevenueCents)}</div>
    <div class="sub">${retainedPct}% ${L.retained}</div>
  </div>
  <div class="summary-card">
    <div class="label">↗ ${escHtml(L.profit)}</div>
    <div class="value value-green">${formatCurrency(stats.totalProfitCents)}</div>
    <div class="sub">${marginPct}% ${L.marginLower}</div>
  </div>
</div>

<!-- META ROW -->
<div class="meta-row">
  ${stats.productSalesTaxCents > 0 ? `<div>${escHtml(L.salesTax)}: <span>${formatCurrency(stats.productSalesTaxCents)}</span></div>` : ''}
  ${stats.utilityTaxCents > 0 ? `<div>${escHtml(L.utilityTax)}: <span>${formatCurrency(stats.utilityTaxCents)}</span></div>` : ''}
  ${stats.mobilitySurchargeCents > 0 ? `<div>${escHtml(L.mobilityFee)}: <span>${formatCurrency(stats.mobilitySurchargeCents)}</span></div>` : ''}
  ${stats.cbeCollectedCents > 0 ? `<div>${escHtml(L.cbeFee)}: <span>${formatCurrency(stats.cbeCollectedCents)}</span></div>` : ''}
  ${stats.screenFeeCents > 0 ? `<div>${escHtml(L.screenFee)}: <span>${formatCurrency(stats.screenFeeCents)}</span></div>` : ''}
  <div><strong>${escHtml(L.totalFees)}: <span>${formatCurrency(stats.taxCollectedCents + stats.cbeCollectedCents + stats.screenFeeCents)}</span></strong></div>
  <div>${escHtml(L.cash)}: <span>${formatCurrency(stats.cashCents)}</span></div>
  <div>${escHtml(L.card)}: <span>${formatCurrency(stats.cardCents)}</span></div>
</div>

<!-- PHONE PAYMENTS -->
<div class="section">
  <div class="section-header">${escHtml(L.ppHeader)}</div>
  <table>
    <thead>
      <tr>
        <th>${escHtml(L.provider)}</th>
        <th class="text-right">${escHtml(L.count)}</th>
        <th class="text-right">Total</th>
        <th class="text-right">${escHtml(L.profit)}</th>
        <th class="text-right">${escHtml(L.marginCol)}</th>
      </tr>
    </thead>
    <tbody>${ppRows}${ppTotalRow}</tbody>
  </table>
</div>

<!-- SALES BY CATEGORY -->
<div class="section">
  <div class="section-header">${escHtml(L.catHeader)}</div>
  <table>
    <thead>
      <tr>
        <th>${escHtml(L.category)}</th>
        <th class="text-right">${L.qty}</th>
        <th class="text-right">${escHtml(L.revenue)}</th>
        <th class="text-right">${escHtml(L.profit)}</th>
        <th class="text-right">${escHtml(L.marginCol)}</th>
      </tr>
    </thead>
    <tbody>${catRows}${catTotalRow}</tbody>
  </table>
</div>

<!-- EMPLOYEES -->
<div class="section">
  <div class="section-header">${escHtml(L.empHeader)}</div>
  <table>
    <thead>
      <tr>
        <th>${escHtml(L.employee)}</th>
        <th class="text-right">${L.trans}</th>
        <th class="text-right">${escHtml(L.revenue)}</th>
      </tr>
    </thead>
    <tbody>${empRows}${empTotalRow}</tbody>
  </table>
</div>

<!-- TOP ITEMS -->
<div class="section">
  <div class="section-header">${escHtml(L.itemHeader)}</div>
  <table>
    <thead>
      <tr>
        <th>${escHtml(L.item)}</th>
        <th class="text-right">${L.qty}</th>
        <th class="text-right">${escHtml(L.revenue)}</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
</div>

<!-- NET TOTAL BANNER -->
<div class="net-banner">
  <span>${escHtml(L.netTotal)}</span>
  <span>${formatCurrency(stats.netRevenueCents)}</span>
</div>

<!-- FOOTER -->
<div class="report-footer">${escHtml(storeName)} | CellHub Pro</div>

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
        salesTax: formatCurrency(stats.productSalesTaxCents),
        utilityTax: formatCurrency(stats.utilityTaxCents),
        mobilityFee: formatCurrency(stats.mobilitySurchargeCents),
        cbe: formatCurrency(stats.cbeCollectedCents),
        screenFee: formatCurrency(stats.screenFeeCents),
        totalFees: formatCurrency(stats.taxCollectedCents + stats.cbeCollectedCents + stats.screenFeeCents),
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
            }}>{type === 'daily' ? t('reports.periodDaily') : type === 'weekly' ? t('reports.periodWeekly') : t('reports.periodMonthly')}</button>
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
          {stats.cleanSalesCount} {pluralize(stats.cleanSalesCount, t('reports.saleSingular'), t('reports.salePlural'))}
          {stats.refundedCount > 0 && <span style={{ color: '#f97316', marginLeft: '0.5rem' }}>• {stats.refundedCount} {pluralize(stats.refundedCount, t('reports.refundedSingular'), t('reports.refundedPlural'))}</span>}
          {stats.voidedCount > 0 && <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>• {stats.voidedCount} {pluralize(stats.voidedCount, t('reports.voidSingular'), t('reports.voidPlural'))}</span>}
          {stats.refundSalesCount > 0 && <span style={{ color: '#fb923c', marginLeft: '0.5rem' }}>• {stats.refundSalesCount} {pluralize(stats.refundSalesCount, t('reports.refundSingular'), t('reports.refundPlural'))}</span>}
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
                  {countCard(t('reports.avgVisits'), customerAnalysis.avgVisitsReturning.toFixed(1), t('reports.returning'), '#a78bfa')}
                  {statCard(t('reports.returningRev'), customerAnalysis.totalRevenueReturningCents, '', '#22c55e')}
                  {statCard(t('reports.avgSpend'), customerAnalysis.avgSpendReturningCents, t('reports.returning'), '#fb923c')}
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
                    {[t('reports.customer'), t('reports.phone'), t('reports.visits'), t('reports.totalSpent'), t('reports.lastVisit')].map((h) => (
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
            {statCard(t('reports.grossRevenue'), stats.grossRevenueCents, `${stats.cleanSalesCount} ${pluralize(stats.cleanSalesCount, t('reports.saleSingular'), t('reports.salePlural'))}`, '#e2e8f0')}
            {statCard(t('reports.returns'), stats.totalReturnsCents, `${returnsFromPeriodSales.length} ${pluralize(returnsFromPeriodSales.length, t('reports.returnSingular'), t('reports.returnPlural'))}`, stats.totalReturnsCents > 0 ? '#ef4444' : '#64748b', true)}
            {statCard(t('reports.netRevenue'), stats.netRevenueCents, stats.grossRevenueCents > 0 ? `${((stats.netRevenueCents / stats.grossRevenueCents) * 100).toFixed(1)}% ${t('reports.retained')}` : '—', '#22c55e')}
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

          {/* ── R-REPORT-ZTAPE-RECONCILIATION-FIX: Z tape reconciliation panel ──
              Additive panel that exposes the 6 explicit financial buckets the
              physical Z tape uses, so the daily report can be cross-checked
              line by line. No legacy field above has been mutated — these
              values are derived from the same accumulators as the summary
              cards. Reads "should match" against the paper tape's NET1 /
              TTL TAX / NET2 columns. */}
          {stats.recon && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(96,165,250,0.25)',
              borderRadius: '0.75rem',
              padding: '0.875rem 1rem',
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#60a5fa', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                🧾 Z Tape Reconciliation
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
                {([
                  ['Gross Collected', stats.recon.grossCollectedCents, '~ Z NET2', '#e2e8f0'],
                  ['Tax Collected (bruto)', stats.recon.taxCollectedCents, '~ Z TTL TAX', '#60a5fa'],
                  ['Fee Collected', stats.recon.feeCollectedCents, 'cbe + screen', '#a78bfa'],
                  ['Refund Tax Adj.', stats.recon.refundTaxAdjustmentCents, 'subtract from tax', stats.recon.refundTaxAdjustmentCents > 0 ? '#ef4444' : '#64748b'],
                  ['Operational Revenue', stats.recon.operationalRevenueCents, '~ Z NET1', '#22c55e'],
                  ['Net Revenue (post-returns)', stats.recon.netRevenueCents, 'gross − returns', '#22c55e'],
                ] as const).map(([label, valueCents, sub, color]) => (
                  <div key={label} style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '0.5rem',
                    padding: '0.5rem 0.7rem',
                  }}>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: '0.2rem' }}>{label}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color }}>{formatCurrency(valueCents)}</div>
                    <div style={{ fontSize: '0.66rem', color: '#64748b', marginTop: '0.1rem', fontStyle: 'italic' }}>{sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                    { v: `${convRate}%`, l: t('reports.convRate'), c: parseInt(convRate) >= 70 ? '#22c55e' : parseInt(convRate) >= 50 ? '#f59e0b' : '#ef4444' },
                    { v: accepted, l: t('reports.accepted'), c: '#22c55e' },
                    { v: pending, l: t('reports.pending'), c: '#f59e0b' },
                    { v: declined, l: t('reports.declined'), c: '#ef4444' },
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
                    {[
                      t('reports.returnHash'),
                      t('reports.originalInvoice'),
                      t('reports.customer'),
                      t('reports.returns.methodCol'),
                      t('reports.returns.certificateCol'),
                      t('reports.returns.employeeCol'),
                      t('reports.reason'),
                      t('reports.date'),
                      t('reports.refundHeader'),
                    ].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.875rem', color: '#94a3b8', fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {returnsFromPeriodSales.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(239,68,68,0.08)' }}>
                      <td style={{ padding: '0.5rem 0.875rem', fontFamily: 'monospace', color: '#fca5a5', fontWeight: 600 }}>{r.returnNumber}</td>
                      <td style={{ padding: '0.5rem 0.875rem', fontFamily: 'monospace', color: '#94a3b8' }}>{r.originalInvoice}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#e2e8f0' }}>
                        {r.recipientName || r.customerName}
                        {r.recipientPhone && <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{r.recipientPhone}</div>}
                      </td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#94a3b8', fontSize: '0.75rem' }}>{r.resolution}</td>
                      <td style={{ padding: '0.5rem 0.875rem', fontFamily: 'monospace', color: r.certificateNumber ? '#38bdf8' : '#475569', fontSize: '0.72rem' }}>{r.certificateNumber || '—'}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#94a3b8', fontSize: '0.75rem' }}>{r.employeeName || '—'}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#94a3b8', fontSize: '0.75rem' }}>{r.reason}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#64748b', fontSize: '0.72rem' }}>{r.createdAt ? formatDate(r.createdAt) : '—'}</td>
                      <td style={{ padding: '0.5rem 0.875rem', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>-{formatCurrency(r.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── R-STORE-CREDIT-REDEMPTION-SYSTEM: ledger metrics ── */}
          {Array.isArray(storeCreditLedger) && storeCreditLedger.length > 0 && (
            <div style={{ background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.18)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(56,189,248,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#7dd3fc' }}>
                  🎫 {t('storeCredit.reports.title')}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  {t('storeCredit.reports.activeLiability')}: <span style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(ledgerSummary.activeLiabilityCents)}</span>
                </span>
              </div>
              {/* Summary row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid rgba(56,189,248,0.1)', fontSize: '0.78rem' }}>
                <div>
                  <div style={{ color: '#64748b' }}>{t('storeCredit.reports.issuedCount')}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{ledgerSummary.issuedCount}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>{t('storeCredit.reports.issuedTotal')}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{formatCurrency(ledgerSummary.issuedTotalCents)}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>{t('storeCredit.reports.redeemed')}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{formatCurrency(ledgerSummary.redeemedTotalCents)}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>{t('storeCredit.reports.redemptions')}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{ledgerSummary.redemptionCount}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b' }}>{t('storeCredit.reports.voidedCount')}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{ledgerSummary.voidedCount}</div>
                </div>
              </div>
              {/* Detail table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(56,189,248,0.18)' }}>
                    {[
                      t('storeCredit.reports.colCert'),
                      t('storeCredit.reports.colCustomer'),
                      t('storeCredit.reports.colIssued'),
                      t('storeCredit.reports.colRedeemed'),
                      t('storeCredit.reports.colRemaining'),
                      t('storeCredit.reports.colStatus'),
                      t('storeCredit.reports.colIssuedAt'),
                      t('storeCredit.reports.colEmployee'),
                      '',
                    ].map((h, i) => (
                      <th key={h + i} style={{ textAlign: 'left', padding: '0.5rem 0.7rem', color: '#94a3b8', fontSize: '0.66rem', textTransform: 'uppercase', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...storeCreditLedger]
                    .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
                    .slice(0, 100)
                    .map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid rgba(56,189,248,0.06)' }}>
                      <td style={{ padding: '0.4rem 0.7rem', fontFamily: 'monospace', color: '#7dd3fc', fontWeight: 600 }}>{c.certificateNumber}</td>
                      <td style={{ padding: '0.4rem 0.7rem', color: '#e2e8f0' }}>
                        {c.customerName}
                        {c.customerPhone && <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{c.customerPhone}</div>}
                      </td>
                      <td style={{ padding: '0.4rem 0.7rem', color: '#e2e8f0', fontWeight: 600 }}>{formatCurrency(c.issuedAmount)}</td>
                      <td style={{ padding: '0.4rem 0.7rem', color: '#94a3b8' }}>{formatCurrency(c.redeemedAmount)}</td>
                      <td style={{ padding: '0.4rem 0.7rem', color: c.remainingAmount > 0 && c.status === 'active' ? '#10b981' : '#64748b', fontWeight: 700 }}>{formatCurrency(c.remainingAmount)}</td>
                      <td style={{ padding: '0.4rem 0.7rem' }}>
                        <span style={{ padding: '0.1rem 0.45rem', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                          background: c.status === 'active' ? 'rgba(16,185,129,0.15)' : c.status === 'voided' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)',
                          color: c.status === 'active' ? '#10b981' : c.status === 'voided' ? '#ef4444' : '#94a3b8' }}>
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.4rem 0.7rem', color: '#64748b', fontSize: '0.72rem' }}>{formatDate(c.issuedAt)}</td>
                      <td style={{ padding: '0.4rem 0.7rem', color: '#94a3b8' }}>{c.issuedByEmployeeName || '—'}</td>
                      <td style={{ padding: '0.4rem 0.7rem', textAlign: 'right' }}>
                        {c.status === 'active' && (
                          <button
                            onClick={() => { setVoidCertTarget(c); setVoidCertReason(''); }}
                            className="btn btn-sm"
                            style={{ fontSize: '0.7rem', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
                          >
                            {t('storeCredit.reports.voidBtn')}
                          </button>
                        )}
                      </td>
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
                      t('reports.provider'),
                      t('reports.paymentCount'),
                      'Total',
                      t('reports.profit'),
                      t('reports.margin'),
                      t('reports.uniqueNumbers'),
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
                          {allUnique.size} {t('reports.unique')}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {/* ── R-ACTIVATIONS-BY-CARRIER-V1: activations grouped by phone company ── */}
          {Object.keys(stats.activationsByCarrier).length > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden', marginBottom: '0.75rem' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                  📞 {t('reports.activationsByCarrier')}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.15rem' }}>
                  {t('reports.activationsByCarrierSub')}
                </div>
              </div>
              <div style={{ padding: '0.5rem 0.75rem' }}>
                {Object.entries(stats.activationsByCarrier)
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([carrier, d]) => (
                    <div key={carrier} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.35rem', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600 }}>{carrier}</span>
                        {d.numbers.size > 0 && (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                            · {d.numbers.size} {t('reports.lines')}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', color: '#fbbf24', fontWeight: 700 }}>
                          {d.count} {t('reports.activations')}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: '#22c55e', fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: '70px', textAlign: 'right' }}>
                          {formatCurrency(d.totalCents)}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
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
                      title={t('reports.clickDrilldown')}>
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
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{e.transactions} {t('reports.transLabel')}</div>
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
                  {cancellationsInPeriod.length} {t('reports.cancellationsCount')}
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
                        t('reports.type'),
                        'Ref.',
                        t('reports.customer'),
                        t('reports.item'),
                        t('reports.method'),
                        t('reports.amount'),
                        t('reports.date'),
                        '',
                      ].map((h, i) => (
                        <th key={h + i} style={{
                          textAlign: h === t('reports.amount') ? 'right' : 'left',
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
                        store_credit: { text: t('reports.creditMethod'), color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
                        cash: { text: t('reports.cashStat'), color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
                        forfeit: { text: t('reports.forfeit'), color: '#a3e635', bg: 'rgba(163, 230, 53, 0.15)' },
                        unknown: { text: t('reports.unknownMethod'), color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.15)' },
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
                                  settings.paperSize,
                                );
                                const printer = localStorage.getItem('receiptModal.lastPrinter') || ((settings as any).detectedPrinters as string[] | undefined)?.[0];
                                printHtml(html, { silent: true, printer, pageSize: (settings.paperSize as PrintPageSizeKey) || '4x6', copies: 1 });
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
                              title={t('reports.printReceiptTitle')}
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
                  📞 {t('reports.phonePaymentsDetail')}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{phonePaymentRows.length} {t('phonePay.linesPlural')}</span>
              </div>
              <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      {[t('reports.customer'), t('reports.phone'), 'Carrier', 'Invoice', t('reports.employee'), 'Time', 'Amount'].map((h) => (
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
                    {t('reports.showing200of', phonePaymentRows.length)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── R-REPORT-FEES-BREAKDOWN: Transaction Breakdown ── */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                {t('reports.breakdown.title')}
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700 }}>{t('reports.breakdown.type')}</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700 }}>{t('reports.breakdown.count')}</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700 }}>{t('reports.breakdown.revenue')}</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700 }}>{t('reports.breakdown.taxesFees')}</th>
                </tr>
              </thead>
              <tbody>
                {/* 🛒 Product Sales */}
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>🛒</span>
                      <div>
                        <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{t('reports.breakdown.productSales')}</div>
                        <div style={{ fontSize: '0.72rem', color: '#475569' }}>{t('reports.breakdown.productSub')}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#94a3b8' }}>{breakdownRows.productCount}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0', fontWeight: 600 }}>{formatCurrency(breakdownRows.productRevenue)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', fontSize: '0.78rem' }}>
                    {(stats.productSalesTaxCents > 0 || stats.cbeCollectedCents > 0 || stats.screenFeeCents > 0) ? (
                      <>
                        {stats.productSalesTaxCents > 0 && (
                          <div style={{ color: '#f87171', fontWeight: 700 }}>
                            {formatCurrency(stats.productSalesTaxCents)}
                            <div style={{ fontSize: '0.68rem', fontWeight: 400, color: '#94a3b8' }}>{t('reports.breakdown.salesTax')}</div>
                          </div>
                        )}
                        {stats.cbeCollectedCents > 0 && (
                          <div style={{ color: '#f87171', fontSize: '0.72rem', marginTop: '0.2rem' }}>
                            {t('reports.breakdown.cbeFee')}: {formatCurrency(stats.cbeCollectedCents)}
                          </div>
                        )}
                        {stats.screenFeeCents > 0 && (
                          <div style={{ color: '#f87171', fontSize: '0.72rem' }}>
                            {t('reports.breakdown.screenFee')}: {formatCurrency(stats.screenFeeCents)}
                          </div>
                        )}
                      </>
                    ) : <span style={{ color: '#475569' }}>—</span>}
                  </td>
                </tr>
                {/* 📱 Phone Bill Payments */}
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>📱</span>
                      <div>
                        <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{t('reports.breakdown.phoneBill')}</div>
                        <div style={{ fontSize: '0.72rem', color: '#475569' }}>{t('reports.breakdown.phoneSub')}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#94a3b8' }}>{breakdownRows.phoneCount}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0', fontWeight: 600 }}>{formatCurrency(breakdownRows.phoneRevenue)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', fontSize: '0.78rem' }}>
                    {(stats.utilityTaxCents > 0 || stats.mobilitySurchargeCents > 0) ? (
                      <>
                        {stats.utilityTaxCents > 0 && (
                          <div style={{ color: '#f87171', fontWeight: 700 }}>
                            {formatCurrency(stats.utilityTaxCents)}
                            <div style={{ fontSize: '0.68rem', fontWeight: 400, color: '#94a3b8' }}>{t('reports.breakdown.utilityTax')}</div>
                          </div>
                        )}
                        {stats.mobilitySurchargeCents > 0 && (
                          <div style={{ color: '#f87171', fontSize: '0.72rem', marginTop: '0.2rem' }}>
                            {t('reports.breakdown.mobilityFee')}: {formatCurrency(stats.mobilitySurchargeCents)}
                          </div>
                        )}
                      </>
                    ) : <span style={{ color: '#475569' }}>—</span>}
                  </td>
                </tr>
                {/* 🔧 Repair Services */}
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>🔧</span>
                      <div>
                        <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{t('reports.breakdown.repairServices')}</div>
                        <div style={{ fontSize: '0.72rem', color: '#475569' }}>{t('reports.breakdown.repairSub')}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#94a3b8' }}>{breakdownRows.repairCount}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0', fontWeight: 600 }}>{formatCurrency(breakdownRows.repairRevenue)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#475569', fontSize: '0.78rem' }}>
                    {formatCurrency(0)} · {t('reports.breakdown.noTax')}
                  </td>
                </tr>
                {/* 🔓 Unlock Services */}
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>🔓</span>
                      <div>
                        <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{t('reports.breakdown.unlockServices')}</div>
                        <div style={{ fontSize: '0.72rem', color: '#475569' }}>{t('reports.breakdown.unlockSub')}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#94a3b8' }}>{breakdownRows.unlockCount}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0', fontWeight: 600 }}>{formatCurrency(breakdownRows.unlockRevenue)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#475569', fontSize: '0.78rem' }}>
                    {formatCurrency(0)} · {t('reports.breakdown.noTax')}
                  </td>
                </tr>
                {/* TOTAL */}
                <tr style={{ background: 'rgba(255,255,255,0.04)', fontWeight: 700 }}>
                  <td style={{ padding: '0.75rem', color: '#e2e8f0' }}>{t('reports.breakdown.total')}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0' }}>{breakdownRows.productCount + breakdownRows.phoneCount + breakdownRows.repairCount + breakdownRows.unlockCount}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#e2e8f0' }}>{formatCurrency(breakdownRows.productRevenue + breakdownRows.phoneRevenue + breakdownRows.repairRevenue + breakdownRows.unlockRevenue)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', color: '#f87171' }}>{formatCurrency(stats.taxCollectedCents + stats.cbeCollectedCents + stats.screenFeeCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>

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
                    placeholder={t('reports.searchTx')}
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
                      {['Invoice', t('reports.customer'), 'Items', t('reports.payment'), t('reports.employee'), 'Total', t('reports.time'), ''].map((h, i) => (
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
                          <td style={{ padding: '0.5rem 0.75rem', color: '#e2e8f0' }}>{sale.customerName || t('reports.walkIn')}</td>
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
                            <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                              <button onClick={() => setReprintSale(sale)}
                                style={{ padding: '0.25rem 0.45rem', borderRadius: '0.35rem', border: '1px solid rgba(102,126,234,0.3)', background: 'rgba(102,126,234,0.1)', color: '#a5b4fc', cursor: 'pointer', fontSize: '0.75rem' }}
                                title={t('reports.reprint')}>🖨️</button>
                              {/* R-OPERATIONS-VOID-SALE-AND-LOSSES-AUDIT-V1: only show Void
                                  when the sale is still active. Already-voided/refunded
                                  rows already render the VOID/REF badge; no second action. */}
                              {!isVoided && !isRefunded && (
                                <button onClick={() => { setVoidTarget(sale); setVoidReason(''); }}
                                  style={{ padding: '0.25rem 0.45rem', borderRadius: '0.35rem', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', cursor: 'pointer', fontSize: '0.75rem' }}
                                  title={t('reports.voidSale')}>🚫</button>
                              )}
                              {/* R-REPORTS-EDIT-SALE-ITEM-V1: edit a line-item
                                  price/qty post-checkout (manager-PIN gated).
                                  Hidden on voided/refunded sales — those are
                                  terminal and shouldn't be retroactively edited. */}
                              {!isVoided && !isRefunded && (
                                <button onClick={() => {
                                  setEditTarget(sale);
                                  setEditItemId(null);
                                  setEditPrice('');
                                  setEditQty('1');
                                  setEditReason('');
                                  setEditNotes('');
                                }}
                                  style={{ padding: '0.25rem 0.45rem', borderRadius: '0.35rem', border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.1)', color: '#c4b5fd', cursor: 'pointer', fontSize: '0.75rem' }}
                                  title={t('reports.editSale.tooltip')}>✏️</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* R-LOSSES-SHRINKAGE-V1: Losses / Shrinkage section.
              Pure visibility — losses are NOT counted as sales,
              refunds, or voids. Net-profit deduction integration is a
              documented follow-up (see Phase E in the round spec). */}
          <div id="reports-losses-section" style={{ marginTop: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#fff' }}>
                📉 {t('reports.losses.title')} ({lossesSummary.count})
              </span>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  {t('reports.losses.totalUnits')}: <strong style={{ color: '#e2e8f0' }}>{lossesSummary.totalQty}</strong>
                </span>
                <span style={{ fontSize: '0.78rem' }}>
                  {t('reports.losses.totalLoss')}: <strong style={{ color: '#fb923c' }}>{formatCurrency(lossesSummary.totalLossCents)}</strong>
                </span>
              </div>
            </div>
            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
              {filteredLosses.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#475569', fontSize: '0.85rem' }}>
                  {t('reports.losses.empty')}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      {[
                        t('reports.losses.col.date'),
                        t('reports.losses.col.item'),
                        t('reports.losses.col.sku'),
                        t('reports.losses.col.qty'),
                        t('reports.losses.col.reason'),
                        t('reports.losses.col.unitCost'),
                        t('reports.losses.col.totalLoss'),
                        t('reports.losses.col.approvedBy'),
                      ].map((h, i) => (
                        <th key={h + i} style={{
                          textAlign: (h === t('reports.losses.col.qty') || h === t('reports.losses.col.unitCost') || h === t('reports.losses.col.totalLoss')) ? 'right' : 'left',
                          padding: '0.5rem 0.75rem',
                          color: '#64748b',
                          fontSize: '0.68rem',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLosses.map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', color: '#475569', fontSize: '0.72rem' }}>{formatDateTime(l.createdAt)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: '#e2e8f0' }}>{l.itemName}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.72rem' }}>{l.sku || '—'}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{l.qty}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          <span style={{ padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 600, background: 'rgba(234,88,12,0.15)', color: '#fb923c' }}>
                            {t(`inventory.loss.reason.${l.reason}`)}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#94a3b8' }}>{formatCurrency(l.unitCost)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#fb923c' }}>{formatCurrency(l.totalLoss)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: '#64748b', fontSize: '0.75rem' }}>{l.approvedBy || '—'}</td>
                      </tr>
                    ))}
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
              <span style={{ fontWeight: 700, color: '#fff' }}>{drilldownCategory} — {t('reports.drilldownCount', drilldownItems.length)}</span>
              <button onClick={() => setDrilldownCategory(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '0.5rem' }}>
              {drilldownItems.length === 0 ? (
                <p style={{ padding: '2rem', textAlign: 'center', color: '#475569' }}>{t('reports.noData')}</p>
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
                {t('close')}
              </button>
              <button onClick={() => {
                // Round 17: real reprint via generateReceiptHtml (hardened in round 12)
                // + usePrint hook (Electron thermal silent / browser window fallback).
                // Previously this called window.print() which printed the entire Reports page.
                // R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1: reprint now encodes the
                // structured CHP|SALE|... payload (with optional |CUST|customerId)
                // so reprinted copies scan equivalent to a fresh print.
                const bsvg = renderBarcodeSvg(buildReceiptBarcodePayload(reprintSale));
                const html = generateReceiptHtml(reprintSale, settings, locale, undefined, bsvg, settings.paperSize);
                printHtml(html, {
                  silent: false,
                  printer: settings.detectedPrinters?.[0],
                  pageSize: (settings.paperSize as PrintPageSizeKey) || '4x6',
                });
                setReprintSale(null);
              }}
                style={{ padding: '0.5rem 1rem', borderRadius: '0.4rem', background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 600 }}>
                🖨️ {t('print')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* R-OPERATIONS-VOID-SALE-AND-LOSSES-AUDIT-V1: Void Sale modal —
          reason picker + manager-PIN guard. Sale is marked voided as a
          STATUS CHANGE (no hard delete); inventory restored only for
          stockable line items; existing isCountableSale filter excludes
          voided sales from active totals/profit/KPIs everywhere. */}
      {voidTarget && (
        <Modal
          open={!!voidTarget && !voidPinOpen}
          onClose={() => { setVoidTarget(null); setVoidReason(''); }}
          title={`🚫 ${t('reports.voidSale')}`}
          size="max-w-md"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => { setVoidTarget(null); setVoidReason(''); }}>
                {t('cancel')}
              </button>
              <button
                className="btn"
                style={{ background: '#dc2626', color: '#fff', fontWeight: 700, border: 'none' }}
                disabled={!voidReason.trim() || voiding}
                onClick={() => setVoidPinOpen(true)}
              >
                {t('reports.voidContinue')}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="text-xs text-slate-400">
              {t('reports.voidInvoiceLabel')}: <strong className="text-slate-200" style={{ fontFamily: 'monospace' }}>{voidTarget.invoiceNumber}</strong>
              <br />
              {t('reports.voidTotalLabel')}: <strong className="text-emerald-400">{formatCurrency(voidTarget.total)}</strong>
            </div>
            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1">
                {t('reports.voidReasonLabel')} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                className="select"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
              >
                <option value="">{t('reports.voidReasonPick')}</option>
                <option value="duplicate">{t('reports.voidReason.duplicate')}</option>
                <option value="cashier_error">{t('reports.voidReason.cashierError')}</option>
                <option value="customer_changed_mind">{t('reports.voidReason.customerChangedMind')}</option>
                <option value="payment_failed">{t('reports.voidReason.paymentFailed')}</option>
                <option value="test_transaction">{t('reports.voidReason.testTransaction')}</option>
                <option value="other">{t('reports.voidReason.other')}</option>
              </select>
            </div>
            <div className="rounded-md p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <p className="text-xs" style={{ color: '#fca5a5', lineHeight: 1.5 }}>
                ⚠️ {t('reports.voidPaymentWarning')}
              </p>
            </div>
            <p className="text-[11px] text-slate-500">
              {t('reports.voidInventoryNote')}
            </p>
          </div>
        </Modal>
      )}

      {/* PIN gate — opens only after the owner confirms reason */}
      <AdminPinGate
        open={voidPinOpen && !!voidTarget}
        adminPin={settings.adminPin || ''}
        onSuccess={() => {
          if (voidTarget) handleVoidSale(voidTarget, voidReason);
        }}
        onCancel={() => setVoidPinOpen(false)}
      />

      {/* R-STORE-CREDIT-REDEMPTION-SYSTEM: void certificate flow.
          Reason modal → PIN gate → voidLedgerEntry. */}
      {voidCertTarget && (
        <Modal open onClose={() => setVoidCertTarget(null)}
          title={`🚫 ${t('storeCredit.void.title', voidCertTarget.certificateNumber)}`}
          size="max-w-md"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '0.5rem', fontSize: '0.85rem', color: '#fca5a5' }}>
              {t('storeCredit.void.warning', formatCurrency(voidCertTarget.remainingAmount))}
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>
                {t('storeCredit.void.reasonLabel')}
              </label>
              <input
                className="input"
                value={voidCertReason}
                onChange={(e) => setVoidCertReason(e.target.value)}
                placeholder={t('storeCredit.void.reasonPlaceholder')}
                style={{ fontSize: '0.88rem' }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setVoidCertTarget(null)}>
                {t('storeCredit.void.cancel')}
              </button>
              <button
                className="btn btn-primary"
                style={{ background: '#ef4444' }}
                onClick={() => setVoidCertPinOpen(true)}
              >
                {t('storeCredit.void.continue')}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <AdminPinGate
        open={voidCertPinOpen && !!voidCertTarget}
        adminPin={settings.adminPin || ''}
        onSuccess={() => {
          if (voidCertTarget) handleVoidCertificate(voidCertTarget, voidCertReason);
        }}
        onCancel={() => setVoidCertPinOpen(false)}
      />

      {/* R-REPORTS-EDIT-SALE-ITEM-V1: edit-item modal — picks an item from
          the sale, lets owner edit price + qty, requires reason + notes,
          then opens the AdminPinGate. Same modal layout style as Void Sale. */}
      {editTarget && (() => {
        const sale = editTarget;
        const item = sale.items.find((it) => it.id === editItemId);
        const newPriceCents = Math.round((parseFloat(editPrice) || 0) * 100);
        const newQty = parseInt(editQty, 10);
        const validInputs = !!item && Number.isFinite(newPriceCents) && newPriceCents >= 0 && Number.isFinite(newQty) && newQty >= 1;
        const validReason = editReason !== '';
        const oldLineTotal = item ? (item.price * item.qty) : 0;
        const newLineTotal = item ? (newPriceCents * newQty) : 0;
        const lineDelta = oldLineTotal - newLineTotal;
        // Stale-sale warning (>24h old).
        const saleDate = (() => {
          try { return new Date(sale.createdAt as string); } catch { return null; }
        })();
        const isStale = saleDate ? (Date.now() - saleDate.getTime() > 86400000) : false;
        return (
          <Modal
            open={!!editTarget && !editPinOpen}
            onClose={() => {
              setEditTarget(null);
              setEditItemId(null);
              setEditPrice('');
              setEditQty('1');
              setEditReason('');
              setEditNotes('');
            }}
            title={`✏️ ${t('reports.editSale.title')}`}
            size="max-w-lg"
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => {
                  setEditTarget(null);
                  setEditItemId(null);
                  setEditPrice('');
                  setEditQty('1');
                  setEditReason('');
                  setEditNotes('');
                }}>
                  {t('cancel')}
                </button>
                <button
                  className="btn"
                  style={{ background: '#a855f7', color: '#fff', fontWeight: 700, border: 'none' }}
                  disabled={!editItemId || !validInputs || !validReason || editingSale}
                  onClick={() => setEditPinOpen(true)}
                >
                  {t('reports.editSale.continue')}
                </button>
              </>
            }
          >
            <div className="space-y-3">
              <div className="text-xs text-slate-400">
                {t('reports.editSale.invoiceLabel')}: <strong className="text-slate-200" style={{ fontFamily: 'monospace' }}>{sale.invoiceNumber}</strong>
                {' · '}
                {t('reports.editSale.totalLabel')}: <strong className="text-emerald-400">{formatCurrency(sale.total)}</strong>
              </div>
              {isStale && (
                <div className="rounded-md p-2.5" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <p className="text-[11px]" style={{ color: '#fcd34d', lineHeight: 1.5 }}>
                    ⚠️ {t('reports.editSale.staleWarning')}
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs text-slate-400 font-semibold block mb-1">
                  {t('reports.editSale.pickItemLabel')}
                </label>
                <div className="rounded border border-surface-700 divide-y divide-surface-700 max-h-44 overflow-y-auto">
                  {sale.items.map((it) => {
                    const isSelected = editItemId === it.id;
                    const isReturned = (it.returnedQty || 0) > 0 || it.fullyReturned;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        disabled={isReturned}
                        onClick={() => {
                          if (isReturned) return;
                          setEditItemId(it.id);
                          setEditPrice(((it.price || 0) / 100).toFixed(2));
                          setEditQty(String(it.qty || 1));
                        }}
                        className={`w-full text-left flex items-center gap-2 px-3 py-2 transition ${
                          isSelected ? 'bg-purple-500/10' : 'hover:bg-surface-700'
                        } ${isReturned ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                            isSelected ? 'border-purple-400 bg-purple-400' : 'border-slate-500'
                          }`}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-200 truncate">{it.name}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {formatCurrency(it.price)} × {it.qty} = {formatCurrency(it.price * it.qty)}
                            {isReturned ? ` · ${t('reports.editSale.returnedTag')}` : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {item && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 font-semibold block mb-1">
                        {t('reports.editSale.priceLabel')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-semibold block mb-1">
                        {t('reports.editSale.qtyLabel')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className="input"
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="rounded-md p-2.5" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)' }}>
                    <div className="flex justify-between text-xs">
                      <span style={{ color: '#c4b5fd' }}>{t('reports.editSale.lineDeltaLabel')}</span>
                      <strong style={{ color: lineDelta > 0 ? '#fb923c' : lineDelta < 0 ? '#fcd34d' : '#94a3b8' }}>
                        {lineDelta > 0 ? '−' : lineDelta < 0 ? '+' : ''}{formatCurrency(Math.abs(lineDelta))}
                      </strong>
                    </div>
                    {lineDelta > 0 && (
                      <p className="text-[10px] mt-1" style={{ color: '#fdba74' }}>
                        {t('reports.editSale.refundOwedHint')}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 font-semibold block mb-1">
                      {t('reports.editSale.reasonLabel')} <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select className="select" value={editReason} onChange={(e) => setEditReason(e.target.value as 'refund' | 'absorbed' | 'typo_correction' | '')}>
                      <option value="">{t('reports.editSale.reasonPick')}</option>
                      <option value="refund">{t('reports.editSale.reason.refund')}</option>
                      <option value="absorbed">{t('reports.editSale.reason.absorbed')}</option>
                      <option value="typo_correction">{t('reports.editSale.reason.typoCorrection')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 font-semibold block mb-1">
                      {t('reports.editSale.notesLabel')}
                    </label>
                    <textarea
                      className="input"
                      rows={2}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder={t('reports.editSale.notesPlaceholder')}
                    />
                  </div>
                </>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* R-REPORTS-EDIT-SALE-ITEM-V1: PIN gate — opens after owner confirms
          item + price + qty + reason. Successful auth fires handleEditSaleItem. */}
      <AdminPinGate
        open={editPinOpen && !!editTarget && !!editItemId}
        adminPin={settings.adminPin || ''}
        onSuccess={() => {
          if (editTarget && editItemId && editReason) {
            handleEditSaleItem(
              editTarget,
              editItemId,
              Math.round((parseFloat(editPrice) || 0) * 100),
              parseInt(editQty, 10),
              editReason,
              editNotes,
            );
          }
        }}
        onCancel={() => setEditPinOpen(false)}
      />

      {/* R-REPORTS-EDIT-SALE-ITEM-V1: optional corrected-receipt reprint
          after a money-impacting edit (refund / absorbed). Owner can decline. */}
      {reprintAfterEdit && (
        <Modal
          open={!!reprintAfterEdit}
          onClose={() => setReprintAfterEdit(null)}
          title={t('reports.editSale.reprintTitle')}
          size="max-w-sm"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setReprintAfterEdit(null)}>
                {t('reports.editSale.reprintLater')}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const sale = reprintAfterEdit;
                  if (!sale) return;
                  try {
                    // R-RECEIPT-BARCODE-SALE-CUSTOMER-LINK-V1: post-edit reprint
                    // also uses the structured payload for scan parity.
                    const bsvg = renderBarcodeSvg(buildReceiptBarcodePayload(sale));
                    const html = generateReceiptHtml(sale, settings, locale, undefined, bsvg, settings.paperSize);
                    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0], pageSize: (settings.paperSize as PrintPageSizeKey) || '4x6' });
                  } catch (err) {
                    console.error('[edit-sale-item] reprint failed', err);
                  }
                  setReprintAfterEdit(null);
                }}
              >
                🖨️ {t('print')}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-300">
            {t('reports.editSale.reprintBody', reprintAfterEdit.invoiceNumber)}
          </p>
        </Modal>
      )}
    </div>
  );
}
