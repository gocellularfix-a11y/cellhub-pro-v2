// ============================================================
// CellHub Pro — Phone Payment Modal
//
// FLOW:
//   1. Search / select customer
//   2. If customer has prior phone payment lines → show them
//      as pre-populated rows the cashier can select & fill amount
//   3. Still supports manual entry (no customer / new number)
//   4. Family Plan / Multi-Line: multiple lines in one transaction
//
// BUGS FIXED (2025-04):
//   1. handlePortal duplicated cart-add logic → buildCartItems()
//   2. Multi-line Add to Cart disabled check was always enabled → canAddToCart
//   3. CC fee missing from handlePortal multi-line branch → unified
//   4. reset() stale closure in deps → cleaned up
//   5. CC fee applied once per transaction (not per line)
//
// FEATURE (2025-04):
//   6. Customers with multiple known lines (from past phone_payment sales)
//      now see those numbers pre-loaded. Cashier checks which lines to pay,
//      fills amounts, adds all to cart in one click.
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Modal } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
// R-OFFLINE-MODE-GUARD-V1: carrier-portal opens require internet — guard them
// so an offline cashier gets a warning instead of a dead tab. POS/cart flow is
// unaffected (only the external open is gated).
import { openExternalIfOnline } from '@/hooks/useOnlineStatus';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import { loadLocal, saveLocal } from '@/services/storage';
import { formatCurrency } from '@/utils/currency';
import { canViewOwnerFinancials } from '@/utils/financialPrivacy';
import { normalizeCarrier, normalizePhone, formatPhone } from '@/utils/normalize';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { generateId } from '@/utils/dates';
import { persist } from '@/services/persist';
import { CustomerFormModal } from '@/modules/customers/CustomerModule';
import { startWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityStore';
import { getActivePortals, getDefaultPortalId, type PaymentPortal } from '@/config/paymentPortals';
import { buildCustomerTimeline } from '@/services/intelligence/customerTimeline/customerTimelineEngine';
import type { CartItem, StoreSettings, Customer, Sale, InventoryItem } from '@/store/types';
import type { PhonePaymentLine } from './types';

// Shared sanitization for phoneNumber — used in onChange, validation,
// and CartItem construction. Defense in depth: trust nothing that
// comes from state or input, always re-sanitize at boundaries.
// Round R-PHONE-INPUT-VALIDATION: fixes 'AT&T -' truncated receipt bug
// caused by normalizePhone silently returning '' for letter-only input.
const sanitizePhone = (raw: unknown): string =>
  String(raw || '').replace(/\D/g, '').slice(0, 10);

// Validation helper — 10-digit enforcement. Reusable across
// buildCartItems (Boundary 1) and customer save (Boundary 2).
// Single source of truth for "what counts as a valid phone" —
// if the rule changes (e.g. disallow leading 0/1), update here.
// Round R-PHONE-INPUT-VALIDATION-v2.
const isValidPhone = (v: unknown): boolean =>
  sanitizePhone(v).length === 10;

// ── Carrier brand colors ──────────────────────────────────
const CARRIER_COLORS: Record<string, string> = {
  'AT&T': '#00A8E0',
  'T-Mobile': '#E20074',
  'Verizon': '#CD040B',
  'Simple Mobile': '#5BC236',
  'H2O': '#0066CC',
  'Page Plus': '#F7A800',
  'Cricket': '#6CC24A',
  'Ultra Mobile': '#7B2D8B',
  'Tracfone': '#E87722',
};

interface Props {
  open: boolean;
  onClose: () => void;
  settings: StoreSettings;
  cart: CartItem[];
  setCart: (cart: CartItem[]) => void;
  customers: Customer[];
  setCustomers: (c: Customer[]) => void;
  sales: Sale[];          // needed to derive known phone lines per customer
  lang: string;
  L: Record<string, any>;
  // R-PHONE-PAYMENT-CUSTOMER-PROPAGATION: propagate the picked customer
  // up to POSModule so Sale.customerId / loyalty / store credit / purchase
  // history all work for phone payments. Mirror of TopUpModal's r28b-fix.
  setSelectedCustomer: (c: Customer | null) => void;
}

export default function PhonePaymentModal({
  open, onClose, settings, cart, setCart, customers, setCustomers, sales, lang, L,
  setSelectedCustomer: propagateSelectedCustomer,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();

  // ── Tab ───────────────────────────────────────────────────
  const [modalTab, setModalTab] = useState<'payment' | 'activation'>('payment');

  // ── Activation state ──────────────────────────────────────
  const [actCarrier, setActCarrier] = useState('');
  const [actPhone, setActPhone] = useState('');
  const [actPlan, setActPlan] = useState('');
  const [actPlanPrice, setActPlanPrice] = useState('');  // first month plan charge to customer
  const [actAmount, setActAmount] = useState('');         // activation/SIM/setup fee
  const [actNotes, setActNotes] = useState('');
  // R-SIM-INTAKE: spiff is now opt-in via the useSpiff toggle (default OFF).
  // The auto-populate effect below was removed — carriers change spiff rates
  // frequently, so the cashier enters the value manually each transaction.
  const [actSpiff, setActSpiff] = useState('0');
  const [useSpiff, setUseSpiff] = useState(false);
  // R-SIM-INTAKE: SIM Card picker state — selected SIM gets stamped on a
  // dedicated cart item with category='sim' and inventoryId so the existing
  // POSModule decrement loop handles qty automatically at checkout.
  const [selectedSim, setSelectedSim] = useState<InventoryItem | null>(null);
  const [simSearch, setSimSearch] = useState('');
  // R-SIM-ACTIVATION: carrier filter buttons above the search input. 'All'
  // shows every SIM; otherwise narrow by carrier (matches `(i as any).carrier`
  // OR `i.brand`, matching the SimManagerModal storage convention).
  const [simCarrierFilter, setSimCarrierFilter] = useState<string>('All');
  // R-SIM-ACTIVATION: editable SIM name in the selected pill. Initialized
  // from `selectedSim.name` on pick; flushed to the cart-line item name on
  // Add to Cart so the cashier can rename ad-hoc per transaction (e.g. note
  // a custom plan in the receipt) without mutating the inventory record.
  const [simNameOverride, setSimNameOverride] = useState('');
  const [editingSimName, setEditingSimName] = useState(false);
  // R-SIM-ACTIVATION-EDITABLE-PRICE-V1: editable SIM price in the selected
  // pill (dollars string). Initialized from `selectedSim.price` on pick;
  // flushed to the cart-line price on Add to Cart so the cashier can adjust
  // the charge ad-hoc per transaction WITHOUT mutating the inventory record.
  // Empty / invalid input falls back to the inventory price (never $0 by
  // accident). Mirrors the simNameOverride pattern exactly.
  const [simPriceOverride, setSimPriceOverride] = useState('');
  const [editingSimPrice, setEditingSimPrice] = useState(false);

  // ── R-OPERATOR-LIVE-BUBBLE-OVERLAY-V2 + OUTCOME-AWARE-V1 emitter.
  // The Operator bubble lives outside this module. We dispatch a
  // CustomEvent on `window` so it can wake without coupling. Payload
  // is IDs / phone digits / numeric values only — never names, notes,
  // or anything beyond what the bubble can recompute from app state.
  //
  // setTimeout(0) defers the dispatch past the current React commit
  // cycle so that any preceding setState() (customers / cart / sales)
  // has flushed through the reducer AND the bubble's inputsRef.current
  // sync effect before the bridge listener runs. Without this defer,
  // outcome events that lookup just-saved entities (e.g. customer_created)
  // race the listener and find stale state.
  const emitOperatorActivity = useCallback((
    type: 'phone.payment.customer_selected'
        | 'phone.payment.known_line_selected'
        | 'phone.payment.number_entered'
        | 'phone.payment.customer_created'
        | 'phone.payment.customer_updated'
        | 'phone.payment.payment_recorded'
        | 'phone.payment.number_linked_to_customer',
    payload: { customerId?: string; phone?: string; lineCount?: number; amountCents?: number },
  ) => {
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
          detail: { type, payload },
        }));
      } catch { /* environments without CustomEvent support — silent */ }
    }, 0);
  }, []);

  // ── Customer search ───────────────────────────────────────
  const [custSearch, setCustSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustDropdown, setShowCustDropdown] = useState(false);

  // ── Form fields ───────────────────────────────────────────
  const [carrier, setCarrier] = useState('');
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  // R-PHONE-AUTOCOPY-ALL-SOURCES-V1: same-session dedupe so a phone driven
  // through multiple state paths (pending customer prefill → user toggles
  // family-plan → re-selects same customer) doesn't trigger multiple writes
  // to the OS clipboard. Cleared by reset() so a fresh modal session can
  // re-copy the same phone (clipboard may have been overwritten meanwhile).
  const lastCopiedPhoneRef = useRef<string | null>(null);
  // Auto-copy phone to clipboard when a valid 10-digit number is set
  // (from manual entry, customer selection, or known line toggle).
  // Strict 10-digit check — isValidPhone() accepts empty as valid, which
  // would otherwise cause empty-clipboard writes when the effect below
  // fires on reset/clear.
  const autoCopyPhone = useCallback((raw: string) => {
    const digits = sanitizePhone(raw);
    if (digits.length !== 10) return;
    if (lastCopiedPhoneRef.current === digits) return;
    const onSuccess = () => {
      lastCopiedPhoneRef.current = digits;
      setCopiedPhone(digits);
      setTimeout(() => setCopiedPhone(null), 2000);
    };
    // R-PHONE-AUTOCOPY-ALL-SOURCES-V2: navigator.clipboard.writeText
    // requires an active user gesture in Chromium/Electron, so it
    // silently fails when called from prefill useEffects (pending
    // customer, intelligence/barcode action, customer select). Fall
    // back to the legacy textarea+execCommand path which has no user-
    // gesture requirement and is still supported in Electron 31.
    const fallbackCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = digits;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        const prevActive = document.activeElement as HTMLElement | null;
        ta.select();
        ta.setSelectionRange(0, digits.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
        if (ok) onSuccess();
      } catch { /* ignore — clipboard genuinely unavailable */ }
    };
    try {
      const p = navigator.clipboard?.writeText(digits);
      if (p && typeof p.then === 'function') {
        p.then(onSuccess).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    } catch {
      fallbackCopy();
    }
  }, []);
  // R-PHONE-AUTOCOPY-ALL-SOURCES-V1: state-driven trigger. Every path that
  // updates phoneNumber (pending customer prefill, intelligence/barcode
  // action, handleSelectCustomer, customer save, multi→single switch,
  // manual onChange) flows through this single effect, so autocopy fires
  // exactly once per phone per session regardless of source.
  useEffect(() => {
    const digits = sanitizePhone(phoneNumber);
    if (digits.length === 0) {
      // Cleared field — drop the dedupe sentinel so a future re-set of the
      // same phone (e.g. operator cleared and re-picked the same customer)
      // will autocopy again.
      lastCopiedPhoneRef.current = null;
      return;
    }
    autoCopyPhone(phoneNumber);
  }, [phoneNumber, autoCopyPhone]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [portal, setPortal] = useState('');
  const [amount, setAmount] = useState('');
  // CC fee state removed — Cart.tsx is the single source of truth
  // (3% on subtotal via its own toggle)

  // ── Stale-closure guards: ref-mirrors of customers/cart props so back-to-back
  // updates within handleSaveCustomer/handleAddToCart don't pisar concurrent writes
  // from other modules (POS sale, loyalty, scanner edits) during the modal session.
  const customersRef = useRef(customers);
  const cartRef = useRef(cart);
  // R-PHONE-AUTOFILL: ref-mirror of sales for the typed-phone lookup. Same
  // pattern as customersRef/cartRef so the debounced callback always sees
  // fresh sales (the prop array gets a new identity on every Firestore push).
  const salesRef = useRef(sales);
  useEffect(() => { salesRef.current = sales; }, [sales]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { cartRef.current = cart; }, [cart]);

  // ── Active payment portals (from settings, fallback to defaults) ──
  const PORTALS = useMemo<PaymentPortal[]>(() => getActivePortals(settings), [settings]);

  // Auto-highlight the portal that matches the selected carrier
  useEffect(() => {
    if (!carrier) return;
    const defaultPortal = getDefaultPortalId(carrier, PORTALS, settings.carrierPortalUrls || {});
    if (defaultPortal) setPortal(defaultPortal);
  }, [carrier, PORTALS, settings.carrierPortalUrls]);

  // R-SIM-INTAKE: auto-populate of spiff was removed. Spiff is now opt-in via
  // the useSpiff toggle (default OFF) and entered manually by the cashier.
  // Reason: carriers change spiff rates often enough that an outdated default
  // pulled from settings.carrierSpiffs caused incorrect spiff stamping. Manual
  // entry keeps each transaction honest. The carrierSpiffs setting is no
  // longer read here; legacy persistence to localStorage.activation_spiffs
  // (Tax Reports source) still happens in handleAddActivation when useSpiff=true.

  // ── Multi-line rows ───────────────────────────────────────
  const [lines, setLines] = useState<PhonePaymentLine[]>([
    { id: generateId(), number: '', amount: '', carrier: '' },
  ]);

  // R-PHONE-MULTILINE-AUTOFILL-v3 Bug A:
  // "+ Agregar número nuevo" expander needs its OWN state — sharing
  // phoneNumber caused the customer's primary phone to appear pre-filled
  // when a customer was selected (since applyCustomerSelection writes
  // customer.phone into phoneNumber). Independent state = always starts
  // empty when expander is opened.
  const [newLinePhone, setNewLinePhone] = useState('');
  const [newLineAmount, setNewLineAmount] = useState('');

  // ── Customer form modal (add/edit from within phone payment) ─
  const [showCustomerForm, setShowCustomerForm] = useState(false);

  // ── Consume pending customer from scanner ─────────────────
  // When a customer credential (GC-xxxx barcode) is scanned, AppShell
  // dispatches SET_PENDING_PHONE_PAYMENT_CUSTOMER and navigates to POS,
  // which auto-opens this modal. We detect the pending ID here and
  // autofill everything from the customer record.
  const { state: appState, dispatch: appDispatch } = useApp();
  const { pendingPhonePaymentCustomerId, inventory, repairs: appRepairs, layaways: appLayaways, storeCreditLedger: appLedger } = appState;
  // R-FINANCIAL-PRIVACY-PHONE-PAYMENT-LEAK: gate the commission preview card
  // below ("💰 Your Commission" + carrier rate + per-line breakdown). Owner-
  // only financial data — must hide entirely for non-owner employees. Math,
  // totals, and the cart write path are untouched.
  const canSeeOwnerFinancials = canViewOwnerFinancials(
    settings,
    appState.isAdminMode || appState.currentEmployee?.role === 'owner',
  );
  // R-SIM-INTAKE: anti-stale-closure ref for inventory — back-to-back
  // activations (same modal session) should see post-decrement qty so the
  // SIM picker doesn't show items that were already sold this session.
  const inventoryRef = useRef(inventory);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  useEffect(() => {
    if (!open || !pendingPhonePaymentCustomerId) return;
    const match = customers.find((c) => c.id === pendingPhonePaymentCustomerId);
    if (!match) {
      appDispatch({ type: 'SET_PENDING_PHONE_PAYMENT_CUSTOMER', payload: '' });
      return;
    }
    // Autofill from customer record
    setSelectedCustomer(match);
    // R-PHONE-FAMILY-MULTICUST: searchbar stays clean so the cashier can
    // immediately search the next customer (Family Plan multi-customer flow).
    setCustSearch('');
    setFirstName(match.firstName || (match.name || '').split(' ')[0] || '');
    setLastName(match.lastName || (match.name || '').split(' ').slice(1).join(' ') || '');
    // Primary phone — v2 Boundary 3: sanitize on hydration (legacy customers
    // may have corrupt phoneNumber from pre-v1 data). Silent strip, no toast.
    const primaryPhone = match.phone || (match as any).phones?.[0] || '';
    if (primaryPhone) setPhoneNumber(sanitizePhone(primaryPhone));
    // Carrier: prefer carriers[0] aligned with primary phone, fallback to .carrier
    const carriers = (match as any).carriers;
    const primaryCarrier = Array.isArray(carriers) && carriers[0]
      ? carriers[0]
      : (match as any).carrier || '';
    if (primaryCarrier) setCarrier(primaryCarrier);
    // Typical monthly payment
    const monthly = (match as any).monthlyPayment;
    if (monthly) setAmount(String(monthly));
    // Ensure payment tab is active (not activation)
    setModalTab('payment');
    // Clear the pending so it doesn't re-trigger
    appDispatch({ type: 'SET_PENDING_PHONE_PAYMENT_CUSTOMER', payload: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingPhonePaymentCustomerId]);

  // ── Customer search results ───────────────────────────────
  const custResults = useMemo(() => {
    if (!custSearch.trim()) return [];
    return customers
      .filter((c) => matchesSearch(custSearch, c.name, c.phone, c.customerNumber))
      .slice(0, 6);
  }, [custSearch, customers]);

  // R-PHONE-PAYMENT-REMINDER-TODAY-LAST-PAYMENT-BUBBLE-ANCHOR §2:
  // Derive the most-recent EXTERNAL phone_payment record for the entered
  // phone number. Used to surface "Last payment: <date> — $<amount>" right
  // under the autofill checkmark. Returns null when no historical
  // phone_payment exists — UI uses that to show "No previous phone payment
  // found" instead of fabricating data. Real sales only — never inferred
  // from non-phone-payment purchases.
  //
  // R-PHONE-PAYMENT-BUBBLE-LAST-PAYMENT-DATE-FIX: shared compute exposed via
  // a pure local helper so the Known Lines list (per-customer recognized
  // phones, see hasKnownLines branch ~line 2403) can show the same hint
  // per row. Behaviour identical to the previous inline memo.
  const findLastPhonePaymentForNorm = useCallback((normalized: string): {
    dateMs: number;
    amountCents: number;
    carrier: string;
  } | null => {
    if (!normalized || normalized.length !== 10) return null;
    let best: { dateMs: number; amountCents: number; carrier: string } | null = null;
    for (const s of sales || []) {
      const ca = (s as any).createdAt;
      if (!ca) continue;
      let ms = 0;
      try {
        ms = new Date(typeof ca?.toDate === 'function' ? ca.toDate() : ca).getTime();
      } catch { ms = 0; }
      if (!ms) continue;
      for (const it of (s.items || [])) {
        if (it.category !== 'phone_payment') continue;
        if (normalizePhone(it.phoneNumber || '') !== normalized) continue;
        const amt = Math.max(0, (it.price || 0) * (it.qty || 1));
        if (amt <= 0) continue;
        if (!best || ms > best.dateMs) {
          best = {
            dateMs: ms,
            amountCents: amt,
            carrier: String(it.carrier || '').trim(),
          };
        }
      }
    }
    return best;
  }, [sales]);

  const lastPhonePayment = useMemo<{
    dateMs: number;
    amountCents: number;
    carrier: string;
  } | null>(() => findLastPhonePaymentForNorm(normalizePhone(phoneNumber || '')),
  [phoneNumber, findLastPhonePaymentForNorm]);

  // R-INTELLIGENCE-CUSTOMER-TIMELINE-MEMORY §5: deterministic cadence /
  // streak / late signals derived from the customer's real phone_payment
  // history. Memoized on the resolved customer + sales reference — the
  // engine's pure functions are cheap but we still avoid rescanning on
  // every keystroke. No AI, no inference outside the historical record.
  const customerTimeline = useMemo(() => {
    if (!selectedCustomer) return null;
    return buildCustomerTimeline({
      customerId: selectedCustomer.id,
      sales,
      repairs: appRepairs || [],
      layaways: appLayaways || [],
      storeCreditLedger: appLedger || [],
    });
  }, [selectedCustomer, sales, appRepairs, appLayaways, appLedger]);

  // ── Known phone lines for selected customer ───────────────
  // Derived from past phone_payment sales linked to this customer.
  // Returns unique phone numbers sorted by most-recently-used first.
  const knownLines = useMemo<string[]>(() => {
    if (!selectedCustomer) return [];
    const seen = new Map<string, number>(); // normalized → timestamp ms

    sales.forEach((sale) => {
      if (sale.customerId !== selectedCustomer.id) return;
      sale.items.forEach((item) => {
        if (item.category === 'phone_payment' && item.phoneNumber) {
          const norm = normalizePhone(item.phoneNumber);
          if (!norm) return;
          // Keep the most recent timestamp seen for this number
          const ts = sale.createdAt
            ? new Date(
                typeof (sale.createdAt as any).toDate === 'function'
                  ? (sale.createdAt as any).toDate()
                  : sale.createdAt
              ).getTime()
            : 0;
          if (!seen.has(norm) || ts > seen.get(norm)!) seen.set(norm, ts);
        }
      });
    });

    // Also always include the customer's primary phone if it's not already there
    const primaryNorm = normalizePhone(selectedCustomer.phone);
    if (primaryNorm && !seen.has(primaryNorm)) seen.set(primaryNorm, 0);

    // R-PHONE-FAMILY-MULTIPHONES: include ALL saved phones from the
    // customer.phones[] array (multi-line support field). Before, only
    // primary phone + past-sale phones were surfaced — saved alt lines
    // the customer never paid through the store were invisible.
    const allPhones = (selectedCustomer as { phones?: string[] }).phones;
    if (Array.isArray(allPhones)) {
      for (const p of allPhones) {
        const n = normalizePhone(p);
        if (n && !seen.has(n)) seen.set(n, 0);
      }
    }

    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([norm]) => norm);
  }, [selectedCustomer, sales]);

  // R-PHONE-PAYMENT-BUBBLE-LAST-PAYMENT-DATE-FIX: per-known-line last payment
  // record. Built once per (knownLines, sales) change so the Known Lines
  // render doesn't rescan sales for every row. Map<normalizedPhone, record>.
  const lastPaymentByLine = useMemo<Map<string, { dateMs: number; amountCents: number; carrier: string }>>(() => {
    const out = new Map<string, { dateMs: number; amountCents: number; carrier: string }>();
    for (const norm of knownLines) {
      const rec = findLastPhonePaymentForNorm(norm);
      if (rec) out.set(norm, rec);
    }
    return out;
  }, [knownLines, findLastPhonePaymentForNorm]);

  // ── Which known-line rows are checked (for multi-select) ─
  // key: normalized phone, value: amount string
  const [selectedKnownLines, setSelectedKnownLines] = useState<Record<string, string>>({});

  // R-PHONE-PAYMENTS-MULTILINE-RUNNER: per-line paid status for the runner.
  // key: normalized phone, value: true once the cashier has confirmed the
  // portal payment via "Mark Paid & Next". Drives the runner UI's progress
  // counter and current/next derivation. Cleared on reset() and on customer
  // change (applyCustomerSelection) — same lifecycle as selectedKnownLines.
  const [paidKnownLines, setPaidKnownLines] = useState<Record<string, boolean>>({});

  // ── Phone selector (when customer has multiple phones[]) ──
  const [phoneSelectorCustomer, setPhoneSelectorCustomer] = useState<Customer | null>(null);

  // Core customer-selection logic (used after phone is chosen or if only one)
  const applyCustomerSelection = (c: Customer, chosenPhone: string) => {
    setSelectedCustomer(c);
    // R-PHONE-FAMILY-MULTICUST: clear searchbar post-selection (the green ✓
    // badge below is the visual confirmation). Lets the user immediately
    // search for a different/next customer without manually deleting.
    setCustSearch('');
    setShowCustDropdown(false);
    const parts = c.name.trim().split(' ');
    setFirstName(c.firstName || parts[0] || '');
    setLastName(c.lastName || parts.slice(1).join(' ') || '');
    // v2 Boundary 3: sanitize on customer selection.
    const cleanPhone = sanitizePhone(chosenPhone || c.phone || '');
    setPhoneNumber(cleanPhone);
    const primaryCarrier = (c as any).carriers?.[0] || (c as any).carrier || '';
    if (primaryCarrier) setCarrier(primaryCarrier);
    const mp = (c as any).monthlyPayment;
    if (mp) setAmount(String(mp));
    setSelectedKnownLines({});
    setPaidKnownLines({});
    // R-OPERATOR-LIVE-BUBBLE-OVERLAY-V2 fix: wake the Operator bubble.
    const phonesArr = (c as { phones?: string[] }).phones;
    const lineCount = Array.isArray(phonesArr) && phonesArr.length > 0
      ? phonesArr.length
      : (c.phone ? 1 : 0);
    emitOperatorActivity('phone.payment.customer_selected', {
      customerId: c.id,
      phone: cleanPhone,
      lineCount,
    });
  };

  // ── R-PHONE-AUTOFILL: typed-phone auto-fill ──────────────────────────
  // V1 parity. When the cashier types a 10-digit phone in the Bill Payment
  // tab's single-line input, look up the number in: (1) CustomerDB, then
  // (2) sales history. Auto-fill firstName / lastName / carrier / amount.
  // Manual edits are preserved via a snapshot pattern: a field is only
  // overwritten if it is currently empty OR still equals the value set by
  // the previous lookup. This lets the cashier change the carrier and have
  // it stick, even if a later 10-digit retype would otherwise re-fill.
  const [autoFilledSnap, setAutoFilledSnap] = useState<{
    carrier: string; amount: string; firstName: string; lastName: string;
  } | null>(null);

  // Mirror current form state into a ref so lookupByPhone can stay a stable
  // useCallback (empty deps). Without this, putting carrier/amount/etc. in
  // the deps would recreate the callback every render → useEffect re-fires
  // → infinite debounce loop.
  const formStateRef = useRef({ carrier, amount, firstName, lastName, autoFilledSnap });
  useEffect(() => {
    formStateRef.current = { carrier, amount, firstName, lastName, autoFilledSnap };
  }, [carrier, amount, firstName, lastName, autoFilledSnap]);

  const lookupByPhone = useCallback((rawPhone: string) => {
    const norm = normalizePhone(rawPhone);
    if (!norm || norm.length !== 10) return;

    // Timestamp extraction reused from the knownLines memo (line ~242).
    // Handles Firestore Timestamp { toDate() } + Date + ISO string.
    const tsOf = (sale: Sale): number => {
      const ca = (sale as any).createdAt;
      if (!ca) return 0;
      try {
        return new Date(typeof ca?.toDate === 'function' ? ca.toDate() : ca).getTime();
      } catch { return 0; }
    };

    // Source 1: CustomerDB by normalized phone.
    // R-PHONE-PAYMENTS-KNOWN-LINES-AUTOFILL-FIX: also scan c.phones[] so
    // multi-line customers resolve when the cashier types ANY of their
    // saved numbers (was: primary phone only).
    const customer = customersRef.current.find((c) => {
      if (normalizePhone(c.phone || '') === norm) return true;
      const phones = (c as { phones?: string[] }).phones;
      if (Array.isArray(phones) && phones.some((p) => normalizePhone(p) === norm)) return true;
      return false;
    });

    let freshFirst = '', freshLast = '', freshCarrier = '', freshAmount = '';

    if (customer) {
      freshFirst = customer.firstName || (customer.name || '').split(' ')[0] || '';
      freshLast  = customer.lastName  || (customer.name || '').split(' ').slice(1).join(' ') || '';

      // Find this customer's most recent phone_payment for this exact number.
      const customerSales = salesRef.current
        .filter((s) =>
          s.customerId === customer.id ||
          normalizePhone(s.customerPhone || '') === norm,
        )
        .sort((a, b) => tsOf(b) - tsOf(a));
      for (const s of customerSales) {
        const item = (s.items || []).find((i) =>
          i.category === 'phone_payment'
          && normalizePhone(i.phoneNumber || '') === norm,
        );
        if (item) {
          if (item.carrier) freshCarrier = item.carrier;
          if (item.price)   freshAmount  = (item.price / 100).toFixed(2);
          break;
        }
      }
      // Fallbacks to the customer profile when no sale was found.
      if (!freshCarrier) {
        const c = customer as any;
        freshCarrier = (c.carriers?.[0] || c.carrier || '').trim();
      }
      if (!freshAmount) {
        const mp = (customer as any).monthlyPayment;
        if (mp) freshAmount = String(mp);
      }

      // R-PHONE-PAYMENTS-KNOWN-LINES-AUTOFILL-FIX: load full customer
      // context so the Known Lines panel surfaces automatically — same
      // behavior as the Customers money-icon flow. Preselect the typed
      // matching phone in the panel (only when no prior selection exists,
      // to preserve the cashier's manual checks). setSelectedCustomer
      // with the same reference is short-circuited by React, so repeated
      // typed-digit fires within the debounce window are idempotent.
      setSelectedCustomer(customer);
      setSelectedKnownLines((prev) =>
        Object.keys(prev).length === 0 ? { [norm]: freshAmount || '' } : prev,
      );
    } else {
      // Source 2: sales history (no customer record) — find latest
      // phone_payment for this number across all sales.
      type Cand = { item: any; ts: number; sale: Sale };
      const candidates: Cand[] = [];
      for (const s of salesRef.current) {
        for (const i of s.items || []) {
          if (i.category === 'phone_payment'
              && normalizePhone(i.phoneNumber || '') === norm) {
            candidates.push({ item: i, ts: tsOf(s), sale: s });
          }
        }
      }
      candidates.sort((a, b) => b.ts - a.ts);
      if (candidates.length > 0) {
        const { item, sale } = candidates[0];
        if (item.carrier) freshCarrier = item.carrier;
        if (item.price)   freshAmount  = (item.price / 100).toFixed(2);
        if (sale.customerName) {
          const parts = sale.customerName.split(/\s+/);
          freshFirst = parts[0] || '';
          freshLast  = parts.slice(1).join(' ');
        }
      }
    }

    // Nothing found → no-op so we don't pollute the form.
    if (!freshCarrier && !freshAmount && !freshFirst && !freshLast) return;

    // Snapshot-based keep-or-replace. Preserves cashier edits AND lets the
    // next 10-digit retype re-fill from a different number's history.
    const snap = formStateRef.current.autoFilledSnap;
    const kr = (cur: string, prev: string | undefined, fresh: string) =>
      fresh && (cur === '' || (prev !== undefined && cur === prev)) ? fresh : cur;
    const cur = formStateRef.current;
    const nextCarrier   = kr(cur.carrier,   snap?.carrier,   freshCarrier);
    const nextAmount    = kr(cur.amount,    snap?.amount,    freshAmount);
    const nextFirstName = kr(cur.firstName, snap?.firstName, freshFirst);
    const nextLastName  = kr(cur.lastName,  snap?.lastName,  freshLast);
    if (nextCarrier   !== cur.carrier)   setCarrier(nextCarrier);
    if (nextAmount    !== cur.amount)    setAmount(nextAmount);
    if (nextFirstName !== cur.firstName) setFirstName(nextFirstName);
    if (nextLastName  !== cur.lastName)  setLastName(nextLastName);
    setAutoFilledSnap({
      carrier: freshCarrier, amount: freshAmount,
      firstName: freshFirst, lastName: freshLast,
    });
  }, []);

  // Debounced trigger: 500ms after the cashier types the 10th digit.
  // When the field is cleared, also clear the snapshot so a future retype
  // can re-fill from scratch (D3 in the phase-1 report).
  useEffect(() => {
    if (phoneNumber.length === 0) {
      setAutoFilledSnap(null);
      return;
    }
    if (phoneNumber.length !== 10) return;
    const t = setTimeout(() => {
      lookupByPhone(phoneNumber);
      // R-OPERATOR-LIVE-BUBBLE-OVERLAY-V2 fix: wake the bubble after the
      // debounce settles. Helper resolves customer + history from app
      // state without us reading lookupByPhone's setState side-effects.
      emitOperatorActivity('phone.payment.number_entered', {
        phone: phoneNumber,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [phoneNumber, lookupByPhone, emitOperatorActivity]);

  // R-PHONE-FAMILY-MULTICUST: add a customer's line to the multi-line rows
  // without replacing the previously selected customer. Fills the first
  // empty line (number + carrier both blank) or pushes a new one.
  // The FIRST customer added in a multi-line transaction becomes
  // selectedCustomer (drives sale.customerId / loyalty attribution).
  const addCustomerLineToMulti = (c: Customer, chosenPhone: string) => {
    const cleanPhone = sanitizePhone(chosenPhone || c.phone || '');
    const primaryCarrier = (c as any).carriers?.[0] || (c as any).carrier || '';
    const monthly = (c as any).monthlyPayment;
    const amt = monthly ? String(monthly) : '';

    if (!selectedCustomer) {
      setSelectedCustomer(c);
      const parts = (c.name || '').trim().split(' ');
      setFirstName(c.firstName || parts[0] || '');
      setLastName(c.lastName || parts.slice(1).join(' ') || '');
    }

    setLines((prev) => {
      const idx = prev.findIndex((l) => !l.number.trim() && !l.carrier);
      const filled = {
        number: cleanPhone,
        amount: amt,
        carrier: primaryCarrier,
        customerId: c.id,
        customerName: c.name,
      };
      if (idx >= 0) {
        return prev.map((l, i) => (i === idx ? { ...l, ...filled } : l));
      }
      return [...prev, { id: generateId(), ...filled }];
    });

    autoCopyPhone(cleanPhone);
    setCustSearch('');
    setShowCustDropdown(false);
  };

  // ── Select a customer ─────────────────────────────────────
  const handleSelectCustomer = (c: Customer) => {
    // If customer has multiple valid phones, show the selector
    const allPhones = Array.isArray((c as any).phones) ? ((c as any).phones as string[]) : [];
    const validPhones = allPhones.map((p) => (p || '').trim()).filter(Boolean);
    const uniquePhones = Array.from(new Set(validPhones));
    if (uniquePhones.length > 1) {
      setPhoneSelectorCustomer(c);
      setShowCustDropdown(false);
      return;
    }
    // R-PHONE-FAMILY-MULTICUST: in multi-line mode, append a new line for
    // this customer instead of overwriting the previously selected one.
    const chosenPhone = uniquePhones[0] || c.phone || '';
    if (isMultiLine) {
      addCustomerLineToMulti(c, chosenPhone);
      return;
    }
    // Single-line mode — replace behavior unchanged.
    applyCustomerSelection(c, chosenPhone);
  };

  // R-PHONE-PAYMENTS-KNOWN-LINES-AUTOFILL-FIX: lookup the most recent
  // phone_payment price for this exact normalized phone number from the
  // selected customer's sales history. Mirrors the auto-fill logic in
  // lookupByPhone (L375-391). Returns formatted dollar string ("19.99")
  // or empty when no historical sale exists.
  const lookupHistoricalAmount = (norm: string): string => {
    if (!selectedCustomer) return '';
    const tsOf = (sale: Sale): number => {
      const ca = (sale as { createdAt?: unknown }).createdAt;
      if (!ca) return 0;
      try {
        const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
          ? (ca as { toDate: () => Date }).toDate()
          : (ca as string | Date);
        return new Date(d).getTime();
      } catch { return 0; }
    };
    const sorted = sales
      .filter((s) => s.customerId === selectedCustomer.id)
      .slice()
      .sort((a, b) => tsOf(b) - tsOf(a));
    for (const s of sorted) {
      const item = (s.items || []).find((i) =>
        i.category === 'phone_payment'
        && normalizePhone(i.phoneNumber || '') === norm,
      );
      if (item?.price) return (item.price / 100).toFixed(2);
    }
    return '';
  };

  // ── Toggle a known line on/off ────────────────────────────
  const toggleKnownLine = (norm: string) => {
    let didAdd = false;
    let amtStr = '';
    setSelectedKnownLines((prev) => {
      const next = { ...prev };
      if (next[norm] !== undefined) {
        delete next[norm];
      } else {
        // R-PHONE-PAYMENTS-KNOWN-LINES-AUTOFILL-FIX: prefer historical
        // amount for this exact phone number (most-recent phone_payment
        // for this customer), else fall back to the main amount input.
        // Empty string means truly no configured default — never auto-
        // fill 0 when a real amount exists in history or main input.
        amtStr = lookupHistoricalAmount(norm) || amount || '';
        next[norm] = amtStr;
        didAdd = true;
        // Auto-copy to clipboard when checking a line
        autoCopyPhone(norm);
      }
      return next;
    });
    // R-MULTILINE-PICKER-FIX: removed unconditional setIsMultiLine(true) here.
    // It dismounted the known-lines panel on every checkbox click, hiding the
    // selected phone numbers and forcing the cashier into the empty manual
    // multi-line UI. Per-line amount inputs in the panel (below) now let
    // multi-select work in place — no mode switch required.
    // R-OPERATOR-LIVE-BUBBLE-OVERLAY-V2 fix: only emit on add path.
    if (didAdd) {
      const cents = Math.round((parseFloat(amtStr) || 0) * 100);
      emitOperatorActivity('phone.payment.known_line_selected', {
        customerId: selectedCustomer?.id,
        phone: norm,
        amountCents: cents > 0 ? cents : undefined,
      });
    }
  };

  const updateKnownLineAmount = (norm: string, val: string) => {
    setSelectedKnownLines((prev) => ({ ...prev, [norm]: val }));
  };

  // ── Auto-select single known line ──────────────────────
  // When customer has exactly 1 known line, auto-check it so the user
  // doesn't have to manually click the checkbox before Add to Cart.
  useEffect(() => {
    if (knownLines.length === 1 && Object.keys(selectedKnownLines).length === 0) {
      setSelectedKnownLines({ [knownLines[0]]: amount || '' });
    }
  }, [knownLines]);

  // ── Sync main amount input → single selected known line (option C) ──
  // When the user has exactly one known line selected, the main "Payment Amount"
  // input acts as the source of truth and auto-fills that line. If they have
  // multiple lines selected, the main input is ignored and they enter per-line.
  useEffect(() => {
    const keys = Object.keys(selectedKnownLines);
    if (keys.length !== 1) return;
    const onlyKey = keys[0];
    if (selectedKnownLines[onlyKey] !== amount) {
      setSelectedKnownLines((prev) => ({ ...prev, [onlyKey]: amount }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  // ── Reset ─────────────────────────────────────────────────
  const reset = () => {
    setCustSearch(''); setSelectedCustomer(null);
    setCarrier(''); setIsMultiLine(false);
    setPhoneNumber(''); setCopiedPhone(null); setFirstName(''); setLastName('');
    setPortal(''); setAmount('');
    // CC fee removed — Cart.tsx handles it
    setLines([{ id: generateId(), number: '', amount: '', carrier: '' }]);
    setSelectedKnownLines({});
    setPaidKnownLines({});
    setNewLinePhone('');
    setNewLineAmount('');
    // R-PHONE-AUTOCOPY-ALL-SOURCES-V1: clear the dedupe sentinel so the next
    // modal session can re-copy the same phone (clipboard may be stale).
    lastCopiedPhoneRef.current = null;
  };

  const handleClose = () => { reset(); onClose(); };

  // ── Derived: valid lines to add to cart ──────────────────
  const validLines = useMemo<PhonePaymentLine[]>(() => {
    // If customer has known lines and at least one is selected+filled → use those
    if (knownLines.length > 0) {
      // R-PHONE-FAMILY-PERLINE: known-lines entries carry an empty carrier
      // for now; buildCartItems multi-line branch falls back to the global
      // `carrier` when line.carrier is empty (Phase B: per-line carrier
      // for known-lines will need its own state extension).
      const selected: PhonePaymentLine[] = Object.entries(selectedKnownLines)
        .filter(([, amt]) => parseFloat(amt) > 0)
        .map(([norm, amt]) => ({ id: norm, number: norm, amount: amt, carrier: '' }));
      if (isValidPhone(newLinePhone) && parseFloat(newLineAmount) > 0) {
        selected.push({ id: `new-${newLinePhone}`, number: sanitizePhone(newLinePhone), amount: newLineAmount, carrier: '' });
      }
      return selected;
    }
    // Otherwise fall back to the manual multi-line rows
    return lines.filter((l) => l.number.trim() && parseFloat(l.amount) > 0);
  }, [knownLines, selectedKnownLines, lines, newLinePhone, newLineAmount]);

  // ── Can add to cart? ─────────────────────────────────────
  const canAddToCart = useMemo(() => {
    if (!carrier) return false;
    if (isMultiLine || knownLines.length > 0) return validLines.length > 0;
    return phoneNumber.trim().length > 0 && parseFloat(amount) > 0;
  }, [carrier, isMultiLine, knownLines, validLines, phoneNumber, amount]);

  // ── Payment breakdown preview (Bill Payment + UUT + Mobility + CC + Commission)
  // ── Breakdown (cents-as-int, single source of truth) ─────
  // NOTE: settings.mobileSurcharge is an ABSOLUTE dollar amount per line
  // (CDTFA charges $0.41 fixed per bill), not a percentage rate.
  // settings.creditCardFee handled by Cart.tsx (3% on subtotal) — NOT here.
  const breakdown = useMemo(() => {
    const utilRate = settings.utilityUsersTax || 0.055;
    const mobilityPerLineCents = Math.round((settings.mobileSurcharge || 0.41) * 100);
    // Fix Bug #5: normalize carrier before commission lookup (consistent with buildCartItems)
    const normalizedCarrier = normalizeCarrier(carrier);
    // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain to avoid silent zero
    const globalCommRate = (settings.carrierCommissions?.[normalizedCarrier]
      ?? settings.defaultCommissionRate
      ?? 0.07);

    // R-PHONE-FAMILY-MULTILINE-TOTALS: per-line commission accumulator grouped by
    // carrier. Multi-line family plans can mix carriers (T-Mobile $70 @ 10% +
    // Verizon $50 @ 7%) and the prior global-carrier math gave $12 instead of
    // the correct $10.50. Sum per-line (Approach A) to avoid rounding drift.
    const commGroups = new Map<string, { rate: number; amountCents: number; commissionCents: number }>();
    const addLineCommission = (carrierRaw: string, amountCents: number) => {
      if (amountCents <= 0) return;
      const norm = normalizeCarrier(carrierRaw);
      // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain
      const rate = (settings.carrierCommissions?.[norm]
        ?? settings.defaultCommissionRate
        ?? 0.07);
      const lineCommissionCents = Math.round(amountCents * rate);
      const existing = commGroups.get(norm);
      if (existing) {
        existing.amountCents += amountCents;
        existing.commissionCents += lineCommissionCents;
      } else {
        commGroups.set(norm, { rate, amountCents, commissionCents: lineCommissionCents });
      }
    };

    // Subtotal: sum of all line amounts (or single amount), in CENTS
    let subtotalCents = 0;
    let lineCount = 0;
    if (isMultiLine || knownLines.length > 0) {
      for (const l of validLines) {
        const cents = Math.round((parseFloat(l.amount) || 0) * 100);
        if (cents > 0) {
          subtotalCents += cents;
          lineCount++;
          // Fall back to global `carrier` when the line left it blank (legacy
          // known-line entries) — mirrors buildCartItems multi-line logic.
          addLineCommission(l.carrier || carrier, cents);
        }
      }
    } else {
      subtotalCents = Math.round((parseFloat(amount) || 0) * 100);
      lineCount = subtotalCents > 0 ? 1 : 0;
      if (subtotalCents > 0 && carrier) {
        addLineCommission(carrier, subtotalCents);
      }
    }

    const utilityTaxCents  = Math.round(subtotalCents * utilRate);
    const mobilityTotCents = mobilityPerLineCents * lineCount;
    const totalCents       = subtotalCents + utilityTaxCents + mobilityTotCents;

    // Build ordered breakdown array + total commission from the per-carrier
    // groups. Total = sum of group totals (NOT re-derived from subtotal).
    const commissionBreakdown: Array<{
      carrier: string;
      rate: number;
      amountCents: number;
      commissionCents: number;
    }> = [];
    let commissionCents = 0;
    commGroups.forEach((g, carrierKey) => {
      if (g.commissionCents > 0) {
        commissionBreakdown.push({
          carrier: carrierKey,
          rate: g.rate,
          amountCents: g.amountCents,
          commissionCents: g.commissionCents,
        });
        commissionCents += g.commissionCents;
      }
    });

    // Dollar equivalents for display only
    return {
      subtotalCents, utilityTaxCents, mobilityTotCents, totalCents, commissionCents,
      subtotal:    subtotalCents / 100,
      utilityTax:  utilityTaxCents / 100,
      mobilityTot: mobilityTotCents / 100,
      total:       totalCents / 100,
      commission:  commissionCents / 100,
      commissionBreakdown,
      // Kept as globalCommRate for backward-compat with any consumer still
      // reading the single-carrier rate; commissionBreakdown is the new truth.
      commRate: globalCommRate,
      utilRate,
      mobility:    mobilityPerLineCents / 100,
      lineCount,
    };
  }, [carrier, isMultiLine, knownLines, validLines, amount, settings]);

  // ── Build cart items — single source of truth ─────────────
  // Each phone payment becomes its own line item.
  // Utility users tax and mobility fee are added as separate line items so they
  // actually reach the cart totals (previously displayed but never charged).
  // CC fee is intentionally NOT added here — Cart.tsx handles it via its own
  // % toggle on subtotal, source of truth for all card payments.
  const buildCartItems = useCallback((): CartItem[] => {
    const customerNote = `${firstName} ${lastName}`.trim();
    const items: CartItem[] = [];

    if (isMultiLine || knownLines.length > 0) {
      // R-PHONE-FAMILY-PERLINE: each PhonePaymentLine has its own carrier.
      // Fall back to global `carrier` only if the line left it blank
      // (e.g. legacy known-line entries that don't carry carrier yet).
      // R-PHONE-FAMILY-MULTICUST: each line may be attributed to a different
      // customer. Prefer the line's own customerName for the cart-item note so
      // a multi-customer family bundle shows the right person per line on the
      // receipt; fall back to the global note when the line wasn't sourced
      // from a specific customer (manual typed entry).
      validLines.forEach((line) => {
        const lineCarrierRaw = line.carrier || carrier;
        if (!lineCarrierRaw) return;
        const normalizedCarrier = normalizeCarrier(lineCarrierRaw);
        const phone = normalizePhone(line.number);
        const lineNote = line.customerName || customerNote;
        const priceCents = Math.round(parseFloat(line.amount) * 100);
        const commRate = (settings.carrierCommissions?.[normalizedCarrier]
          ?? settings.defaultCommissionRate
          ?? 0.07);
        items.push({
          id: generateId(),
          name: `${normalizedCarrier} - ${formatPhone(phone)}`,
          category: 'phone_payment',
          price: priceCents,
          // R-PHONEPAYMENT-COST-STAMP: stamp cost at sale time so consumers
          // (Dashboard/Reports/Tax) read profit directly via (price - cost) × qty
          // instead of re-deriving via commission lookup. Math mirrors Reports.
          cost: Math.round(priceCents * (1 - commRate)),
          qty: 1, taxable: false, cbeEligible: false,
          carrier: normalizedCarrier, phoneNumber: phone,
          // R-PHONE-FAMILY-MULTILINE-TOTALS: persist per-line rate so historical
          // reports (sum of item.price × item.commissionRate) match the preview.
          // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain (was `?? 0` —
          // silent zero corrupted reports when carrier missing from settings).
          commissionRate: commRate,
          notes: lineNote,
        });
      });
    } else {
      // Single-line mode requires the global carrier (unchanged).
      if (!carrier) return [];
      const normalizedCarrier = normalizeCarrier(carrier);
      // Round R-PHONE-INPUT-VALIDATION: validate 10-digit phone BEFORE build.
      // Prior guard `!phoneNumber.trim()` let letter-only input through
      // (e.g. "abcXYZ" truthy after trim), causing receipt to show
      // "AT&T - " with empty phoneNumber.
      // v2: refactored to use isValidPhone helper for DRY validation.
      if (!isValidPhone(phoneNumber)) {
        toast(t('phonePay.errPhoneTenDigits'), 'error');
        return [];
      }
      const digits = sanitizePhone(phoneNumber);
      if (parseFloat(amount) <= 0) return [];
      const priceCents = Math.round(parseFloat(amount) * 100);
      const commRate = (settings.carrierCommissions?.[normalizedCarrier]
        ?? settings.defaultCommissionRate
        ?? 0.07);
      items.push({
        id: generateId(),
        name: `${normalizedCarrier} - ${formatPhone(digits)}`,
        category: 'phone_payment',
        price: priceCents,
        // R-PHONEPAYMENT-COST-STAMP: stamp cost at sale time (parity w/ multi-line path).
        cost: Math.round(priceCents * (1 - commRate)),
        qty: 1, taxable: false, cbeEligible: false,
        carrier: normalizedCarrier,
        // Re-sanitize at the persist boundary (defense in depth) — never
        // trust raw state; guarantees the 10-digit phoneNumber shipped to
        // cart → sale → receipt → SMS is identical to what validation saw.
        phoneNumber: sanitizePhone(phoneNumber),
        // R-PHONE-FAMILY-MULTILINE-TOTALS: parity with multi-line path +
        // handlePortalForLine/activation — reports need this to attribute
        // commission on historical single-line sales.
        // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain (no silent zero).
        commissionRate: commRate,
        notes: customerNote,
      });
    }

    if (items.length === 0) return [];

    // Cart auto-applies utility tax + mobility surcharge for category 'phone_payment'
    // (see calculateCartTotals in types.ts). DO NOT push them as separate items here
    // or the customer gets double-charged.
    return items;
  }, [carrier, isMultiLine, knownLines, validLines, phoneNumber, amount,
      firstName, lastName, breakdown, t, toast]);

  // ── Add to Customers ─────────────────────────────────────
  // ── Open customer form (add new or edit existing) ────────
  const handleAddToCustomers = () => {
    // If a customer is already selected, edit them
    if (selectedCustomer) {
      setShowCustomerForm(true);
      return;
    }
    // Otherwise check if phone matches an existing customer → edit mode
    const phone = normalizePhone(phoneNumber);
    if (phone.length >= 7) {
      const existing = customers.find((c) => normalizePhone(c.phone) === phone);
      if (existing) {
        setSelectedCustomer(existing);
        setShowCustomerForm(true);
        return;
      }
    }
    // New customer: just open the form (it will use whatever's in firstName/lastName/phoneNumber as defaults via a stub)
    setShowCustomerForm(true);
  };

  // ── Save from customer form (create or update) ───────────
  const handleSaveCustomer = (data: Partial<Customer>) => {
    // Round R-PHONE-INPUT-VALIDATION-v2 Boundary 2: block save when the
    // phone about to be persisted is not a valid 10-digit number. The
    // CustomerFormModal UI lives in @/modules/customers (external), so
    // we validate here at the persistence boundary — data.phone is what
    // the user typed in the external form, phoneNumber is the modal's
    // own state (fallback when the form didn't supply one). Whichever
    // value would be persisted must pass isValidPhone.
    const phoneToPersist = data.phone || phoneNumber || '';
    if (!isValidPhone(phoneToPersist)) {
      toast(t('phonePay.errCustomerPhoneTenDigits'), 'error');
      return;
    }

    // Capture current amount BEFORE state updates so we can transfer it
    // to the auto-selected line. This prevents the user from losing the
    // amount they already typed in the modal before clicking "Add to Customers".
    const currentAmount = amount;

    // Determine which phone number to auto-select on the line picker.
    // Prefer the phone the cashier already typed; fall back to data.phone.
    const phoneForAutoSelect = phoneNumber || data.phone || '';
    const normForAutoSelect = phoneForAutoSelect ? normalizePhone(phoneForAutoSelect) : '';

    if (selectedCustomer) {
      // Update existing
      const updated: Customer = {
        ...selectedCustomer,
        ...data,
        updatedAt: new Date().toISOString(),
      } as Customer;
      const nextCustomers = customersRef.current.map((c) => c.id === selectedCustomer.id ? updated : c);
      customersRef.current = nextCustomers;
      setCustomers(nextCustomers);
      persist.customer(updated.id, updated as unknown as Record<string, unknown>);
      setSelectedCustomer(updated);
      // R-PHONE-FAMILY-MULTICUST: keep searchbar empty after save (consistent
      // with select-customer flow — ✓ badge is the confirmation).
      setCustSearch('');
      // Sync form fields with updated customer
      // v2 Boundary 3: sanitize (defense in depth — even though Boundary 2
      // already blocked bad phones pre-persist, preserves the invariant).
      if (data.phone) setPhoneNumber(sanitizePhone(data.phone));
      if (data.firstName !== undefined) setFirstName(data.firstName || '');
      if (data.lastName !== undefined) setLastName(data.lastName || '');
      // R-OPERATOR-ACTIVITY-OUTCOME-AWARE-V1
      const updPhones = (updated as { phones?: string[] }).phones;
      const updLineCount = Array.isArray(updPhones) && updPhones.length > 0
        ? updPhones.length
        : (updated.phone ? 1 : 0);
      emitOperatorActivity('phone.payment.customer_updated', {
        customerId: updated.id,
        phone: sanitizePhone(data.phone || updated.phone || ''),
        lineCount: updLineCount,
      });
    } else {
      // Create new
      const newCust: Customer = {
        id: generateId(),
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        name: data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown',
        phone: data.phone || phoneNumber || '',
        email: data.email || '',
        loyaltyPoints: 0,
        storeCredit: 0,
        customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-4)}`,
        notes: data.notes || '',
        communicationConsent: data.communicationConsent ?? false,
        createdAt: new Date().toISOString(),
        ...data,
      } as Customer;
      const nextCustomers = [...customersRef.current, newCust];
      customersRef.current = nextCustomers;
      setCustomers(nextCustomers);
      persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
      setSelectedCustomer(newCust);
      // R-PHONE-FAMILY-MULTICUST: keep searchbar empty after save.
      setCustSearch('');
      // v2 Boundary 3: sanitize (defense in depth).
      setPhoneNumber(sanitizePhone(newCust.phone));
      setFirstName(newCust.firstName || '');
      setLastName(newCust.lastName || '');
      // R-OPERATOR-ACTIVITY-OUTCOME-AWARE-V1
      emitOperatorActivity('phone.payment.customer_created', {
        customerId: newCust.id,
        phone: sanitizePhone(newCust.phone),
        lineCount: newCust.phone ? 1 : 0,
      });
    }

    // ── Auto-select the line that just got linked + carry the amount over ──
    // After save, the customer will have the phone in their phones[] which
    // makes hasKnownLines = true. Without this auto-selection, the user
    // would lose their amount input AND have to manually click the checkbox.
    if (normForAutoSelect) {
      setSelectedKnownLines((prev) => ({
        ...prev,
        [normForAutoSelect]: currentAmount || '',
      }));
      // Restore the amount in the main input too — option C means both visible
      // and synced. The main input stays as the source of truth for single-line.
      if (currentAmount) setAmount(currentAmount);
    }

    setShowCustomerForm(false);
  };

  // ── Open portal ───────────────────────────────────────────
  const handlePortal = useCallback(() => {
    if (!carrier) return;
    // Check that we have something to add BEFORE opening portal — otherwise
    // the cashier opens the external window and forgets to add the line.
    const newItems = buildCartItems();
    if (newItems.length === 0) return;

    const url = settings.carrierPortalUrls?.[carrier];
    if (url) {
      const c = normalizeCarrier(carrier).toLowerCase();
      const winName = (c.includes('att') || url.includes('qpay') || url.includes('myrtpay'))
        ? 'qpayWindow' : 'externalPortalWindow';
      openExternalIfOnline(url, winName, 'noopener,noreferrer');
    }
    const nextCart = [...cartRef.current, ...newItems];
    cartRef.current = nextCart;
    // R-PHONE-PAYMENT-CUSTOMER-PROPAGATION
    if (selectedCustomer) propagateSelectedCustomer(selectedCustomer);
    setCart(nextCart);
    // R-OPERATOR-ACTIVITY-OUTCOME-AWARE-V1: emit BEFORE reset() so the
    // payload still references valid in-state values; helper defers via
    // setTimeout(0) anyway.
    {
      const firstPhone = newItems.find((it) => (it as { phoneNumber?: string }).phoneNumber)?.phoneNumber || '';
      const totalCents = newItems.reduce((s, it) => s + ((it.price || 0) * (it.qty || 1)), 0);
      if (firstPhone) {
        emitOperatorActivity('phone.payment.payment_recorded', {
          customerId: selectedCustomer?.id,
          phone: firstPhone,
          amountCents: totalCents,
        });
      }
    }
    reset();
    onClose();
  }, [carrier, settings, buildCartItems, setCart, onClose, selectedCustomer, propagateSelectedCustomer, emitOperatorActivity]);

  // ── Add to cart ───────────────────────────────────────────
  const handleAddToCart = useCallback(() => {
    if (!canAddToCart) return;
    const newItems = buildCartItems();
    if (!newItems.length) return;
    const nextCart = [...cartRef.current, ...newItems];
    cartRef.current = nextCart;
    // R-PHONE-PAYMENT-CUSTOMER-PROPAGATION
    if (selectedCustomer) propagateSelectedCustomer(selectedCustomer);
    setCart(nextCart);
    // R-OPERATOR-ACTIVITY-OUTCOME-AWARE-V1
    {
      const firstPhone = newItems.find((it) => (it as { phoneNumber?: string }).phoneNumber)?.phoneNumber || '';
      const totalCents = newItems.reduce((s, it) => s + ((it.price || 0) * (it.qty || 1)), 0);
      if (firstPhone) {
        emitOperatorActivity('phone.payment.payment_recorded', {
          customerId: selectedCustomer?.id,
          phone: firstPhone,
          amountCents: totalCents,
        });
      }
    }
    reset();
    onClose();
  }, [canAddToCart, buildCartItems, setCart, onClose, selectedCustomer, propagateSelectedCustomer, emitOperatorActivity]);

  // R-PHONE-FAMILY-PERLINE: per-line portal handler — multi-line mode.
  // Processes ONE line at a time: validates, builds its cart item with
  // ITS carrier, opens that carrier's portal, adds to cart, removes
  // the line from state. When the last line is processed, closes modal.
  const handlePortalForLine = useCallback((lineId: string) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    if (!line.carrier) {
      toast(t('phonePay.errPickCarrierLine'), 'error');
      return;
    }
    if (!isValidPhone(line.number)) {
      toast(t('phonePay.errInvalidPhoneShort'), 'error');
      return;
    }
    const amt = parseFloat(line.amount);
    if (!amt || amt <= 0) {
      toast(t('phonePay.errInvalidAmount'), 'error');
      return;
    }

    const normCarrier = normalizeCarrier(line.carrier);
    const phone = sanitizePhone(line.number);
    // R-PHONE-FAMILY-MULTICUST: attribute the cart-item note to this line's
    // customer (set when a customer was picked via the searchbar in multi mode)
    // and fall back to the global note for manually typed lines.
    const customerNote = line.customerName || `${firstName} ${lastName}`.trim();

    const priceCents = Math.round(amt * 100);
    const commRate = (settings.carrierCommissions?.[normCarrier]
      ?? settings.defaultCommissionRate
      ?? 0.07);
    const newItem: CartItem = {
      id: generateId(),
      name: `${normCarrier} - ${formatPhone(phone)}`,
      category: 'phone_payment',
      price: priceCents,
      // R-PHONEPAYMENT-COST-STAMP: stamp cost at sale time (parity w/ buildCartItems paths).
      cost: Math.round(priceCents * (1 - commRate)),
      qty: 1,
      taxable: false,
      cbeEligible: false,
      carrier: normCarrier,
      phoneNumber: phone,
      notes: customerNote,
      // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain (no silent zero).
      commissionRate: commRate,
    };

    // Open this carrier's portal (if URL configured).
    const url = settings.carrierPortalUrls?.[normCarrier];
    if (url) {
      const c = normCarrier.toLowerCase();
      const winName = (c.includes('att') || url.includes('qpay') || url.includes('myrtpay'))
        ? 'qpayWindow' : 'externalPortalWindow';
      openExternalIfOnline(url, winName, 'noopener,noreferrer');
    }

    // Commit to cart.
    const nextCart = [...cartRef.current, newItem];
    cartRef.current = nextCart;
    // R-PHONE-PAYMENT-CUSTOMER-PROPAGATION
    if (selectedCustomer) propagateSelectedCustomer(selectedCustomer);
    setCart(nextCart);
    // R-OPERATOR-ACTIVITY-OUTCOME-AWARE-V1
    emitOperatorActivity('phone.payment.payment_recorded', {
      customerId: selectedCustomer?.id,
      phone,
      amountCents: priceCents,
    });

    // Remove the processed line; if it was the last, close the modal.
    setLines((prev) => {
      const remaining = prev.filter((l) => l.id !== lineId);
      if (remaining.length === 0) {
        // Defer close to next tick so state settles.
        setTimeout(() => { reset(); onClose(); }, 0);
        return [{ id: generateId(), number: '', amount: '', carrier: '' }];
      }
      return remaining;
    });
  }, [lines, firstName, lastName, settings, setCart, onClose, t, toast, selectedCustomer, propagateSelectedCustomer, emitOperatorActivity]);

  // ── Multi-line runner: mark current paid & advance to next ──
  // R-PHONE-PAYMENTS-MULTILINE-RUNNER: process selected known lines one at
  // a time. Cashier opens portal externally, returns, clicks Mark Paid &
  // Next → we add this line to cart (CartItem identical to handlePortalForLine
  // output) and flip the line's paid flag. Re-derivation in JSX surfaces the
  // next unpaid line as the new current. No portal automation.
  const markPaidAndNext = useCallback(() => {
    // R-PHONE-PAYMENTS-MULTILINE-RUNNER-V2-FIX: derive runner order from
    // the knownLines memo (already normalized strings, sorted most-recent
    // first inside the memo) rather than Object.keys(selectedKnownLines)
    // — the latter's ordering depends on toggle/insertion sequence and
    // can drift away from the panel rows the cashier actually sees.
    const selectedNorms = knownLines.filter((n) => selectedKnownLines[n] !== undefined);
    const current = selectedNorms.find((n) => !paidKnownLines[n]);
    if (!current) return;
    // Safety: phone validation (defensive — known lines are normalized 10-digit).
    if (!isValidPhone(current)) {
      toast(t('phonePay.errInvalidPhoneShort'), 'error');
      return;
    }
    // Safety: amount required.
    const amtStr = selectedKnownLines[current] || '';
    const amt = parseFloat(amtStr);
    if (!amt || amt <= 0) {
      toast(t('phonePay.errInvalidAmount'), 'error');
      return;
    }
    // Carrier required (global state — known-lines flow uses the global pick).
    if (!carrier) {
      toast(t('phonePay.errPickCarrierLine'), 'error');
      return;
    }
    // Duplicate guard (idempotent against rapid double-clicks).
    if (paidKnownLines[current]) return;

    // R-PHONE-PAYMENTS-MULTILINE-RUNNER-V2-FIX: cart-level duplicate
    // protection. paidKnownLines can reset on customer/modal state
    // changes while the item still lives in cartRef — cart is the
    // final source of truth for "this line was already added".
    const alreadyInCart = cartRef.current.some(
      (item) => item.category === 'phone_payment' && item.phoneNumber === current,
    );
    if (alreadyInCart) {
      setPaidKnownLines((prev) => ({ ...prev, [current]: true }));
      return;
    }

    const normCarrier = normalizeCarrier(carrier);
    const phone = current;
    const customerNote = `${firstName} ${lastName}`.trim();
    const priceCents = Math.round(amt * 100);
    const commRate = (settings.carrierCommissions?.[normCarrier]
      ?? settings.defaultCommissionRate
      ?? 0.07);
    const newItem: CartItem = {
      id: generateId(),
      name: `${normCarrier} - ${formatPhone(phone)}`,
      category: 'phone_payment',
      price: priceCents,
      // R-PHONEPAYMENT-COST-STAMP: parity with handlePortalForLine.
      cost: Math.round(priceCents * (1 - commRate)),
      qty: 1,
      taxable: false,
      cbeEligible: false,
      carrier: normCarrier,
      phoneNumber: phone,
      notes: customerNote,
      commissionRate: commRate,
    };

    const nextCart = [...cartRef.current, newItem];
    cartRef.current = nextCart;
    if (selectedCustomer) propagateSelectedCustomer(selectedCustomer);
    setCart(nextCart);

    setPaidKnownLines((prev) => ({ ...prev, [current]: true }));
  }, [knownLines, selectedKnownLines, paidKnownLines, carrier, firstName, lastName, settings, setCart, t, toast, selectedCustomer, propagateSelectedCustomer]);

  // Anti-stale-closure ref so the event listener always calls the current
  // markPaidAndNext without re-attaching the listener on every dep change.
  const markPaidAndNextRef = useRef(markPaidAndNext);
  useEffect(() => { markPaidAndNextRef.current = markPaidAndNext; }, [markPaidAndNext]);

  // R-INTELLIGENCE-WORKFLOW-CONTINUITY-V1: listen for the bubble's
  // "Mark Paid & Next" confirmation. The bubble dispatches this event when
  // the cashier clicks "Confirm Paid" after returning from the carrier portal.
  // NEVER auto-confirms — this path only fires on explicit human action.
  useEffect(() => {
    const handler = () => { markPaidAndNextRef.current(); };
    window.addEventListener('cellhub:workflow-external-payment-confirm', handler);
    return () => window.removeEventListener('cellhub:workflow-external-payment-confirm', handler);
  }, []);

  // ── Portal opener for a single known-line row ─────────────
  // R-PHONE-PAYMENTS-PORTAL-ICON-RESTORE: per-line 🌐 button in the Known
  // Lines panel. Opens the carrier portal so the cashier can pay this
  // specific number externally before clicking "Mark Paid & Next" in the
  // runner. URL is read from settings.carrierPortalUrls[normCarrier] —
  // same source used by handlePortalForLine and the activation flow.
  // Spec called this getCarrierPortalUrl(carrier, phone); adapted to the
  // existing carrierPortalUrls map (no helper of that name exists).
  const handlePortalForKnownLine = (phone: string) => {
    if (!carrier) {
      toast(t('phonePay.errPickCarrierLine'), 'error');
      return;
    }
    const normCarrier = normalizeCarrier(carrier);
    const url = settings.carrierPortalUrls?.[normCarrier];
    if (!url) return;
    window.open(url, '_blank');
    // R-INTELLIGENCE-WORKFLOW-RESUMPTION-V1: record richer workflow context so
    // Intelligence can surface a resume card when the cashier returns.
    // NEVER auto-confirms — human click required.
    const normPhone = normalizePhone(phone);
    const amtCents = Math.round(parseFloat(selectedKnownLines[normPhone] || '0') * 100);
    const selectedNorms = knownLines.filter((n) => selectedKnownLines[n] !== undefined);
    const lineIndex = selectedNorms.findIndex((n) => n === normPhone);
    const totalLines = selectedNorms.length;
    const now = Date.now();
    startWorkflow(
      'external_payment',
      {
        phone: normPhone,
        carrier: normCarrier,
        amountCents: amtCents,
        activeLine: normPhone,
        lineIndex,
        totalLines,
        source: 'phone_payments',
      },
      {
        steps: [
          { id: 'external_portal_opened',  label: 'Portal opened',    status: 'completed', createdAt: now, updatedAt: now },
          { id: 'confirm_payment_return',  label: 'Confirm payment',  status: 'active',    createdAt: now, updatedAt: now },
        ],
      },
    );
  };

  // ── Manual line helpers ───────────────────────────────────
  // R-PHONE-MULTILINE-AUTOFILL-v2: functional setState form — avoids any
  // stale-closure scenario where rapid add-line+type interleavings could
  // cause one update to see pre-update `lines` and clobber changes.
  // R-PHONE-FAMILY-PERLINE: new lines inherit the global `carrier` state
  // as a convenience default; user can override per-row.
  const addLine = () =>
    setLines((prev) => [...prev, { id: generateId(), number: '', amount: '', carrier: carrier || '' }]);
  const removeLine = (id: string) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  const updateLine = (id: string, field: 'number' | 'amount' | 'carrier', val: string) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: val } : l)));

  const carriers = settings.phoneCarriers?.length
    ? settings.phoneCarriers
    : ['AT&T', 'T-Mobile', 'Verizon', 'Simple Mobile', 'H2O', 'Page Plus', 'Cricket', 'Ultra Mobile', 'Tracfone'];

  const hasKnownLines = knownLines.length > 0;
  const selectedKnownCount = Object.keys(selectedKnownLines).length;

  // ── Activation helpers ────────────────────────────────────
  // Commission calculation in CENTS.
  // Base = plan price ONLY (same as bill payment — plan goes through carrier).
  // Activation fee is 100% profit for the owner, no commission applies.
  const actCommissionCents = useMemo(() => {
    if (!actCarrier || !actPlanPrice) return 0;
    const normalizedActCarrier = normalizeCarrier(actCarrier);
    // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain
    const rate = (settings.carrierCommissions?.[normalizedActCarrier]
      ?? settings.defaultCommissionRate
      ?? 0.07);
    const baseCents = Math.round((parseFloat(actPlanPrice) || 0) * 100);
    return Math.round(baseCents * rate);
  }, [actCarrier, actPlanPrice, settings.carrierCommissions]);

  // Phone validation — DRY with isValidPhone helper (same rule used in bill
  // payment boundaries 1-3). sanitizePhone truncates to 10 digits, so 11+
  // digit input is accepted as before (first 10 kept).
  const actPhoneValid = isValidPhone(actPhone);

  // R-PHONE-ACTIVATION-SIM-ONLY-FIX: a picked SIM is itself a valid line
  // item (price decremented from inventory), so it alone satisfies the
  // "something to charge" requirement. Previously SIM-only flows were
  // blocked because activationFee=0 AND planPrice=0 failed the OR check.
  const canAddActivation =
    !!actCarrier &&
    actPhoneValid &&
    (
      (parseFloat(actAmount) || 0) > 0 ||
      (parseFloat(actPlanPrice) || 0) > 0 ||
      !!selectedSim
    );

  // R-SIM-INTAKE: SIM Cards in stock (category 'sim', qty>0). Optional — the
  // activation can complete without a SIM. The cart-side decrement at checkout
  // (POSModule) uses the stamped inventoryId on the SIM cart line.
  const availableSims = useMemo(
    () => inventory.filter((i) => (i.category || '').toLowerCase() === 'sim' && (i.qty || 0) > 0),
    [inventory],
  );
  // R-SIM-ACTIVATION: distinct carriers present in stock (used to render
  // carrier filter buttons above the search input). Reads either the legacy
  // `carrier` field or the SimManagerModal `brand` field.
  const simCarriers = useMemo(() => {
    const set = new Set<string>();
    for (const i of availableSims) {
      const c = ((i as any).carrier || i.brand || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [availableSims]);
  // R-SIM-ACTIVATION: SIMs after the carrier-button filter, before the
  // text-search filter. simResults below narrows further by simSearch.
  const carrierFilteredSims = useMemo(
    () => simCarrierFilter === 'All'
      ? availableSims
      : availableSims.filter(
          (i) => (((i as any).carrier || i.brand || '') as string).toLowerCase()
                 === simCarrierFilter.toLowerCase(),
        ),
    [availableSims, simCarrierFilter],
  );
  const simResults = useMemo(() => {
    const list = simSearch.trim()
      ? carrierFilteredSims.filter((i) =>
          // R-SIM-ACTIVATION: include `brand` in search — SimManagerModal
          // stores carrier in InventoryItem.brand, so a search for "Verizon"
          // would otherwise miss SIMs created from the new manager.
          matchesSearch(simSearch, i.name, i.imei, i.sku, i.barcode, (i as any).carrier, i.brand),
        )
      : carrierFilteredSims;
    return list.slice(0, 8);
  }, [simSearch, carrierFilteredSims]);

  // R-SIM-ACTIVATION-EDITABLE-PRICE-V1: effective SIM charge in cents — the
  // cashier's ad-hoc override when it parses to a non-negative number, else
  // the inventory price. Single source for both the pill display and the
  // cart line (checkout recomputes the same expression).
  const simEffectivePriceCents = useMemo(() => {
    const d = parseFloat(simPriceOverride);
    if (simPriceOverride.trim() !== '' && Number.isFinite(d) && d >= 0) return Math.round(d * 100);
    return selectedSim?.price || 0;
  }, [simPriceOverride, selectedSim]);

  // Plan autocomplete — load previously-used plans from localStorage
  const knownPlans = useMemo<string[]>(() => {
    try {
      const stored = loadLocal<string[]>('activation_plans', []);
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }, [actCarrier]); // refresh when carrier changes (could filter by carrier later)

  const handleAddActivation = useCallback(() => {
    if (!canAddActivation) return;
    const normalizedCarrier = normalizeCarrier(actCarrier);
    const planLabel = actPlan.trim() ? ` — ${actPlan.trim()}` : '';
    const spiffValue = parseFloat(actSpiff) || 0;
    const amountCents = Math.round((parseFloat(actAmount) || 0) * 100);
    const planPriceCents = Math.round((parseFloat(actPlanPrice) || 0) * 100);
    const spiffCents = Math.round(spiffValue * 100);
    const phoneNorm = normalizePhone(actPhone);
    const newItems: CartItem[] = [];

    // ── Item 1: Plan charge (first month) — same treatment as bill payment ──
    // Cart auto-applies utility tax + mobility surcharge for category 'phone_payment'
    // (see calculateCartTotals in types.ts). DO NOT push them as separate items here
    // or the customer gets double-charged.
    const customerNote = `${firstName} ${lastName}`.trim();
    if (planPriceCents > 0) {
      const commRate = (settings.carrierCommissions?.[normalizedCarrier]
        ?? settings.defaultCommissionRate
        ?? 0.07);
      newItems.push({
        id: generateId(),
        name: `📱 ${t('phonePay.itemPlanName')} ${normalizedCarrier}${planLabel}`,
        category: 'phone_payment',
        price: planPriceCents,
        // R-PHONEPAYMENT-COST-STAMP: stamp cost on activation plan (treated as phone_payment by Reports).
        cost: Math.round(planPriceCents * (1 - commRate)),
        qty: 1,
        taxable: false,
        cbeEligible: false,
        carrier: normalizedCarrier,
        phoneNumber: phoneNorm,
        notes: [customerNote, actNotes.trim()].filter(Boolean).join(' — '),
        // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain (no silent zero).
        commissionRate: commRate,
        // R-PHONE-PAYMENT-ACTIVATION-RECEIPT-ZERO-FEE-FIX: mark the plan line
        // as part of the activation flow so the receipt's NEW PHONE NUMBER
        // block triggers even when activation fee = $0 (no separate
        // 'activation'-category item exists in that case).
        isActivation: true,
      });
    }

    // ── Item 2: Activation / SIM / setup fee — 100% profit for the owner ──
    // No commission, no utility tax, no mobility fee. Fixed price.
    // R-PHONE-ACTIVATION-FEE-TAX-LOCK-V1: activation fee is a service/setup
    // fee — MUST stay non-taxable per business rule. category='activation'
    // (not 'phone_payment') ensures utility-tax + mobility-surcharge in
    // calculateCartTotals are also skipped. Do not flip taxable:true.
    if (amountCents > 0) {
      newItems.push({
        id: generateId(),
        name: `⚡ ${t('phonePay.itemActivationFeeName')} ${normalizedCarrier}${planLabel}`,
        category: 'activation',
        price: amountCents,
        qty: 1,
        taxable: false,
        cbeEligible: false,
        carrier: normalizedCarrier,
        phoneNumber: phoneNorm,
        notes: [customerNote, actNotes.trim()].filter(Boolean).join(' — '),
        // R-PHONE-PAYMENT-ACTIVATION-RECEIPT-ZERO-FEE-FIX
        isActivation: true,
      });
    }

    // ── Item 3 (R-SIM-INTAKE): SIM Card from inventory ──
    // Separate cart line with category='sim' so reports can attribute SIM
    // revenue/profit independently from activation fees. inventoryId triggers
    // the existing POSModule.tsx decrement loop (no new checkout code needed).
    // spiffAmount is stamped here (NOT on Plan or Activation Fee) per auditor
    // decision — single source of truth for downstream commission/tax reports.
    //
    // R-PHONE-ACTIVATION-ESIM-MUTEX-V1: when Activation Fee (amountCents) > 0
    // we treat this as an eSIM activation — physical SIM line is skipped even
    // if `selectedSim` happens to be set. eSIM and physical SIM are mutually
    // exclusive: a single phone gets ONE provisioning method, not both.
    const isEsimActivation = amountCents > 0;
    if (selectedSim && !isEsimActivation) {
      // R-SIM-ACTIVATION-EDITABLE-PRICE-V1: honor the cashier's ad-hoc price
      // override when it parses to a non-negative number; otherwise fall back
      // to the inventory price (never silently $0). Inventory record untouched.
      const overrideDollars = parseFloat(simPriceOverride);
      const simPriceCents = (simPriceOverride.trim() !== '' && Number.isFinite(overrideDollars) && overrideDollars >= 0)
        ? Math.round(overrideDollars * 100)
        : (selectedSim.price || 0);
      newItems.push({
        id: generateId(),
        inventoryId: selectedSim.id,
        // R-SIM-ACTIVATION: simNameOverride lets the cashier rename the SIM
        // ad-hoc per transaction without mutating the inventory record.
        name: `📶 ${t('phonePay.itemSimName')} — ${simNameOverride.trim() || selectedSim.name || normalizedCarrier}`,
        category: 'sim',
        price: simPriceCents,
        qty: 1,
        taxable: !!selectedSim.taxable,
        cbeEligible: false,
        carrier: normalizedCarrier,
        phoneNumber: phoneNorm,
        notes: [
          customerNote,
          selectedSim.imei ? `IMEI: ${selectedSim.imei}` : '',
          actNotes.trim(),
        ].filter(Boolean).join(' — '),
        // Stamped tracking fields — read by reports / receipts.
        simCardId: selectedSim.id,
        simCardImei: selectedSim.imei || '',
        simPrice: simPriceCents,
        spiffAmount: useSpiff ? spiffCents : 0,
      } as unknown as CartItem);
    }

    const nextCart = [...cartRef.current, ...newItems];
    cartRef.current = nextCart;

    // R-PHONE-ACTIVATION-AUTOCREATE-CUSTOMER-V1: walk-in activations now
    // capture the customer in the DB with carrier + phone + name. Mirrors
    // CustomerForm's "Create new" branch (silent — no toast, no modal,
    // cashier is mid-POS flow). Existing-customer flow unchanged: if the
    // cashier already picked someone, the modal preserves that selection.
    //
    // R-PHONE-ACTIVATION-AUTOCREATE-DEDUPE-V1 (auditor caution patch):
    // before creating, look up by normalized phone across primary `phone`
    // AND `phones[]` array. Prevents duplicate walk-in records when the
    // same number gets entered across sessions/cashiers. Keeps existing
    // customer untouched (no overwrite of name/email/etc — the new carrier
    // info still lands on the sale's cart items, which is the SoT).
    let resolvedCustomer = selectedCustomer;
    const nameTrim = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!resolvedCustomer && phoneNorm) {
      const existing = customersRef.current.find((c) => {
        const phonesToCheck = [c.phone, ...((c as { phones?: string[] }).phones || [])];
        return phonesToCheck.some((p) => normalizePhone(p || '') === phoneNorm);
      });
      if (existing) resolvedCustomer = existing;
    }
    // R-PHONE-PAYMENT-ACTIVATION-RECEIPT-ZERO-FEE-FIX: even when an EXISTING
    // customer is matched by phone, ensure the activation's carrier is
    // recorded on their record so future lookups know which provider this
    // line is on. Pure additive — never overwrites name/email; only extends
    // carriers[] when the new one isn't already there. Persists immediately
    // so a $0-fee activation still leaves a fresh customer-DB trail.
    if (resolvedCustomer && phoneNorm) {
      const existingCarriers = Array.isArray((resolvedCustomer as any).carriers)
        ? ((resolvedCustomer as any).carriers as string[])
        : ((resolvedCustomer as any).carrier ? [(resolvedCustomer as any).carrier] : []);
      const nextCarriers = existingCarriers.includes(normalizedCarrier)
        ? existingCarriers
        : [...existingCarriers, normalizedCarrier];
      const updated: Customer = {
        ...resolvedCustomer,
        carriers: nextCarriers,
        carrier: (resolvedCustomer as any).carrier || normalizedCarrier,
        updatedAt: new Date().toISOString(),
      } as Customer;
      const nextCustomersArr = customersRef.current.map((c) => c.id === updated.id ? updated : c);
      customersRef.current = nextCustomersArr;
      setCustomers(nextCustomersArr);
      persist.customer(updated.id, updated as unknown as Record<string, unknown>);
      resolvedCustomer = updated;
    }
    if (!resolvedCustomer && nameTrim && phoneNorm) {
      const newCust: Customer = {
        id: generateId(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        name: nameTrim,
        phone: phoneNorm,
        phones: [phoneNorm],
        carriers: [normalizedCarrier],
        carrier: normalizedCarrier,
        plan: actPlan.trim() || undefined,
        email: '',
        loyaltyPoints: 0,
        storeCredit: 0,
        customerNumber: `${settings.customerNumberPrefix || 'GC'}-${Date.now().toString().slice(-4)}`,
        notes: `Auto-created from activation: ${normalizedCarrier}${planLabel}`,
        communicationConsent: false,
        createdAt: new Date().toISOString(),
      } as Customer;
      const nextCustomers = [...customersRef.current, newCust];
      customersRef.current = nextCustomers;
      setCustomers(nextCustomers);
      persist.customer(newCust.id, newCust as unknown as Record<string, unknown>);
      resolvedCustomer = newCust;
    }

    // R-PHONE-PAYMENT-CUSTOMER-PROPAGATION
    if (resolvedCustomer) propagateSelectedCustomer(resolvedCustomer);
    setCart(nextCart);

    // Persist spiff (INTERNAL — does NOT touch customer total, reported in Taxes).
    // R-SIM-INTAKE: gated on the manual `useSpiff` toggle (default OFF) instead of
    // settings.trackActivationSpiffs. The legacy `activation_spiffs` localStorage
    // is preserved for Tax Reports backward-compat; the spiffAmount is also
    // stamped on the SIM cart line (above) so future reports can read either.
    if (useSpiff && spiffCents > 0) {
      try {
        const all = loadLocal<any[]>('activation_spiffs', []) || [];
        all.push({
          id: generateId(),
          carrier: normalizedCarrier,
          plan: actPlan.trim(),
          phoneNumber: phoneNorm,
          spiffCents,
          taxableRatio: settings.spiffTaxableRatio ?? 1.0,
          amountCents,
          planPriceCents,
          commissionCents: actCommissionCents,
          notes: actNotes.trim(),
          createdAt: new Date().toISOString(),
        });
        saveLocal('activation_spiffs', all);
      } catch (e) { console.error('spiff persist failed', e); }
    }

    // Persist plan name for autocomplete next time
    if (actPlan.trim()) {
      try {
        const plans = loadLocal<string[]>('activation_plans', []) || [];
        if (!plans.includes(actPlan.trim())) {
          plans.push(actPlan.trim());
          saveLocal('activation_plans', plans.slice(-50));
        }
      } catch { /* noop */ }
    }

    // R-PHONE-ACTIVATION-INTELLIGENCE-EVENT-V1: notify operator-activity
    // pipeline that an activation was completed. Reuses the existing
    // 'payment_recorded' event (an activation IS a captured-payment-with-
    // extra-context). Carrier + service info is already stamped on cart
    // items (categories phone_payment / activation / sim), so
    // SalesAnalyzer / Reports can derive per-carrier activation counts
    // from the sale record without a new event type.
    emitOperatorActivity('phone.payment.payment_recorded', {
      customerId: resolvedCustomer?.id,
      phone: phoneNorm,
      amountCents: planPriceCents + amountCents + (selectedSim?.price || 0),
    });

    // Reset all activation fields
    setActCarrier('');
    setActPhone(''); setActPlan(''); setActPlanPrice(''); setActAmount(''); setActNotes(''); setActSpiff('0');
    // R-SIM-INTAKE: reset SIM picker + spiff toggle for next transaction
    setSelectedSim(null); setSimSearch(''); setUseSpiff(false);
    // R-SIM-ACTIVATION: reset the new picker UX state too.
    setSimCarrierFilter('All'); setSimNameOverride(''); setEditingSimName(false);
    // R-SIM-ACTIVATION-EDITABLE-PRICE-V1: reset price override for next sale.
    setSimPriceOverride(''); setEditingSimPrice(false);
    // Also reset main panel fields to avoid data leak between transactions
    reset();
    onClose();
  }, [canAddActivation, actCarrier, actPhone, actPlan, actPlanPrice, actAmount, actNotes, actSpiff,
      actCommissionCents, settings, setCart, onClose, t, firstName, lastName,
      selectedCustomer, propagateSelectedCustomer, selectedSim, useSpiff,
      // R-SIM-ACTIVATION: the renamed SIM line picks up simNameOverride.
      simNameOverride,
      // R-SIM-ACTIVATION-EDITABLE-PRICE-V1: ad-hoc price override.
      simPriceOverride]);

  const handleOpenActivationPortal = () => {
    // Try both raw and normalized carrier name as keys
    const normalizedActCarrier = normalizeCarrier(actCarrier);
    const url = settings.carrierPortalUrls?.[actCarrier]
             || settings.carrierPortalUrls?.[normalizedActCarrier];
    if (url) { openExternalIfOnline(url, '_blank'); return; }
    const lcCarrier = normalizedActCarrier.toLowerCase();
    const defaults: Record<string, string> = {
      'att': 'https://www.att.com/dealer',
      'at&t': 'https://www.att.com/dealer',
      't-mobile': 'https://www.t-mobile.com/dealerlogin',
      'tmobile': 'https://www.t-mobile.com/dealerlogin',
      'verizon': 'https://www.verizonwireless.com/dealer',
      'h2o': 'https://www.h2owirelessnow.com',
      'simple mobile': 'https://dealer.simplemobile.com',
      'page plus': 'https://www.pagepluscellular.com/dealer',
    };
    const fallback = Object.entries(defaults).find(([k]) => lcCarrier.includes(k))?.[1];
    if (fallback) openExternalIfOnline(fallback, '_blank');
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`📱 ${t('phonePay.modalTitle')}`}
      size="max-w-xl"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* ── Tab switcher ─────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '0.375rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.625rem', padding: '0.25rem' }}>
          {[
            { id: 'payment',    label: t('phonePay.tabBillPayment') },
            { id: 'activation', label: t('phonePay.tabActivation') },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setModalTab(tab.id as any)}
              style={{
                flex: 1, padding: '0.5rem', borderRadius: '0.5rem', cursor: 'pointer',
                fontWeight: modalTab === tab.id ? 700 : 400, fontSize: '0.82rem',
                border: 'none',
                background: modalTab === tab.id ? 'rgba(102,126,234,0.25)' : 'transparent',
                color: modalTab === tab.id ? '#a5b4fc' : '#64748b',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════
            TAB: ACTIVATION
        ══════════════════════════════════════════════════ */}
        {modalTab === 'activation' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', minHeight: '540px' }}>

            {/* Customer search — same component as bill payment tab */}
            <div style={{ position: 'relative' }}>
              <div style={{
                padding: '0.5rem 0.875rem',
                background: 'rgba(102,126,234,0.08)',
                border: '1px solid rgba(102,126,234,0.25)',
                borderRadius: '0.625rem',
                fontSize: '0.78rem', color: '#a5b4fc',
                marginBottom: '0.5rem',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
              }}>
                🔍 <span>{t('phonePay.searchCustomerLabel')}</span>
              </div>
              <input
                className="input"
                placeholder={t('phonePay.searchCustomerPlaceholder')}
                value={custSearch}
                onChange={(e) => {
                  setCustSearch(e.target.value);
                  setShowCustDropdown(true);
                  setSelectedCustomer(null);
                }}
                onFocus={() => setShowCustDropdown(true)}
              />
              {showCustDropdown && custResults.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '0.5rem', marginTop: '0.25rem', overflow: 'hidden',
                }}>
                  {custResults.map((c) => (
                    <button key={c.id} onClick={() => {
                      handleSelectCustomer(c);
                      // Autopopulate activation phone from customer primary phone
                      if (c.phone) setActPhone(c.phone);
                    }} style={{
                      width: '100%', textAlign: 'left', padding: '0.625rem 0.875rem',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: '#e2e8f0', fontSize: '0.875rem',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(102,126,234,0.15)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedCustomer && (
                <div style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: '0.25rem' }}>
                  ✓ {selectedCustomer.name}
                </div>
              )}
            </div>

            {/* First / Last name */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {t('phonePay.firstNameLower')}
                </label>
                <input className="input" value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={t('phonePay.firstNamePlaceholderLower')} />
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {t('phonePay.lastNameLower')}
                </label>
                <input className="input" value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={t('phonePay.lastNamePlaceholderLower')} />
              </div>
            </div>

            {/* Carrier selector */}
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>
                Carrier *
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {carriers.map((c) => {
                  const color = CARRIER_COLORS[c] || '#667eea';
                  const active = actCarrier === c;
                  return (
                    <button key={c} onClick={() => setActCarrier(c)}
                      style={{
                        padding: '0.3rem 0.75rem', borderRadius: '999px', cursor: 'pointer',
                        fontSize: '0.78rem', fontWeight: active ? 700 : 500,
                        border: `1px solid ${active ? color : 'rgba(255,255,255,0.12)'}`,
                        background: active ? `${color}22` : 'rgba(255,255,255,0.04)',
                        color: active ? color : '#94a3b8', transition: 'all 0.12s',
                      }}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Commission preview — R-FINANCIAL-PRIVACY-PHONE-PAYMENT-LEAK:
                hide the 💰 emoji + commission % + $ for non-owner employees.
                The "🔗 Open Portal" button stays — it's operational, not
                financial, and the cashier still needs to launch the carrier
                portal flow. */}
            {actCarrier && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.625rem 0.875rem',
                background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: '0.625rem',
              }}>
                {canSeeOwnerFinancials && (
                  <>
                    <span style={{ fontSize: '1.1rem' }}>💰</span>
                    <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                      {t('phonePay.estCommission')}:
                      <strong style={{ color: '#22c55e', marginLeft: '0.35rem' }}>
                        {((settings.carrierCommissions?.[normalizeCarrier(actCarrier)] ?? 0) * 100).toFixed(0)}%
                        {actCommissionCents > 0 && ` = ${formatCurrency(actCommissionCents)}`}
                      </strong>
                    </div>
                  </>
                )}
                {actCarrier && (
                  <button onClick={handleOpenActivationPortal}
                    style={{
                      marginLeft: 'auto', padding: '0.25rem 0.625rem',
                      background: 'rgba(102,126,234,0.15)', border: '1px solid rgba(102,126,234,0.3)',
                      borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.72rem',
                      color: '#a5b4fc', fontWeight: 600,
                    }}>
                    🔗 {t('phonePay.openPortal')}
                  </button>
                )}
              </div>
            )}

            {/* R-SIM-INTAKE: Spiff toggle — opt-in per transaction (default OFF).
                Replaces the prior auto-populate that read settings.carrierSpiffs.
                When ON: cashier types the spiff amount; gets stamped onto the
                SIM cart line as `spiffAmount` and persisted to legacy
                `activation_spiffs` localStorage (Tax Reports source).
                R-FINANCIAL-PRIVACY-PHONE-PAYMENT-LEAK: spiff is owner-only
                financial data (carrier bonus paid TO the shop). Hide the
                toggle entirely from non-owner employees. Math/persistence
                are not affected — useSpiff stays its initial `false`. */}
            {canSeeOwnerFinancials && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.625rem 0.875rem',
              background: useSpiff ? 'rgba(251,191,36,0.07)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${useSpiff ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: '0.625rem',
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useSpiff}
                  onChange={(e) => {
                    setUseSpiff(e.target.checked);
                    if (!e.target.checked) setActSpiff('0');
                  }}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#fbbf24' }}
                />
                <span style={{ fontSize: '1.1rem' }}>🎯</span>
                <strong style={{ color: useSpiff ? '#fbbf24' : '#94a3b8', fontSize: '0.85rem' }}>
                  {t('phonePay.spiffToggleLabel')}
                </strong>
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  {t('phonePay.spiffToggleHint')}
                </span>
              </label>
              {useSpiff && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={actSpiff}
                    onChange={(e) => setActSpiff(e.target.value)}
                    placeholder="0.00"
                    style={{
                      width: '90px', padding: '0.25rem 0.5rem', textAlign: 'right',
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '0.375rem',
                      color: '#fbbf24',
                      fontWeight: 700, fontSize: '0.9rem',
                    }}
                  />
                </div>
              )}
            </div>
            )}

            {/* Phone + Plan grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {t('phonePay.phoneNumberStarLabel')}
                </label>
                <input
                  className="input"
                  type="tel"
                  value={actPhone}
                  onChange={(e) => setActPhone(e.target.value)}
                  placeholder="(555) 000-0000"
                  style={{
                    borderColor: actPhone && !actPhoneValid ? 'rgba(239,68,68,0.5)' : undefined,
                  }}
                />
                {actPhone && !actPhoneValid && (
                  <div style={{ fontSize: '0.68rem', color: '#f87171', marginTop: '0.2rem' }}>
                    {t('phonePay.tenDigitsRequired')}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {t('phonePay.planDescription')}
                </label>
                <input
                  className="input"
                  value={actPlan}
                  onChange={(e) => setActPlan(e.target.value)}
                  placeholder={t('phonePay.planPlaceholder')}
                  list="activation-plan-presets"
                />
                <datalist id="activation-plan-presets">
                  {knownPlans.map((p) => <option key={p} value={p} />)}
                </datalist>
              </div>
            </div>

            {/* Plan price + Activation fee — TWO separate charges to customer */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {t('phonePay.planPrice')}
                </label>
                <input className="input" type="number" min="0" step="0.01"
                  value={actPlanPrice} onChange={(e) => setActPlanPrice(e.target.value)}
                  placeholder="0.00" />
                <p style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.2rem' }}>
                  {t('phonePay.firstMonthHint')}
                </p>
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {t('phonePay.activationFeeLabel')}
                </label>
                <input className="input" type="number" min="0" step="0.01"
                  value={actAmount} onChange={(e) => setActAmount(e.target.value)}
                  placeholder="0.00" />
                {/* R-PHONE-ACTIVATION-ESIM-HINT-V1: eSIM hint under the
                    activation fee. Subtle styling (muted color, not red),
                    purely informational — does not auto-fill, does not
                    enforce, does not change logic. */}
                <p style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.2rem' }}>
                  {t('phonePay.activationFeeEsimHint')}
                </p>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                {t('phonePay.internalNotes')}
              </label>
              <input className="input" value={actNotes}
                onChange={(e) => setActNotes(e.target.value)}
                placeholder={t('phonePay.internalNotesPlaceholder')} />
            </div>

            {/* R-SIM-INTAKE: SIM Card picker. Lists category='sim' items with
                qty>0 from inventory. Optional — activation can complete without
                a SIM. The selected SIM's price is added to the cart total and
                its qty is decremented at checkout via inventoryId. */}
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                {t('phonePay.simCardLabel')}
              </label>
              {selectedSim ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  background: 'rgba(34,211,238,0.08)',
                  border: '1px solid rgba(34,211,238,0.3)',
                  borderRadius: '0.5rem',
                }}>
                  <span style={{ fontSize: '1rem' }}>📶</span>
                  {/* R-SIM-ACTIVATION: pill flex container so the editable
                      name input can claim flex:1 alongside ICCID + price. */}
                  <span style={{ fontSize: '0.82rem', color: '#e2e8f0', flex: 1, display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flexWrap: 'wrap' }}>
                    {editingSimName ? (
                      <input
                        value={simNameOverride}
                        onChange={(e) => setSimNameOverride(e.target.value)}
                        onBlur={() => setEditingSimName(false)}
                        autoFocus
                        style={{
                          flex: 1,
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid rgba(34,211,238,0.5)',
                          color: '#e2e8f0',
                          fontSize: '0.82rem',
                          outline: 'none',
                          padding: '0.1rem 0.2rem',
                        }}
                      />
                    ) : (
                      <>
                        <strong>{simNameOverride || selectedSim.name}</strong>
                        <button
                          type="button"
                          onClick={() => setEditingSimName(true)}
                          aria-label="edit SIM name"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            fontSize: '0.78rem',
                            padding: '0 0.2rem',
                          }}
                        >
                          ✏️
                        </button>
                      </>
                    )}
                    {/* R-SIM-ACTIVATION: ICCID label (was "IMEI" — semantically wrong for SIMs). */}
                    {selectedSim.imei && <span style={{ color: '#94a3b8' }}>· ICCID {selectedSim.imei}</span>}
                    {/* R-SIM-ACTIVATION-EDITABLE-PRICE-V1: editable SIM price.
                        Tap the green amount (or ✏️) to override the charge for
                        this transaction only — inventory price is unchanged. */}
                    {editingSimPrice ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', color: '#22c55e', fontWeight: 700 }}>
                        $
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={simPriceOverride}
                          onChange={(e) => setSimPriceOverride(e.target.value)}
                          onBlur={() => setEditingSimPrice(false)}
                          autoFocus
                          style={{
                            width: '5rem',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: '1px solid rgba(34,197,94,0.5)',
                            color: '#22c55e',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            outline: 'none',
                            padding: '0.1rem 0.2rem',
                          }}
                        />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingSimPrice(true)}
                        aria-label="edit SIM price"
                        title={t('phonePay.simPriceEditHint')}
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: '#22c55e', fontWeight: 700, fontSize: '0.82rem',
                          padding: 0, display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                        }}
                      >
                        {formatCurrency(simEffectivePriceCents)}
                        <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>✏️</span>
                      </button>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      // R-SIM-ACTIVATION: reset all SIM-picker state on clear.
                      setSelectedSim(null);
                      setSimSearch('');
                      setSimCarrierFilter('All');
                      setSimNameOverride('');
                      setEditingSimName(false);
                      // R-SIM-ACTIVATION-EDITABLE-PRICE-V1: clear price override.
                      setSimPriceOverride('');
                      setEditingSimPrice(false);
                    }}
                    style={{
                      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                      color: '#f87171', padding: '0.2rem 0.55rem', borderRadius: '0.375rem',
                      cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700,
                    }}
                    aria-label="clear selected SIM"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  {/* R-SIM-ACTIVATION: carrier filter buttons (only render
                      when at least one carrier is present in stock). 'All'
                      pill always first; the rest is the sorted set of
                      distinct carriers from `simCarriers` memo. */}
                  {simCarriers.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                      <button
                        type="button"
                        onClick={() => setSimCarrierFilter('All')}
                        style={{
                          padding: '0.25rem 0.55rem', fontSize: '0.72rem', fontWeight: 700,
                          borderRadius: '0.4rem', cursor: 'pointer',
                          background: simCarrierFilter === 'All' ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${simCarrierFilter === 'All' ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.12)'}`,
                          color: simCarrierFilter === 'All' ? '#67e8f9' : '#94a3b8',
                        }}
                      >
                        All
                      </button>
                      {simCarriers.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setSimCarrierFilter(c)}
                          style={{
                            padding: '0.25rem 0.55rem', fontSize: '0.72rem', fontWeight: 700,
                            borderRadius: '0.4rem', cursor: 'pointer',
                            background: simCarrierFilter === c ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${simCarrierFilter === c ? 'rgba(34,211,238,0.5)' : 'rgba(255,255,255,0.12)'}`,
                            color: simCarrierFilter === c ? '#67e8f9' : '#cbd5e1',
                          }}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    className="input"
                    value={simSearch}
                    onChange={(e) => setSimSearch(e.target.value)}
                    placeholder={t('phonePay.simCardSearchPlaceholder')}
                    disabled={availableSims.length === 0}
                  />
                  {availableSims.length === 0 ? (
                    <p style={{ fontSize: '0.7rem', color: '#fbbf24', marginTop: '0.25rem' }}>
                      ⚠️ {t('phonePay.noSimsInStock')}
                    </p>
                  ) : simResults.length > 0 && (
                    <div style={{
                      marginTop: '0.25rem',
                      background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '0.5rem', overflow: 'hidden',
                      maxHeight: '180px', overflowY: 'auto',
                    }}>
                      {simResults.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            // R-SIM-ACTIVATION: seed simNameOverride from the
                            // picked SIM so the editable pill input starts
                            // with the inventory name as the placeholder text.
                            setSelectedSim(s);
                            setSimSearch('');
                            setSimNameOverride(s.name || '');
                            setEditingSimName(false);
                            // R-SIM-ACTIVATION-EDITABLE-PRICE-V1: seed the
                            // editable price from the inventory price (dollars).
                            setSimPriceOverride(((s.price || 0) / 100).toFixed(2));
                            setEditingSimPrice(false);
                          }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '0.45rem 0.75rem', cursor: 'pointer',
                            background: 'transparent', border: 'none',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            color: '#e2e8f0', fontSize: '0.78rem',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(34,211,238,0.12)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 600 }}>{s.name}</span>
                            <span style={{ color: '#22c55e', fontWeight: 700 }}>{formatCurrency(s.price || 0)}</span>
                          </div>
                          <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.1rem' }}>
                            {[
                              // R-SIM-ACTIVATION: ICCID label (was "IMEI") +
                              // brand fallback for SIMs created via
                              // SimManagerModal (which stores carrier in `brand`).
                              s.imei && `ICCID ${s.imei}`,
                              (s as any).carrier || s.brand,
                              `qty ${s.qty}`,
                            ].filter(Boolean).join(' · ')}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Add to cart */}
            <button
              onClick={handleAddActivation}
              disabled={!canAddActivation}
              className="btn btn-success"
              style={{ fontSize: '1rem', padding: '0.75rem', marginTop: '0.25rem' }}
            >
              🛒 {t('addToCart')}
              {(() => {
                const plan = parseFloat(actPlanPrice) || 0;
                const fee  = parseFloat(actAmount) || 0;
                // R-SIM-INTAKE: include selected SIM price in the preview total.
                const sim  = (selectedSim?.price || 0) / 100;
                // If plan > 0, add utility tax + mobility (same as bill payment)
                const utilRate = settings.utilityUsersTax || 0.055;
                const mobility = settings.mobileSurcharge || 0.41;
                const planExtras = plan > 0 ? (plan * utilRate + mobility) : 0;
                const total = plan + fee + sim + planExtras;
                return total > 0 ? ` — $${total.toFixed(2)}` : '';
              })()}
            </button>

          </div>
        )}

        {/* ══════════════════════════════════════════════════
            TAB: BILL PAYMENT (existing content)
        ══════════════════════════════════════════════════ */}
        {modalTab === 'payment' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ position: 'relative' }}>
          <div style={{
            padding: '0.5rem 0.875rem',
            background: 'rgba(102,126,234,0.08)',
            border: '1px solid rgba(102,126,234,0.25)',
            borderRadius: '0.625rem',
            fontSize: '0.78rem', color: '#a5b4fc',
            marginBottom: '0.5rem',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            🔍 <span>{t('phonePay.searchCustomerLabel')}</span>
          </div>
          <input
            className="input"
            placeholder={t('phonePay.searchCustomerPlaceholder')}
            value={custSearch}
            onChange={(e) => {
              setCustSearch(e.target.value);
              setShowCustDropdown(true);
              setSelectedCustomer(null);
              setSelectedKnownLines({});
    setPaidKnownLines({});
            }}
            onFocus={() => setShowCustDropdown(true)}
          />
          {showCustDropdown && custResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '0.5rem', marginTop: '0.25rem', overflow: 'hidden',
            }}>
              {custResults.map((c) => (
                <button key={c.id} onClick={() => handleSelectCustomer(c)} style={{
                  width: '100%', textAlign: 'left', padding: '0.625rem 0.875rem',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#e2e8f0', fontSize: '0.875rem',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(102,126,234,0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{c.phone}</span>
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <div style={{
              fontSize: '0.75rem', marginTop: '0.25rem',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              flexWrap: 'wrap',
            }}>
              <span style={{ color: '#22c55e' }}>✓ {selectedCustomer.name}</span>
              {hasKnownLines && (
                <span style={{ color: '#a5b4fc' }}>
                  · {knownLines.length} {t('phonePay.knownLineCount', knownLines.length)}
                </span>
              )}
              {/* R-PHONE-FAMILY-SWITCHCUSTOMER: explicit "change customer" button.
                  Clears everything so user can search a different customer without
                  having to manually delete the filled input value. */}
              <button
                type="button"
                onClick={() => {
                  setSelectedCustomer(null);
                  setCustSearch('');
                  setSelectedKnownLines({});
    setPaidKnownLines({});
                  setFirstName('');
                  setLastName('');
                  setPhoneNumber('');
                  setCarrier('');
                  setAmount('');
                  setPortal('');
                  setNewLinePhone('');
                  setNewLineAmount('');
                  setLines([{ id: generateId(), number: '', amount: '', carrier: '' }]);
                  setShowCustDropdown(true);
                }}
                style={{
                  marginLeft: 'auto',
                  background: 'rgba(148,163,184,0.12)',
                  border: '1px solid rgba(148,163,184,0.3)',
                  color: '#94a3b8',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '0.35rem',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('phonePay.changeCustomer')}
              </button>
            </div>
          )}
        </div>

        {/* ── Carrier Buttons ─────────────────────────────── */}
        <div>
          <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
            {t('phonePay.selectCarrier')}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem' }}>
            {carriers.map((c) => {
              const color = CARRIER_COLORS[c] || '#667eea';
              const active = carrier === c;
              return (
                <button key={c} onClick={() => setCarrier(c)} style={{
                  padding: '0.55rem 0.4rem', borderRadius: '0.5rem',
                  border: active ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.12)',
                  background: active ? `${color}22` : 'rgba(255,255,255,0.04)',
                  color: active ? color : '#94a3b8',
                  fontWeight: active ? 700 : 500, fontSize: '0.78rem',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════
            KNOWN LINES PANEL — shown when customer has history
            AND Family Plan toggle is OFF. When toggle is ON the user
            uses the manual multi-line UI (per-line carrier + portal)
            from R-PHONE-FAMILY-PERLINE, which is strictly more capable
            (mixed carriers across known + new numbers).
        ══════════════════════════════════════════════════ */}
        {hasKnownLines && !isMultiLine && (
          <div style={{
            border: '1px solid rgba(102,126,234,0.35)',
            borderRadius: '0.75rem',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '0.6rem 0.875rem',
              background: 'rgba(102,126,234,0.12)',
              borderBottom: '1px solid rgba(102,126,234,0.2)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a5b4fc' }}>
                📋 {t('phonePay.knownLines')} — {selectedCustomer?.name}
              </span>
              {selectedKnownCount > 0 && (
                <span style={{
                  fontSize: '0.7rem', background: 'rgba(102,126,234,0.3)',
                  color: '#c7d2fe', padding: '0.15rem 0.5rem', borderRadius: '999px',
                }}>
                  {t('phonePay.knownLinesSelectedCount', selectedKnownCount)}
                </span>
              )}
            </div>

            {/* Line rows */}
            <div style={{ padding: '0.625rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {knownLines.map((norm) => {
                const isChecked = selectedKnownLines[norm] !== undefined;
                const lineAmt = selectedKnownLines[norm] ?? '';
                return (
                  <div key={norm} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.5rem 0.625rem',
                    background: isChecked ? 'rgba(102,126,234,0.12)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isChecked ? 'rgba(102,126,234,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '0.5rem',
                    transition: 'all 0.15s',
                  }}>
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleKnownLine(norm)}
                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#667eea', flexShrink: 0 }}
                    />
                    {/* Formatted phone — click to copy.
                        R-PHONE-PAYMENT-BUBBLE-LAST-PAYMENT-DATE-FIX: wrap
                        the phone span and a tiny "Last payment" sub-line in
                        a flex column so the per-line history is visible
                        when the customer is recognized (knownLines branch). */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          autoCopyPhone(norm);
                        }}
                        title={t('phonePay.clickToCopy')}
                        style={{
                          fontSize: '0.9rem', fontFamily: 'monospace',
                          color: copiedPhone === norm ? '#22c55e' : (isChecked ? '#e2e8f0' : '#94a3b8'),
                          letterSpacing: '0.04em',
                          cursor: 'pointer',
                          transition: 'color 0.2s',
                          userSelect: 'all',
                        }}
                      >
                        {copiedPhone === norm ? `✓ ${t('phonePay.copiedExclaim')}` : formatPhone(norm)}
                      </span>
                      {(() => {
                        const lp = lastPaymentByLine.get(norm);
                        if (!lp) {
                          return (
                            <span style={{
                              fontSize: '0.66rem', color: '#475569', fontStyle: 'italic',
                              marginTop: '0.1rem',
                            }}>
                              {t('phonePay.lastPaymentNone')}
                            </span>
                          );
                        }
                        return (
                          <span style={{
                            fontSize: '0.66rem', color: '#94a3b8', marginTop: '0.1rem',
                          }}>
                            📅 {t(
                              'phonePay.lastPayment',
                              new Date(lp.dateMs).toLocaleDateString(),
                              '$' + (lp.amountCents / 100).toFixed(2),
                            )}
                            {lp.carrier ? ` · ${lp.carrier}` : ''}
                          </span>
                        );
                      })()}
                    </div>
                    {/* Copied badge when checked */}
                    {isChecked && copiedPhone === norm && (
                      <span style={{ fontSize: '0.7rem', color: '#22c55e', fontWeight: 600, flexShrink: 0 }}>
                        📋 {t('phonePay.ready')}
                      </span>
                    )}
                    {/* R-MULTILINE-PICKER-FIX: per-line amount input. Visible
                        only when this line is checked. Lets the cashier enter
                        a different amount per phone in multi-select mode
                        (validLines filters parseFloat(amt) > 0, so without
                        this field 2+ selected lines never reach Portal / Add
                        to Cart). */}
                    {selectedKnownLines[norm] !== undefined && (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lineAmt}
                        onChange={(e) => updateKnownLineAmount(norm, e.target.value)}
                        placeholder={t('pos.amountPlaceholder')}
                        aria-label={t('pos.knownLineAmountAria')}
                        className="input"
                        style={{ width: '90px', flexShrink: 0, fontSize: '0.82rem' }}
                      />
                    )}
                    {/* R-PHONE-PAYMENTS-PORTAL-ICON-RESTORE: per-line portal
                        opener. Disabled until cashier picks a carrier (URL is
                        keyed by normalized carrier name). */}
                    <button
                      type="button"
                      onClick={() => handlePortalForKnownLine(norm)}
                      disabled={!carrier}
                      title={t('phonePay.openPortal')}
                      aria-label={t('phonePay.openPortal')}
                      style={{
                        marginLeft: '0.5rem',
                        padding: '0.3rem 0.5rem',
                        borderRadius: '0.4rem',
                        border: '1px solid rgba(59,130,246,0.4)',
                        background: carrier ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                        color: carrier ? '#93c5fd' : '#64748b',
                        cursor: carrier ? 'pointer' : 'not-allowed',
                        fontSize: '0.75rem',
                        flexShrink: 0,
                      }}
                    >
                      🌐
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Quick total when multiple lines selected */}
            {selectedKnownCount > 1 && (
              <div style={{
                padding: '0.5rem 1rem',
                borderTop: '1px solid rgba(102,126,234,0.15)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: '0.82rem',
              }}>
                <span style={{ color: '#64748b' }}>
                  {selectedKnownCount} {t('phonePay.linesPlural')}
                </span>
                <span style={{ color: '#a5b4fc', fontWeight: 700 }}>
                  ${Object.values(selectedKnownLines)
                    .reduce((s, v) => s + (parseFloat(v) || 0), 0)
                    .toFixed(2)}
                  {' '}{t('phonePay.totalShort')}
                </span>
              </div>
            )}

            {/* R-PHONE-PAYMENTS-MULTILINE-RUNNER: per-line runner shown when 2+
                lines are selected. Tracks paid status and advances cashier
                through unpaid lines one at a time. Inline EN/ES strings —
                spec did not list translations.ts. */}
            {selectedKnownCount > 1 && (() => {
              // R-PHONE-PAYMENTS-MULTILINE-RUNNER-V2-FIX: same deterministic
              // order as markPaidAndNext (knownLines memo sequence) so the UI
              // current/next display matches what the handler will actually
              // process on click.
              const selectedNorms = knownLines.filter((n) => selectedKnownLines[n] !== undefined);
              const paidCount = selectedNorms.filter((n) => paidKnownLines[n]).length;
              const unpaidNorms = selectedNorms.filter((n) => !paidKnownLines[n]);
              const currentNorm = unpaidNorms[0];
              const nextNorm = unpaidNorms[1];
              const allDone = unpaidNorms.length === 0;
              const currentAmt = currentNorm ? parseFloat(selectedKnownLines[currentNorm] || '0') : 0;
              const canAdvance = !allDone && currentAmt > 0 && !!carrier;
              const isEs = lang === 'es';
              return (
                <div style={{
                  padding: '0.625rem 1rem',
                  borderTop: '1px solid rgba(102,126,234,0.2)',
                  background: 'rgba(102,126,234,0.06)',
                  display: 'flex', flexDirection: 'column', gap: '0.4rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem' }}>
                    <span style={{ color: '#a5b4fc', fontWeight: 700 }}>
                      🏁 {isEs ? 'Procesar línea por línea' : 'Run lines one by one'}
                      {' '}
                      <span style={{ color: '#cbd5e1', fontWeight: 500 }}>
                        — {isEs ? 'Pagadas' : 'Paid'} {paidCount} / {selectedNorms.length}
                      </span>
                    </span>
                    {allDone && (
                      <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.75rem' }}>
                        ✓ {isEs ? 'Todas pagadas' : 'All selected lines paid'}
                      </span>
                    )}
                  </div>
                  {!allDone && currentNorm && (
                    <>
                      <div style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>
                          {isEs ? 'Actual:' : 'Current:'}{' '}
                          <strong style={{ color: '#fbbf24', fontFamily: 'monospace' }}>{formatPhone(currentNorm)}</strong>
                          {' '}— ${currentAmt.toFixed(2)}
                        </span>
                        {nextNorm && (
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            {isEs ? 'Siguiente:' : 'Next:'}{' '}
                            <span style={{ fontFamily: 'monospace' }}>{formatPhone(nextNorm)}</span>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={markPaidAndNext}
                        disabled={!canAdvance}
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '0.5rem',
                          border: '1px solid rgba(34,197,94,0.4)',
                          background: canAdvance ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.04)',
                          color: canAdvance ? '#86efac' : '#64748b',
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          cursor: canAdvance ? 'pointer' : 'not-allowed',
                          transition: 'all 0.15s',
                        }}
                      >
                        ✓ {isEs ? 'Marcar pagada y siguiente' : 'Mark Paid & Next'}
                      </button>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ══════════════════════════════════════════════════
            FAMILY PLAN TOGGLE + MANUAL ENTRY
            R-PHONE-FAMILY-MULTIPHONES: toggle is ALWAYS visible (used
            to live behind {!hasKnownLines && ...} which hid it for any
            customer with a phone field). Single-line UI renders only
            when toggle is OFF AND customer has no known lines —
            otherwise the KnownLinesPanel above handles that case or
            the MultiLineUI below handles the toggle-ON case.
        ══════════════════════════════════════════════════ */}
        <>
            {/* Family Plan toggle */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: isMultiLine ? 'rgba(102,126,234,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isMultiLine ? 'rgba(102,126,234,0.4)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '0.625rem', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={isMultiLine}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsMultiLine(checked);
                  // R-PHONE-MULTILINE-AUTOFILL-v3 Bug B + R-PHONE-FAMILY-PERLINE:
                  // transfer typed phone AND carrier between single-line
                  // (phoneNumber + global carrier) and multi-line (lines[0])
                  // when toggling, so the user's input isn't lost visually.
                  if (checked) {
                    // Single → Multi: move phoneNumber/amount/carrier into lines[0].
                    // R-PHONE-FAMILY-MULTICUST: also carry selectedCustomer id/name
                    // so the line is attributed to the right customer on the receipt
                    // even before the user adds additional family members.
                    const clean = sanitizePhone(phoneNumber);
                    if (clean || carrier) {
                      setLines((prev) => {
                        const head = prev[0];
                        if (head && !head.number.trim() && !head.carrier) {
                          return [{
                            ...head,
                            number: clean || head.number,
                            amount: amount || head.amount,
                            carrier: carrier || head.carrier,
                            customerId: selectedCustomer?.id || head.customerId,
                            customerName: selectedCustomer?.name || head.customerName,
                          }, ...prev.slice(1)];
                        }
                        return prev;
                      });
                    }
                  } else {
                    // Multi → Single: move lines[0] back into phoneNumber/amount/carrier
                    setLines((prev) => {
                      const head = prev[0];
                      if (head && head.number.trim() && !phoneNumber) {
                        setPhoneNumber(head.number);
                        if (head.amount && !amount) setAmount(head.amount);
                        if (head.carrier && !carrier) setCarrier(head.carrier);
                      }
                      return prev;
                    });
                  }
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#667eea' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isMultiLine ? '#a5b4fc' : '#e2e8f0' }}>
                  👨‍👩‍👧 {t('phonePay.familyPlanTitle')}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {t('phonePay.familyPlanSubtitle')}
                </div>
              </div>
            </label>

            {/* Phone fields */}
            {isMultiLine ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  {t('phonePay.lines')}
                </label>
                {lines.map((line, i) => {
                  const lineCarrierColor = line.carrier ? (CARRIER_COLORS[line.carrier] || '#667eea') : '#64748b';
                  const lineReady = !!(line.carrier && isValidPhone(line.number) && parseFloat(line.amount) > 0);
                  return (
                    <div key={line.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      {/* R-PHONE-FAMILY-MULTICUST: show which customer this line
                          belongs to when it was added via searchbar in multi-line
                          mode. Hidden for manually typed rows (customerName empty). */}
                      {line.customerName && (
                        <div style={{
                          fontSize: '0.7rem', color: '#a5b4fc', fontWeight: 600,
                          marginLeft: '22px', display: 'flex', alignItems: 'center', gap: '0.3rem',
                        }}>
                          <span>👤</span>
                          <span>{line.customerName}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', width: '18px' }}>{i + 1}.</span>
                      {/* Phone number — R-PHONE-MULTILINE-AUTOFILL-v2 protections kept */}
                      <input
                        type="tel"
                        name={`line-number-${line.id}`}
                        autoComplete="off"
                        inputMode="numeric"
                        // R-PHONE-INPUT-TRUNCATION-FIX: was maxLength={10} which
                        // truncated formatted pastes like "(805) 403-8679" to
                        // "(805) 403-" before the onChange handler could
                        // sanitize. sanitizePhone() does the final 10-digit
                        // cap. Allow up to 20 chars for typical formatted
                        // phones: "+1 (805) 403-8679" = 18 chars.
                        maxLength={20}
                        pattern="[0-9]*"
                        readOnly
                        onFocus={(e) => { e.currentTarget.readOnly = false; }}
                        value={line.number || ''}
                        onChange={(e) => {
                          const clean = sanitizePhone(e.target.value);
                          updateLine(line.id, 'number', clean);
                          // R-PHONE-FAMILY-AUTOCOPY: mirror the single-line input's
                          // auto-copy-to-clipboard behavior for multi-line entries.
                          autoCopyPhone(clean);
                        }}
                        placeholder={t('phonePay.phonePlaceholder')}
                        className="input" style={{ flex: 1, minWidth: '110px' }}
                      />
                      {/* R-PHONE-FAMILY-COPYBTN: manual copy per-line for Family Plan.
                          Cashier clicks 📋 to copy THIS line's phone to clipboard
                          (autoCopyPhone helper has no toast; button gives explicit
                          feedback for the active user action). Disabled until the
                          number is a valid 10-digit. */}
                      {(() => {
                        const lineValid = isValidPhone(line.number);
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              const clean = sanitizePhone(line.number);
                              if (!isValidPhone(clean)) return;
                              navigator.clipboard.writeText(clean).then(() => {
                                toast(t('phonePay.numberCopied', formatPhone(clean)), 'success');
                              }).catch(() => {
                                toast(t('phonePay.couldNotCopy'), 'error');
                              });
                            }}
                            disabled={!lineValid}
                            title={t('phonePay.copyNumberTitle')}
                            aria-label={t('phonePay.copyNumberAria')}
                            style={{
                              background: 'rgba(100,116,139,0.12)',
                              color: '#94a3b8',
                              border: '1px solid transparent',
                              borderRadius: '0.35rem',
                              padding: '0 0.4rem',
                              fontSize: '0.95rem',
                              cursor: lineValid ? 'pointer' : 'not-allowed',
                              opacity: lineValid ? 1 : 0.4,
                            }}
                          >
                            📋
                          </button>
                        );
                      })()}
                      {/* R-PHONE-FAMILY-PERLINE: per-line carrier select */}
                      <select
                        value={line.carrier}
                        onChange={(e) => updateLine(line.id, 'carrier', e.target.value)}
                        className="input"
                        style={{
                          width: '110px',
                          fontSize: '0.75rem',
                          color: line.carrier ? lineCarrierColor : '#94a3b8',
                          fontWeight: line.carrier ? 700 : 400,
                          borderColor: line.carrier ? `${lineCarrierColor}66` : undefined,
                        }}
                      >
                        <option value="">{t('phonePay.carrierShort')}</option>
                        {carriers.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        name={`line-amount-${line.id}`}
                        autoComplete="off"
                        readOnly
                        onFocus={(e) => { e.currentTarget.readOnly = false; }}
                        value={line.amount}
                        onChange={(e) => updateLine(line.id, 'amount', e.target.value)}
                        placeholder="$0.00"
                        className="input" style={{ width: '80px' }}
                        step="0.01" min="0"
                      />
                      {/* Per-line portal button: opens THIS line's carrier portal,
                          adds THIS line to cart, removes from state. */}
                      <button
                        onClick={() => handlePortalForLine(line.id)}
                        disabled={!lineReady}
                        title={lineReady
                          ? t('phonePay.openCarrierPortal', line.carrier)
                          : t('phonePay.missingLineData')}
                        style={{
                          background: lineReady ? lineCarrierColor : 'rgba(255,255,255,0.05)',
                          color: lineReady ? '#fff' : '#475569',
                          border: 'none', borderRadius: '0.4rem',
                          padding: '0.45rem 0.65rem',
                          cursor: lineReady ? 'pointer' : 'not-allowed',
                          fontSize: '0.85rem', fontWeight: 700,
                          opacity: lineReady ? 1 : 0.5,
                        }}
                      >
                        📡
                      </button>
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(line.id)} style={{
                            background: 'transparent', border: 'none', color: '#ef4444',
                            cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem',
                          }}>✕</button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <button onClick={addLine} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
                    + {t('phonePay.addLine')}
                  </button>
                  {validLines.length > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#34d399' }}>
                      {t('phonePay.linesReadyCount', validLines.length)}
                    </span>
                  )}
                </div>
              </div>
            ) : !hasKnownLines ? (
              <div>
                <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
                  {t('phonePay.phoneNumberLabel')}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="tel"
                    className="input"
                    style={{ textAlign: 'center', fontSize: '1.1rem', letterSpacing: '0.05em', paddingRight: '3rem' }}
                    placeholder="(555) 123-4567"
                    value={phoneNumber || ''}
                    inputMode="numeric"
                    // R-PHONE-INPUT-TRUNCATION-FIX: was maxLength={10}; see
                    // multi-line input comment for context. sanitizePhone()
                    // performs the final 10-digit cap.
                    maxLength={20}
                    pattern="[0-9]*"
                    onChange={(e) => {
                      setPhoneNumber(sanitizePhone(e.target.value));
                      autoCopyPhone(e.target.value);
                    }}
                  />
                  {/* Auto-copied indicator */}
                  {phoneNumber.trim() && (
                    <span style={{
                      position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)',
                      fontSize: '0.75rem', fontWeight: 600,
                      color: copiedPhone === sanitizePhone(phoneNumber) ? '#22c55e' : '#475569',
                      transition: 'all 0.2s', pointerEvents: 'none',
                    }}>
                      {copiedPhone === sanitizePhone(phoneNumber) ? `✓ ${t('phonePay.copiedShort')}` : ''}
                    </span>
                  )}
                </div>
                {/* R-PHONE-AUTOFILL: shown when the typed-phone lookup
                    populated carrier / amount / name from CustomerDB or
                    sales history. Fades silently when phone is cleared. */}
                {autoFilledSnap && (
                  <div style={{
                    fontSize: '0.7rem', color: '#22c55e', marginTop: '0.3rem',
                    textAlign: 'center', fontWeight: 600,
                  }}>
                    ✓ {t('phonePay.autoFilled')}
                  </div>
                )}
                {/* R-PHONE-PAYMENT-REMINDER-TODAY-LAST-PAYMENT-BUBBLE-ANCHOR §2:
                    "Last payment" hint — real phone_payment history only,
                    never inferred from non-phone-payment purchases. */}
                {phoneNumber.trim().length === 10 && (
                  lastPhonePayment ? (
                    <div style={{
                      fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.35rem',
                      textAlign: 'center', fontWeight: 500,
                    }}>
                      📅 {t(
                        'phonePay.lastPayment',
                        new Date(lastPhonePayment.dateMs).toLocaleDateString(),
                        '$' + (lastPhonePayment.amountCents / 100).toFixed(2),
                      )}
                      {lastPhonePayment.carrier
                        ? ` · ${lastPhonePayment.carrier}`
                        : ''}
                    </div>
                  ) : (
                    <div style={{
                      fontSize: '0.7rem', color: '#64748b', marginTop: '0.35rem',
                      textAlign: 'center', fontWeight: 500, fontStyle: 'italic',
                    }}>
                      {t('phonePay.lastPaymentNone')}
                    </div>
                  )
                )}
                {/* R-INTELLIGENCE-CUSTOMER-TIMELINE-MEMORY §5: cadence /
                    streak / late hint. Pure rule output — only renders
                    when the customer has 2+ historical phone_payments. */}
                {customerTimeline && customerTimeline.cadence.paymentCount >= 2 && (
                  <div style={{
                    fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem',
                    textAlign: 'center', fontWeight: 500, display: 'flex',
                    flexWrap: 'wrap', justifyContent: 'center', gap: '0.4rem',
                  }}>
                    {customerTimeline.cadence.averageDaysBetween !== null && (
                      <span>🔁 {t('phonePay.cadence.usually', customerTimeline.cadence.averageDaysBetween)}</span>
                    )}
                    {customerTimeline.cadence.isLate && customerTimeline.cadence.cadenceDeltaDays !== null && customerTimeline.cadence.cadenceDeltaDays > 0 && (
                      <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                        ⏳ {t('phonePay.cadence.overdue', customerTimeline.cadence.cadenceDeltaDays)}
                      </span>
                    )}
                    {!customerTimeline.cadence.isLate && customerTimeline.cadence.onTimeStreak >= 3 && (
                      <span style={{ color: '#10b981', fontWeight: 600 }}>
                        ✓ {t('phonePay.cadence.onTimeStreak', customerTimeline.cadence.onTimeStreak)}
                      </span>
                    )}
                    {customerTimeline.cadence.skippedLikely && (
                      <span style={{ color: '#ef4444', fontWeight: 600 }}>
                        ⚠️ {t('phonePay.cadence.skipped')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </>

        {/* If customer HAS known lines (and toggle OFF), allow adding a
            brand-new number too. When toggle ON the user uses the normal
            multi-line UI with per-line carrier + portal instead.
            R-PHONE-MULTILINE-AUTOFILL-v3: uses INDEPENDENT state (newLinePhone /
            newLineAmount) instead of sharing phoneNumber/amount — prevents
            customer's primary phone from appearing pre-filled here. */}
        {hasKnownLines && !isMultiLine && (
          <details style={{ fontSize: '0.8rem' }}>
            <summary style={{ cursor: 'pointer', color: '#64748b', userSelect: 'none', padding: '0.25rem 0' }}>
              + {t('phonePay.addNewNumber')}
            </summary>
            <div style={{ paddingTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
              <input
                type="tel"
                className="input"
                style={{ flex: 1 }}
                placeholder={t('phonePay.newNumberPlaceholder')}
                value={newLinePhone}
                inputMode="numeric"
                // R-PHONE-INPUT-TRUNCATION-FIX: was maxLength={10}; see
                // multi-line input comment for context. sanitizePhone()
                // performs the final 10-digit cap.
                maxLength={20}
                pattern="[0-9]*"
                autoComplete="off"
                onChange={(e) => {
                  const clean = sanitizePhone(e.target.value);
                  setNewLinePhone(clean);
                  // R-PHONE-FAMILY-AUTOCOPY: same auto-copy as single-line input.
                  autoCopyPhone(clean);
                }}
              />
              <input
                type="number"
                className="input"
                style={{ width: '90px' }}
                placeholder="$0.00"
                value={newLineAmount}
                autoComplete="off"
                onChange={(e) => setNewLineAmount(e.target.value)}
                step="0.01" min="0"
              />
            </div>
          </details>
        )}

        {/* ── First / Last Name ─────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
              {t('phonePay.firstNameUpper')}
            </label>
            <input className="input" placeholder="John" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
              {t('phonePay.lastNameUpper')}
            </label>
            <input className="input" placeholder="Doe" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        {/* ── Payment Portal ───────────────────────────────── */}
        <div>
          <div style={{
            fontSize: '0.7rem', color: '#64748b', letterSpacing: '0.06em',
            fontWeight: 700, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#667eea', display: 'inline-block' }} />
            {t('phonePay.paymentPortalHeader')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem' }}>
            {PORTALS.map((p) => {
              const active = portal === p.id;
              return (
                <button key={p.id} onClick={() => setPortal(active ? '' : p.id)} style={{
                  padding: '0.6rem 0.4rem', borderRadius: '0.5rem',
                  border: `1px solid ${active ? p.color : 'rgba(255,255,255,0.1)'}`,
                  background: active ? `${p.color}26` : 'rgba(255,255,255,0.04)',
                  color: active ? p.color : '#94a3b8',
                  cursor: 'pointer', fontSize: '0.78rem', fontWeight: active ? 700 : 600,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
                  transition: 'all 0.15s',
                  boxShadow: active ? `0 0 0 2px ${p.color}40` : 'none',
                }}>
                  <span style={{ fontSize: '1rem' }}>{p.emoji}</span>
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Payment Amount (always visible — option C: kept even with known lines) ──
            When known lines exist, this acts as a quick-set value the user can
            type once and have it auto-applied to the auto-selected line via the
            useEffect below. When no known lines, it's the only amount input. */}
        {!isMultiLine && (
          <div>
            <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
              {t('phonePay.paymentAmount')}
            </label>
            <input
              type="number"
              className="input"
              style={{ textAlign: 'center', fontSize: '1.4rem', fontWeight: 700 }}
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01" min="0"
              autoComplete="off"
            />
            {hasKnownLines && selectedKnownCount === 1 && (
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem', textAlign: 'center' }}>
                {t('phonePay.amountAutoApplied')}
              </div>
            )}
          </div>
        )}

        {/* CC fee handled by Cart.tsx (single source of truth — % on subtotal). */}
        {/* Old toggle removed to prevent double-charge. */}

        {/* ── Commission preview ──────────────────────────── */}
        {/* R-PHONE-FAMILY-MULTILINE-TOTALS: gate on total commission (not
            global carrier) so mixed-carrier multi-line bundles still render
            the card even when no top-level carrier was picked.
            R-FINANCIAL-PRIVACY-PHONE-PAYMENT-LEAK: also gate on
            canSeeOwnerFinancials — commission is owner-only financial data
            and must be hidden from non-owner employees when the Financial
            Privacy toggle is on. Math, totals, and the cart write path are
            unaffected. Card disappears entirely (no $0 placeholder). */}
        {canSeeOwnerFinancials && breakdown.commissionCents > 0 && breakdown.commissionBreakdown.length > 0 && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: '0.625rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.88rem' }}>
                💰 {t('phonePay.yourCommission')}
              </div>
              {breakdown.commissionBreakdown.length === 1 ? (
                <div style={{ fontSize: '0.72rem', color: '#86efac', marginTop: '0.15rem' }}>
                  {breakdown.commissionBreakdown[0].carrier}: {(breakdown.commissionBreakdown[0].rate * 100).toFixed(0)}% {t('phonePay.commissionLabel')}
                </div>
              ) : (
                <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  {breakdown.commissionBreakdown.map((g) => (
                    <div key={g.carrier} style={{
                      fontSize: '0.72rem', color: '#86efac',
                      display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
                    }}>
                      <span>{g.carrier} {(g.rate * 100).toFixed(0)}%:</span>
                      <span>${(g.commissionCents / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#22c55e', marginLeft: '0.75rem' }}>
              ${breakdown.commission.toFixed(2)}
            </div>
          </div>
        )}

        {/* ── Payment breakdown preview ───────────────────── */}
        {breakdown.subtotal > 0 && (
          <div style={{
            padding: '0.85rem 1rem',
            background: 'rgba(59,130,246,0.08)',
            border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: '0.625rem',
            fontSize: '0.88rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', color: '#cbd5e1' }}>
              <span>{t('phonePay.billPaymentLabel')}{breakdown.lineCount > 1 ? ` (${breakdown.lineCount} ${t('phonePay.linesPlural')})` : ''}:</span>
              <span style={{ fontWeight: 600 }}>${breakdown.subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', color: '#94a3b8' }}>
              <span>{t('phonePay.utilityUsersTax')} ({(breakdown.utilRate * 100).toFixed(2)}%):</span>
              <span>+${breakdown.utilityTax.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', color: '#94a3b8' }}>
              <span>{t('phonePay.caMobilityFee')}{breakdown.lineCount > 1 ? ` × ${breakdown.lineCount}` : ''}:</span>
              <span>+${breakdown.mobilityTot.toFixed(2)}</span>
            </div>
            {/* CC fee row removed — Cart.tsx is the source of truth. */}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              paddingTop: '0.5rem', marginTop: '0.35rem',
              borderTop: '1px solid rgba(59,130,246,0.3)',
              fontSize: '1.05rem', fontWeight: 800, color: '#93c5fd',
            }}>
              <span>{t('phonePay.totalToCharge')}:</span>
              <span>${breakdown.total.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* ── Action Buttons ───────────────────────────────── */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={handleAddToCustomers} style={{
            flex: 1, minWidth: '100px', padding: '0.65rem 0.5rem',
            borderRadius: '0.625rem',
            border: `1px solid ${selectedCustomer ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.15)'}`,
            background: selectedCustomer ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.06)',
            color: selectedCustomer ? '#6ee7b7' : '#94a3b8',
            cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: 600,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
          }}
          title={selectedCustomer
            ? t('phonePay.updateCustomerTitle')
            : t('phonePay.addToCustomersTitle')}>
            <span>{selectedCustomer ? '✏️' : '👤'}</span>
            <span>
              {selectedCustomer
                ? t('phonePay.updateCustomerBtn')
                : t('phonePay.addToCustomersBtn')}
            </span>
          </button>

          <button onClick={handleClose} style={{
            flex: 1, padding: '0.65rem 0.5rem', borderRadius: '0.625rem',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: '#94a3b8', cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 600,
          }}>
            {t('cancel')}
          </button>

          <button onClick={reset} style={{
            padding: '0.65rem 0.75rem', borderRadius: '0.625rem',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem',
          }} title={t('clear')}>
            🗑️
          </button>

          <button onClick={handlePortal} disabled={!carrier} style={{
            padding: '0.65rem 0.875rem', borderRadius: '0.625rem',
            border: '1px solid rgba(102,126,234,0.4)',
            background: 'rgba(102,126,234,0.1)',
            color: carrier ? '#a5b4fc' : '#475569',
            cursor: carrier ? 'pointer' : 'not-allowed',
            fontSize: '0.85rem', fontWeight: 600,
          }}>
            Portal
          </button>

          <button onClick={handleAddToCart} disabled={!canAddToCart} style={{
            flex: 2, minWidth: '120px', padding: '0.65rem 1rem',
            borderRadius: '0.625rem', border: 'none',
            background: canAddToCart
              ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              : 'rgba(255,255,255,0.1)',
            color: canAddToCart ? 'white' : '#475569',
            cursor: canAddToCart ? 'pointer' : 'not-allowed',
            fontSize: '0.9rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
          }}>
            {t('addToCart')} →
          </button>
        </div>

        </div>)} {/* end modalTab === 'payment' */}

      </div>

      {/* ── Phone Selector (customer with multiple phones[]) ── */}
      {phoneSelectorCustomer && (() => {
        const c = phoneSelectorCustomer;
        const allPhones = Array.isArray((c as any).phones) ? ((c as any).phones as string[]) : [];
        const validPhones = Array.from(new Set(allPhones.map((p) => (p || '').trim()).filter(Boolean)));
        const allCarriers = Array.isArray((c as any).carriers) ? ((c as any).carriers as string[]) : [];
        return (
          <div
            onClick={() => setPhoneSelectorCustomer(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 1100,
              background: 'rgba(0,0,0,0.75)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '1rem',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#1e293b',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '1rem',
                width: '100%', maxWidth: '420px',
                padding: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
                  📞 {t('phonePay.selectLine')}
                </h3>
                <button onClick={() => setPhoneSelectorCustomer(null)} style={{
                  background: 'none', border: 'none', color: '#94a3b8',
                  fontSize: '1.25rem', cursor: 'pointer',
                }}>✕</button>
              </div>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
                {t('phonePay.customerHasLinesPrompt', c.name, validPhones.length)}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {validPhones.map((p, idx) => {
                  const carrierForLine = allCarriers[idx] || '';
                  return (
                    <button
                      key={`${p}-${idx}`}
                      onClick={() => {
                        // R-PHONE-FAMILY-MULTICUST: multi-line path appends a
                        // line per customer-phone selected, single-line path
                        // replaces the global form state as before.
                        if (isMultiLine) {
                          // Temporarily stamp the customer's carriers[idx] as
                          // primary so addCustomerLineToMulti reads it for the line.
                          const withPickedCarrier = carrierForLine
                            ? ({ ...c, carriers: [carrierForLine, ...((c as any).carriers || [])] } as Customer)
                            : c;
                          addCustomerLineToMulti(withPickedCarrier, p);
                        } else {
                          applyCustomerSelection(c, p);
                          if (carrierForLine) setCarrier(carrierForLine);
                        }
                        setPhoneSelectorCustomer(null);
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0.75rem 1rem',
                        borderRadius: '0.625rem',
                        border: '1px solid rgba(102,126,234,0.3)',
                        background: 'rgba(102,126,234,0.08)',
                        color: '#e2e8f0', cursor: 'pointer',
                        fontSize: '0.95rem', fontWeight: 600,
                        transition: 'all 0.15s',
                      }}
                    >
                      <span style={{ fontFamily: 'monospace' }}>{formatPhone(p)}</span>
                      {carrierForLine && (
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '0.3rem',
                          background: 'rgba(255,255,255,0.08)',
                          color: '#a5b4fc',
                        }}>
                          {carrierForLine}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setPhoneSelectorCustomer(null)}
                style={{
                  width: '100%', marginTop: '0.75rem',
                  padding: '0.55rem', borderRadius: '0.5rem',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#94a3b8', cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Customer Form Modal (add / update from within phone payment) ── */}
      {showCustomerForm && (
        <CustomerFormModal
          customer={selectedCustomer || ({
            // Stub with pre-filled values from the phone payment form
            id: '',
            firstName,
            lastName,
            name: `${firstName} ${lastName}`.trim(),
            phone: phoneNumber,
            phones: phoneNumber ? [phoneNumber] : [''],
            carrier,
            carriers: carrier ? [carrier] : [''],
            email: '',
            loyaltyPoints: 0,
            storeCredit: 0,
            customerNumber: '',
            notes: '',
            communicationConsent: false,
            createdAt: '',
          } as unknown as Customer)}
          onSave={handleSaveCustomer}
          onClose={() => setShowCustomerForm(false)}
        />
      )}
    </Modal>
  );
}
