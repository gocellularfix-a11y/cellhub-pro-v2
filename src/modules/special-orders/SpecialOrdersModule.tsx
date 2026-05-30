// ============================================================
// CellHub Pro — Special Orders Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, AutocompleteInput, ConfirmDialog } from '@/components/ui';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import type { AutocompleteOption } from '@/hooks/useAutocomplete';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { persist, remove } from '@/services/persist';
import DepositModal from '@/components/DepositModal';
import { calcDepositTotals, reverseTaxFromPayment, forwardTaxFromBase } from '@/utils/depositTax';
import { matchesSearchPhones } from '@/utils/search';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
import TicketListLayout from '@/components/shared/TicketListLayout';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import TicketCard from '@/components/shared/TicketCard';
import CustomerSearchHeader from '@/components/shared/CustomerSearchHeader';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import type { SpecialOrder, CartItem, Customer, Sale, EditAuditEntry } from '@/store/types';
import CancelSpecialOrderModal from './CancelSpecialOrderModal';
import { usePrint } from '@/hooks/usePrint';
import AdminPinGate from '@/components/shared/AdminPinGate';
import { usePinGate } from '@/hooks/usePinGate';
import ReasonSelectorModal from '@/components/ReasonSelectorModal';
import EditHistoryModal from '@/components/EditHistoryModal';
import {
  computeDiff, hasMoneyChanges, captureSnapshot, appendEditEntry,
  checkEditHistoryStatus,
  SPECIAL_ORDER_MONEY_FIELDS, SPECIAL_ORDER_ALL_FIELDS,
  type FieldChange, type EditReason,
} from '@/services/editAudit';
import { useApprovalGate } from '@/hooks/useApprovalGate';
import { escHtml } from '@/utils/escHtml';
import { setIntelligenceContext, clearEntityContext } from '@/services/intelligence/context/intelligenceContext';
import { emitSpecialOrderAmbient } from '@/services/intelligence/ambient/ambientAwarenessService';

// FIX Bug 1+2: Added In Transit, Received, Ready so those orders aren't invisible
const STATUSES = ['All', 'Ordered', 'In Transit', 'Received', 'Ready', 'Picked Up', 'Cancelled'];

const STATUS_BADGE: Record<string, string> = {
  Ordered: 'badge-info', ordered: 'badge-info',
  Arrived: 'badge-success', received: 'badge-success', ready: 'badge-success',
  'Picked Up': 'badge-neutral', picked_up: 'badge-neutral',
  Cancelled: 'badge-danger', cancelled: 'badge-danger',
  in_transit: 'badge-warning',
  // R-EDIT-AUDIT F5: refund statuses badging.
  refund_pending: 'badge-warning',
  refunded: 'badge-danger',
};

export default function SpecialOrdersModule() {
  const {
    state: { specialOrders, customers, settings, employees, currentEmployee, cart, sales, lang, globalSearchTerm },
    setSpecialOrders, setCustomers, setCart, setSales, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { t } = useTranslation();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const { printHtml } = usePrint();
  const approvalGate = useApprovalGate({ employees, settings, attemptedByName: currentEmployee?.name });

  const [search, setSearch] = useState(globalSearchTerm || '');
  const [filterStatus, setFilterStatus] = useState('All');
  const [visibleCount, setVisibleCount] = useState(50);
  const [showModal, setShowModal] = useState(false);
  const [editOrder, setEditOrder] = useState<SpecialOrder | null>(null);
  const [form, setForm] = useState<Partial<SpecialOrder>>({});
  const [depositModalOrder, setDepositModalOrder] = useState<SpecialOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SpecialOrder | null>(null);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<SpecialOrder | null>(null);
  const [completeConfirm, setCompleteConfirm] = useState<SpecialOrder | null>(null);

  // R-EDIT-AUDIT F5: post-completion edit tracking — history viewer,
  // print-choice dialog, Mark Refunded confirmation.
  const [historyTarget, setHistoryTarget] = useState<SpecialOrder | null>(null);
  const [printChoiceTarget, setPrintChoiceTarget] = useState<SpecialOrder | null>(null);
  const [refundConfirmTarget, setRefundConfirmTarget] = useState<SpecialOrder | null>(null);

  // Refs to avoid stale closures in handlers (multi-station Firestore sync).
  // Setters from context don't accept function updaters, so we track the latest
  // committed state in refs and always build next-state from ref.current.
  const specialOrdersRef = useRef(specialOrders);
  const customersRef = useRef(customers);
  const cartRef = useRef(cart);
  const salesRef = useRef(sales);
  useEffect(() => { specialOrdersRef.current = specialOrders; }, [specialOrders]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  useEffect(() => { salesRef.current = sales; }, [sales]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { orderId } = (e as CustomEvent<{ orderId?: string }>).detail ?? {};
      if (!orderId) return;
      const order = specialOrdersRef.current.find((o) => o.id === orderId);
      if (!order) { console.warn('[cellhub] _intel-open-special-order: not found', orderId); return; }
      setEditOrder(order);
      setShowModal(true);
    };
    window.addEventListener('cellhub:_intel-open-special-order', handler);
    return () => window.removeEventListener('cellhub:_intel-open-special-order', handler);
  }, []);

  // R-INTELLIGENCE-CONTEXT-AWARE-V1: broadcast active special order entity so
  // Intelligence surfaces contextual recommendations for this specific ticket.
  // R-INTELLIGENCE-AMBIENT-AWARENESS-V1: emit passive ambient hint on entity open;
  // clear entity context when modal closes to prevent stale context bleed.
  useEffect(() => {
    if (editOrder) {
      setIntelligenceContext({
        activeModule: 'specialOrders',
        activeSpecialOrderId: editOrder.id,
        activeCustomerId: (editOrder as any).customerId ?? undefined,
      });
      emitSpecialOrderAmbient(editOrder);
    } else {
      clearEntityContext();
    }
  }, [editOrder]);

  // Consume cross-module search term once on mount
  useEffect(() => {
    if (globalSearchTerm) {
      setSearch(globalSearchTerm);
      dispatch({ type: 'SET_GLOBAL_SEARCH', payload: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizeStatus = (s: string) => s.toLowerCase().replace(/ /g, '_');

  // r-new-1 + r-new-6 port from Repairs Round 2/3: pending per SO, tax-inclusive.
  // Matches what customer perceives they've "paid" from the ticket — the forward-
  // tax converts cart.price (pre-tax base) into the register total.
  const pendingBySpecialOrderId = useMemo(() => {
    const map = new Map<string, number>();
    const taxRate = settings.taxRate ?? 0.0925;
    for (const item of cart) {
      if (!item.specialOrderId) continue;
      const itemBaseCents = (item.price || 0) * (item.qty || 1);
      const fwd = forwardTaxFromBase(itemBaseCents, taxRate, !!item.taxable);
      const prev = map.get(item.specialOrderId) || 0;
      map.set(item.specialOrderId, prev + fwd.totalCents);
    }
    return map;
  }, [cart, settings.taxRate]);

  // r-new-5 port: ensures invariant "one SO has at most one cart item at any time".
  // Called by: deposit-at-create (handleSave CREATE), DepositModal onConfirm,
  // handleCompleteConfirmed. `additionalCents` is TAX-INCLUSIVE. Combines with any
  // existing cart items for this SO (forward-taxed), then reverse-taxes the total
  // to a single new cart item.
  const consolidateCartForSpecialOrder = useCallback((params: {
    specialOrderId: string;
    additionalCents: number;
    itemDescription: string;
    isTaxable: boolean;
  }): { combinedCents: number } => {
    const { specialOrderId, additionalCents, itemDescription, isTaxable } = params;
    const taxRate = settings.taxRate ?? 0.0925;

    const existingItems = cartRef.current.filter((c) => c.specialOrderId === specialOrderId);
    let combinedCents = additionalCents;
    for (const existing of existingItems) {
      const existingBase = (existing.price || 0) * (existing.qty || 1);
      const existingFwd = forwardTaxFromBase(existingBase, taxRate, !!existing.taxable);
      combinedCents += existingFwd.totalCents;
    }

    const split = reverseTaxFromPayment(combinedCents, taxRate, isTaxable);
    const consolidatedItem: CartItem = {
      id: generateId(),
      name: `${t('so.cartItemName')} — ${itemDescription}`,
      category: 'service',
      price: split.baseCents,
      qty: 1,
      taxable: isTaxable,
      cbeEligible: false,
      specialOrderId,
      notes: specialOrderId.slice(-6).toUpperCase(),
    };

    const nextCart = [
      ...cartRef.current.filter((c) => c.specialOrderId !== specialOrderId),
      consolidatedItem,
    ];
    cartRef.current = nextCart;
    setCart(nextCart);

    return { combinedCents };
  }, [settings.taxRate, t, setCart]);

  const translateStatus = useCallback(
    (s: string) => {
      const map: Record<string, string> = {
        All:          t('so.all'),
        Ordered:      t('so.status.ordered'),
        'In Transit': t('so.status.inTransit'),
        Received:     t('so.status.received'),
        Ready:        t('so.status.ready'),
        'Picked Up':  t('so.status.pickedUp'),
        Cancelled:    t('so.cancelled'),
      };
      return map[s] || s;
    }, [t],
  );

  // FIX Bug 1+2: normalize both sides so each tab only matches its own status
  const filtered = useMemo(() => {
    return specialOrders
      .filter((o) => filterStatus === 'All' || normalizeStatus(o.status) === normalizeStatus(filterStatus))
      // R-SEARCH-NORMALIZE-V1: phone-aware match; add o.id for parity
      // with the GlobalSearchBar SO lookup at line ~256.
      .filter((o) => matchesSearchPhones(
        search,
        [o.customerPhone],
        o.customerName, o.itemDescription, o.supplier, o.id,
      ))
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [specialOrders, filterStatus, search]);

  // FIX Bug 6: normalize status; only picked_up, cancelled, and refunded are "done"
  // R-EDIT-AUDIT: refund_pending stays active until Mark Refunded.
  // in_transit, received, ready are still active (order not yet delivered to customer)
  const DONE_SO_STATUSES = ['picked_up', 'cancelled', 'refunded'];
  const activeCount = useMemo(
    () => specialOrders.filter((o) => !DONE_SO_STATUSES.includes(normalizeStatus(o.status))).length,
    [specialOrders],
  );

  const openNew = () => {
    setEditOrder(null);
    setForm({
      firstName: '', lastName: '', customerPhone: '', itemDescription: '',
      supplier: '', cost: '' as any, price: '' as any, depositAmount: '' as any, balance: 0,
      status: 'ordered', notes: '', taxable: false,
    } as any);
    setShowModal(true);
  };

  const openEdit = (o: SpecialOrder) => {
    setEditOrder(o);
    const parts = (o.customerName || '').trim().split(' ');
    setForm({
      ...o,
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      cost: (o.cost ? (o.cost / 100).toFixed(2) : '') as any,
      price: (o.price ? (o.price / 100).toFixed(2) : '') as any,
      depositAmount: (o.depositAmount ? (o.depositAmount / 100).toFixed(2) : '') as any,
    });
    setShowModal(true);
  };

  // R-EDIT-AUDIT F5: entity-based SpecialOrder print. Accepts a persisted
  // SpecialOrder plus optional "corrected" display override — used by auto-
  // reprint after audit saves AND by the print-choice dialog on the card.
  // (No pre-existing SO print function; card's onPrint was undefined.)
  const printSpecialOrderEntity = useCallback((order: SpecialOrder, displayOverride?: {
    corrected?: boolean;
    originalSnapshot?: { capturedAt: string; snapshot: Record<string, unknown> };
  }) => {
    const storeName = (settings.storeName || 'CellHub Pro').toUpperCase();
    const storeAddr = settings.storeAddress || '';
    const storePhone = settings.storePhone || '';
    const fmt = (v: unknown) => v == null ? '' : String(v);
    const money = (cents: unknown) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;

    const corrected = !!displayOverride?.corrected;
    const snap = displayOverride?.originalSnapshot?.snapshot;
    const prevHtml = (field: string): string => {
      if (!corrected || !snap) return '';
      const prior = snap[field];
      const current = (order as any)[field];
      if (prior == null || prior === '' || prior === current) return '';
      if (typeof prior === 'number') return ` <span class="was">${escHtml(t('so.print.previously', money(prior)))}</span>`;
      return '';
    };

    const ticketNum = order.id.slice(-8).toUpperCase();
    // R-PRINT-PREMIUM: premium 4×6 thermal layout matching Repairs.
    const css = `@page{size:4in 6in;margin:0}*{box-sizing:border-box;margin:0;padding:0}html,body{width:4in;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#fff}body{padding:.18in .22in .15in .22in;overflow-x:hidden}.hdr{text-align:center;margin-bottom:5px}.store{font-size:13px;font-weight:800;letter-spacing:.5px}.store-sub{font-size:9px;color:#555;margin-top:1px}.title-bar{background:#000;color:#fff;text-align:center;font-size:11px;font-weight:700;padding:3px 0;margin:4px 0}.corr-bar{background:#b91c1c;color:#fff;text-align:center;font-size:10px;font-weight:700;padding:2px 0;margin:2px 0}.sec{margin:4px 0}.sec-lbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#666;border-bottom:1px solid #ccc;padding-bottom:1px;margin-bottom:3px}.row{display:flex;justify-content:space-between;margin-bottom:1px}.lbl{color:#555}.val{font-weight:600}.was{font-size:9px;color:#999;font-style:italic}.dash{border-top:1px dashed #bbb;margin:3px 0}.solid{border-top:2px solid #000;margin:3px 0}.grand .lbl,.grand .val{font-weight:800;font-size:11px}.bal-due .val{color:#c00;font-weight:800}.ftr{text-align:center;font-size:9px;color:#666;margin-top:5px;border-top:1px dashed #bbb;padding-top:3px}`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SO ${escHtml(ticketNum)}</title><style>${css}</style></head><body>
<div class="hdr"><div class="store">${escHtml(storeName)}</div>${storeAddr ? `<div class="store-sub">${escHtml(storeAddr)}</div>` : ''}${storePhone ? `<div class="store-sub">${escHtml(storePhone)}</div>` : ''}</div>
${corrected ? `<div class="corr-bar">${escHtml(t('so.print.correctedReceipt'))}</div>` : ''}
<div class="title-bar">${escHtml(t('so.print.title'))} — #${escHtml(ticketNum)}</div>
<div class="sec">
<div class="row"><span class="lbl">${escHtml(t('so.print.date'))}</span><span class="val">${escHtml(new Date().toLocaleString())}</span></div>
<div class="row"><span class="lbl">Status</span><span class="val">${escHtml(fmt(order.status))}</span></div>
${corrected ? `<div class="row"><span class="lbl">${escHtml(t('so.print.corrected'))}</span><span class="val">${escHtml(new Date().toLocaleString())}</span></div>` : ''}
</div>
<div class="dash"></div>
<div class="sec">
<div class="sec-lbl">${escHtml(t('so.print.customer'))}</div>
<div class="row"><span class="lbl"></span><span class="val">${escHtml(fmt(order.customerName))}</span></div>
${order.customerPhone ? `<div class="row"><span class="lbl">${escHtml(t('so.print.phone'))}</span><span class="val">${escHtml(fmt(order.customerPhone))}</span></div>` : ''}
</div>
<div class="dash"></div>
<div class="sec">
<div class="sec-lbl">${escHtml(t('so.print.item'))}</div>
<div class="row"><span class="lbl"></span><span class="val">${escHtml(fmt(order.itemDescription))}</span></div>
${order.supplier ? `<div class="row"><span class="lbl">${escHtml(t('so.print.supplier'))}</span><span class="val">${escHtml(fmt(order.supplier))}</span></div>` : ''}
${order.estimatedArrival ? `<div class="row"><span class="lbl">${escHtml(t('so.print.estArrival'))}</span><span class="val">${escHtml(fmt(order.estimatedArrival))}</span></div>` : ''}
</div>
<div class="solid"></div>
<div class="sec">
<div class="row"><span class="lbl">${escHtml(t('so.print.price'))}</span><span class="val">${escHtml(money(order.price || 0))}${prevHtml('price')}</span></div>
<div class="row"><span class="lbl">${escHtml(t('so.print.deposit'))}</span><span class="val">${escHtml(money(order.depositAmount || 0))}${prevHtml('depositAmount')}</span></div>
<div class="dash"></div>
<div class="row ${(order.balance || 0) > 0 ? 'bal-due' : 'grand'}"><span class="lbl">${escHtml(t('so.print.balance'))}</span><span class="val">${escHtml(money(order.balance || 0))}${prevHtml('balance')}</span></div>
${corrected && ((order as any).refundOwedAmount || 0) > 0 ? `<div class="row" style="color:#b91c1c"><span class="lbl">${escHtml(t('so.print.refundOwed'))}</span><span class="val">${escHtml(money((order as any).refundOwedAmount))}</span></div>` : ''}
</div>
${order.notes ? `<div class="dash"></div><div class="sec"><div class="sec-lbl">${escHtml(t('so.print.notes'))}</div><div>${escHtml(fmt(order.notes))}</div></div>` : ''}
<div class="ftr">Thank you for your business!<br>${escHtml(storeName)}</div>
</body></html>`;
    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });
  }, [settings, t, printHtml]);

  const handleSave = useCallback((auditMeta?: {
    reason: EditReason;
    changes: FieldChange[];
    note?: string;
  }) => {
    const firstName = ((form as any).firstName || '').trim();
    const lastName  = ((form as any).lastName  || '').trim();
    const customerName = `${firstName} ${lastName}`.trim();
    if (!customerName || !form.itemDescription?.trim()) return;
    const phoneLen = ((form as any).customerPhone || '').replace(/\D/g, '').length;
    if (phoneLen > 0 && phoneLen !== 10) { toast(t('so.errorPhoneDigits'), 'error'); return; }

    const price = Math.round((parseFloat(form.price as any) || 0) * 100);
    const deposit = Math.round((parseFloat(form.depositAmount as any) || 0) * 100);
    const cost = Math.round((parseFloat(form.cost as any) || 0) * 100);
    const taxable = !!(form as any).taxable;
    const taxRate = settings.taxRate ?? 0.0925;
    // Use shared helper for totals — single source of truth across modules
    const _t = calcDepositTotals(price, deposit, taxRate, taxable);
    const balance = _t.balanceCents;
    // r-deposit-integrity-1 P1: balance on a NEW order must not reflect the
    // deposit yet — the deposit only exists in the cart until POS checkout
    // confirms. See POSModule.handleCompleteSale for the reconciliation step.
    const balanceBeforeDeposit = _t.totalWithTaxCents;

    // Auto-create customer — build next-state from ref, don't commit yet.
    // Collapsing create-customer + create-order into a single pass avoids the
    // stale-closure bug where two setCustomers/setSpecialOrders calls in sequence
    // could overwrite each other when the Firestore listener pushed an update
    // between them (same pattern as ReceiptModal handleCreateAndAssign fix).
    let workingCustomers = customersRef.current;
    let customersChanged = false;
    let persistCustomer: Customer | null = null;

    if (form.customerPhone) {
      const phone = normalizePhone(form.customerPhone);
      const existing = workingCustomers.find((c) => normalizePhone(c.phone) === phone);
      if (!existing && customerName) {
        // FIX: customer number uses full timestamp + random suffix (not .slice(-4))
        // to avoid collisions in multi-station environments. Same pattern as
        // PaymentModal invoice numbers and ReceiptModal create-and-assign.
        const ts = Date.now().toString().slice(-8);
        const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
        const newCust: Customer = {
          // R-PHONE-SANITIZE-SWEEP: persist 10-digit form (or empty).
          id: generateId(), firstName, lastName, name: customerName, phone: normalizePhone(form.customerPhone || ''),
          email: '', loyaltyPoints: 0, storeCredit: 0,
          customerNumber: `${settings.customerNumberPrefix || 'GC'}-${ts}-${rand}`,
          notes: '', communicationConsent: false, createdAt: new Date().toISOString(),
        };
        workingCustomers = [...workingCustomers, newCust];
        customersChanged = true;
        persistCustomer = newCust;
      }
    }

    if (editOrder) {
      // r-deposit-integrity-1 EDIT guard: never overwrite depositAmount from form.
      // The form field `deposit` was parsed but we IGNORE it here — entity's
      // committed depositAmount is the source of truth. Recalculate balance from
      // the (possibly updated) price minus the locked deposit.
      const spread = { ...editOrder, ...form, customerName, cost, price } as SpecialOrder;
      const lockedDeposit = editOrder.depositAmount || 0;
      const newPrice = (spread as any).price || 0;
      const newTaxRate = settings.taxRate ?? 0.0925;
      const newTaxable = !!(spread as any).taxable;
      const newTaxAmt = newTaxable ? Math.round(newPrice * newTaxRate) : 0;
      const newTotalWithTax = newPrice + newTaxAmt;
      const lockedBalance = Math.max(0, newTotalWithTax - lockedDeposit);

      const updated: SpecialOrder = {
        ...spread,
        depositAmount: lockedDeposit,
        balance: lockedBalance,
        updatedAt: new Date().toISOString(),
      } as SpecialOrder;

      // R-EDIT-AUDIT F5: when audit metadata is present (from a locked-ticket
      // edit), layer side-effects + capture originalSnapshot + append edit-
      // history entry. Read the truly-fresh entity from specialOrdersRef so
      // concurrent writes (POS checkout, etc.) don't get clobbered.
      if (auditMeta) {
        const fresh = specialOrdersRef.current.find((o) => o.id === editOrder.id) || editOrder;
        const taxRateA = settings.taxRate ?? 0.0925;
        const newTaxable = (updated as any).taxable ?? false;
        const oldTaxable = (fresh as any).taxable ?? false;

        // Defensive: any incoming payload spread must not clobber audit fields.
        delete (updated as any).editHistory;
        delete (updated as any).originalSnapshot;
        delete (updated as any).refundOwedAmount;
        updated.editHistory = fresh.editHistory;
        updated.originalSnapshot = fresh.originalSnapshot;
        updated.refundOwedAmount = fresh.refundOwedAmount;

        const sideEffects: EditAuditEntry['sideEffects'] = {};
        switch (auditMeta.reason) {
          case 'additional_balance': {
            const fwd = forwardTaxFromBase(updated.price || 0, taxRateA, newTaxable);
            const newTotal = fwd.totalCents;
            const alreadyPaid = fresh.depositAmount || 0;
            const newBalance = Math.max(0, newTotal - alreadyPaid);
            updated.balance = newBalance;
            updated.status = 'ordered'; // Reopen to active flow.
            sideEffects.balanceChange = newBalance - (fresh.balance || 0);
            sideEffects.statusChange = { from: String(fresh.status), to: 'ordered' };
            break;
          }
          case 'absorbed': {
            updated.balance = 0;
            const oldFwd = forwardTaxFromBase(fresh.price || 0, taxRateA, oldTaxable);
            const newFwd = forwardTaxFromBase(updated.price || 0, taxRateA, newTaxable);
            sideEffects.absorbedAmount = Math.abs(newFwd.totalCents - oldFwd.totalCents);
            break;
          }
          case 'refund': {
            const oldFwd = forwardTaxFromBase(fresh.price || 0, taxRateA, oldTaxable);
            const newFwd = forwardTaxFromBase(updated.price || 0, taxRateA, newTaxable);
            const refundOwed = Math.max(0, oldFwd.totalCents - newFwd.totalCents);
            updated.refundOwedAmount = refundOwed;
            updated.status = 'refund_pending';
            updated.balance = 0;
            sideEffects.refundOwedAmount = refundOwed;
            sideEffects.statusChange = { from: String(fresh.status), to: 'refund_pending' };
            break;
          }
          case 'typo_correction':
            break;
        }

        if (!updated.originalSnapshot) {
          updated.originalSnapshot = captureSnapshot(fresh as unknown as Record<string, unknown>);
        }

        const entry: EditAuditEntry = {
          editedAt: updated.updatedAt as string,
          editedBy: currentEmployee?.name || 'Unknown',
          pinUsedBy: currentEmployee?.name || 'Admin',
          reason: auditMeta.reason,
          fieldsChanged: auditMeta.changes,
          note: auditMeta.note || undefined,
          sideEffects: Object.keys(sideEffects).length > 0 ? sideEffects : undefined,
        };
        if (checkEditHistoryStatus(updated.editHistory) === 'full') {
          toast(t('so.editHistoryFull'), 'error');
          return;
        }
        const newHistory = appendEditEntry(updated.editHistory, entry);
        if (newHistory === null) {
          toast(t('so.editHistoryFull'), 'error');
          return;
        }
        updated.editHistory = newHistory;
      }

      const nextOrders = specialOrdersRef.current.map((o) => (o.id === editOrder.id ? updated : o));
      specialOrdersRef.current = nextOrders;
      setSpecialOrders(nextOrders);
      persist.specialOrder(updated.id, updated as unknown as Record<string, unknown>);

      // R-EDIT-AUDIT F5: auto-reprint corrected receipt for money-impacting edits.
      if (auditMeta && auditMeta.reason !== 'typo_correction') {
        printSpecialOrderEntity(updated, {
          corrected: true,
          originalSnapshot: updated.originalSnapshot,
        });
      }

      // Commit customer changes if any (edit-path rarely creates customer, but
      // the autocreate logic above still runs when phone is filled in)
      if (customersChanged) {
        customersRef.current = workingCustomers;
        setCustomers(workingCustomers);
        if (persistCustomer) {
          persist.customer(persistCustomer.id, persistCustomer as unknown as Record<string, unknown>);
        }
      }

      toast(t('so.saved'), 'success');
    } else {
      const newOrder: SpecialOrder = {
        id: generateId(), ...form, customerName,
        cost, price,
        // r-deposit-integrity-1: override form's depositAmount and balance.
        // The deposit lives in the cart until POS checkout confirms.
        depositAmount: 0,
        balance: balanceBeforeDeposit,
        status: form.status || 'ordered',
        employeeName: currentEmployee?.name,
        employeeId: currentEmployee?.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as SpecialOrder;
      const nextOrders = [...specialOrdersRef.current, newOrder];
      specialOrdersRef.current = nextOrders;
      setSpecialOrders(nextOrders);
      persist.specialOrder(newOrder.id, newOrder as unknown as Record<string, unknown>);
      setTimeout(() => printSpecialOrderEntity(newOrder), 300);
      try {
        window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
          detail: { type: 'special_order.created', payload: { customerId: (newOrder as any).customerId || undefined } },
        }));
      } catch { /* env without CustomEvent */ }

      // Commit customer changes if any (must happen BEFORE deposit cart add so
      // the customer exists in state when subsequent modules look it up)
      if (customersChanged) {
        customersRef.current = workingCustomers;
        setCustomers(workingCustomers);
        if (persistCustomer) {
          persist.customer(persistCustomer.id, persistCustomer as unknown as Record<string, unknown>);
        }
      }

      if (deposit > 0) {
        // r-new-5 port: go through consolidation helper (invariant: 1 cart
        // item per SO). On CREATE there are never pre-existing items for
        // a just-generated SO id, but this keeps all add-paths identical.
        consolidateCartForSpecialOrder({
          specialOrderId: newOrder.id,
          additionalCents: deposit,
          itemDescription: form.itemDescription || 'Item',
          isTaxable: taxable,
        });

        // r-new-cust-pos port from Round 4: auto-propagate customer to POS.
        // On CREATE, newOrder.customerId may not be set yet (auto-created
        // customer path). Fall back to phone-tail match against the working
        // customer list we already built above.
        let custId = (newOrder as any).customerId as string | undefined;
        if (!custId && form.customerPhone) {
          const phoneTail = (form.customerPhone || '').replace(/\D/g, '').slice(-10);
          if (phoneTail) {
            const matched = workingCustomers.find((c) => {
              const cTail = (c.phone || '').replace(/\D/g, '').slice(-10);
              return cTail && cTail === phoneTail;
            });
            if (matched) custId = matched.id;
          }
        }
        if (custId) {
          dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: custId });
        }

        toast(t('so.createdWithDeposit', formatCurrency(deposit)), 'info');
      } else {
        toast(t('so.specialOrderCreated'), 'success');
      }
    }

    setShowModal(false);
    setEditOrder(null);
  }, [form, editOrder, settings, currentEmployee, t,
      setSpecialOrders, setCustomers, setCart, toast,
      consolidateCartForSpecialOrder, dispatch,
      // R-EDIT-AUDIT F5: audit reprint dep.
      printSpecialOrderEntity]);

  // NOTE: `collectBalance` was removed as dead code — the TicketCard's
  // onCollectBalance handler opens the DepositModal directly via
  // setDepositModalOrder, which has its own payment flow with proper
  // user-input validation. The old collectBalance function bypassed that
  // flow and marked orders as picked_up unconditionally.

  // r-new-4 port from Repairs Round 1: cancel with deposit disposition.
  // Before this, cancelling left depositAmount intact — ghost revenue with
  // no record of what happened to the money. Every cancellation now forces
  // a disposition choice (store_credit / cash / forfeit).
  const handleCancelSpecialOrder = useCallback(async (order: SpecialOrder, choice: {
    method: 'store_credit' | 'cash' | 'forfeit';
    note: string;
  }) => {
    // R-APPROVAL-GATE-SPECIALORDERS-V1: approval gate before any mutation.
    const approval = await approvalGate.requestApproval({
      actionType: 'CANCEL_SPECIAL_ORDER',
      requestedByEmployeeId: currentEmployee?.id || '',
      entityId: order.id,
      affectedAmount: order.depositAmount || 0,
      reason: choice.method === 'cash'
        ? 'Special order cancellation — cash refund'
        : choice.method === 'store_credit'
        ? 'Special order cancellation — store credit'
        : 'Special order cancellation — deposit forfeited',
    });
    if (!approval.approved) return;

    const depositCents = order.depositAmount || 0;
    const now = new Date().toISOString();

    // 1. Customer side effects
    if (choice.method === 'store_credit' && depositCents > 0) {
      const phoneTail = (order.customerPhone || '').replace(/\D/g, '').slice(-10);
      const matched = customersRef.current.find((c) => {
        if ((order as any).customerId && c.id === (order as any).customerId) return true;
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
        toast(t('so.cancel.customerNotMatched'), 'warning');
      }
    } else if (choice.method === 'cash' && depositCents > 0) {
      const refundSale: Sale = {
        id: generateId(),
        storeId: (order as any).storeId,
        invoiceNumber: `REFUND-${order.id.slice(-6).toUpperCase()}`,
        customerId: (order as any).customerId,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        items: [{
          id: generateId(),
          name: `${order.itemDescription || t('so.cartItemName')} — ${t('so.cancelRefundName')}`,
          category: 'service' as any,
          price: -depositCents,
          qty: 1,
          taxable: false,
          cbeEligible: false,
          specialOrderId: order.id,
        }],
        subtotal: -depositCents,
        taxAmount: 0,
        cbeTotal: 0,
        total: -depositCents,
        paymentMethod: 'Cash' as any,
        status: 'completed',
        employeeId: currentEmployee?.id,
        employeeName: currentEmployee?.name,
        notes: `Special order cancelled — cash refund for order ${order.id.slice(-6).toUpperCase()}`,
        refundReason: 'Special order cancelled',
        createdAt: now,
      };
      // r9-1: Mark original sale(s) containing this SO as refunded so Reports
      //       excludes them from Gross/Cash/Profit. Voided refund sale remains
      //       as audit trail.
      const originalSales = salesRef.current.filter((s: Sale) =>
        (s.items || []).some((item: any) => item.specialOrderId === order.id)
        && s.status !== 'voided'
        && s.status !== 'refunded'
      );
      const markedSales = originalSales.map((s: Sale) => ({
        ...s,
        status: 'refunded' as Sale['status'],
        refundedAt: now,
        refundReason: `SO Cancel: ${choice.note || 'no note'}`,
        refundMethod: 'cash',
      }));
      for (const ms of markedSales) {
        persist.sale(ms.id, ms as unknown as Record<string, unknown>);
      }

      // Build next sales array: replace originals with marked versions + add refund audit record
      const salesWithMarked = salesRef.current.map((s: Sale) => {
        const marked = markedSales.find((m: any) => m.id === s.id);
        return marked || s;
      });
      const nextSales = [...salesWithMarked, refundSale];
      salesRef.current = nextSales;
      setSales(nextSales);
      persist.sale(refundSale.id, refundSale as unknown as Record<string, unknown>);
    }

    // 2. Update SO entity
    const updated = {
      ...order,
      status: 'cancelled',
      depositRefundMethod: choice.method,
      depositRefundAmount: depositCents,
      cancellationNote: choice.note || '',
      cancelledAt: now,
      depositAmount: 0,
      balance: 0,
      updatedAt: now,
    } as unknown as SpecialOrder;
    const nextOrders = specialOrdersRef.current.map((o) => o.id === order.id ? updated : o);
    specialOrdersRef.current = nextOrders;
    setSpecialOrders(nextOrders);
    persist.specialOrder(updated.id, updated as unknown as Record<string, unknown>);

    const amtDisplay = (depositCents / 100).toFixed(2);
    const msg = {
      store_credit: t('so.cancel.toastStoreCredit', amtDisplay),
      cash:         t('so.cancel.toastCash',        amtDisplay),
      forfeit:      t('so.cancel.toastForfeit'),
    }[choice.method];
    toast(msg, 'success');
    setCancelTarget(null);
  }, [t, setCustomers, setSales, setSpecialOrders, toast, currentEmployee, approvalGate.requestApproval]);

  const handleComplete = useCallback((order: SpecialOrder) => {
    const balance = order.balance || 0;
    const deposit = order.depositAmount || 0;

    if (balance === 0 && deposit === 0) {
      const updated: SpecialOrder = { ...order, status: 'picked_up' as any, updatedAt: new Date().toISOString() };
      const next = specialOrdersRef.current.map((o) => o.id === order.id ? updated : o);
      specialOrdersRef.current = next;
      setSpecialOrders(next);
      persist.specialOrder(updated.id, updated as unknown as Record<string, unknown>);
      toast(t('so.orderCompleted'), 'success');
      return;
    }
    setCompleteConfirm(order);
  }, [setSpecialOrders, toast, t]);

  const handleCompleteConfirmed = useCallback(() => {
    const order = completeConfirm;
    if (!order) return;

    if ((order.balance || 0) > 0) {
      const isTaxable = !!(order as any).taxable;
      consolidateCartForSpecialOrder({
        specialOrderId: order.id,
        additionalCents: order.balance,
        itemDescription: order.itemDescription || 'Item',
        isTaxable,
      });
      let custId = (order as any).customerId as string | undefined;
      if (!custId && order.customerPhone) {
        const phoneTail = (order.customerPhone || '').replace(/\D/g, '').slice(-10);
        if (phoneTail) {
          const matched = customersRef.current.find((c) => {
            const cTail = (c.phone || '').replace(/\D/g, '').slice(-10);
            return cTail && cTail === phoneTail;
          });
          if (matched) custId = matched.id;
        }
      }
      if (custId) {
        dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: custId });
      }
    }

    const updated: SpecialOrder = { ...order, status: 'picked_up' as any, updatedAt: new Date().toISOString() };
    const next = specialOrdersRef.current.map((o) => o.id === order.id ? updated : o);
    specialOrdersRef.current = next;
    setSpecialOrders(next);
    persist.specialOrder(updated.id, updated as unknown as Record<string, unknown>);

    setCompleteConfirm(null);
    toast(
      (order.balance || 0) > 0
        ? t('so.balanceAddedToCart')
        : t('so.orderCompleted'),
      'success',
    );
  }, [completeConfirm, consolidateCartForSpecialOrder, setSpecialOrders, dispatch, toast, t]);

  // R-COMMS-SMS-INFRA-CLEANUP: handleSMS stub callback removed
  // (was a placeholder toast; SMS sending retired entirely).

  const handleDeleteConfirmed = useCallback(() => {
    if (!deleteConfirm) return;

    // GUARD 1: prevent delete if SO has pending cart items.
    const hasPendingCart = cartRef.current.some((item) => item.specialOrderId === deleteConfirm.id);
    if (hasPendingCart) {
      toast(t('so.errorDeleteInCart'), 'error');
      setDeleteConfirm(null);
      return;
    }

    // GUARD 2: prevent delete of paid/completed SOs.
    const hasDeposit = (deleteConfirm.depositAmount || 0) > 0;
    const isCompleted = ['picked_up', 'received', 'ready'].includes(normalizeStatus(deleteConfirm.status));
    if (hasDeposit || isCompleted) {
      toast(t('so.errorDeletePaid'), 'error');
      setDeleteConfirm(null);
      return;
    }

    const next = specialOrdersRef.current.filter((o) => o.id !== deleteConfirm.id);
    specialOrdersRef.current = next;
    setSpecialOrders(next);
    remove.specialOrder(deleteConfirm.id);
    setDeleteConfirm(null);
    toast(t('so.orderDeleted'), 'success');
  }, [deleteConfirm, setSpecialOrders, toast, t]);

  return (
    <>
      <TicketListLayout
        title={t('so.title')}
        icon="📋"
        statuses={STATUSES}
        activeStatus={filterStatus}
        onStatusChange={(s) => { setFilterStatus(s); setVisibleCount(50); }}
        translateStatus={translateStatus}
        // r-global-search: search props removed; GlobalSearchBar mounted via slot.
        globalSearchSlot={
          <GlobalSearchBar
            localValue={search}
            onLocalChange={(s) => { setSearch(s); setVisibleCount(50); }}
            excludeCollection="specialOrders"
            placeholder={t('so.searchPlaceholder')}
          />
        }
        stats={[
          { label: t('so.active'), value: activeCount, color: 'text-blue-400' },
          { label: t('so.completed'), value: specialOrders.filter((o) => normalizeStatus(o.status) === 'picked_up').length, color: 'text-emerald-400' },
          { label: t('so.total'), value: specialOrders.length },
        ]}
        onNew={openNew}
        newLabel={t('so.newOrder')}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <span className="text-4xl block mb-3">📋</span>
            <p>{t('so.noResults')}</p>
          </div>
        ) : (
          filtered.slice(0, visibleCount).map((o) => (
            <TicketCard
              ref={isHighlighted(o.id) ? highlightRef : null}
              highlighted={isHighlighted(o.id)}
              key={o.id}
              ticketNumber={o.id.slice(-8).toUpperCase()}
              customerName={o.customerName}
              customerPhone={o.customerPhone}
              device={o.itemDescription}
              issue={o.supplier ? `Supplier: ${o.supplier}` : undefined}
              status={o.status}
              statusBadgeClass={STATUS_BADGE[o.status] || 'badge-neutral'}
              total={o.price || (o as any).totalPrice || (o as any).total}
              deposit={o.depositAmount}
              balance={o.balance}
              pendingCents={pendingBySpecialOrderId.get(o.id) || 0}
              createdAt={o.createdAt as string}
              onClick={() => openEdit(o)}
              onCollectBalance={o.balance > 0 ? () => setDepositModalOrder(o) : undefined}
              onWhatsApp={settings.waEnabled !== false && o.customerPhone ? () => openWhatsApp(
                o.customerPhone,
                buildWaMessage(
                  ['received','ready','arrived'].includes(normalizeStatus(o.status)) ? 'specialOrderReady' : 'balanceDue',
                  {
                    customerName: o.customerName,
                    storeName: settings.storeName || 'Go Cellular',
                    storePhone: settings.storePhone,
                    itemDescription: o.itemDescription,
                    balance: o.balance > 0 ? `$${(o.balance / 100).toFixed(2)}` : undefined,
                  },
                  lang as 'en' | 'es',
                )
              ) : undefined}
              onDeposit={
                !['cancelled', 'picked_up'].includes(normalizeStatus(o.status)) && (o.balance || 0) > 0
                  ? () => setDepositModalOrder(o)
                  : undefined
              }
              onComplete={() => handleComplete(o)}
              completeLabel={
                normalizeStatus(o.status) === 'cancelled'
                  ? t('so.labelCancelled')
                  : normalizeStatus(o.status) === 'picked_up'
                  ? t('so.labelPickedUp')
                  : (o.balance || 0) > 0
                  ? t('so.labelCompleteCollect', formatCurrency(o.balance))
                  : t('so.labelMarkPickedUp')
              }
              completeDisabled={['cancelled', 'picked_up', 'refunded'].includes(normalizeStatus(o.status))}
              completeVariant={normalizeStatus(o.status) === 'picked_up' ? 'green' : 'amber'}
              // R-EDIT-AUDIT F5: edited tickets route through the corrected/original
              // print-choice dialog; unedited tickets print directly.
              onPrint={() => {
                if (o.editHistory && o.editHistory.length > 0) {
                  setPrintChoiceTarget(o);
                } else {
                  printSpecialOrderEntity(o);
                }
              }}
              onDelete={() => setDeleteConfirm(o)}
              extraBadges={
                <>
                  {/* R-EDIT-AUDIT F5: edit-history count badge. */}
                  {o.editHistory && o.editHistory.length > 0 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryTarget(o);
                      }}
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: 'rgba(251, 191, 36, 0.15)',
                        color: '#fbbf24',
                      }}
                      title={t('so.viewEditHistory')}
                    >
                      🕐 {o.editHistory.length}
                    </span>
                  )}
                  {/* R-EDIT-AUDIT F5: Mark Refunded button when in refund_pending state. */}
                  {normalizeStatus(o.status) === 'refund_pending' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRefundConfirmTarget(o);
                      }}
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.72rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '0.3rem',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#10b981',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        fontWeight: 600,
                      }}
                    >
                      {t('so.markRefunded')}
                    </button>
                  )}
                </>
              }
              lang={lang}
            />
          ))
        )}

          {filtered.length > visibleCount && (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <button
                onClick={() => setVisibleCount((n) => n + 50)}
                className="btn btn-secondary btn-sm"
              >
                {t('so.showMore', filtered.length - visibleCount)}
              </button>
            </div>
          )}
      </TicketListLayout>

      {/* Special Order Modal */}
      {showModal && (
        <SpecialOrderModal
          editOrder={editOrder}
          form={form}
          setForm={setForm}
          customers={customers}
          settings={settings}
          onSave={handleSave}
          onRequestCancel={(o) => {
            setShowModal(false);
            setEditOrder(null);
            setCancelTarget(o);
          }}
          onPrint={editOrder ? () => printSpecialOrderEntity(editOrder) : undefined}
          onClose={() => { setShowModal(false); setEditOrder(null); }}
          lang={lang}
          allOrders={specialOrders}
        />
      )}
      {depositModalOrder && (
        <DepositModal
          title={t('so.collectPaymentTitle')}
          itemLabel={depositModalOrder.itemDescription || 'Special Order'}
          itemPrice={(depositModalOrder.price || 0) / 100}
          taxRate={settings.taxRate ?? 0.0925}
          taxable={!!(depositModalOrder as any).taxable}
          existingDeposit={(depositModalOrder.depositAmount || 0) / 100}
          pendingInCart={(pendingBySpecialOrderId.get(depositModalOrder.id) || 0) / 100}
          mode="balance"
          lang={lang}
          onClose={() => setDepositModalOrder(null)}
          onConfirm={({ depositAmt }) => {
            // r-new-5 race guard port
            if (isConsolidating) return;
            setIsConsolidating(true);
            try {
              const o = depositModalOrder;
              const newAmtCents = Math.round(depositAmt * 100);
              const taxable = !!(o as any).taxable;

              const { combinedCents } = consolidateCartForSpecialOrder({
                specialOrderId: o.id,
                additionalCents: newAmtCents,
                itemDescription: o.itemDescription || 'Item',
                isTaxable: taxable,
              });

              // r-new-cust-pos port: auto-propagate customer to POS.
              let custId = (o as any).customerId as string | undefined;
              if (!custId && o.customerPhone) {
                const phoneTail = (o.customerPhone || '').replace(/\D/g, '').slice(-10);
                if (phoneTail) {
                  const matched = customersRef.current.find((c) => {
                    const cTail = (c.phone || '').replace(/\D/g, '').slice(-10);
                    return cTail && cTail === phoneTail;
                  });
                  if (matched) custId = matched.id;
                }
              }
              if (custId) {
                dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: custId });
              }

              setDepositModalOrder(null);
              toast(t('so.depositInCart', (combinedCents / 100).toFixed(2)), 'success');
            } finally {
              setTimeout(() => setIsConsolidating(false), 100);
            }
          }}
        />
      )}

      {cancelTarget && (
        <CancelSpecialOrderModal
          specialOrder={cancelTarget}
          customerHasPhone={!!cancelTarget.customerPhone}
          customerName={cancelTarget.customerName}
          lang={lang}
          onConfirm={(choice) => handleCancelSpecialOrder(cancelTarget, choice)}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* R-APPROVAL-GATE-SPECIALORDERS-V1 */}
      {approvalGate.modal}

      {deleteConfirm && (
        <ConfirmDialog
          open
          title={t('so.confirmDelete.title')}
          message={t('so.confirmDelete.message')}
          variant="danger"
          confirmLabel={t('so.confirmDelete.confirm')}
          cancelLabel={t('so.cancelBtn')}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {completeConfirm && (
        <ConfirmDialog
          open
          title={t('so.confirmComplete.title')}
          message={
            (completeConfirm.balance || 0) > 0
              ? t('so.confirmComplete.message', formatCurrency(completeConfirm.balance))
              : t('so.confirmComplete.messageNoBalance')
          }
          variant="warning"
          confirmLabel={t('so.confirmBtn')}
          cancelLabel={t('so.cancelBtn')}
          onConfirm={handleCompleteConfirmed}
          onCancel={() => setCompleteConfirm(null)}
        />
      )}

      {/* R-EDIT-AUDIT F5: edit history viewer. */}
      {historyTarget && (
        <EditHistoryModal
          open
          onClose={() => setHistoryTarget(null)}
          lang={lang}
          editHistory={historyTarget.editHistory || []}
          originalSnapshot={historyTarget.originalSnapshot}
        />
      )}

      {/* R-EDIT-AUDIT F5: corrected-vs-original print choice for edited tickets. */}
      {printChoiceTarget && (
        <Modal
          open
          title={t('so.printTicket')}
          onClose={() => setPrintChoiceTarget(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => {
                printSpecialOrderEntity(printChoiceTarget, {
                  corrected: true,
                  originalSnapshot: printChoiceTarget.originalSnapshot,
                });
                setPrintChoiceTarget(null);
              }}
            >
              {t('so.printCurrent')}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => {
                // R-EDIT-AUDIT F6-FIX: explicit money-field mapping instead of
                // raw snapshot spread. Keeps id/createdAt/status/editHistory
                // from the current entity; only pre-edit money values come
                // from the snapshot.
                if (printChoiceTarget.originalSnapshot?.snapshot) {
                  const snap = printChoiceTarget.originalSnapshot.snapshot;
                  printSpecialOrderEntity({
                    ...printChoiceTarget,
                    price: (snap.price as number | undefined) ?? printChoiceTarget.price,
                    cost: (snap.cost as number | undefined) ?? printChoiceTarget.cost,
                    depositAmount: (snap.depositAmount as number | undefined) ?? printChoiceTarget.depositAmount,
                    balance: (snap.balance as number | undefined) ?? printChoiceTarget.balance,
                    total: (snap.total as number | undefined) ?? (printChoiceTarget as any).total,
                    taxAmount: (snap.taxAmount as number | undefined) ?? (printChoiceTarget as any).taxAmount,
                  } as SpecialOrder);
                } else {
                  printSpecialOrderEntity(printChoiceTarget);
                }
                setPrintChoiceTarget(null);
              }}
            >
              {t('so.printOriginal')}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => setPrintChoiceTarget(null)}
            >
              {t('so.cancelBtn')}
            </button>
          </div>
        </Modal>
      )}

      {/* R-EDIT-AUDIT F5: confirm Mark Refunded → closes out refund_pending state. */}
      {refundConfirmTarget && (
        <ConfirmDialog
          open
          title={t('so.confirmRefund.title')}
          message={t('so.confirmRefund.message', (((refundConfirmTarget as any).refundOwedAmount || 0) / 100).toFixed(2))}
          confirmLabel={t('so.confirmRefund.confirm')}
          cancelLabel={t('so.cancelBtn')}
          onConfirm={() => {
            const target = refundConfirmTarget;
            // F7-FIX-v2: double-refund guard.
            if (normalizeStatus(target.status) === 'refunded') {
              setRefundConfirmTarget(null);
              return;
            }
            const now = new Date().toISOString();
            const refundAmountCents = (target as any).refundOwedAmount || 0;

            // 1. Mark ticket as refunded.
            const updated: SpecialOrder = {
              ...target,
              status: 'refunded',
              refundOwedAmount: 0,
              updatedAt: now,
            };
            const nextOrders = specialOrdersRef.current.map((o) => (o.id === updated.id ? updated : o));
            specialOrdersRef.current = nextOrders;
            setSpecialOrders(nextOrders);
            persist.specialOrder(updated.id, updated as unknown as Record<string, unknown>);

            // 2. F7-FIX-v2: partial refund sale. status='completed' (NOT voided)
            //    so Reports includes it with negative total, subtracting from
            //    gross. Originals stay untouched — partial refund, not cancellation.
            if (refundAmountCents > 0) {
              const refundSale: Sale = {
                id: generateId(),
                storeId: (updated as any).storeId,
                invoiceNumber: `REFUND-${updated.id.slice(-6).toUpperCase()}`,
                customerId: (updated as any).customerId,
                customerName: updated.customerName || 'Walk-in',
                customerPhone: updated.customerPhone || '',
                items: [{
                  id: generateId(),
                  name: `${updated.itemDescription || t('so.cartItemName')} — ${t('so.postEditRefundName')}`,
                  category: 'service' as any,
                  price: -refundAmountCents,
                  qty: 1,
                  taxable: false,
                  cbeEligible: false,
                  specialOrderId: updated.id,
                }],
                subtotal: -refundAmountCents,
                taxAmount: 0,
                cbeTotal: 0,
                total: -refundAmountCents,
                paymentMethod: 'Cash' as any,
                status: 'completed',
                employeeId: currentEmployee?.id,
                employeeName: currentEmployee?.name,
                notes: `Post-edit refund — Special Order ${updated.id.slice(-6).toUpperCase()}`,
                refundReason: 'Post-edit refund',
                createdAt: now,
              };
              const nextSales = [...salesRef.current, refundSale];
              salesRef.current = nextSales;
              setSales(nextSales);
              persist.sale(refundSale.id, refundSale as unknown as Record<string, unknown>);
            }

            toast(t('so.refundProcessed'), 'success');
            setRefundConfirmTarget(null);
          }}
          onCancel={() => setRefundConfirmTarget(null)}
        />
      )}
    </>
  );
}

// ── SpecialOrderModal ─────────────────────────────────────

// R-EDIT-AUDIT F5: audit metadata for locked-ticket saves.
interface SpecialOrderAuditMeta {
  reason: EditReason;
  changes: FieldChange[];
  note?: string;
}

interface SpecialOrderModalProps {
  editOrder: SpecialOrder | null;
  form: Partial<SpecialOrder>;
  setForm: (f: Partial<SpecialOrder>) => void;
  customers: Customer[];
  settings: import('@/store/types').StoreSettings;
  // R-EDIT-AUDIT F5: signature extended to accept optional audit metadata.
  onSave: (auditMeta?: SpecialOrderAuditMeta) => void;
  onRequestCancel?: (order: SpecialOrder) => void;
  onPrint?: () => void;
  onClose: () => void;
  lang: string;
  // R-EDIT-AUDIT F5: freshest orders list for stale check on locked edits.
  allOrders: SpecialOrder[];
}

// FIX Bug 2: align modal statuses with filter tab values (normalized lowercase)
const SPECIAL_ORDER_STATUSES = ['ordered', 'in_transit', 'received', 'ready', 'picked_up', 'cancelled', 'refund_pending', 'refunded'];

function SpecialOrderModal({ editOrder, form, setForm, customers, settings, onSave, onRequestCancel, onPrint, onClose, lang, allOrders }: SpecialOrderModalProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const upd = (field: keyof SpecialOrder, val: any) => setForm({ ...form, [field]: val });

  // R-EDIT-AUDIT F5: normalize helper matches the module's lowercase/snake convention.
  const normalizeStatus = (s: string) => (s || '').toLowerCase().replace(/ /g, '_');

  // R-EDIT-AUDIT F5.1: lock money fields on completed tickets.
  // totalPaid = what customer has paid (price - outstanding balance).
  const totalPaid = (editOrder?.price || 0) - (editOrder?.balance || 0);
  const isLocked = !!editOrder && (
    (editOrder.balance === 0 && totalPaid > 0)
    || normalizeStatus(editOrder.status) === 'refunded'
  );

  // R-EDIT-AUDIT F5.2: PIN gate + reason selector state live inside the modal.
  const pin = usePinGate(settings?.adminPin);
  const [showReasonSelector, setShowReasonSelector] = useState(false);
  const [pendingAuditPayload, setPendingAuditPayload] = useState<{ changes: FieldChange[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Wrap close so we reset the PIN unlock and saving guard.
  const handleClose = () => {
    pin.resetLock();
    setIsSaving(false);
    setShowReasonSelector(false);
    setPendingAuditPayload(null);
    onClose();
  };

  // Dollar helpers for display (prices stored as dollar strings)
  const priceC = Math.round((parseFloat(form.price as any) || 0) * 100);
  const costC = Math.round((parseFloat(form.cost as any) || 0) * 100);
  const depositC = Math.round((parseFloat(form.depositAmount as any) || 0) * 100);
  const taxable  = !!(form as any).taxable;
  const taxRate  = settings.taxRate ?? 0.0925;
  const _formTotals = calcDepositTotals(priceC, depositC, taxRate, taxable);
  const taxC     = _formTotals.taxCents;
  const totalC   = _formTotals.totalWithTaxCents;
  const profitC  = priceC - costC;
  const balanceC = _formTotals.balanceCents;

  // firstName/lastName split autocomplete
  const firstNameOptions = useMemo(() =>
    customers.map((c) => {
      const parts = c.name.trim().split(' ');
      return { value: parts[0] || '', label: parts[0] || '', sublabel: c.phone, data: c };
    }).filter((o) => o.value.length > 0),
    [customers],
  );
  const lastNameOptions = useMemo(() => {
    const base = customers
      .filter((c) => !(form as any).firstName || c.name.toLowerCase().startsWith(((form as any).firstName || '').toLowerCase()))
      .map((c) => {
        const parts = c.name.trim().split(' ');
        const last = parts.slice(1).join(' ');
        return { value: last, label: last, sublabel: c.phone, data: c };
      }).filter((o) => o.value.length > 0);
    return base.filter((o, i, arr) => arr.findIndex((x) => x.label === o.label) === i);
  }, [customers, (form as any).firstName]);
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
  const itemOptions = useMemo(() =>
    DEVICE_MODEL_OPTIONS.map((o) => o),
    [],
  );

  // R-EDIT-AUDIT F5.3: handleSubmit wraps onSave with the locked-ticket flow.
  // Non-locked path → plain onSave() (parent's handleSave with no auditMeta).
  // Locked path → stale/H2/cap checks, diff form against fresh entity, and
  // either open the reason selector (money change) or invoke onSave with
  // typo_correction auditMeta (info-only change).
  const handleSubmit = () => {
    if (isSaving) return;

    // Non-locked: delegate straight to parent.
    if (!editOrder || !isLocked) {
      onSave();
      return;
    }

    setIsSaving(true);
    const fresh = (allOrders || []).find((o) => o.id === editOrder.id);
    if (!fresh) {
      toast(t('so.modal.deletedExternally'), 'error');
      handleClose();
      return;
    }
    const freshNorm = normalizeStatus(fresh.status);
    if (freshNorm === 'cancelled' || freshNorm === 'refunded') {
      toast(t('so.modal.ticketCancelledCannotEdit'), 'error');
      handleClose();
      return;
    }
    // R-CROSS-STALE-CHECK-NORMALIZATION: same fix as RepairModal B1 —
    // String(date_object) is locale-dependent and differs from String(iso_string)
    // for the same instant when storage format is mixed.
    const normalizeUpdatedAt = (v: unknown): number => {
      if (v instanceof Date) return v.getTime();
      if (v != null && typeof (v as any).toDate === 'function') return (v as any).toDate().getTime();
      if (typeof v === 'string') return Date.parse(v);
      if (typeof v === 'number') return v;
      return 0;
    };
    if (fresh.updatedAt && editOrder.updatedAt && normalizeUpdatedAt(fresh.updatedAt) !== normalizeUpdatedAt(editOrder.updatedAt)) {
      toast(t('so.modal.ticketModifiedOtherStation'), 'error');
      handleClose();
      return;
    }

    const historyStatus = checkEditHistoryStatus(fresh.editHistory);
    if (historyStatus === 'full') {
      toast(t('so.modal.editHistoryFull'), 'error');
      setIsSaving(false);
      return;
    }
    if (historyStatus === 'warning') {
      toast(t('so.modal.editHistoryWarning', fresh.editHistory?.length || 0), 'warning');
    }

    // Form stores money as dollar strings/numbers; convert to cents for diff.
    const priceCents = Math.round((parseFloat(form.price as any) || 0) * 100);
    const costCents = Math.round((parseFloat(form.cost as any) || 0) * 100);

    const reference: Record<string, unknown> = {
      price: fresh.price ?? 0,
      cost: fresh.cost ?? 0,
      taxable: (fresh as any).taxable ?? false,
      customerName: fresh.customerName ?? '',
      customerPhone: fresh.customerPhone ?? '',
      itemDescription: fresh.itemDescription ?? '',
      supplier: fresh.supplier ?? '',
      estimatedArrival: fresh.estimatedArrival ?? '',
      notes: fresh.notes ?? '',
      employeeName: fresh.employeeName ?? '',
    };
    const customerName = `${((form as any).firstName || '').trim()} ${((form as any).lastName || '').trim()}`.trim();
    const current: Record<string, unknown> = {
      price: priceCents,
      cost: costCents,
      taxable: !!(form as any).taxable,
      customerName,
      // R-PHONE-SANITIZE-SWEEP: 10-digit form on the SO record itself.
      customerPhone: normalizePhone(form.customerPhone || ''),
      itemDescription: form.itemDescription ?? '',
      supplier: form.supplier ?? '',
      estimatedArrival: form.estimatedArrival ?? '',
      notes: form.notes ?? '',
      employeeName: fresh.employeeName ?? '', // not in form — keep reference value
    };

    const fieldsToCheck = (SPECIAL_ORDER_ALL_FIELDS as readonly string[]).filter((f) => f !== 'depositAmount');
    const changes = computeDiff(reference, current, fieldsToCheck);
    if (changes.length === 0) {
      handleClose();
      return;
    }

    const moneyChanged = hasMoneyChanges(changes, SPECIAL_ORDER_MONEY_FIELDS as unknown as string[]);
    if (moneyChanged) {
      setPendingAuditPayload({ changes });
      setShowReasonSelector(true);
      // Keep isSaving=true; resolution path (reason selected or cancel) resets it.
      return;
    }

    // Info-only change → save as typo_correction, no reason prompt.
    onSave({ reason: 'typo_correction', changes, note: '' });
    handleClose();
  };

  const handleReasonSelected = (reason: EditReason, note: string) => {
    if (!pendingAuditPayload) return;
    const { changes } = pendingAuditPayload;
    setShowReasonSelector(false);
    setPendingAuditPayload(null);
    onSave({ reason, changes, note });
    handleClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '560px', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontWeight: 700 }}>
            📋 {editOrder ? t('so.modal.editTitle') : t('so.modal.newTitle')}
          </h3>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

          {/* R-EDIT-AUDIT F5.2: banner when admin unlocks money fields post-completion. */}
          {isLocked && pin.editUnlocked && (
            <div style={{
              background: 'rgba(251, 191, 36, 0.15)',
              border: '1px solid rgba(251, 191, 36, 0.4)',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
            }}>
              <span>⚠️</span>
              <span>
                {t('so.modal.editingCompletedTicket')}
              </span>
            </div>
          )}

          {/* Customer */}
          {/* r-customer-picker-sweep: wrap customer inputs in shared
              CustomerSearchHeader for explicit "Select Customer" button. */}
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
              } as any);
            }}
          >
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label className="label">👤 {t('so.modal.firstName')}</label>
                <AutocompleteInput
                  value={(form as any).firstName || ''}
                  onChange={(val) => setForm({ ...form, firstName: val } as any)}
                  onSelect={(opt) => {
                    setForm({ ...form, firstName: opt.value,
                      lastName: (form as any).lastName || (opt.data as Customer)?.name?.split(' ').slice(1).join(' ') || '',
                      // R-PHONE-SANITIZE-SWEEP: re-normalize on autocomplete pick — defense
                      // in depth in case a legacy customer record still has formatted phone.
                      customerPhone: normalizePhone(form.customerPhone || (opt.data as Customer)?.phone || ''),
                    } as any);
                  }}
                  options={firstNameOptions}
                  placeholder={t('so.modal.firstNamePlaceholder')}
                  maxResults={6}
                />
              </div>
              <div>
                <label className="label">{t('so.modal.lastName')}</label>
                <AutocompleteInput
                  value={(form as any).lastName || ''}
                  onChange={(val) => setForm({ ...form, lastName: val } as any)}
                  onSelect={(opt) => {
                    setForm({ ...form, lastName: opt.value,
                      firstName: (form as any).firstName || (opt.data as Customer)?.name?.split(' ')[0] || '',
                      // R-PHONE-SANITIZE-SWEEP: same defense-in-depth normalization on this autocomplete path.
                      customerPhone: normalizePhone(form.customerPhone || (opt.data as Customer)?.phone || ''),
                    } as any);
                  }}
                  options={lastNameOptions}
                  placeholder={t('so.modal.lastNamePlaceholder')}
                  maxResults={6}
                />
              </div>
            </div>

            {/* Phone */}
            <div style={{ marginTop: '0.75rem' }}>
              <label className="label">📞 {t('so.modal.phone')}</label>
              <AutocompleteInput
                type="tel"
                value={form.customerPhone || ''}
                onChange={(val) => upd('customerPhone', val)}
                onSelect={(opt) => {
                  upd('customerPhone', opt.value);
                  if (opt.data) upd('customerName', (opt.data as Customer).name || form.customerName || '');
                }}
                options={phoneOptions}
                placeholder="(805) 000-0000"
                maxResults={6}
                matchHint={phoneMatch ? (
                  <span style={{ fontSize: '0.72rem', color: '#34d399' }}>&#10003; {phoneMatch.name}</span>
                ) : undefined}
              />
            </div>
          </CustomerSearchHeader>

          {/* Item */}
          <div>
            <label className="label">📦 {t('so.modal.itemDesc')}</label>
            <AutocompleteInput
              value={form.itemDescription || ''}
              onChange={(val) => upd('itemDescription', val)}
              onSelect={(opt) => upd('itemDescription', opt.value)}
              options={itemOptions}
              placeholder={t('so.modal.itemDescPlaceholder')}
              maxResults={8}
            />
          </div>

          {/* Supplier */}
          <div>
            <label className="label">🏭 {t('so.modal.supplier')}</label>
            <input className="input" value={form.supplier || ''} onChange={(e) => upd('supplier', e.target.value)} placeholder={t('so.modal.supplierPlaceholder')} />
          </div>

          {/* Status */}
          <div>
            <label className="label">{t('so.modal.status')}</label>
            <select className="select" value={form.status || 'ordered'} onChange={(e) => upd('status', e.target.value)}>
              {SPECIAL_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
              ))}
            </select>
          </div>

          {/* Pricing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="label">
                {isLocked && !pin.editUnlocked && '🔒 '}💵 {t('so.modal.cost')}
              </label>
              {/* R-EDIT-AUDIT F5.2: lock cost on completed tickets. */}
              <div style={{ position: 'relative' }}>
                <input
                  className="input" type="number" step="0.01" min="0"
                  value={form.cost as any}
                  onChange={(e) => upd('cost', e.target.value)}
                  placeholder="0.00"
                  disabled={isLocked && !pin.editUnlocked}
                  style={isLocked && !pin.editUnlocked ? { opacity: 0.6 } : undefined}
                />
                {isLocked && !pin.editUnlocked && (
                  <span
                    onClick={pin.requestUnlock}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: '1rem' }}
                    title={t('so.modal.unlockWithPin')}
                  >🔒</span>
                )}
              </div>
            </div>
            <div>
              <label className="label">
                {isLocked && !pin.editUnlocked && '🔒 '}🏷️ {t('so.modal.price')}
              </label>
              {/* R-EDIT-AUDIT F5.2: lock price on completed tickets. */}
              <div style={{ position: 'relative' }}>
                <input
                  className="input" type="number" step="0.01" min="0"
                  value={form.price as any}
                  onChange={(e) => upd('price', e.target.value)}
                  placeholder="0.00" style={{ fontWeight: 700, opacity: isLocked && !pin.editUnlocked ? 0.6 : 1 }}
                  disabled={isLocked && !pin.editUnlocked}
                />
                {isLocked && !pin.editUnlocked && (
                  <span
                    onClick={pin.requestUnlock}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: '1rem' }}
                    title={t('so.modal.unlockWithPin')}
                  >🔒</span>
                )}
              </div>
            </div>
            <div>
              <label className="label">💰 {t('so.modal.deposit')}</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input" type="number" step="0.01" min="0"
                  value={form.depositAmount as any}
                  onChange={(e) => upd('depositAmount', e.target.value)}
                  disabled={!!editOrder}
                  placeholder="0.00"
                  style={{ color: '#10b981', fontWeight: 700, opacity: editOrder ? 0.6 : 1 }}
                />
                {editOrder && (
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    🔒
                  </span>
                )}
              </div>
              {editOrder && (
                <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  {t('so.modal.depositLocked')}
                </p>
              )}
            </div>
          </div>

          {/* r-new-8: hint for already-delivered orders — redirect to Returns module */}
          {editOrder && editOrder.status === 'picked_up' && (
            <div style={{
              padding: '0.75rem',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '0.5rem',
              fontSize: '0.82rem',
              color: '#93c5fd',
            }}>
              ℹ️ {t('so.modal.orderDeliveredHint')}
            </div>
          )}

          {/* Taxable toggle */}
          {/* R-EDIT-AUDIT F5.2: taxable is money-impacting — lock on completed tickets. */}
          <div style={{ opacity: isLocked && !pin.editUnlocked ? 0.6 : 1 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: isLocked && !pin.editUnlocked ? 'not-allowed' : 'pointer', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={taxable}
                onChange={(e) => upd('taxable' as any, e.target.checked)}
                disabled={isLocked && !pin.editUnlocked}
                style={{ width: '1rem', height: '1rem', cursor: isLocked && !pin.editUnlocked ? 'not-allowed' : 'pointer' }}
              />
              <span>
                {isLocked && !pin.editUnlocked && '🔒 '}
                🧾 {t('so.modal.chargeSalesTax', (taxRate * 100).toFixed(2))}
              </span>
              {isLocked && !pin.editUnlocked && (
                <span
                  onClick={pin.requestUnlock}
                  style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: '0.9rem' }}
                  title={t('so.modal.unlockWithPin')}
                >🔒</span>
              )}
            </label>
          </div>

          {/* Totals preview */}
          {priceC > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem', padding: '0.75rem', fontSize: '0.875rem' }}>
              {costC > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', padding: '0.2rem 0' }}>
                    <span>{t('so.modal.costLabel')}:</span><span>${(costC / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: profitC >= 0 ? '#10b981' : '#ef4444', padding: '0.2rem 0', fontWeight: 700 }}>
                    <span>📈 {t('so.modal.profit')}:</span>
                    <span>${(profitC / 100).toFixed(2)} {priceC > 0 && costC > 0 && <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>({((profitC / priceC) * 100).toFixed(1)}%)</span>}</span>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.3rem 0' }} />
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1', padding: '0.2rem 0' }}>
                <span>{t('so.modal.priceLabel')}:</span><span>${(priceC / 100).toFixed(2)}</span>
              </div>
              {taxable && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', padding: '0.2rem 0' }}>
                  <span>+ {t('so.modal.taxLabel')} ({(taxRate * 100).toFixed(2)}%):</span><span>+${(taxC / 100).toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#fff', padding: '0.25rem 0', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.2rem' }}>
                <span>{t('so.modal.total')}:</span><span>${(totalC / 100).toFixed(2)}</span>
              </div>
              {depositC > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981', padding: '0.2rem 0' }}>
                  <span>− {t('so.modal.depositLabel')}:</span><span>−${(depositC / 100).toFixed(2)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: balanceC > 0 ? '#f59e0b' : '#10b981', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.35rem', marginTop: '0.25rem', fontSize: '1rem' }}>
                <span>= {t('so.modal.balanceLabel')}:</span><span>${(balanceC / 100).toFixed(2)}</span>
              </div>
              {taxable && depositC > 0 && (
                <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(59,130,246,0.08)', borderRadius: '0.4rem', fontSize: '0.72rem', color: '#93c5fd' }}>
                  💡 {t('so.modal.depositBreakdown',
                    (depositC / 100).toFixed(2),
                    ((depositC / (1 + taxRate)) / 100).toFixed(2),
                    ((depositC - depositC / (1 + taxRate)) / 100).toFixed(2),
                  )}
                </div>
              )}
            </div>
          )}

          {/* Estimated arrival */}
          <div>
            <label className="label">📅 {t('so.modal.estArrival')}</label>
            <input className="input" type="date" value={form.estimatedArrival || ''} onChange={(e) => upd('estimatedArrival', e.target.value)} />
          </div>

          {/* Notes */}
          <div>
            <label className="label">📝 {t('so.modal.notes')}</label>
            <textarea className="input" rows={2} value={form.notes || ''} onChange={(e) => upd('notes', e.target.value)} placeholder={t('so.modal.notesPlaceholder')} style={{ resize: 'vertical' }} />
          </div>

          {!editOrder && depositC > 0 && (
            <div style={{ padding: '0.65rem 0.875rem', background: 'rgba(16,185,129,0.1)', borderRadius: '0.5rem', border: '1px solid rgba(16,185,129,0.3)', fontSize: '0.82rem', color: '#10b981' }}>
              💡 {t('so.modal.depositAutoCart')}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleClose}>{t('so.cancelBtn')}</button>
          {onPrint && editOrder && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={onPrint}
            >
              🖨️ {lang === 'es' ? 'Imprimir' : lang === 'pt' ? 'Imprimir' : 'Print'}
            </button>
          )}
          {/* r-new-4 port: Cancel Order with disposition. Only shown when editing
              an SO that has a deposit — unpaid orders can be deleted directly.
              r-new-8: also hidden on terminal statuses (picked_up / cancelled) —
              post-delivery refunds must go through the Returns module. */}
          {editOrder
            && (editOrder.depositAmount || 0) > 0
            && !['picked_up', 'cancelled', 'Cancelled'].includes(editOrder.status)
            && onRequestCancel && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1, color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
              onClick={() => { handleClose(); onRequestCancel(editOrder); }}
            >
              ❌ {t('so.modal.cancelOrder')}
            </button>
          )}
          {/* R-EDIT-AUDIT F5.3: save routes through handleSubmit to pick up the
              locked-ticket audit flow. Explicit arrow avoids MouseEvent leaking
              into onSave's optional auditMeta parameter. */}
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={() => handleSubmit()}>💾 {t('so.saveBtn')}</button>
        </div>

        {/* R-EDIT-AUDIT F5.2-3: reason selector + admin PIN challenge. */}
        <ReasonSelectorModal
          open={showReasonSelector}
          lang={lang}
          onSelect={(reason, note) => handleReasonSelected(reason, note)}
          onCancel={() => {
            setShowReasonSelector(false);
            setPendingAuditPayload(null);
            setIsSaving(false);
          }}
        />
        <AdminPinGate
          open={pin.showPinGate}
          adminPin={settings?.adminPin || ''}
          onSuccess={pin.handleSuccess}
          onCancel={pin.handleCancel}
        />
      </div>
    </div>
  );
}
