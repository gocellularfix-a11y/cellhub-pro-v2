// ============================================================
// CellHub Pro — Unlock Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, SearchInput, AutocompleteInput, ConfirmDialog } from '@/components/ui';
import { getLabels } from '@/config/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import { sendSms } from '@/services/sms';
import { persist, remove } from '@/services/persist';
import DepositModal from '@/components/DepositModal';
import { calcDepositTotals, reverseTaxFromPayment, forwardTaxFromBase } from '@/utils/depositTax';
import TicketListLayout from '@/components/shared/TicketListLayout';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import TicketCard from '@/components/shared/TicketCard';
import CustomerSearchHeader from '@/components/shared/CustomerSearchHeader';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { usePrint } from '@/hooks/usePrint';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import type { AutocompleteOption } from '@/hooks/useAutocomplete';
import type { Unlock, UnlockType, CartItem, Customer, Sale } from '@/store/types';
import CancelUnlockModal from './CancelUnlockModal';

const STATUSES = ['All', 'Received', 'Processing', 'Code Received', 'Completed', 'Cancelled', 'Failed'];

const STATUS_BADGE: Record<string, string> = {
  'Received': 'badge-info',
  'Processing': 'badge-warning',
  'Code Received': 'badge-success',
  'Completed': 'badge-success',
  'Cancelled': 'badge-danger',
  'Failed': 'badge-danger',
};

export default function UnlockModule() {
  const {
    state: { unlocks, customers, settings, currentEmployee, cart, sales, lang, globalSearchTerm },
    setUnlocks, setCustomers, setCart, setSales, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const { printHtml } = usePrint();
  const L = getLabels(lang);

  const unlocksRef = useRef(unlocks);
  useEffect(() => { unlocksRef.current = unlocks; }, [unlocks]);

  // r-new-5 port: refs to avoid stale closures in handlers (multi-station sync).
  const cartRef = useRef(cart);
  const customersRef = useRef(customers);
  const salesRef = useRef(sales);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { salesRef.current = sales; }, [sales]);

  const [search, setSearch] = useState(globalSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState('All');
  const [visibleCount, setVisibleCount] = useState(50);
  const [showModal, setShowModal] = useState(false);
  const [editUnlock, setEditUnlock] = useState<Unlock | null>(null);
  const [depositModalUnlock, setDepositModalUnlock] = useState<Unlock | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Unlock | null>(null);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Unlock | null>(null);
  const [completeConfirm, setCompleteConfirm] = useState<Unlock | null>(null);

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateStatus = useCallback(
    (s: string) => {
      const map: Record<string, string> = {
        All: L.all, Received: L.received, Processing: L.processing,
        'Code Received': L.codeReceived || 'Code Received',
        Completed: L.completed, Cancelled: L.cancelled, Failed: L.failed || 'Failed',
      };
      return map[s] || s;
    }, [L],
  );

  const normalizeStatus = (s: string) => s.toLowerCase().replace(/ /g, '_');

  const filtered = useMemo(() => {
    return unlocks
      .filter((u) => filterStatus === 'All' || normalizeStatus(u.status) === normalizeStatus(filterStatus))
      .filter((u) => matchesSearch(search, u.customerName, u.customerPhone, u.device, u.imei, u.carrier))
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [unlocks, filterStatus, search]);

  const DONE_UNLOCK = ['completed', 'cancelled', 'failed'];
  const activeCount = useMemo(
    () => unlocks.filter((u) => !DONE_UNLOCK.includes(normalizeStatus(u.status))).length,
    [unlocks],
  );

  // ── Form state (inside modal) ───────────────────────────

  const [form, setForm] = useState<Partial<Unlock>>({});

  // ── Autocomplete options ─────────────────────────────────
  // firstName/lastName split autocomplete options
  const firstNameOptions = useMemo(() =>
    customers.map((c) => {
      const parts = c.name.trim().split(' ');
      return { value: parts[0] || '', label: parts[0] || '', sublabel: c.phone, data: c };
    }).filter((o) => o.value.length > 0),
    [customers],
  );
  const lastNameOptions = useMemo(() => {
    const base = customers
      .filter((c) => !form.firstName || c.name.toLowerCase().startsWith((form.firstName as string || '').toLowerCase()))
      .map((c) => {
        const parts = c.name.trim().split(' ');
        const last = parts.slice(1).join(' ');
        return { value: last, label: last, sublabel: c.phone, data: c };
      }).filter((o) => o.value.length > 0);
    return base.filter((o, i, arr) => arr.findIndex((x) => x.label === o.label) === i);
  }, [customers, form.firstName]);
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


  const openNew = () => {
    setEditUnlock(null);
    const today = new Date().toISOString().slice(0, 10);
    setForm({
      firstName: '', lastName: '', customerPhone: '', device: '', imei: '',
      carrier: '', price: 0, cost: 0, depositAmount: 0, balance: 0,
      status: 'Received', notes: '',
      unlockType: '', unlockCode: '', supplier: '',
      orderDate: today, completionDate: '',
      taxable: false,
    } as any);
    setShowModal(true);
  };

  const openEdit = (u: Unlock) => {
    setEditUnlock(u);
    // Storage is in cents — convert to dollars for the form inputs
    setForm({
      ...u,
      price: (u.price || 0) / 100,
      cost: (u.cost || 0) / 100,
      depositAmount: (u.depositAmount || 0) / 100,
    });
    setShowModal(true);
  };

  // r-new-6 port: pending per unlock, tax-inclusive (matches register total).
  const pendingByUnlockId = useMemo(() => {
    const map = new Map<string, number>();
    const taxRate = settings.taxRate || 0.0925;
    for (const item of cart) {
      if (!item.unlockId) continue;
      const itemBaseCents = (item.price || 0) * (item.qty || 1);
      const fwd = forwardTaxFromBase(itemBaseCents, taxRate, !!item.taxable);
      const prev = map.get(item.unlockId) || 0;
      map.set(item.unlockId, prev + fwd.totalCents);
    }
    return map;
  }, [cart, settings.taxRate]);

  // r-new-5 port: ensures invariant "one unlock has at most one cart item at any time".
  // `additionalCents` is TAX-INCLUSIVE. Combines with any existing cart items for this
  // unlock (forward-taxed), then reverse-taxes the total to a single new cart item.
  const consolidateCartForUnlock = useCallback((params: {
    unlockId: string;
    additionalCents: number;
    device: string;
    isTaxable: boolean;
  }): { combinedCents: number } => {
    const { unlockId, additionalCents, device, isTaxable } = params;
    const taxRate = settings.taxRate || 0.0925;

    const existingItems = cartRef.current.filter((c) => c.unlockId === unlockId);
    let combinedCents = additionalCents;
    for (const existing of existingItems) {
      const existingBase = (existing.price || 0) * (existing.qty || 1);
      const existingFwd = forwardTaxFromBase(existingBase, taxRate, !!existing.taxable);
      combinedCents += existingFwd.totalCents;
    }

    const split = reverseTaxFromPayment(combinedCents, taxRate, isTaxable);
    const consolidatedItem: CartItem = {
      id: generateId(),
      name: `${device} — ${lang === 'es' ? 'Desbloqueo' : 'Unlock'}`,
      category: 'service',
      price: split.baseCents,
      qty: 1,
      taxable: isTaxable,
      cbeEligible: false,
      unlockId,
      notes: unlockId.slice(-6).toUpperCase(),
    };

    const nextCart = [
      ...cartRef.current.filter((c) => c.unlockId !== unlockId),
      consolidatedItem,
    ];
    cartRef.current = nextCart;
    setCart(nextCart);

    return { combinedCents };
  }, [settings.taxRate, lang, setCart]);

  const handleSave = useCallback(() => {
    const firstName = (form.firstName as string || '').trim();
    const lastName  = (form.lastName  as string || '').trim();
    const customerName = `${firstName} ${lastName}`.trim();
    if (!customerName) {
      toast(lang === 'es' ? 'Nombre del cliente requerido' : 'Customer name required', 'error');
      return;
    }
    if (!form.customerPhone?.trim()) {
      toast(lang === 'es' ? 'Teléfono requerido' : 'Phone required', 'error');
      return;
    }
    if (!form.device?.trim()) {
      toast(lang === 'es' ? 'Dispositivo requerido' : 'Device required', 'error');
      return;
    }

    // Form values are in DOLLARS — convert to cents for storage and calculations.
    // All persisted fields (price, cost, depositAmount, balance) are in CENTS,
    // matching the rest of the system (TicketCard, formatCurrency, DepositModal).
    const priceCents   = Math.round((form.price || 0) * 100);
    const costCents    = Math.round((form.cost || 0) * 100);
    const depositCents = Math.round((form.depositAmount || 0) * 100);
    const taxable = !!(form as any).taxable;
    const taxRate = settings.taxRate || 0.0925;
    const _t = calcDepositTotals(priceCents, depositCents, taxRate, taxable);
    const balance = _t.balanceCents;

    if (depositCents > _t.totalWithTaxCents + 1) {
      toast(lang === 'es' ? 'El depósito no puede exceder el total' : 'Deposit cannot exceed total', 'error');
      return;
    }

    const normalizedImei = (form.imei || '').replace(/\s+/g, '').trim();

    // Auto-create customer — dedup by phone
    if (form.customerPhone) {
      const phone = normalizePhone(form.customerPhone);
      const existing = customers.find((c) => normalizePhone(c.phone) === phone);
      if (existing) {
        if (existing.name.toLowerCase() !== customerName.toLowerCase()) {
          toast(
            lang === 'es'
              ? `Cliente existente encontrado: ${existing.name}`
              : `Existing customer found: ${existing.name}`,
            'info',
          );
        }
      } else if (customerName) {
        const newCust: Customer = {
          id: generateId(), firstName, lastName, name: customerName, phone: form.customerPhone,
          email: '', loyaltyPoints: 0, storeCredit: 0,
          customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-4)}`,
          notes: '', smsConsent: false, createdAt: new Date().toISOString(),
        };
        setCustomers([...customers, newCust]);
        persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
      }
    }

    if (editUnlock) {
      // Auto-set completionDate the first time it transitions to completed
      const justCompleted =
        form.status === 'Completed' && editUnlock.status !== 'Completed';
      const completionDate = justCompleted && !form.completionDate
        ? new Date().toISOString().slice(0, 10)
        : form.completionDate;

      // r-deposit-integrity-1 EDIT guard: never overwrite depositAmount from form.
      const lockedDeposit = editUnlock.depositAmount || 0;
      const newPrice = priceCents;
      const taxAmt = taxable ? Math.round(newPrice * taxRate) : 0;
      const newTotalWithTax = newPrice + taxAmt;
      const lockedBalance = Math.max(0, newTotalWithTax - lockedDeposit);

      const updated: Unlock = {
        ...editUnlock, ...form, customerName,
        price: priceCents,
        cost: costCents,
        depositAmount: lockedDeposit,
        balance: lockedBalance,
        imei: normalizedImei,
        completionDate,
        updatedAt: new Date().toISOString(),
      } as Unlock;
      const nextUnlocks = unlocksRef.current.map((u) => (u.id === editUnlock.id ? updated : u));
      unlocksRef.current = nextUnlocks;
      setUnlocks(nextUnlocks);
        persist.unlock(updated.id, updated as unknown as Record<string, unknown>);

      // Auto-SMS on completion
      if (updated.status === 'Completed' && editUnlock.status !== 'Completed' &&
          settings.smsAutoUnlockReady && updated.customerPhone) {
        const codeLine = updated.unlockCode
          ? (lang === 'es' ? ` Código: ${updated.unlockCode}.` : ` Code: ${updated.unlockCode}.`)
          : '';
        const msg = lang === 'es'
          ? `Hola ${customerName}, su desbloqueo está listo.${codeLine} ${settings.storeName || 'CellHub Pro'}`
          : `Hi ${customerName}, your unlock is ready!${codeLine} ${settings.storeName || 'CellHub Pro'}`;
        sendSms(updated.customerPhone, msg, settings).catch(console.error);
      }
      toast(L.saved || 'Saved!', 'success');
    } else {
      const newUnlock: Unlock = {
        id: generateId(), ...form, customerName,
        // Override with cents — form values are dollars, storage is cents
        price: priceCents,
        cost: costCents,
        // r-deposit-integrity-1 P1: deposit lives in cart until POS checkout
        // confirms. Entity persists with depositAmount=0 and full balance.
        depositAmount: 0,
        balance: _t.totalWithTaxCents,
        imei: normalizedImei,
        status: form.status || 'Received',
        employeeName: currentEmployee?.name,
        employeeId: currentEmployee?.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Unlock;
      const nextUnlocks = [...unlocksRef.current, newUnlock];
      unlocksRef.current = nextUnlocks;
      setUnlocks(nextUnlocks);
        persist.unlock(newUnlock.id, newUnlock as unknown as Record<string, unknown>);

      if (depositCents > 0) {
        consolidateCartForUnlock({
          unlockId: newUnlock.id,
          additionalCents: depositCents,
          device: newUnlock.device || '',
          isTaxable: taxable,
        });

        const customerId = (newUnlock as any).customerId;
        if (customerId) {
          dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: customerId });
        } else if (newUnlock.customerPhone) {
          const phoneTail = newUnlock.customerPhone.replace(/\D/g, '').slice(-10);
          const matched = customersRef.current.find((c) => {
            const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
            return cPhone && cPhone === phoneTail;
          });
          if (matched) {
            dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: matched.id });
          }
        }

        toast(
          lang === 'es'
            ? `Desbloqueo creado. Depósito ${formatCurrency(depositCents)} agregado al carrito.`
            : `Unlock created. Deposit ${formatCurrency(depositCents)} added to cart.`,
          'info',
        );
      } else {
        toast(L.unlockCreated || 'Unlock created!', 'success');
      }
    }

    setShowModal(false);
    setEditUnlock(null);
  }, [form, editUnlock, customers, settings, currentEmployee, lang, L,
      setUnlocks, setCustomers, setCart, toast, consolidateCartForUnlock, dispatch]);

  const collectBalance = useCallback((u: Unlock) => {
    if (!u.balance || u.balance <= 0) return;
    const taxable = !!(u as any).taxable;
    const { combinedCents } = consolidateCartForUnlock({
      unlockId: u.id,
      additionalCents: u.balance,
      device: u.device || '',
      isTaxable: taxable,
    });

    const customerId = (u as any).customerId;
    if (customerId) {
      dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: customerId });
    } else if (u.customerPhone) {
      const phoneTail = u.customerPhone.replace(/\D/g, '').slice(-10);
      const matched = customersRef.current.find((c) => {
        const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
        return cPhone && cPhone === phoneTail;
      });
      if (matched) {
        dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: matched.id });
      }
    }

    toast(
      lang === 'es'
        ? `$${(combinedCents / 100).toFixed(2)} en carrito para este desbloqueo`
        : `$${(combinedCents / 100).toFixed(2)} in cart for this unlock`,
      'info',
    );
  }, [consolidateCartForUnlock, dispatch, lang, toast]);

  // r-new-4 port: cancel with deposit disposition (store_credit / cash / forfeit).
  // R9-1: cash refund marks original sale(s) as refunded so Reports excludes them
  // from Gross/Cash/Profit. A voided REFUND-* audit sale is also created.
  const handleCancelUnlock = useCallback((unlock: Unlock, choice: {
    method: 'store_credit' | 'cash' | 'forfeit';
    note: string;
  }) => {
    const depositCents = unlock.depositAmount || 0;
    const now = new Date().toISOString();

    if (choice.method === 'store_credit' && depositCents > 0) {
      const phoneTail = (unlock.customerPhone || '').replace(/\D/g, '').slice(-10);
      const matched = customersRef.current.find((c) => {
        if ((unlock as any).customerId && c.id === (unlock as any).customerId) return true;
        if (phoneTail) {
          const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
          if (cPhone && cPhone === phoneTail) return true;
        }
        return false;
      });
      if (matched) {
        const updatedCustomer = {
          ...matched,
          storeCredit: (matched.storeCredit || 0) + depositCents,
        };
        const nextCustomers = customersRef.current.map((c) =>
          c.id === matched.id ? updatedCustomer : c
        );
        customersRef.current = nextCustomers;
        setCustomers(nextCustomers);
        persist.customer(updatedCustomer.id, updatedCustomer as unknown as Record<string, unknown>);
      } else {
        toast(
          lang === 'es'
            ? '⚠️ No se identificó al cliente. Aplica crédito manualmente.'
            : '⚠️ Customer not matched. Apply credit manually.',
          'warning',
        );
      }
    } else if (choice.method === 'cash' && depositCents > 0) {
      // R9-1: mark original sale(s) containing this unlock as refunded.
      const originalSales = salesRef.current.filter((s: Sale) =>
        (s.items || []).some((item: any) => item.unlockId === unlock.id)
        && s.status !== 'voided'
        && s.status !== 'refunded'
      );
      const markedSales = originalSales.map((s: Sale) => ({
        ...s,
        status: 'refunded' as Sale['status'],
        refundedAt: now,
        refundReason: `Unlock Cancel: ${choice.note || 'no note'}`,
        refundMethod: 'cash',
      }));
      for (const ms of markedSales) {
        persist.sale(ms.id, ms as unknown as Record<string, unknown>);
      }

      const refundSale: Sale = {
        id: generateId(),
        storeId: (unlock as any).storeId,
        invoiceNumber: `REFUND-${unlock.id.slice(-6).toUpperCase()}`,
        customerId: (unlock as any).customerId,
        customerName: unlock.customerName,
        customerPhone: unlock.customerPhone,
        items: [{
          id: generateId(),
          name: `${unlock.device || 'Unlock'} — ${lang === 'es' ? 'Reembolso cancelación' : 'Cancellation refund'}`,
          category: 'service' as any,
          price: -depositCents,
          qty: 1,
          taxable: false,
          cbeEligible: false,
          unlockId: unlock.id,
        }],
        subtotal: -depositCents,
        taxAmount: 0,
        cbeTotal: 0,
        total: -depositCents,
        paymentMethod: 'Cash' as any,
        status: 'voided',
        employeeId: currentEmployee?.id,
        employeeName: currentEmployee?.name,
        notes: `Unlock cancelled — cash refund for ${unlock.id.slice(-6).toUpperCase()}`,
        refundReason: 'Unlock cancelled',
        createdAt: now,
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

    const updated = {
      ...unlock,
      status: 'Cancelled' as any,
      depositRefundMethod: choice.method,
      depositRefundAmount: depositCents,
      cancellationNote: choice.note || '',
      cancelledAt: now,
      depositAmount: 0,
      balance: 0,
      updatedAt: now,
    } as unknown as Unlock;
    const nextUnlocks = unlocksRef.current.map((u) => u.id === unlock.id ? updated : u);
    unlocksRef.current = nextUnlocks;
    setUnlocks(nextUnlocks);
    persist.unlock(updated.id, updated as unknown as Record<string, unknown>);

    const msg = {
      store_credit: lang === 'es'
        ? `Cancelado. Crédito $${(depositCents/100).toFixed(2)} agregado al cliente.`
        : `Cancelled. $${(depositCents/100).toFixed(2)} store credit added.`,
      cash: lang === 'es'
        ? `Cancelado. Reembolso $${(depositCents/100).toFixed(2)} registrado.`
        : `Cancelled. $${(depositCents/100).toFixed(2)} cash refund recorded.`,
      forfeit: lang === 'es' ? 'Cancelado. Depósito retenido.' : 'Cancelled. Deposit forfeited.',
    }[choice.method];
    toast(msg, 'success');
    setCancelTarget(null);
  }, [lang, setCustomers, setUnlocks, setSales, currentEmployee, toast]);

  const handleComplete = useCallback((unlock: Unlock) => {
    const balance = unlock.balance || 0;
    const deposit = unlock.depositAmount || 0;

    if (balance === 0 && deposit === 0) {
      const updated: Unlock = { ...unlock, status: 'Completed' as any, updatedAt: new Date().toISOString() };
      const next = unlocksRef.current.map((u) => u.id === unlock.id ? updated : u);
      unlocksRef.current = next;
      setUnlocks(next);
      persist.unlock(updated.id, updated as unknown as Record<string, unknown>);
      toast(lang === 'es' ? 'Desbloqueo completado' : 'Unlock completed', 'success');
      return;
    }
    setCompleteConfirm(unlock);
  }, [setUnlocks, toast, lang]);

  const handleCompleteConfirmed = useCallback(() => {
    const unlock = completeConfirm;
    if (!unlock) return;

    if ((unlock.balance || 0) > 0) {
      const isTaxable = !!(unlock as any).taxable;
      consolidateCartForUnlock({
        unlockId: unlock.id,
        additionalCents: unlock.balance,
        device: unlock.device || '',
        isTaxable,
      });
      const customerId = (unlock as any).customerId;
      if (customerId) {
        dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: customerId });
      } else if (unlock.customerPhone) {
        const phoneTail = unlock.customerPhone.replace(/\D/g, '').slice(-10);
        const matched = customersRef.current.find((c) => {
          const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
          return cPhone && cPhone === phoneTail;
        });
        if (matched) {
          dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: matched.id });
        }
      }
    }

    const updated: Unlock = { ...unlock, status: 'Completed' as any, updatedAt: new Date().toISOString() };
    const next = unlocksRef.current.map((u) => u.id === unlock.id ? updated : u);
    unlocksRef.current = next;
    setUnlocks(next);
    persist.unlock(updated.id, updated as unknown as Record<string, unknown>);

    // Preserve auto-SMS on completion (Round 6-pre behavior).
    if ((settings as any).smsAutoUnlockReady && updated.customerPhone) {
      const codeLine = updated.unlockCode
        ? (lang === 'es' ? ` Código: ${updated.unlockCode}.` : ` Code: ${updated.unlockCode}.`)
        : '';
      const msg = lang === 'es'
        ? `Hola ${updated.customerName}, su desbloqueo está listo.${codeLine} ${settings.storeName || 'CellHub Pro'}`
        : `Hi ${updated.customerName}, your unlock is ready!${codeLine} ${settings.storeName || 'CellHub Pro'}`;
      sendSms(updated.customerPhone, msg, settings).catch(console.error);
    }

    setCompleteConfirm(null);
    toast(
      (unlock.balance || 0) > 0
        ? (lang === 'es' ? 'Balance agregado al carrito. Ve a POS.' : 'Balance added to cart. Go to POS.')
        : (lang === 'es' ? 'Desbloqueo completado' : 'Unlock completed'),
      'success',
    );
  }, [completeConfirm, consolidateCartForUnlock, setUnlocks, dispatch, settings, toast, lang]);

  const handleSMSButton = useCallback((unlock: Unlock) => {
    if (!unlock.customerPhone) return;
    const codeLine = unlock.unlockCode
      ? (lang === 'es' ? ` Código: ${unlock.unlockCode}.` : ` Code: ${unlock.unlockCode}.`)
      : '';
    const msg = lang === 'es'
      ? `Hola ${unlock.customerName}, su desbloqueo está listo.${codeLine} ${settings.storeName || 'CellHub Pro'}`
      : `Hi ${unlock.customerName}, your unlock is ready!${codeLine} ${settings.storeName || 'CellHub Pro'}`;
    sendSms(unlock.customerPhone, msg, settings).catch(console.error);
    toast(lang === 'es' ? 'SMS enviado' : 'SMS sent', 'success');
  }, [settings, lang, toast]);

  const handleDeleteConfirmed = useCallback(() => {
    if (!deleteConfirm) return;

    const hasPendingCart = cartRef.current.some((item) => item.unlockId === deleteConfirm.id);
    if (hasPendingCart) {
      toast(
        lang === 'es'
          ? 'No se puede eliminar: hay items en el carrito.'
          : 'Cannot delete: has cart items.',
        'error',
      );
      setDeleteConfirm(null);
      return;
    }

    const hasDeposit = (deleteConfirm.depositAmount || 0) > 0;
    const isCompleted = ['Completed', 'Code Received'].includes(deleteConfirm.status);
    if (hasDeposit || isCompleted) {
      toast(
        lang === 'es'
          ? 'No se puede eliminar desbloqueos pagados o completados. Usa "Cancelar".'
          : 'Cannot delete paid or completed unlocks. Use "Cancel".',
        'error',
      );
      setDeleteConfirm(null);
      return;
    }

    const next = unlocksRef.current.filter((u) => u.id !== deleteConfirm.id);
    unlocksRef.current = next;
    setUnlocks(next);
    remove.unlock(deleteConfirm.id);
    setDeleteConfirm(null);
    toast(lang === 'es' ? 'Desbloqueo eliminado' : 'Unlock deleted', 'success');
  }, [deleteConfirm, setUnlocks, toast, lang]);

  // ── Print 4x6 thermal ticket ─────────────────────────────
  const printTicket = useCallback(() => {
    const storeName = settings.storeName || 'CellHub Pro';
    const storeAddr = settings.storeAddress || '';
    const storePhone = settings.storePhone || '';
    const firstName = (form.firstName as string || '').trim();
    const lastName  = (form.lastName  as string || '').trim();
    const customerName = `${firstName} ${lastName}`.trim() || form.customerName || '';
    const fmt = (v: unknown) => v == null ? '' : String(v);
    const money = (v: number) => `$${(v / 100).toFixed(2)}`;
    const typeLabel = (t?: string) => {
      if (!t) return '';
      return ({ factory: 'Factory', imei: 'IMEI', subsidy: 'Subsidy', custom: 'Custom' } as Record<string, string>)[t] || t;
    };
    const ticketNum = editUnlock ? editUnlock.id.slice(-8).toUpperCase() : 'NEW';
    const lines = [
      storeName.toUpperCase(), storeAddr,
      storePhone, '----------------------------------------',
      `UNLOCK TICKET: ${ticketNum}`,
      `STATUS: ${fmt(form.status)}`,
      `DATE: ${new Date().toLocaleString()}`,
      '----------------------------------------',
      `CUSTOMER: ${customerName}`,
      form.customerPhone ? `PHONE: ${fmt(form.customerPhone)}` : '',
      '----------------------------------------',
      `DEVICE: ${fmt(form.device)}`,
      `CARRIER: ${fmt(form.carrier)}`,
      form.imei ? `IMEI: ${fmt(form.imei)}` : '',
      form.unlockType ? `TYPE: ${typeLabel(form.unlockType as string)}` : '',
      form.supplier ? `SUPPLIER: ${fmt(form.supplier)}` : '',
      form.unlockCode ? `CODE: ${fmt(form.unlockCode)}` : '',
      '----------------------------------------',
      form.orderDate ? `ORDERED: ${fmt(form.orderDate)}` : '',
      form.completionDate ? `COMPLETED: ${fmt(form.completionDate)}` : '',
      '----------------------------------------',
      `PRICE: ${money(Math.round((form.price || 0) * 100))}`,
      `DEPOSIT: ${money(Math.round((form.depositAmount || 0) * 100))}`,
      `BALANCE: ${money(Math.max(0, Math.round(((form.price || 0) - (form.depositAmount || 0)) * 100)))}`,
      '----------------------------------------',
      form.notes ? 'NOTES:' : '',
      form.notes ? fmt(form.notes) : '',
    ].filter(Boolean);
    const content = lines.join('\n');
    const html = `<!DOCTYPE html><html><head><title>Unlock Ticket</title><style>@page{size:4in 6in;margin:0}html,body{width:4in;height:6in;margin:0;padding:0}body{font-family:monospace}.paper{width:4in;height:6in;padding:.25in;box-sizing:border-box}pre{font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:0}</style></head><body><div class="paper"><pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div></body></html>`;
    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });
  }, [form, editUnlock, settings, printHtml]);

  return (
    <>
      <TicketListLayout
        title={L.unlocks || 'Unlocks'}
        icon="🔓"
        statuses={STATUSES}
        activeStatus={filterStatus}
        onStatusChange={(s) => { setFilterStatus(s); setVisibleCount(50); }}
        translateStatus={translateStatus}
        // r-global-search: search props removed; GlobalSearchBar mounted via slot.
        globalSearchSlot={
          <GlobalSearchBar
            localValue={search}
            onLocalChange={(s) => { setSearch(s); setVisibleCount(50); }}
            excludeCollection="unlocks"
            placeholder={lang === 'es' ? 'Buscar cliente, dispositivo, IMEI, operador…' : 'Search customer, device, IMEI, carrier…'}
          />
        }
        stats={[
          { label: L.activeUnlocks || 'Active', value: activeCount, color: 'text-purple-400' },
          { label: L.completed || 'Completed', value: unlocks.filter((u) => normalizeStatus(u.status) === 'completed').length, color: 'text-emerald-400' },
          { label: L.total || 'Total', value: unlocks.length },
        ]}
        onNew={openNew}
        newLabel={L.newUnlock || 'New Unlock'}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <span className="text-4xl block mb-3">🔓</span>
            <p>No unlocks found</p>
          </div>
        ) : (
          filtered.slice(0, visibleCount).map((u) => (
            <TicketCard
              ref={isHighlighted(u.id) ? highlightRef : null}
              highlighted={isHighlighted(u.id)}
              key={u.id}
              ticketNumber={u.id.slice(-8).toUpperCase()}
              customerName={u.customerName}
              customerPhone={u.customerPhone}
              device={`${u.device} (${u.carrier})`}
              issue={u.imei ? `IMEI: ${u.imei}` : undefined}
              status={u.status}
              statusBadgeClass={STATUS_BADGE[u.status] || 'badge-neutral'}
              total={u.price}
              deposit={u.depositAmount}
              balance={u.balance}
              pendingCents={pendingByUnlockId.get(u.id) || 0}
              createdAt={u.createdAt as string}
              onClick={() => openEdit(u)}
              onDeposit={
                !['Cancelled', 'Completed', 'Code Received'].includes(u.status) && (u.balance || 0) > 0
                  ? () => setDepositModalUnlock(u)
                  : undefined
              }
              onComplete={() => handleComplete(u)}
              completeLabel={
                u.status === 'Cancelled'
                  ? (lang === 'es' ? 'Cancelado' : 'Cancelled')
                  : u.status === 'Completed'
                  ? (lang === 'es' ? '✓ Completado' : '✓ Completed')
                  : u.status === 'Code Received'
                  ? (lang === 'es' ? 'Código Recibido' : 'Code Received')
                  : (u.balance || 0) > 0
                  ? (lang === 'es' ? `Completar / Cobrar ${formatCurrency(u.balance)}` : `Complete / Collect ${formatCurrency(u.balance)}`)
                  : (lang === 'es' ? 'Marcar completado' : 'Mark completed')
              }
              completeDisabled={['Cancelled', 'Completed'].includes(u.status)}
              completeVariant={u.status === 'Completed' ? 'green' : 'amber'}
              onPrint={undefined}
              onSMS={() => handleSMSButton(u)}
              onDelete={() => setDeleteConfirm(u)}
              smsAvailable={!!(settings.smsProvider && settings.smsProvider !== 'none' && u.customerPhone)}
              onWhatsApp={settings.waEnabled !== false && u.customerPhone ? () => openWhatsApp(
                u.customerPhone,
                buildWaMessage(
                  ['Completed', 'Code Received'].includes(u.status) ? 'repairReady' : 'balanceDue',
                  {
                    customerName: u.customerName,
                    storeName: settings.storeName || 'Go Cellular',
                    storePhone: settings.storePhone,
                    device: `${u.device} (${u.carrier})`,
                    balance: u.balance > 0 ? `$${(u.balance / 100).toFixed(2)}` : undefined,
                    ticketNumber: u.id.slice(-8).toUpperCase(),
                  },
                  lang as 'en' | 'es',
                )
              ) : undefined}
              lang={lang}
              L={L}
            />
          ))
        )}

          {filtered.length > visibleCount && (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <button
                onClick={() => setVisibleCount((n) => n + 50)}
                className="btn btn-secondary btn-sm"
              >
                {lang === 'es'
                  ? `Mostrar más (${filtered.length - visibleCount} restantes)`
                  : `Show more (${filtered.length - visibleCount} remaining)`}
              </button>
            </div>
          )}
      </TicketListLayout>

      {/* Unlock Modal */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditUnlock(null); }}
        title={`🔓 ${editUnlock ? 'Edit Unlock' : 'New Unlock'}`}
        size="max-w-lg"
      >
        <div className="space-y-3">
          {/* r-customer-picker-sweep: wrap customer inputs in shared
              CustomerSearchHeader. The 3 AutocompleteInputs below are kept
              as-is — they still provide per-field autocomplete on top of
              the header search button. */}
          <CustomerSearchHeader
            customers={customers}
            lang={lang === 'es' ? 'es' : 'en'}
            onSelect={(c) => {
              const parts = c.name.trim().split(/\s+/);
              setForm({
                ...form,
                firstName: parts[0] || '',
                lastName: parts.slice(1).join(' ') || '',
                customerPhone: c.phone || '',
                customerName: c.name || '',
              });
            }}
          >
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Nombre *' : 'First Name *'}</label>
                <AutocompleteInput
                  value={(form.firstName as string) || ''}
                  onChange={(val) => setForm({ ...form, firstName: val })}
                  onSelect={(opt) => {
                    setForm({ ...form, firstName: opt.value,
                      lastName: (form.lastName as string) || (opt.data as Customer)?.name?.split(' ').slice(1).join(' ') || '',
                      customerPhone: (opt.data as Customer)?.phone || form.customerPhone || '' });
                  }}
                  options={firstNameOptions}
                  placeholder={lang === 'es' ? 'Jorge' : 'John'}
                  maxResults={6}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Apellido' : 'Last Name'}</label>
                <AutocompleteInput
                  value={(form.lastName as string) || ''}
                  onChange={(val) => setForm({ ...form, lastName: val })}
                  onSelect={(opt) => {
                    setForm({ ...form, lastName: opt.value,
                      firstName: (form.firstName as string) || (opt.data as Customer)?.name?.split(' ')[0] || '',
                      customerPhone: (opt.data as Customer)?.phone || form.customerPhone || '' });
                  }}
                  options={lastNameOptions}
                  placeholder={lang === 'es' ? 'Ochoa' : 'Doe'}
                  maxResults={6}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Phone</label>
                <AutocompleteInput
                  type="tel"
                  value={form.customerPhone || ''}
                  onChange={(val) => setForm({ ...form, customerPhone: val })}
                  onSelect={(opt) => {
                    setForm({ ...form, customerPhone: opt.value, customerName: (opt.data as Customer)?.name || form.customerName || '' });
                  }}
                  options={phoneOptions}
                  placeholder="(555) 123-4567"
                  maxResults={6}
                  matchHint={phoneMatch ? (
                    <span style={{ fontSize: '0.72rem', color: '#34d399' }}>&#10003; {phoneMatch.name}</span>
                  ) : undefined}
                />
              </div>
            </div>
          </CustomerSearchHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">IMEI</label>
              <input
                value={form.imei || ''}
                onChange={(e) => setForm({ ...form, imei: e.target.value })}
                className="input"
                maxLength={15}
                inputMode="numeric"
                placeholder="15 digits"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Device</label>
              <AutocompleteInput
                value={form.device || ''}
                onChange={(val) => setForm({ ...form, device: val })}
                onSelect={(opt) => setForm({ ...form, device: opt.value })}
                options={DEVICE_MODEL_OPTIONS}
                placeholder="iPhone 14 Pro"
                maxResults={8}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Carrier</label>
              <AutocompleteInput
                value={form.carrier || ''}
                onChange={(val) => setForm({ ...form, carrier: val })}
                onSelect={(opt) => setForm({ ...form, carrier: opt.value })}
                options={CARRIER_OPTIONS}
                placeholder="AT&T, T-Mobile..."
                maxResults={8}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Price ($)</label>
              <input type="number" value={form.price || ''} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} className="input" step="0.01" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Cost ($)</label>
              <input type="number" value={form.cost || ''} onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} className="input" step="0.01" placeholder="Supplier cost" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Deposit ($)</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={form.depositAmount || ''}
                  onChange={(e) => setForm({ ...form, depositAmount: parseFloat(e.target.value) || 0 })}
                  className="input"
                  step="0.01"
                  disabled={!!editUnlock}
                  style={editUnlock ? { opacity: 0.6 } : undefined}
                />
                {editUnlock && (
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '1rem' }}>
                    🔒
                  </span>
                )}
              </div>
              {editUnlock && (
                <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  {lang === 'es' ? 'Depósito bloqueado — se cobra solo vía POS' : 'Deposit locked — collected via POS'}
                </p>
              )}
            </div>
          </div>

          {/* Unlock type + supplier */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Tipo de desbloqueo' : 'Unlock Type'}</label>
              <select
                value={form.unlockType || ''}
                onChange={(e) => setForm({ ...form, unlockType: e.target.value as UnlockType })}
                className="select"
              >
                <option value="">—</option>
                <option value="factory">Factory</option>
                <option value="imei">IMEI</option>
                <option value="subsidy">Subsidy</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Proveedor' : 'Supplier'}</label>
              <input
                value={form.supplier || ''}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                className="input"
                placeholder="DoctorSIM, UnlockBoot..."
              />
            </div>
          </div>

          {/* Unlock code */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {lang === 'es' ? 'Código de desbloqueo' : 'Unlock Code'}
              <span className="text-slate-500 ml-1">({lang === 'es' ? 'del proveedor' : 'from supplier'})</span>
            </label>
            <input
              value={form.unlockCode || ''}
              onChange={(e) => setForm({ ...form, unlockCode: e.target.value })}
              className="input"
              placeholder="NCK / FRP bypass / Factory code..."
              style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
            />
          </div>

          {/* Dates + status */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Fecha de orden' : 'Order Date'}</label>
              <input
                type="date"
                value={form.orderDate || ''}
                onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{lang === 'es' ? 'Fecha completado' : 'Completion Date'}</label>
              <input
                type="date"
                value={form.completionDate || ''}
                onChange={(e) => setForm({ ...form, completionDate: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Status</label>
              <select value={form.status || 'Received'} onChange={(e) => setForm({ ...form, status: e.target.value as any })} className="select">
                {['Received', 'Processing', 'Code Received', 'Completed', 'Cancelled', 'Failed'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Notes</label>
            <textarea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="textarea" rows={2} />
          </div>

          {/* Tax toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.08)' }}>
            <input
              type="checkbox"
              id="unlock-taxable"
              checked={!!(form as any).taxable}
              onChange={(e) => setForm({ ...form, taxable: e.target.checked } as any)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="unlock-taxable" style={{ fontSize: '0.82rem', color: '#cbd5e1', cursor: 'pointer' }}>
              {lang === 'es' ? `Aplicar impuesto (${((settings.taxRate || 0.0925) * 100).toFixed(2)}%)` : `Apply tax (${((settings.taxRate || 0.0925) * 100).toFixed(2)}%)`}
            </label>
            <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: 'auto' }}>
              {lang === 'es' ? 'Por defecto OFF' : 'Default OFF'}
            </span>
          </div>

          {/* Totals */}
          {(form.price || 0) > 0 && (() => {
            const previewPriceCents = Math.round((form.price || 0) * 100);
            const previewDepositCents = Math.round((form.depositAmount || 0) * 100);
            const _t = calcDepositTotals(previewPriceCents, previewDepositCents, settings.taxRate || 0.0925, !!(form as any).taxable);
            return (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', padding: '0.875rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 700, padding: '0.2rem 0' }}>
                <span>Service Price:</span><span>{formatCurrency(_t.subtotalCents)}</span>
              </div>
              {(form as any).taxable && _t.taxCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', padding: '0.2rem 0' }}>
                  <span>+ Tax ({((settings.taxRate || 0.0925) * 100).toFixed(2)}%):</span><span>+{formatCurrency(_t.taxCents)}</span>
                </div>
              )}
              {(form as any).taxable && _t.taxCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 700, padding: '0.2rem 0', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.25rem', paddingTop: '0.3rem' }}>
                  <span>Total w/ Tax:</span><span>{formatCurrency(_t.totalWithTaxCents)}</span>
                </div>
              )}
              {(form.depositAmount || 0) > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#22c55e', padding: '0.2rem 0' }}>
                    <span>− Deposit (paid):</span><span>−{formatCurrency(previewDepositCents)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', fontWeight: 800, fontSize: '0.95rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.25rem', paddingTop: '0.3rem' }}>
                    <span>= Balance Due:</span>
                    <span>{formatCurrency(_t.balanceCents)}</span>
                  </div>
                </>
              )}
            </div>
            );
          })()}
        </div>
        {editUnlock && editUnlock.status === 'Completed' && (
          <div style={{ padding: '0.75rem', marginTop: '1rem', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '0.5rem', fontSize: '0.82rem', color: '#93c5fd' }}>
            ℹ️ {lang === 'es' ? 'Desbloqueo completado. Para devoluciones, usa el módulo Returns.' : 'Unlock completed. For refunds, use the Returns module.'}
          </div>
        )}
        <div className="flex gap-3 mt-4 pt-4 border-t border-white/10">
          <button onClick={() => setShowModal(false)} className="btn btn-secondary flex-1">{L.cancel}</button>
          {editUnlock && !['Completed', 'Code Received', 'Cancelled'].includes(editUnlock.status) && (
            <button
              onClick={() => {
                const target = editUnlock;
                setShowModal(false);
                setEditUnlock(null);
                setCancelTarget(target);
              }}
              className="btn btn-danger flex-1"
              title={lang === 'es' ? 'Cancelar desbloqueo y decidir sobre depósito' : 'Cancel unlock and resolve deposit'}
            >
              ❌ {lang === 'es' ? 'Cancelar Desbloqueo' : 'Cancel Unlock'}
            </button>
          )}
          <button onClick={printTicket} className="btn btn-secondary flex-1" title={lang === 'es' ? 'Imprimir ticket 4x6' : 'Print 4x6 ticket'}>
            🖨️ {lang === 'es' ? 'Imprimir' : 'Print'}
          </button>
          <button onClick={handleSave} className="btn btn-primary flex-1">{editUnlock ? L.save : L.create}</button>
        </div>
      </Modal>

      {/* COLLECT BALANCE MODAL */}
      {depositModalUnlock && (
        <DepositModal
          title={lang === 'es' ? `Desbloqueo ${depositModalUnlock.id.slice(-8).toUpperCase()} — Cobrar` : `Unlock ${depositModalUnlock.id.slice(-8).toUpperCase()} — Collect`}
          itemLabel={`${depositModalUnlock.device} (${depositModalUnlock.carrier}) — Unlock`}
          itemPrice={(depositModalUnlock.price || 0) / 100}
          taxRate={settings.taxRate || 0.0925}
          taxable={!!(depositModalUnlock as any).taxable}
          existingDeposit={(depositModalUnlock.depositAmount || 0) / 100}
          pendingInCart={(pendingByUnlockId.get(depositModalUnlock.id) || 0) / 100}
          mode="balance"
          lang={lang}
          onClose={() => setDepositModalUnlock(null)}
          onConfirm={({ depositAmt }) => {
            // UNL-9 fix: respect user input (was ignoring it before).
            if (isConsolidating) return;
            setIsConsolidating(true);
            try {
              const u = depositModalUnlock;
              const newAmtCents = Math.round(depositAmt * 100);
              const taxable = !!(u as any).taxable;

              const { combinedCents } = consolidateCartForUnlock({
                unlockId: u.id,
                additionalCents: newAmtCents,
                device: u.device || '',
                isTaxable: taxable,
              });

              const customerId = (u as any).customerId;
              if (customerId) {
                dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: customerId });
              } else if (u.customerPhone) {
                const phoneTail = u.customerPhone.replace(/\D/g, '').slice(-10);
                const matched = customersRef.current.find((c) => {
                  const cPhone = (c.phone || '').replace(/\D/g, '').slice(-10);
                  return cPhone && cPhone === phoneTail;
                });
                if (matched) {
                  dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: matched.id });
                }
              }

              setDepositModalUnlock(null);
              toast(
                lang === 'es'
                  ? `$${(combinedCents / 100).toFixed(2)} en carrito`
                  : `$${(combinedCents / 100).toFixed(2)} in cart`,
                'success',
              );
            } finally {
              setTimeout(() => setIsConsolidating(false), 100);
            }
          }}
        />
      )}

      {cancelTarget && (
        <CancelUnlockModal
          unlock={cancelTarget}
          customerHasPhone={!!cancelTarget.customerPhone}
          customerName={cancelTarget.customerName}
          lang={lang}
          onConfirm={(choice) => handleCancelUnlock(cancelTarget, choice)}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          open
          title={lang === 'es' ? 'Eliminar desbloqueo' : 'Delete unlock'}
          message={lang === 'es' ? '¿Eliminar este desbloqueo?' : 'Delete this unlock?'}
          variant="danger"
          confirmLabel={lang === 'es' ? 'Eliminar' : 'Delete'}
          cancelLabel={lang === 'es' ? 'Cancelar' : 'Cancel'}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {completeConfirm && (
        <ConfirmDialog
          open
          title={lang === 'es' ? 'Completar desbloqueo' : 'Complete unlock'}
          message={
            (completeConfirm.balance || 0) > 0
              ? (lang === 'es'
                  ? `¿Marcar completado y cobrar saldo de ${formatCurrency(completeConfirm.balance)}?`
                  : `Mark completed and collect balance of ${formatCurrency(completeConfirm.balance)}?`)
              : (lang === 'es' ? '¿Marcar como completado?' : 'Mark as completed?')
          }
          variant="warning"
          confirmLabel={lang === 'es' ? 'Confirmar' : 'Confirm'}
          cancelLabel={lang === 'es' ? 'Cancelar' : 'Cancel'}
          onConfirm={handleCompleteConfirmed}
          onCancel={() => setCompleteConfirm(null)}
        />
      )}
    </>
  );
}
