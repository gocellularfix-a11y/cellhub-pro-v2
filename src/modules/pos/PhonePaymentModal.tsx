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
import { useApp } from '@/store/AppProvider';
import { loadLocal, saveLocal } from '@/services/storage';
import { formatCurrency } from '@/utils/currency';
import { normalizeCarrier, normalizePhone, formatPhone } from '@/utils/normalize';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { generateId } from '@/utils/dates';
import { persist } from '@/services/persist';
import { CustomerFormModal } from '@/modules/customers/CustomerModule';
import { getActivePortals, getDefaultPortalId, type PaymentPortal } from '@/config/paymentPortals';
import type { CartItem, StoreSettings, Customer, Sale } from '@/store/types';
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
}

export default function PhonePaymentModal({
  open, onClose, settings, cart, setCart, customers, setCustomers, sales, lang, L,
}: Props) {
  const es = lang === 'es';
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
  const [actSpiff, setActSpiff] = useState('0'); // pre-populated from settings.carrierSpiffs[carrier] when carrier selected

  // ── Customer search ───────────────────────────────────────
  const [custSearch, setCustSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustDropdown, setShowCustDropdown] = useState(false);

  // ── Form fields ───────────────────────────────────────────
  const [carrier, setCarrier] = useState('');
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  // Auto-copy phone to clipboard when a valid 10-digit number is set
  // (from manual entry, customer selection, or known line toggle).
  // v2: use isValidPhone helper so all 10-digit checks stay centralized.
  const autoCopyPhone = useCallback((raw: string) => {
    if (!isValidPhone(raw)) return;
    const digits = sanitizePhone(raw);
    navigator.clipboard.writeText(digits).then(() => {
      setCopiedPhone(digits);
      setTimeout(() => setCopiedPhone(null), 2000);
    }).catch(() => {});
  }, []);
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

  // Auto-populate spiff default from settings.carrierSpiffs when activation carrier changes
  useEffect(() => {
    if (!actCarrier || !settings.trackActivationSpiffs) {
      setActSpiff('0');
      return;
    }
    const normalized = normalizeCarrier(actCarrier);
    const def = settings.carrierSpiffs?.[actCarrier] ?? settings.carrierSpiffs?.[normalized] ?? 0;
    setActSpiff(String(def));
  }, [actCarrier, settings.trackActivationSpiffs, settings.carrierSpiffs]);

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
  const { pendingPhonePaymentCustomerId } = appState;
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

  // ── Which known-line rows are checked (for multi-select) ─
  // key: normalized phone, value: amount string
  const [selectedKnownLines, setSelectedKnownLines] = useState<Record<string, string>>({});

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
    setPhoneNumber(sanitizePhone(chosenPhone || c.phone || ''));
    const primaryCarrier = (c as any).carriers?.[0] || (c as any).carrier || '';
    if (primaryCarrier) setCarrier(primaryCarrier);
    const mp = (c as any).monthlyPayment;
    if (mp) setAmount(String(mp));
    setSelectedKnownLines({});
  };

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

  // ── Toggle a known line on/off ────────────────────────────
  const toggleKnownLine = (norm: string) => {
    setSelectedKnownLines((prev) => {
      const next = { ...prev };
      if (next[norm] !== undefined) {
        delete next[norm];
      } else {
        next[norm] = '';
        // Auto-copy to clipboard when checking a line
        autoCopyPhone(norm);
      }
      return next;
    });
    // Auto-switch to multi-line mode if more than one line selected
    setIsMultiLine(true);
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
    setNewLinePhone('');
    setNewLineAmount('');
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
        items.push({
          id: generateId(),
          name: `${normalizedCarrier} - ${formatPhone(phone)}`,
          category: 'phone_payment',
          price: Math.round(parseFloat(line.amount) * 100),
          qty: 1, taxable: false, cbeEligible: false,
          carrier: normalizedCarrier, phoneNumber: phone,
          // R-PHONE-FAMILY-MULTILINE-TOTALS: persist per-line rate so historical
          // reports (sum of item.price × item.commissionRate) match the preview.
          // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain (was `?? 0` —
          // silent zero corrupted reports when carrier missing from settings).
          commissionRate: (settings.carrierCommissions?.[normalizedCarrier]
            ?? settings.defaultCommissionRate
            ?? 0.07),
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
        toast(
          es
            ? 'El número de teléfono debe tener 10 dígitos'
            : 'Phone number must be 10 digits',
          'error',
        );
        return [];
      }
      const digits = sanitizePhone(phoneNumber);
      if (parseFloat(amount) <= 0) return [];
      items.push({
        id: generateId(),
        name: `${normalizedCarrier} - ${formatPhone(digits)}`,
        category: 'phone_payment',
        price: Math.round(parseFloat(amount) * 100),
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
        commissionRate: (settings.carrierCommissions?.[normalizedCarrier]
          ?? settings.defaultCommissionRate
          ?? 0.07),
        notes: customerNote,
      });
    }

    if (items.length === 0) return [];

    // Cart auto-applies utility tax + mobility surcharge for category 'phone_payment'
    // (see calculateCartTotals in types.ts). DO NOT push them as separate items here
    // or the customer gets double-charged.
    return items;
  }, [carrier, isMultiLine, knownLines, validLines, phoneNumber, amount,
      firstName, lastName, breakdown, es, toast]);

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
      toast(
        es
          ? 'El teléfono del cliente debe tener 10 dígitos'
          : 'Customer phone must be 10 digits',
        'error',
      );
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
      window.open(url, winName, 'noopener,noreferrer');
    }
    const nextCart = [...cartRef.current, ...newItems];
    cartRef.current = nextCart;
    setCart(nextCart);
    reset();
    onClose();
  }, [carrier, settings, buildCartItems, setCart, onClose]);

  // ── Add to cart ───────────────────────────────────────────
  const handleAddToCart = useCallback(() => {
    if (!canAddToCart) return;
    const newItems = buildCartItems();
    if (!newItems.length) return;
    const nextCart = [...cartRef.current, ...newItems];
    cartRef.current = nextCart;
    setCart(nextCart);
    reset();
    onClose();
  }, [canAddToCart, buildCartItems, setCart, onClose]);

  // R-PHONE-FAMILY-PERLINE: per-line portal handler — multi-line mode.
  // Processes ONE line at a time: validates, builds its cart item with
  // ITS carrier, opens that carrier's portal, adds to cart, removes
  // the line from state. When the last line is processed, closes modal.
  const handlePortalForLine = useCallback((lineId: string) => {
    const line = lines.find((l) => l.id === lineId);
    if (!line) return;
    if (!line.carrier) {
      toast(es ? 'Selecciona carrier para esta línea' : 'Pick a carrier for this line', 'error');
      return;
    }
    if (!isValidPhone(line.number)) {
      toast(es ? 'Número inválido (10 dígitos)' : 'Invalid phone (10 digits)', 'error');
      return;
    }
    const amt = parseFloat(line.amount);
    if (!amt || amt <= 0) {
      toast(es ? 'Monto inválido' : 'Invalid amount', 'error');
      return;
    }

    const normCarrier = normalizeCarrier(line.carrier);
    const phone = sanitizePhone(line.number);
    // R-PHONE-FAMILY-MULTICUST: attribute the cart-item note to this line's
    // customer (set when a customer was picked via the searchbar in multi mode)
    // and fall back to the global note for manually typed lines.
    const customerNote = line.customerName || `${firstName} ${lastName}`.trim();

    const newItem: CartItem = {
      id: generateId(),
      name: `${normCarrier} - ${formatPhone(phone)}`,
      category: 'phone_payment',
      price: Math.round(amt * 100),
      qty: 1,
      taxable: false,
      cbeEligible: false,
      carrier: normCarrier,
      phoneNumber: phone,
      notes: customerNote,
      // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain (no silent zero).
      commissionRate: (settings.carrierCommissions?.[normCarrier]
        ?? settings.defaultCommissionRate
        ?? 0.07),
    };

    // Open this carrier's portal (if URL configured).
    const url = settings.carrierPortalUrls?.[normCarrier];
    if (url) {
      const c = normCarrier.toLowerCase();
      const winName = (c.includes('att') || url.includes('qpay') || url.includes('myrtpay'))
        ? 'qpayWindow' : 'externalPortalWindow';
      window.open(url, winName, 'noopener,noreferrer');
    }

    // Commit to cart.
    const nextCart = [...cartRef.current, newItem];
    cartRef.current = nextCart;
    setCart(nextCart);

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
  }, [lines, firstName, lastName, settings, setCart, onClose, es, toast]);

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

  const canAddActivation =
    !!actCarrier &&
    actPhoneValid &&
    ((parseFloat(actAmount) || 0) > 0 || (parseFloat(actPlanPrice) || 0) > 0);

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
      newItems.push({
        id: generateId(),
        name: `📱 ${es ? 'Plan' : 'Plan'} ${normalizedCarrier}${planLabel}`,
        category: 'phone_payment',
        price: planPriceCents,
        qty: 1,
        taxable: false,
        cbeEligible: false,
        carrier: normalizedCarrier,
        phoneNumber: phoneNorm,
        notes: [customerNote, actNotes.trim()].filter(Boolean).join(' — '),
        // R-COMMISSION-FIX-WRITE-AND-READ: full fallback chain (no silent zero).
        commissionRate: (settings.carrierCommissions?.[normalizedCarrier]
          ?? settings.defaultCommissionRate
          ?? 0.07),
      });
    }

    // ── Item 2: Activation / SIM / setup fee — 100% profit for the owner ──
    // No commission, no utility tax, no mobility fee. Fixed price.
    if (amountCents > 0) {
      newItems.push({
        id: generateId(),
        name: `⚡ ${es ? 'Cargo de Activación' : 'Activation Fee'} ${normalizedCarrier}${planLabel}`,
        category: 'activation',
        price: amountCents,
        qty: 1,
        taxable: false,
        cbeEligible: false,
        carrier: normalizedCarrier,
        phoneNumber: phoneNorm,
        notes: [customerNote, actNotes.trim()].filter(Boolean).join(' — '),
      });
    }

    const nextCart = [...cartRef.current, ...newItems];
    cartRef.current = nextCart;
    setCart(nextCart);

    // Persist spiff (INTERNAL — does NOT touch cart, reported separately in Taxes)
    if (spiffCents > 0 && settings.trackActivationSpiffs) {
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

    // Reset all activation fields
    setActCarrier('');
    setActPhone(''); setActPlan(''); setActPlanPrice(''); setActAmount(''); setActNotes(''); setActSpiff('0');
    // Also reset main panel fields to avoid data leak between transactions
    reset();
    onClose();
  }, [canAddActivation, actCarrier, actPhone, actPlan, actPlanPrice, actAmount, actNotes, actSpiff,
      actCommissionCents, settings, setCart, onClose, es, firstName, lastName]);

  const handleOpenActivationPortal = () => {
    // Try both raw and normalized carrier name as keys
    const normalizedActCarrier = normalizeCarrier(actCarrier);
    const url = settings.carrierPortalUrls?.[actCarrier]
             || settings.carrierPortalUrls?.[normalizedActCarrier];
    if (url) { window.open(url, '_blank'); return; }
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
    if (fallback) window.open(fallback, '_blank');
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`📱 ${es ? 'Telefonía' : 'Phone Services'}`}
      size="max-w-xl"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* ── Tab switcher ─────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '0.375rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.625rem', padding: '0.25rem' }}>
          {[
            { id: 'payment',    label: es ? '💳 Pago de Factura' : '💳 Bill Payment' },
            { id: 'activation', label: es ? '⚡ Nueva Activación' : '⚡ New Activation' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setModalTab(t.id as any)}
              style={{
                flex: 1, padding: '0.5rem', borderRadius: '0.5rem', cursor: 'pointer',
                fontWeight: modalTab === t.id ? 700 : 400, fontSize: '0.82rem',
                border: 'none',
                background: modalTab === t.id ? 'rgba(102,126,234,0.25)' : 'transparent',
                color: modalTab === t.id ? '#a5b4fc' : '#64748b',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
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
                🔍 <span>{es ? 'Buscar cliente (nombre, teléfono, #)' : 'Search customer (name, phone, #)'}</span>
              </div>
              <input
                className="input"
                placeholder={es ? 'Escribe para buscar...' : 'Start typing...'}
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
                  {es ? 'Nombre' : 'First name'}
                </label>
                <input className="input" value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder={es ? 'Nombre' : 'First'} />
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {es ? 'Apellido' : 'Last name'}
                </label>
                <input className="input" value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder={es ? 'Apellido' : 'Last'} />
              </div>
            </div>

            {/* Carrier selector */}
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>
                {es ? 'Carrier *' : 'Carrier *'}
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

            {/* Commission preview */}
            {actCarrier && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.625rem 0.875rem',
                background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: '0.625rem',
              }}>
                <span style={{ fontSize: '1.1rem' }}>💰</span>
                <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                  {es ? 'Comisión estimada' : 'Est. commission'}:
                  <strong style={{ color: '#22c55e', marginLeft: '0.35rem' }}>
                    {((settings.carrierCommissions?.[normalizeCarrier(actCarrier)] ?? 0) * 100).toFixed(0)}%
                    {actCommissionCents > 0 && ` = ${formatCurrency(actCommissionCents)}`}
                  </strong>
                </div>
                {actCarrier && (
                  <button onClick={handleOpenActivationPortal}
                    style={{
                      marginLeft: 'auto', padding: '0.25rem 0.625rem',
                      background: 'rgba(102,126,234,0.15)', border: '1px solid rgba(102,126,234,0.3)',
                      borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.72rem',
                      color: '#a5b4fc', fontWeight: 600,
                    }}>
                    🔗 {es ? 'Abrir Portal' : 'Open Portal'}
                  </button>
                )}
              </div>
            )}

            {/* Spiff — visible whenever tracking is enabled in Settings.
                Autopopulates from settings.carrierSpiffs[carrier] once carrier is picked. */}
            {settings.trackActivationSpiffs && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.625rem 0.875rem',
                background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)',
                borderRadius: '0.625rem',
              }}>
                <span style={{ fontSize: '1.1rem' }}>🎯</span>
                <div style={{ fontSize: '0.82rem', color: '#94a3b8', flex: 1 }}>
                  <strong style={{ color: '#fbbf24' }}>Spiff</strong>
                  <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', color: '#64748b' }}>
                    {es ? '(bono interno del carrier — no cobrado al cliente)' : '(internal carrier bonus — not charged to customer)'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>$</span>
                  <input
                    type="number" min="0" step="1"
                    value={actSpiff}
                    onChange={(e) => setActSpiff(e.target.value)}
                    disabled={!actCarrier}
                    placeholder={actCarrier ? '0' : '—'}
                    style={{
                      width: '80px', padding: '0.25rem 0.5rem', textAlign: 'right',
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '0.375rem',
                      color: actCarrier ? '#fbbf24' : '#64748b',
                      fontWeight: 700, fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Phone + Plan grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {es ? 'Número de teléfono *' : 'Phone number *'}
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
                    {es ? '10 dígitos requeridos' : '10 digits required'}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {es ? 'Plan / descripción' : 'Plan / description'}
                </label>
                <input
                  className="input"
                  value={actPlan}
                  onChange={(e) => setActPlan(e.target.value)}
                  placeholder={es ? 'ej. Plan $45 Unlimited' : 'e.g. $45 Unlimited Plan'}
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
                  {es ? 'Costo del plan ($)' : 'Plan price ($)'}
                </label>
                <input className="input" type="number" min="0" step="0.01"
                  value={actPlanPrice} onChange={(e) => setActPlanPrice(e.target.value)}
                  placeholder="0.00" />
                <p style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.2rem' }}>
                  {es ? 'Primer mes del plan' : 'First month of plan'}
                </p>
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                  {es ? 'Cargo de activación ($) *' : 'Activation fee ($) *'}
                </label>
                <input className="input" type="number" min="0" step="0.01"
                  value={actAmount} onChange={(e) => setActAmount(e.target.value)}
                  placeholder="0.00" />
                <p style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.2rem' }}>
                  {es ? 'SIM / setup' : 'SIM / setup'}
                </p>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                {es ? 'Notas internas' : 'Internal notes'}
              </label>
              <input className="input" value={actNotes}
                onChange={(e) => setActNotes(e.target.value)}
                placeholder={es ? 'IMEI, notas de activación...' : 'IMEI, activation notes...'} />
            </div>

            {/* Add to cart */}
            <button
              onClick={handleAddActivation}
              disabled={!canAddActivation}
              className="btn btn-success"
              style={{ fontSize: '1rem', padding: '0.75rem', marginTop: '0.25rem' }}
            >
              🛒 {es ? 'Agregar al Carrito' : 'Add to Cart'}
              {(() => {
                const plan = parseFloat(actPlanPrice) || 0;
                const fee  = parseFloat(actAmount) || 0;
                // If plan > 0, add utility tax + mobility (same as bill payment)
                const utilRate = settings.utilityUsersTax || 0.055;
                const mobility = settings.mobileSurcharge || 0.41;
                const planExtras = plan > 0 ? (plan * utilRate + mobility) : 0;
                const total = plan + fee + planExtras;
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
            🔍 <span>{es ? 'Buscar cliente (nombre, teléfono, #)' : 'Search customer (name, phone, #)'}</span>
          </div>
          <input
            className="input"
            placeholder={es ? 'Escribe para buscar...' : 'Start typing...'}
            value={custSearch}
            onChange={(e) => {
              setCustSearch(e.target.value);
              setShowCustDropdown(true);
              setSelectedCustomer(null);
              setSelectedKnownLines({});
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
                  · {knownLines.length} {es ? 'línea(s) conocida(s)' : `known line${knownLines.length > 1 ? 's' : ''}`}
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
                × {es ? 'Cambiar cliente' : 'Change customer'}
              </button>
            </div>
          )}
        </div>

        {/* ── Carrier Buttons ─────────────────────────────── */}
        <div>
          <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
            {es ? 'Seleccionar Carrier' : 'Select Carrier'}
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
                📋 {es ? 'Líneas conocidas' : 'Known lines'} — {selectedCustomer?.name}
              </span>
              {selectedKnownCount > 0 && (
                <span style={{
                  fontSize: '0.7rem', background: 'rgba(102,126,234,0.3)',
                  color: '#c7d2fe', padding: '0.15rem 0.5rem', borderRadius: '999px',
                }}>
                  {selectedKnownCount} {es ? 'seleccionada(s)' : 'selected'}
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
                    {/* Formatted phone — click to copy */}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        autoCopyPhone(norm);
                      }}
                      title={es ? 'Click para copiar' : 'Click to copy'}
                      style={{
                        fontSize: '0.9rem', fontFamily: 'monospace',
                        color: copiedPhone === norm ? '#22c55e' : (isChecked ? '#e2e8f0' : '#94a3b8'),
                        flex: 1, letterSpacing: '0.04em',
                        cursor: 'pointer',
                        transition: 'color 0.2s',
                        userSelect: 'all',
                      }}
                    >
                      {copiedPhone === norm ? `✓ ${es ? 'Copiado!' : 'Copied!'}` : formatPhone(norm)}
                    </span>
                    {/* Copied badge when checked */}
                    {isChecked && copiedPhone === norm && (
                      <span style={{ fontSize: '0.7rem', color: '#22c55e', fontWeight: 600, flexShrink: 0 }}>
                        📋 {es ? 'Listo' : 'Ready'}
                      </span>
                    )}
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
                  {selectedKnownCount} {es ? 'líneas' : 'lines'}
                </span>
                <span style={{ color: '#a5b4fc', fontWeight: 700 }}>
                  ${Object.values(selectedKnownLines)
                    .reduce((s, v) => s + (parseFloat(v) || 0), 0)
                    .toFixed(2)}
                  {' '}{es ? 'total' : 'total'}
                </span>
              </div>
            )}
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
                  👨‍👩‍👧 {es ? 'Plan Familiar / Multi-Línea' : 'Family Plan / Multi-Line'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {es ? 'Agregar múltiples líneas a la vez' : 'Add multiple lines at once'}
                </div>
              </div>
            </label>

            {/* Phone fields */}
            {isMultiLine ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  {es ? 'Líneas' : 'Lines'}
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
                        maxLength={10}
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
                        placeholder={es ? 'Número' : 'Phone'}
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
                                toast(
                                  es
                                    ? `Número copiado: ${formatPhone(clean)}`
                                    : `Number copied: ${formatPhone(clean)}`,
                                  'success',
                                );
                              }).catch(() => {
                                toast(
                                  es
                                    ? 'No se pudo copiar al portapapeles'
                                    : 'Could not copy to clipboard',
                                  'error',
                                );
                              });
                            }}
                            disabled={!lineValid}
                            title={es ? 'Copiar número' : 'Copy number'}
                            aria-label={es ? 'Copiar número al portapapeles' : 'Copy number to clipboard'}
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
                        <option value="">{es ? 'Carrier…' : 'Carrier…'}</option>
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
                          ? (es ? `Abrir portal de ${line.carrier}` : `Open ${line.carrier} portal`)
                          : (es ? 'Faltan datos en la línea' : 'Missing line data')}
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
                    + {es ? 'Agregar Línea' : 'Add Line'}
                  </button>
                  {validLines.length > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#34d399' }}>
                      {validLines.length} {es ? 'línea(s) lista(s)' : `line${validLines.length > 1 ? 's' : ''} ready`}
                    </span>
                  )}
                </div>
              </div>
            ) : !hasKnownLines ? (
              <div>
                <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
                  {es ? 'Número de Teléfono' : 'Phone Number'}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="tel"
                    className="input"
                    style={{ textAlign: 'center', fontSize: '1.1rem', letterSpacing: '0.05em', paddingRight: '3rem' }}
                    placeholder="(555) 123-4567"
                    value={phoneNumber || ''}
                    inputMode="numeric"
                    maxLength={10}
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
                      {copiedPhone === sanitizePhone(phoneNumber) ? '✓ Copied' : ''}
                    </span>
                  )}
                </div>
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
              + {es ? 'Agregar número nuevo' : 'Add a new number'}
            </summary>
            <div style={{ paddingTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
              <input
                type="tel"
                className="input"
                style={{ flex: 1 }}
                placeholder={es ? 'Número nuevo' : 'New number'}
                value={newLinePhone}
                inputMode="numeric"
                maxLength={10}
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
              {es ? 'Nombre' : 'First Name'}
            </label>
            <input className="input" placeholder="John" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
              {es ? 'Apellido' : 'Last Name'}
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
            {es ? 'PORTAL DE PAGO' : 'PAYMENT PORTAL'}
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
              {es ? 'Monto de Pago ($)' : 'Payment Amount ($)'}
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
                {es
                  ? '↑ Este monto se aplica automáticamente a la línea seleccionada arriba'
                  : '↑ This amount is auto-applied to the selected line above'}
              </div>
            )}
          </div>
        )}

        {/* CC fee handled by Cart.tsx (single source of truth — % on subtotal). */}
        {/* Old toggle removed to prevent double-charge. */}

        {/* ── Commission preview ──────────────────────────── */}
        {/* R-PHONE-FAMILY-MULTILINE-TOTALS: gate on total commission (not
            global carrier) so mixed-carrier multi-line bundles still render
            the card even when no top-level carrier was picked. */}
        {breakdown.commissionCents > 0 && breakdown.commissionBreakdown.length > 0 && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: '0.625rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.88rem' }}>
                💰 {es ? 'Tu Comisión' : 'Your Commission'}
              </div>
              {breakdown.commissionBreakdown.length === 1 ? (
                <div style={{ fontSize: '0.72rem', color: '#86efac', marginTop: '0.15rem' }}>
                  {breakdown.commissionBreakdown[0].carrier}: {(breakdown.commissionBreakdown[0].rate * 100).toFixed(0)}% {es ? 'comisión' : 'commission'}
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
              <span>{es ? 'Pago de Factura' : 'Bill Payment'}{breakdown.lineCount > 1 ? ` (${breakdown.lineCount} ${es ? 'líneas' : 'lines'})` : ''}:</span>
              <span style={{ fontWeight: 600 }}>${breakdown.subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', color: '#94a3b8' }}>
              <span>{es ? 'Impuesto de Servicios' : 'Utility Users Tax'} ({(breakdown.utilRate * 100).toFixed(2)}%):</span>
              <span>+${breakdown.utilityTax.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', color: '#94a3b8' }}>
              <span>{es ? 'Recargo Móvil CA' : 'CA Mobility Fee'}{breakdown.lineCount > 1 ? ` × ${breakdown.lineCount}` : ''}:</span>
              <span>+${breakdown.mobilityTot.toFixed(2)}</span>
            </div>
            {/* CC fee row removed — Cart.tsx is the source of truth. */}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              paddingTop: '0.5rem', marginTop: '0.35rem',
              borderTop: '1px solid rgba(59,130,246,0.3)',
              fontSize: '1.05rem', fontWeight: 800, color: '#93c5fd',
            }}>
              <span>{es ? 'Total a Cobrar' : 'Total to Charge'}:</span>
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
            ? (es ? 'Actualizar información del cliente' : 'Update customer information')
            : (es ? 'Agregar este número a Clientes' : 'Add this number to Customers')}>
            <span>{selectedCustomer ? '✏️' : '👤'}</span>
            <span>
              {selectedCustomer
                ? (es ? 'Actualizar Cliente' : 'Update Customer')
                : (es ? 'Agregar Cliente' : 'Add to Customers')}
            </span>
          </button>

          <button onClick={handleClose} style={{
            flex: 1, padding: '0.65rem 0.5rem', borderRadius: '0.625rem',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: '#94a3b8', cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 600,
          }}>
            {es ? 'Cancelar' : 'Cancel'}
          </button>

          <button onClick={reset} style={{
            padding: '0.65rem 0.75rem', borderRadius: '0.625rem',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem',
          }} title={es ? 'Limpiar' : 'Clear'}>
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
            {es ? 'Portal' : 'Portal'}
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
            {es ? 'Agregar al Carrito' : 'Add to Cart'} →
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
                  📞 {es ? 'Selecciona Línea' : 'Select Line'}
                </h3>
                <button onClick={() => setPhoneSelectorCustomer(null)} style={{
                  background: 'none', border: 'none', color: '#94a3b8',
                  fontSize: '1.25rem', cursor: 'pointer',
                }}>✕</button>
              </div>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
                {es
                  ? `${c.name} tiene ${validPhones.length} líneas. ¿Cuál vas a usar?`
                  : `${c.name} has ${validPhones.length} lines. Which one?`}
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
                {es ? 'Cancelar' : 'Cancel'}
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
          lang={lang}
          L={L}
        />
      )}
    </Modal>
  );
}
