// ============================================================
// CellHub Pro — Layaway Module (full rewrite)
// Matches original feature set + correct math + TypeScript
//
// MATH (all in dollars during form, cents in Firestore):
//   grandTotal = subtotal + (taxable ? subtotal * taxRate : 0)
//   balance    = grandTotal - depositPaid
//   On collect: newPaid += payment; balance = max(0, grandTotal - newPaid)
//   balance === 0 → status = 'completed'
//
// FEATURES:
//   - Inventory search live with dropdown (SKU, IMEI, name)
//   - Manual entry toggle (no inventory link)
//   - IMEI / Serial # field
//   - Category selector (auto from inventory or manual)
//   - Tax toggle with real-time totals preview
//   - Employee field
//   - Pickup date with days-left / overdue badge
//   - Ticket number: LAY-XXXXXX
//   - Auto-print ticket on create
//   - Print button on every card (active + completed)
//   - Edit layaway (sync deposit change to linked sale)
//   - Cancel with keep/refund deposit choice
//   - Collect balance via DepositModal → cart → auto-complete
//   - Inventory reservation on create/cancel/complete
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { matchesSearchPhones } from '@/utils/search';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import { persist, remove } from '@/services/persist';
import { useLanReadOnlyMode } from '@/hooks/useLanReadOnly';
import { usePrint } from '@/hooks/usePrint';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import DepositModal from '@/components/DepositModal';
import { calcDepositTotals, reverseTaxFromPayment, forwardTaxFromBase } from '@/utils/depositTax';
import { AutocompleteInput, ConfirmDialog } from '@/components/ui';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import CustomerSearchHeader from '@/components/shared/CustomerSearchHeader';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import { emitLayawayPaymentStarted } from '@/services/intelligence/liveContext/liveContextEvents';
import type { AutocompleteOption } from '@/hooks/useAutocomplete';
import type { Layaway, CartItem, Customer, InventoryItem, Sale } from '@/store/types';
import CancelLayawayModal from './CancelLayawayModal';
import { useApprovalGate } from '@/hooks/useApprovalGate';
import { useGlobalCart } from '@/hooks/useGlobalCart';
import {
  calculateLayawayTotals,
  normalizeLayawayPayments,
} from '@/services/layaway/payments';
// R-PAYMENT-TRACE-RECEIPTS-LAYAWAY-SPECIAL-ORDER-V1: partial-payment audit trail.
import {
  buildPaymentTrace,
  renderPaymentTraceHtml,
  classifyHistoryRows,
  paymentTraceI18n,
} from '@/services/receipts/paymentTrace';
import LayawayPaymentModal from './LayawayPaymentModal';
import { setIntelligenceContext, clearEntityContext } from '@/services/intelligence/context/intelligenceContext';
import { emitLayawayAmbient } from '@/services/intelligence/ambient/ambientAwarenessService';
import { escHtml } from '@/utils/escHtml';
// R-RECEIPT-UNIFY-LAYAWAY-V1: reuse the POS payment-receipt barcode renderer.
// (Google Reviews QR intentionally omitted on layaway — see printLayawayTicket.)
import { renderBarcodeSvg, getReceiptBarcodeHeight } from '@/modules/pos/ReceiptModal';

const STATUS_FILTERS = ['active', 'overdue', 'completed', 'cancelled'] as const;

function generateTicket(): string {
  return 'LAY-' + String(Date.now()).slice(-6);
}

export default function LayawayModule() {
  const {
    state: { layaways, customers, inventory, settings, currentEmployee, employees, cart, sales, lang, globalSearchTerm, currentStoreId },
    setLayaways, setCustomers, setInventory, setCart, setSales, dispatch,
  } = useApp();
  // R-GLOBAL-CART-UNIFY-V1: unified cart writes (stay in module + auto-open drawer).
  const { commitCart, attachCustomer } = useGlobalCart();

  // R-APPROVAL-PIN-V1 F3A: gate cancellations behind manager approval
  // when settings.approvalsEnabled and the current employee's role / per-
  // employee permissions require it. The hook owns the modal lifecycle.
  const approvalGate = useApprovalGate({
    employees,
    settings,
    attemptedByName: currentEmployee?.name,
  });

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const { printHtml } = usePrint();
  const { t, locale } = useTranslation();
  // SECONDARY-UI-LOCK-V1: block layaway create + payments on a read-only Secondary.
  const lanReadOnly = useLanReadOnlyMode();

  const [showImeiWarning, setShowImeiWarning]   = useState(false);
  const skipImeiCheckRef                        = useRef(false);
  const [search, setSearch]               = useState(globalSearchTerm || '');
  const [statusFilter, setStatusFilter]   = useState('active');
  const [visibleCount, setVisibleCount]   = useState(50);
  const [showForm, setShowForm]           = useState(false);
  const [editLayaway, setEditLayaway]     = useState<Layaway | null>(null);
  const [cancelTarget, setCancelTarget]   = useState<Layaway | null>(null);
  // R-APPROVAL-PIN-V1 F3A fix #1: parent-owned spinner for CancelLayawayModal
  // so denial paths can reset the busy state without remounting the modal
  // (which would wipe the cashier's selected disposition/note). True only
  // while the approval flow is in flight.
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Layaway | null>(null);
  const [depositTarget, setDepositTarget] = useState<Layaway | null>(null);
  const [isSaving, setIsSaving]           = useState(false);
  const [isDeleting, setIsDeleting]       = useState(false);

  // ── Stale-closure guards: ref-mirrors of layaways/inventory so back-to-back
  // setLayaways/setInventory calls don't pisarse mutually within this module.
  const layawaysRef = useRef(layaways);
  useEffect(() => { layawaysRef.current = layaways; }, [layaways]);
  const customersRef = useRef(customers);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  const inventoryRef = useRef(inventory);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  const salesRef = useRef(sales);
  useEffect(() => { salesRef.current = sales; }, [sales]);
  const cartRef = useRef(cart);
  useEffect(() => { cartRef.current = cart; }, [cart]);

  // R-INTELLIGENCE-RUNTIME-NAVIGATION-V1: open a specific layaway from
  // Intelligence action buttons. AppShell navigates here first, then defers
  // 80ms before firing this event so this listener is attached.
  useEffect(() => {
    const handler = (e: Event) => {
      // INTEL-ACTION-CONTEXT-AND-NAV-RACE-FIX-V1: ack the AppShell relay —
      // preventDefault on the cancelable event stops its bounded retry loop.
      e.preventDefault();
      const { layawayId } = (e as CustomEvent<{ layawayId?: string }>).detail ?? {};
      if (!layawayId) return;
      const lay = layawaysRef.current.find((l) => l.id === layawayId);
      // R-INTELLIGENCE-ACTION-RELIABILITY-V2: not found → safe no-op + toast.
      if (!lay) {
        console.warn('[cellhub] _intel-open-layaway: not found', layawayId);
        toast(t('intel.entityNotFound'), 'error');
        return;
      }
      // R-INTELLIGENCE-OPEN-ENTITY-RUNTIME-POLISH-V1: the inline edit form renders the
      // parent `form` state (populated by openEdit with the tax back-out math), NOT
      // editLayaway directly. setEditLayaway alone left `form` stale → blank fields.
      // Route through openEdit (same path as the card Edit button).
      openEdit(lay);
    };
    window.addEventListener('cellhub:_intel-open-layaway', handler);
    return () => window.removeEventListener('cellhub:_intel-open-layaway', handler);
  }, [t]);

  // R-INTELLIGENCE-CONTEXT-AWARE-V1: broadcast active layaway so Intelligence
  // surfaces contextual recommendations for this specific ticket.
  // R-INTELLIGENCE-AMBIENT-AWARENESS-V1: emit passive ambient hint on open;
  // clear entity context on modal close.
  useEffect(() => {
    if (editLayaway) {
      setIntelligenceContext({
        activeModule: 'layaways',
        activeLayawayId: editLayaway.id,
        activeCustomerId: (editLayaway as any).customerId ?? undefined,
      });
      emitLayawayAmbient(editLayaway);
    } else {
      clearEntityContext();
    }
  }, [editLayaway]);

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taxRate    = settings.taxRate ?? 0.0925;
  const taxRatePct = (taxRate * 100).toFixed(2);

  const emptyForm = () => ({
    firstName: '', lastName: '', customerPhone: '',
    manualEntry: false, inventoryId: '', itemDescription: '',
    itemSku: '', imei: '', itemCategory: 'Phones',
    totalPrice: '', deposit: '', taxable: false,
    pickupDate: '', notes: '',
    employeeName: currentEmployee?.name || '',
  });

  const [form, setForm]                         = useState(emptyForm());

  // ── Autocomplete options ───────────────────────────────
  const customerNameOptions = useMemo(() =>
    customers.map((c) => ({ value: c.name, label: c.name, sublabel: c.phone, data: c })),
    [customers],
  );
  const firstNameOptions = useMemo(() =>
    customers.map((c) => {
      const p = c.name.trim().split(' ');
      return { value: p[0] || '', label: p[0] || '', sublabel: c.phone, data: c };
    }).filter((o) => o.value.length > 0),
    [customers],
  );
  const lastNameOptions = useMemo(() =>
    customers
      .filter((c) => !form.firstName || c.name.toLowerCase().startsWith(form.firstName.toLowerCase()))
      .map((c) => {
        const p = c.name.trim().split(' ');
        const last = p.slice(1).join(' ');
        return { value: last, label: last, sublabel: c.phone, data: c };
      })
      .filter((o, i, arr) => o.value.length > 0 && arr.findIndex((x) => x.label === o.label) === i),
    [customers, form.firstName],
  );
  const phoneOptions = useMemo(() =>
    customers.map((c) => ({ value: c.phone || '', label: c.phone || '', sublabel: c.name, data: c }))
      .filter((o) => o.value.length > 0),
    [customers],
  );
  const phoneMatch = useMemo(() => {
    const digits = normalizePhone(form.customerPhone || '');
    if (digits.length < 7) return null;
    return customers.find((c) => normalizePhone(c.phone) === digits) || null;
  }, [form.customerPhone, customers]);

  const [itemSearch, setItemSearch]             = useState('');
  const [itemResults, setItemResults]           = useState<InventoryItem[]>([]);
  const [showItemDropdown, setShowItemDropdown] = useState(false);

  const availableCategories = useMemo(() => {
    const seen = new Map<string, string>();  // lowercase → original casing
    for (const cat of ['Phones', 'Accessories', 'Tablets', 'Other']) {
      seen.set(cat.toLowerCase(), cat);
    }
    for (const i of inventory) {
      if (i.category && !seen.has(i.category.toLowerCase())) {
        seen.set(i.category.toLowerCase(), i.category);
      }
    }
    return Array.from(seen.values()).sort();
  }, [inventory]);

  useEffect(() => {
    if (!itemSearch.trim() || form.manualEntry) { setItemResults([]); setShowItemDropdown(false); return; }
    const q = itemSearch.toLowerCase();
    const results = inventory
      .filter((i) => i.qty > 0 && matchesSearch(q, i.name, i.sku, i.imei, i.barcode))
      .slice(0, 8);
    setItemResults(results);
    setShowItemDropdown(results.length > 0);
  }, [itemSearch, inventory, form.manualEntry]);

  const selectInventoryItem = (item: InventoryItem) => {
    setForm((f) => ({
      ...f,
      inventoryId: item.id,
      itemDescription: item.name,
      itemSku: item.sku || '',
      imei: item.imei || '',
      itemCategory: item.category || f.itemCategory,
      totalPrice: item.price > 0 ? (item.price / 100).toFixed(2) : f.totalPrice,
    }));
    setItemSearch(item.name);
    setItemResults([]);
    setShowItemDropdown(false);
  };

  // Math — uses depositTax helper for single source of truth.
  // Form inputs are dollars; helper works in cents.
  const subtotalCents = Math.round((parseFloat(form.totalPrice) || 0) * 100);
  const depositCentsForm = Math.round((parseFloat(form.deposit) || 0) * 100);
  const _totals = calcDepositTotals(subtotalCents, depositCentsForm, taxRate, form.taxable);
  const subtotal   = _totals.subtotalCents / 100;
  const taxAmt     = _totals.taxCents / 100;
  const grandTotal = _totals.totalWithTaxCents / 100;
  const depositAmt = depositCentsForm / 100;
  const balanceAmt = _totals.balanceCents / 100;

  const getDaysInfo = (dueDate?: string): { overdue: boolean; days: number } | null => {
    if (!dueDate) return null;
    const diff = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000);
    return { overdue: diff < 0, days: Math.abs(diff) };
  };

  const statusLabel = (l: Layaway): string => {
    if (l.status === 'completed') return t('layaway.statusCompleted');
    if (l.status === 'cancelled') return t('layaway.statusCancelled');
    const d = getDaysInfo(l.dueDate);
    if (!d) return t('layaway.statusActive');
    if (d.overdue) return t('layaway.statusOverdue', d.days);
    if (d.days === 0) return t('layaway.statusToday');
    return t('layaway.statusDaysLeft', d.days);
  };

  const statusColor = (l: Layaway): string => {
    if (l.status === 'completed') return '#10b981';
    if (l.status === 'cancelled') return '#6b7280';
    const d = getDaysInfo(l.dueDate);
    if (d?.overdue) return '#ef4444';
    if (d && d.days <= 2) return '#f59e0b';
    return '#3b82f6';
  };

  const filtered = useMemo(() => {
    return layaways
      .filter((l) => {
        const normalizedStatus = String(l.status || '').toLowerCase();
        const d = getDaysInfo(l.dueDate);
        const isOverdue = normalizedStatus === 'active' && !!d?.overdue;
        if (statusFilter === 'active')    return normalizedStatus === 'active' && !isOverdue;
        if (statusFilter === 'overdue')   return isOverdue;
        if (statusFilter === 'completed') return normalizedStatus === 'completed';
        if (statusFilter === 'cancelled') return normalizedStatus === 'cancelled' || normalizedStatus === 'forfeited';
        return true;
      })
      .filter((l) => {
        const r = l as any;
        // R-SEARCH-NORMALIZE-V1: phone-aware match; also fold every line
        // item's name/sku/imei/barcode into the searchable surface so
        // typing an IMEI or SKU finds the layaway containing that item
        // (matches the spec's layaway acceptance criteria).
        const itemFields: string[] = [];
        for (const it of (l.items || [])) {
          if (it?.name) itemFields.push(it.name);
          if ((it as any)?.sku) itemFields.push(String((it as any).sku));
          if ((it as any)?.imei) itemFields.push(String((it as any).imei));
          if ((it as any)?.barcode) itemFields.push(String((it as any).barcode));
        }
        return matchesSearchPhones(
          search,
          [l.customerPhone],
          l.customerName,
          r.itemDescription || l.items?.[0]?.name || '',
          r.ticketNumber || '',
          l.id,
          ...itemFields,
        );
      })
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [layaways, statusFilter, search]);

  const activeCount  = layaways.filter((l) => l.status === 'active').length;
  const overdueCount = layaways.filter((l) => {
    const d = getDaysInfo(l.dueDate);
    return l.status === 'active' && !!d?.overdue;
  }).length;
  const completedRevenue = layaways
    .filter((l) => l.status === 'completed')
    .reduce((s, l) => s + (l.totalPrice || 0), 0);

  const openNew = () => {
    setEditLayaway(null);
    setForm(emptyForm());
    setItemSearch('');
    setShowForm(true);
  };

  const openEdit = (l: Layaway) => {
    const r = l as any;
    setEditLayaway(l);
    // R-OPERATOR-ACTIVITY-WIRING: notify FloatingOperatorBubble that a layaway was opened
    try {
      window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
        detail: { type: 'layaway.opened', payload: { layawayId: l.id } },
      }));
    } catch { /* env without CustomEvent — silent */ }
    setForm({
      firstName:       r.firstName    || l.customerName?.split(' ')[0] || '',
      lastName:        r.lastName     || l.customerName?.split(' ').slice(1).join(' ') || '',
      customerPhone:   l.customerPhone || '',
      manualEntry:     r.manualEntry  || false,
      inventoryId:     r.inventoryId  || l.items?.[0]?.inventoryId || '',
      itemDescription: r.itemDescription || l.items?.[0]?.name || '',
      itemSku:         r.itemSku      || '',
      imei:            r.imei         || '',
      itemCategory:    r.itemCategory || 'Phones',
      // R-LAYAWAY-MATH-INTEGRITY-AUDIT: Layaway.totalPrice is tax-INCLUSIVE
      // (per write at lines 461/522/573). The form's totalPrice input is
      // pre-tax (calcDepositTotals treats it as base). Load the pre-tax
      // dollar string by backing out the stored taxAmount split so the
      // re-edit doesn't apply tax twice. Falls back to totalPrice when no
      // tax split is present (legacy non-taxable rows).
      totalPrice:      String(Math.max(0, (l.totalPrice || 0) - ((l as any).taxAmount || 0)) / 100),
      deposit:         String((l.paidAmount  || 0) / 100),
      taxable:         r.taxable      || false,
      pickupDate:      l.dueDate      || '',
      notes:           l.notes        || '',
      employeeName:    l.employeeName || '',
    });
    setItemSearch(r.itemDescription || l.items?.[0]?.name || '');
    setShowForm(true);
  };

  // r-new-5 port: invariant "one layawayId has at most one cart item".
  // Mirrors consolidateCartForRepair: forward-tax existing items, sum with
  // `additionalCents` (tax-inclusive), reverse-tax the combined total to a
  // single pre-tax cart entry, and replace all previous items for this layawayId.
  const consolidateCartForLayaway = useCallback((params: {
    layawayId: string;
    additionalCents: number;
    deviceLabel: string;
    ticketNumber?: string;
    isTaxable: boolean;
    // R-LAYAWAY-DEPOSIT-CART-LINE-CONTEXT-V1: display-only, no effect on balance logic
    displayContext?: {
      customerName?: string;
      itemName?: string;
      currentBalanceCents?: number;
    };
  }): { combinedCents: number } => {
    const { layawayId, additionalCents, deviceLabel, ticketNumber, isTaxable, displayContext } = params;
    const lTaxRate = settings.taxRate ?? 0.0925;

    const existingItems = cartRef.current.filter((c) => c.layawayId === layawayId);
    let combinedCents = additionalCents;
    for (const existing of existingItems) {
      const existingBase = (existing.price || 0) * (existing.qty || 1);
      const existingFwd = forwardTaxFromBase(existingBase, lTaxRate, !!existing.taxable);
      combinedCents += existingFwd.totalCents;
    }

    const split = reverseTaxFromPayment(combinedCents, lTaxRate, isTaxable);
    // R-LAYAWAY-DEPOSIT-CART-LINE-CONTEXT-V1: estimated balance after this payment,
    // display-only — does not touch the actual layaway record.
    const estBalanceCents = displayContext?.currentBalanceCents !== undefined
      ? Math.max(displayContext.currentBalanceCents - additionalCents, 0)
      : undefined;
    const consolidatedItem: CartItem = {
      id: generateId(),
      name: `${deviceLabel} — ${t('layaway.cartItemName')}`,
      category: 'service',
      price: split.baseCents,
      qty: 1,
      taxable: isTaxable,
      cbeEligible: false,
      layawayId,
      notes: ticketNumber || layawayId.slice(-6).toUpperCase(),
      layawayCustomerName: displayContext?.customerName,
      layawayItemName: displayContext?.itemName,
      layawayCurrentBalanceCents: displayContext?.currentBalanceCents,
      layawayEstimatedBalanceCents: estBalanceCents,
    };

    const nextCart = [
      ...cartRef.current.filter((c) => c.layawayId !== layawayId),
      consolidatedItem,
    ];
    cartRef.current = nextCart;
    // R-GLOBAL-CART-UNIFY-V1: write + auto-open drawer via the shared hook
    // (tax math above unchanged). Customer attach stays at each call site.
    commitCart(nextCart, { openDrawer: true });

    return { combinedCents };
  }, [settings.taxRate, t, commitCart]);

  const handleSave = useCallback(() => {
    // Round 14: busy-state guard — short-circuit double-click; setIsSaving toggled
    // around the mutation phase only (after validation returns).
    if (isSaving) return;
    const fName = form.firstName.trim();
    const lName = form.lastName.trim();
    if (!fName) { toast(t('layaway.errorFirstName'), 'error'); return; }
    if (!form.itemDescription.trim()) { toast(t('layaway.errorItemDesc'), 'error'); return; }
    if (!form.totalPrice || subtotal <= 0) { toast(t('layaway.errorTotalPrice'), 'error'); return; }
    if (!form.deposit || depositAmt <= 0) { toast(t('layaway.errorDeposit'), 'error'); return; }
    const phoneLen = (form.customerPhone || '').replace(/\D/g, '').length;
    if (phoneLen > 0 && phoneLen !== 10) { toast(t('layaway.errorPhone'), 'error'); return; }
    if (depositAmt > grandTotal + 0.001) { toast(t('layaway.errorDepositExceedsTotal'), 'error'); return; }

    // IMEI warning for phone layaways — uses ConfirmDialog instead of confirm()
    const layawayCat = (form.itemCategory || '').toLowerCase();
    if ((layawayCat === 'phones' || layawayCat === 'phone') && !form.imei.trim() && !skipImeiCheckRef.current) {
      setShowImeiWarning(true);
      return;
    }
    skipImeiCheckRef.current = false;

    setIsSaving(true);
    // Round 15 C3: wrap the mutation phase in try/catch so a synchronous throw
    // from persist.* / setState / consolidateCartForLayaway never leaves the
    // button stuck at "Guardando...". Happy-path unlocks are still explicit
    // (edit returns, create unlocks inside the print setTimeout — H1).
    try {
    const customerName  = `${fName} ${lName}`.trim();
    // Use helper values directly — avoid cents→dollars→cents round-trip rounding risk
    const totalCents    = _totals.totalWithTaxCents;
    const depositCents  = depositCentsForm;
    const taxCents      = _totals.taxCents;
    const balanceCents  = _totals.balanceCents;

    // Auto-create customer — dedup by phone. Capture final customerId so we
    // can write it to the layaway entity and dispatch SET_PENDING_POS_CUSTOMER.
    let finalCustomerId: string | undefined;
    if (form.customerPhone) {
      const phone    = normalizePhone(form.customerPhone);
      const existing = customers.find((c) => normalizePhone(c.phone) === phone);
      if (existing) {
        finalCustomerId = existing.id;
        if (existing.name.toLowerCase() !== customerName.toLowerCase()) {
          toast(t('layaway.existingCustomer', existing.name), 'info');
        }
      } else if (customerName) {
        // R-PHONE-SANITIZE-SWEEP: normalize at write boundary so customer.phone
        // and the phones[] array are 10-digit / empty (never raw "(805)…").
        const normPhone = normalizePhone(form.customerPhone || '');
        const newCust: Customer = {
          id: generateId(), firstName: fName, lastName: lName, name: customerName, phone: normPhone,
          phones: normPhone ? [normPhone] : [], email: '', loyaltyPoints: 0, storeCredit: 0,
          customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          notes: '', communicationConsent: false, createdAt: new Date().toISOString(),
        };
        const nextCustomers = [...customersRef.current, newCust];
        customersRef.current = nextCustomers;
        setCustomers(nextCustomers);
        persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
        finalCustomerId = newCust.id;
      }
    }

    if (editLayaway) {
      const r = editLayaway as any;
      // Swap inventory reservation atomically (single setInventory call to avoid race)
      if (r.inventoryId !== form.inventoryId) {
        const nextInv = inventoryRef.current.map((i) => {
          if (i.id === r.inventoryId && r.inventoryId) return { ...i, qty: i.qty + 1 };
          if (i.id === form.inventoryId && form.inventoryId) return { ...i, qty: Math.max(0, i.qty - 1) };
          return i;
        });
        // Persist affected items BEFORE updating ref (so we find the updated objects in nextInv)
        const oldInvItem = r.inventoryId ? nextInv.find((i: any) => i.id === r.inventoryId) : null;
        const newInvItem = form.inventoryId ? nextInv.find((i: any) => i.id === form.inventoryId) : null;
        inventoryRef.current = nextInv;
        setInventory(nextInv);
        if (oldInvItem) persist.inventory(oldInvItem.id, oldInvItem as unknown as Record<string, unknown>);
        if (newInvItem) persist.inventory(newInvItem.id, newInvItem as unknown as Record<string, unknown>);
      }

      // R-LAYAWAY-SAFE-STATE-REPAIR-V1: the edit form's "deposit" field is the
      // legacy single-deposit value and must NEVER overwrite the reconciled
      // payment total. payments[] is the source of truth — preserve it and the
      // derived paid total, recomputing balance only against the (possibly
      // edited) grand total. Prevents an info-only edit from collapsing
      // multi-payment history down to the form's deposit value.
      const preservedPaidCents = calculateLayawayTotals(editLayaway).totalPaidCents;
      const preservedBalanceCents = Math.max(0, totalCents - preservedPaidCents);
      const updated: any = {
        ...editLayaway,
        // R-PHONE-SANITIZE-SWEEP: 10-digit form on the layaway record itself.
        firstName: fName, lastName: lName, customerName, customerPhone: normalizePhone(form.customerPhone || ''),
        customerId: finalCustomerId || (editLayaway as any).customerId,
        inventoryId: form.inventoryId || undefined,
        itemDescription: form.itemDescription, itemSku: form.itemSku, imei: form.imei,
        itemCategory: form.itemCategory, manualEntry: form.manualEntry,
        items: [{ id: editLayaway.items?.[0]?.id || generateId(), inventoryId: form.inventoryId || undefined, name: form.itemDescription, price: Math.round(subtotal * 100), qty: 1 }],
        totalPrice: totalCents, taxAmount: taxCents, taxable: form.taxable,
        taxRate: form.taxable ? taxRate : 0,
        paidAmount: preservedPaidCents, balance: preservedBalanceCents,
        dueDate: form.pickupDate || undefined, notes: form.notes,
        employeeName: form.employeeName, updatedAt: new Date().toISOString(),
      };
      const nextLay = layawaysRef.current.map((l) => l.id === editLayaway.id ? updated : l);
      layawaysRef.current = nextLay;
      setLayaways(nextLay);
      persist.layaway(updated.id, updated as unknown as Record<string, unknown>);

      // Sync deposit change to linked sale item
      const oldDepositCents = editLayaway.paidAmount || 0;
      if (depositCents !== oldDepositCents && setSales) {
        // Round 13 fix: persist each modified sale to avoid data loss on reload
        const modifiedSales: typeof sales = [];
        setSales(sales.map((sale) => {
          const hasItem = (sale.items || []).some((it) => (it as any).layawayId === editLayaway.id);
          if (!hasItem) return sale;
          const updatedItems = sale.items.map((it) =>
            (it as any).layawayId !== editLayaway.id ? it : { ...it, price: depositCents }
          );
          const newTotal = updatedItems.reduce((s, it) => s + it.price * it.qty, 0);
          const nextSale = { ...sale, items: updatedItems, total: newTotal };
          modifiedSales.push(nextSale);
          return nextSale;
        }));
        for (const ms of modifiedSales) {
          persist.sale(ms.id, ms as unknown as Record<string, unknown>);
        }
      }

      toast(t('layaway.updated'), 'success');
      setIsSaving(false);
      setShowForm(false); setEditLayaway(null); return;
    }

    // CREATE
    const ticket = generateTicket();
    const newLayaway: any = {
      id: generateId(), ticketNumber: ticket,
      // Round 16 H-v4b: multi-store — stamp storeId at creation so belongs(storeId)
      // filters + R15b H2 fresh re-read guards don't orphan records across stores.
      storeId: currentStoreId,
      // R-PHONE-SANITIZE-SWEEP: same normalization on the create path.
      firstName: fName, lastName: lName, customerName, customerPhone: normalizePhone(form.customerPhone || ''),
      customerId: finalCustomerId || undefined,
      inventoryId: form.inventoryId || undefined,
      itemDescription: form.itemDescription, itemSku: form.itemSku, imei: form.imei,
      itemCategory: form.itemCategory, manualEntry: form.manualEntry,
      items: [{ id: generateId(), inventoryId: form.inventoryId || undefined, name: form.itemDescription, price: Math.round(subtotal * 100), qty: 1 }],
      totalPrice: totalCents, taxAmount: taxCents, taxable: form.taxable,
      taxRate: form.taxable ? taxRate : 0,
      // r-deposit-integrity-1 P1: paidAmount starts at 0 — the deposit only
      // exists in the cart until POS checkout confirms. Inventory reservation
      // below is still correct (the item IS reserved for this customer),
      // but no money has changed hands yet until the sale is finalized.
      // POSModule.handleCompleteSale reconciles paidAmount + balance after
      // the sale is persisted.
      paidAmount: 0, balance: totalCents,
      // Round L-QF1: freeze the deposit intent on the record so the
      // auto-print receipt reads the agreed deposit. paidAmount stays 0
      // (POS reconciles on checkout); depositAmount is the "agreement"
      // value and is never mutated by POS. Post-build Agreement/Payment
      // split round will formalize this.
      depositAmount: depositCents,
      status: 'active', notes: form.notes,
      employeeName: form.employeeName || currentEmployee?.name || '',
      employeeId: currentEmployee?.id,
      dueDate: form.pickupDate || undefined,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };

    // Reserve inventory item
    if (form.inventoryId) {
      const nextInv = inventoryRef.current.map((i) => i.id === form.inventoryId ? { ...i, qty: Math.max(0, i.qty - 1) } : i);
      inventoryRef.current = nextInv;
      setInventory(nextInv);
    }
    const nextLayCreate = [newLayaway, ...layawaysRef.current];
    layawaysRef.current = nextLayCreate;
    setLayaways(nextLayCreate);
    persist.layaway(newLayaway.id, newLayaway as unknown as Record<string, unknown>);

    // Add deposit to cart via consolidation helper (invariant: 1 cart item per layaway).
    if (depositCents > 0) {
      consolidateCartForLayaway({
        layawayId: newLayaway.id,
        additionalCents: depositCents,
        deviceLabel: form.itemDescription,
        ticketNumber: ticket,
        isTaxable: form.taxable,
        displayContext: {
          customerName,
          itemName: form.itemDescription,
          currentBalanceCents: totalCents,
        },
      });
      if (finalCustomerId) {
        attachCustomer(finalCustomerId);
      }
      toast(t('layaway.depositAddedToCart'), 'info');
    }

    // Round 15 H1: defer the isSaving unlock until print fires so a fast
    // double-click on Save can't queue a second CREATE in the 300ms window.
    setTimeout(() => { printLayawayTicket(newLayaway); setIsSaving(false); }, 300);
    toast(t('layaway.created'), 'success');
    setShowForm(false); setForm(emptyForm());
    } catch (err) {
      setIsSaving(false);
      toast(t('layaway.errorSaving'), 'error');
      console.error(err);
    }
  }, [form, subtotal, taxAmt, grandTotal, depositAmt, balanceAmt, editLayaway,
      layaways, customers, inventory, settings, currentEmployee, sales, currentStoreId,
      t, taxRate, isSaving, setLayaways, setCustomers, setInventory, setCart, setSales, toast,
      consolidateCartForLayaway, dispatch]);

  const handleCollectConfirm = useCallback((l: Layaway, paymentDollars: number) => {
    const paymentCents = Math.round(paymentDollars * 100);
    const isTaxable = !!(l as any).taxable;
    const deviceLabel = (l as any).itemDescription || l.items?.[0]?.name || '';
    const ticketNumber = (l as any).ticketNumber || l.id.slice(-6).toUpperCase();

    consolidateCartForLayaway({
      layawayId: l.id,
      additionalCents: paymentCents,
      deviceLabel,
      ticketNumber,
      isTaxable,
      displayContext: {
        customerName: l.customerName,
        itemName: deviceLabel,
        currentBalanceCents: l.balance,
      },
    });

    // Propagate customer to POS (customerId first, phone-tail fallback).
    let customerId = (l as any).customerId as string | undefined;
    if (!customerId && l.customerPhone) {
      const phoneTail = l.customerPhone.replace(/\D/g, '').slice(-10);
      if (phoneTail) {
        const matched = customersRef.current.find((c) => {
          const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
          return cPhone && cPhone === phoneTail;
        });
        if (matched) customerId = matched.id;
      }
    }
    if (customerId) {
      attachCustomer(customerId);
    }

    // r-pkg-b1: DO NOT update layaway paidAmount/balance/status here.
    // The POS checkout handler (POSModule.tsx §4d) reads the layaway from
    // state and applies deduction + persist when the sale completes.
    // Premature persist here caused double-deduction and false revenue
    // if the user cancelled checkout. Also, marking status='completed'
    // before payment is collected is incorrect — the layaway isn't
    // complete until the money is actually in the drawer.
    emitLayawayPaymentStarted(l.id, (l as any).customerId);
    setDepositTarget(null);
    toast(t('layaway.paymentAddedToCart', formatCurrency(paymentCents)), 'info');
  }, [t, toast, consolidateCartForLayaway, dispatch]);

  // LAYAWAY-PAYMENT-CART-SEMANTICS-AND-MULTIPAGE-PRINT-FIX-V1: the
  // R-LAYAWAY-DIRECT-PAYMENT-V1 handleDirectPayment bypass (immediate
  // payment write + Sale creation with no cart step) was REMOVED. All
  // collect-balance payments now route through handleCollectConfirm above
  // → consolidateCartForLayaway → POS §4d, which owns reconcile, Sale
  // creation, and receipt printing. Single transaction-creation path.

  // r-new-4 port: cancel with deposit disposition (store_credit / cash / forfeit).
  // R9-1: cash refund marks original sale(s) as refunded so Reports excludes them
  // from Gross/Cash/Profit. A voided REFUND-* audit sale is also created.
  const handleCancel = useCallback(async (l: Layaway, choice: {
    method: 'store_credit' | 'cash' | 'forfeit';
    note: string;
  }) => {
    // Round 14: block invalid transitions BEFORE any mutation or side effect.
    // Round 15 C2/M1: include 'forfeited' terminal state AND close the modal on
    // early-return so CancelLayawayModal's isConfirming unlocks (otherwise the
    // child modal stays frozen at "Confirmando...").
    const normalizedStatus = String(l.status || '').toLowerCase();
    if (normalizedStatus === 'completed') {
      toast(t('layaway.errorCancelCompleted'), 'error');
      setCancelTarget(null);
      return;
    }
    if (normalizedStatus === 'cancelled' || normalizedStatus === 'forfeited') {
      toast(t('layaway.errorAlreadyCancelled'), 'error');
      setCancelTarget(null);
      return;
    }
    // Round 15b H2: re-read from ref in case a concurrent POS checkout just
    // marked this layaway completed. Abort rather than resetting paid/balance.
    // Round 16: also early-return if the layaway no longer exists in the ref
    // (deleted in another tab/station mid-flow) — previously the guard fell
    // through and cancel proceeded against the stale closure `l`.
    const fresh = layawaysRef.current.find((x) => x.id === l.id);
    if (!fresh) {
      toast(t('layaway.errorNoLongerExists'), 'error');
      setCancelTarget(null);
      return;
    }
    if (String(fresh.status || '').toLowerCase() === 'completed') {
      toast(t('layaway.errorJustCompleted'), 'error');
      setCancelTarget(null);
      return;
    }

    // R-APPROVAL-PIN-V1 F3A: manager-approval gate. Runs AFTER status guards
    // so we don't prompt for an approval that would be wasted on an already-
    // terminal layaway. Returns approved=true (passthrough) when the feature
    // is disabled or the requesting employee doesn't need approval — cero
    // visible change for owners/managers when approvals are off.
    //
    // F3A fix #1 + #2: on denial we DO NOT close CancelLayawayModal. Spinner
    // resets via cancelInFlight=false; cashier keeps disposition + note and
    // can retry by clicking Confirm again. Toast policy: timeout only.
    // invalid_pin / self_approval_blocked are inline-only inside the
    // approval modal (handled by useApprovalGate); cancelled/ESC is silent.
    setCancelInFlight(true);
    const approval = await approvalGate.requestApproval({
      actionType: 'CANCEL_LAYAWAY',
      requestedByEmployeeId: currentEmployee?.id || '',
      entityId: l.id,
      affectedAmount: l.paidAmount || 0,
      reason: choice.method === 'cash'
        ? 'Layaway cancellation — cash refund'
        : choice.method === 'store_credit'
        ? 'Layaway cancellation — store credit'
        : 'Layaway cancellation — deposit forfeited',
    });
    if (!approval.approved) {
      setCancelInFlight(false);
      if (approval.reason === 'timeout') {
        toast(t('approval.toast.timeout'), 'warning');
      }
      return;
    }

    const depositCents = fresh.paidAmount || 0;
    const now = new Date().toISOString();

    // Restore inventory reservation
    // Round 15b M3: loop over items for future multi-item layaway support.
    // Today every layaway has exactly one item; loop is defensive.
    // Round 16 H-v4c: when the legacy top-level inventoryId matches items[0]
    // (common today), prefer items[0].qty over the implicit 1 so multi-qty
    // layaways restore the full reserved quantity instead of losing qty−1.
    const invIdsToRestore: Array<{ id: string; qty: number }> = [];
    const topLevelInvId = (l as any).inventoryId;
    if (topLevelInvId) {
      const matchedItem = (l.items || []).find((it) => it.inventoryId === topLevelInvId);
      invIdsToRestore.push({ id: topLevelInvId, qty: matchedItem?.qty || 1 });
    }
    for (const item of l.items || []) {
      if (item.inventoryId && item.inventoryId !== topLevelInvId) {
        invIdsToRestore.push({ id: item.inventoryId, qty: item.qty || 1 });
      }
    }
    if (invIdsToRestore.length > 0) {
      const nextInv = inventoryRef.current.map((i) => {
        const match = invIdsToRestore.find((r) => r.id === i.id);
        return match ? { ...i, qty: i.qty + match.qty } : i;
      });
      inventoryRef.current = nextInv;
      setInventory(nextInv);
      for (const r of invIdsToRestore) {
        const updatedInv = nextInv.find((i: any) => i.id === r.id);
        if (updatedInv) persist.inventory(updatedInv.id, updatedInv as unknown as Record<string, unknown>);
      }
    }

    if (choice.method === 'store_credit' && depositCents > 0) {
      const phoneTail = (l.customerPhone || '').replace(/\D/g, '').slice(-10);
      const matched = customersRef.current.find((c) => {
        if ((l as any).customerId && c.id === (l as any).customerId) return true;
        if (phoneTail) {
          const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
          if (cPhone && cPhone === phoneTail) return true;
        }
        return false;
      });
      if (matched) {
        // Round 15b/15b.1 M2: setCustomers is dispatch-only (no functional
        // updater overload in AppProvider). This is the canonical local
        // anti-stale fix and must not be changed without a full AppProvider
        // refactor. CRITICAL invariants — do NOT remove or reorder:
        //   1. Re-read via customersRef.current IMMEDIATELY before the
        //      increment, not via a closure-captured customers value.
        //   2. Write customersRef.current = nextCustomers BEFORE calling
        //      setCustomers(nextCustomers) so a concurrent handler firing
        //      between these two lines sees the updated credit.
        //   3. persist.customer runs AFTER the ref sync, against the
        //      synchronously-captured updatedCustomer.
        // Any refactor that loses these three invariants reopens the
        // concurrent-cancel store_credit race.
        const fresh = customersRef.current.find((c) => c.id === matched.id) || matched;
        const updatedCustomer = {
          ...fresh,
          storeCredit: (fresh.storeCredit || 0) + depositCents,
        };
        const nextCustomers = customersRef.current.map((c) =>
          c.id === matched.id ? updatedCustomer : c
        );
        customersRef.current = nextCustomers;
        setCustomers(nextCustomers);
        persist.customer(updatedCustomer.id, updatedCustomer as unknown as Record<string, unknown>);
      } else {
        toast(t('layaway.errorCustomerNotMatched'), 'warning');
      }
    } else if (choice.method === 'cash' && depositCents > 0) {
      // Round 16 C-v4: cash-branch refund ALWAYS writes paymentMethod='Cash'.
      // Round 15b M4 originally used l.depositMethod here, but if the original
      // deposit was 'store_credit' or 'split', the refundSale would carry that
      // tag despite the cashier physically taking cash out of the drawer —
      // breaking cash-out reporting + Reports cashBreakdown aggregation.
      // The cash branch is literally a cash-drawer outflow; depositMethod is
      // kept on the Layaway itself for future "refund-to-original" policy UX
      // (e.g. suggesting the cashier pick the matching method) but does NOT
      // override what actually happened at the drawer.
      // This also transparently resolves the 'split' refund-shape gap: cash
      // refunds of split deposits are now simple 'Cash' refundSales.
      // R9-1: mark original sale(s) containing this layaway as refunded.
      const originalSales = salesRef.current.filter((s: Sale) =>
        (s.items || []).some((item: any) => item.layawayId === l.id)
        && s.status !== 'voided'
        && s.status !== 'refunded'
      );
      const markedSales = originalSales.map((s: Sale) => ({
        ...s,
        status: 'refunded' as Sale['status'],
        refundedAt: now,
        refundReason: `Layaway Cancel: ${choice.note || 'no note'}`,
        refundMethod: 'cash',
      }));
      for (const ms of markedSales) {
        persist.sale(ms.id, ms as unknown as Record<string, unknown>);
      }

      const refundSale: Sale = {
        id: generateId(),
        storeId: (l as any).storeId,
        invoiceNumber: `REFUND-${((l as any).ticketNumber || l.id.slice(-6).toUpperCase())}`,
        customerId: (l as any).customerId,
        customerName: l.customerName,
        customerPhone: l.customerPhone,
        items: [{
          id: generateId(),
          name: `${(l as any).itemDescription || l.items?.[0]?.name || t('layaway.cartItemName')} — ${t('layaway.cancelRefundName')}`,
          category: 'service' as any,
          price: -depositCents,
          qty: 1,
          taxable: false,
          cbeEligible: false,
          layawayId: l.id,
        }],
        subtotal: -depositCents,
        taxAmount: 0,
        cbeTotal: 0,
        total: -depositCents,
        paymentMethod: 'Cash',
        status: 'completed',
        employeeId: currentEmployee?.id,
        employeeName: currentEmployee?.name,
        notes: `Layaway cancelled — cash refund for ${(l as any).ticketNumber || l.id.slice(-6).toUpperCase()}`,
        refundReason: 'Layaway cancelled',
        createdAt: now,
        updatedAt: now,
        // Round 14: R9-1 parity — attach linkedRefunds so Reports cash-out dedup works across customerReturns and entity cancellations
        linkedRefunds: [{ type: 'layaway', id: l.id, depositCents }],
      } as unknown as Sale;

      const salesWithMarked = salesRef.current.map((s: Sale) => {
        const marked = markedSales.find((m: any) => m.id === s.id);
        return marked || s;
      });
      const nextSales = [...salesWithMarked, refundSale];
      salesRef.current = nextSales;
      setSales(nextSales);
      persist.sale(refundSale.id, refundSale as unknown as Record<string, unknown>);
    }

    const updated: any = {
      ...l,
      status: 'cancelled',
      depositRefundMethod: choice.method,
      depositRefundAmount: depositCents,
      cancellationNote: choice.note || '',
      cancelledAt: now,
      paidAmount: 0,
      balance: 0,
      updatedAt: now,
    };
    const nextLayCancel = layawaysRef.current.map((x) => x.id === l.id ? updated : x);
    layawaysRef.current = nextLayCancel;
    setLayaways(nextLayCancel);
    persist.layaway(updated.id, updated as unknown as Record<string, unknown>);

    // Round 16.2: clear any orphan cart items for this cancelled layaway so the
    // user can't accidentally checkout a pending balance against a cancelled
    // record. POS already guards via R15b H2, but the cart should also be clean.
    const cleanedCart = cartRef.current.filter((c) => c.layawayId !== l.id);
    if (cleanedCart.length !== cartRef.current.length) {
      cartRef.current = cleanedCart;
      // R-GLOBAL-CART-UNIFY-V1: cleanup write through the hook, no drawer pop.
      commitCart(cleanedCart, { openDrawer: false });
    }

    const amtStr = (depositCents / 100).toFixed(2);
    const msg = {
      store_credit: t('layaway.cancel.toastStoreCredit', amtStr),
      cash:         t('layaway.cancel.toastCash', amtStr),
      forfeit:      t('layaway.cancel.toastForfeit'),
    }[choice.method];
    toast(msg, 'success');
    setCancelInFlight(false);
    setCancelTarget(null);
  }, [t, setLayaways, setCustomers, setInventory, setSales, setCart, currentEmployee, toast, approvalGate]);

  const handleDeleteConfirmed = useCallback(() => {
    if (!deleteConfirm) return;
    if (isDeleting) return;

    // Round 15b L5: try/finally so the button always unlocks on any throw.
    setIsDeleting(true);
    try {
      // GUARD 1: no deletar si hay items pendientes en carrito
      const hasPendingCart = cartRef.current.some((item) => item.layawayId === deleteConfirm.id);
      if (hasPendingCart) {
        toast(t('layaway.errorDeleteInCart'), 'error');
        setDeleteConfirm(null);
        return;
      }

      // GUARD 2: no deletar si tiene depósito o está completado
      const hasDeposit = ((deleteConfirm as any).paidAmount || 0) > 0;
      const isCompleted = deleteConfirm.status === 'completed';
      if (hasDeposit || isCompleted) {
        toast(t('layaway.errorDeletePaidOrCompleted'), 'error');
        setDeleteConfirm(null);
        return;
      }

      // GUARD 3: restore inventory if reserved
      // Round 16.2: mirror Round 16 H-v4c dedup so Delete and Cancel restore the
      // same qty across multi-qty layaways (today every layaway is 1-item qty=1,
      // but the logic stays consistent if multi-qty ever ships).
      const invIdsToRestore: Array<{ id: string; qty: number }> = [];
      const topLevelInvId = (deleteConfirm as any).inventoryId;
      if (topLevelInvId) {
        const matchedItem = (deleteConfirm.items || []).find((it) => it.inventoryId === topLevelInvId);
        invIdsToRestore.push({ id: topLevelInvId, qty: matchedItem?.qty || 1 });
      }
      for (const item of deleteConfirm.items || []) {
        if (item.inventoryId && item.inventoryId !== topLevelInvId) {
          invIdsToRestore.push({ id: item.inventoryId, qty: item.qty || 1 });
        }
      }
      if (invIdsToRestore.length > 0) {
        const nextInv = inventoryRef.current.map((i) => {
          const match = invIdsToRestore.find((r) => r.id === i.id);
          return match ? { ...i, qty: i.qty + match.qty } : i;
        });
        inventoryRef.current = nextInv;
        setInventory(nextInv);
        for (const r of invIdsToRestore) {
          const updatedInv = nextInv.find((i: any) => i.id === r.id);
          if (updatedInv) persist.inventory(updatedInv.id, updatedInv as unknown as Record<string, unknown>);
        }
      }

      // Round 16.2: clear any orphan cart items for this deleted layaway —
      // matches the cancel-path hygiene. Delete is already gated against
      // layaways with deposits, so this is defensive belt-and-suspenders.
      const cleanedCart = cartRef.current.filter((c) => c.layawayId !== deleteConfirm.id);
      if (cleanedCart.length !== cartRef.current.length) {
        cartRef.current = cleanedCart;
        // R-GLOBAL-CART-UNIFY-V1: cleanup write through the hook, no drawer pop.
        commitCart(cleanedCart, { openDrawer: false });
      }

      const next = layawaysRef.current.filter((x) => x.id !== deleteConfirm.id);
      layawaysRef.current = next;
      setLayaways(next);
      remove.layaway(deleteConfirm.id);
      setDeleteConfirm(null);
      toast(t('layaway.deleted'), 'success');
    } catch (err) {
      toast(t('layaway.errorDeleting'), 'error');
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteConfirm, t, isDeleting, setLayaways, setInventory, setCart, toast]);

  const printLayawayTicket = useCallback(async (l: any) => {
    const safe   = (v: any) => v == null ? '' : String(v);
    const esc    = (s: unknown) => escHtml(s);
    const moneyC = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const storeName  = settings.storeName || 'GO CELLULAR';
    const storeAddr  = settings.storeAddress || '';
    const storePhone = settings.storePhone   || '';
    const taxRatePctLocal = ((settings.taxRate ?? 0.0925) * 100).toFixed(2);
    const totalCents    = l.totalPrice  || 0;
    // Round L-QF1: receipt reflects the AGREEMENT state — depositAmount
    // is the intent captured at Save (non-zero) while paidAmount is $0
    // until POS checkout reconciles. Reading paidAmount made the
    // auto-print show $0 even when the customer was about to pay $50.
    // Fallback chain covers legacy records that only have paidAmount.
    const paidCents     = (l as any).depositAmount ?? l.paidAmount ?? 0;
    const balanceCents  = totalCents - paidCents;
    const taxCents      = l.taxAmount   || 0;
    const subtotalCents = totalCents - taxCents;
    const itemDesc = l.itemDescription || l.items?.[0]?.name || '';

    // r-layaway-receipt-desglose: format with commas + full tax breakdown.
    const fmtMoney = (cents: number) => {
      const abs = Math.abs(cents);
      const str = (abs / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return cents < 0 ? `-$${str}` : `$${str}`;
    };
    const isTaxable = !!(l as any).taxable;
    const effectiveRate = isTaxable ? (settings.taxRate ?? 0.0925) : 0;

    const depSplit = paidCents > 0 ? reverseTaxFromPayment(paidCents, effectiveRate, isTaxable) : null;
    const balSplit = (isTaxable && balanceCents > 0) ? reverseTaxFromPayment(balanceCents, effectiveRate, isTaxable) : null;

    // R-LAYAWAY-MULTIPAY-V1 — payment totals.
    const lpTotals = calculateLayawayTotals(l);
    // R-PAYMENT-TRACE-RECEIPTS-LAYAWAY-SPECIAL-ORDER-V1: structured partial-
    // payment audit trail (summary + full per-payment history). Uses values the
    // receipt already computed — no money/tax/balance recomputation. When the
    // payments[] history exists, the summary is derived from it (single source
    // of truth); for a brand-new agreement-state deposit (history empty but a
    // deposit was captured) the deposit is shown as today's payment.
    const traceHasHistory = lpTotals.paymentCount > 0;
    const traceRows = traceHasHistory
      ? classifyHistoryRows(
          [...normalizeLayawayPayments(l)]
            .sort((a, b) => (new Date(a.date).getTime() || 0) - (new Date(b.date).getTime() || 0))
            .map((p) => ({
              date: (() => { try { return new Date(p.date).toLocaleDateString(); } catch { return ''; } })(),
              method: String(p.method || ''),
              amountCents: p.amount || 0,
            })),
          lpTotals.remainingBalanceCents <= 0,
        )
      : [];
    const paymentTrace = buildPaymentTrace({
      originalTotalCents: totalCents,
      totalPaidCents: traceHasHistory ? lpTotals.totalPaidCents : paidCents,
      balanceAfterCents: traceHasHistory ? lpTotals.remainingBalanceCents : Math.max(0, totalCents - paidCents),
      history: traceRows,
      fallbackTodayCents: traceHasHistory ? 0 : paidCents,
      // SPECIAL-ORDER-PAYMENT-TRACE-SEMANTIC-CLARITY-V1: pre-tax split the
      // receipt already computed — ORDER SUMMARY shows tax once.
      subtotalCents,
      taxCents: isTaxable ? taxCents : 0,
    });
    // LAYAWAY-RECEIPT-CLEANUP-V1: omit the ORDER SUMMARY block (Subtotal / Sales Tax /
    // "tax is part of the order total…" note / Original Total) — the main body above
    // already shows Total / Deposit / Balance Due.
    // LAYAWAY-RECEIPT-CLEANUP-V2: also omit the CURRENT STATUS sub-block (Total Paid /
    // Remaining Balance / Status) while KEEPING Payment History + Paid Today (and the
    // Conditions block, which lives in the main template). Display-only; no recompute.
    const paymentTraceHtml = renderPaymentTraceHtml(paymentTrace, paymentTraceI18n(t), esc, fmtMoney, { omitOrderSummary: true, omitCurrentStatus: true });

    // R-RECEIPT-UNIFY-LAYAWAY-V1: barcode (ticket #). The Google Reviews QR is
    // intentionally OMITTED on layaway — it is the tallest receipt (tax split +
    // payment history + 4 conditions) and the QR pushed it past the 4x6 page.
    const barcodeSvg = renderBarcodeSvg(safe(l.ticketNumber) || (l.id ? String(l.id).slice(-8).toUpperCase() : ''), getReceiptBarcodeHeight(settings.paperSize));
    // R-RECEIPT-UNIFY-LAYAWAY-V1: master visual shell (centered Go Cellular
    // header, barcode, Arial typography, dashed separators, footer + Google
    // Reviews QR). All money / payment-history / conditions rows are preserved
    // verbatim below — formatting only, no financial math touched.
    // LAYAWAY-80MM-RECEIPT-LAYOUT-AUDIT-V1: width-agnostic page strategy.
    // The old css hardcoded @page size 4in 6in + html,body width 4in. With
    // preferCSSPageSize:true in the print pipeline, that 4in (101.6mm) layout
    // overrode the user's 80mm paper selection → right side clipped, rows
    // mis-aligned, history lines cut. Now the SELECTED paper size drives the
    // page box and content fills 100% of the printable width (80mm AND 4x6
    // both work). Long values wrap right-aligned instead of overflowing.
    // Visual system (Arial, dashed separators, label/value rows) unchanged.
    const css = `@page{margin:0}*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;max-width:100%;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;background:#fff}body{padding:.1in .15in;overflow-x:hidden}@media screen{img,svg{max-width:100%;height:auto}}.sep{border-top:1px dashed #999;margin:5px 0}.sec{margin:4px 0}.sec-lbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#666;border-bottom:1px solid #ccc;padding-bottom:1px;margin-bottom:3px}.row{display:flex;justify-content:space-between;gap:6px;margin-bottom:1px}.lbl{color:#444;flex-shrink:0}.val{font-weight:600;text-align:right;min-width:0;word-break:break-word}.sub{font-size:9px;color:#666;padding-left:8px;margin-bottom:1px}.dash{border-top:1px dashed #bbb;margin:3px 0}.solid{border-top:1px solid #000;margin:3px 0}.grand .lbl,.grand .val{font-weight:800;font-size:13px}.bal-due .val{color:#c00;font-weight:800;font-size:13px}.cond-hdr{font-weight:700;font-size:9px;margin:4px 0 2px}.cond{font-size:8px;color:#555;margin-bottom:1px}.ftr{text-align:center;font-size:11px;font-weight:600;line-height:1.3;margin-top:6px}@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}body,body *{color:#000!important;border-color:#000!important}}`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Layaway ${esc(l.ticketNumber)}</title><style>${css}</style></head><body>
<div style="width:100%;box-sizing:border-box;margin-bottom:4px;border-bottom:2px solid #000;padding-bottom:4px;overflow:hidden;text-align:center"><div style="font-size:18px;font-weight:900;line-height:1.1;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(storeName)}</div>${storeAddr ? `<div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(storeAddr)}</div>` : ''}${storePhone ? `<div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(storePhone)}</div>` : ''}</div>
<div style="width:100%;box-sizing:border-box;text-align:center;margin:0 0 6px 0;overflow:hidden">${barcodeSvg ? barcodeSvg.replace('<svg', '<svg style="display:inline-block;max-width:100%"') : ''}</div>
<div style="text-align:center;font-size:13px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:4px">${esc(t('layaway.print.receipt'))}</div>
<div class="sec">
<div class="row"><span class="lbl">${esc(t('layaway.print.date'))}</span><span class="val">${esc(new Date().toLocaleString())}</span></div>
</div>
<div class="dash"></div>
<div class="sec">
<div class="sec-lbl">${esc(t('layaway.print.customer'))}</div>
<div class="row"><span class="lbl"></span><span class="val">${esc(safe(l.customerName))}</span></div>
${l.customerPhone ? `<div class="row"><span class="lbl">${esc(t('layaway.print.phone'))}</span><span class="val">${esc(safe(l.customerPhone))}</span></div>` : ''}
</div>
<div class="dash"></div>
<div class="sec">
<div class="sec-lbl">${esc(t('layaway.print.item'))}</div>
<div class="row"><span class="lbl"></span><span class="val">${esc(safe(itemDesc))}</span></div>
${l.imei ? `<div class="row"><span class="lbl">IMEI</span><span class="val">${esc(safe(l.imei))}</span></div>` : ''}
${l.itemSku ? `<div class="row"><span class="lbl">SKU</span><span class="val">${esc(safe(l.itemSku))}</span></div>` : ''}
${(l.dueDate || l.pickupDate) ? `<div class="row"><span class="lbl">${esc(t('layaway.print.pickupDate'))}</span><span class="val">${esc(safe(l.dueDate || l.pickupDate))}</span></div>` : ''}
</div>
<div class="solid"></div>
<div class="sec">
<div class="row"><span class="lbl">${esc(t('layaway.print.subtotal'))}</span><span class="val">${esc(fmtMoney(subtotalCents))}</span></div>
${isTaxable && taxCents > 0 ? `<div class="row"><span class="lbl">${esc(t('layaway.print.tax'))} (${esc(taxRatePctLocal)}%)</span><span class="val">${esc(fmtMoney(taxCents))}</span></div>` : ''}
<div class="dash"></div>
<div class="row grand"><span class="lbl">${esc(t('layaway.print.total'))}</span><span class="val">${esc(fmtMoney(totalCents))}</span></div>
<div class="dash"></div>
<div class="row"><span class="lbl">${esc(t('layaway.print.deposit'))}</span><span class="val">${paidCents > 0 ? `- ${esc(fmtMoney(paidCents))}` : esc(fmtMoney(0))}</span></div>
${depSplit && isTaxable && depSplit.taxCents > 0 ? `<div class="sub">${esc(t('layaway.print.taxIncluded'))}: ${esc(fmtMoney(depSplit.taxCents))}</div><div class="sub">${esc(t('layaway.print.preTaxBase'))}: ${esc(fmtMoney(depSplit.baseCents))}</div>` : ''}
<div class="dash"></div>
<div class="row ${balanceCents > 0 ? 'bal-due' : 'grand'}"><span class="lbl">${esc(t('layaway.print.balanceDue'))}</span><span class="val">${esc(fmtMoney(balanceCents))}</span></div>
${balSplit ? `<div class="sub">${esc(t('layaway.print.taxIncluded'))}: ${esc(fmtMoney(balSplit.taxCents))}</div><div class="sub">${esc(t('layaway.print.preTaxBase'))}: ${esc(fmtMoney(balSplit.baseCents))}</div>` : ''}
</div>
<div class="dash"></div>${paymentTraceHtml}
${l.notes ? `<div class="dash"></div><div class="sec"><div class="sec-lbl">${esc(t('layaway.print.notes'))}</div><div>${esc(safe(l.notes))}</div></div>` : ''}
<div class="dash"></div>
<div class="sec">
<div class="cond-hdr">${esc(t('layaway.print.conditionsHeader'))}</div>
<div class="cond">${esc(t('layaway.print.cond1'))}</div>
<div class="cond">${esc(t('layaway.print.cond2'))}</div>
<div class="cond">${esc(t('layaway.print.cond3'))}</div>
<div class="cond">${esc(t('layaway.print.cond4'))}</div>
</div>
<div class="ftr">${l.employeeName ? `${esc(t('layaway.print.servedBy'))}: ${esc(safe(l.employeeName))}<br>` : ''}${esc(t('layaway.print.thanks'))}${settings.storeWebsite ? `<br>${esc(settings.storeWebsite)}` : ''}</div>
</body></html>`;
    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
  }, [settings, t, printHtml]);

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>🏷️ {t('layaway.title')}</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
              {activeCount} {t('layaway.activeWord')}
              {overdueCount > 0 && ` • ${t('layaway.overdueCount', overdueCount)}`}
              {completedRevenue > 0 && ` • ${t('layaway.revenue', formatCurrency(completedRevenue))}`}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={openNew}
            disabled={lanReadOnly}
            title={lanReadOnly ? t('lan.readOnlyTooltip') : undefined}
            style={lanReadOnly ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >+ {t('layaway.newBtn')}</button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => { setStatusFilter(s); setVisibleCount(50); }} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}>
              {s === 'active' ? t('layaway.filter.active') : s === 'overdue' ? t('layaway.filter.overdue') : s === 'completed' ? t('layaway.filter.completed') : t('layaway.filter.cancelled')}
              {s === 'overdue' && overdueCount > 0 && (
                <span style={{ marginLeft: '0.4rem', background: '#ef4444', color: '#fff', borderRadius: '999px', padding: '0 6px', fontSize: '0.7rem' }}>{overdueCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* r-global-search: GlobalSearchBar replaces the local SearchInput.
            Synced mode — local `search` state still drives the filtered list. */}
        <div style={{ width: '100%', maxWidth: '340px', marginBottom: '1rem' }}>
          <GlobalSearchBar
            localValue={search}
            onLocalChange={(v) => { setSearch(v); setVisibleCount(50); }}
            excludeCollection="layaways"
            placeholder={t('layaway.searchPlaceholder')}
          />
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏷️</div>
            <p>{t('layaway.noLayaways')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filtered.slice(0, visibleCount).map((l) => {
              const r             = l as any;
              const sc            = statusColor(l);
              const sl            = statusLabel(l);
              const itemName      = r.itemDescription || l.items?.[0]?.name || '';
              const ticketNum     = r.ticketNumber    || l.id.slice(-8).toUpperCase();
              const totalDollars  = (l.totalPrice  || 0) / 100;
              // R-LAYAWAY-SAFE-STATE-REPAIR-V1: derive paid/balance from
              // payments[] when present (calculateLayawayTotals), falling back
              // to stored aggregates only for legacy records with no payment
              // log. The card no longer trusts raw l.paidAmount/l.balance,
              // which can desync from the discrete payment log.
              const _layTotals    = calculateLayawayTotals(l);
              const paidDollars   = _layTotals.totalPaidCents / 100;
              const balDollars    = _layTotals.remainingBalanceCents / 100;
              const taxDollars    = (r.taxAmount   || 0) / 100;
              const subDollars    = totalDollars - taxDollars;
              // R-LAYAWAY-SAFE-STATE-REPAIR-V1: normalized status gate so a
              // record stored as 'Active' (capitalized) still surfaces the
              // active action row, consistent with the filter logic above.
              const isActive      = String(l.status || '').toLowerCase() === 'active';

              return (
                <div key={l.id}
                  ref={isHighlighted(l.id) ? highlightRef : null}
                  className="glass-card"
                  style={{ padding: '1rem', borderLeft: `4px solid ${sc}`, ...(isHighlighted(l.id) ? { outline: '2px solid #667eea', boxShadow: '0 0 0 4px rgba(102,126,234,0.15)' } : {}) }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {/* Left */}
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{l.customerName}</span>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>{ticketNum}</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: sc, background: sc + '22', padding: '2px 8px', borderRadius: '999px' }}>{sl}</span>
                        {r.inventoryId && (
                          <span style={{ fontSize: '0.7rem', color: '#a78bfa', background: 'rgba(167,139,250,0.15)', padding: '2px 8px', borderRadius: '999px' }}>
                            📦 {t('layaway.inInventory')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.9rem', color: '#e2e8f0', marginBottom: '0.2rem' }}>
                        📱 {itemName}{r.imei ? ` — IMEI: ${r.imei}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#94a3b8', flexWrap: 'wrap' }}>
                        {l.customerPhone && <span>📞 {l.customerPhone}</span>}
                        {(l.dueDate || r.pickupDate) && <span>📅 {l.dueDate || r.pickupDate}</span>}
                        {l.employeeName && <span>👤 {l.employeeName}</span>}
                      </div>
                      {l.notes && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem', fontStyle: 'italic' }}>📝 {l.notes}</div>}
                      {l.status === 'cancelled' && (
                        <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#6b7280' }}>
                          ✕ {t('layaway.cancelled')}{r.cancelledAt ? ` — ${String(r.cancelledAt).slice(0,10)}` : ''}
                          {r.depositRefundMethod === 'store_credit' && ` — ${t('layaway.storeCreditApplied')}`}
                          {r.depositRefundMethod === 'cash' && ` — ${t('layaway.cashRefunded')}`}
                          {r.depositRefundMethod === 'forfeit' && ` — ${t('layaway.depositForfeited')}`}
                          {!r.depositRefundMethod && r.depositRefunded !== undefined && (r.depositRefunded ? ` — ${t('layaway.depositRefunded')}` : ` — ${t('layaway.depositKept')}`)}
                        </div>
                      )}
                      {l.status === 'completed' && (
                        <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#10b981' }}>
                          ✅ {t('layaway.completed')}{r.completedAt ? ` — ${String(r.completedAt).slice(0,10)}` : ''}
                        </div>
                      )}
                    </div>
                    {/* Right — amounts */}
                    <div style={{ textAlign: 'right', minWidth: '145px', flexShrink: 0 }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t('subtotal')}: <span style={{ color: '#e2e8f0' }}>${subDollars.toFixed(2)}</span></div>
                      {r.taxable && taxDollars > 0 && <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t('tax')}: <span style={{ color: '#e2e8f0' }}>${taxDollars.toFixed(2)}</span></div>}
                      <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{t('total')} <span style={{ color: '#e2e8f0', fontWeight: 600 }}>${totalDollars.toFixed(2)}</span></div>
                      <div style={{ fontSize: '0.78rem', color: '#10b981' }}>{t('layaway.paid')}: ${paidDollars.toFixed(2)}</div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: balDollars > 0 ? '#f59e0b' : '#10b981' }}>Balance: ${balDollars.toFixed(2)}</div>
                    </div>
                  </div>
                  {/* R-LAYAWAY-MULTIPAY-V1: payment history (newest-first).
                      Lazy-normalized so legacy single-deposit layaways
                      surface as payments[0] without any data migration. */}
                  {(() => {
                    const totals = calculateLayawayTotals(l);
                    if (totals.paymentCount === 0) return null;
                    const history = [...normalizeLayawayPayments(l)].sort((a, b) => {
                      const da = new Date(a.date).getTime() || 0;
                      const db = new Date(b.date).getTime() || 0;
                      return db - da;
                    });
                    const fmtDate = (iso: string) => {
                      try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
                    };
                    return (
                      <div style={{ marginTop: '0.65rem', padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0.5rem' }}>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>💳 {t('layaway.payments.historyTitle')} ({totals.paymentCount})</span>
                          <span style={{ color: '#10b981', fontWeight: 600 }}>
                            ${(totals.totalPaidCents / 100).toFixed(2)}
                            <span style={{ color: '#64748b', fontWeight: 500 }}> / </span>
                            <span style={{ color: totals.remainingBalanceCents > 0 ? '#f59e0b' : '#10b981' }}>
                              ${(totals.remainingBalanceCents / 100).toFixed(2)} {t('layaway.payments.remaining')}
                            </span>
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.78rem' }}>
                          {history.map((p) => (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', padding: '0.15rem 0', borderTop: '1px dashed rgba(255,255,255,0.05)' }}>
                              <span style={{ color: '#94a3b8', minWidth: '5.5rem' }}>{fmtDate(p.date)}</span>
                              <span style={{ color: '#e2e8f0', fontWeight: 600, fontFamily: 'monospace', minWidth: '5rem', textAlign: 'right' }}>${(p.amount / 100).toFixed(2)}</span>
                              <span style={{ color: '#a78bfa', minWidth: '4.5rem' }}>{p.method || '—'}</span>
                              <span style={{ color: '#64748b', flex: 1, fontStyle: 'italic', textAlign: 'right' }}>{p.note || ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    {isActive && (
                      <>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => setDepositTarget(l)}
                          disabled={lanReadOnly}
                          title={lanReadOnly ? t('lan.readOnlyTooltip') : undefined}
                          style={lanReadOnly ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                        >
                          💳 {t('layaway.addPayment')} (${balDollars.toFixed(2)})
                        </button>
                        {settings.waEnabled !== false && l.customerPhone && (
                          <button
                            className="btn btn-sm"
                            style={{ background: 'rgba(37,211,102,0.15)', color: '#25d366', border: '1px solid rgba(37,211,102,0.3)' }}
                            onClick={() => openWhatsApp(
                              l.customerPhone!,
                              buildWaMessage(
                                balDollars > 0 ? 'layawayReminder' : 'thankYou',
                                {
                                  customerName: l.customerName,
                                  storeName: settings.storeName || 'Go Cellular',
                                  storePhone: settings.storePhone,
                                  itemDescription: r.itemDescription || l.items?.[0]?.name || '',
                                  balance: balDollars > 0 ? `$${balDollars.toFixed(2)}` : undefined,
                                },
                                locale === 'es' ? 'es' : 'en',
                              )
                            )}
                          >
                            📱 WhatsApp
                          </button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => printLayawayTicket(l)}>🖨️ {t('layaway.printBtn')}</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(l)}>✏️ {t('layaway.editBtn')}</button>
                        <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }} onClick={() => setCancelTarget(l)}>
                          ✕ {t('layaway.cancelBtn')}
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                          onClick={() => setDeleteConfirm(l)}
                          disabled={isDeleting}
                          aria-busy={isDeleting}
                          title={t('layaway.deleteTitle')}
                        >
                          🗑️
                        </button>
                      </>
                    )}
                    {(l.status === 'completed' || l.status === 'cancelled') && (
                      <button className="btn btn-secondary btn-sm" onClick={() => printLayawayTicket(l)}>🖨️ {t('layaway.reprintBtn')}</button>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length > visibleCount && (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <button onClick={() => setVisibleCount((n) => n + 50)} className="btn btn-secondary btn-sm">
                  {t('layaway.showMore', filtered.length - visibleCount)}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CREATE / EDIT MODAL */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" style={{ maxWidth: '580px', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontWeight: 700 }}>🏷️ {editLayaway ? t('layaway.editTitle') : t('layaway.newTitle')}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

              {/* Name */}
              {/* r-customer-picker-sweep: wrap customer inputs in shared
                  CustomerSearchHeader for explicit "Select Customer" button. */}
              <CustomerSearchHeader
                customers={customers}
                lang={locale === 'es' ? 'es' : 'en'}
                onSelect={(c) => {
                  const parts = c.name.trim().split(/\s+/);
                  setForm({
                    ...form,
                    firstName: parts[0] || '',
                    lastName: parts.slice(1).join(' ') || '',
                    customerPhone: c.phone || '',
                  });
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="label">👤 {t('layaway.firstName')} *</label>
                    <AutocompleteInput
                      value={form.firstName}
                      onChange={(val) => setForm({ ...form, firstName: val })}
                      onSelect={(opt) => {
                        const c = opt.data as Customer;
                        const parts = c.name.trim().split(' ');
                        setForm({ ...form, firstName: parts[0] || opt.value, lastName: parts.slice(1).join(' ') || form.lastName, customerPhone: c.phone || form.customerPhone });
                      }}
                      options={firstNameOptions}
                      placeholder={t('layaway.firstNamePlaceholder')}
                      maxResults={6}
                    />
                  </div>
                  <div>
                    <label className="label">👤 {t('layaway.lastName')}</label>
                    <AutocompleteInput
                      value={form.lastName}
                      onChange={(val) => setForm({ ...form, lastName: val })}
                      onSelect={(opt) => {
                        const c = opt.data as Customer;
                        const parts = c.name.trim().split(' ');
                        setForm({ ...form, lastName: parts.slice(1).join(' ') || opt.value, firstName: parts[0] || form.firstName, customerPhone: c.phone || form.customerPhone });
                      }}
                      options={lastNameOptions}
                      placeholder={t('layaway.lastNamePlaceholder')}
                      maxResults={6}
                    />
                  </div>
                </div>

                {/* Phone */}
                <div style={{ marginTop: '0.75rem' }}>
                  <label className="label">📞 {t('layaway.phone')}</label>
                  <AutocompleteInput
                    type="tel"
                    value={form.customerPhone}
                    onChange={(val) => setForm({ ...form, customerPhone: val })}
                    onSelect={(opt) => {
                      const c = opt.data as Customer;
                      const parts = c.name.trim().split(' ');
                      setForm({ ...form, customerPhone: opt.value, firstName: parts[0] || form.firstName, lastName: parts.slice(1).join(' ') || form.lastName });
                    }}
                    options={phoneOptions}
                    placeholder="(805) 000-0000"
                    maxResults={6}
                    matchHint={phoneMatch ? (
                      <span style={{ fontSize: '0.72rem', color: '#34d399' }}>&#10003; {phoneMatch.name} &middot; {phoneMatch.loyaltyPoints || 0} pts</span>
                    ) : undefined}
                  />
                </div>
              </CustomerSearchHeader>

              {/* Item search / manual */}
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label className="label" style={{ margin: 0 }}>📱 {t('layaway.item')} *</label>
                  <button type="button" onClick={() => setForm({ ...form, manualEntry: !form.manualEntry, inventoryId: '' })}
                    style={{ fontSize: '0.72rem', color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer' }}>
                    {form.manualEntry ? `🔍 ${t('layaway.searchInventory')}` : `✏️ ${t('layaway.manualEntry')}`}
                  </button>
                </div>
                {!form.manualEntry ? (
                  <>
                    <input className="input" value={itemSearch}
                      onChange={(e) => { setItemSearch(e.target.value); setForm({ ...form, inventoryId: '', itemDescription: e.target.value }); }}
                      onFocus={() => itemResults.length > 0 && setShowItemDropdown(true)}
                      placeholder={t('layaway.searchImei')} />
                    {showItemDropdown && itemResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '0.5rem', zIndex: 100, maxHeight: '220px', overflowY: 'auto', marginTop: '2px' }}>
                        {itemResults.map((item) => (
                          <div key={item.id} onClick={() => selectInventoryItem(item)}
                            style={{ padding: '0.6rem 0.875rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background='rgba(167,139,250,0.15)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background='transparent'; }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{item.name}</div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{item.sku?`SKU: ${item.sku}`:''}{item.imei?` • IMEI: ${item.imei}`:''}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 700, color: '#10b981', fontSize: '0.875rem' }}>{formatCurrency(item.price)}</div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{item.qty} {t('layaway.inStock')}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {form.inventoryId && (
                      <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#a78bfa' }}>
                        ✅ {t('layaway.linkedToInventory')}
                      </div>
                    )}
                  </>
                ) : (
                  <input className="input" value={form.itemDescription}
                    onChange={(e) => setForm({ ...form, itemDescription: e.target.value })}
                    placeholder={t('layaway.itemPlaceholder')} />
                )}
                {/* Category */}
                <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{t('layaway.category')}</span>
                  {form.inventoryId && !form.manualEntry ? (
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#a78bfa', background: 'rgba(167,139,250,0.15)', padding: '2px 10px', borderRadius: '999px' }}>📦 {form.itemCategory}</span>
                  ) : (
                    <select className="select" value={form.itemCategory} onChange={(e) => setForm({ ...form, itemCategory: e.target.value })} style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', flex: 1 }}>
                      {availableCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>
              </div>

              {/* IMEI */}
              <div>
                <label className="label">🔢 {t('layaway.imei')}</label>
                <input className="input" value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value })} placeholder="356XXXXXXXXX" style={{ fontFamily: 'monospace' }} />
              </div>

              {/* Price + Deposit */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">💵 {t('layaway.totalPrice')} * ($)</label>
                  <input className="input" type="number" step="0.01" min="0" value={form.totalPrice} onChange={(e) => setForm({ ...form, totalPrice: e.target.value })} placeholder="0.00" style={{ textAlign: 'center', fontWeight: 700 }} />
                </div>
                <div>
                  <label className="label">💰 {t('layaway.depositField')} * ($)</label>
                  <input className="input" type="number" step="0.01" min="0" value={form.deposit}
                    onChange={(e) => { if (!editLayaway) setForm({ ...form, deposit: e.target.value }); }}
                    readOnly={!!editLayaway}
                    placeholder="0.00"
                    style={{ textAlign: 'center', fontWeight: 700, color: '#10b981', opacity: editLayaway ? 0.6 : 1, cursor: editLayaway ? 'not-allowed' : undefined }}
                  />
                  {editLayaway && (
                    <p style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.25rem', textAlign: 'center' }}>
                      {t('layaway.depositLocked')}
                    </p>
                  )}
                </div>
              </div>

              {/* Tax */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.6rem 0.875rem', background: form.taxable ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', border: `1px solid ${form.taxable ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}` }}>
                <input type="checkbox" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} />
                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>🧾 {t('layaway.taxable', taxRatePct)}</span>
              </label>

              {/* Totals preview */}
              {subtotal > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '0.875rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', padding: '0.2rem 0' }}>
                    <span>{t('layaway.itemPriceLabel')}:</span><span>${subtotal.toFixed(2)}</span>
                  </div>
                  {form.taxable && taxAmt > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', padding: '0.2rem 0' }}>
                      <span>{t('layaway.taxLabel')} ({taxRatePct}%):</span><span style={{ color: '#fbbf24' }}>+${taxAmt.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#e2e8f0', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.4rem', marginTop: '0.25rem' }}>
                    <span>= {t('layaway.totalLabel')}{form.taxable ? ` (${t('layaway.taxInclLabel')})` : ''}:</span><span>${grandTotal.toFixed(2)}</span>
                  </div>
                  {depositAmt > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981', padding: '0.2rem 0' }}>
                        <span>− {t('layaway.depositToday')}:</span><span>−${depositAmt.toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1rem', color: balanceAmt > 0 ? '#f59e0b' : '#10b981', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.35rem', marginTop: '0.25rem' }}>
                        <span>= {t('layaway.balanceDueLabel')}:</span><span>${balanceAmt.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Pickup + Employee */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">📅 {t('layaway.pickupDate')}</label>
                  <input className="input" type="date" value={form.pickupDate} onChange={(e) => setForm({ ...form, pickupDate: e.target.value })} min={new Date().toISOString().slice(0, 10)} />
                </div>
                <div>
                  <label className="label">👤 {t('layaway.employee')}</label>
                  <input className="input" value={form.employeeName} onChange={(e) => setForm({ ...form, employeeName: e.target.value })} placeholder={currentEmployee?.name || ''} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="label">📝 {t('layaway.notes')}</label>
                <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('layaway.notesPlaceholder')} style={{ resize: 'vertical' }} />
              </div>

              {!editLayaway && (
                <div style={{ padding: '0.65rem 0.875rem', background: 'rgba(16,185,129,0.1)', borderRadius: '0.5rem', border: '1px solid rgba(16,185,129,0.3)', fontSize: '0.82rem', color: '#10b981' }}>
                  💡 {t('layaway.depositAutoCart')}
                </div>
              )}
            </div>
            <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>{t('layaway.cancelBtn')}</button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => {
                if (editLayaway) {
                  printLayawayTicket(editLayaway);
                } else {
                  printLayawayTicket({
                    ...form,
                    customerName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
                    totalPrice: Math.round(grandTotal * 100),
                    taxAmount: Math.round(taxAmt * 100),
                    depositAmount: Math.round(depositAmt * 100),
                    balance: Math.round(balanceAmt * 100),
                    paidAmount: 0,
                    ticketNumber: locale === 'es' ? 'VISTA PREVIA' : 'PREVIEW',
                  });
                }
              }}>🖨️ {t('layaway.printBtn')}</button>
              <button className="btn btn-primary min-w-[140px]" style={{ flex: 2 }} onClick={handleSave} disabled={isSaving} aria-busy={isSaving}>💾 {isSaving ? t('layaway.saving') : t('layaway.saveBtn')}</button>
            </div>
          </div>
        </div>
      )}

      {/* COLLECT BALANCE MODAL — LAYAWAY-PAYMENT-CART-SEMANTICS-AND-MULTIPAGE-
          PRINT-FIX-V1: routes through the canonical cart pipeline
          (handleCollectConfirm → consolidateCartForLayaway → POS §4d), which
          reconciles paidAmount/balance, creates the Sale, and prints the
          receipt at checkout. The R-LAYAWAY-DIRECT-PAYMENT-V1 bypass
          (immediate Sale + history write with no cart/payment step) was
          removed — it skipped the payment-method/finalize semantics and
          could double-create transactions alongside the POS path. */}
      {depositTarget && (
        <LayawayPaymentModal
          layaway={depositTarget}
          lang={lang}
          onClose={() => setDepositTarget(null)}
          onConfirm={(amountCents) =>
            handleCollectConfirm(depositTarget, amountCents / 100)
          }
        />
      )}

      {cancelTarget && (
        <CancelLayawayModal
          layaway={cancelTarget}
          customerHasPhone={!!cancelTarget.customerPhone}
          customerName={cancelTarget.customerName}
          confirming={cancelInFlight}
          onClose={() => { setCancelInFlight(false); setCancelTarget(null); }}
          onConfirm={(choice) => { void handleCancel(cancelTarget, choice); }}
        />
      )}
      {/* R-APPROVAL-PIN-V1 F3A: manager-approval modal. Stacks on top of
          CancelLayawayModal during the confirm flow; closes itself on
          approve / cancel / timeout. */}
      {approvalGate.modal}
      <ConfirmDialog
        open={showImeiWarning}
        title={t('layaway.imeiWarning.title')}
        message={t('layaway.imeiWarning.message')}
        variant="warning"
        confirmLabel={t('layaway.imeiWarning.confirm')}
        cancelLabel={t('layaway.cancelBtn')}
        onConfirm={() => { setShowImeiWarning(false); skipImeiCheckRef.current = true; handleSave(); }}
        onCancel={() => setShowImeiWarning(false)}
      />
      <ConfirmDialog
        open={!!deleteConfirm}
        title={t('layaway.delete.title')}
        message={deleteConfirm ? t('layaway.delete.message', (deleteConfirm as any).ticketNumber || deleteConfirm.id.slice(-6).toUpperCase()) : ''}
        variant="danger"
        confirmLabel={t('layaway.delete.confirm')}
        cancelLabel={t('layaway.cancelBtn')}
        busy={isDeleting}
        confirmClassName="min-w-[140px]"
        confirmBusyLabel={t('layaway.delete.busy')}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}
