// ============================================================
// CellHub Pro — Unlock Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { Modal, SearchInput, AutocompleteInput, ConfirmDialog } from '@/components/ui';
import { getLabels } from '@/config/i18n';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
import { matchesSearchPhones } from '@/utils/search';
import { normalizePhone } from '@/utils/normalize';
import { generateId } from '@/utils/dates';
// R-COMMS-SMS-HARD-DISABLE: sendSms import removed.
import { persist, remove } from '@/services/persist';
// R-PAYMENT-TRACE-RECEIPTS-REPAIRS-UNLOCKS-V1: reuse the shared payment-trace
// audit trail (summary mode — unlocks store aggregates, not per-payment history).
import { buildPaymentTrace, renderPaymentTraceHtml, paymentTraceI18n } from '@/services/receipts/paymentTrace';
import DepositModal from '@/components/DepositModal';
import { calcDepositTotals, reverseTaxFromPayment, forwardTaxFromBase } from '@/utils/depositTax';
import TicketListLayout from '@/components/shared/TicketListLayout';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import TicketCard from '@/components/shared/TicketCard';
import CustomerPicker from '@/components/shared/CustomerPicker';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { usePrint } from '@/hooks/usePrint';
import { openWhatsApp, buildWaMessage } from '@/services/whatsapp';
import { CARRIER_OPTIONS, DEVICE_MODEL_OPTIONS } from '@/config/autocompleteData';
import type { AutocompleteOption } from '@/hooks/useAutocomplete';
import type { Unlock, UnlockType, CartItem, Customer, Sale, EditAuditEntry } from '@/store/types';
import CancelUnlockModal from './CancelUnlockModal';
import AdminPinGate from '@/components/shared/AdminPinGate';
import { usePinGate } from '@/hooks/usePinGate';
import ReasonSelectorModal from '@/components/ReasonSelectorModal';
import EditHistoryModal from '@/components/EditHistoryModal';
import {
  computeDiff, hasMoneyChanges, captureSnapshot, appendEditEntry,
  checkEditHistoryStatus,
  UNLOCK_MONEY_FIELDS, UNLOCK_ALL_FIELDS,
  type FieldChange, type EditReason,
} from '@/services/editAudit';
import { useApprovalGate } from '@/hooks/useApprovalGate';
import { setIntelligenceContext, clearEntityContext } from '@/services/intelligence/context/intelligenceContext';
import { emitUnlockAmbient } from '@/services/intelligence/ambient/ambientAwarenessService';
import { escHtml } from '@/utils/escHtml';
// R-RECEIPT-UNIFY-UNLOCK-V1: reuse the POS payment-receipt barcode renderer +
// bundled QR lib so the unlock receipt shares the same visual system.
import { renderBarcodeSvg, getReceiptBarcodeHeight } from '@/modules/pos/ReceiptModal';
import QRCode from 'qrcode';

// Typed accessor for `taxable` — present at runtime but absent from the Unlock interface.
// Narrower than `as any`: casts to a specific shape so the return type is boolean, not any.
const getTaxable = (u: unknown): boolean => !!(u as { taxable?: boolean }).taxable;

// R-EDIT-AUDIT: added 'Refund Pending' (active) and 'Refunded' (done).
// Normalized forms: refund_pending, refunded.
const STATUSES = ['All', 'Received', 'Processing', 'Code Received', 'Completed', 'Cancelled', 'Failed', 'Refund Pending', 'Refunded'];

const STATUS_BADGE: Record<string, string> = {
  'Received': 'badge-info',
  'Processing': 'badge-warning',
  'Code Received': 'badge-success',
  'Completed': 'badge-success',
  'Cancelled': 'badge-danger',
  'Failed': 'badge-danger',
  'Refund Pending': 'badge-warning',
  'Refunded': 'badge-danger',
};

function generateImei(): string {
  const digits: number[] = Array.from({ length: 14 }, () => Math.floor(Math.random() * 10));
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = digits[i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return [...digits, check].join('');
}

export default function UnlockModule() {
  const {
    state: { unlocks, customers, settings, employees, currentEmployee, cart, sales, lang, globalSearchTerm, currentStoreId },
    setUnlocks, setCustomers, setCart, setSales, dispatch,
  } = useApp();

  const { toast } = useToast();
  const { t } = useTranslation();
  const { highlightRef, isHighlighted } = useHighlightRecord();
  const { printHtml } = usePrint();
  const L = getLabels(lang);
  const approvalGate = useApprovalGate({ employees, settings, attemptedByName: currentEmployee?.name });

  const unlocksRef = useRef(unlocks);
  useEffect(() => { unlocksRef.current = unlocks; }, [unlocks]);

  useEffect(() => {
    const handler = (e: Event) => {
      // INTEL-ACTION-CONTEXT-AND-NAV-RACE-FIX-V1: ack the AppShell relay —
      // preventDefault on the cancelable event stops its bounded retry loop.
      e.preventDefault();
      const { unlockId } = (e as CustomEvent<{ unlockId?: string }>).detail ?? {};
      if (!unlockId) return;
      const unlock = unlocksRef.current.find((u) => u.id === unlockId);
      // R-INTELLIGENCE-ACTION-RELIABILITY-V2: not found → safe no-op + toast.
      if (!unlock) {
        console.warn('[cellhub] _intel-open-unlock: not found', unlockId);
        toast(t('intel.entityNotFound'), 'error');
        return;
      }
      // R-INTELLIGENCE-OPEN-ENTITY-RUNTIME-POLISH-V1: the inline edit modal renders the
      // parent `form` state (populated cents→dollars by openEdit), NOT editUnlock
      // directly. setEditUnlock alone left `form` stale → blank/placeholder fields.
      // Route through openEdit (same path as the card Edit button) so the real unlock
      // populates the form + selected customer and opens the modal.
      openEdit(unlock);
    };
    window.addEventListener('cellhub:_intel-open-unlock', handler);
    return () => window.removeEventListener('cellhub:_intel-open-unlock', handler);
  }, [t]);

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
  // R-REPAIR-UNLOCK-CANCEL-DOUBLECLICK-UX1: parent-owned busy flag so the cancel
  // modal's confirm button disables on first click and ignores rapid double-clicks.
  const [cancelInFlight, setCancelInFlight] = useState(false);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Unlock | null>(null);
  const [completeConfirm, setCompleteConfirm] = useState<Unlock | null>(null);

  // R-INTELLIGENCE-CONTEXT-AWARE-V1: broadcast active unlock entity so Intelligence
  // surfaces contextual recommendations for this specific ticket.
  // R-INTELLIGENCE-AMBIENT-AWARENESS-V1: emit passive ambient hint on entity open;
  // clear entity context when modal closes to prevent stale context bleed.
  useEffect(() => {
    if (editUnlock) {
      setIntelligenceContext({
        activeModule: 'unlocks',
        activeUnlockId: editUnlock.id,
        activeCustomerId: (editUnlock as any).customerId ?? undefined,
      });
      emitUnlockAmbient(editUnlock);
    } else {
      clearEntityContext();
    }
  }, [editUnlock]);

  // R-EDIT-AUDIT F4: post-completion edit tracking — PIN gate, reason prompt,
  // edit-history viewer, print-choice dialog, Mark Refunded confirmation.
  const [historyTarget, setHistoryTarget] = useState<Unlock | null>(null);
  const [printChoiceTarget, setPrintChoiceTarget] = useState<Unlock | null>(null);
  const [refundConfirmTarget, setRefundConfirmTarget] = useState<Unlock | null>(null);
  const [showReasonSelector, setShowReasonSelector] = useState(false);
  const [pendingAuditPayload, setPendingAuditPayload] = useState<{
    baseUpdated: Unlock;
    changes: FieldChange[];
    fresh: Unlock;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const pin = usePinGate(settings?.adminPin);

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
        All: t('unlocks.filter.all'),
        Received: t('unlocks.status.received'),
        Processing: t('unlocks.status.processing'),
        'Code Received': t('unlocks.status.codeReceived'),
        Completed: t('unlocks.status.completed'),
        Cancelled: t('unlocks.status.cancelled'),
        Failed: t('unlocks.status.failed'),
        'Refund Pending': t('unlocks.status.refundPending'),
        'Refunded': t('unlocks.status.refunded'),
      };
      return map[s] || s;
    }, [t],
  );

  const normalizeStatus = (s: string) => s.toLowerCase().replace(/ /g, '_');

  const filtered = useMemo(() => {
    return unlocks
      .filter((u) => filterStatus === 'All' || normalizeStatus(u.status) === normalizeStatus(filterStatus))
      // R-SEARCH-NORMALIZE-V1: phone-aware match; add u.id for parity
      // with the GlobalSearchBar unlock lookup at line ~242.
      .filter((u) => matchesSearchPhones(
        search,
        [u.customerPhone],
        u.customerName, u.device, u.imei, u.carrier, u.id,
      ))
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());
  }, [unlocks, filterStatus, search]);

  // R-EDIT-AUDIT: 'refunded' is terminal; 'refund_pending' stays active until Mark Refunded.
  const DONE_UNLOCK = ['completed', 'cancelled', 'failed', 'refunded'];
  const activeCount = useMemo(
    () => unlocks.filter((u) => !DONE_UNLOCK.includes(normalizeStatus(u.status))).length,
    [unlocks],
  );

  // R-EDIT-AUDIT F4.1: lock money fields on completed tickets.
  // totalPaid = what customer has paid so far (price - outstanding balance).
  // Lock when fully paid AND at least one payment made, OR status=refunded.
  const totalPaid = (editUnlock?.price || 0) - (editUnlock?.balance || 0);
  const isLocked = !!editUnlock && (
    (editUnlock.balance === 0 && totalPaid > 0)
    || normalizeStatus(editUnlock.status) === 'refunded'
  );

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Wrap the modal close so closing resets the PIN unlock state.
  const handleClose = () => {
    pin.resetLock();
    setIsSaving(false);
    setShowModal(false);
    setEditUnlock(null);
    setSelectedCustomer(null);
  };

  // ── Form state (inside modal) ───────────────────────────

  const [form, setForm] = useState<Partial<Unlock> & { taxable?: boolean }>({});

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
    setSelectedCustomer(null);
    const today = new Date().toISOString().slice(0, 10);
    setForm({
      firstName: '', lastName: '', customerPhone: '', device: '', imei: '',
      carrier: '', price: 0, cost: 0, depositAmount: 0, balance: 0,
      status: 'Received', notes: '',
      unlockType: '', unlockCode: '', supplier: '',
      orderDate: today, completionDate: '',
      taxable: false,
    });
    setShowModal(true);
  };

  const openEdit = (u: Unlock) => {
    setEditUnlock(u);
    // R-INTELLIGENCE-OPEN-ENTITY-RUNTIME-POLISH-V1: read from the ref so the
    // `[]`-deps _intel-open-unlock handler closure resolves the customer against
    // the freshest list (not the first-render snapshot).
    setSelectedCustomer(customersRef.current.find(c => c.id === u.customerId) ?? null);
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
    const taxRate = settings.taxRate ?? 0.0925;
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
    const taxRate = settings.taxRate ?? 0.0925;

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
      name: `${device} — ${t('unlocks.cartItemName')}`,
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

  // R-EDIT-AUDIT F4.5: entity-based unlock print (entity already in cents).
  // Parallel to the existing `printTicket` which reads from form state — this
  // one takes a persisted Unlock plus optional "corrected" display override,
  // so audit auto-reprints and the print-choice dialog can invoke it.
  const printUnlockEntity = async (unlock: Unlock, displayOverride?: {
    corrected?: boolean;
    originalSnapshot?: { capturedAt: string; snapshot: Record<string, unknown> };
  }) => {
    const storeName = settings.storeName || 'GO CELLULAR';
    const storeAddr = settings.storeAddress || '';
    const storePhone = settings.storePhone || '';
    const fmt = (v: unknown) => v == null ? '' : String(v);
    const money = (cents: unknown) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;
    const typeLabel = (tp?: string) => {
      if (!tp) return '';
      return ({ factory: 'Factory', imei: 'IMEI', subsidy: 'Subsidy', custom: 'Custom' } as Record<string, string>)[tp] || tp;
    };

    const corrected = !!displayOverride?.corrected;
    const snap = displayOverride?.originalSnapshot?.snapshot;
    const prevHtml = (field: string): string => {
      if (!corrected || !snap) return '';
      const prior = snap[field];
      const current = (unlock as any)[field];
      if (prior == null || prior === '' || prior === current) return '';
      if (typeof prior === 'number') return ` <span class="was">${escHtml(t('unlocks.print.previously', money(prior)))}</span>`;
      return '';
    };

    // R-PAYMENT-TRACE-RECEIPTS-REPAIRS-UNLOCKS-V1: summary payment trace.
    // Unlocks store only price + deposit + balance (no per-payment history), so
    // this is a summary (no PAYMENT HISTORY rows) — same shape as Special Orders.
    // Uses the values the receipt already shows; no money recomputation.
    const unlockTraceHtml = renderPaymentTraceHtml(
      buildPaymentTrace({
        originalTotalCents: unlock.price || 0,
        totalPaidCents: unlock.depositAmount || 0,
        balanceAfterCents: unlock.balance || 0,
        history: [],
        fallbackTodayCents: unlock.depositAmount || 0,
      }),
      paymentTraceI18n(t),
      escHtml,
      money,
    );

    const ticketNum = unlock.id.slice(-8).toUpperCase();
    // R-RECEIPT-UNIFY-UNLOCK-V1: rebuilt onto the SAME visual system as the POS
    // payment receipt — centered Go Cellular header, scannable CODE128 barcode
    // (ticket #), dashed separators, Arial typography, money section in the
    // master's totals style, shared footer + Google Reviews QR. ALL existing
    // data/logic preserved: corrected-reprint bar, previous-value annotations
    // (prevHtml), refund-owed line, carrier/type/supplier/code/dates/notes.
    // Money values formatted only — no financial math touched.
    const barcodeSvg = renderBarcodeSvg(ticketNum, getReceiptBarcodeHeight(settings.paperSize));
    let qrSvg = '';
    if (settings.showReviewQr && settings.googleReviewUrl) {
      try { qrSvg = await QRCode.toString(settings.googleReviewUrl, { type: 'svg', margin: 1, width: 80 }); }
      catch { /* QR optional — template falls back to a remote img */ }
    }
    const balanceDue = (unlock.balance || 0) > 0;
    const thanks = settings.receiptFooter || t('unlocks.print.thankYou');
    const lvRow = (label: string, value: string) =>
      `<tr><td style="font-size:11px;color:#444">${escHtml(label)}:</td><td style="text-align:right;font-size:11px;font-weight:600">${escHtml(value)}</td></tr>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unlock ${escHtml(ticketNum)}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 4in; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; background: #fff; }
  body { padding: 0.1in 0.15in; }
  @media screen { html, body { width: 100% !important; max-width: 100% !important; } img, svg { max-width: 100%; height: auto; } }
  table { width: 100%; border-collapse: collapse; }
  .sep { border-top: 1px dashed #999; margin: 5px 0; }
  .sec-lbl { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #666; border-bottom: 1px solid #ccc; padding-bottom: 1px; margin-bottom: 3px; }
  .corr-bar { background: #b91c1c; color: #fff; text-align: center; font-size: 10px; font-weight: 700; padding: 2px 0; margin: 4px 0; }
  .was { font-size: 9px; color: #999; font-style: italic; }
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } body, body * { color: #000 !important; border-color: #000 !important; } .corr-bar, .corr-bar * { color: #fff !important; background: #000 !important; } }
</style></head><body>
  <div style="width:100%;box-sizing:border-box;margin-bottom:4px;border-bottom:2px solid #000;padding-bottom:4px;overflow:hidden;text-align:center"><div style="font-size:18px;font-weight:900;line-height:1.1;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storeName)}</div>${storeAddr ? `<div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storeAddr)}</div>` : ''}${storePhone ? `<div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storePhone)}</div>` : ''}</div>
  <div style="width:100%;box-sizing:border-box;text-align:center;margin:0 0 6px 0;overflow:hidden">${barcodeSvg ? barcodeSvg.replace('<svg', '<svg style="display:inline-block;max-width:100%"') : ''}</div>
  ${corrected ? `<div class="corr-bar">${escHtml(t('unlocks.print.correctedReceipt'))}</div>` : ''}
  <table style="margin-bottom:5px">
    <tr><td style="font-size:11px">${escHtml(new Date().toLocaleString())}</td><td style="text-align:right;font-size:12px;font-weight:900">#${escHtml(ticketNum)}</td></tr>
    <tr><td colspan="2" style="text-align:center;font-size:13px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;padding-top:3px">${escHtml(t('unlocks.print.title'))}</td></tr>
    <tr><td colspan="2" style="font-size:10px;padding-top:2px">${escHtml(t('unlocks.print.status'))}: <strong>${escHtml(fmt(unlock.status))}</strong></td></tr>
    ${corrected ? `<tr><td colspan="2" style="font-size:10px">${escHtml(t('unlocks.print.correctedLabel'))}: ${escHtml(new Date().toLocaleString())}</td></tr>` : ''}
  </table>
  <div class="sep"></div>
  <div class="sec-lbl">${escHtml(t('unlocks.print.customer'))}</div>
  <table style="margin-bottom:5px">
    <tr><td colspan="2" style="font-size:11px;font-weight:600">${escHtml(fmt(unlock.customerName))}</td></tr>
    ${unlock.customerPhone ? lvRow(t('unlocks.print.phone'), fmt(unlock.customerPhone)) : ''}
  </table>
  <div class="sep"></div>
  <div class="sec-lbl">${escHtml(t('unlocks.print.device'))}</div>
  <table style="margin-bottom:5px">
    <tr><td colspan="2" style="font-size:11px;font-weight:600">${escHtml(fmt(unlock.device))}</td></tr>
    ${unlock.carrier ? lvRow(t('unlocks.print.carrier'), fmt(unlock.carrier)) : ''}
    ${unlock.imei ? lvRow('IMEI', fmt(unlock.imei)) : ''}
    ${unlock.unlockType ? lvRow(t('unlocks.print.type'), typeLabel(unlock.unlockType as string)) : ''}
    ${unlock.supplier ? lvRow(t('unlocks.print.supplier'), fmt(unlock.supplier)) : ''}
    ${unlock.unlockCode ? lvRow(t('unlocks.print.code'), fmt(unlock.unlockCode)) : ''}
    ${unlock.orderDate ? lvRow(t('unlocks.print.ordered'), fmt(unlock.orderDate)) : ''}
    ${unlock.completionDate ? lvRow(t('unlocks.print.completed'), fmt(unlock.completionDate)) : ''}
  </table>
  <div class="sep"></div>
  <table style="margin-bottom:5px">
    <tr><td>${escHtml(t('unlocks.print.price'))}:</td><td style="text-align:right">${escHtml(money(unlock.price || 0))}${prevHtml('price')}</td></tr>
    <tr><td>${escHtml(t('unlocks.print.deposit'))}:</td><td style="text-align:right">${escHtml(money(unlock.depositAmount || 0))}${prevHtml('depositAmount')}</td></tr>
    <tr style="border-top:1px solid #000">
      <td style="font-size:14px;font-weight:900;padding-top:4px">${escHtml(t('unlocks.print.balance'))}:</td>
      <td style="text-align:right;font-size:16px;font-weight:900;padding-top:4px${balanceDue ? ';color:#c00' : ''}">${escHtml(money(unlock.balance || 0))}${prevHtml('balance')}</td>
    </tr>
    ${corrected && (unlock.refundOwedAmount || 0) > 0 ? `<tr style="color:#b91c1c"><td>${escHtml(t('unlocks.print.refundOwed'))}:</td><td style="text-align:right;font-weight:700">${escHtml(money(unlock.refundOwedAmount || 0))}</td></tr>` : ''}
  </table>
  <div class="sep"></div>
  ${unlockTraceHtml}
  ${unlock.notes ? `<div class="sep"></div><div class="sec-lbl">${escHtml(t('unlocks.print.notes'))}</div><div style="font-size:10px">${escHtml(fmt(unlock.notes))}</div>` : ''}
  <div class="sep"></div>
  <div style="text-align:center;font-size:11px;font-weight:600;line-height:1.3">
    ${escHtml(thanks)}
    ${settings.showReviewQr && settings.googleReviewUrl ? `
    <div style="text-align:center;margin-top:8px;padding-top:6px;border-top:1px dashed #ccc">
      <div style="font-size:10px;font-weight:700;margin-bottom:4px">${escHtml(t('unlocks.print.reviewPrompt'))}</div>
      ${qrSvg
        ? `<div style="width:72px;height:72px;margin:0 auto">${qrSvg}</div>`
        : `<img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(settings.googleReviewUrl)}" width="72" height="72" style="display:block;margin:0 auto" />`}
      <div style="font-size:8px;color:#555;margin-top:3px">&#9733;&#9733;&#9733;&#9733;&#9733; Google</div>
    </div>` : ''}
  </div>
</body></html>`;
    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });
  };

  // R-EDIT-AUDIT F4.3-5: apply audit side-effects, append edit-history entry,
  // persist full entity, trigger corrected receipt. Called for both the info-only
  // typo_correction path (from handleSave) and the money-change path (from
  // handleReasonSelected after the user picks a reason).
  const applyAuditSave = (
    baseUpdated: Unlock,
    fresh: Unlock,
    reason: EditReason,
    changes: FieldChange[],
    note: string,
  ) => {
    const taxRate = settings.taxRate ?? 0.0925;
    const newTaxable = getTaxable(baseUpdated);
    const oldTaxable = getTaxable(fresh);
    const updated: Unlock = { ...baseUpdated };

    // Defensive: strip audit fields from any incoming spread and re-seed from fresh.
    delete updated.editHistory;
    delete updated.originalSnapshot;
    delete updated.refundOwedAmount;
    updated.editHistory = fresh.editHistory;
    updated.originalSnapshot = fresh.originalSnapshot;
    updated.refundOwedAmount = fresh.refundOwedAmount;

    const sideEffects: EditAuditEntry['sideEffects'] = {};
    switch (reason) {
      case 'additional_balance': {
        const fwd = forwardTaxFromBase(updated.price || 0, taxRate, newTaxable);
        const newTotal = fwd.totalCents;
        const alreadyPaid = fresh.depositAmount || 0;
        const newBalance = Math.max(0, newTotal - alreadyPaid);
        updated.balance = newBalance;
        updated.status = 'Received'; // Reopen for collection.
        sideEffects.balanceChange = newBalance - (fresh.balance || 0);
        sideEffects.statusChange = { from: String(fresh.status), to: 'Received' };
        break;
      }
      case 'absorbed': {
        updated.balance = 0;
        const oldFwd = forwardTaxFromBase(fresh.price || 0, taxRate, oldTaxable);
        const newFwd = forwardTaxFromBase(updated.price || 0, taxRate, newTaxable);
        sideEffects.absorbedAmount = Math.abs(newFwd.totalCents - oldFwd.totalCents);
        break;
      }
      case 'refund': {
        const oldFwd = forwardTaxFromBase(fresh.price || 0, taxRate, oldTaxable);
        const newFwd = forwardTaxFromBase(updated.price || 0, taxRate, newTaxable);
        const refundOwed = Math.max(0, oldFwd.totalCents - newFwd.totalCents);
        updated.refundOwedAmount = refundOwed;
        updated.status = 'Refund Pending';
        updated.balance = 0;
        sideEffects.refundOwedAmount = refundOwed;
        sideEffects.statusChange = { from: String(fresh.status), to: 'Refund Pending' };
        break;
      }
      case 'typo_correction':
        break;
    }

    if (!updated.originalSnapshot) {
      updated.originalSnapshot = captureSnapshot(fresh as unknown as Record<string, unknown>);
    }

    const now = new Date().toISOString();
    updated.updatedAt = now;

    const entry: EditAuditEntry = {
      editedAt: now,
      editedBy: currentEmployee?.name || 'Unknown',
      // AdminPinGate validates a single shared adminPin — no per-admin identity.
      pinUsedBy: currentEmployee?.name || 'Admin',
      reason,
      fieldsChanged: changes,
      note: note || undefined,
      sideEffects: Object.keys(sideEffects).length > 0 ? sideEffects : undefined,
    };
    if (checkEditHistoryStatus(updated.editHistory) === 'full') {
      toast(t('unlocks.errHistoryFullShort'), 'error');
      setIsSaving(false);
      return;
    }
    const newHistory = appendEditEntry(updated.editHistory, entry);
    if (newHistory === null) {
      toast(t('unlocks.errHistoryFullShort'), 'error');
      setIsSaving(false);
      return;
    }
    updated.editHistory = newHistory;

    const nextUnlocks = unlocksRef.current.map((u) => (u.id === updated.id ? updated : u));
    unlocksRef.current = nextUnlocks;
    setUnlocks(nextUnlocks);
    persist.unlock(updated.id, updated as unknown as Record<string, unknown>);

    if (reason !== 'typo_correction') {
      printUnlockEntity(updated, {
        corrected: true,
        originalSnapshot: updated.originalSnapshot,
      });
    }

    toast(t('unlocks.ticketUpdatedAudit'), 'success');
    handleClose();
  };

  const handleReasonSelected = (reason: EditReason, note: string) => {
    if (!pendingAuditPayload) return;
    const { baseUpdated, changes, fresh } = pendingAuditPayload;
    setShowReasonSelector(false);
    setPendingAuditPayload(null);
    applyAuditSave(baseUpdated, fresh, reason, changes, note);
  };

  const handleSave = useCallback(() => {
    // R-EDIT-AUDIT F4.3: double-submit guard. Prevents rapid clicks from
    // creating duplicate editHistory entries. Reset in every early-return path.
    if (isSaving) return;
    setIsSaving(true);

    const firstName = (form.firstName as string || '').trim();
    const lastName  = (form.lastName  as string || '').trim();
    const customerName = `${firstName} ${lastName}`.trim();
    if (!customerName) {
      toast(t('unlocks.errCustomerNameRequired'), 'error');
      setIsSaving(false);
      return;
    }
    if (!form.customerPhone?.trim()) {
      toast(t('unlocks.errPhoneRequired'), 'error');
      setIsSaving(false);
      return;
    }
    if (!form.device?.trim()) {
      toast(t('unlocks.errDeviceRequired'), 'error');
      setIsSaving(false);
      return;
    }

    // Form values are in DOLLARS — convert to cents for storage and calculations.
    // All persisted fields (price, cost, depositAmount, balance) are in CENTS,
    // matching the rest of the system (TicketCard, formatCurrency, DepositModal).
    const priceCents   = Math.round((form.price || 0) * 100);
    const costCents    = Math.round((form.cost || 0) * 100);
    const depositCents = Math.round((form.depositAmount || 0) * 100);
    const taxable = form.taxable ?? false;
    const taxRate = settings.taxRate ?? 0.0925;
    const _t = calcDepositTotals(priceCents, depositCents, taxRate, taxable);
    const balance = _t.balanceCents;

    if (depositCents > _t.totalWithTaxCents + 1) {
      toast(t('unlocks.errDepositExceedsTotal'), 'error');
      setIsSaving(false);
      return;
    }

    const normalizedImei = (form.imei || '').replace(/\s+/g, '').trim();

    // Auto-create customer — dedup by phone
    if (form.customerPhone) {
      const phone = normalizePhone(form.customerPhone);
      const existing = customers.find((c) => normalizePhone(c.phone) === phone);
      if (existing) {
        if (existing.name.toLowerCase() !== customerName.toLowerCase()) {
          toast(t('unlocks.existingCustomerFound', existing.name), 'info');
        }
      } else if (customerName) {
        const newCust: Customer = {
          // R-PHONE-SANITIZE-SWEEP: persist 10-digit form (or empty).
          id: generateId(), firstName, lastName, name: customerName, phone: normalizePhone(form.customerPhone || ''),
          email: '', loyaltyPoints: 0, storeCredit: 0,
          customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-4)}`,
          notes: '', communicationConsent: false, createdAt: new Date().toISOString(),
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
      const fwd = forwardTaxFromBase(priceCents, taxRate, taxable);
      const lockedBalance = Math.max(0, fwd.totalCents - lockedDeposit);

      const updated: Unlock = {
        ...editUnlock, ...form, customerName,
        customerId: selectedCustomer?.id ?? editUnlock.customerId ?? undefined,
        price: priceCents,
        cost: costCents,
        depositAmount: lockedDeposit,
        balance: lockedBalance,
        imei: normalizedImei,
        completionDate,
        updatedAt: new Date().toISOString(),
      } as Unlock;

      // R-EDIT-AUDIT F4.3: locked ticket → stale/H2/cap checks, diff, route to
      // reason selector or info-only typo_correction. Don't persist here when
      // locked; the audit-save path below handles it.
      if (isLocked) {
        const fresh = unlocksRef.current.find((u) => u.id === editUnlock.id);
        if (!fresh) {
          toast(t('unlocks.errTicketDeletedExternal'), 'error');
          handleClose();
          return;
        }
        const freshNorm = normalizeStatus(fresh.status);
        if (freshNorm === 'cancelled' || freshNorm === 'refunded') {
          toast(t('unlocks.errTicketCancelledRefunded'), 'error');
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
        if (fresh.updatedAt && editUnlock.updatedAt && normalizeUpdatedAt(fresh.updatedAt) !== normalizeUpdatedAt(editUnlock.updatedAt)) {
          toast(t('unlocks.errTicketModifiedOtherStation'), 'error');
          handleClose();
          return;
        }
        const historyStatus = checkEditHistoryStatus(fresh.editHistory);
        if (historyStatus === 'full') {
          toast(t('unlocks.errHistoryFull'), 'error');
          setIsSaving(false);
          return;
        }
        if (historyStatus === 'warning') {
          toast(t('unlocks.warningHistoryStatus', fresh.editHistory?.length || 0), 'warning');
        }

        // Build reference (fresh entity, cents) + current (form → cents) for diff.
        // depositAmount excluded: r-deposit-integrity-1 invariant keeps it read-only in form.
        const reference: Record<string, unknown> = {
          price: fresh.price ?? 0,
          cost: fresh.cost ?? 0,
          taxable: getTaxable(fresh),
          customerName: fresh.customerName ?? '',
          customerPhone: fresh.customerPhone ?? '',
          device: fresh.device ?? '',
          imei: fresh.imei ?? '',
          carrier: fresh.carrier ?? '',
          targetCarrier: fresh.targetCarrier ?? '',
          unlockType: fresh.unlockType ?? '',
          unlockCode: fresh.unlockCode ?? '',
          supplier: fresh.supplier ?? '',
          orderDate: fresh.orderDate ?? '',
          completionDate: fresh.completionDate ?? '',
          notes: fresh.notes ?? '',
          employeeName: fresh.employeeName ?? '',
        };
        const current: Record<string, unknown> = {
          price: priceCents,
          cost: costCents,
          taxable,
          customerName,
          // R-PHONE-SANITIZE-SWEEP: 10-digit form on unlock record.
          customerPhone: normalizePhone(form.customerPhone || ''),
          device: form.device ?? '',
          imei: normalizedImei,
          carrier: form.carrier ?? '',
          targetCarrier: form.targetCarrier ?? '',
          unlockType: form.unlockType ?? '',
          unlockCode: form.unlockCode ?? '',
          supplier: form.supplier ?? '',
          orderDate: form.orderDate ?? '',
          completionDate: completionDate ?? '',
          notes: form.notes ?? '',
          employeeName: fresh.employeeName ?? '', // not in form — preserve reference
        };

        const fieldsToCheck = (UNLOCK_ALL_FIELDS as readonly string[]).filter((f) => f !== 'depositAmount');
        const changes = computeDiff(reference, current, fieldsToCheck);
        if (changes.length === 0) {
          handleClose();
          return;
        }

        const moneyChanged = hasMoneyChanges(changes, UNLOCK_MONEY_FIELDS as unknown as string[]);
        if (moneyChanged) {
          setPendingAuditPayload({ baseUpdated: updated, changes, fresh });
          setShowReasonSelector(true);
          // Leave isSaving=true; handleReasonSelected or the Cancel path reset it.
          return;
        }

        // Info-only changes → save with typo_correction, no reason prompt.
        applyAuditSave(updated, fresh, 'typo_correction', changes, '');
        return;
      }

      const nextUnlocks = unlocksRef.current.map((u) => (u.id === editUnlock.id ? updated : u));
      unlocksRef.current = nextUnlocks;
      setUnlocks(nextUnlocks);
        persist.unlock(updated.id, updated as unknown as Record<string, unknown>);

      // R-COMMS-SMS-HARD-DISABLE: removed auto-SMS on completion (edit path).
      // WhatsApp ticket button stays for manual comm.
      toast(L.saved || 'Saved!', 'success');
    } else {
      const newUnlock: Unlock = {
        id: generateId(), ...form, customerName,
        storeId: currentStoreId,
        customerId: selectedCustomer?.id ?? undefined,
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
      try {
        window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
          detail: { type: 'unlock.submitted', payload: { customerId: newUnlock.customerId || undefined } },
        }));
      } catch { /* env without CustomEvent */ }

      if (depositCents > 0) {
        consolidateCartForUnlock({
          unlockId: newUnlock.id,
          additionalCents: depositCents,
          device: newUnlock.device || '',
          isTaxable: taxable,
        });

        const customerId = newUnlock.customerId;
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

        toast(t('unlocks.unlockCreatedDepositCart', formatCurrency(depositCents)), 'info');
      } else {
        toast(t('unlocks.unlockCreated'), 'success');
      }
    }

    setShowModal(false);
    setEditUnlock(null);
    setIsSaving(false);
  }, [form, editUnlock, customers, settings, currentEmployee, lang, L, t,
      setUnlocks, setCustomers, setCart, toast, consolidateCartForUnlock, dispatch,
      // R-EDIT-AUDIT F4.3: audit deps — isLocked + isSaving guard reads, applyAuditSave closure.
      isLocked, isSaving]);

  const collectBalance = useCallback((u: Unlock) => {
    if (!u.balance || u.balance <= 0) return;
    const taxable = getTaxable(u);
    const { combinedCents } = consolidateCartForUnlock({
      unlockId: u.id,
      additionalCents: u.balance,
      device: u.device || '',
      isTaxable: taxable,
    });

    const customerId = u.customerId;
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

    toast(t('unlocks.inCartForUnlock', `$${(combinedCents / 100).toFixed(2)}`), 'info');
  }, [consolidateCartForUnlock, dispatch, lang, t, toast]);

  // r-new-4 port: cancel with deposit disposition (store_credit / cash / forfeit).
  // R9-1: cash refund marks original sale(s) as refunded so Reports excludes them
  // from Gross/Cash/Profit. A voided REFUND-* audit sale is also created.
  const handleCancelUnlock = useCallback(async (unlock: Unlock, choice: {
    method: 'store_credit' | 'cash' | 'forfeit';
    note: string;
  }) => {
    // R-REPAIR-UNLOCK-CANCEL-DOUBLECLICK-UX1: handler-level guard + busy flag.
    // Re-entrant calls bail before any mutation; finally clears on every exit.
    if (cancelInFlight) return;
    setCancelInFlight(true);
    try {
    // R-APPROVAL-GATE-REPAIRS-UNLOCKS-V1: approval gate before any mutation.
    const approval = await approvalGate.requestApproval({
      actionType: 'CANCEL_UNLOCK',
      requestedByEmployeeId: currentEmployee?.id || '',
      entityId: unlock.id,
      affectedAmount: unlock.depositAmount || 0,
      reason: choice.method === 'cash'
        ? 'Unlock cancellation — cash refund'
        : choice.method === 'store_credit'
        ? 'Unlock cancellation — store credit'
        : 'Unlock cancellation — deposit forfeited',
    });
    if (!approval.approved) return;

    const depositCents = unlock.depositAmount || 0;
    const now = new Date().toISOString();

    if (choice.method === 'store_credit' && depositCents > 0) {
      const phoneTail = (unlock.customerPhone || '').replace(/\D/g, '').slice(-10);
      const matched = customersRef.current.find((c) => {
        if (unlock.customerId && c.id === unlock.customerId) return true;
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
        toast(t('unlocks.customerNotMatched'), 'warning');
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
        storeId: unlock.storeId,
        invoiceNumber: `REFUND-${unlock.id.slice(-6).toUpperCase()}`,
        customerId: unlock.customerId,
        customerName: unlock.customerName,
        customerPhone: unlock.customerPhone,
        items: [{
          id: generateId(),
          name: `${unlock.device || t('unlocks.cartItemName')} — ${t('unlocks.cancelRefundName')}`,
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

    const amt = `$${(depositCents / 100).toFixed(2)}`;
    const msg = {
      store_credit: t('unlocks.cancelledStoreCreditAdded', amt),
      cash: t('unlocks.cancelledCashRefundRecorded', amt),
      forfeit: t('unlocks.cancelledForfeited'),
    }[choice.method];
    toast(msg, 'success');
    setCancelTarget(null);
    } finally {
      // R-REPAIR-UNLOCK-CANCEL-DOUBLECLICK-UX1: clear busy on every exit (approval
      // denied, early-return, or success) so a re-opened modal never starts stuck.
      setCancelInFlight(false);
    }
  }, [cancelInFlight, lang, t, setCustomers, setUnlocks, setSales, currentEmployee, toast, approvalGate.requestApproval]);

  const handleComplete = useCallback((unlock: Unlock) => {
    const balance = unlock.balance || 0;
    const deposit = unlock.depositAmount || 0;

    if (balance === 0 && deposit === 0) {
      const updated: Unlock = { ...unlock, status: 'Completed' as any, updatedAt: new Date().toISOString() };
      const next = unlocksRef.current.map((u) => u.id === unlock.id ? updated : u);
      unlocksRef.current = next;
      setUnlocks(next);
      persist.unlock(updated.id, updated as unknown as Record<string, unknown>);
      toast(t('unlocks.unlockCompleted'), 'success');
      return;
    }
    setCompleteConfirm(unlock);
  }, [setUnlocks, t, toast, lang]);

  const handleCompleteConfirmed = useCallback(() => {
    const unlock = completeConfirm;
    if (!unlock) return;

    if ((unlock.balance || 0) > 0) {
      const isTaxable = getTaxable(unlock);
      consolidateCartForUnlock({
        unlockId: unlock.id,
        additionalCents: unlock.balance,
        device: unlock.device || '',
        isTaxable,
      });
      const customerId = unlock.customerId;
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

    // R-COMMS-SMS-HARD-DISABLE: removed auto-SMS on completion (Complete-confirm path).

    setCompleteConfirm(null);
    toast(
      (unlock.balance || 0) > 0
        ? t('unlocks.balanceAddedGoToPOS')
        : t('unlocks.unlockCompleted'),
      'success',
    );
  }, [completeConfirm, consolidateCartForUnlock, setUnlocks, dispatch, settings, t, toast, lang]);

  // R-COMMS-SMS-HARD-DISABLE: handleSMSButton callback removed.
  // TicketCard onWhatsApp prop is the live manual comm path.

  const handleDeleteConfirmed = useCallback(() => {
    if (!deleteConfirm) return;

    const hasPendingCart = cartRef.current.some((item) => item.unlockId === deleteConfirm.id);
    if (hasPendingCart) {
      toast(t('unlocks.cantDeleteCartItems'), 'error');
      setDeleteConfirm(null);
      return;
    }

    const hasDeposit = (deleteConfirm.depositAmount || 0) > 0;
    const isCompleted = ['Completed', 'Code Received'].includes(deleteConfirm.status);
    if (hasDeposit || isCompleted) {
      toast(t('unlocks.cantDeletePaidCompleted'), 'error');
      setDeleteConfirm(null);
      return;
    }

    const next = unlocksRef.current.filter((u) => u.id !== deleteConfirm.id);
    unlocksRef.current = next;
    setUnlocks(next);
    remove.unlock(deleteConfirm.id);
    setDeleteConfirm(null);
    toast(t('unlocks.unlockDeleted'), 'success');
  }, [deleteConfirm, setUnlocks, t, toast, lang]);

  // ── Print 4x6 thermal ticket ─────────────────────────────
  const printTicket = useCallback(async () => {
    const storeName = settings.storeName || 'GO CELLULAR';
    const storeAddr = settings.storeAddress || '';
    const storePhone = settings.storePhone || '';
    const firstName = (form.firstName as string || '').trim();
    const lastName  = (form.lastName  as string || '').trim();
    const customerName = `${firstName} ${lastName}`.trim() || form.customerName || '';
    const fmt = (v: unknown) => v == null ? '' : String(v);
    const money = (v: number) => `$${(v / 100).toFixed(2)}`;
    const typeLabel = (tp?: string) => {
      if (!tp) return '';
      return ({ factory: 'Factory', imei: 'IMEI', subsidy: 'Subsidy', custom: 'Custom' } as Record<string, string>)[tp] || tp;
    };
    const ticketNum = editUnlock ? editUnlock.id.slice(-8).toUpperCase() : 'NEW';
    const priceCents   = Math.round((form.price        || 0) * 100);
    const depositCents = Math.round((form.depositAmount || 0) * 100);
    const balanceCents = Math.max(0, Math.round(((form.price || 0) - (form.depositAmount || 0)) * 100));
    // R-RECEIPT-UNIFY-UNLOCK-V1: this 4x6 "Print Ticket" path (prints from the
    // open form) now uses the SAME master visual system as the payment receipt —
    // centered Go Cellular header, scannable CODE128 barcode (skipped for an
    // unsaved NEW ticket that has no real number yet), Arial typography, dashed
    // separators, money section in the master totals style, footer + Google
    // Reviews QR. Form data only — no financial math touched.
    // R-RECEIPT-UNIFY-UNLOCK-V2: always render the barcode so the 4x6 ticket
    // matches the other receipts. For an unsaved ticket the value is "NEW"
    // (becomes the real id-derived number once the unlock is saved/reprinted).
    const barcodeSvg = renderBarcodeSvg(ticketNum || 'NEW', getReceiptBarcodeHeight(settings.paperSize));
    let qrSvg = '';
    if (settings.showReviewQr && settings.googleReviewUrl) {
      try { qrSvg = await QRCode.toString(settings.googleReviewUrl, { type: 'svg', margin: 1, width: 80 }); }
      catch { /* QR optional — template falls back to a remote img */ }
    }
    const balanceDue = balanceCents > 0;
    const thanks = settings.receiptFooter || t('unlocks.print.thankYou');
    const lvRow = (label: string, value: string) =>
      `<tr><td style="font-size:11px;color:#444">${escHtml(label)}:</td><td style="text-align:right;font-size:11px;font-weight:600">${escHtml(value)}</td></tr>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unlock ${escHtml(ticketNum)}</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 4in; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; background: #fff; }
  body { padding: 0.1in 0.15in; }
  @media screen { html, body { width: 100% !important; max-width: 100% !important; } img, svg { max-width: 100%; height: auto; } }
  table { width: 100%; border-collapse: collapse; }
  .sep { border-top: 1px dashed #999; margin: 5px 0; }
  .sec-lbl { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #666; border-bottom: 1px solid #ccc; padding-bottom: 1px; margin-bottom: 3px; }
  @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } body, body * { color: #000 !important; border-color: #000 !important; } .corr-bar, .corr-bar * { color: #fff !important; background: #000 !important; } }
</style></head><body>
  <div style="width:100%;box-sizing:border-box;margin-bottom:4px;border-bottom:2px solid #000;padding-bottom:4px;overflow:hidden;text-align:center"><div style="font-size:18px;font-weight:900;line-height:1.1;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storeName)}</div>${storeAddr ? `<div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storeAddr)}</div>` : ''}${storePhone ? `<div style="font-size:10px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(storePhone)}</div>` : ''}</div>
  ${barcodeSvg ? `<div style="width:100%;box-sizing:border-box;text-align:center;margin:0 0 6px 0;overflow:hidden">${barcodeSvg.replace('<svg', '<svg style="display:inline-block;max-width:100%"')}</div>` : ''}
  <table style="margin-bottom:5px">
    <tr><td style="font-size:11px">${escHtml(new Date().toLocaleString())}</td><td style="text-align:right;font-size:12px;font-weight:900">#${escHtml(ticketNum)}</td></tr>
    <tr><td colspan="2" style="text-align:center;font-size:13px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;padding-top:3px">${escHtml(t('unlocks.print.title'))}</td></tr>
    <tr><td colspan="2" style="font-size:10px;padding-top:2px">${escHtml(t('unlocks.print.status'))}: <strong>${escHtml(fmt(form.status))}</strong></td></tr>
  </table>
  <div class="sep"></div>
  <div class="sec-lbl">${escHtml(t('unlocks.print.customer'))}</div>
  <table style="margin-bottom:5px">
    <tr><td colspan="2" style="font-size:11px;font-weight:600">${escHtml(customerName)}</td></tr>
    ${form.customerPhone ? lvRow(t('unlocks.print.phone'), fmt(form.customerPhone)) : ''}
  </table>
  <div class="sep"></div>
  <div class="sec-lbl">${escHtml(t('unlocks.print.device'))}</div>
  <table style="margin-bottom:5px">
    <tr><td colspan="2" style="font-size:11px;font-weight:600">${escHtml(fmt(form.device))}</td></tr>
    ${form.carrier ? lvRow(t('unlocks.print.carrier'), fmt(form.carrier)) : ''}
    ${form.imei ? lvRow('IMEI', fmt(form.imei)) : ''}
    ${form.unlockType ? lvRow(t('unlocks.print.type'), typeLabel(form.unlockType as string)) : ''}
    ${form.supplier ? lvRow(t('unlocks.print.supplier'), fmt(form.supplier)) : ''}
    ${form.unlockCode ? lvRow(t('unlocks.print.code'), fmt(form.unlockCode)) : ''}
    ${form.orderDate ? lvRow(t('unlocks.print.ordered'), fmt(form.orderDate)) : ''}
    ${form.completionDate ? lvRow(t('unlocks.print.completed'), fmt(form.completionDate)) : ''}
  </table>
  <div class="sep"></div>
  <table style="margin-bottom:5px">
    <tr><td>${escHtml(t('unlocks.print.price'))}:</td><td style="text-align:right">${escHtml(money(priceCents))}</td></tr>
    <tr><td>${escHtml(t('unlocks.print.deposit'))}:</td><td style="text-align:right">${escHtml(money(depositCents))}</td></tr>
    <tr style="border-top:1px solid #000">
      <td style="font-size:14px;font-weight:900;padding-top:4px">${escHtml(t('unlocks.print.balance'))}:</td>
      <td style="text-align:right;font-size:16px;font-weight:900;padding-top:4px${balanceDue ? ';color:#c00' : ''}">${escHtml(money(balanceCents))}</td>
    </tr>
  </table>
  ${form.notes ? `<div class="sep"></div><div class="sec-lbl">${escHtml(t('unlocks.print.notes'))}</div><div style="font-size:10px">${escHtml(fmt(form.notes))}</div>` : ''}
  <div class="sep"></div>
  <div style="text-align:center;font-size:11px;font-weight:600;line-height:1.3">
    ${escHtml(thanks)}
    ${settings.showReviewQr && settings.googleReviewUrl ? `
    <div style="text-align:center;margin-top:8px;padding-top:6px;border-top:1px dashed #ccc">
      <div style="font-size:10px;font-weight:700;margin-bottom:4px">${escHtml(t('unlocks.print.reviewPrompt'))}</div>
      ${qrSvg
        ? `<div style="width:72px;height:72px;margin:0 auto">${qrSvg}</div>`
        : `<img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(settings.googleReviewUrl)}" width="72" height="72" style="display:block;margin:0 auto" />`}
      <div style="font-size:8px;color:#555;margin-top:3px">&#9733;&#9733;&#9733;&#9733;&#9733; Google</div>
    </div>` : ''}
  </div>
</body></html>`;
    printHtml(html, {
      silent: false,
      printer: settings.detectedPrinters?.[0],
    });
  }, [form, editUnlock, settings, printHtml]);

  return (
    <>
      <TicketListLayout
        title={t('unlocks.moduleTitle')}
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
            placeholder={t('unlocks.searchPlaceholder')}
          />
        }
        stats={[
          { label: t('unlocks.statActive'), value: activeCount, color: 'text-purple-400' },
          { label: t('unlocks.statCompleted'), value: unlocks.filter((u) => normalizeStatus(u.status) === 'completed').length, color: 'text-emerald-400' },
          { label: t('unlocks.statTotal'), value: unlocks.length },
        ]}
        onNew={openNew}
        newLabel={t('unlocks.newUnlock')}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <span className="text-4xl block mb-3">🔓</span>
            <p>{t('unlocks.noResults')}</p>
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
                  ? t('unlocks.cancelledLabel')
                  : u.status === 'Completed'
                  ? t('unlocks.completedLabel')
                  : u.status === 'Code Received'
                  ? t('unlocks.codeReceivedLabel')
                  : (u.balance || 0) > 0
                  ? t('unlocks.completeCollect', formatCurrency(u.balance))
                  : t('unlocks.markCompleted')
              }
              completeDisabled={['Cancelled', 'Completed', 'Refunded'].includes(u.status)}
              completeVariant={u.status === 'Completed' ? 'green' : 'amber'}
              // R-EDIT-AUDIT F4.6: edited tickets route through the corrected/original
              // print-choice dialog; unedited tickets print directly.
              onPrint={() => {
                if (u.editHistory && u.editHistory.length > 0) {
                  setPrintChoiceTarget(u);
                } else {
                  printUnlockEntity(u);
                }
              }}
              onDelete={() => setDeleteConfirm(u)}
              extraBadges={
                <>
                  {/* R-EDIT-AUDIT F4.6: edit-history count badge. */}
                  {u.editHistory && u.editHistory.length > 0 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryTarget(u);
                      }}
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: 'rgba(251, 191, 36, 0.15)',
                        color: '#fbbf24',
                      }}
                      title={t('unlocks.viewEditHistory')}
                    >
                      🕐 {u.editHistory.length}
                    </span>
                  )}
                  {/* R-EDIT-AUDIT F4.6: Mark Refunded button when in refund_pending state. */}
                  {normalizeStatus(u.status) === 'refund_pending' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRefundConfirmTarget(u);
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
                      {t('unlocks.markRefunded')}
                    </button>
                  )}
                </>
              }
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
            />
          ))
        )}

          {filtered.length > visibleCount && (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <button
                onClick={() => setVisibleCount((n) => n + 50)}
                className="btn btn-secondary btn-sm"
              >
                {t('unlocks.showMore', filtered.length - visibleCount)}
              </button>
            </div>
          )}
      </TicketListLayout>

      {/* Unlock Modal */}
      <Modal
        open={showModal}
        onClose={handleClose}
        title={t(editUnlock ? 'unlocks.modalTitleEdit' : 'unlocks.modalTitleNew')}
        size="max-w-lg"
      >
        <div className="space-y-3">
          {/* R-EDIT-AUDIT F4.2: banner when admin unlocks money fields post-completion. */}
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
              <span>{t('unlocks.editingCompletedBanner')}</span>
            </div>
          )}

          <CustomerPicker
            customers={customers}
            selectedCustomer={selectedCustomer}
            lang={lang === 'es' ? 'es' : lang === 'pt' ? 'pt' : 'en'}
            allowClear
            onSelect={(c) => {
              setSelectedCustomer(c);
              if (c) {
                const parts = c.name.trim().split(/\s+/);
                setForm(prev => ({
                  ...prev,
                  firstName: (prev.firstName as string) || parts[0] || '',
                  lastName: (prev.lastName as string) || parts.slice(1).join(' ') || '',
                  customerPhone: (prev.customerPhone as string) || c.phone || '',
                  customerName: (prev.customerName as string) || c.name || '',
                }));
              }
            }}
          />
          <div className="grid grid-cols-3 gap-3" style={{ marginTop: '0.5rem' }}>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('unlocks.firstNameLabel')}</label>
              <AutocompleteInput
                value={(form.firstName as string) || ''}
                onChange={(val) => setForm({ ...form, firstName: val })}
                onSelect={(opt) => {
                  setForm(prev => ({ ...prev, firstName: opt.value,
                    lastName: (prev.lastName as string) || (opt.data as Customer)?.name?.split(' ').slice(1).join(' ') || '',
                    customerPhone: (prev.customerPhone as string) || (opt.data as Customer)?.phone || '' }));
                }}
                options={firstNameOptions}
                placeholder={t('unlocks.firstNamePlaceholder')}
                maxResults={6}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('unlocks.lastNameLabel')}</label>
              <AutocompleteInput
                value={(form.lastName as string) || ''}
                onChange={(val) => setForm({ ...form, lastName: val })}
                onSelect={(opt) => {
                  setForm(prev => ({ ...prev, lastName: opt.value,
                    firstName: (prev.firstName as string) || (opt.data as Customer)?.name?.split(' ')[0] || '',
                    customerPhone: (prev.customerPhone as string) || (opt.data as Customer)?.phone || '' }));
                }}
                options={lastNameOptions}
                placeholder={t('unlocks.lastNamePlaceholder')}
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
                  setForm(prev => ({ ...prev, customerPhone: opt.value,
                    customerName: (prev.customerName as string) || (opt.data as Customer)?.name || '' }));
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">IMEI</label>
              <div className="flex gap-1">
                <input
                  value={form.imei || ''}
                  onChange={(e) => setForm({ ...form, imei: e.target.value })}
                  className="input flex-1"
                  maxLength={15}
                  inputMode="numeric"
                  placeholder="15 digits"
                />
                <button
                  type="button"
                  title={lang === 'es' ? 'Generar IMEI' : lang === 'pt' ? 'Gerar IMEI' : 'Generate IMEI'}
                  className="btn btn-ghost text-xs px-2"
                  onClick={() => setForm({ ...form, imei: generateImei() })}
                >
                  {lang === 'es' ? 'Generar' : lang === 'pt' ? 'Gerar' : 'Generate'}
                </button>
              </div>
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
              <label className="text-xs text-slate-400 block mb-1">
                {isLocked && !pin.editUnlocked && '🔒 '}Price ($)
              </label>
              {/* R-EDIT-AUDIT F4.2: lock price on completed tickets. */}
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={form.price || ''}
                  onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })}
                  className="input"
                  step="0.01"
                  disabled={isLocked && !pin.editUnlocked}
                  style={isLocked && !pin.editUnlocked ? { opacity: 0.6 } : undefined}
                />
                {isLocked && !pin.editUnlocked && (
                  <span
                    onClick={pin.requestUnlock}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: '1rem' }}
                    title={t('unlocks.unlockWithPin')}
                  >🔒</span>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {isLocked && !pin.editUnlocked && '🔒 '}Cost ($)
              </label>
              {/* R-EDIT-AUDIT F4.2: lock cost on completed tickets. */}
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={form.cost || ''}
                  onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })}
                  className="input"
                  step="0.01"
                  placeholder="Supplier cost"
                  disabled={isLocked && !pin.editUnlocked}
                  style={isLocked && !pin.editUnlocked ? { opacity: 0.6 } : undefined}
                />
                {isLocked && !pin.editUnlocked && (
                  <span
                    onClick={pin.requestUnlock}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', fontSize: '1rem' }}
                    title={t('unlocks.unlockWithPin')}
                  >🔒</span>
                )}
              </div>
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
                  {t('unlocks.depositLockedMsg')}
                </p>
              )}
            </div>
          </div>

          {/* Unlock type + supplier */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('unlocks.unlockTypeLabel')}</label>
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
              <label className="text-xs text-slate-400 block mb-1">{t('supplier')}</label>
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
              {t('unlockCode')}
              <span className="text-slate-500 ml-1">{t('unlocks.unlockCodeFromSupplier')}</span>
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
              <label className="text-xs text-slate-400 block mb-1">{t('unlocks.orderDateLabel')}</label>
              <input
                type="date"
                value={form.orderDate || ''}
                onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('unlocks.completionDateLabel')}</label>
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
                {['Received', 'Processing', 'Code Received', 'Completed', 'Cancelled', 'Failed', 'Refund Pending', 'Refunded'].map((s) => (
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
          {/* R-EDIT-AUDIT F4.2: taxable is a money-impacting toggle — lock on completed tickets. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.08)', opacity: isLocked && !pin.editUnlocked ? 0.6 : 1 }}>
            <input
              type="checkbox"
              id="unlock-taxable"
              checked={form.taxable ?? false}
              onChange={(e) => setForm({ ...form, taxable: e.target.checked })}
              disabled={isLocked && !pin.editUnlocked}
              style={{ cursor: isLocked && !pin.editUnlocked ? 'not-allowed' : 'pointer' }}
            />
            <label htmlFor="unlock-taxable" style={{ fontSize: '0.82rem', color: '#cbd5e1', cursor: isLocked && !pin.editUnlocked ? 'not-allowed' : 'pointer' }}>
              {isLocked && !pin.editUnlocked && '🔒 '}
              {t('unlocks.applyTaxLabel', ((settings.taxRate ?? 0.0925) * 100).toFixed(2))}
            </label>
            {isLocked && !pin.editUnlocked ? (
              <span
                onClick={pin.requestUnlock}
                style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: '0.9rem' }}
                title={t('unlocks.unlockWithPin')}
              >🔒</span>
            ) : (
              <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: 'auto' }}>
                {t('unlocks.defaultOff')}
              </span>
            )}
          </div>

          {/* Totals */}
          {(form.price || 0) > 0 && (() => {
            const previewPriceCents = Math.round((form.price || 0) * 100);
            const previewDepositCents = Math.round((form.depositAmount || 0) * 100);
            const _t = calcDepositTotals(previewPriceCents, previewDepositCents, settings.taxRate ?? 0.0925, form.taxable ?? false);
            return (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.75rem', padding: '0.875rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 700, padding: '0.2rem 0' }}>
                <span>Service Price:</span><span>{formatCurrency(_t.subtotalCents)}</span>
              </div>
              {form.taxable && _t.taxCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f59e0b', padding: '0.2rem 0' }}>
                  <span>+ Tax ({((settings.taxRate ?? 0.0925) * 100).toFixed(2)}%):</span><span>+{formatCurrency(_t.taxCents)}</span>
                </div>
              )}
              {form.taxable && _t.taxCents > 0 && (
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
            ℹ️ {t('unlocks.completedNote')}
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
              title={t('unlocks.cancelUnlockTitle')}
            >
              {t('unlocks.cancelUnlockBtn')}
            </button>
          )}
          <button onClick={printTicket} className="btn btn-secondary flex-1" title={t('unlocks.print4x6Title')}>
            🖨️ {t('print')}
          </button>
          <button onClick={handleSave} className="btn btn-primary flex-1">{editUnlock ? L.save : L.create}</button>
        </div>

        {/* R-EDIT-AUDIT F4.2-3: reason selector + admin PIN challenge. */}
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
      </Modal>

      {/* COLLECT BALANCE MODAL */}
      {depositModalUnlock && (
        <DepositModal
          title={t('unlocks.depositModalCollect', depositModalUnlock.id.slice(-8).toUpperCase())}
          itemLabel={`${depositModalUnlock.device} (${depositModalUnlock.carrier}) — Unlock`}
          itemPrice={(depositModalUnlock.price || 0) / 100}
          taxRate={settings.taxRate ?? 0.0925}
          taxable={getTaxable(depositModalUnlock)}
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
              const taxable = getTaxable(u);

              const { combinedCents } = consolidateCartForUnlock({
                unlockId: u.id,
                additionalCents: newAmtCents,
                device: u.device || '',
                isTaxable: taxable,
              });

              const customerId = u.customerId;
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
              toast(t('unlocks.cartAdded', `$${(combinedCents / 100).toFixed(2)}`), 'success');
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
          confirming={cancelInFlight}
          onConfirm={(choice) => handleCancelUnlock(cancelTarget, choice)}
          onClose={() => { setCancelInFlight(false); setCancelTarget(null); }}
        />
      )}

      {/* R-APPROVAL-GATE-REPAIRS-UNLOCKS-V1 */}
      {approvalGate.modal}

      {deleteConfirm && (
        <ConfirmDialog
          open
          title={t('unlocks.deleteTitle')}
          message={t('unlocks.deleteConfirm')}
          variant="danger"
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {completeConfirm && (
        <ConfirmDialog
          open
          title={t('unlocks.completeTitle')}
          message={
            (completeConfirm.balance || 0) > 0
              ? t('unlocks.completeWithBalance', formatCurrency(completeConfirm.balance))
              : t('unlocks.completeSimple')
          }
          variant="warning"
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          onConfirm={handleCompleteConfirmed}
          onCancel={() => setCompleteConfirm(null)}
        />
      )}

      {/* R-EDIT-AUDIT F4.6: edit history viewer. */}
      {historyTarget && (
        <EditHistoryModal
          open
          onClose={() => setHistoryTarget(null)}
          lang={lang}
          editHistory={historyTarget.editHistory || []}
          originalSnapshot={historyTarget.originalSnapshot}
        />
      )}

      {/* R-EDIT-AUDIT F4.6: corrected-vs-original print choice for edited tickets. */}
      {printChoiceTarget && (
        <Modal
          open
          title={t('unlocks.printTicketTitle')}
          onClose={() => setPrintChoiceTarget(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => {
                printUnlockEntity(printChoiceTarget, {
                  corrected: true,
                  originalSnapshot: printChoiceTarget.originalSnapshot,
                });
                setPrintChoiceTarget(null);
              }}
            >
              {t('unlocks.printCurrentCorrected')}
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
                  printUnlockEntity({
                    ...printChoiceTarget,
                    price: snap.price ?? printChoiceTarget.price,
                    cost: snap.cost ?? printChoiceTarget.cost,
                    depositAmount: snap.depositAmount ?? printChoiceTarget.depositAmount,
                    balance: snap.balance ?? printChoiceTarget.balance,
                  } as Unlock);
                } else {
                  printUnlockEntity(printChoiceTarget);
                }
                setPrintChoiceTarget(null);
              }}
            >
              {t('unlocks.printOriginalPreEdits')}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: '100%' }}
              onClick={() => setPrintChoiceTarget(null)}
            >
              {t('cancel')}
            </button>
          </div>
        </Modal>
      )}

      {/* R-EDIT-AUDIT F4.6: confirm Mark Refunded → closes out refund_pending state. */}
      {refundConfirmTarget && (
        <ConfirmDialog
          open
          title={t('unlocks.markRefundedTitle')}
          message={t('unlocks.markRefundedConfirm', ((refundConfirmTarget.refundOwedAmount || 0) / 100).toFixed(2))}
          confirmLabel={t('unlocks.yesRefunded')}
          cancelLabel={t('cancel')}
          onConfirm={() => {
            const target = refundConfirmTarget;
            // F7-FIX-v2: double-refund guard.
            if (normalizeStatus(target.status) === 'refunded') {
              setRefundConfirmTarget(null);
              return;
            }
            const now = new Date().toISOString();
            const refundAmountCents = target.refundOwedAmount || 0;

            // 1. Mark ticket as refunded.
            const updated: Unlock = {
              ...target,
              status: 'Refunded',
              refundOwedAmount: 0,
              updatedAt: now,
            };
            const nextUnlocks = unlocksRef.current.map((u) => (u.id === updated.id ? updated : u));
            unlocksRef.current = nextUnlocks;
            setUnlocks(nextUnlocks);
            persist.unlock(updated.id, updated as unknown as Record<string, unknown>);

            // 2. F7-FIX-v2: partial refund sale. status='completed' (NOT voided)
            //    so Reports includes it with negative total, subtracting from
            //    gross. Originals stay untouched — partial refund, not cancellation.
            if (refundAmountCents > 0) {
              const refundSale: Sale = {
                id: generateId(),
                storeId: updated.storeId,
                invoiceNumber: `REFUND-${updated.id.slice(-6).toUpperCase()}`,
                customerId: updated.customerId,
                customerName: updated.customerName || 'Walk-in',
                customerPhone: updated.customerPhone || '',
                items: [{
                  id: generateId(),
                  name: `${updated.device || t('unlocks.cartItemName')} — ${t('unlocks.postEditRefundName')}`,
                  category: 'service' as any,
                  price: -refundAmountCents,
                  qty: 1,
                  taxable: false,
                  cbeEligible: false,
                  unlockId: updated.id,
                }],
                subtotal: -refundAmountCents,
                taxAmount: 0,
                cbeTotal: 0,
                total: -refundAmountCents,
                paymentMethod: 'Cash' as any,
                status: 'completed',
                employeeId: currentEmployee?.id,
                employeeName: currentEmployee?.name,
                notes: `Post-edit refund — Unlock ${updated.id.slice(-6).toUpperCase()}`,
                refundReason: 'Post-edit refund',
                createdAt: now,
              } as unknown as Sale;
              const nextSales = [...salesRef.current, refundSale];
              salesRef.current = nextSales;
              setSales(nextSales);
              persist.sale(refundSale.id, refundSale as unknown as Record<string, unknown>);
            }

            toast(t('unlocks.refundMarkedSuccess'), 'success');
            setRefundConfirmTarget(null);
          }}
          onCancel={() => setRefundConfirmTarget(null)}
        />
      )}
    </>
  );
}
