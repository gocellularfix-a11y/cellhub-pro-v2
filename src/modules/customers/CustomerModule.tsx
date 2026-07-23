// ============================================================
// CellHub Pro — Customer Module
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useHighlightRecord } from '@/hooks/useHighlightRecord';
import { useLanReadOnlyMode, isLanSecondaryReadOnly } from '@/hooks/useLanReadOnly';
import { sendCreateCustomer, sendCustomerNote } from '@/services/lan/lanService';
import { appendCustomerNote } from '@/utils/customerNotes';
import { Modal, ConfirmDialog } from '@/components/ui';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import { useTranslation } from '@/i18n';
import { formatCurrency } from '@/utils/currency';
// CELLHUB-INTELLIGENCE-I2B-0: canonical customer money (attribution + field
// mapping over computeReportMoneyStats — replaces the legacy
// computeCustomerProfit/adjustSalesItemCosts pair in this module).
import {
  computeCustomerMoneyProfile,
  createCustomerProfilesCache,
  traceCustomerInvoiceEconomics,
} from '@/services/customers/customerMoneyProfile';
import { canViewOwnerFinancials } from '@/utils/financialPrivacy';
import { matchesSearchPhones } from '@/utils/search';
import { normalizePhone, formatPhone } from '@/utils/normalize';
import { generateId, formatDate } from '@/utils/dates';
import type { Customer, Sale } from '@/store/types';
import { persist, remove } from '@/services/persist';
// R-CUSTOMER-LINE-PAYMENTS-V1 + R-CUSTOMER-DELETE-FIX-V1
import {
  parseDollarsToCents,
  centsToDollarsString,
  hasPerLinePayments,
  hasUnassignedLegacyPayment,
  getMonthlyTotalCents,
} from '@/services/customers/linePayments';
import { evaluateCustomerDelete, type CustomerDeleteWarning } from '@/services/customers/customerDeleteGuard';
import { openWhatsApp } from '@/services/whatsapp';
import { setIntelligenceContext, clearEntityContext, setPendingIntelligenceAction, setPendingExplicitCustomer } from '@/services/intelligence/context/intelligenceContext';
import { emitCustomerAmbient } from '@/services/intelligence/ambient/ambientAwarenessService';

export default function CustomerModule() {
  // Round 18: extract `state` at root and destructure separately so we can also
  // read returns/appointments from the same state without calling useApp() again.
  // Old code called useApp() three times — each subscribed to the context and
  // forced extra re-renders.
  const app = useApp();
  const { state, setCustomers, dispatch } = app;
  // I2B-0: inventory feeds the customer money profile's canonical cost
  // fallback (store-scoped by AppProvider like every other collection).
  const { customers, sales, repairs, unlocks, specialOrders, layaways, inventory, settings, customerSearchTerm, customerReturns, storeCreditLedger, pendingCustomerHistoryId } = state;

  // customerReturns now lives in AppState (hydrated at boot via SET_CUSTOMER_RETURNS).
  const returns_      = customerReturns || [];
  // appointments still in localStorage pending a future store lift.
  const appointments_ = (state as unknown as { appointments?: unknown[] }).appointments || [];

  const { toast } = useToast();
  const { highlightRef, isHighlighted } = useHighlightRecord<HTMLTableRowElement>();
  const { t } = useTranslation();
  // SECONDARY-UI-LOCK-V1: block customer create on a read-only LAN Secondary.
  const lanReadOnly = useLanReadOnlyMode();

  // Round 18: customersRef anti-stale-closure pattern (canonical project pattern).
  // setCustomers from AppProvider only accepts arrays (not functions), so handlers
  // that read `customers` from the closure can clobber concurrent updates from the
  // Firestore listener (multi-station sync). All write paths in this module read
  // customersRef.current and assign back before calling setCustomers.
  const customersRef = useRef(customers);
  useEffect(() => { customersRef.current = customers; }, [customers]);

  // R-OPERATOR-VIEW-HISTORY-DIRECT-V1: open the same history modal the
  // row action button opens, in response to the Operator bubble's "View
  // Customer History" quick action. Listener is scoped to this module's
  // mount — operator bubble navigates to the Customers tab first, then
  // dispatches with a small defer so this effect has attached.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ customerId?: string }>).detail;
      const cid = detail?.customerId;
      if (!cid) return;
      const cust = customersRef.current.find((c) => c && c.id === cid);
      if (cust) setViewHistory(cust);
    };
    window.addEventListener('cellhub:open-customer-history', handler);
    return () => window.removeEventListener('cellhub:open-customer-history', handler);
  }, []);

  // R-BARCODE-CUSTOMER-HISTORY-FIRST-CLICK-RACE-FIX-V1: store-based handoff
  // that survives a tab switch from an unmounted Customers module. When
  // BarcodeActionModal sets pendingCustomerHistoryId + navigates here, this
  // effect fires on initial mount (and on any later re-dispatch) and opens
  // the same history modal the CustomEvent path opens, then clears the
  // pending id so a subsequent navigation does not re-open it.
  useEffect(() => {
    if (!pendingCustomerHistoryId) return;
    const cust = customersRef.current.find((c) => c && c.id === pendingCustomerHistoryId);
    if (cust) setViewHistory(cust);
    dispatch({ type: 'SET_PENDING_CUSTOMER_HISTORY', payload: '' });
  }, [pendingCustomerHistoryId, dispatch]);

  // R-OPERATOR-AMBIENT-AWARENESS-V1: open the create-mode CustomerForm
  // with an optional phone prefill. Triggered by the Operator bubble's
  // Create Customer quick action on an unknown_phone context.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ phone?: string }>).detail;
      setEditCustomer(null);                 // create mode
      setPrefillPhone(detail?.phone || '');  // optional prefill
      setShowModal(true);
    };
    window.addEventListener('cellhub:open-new-customer-form', handler);
    return () => window.removeEventListener('cellhub:open-new-customer-form', handler);
  }, []);

  // R-INTELLIGENCE-RUNTIME-NAVIGATION-V1: open a customer profile from
  // Intelligence action buttons. AppShell navigates here first, then defers
  // 80ms before firing this event so this listener is attached.
  // CUSTOMER-360-INTELLIGENCE-OPEN-HISTORY-V1: default now opens the rich
  // CustomerHistoryModal (Customer 360 view) instead of the edit form.
  // Callers that genuinely want the edit form (BarcodeActionModal "View
  // Customer") pass mode:'edit' through the event detail — AppShell forwards
  // it. Edit buttons on customer cards are untouched (they call
  // setEditCustomer directly, not this event).
  useEffect(() => {
    const handler = (e: Event) => {
      // INTEL-ACTION-CONTEXT-AND-NAV-RACE-FIX-V1: ack the AppShell relay —
      // preventDefault on the cancelable event stops its bounded retry loop.
      e.preventDefault();
      const { customerId, mode } = (e as CustomEvent<{ customerId?: string; mode?: 'edit' | 'history' }>).detail ?? {};
      if (!customerId) return;
      const cust = customersRef.current.find((c) => c && c.id === customerId);
      // R-INTELLIGENCE-ACTION-RELIABILITY-V2: not found → safe no-op + toast
      // (never the create-new customer modal). Same path as the card Edit button.
      if (!cust) {
        console.warn('[cellhub] _intel-open-customer: not found', customerId);
        toast(t('intel.entityNotFound'), 'error');
        return;
      }
      if (mode === 'edit') {
        setEditCustomer(cust);
        setShowModal(true);
      } else {
        setViewHistory(cust);
      }
    };
    window.addEventListener('cellhub:_intel-open-customer', handler);
    return () => window.removeEventListener('cellhub:_intel-open-customer', handler);
  }, [t]);

  const [search, setSearch] = useState(customerSearchTerm || '');
  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);

  // R-INTELLIGENCE-CONTEXT-AWARE-V1: broadcast active customer so Intelligence
  // surfaces contextual recommendations for this specific profile.
  // R-CUSTOMER-AMBIENT-V1: emit cross-module ambient hint on customer open.
  useEffect(() => {
    if (editCustomer) {
      setIntelligenceContext({
        activeModule: 'customers',
        activeCustomerId: editCustomer.id,
      });
      emitCustomerAmbient({
        customer: editCustomer,
        repairs,
        unlocks,
        specialOrders,
        layaways,
        sales,
        customers,
      });
    } else {
      clearEntityContext();
    }
  }, [editCustomer]); // eslint-disable-line react-hooks/exhaustive-deps
  // R-OPERATOR-AMBIENT-AWARENESS-V1: phone prefill for the create-mode
  // form when triggered externally (e.g. Operator bubble Create Customer
  // for an unknown_phone context). Only consulted when editCustomer is
  // null. Cleared on modal close.
  const [prefillPhone, setPrefillPhone] = useState<string>('');
  const [viewHistory, setViewHistory] = useState<Customer | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteWarningMsg, setDeleteWarningMsg] = useState<string | null>(null);
  const [dupConfirm, setDupConfirm] = useState<{
    message: string;
    onMerge: () => void;
    onCreateNew: () => void;
  } | null>(null);
  const [showLapsedOnly, setShowLapsedOnly] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    title: string;
    variant?: 'danger' | 'warning' | 'default';
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  // Lapsed = no visit in 30+ days
  const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
  const lapsedCustomers = useMemo(() => customers.filter((c) => {
    const last = c.updatedAt
      ? new Date(c.updatedAt as string).getTime()
      : new Date(c.createdAt as string).getTime();
    return (Date.now() - last) > DAYS_30;
  }), [customers]);

  // Clear cross-module search after first render (was wrongly written with useState)
  useEffect(() => {
    if (customerSearchTerm) dispatch({ type: 'SET_CUSTOMER_SEARCH', payload: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return customers
      .filter((c) => {
        if (showLapsedOnly) {
          const last = c.updatedAt
            ? new Date(c.updatedAt as string).getTime()
            : new Date(c.createdAt as string).getTime();
          if ((Date.now() - last) <= DAYS_30) return false;
        }
        // R-SEARCH-NORMALIZE-V1: route the primary phone and any
        // secondary phones[] through the shared phone-aware helper so
        // queries like "(805) 555-1234" match storage like "8055551234"
        // (and vice-versa), and so the secondary-phones fallback uses
        // the same logic instead of the bespoke inline digit-strip.
        const secondaryPhones = Array.isArray((c as any).phones)
          ? ((c as any).phones as unknown[]).map((p) => String(p ?? ''))
          : [];
        const notes = String((c as any).notes ?? '');
        return matchesSearchPhones(
          search,
          [c.phone, ...secondaryPhones],
          c.name,
          c.email,
          c.customerNumber,
          (c as any).carrier,
          (c as any).plan,
          (c as any).address,
          notes,
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, search, showLapsedOnly]);

  // Customer purchase history — all transaction types
  const getCustomerHistory = useCallback(
    (customer: Customer) => {
      const phone = normalizePhone(customer.phone);
      const id    = customer.id;

      // Sales: match by customerId OR by customerPhone (fallback for unlinked sales)
      const customerSales = sales
        .filter((s) =>
          s.status === 'completed' &&
          (s.customerId === id || normalizePhone(s.customerPhone || '') === phone)
        )
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerRepairs = repairs
        .filter((r) => (r as any).customerId === id || normalizePhone(r.customerPhone) === phone)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerLayaways = layaways
        .filter((l) => (l as any).customerId === id || normalizePhone(l.customerPhone) === phone)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerUnlocks = unlocks
        .filter((u) => (u as any).customerId === id || normalizePhone(u.customerPhone) === phone)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerSpecialOrders = specialOrders
        .filter((o) => (o as any).customerId === id || normalizePhone(o.customerPhone) === phone)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

      const customerReturns = returns_
        .filter((r: any) =>
          r.customerId === id || normalizePhone(r.customerPhone || '') === phone
        )
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const customerAppointments = appointments_
        .filter((a: any) => normalizePhone(a.customerPhone || '') === phone)
        .sort((a: any, b: any) => new Date(b.date || b.scheduledAt || 0).getTime() - new Date(a.date || a.scheduledAt || 0).getTime());

      // R-STORE-CREDIT-REDEMPTION-SYSTEM: ledger entries linked to this customer.
      const customerCerts = (storeCreditLedger || [])
        .filter((l) => l.customerId === id || (l.customerPhone && normalizePhone(l.customerPhone) === phone))
        .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());

      return {
        sales: customerSales,
        repairs: customerRepairs,
        layaways: customerLayaways,
        unlocks: customerUnlocks,
        specialOrders: customerSpecialOrders,
        returns: customerReturns,
        appointments: customerAppointments,
        certificates: customerCerts,
      };
    },
    [sales, repairs, layaways, unlocks, specialOrders, returns_, appointments_, storeCreditLedger],
  );

  // ── Per-customer sales stats (precomputed for table columns) ──
  // I2B-0.1: the list's "Total Collected" now comes from the SAME canonical
  // customer profile as the Customer 360 modal (batched: one bucketing pass
  // over every collection, then the canonical service per customer — no
  // per-customer full-array reduce). The reference-keyed cache invalidates
  // on store switch / any collection or settings update (new array refs).
  const profilesCache = useRef(createCustomerProfilesCache()).current;
  const customerProfiles = useMemo(
    () => profilesCache.get(customers, {
      sales, repairs, unlocks, layaways, specialOrders,
      customerReturns: returns_, inventory, settings: settings || {},
    }),
    [profilesCache, customers, sales, repairs, unlocks, layaways, specialOrders, returns_, inventory, settings],
  );
  const customerStats = useMemo(() => {
    const map = new Map<string, { totalCollected: number; visits: number; lastVisit: string }>();
    for (const c of customers) {
      const p = customerProfiles.get(c.id);
      if (!p) continue;
      map.set(c.id, {
        totalCollected: p.totalCollectedCents,
        visits: p.transactionCount,
        lastVisit: p.lastVisitAt
          ? p.lastVisitAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '',
      });
    }
    return map;
  }, [customers, customerProfiles]);

  // I2B-0.1 Part G: owner-triggered diagnostic — invoice-level customer
  // economics trace over LIVE records, callable from DevTools:
  //   __cellhubTraceCustomerEconomics('<customerId or phone>')
  // Pure/read-only (never mutates transactions, never logs on its own) and
  // registered ONLY when the current viewer may see owner financials.
  const canSeeFinancialsGlobal = canViewOwnerFinancials(
    settings, state.isAdminMode || state.currentEmployee?.role === 'owner',
  );
  useEffect(() => {
    if (!canSeeFinancialsGlobal) return;
    const w = window as unknown as Record<string, unknown>;
    w.__cellhubTraceCustomerEconomics = (idOrPhone: string) => {
      const key = String(idOrPhone || '').trim();
      if (!key) return { error: 'customer_not_found' };
      const keyPhone = normalizePhone(key);
      const cust = customers.find((c) => c.id === key)
        || (keyPhone.length >= 10
          ? customers.find((c) => normalizePhone(c.phone || '').slice(-10) === keyPhone.slice(-10))
          : undefined);
      if (!cust) return { error: 'customer_not_found' };
      return traceCustomerInvoiceEconomics({
        customer: cust, sales, repairs, unlocks, layaways, specialOrders,
        customerReturns: returns_, inventory, settings: settings || {},
      });
    };
    // P0-SC-1.1 (audit BLOCKER 1): owner-triggered Store Credit forensic dump —
    //   __cellhubAuditStoreCredit()            → everything credit-related
    //   __cellhubAuditStoreCredit('<query>')   → filter by cert # / invoice /
    //                                            sale id / customer id / name
    // Read-only; never mutates. Answers, from LIVE persisted records: which
    // route a redemption used (certificate line vs legacy tender), whether
    // the persisted SaleItem carries storeCreditLedgerId, whether the ledger
    // holds a redemption for that saleId, and the customer's legacy balance +
    // idempotency markers.
    w.__cellhubAuditStoreCredit = (query?: string) => {
      const q = String(query || '').trim().toLowerCase();
      const has = (v: unknown) => String(v || '').toLowerCase().includes(q);
      const certRows = (storeCreditLedger || [])
        .filter((l) => !q || has(l.certificateNumber) || has(l.customerId) || has(l.customerName) || has(l.id))
        .map((l) => ({
          ledgerId: l.id, certificateNumber: l.certificateNumber, storeId: l.storeId,
          customerId: l.customerId, customerName: l.customerName, status: l.status,
          issuedCents: l.issuedAmount, redeemedCents: l.redeemedAmount, remainingCents: l.remainingAmount,
          redemptions: (l.redemptions || []).map((r) => ({ saleId: r.saleId, invoice: r.invoiceNumber, cents: r.redeemedAmount, remainingAfter: r.remainingAfter, at: r.redeemedAt })),
        }));
      const saleRows = sales
        .filter((s) => s.paymentMethod === 'Store Credit' || s.paymentMethod === 'store_credit'
          || (s.items || []).some((i) => (i as unknown as { storeCreditLedgerId?: string }).storeCreditLedgerId || i.category === 'exchange_credit'))
        .filter((s) => !q || has(s.id) || has(s.invoiceNumber) || has(s.customerId) || has(s.customerName))
        .map((s) => ({
          saleId: s.id, invoice: s.invoiceNumber, createdAt: s.createdAt, status: s.status,
          paymentMethod: s.paymentMethod, totalCents: s.total, customerId: s.customerId, customerName: s.customerName,
          creditLines: (s.items || [])
            .filter((i) => (i as unknown as { storeCreditLedgerId?: string }).storeCreditLedgerId || i.category === 'exchange_credit')
            .map((i) => ({
              name: i.name, priceCents: i.price, qty: i.qty,
              storeCreditLedgerId: (i as unknown as { storeCreditLedgerId?: string }).storeCreditLedgerId || null,
              storeCreditCertNumber: (i as unknown as { storeCreditCertNumber?: string }).storeCreditCertNumber || null,
              ledgerHasRedemptionForThisSale: (storeCreditLedger || []).some((l) =>
                l.id === (i as unknown as { storeCreditLedgerId?: string }).storeCreditLedgerId
                && (l.redemptions || []).some((r) => r.saleId === s.id)),
            })),
        }));
      const customerRows = customers
        .filter((c) => (c.storeCredit || 0) > 0 || (c.storeCreditRedemptions || []).length > 0)
        .filter((c) => !q || has(c.id) || has(c.name) || has(c.phone))
        .map((c) => ({
          customerId: c.id, name: c.name, legacyStoreCreditCents: c.storeCredit || 0,
          tenderRedemptions: c.storeCreditRedemptions || [],
        }));
      return { certificates: certRows, creditSales: saleRows, customersWithCredit: customerRows };
    };
    return () => { delete w.__cellhubTraceCustomerEconomics; delete w.__cellhubAuditStoreCredit; };
  }, [canSeeFinancialsGlobal, customers, sales, repairs, unlocks, layaways, specialOrders, returns_, inventory, settings, storeCreditLedger]);

  // ── CRUD ────────────────────────────────────────────────
  // LAN-PHASE-3B-CREATE-CUSTOMER-FORWARDING-V1: on a read-only Secondary, a NEW
  // customer is not saved locally — it is forwarded to the Primary, which
  // creates + persists it. On success the mirror re-syncs and the customer
  // appears from the Primary snapshot. (Edits are not forwarded this round.)
  const forwardCreateCustomer = useCallback(async (data: Partial<Customer>) => {
    const firstName = (data.firstName || '').trim();
    const lastName = (data.lastName || '').trim();
    const composedName = `${firstName} ${lastName}`.trim() || data.name || '';
    if (!composedName) { toast(t('lan.fwd.nameRequired'), 'error'); return; }
    setShowModal(false);
    setEditCustomer(null);
    setPrefillPhone('');
    toast(t('lan.fwd.sending'), 'info');
    const ack = await sendCreateCustomer({
      firstName, lastName, name: composedName,
      phone: data.phone, email: data.email, notes: data.notes,
      communicationConsent: data.communicationConsent,
    });
    if (ack.ok) {
      toast(ack.duplicate ? t('lan.fwd.duplicate') : t('lan.fwd.created'), 'success');
    } else {
      const map: Record<string, string> = {
        not_paired: t('lan.fwd.notPaired'),
        unreachable: t('lan.fwd.offline'),
        no_renderer: t('lan.fwd.offline'),
        timeout: t('lan.fwd.timeout'),
        dispatch_timeout: t('lan.fwd.timeout'),
        dispatch_unavailable: t('lan.fwd.notReady'),
      };
      toast(map[ack.error || ''] || t('lan.fwd.failed'), 'error');
    }
  }, [toast, t]);

  // LAN-OPERATION-FORWARDING-CUSTOMER-NOTE-V1: add a note to a customer.
  // Secondary → forward to Primary (no local write). Primary/standalone →
  // append locally + persist. Returns void; shows toast feedback.
  const handleAddCustomerNote = useCallback(async (customer: Customer, text: string) => {
    const clean = (text || '').trim();
    if (!clean) return;
    if (isLanSecondaryReadOnly()) {
      toast(t('lan.note.sending'), 'info');
      const ack = await sendCustomerNote({ customerId: customer.id, text: clean });
      if (ack.ok) {
        toast(t('lan.note.savedPrimary'), 'success');
      } else {
        const map: Record<string, string> = {
          not_paired: t('lan.fwd.notPaired'),
          unreachable: t('lan.note.offline'),
          no_renderer: t('lan.note.offline'),
          timeout: t('lan.note.offline'),
          dispatch_timeout: t('lan.note.offline'),
          dispatch_unavailable: t('lan.note.offline'),
          customer_not_found: t('lan.note.notFound'),
        };
        toast(map[ack.error || ''] || t('lan.note.failed'), 'error');
      }
      return;
    }
    // Primary / standalone — append locally through the canonical persist path.
    const fresh = customersRef.current.find((c) => c.id === customer.id) || customer;
    const updated: Customer = {
      ...fresh,
      notes: appendCustomerNote(fresh.notes, clean),
      updatedAt: new Date().toISOString(),
    };
    const next = customersRef.current.map((c) => (c.id === fresh.id ? updated : c));
    customersRef.current = next;
    setCustomers(next);
    persist.customer(updated.id, updated as unknown as Record<string, unknown>);
    // Keep the open history modal in sync so the new note shows immediately.
    setViewHistory((v) => (v && v.id === updated.id ? updated : v));
    toast(t('lan.note.added'), 'success');
  }, [toast, t, setCustomers]);

  const handleSave = useCallback(
    (data: Partial<Customer>) => {
      const firstName = (data.firstName || '').trim();
      const lastName  = (data.lastName  || '').trim();
      const composedName = `${firstName} ${lastName}`.trim() || data.name || '';

      // LAN-PHASE-3B: Secondary CREATE → forward to Primary (no local persist).
      if (!editCustomer && isLanSecondaryReadOnly()) {
        void forwardCreateCustomer(data);
        return;
      }

      if (editCustomer) {
        const updated: Customer = {
          ...editCustomer,
          ...data,
          firstName: firstName || editCustomer.firstName,
          lastName:  lastName  || editCustomer.lastName,
          name: composedName || editCustomer.name,
          updatedAt: new Date().toISOString(),
        };
        // Round 18: read from ref to avoid stale-closure clobber on multi-station sync
        const nextCustomers = customersRef.current.map((c) => c.id === editCustomer.id ? updated : c);
        customersRef.current = nextCustomers;
        setCustomers(nextCustomers);
        persist.customer(updated.id, updated as unknown as Record<string, unknown>);
        toast(t('customers.saved'), 'success');
      } else {
        // Duplicate detection — by phone (last 10 digits) or by first+last name.
        // Round 18: search baseline reads customersRef.current so dup-check sees
        // any concurrent customers added by another station between renders.
        const newFirst = firstName.toLowerCase();
        const newLast  = lastName.toLowerCase();
        const newPhone = normalizePhone(data.phone || '');
        const baseCustomers = customersRef.current;

        const existingByPhone = newPhone.length >= 10 ? baseCustomers.find((c) => {
          // Check primary phone
          const cPhone = normalizePhone(c.phone || '');
          if (cPhone.length >= 10 && cPhone.slice(-10) === newPhone.slice(-10)) return true;
          // Also check secondary phones[] array
          const cPhones = (c as any).phones;
          if (Array.isArray(cPhones)) {
            for (const p of cPhones) {
              const pNorm = normalizePhone(p || '');
              if (pNorm.length >= 10 && pNorm.slice(-10) === newPhone.slice(-10)) return true;
            }
          }
          return false;
        }) : null;

        const existingByName = !existingByPhone && newFirst ? baseCustomers.find((c) => {
          const cFirst = (c.firstName || '').trim().toLowerCase();
          const cLast  = (c.lastName  || '').trim().toLowerCase();
          if (newFirst && newLast && cFirst === newFirst && cLast === newLast) return true;
          return false;
        }) : null;

        const existing = existingByPhone || existingByName;
        if (existing) {
          const matchType = existingByPhone
            ? t('customers.dupMatchPhone')
            : t('customers.dupMatchName');
          const existName = `${existing.firstName || ''} ${existing.lastName || ''}`.trim() || existing.name;
          const existPhone = existing.phone ? formatPhone(existing.phone) : t('customers.na');
          // Show merge/create dialog instead of blocking confirm()
          const doMerge = () => {
            const existingPhones = Array.isArray((existing as any).phones) ? (existing as any).phones : (existing.phone ? [existing.phone] : []);
            const incomingPhones = Array.isArray((data as any).phones) ? (data as any).phones : (data.phone ? [data.phone] : []);
            const mergedPhones = Array.from(new Set([...existingPhones, ...incomingPhones].map((p) => normalizePhone(p)).filter(Boolean)));
            const merged: Customer = {
              ...existing,
              ...data,
              id: existing.id,
              customerNumber: existing.customerNumber,
              createdAt: existing.createdAt,
              firstName: firstName || existing.firstName,
              lastName: lastName || existing.lastName,
              name: composedName || existing.name,
              phones: mergedPhones,
              updatedAt: new Date().toISOString(),
            } as Customer;
            const mergedNext = customersRef.current.map((c) => c.id === existing.id ? merged : c);
            customersRef.current = mergedNext;
            setCustomers(mergedNext);
            persist.customer(merged.id, merged as unknown as Record<string, unknown>);
            toast(t('customers.updated'), 'success');
            setShowModal(false);
            setEditCustomer(null);
          };
          setDupConfirm({
            message: t('customers.dupMsg', matchType, existName, existPhone),
            onMerge: doMerge,
            onCreateNew: () => {
              setDupConfirm(null);
            },
          });
          return; // Wait for user choice via dialog
        }

        // Multi-station safe customer number — slice(-8) for timestamp + 4 random chars.
        // Pattern: ${prefix}-${ts8}-${rand4}. Round 18 fix — old slice(-4) collided
        // every ~10 seconds across the two stations syncing through Firestore.
        const ts8 = Date.now().toString().slice(-8);
        const rand4 = Math.random().toString(36).slice(2, 6).toUpperCase();
        const custNum = `${settings.customerNumberPrefix || 'GC'}-${ts8}-${rand4}`;
        // Referral code: prefix + 4 random chars (independent of customerNumber so it
        // stays short enough for the maxLength={10} input). Example: GC7K9X.
        const referralRand = Math.random().toString(36).slice(2, 6).toUpperCase();
        const referralCode = `${settings.customerNumberPrefix || 'GC'}${referralRand}`;

        const { firstName: _df, lastName: _dl, name: _dn, ...dataRest } = data;
        const newCustomer: Customer = {
          id: generateId(),
          // R-PHONE-SANITIZE-SWEEP: persist 10-digit form (or empty) so wa.me /
          // SMS / search downstream see consistent input regardless of how the
          // cashier typed the number.
          phone: normalizePhone(data.phone || ''),
          email: data.email || '',
          loyaltyPoints: 0,
          storeCredit: 0,
          customerNumber: custNum,
          notes: data.notes || '',
          communicationConsent: data.communicationConsent ?? false,
          createdAt: new Date().toISOString(),
          ...dataRest,
          // Canonical name fields — placed last so nothing in dataRest overrides them
          firstName,
          lastName,
          name: composedName,
          referralCode,
        };

        // If a referral code was provided, award bonus points to both parties.
        // Round 18: collapsed single-pass through customersRef so referrer update +
        // new customer add commit in one setCustomers call without stale-closure risk.
        const usedCode = data.referredBy?.trim().toUpperCase();
        let workingCustomers = customersRef.current;
        if (usedCode && settings.loyaltyEnabled) {
          const referrer = workingCustomers.find(
            (c) => c.referralCode?.toUpperCase() === usedCode,
          );
          if (referrer) {
            const REFERRAL_BONUS = 50; // 50 points to each party
            const updatedReferrer: Customer = {
              ...referrer,
              loyaltyPoints: (referrer.loyaltyPoints || 0) + REFERRAL_BONUS,
              updatedAt: new Date().toISOString(),
            };
            workingCustomers = workingCustomers.map((c) => c.id === referrer.id ? updatedReferrer : c);
            persist.customer(referrer.id, updatedReferrer as unknown as Record<string, unknown>);
            newCustomer.loyaltyPoints = REFERRAL_BONUS;
            toast(t('customers.referralBonus', REFERRAL_BONUS), 'success');
          }
        }

        const finalCustomers = [...workingCustomers, newCustomer];
        customersRef.current = finalCustomers;
        setCustomers(finalCustomers);
        persist.customer(newCustomer.id, newCustomer as unknown as Record<string, unknown>);
        if (!usedCode || !settings.loyaltyEnabled) {
          toast(t('customers.added'), 'success');
        }
      }
      setShowModal(false);
      setEditCustomer(null);
    },
    [editCustomer, customers, settings, t, setCustomers, toast, forwardCreateCustomer],
  );

  // R-CUSTOMER-DELETE-FIX-V1: single delete executor. Persistence runs FIRST
  // so a storage failure leaves the in-memory list intact (modal stays open,
  // error is visible). deletingRef guards double-submit. Returns success.
  const deletingRef = useRef(false);
  const performDelete = useCallback((id: string): boolean => {
    if (deletingRef.current) return false;
    deletingRef.current = true;
    try {
      remove.customer(id);
      const nextCustomers = customersRef.current.filter((c) => c.id !== id);
      customersRef.current = nextCustomers;
      setCustomers(nextCustomers);
      toast(t('customers.deleted'), 'info');
      return true;
    } catch (err) {
      console.error('[customers] delete failed', err);
      toast(t('customers.deleteFailed'), 'error');
      return false;
    } finally {
      deletingRef.current = false;
    }
  }, [setCustomers, toast, t]);

  // R-CUSTOMER-DELETE-FIX-V1: render the pure guard's structured warnings
  // through the existing i18n keys (behavior/text unchanged).
  const renderDeleteWarnings = useCallback((warnings: CustomerDeleteWarning[]): string => {
    const lines = warnings.map((w) => {
      switch (w.type) {
        case 'store_credit':    return t('customers.warnStoreCredit', formatCurrency(w.amountCents));
        case 'loyalty':         return t('customers.warnLoyalty', w.points);
        case 'active_repairs':  return t('customers.warnRepairs', w.count);
        case 'active_layaways': return t('customers.warnLayaways', w.count);
        case 'active_unlocks':  return t('customers.warnUnlocks', w.count);
      }
    });
    return t('customers.deleteWarning', lines.join('\n'));
  }, [t]);

  // CUSTOMER-RECOVER-BUTTON-INTEL-CONTEXT-FIX-V1: pass the EXACT customer id
  // through the one-shot context (consumed by IntelligenceChat at classify
  // time) — the visible text prompt stays identical and remains the fallback.
  // Applied to both buttons: inspection proved Recover and VIP share this
  // exact text-only signal path.
  const handleRecoverCustomer = useCallback((c: Customer) => {
    const query = `${t('customers.queryRecover')}${c.name}${c.phone ? ` ${c.phone}` : ''}`;
    setPendingExplicitCustomer(c.id);
    setPendingIntelligenceAction(query);
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'intelligence' });
  }, [t, dispatch]);

  const handleVipOutreach = useCallback((c: Customer) => {
    const query = `${t('customers.queryVip')}${c.name}${c.phone ? ` ${c.phone}` : ''}`;
    setPendingExplicitCustomer(c.id);
    setPendingIntelligenceAction(query);
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'intelligence' });
  }, [t, dispatch]);

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">👤 {t('customers.title')}</h1>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // Build CSV for TextMagic / any SMS platform.
                // Clients with multiple phones get one row per number (so bulk SMS
                // reaches all their lines, not just the primary).
                const rows = [['First Name', 'Last Name', 'Phone', 'Email', 'Communication Consent', 'Carrier', 'Plan', 'Store Credit']];
                customers.forEach((c) => {
                  // Collect every phone: primary + phones[] array, dedup
                  const allPhones = new Set<string>();
                  if (c.phone) allPhones.add(String(c.phone).replace(/\D/g, ''));
                  const extra = (c as any).phones;
                  if (Array.isArray(extra)) {
                    for (const p of extra) {
                      if (p) allPhones.add(String(p).replace(/\D/g, ''));
                    }
                  }
                  const carriers = (c as any).carriers || [];
                  let idx = 0;
                  for (let phone of allPhones) {
                    if (!phone) { idx++; continue; }
                    if (phone.length === 10) phone = '+1' + phone;
                    else if (phone.length === 11 && phone[0] === '1') phone = '+' + phone;
                    rows.push([
                      c.firstName || (c.name || '').split(' ')[0] || '',
                      c.lastName || (c.name || '').split(' ').slice(1).join(' ') || '',
                      phone,
                      c.email || '',
                      c.communicationConsent ? 'Yes' : 'No',
                      carriers[idx] || (c as any).carrier || '',
                      (c as any).plan || '',
                      ((c.storeCredit || 0) / 100).toFixed(2),
                    ]);
                    idx++;
                  }
                });
                const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast(t('customers.csvExported'), 'success');
              }}
              className="btn btn-secondary"
            >
              ⬇ {t('customers.exportCsv')}
            </button>
            {/* LAN-PHASE-3B: on a Secondary, New Customer stays ENABLED — the
                create is forwarded to the Primary (not saved locally). */}
            <button
              onClick={() => { setEditCustomer(null); setShowModal(true); }}
              className="btn btn-primary"
              title={lanReadOnly ? t('lan.fwd.newOnSecondary') : undefined}
            >
              + {t('customers.newCustomer')}
            </button>
          </div>
        </div>

        {/* Stats — hybrid 4-card: Total / Lapsed / StoreCredit / Revenue */}
        <div className="grid grid-cols-4 gap-4">
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('customers.stat.total')}</p>
            <p className="text-2xl font-bold text-white mt-1">{customers.length}</p>
          </div>
          <div className="stat-card" style={{ cursor: lapsedCustomers.length > 0 ? 'pointer' : 'default' }} onClick={() => lapsedCustomers.length > 0 && setShowLapsedOnly(!showLapsedOnly)}>
            <p className="text-xs text-slate-400 uppercase">{t('customers.stat.lapsed')}</p>
            <p className={`text-2xl font-bold mt-1 ${lapsedCustomers.length > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
              {lapsedCustomers.length}
            </p>
            {lapsedCustomers.length > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">{t('customers.stat.lapsedFilter')}</p>
            )}
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('customers.stat.storeCredit')}</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">
              {formatCurrency(customers.reduce((sum, c) => sum + (c.storeCredit || 0), 0))}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {customers.filter((c) => (c.storeCredit || 0) > 0).length} {t('customers.stat.withCredit')}
            </p>
          </div>
          <div className="stat-card">
            <p className="text-xs text-slate-400 uppercase">{t('customers.stat.totalRevenue')}</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">
              {formatCurrency(sales.filter((s) => s.status === 'completed').reduce((sum, s) => sum + (s.total || 0), 0))}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            {/* r-global-search: SYNCED mode — local `search` state still
                drives the filtered list (preserving secondary phones[] match
                logic in the memo below) AND the dropdown opens for the other
                7 collections. excludeCollection='customers' avoids redundancy.
                R-CUSTOMER-SEARCH-IDENTITY-FIRST-V1: disableResultsDropdown so the
                absolutely-positioned cross-module popover (incl. its "Recent Sales"
                section) never floats OVER the customer identity rows below. The
                input + SYNCED local filter still work, so the customer table
                itself filters by name/phone and identity stays fully visible.
                Recent sales stay in the per-customer View History modal (stacked,
                never above the row). Same pattern as InventoryModule
                (R-INVENTORY-OVERLAY-FIX-V1). */}
            <GlobalSearchBar
              localValue={search}
              onLocalChange={setSearch}
              excludeCollection="customers"
              placeholder={t('customers.searchPlaceholder')}
              disableResultsDropdown
            />
          </div>
          {lapsedCustomers.length > 0 && (
            <button
              onClick={() => setShowLapsedOnly(!showLapsedOnly)}
              style={{
                padding: '0.5rem 0.875rem', borderRadius: '0.5rem', fontSize: '0.8rem', fontWeight: 600,
                border: `1px solid ${showLapsedOnly ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.12)'}`,
                background: showLapsedOnly ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                color: showLapsedOnly ? '#fbbf24' : '#94a3b8', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              ⏰ {t('customers.lapsedBtn', lapsedCustomers.length)}
            </button>
          )}
        </div>

        {/* Table */}
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>{t('customers.col.name')}</th>
                <th>{t('customers.col.phone')}</th>
                <th>{t('customers.col.carrier')}</th>
                <th>{t('customers.col.plan')}</th>
                <th className="text-right">{t('customers.col.totalSpent')}</th>
                <th className="text-center">{t('customers.col.visits')}</th>
                <th>{t('customers.col.lastVisit')}</th>
                <th className="text-right">{t('customers.col.credit')}</th>
                <th className="text-right">{t('customers.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-500">{t('customers.noFound')}</td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id}
                    ref={isHighlighted(c.id) ? highlightRef : null}
                    style={isHighlighted(c.id) ? { outline: '2px solid #667eea', background: 'rgba(102,126,234,0.1)' } : undefined}>
                    <td>
                      <p className="text-sm text-white font-medium">{c.name}</p>
                      {(() => {
                        const stats = customerStats.get(c.id);
                        // r-audit-r3: only show lapsed badge when there IS purchase history.
                        // Customers with no v2 sales show nothing instead of misleading "999d".
                        if (!stats?.lastVisit) return null;
                        const daysAgo = Math.floor((Date.now() - new Date(stats.lastVisit).getTime()) / (24 * 60 * 60 * 1000));
                        if (daysAgo >= 30) {
                          return <p className="text-xs text-amber-500 mt-0.5">⏰ {daysAgo}d</p>;
                        }
                      })()}
                    </td>
                    <td className="text-sm text-slate-300">{formatPhone(c.phone)}</td>
                    <td className="text-sm text-slate-400">{c.carrier || '—'}</td>
                    <td className="text-sm text-slate-400">{c.plan || '—'}</td>
                    <td className="text-right">
                      {(() => {
                        const stats = customerStats.get(c.id);
                        // I2B-0.1: canonical Total Collected (same number as
                        // the Customer 360 modal — never a separate reduce).
                        const collected = stats?.totalCollected || 0;
                        return collected > 0
                          ? <span className="text-emerald-400 font-semibold">{formatCurrency(collected)}</span>
                          : <span className="text-slate-600">—</span>;
                      })()}
                    </td>
                    <td className="text-center">
                      {(() => {
                        const v = customerStats.get(c.id)?.visits || 0;
                        return v > 0
                          ? <span style={{ background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>{v}</span>
                          : <span className="text-slate-600">—</span>;
                      })()}
                    </td>
                    <td className="text-sm text-slate-400">{customerStats.get(c.id)?.lastVisit || '—'}</td>
                    <td className="text-right">
                      {(c.storeCredit || 0) > 0 ? (
                        <span className="text-blue-400 font-semibold" title={t('customers.creditAvailable')}>
                          {formatCurrency(c.storeCredit || 0)}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            dispatch({ type: 'SET_PENDING_PHONE_PAYMENT_CUSTOMER', payload: c.id });
                            dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });
                          }}
                          title={t('customers.titlePhonePayment')}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 800, background: 'rgba(34,197,94,0.3)', color: '#22c55e' }}
                        >$</button>
                        <button
                          onClick={() => {
                            // R-COMMS-WHATSAPP-EMOJI-FIX-V2: route through openWhatsApp
                            // for consistent country-code handling + BMP sanitize guard.
                            if (c.phone) openWhatsApp(c.phone, '');
                          }}
                          title="WhatsApp"
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(59,130,246,0.3)', color: '#3b82f6' }}
                        >💬</button>
                        <button
                          onClick={() => {
                            setViewHistory(c);
                            // R-OPERATOR-ACTIVITY-WIRING: notify FloatingOperatorBubble that a customer history was opened
                            try {
                              window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
                                detail: { type: 'customer.history_opened', payload: { customerId: c.id } },
                              }));
                            } catch { /* env without CustomEvent — silent */ }
                          }}
                          title={t('customers.titleViewHistory')}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(139,92,246,0.3)', color: '#8b5cf6' }}
                        >👁</button>
                        <button
                          onClick={() => { setEditCustomer(c); setShowModal(true); }}
                          title={t('customers.titleEdit')}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(245,158,11,0.25)', color: '#f59e0b' }}
                        >✏️</button>
                        <button
                          onClick={() => setDeleteConfirm(c.id)}
                          title={t('customers.titleDelete')}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(239,68,68,0.25)', color: '#ef4444' }}
                        >🗑️</button>
                        <button
                          onClick={() => handleRecoverCustomer(c)}
                          title={t('customers.titleRecover')}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(20,184,166,0.2)', color: '#2dd4bf' }}
                        >🔄</button>
                        <button
                          onClick={() => handleVipOutreach(c)}
                          title={t('customers.titleVipOutreach')}
                          style={{ width: 38, height: 38, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', fontSize: '1.1rem', background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}
                        >⭐</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <CustomerFormModal
          customer={editCustomer}
          initialPhone={editCustomer ? '' : prefillPhone}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditCustomer(null); setPrefillPhone(''); }}
          toast={toast}
          confirmDialog={confirmDialog}
          setConfirmDialog={setConfirmDialog}
        />
      )}

      {/* History Modal */}
      {viewHistory && (() => {
        const history = getCustomerHistory(viewHistory);
        return (
          <CustomerHistoryModal
            customer={viewHistory}
            sales={history.sales}
            repairs={history.repairs}
            layaways={history.layaways}
            unlocks={history.unlocks}
            specialOrders={history.specialOrders}
            returns={history.returns}
            appointments={history.appointments}
            certificates={history.certificates}
            onClose={() => setViewHistory(null)}
            // CUSTOMER-360-HEADER-V1: reuses the existing edit-modal handlers —
            // closes history, opens the same edit modal the card ✏️ button uses.
            onEdit={() => { setViewHistory(null); setEditCustomer(viewHistory); setShowModal(true); }}
            onAddNote={(text) => handleAddCustomerNote(viewHistory, text)}
            settings={settings}
            // I2B-0: GLOBAL (store-scoped) collections for the canonical
            // customer money profile — the service attributes internally by
            // customerId → return linkage → normalized phone. The pre-filtered
            // history props above keep feeding the visible lists unchanged.
            moneyCollections={{ sales, repairs, unlocks, layaways, specialOrders, customerReturns: returns_, inventory }}
          />
        );
      })()}

      <ConfirmDialog
        open={!!deleteConfirm || !!deleteWarningMsg}
        title={t('customers.titleDelete')}
        message={deleteWarningMsg || t('customers.deleteMsg')}
        variant="danger"
        confirmLabel={t('customers.confirmDelete')}
        cancelLabel={t('customers.cancelBtn')}
        onConfirm={() => {
          // R-CUSTOMER-DELETE-FIX-V1. Root cause of the reported no-op: the
          // old handler raised the linked-record warning AND then cleared
          // deleteConfirm in the same confirm — so when the warning dialog
          // re-opened and the owner pressed Delete again, no id was left and
          // the dialog closed silently without deleting. deleteConfirm is now
          // kept alive across the warning step and only cleared on completion.
          const id = deleteConfirm;
          if (!id) {
            setDeleteConfirm(null);
            setDeleteWarningMsg(null);
            return;
          }
          if (deleteWarningMsg) {
            // Second dialog — owner confirmed despite the warnings.
            if (performDelete(id)) {
              setDeleteConfirm(null);
              setDeleteWarningMsg(null);
            }
            // On failure the dialog stays open with the visible error toast.
            return;
          }
          const evaluation = evaluateCustomerDelete(id, customersRef.current, { repairs, layaways, unlocks });
          if (evaluation.kind === 'missing') {
            // Fail safe, never silently: explain instead of no-op.
            toast(t('customers.deleteNotFound'), 'error');
            setDeleteConfirm(null);
            setDeleteWarningMsg(null);
            return;
          }
          if (evaluation.kind === 'warn') {
            setDeleteWarningMsg(renderDeleteWarnings(evaluation.warnings));
            return; // keep deleteConfirm — the warning dialog completes it
          }
          if (performDelete(id)) {
            setDeleteConfirm(null);
            setDeleteWarningMsg(null);
          }
        }}
        onCancel={() => { setDeleteConfirm(null); setDeleteWarningMsg(null); }}
      />
      {dupConfirm && (
        <ConfirmDialog
          open
          title={t('customers.dupTitle')}
          message={dupConfirm.message}
          variant="warning"
          confirmLabel={t('customers.dupUpdateExisting')}
          cancelLabel={t('customers.dupCreateNew')}
          onConfirm={() => { dupConfirm.onMerge(); setDupConfirm(null); }}
          onCancel={() => { dupConfirm.onCreateNew(); setDupConfirm(null); }}
        />
      )}
    </>
  );
}

// ── Customer Form ─────────────────────────────────────────

const CARRIER_OPTIONS_LIST = ['AT&T', 'T-Mobile', 'Verizon', 'Cricket', 'Metro', 'Boost', 'Simple Mobile', 'H2O', 'Page Plus', 'Ultra Mobile', 'Tracfone', 'Other'];
const MONTHLY_PAYMENT_PRESETS = ['25.00', '30.00', '35.00', '40.00', '45.00', '50.00', '55.00', '60.00', '65.00', '70.00', '75.00', '80.00', '100.00'];
const DRAFT_KEY = 'customer_form_draft';

interface CustomerFormModalProps {
  customer: Customer | null;
  /**
   * Optional phone prefill for create mode (customer == null).
   * R-OPERATOR-AMBIENT-AWARENESS-V1 — used by the Operator bubble's
   * Create Customer quick action so the cashier doesn't have to
   * re-type a number they just entered in Phone Services.
   */
  initialPhone?: string;
  onSave: (d: Partial<Customer>) => void;
  onClose: () => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'error') => void;
  confirmDialog?: {
    message: string;
    title: string;
    variant?: 'danger' | 'warning' | 'default';
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  } | null;
  setConfirmDialog?: React.Dispatch<React.SetStateAction<{
    message: string;
    title: string;
    variant?: 'danger' | 'warning' | 'default';
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  } | null>>;
}

function CustomerFormModal({ customer, initialPhone, onSave, onClose, toast, confirmDialog, setConfirmDialog }: CustomerFormModalProps) {
  const { t } = useTranslation();

  // Build initial form state (handles: edit mode, draft restore, fresh)
  const [form, setForm] = useState(() => {
    // R-OPERATOR-AMBIENT-AWARENESS-V1: create-mode prefill from
    // initialPhone. Ignored when in edit mode (the customer hydration
    // branch below overrides). Has zero effect when initialPhone is '' .
    const prefillPhone = (initialPhone || '').trim();
    const defaults = {
      firstName: '', lastName: '',
      phone: prefillPhone,
      phones: [prefillPhone] as string[],
      carrier: '', carriers: [''] as string[],
      // R-CUSTOMER-LINE-PAYMENTS-V1: per-line dollars strings, parallel to
      // phones[]. A new line always starts blank — never inherited.
      monthlyPayments: [''] as string[],
      email: '', address: '', city: '', state: '', zip: '',
      showAddressOnCredential: false,
      plan: '',
      notes: '', communicationConsent: false, photo: '',
      referredBy: '',
    };

    // Edit mode — hydrate from customer
    if (customer) {
      const cAny = customer as any;
      const phones = Array.isArray(cAny.phones) && cAny.phones.length > 0
        ? cAny.phones
        : (customer.phone ? [customer.phone] : ['']);
      const carriers: string[] = [];
      const baseCarriers = Array.isArray(cAny.carriers) ? cAny.carriers : [cAny.carrier || ''];
      for (let i = 0; i < phones.length; i++) {
        carriers[i] = baseCarriers[i] || (i === 0 ? (cAny.carrier || '') : '');
      }
      // R-CUSTOMER-LINE-PAYMENTS-V1: hydrate per-line amounts. Legacy
      // customer-level amount maps ONLY onto the single line of a
      // single-line record; a multi-line legacy amount is never distributed
      // (the warning banner asks the owner to assign it explicitly).
      const centsArr: (number | null | undefined)[] = Array.isArray(cAny.monthlyPaymentsCents) ? cAny.monthlyPaymentsCents : [];
      const monthlyPayments: string[] = [];
      for (let i = 0; i < phones.length; i++) {
        monthlyPayments[i] = centsToDollarsString(centsArr[i] ?? null);
      }
      if (!hasPerLinePayments(customer) && phones.length <= 1) {
        const legacy = parseDollarsToCents(cAny.monthlyPayment);
        if (legacy != null) monthlyPayments[0] = centsToDollarsString(legacy);
      }
      return {
        ...defaults,
        firstName: customer.firstName || customer.name.split(' ')[0] || '',
        lastName:  customer.lastName  || customer.name.split(' ').slice(1).join(' ') || '',
        phone: phones[0] || '',
        phones,
        carrier: carriers[0] || '',
        carriers,
        monthlyPayments,
        email: customer.email || '',
        address: cAny.address || '',
        city:    cAny.city || '',
        state:   cAny.state || '',
        zip:     cAny.zip || '',
        plan:    cAny.plan || '',
        notes: customer.notes || '',
        communicationConsent: customer.communicationConsent ?? false,
        photo: cAny.photo || '',
        showAddressOnCredential: cAny.showAddressOnCredential ?? false,
      };
    }

    // New customer — check for draft in useEffect
    return defaults;
  });

  // R-CUSTOMER-LINE-PAYMENTS-V1: legacy amount on a multi-line record that
  // was never assigned to a specific line — surfaced, never auto-allocated.
  const legacyUnassignedDollars = customer && hasUnassignedLegacyPayment(customer)
    ? centsToDollarsString(parseDollarsToCents((customer as any).monthlyPayment))
    : '';

  // Check for saved draft on mount
  useEffect(() => {
    if (customer) return;
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        setForm((prev) => ({ ...prev, ...draft }));
      } catch { localStorage.removeItem(DRAFT_KEY); }
    }
  }, []);

  // Auto-save draft (only for new customers)
  useEffect(() => {
    if (customer) return; // edit mode — no draft
    const hasContent = form.firstName || form.lastName || form.phones.some((p: string) => p);
    if (hasContent) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch {}
    }
  }, [form, customer]);

  // ── Phones / Carriers / Line-payments array helpers ────────
  // R-CUSTOMER-LINE-PAYMENTS-V1: monthlyPayments is a third parallel array;
  // every mutation keeps the three arrays index-aligned so removing or
  // reordering one line can never shift another line's amount.
  const padPayments = (payments: string[], len: number): string[] => {
    const next = [...payments];
    while (next.length < len) next.push('');
    return next.slice(0, Math.max(len, 1));
  };
  const updatePhone = (idx: number, value: string) => {
    const nextPhones = [...form.phones];
    nextPhones[idx] = value.replace(/\D/g, '');
    const primary = nextPhones.find((p) => (p || '').trim()) || '';
    const nextCarriers = [...form.carriers];
    while (nextCarriers.length < nextPhones.length) nextCarriers.push('');
    setForm({ ...form, phones: nextPhones, phone: primary, carriers: nextCarriers, carrier: nextCarriers[0] || form.carrier, monthlyPayments: padPayments(form.monthlyPayments, nextPhones.length) });
  };
  const updateCarrier = (idx: number, value: string) => {
    const nextCarriers = [...form.carriers];
    nextCarriers[idx] = value;
    setForm({ ...form, carriers: nextCarriers, carrier: nextCarriers[0] || '' });
  };
  const updateLinePayment = (idx: number, value: string) => {
    const next = padPayments(form.monthlyPayments, form.phones.length);
    next[idx] = value;
    setForm({ ...form, monthlyPayments: next });
  };
  const addPhoneField = () => {
    // New line starts BLANK — it never inherits another line's payment.
    setForm({ ...form, phones: [...form.phones, ''], carriers: [...form.carriers, ''], monthlyPayments: [...padPayments(form.monthlyPayments, form.phones.length), ''] });
  };
  const removePhoneField = (idx: number) => {
    let nextPhones = form.phones.filter((_: string, i: number) => i !== idx);
    let nextCarriers = form.carriers.filter((_: string, i: number) => i !== idx);
    let nextPayments = padPayments(form.monthlyPayments, form.phones.length).filter((_: string, i: number) => i !== idx);
    if (nextPhones.length === 0) { nextPhones = ['']; nextPayments = ['']; }
    while (nextCarriers.length < nextPhones.length) nextCarriers.push('');
    while (nextPayments.length < nextPhones.length) nextPayments.push('');
    const primary = nextPhones.find((p: string) => (p || '').trim()) || '';
    setForm({ ...form, phones: nextPhones, phone: primary, carriers: nextCarriers, carrier: nextCarriers[0] || '', monthlyPayments: nextPayments });
  };

  // ── Webcam for customer photo ─────────────────────────────
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      setStream(s);
      setShowCamera(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch {
      toast?.(t('customers.form.cameraUnavailable'), 'error');
    }
  };
  const stopCamera = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setShowCamera(false);
  };
  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const v = videoRef.current, c = canvasRef.current;
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      setForm({ ...form, photo: c.toDataURL('image/jpeg', 0.8) });
      stopCamera();
    }
  };
  useEffect(() => {
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = () => {
    const firstName = form.firstName.trim();
    const lastName  = form.lastName.trim();
    if (!firstName || !lastName) {
      toast?.(t('customers.form.nameRequired'), 'error');
      return;
    }
    // R-CUSTOMER-LINE-PAYMENTS-V1: build (phone, carrier, payment) entries
    // BEFORE filtering blanks so a removed/blank middle line can never shift
    // another line's carrier or amount (index alignment preserved).
    const entries = form.phones
      .map((p: string, i: number) => ({
        phone: (p || '').trim(),
        carrier: (form.carriers[i] || (i === 0 ? form.carrier : '') || '').trim(),
        paymentCents: parseDollarsToCents(form.monthlyPayments[i]),
      }))
      .filter((e: { phone: string }) => e.phone);
    const phones = entries.map((e: { phone: string }) => e.phone);
    if (phones.length === 0) {
      toast?.(t('customers.form.phoneRequired'), 'error');
      return;
    }
    const phoneLen = phones[0].replace(/\D/g, '').length;
    if (phoneLen > 0 && phoneLen !== 10) {
      toast?.(t('customers.form.phoneMustBe10'), 'error');
      return;
    }
    const carriers: string[] = entries.map((e: { carrier: string }) => e.carrier);
    const monthlyPaymentsCents: (number | null)[] = entries.map((e: { paymentCents: number | null }) => e.paymentCents);
    // Legacy field handling: a single-line record keeps the legacy mirror so
    // pre-existing readers stay correct; an edited multi-line record clears
    // it — per-line values are now authoritative (the legacy amount was only
    // ever a one-time fallback "until the record is edited").
    const legacyMirror = phones.length === 1 ? centsToDollarsString(monthlyPaymentsCents[0]) : '';

    const patch: Partial<Customer> = {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      phone: phones[0],
      phones,
      carrier: carriers[0] || '',
      carriers,
      email: form.email,
      address: form.address,
      city: form.city,
      state: form.state,
      zip: form.zip,
      showAddressOnCredential: form.showAddressOnCredential,
      plan: form.plan,
      monthlyPaymentsCents,
      monthlyPayment: legacyMirror || undefined,
      photo: form.photo,
      notes: form.notes,
      communicationConsent: form.communicationConsent,
      referredBy: form.referredBy.trim().toUpperCase() || undefined,
    };
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    onSave(patch);
  };

  const clearForm = () => {
    if (!setConfirmDialog) return;
    setConfirmDialog({
      title: t('customers.form.clearTitle'),
      message: t('customers.form.clearMsg'),
      variant: 'warning',
      confirmLabel: t('customers.form.clearConfirm'),
      cancelLabel: t('customers.form.cancelBtn'),
      onConfirm: () => {
        setForm({
          firstName: '', lastName: '', phone: '', phones: [''],
          carrier: '', carriers: [''],
          monthlyPayments: [''],
          email: '', address: '', city: '', state: '', zip: '',
          showAddressOnCredential: false,
          plan: '', notes: '', communicationConsent: false, photo: '',
          referredBy: '',
        });
        try { localStorage.removeItem(DRAFT_KEY); } catch {}
        setConfirmDialog(null);
      },
    });
  };

  return (
    <Modal open onClose={onClose} title={`👤 ${customer ? t('customers.form.editCustomer') : t('customers.form.addCustomer')}`} size="max-w-2xl">
      <div className="space-y-3 max-h-[75vh] overflow-y-auto pr-1">
        {/* Auto-save indicator */}
        {!customer && (
          <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '0.5rem', padding: '0.6rem 0.75rem', fontSize: '0.8rem', color: '#6ee7b7' }}>
            💾 {t('customers.form.autoSave')}
          </div>
        )}

        {/* First / Last Name */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('customers.form.firstName')} *</label>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="input" autoFocus />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('customers.form.lastName')} *</label>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="input" />
          </div>
        </div>

        {/* Photo / Webcam */}
        <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '0.5rem', padding: '0.75rem' }}>
          <label className="text-xs text-slate-300 font-semibold block mb-2">📸 {t('customers.form.photo')}</label>
          {!showCamera ? (
            form.photo ? (
              <div style={{ textAlign: 'center' }}>
                <img src={form.photo} alt="Customer" style={{ maxWidth: '160px', maxHeight: '160px', borderRadius: '8px', border: '2px solid #8b5cf6', marginBottom: '0.5rem' }} />
                <div className="flex gap-2 justify-center">
                  <button type="button" onClick={startCamera} className="btn btn-secondary btn-sm">📷 {t('customers.form.retakePhoto')}</button>
                  <button type="button" onClick={() => setForm({ ...form, photo: '' })} className="btn btn-ghost btn-sm text-red-400">🗑️</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={startCamera} className="btn btn-secondary" style={{ width: '100%' }}>📷 {t('customers.form.takePhoto')}</button>
            )
          ) : (
            <div style={{ textAlign: 'center' }}>
              <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: '360px', borderRadius: '8px', marginBottom: '0.5rem', transform: 'scaleX(-1)' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div className="flex gap-2 justify-center">
                <button type="button" onClick={capturePhoto} className="btn btn-primary btn-sm">✓ {t('customers.form.capture')}</button>
                <button type="button" onClick={stopCamera} className="btn btn-secondary btn-sm">✕ {t('customers.form.cancelBtn')}</button>
              </div>
            </div>
          )}
        </div>

        {/* Phones[] + Carriers[] + per-line Monthly Payment (R-CUSTOMER-LINE-PAYMENTS-V1) */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('customers.form.phones')} *</label>
          {legacyUnassignedDollars && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '0.4rem', padding: '0.5rem 0.6rem', fontSize: '0.75rem', color: '#fbbf24', marginBottom: '0.5rem' }}>
              ⚠️ {t('customers.form.legacyPaymentWarning', `$${legacyUnassignedDollars}`)}
            </div>
          )}
          {form.phones.map((p: string, idx: number) => (
            <div key={idx} style={{ marginBottom: '0.6rem', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '0.4rem' }}>
              <div className="flex gap-2 items-center mb-1">
                <input
                  type="tel" className="input"
                  value={formatPhone(p)}
                  onChange={(e) => updatePhone(idx, e.target.value)}
                  placeholder={t('customers.form.phonePlaceholder')}
                  style={{ flex: 1 }}
                />
                {form.phones.length > 1 && (
                  <button type="button" onClick={() => removePhoneField(idx)} className="btn btn-ghost btn-sm text-red-400" title={t('customers.form.removePhone')}>🗑️</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="input"
                  value={form.carriers[idx] || ''}
                  onChange={(e) => updateCarrier(idx, e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                >
                  <option value="">{t('customers.form.selectCarrier')}</option>
                  {CARRIER_OPTIONS_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {/* This line's own monthly payment — never inherited between lines. */}
                <input
                  type="number" step="0.01" min="0"
                  value={form.monthlyPayments[idx] ?? ''}
                  onChange={(e) => updateLinePayment(idx, e.target.value)}
                  className="input"
                  placeholder={t('customers.form.linePaymentPlaceholder')}
                  title={t('customers.form.linePayment')}
                  list="monthly-payment-presets"
                  style={{ fontSize: '0.85rem' }}
                />
              </div>
            </div>
          ))}
          <datalist id="monthly-payment-presets">
            {MONTHLY_PAYMENT_PRESETS.map((v) => <option key={v} value={v} />)}
          </datalist>
          <button type="button" onClick={addPhoneField} className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
            + {t('customers.form.addPhone')}
          </button>
          <p className="text-xs text-slate-600 mt-1">{t('customers.form.multiPhoneHint')} · {t('customers.form.linePaymentHint')}</p>
        </div>

        {/* Email */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('customers.form.email')}</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" placeholder={t('customers.form.emailPlaceholder')} />
        </div>

        {/* Address */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('customers.form.address')}</label>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input" placeholder={t('customers.form.addressPlaceholder')} />
        </div>

        {/* City / State / Zip */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('customers.form.city')}</label>
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="input" placeholder={t('customers.form.cityPlaceholder')} />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('customers.form.state')}</label>
            <input
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })}
              className="input" placeholder={t('customers.form.statePlaceholder')} maxLength={2}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('customers.form.zip')}</label>
            <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value.replace(/\D/g, '').slice(0, 5) })} className="input" placeholder={t('customers.form.zipPlaceholder')} />
          </div>
        </div>

        {/* R-CUSTOMER-ADDRESS-PRIVACY-V1: opt-in to print the customer's address
            on their credential card. Only shown when an address is present;
            default off (privacy-first). Receipts are never affected. */}
        {form.address.trim() !== '' && (
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.showAddressOnCredential}
              onChange={(e) => setForm({ ...form, showAddressOnCredential: e.target.checked })}
            />
            {t('customers.form.showAddressOnCredential')}
          </label>
        )}

        {/* Plan (R-CUSTOMER-LINE-PAYMENTS-V1: the ambiguous global Monthly
            Payment field was removed — each phone line now carries its own
            amount inside its card above) */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('customers.form.plan')}</label>
          <input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="input" placeholder={t('customers.form.planPlaceholder')} />
        </div>

        {/* Referral code (new customer only) */}
        {!customer && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {t('customers.form.referralCode')}
            </label>
            <input
              value={form.referredBy}
              onChange={(e) => setForm({ ...form, referredBy: e.target.value.toUpperCase() })}
              className="input font-mono"
              placeholder={t('customers.form.referralPlaceholder')}
              maxLength={10}
            />
            <p className="text-xs text-slate-600 mt-1">
              {t('customers.form.referralHint')}
            </p>
          </div>
        )}

        {/* Communication consent — R-COMMS-CONSENT-UNIFY: covers SMS, WhatsApp, future email */}
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={form.communicationConsent} onChange={(e) => setForm({ ...form, communicationConsent: e.target.checked })} className="rounded border-white/20 bg-white/5" />
          {t('customers.form.consent')}
        </label>

        {/* Notes */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('customers.form.notes')}</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="textarea" rows={2} />
        </div>
      </div>

      <div className="flex gap-3 mt-4 pt-4 border-t border-white/10">
        <button onClick={onClose} className="btn btn-secondary flex-1">{t('customers.form.cancelBtn')}</button>
        {!customer && (
          <button onClick={clearForm} className="btn btn-ghost" style={{ flex: 0.6 }}>🗑️ {t('customers.form.clearBtn')}</button>
        )}
        <button onClick={handleSubmit} className="btn btn-primary flex-1">{customer ? t('customers.form.saveBtn') : t('customers.form.createBtn')}</button>
      </div>

      {confirmDialog && (
        <ConfirmDialog
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={confirmDialog.cancelLabel}
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog?.(null); }}
          onCancel={() => setConfirmDialog?.(null)}
        />
      )}
    </Modal>
  );
}

// ── Customer History ──────────────────────────────────────

function CustomerHistoryModal({ customer, sales, repairs, layaways, unlocks, specialOrders, returns, appointments, certificates, onClose, onEdit, onAddNote, settings, moneyCollections }: {
  customer: Customer;
  sales: Sale[];
  repairs: any[];
  layaways: any[];
  unlocks: any[];
  specialOrders: any[];
  returns: any[];
  appointments: any[];
  certificates?: any[];
  onClose: () => void;
  /** CUSTOMER-360-HEADER-V1: optional — opens the existing edit modal (parent handler reuse). */
  onEdit?: () => void;
  /** LAN-OPERATION-FORWARDING-CUSTOMER-NOTE-V1: append a note (parent decides local vs forward). */
  onAddNote?: (text: string) => void;
  settings: any;
  /** I2B-0: global store-scoped collections for the canonical money profile. */
  moneyCollections: {
    sales: Sale[]; repairs: any[]; unlocks: any[]; layaways: any[];
    specialOrders: any[]; customerReturns: any[]; inventory: any[];
  };
}) {
  const { t } = useTranslation();
  // LAN-OPERATION-FORWARDING-CUSTOMER-NOTE-V1: quick note-add input state.
  const [noteDraft, setNoteDraft] = useState('');
  const submitNote = () => {
    const v = noteDraft.trim();
    if (!v || !onAddNote) return;
    onAddNote(v);
    setNoteDraft('');
  };
  // R-FINANCIAL-PRIVACY-V2: gate profit + margin stat tiles inside this modal.
  const { state: { isAdminMode: _hxAdminMode, currentEmployee: _hxCurrentEmp } } = useApp();
  const canSeeOwnerFinancials = canViewOwnerFinancials(
    settings,
    _hxAdminMode || _hxCurrentEmp?.role === 'owner',
  );
  // CELLHUB-INTELLIGENCE-I2B-0: the customer's money truth comes from the
  // canonical service via computeCustomerMoneyProfile (attribution + field
  // mapping only — commission precedence, refund/exchange reversal, tax
  // exclusion and negative days are all owned by computeReportMoneyStats).
  // Replaces the legacy adjustSalesItemCosts + computeCustomerProfit pair,
  // whose tax-inclusive denominator produced Jenny's misleading 9.0% margin
  // and "94% cost data" warning for fully-configured carrier commissions.
  const profile = useMemo(
    () => computeCustomerMoneyProfile({
      customer,
      ...moneyCollections,
      settings: settings || {},
    }),
    [customer, moneyCollections, settings],
  );
  const totalCollected = profile.totalCollectedCents;

  // I2B-0.1: the 7-domain aggregate is CUSTOMER ACTIVITY ("Interactions"),
  // not financial transactions — appointments and returns are not sales.
  // Financial Transactions + Avg Ticket both come from the canonical
  // profile (same population as Total Collected), so they reconcile:
  // collected ≈ avgTicket × transactions (Jenny: $482.93 = $68.99 × 7).
  const totalInteractions = sales.length + repairs.length + layaways.length +
    unlocks.length + specialOrders.length + returns.length + appointments.length;

  // Category display label — titlecase key (e.g. "accessory" → "Accessory")
  const categoryLabel = profile.topCategoryByProfit
    ? profile.topCategoryByProfit.charAt(0).toUpperCase() + profile.topCategoryByProfit.slice(1)
    : '—';

  const Badge = ({ status }: { status: string }) => {
    const cls = ['complete','completed','ready','picked_up'].includes((status||'').toLowerCase())
      ? 'badge-success'
      : ['cancelled','cancelled'].includes((status||'').toLowerCase())
        ? 'badge-danger'
        : 'badge-info';
    return <span className={`badge ${cls}`}>{status}</span>;
  };

  const Row = ({ left, right, sub }: { left: string; right: string; sub?: string }) => (
    <div className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm">
      <div>
        <span className="text-slate-300">{left}</span>
        {sub && <span className="text-slate-500 ml-2 text-xs">{sub}</span>}
      </div>
      <span className="text-emerald-400 font-medium shrink-0 ml-2">{right}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`📋 ${customer.name}`} size="max-w-2xl">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

        {/* CUSTOMER-360-HEADER-V1: compact identity snapshot — customer card +
            quick facts. Every value comes from props already passed to this
            modal (customer fields + the pre-sorted sales array); no new
            aggregation, no new queries. Lifetime spend intentionally NOT
            repeated here — it's the Revenue tile directly below. */}
        <div className="rounded-lg bg-white/5 p-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <div className="min-w-0 mr-auto">
              <p className="text-base font-bold text-white truncate">{customer.name}</p>
              <p className="text-sm text-slate-400">{customer.phone || '—'}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500">{t('carrier')}</p>
              <p className="text-sm font-semibold text-white">{customer.carrier || '—'}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500">{t('monthlyPaymentLabel')}</p>
              {/* R-CUSTOMER-LINE-PAYMENTS-V1: exact per-line sum; legacy counted once as fallback, never both. */}
              <p className="text-sm font-semibold text-white">{(() => { const cents = getMonthlyTotalCents(customer); return cents != null ? `$${centsToDollarsString(cents)}` : '—'; })()}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-500">{t('customers.history.lastVisit')}</p>
              <p className="text-sm font-semibold text-white">{sales[0]?.createdAt ? formatDate(sales[0].createdAt as string) : '—'}</p>
            </div>
            {onEdit && (
              <button onClick={onEdit} className="btn btn-sm btn-secondary shrink-0" title={t('customers.form.editCustomer')}>
                ✏️ {t('customers.titleEdit')}
              </button>
            )}
          </div>
          {customer.notes && (
            <p className="mt-2 text-xs text-slate-400 whitespace-pre-line" title={customer.notes}>
              📝 {customer.notes}
            </p>
          )}
          {/* LAN-OPERATION-FORWARDING-CUSTOMER-NOTE-V1: quick add-note row.
              On a Secondary the parent forwards this to the Primary. */}
          {onAddNote && (
            <div className="mt-2 flex items-center gap-2">
              <input
                className="input flex-1 text-xs"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNote(); } }}
                placeholder={t('lan.note.placeholder')}
                maxLength={1000}
                aria-label={t('lan.note.label')}
              />
              <button
                className="btn btn-sm btn-secondary shrink-0"
                onClick={submitNote}
                disabled={!noteDraft.trim()}
                style={!noteDraft.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              >
                📝 {t('lan.note.addBtn')}
              </button>
            </div>
          )}
        </div>

        {/* Summary stats — primary row.
            R-FINANCIAL-PRIVACY-V2: profit + margin tiles are owner-only.
            Revenue + store credit remain visible. Grid drops to 2 cols when
            both owner-only tiles are hidden so the layout doesn't collapse. */}
        <div className={`grid ${canSeeOwnerFinancials ? 'grid-cols-4' : 'grid-cols-2'} gap-2`}>
          {/* I2B-0: Total Collected = everything paid (merchandise + taxes +
              pass-through). Tooltip surfaces returns and the commissionable
              base so collected vs profit-bearing is never ambiguous. */}
          <div
            className="rounded-lg bg-white/5 p-3 text-center"
            title={t('customers.history.collectedTitle',
              formatCurrency(profile.profitBearingRevenueCents),
              formatCurrency(Math.abs(profile.returnsCents)))}
          >
            <p className="text-xs text-slate-400">{t('customers.history.totalCollected')}</p>
            <p className="text-lg font-bold text-emerald-400">{formatCurrency(totalCollected)}</p>
            {/* I2B-0.1 Part E: gross collected ≠ retained. When returns/refunds
                exist, show the canonical net (no math in the component); the
                tooltip already itemizes the returns amount. No returns → no
                visual noise. */}
            {profile.returnsCents !== 0 && (
              <p className="text-[10px] text-amber-400/90">
                {t('customers.history.netAfterReturns', formatCurrency(profile.netAfterReturnsCents))}
              </p>
            )}
          </div>
          {canSeeOwnerFinancials && (
            <div
              className="rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/30 p-3 text-center"
              title={profile.profitEstimated ? t('customers.history.profitEstimatedTitle', profile.estimatedPercent) : undefined}
            >
              <p className="text-xs text-emerald-300">
                {t('customers.history.profit')}
                {(profile.profitEstimated || profile.unavailablePercent > 0) && <span className="ml-1 text-amber-400">*</span>}
              </p>
              <p className="text-lg font-bold text-emerald-300">{formatCurrency(profile.profitCents)}</p>
            </div>
          )}
          {canSeeOwnerFinancials && (
            <div
              className="rounded-lg bg-white/5 p-3 text-center"
              // I2B-0: margin = profit ÷ COMMISSIONABLE (pre-tax) revenue —
              // taxes/pass-through never lower the stated rate. The tooltip
              // names the denominator explicitly (Jenny: 10.0% of $455.00,
              // not 9.0% of $482.93).
              title={t('customers.history.marginTitle', formatCurrency(profile.profitBearingRevenueCents))}
            >
              <p className="text-xs text-slate-400">{t('customers.history.margin')}</p>
              <p className="text-lg font-bold text-white">
                {profile.marginMeaningful ? `${profile.marginPercent.toFixed(1)}%` : '—'}
              </p>
              <p className="text-[10px] text-slate-500 truncate">
                {t('customers.history.marginBasis', formatCurrency(profile.profitBearingRevenueCents))}
              </p>
            </div>
          )}
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-xs text-slate-400">{t('customers.history.credit')}</p>
            <p className="text-lg font-bold text-blue-400">{formatCurrency(customer.storeCredit || 0)}</p>
          </div>
        </div>

        {/* Summary stats — analytics row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-xs text-slate-400">{t('customers.history.avgTicket')}</p>
            <p className="text-lg font-bold text-white">{formatCurrency(profile.averageTicketCents)}</p>
          </div>
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-xs text-slate-400">{t('customers.history.returnsEvery')}</p>
            <p className="text-lg font-bold text-white">
              {profile.avgDaysBetweenVisits !== null ? `${profile.avgDaysBetweenVisits}d` : '—'}
            </p>
          </div>
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-xs text-slate-400">{t('customers.history.topCategory')}</p>
            <p className="text-lg font-bold text-white truncate" title={categoryLabel}>{categoryLabel}</p>
          </div>
          <div className="rounded-lg bg-white/5 p-3 text-center">
            <p className="text-xs text-slate-400">{t('customers.history.transactions')}</p>
            {/* I2B-0.1: FINANCIAL transactions (canonical — same denominator
                as Avg Ticket). The 7-domain activity count is shown
                separately below as "interactions", never used for money. */}
            <p className="text-lg font-bold text-white">{profile.transactionCount}</p>
            <p className="text-[10px] text-slate-500">
              {t('customers.history.interactions', totalInteractions)}
            </p>
          </div>
        </div>

        {/* I2B-0 coverage semantics: a configured/stamped carrier commission
            IS an exact economic basis — never "missing cost data". Warn only
            about genuinely ESTIMATED or UNAVAILABLE portions; 100% exact →
            no warning at all. (R-FINANCIAL-PRIVACY-V2: owner-only, matching
            the profit tile.) */}
        {canSeeOwnerFinancials && profile.visitCount > 0 && profile.estimatedPercent > 0 && (
          <div className="text-xs text-amber-400/80 text-center -mt-2">
            {t('customers.history.coverageEstimated', profile.estimatedPercent)}
          </div>
        )}
        {canSeeOwnerFinancials && profile.visitCount > 0 && profile.unavailablePercent > 0 && (
          <div className="text-xs text-amber-400/80 text-center -mt-2">
            {t('customers.history.coverageUnavailable', profile.unavailablePercent)}
          </div>
        )}

        {/* 🎫 Store Credit Certificates (R-STORE-CREDIT-REDEMPTION-SYSTEM) */}
        {certificates && certificates.length > 0 && (
          <Section title={`🎫 ${t('storeCredit.profile.title')}`} count={certificates.length}>
            <div className="flex flex-col gap-2">
              {certificates.map((c: any) => (
                <div key={c.id} className="rounded-lg bg-white/5 p-2.5 text-sm">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-sky-300 font-semibold">{c.certificateNumber}</span>
                      <span className={`badge ${c.status === 'active' ? 'badge-success' : c.status === 'voided' ? 'badge-danger' : 'badge-neutral'}`}>
                        {c.status}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">{formatDate(c.issuedAt)}</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-slate-500">{t('storeCredit.fields.issued')}</div>
                      <div className="text-slate-200 font-semibold">{formatCurrency(c.issuedAmount)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{t('storeCredit.fields.redeemed')}</div>
                      <div className="text-slate-200 font-semibold">{formatCurrency(c.redeemedAmount)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">{t('storeCredit.fields.remaining')}</div>
                      <div className="text-emerald-400 font-bold">{formatCurrency(c.remainingAmount)}</div>
                    </div>
                  </div>
                  {Array.isArray(c.redemptions) && c.redemptions.length > 0 && (
                    <details className="mt-1.5">
                      <summary className="text-xs text-slate-400 cursor-pointer">
                        {t('storeCredit.profile.redemptionsLabel', c.redemptions.length)}
                      </summary>
                      <div className="mt-1 flex flex-col gap-1">
                        {c.redemptions.map((r: any) => (
                          <div key={r.id} className="flex justify-between text-xs text-slate-400">
                            <span>{r.invoiceNumber || r.saleId?.slice(-6) || '—'} · {formatDate(r.redeemedAt)}</span>
                            <span className="text-emerald-400">-{formatCurrency(r.redeemedAmount)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 💰 Sales */}
        <Section title={`💰 ${t('customers.history.sales')}`} count={sales.length}>
          {sales.length === 0
            ? <Empty />
            : sales.slice(0, 20).map((s) => (
                <div key={s.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-brand-400 font-mono">{s.invoiceNumber}</span>
                    <span className="text-slate-500 ml-2">{formatDate(s.createdAt)}</span>
                    <span className="text-slate-400 ml-2">{s.items?.length || 0} {t('customers.history.salesItems')}</span>
                  </div>
                  <span className="text-emerald-400 font-medium shrink-0">{formatCurrency(s.total)}</span>
                </div>
              ))
          }
        </Section>

        {/* 🔧 Repairs */}
        <Section title={`🔧 ${t('customers.history.repairs')}`} count={repairs.length}>
          {repairs.length === 0
            ? <Empty />
            : repairs.slice(0, 10).map((r) => (
                <div key={r.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    {r.ticketNumber && <span className="text-brand-400 font-mono text-xs mr-2">{r.ticketNumber}</span>}
                    <span className="text-slate-300">{r.device || `${r.brand || ''} ${r.model || ''}`.trim()}</span>
                    {r.issue && <span className="text-slate-500 ml-2 text-xs truncate">{r.issue}</span>}
                    <div className="text-xs text-slate-600">{formatDate(r.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(r.balance || 0) > 0 && <span className="text-amber-400 text-xs">{formatCurrency(r.balance)}</span>}
                    <Badge status={r.status} />
                    <button
                      onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('cellhub:open-repair', { detail: { repairId: r.id } })); }}
                      className="text-xs px-1.5 py-0.5 rounded border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition"
                      title={t('customers.history.open')}
                    >↗</button>
                  </div>
                </div>
              ))
          }
        </Section>

        {/* 📦 Layaways */}
        <Section title={`🏷️ ${t('customers.history.layaways')}`} count={layaways.length}>
          {layaways.length === 0
            ? <Empty />
            : layaways.slice(0, 10).map((l) => (
                <div key={l.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    {l.ticketNumber && <span className="text-brand-400 font-mono text-xs mr-2">{l.ticketNumber}</span>}
                    <span className="text-slate-300">{l.itemDescription || l.items?.[0]?.name || '—'}</span>
                    <div className="text-xs text-slate-600">{formatDate(l.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(l.balance || 0) > 0 && <span className="text-amber-400 text-xs">{formatCurrency(l.balance)}</span>}
                    <Badge status={l.status} />
                    <button
                      onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('cellhub:open-layaway', { detail: { layawayId: l.id } })); }}
                      className="text-xs px-1.5 py-0.5 rounded border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition"
                      title={t('customers.history.open')}
                    >↗</button>
                  </div>
                </div>
              ))
          }
        </Section>

        {/* 🔓 Unlocks */}
        <Section title={`🔓 ${t('customers.history.unlocks')}`} count={unlocks.length}>
          {unlocks.length === 0
            ? <Empty />
            : unlocks.slice(0, 10).map((u) => (
                <div key={u.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300">{u.device}</span>
                    <span className="text-slate-500 ml-2 text-xs">{u.carrier}</span>
                    {u.imei && <span className="text-slate-600 ml-2 text-xs font-mono">{u.imei}</span>}
                    <div className="text-xs text-slate-600">{formatDate(u.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-slate-300 text-xs">{formatCurrency(u.price || 0)}</span>
                    <Badge status={u.status} />
                    <button
                      onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('cellhub:open-unlock', { detail: { unlockId: u.id } })); }}
                      className="text-xs px-1.5 py-0.5 rounded border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition"
                      title={t('customers.history.open')}
                    >↗</button>
                  </div>
                </div>
              ))
          }
        </Section>

        {/* 🛍️ Special Orders */}
        <Section title={`🛍️ ${t('customers.history.specialOrders')}`} count={specialOrders.length}>
          {specialOrders.length === 0
            ? <Empty />
            : specialOrders.slice(0, 10).map((o) => (
                <div key={o.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300">{o.itemDescription}</span>
                    {o.supplier && <span className="text-slate-500 ml-2 text-xs">{o.supplier}</span>}
                    <div className="text-xs text-slate-600">{formatDate(o.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(o.balance || 0) > 0 && <span className="text-amber-400 text-xs">{formatCurrency(o.balance)}</span>}
                    <Badge status={o.status} />
                    <button
                      onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('cellhub:open-special-order', { detail: { orderId: o.id } })); }}
                      className="text-xs px-1.5 py-0.5 rounded border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition"
                      title={t('customers.history.open')}
                    >↗</button>
                  </div>
                </div>
              ))
          }
        </Section>

        {/* 🔄 Returns */}
        {returns.length > 0 && (
          <Section title={`🔄 ${t('customers.history.returns')}`} count={returns.length}>
            {returns.slice(0, 10).map((r: any) => {
              // Returns in localStorage are in dollars; formatCurrency expects cents.
              // Round 18 fix: real field is `r.total` not `r.refundAmount`. Label uses
              // first item name if present, fallback to reason then generic label.
              const refundCents = Math.round((r.total || 0) * 100);
              const label = (Array.isArray(r.items) && r.items[0] && r.items[0].name)
                || r.reason
                || t('customers.history.returnLabel');
              return (
                <Row
                  key={r.id}
                  left={label}
                  right={formatCurrency(refundCents)}
                  sub={formatDate(r.createdAt)}
                />
              );
            })}
          </Section>
        )}

        {/* 📅 Appointments */}
        {appointments.length > 0 && (
          <Section title={`📅 ${t('customers.history.appointments')}`} count={appointments.length}>
            {appointments.slice(0, 10).map((a: any) => (
              <div key={a.id} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white/5 text-sm gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-slate-300">{a.title || a.service || t('customers.history.appointment')}</span>
                  <div className="text-xs text-slate-600">
                    {a.date || formatDate(a.scheduledAt || a.createdAt)}
                    {a.time && ` · ${a.time}`}
                  </div>
                </div>
                {a.status && <Badge status={a.status} />}
              </div>
            ))}
          </Section>
        )}
      </div>
    </Modal>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-2">{title} <span className="text-slate-500 font-normal">({count})</span></h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Empty() {
  const { t } = useTranslation();
  return <p className="text-sm text-slate-600 px-3">{t('customers.history.noRecords')}</p>;
}

export { CustomerFormModal };
export type { CustomerFormModalProps };
