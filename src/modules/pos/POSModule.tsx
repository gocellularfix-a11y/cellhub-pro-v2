// ============================================================
// CellHub Pro — POS Module (Main Orchestrator)
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, SearchInput, Modal } from '@/components/ui';
import CustomerPicker from '@/components/shared/CustomerPicker';
import { getLabels } from '@/config/i18n';
import { useTranslation } from '@/i18n';
import { generateId } from '@/utils/dates';
import { formatCurrency } from '@/utils/currency';
import { normalizePhone } from '@/utils/normalize';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { loadLocal, saveLocal } from '@/services/storage';

import QuickActionGrid from './QuickActionGrid';
import ProductGrid from './ProductGrid';
import QuickServicePanel from './QuickServicePanel';
import { emitCustomerSelected, emitItemAdded } from '@/services/intelligence/liveContext/liveContextEvents';
import Cart from './Cart';
import PhonePaymentModal from './PhonePaymentModal';
import PaymentModal from './PaymentModal';
import ReceiptModal from './ReceiptModal';
import CredentialMakerModal from './CredentialMakerModal';
import NotepadModal from './NotepadModal';
import EstimateModal from './EstimateModal';
import RMALabelModal from './RMALabelModal';
import PriceLabelsModal from '../priceLabels/PriceLabelsModal';
import TopUpModal from './TopUpModal';
import ApplyStoreCreditModal from './ApplyStoreCreditModal';
import type { CartTotals, DiscountState, CustomCategory, calculateCartTotals } from './types';
import { calculateCartTotals as calcTotals } from './types';
import type { Customer, Sale, InventoryItem, CartItem, StoreCreditLedger, PendingExchangeReturn } from '@/store/types';

import { persist, batchSave } from '@/services/persist';
import { recordTopUpsToCustomer } from '@/utils/topUpHistory';
import { addLayawayPayment } from '@/services/layaway/payments';
import { redeemLedgerEntry } from '@/services/storeCredit/ledger';
import { finalizeExchangeReturn } from '@/services/returns/finalizeExchangeReturn';
import { forwardTaxFromBase } from '@/utils/depositTax';
import { buildSale, computePaidCents } from './saleBuilder';
import { isTaxableCheckoutBlocked } from './taxConfirmGuard';
import { finalizeSaleCore } from './finalizeSaleCore';
import { sendPosCheckout, requestMirrorResync } from '@/services/lan/lanService';
import { isLanSecondaryReadOnly } from '@/hooks/useLanReadOnly';
import { addVerification } from '@/services/intelligence/paymentVerification/paymentVerificationService';
import { trackWorkflowStart, clearWorkflowTrack } from '@/services/intelligence/continuity/continuityEngine';

// Case-insensitive category predicates — single source of truth so bundle
// suggestion, search icon, and category filter all agree on what counts as
// a phone/accessory regardless of how inventory was entered (e.g. "Phone"
// vs "phone" vs "PHONES").
const isPhoneCategory = (i: InventoryItem): boolean => {
  const c = (i.category || '').toLowerCase();
  return c === 'phone' || c === 'phones';
};
const isAccessoryCategory = (i: InventoryItem): boolean => {
  const c = (i.category || '').toLowerCase();
  return c === 'accessory' || c === 'accessories';
};

export default function POSModule() {
  const {
    state: {
      inventory, customers, sales, repairs, specialOrders, unlocks, layaways,
      settings, currentEmployee, cart, lang, inventorySearchTerm, pendingPhonePaymentCustomerId,
      pendingPosCustomer, storeCreditLedger, customerReturns,
    },
    setCart, setInventory, setCustomers, setSales,
    setRepairs, setSpecialOrders, setUnlocks, setLayaways, dispatch,
    setStoreCreditLedger, setCustomerReturns,
  } = useApp();

  const { toast } = useToast();
  const { t } = useTranslation();
  const L = getLabels(lang); // kept for prop drilling to PhonePaymentModal (not yet migrated)

  // ── Stale-closure guards: ref-mirrors of state arrays so back-to-back
  // updates within handleCompleteSale (and from rapid scanner input in addToCart)
  // don't pisarse mutually. Critical for POS — every sale touches multiple
  // arrays in sequence.
  const salesRef = useRef(sales);
  const inventoryRef = useRef(inventory);
  const customersRef = useRef(customers);
  const repairsRef = useRef(repairs);
  // r-deposit-integrity-1 P1: refs for linked-entity reconciliation in
  // handleCompleteSale. POSModule is now the single source of truth for
  // incrementing depositAmount/paidAmount — modules persist with 0 at
  // creation, POS reconciles on checkout. See Step 4 in handleCompleteSale.
  const specialOrdersRef = useRef(specialOrders);
  const unlocksRef = useRef(unlocks);
  const layawaysRef = useRef(layaways);
  const cartRef = useRef(cart);
  useEffect(() => { salesRef.current = sales; }, [sales]);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { repairsRef.current = repairs; }, [repairs]);
  useEffect(() => { specialOrdersRef.current = specialOrders; }, [specialOrders]);
  useEffect(() => { unlocksRef.current = unlocks; }, [unlocks]);
  useEffect(() => { layawaysRef.current = layaways; }, [layaways]);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  // R-STORE-CREDIT-REDEMPTION-SYSTEM
  const storeCreditLedgerRef = useRef(storeCreditLedger);
  useEffect(() => { storeCreditLedgerRef.current = storeCreditLedger; }, [storeCreditLedger]);
  // R-RETURNS-PHASE-2B: ref-mirror so exchange-return finalization in
  // handleCompleteSale sees the freshest returns array (idempotency guard).
  const customerReturnsRef = useRef(customerReturns);
  useEffect(() => { customerReturnsRef.current = customerReturns; }, [customerReturns]);

  // ── Local State ─────────────────────────────────────────

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // R-POS-POSTSALE-FOCUS-RETURN-FLOW-V1: bumped each time the receipt
  // modal closes after a completed sale. Used as `key` on ProductGrid
  // so the category view remounts with a fresh internal search='' and
  // re-runs the autoFocus effect — cashier returns to the same
  // Accessories/Phones view they started in, with the cursor in search
  // ready for the next purchase.
  const [productGridKey, setProductGridKey] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchTerm, setSearchTerm] = useState(() => loadLocal('global_search', ''));

  // ── Consume inventory barcode from global scanner ─────────
  // When a product barcode is scanned outside any input, AppShell
  // dispatches SET_INVENTORY_SEARCH and navigates to POS.
  // We pick it up here and pre-fill the search bar.
  useEffect(() => {
    if (!inventorySearchTerm) return;
    setSearchTerm(inventorySearchTerm);
    setActiveCategory(null); // clear category filter so search results show
    dispatch({ type: 'SET_INVENTORY_SEARCH', payload: '' });
  }, [inventorySearchTerm, dispatch]);

  // Reset to Quick Action Grid when user clicks POS in sidebar while already on POS
  useEffect(() => {
    const handler = () => { setActiveCategory(null); setSearchTerm(''); };
    window.addEventListener('cellhub_pos_reset', handler);
    return () => window.removeEventListener('cellhub_pos_reset', handler);
  }, []);
  const [discount, setDiscount] = useState<DiscountState>({ amount: 0, type: 'percent', reason: '' });
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [addCreditCardFee, setAddCreditCardFee] = useState(false);
  const [creditCardFeeOverride, setCreditCardFeeOverride] = useState<number | null>(null);
  const [cashAmount, setCashAmount] = useState(0);
  const [cardAmount, setCardAmount] = useState(0);

  useEffect(() => {
    if (paymentMethod !== 'Card' && paymentMethod !== 'Split') {
      setCreditCardFeeOverride(null);
    }
  }, [paymentMethod]);

  // Modals
  const [showPhonePayment, setShowPhonePayment] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  // R-POS-CUSTOMER-QUICKEDIT-V1: state for the inline "Edit customer plan"
  // modal triggered from a phone_payment cart row. The form is pre-filled
  // from the customer record (NOT the cart item) — the cart item reflects
  // this sale, the customer record is the persistent source of truth that
  // we're updating. Save is immediate (per Jorge's choice C1): the
  // customer record updates as soon as the modal confirms, regardless of
  // whether the sale completes or cancels.
  const [quickEditCustomerId, setQuickEditCustomerId] = useState<string | null>(null);
  const [quickEditForm, setQuickEditForm] = useState<{ carrier: string; plan: string; monthlyPayment: string }>({
    carrier: '', plan: '', monthlyPayment: '',
  });
  const [showCredentialMaker, setShowCredentialMaker] = useState(false);
  const [showNotepad, setShowNotepad] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);
  const [showRMALabel, setShowRMALabel] = useState(false);
  const [showLabelPrinter, setShowLabelPrinter] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  // R-STORE-CREDIT-REDEMPTION-SYSTEM
  const [showApplyStoreCredit, setShowApplyStoreCredit] = useState(false);

  // ── Auto-open PhonePaymentModal when customer credential is scanned ──
  // AppShell scanner handler sets pendingPhonePaymentCustomerId when a GC-xxxx
  // code matches a customer. We detect it here and pop the modal.
  useEffect(() => {
    if (pendingPhonePaymentCustomerId) {
      setShowPhonePayment(true);
    }
  }, [pendingPhonePaymentCustomerId]);

  // ── Auto-assign customer when repair/SO is added to cart ──
  // RepairModule dispatches SET_PENDING_POS_CUSTOMER after consolidateCartForRepair.
  // We pick it up here and set selectedCustomer so PaymentModal doesn't warn
  // "pts will be lost — no customer assigned" (BUG #CUST-POS-1).
  useEffect(() => {
    if (!pendingPosCustomer) return;
    const cust = customers.find((c) => c.id === pendingPosCustomer);
    if (cust && (!selectedCustomer || selectedCustomer.id !== cust.id)) {
      setSelectedCustomer(cust);
    }
    dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: '' });
  }, [pendingPosCustomer, customers, selectedCustomer, dispatch]);

  // Last completed sale (for receipt)
  const [lastSale, setLastSale] = useState<Sale | null>(null);

  // Bundle suggestion — shown when a phone is added to cart
  const [bundleSuggestion, setBundleSuggestion] = useState<InventoryItem[]>([]);

  // Custom categories (user-created)
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(() => loadLocal('pos_custom_categories', []));

  // ── Computed ─────────────────────────────────────────────

  const totals: CartTotals = useMemo(
    () => calcTotals(cart, settings, discount, paymentMethod, addCreditCardFee, undefined, creditCardFeeOverride ?? undefined),
    [cart, settings, discount, paymentMethod, addCreditCardFee, creditCardFeeOverride],
  );

  // Search across inventory
  // R-PERF-HARDENING-V1 #3: useDeferredValue lets React skip re-running the
  // O(N) inventory filter on intermediate keystrokes when typing fast. The
  // input stays responsive (commits immediately to searchTerm); the heavy
  // filter follows when the renderer has bandwidth.
  const isSearchActive = searchTerm.trim().length > 0;
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const searchResults = useMemo(() => {
    if (!isSearchActive) return [];
    const q = deferredSearchTerm.trim();
    if (!q) return [];
    return inventory.filter((item) =>
      matchesSearch(q, item.name, item.sku, item.barcode, item.imei, item.category),
    );
  }, [deferredSearchTerm, inventory, isSearchActive]);

  // Items filtered by active category
  const categoryItems = useMemo(() => {
    if (!activeCategory) return [];

    // Custom category
    if (activeCategory.startsWith('custom:')) {
      const catId = activeCategory.slice('custom:'.length);
      const cat = customCategories.find((c) => c.id === catId);
      if (!cat) return [];
      return inventory.filter(
        (i) => i.category.toLowerCase() === cat.category.toLowerCase() && i.qty > 0,
      );
    }

    // Built-in categories
    const cat = (i: InventoryItem) => (i.category || '').toLowerCase();
    const catMap: Record<string, (item: InventoryItem) => boolean> = {
      accessories: (i) => isAccessoryCategory(i) && i.qty > 0,
      cellphones: (i) => isPhoneCategory(i) && i.qty > 0,
      services: (i) => cat(i) === 'service',
      international: (i) => cat(i) === 'top_up',
    };

    const filter = catMap[activeCategory];
    return filter ? inventory.filter(filter) : [];
  }, [activeCategory, inventory, customCategories]);

  // R-POS-CUSTOMERPICKER-MIGRATION: inline customer add via picker.
  // Mirrors TopUpModal/CredentialMaker pattern — append to customers state and persist.
  const handleCreateNewCustomer = useCallback((c: Customer) => {
    try {
      const next = [...customersRef.current, c];
      customersRef.current = next;
      setCustomers(next);
      persist.customer(c.id, c as unknown as Record<string, unknown>);
    } catch (_) { /* defensive */ }
  }, [setCustomers]);

  // ── Helpers ─────────────────────────────────────────────

  const getStock = useCallback(
    (item: InventoryItem): number => {
      // For services, stock is unlimited
      if (item.category === 'service') return 999;
      return item.qty || (item as any).quantity || 0;
    },
    [],
  );

  // ── Add To Cart ─────────────────────────────────────────

  const addToCart = useCallback(
    (item: InventoryItem) => {
      // Stock guard — blocks ALL entry points (ProductGrid, search, scanner).
      // Services are exempt: getStock() returns 999 for service category.
      if (getStock(item) <= 0) {
        toast(t('outOfStock'), 'warning');
        return;
      }
      const currentCart = cartRef.current;
      const existing = currentCart.find((c) => c.inventoryId === item.id);

      if (existing) {
        if (existing.qty >= getStock(item)) {
          toast(t('notEnoughStock'), 'warning');
          return;
        }
        const next = currentCart.map((c) =>
          c.inventoryId === item.id ? { ...c, qty: c.qty + 1 } : c,
        );
        cartRef.current = next;
        setCart(next);
      } else {
        // Use the inventory item's taxable flag as the authoritative source.
        // phone_payment / top_up / quick_charge always bypass sales tax —
        // they generate utility tax or follow a separate fee structure.
        // 'service' is intentionally excluded from the override so taxable
        // repair/installation items are charged correctly.
        let taxable = item.taxable &&
          !['phone_payment', 'top_up', 'quick_charge'].includes(item.category);
        let category = item.category;

        if (activeCategory?.startsWith('custom:')) {
          const catId = activeCategory.slice('custom:'.length);
          const cat = customCategories.find((c) => c.id === catId);
          if (cat?.taxMode === 'none') {
            taxable = false;
            category = 'service';
          } else if (cat?.taxMode === 'phone_payment') {
            taxable = false;
            category = 'phone_payment';
          } else if (cat?.taxMode === 'sales') {
            taxable = true;
          }
        }

        const newItem: CartItem = {
          id: generateId(),
          inventoryId: item.id,
          name: item.name,
          sku: item.sku,
          imei: item.imei,
          category,
          price: item.price,
          originalPrice: item.price,
          cost: item.cost,
          qty: 1,
          taxable,
          cbeEligible: item.cbeEligible,
          screenFeeEligible: item.screenFeeEligible,
          notes: '',
        };

        const next = [...currentCart, newItem];
        cartRef.current = next;
        setCart(next);

        // BUG-9 (R-CART-FEES) DISABLED: the auto-pop "Add accessories?" panel
        // interrupted the fast-sale flow. State + render are preserved (so a
        // future feature flag can re-enable easily) but the trigger is muted.
        // To re-enable, uncomment the block below.
        //
        // if (isPhoneCategory(item)) {
        //   const suggestions = inventory.filter(
        //     (i) =>
        //       isAccessoryCategory(i) &&
        //       i.qty > 0 &&
        //       !currentCart.some((c) => c.inventoryId === i.id) &&
        //       i.id !== item.id,
        //   ).slice(0, 4);
        //   if (suggestions.length > 0) setBundleSuggestion(suggestions);
        // }
      }

      toast(t('pos.itemAdded', item.name), 'success');
      emitItemAdded({ sku: item.sku, category: item.category, itemCount: (cartRef.current.length) });
    },
    [setCart, activeCategory, customCategories, getStock, toast, L, inventory, lang],
  );

  // ── Complete Sale ───────────────────────────────────────

  const handleCompleteSale = useCallback(
    (sale: Sale) => {
      // R-FINALIZE-SALE-CORE-EXTRACT-SCOPED: all global data mutations +
      // reconciliation + validation now live in the headless finalizeSaleCore.
      // POSModule keeps every UI effect (toasts, navigation, cart reset, receipt)
      // and applies the returned updates with the exact same state/persist
      // patterns as before. Behaviour is byte-identical to the prior inline flow.
      const coreResult = finalizeSaleCore({
        sale,
        sales: salesRef.current,
        inventory: inventoryRef.current,
        customers: customersRef.current,
        repairs: repairsRef.current,
        specialOrders: specialOrdersRef.current,
        unlocks: unlocksRef.current,
        layaways: layawaysRef.current,
        storeCreditLedger: storeCreditLedgerRef.current,
        customerReturns: customerReturnsRef.current,
        settings,
        selectedCustomer,
        currentEmployee,
      });

      if (!coreResult.ok) {
        switch (coreResult.reason) {
          case 'tax_setup_required':
            toast(
              lang === 'es'
                ? 'Configuración de impuestos requerida antes de una venta con impuesto.'
                : lang === 'pt'
                  ? 'Configuração de impostos necessária antes de uma venda tributável.'
                  : 'Tax setup required before taxable sale.',
              'error',
            );
            dispatch({ type: 'SET_ACTIVE_TAB', payload: 'settings' });
            return;
          case 'repair_cancelled':
            toast(t('pos.repairCancelledPayment'), 'error');
            return;
          case 'repair_completed':
            toast(t('pos.repairAlreadyCompleted'), 'error');
            return;
          case 'layaway_cancelled':
            toast(t('pos.layawayCancelledSale'), 'error');
            return;
          case 'repair_overpayment':
            toast(t('pos.repairOverpaymentBlocked'), 'error');
            return;
          default:
            return;
        }
      }

      // §1. Save sale (apply from core result).
      salesRef.current = coreResult.nextSales;
      setSales(coreResult.nextSales);
      setLastSale(sale);
      persist.sale(sale.id, sale as unknown as Record<string, unknown>);
      try {
        window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
          detail: { type: 'sale.completed', payload: coreResult.sideEffects.operatorActivity },
        }));
      } catch { /* env without CustomEvent */ }
      // R-INTELLIGENCE-CONTINUITY-V1: clear the interrupted phone_payment portal track.
      if (coreResult.sideEffects.clearWorkflowTrack) {
        try { clearWorkflowTrack(coreResult.sideEffects.clearWorkflowTrack); } catch { /* non-critical */ }
      }
      // R-INTELLIGENCE-PAYMENT-VERIFY-V1: schedule the carrier-portal confirm nudge.
      if (coreResult.sideEffects.phonePaymentVerify) {
        try {
          const created = addVerification(coreResult.sideEffects.phonePaymentVerify);
          if (created) {
            window.dispatchEvent(new CustomEvent('cellhub:payment-verify-nudge'));
          }
        } catch { /* non-critical */ }
      }

      // §2. Deduct inventory (apply from core result).
      if (coreResult.inventoryOps.length > 0) {
        inventoryRef.current = coreResult.inventory;
        setInventory(coreResult.inventory);
        batchSave(coreResult.inventoryOps);
      }

      // §3 + §5 + §6. Customer single-pass (apply from core result —
      // store credit deduction, loyalty points, top-up history).
      if (coreResult.customerChanged && coreResult.workingCustomer) {
        customersRef.current = coreResult.customers;
        setCustomers(coreResult.customers);
        persist.customer(coreResult.workingCustomer.id, coreResult.workingCustomer as unknown as Record<string, unknown>);
      }

      // §4. Linked entity reconciliation (computed in core). §4a Repairs (apply).
      if (coreResult.repairOps.length > 0) {
        repairsRef.current = coreResult.repairs;
        setRepairs(coreResult.repairs);
        batchSave(coreResult.repairOps);
      }

      // §4b. Special Orders (apply from core result).
      if (coreResult.specialOrderOps.length > 0) {
        specialOrdersRef.current = coreResult.specialOrders;
        setSpecialOrders(coreResult.specialOrders);
        batchSave(coreResult.specialOrderOps);
      }

      // §4c. Unlocks (apply from core result).
      if (coreResult.unlockOps.length > 0) {
        unlocksRef.current = coreResult.unlocks;
        setUnlocks(coreResult.unlocks);
        batchSave(coreResult.unlockOps);
      }

      // §4d. Layaways (apply from core result).
      if (coreResult.layawayOps.length > 0) {
        layawaysRef.current = coreResult.layaways;
        setLayaways(coreResult.layaways);
        batchSave(coreResult.layawayOps);
      }

      // §4e. Store-credit redemption (apply from core result).
      if (coreResult.ledgerOps.length > 0) {
        storeCreditLedgerRef.current = coreResult.storeCreditLedger;
        setStoreCreditLedger(coreResult.storeCreditLedger);
        batchSave(coreResult.ledgerOps);
      }

      // §4f. Exchange/return finalization (apply from core result).
      if (coreResult.exchange) {
        const exRes = coreResult.exchange;
        if (exRes.salesChanged) {
          salesRef.current = exRes.sales;
          setSales(exRes.sales);
          for (const id of exRes.updatedSaleIds) {
            const s = exRes.sales.find((x) => x.id === id);
            if (s) persist.sale(s.id, s as unknown as Record<string, unknown>);
          }
        }
        if (exRes.inventoryChanged) {
          inventoryRef.current = exRes.inventory;
          setInventory(exRes.inventory);
          const exInvOps = exRes.updatedInventoryIds
            .map((id) => exRes.inventory.find((x) => x.id === id))
            .filter((inv): inv is InventoryItem => !!inv)
            .map((inv) => ({
              collection: 'inventory',
              id: inv.id,
              data: inv as unknown as Record<string, unknown>,
            }));
          if (exInvOps.length > 0) batchSave(exInvOps);
        }
        if (exRes.returnsChanged) {
          customerReturnsRef.current = exRes.returns;
          setCustomerReturns(exRes.returns);
          for (const rec of exRes.persistedReturns) {
            persist.customerReturn(rec.id, rec as unknown as Record<string, unknown>);
          }
        }
      }

      // 6. Clear cart and reset
      cartRef.current = [];
      setCart([]);
      setDiscount({ amount: 0, type: 'percent', reason: '' });
      setPaymentMethod('Cash');
      setCashAmount(0);
      setCardAmount(0);
      setAddCreditCardFee(false);
      setSelectedCustomer(null);
      setShowPayment(false);

      // 7. Show receipt
      setShowReceipt(true);

      toast(t('pos.saleCompleted', sale.invoiceNumber), 'success');
    },
    [
      setSales, setInventory, setCustomers,
      selectedCustomer, setRepairs, setSpecialOrders, setUnlocks, setLayaways,
      setCart, settings, toast, lang, setCustomerReturns, dispatch,
    ],
  );

  // R-STORE-CREDIT-REDEMPTION-SYSTEM: apply a redemption as a negative-priced
  // cart line. handleCompleteSale post-processes any cart line carrying
  // storeCreditLedgerId and appends a redemption to the ledger entry.
  const handleApplyStoreCredit = useCallback((entry: StoreCreditLedger, amountCents: number) => {
    const safe = Math.max(0, Math.round(amountCents));
    if (safe <= 0) return;
    // R-STORE-CREDIT-REDEMPTION-SYSTEM: compute the projected remaining at
    // apply time so the receipt can show "Remaining: $X" without needing
    // to re-resolve the ledger entry post-sale.
    const projectedRemaining = Math.max(0, (entry.remainingAmount || 0) - safe);
    const line: CartItem = {
      id: generateId(),
      name: t('storeCredit.cartLine.name', entry.certificateNumber),
      category: 'exchange_credit',
      price: -safe,
      qty: 1,
      taxable: false,
      cbeEligible: false,
      notes: t('storeCredit.cartLine.notesWithRemaining', entry.customerName, formatCurrency(projectedRemaining)),
      storeCreditLedgerId: entry.id,
      storeCreditCertNumber: entry.certificateNumber,
    };
    const nextCart = [...cartRef.current, line];
    cartRef.current = nextCart;
    setCart(nextCart);
    setShowApplyStoreCredit(false);
    toast(t('storeCredit.toasts.applied', entry.certificateNumber, formatCurrency(safe)), 'success');
  }, [t, toast, setCart]);

  // ── Cart Checkout — Round R-POS-PAY-DEDUPE F4 ──────────
  //
  // Single entry point for the "Complete Sale" button in the cart.
  // Routes to one of two checkout paths based on cart contents:
  //   - PATH A (bypass): cart has no external-portal items → build
  //     the sale directly and call handleCompleteSale. NO secondary
  //     modal. This fixes the original complaint (doble captura de
  //     Cash Received) for ~95 % of sales.
  //   - PATH B (phone portal): cart has phone_payment items with a
  //     carrier → open PaymentModal slim to show the "¿portal done?"
  //     warning that Jorge wants preserved. PaymentModal still calls
  //     handleCompleteSale via onComplete — same single post-sale
  //     layer for both paths (invariant I1).
  //
  // Both paths use buildSale + computePaidCents from saleBuilder.ts —
  // zero drift in sale construction or payment guard (I3, I7).
  // R-LAN-POS-CHECKOUT-FORWARDING: single entry point for a finished Sale.
  // Standalone/Primary → local finalize (unchanged). Secondary → forward the
  // built Sale to the Primary, which finalizes it headlessly; the Secondary
  // NEVER persists or calls finalizeSaleCore locally. Only Secondary-local UI is
  // reset on success; on failure the cart is preserved so the cashier can retry.
  const forwardingRef = useRef(false);
  const completeOrForwardSale = useCallback((sale: Sale) => {
    if (!isLanSecondaryReadOnly()) {
      handleCompleteSale(sale);
      return;
    }
    // R-LAN-POS-CHECKOUT-FORWARDING-FIX: in-flight guard. A rapid double-click
    // rebuilds a NEW sale.id each time (which the Primary's sale.id dedup cannot
    // catch), so block a second forward while the first is still pending.
    // Released in .finally() below whether the forward resolves or rejects.
    if (forwardingRef.current) return;
    forwardingRef.current = true;
    void (async () => {
      const ack = await sendPosCheckout(sale);
      if (ack && ack.ok) {
        // Secondary-only UI cleanup (UI state only — no persist, no global writes).
        setLastSale(sale);
        cartRef.current = [];
        setCart([]);
        setDiscount({ amount: 0, type: 'percent', reason: '' });
        setPaymentMethod('Cash');
        setCashAmount(0);
        setCardAmount(0);
        setAddCreditCardFee(false);
        setSelectedCustomer(null);
        setShowPayment(false);
        setShowReceipt(true);
        requestMirrorResync();
        toast(t('pos.saleCompleted', sale.invoiceNumber), 'success');
        return;
      }
      // Rejection → same user-facing toast mapping as local checkout. Cart preserved.
      switch (ack?.error) {
        case 'tax_setup_required':
          toast(
            lang === 'es'
              ? 'Configuración de impuestos requerida antes de una venta con impuesto.'
              : lang === 'pt'
                ? 'Configuração de impostos necessária antes de uma venda tributável.'
                : 'Tax setup required before taxable sale.',
            'error',
          );
          break;
        case 'repair_cancelled': toast(t('pos.repairCancelledPayment'), 'error'); break;
        case 'repair_completed': toast(t('pos.repairAlreadyCompleted'), 'error'); break;
        case 'layaway_cancelled': toast(t('pos.layawayCancelledSale'), 'error'); break;
        case 'repair_overpayment': toast(t('pos.repairOverpaymentBlocked'), 'error'); break;
        default:
          toast(
            lang === 'es'
              ? 'No se pudo completar en la Principal. Revisa la conexión e intenta de nuevo.'
              : lang === 'pt'
                ? 'Não foi possível concluir no Principal. Verifique a conexão e tente novamente.'
                : 'Could not complete on the Primary. Check the connection and try again.',
            'error',
          );
      }
    })().finally(() => { forwardingRef.current = false; });
  }, [
    handleCompleteSale, toast, t, lang,
    setCart, setDiscount, setPaymentMethod, setCashAmount, setCardAmount,
    setAddCreditCardFee, setSelectedCustomer,
  ]);

  const handleCartCheckout = useCallback(() => {
    // [I6] Mismo discriminator que PaymentModal.tsx:60-64. Intencionalmente
    // duplicado (no helper compartido) — refactor a saleBuilder en ticket
    // post-round si se vuelve relevante.
    const hasExternalPortal = cart.some(
      (item) =>
        item.category === 'phone_payment'
        && typeof item.carrier === 'string'
        && item.carrier.trim().length > 0,
    );

    if (hasExternalPortal) {
      // R-INTELLIGENCE-CONTINUITY-V1: track workflow start so continuity
      // engine can surface a reminder if the flow is abandoned mid-checkout.
      const portalCarrier = cart.find((i) => i.category === 'phone_payment' && (i as any).carrier)
        ? String((cart.find((i) => i.category === 'phone_payment') as any)?.carrier || 'Carrier')
        : 'Carrier';
      try {
        trackWorkflowStart('phone_payment_portal', {
          title: 'Phone Payment Portal',
          summary: `${portalCarrier} — checkout not completed`,
          navigateTo: 'pos',
        });
      } catch { /* non-critical */ }
      setShowPayment(true);
      return;
    }

    // ── Bypass path ────────────────────────────────────
    // Mirrors the guards from PaymentModal slim (employee + payment
    // sufficiency) so behavior matches for non-phone sales.
    if (!currentEmployee) {
      toast(t('pos.selectEmployeeFirst'), 'error');
      return;
    }

    // [I2] Guard de pago suficiente — mismo helper que PaymentModal.
    const paidCents = computePaidCents(
      paymentMethod,
      cashAmount,
      cardAmount,
      selectedCustomer?.storeCredit ?? 0,
      totals.total,
    );
    // R-POS-CARD-PAYMENT-FUNDS-BUG: pure Card payments delegate authorization
    // to the terminal — the cardAmount input is informational only and may be
    // stale (auto-prefill drift after cart/CC-fee changes). Skip the funds
    // guard for Card. Cash, Split (cash portion + record-keeping), and Store
    // Credit (known balance) still validate.
    if (paymentMethod !== 'Card' && paidCents < totals.total) {
      const shortBy = totals.total - paidCents;
      toast(t('paymentModal.insufficientPayment', formatCurrency(shortBy)), 'error');
      return;
    }

    // [I3, I7] Mismo BuildSaleInput shape que phone path. storeId se
    // omite — currentStoreId no está en scope de POSModule (F0 Q3
    // conservative; pre-existing behavior preserved).
    const sale = buildSale({
      cart,
      totals,
      paymentMethod,
      cashAmount,
      cardAmount,
      selectedCustomer,
      currentEmployee,
      settings,
    });

    // [I1] Única capa post-sale — misma función que consume onComplete
    // de PaymentModal (path B). R-LAN-POS-CHECKOUT-FORWARDING: routes through
    // completeOrForwardSale so a Secondary forwards to the Primary instead of
    // finalizing locally (standalone/Primary behaviour unchanged).
    completeOrForwardSale(sale);
  }, [
    cart, totals, paymentMethod, cashAmount, cardAmount,
    selectedCustomer, currentEmployee, settings, lang, toast,
    completeOrForwardSale,
  ]);

  // ── Clear Cart ──────────────────────────────────────────

  const handleClearCart = useCallback(() => {
    cartRef.current = [];
    setCart([]);
    setBundleSuggestion([]);
    setDiscount({ amount: 0, type: 'percent', reason: '' });
    setSelectedCustomer(null);
    setShowClearConfirm(false);
    // R-INTELLIGENCE-CONTINUITY-V1: cart abandoned — clear workflow tracking.
    try { clearWorkflowTrack('phone_payment_portal'); } catch { /* non-critical */ }
    toast(t('pos.cartCleared'), 'info');
  }, [setCart, toast, lang]);

  // ── R-POS-CUSTOMER-QUICKEDIT-V1: open + save handlers for the
  //    customer wireless quick-edit modal. Open prefills the form from
  //    the customer record; save patches the same customer with the
  //    edited fields and persists. Mirrors the canonical pattern in
  //    CustomerModule (setCustomers + persist.customer with full record
  //    spread to satisfy the `localSaveRecord OVERWRITES` contract).
  // ────────────────────────────────────────────────────────────

  const handleEditCustomerPlan = useCallback((customerId: string) => {
    const c = customers.find((x) => x.id === customerId);
    if (!c) return;
    setQuickEditCustomerId(customerId);
    setQuickEditForm({
      carrier: String((c as { carrier?: string }).carrier ?? ''),
      plan: String((c as { plan?: string }).plan ?? ''),
      monthlyPayment: String((c as { monthlyPayment?: string }).monthlyPayment ?? ''),
    });
  }, [customers]);

  const handleSaveCustomerEdit = useCallback(() => {
    if (!quickEditCustomerId) return;
    const idx = customers.findIndex((x) => x.id === quickEditCustomerId);
    if (idx < 0) return;
    const original = customers[idx];
    const updated = {
      ...original,
      carrier: quickEditForm.carrier.trim() || undefined,
      plan: quickEditForm.plan.trim() || undefined,
      monthlyPayment: quickEditForm.monthlyPayment.trim() || undefined,
      updatedAt: new Date().toISOString(),
    } as Customer;
    const next = customers.map((c, i) => (i === idx ? updated : c));
    setCustomers(next);
    persist.customer(updated.id, updated as unknown as Record<string, unknown>);
    // Sync selectedCustomer too if it matches — otherwise the cart row
    // would still show the stale carrier/plan in the customer card.
    if (selectedCustomer && selectedCustomer.id === updated.id) {
      setSelectedCustomer(updated);
    }
    setQuickEditCustomerId(null);
    toast(t('pos.customerEdit.saved'), 'success');
  }, [quickEditCustomerId, quickEditForm, customers, setCustomers, selectedCustomer, toast, t]);

  // ── Search persistence ──────────────────────────────────

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchTerm(value);
      saveLocal('global_search', value);
    },
    [],
  );

  // ── Category title helpers ──────────────────────────────

  const getCategoryTitle = (): { title: string; subtitle: string } => {
    if (!activeCategory) return { title: '', subtitle: '' };

    if (activeCategory.startsWith('custom:')) {
      const catId = activeCategory.slice('custom:'.length);
      const cat = customCategories.find((c) => c.id === catId);
      return {
        title: cat ? (lang === 'es' && cat.labelEs ? cat.labelEs : cat.label) : t('pos.categoryFallback'),
        subtitle: cat?.description || t('selectItemsToAdd'),
      };
    }

    const titles: Record<string, { title: string; subtitle: string }> = {
      accessories: { title: t('qaAccessories'), subtitle: t('qaAccessoriesDesc') },
      cellphones: { title: t('qaCellphones'), subtitle: t('qaCellphonesDesc') },
      services: { title: t('qaServices'), subtitle: t('qaServicesDesc') },
      international: { title: t('internationalTopUp'), subtitle: t('selectProviderAmount') },
    };

    return titles[activeCategory] || { title: activeCategory, subtitle: '' };
  };

  // ── Render ──────────────────────────────────────────────

  const renderMainContent = () => {
    // Search mode
    if (isSearchActive) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-white">
                {t('searchResults')}
              </h2>
              <p className="text-sm text-slate-400">
                {t('pos.resultsCount', searchResults.length)}
              </p>
            </div>
            <button
              onClick={() => handleSearchChange('')}
              className="btn btn-secondary btn-sm"
            >
              ✕ {t('clearSearch')}
            </button>
          </div>

          <SearchInput
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder={t('searchPlaceholder')}
            className="mb-4"
            autoFocus
          />

          <div className="flex-1 overflow-y-auto">
            {searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <span className="text-5xl mb-4">🔍</span>
                <p className="font-medium">{t('noMatches')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="glass-card p-4 flex flex-col items-center text-center
                               hover:bg-white/10 transition-all cursor-pointer"
                  >
                    <div className="w-16 h-16 rounded-full bg-brand-500/10 border border-brand-500/20
                                  flex items-center justify-center text-2xl mb-2">
                      {isPhoneCategory(item) ? '📱' : isAccessoryCategory(item) ? '🎧' : '📦'}
                    </div>
                    <p className="text-sm font-bold text-white mb-1 line-clamp-2">{item.name}</p>
                    <p className="text-base font-bold text-emerald-400">
                      {formatCurrency(item.price)}
                    </p>
                    <p className="text-xs text-slate-500">{item.qty} {t('pos.inStock')}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Quick Service Panel — replaces ProductGrid for services category
    if (activeCategory === 'services') {
      return (
        <QuickServicePanel
          lang={lang}
          // Round POS-T1: ?? not || so taxRate=0 (tax-exempt stores) stays 0.
          taxRate={settings.taxRate ?? 0.0925}
          onAddToCart={(item) => { setCart([...cart, item]); }}
          onBack={() => setActiveCategory(null)}
        />
      );
    }

    // Category browse mode
    if (activeCategory && activeCategory !== 'phone_payment') {
      const { title, subtitle } = getCategoryTitle();
      return (
        <ProductGrid
          key={productGridKey}
          title={title}
          subtitle={subtitle}
          items={categoryItems}
          lang={lang}
          L={L}
          onAddToCart={addToCart}
          onBack={() => setActiveCategory(null)}
        />
      );
    }

    // Default: Quick Action Grid
    return (
      <div className="flex flex-col h-full">
        {/* Global search bar */}
        <SearchInput
          value={searchTerm}
          onChange={handleSearchChange}
          placeholder={L.searchPlaceholder}
          className="mb-4"
        />

        <QuickActionGrid
          lang={lang}
          L={L}
          customCategories={customCategories}
          onSelectCategory={(cat) => {
            // International Top-Up has its own dedicated modal (provider/sender/multi-line)
            if (cat === 'international') {
              setShowTopUp(true);
            } else {
              setActiveCategory(cat);
            }
          }}
          onPhonePayment={() => setShowPhonePayment(true)}
          onCredentialMaker={() => setShowCredentialMaker(true)}
          onNotepad={() => setShowNotepad(true)}
          onEstimate={() => setShowEstimate(true)}
          onRMALabel={() => setShowRMALabel(true)}
          onLabelPrinter={() => setShowLabelPrinter(true)}
          onAddCategory={() => setShowAddCategory(true)}
        />
      </div>
    );
  };

  return (
    <>
      {/* Main layout: content + cart sidebar */}
      <div
        className="h-[calc(100vh-5rem)]"
        style={{
          display: 'grid',
          gridTemplateColumns: cart.length > 0 ? '1fr 380px' : '1fr',
          gap: '1.5rem',
          position: 'relative',
        }}
      >
        {/* Left: main content */}
        <div className="flex flex-col overflow-hidden">
          {renderMainContent()}
        </div>

        {/* Bundle suggestion — appears when a phone is added */}
        {bundleSuggestion.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)',
            zIndex: 50, width: '420px', maxWidth: '90vw',
            background: 'var(--bg-secondary)', border: '1px solid rgba(99,102,241,0.4)',
            borderRadius: '0.875rem', padding: '0.875rem 1rem', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a5b4fc' }}>
                📦 {t('pos.bundleSuggestion')}
              </span>
              <button onClick={() => setBundleSuggestion([])} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {bundleSuggestion.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => {
                    addToCart(acc);
                    setBundleSuggestion((prev) => prev.filter((a) => a.id !== acc.id));
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.4rem 0.6rem', background: 'var(--bg-input)',
                    border: '1px solid var(--border-default)', borderRadius: '0.5rem',
                    cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-primary)', textAlign: 'left', gap: '0.4rem',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</span>
                  <span style={{ color: '#34d399', fontWeight: 700, flexShrink: 0 }}>${(acc.price / 100).toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* R-POS-CART-GRID-STORE-CREDIT-BUTTON-LAYOUT-FIX: apply-credit
            button is stacked directly above the Cart inside the SAME
            right-column grid child so the parent 2-col layout
            (1fr / 380px) stays intact. Previous `gridColumn: 'span 2'`
            wrapper auto-placed Cart in the wrong row. */}
        {cart.length > 0 && (
          <div className="flex flex-col h-full min-h-0 gap-2">
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowApplyStoreCredit(true)}
                className="btn btn-secondary btn-sm"
                style={{ borderColor: 'rgba(56,189,248,0.4)', color: '#38bdf8', fontWeight: 600 }}
              >
                🎫 {t('storeCredit.apply.openBtn')}
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <Cart
                cart={cart}
                setCart={setCart}
                totals={totals}
                selectedCustomer={selectedCustomer}
                discount={discount}
                setDiscount={setDiscount}
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                cashAmount={cashAmount}
                setCashAmount={setCashAmount}
                cardAmount={cardAmount}
                setCardAmount={setCardAmount}
                addCreditCardFee={addCreditCardFee}
                setAddCreditCardFee={setAddCreditCardFee}
                creditCardFeeOverride={creditCardFeeOverride}
                setCreditCardFeeOverride={setCreditCardFeeOverride}
                onCheckout={handleCartCheckout}
                onClearCart={() => setShowClearConfirm(true)}
                onSelectCustomer={() => setShowCustomerSearch(true)}
                onEditCustomerPlan={handleEditCustomerPlan}
                settings={settings}
                lang={lang}
                L={L}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────── */}

      {showPhonePayment && (
        <PhonePaymentModal
          open={showPhonePayment}
          onClose={() => setShowPhonePayment(false)}
          settings={settings}
          cart={cart}
          setCart={setCart}
          customers={customers}
          setCustomers={setCustomers}
          sales={sales}
          lang={lang}
          L={L}
          // R-PHONE-PAYMENT-CUSTOMER-PROPAGATION: mirror TopUpModal r28b-fix
          setSelectedCustomer={(c) => {
            if (c && (!selectedCustomer || selectedCustomer.id !== c.id)) {
              setSelectedCustomer(c);
            }
          }}
        />
      )}

      {showPayment && (
        <PaymentModal
          open={showPayment}
          onClose={() => setShowPayment(false)}
          cart={cart}
          totals={totals}
          paymentMethod={paymentMethod}
          cashAmount={cashAmount}
          cardAmount={cardAmount}
          selectedCustomer={selectedCustomer}
          currentEmployee={currentEmployee}
          settings={settings}
          onComplete={completeOrForwardSale}
          lang={lang}
          L={L}
        />
      )}

      <ReceiptModal
        open={showReceipt}
        sale={lastSale}
        settings={settings}
        onClose={() => {
          setShowReceipt(false);
          // R-POS-POSTSALE-FOCUS-RETURN-FLOW-V1: bump the key so the
          // active ProductGrid remounts (clears internal search, re-
          // focuses input) AFTER the receipt modal closes. No effect
          // when no category is active (key is unread).
          setProductGridKey((k) => k + 1);
        }}
        customers={customers}
        setCustomers={setCustomers}
        setSales={setSales}
        sales={sales}
        lang={lang}
        L={L}
      />

      {/* Add Custom Category Modal */}
      {showAddCategory && (
        <AddCategoryModal
          lang={lang}
          onSave={(cat) => {
            const updated = [...customCategories, cat];
            setCustomCategories(updated);
            saveLocal('pos_custom_categories', updated);
            setShowAddCategory(false);
            toast(t('pos.categoryCreated'), 'success');
          }}
          onClose={() => setShowAddCategory(false)}
        />
      )}

      <ConfirmDialog
        open={showClearConfirm}
        title={t('clearCartConfirm')}
        message={t('clearCartConfirm')}
        variant="danger"
        confirmLabel={t('clear')}
        cancelLabel={t('cancel')}
        onConfirm={handleClearCart}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* R-POS-CUSTOMER-QUICKEDIT-V1: inline customer wireless quick-edit modal.
          Fired from a phone_payment cart row. Edits carrier / plan /
          monthlyPayment on the customer record only — does NOT touch the
          cart item's price (Jorge's choice C1). Cashier still does the
          per-line price override separately for this sale; next sale
          benefits from the corrected stamped plan. */}
      {quickEditCustomerId && (
        <Modal
          open
          onClose={() => setQuickEditCustomerId(null)}
          title={`✏️ ${t('pos.customerEdit.title')}`}
          size="max-w-sm"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                {t('pos.customerEdit.carrier')}
              </label>
              <input
                className="input"
                value={quickEditForm.carrier}
                onChange={(e) => setQuickEditForm((f) => ({ ...f, carrier: e.target.value }))}
                placeholder="AT&T, Verizon, T-Mobile…"
                autoFocus
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                {t('pos.customerEdit.plan')}
              </label>
              <input
                className="input"
                value={quickEditForm.plan}
                onChange={(e) => setQuickEditForm((f) => ({ ...f, plan: e.target.value }))}
                placeholder="Unlimited Elite, Magenta MAX…"
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                {t('pos.customerEdit.monthlyPayment')}
              </label>
              <input
                className="input"
                value={quickEditForm.monthlyPayment}
                onChange={(e) => setQuickEditForm((f) => ({ ...f, monthlyPayment: e.target.value }))}
                placeholder="35, 45, 60…"
                inputMode="decimal"
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                onClick={() => setQuickEditCustomerId(null)}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                {t('pos.customerEdit.cancel')}
              </button>
              <button
                onClick={handleSaveCustomerEdit}
                className="btn btn-primary"
                style={{ flex: 2 }}
              >
                {t('pos.customerEdit.save')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Customer search modal */}
      {showCustomerSearch && (
        <div className="modal-overlay">
          <div
            className="modal-content w-full max-w-md mx-4"
            >
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                👤 {t('selectCustomerOptional')}
              </h2>
              <button
                onClick={() => setShowCustomerSearch(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              {/* R-POS-CUSTOMERPICKER-MIGRATION: explicit Walk-in button preserves
                  the affordance the inline list used to provide; picker handles the
                  search/select/inline-create UX. */}
              <button
                onClick={() => {
                  setSelectedCustomer(null);
                  setShowCustomerSearch(false);
                }}
                className="w-full text-left px-3 py-2 mb-3 rounded-lg hover:bg-white/10 text-sm text-slate-400 border border-white/10"
              >
                🚶 {t('pos.walkInOption')}
              </button>

              <CustomerPicker
                customers={customers}
                selectedCustomer={selectedCustomer}
                onSelect={(c) => {
                  if (c && (!selectedCustomer || selectedCustomer.id !== c.id)) {
                    setSelectedCustomer(c);
                    emitCustomerSelected(c.id);
                  }
                  setShowCustomerSearch(false);
                }}
                lang={lang}
                placeholder={t('typeCustomer')}
                onCreateCustomer={handleCreateNewCustomer}
              />
            </div>
          </div>
        </div>
      )}

      {/* Credential Maker */}
      {showCredentialMaker && (
        <CredentialMakerModal
          open={showCredentialMaker}
          onClose={() => setShowCredentialMaker(false)}
        />
      )}

      {/* Notepad */}
      {showNotepad && (
        <NotepadModal
          open={showNotepad}
          onClose={() => setShowNotepad(false)}
        />
      )}

      {/* Estimate */}
      {showEstimate && (
        <EstimateModal
          open={showEstimate}
          onClose={() => setShowEstimate(false)}
        />
      )}

      {/* RMA Label */}
      {showRMALabel && (
        <RMALabelModal
          open={showRMALabel}
          onClose={() => setShowRMALabel(false)}
        />
      )}

      {/* Price Labels */}
      {showLabelPrinter && (
        <PriceLabelsModal
          open={showLabelPrinter}
          onClose={() => setShowLabelPrinter(false)}
        />
      )}

      {/* R-STORE-CREDIT-REDEMPTION-SYSTEM */}
      <ApplyStoreCreditModal
        open={showApplyStoreCredit}
        onClose={() => setShowApplyStoreCredit(false)}
        maxCartCents={Math.max(0, totals.total)}
        ledger={storeCreditLedger}
        alreadyAppliedLedgerIds={cart.map((c) => c.storeCreditLedgerId).filter((x): x is string => !!x)}
        onConfirm={handleApplyStoreCredit}
      />

      {/* International Top-Up */}
      {showTopUp && (
        <TopUpModal
          open={showTopUp}
          onClose={() => setShowTopUp(false)}
          onAddToCart={(items, customer) => {
            // r28b-fix: propagate customer selected inside TopUpModal to POS state
            // so sale.customerId is set at checkout and recordTopUpsToCustomer runs.
            if (customer && (!selectedCustomer || selectedCustomer.id !== customer.id)) {
              setSelectedCustomer(customer);
            }
            setCart([...cart, ...items]);
            setShowTopUp(false);
            toast(t('pos.topUpsAdded', items.length), 'success');
          }}
        />
      )}
    </>
  );
}

// ── Add Custom Category Modal ─────────────────────────────
function AddCategoryModal({ lang, onSave, onClose }: {
  lang: string;
  onSave: (cat: CustomCategory) => void;
  onClose: () => void;
}) {
  void lang; // vestigial — kept for parent compat
  const { t } = useTranslation();
  const [form, setForm] = useState({
    label: '', labelEs: '', icon: '📦', category: 'accessory', taxMode: 'sales' as const,
  });
  const [err, setErr] = useState('');

  const ICONS = ['📦','🔌','🎧','🖥️','📱','🔋','💡','🎮','⌚','💻','🖨️','🔧','🛍️','✨'];

  const handleSave = () => {
    if (!form.label.trim()) { setErr(t('addCategory.errorNameRequired')); return; }
    if (!form.category.trim()) { setErr(t('addCategory.errorCategoryRequired')); return; }
    onSave({
      id: `cat_${Date.now()}`,
      label: form.label.trim(),
      labelEs: form.labelEs.trim() || form.label.trim(),
      icon: form.icon,
      category: form.category.trim().toLowerCase().replace(/\s+/g, '_'),
      taxMode: form.taxMode,
    });
  };

  return (
    <Modal open onClose={onClose} title={t('addCategory.modalTitle')} size="max-w-sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

        {/* Icon picker */}
        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
            {t('addCategory.icon')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {ICONS.map((icon) => (
              <button key={icon} type="button" onClick={() => setForm({ ...form, icon })}
                style={{
                  fontSize: '1.25rem', padding: '0.35rem', borderRadius: '0.5rem', cursor: 'pointer',
                  border: form.icon === icon ? '2px solid #667eea' : '1px solid var(--border-default)',
                  background: form.icon === icon ? 'rgba(102,126,234,0.15)' : 'var(--bg-input)',
                }}>
                {icon}
              </button>
            ))}
            <input
              value={ICONS.includes(form.icon) ? '' : form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="custom"
              className="input"
              style={{ width: '70px', fontSize: '0.8rem', textAlign: 'center' }}
            />
          </div>
        </div>

        {/* Name */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
          <div>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
              {t('addCategory.nameEn')}
            </label>
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Accessories" autoFocus />
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
              {t('addCategory.nameEs')}
            </label>
            <input className="input" value={form.labelEs} onChange={(e) => setForm({ ...form, labelEs: e.target.value })} placeholder="Accesorios" />
          </div>
        </div>

        {/* Inventory category */}
        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
            {t('addCategory.inventoryCategory')}
          </label>
          <input className="input" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder={t('addCategory.inventoryCategoryPlaceholder')} />
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {t('addCategory.inventoryCategoryHint')}
          </div>
        </div>

        {/* Tax mode */}
        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            {t('addCategory.taxMode')}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[
              { v: 'sales', label: t('addCategory.taxModeSales') },
              { v: 'phone_payment', label: t('addCategory.taxModePhone') },
              { v: 'none', label: t('addCategory.taxModeNone') },
            ].map((opt) => (
              <button key={opt.v} type="button"
                onClick={() => setForm({ ...form, taxMode: opt.v as any })}
                style={{
                  flex: 1, padding: '0.4rem 0.25rem', borderRadius: '0.5rem', cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: form.taxMode === opt.v ? 700 : 400,
                  border: `1px solid ${form.taxMode === opt.v ? '#667eea' : 'var(--border-default)'}`,
                  background: form.taxMode === opt.v ? 'rgba(102,126,234,0.15)' : 'var(--bg-input)',
                  color: form.taxMode === opt.v ? '#a5b4fc' : 'var(--text-secondary)',
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.5rem', fontSize: '0.82rem', color: '#f87171' }}>
            ⚠ {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-default)' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
            {t('cancel')}
          </button>
          <button onClick={handleSave} className="btn btn-primary" style={{ flex: 1 }}>
            ✓ {t('addCategory.createButton')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
