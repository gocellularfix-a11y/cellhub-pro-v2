// ============================================================
// CellHub Pro — Returns Module (rewrite from updated original)
// Features:
//   - Multi-field search: invoice, phone, name, item, date range
//   - Barcode scan support (press Enter to search)
//   - Multi-result picker
//   - Item checklist with qty adjust
//   - Reason + resolution (cash/card/store_credit/exchange)
//   - Records negative sale for reports
//   - Return history with print
//   - Vendor returns
// ============================================================

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { generateId } from '@/utils/dates';
import { usePrint } from '@/hooks/usePrint';
import { forwardTaxFromBase } from '@/utils/depositTax';
import { persist, batchSave } from '@/services/persist';
import { useApprovalGate } from '@/hooks/useApprovalGate';
import { COLLECTIONS } from '@/config/constants';
import type { Sale, CartItem, Customer, CustomerReturn, CustomerReturnItem, VendorReturn, InventoryItem } from '@/store/types';

const rc = (n: number) => Math.round(n * 100) / 100;
const fc = (n: number) => formatCurrency(n);
const fd = (d: any) => d ? new Date(d).toLocaleDateString() : '';

/**
 * HTML escape for print window interpolation. Round 19 fix — old code only
 * escaped < and >, missing & " '. Same canonical pattern as Reports/ReceiptModal.
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

/** Status normalization (matches the inline pattern used by other modules). */
function normalizeStatus(s: string): string {
  return (s || '').toLowerCase().replace(/ /g, '_');
}

export default function ReturnsModule() {
  const {
    state: { sales, inventory, customers, settings, employees, currentEmployee, cart, lang, pendingBarcodeInvoice, globalSearchTerm,
             repairs, unlocks, specialOrders, layaways, customerReturns, vendorReturns },
    setSales, setInventory, setCustomers, setCart, setActiveTab, dispatch,
    setRepairs, setUnlocks, setSpecialOrders, setLayaways,
    setCustomerReturns, setVendorReturns,
  } = useApp();

  const { toast } = useToast();
  const { printHtml } = usePrint();
  const { t } = useTranslation();
  // R-APPROVAL-GATE-RETURNS-V1: gate for refund execution.
  const approvalGate = useApprovalGate({ employees, settings, attemptedByName: currentEmployee?.name });
  const taxRate = settings.taxRate ?? 0.0925;
  // r-pkg-b4 fix B1: was reading nonexistent `returnDays` — `returnPolicyDays`
  // is the actual field on StoreSettings (types.ts L74).
  const RETURN_LIMIT_DAYS = settings.returnPolicyDays || 30;

  // Round 19: anti-stale-closure refs for the 8 collections processReturn touches.
  // Returns is the hub handler that mutates the most state in a single transaction
  // (sales + inventory + customers + cart + repairs + unlocks + specialOrders +
  // layaways). Without refs, any Firestore listener push during the confirm modal
  // can invalidate the closure and clobber concurrent updates from station B.
  const salesRef         = useRef(sales);
  const inventoryRef     = useRef(inventory);
  const customersRef     = useRef(customers);
  const cartRef          = useRef(cart);
  const repairsRef       = useRef(repairs);
  const unlocksRef       = useRef(unlocks);
  const specialOrdersRef = useRef(specialOrders);
  const layawaysRef      = useRef(layaways);
  const customerReturnsRef = useRef(customerReturns);
  const vendorReturnsRef   = useRef(vendorReturns);
  useEffect(() => { salesRef.current = sales; }, [sales]);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  useEffect(() => { repairsRef.current = repairs; }, [repairs]);
  useEffect(() => { unlocksRef.current = unlocks; }, [unlocks]);
  useEffect(() => { specialOrdersRef.current = specialOrders; }, [specialOrders]);
  useEffect(() => { layawaysRef.current = layaways; }, [layaways]);
  useEffect(() => { customerReturnsRef.current = customerReturns; }, [customerReturns]);
  useEffect(() => { vendorReturnsRef.current = vendorReturns; }, [vendorReturns]);

  // ── Tabs ──────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState<'customer' | 'vendor'>('customer');

  // ── Customer return state ──────────────────────────────────
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState(globalSearchTerm || '');
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchType, setSearchType] = useState('any');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchResults, setSearchResults] = useState<Sale[]>([]);
  const [foundSale, setFoundSale] = useState<Sale | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<string, { qty: number; maxQty: number }>>({});
  const [reason, setReason] = useState('defective');
  const [resolution, setResolution] = useState('cash');
  const [notes, setNotes] = useState('');
  const [showConfirmReturn, setShowConfirmReturn] = useState(false);
  const [returnSuccess, setReturnSuccess] = useState<CustomerReturn | null>(null);
  // r-pkg-b3: returnHistory now reads from AppState (hydrated at boot from
  // localStorage or Firestore), replacing the old loadLocal() init.
  const returnHistory = customerReturns;
  const setReturnHistory = setCustomerReturns;
  const [showHistory, setShowHistory] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  // ── Consume cross-module search term once on mount ────────
  useEffect(() => {
    if (globalSearchTerm) {
      setSearchQuery(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Consume pending barcode from global scanner ───────────
  // When a receipt barcode is scanned anywhere in the app, AppShell
  // navigates here and sets pendingBarcodeInvoice. We auto-search it.
  useEffect(() => {
    if (!pendingBarcodeInvoice) return;
    // Clear the global pending state immediately so it doesn't re-trigger
    dispatch({ type: 'SET_PENDING_BARCODE_INVOICE', payload: '' });
    // Set search fields
    setSearchQuery(pendingBarcodeInvoice);
    setSearchType('invoice');
    // Run search directly with the invoice string (avoids stale closure on handleSearch).
    // Round 19: read from salesRef.current so we see any sales the Firestore listener
    // has pushed since the component mounted (not just the snapshot at mount time).
    const q = pendingBarcodeInvoice.trim().toLowerCase();
    const matches = (salesRef.current || []).filter((s) => {
      if (s.status === 'voided') return false;
      return s.invoiceNumber?.toLowerCase() === q;
    });
    if (matches.length === 1) {
      setFoundSale(matches[0]);
      setStep(2);
    } else if (matches.length > 1) {
      setSearchResults(matches);
      setStep(1);
    } else {
      // No exact match — let the user see the pre-filled search and hit Search
      setStep(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBarcodeInvoice]);

  // ── Search ────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q && !dateFrom && !dateTo) {
      toast(t('returns.enterSearchTerm'), 'warning');
      return;
    }

    let matches = (sales || []).filter((s) => s.status !== 'voided');

    if (dateFrom) matches = matches.filter((s) => s.createdAt && new Date(s.createdAt as string) >= new Date(dateFrom));
    if (dateTo)   matches = matches.filter((s) => s.createdAt && new Date(s.createdAt as string) <= new Date(dateTo + 'T23:59:59'));

    if (q) {
      matches = matches.filter((s) => {
        if (searchType === 'invoice' || searchType === 'any') {
          if ((s.invoiceNumber || '').toLowerCase().includes(q)) return true;
          if ((s.invoiceNumber || '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))) return true;
        }
        if (searchType === 'phone' || searchType === 'any') {
          if ((s.customerPhone || '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))) return true;
        }
        if (searchType === 'name' || searchType === 'any') {
          if ((s.customerName || '').toLowerCase().includes(q)) return true;
        }
        if (searchType === 'item' || searchType === 'any') {
          if ((s.items || []).some((i) => (i.name || '').toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q))) return true;
        }
        return false;
      });
    }

    matches = matches
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())
      .slice(0, 30);

    if (matches.length === 0) {
      toast(t('returns.noSalesFound'), 'warning');
    } else if (matches.length === 1) {
      pickSale(matches[0]);
    } else {
      setSearchResults(matches);
    }
  }, [searchQuery, searchType, dateFrom, dateTo, sales, t, toast]);

  const pickSale = (sale: Sale) => {
    setFoundSale(sale);
    setSelectedItems({});
    setSearchResults([]);
    setStep(2);
    // R-RETURNS-F1.4: if the original was store credit, pre-select
    // a valid refund method (store_credit) so the form starts in a
    // valid state — the cash/card buttons will render disabled.
    if (sale.paymentMethod === 'Store Credit') {
      setResolution('store_credit');
    }
  };

  const resetSearch = () => {
    setStep(1); setFoundSale(null); setSelectedItems({});
    setSearchQuery(''); setSearchResults([]); setNotes('');
    setReason('defective'); setResolution('cash');
  };

  const handleBarcodeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setSearchType('invoice');
      setTimeout(handleSearch, 50);
    }
  };

  // ── Item selection ─────────────────────────────────────────
  // r-pkg-b4 fix B2+B3+B5: block double returns (fullyReturned check),
  // exclude non-returnable categories (top_up, special_order added).
  const NON_RETURNABLE: Set<string> = new Set([
    'phone_payment', 'service', 'repair', 'unlock',
    'layaway_deposit', 'top_up', 'special_order',
  ]);
  const returnableItems = useMemo(() => {
    if (!foundSale) return [];
    return (foundSale.items || []).filter((item) =>
      !NON_RETURNABLE.has(item.category) && !item.fullyReturned
    );
  }, [foundSale]);

  const toggleItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const updated = { ...prev };
      if (updated[itemId]) {
        delete updated[itemId];
      } else {
        const item = returnableItems.find((i) => i.id === itemId);
        const maxQty = Math.max(0, (item?.qty || 1) - (item?.returnedQty || 0));
        if (maxQty <= 0) return updated; // fully returned — shouldn't reach here post-filter, but guard
        updated[itemId] = { qty: 1, maxQty };
      }
      return updated;
    });
  };

  const setItemQty = (itemId: string, qty: number) => {
    const item = returnableItems.find((i) => i.id === itemId);
    const maxQty = Math.max(0, (item?.qty || 1) - (item?.returnedQty || 0));
    const safeQty = Math.max(1, Math.min(qty, Math.max(1, maxQty)));
    setSelectedItems((prev) => ({ ...prev, [itemId]: { ...prev[itemId], qty: safeQty, maxQty } }));
  };

  // R-RETURNS-F1.2: discount ratio reconstruction — mirrors POSModule's
  // itemPaidCents helper (see POSModule.tsx line ~493). When the original
  // sale had a cart discount, calculateCartTotals prorated it across
  // discountable items. Refunding `price × qty × taxRate` (without the
  // ratio) would over-refund both the item base AND the tax, paying the
  // customer more than they paid the store.
  //
  // Only discountable categories (exclude phone_payment + top_up) get the
  // ratio applied. phone_payment is NON_RETURNABLE anyway, but the filter
  // preserves the invariant symmetry with POSModule.
  const discountRatio = useMemo(() => {
    if (!foundSale) return 1;
    const discountableBaseSum = (foundSale.items || [])
      .filter((i) => i.category !== 'phone_payment' && i.category !== 'top_up')
      .reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
    const saleDiscountAmount = Math.max(
      0,
      (foundSale.subtotal || 0) - ((foundSale as any).subtotalAfterDiscount ?? foundSale.subtotal ?? 0),
    );
    return discountableBaseSum > 0
      ? Math.max(0, (discountableBaseSum - saleDiscountAmount) / discountableBaseSum)
      : 1;
  }, [foundSale]);

  // Effective per-unit price in cents after applying the sale's prorated
  // discount. Non-discountable categories pass through unchanged.
  const effectivePriceCents = useCallback((item: { price?: number; category?: string }) => {
    const raw = item.price || 0;
    const isDiscountable = item.category !== 'phone_payment' && item.category !== 'top_up';
    return isDiscountable ? Math.round(raw * discountRatio) : raw;
  }, [discountRatio]);

  const returnSubtotal = useMemo(() =>
    Object.entries(selectedItems).reduce((sum, [id, sel]) => {
      const item = returnableItems.find((i) => i.id === id);
      if (!item) return sum;
      return sum + (effectivePriceCents(item) / 100) * sel.qty;
    }, 0), [selectedItems, returnableItems, effectivePriceCents]);

  const returnTax = useMemo(() =>
    Object.entries(selectedItems).reduce((sum, [id, sel]) => {
      const item = returnableItems.find((i) => i.id === id);
      if (!item?.taxable) return sum;
      return sum + rc(forwardTaxFromBase(effectivePriceCents(item) * sel.qty, taxRate, true).taxCents / 100);
    }, 0), [selectedItems, returnableItems, taxRate, effectivePriceCents]);

  const returnTotal = rc(returnSubtotal + returnTax);
  const selectedCount = Object.keys(selectedItems).length;
  const isWithinWindow = foundSale
    ? (Date.now() - new Date(foundSale.createdAt as string).getTime()) / 86400000 <= RETURN_LIMIT_DAYS
    : true;

  // ── Process customer return ────────────────────────────────
  const processReturn = useCallback(async () => {
    if (selectedCount === 0) { toast(t('returns.selectAtLeastOne'), 'warning'); return; }

    // R-RETURNS-F1.4: hard guard — if the original sale was paid with store
    // credit, no cash/card money physically entered the drawer. Refunding
    // to cash or card would cash out money that was never collected.
    // Force store_credit or exchange.
    if (foundSale?.paymentMethod === 'Store Credit' && (resolution === 'cash' || resolution === 'card')) {
      toast(t('returns.storeCreditOnly'), 'error');
      return;
    }

    // Multi-station safe return number (ts8 + rand4).
    const rtnTs8  = Date.now().toString().slice(-8);
    const rtnRand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const returnNumber = `RTN-${rtnTs8}-${rtnRand}`;
    const nowIso = new Date().toISOString();

    // Phase 1: build return items with dual-write (canonical cents + legacy dollars).
    // SaleItem.price is already cents; no conversion math here, just multiply.
    //
    // R-RETURNS-F1.2: priceCents is the EFFECTIVE (post-discount) per-unit
    // price the customer actually paid. This matches the refund amount
    // owed. Previously priceCents was the pre-discount sticker which
    // over-refunded by the discount portion (base + tax both inflated).
    const returnItems: CustomerReturnItem[] = Object.entries(selectedItems).map(([id, sel]) => {
      const item = returnableItems.find((i) => i.id === id);
      const priceCents    = item ? effectivePriceCents(item) : 0;
      const subtotalCents = priceCents * sel.qty;
      const taxCents      = item?.taxable ? forwardTaxFromBase(subtotalCents, taxRate, true).taxCents : 0;
      const totalCents    = subtotalCents + taxCents;
      return {
        id: item?.id,
        name: item?.name || t('returns.unknownItem'),
        qty: sel.qty,
        // canonical cents
        priceCents, subtotalCents, taxCents, totalCents,
        // legacy dollars (deprecated — kept for Reports/Dashboard compat)
        price: priceCents / 100,
        subtotal: subtotalCents / 100,
        tax: taxCents / 100,
        total: totalCents / 100,
      };
    });

    const subtotalCents = returnItems.reduce((s, i) => s + i.subtotalCents, 0);
    const taxCentsTotal = returnItems.reduce((s, i) => s + i.taxCents, 0);
    const totalCents    = subtotalCents + taxCentsTotal;

    // R-APPROVAL-GATE-RETURNS-V1: gate before any mutation.
    const refundReasonStr = reason ? `Refund requested — ${reason}` : 'Refund requested — customer return';
    const refundApproval = await approvalGate.requestApproval({
      actionType: 'REFUND',
      requestedByEmployeeId: currentEmployee?.id || '',
      entityId: foundSale?.id || '',
      affectedAmount: totalCents,
      reason: refundReasonStr,
    });
    if (!refundApproval.approved) return;

    const returnRecord: CustomerReturn = {
      id: generateId(),
      returnNumber,
      originalInvoice: foundSale?.invoiceNumber || t('returns.na'),
      originalSaleId: foundSale?.id || null,
      customerName: foundSale?.customerName || t('returns.noInvoice'),
      customerPhone: foundSale?.customerPhone || '',
      employeeName: currentEmployee?.name || '',
      createdAt: nowIso,
      reason, resolution, notes,
      items: returnItems,
      // canonical cents
      subtotalCents, taxCents: taxCentsTotal, totalCents,
      // legacy dollars (deprecated — kept for Reports/Dashboard compat)
      subtotal: subtotalCents / 100,
      taxRefunded: taxCentsTotal / 100,
      total: totalCents / 100,
    };

    // Phase 2: update foundSale.items (returnedQty / fullyReturned / hasReturn).
    // Hold commit — R9-1 may add status='refunded' before we persist.
    let updatedSale: Sale | null = null;
    if (foundSale) {
      updatedSale = {
        ...foundSale,
        items: foundSale.items.map((item) => {
          const sel = selectedItems[item.id];
          if (!sel) return item;
          const returnedQty = (item.returnedQty || 0) + sel.qty;
          return { ...item, returnedQty, fullyReturned: returnedQty >= item.qty };
        }),
        hasReturn: true,
        lastReturnAt: nowIso,
      } as Sale;
    }

    // Phase 3: restore inventory (atomic batch write).
    const updatedInv = inventoryRef.current.map((invItem) => {
      const entry = Object.entries(selectedItems).find(([id]) => {
        const si = foundSale?.items.find((i) => i.id === id);
        return si?.inventoryId === invItem.id;
      });
      if (!entry) return invItem;
      const newQty = invItem.qty + entry[1].qty;
      return { ...invItem, qty: newQty };
    });
    inventoryRef.current = updatedInv;
    setInventory(updatedInv);
    const changedInvItems = updatedInv.filter((invItem) =>
      Object.entries(selectedItems).some(([id]) => {
        const si = foundSale?.items.find((i) => i.id === id);
        return si?.inventoryId === invItem.id;
      }),
    );
    if (changedInvItems.length > 0) {
      batchSave(changedInvItems.map((i) => ({
        collection: COLLECTIONS.inventory,
        id: i.id,
        data: i as unknown as Record<string, unknown>,
      })));
    }

    // Phase 4: build refund sale (only if cash/card). Hold commit — R9-1 may
    // attach linkedRefunds before we persist.
    // paymentMethod = 'Cash'/'Card' so Reports drawer reconciliation finds it;
    // the "is refund" identity is encoded via isRefund:true + negative total.
    //
    // R-RETURNS-F1.3: if the original sale was Split, the refund must be
    // proportionally distributed across cash/card to keep the drawer
    // reconciled. Otherwise refunding a $100 50/50 split entirely to
    // cash would cash-out $50 that was never in the drawer.
    let refundSale: any = null;
    if (resolution === 'cash' || resolution === 'card') {
      const wasSplit = foundSale?.paymentMethod === 'Split' && !!foundSale?.splitPayment;
      const origCashCents = wasSplit ? (foundSale!.splitPayment!.cash || 0) : 0;
      const origCardCents = wasSplit ? (foundSale!.splitPayment!.card || 0) : 0;
      const origSplitTotal = origCashCents + origCardCents;

      let refundPaymentMethod: string;
      let refundSplitPayment: { cash: number; card: number; storeCredit: number } | undefined;

      if (wasSplit && origSplitTotal > 0) {
        // Proportional split: preserve the original cash/card ratio.
        // Remainder goes to the non-rounded side so totals match exactly.
        const cashRatio = origCashCents / origSplitTotal;
        const refundCashCents = Math.round(totalCents * cashRatio);
        const refundCardCents = totalCents - refundCashCents;
        refundPaymentMethod = 'Split';
        refundSplitPayment = {
          cash: -refundCashCents,
          card: -refundCardCents,
          storeCredit: 0,
        };
        toast(t('returns.splitRefundInfo', (refundCashCents / 100).toFixed(2), (refundCardCents / 100).toFixed(2)), 'info');
      } else {
        refundPaymentMethod = resolution === 'cash' ? 'Cash' : 'Card';
      }

      refundSale = {
        id: generateId(),
        invoiceNumber: `REF-${returnNumber}`,
        customerName: returnRecord.customerName,
        customerPhone: returnRecord.customerPhone,
        employeeName: currentEmployee?.name || '',
        createdAt: nowIso,
        paymentMethod: refundPaymentMethod,
        ...(refundSplitPayment ? { splitPayment: refundSplitPayment } : {}),
        isRefund: true,
        // Round 11: refund sale is an audit record, not a real sale. 'voided'
        // aligns with SO/Repair/Unlock/Layaway cancellation refund sales and
        // keeps Reports Round 10.1 Gross math consistent (excluded via status).
        status: 'voided',
        refundFor: foundSale?.invoiceNumber || '',
        returnNumber,
        items: returnItems.map((i) => ({ ...i, price: -i.priceCents })),
        subtotal: -subtotalCents,
        taxAmount: -taxCentsTotal,
        // Fee fields present (even as 0) so Reports aggregations don't NaN.
        cbeTotal: 0,
        screenFeeTotal: 0,
        creditCardFee: 0,
        salesTax: 0,
        utilityTax: 0,
        mobileSurcharge: 0,
        total: -totalCents,
      };
    }

    // Phase 5: exchange → negative cart item.
    if (resolution === 'exchange' && totalCents > 0) {
      const exchangeItem: CartItem = {
        id: generateId(),
        name: t('returns.exchangeCreditName', returnNumber),
        category: 'service',
        price: -totalCents,
        qty: 1, taxable: false, cbeEligible: false,
        notes: t('returns.exchangeFrom', returnRecord.originalInvoice),
      };
      const nextCart = [...cartRef.current, exchangeItem];
      cartRef.current = nextCart;
      setCart(nextCart);
      setActiveTab('pos');
    }

    // Phase 6: store credit.
    // Prefer exact customerId match; fallback to exact tail-10 phone match.
    if (resolution === 'store_credit' && totalCents > 0) {
      const refundCents = totalCents;
      const saleCustomerId = foundSale?.customerId;
      const rPhoneRaw = (foundSale?.customerPhone || '').replace(/\D/g, '');
      const rTail = rPhoneRaw.length >= 10 ? rPhoneRaw.slice(-10) : '';

      let matched = false;
      const updatedCustomers = customersRef.current.map((c) => {
        if (saleCustomerId && c.id === saleCustomerId) {
          matched = true;
          const updated = { ...c, storeCredit: (c.storeCredit || 0) + refundCents };
          persist.customer(updated.id, updated as unknown as Record<string, unknown>);
          return updated;
        }
        if (!saleCustomerId && rTail) {
          const cPhone = (c.phone || '').replace(/\D/g, '');
          if (cPhone.length >= 10 && cPhone.slice(-10) === rTail) {
            matched = true;
            const updated = { ...c, storeCredit: (c.storeCredit || 0) + refundCents };
            persist.customer(updated.id, updated as unknown as Record<string, unknown>);
            return updated;
          }
        }
        return c;
      });

      if (matched) {
        customersRef.current = updatedCustomers;
        setCustomers(updatedCustomers);
      } else {
        toast(t('returns.creditApplyManually'), 'warning');
      }
    }

    // Phase 6b: loyalty points reversal.
    // Mirror the POS earn formula: 1 pt per $1 of non-phone_payment/top_up items.
    // Only runs if loyalty is enabled and a customer is linked to the original sale.
    if (settings.loyaltyEnabled && foundSale?.customerId) {
      const returnedBase = returnItems
        .filter((i) => (i as any).category !== 'phone_payment' && (i as any).category !== 'top_up')
        .reduce((s, i) => s + i.subtotalCents, 0);
      const ptsToReverse = Math.trunc(returnedBase / 100);
      if (ptsToReverse > 0) {
        const saleCustomerId = foundSale.customerId;
        const updatedCustomers = customersRef.current.map((c) => {
          if (c.id !== saleCustomerId) return c;
          const updated = { ...c, loyaltyPoints: Math.max(0, (c.loyaltyPoints || 0) - ptsToReverse) };
          persist.customer(updated.id, updated as unknown as Record<string, unknown>);
          return updated;
        });
        customersRef.current = updatedCustomers;
        setCustomers(updatedCustomers);
      }
    }

    // Phase 7: R9-1 linked cancellation.
    // For each linked entity (repair/unlock/SO/layaway) cancel with canonical
    // schema of its source module. If resolution is cash/card, capture depositCents
    // into linkedRefunds[] so the refund sale cross-refs the cancelled entities.
    const linkedRefunds: { type: string; id: string; depositCents: number }[] = [];
    const skippedAlreadyDone: string[] = [];
    let cancelledCount = 0;
    const refundMethodForEntity: 'cash' | 'store_credit' =
      (resolution === 'cash' || resolution === 'card') ? 'cash' : 'store_credit';
    const cancellationNote = `Return ${returnNumber}: ${notes || reason}`;

    if (foundSale) {
      const returnedItemIds = new Set(Object.keys(selectedItems));
      const linkedItems = foundSale.items.filter((i) =>
        returnedItemIds.has(i.id) &&
        (i.repairId || i.unlockId || i.specialOrderId || i.layawayId)
      );

      if (linkedItems.length > 0) {
        // Repairs — 'Cancelled' capitalized (RepairModule schema). Clear the
        // legacy `deposit` field too so TicketCard doesn't fall back to stale data.
        const repairIds = new Set(linkedItems.map((i) => i.repairId).filter(Boolean) as string[]);
        if (repairIds.size > 0) {
          const updatedRepairs = repairsRef.current.map((r) => {
            if (!repairIds.has(r.id)) return r;
            const ns = normalizeStatus(r.status || '');
            if (ns === 'complete' || ns === 'completed' || ns === 'picked_up') {
              skippedAlreadyDone.push(`Repair ${r.id.slice(-6)}`);
              return r;
            }
            const depositCents = (r as any).depositAmount || (r as any).deposit || 0;
            if ((resolution === 'cash' || resolution === 'card') && depositCents > 0) {
              linkedRefunds.push({ type: 'repair', id: r.id, depositCents });
            }
            const updated = {
              ...r,
              status: 'Cancelled',
              depositAmount: 0,
              deposit: 0,
              balance: 0,
              depositRefundMethod: refundMethodForEntity,
              depositRefundAmount: depositCents,
              cancellationNote,
              cancelledAt: nowIso,
              updatedAt: nowIso,
            };
            persist.repair(updated.id, updated as unknown as Record<string, unknown>);
            cancelledCount++;
            return updated;
          });
          repairsRef.current = updatedRepairs;
          setRepairs(updatedRepairs);
        }

        // Unlocks — 'Cancelled' capitalized (UnlockModule schema).
        const unlockIds = new Set(linkedItems.map((i) => i.unlockId).filter(Boolean) as string[]);
        if (unlockIds.size > 0) {
          const updatedUnlocks = unlocksRef.current.map((u) => {
            if (!unlockIds.has(u.id)) return u;
            const ns = normalizeStatus(u.status || '');
            if (ns === 'completed' || ns === 'complete') {
              skippedAlreadyDone.push(`Unlock ${u.id.slice(-6)}`);
              return u;
            }
            const depositCents = (u as any).depositAmount || 0;
            if ((resolution === 'cash' || resolution === 'card') && depositCents > 0) {
              linkedRefunds.push({ type: 'unlock', id: u.id, depositCents });
            }
            const updated = {
              ...u,
              status: 'Cancelled',
              depositAmount: 0,
              balance: 0,
              depositRefundMethod: refundMethodForEntity,
              depositRefundAmount: depositCents,
              cancellationNote,
              cancelledAt: nowIso,
              updatedAt: nowIso,
            };
            persist.unlock(updated.id, updated as unknown as Record<string, unknown>);
            cancelledCount++;
            return updated;
          });
          unlocksRef.current = updatedUnlocks;
          setUnlocks(updatedUnlocks);
        }

        // Special Orders — 'cancelled' lowercase (SpecialOrdersModule schema).
        const soIds = new Set(linkedItems.map((i) => i.specialOrderId).filter(Boolean) as string[]);
        if (soIds.size > 0) {
          const updatedSOs = specialOrdersRef.current.map((o) => {
            if (!soIds.has(o.id)) return o;
            const ns = normalizeStatus(o.status || '');
            if (ns === 'picked_up' || ns === 'completed') {
              skippedAlreadyDone.push(`SO ${o.id.slice(-6)}`);
              return o;
            }
            const depositCents = (o as any).depositAmount || 0;
            if ((resolution === 'cash' || resolution === 'card') && depositCents > 0) {
              linkedRefunds.push({ type: 'specialOrder', id: o.id, depositCents });
            }
            const updated = {
              ...o,
              status: 'cancelled',
              depositAmount: 0,
              balance: 0,
              depositRefundMethod: refundMethodForEntity,
              depositRefundAmount: depositCents,
              cancellationNote,
              cancelledAt: nowIso,
              updatedAt: nowIso,
            };
            persist.specialOrder(updated.id, updated as unknown as Record<string, unknown>);
            cancelledCount++;
            return updated;
          });
          specialOrdersRef.current = updatedSOs;
          setSpecialOrders(updatedSOs);
        }

        // Layaways — 'cancelled' lowercase; uses paidAmount (not depositAmount).
        const layawayIds = new Set(linkedItems.map((i) => i.layawayId).filter(Boolean) as string[]);
        if (layawayIds.size > 0) {
          const updatedLayaways = layawaysRef.current.map((l) => {
            if (!layawayIds.has(l.id)) return l;
            const ns = normalizeStatus(l.status || '');
            if (ns === 'completed' || ns === 'picked_up') {
              skippedAlreadyDone.push(`Layaway ${l.id.slice(-6)}`);
              return l;
            }
            const depositCents = (l as any).paidAmount || 0;
            if ((resolution === 'cash' || resolution === 'card') && depositCents > 0) {
              linkedRefunds.push({ type: 'layaway', id: l.id, depositCents });
            }
            const updated = {
              ...l,
              status: 'cancelled',
              paidAmount: 0,
              balance: 0,
              depositRefundMethod: refundMethodForEntity,
              depositRefundAmount: depositCents,
              cancellationNote,
              cancelledAt: nowIso,
              updatedAt: nowIso,
            };
            persist.layaway(updated.id, updated as unknown as Record<string, unknown>);
            cancelledCount++;
            return updated;
          });
          layawaysRef.current = updatedLayaways;
          setLayaways(updatedLayaways);
        }
      }
    }

    // Phase 8: attach linkedRefunds to refund sale + mark original sale 'refunded'.
    // Round 11: linear refunds (cash/card with no entity link) must also mark the
    // original sale refunded and cross-ref the refund sale back to it — previously
    // only linked-entity refunds did this, leaving linear refunds invisible to
    // Reports Round 10.1 Gross-exclusion + R9-1 dedup logic.
    if (refundSale) {
      if (linkedRefunds.length > 0) {
        refundSale.linkedRefunds = linkedRefunds;
      } else if (updatedSale) {
        refundSale.linkedRefunds = [{ type: 'sale', id: updatedSale.id, depositCents: totalCents }];
      }
    }
    if (updatedSale && (resolution === 'cash' || resolution === 'card')) {
      const reason = linkedRefunds.length > 0
        ? `Return ${returnNumber} — linked entity cancellation`
        : `Return ${returnNumber}`;
      updatedSale = {
        ...updatedSale,
        status: 'refunded' as Sale['status'],
        refundedAt: nowIso,
        refundReason: reason,
        refundMethod: resolution === 'cash' ? 'cash' : 'card',
      } as Sale;
    }

    // Phase 9: commit foundSale (with returnedQty and possibly refunded status).
    if (updatedSale && foundSale) {
      const nextSales = salesRef.current.map((s) => s.id === foundSale.id ? updatedSale as Sale : s);
      salesRef.current = nextSales;
      setSales(nextSales);
      persist.sale(updatedSale.id, updatedSale as unknown as Record<string, unknown>);
    }
    // Phase 9b: commit refund sale (with linkedRefunds if any).
    if (refundSale) {
      const refundedSales = [refundSale, ...salesRef.current];
      salesRef.current = refundedSales;
      setSales(refundedSales);
      persist.sale(refundSale.id, refundSale as unknown as Record<string, unknown>);
    }

    // Phase 10: persist return record.
    const history = [returnRecord, ...customerReturnsRef.current];
    customerReturnsRef.current = history;
    setReturnHistory(history);
    persist.customerReturn(returnRecord.id, returnRecord as unknown as Record<string, unknown>);

    // Toasts
    if (skippedAlreadyDone.length > 0) {
      toast(t('returns.alreadyCompleteWarning', skippedAlreadyDone.join(', ')), 'warning');
    }
    const mainMsg = t('returns.processedToast', returnNumber, fc(totalCents));
    const linkedMsg = cancelledCount > 0 ? t('returns.linkedCancelledMsg', cancelledCount) : '';
    toast(mainMsg + linkedMsg, 'success');

    setReturnSuccess(returnRecord);
    resetSearch();
  }, [selectedCount, selectedItems, foundSale, returnableItems, resolution, reason, notes,
      currentEmployee, taxRate, t,
      setSales, setInventory, setCustomers, setCart, setActiveTab, setRepairs, setUnlocks, setSpecialOrders, setLayaways,
      setReturnHistory, toast, approvalGate.requestApproval]);

  // ── Print return receipt ───────────────────────────────────
  // Round 19 fixes:
  //   - Old code did `window.open('', '_blank')` placeholder + `w.close()` which
  //     flashed an empty tab. printHtml creates its own window — no placeholder needed.
  //   - escHtml replaces the partial-escape (only < and >) with full canonical escape.
  const printReturnReceipt = (rec: CustomerReturn) => {
    const lines = [
      settings.storeName || 'GO CELLULAR',
      settings.storeAddress || '',
      settings.storePhone || '',
      '--------------------------------',
      t('returns.print.receipt'),
      `${t('returns.print.returnNo')}: ${rec.returnNumber}`,
      `${t('returns.print.date')}: ${new Date(rec.createdAt).toLocaleDateString()}`,
      `${t('returns.print.customer')}: ${rec.customerName}`,
      `${t('returns.print.origInvoice')}: ${rec.originalInvoice}`,
      `${t('returns.print.reason')}: ${rec.reason}`,
      `${t('returns.print.resolution')}: ${rec.resolution}`,
      '--------------------------------',
      ...(rec.items || []).map((i: any) => `${i.name} x${i.qty}  $${((i.totalCents || 0) / 100).toFixed(2)}`),
      '--------------------------------',
      `${t('returns.print.totalReturned')}: $${((rec.totalCents || 0) / 100).toFixed(2)}`,
      '', t('returns.print.thanks'),
    ].filter(Boolean);
    const html = `<!DOCTYPE html><html><head><title>Return</title><style>body{font-family:monospace;font-size:12px;width:3in;margin:0;padding:8px}pre{white-space:pre-wrap}</style></head><body><pre>${escHtml(lines.join('\n'))}</pre></body></html>`;
    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
  };

  // ── Vendor returns ─────────────────────────────────────────
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorItem, setVendorItem] = useState<InventoryItem | null>(null);
  const [vendorQty, setVendorQty] = useState(1);
  const [vendorReason, setVendorReason] = useState('defective');
  const [vendorResolution, setVendorResolution] = useState('credit');
  const [vendorNotes, setVendorNotes] = useState('');
  // r-pkg-b3: vendorHistory now reads from AppState (hydrated at boot)
  const vendorHistory = vendorReturns;
  const setVendorHistory = setVendorReturns;
  const [showVendorHistory, setShowVendorHistory] = useState(false);

  const vendorResults = useMemo(() => {
    if (!vendorSearch.trim()) return [];
    return inventory.filter((i) => matchesSearch(vendorSearch, i.name, i.sku, i.supplier)).slice(0, 15);
  }, [vendorSearch, inventory]);

  const processVendorReturn = () => {
    if (!vendorItem) { toast(t('returns.vendor.selectProduct'), 'warning'); return; }
    const maxQty = vendorItem.qty || 0;
    if (vendorQty < 1 || vendorQty > maxQty) { toast(t('returns.vendor.invalidQty', maxQty), 'warning'); return; }
    // Round 19: multi-station safe vendor return number (same pattern as RTN above)
    const vndTs8  = Date.now().toString().slice(-8);
    const vndRand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const vendorCostCents = (vendorItem.cost || 0) * vendorQty;
    const rec: VendorReturn = {
      id: generateId(), returnNumber: `VND-${vndTs8}-${vndRand}`,
      productId: vendorItem.id, productName: vendorItem.name,
      sku: vendorItem.sku || '', supplier: vendorItem.supplier || t('returns.vendor.unknown'),
      qty: vendorQty, cost: vendorItem.cost || 0,
      // canonical cents
      totalValueCents: vendorCostCents,
      // legacy dollars (deprecated — kept for backward compat)
      totalValue: vendorCostCents / 100,
      reason: vendorReason, resolution: vendorResolution, notes: vendorNotes,
      employeeName: currentEmployee?.name || '', createdAt: new Date().toISOString(),
    };
    // Round 19: read from inventoryRef.current (anti stale-closure).
    // Fix 7: replacement resolution means the vendor is sending a new unit —
    // the defective item was already removed from shelf, so inventory stays.
    if (vendorResolution !== 'replacement') {
      const updatedInv = inventoryRef.current.map((i) => {
        if (i.id !== vendorItem.id) return i;
        const newQty = Math.max(0, i.qty - vendorQty);
        return { ...i, qty: newQty };
      });
      inventoryRef.current = updatedInv;
      setInventory(updatedInv);
      const updated = updatedInv.find((i) => i.id === vendorItem.id);
      if (updated) persist.inventory(updated.id, updated as unknown as Record<string, unknown>);
    }
    // r-pkg-b3: persist via Firestore + update state via ref-safe pattern
    const vHistory = [rec, ...vendorReturnsRef.current];
    vendorReturnsRef.current = vHistory;
    setVendorHistory(vHistory);
    persist.vendorReturn(rec.id, rec as unknown as Record<string, unknown>);
    toast(t('returns.vendor.recorded'), 'success');
    setVendorItem(null); setVendorSearch(''); setVendorQty(1); setVendorNotes('');
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header + tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', margin: 0 }}>
          🔄 {t('returns.title')}
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => { setMainTab('customer'); resetSearch(); }}
            className={`btn ${mainTab === 'customer' ? 'btn-primary' : 'btn-secondary'}`}>
            👤 {t('returns.tabCustomer')}
          </button>
          <button onClick={() => setMainTab('vendor')}
            className={`btn ${mainTab === 'vendor' ? 'btn-primary' : 'btn-secondary'}`}>
            📦 {t('returns.tabVendor')}
          </button>
        </div>
      </div>

      <GlobalSearchBar
        localValue={globalSearch}
        onLocalChange={setGlobalSearch}
        placeholder={t('returns.globalSearchPlaceholder')}
      />

      {/* Success banner */}
      {returnSuccess && (
        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '0.75rem', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div style={{ fontWeight: 700, color: '#22c55e' }}>
              ✅ {t('returns.successBanner')}: {returnSuccess.returnNumber}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>
              {fc(returnSuccess.totalCents || 0)} —{' '}
              {returnSuccess.resolution === 'cash' ? t('returns.resCashFull') :
               returnSuccess.resolution === 'card' ? t('returns.resCardFull') :
               returnSuccess.resolution === 'store_credit' ? t('returns.resStoreCreditFull') :
               t('returns.resExchangeFull')}
              {(returnSuccess.resolution === 'cash' || returnSuccess.resolution === 'card')
                ? t('returns.negativeTransactionNote') : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
              onClick={() => printReturnReceipt(returnSuccess)}>🖨️ {t('returns.printBtn')}</button>
            <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
              onClick={() => setReturnSuccess(null)}>✕</button>
          </div>
        </div>
      )}

      {/* ── CUSTOMER RETURNS ──────────────────────────────── */}
      {mainTab === 'customer' && (
        <div>
          {/* STEP 1 — SEARCH */}
          {step === 1 && (
            <div className="glass-card p-5">
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: '1rem' }}>
                🔍 {t('returns.findSale')}
              </h3>

              {/* Search type tabs */}
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
                {[
                  { v: 'any',     l: t('returns.searchAll') },
                  { v: 'invoice', l: t('returns.searchInvoice') },
                  { v: 'phone',   l: t('returns.searchPhone') },
                  { v: 'name',    l: t('returns.searchName') },
                  { v: 'item',    l: t('returns.searchItem') },
                  { v: 'date',    l: t('returns.searchDate') },
                ].map((o) => (
                  <button key={o.v} onClick={() => setSearchType(o.v)}
                    className={`btn btn-sm ${searchType === o.v ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.78rem' }}>
                    {o.l}
                  </button>
                ))}
              </div>

              {/* Barcode/text input */}
              {searchType !== 'date' && (
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input
                    ref={barcodeRef}
                    type="text"
                    className="input"
                    style={{ flex: 1, fontSize: '1rem' }}
                    placeholder={
                      searchType === 'invoice' ? t('returns.searchPlaceholderInvoice') :
                      searchType === 'phone'   ? t('returns.searchPlaceholderPhone') :
                      searchType === 'name'    ? t('returns.searchPlaceholderName') :
                      searchType === 'item'    ? t('returns.searchPlaceholderItem') :
                      t('returns.searchPlaceholderAny')
                    }
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleBarcodeKey}
                    autoFocus
                  />
                  <button className="btn btn-primary" onClick={handleSearch}>
                    🔍 {t('returns.searchBtn')}
                  </button>
                </div>
              )}

              {/* Date range */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{t('returns.dateFrom')}</label>
                  <input type="date" className="input" style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
                    value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{t('returns.dateTo')}</label>
                  <input type="date" className="input" style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
                    value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                {searchType === 'date' && (dateFrom || dateTo) && (
                  <button className="btn btn-primary" onClick={handleSearch}>{t('returns.searchByDate')}</button>
                )}
                {(dateFrom || dateTo) && (
                  <button className="btn btn-secondary btn-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>
                    ✕ {t('returns.clearDates')}
                  </button>
                )}
              </div>

              {/* Barcode hint */}
              {(searchType === 'invoice' || searchType === 'any') && (
                <div style={{ fontSize: '0.78rem', color: '#38bdf8', padding: '0.4rem 0.75rem', background: 'rgba(56,189,248,0.08)', borderRadius: '6px', border: '1px solid rgba(56,189,248,0.2)', marginBottom: '0.75rem' }}>
                  📷 {t('returns.barcodeHint')}
                </div>
              )}

              {/* Multiple results */}
              {searchResults.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
                    {t('returns.salesFound', searchResults.length)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '320px', overflowY: 'auto' }}>
                    {searchResults.map((s) => (
                      <button key={s.id} onClick={() => pickSale(s)}
                        style={{ textAlign: 'left', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', cursor: 'pointer', color: '#e2e8f0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span style={{ fontWeight: 700, color: '#a5b4fc', marginRight: '0.75rem' }}>{s.invoiceNumber || t('returns.na')}</span>
                            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{fd(s.createdAt)}</span>
                          </div>
                          <span style={{ fontWeight: 700, color: '#10b981' }}>{fc(s.total)}</span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
                          👤 {s.customerName || '—'} · {(s.items || []).slice(0, 2).map((i) => i.name).join(', ')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* History toggle */}
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowHistory(!showHistory)}>
                  📋 {t('returns.historyBtn')} ({returnHistory.length})
                </button>
              </div>
              {showHistory && returnHistory.length > 0 && (
                <div style={{ marginTop: '0.75rem', maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {returnHistory.map((r) => (
                    <div key={r.id} style={{ padding: '0.6rem 0.75rem', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600, color: '#a5b4fc' }}>{r.returnNumber}</span>
                        <span style={{ fontSize: '0.78rem', color: '#64748b', marginLeft: '0.5rem' }}>{fd(r.createdAt)}</span>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{r.customerName} · {r.originalInvoice}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: '#ef4444' }}>−${((r.totalCents || 0) / 100).toFixed(2)}</span>
                        <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.72rem' }}
                          onClick={() => printReturnReceipt(r)}>🖨️</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 2 — SELECT ITEMS + REASON */}
          {step === 2 && foundSale && (
            <div className="space-y-4">
              {/* Sale summary */}
              <div className="glass-card p-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#a5b4fc' }}>{foundSale.invoiceNumber || t('returns.na')}</div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    {foundSale.customerName || '—'} · {fd(foundSale.createdAt)} · {fc(foundSale.total)}
                  </div>
                  {!isWithinWindow && (
                    <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginTop: '0.25rem' }}>
                      ⚠️ {t('returns.outsideWindow', RETURN_LIMIT_DAYS)}
                    </div>
                  )}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={resetSearch}>
                  ← {t('returns.searchAgain')}
                </button>
              </div>

              {/* Item checklist */}
              <div className="glass-card p-4">
                <h4 style={{ fontWeight: 700, color: '#fff', marginBottom: '0.75rem' }}>
                  ✅ {t('returns.selectItems')}
                </h4>
                {returnableItems.length === 0 ? (
                  <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                    {t('returns.noReturnableItems')}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {returnableItems.map((item) => {
                      const sel = selectedItems[item.id];
                      const alreadyReturned = item.returnedQty || 0;
                      const available = item.qty - alreadyReturned;
                      const disabled = available <= 0;
                      // R-RETURNS-F1.2: use post-discount effective price so per-item
                      // display matches the totals panel (which applies discountRatio).
                      const effCents = effectivePriceCents(item);
                      const qtyForTotal = sel ? sel.qty : item.qty;
                      const itemTotal = (effCents / 100) * qtyForTotal
                        + (item.taxable ? rc((effCents / 100) * qtyForTotal * taxRate) : 0);
                      return (
                        <div key={item.id}
                          onClick={() => !disabled && toggleItem(item.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem',
                            borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.4 : 1,
                            background: sel ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${sel ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
                            transition: 'all 0.15s',
                          }}>
                          <div style={{ width: '20px', height: '20px', borderRadius: '4px', border: `2px solid ${sel ? '#6366f1' : '#475569'}`, background: sel ? '#6366f1' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {sel && <span style={{ color: '#fff', fontSize: '12px' }}>✓</span>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#e2e8f0' }}>{item.name}</div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                              {fc(item.price)} × {item.qty}
                              {item.taxable ? ` + ${t('returns.tax')}` : ''}
                              {alreadyReturned > 0 ? ` · ${alreadyReturned} ${t('returns.alreadyReturned')}` : ''}
                              {disabled ? ` · ✓ ${t('returns.fullyReturned')}` : ''}
                            </div>
                          </div>
                          {sel && available > 1 && (
                            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <button onClick={() => setItemQty(item.id, sel.qty - 1)} style={{ width: '26px', height: '26px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', cursor: 'pointer' }}>−</button>
                              <span style={{ fontWeight: 700, minWidth: '20px', textAlign: 'center', color: '#e2e8f0' }}>{sel.qty}</span>
                              <button onClick={() => setItemQty(item.id, sel.qty + 1)} style={{ width: '26px', height: '26px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', cursor: 'pointer' }}>+</button>
                            </div>
                          )}
                          <div style={{ fontWeight: 700, color: '#e2e8f0', minWidth: '70px', textAlign: 'right' }}>
                            ${itemTotal.toFixed(2)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Reason + Resolution */}
              {selectedCount > 0 && (
                <div className="glass-card p-4">
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                        {t('returns.reasonLabel')}
                      </label>
                      <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
                        <option value="defective">{t('returns.reasonDefective')}</option>
                        <option value="not_working">{t('returns.reasonNotWorking')}</option>
                        <option value="wrong_item">{t('returns.reasonWrongItem')}</option>
                        <option value="changed_mind">{t('returns.reasonChangedMind')}</option>
                        <option value="other">{t('returns.reasonOther')}</option>
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                        {t('returns.resolutionLabel')}
                      </label>
                      {/* R-RETURNS-F1.4: disable cash/card when original sale was
                          Store Credit — no physical money to refund from drawer. */}
                      {(() => {
                        const origWasStoreCredit = foundSale?.paymentMethod === 'Store Credit';
                        const resolutionDisabled = (v: string) =>
                          origWasStoreCredit && (v === 'cash' || v === 'card');
                        return (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                              {[
                                { v: 'cash',         l: t('returns.resCash') },
                                { v: 'card',         l: t('returns.resCard') },
                                { v: 'store_credit', l: t('returns.resStoreCredit') },
                                { v: 'exchange',     l: t('returns.resExchange') },
                              ].map((r) => {
                                const disabled = resolutionDisabled(r.v);
                                return (
                                  <button
                                    key={r.v}
                                    onClick={() => !disabled && setResolution(r.v)}
                                    disabled={disabled}
                                    title={disabled ? t('returns.storeCreditTitle') : undefined}
                                    style={{
                                      padding: '0.5rem', borderRadius: '8px',
                                      border: `2px solid ${resolution === r.v ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
                                      background: resolution === r.v ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                                      color: resolution === r.v ? '#a5b4fc' : '#94a3b8',
                                      cursor: disabled ? 'not-allowed' : 'pointer',
                                      opacity: disabled ? 0.4 : 1,
                                      fontSize: '0.82rem',
                                      fontWeight: resolution === r.v ? 700 : 400,
                                    }}>
                                    {r.l}
                                  </button>
                                );
                              })}
                            </div>
                            {origWasStoreCredit && (
                              <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: '0.4rem' }}>
                                ⚠️ {t('returns.storeCreditWarning')}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                      {t('returns.notesOptional')}
                    </label>
                    <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder={t('returns.notesPlaceholder')} />
                  </div>
                </div>
              )}

              {/* Return total + confirm */}
              {selectedCount > 0 && (
                <div className="glass-card p-4">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{selectedCount} {t('returns.itemsSelected')}</div>
                      {returnTax > 0 && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{t('returns.subtotalLine', returnSubtotal.toFixed(2), returnTax.toFixed(2))}</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ef4444' }}>−${returnTotal.toFixed(2)}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'right' }}>{t('returns.toRefund')}</div>
                    </div>
                  </div>
                  <button onClick={() => setShowConfirmReturn(true)} className="btn btn-primary" style={{ width: '100%', fontSize: '1rem', fontWeight: 700 }}>
                    ✅ {t('returns.processReturn', returnTotal.toFixed(2))}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* r-pkg-b4 fix S5: Confirmation modal before irreversible return */}
      <Modal open={showConfirmReturn} onClose={() => setShowConfirmReturn(false)}
        title={t('returns.confirmTitle')} size="max-w-md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.9rem', color: '#e2e8f0' }}>
            {t('returns.confirmMsg')}
          </div>
          <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.5rem' }}>
            <div style={{ fontWeight: 700, color: '#f87171', fontSize: '1.1rem' }}>−${returnTotal.toFixed(2)}</div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
              {foundSale?.invoiceNumber || t('returns.na')} · {selectedCount} {t('returns.items')} ·{' '}
              {resolution === 'cash' ? t('returns.resCashShort') :
               resolution === 'card' ? t('returns.resCardShort') :
               resolution === 'store_credit' ? t('returns.resStoreCreditShort') :
               t('returns.resExchangeShort')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setShowConfirmReturn(false)}>
              {t('returns.cancelBtn')}
            </button>
            <button className="btn btn-primary" style={{ background: '#ef4444' }}
              onClick={() => { setShowConfirmReturn(false); processReturn(); }}>
              {t('returns.confirmBtn')}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── VENDOR RETURNS ────────────────────────────────── */}
      {mainTab === 'vendor' && (
        <div className="space-y-4">
          <div className="glass-card p-5">
            <h3 style={{ fontWeight: 700, color: '#fff', marginBottom: '1rem' }}>
              📦 {t('returns.vendor.title')}
            </h3>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                {t('returns.vendor.searchLabel')}
              </label>
              <div style={{ position: 'relative' }}>
                <input className="input" value={vendorSearch} onChange={(e) => { setVendorSearch(e.target.value); setVendorItem(null); }}
                  placeholder={t('returns.vendor.searchPlaceholder')} autoFocus />
                {vendorResults.length > 0 && !vendorItem && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '0.5rem', marginTop: '0.25rem', overflow: 'hidden' }}>
                    {vendorResults.map((i) => (
                      <button key={i.id} onClick={() => { setVendorItem(i); setVendorSearch(i.name); }}
                        style={{ width: '100%', textAlign: 'left', padding: '0.625rem 0.875rem', background: 'transparent', border: 'none', color: '#e2e8f0', cursor: 'pointer', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(102,126,234,0.15)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                        <span>{i.name} {i.supplier ? `· ${i.supplier}` : ''}</span>
                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>Qty: {i.qty}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {vendorItem && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{vendorItem.name}</div>
                  <div style={{ color: '#94a3b8' }}>{t('returns.vendor.supplier')} {vendorItem.supplier || '—'} · {t('returns.vendor.cost')} ${((vendorItem.cost || 0) / 100).toFixed(2)} · {t('returns.vendor.stock')} {vendorItem.qty}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>{t('returns.vendor.qty')}</label>
                    <input type="number" className="input" min={1} max={vendorItem.qty} value={vendorQty} onChange={(e) => setVendorQty(Math.max(1, Math.min(parseInt(e.target.value) || 1, vendorItem.qty)))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>{t('returns.vendor.reason')}</label>
                    <select className="select" value={vendorReason} onChange={(e) => setVendorReason(e.target.value)}>
                      <option value="defective">{t('returns.reasonDefective')}</option>
                      <option value="overstock">{t('returns.vendor.reasonOverstock')}</option>
                      <option value="wrong_item">{t('returns.reasonWrongItem')}</option>
                      <option value="warranty">{t('returns.vendor.reasonWarranty')}</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>{t('returns.resolutionLabel')}</label>
                    <select className="select" value={vendorResolution} onChange={(e) => setVendorResolution(e.target.value)}>
                      <option value="credit">{t('returns.vendor.resCredit')}</option>
                      <option value="replacement">{t('returns.vendor.resReplacement')}</option>
                      <option value="refund">{t('returns.vendor.resRefund')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>{t('returns.notesLabel')}</label>
                  <input className="input" value={vendorNotes} onChange={(e) => setVendorNotes(e.target.value)}
                    placeholder={t('returns.vendor.notesPlaceholder')} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.5rem' }}>
                  <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{t('returns.vendor.valueToReturn')}</span>
                  <span style={{ fontWeight: 700, color: '#f87171' }}>${(((vendorItem.cost || 0) / 100) * vendorQty).toFixed(2)} ({vendorQty} {t('returns.vendor.units')})</span>
                </div>
                <button onClick={processVendorReturn} className="btn btn-primary" style={{ width: '100%' }}>
                  📦 {t('returns.vendor.recordBtn')}
                </button>
              </div>
            )}
          </div>

          {/* Vendor history */}
          {vendorHistory.length > 0 && (
            <div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowVendorHistory(!showVendorHistory)}>
                📋 {t('returns.vendor.historyBtn')} ({vendorHistory.length})
              </button>
              {showVendorHistory && (
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '300px', overflowY: 'auto' }}>
                  {vendorHistory.map((r) => (
                    <div key={r.id} style={{ padding: '0.625rem 0.875rem', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600, color: '#a5b4fc' }}>{r.returnNumber}</span>
                        <span style={{ fontSize: '0.78rem', color: '#64748b', marginLeft: '0.5rem' }}>{fd(r.createdAt)}</span>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{r.productName} · {r.supplier} · {r.qty} {t('returns.vendor.units')}</div>
                      </div>
                      <span style={{ fontWeight: 700, color: '#f87171' }}>${((r.totalValueCents || 0) / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* R-APPROVAL-GATE-RETURNS-V1 */}
      {approvalGate.modal}
    </div>
  );
}
