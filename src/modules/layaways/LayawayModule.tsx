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
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import { persist, remove } from '@/services/persist';
import { usePrint } from '@/hooks/usePrint';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import DepositModal from '@/components/DepositModal';
import { calcDepositTotals, reverseTaxFromPayment, forwardTaxFromBase } from '@/utils/depositTax';
import { AutocompleteInput, ConfirmDialog } from '@/components/ui';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import CustomerSearchHeader from '@/components/shared/CustomerSearchHeader';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import type { AutocompleteOption } from '@/hooks/useAutocomplete';
import type { Layaway, CartItem, Customer, InventoryItem, Sale } from '@/store/types';
import CancelLayawayModal from './CancelLayawayModal';

const STATUS_FILTERS = ['active', 'overdue', 'completed', 'cancelled'] as const;

function generateTicket(): string {
  return 'LAY-' + String(Date.now()).slice(-6);
}

export default function LayawayModule() {
  const {
    state: { layaways, customers, inventory, settings, currentEmployee, cart, sales, lang, globalSearchTerm },
    setLayaways, setCustomers, setInventory, setCart, setSales, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const { printHtml } = usePrint();
  const L = getLabels(lang);
  const es = lang === 'es';

  const [showImeiWarning, setShowImeiWarning]   = useState(false);
  const skipImeiCheckRef                        = useRef(false);
  const [search, setSearch]               = useState(globalSearchTerm || '');
  const [statusFilter, setStatusFilter]   = useState('active');
  const [visibleCount, setVisibleCount]   = useState(50);
  const [showForm, setShowForm]           = useState(false);
  const [editLayaway, setEditLayaway]     = useState<Layaway | null>(null);
  const [cancelTarget, setCancelTarget]   = useState<Layaway | null>(null);
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

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taxRate    = settings.taxRate || 0.0925;
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
    if (l.status === 'completed') return es ? 'Completado' : 'Completed';
    if (l.status === 'cancelled') return es ? 'Cancelado' : 'Cancelled';
    const d = getDaysInfo(l.dueDate);
    if (!d) return es ? 'Activo' : 'Active';
    if (d.overdue) return `${es ? 'Vencido' : 'Overdue'} (${d.days}d)`;
    if (d.days === 0) return es ? '¡Hoy!' : 'Today!';
    return `${d.days} ${es ? 'días' : 'days'}`;
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
        return matchesSearch(search, l.customerName, l.customerPhone,
          r.itemDescription || l.items?.[0]?.name || '',
          r.ticketNumber || '');
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
      totalPrice:      String((l.totalPrice  || 0) / 100),
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
  }): { combinedCents: number } => {
    const { layawayId, additionalCents, deviceLabel, ticketNumber, isTaxable } = params;
    const lTaxRate = settings.taxRate || 0.0925;

    const existingItems = cartRef.current.filter((c) => c.layawayId === layawayId);
    let combinedCents = additionalCents;
    for (const existing of existingItems) {
      const existingBase = (existing.price || 0) * (existing.qty || 1);
      const existingFwd = forwardTaxFromBase(existingBase, lTaxRate, !!existing.taxable);
      combinedCents += existingFwd.totalCents;
    }

    const split = reverseTaxFromPayment(combinedCents, lTaxRate, isTaxable);
    const consolidatedItem: CartItem = {
      id: generateId(),
      name: `${deviceLabel} — ${es ? 'Apartado' : 'Layaway'}`,
      category: 'service',
      price: split.baseCents,
      qty: 1,
      taxable: isTaxable,
      cbeEligible: false,
      layawayId,
      notes: ticketNumber || layawayId.slice(-6).toUpperCase(),
    };

    const nextCart = [
      ...cartRef.current.filter((c) => c.layawayId !== layawayId),
      consolidatedItem,
    ];
    cartRef.current = nextCart;
    setCart(nextCart);

    return { combinedCents };
  }, [settings.taxRate, es, setCart]);

  const handleSave = useCallback(() => {
    // Round 14: busy-state guard — short-circuit double-click; setIsSaving toggled
    // around the mutation phase only (after validation returns).
    if (isSaving) return;
    const fName = form.firstName.trim();
    const lName = form.lastName.trim();
    if (!fName) { toast(es ? 'Ingresa el nombre del cliente' : 'Enter customer first name', 'error'); return; }
    if (!form.itemDescription.trim()) { toast(es ? 'Selecciona o describe el artículo' : 'Select or describe the item', 'error'); return; }
    if (!form.totalPrice || subtotal <= 0) { toast(es ? 'Ingresa el precio total' : 'Enter total price', 'error'); return; }
    if (!form.deposit || depositAmt <= 0) { toast(es ? 'Ingresa el depósito' : 'Enter deposit amount', 'error'); return; }
    const phoneLen = (form.customerPhone || '').replace(/\D/g, '').length;
    if (phoneLen > 0 && phoneLen !== 10) { toast(es ? 'Teléfono debe ser 10 dígitos' : 'Phone must be 10 digits', 'error'); return; }
    if (depositAmt > grandTotal + 0.001) { toast(es ? 'El depósito no puede ser mayor al total' : 'Deposit cannot exceed total', 'error'); return; }

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
          toast(
            es ? `Cliente existente encontrado: ${existing.name}` : `Existing customer found: ${existing.name}`,
            'info',
          );
        }
      } else if (customerName) {
        const newCust: Customer = {
          id: generateId(), firstName: fName, lastName: lName, name: customerName, phone: form.customerPhone,
          phones: [form.customerPhone], email: '', loyaltyPoints: 0, storeCredit: 0,
          customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          notes: '', smsConsent: false, createdAt: new Date().toISOString(),
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

      const updated: any = {
        ...editLayaway,
        firstName: fName, lastName: lName, customerName, customerPhone: form.customerPhone,
        customerId: finalCustomerId || (editLayaway as any).customerId,
        inventoryId: form.inventoryId || undefined,
        itemDescription: form.itemDescription, itemSku: form.itemSku, imei: form.imei,
        itemCategory: form.itemCategory, manualEntry: form.manualEntry,
        items: [{ id: editLayaway.items?.[0]?.id || generateId(), inventoryId: form.inventoryId || undefined, name: form.itemDescription, price: Math.round(subtotal * 100), qty: 1 }],
        totalPrice: totalCents, taxAmount: taxCents, taxable: form.taxable,
        taxRate: form.taxable ? taxRate : 0,
        paidAmount: depositCents, balance: balanceCents,
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

      toast(es ? 'Apartado actualizado' : 'Layaway updated', 'success');
      setIsSaving(false);
      setShowForm(false); setEditLayaway(null); return;
    }

    // CREATE
    const ticket = generateTicket();
    const newLayaway: any = {
      id: generateId(), ticketNumber: ticket,
      firstName: fName, lastName: lName, customerName, customerPhone: form.customerPhone,
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
      });
      if (finalCustomerId) {
        dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: finalCustomerId });
      }
      toast(es ? 'Depósito agregado al carrito' : 'Deposit added to cart', 'info');
    }

    // Round 15 H1: defer the isSaving unlock until print fires so a fast
    // double-click on Save can't queue a second CREATE in the 300ms window.
    setTimeout(() => { printLayawayTicket(newLayaway); setIsSaving(false); }, 300);
    toast(es ? 'Apartado creado' : 'Layaway created!', 'success');
    setShowForm(false); setForm(emptyForm());
    } catch (err) {
      setIsSaving(false);
      toast(es ? 'Error al guardar el apartado' : 'Error saving layaway', 'error');
      console.error(err);
    }
  }, [form, subtotal, taxAmt, grandTotal, depositAmt, balanceAmt, editLayaway,
      layaways, customers, inventory, settings, currentEmployee, sales,
      es, taxRate, isSaving, setLayaways, setCustomers, setInventory, setCart, setSales, toast,
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
      dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: customerId });
    }

    // r-pkg-b1: DO NOT update layaway paidAmount/balance/status here.
    // The POS checkout handler (POSModule.tsx §4d) reads the layaway from
    // state and applies deduction + persist when the sale completes.
    // Premature persist here caused double-deduction and false revenue
    // if the user cancelled checkout. Also, marking status='completed'
    // before payment is collected is incorrect — the layaway isn't
    // complete until the money is actually in the drawer.
    setDepositTarget(null);
    toast(
      `${formatCurrency(paymentCents)} ${es ? 'agregado al carrito' : 'added to cart'}`,
      'info',
    );
  }, [es, toast, consolidateCartForLayaway, dispatch]);

  // r-new-4 port: cancel with deposit disposition (store_credit / cash / forfeit).
  // R9-1: cash refund marks original sale(s) as refunded so Reports excludes them
  // from Gross/Cash/Profit. A voided REFUND-* audit sale is also created.
  const handleCancel = useCallback((l: Layaway, choice: {
    method: 'store_credit' | 'cash' | 'forfeit';
    note: string;
  }) => {
    // Round 14: block invalid transitions BEFORE any mutation or side effect.
    // Round 15 C2/M1: include 'forfeited' terminal state AND close the modal on
    // early-return so CancelLayawayModal's isConfirming unlocks (otherwise the
    // child modal stays frozen at "Confirmando...").
    const normalizedStatus = String(l.status || '').toLowerCase();
    if (normalizedStatus === 'completed') {
      toast(es ? 'No se puede cancelar un apartado completado' : 'Cannot cancel a completed layaway', 'error');
      setCancelTarget(null);
      return;
    }
    if (normalizedStatus === 'cancelled' || normalizedStatus === 'forfeited') {
      toast(es ? 'Este apartado ya está cancelado' : 'This layaway is already cancelled', 'error');
      setCancelTarget(null);
      return;
    }
    // Round 15b H2: re-read from ref in case a concurrent POS checkout just
    // marked this layaway completed. Abort rather than resetting paid/balance.
    const fresh = layawaysRef.current.find((x) => x.id === l.id);
    if (fresh && String(fresh.status || '').toLowerCase() === 'completed') {
      toast(
        es ? 'Este apartado se acaba de completar. No se puede cancelar.'
           : 'This layaway was just completed. Cannot cancel.',
        'error',
      );
      setCancelTarget(null);
      return;
    }
    const depositCents = l.paidAmount || 0;
    const now = new Date().toISOString();

    // Restore inventory reservation
    // Round 15b M3: loop over items for future multi-item layaway support.
    // Today every layaway has exactly one item; loop is defensive.
    const invIdsToRestore: Array<{ id: string; qty: number }> = [];
    const topLevelInvId = (l as any).inventoryId;
    if (topLevelInvId) invIdsToRestore.push({ id: topLevelInvId, qty: 1 });
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
        // Round 15b M2: re-find the customer through customersRef immediately
        // before mutating, so concurrent cancels on the same customer don't
        // both read the pre-race storeCredit off a stale closure. Synchronous
        // ref write before setCustomers guarantees the next handler sees the
        // updated value. (App setter is dispatch-only — no functional updater
        // overload available; ref-sync is the equivalent anti-stale path.)
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
        toast(
          es ? '⚠️ No se identificó al cliente. Aplica crédito manualmente.'
             : '⚠️ Customer not matched. Apply credit manually.',
          'warning',
        );
      }
    } else if (choice.method === 'cash' && depositCents > 0) {
      // Round 15b M4: refund to the method used on the FIRST deposit. Fallback
      // to 'Cash' for pre-R15b layaways with console.warn for observability.
      const refundMethod = l.depositMethod || 'Cash';
      if (!l.depositMethod) {
        console.warn(
          `[Layaway refund] No depositMethod on layaway ${l.id}; falling back to Cash. Expected for pre-R15b layaways.`
        );
      }
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
          name: `${(l as any).itemDescription || l.items?.[0]?.name || 'Layaway'} — ${es ? 'Reembolso cancelación' : 'Cancellation refund'}`,
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
        paymentMethod: refundMethod,
        status: 'voided',
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

    const msg = {
      store_credit: es
        ? `Cancelado. Crédito $${(depositCents/100).toFixed(2)} agregado al cliente.`
        : `Cancelled. $${(depositCents/100).toFixed(2)} store credit added.`,
      cash: es
        ? `Cancelado. Reembolso $${(depositCents/100).toFixed(2)} registrado.`
        : `Cancelled. $${(depositCents/100).toFixed(2)} cash refund recorded.`,
      forfeit: es ? 'Cancelado. Depósito retenido.' : 'Cancelled. Deposit forfeited.',
    }[choice.method];
    toast(msg, 'success');
    setCancelTarget(null);
  }, [es, setLayaways, setCustomers, setInventory, setSales, currentEmployee, toast]);

  const handleDeleteConfirmed = useCallback(() => {
    if (!deleteConfirm) return;
    if (isDeleting) return;

    // Round 15b L5: try/finally so the button always unlocks on any throw.
    setIsDeleting(true);
    try {
      // GUARD 1: no deletar si hay items pendientes en carrito
      const hasPendingCart = cartRef.current.some((item) => item.layawayId === deleteConfirm.id);
      if (hasPendingCart) {
        toast(
          es ? 'No se puede eliminar: hay items en el carrito.'
             : 'Cannot delete: has cart items.',
          'error',
        );
        setDeleteConfirm(null);
        return;
      }

      // GUARD 2: no deletar si tiene depósito o está completado
      const hasDeposit = ((deleteConfirm as any).paidAmount || 0) > 0;
      const isCompleted = deleteConfirm.status === 'completed';
      if (hasDeposit || isCompleted) {
        toast(
          es ? 'No se puede eliminar apartados pagados o completados. Usa "Cancelar".'
             : 'Cannot delete paid or completed layaways. Use "Cancel".',
          'error',
        );
        setDeleteConfirm(null);
        return;
      }

      // GUARD 3: restore inventory if reserved
      const invId = (deleteConfirm as any).inventoryId || deleteConfirm.items?.[0]?.inventoryId;
      if (invId) {
        const nextInv = inventoryRef.current.map((i) => i.id === invId ? { ...i, qty: i.qty + 1 } : i);
        const updatedInv = nextInv.find((i: any) => i.id === invId);
        inventoryRef.current = nextInv;
        setInventory(nextInv);
        if (updatedInv) persist.inventory(updatedInv.id, updatedInv as unknown as Record<string, unknown>);
      }

      const next = layawaysRef.current.filter((x) => x.id !== deleteConfirm.id);
      layawaysRef.current = next;
      setLayaways(next);
      remove.layaway(deleteConfirm.id);
      setDeleteConfirm(null);
      toast(es ? 'Apartado eliminado' : 'Layaway deleted', 'success');
    } catch (err) {
      toast(es ? 'Error al eliminar el apartado' : 'Error deleting layaway', 'error');
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteConfirm, es, isDeleting, setLayaways, setInventory, toast]);

  const printLayawayTicket = useCallback((l: any) => {
    const safe   = (v: any) => v == null ? '' : String(v);
    // Round 13 fix: escape HTML for interpolations OUTSIDE the <pre> text block.
    // Content inside <pre> is escaped inline at join time (see text.replace below).
    const escHtml = (s: unknown): string => {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    const moneyC = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const storeName  = (settings.storeName  || 'Go Cellular').toUpperCase();
    const storeAddr  = settings.storeAddress || '';
    const storePhone = settings.storePhone   || '';
    const taxRatePctLocal = ((settings.taxRate || 0.0925) * 100).toFixed(2);
    const totalCents    = l.totalPrice  || 0;
    const paidCents     = l.paidAmount  || 0;
    const balanceCents  = l.balance     ?? (totalCents - paidCents);
    const taxCents      = l.taxAmount   || 0;
    const subtotalCents = totalCents - taxCents;
    const itemDesc = l.itemDescription || l.items?.[0]?.name || '';

    const lines: string[] = [];
    lines.push(storeName);
    // Round 14: defense-in-depth HTML escape even inside pre content
    if (storeAddr)  lines.push(escHtml(storeAddr));
    if (storePhone) lines.push(escHtml(storePhone));
    lines.push('----------------------------------------');
    lines.push(es ? 'COMPROBANTE DE APARTADO' : 'LAYAWAY RECEIPT');
    lines.push(`TICKET: ${safe(l.ticketNumber)}`);
    lines.push(`${es ? 'FECHA' : 'DATE'}: ${new Date().toLocaleString()}`);
    lines.push('----------------------------------------');
    lines.push(`${es ? 'CLIENTE' : 'CUSTOMER'}: ${safe(l.customerName)}`);
    if (l.customerPhone) lines.push(`${es ? 'TEL' : 'PHONE'}: ${safe(l.customerPhone)}`);
    lines.push('----------------------------------------');
    lines.push(`${es ? 'ARTÍCULO' : 'ITEM'}: ${safe(itemDesc)}`);
    if (l.imei)               lines.push(`IMEI: ${safe(l.imei)}`);
    if (l.itemSku)            lines.push(`SKU: ${safe(l.itemSku)}`);
    if (l.dueDate || l.pickupDate) lines.push(`${es ? 'FECHA DE RECOGIDA' : 'PICKUP DATE'}: ${safe(l.dueDate || l.pickupDate)}`);
    // r-layaway-receipt-desglose: format with commas + full tax breakdown
    const fmtMoney = (cents: number) => {
      const abs = Math.abs(cents);
      const str = (abs / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return cents < 0 ? `-$${str}` : `$${str}`;
    };
    const isTaxable = !!(l as any).taxable;
    const effectiveRate = isTaxable ? (settings.taxRate || 0.0925) : 0;

    lines.push('----------------------------------------');
    lines.push(`${es ? 'PRECIO ARTÍCULO' : 'ITEM PRICE'}:    ${fmtMoney(subtotalCents)}`);
    lines.push('─────────────────────────────');
    lines.push(`${es ? 'SUBTOTAL' : 'SUBTOTAL'}:          ${fmtMoney(subtotalCents)}`);
    if (isTaxable && taxCents > 0) {
      lines.push(`${es ? 'IMPUESTO' : 'TAX'} (${taxRatePctLocal}%):  + ${fmtMoney(taxCents)}`);
    }
    lines.push('                         ──────────');
    lines.push(`${es ? 'TOTAL' : 'TOTAL'}:             ${fmtMoney(totalCents)}`);
    lines.push('─────────────────────────────');

    // Deposit breakdown
    if (paidCents > 0) {
      const depSplit = reverseTaxFromPayment(paidCents, effectiveRate, isTaxable);
      lines.push(`${es ? 'DEPÓSITO' : 'DEPOSIT'}:          - ${fmtMoney(paidCents)}`);
      if (isTaxable && depSplit.taxCents > 0) {
        lines.push(`  ${es ? 'Impuesto incl.' : 'Tax included'}:     ${fmtMoney(depSplit.taxCents)}`);
        lines.push(`  ${es ? 'Base pre-impuesto' : 'Pre-tax base'}:   ${fmtMoney(depSplit.baseCents)}`);
      }
    } else {
      lines.push(`${es ? 'DEPÓSITO' : 'DEPOSIT'}:          ${fmtMoney(0)}`);
    }
    lines.push('─────────────────────────────');

    // Balance breakdown
    lines.push(`${es ? 'BALANCE PENDIENTE' : 'BALANCE DUE'}:  ${fmtMoney(balanceCents)}`);
    if (isTaxable && balanceCents > 0) {
      const balSplit = reverseTaxFromPayment(balanceCents, effectiveRate, isTaxable);
      lines.push(`  ${es ? 'Impuesto incl.' : 'Tax included'}:     ${fmtMoney(balSplit.taxCents)}`);
      lines.push(`  ${es ? 'Base pre-impuesto' : 'Pre-tax base'}:   ${fmtMoney(balSplit.baseCents)}`);
    }
    lines.push('─────────────────────────────');
    if (l.notes) { lines.push(`${es ? 'NOTAS' : 'NOTES'}: ${safe(l.notes)}`); lines.push('----------------------------------------'); }
    lines.push(es ? 'CONDICIONES:' : 'CONDITIONS:');
    lines.push(es ? '• El artículo queda reservado hasta la'  : '• Item reserved until pickup date.');
    lines.push(es ? '  fecha de recogida indicada.'           : '• Deposit is non-refundable');
    lines.push(es ? '• El depósito no es reembolsable'        : '  unless otherwise agreed.');
    lines.push(es ? '  salvo acuerdo previo.'                 : '');
    lines.push('----------------------------------------');
    if (l.employeeName) lines.push(`${es ? 'ATENDIDO POR' : 'SERVED BY'}: ${safe(l.employeeName)}`);
    lines.push(es ? '¡Gracias por su preferencia!' : 'Thank you for your business!');
    // Round 14: defense-in-depth HTML escape even inside pre content
    if (settings.storeWebsite) lines.push(escHtml(settings.storeWebsite));

    const text = lines.filter(Boolean).join('\n');
    const html = `<!DOCTYPE html><html><head><title>Layaway ${escHtml(l.ticketNumber)}</title><style>@page{size:4in 6in;margin:0}html,body{width:4in;margin:0;padding:0;font-family:monospace}body{padding:.25in;box-sizing:border-box}pre{font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:0}</style></head><body><pre>${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`;
    printHtml(html, { silent: false, printer: settings.detectedPrinters?.[0] });
  }, [settings, es, printHtml]);

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ padding: '1.5rem', maxWidth: '1100px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>🏷️ {es ? 'Apartados' : 'Layaways'}</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
              {activeCount} {es ? 'activos' : 'active'}
              {overdueCount > 0 && ` • ${overdueCount} ${es ? 'vencidos' : 'overdue'} ⚠️`}
              {completedRevenue > 0 && ` • ${es ? 'Ingresos' : 'Revenue'}: ${formatCurrency(completedRevenue)}`}
            </p>
          </div>
          <button className="btn btn-primary" onClick={openNew}>+ {es ? 'Nuevo Apartado' : 'New Layaway'}</button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => { setStatusFilter(s); setVisibleCount(50); }} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}>
              {s === 'active' ? (es ? 'Activo' : 'Active') : s === 'overdue' ? (es ? 'Vencido' : 'Overdue') : s === 'completed' ? (es ? 'Completado' : 'Completed') : (es ? 'Cancelado' : 'Cancelled')}
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
            placeholder={es ? 'Buscar cliente, artículo, ticket...' : 'Search customer, item, ticket...'}
          />
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏷️</div>
            <p>{es ? 'No hay apartados' : 'No layaways found'}</p>
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
              const paidDollars   = (l.paidAmount  || 0) / 100;
              const balDollars    = (l.balance     || 0) / 100;
              const taxDollars    = (r.taxAmount   || 0) / 100;
              const subDollars    = totalDollars - taxDollars;
              const isActive      = l.status === 'active';

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
                            📦 {es ? 'En inventario' : 'In inventory'}
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
                          ✕ {es ? 'Cancelado' : 'Cancelled'}{r.cancelledAt ? ` — ${String(r.cancelledAt).slice(0,10)}` : ''}
                          {r.depositRefundMethod === 'store_credit' && ` — ${es ? 'Crédito aplicado' : 'Store credit applied'}`}
                          {r.depositRefundMethod === 'cash' && ` — ${es ? 'Reembolso efectivo' : 'Cash refunded'}`}
                          {r.depositRefundMethod === 'forfeit' && ` — ${es ? 'Depósito retenido' : 'Deposit forfeited'}`}
                          {!r.depositRefundMethod && r.depositRefunded !== undefined && (r.depositRefunded ? ` — ${es ? 'Depósito reembolsado' : 'Deposit refunded'}` : ` — ${es ? 'Depósito retenido' : 'Deposit kept'}`)}
                        </div>
                      )}
                      {l.status === 'completed' && (
                        <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#10b981' }}>
                          ✅ {es ? 'Completado' : 'Completed'}{r.completedAt ? ` — ${String(r.completedAt).slice(0,10)}` : ''}
                        </div>
                      )}
                    </div>
                    {/* Right — amounts */}
                    <div style={{ textAlign: 'right', minWidth: '145px', flexShrink: 0 }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Subtotal: <span style={{ color: '#e2e8f0' }}>${subDollars.toFixed(2)}</span></div>
                      {r.taxable && taxDollars > 0 && <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Tax: <span style={{ color: '#e2e8f0' }}>${taxDollars.toFixed(2)}</span></div>}
                      <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Total: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>${totalDollars.toFixed(2)}</span></div>
                      <div style={{ fontSize: '0.78rem', color: '#10b981' }}>{es ? 'Pagado' : 'Paid'}: ${paidDollars.toFixed(2)}</div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: balDollars > 0 ? '#f59e0b' : '#10b981' }}>Balance: ${balDollars.toFixed(2)}</div>
                    </div>
                  </div>
                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    {isActive && (
                      <>
                        <button className="btn btn-success btn-sm" onClick={() => setDepositTarget(l)}>
                          💰 {es ? 'Cobrar Balance' : 'Collect Balance'} (${balDollars.toFixed(2)})
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
                                es ? 'es' : 'en',
                              )
                            )}
                          >
                            📱 WhatsApp
                          </button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => printLayawayTicket(l)}>🖨️ {es ? 'Imprimir' : 'Print'}</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(l)}>✏️ {es ? 'Editar' : 'Edit'}</button>
                        <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }} onClick={() => setCancelTarget(l)}>
                          ✕ {es ? 'Cancelar' : 'Cancel'}
                        </button>
                        <button
                          className="btn btn-sm min-w-[140px]"
                          style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                          onClick={() => setDeleteConfirm(l)}
                          disabled={isDeleting}
                          aria-busy={isDeleting}
                          title={es ? 'Eliminar (solo sin depósito)' : 'Delete (only if no deposit)'}
                        >
                          🗑️ {isDeleting ? (es ? 'Eliminando...' : 'Deleting...') : (es ? 'Eliminar' : 'Delete')}
                        </button>
                      </>
                    )}
                    {(l.status === 'completed' || l.status === 'cancelled') && (
                      <button className="btn btn-secondary btn-sm" onClick={() => printLayawayTicket(l)}>🖨️ {es ? 'Reimprimir' : 'Reprint'}</button>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length > visibleCount && (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <button onClick={() => setVisibleCount((n) => n + 50)} className="btn btn-secondary btn-sm">
                  {es ? `Mostrar más (${filtered.length - visibleCount} restantes)` : `Show more (${filtered.length - visibleCount} remaining)`}
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
              <h3 style={{ margin: 0, fontWeight: 700 }}>🏷️ {editLayaway ? (es ? 'Editar Apartado' : 'Edit Layaway') : (es ? 'Nuevo Apartado' : 'New Layaway')}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

              {/* Name */}
              {/* r-customer-picker-sweep: wrap customer inputs in shared
                  CustomerSearchHeader for explicit "Select Customer" button. */}
              <CustomerSearchHeader
                customers={customers}
                lang={es ? 'es' : 'en'}
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
                    <label className="label">👤 {es ? 'Nombre' : 'First Name'} *</label>
                    <AutocompleteInput
                      value={form.firstName}
                      onChange={(val) => setForm({ ...form, firstName: val })}
                      onSelect={(opt) => {
                        const c = opt.data as Customer;
                        const parts = c.name.trim().split(' ');
                        setForm({ ...form, firstName: parts[0] || opt.value, lastName: parts.slice(1).join(' ') || form.lastName, customerPhone: c.phone || form.customerPhone });
                      }}
                      options={firstNameOptions}
                      placeholder={es ? 'Juan' : 'John'}
                      maxResults={6}
                    />
                  </div>
                  <div>
                    <label className="label">👤 {es ? 'Apellido' : 'Last Name'}</label>
                    <AutocompleteInput
                      value={form.lastName}
                      onChange={(val) => setForm({ ...form, lastName: val })}
                      onSelect={(opt) => {
                        const c = opt.data as Customer;
                        const parts = c.name.trim().split(' ');
                        setForm({ ...form, lastName: parts.slice(1).join(' ') || opt.value, firstName: parts[0] || form.firstName, customerPhone: c.phone || form.customerPhone });
                      }}
                      options={lastNameOptions}
                      placeholder={es ? 'García' : 'Doe'}
                      maxResults={6}
                    />
                  </div>
                </div>

                {/* Phone */}
                <div style={{ marginTop: '0.75rem' }}>
                  <label className="label">📞 {es ? 'Teléfono' : 'Phone'}</label>
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
                  <label className="label" style={{ margin: 0 }}>📱 {es ? 'Artículo' : 'Item'} *</label>
                  <button type="button" onClick={() => setForm({ ...form, manualEntry: !form.manualEntry, inventoryId: '' })}
                    style={{ fontSize: '0.72rem', color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer' }}>
                    {form.manualEntry ? `🔍 ${es ? 'Buscar inventario' : 'Search inventory'}` : `✏️ ${es ? 'Entrada manual' : 'Manual entry'}`}
                  </button>
                </div>
                {!form.manualEntry ? (
                  <>
                    <input className="input" value={itemSearch}
                      onChange={(e) => { setItemSearch(e.target.value); setForm({ ...form, inventoryId: '', itemDescription: e.target.value }); }}
                      onFocus={() => itemResults.length > 0 && setShowItemDropdown(true)}
                      placeholder={es ? 'Buscar por IMEI o nombre...' : 'Search by IMEI or name...'} />
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
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{item.qty} {es ? 'en stock' : 'in stock'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {form.inventoryId && (
                      <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#a78bfa' }}>
                        ✅ {es ? 'Conectado al inventario — se reservará al guardar' : 'Linked to inventory — will be reserved on save'}
                      </div>
                    )}
                  </>
                ) : (
                  <input className="input" value={form.itemDescription}
                    onChange={(e) => setForm({ ...form, itemDescription: e.target.value })}
                    placeholder={es ? 'iPhone 13 128GB Negro' : 'iPhone 13 128GB Black'} />
                )}
                {/* Category */}
                <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{es ? 'Categoría:' : 'Category:'}</span>
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
                <label className="label">🔢 {es ? 'IMEI / # Serie' : 'IMEI / Serial #'}</label>
                <input className="input" value={form.imei} onChange={(e) => setForm({ ...form, imei: e.target.value })} placeholder="356XXXXXXXXX" style={{ fontFamily: 'monospace' }} />
              </div>

              {/* Price + Deposit */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">💵 {es ? 'Precio Total' : 'Total Price'} * ($)</label>
                  <input className="input" type="number" step="0.01" min="0" value={form.totalPrice} onChange={(e) => setForm({ ...form, totalPrice: e.target.value })} placeholder="0.00" style={{ textAlign: 'center', fontWeight: 700 }} />
                </div>
                <div>
                  <label className="label">💰 {es ? 'Depósito' : 'Deposit'} * ($)</label>
                  <input className="input" type="number" step="0.01" min="0" value={form.deposit}
                    onChange={(e) => { if (!editLayaway) setForm({ ...form, deposit: e.target.value }); }}
                    readOnly={!!editLayaway}
                    placeholder="0.00"
                    style={{ textAlign: 'center', fontWeight: 700, color: '#10b981', opacity: editLayaway ? 0.6 : 1, cursor: editLayaway ? 'not-allowed' : undefined }}
                  />
                  {editLayaway && (
                    <p style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.25rem', textAlign: 'center' }}>
                      {es ? 'Total pagado. Usa "Cobrar Balance" para registrar pagos.' : 'Total paid. Use "Collect Balance" to record payments.'}
                    </p>
                  )}
                </div>
              </div>

              {/* Tax */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.6rem 0.875rem', background: form.taxable ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', border: `1px solid ${form.taxable ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}` }}>
                <input type="checkbox" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} />
                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>🧾 {es ? `Con Impuesto (${taxRatePct}%)` : `Taxable (${taxRatePct}%)`}</span>
              </label>

              {/* Totals preview */}
              {subtotal > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '0.875rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', padding: '0.2rem 0' }}>
                    <span>{es ? 'Precio artículo' : 'Item price'}:</span><span>${subtotal.toFixed(2)}</span>
                  </div>
                  {form.taxable && taxAmt > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', padding: '0.2rem 0' }}>
                      <span>{es ? 'Impuesto' : 'Tax'} ({taxRatePct}%):</span><span style={{ color: '#fbbf24' }}>+${taxAmt.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#e2e8f0', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.4rem', marginTop: '0.25rem' }}>
                    <span>= Total{form.taxable ? ` (${es ? 'con impuesto' : 'tax incl.'})` : ''}:</span><span>${grandTotal.toFixed(2)}</span>
                  </div>
                  {depositAmt > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981', padding: '0.2rem 0' }}>
                        <span>− {es ? 'Depósito hoy' : 'Deposit today'}:</span><span>−${depositAmt.toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1rem', color: balanceAmt > 0 ? '#f59e0b' : '#10b981', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.35rem', marginTop: '0.25rem' }}>
                        <span>= {es ? 'Balance pendiente' : 'Balance due'}:</span><span>${balanceAmt.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Pickup + Employee */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">📅 {es ? 'Fecha de Recogida' : 'Pickup Date'}</label>
                  <input className="input" type="date" value={form.pickupDate} onChange={(e) => setForm({ ...form, pickupDate: e.target.value })} min={new Date().toISOString().slice(0, 10)} />
                </div>
                <div>
                  <label className="label">👤 {es ? 'Empleado' : 'Employee'}</label>
                  <input className="input" value={form.employeeName} onChange={(e) => setForm({ ...form, employeeName: e.target.value })} placeholder={currentEmployee?.name || ''} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="label">📝 {es ? 'Notas' : 'Notes'}</label>
                <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={es ? 'Color, condición, notas especiales...' : 'Color, condition, special notes...'} style={{ resize: 'vertical' }} />
              </div>

              {!editLayaway && (
                <div style={{ padding: '0.65rem 0.875rem', background: 'rgba(16,185,129,0.1)', borderRadius: '0.5rem', border: '1px solid rgba(16,185,129,0.3)', fontSize: '0.82rem', color: '#10b981' }}>
                  💡 {es ? 'El depósito se agregará al carrito automáticamente.' : 'Deposit will be automatically added to cart.'}
                </div>
              )}
            </div>
            <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>{es ? 'Cancelar' : 'Cancel'}</button>
              <button className="btn btn-primary min-w-[140px]" style={{ flex: 2 }} onClick={handleSave} disabled={isSaving} aria-busy={isSaving}>💾 {isSaving ? (es ? 'Guardando...' : 'Saving...') : (es ? 'Guardar' : 'Save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* COLLECT BALANCE MODAL */}
      {depositTarget && (() => {
        // Round 14 fix: fall back to totalPrice when items[0].price is 0 or missing (Round 13 ?? only covered null/undefined)
        // Round 15 C1: DepositModal adds tax on top of itemPrice. totalPrice is tax-inclusive,
        // so subtract taxAmount when falling back to avoid double-counting tax in the display.
        const firstItemPrice = depositTarget.items?.[0]?.price ?? 0;
        const totalPreTax = Math.max(0, (depositTarget.totalPrice || 0) - ((depositTarget as any).taxAmount || 0));
        return (
        <DepositModal
          title={es ? `Apartado ${(depositTarget as any).ticketNumber || ''} — Cobrar` : `Layaway ${(depositTarget as any).ticketNumber || ''} — Collect`}
          itemLabel={(depositTarget as any).itemDescription || depositTarget.items?.[0]?.name || 'Layaway Item'}
          itemPrice={(firstItemPrice > 0 ? firstItemPrice : totalPreTax) / 100}
          taxRate={taxRate}
          taxable={(depositTarget as any).taxable || false}
          existingDeposit={(depositTarget.paidAmount || 0) / 100}
          mode="balance"
          lang={lang}
          onClose={() => setDepositTarget(null)}
          onConfirm={({ depositAmt: payAmt }) => handleCollectConfirm(depositTarget, payAmt)}
        />
        );
      })()}

      {cancelTarget && (
        <CancelLayawayModal
          layaway={cancelTarget}
          customerHasPhone={!!cancelTarget.customerPhone}
          customerName={cancelTarget.customerName}
          lang={es ? 'es' : 'en'}
          onClose={() => setCancelTarget(null)}
          onConfirm={(choice) => handleCancel(cancelTarget, choice)}
        />
      )}
      <ConfirmDialog
        open={showImeiWarning}
        title={es ? 'Sin IMEI' : 'No IMEI'}
        message={es
          ? '⚠️ Apartado de teléfono sin IMEI. ¿Continuar de todos modos?'
          : '⚠️ Phone layaway without IMEI. Continue anyway?'}
        variant="warning"
        confirmLabel={es ? 'Continuar' : 'Continue'}
        cancelLabel={es ? 'Cancelar' : 'Cancel'}
        onConfirm={() => { setShowImeiWarning(false); skipImeiCheckRef.current = true; handleSave(); }}
        onCancel={() => setShowImeiWarning(false)}
      />
      <ConfirmDialog
        open={!!deleteConfirm}
        title={es ? 'Eliminar Apartado' : 'Delete Layaway'}
        message={deleteConfirm ? (es
          ? `¿Eliminar apartado ${(deleteConfirm as any).ticketNumber || deleteConfirm.id.slice(-6).toUpperCase()}? Esta acción no se puede deshacer.`
          : `Delete layaway ${(deleteConfirm as any).ticketNumber || deleteConfirm.id.slice(-6).toUpperCase()}? This cannot be undone.`) : ''}
        variant="danger"
        confirmLabel={isDeleting ? (es ? 'Eliminando...' : 'Deleting...') : (es ? 'Eliminar' : 'Delete')}
        cancelLabel={es ? 'Cancelar' : 'Cancel'}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}
