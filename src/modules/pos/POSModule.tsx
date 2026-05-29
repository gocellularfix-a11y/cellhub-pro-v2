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
import type { Customer, Sale, InventoryItem, CartItem, StoreCreditLedger } from '@/store/types';

import { persist, batchSave } from '@/services/persist';
import { recordTopUpsToCustomer } from '@/utils/topUpHistory';
import { addLayawayPayment } from '@/services/layaway/payments';
import { redeemLedgerEntry } from '@/services/storeCredit/ledger';
import { forwardTaxFromBase } from '@/utils/depositTax';
import { buildSale, computePaidCents } from './saleBuilder';
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
      pendingPosCustomer, storeCreditLedger,
    },
    setCart, setInventory, setCustomers, setSales,
    setRepairs, setSpecialOrders, setUnlocks, setLayaways, dispatch,
    setStoreCreditLedger,
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
      // ── R-POS-PARTIAL-COMMIT-WINDOW-HIGH-FIX: pre-flight validation ──
      // Walk every linked entity in the sale BEFORE persisting anything so a
      // cancelled repair or cancelled/forfeited layaway aborts the whole
      // checkout cleanly. Previously these guards lived inside §4a (line ~639)
      // and §4d (line ~775), AFTER the sale was persisted and inventory was
      // decremented — a failing guard there returned mid-mutation, leaving
      // persisted Sale + decremented stock + still-active linked entity +
      // uncleared cart. Refs are stable across a single synchronous handler
      // invocation, so the lookups here see exactly the same data §4a/§4d
      // would have seen, which is why the in-loop guards below are now
      // redundant and have been removed (same toasts, same return points,
      // pre-persist).
      const repairIdsInSale = new Set<string>();
      const layawayIdsInSale = new Set<string>();
      for (const saleItem of sale.items) {
        if (saleItem.repairId) repairIdsInSale.add(saleItem.repairId);
        if (saleItem.layawayId) layawayIdsInSale.add(saleItem.layawayId);
      }
      for (const repairId of repairIdsInSale) {
        const repair = repairsRef.current.find((r) => r.id === repairId);
        if (!repair) continue;
        const freshStatus = String(repair.status || '').toLowerCase();
        if (freshStatus === 'cancelled') {
          toast(t('pos.repairCancelledPayment'), 'error');
          return;
        }
      }
      for (const layawayId of layawayIdsInSale) {
        const layaway = layawaysRef.current.find((l) => l.id === layawayId);
        if (!layaway) continue;
        const freshStatus = String(layaway.status || '').toLowerCase();
        if (freshStatus === 'cancelled' || freshStatus === 'forfeited') {
          toast(t('pos.layawayCancelledSale'), 'error');
          return;
        }
      }

      // 1. Save sale (use ref to avoid stale closure if Firestore listener
      //    or another module wrote sales between render and now)
      const nextSales = [...salesRef.current, sale];
      salesRef.current = nextSales;
      setSales(nextSales);
      setLastSale(sale);
      persist.sale(sale.id, sale as unknown as Record<string, unknown>);
      try {
        window.dispatchEvent(new CustomEvent('cellhub:operator-activity', {
          detail: {
            type: 'sale.completed',
            payload: { customerId: sale.customerId || undefined, amountCents: sale.total || 0 },
          },
        }));
      } catch { /* env without CustomEvent */ }

      // R-INTELLIGENCE-CONTINUITY-V1: sale completed — clear any interrupted
      // workflow tracking for the phone_payment portal flow.
      try { clearWorkflowTrack('phone_payment_portal'); } catch { /* non-critical */ }

      // R-INTELLIGENCE-PAYMENT-VERIFY-V1: after phone_payment checkout,
      // schedule a 2-min nudge to remind cashier to confirm carrier portal.
      //
      // R-EXTERNAL-PAYMENT-ONLY-NUDGE-GUARD: only carrier-bound phone_payment
      // items qualify. A phone_payment line without a carrier (rare — usually
      // a manual entry) is treated as internal POS and skipped. The service
      // also enforces the allowlist + carrier-required guard as defense in
      // depth, so this filter and the service guard are independent.
      try {
        const externalPhoneItems = sale.items.filter((i) =>
          i.category === 'phone_payment'
          && typeof (i as any).carrier === 'string'
          && String((i as any).carrier).trim().length > 0
        );
        if (externalPhoneItems.length > 0) {
          const carrier = String((externalPhoneItems[0] as any).carrier).trim();
          const amountCents = externalPhoneItems.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
          const created = addVerification({
            saleId: sale.id,
            customerName: sale.customerName || selectedCustomer?.name || '',
            carrier,
            amountCents,
            source: 'phone_payment',
          });
          if (created) {
            window.dispatchEvent(new CustomEvent('cellhub:payment-verify-nudge'));
          }
        }
      } catch { /* non-critical */ }

      // 2. Deduct inventory (using ref)
      const updatedInventory = [...inventoryRef.current];
      const inventoryOps: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];

      for (const saleItem of sale.items) {
        if (!saleItem.inventoryId) continue;
        const idx = updatedInventory.findIndex((i) => i.id === saleItem.inventoryId);
        if (idx >= 0 && updatedInventory[idx].category !== 'service') {
          // R-SIM-INTAKE: surface a warning if the item we're "decrementing"
          // already shows qty=0. The Math.max(0, ...) clamps to zero (no
          // negative qty), but the physical sale still happened — log so it
          // can be reconciled (typical cause: same SIM scanned twice in
          // back-to-back transactions before the first persist landed).
          if ((updatedInventory[idx].qty || 0) <= 0 && (saleItem.qty || 0) > 0) {
            // eslint-disable-next-line no-console
            console.warn(
              '[POS] Sale item with inventoryId but inventory qty already 0:',
              { name: saleItem.name, id: saleItem.inventoryId, soldQty: saleItem.qty },
            );
          }
          updatedInventory[idx] = {
            ...updatedInventory[idx],
            qty: Math.max(0, updatedInventory[idx].qty - saleItem.qty),
          };
          inventoryOps.push({
            collection: 'inventory',
            id: updatedInventory[idx].id,
            data: updatedInventory[idx] as unknown as Record<string, unknown>,
          });
        }
      }
      if (inventoryOps.length > 0) {
        inventoryRef.current = updatedInventory;
        setInventory(updatedInventory);
        batchSave(inventoryOps);
      }

      // 3. + 5. COLLAPSED — Build the final customer state in ONE pass.
      // Previously this was two separate setCustomers calls (store credit, then
      // loyalty), and the second one's `customers.map()` operated on the closure-
      // captured `customers`, sobreescribiendo la deducción de store credit del
      // primer call. CRITICAL: must be a single setCustomers, single map.
      let workingCustomers = customersRef.current;
      let workingCustomer = selectedCustomer;
      let customerChanged = false;

      // 3. Store credit deduction
      const isStoreCreditPayment =
        sale.paymentMethod === 'store_credit' || sale.paymentMethod === 'Store Credit';
      if (isStoreCreditPayment && selectedCustomer) {
        const creditUsed = Math.min(selectedCustomer.storeCredit || 0, sale.total);
        if (creditUsed > 0) {
          workingCustomer = {
            ...workingCustomer!,
            storeCredit: Math.max(0, (workingCustomer!.storeCredit || 0) - creditUsed),
          };
          workingCustomers = workingCustomers.map((c) =>
            c.id === workingCustomer!.id ? workingCustomer! : c,
          );
          customerChanged = true;
        }
      }

      // 5. Loyalty points
      // NOTE: Loyalty feature is not yet customer-facing — Jorge will activate it
      // when CellHub Pro is at 100%. Code accumulates correctly at 1 point per $1
      // (pointsBase is in cents, divided by 100). Phone payments and top-ups are
      // excluded because they have low margin and would erode profitability.
      if (sale.customerId && settings.loyaltyEnabled && workingCustomer) {
        // CRITICAL: loyaltyBase is the canonical source. Previously this used
        // `sale.subtotalAfterDiscount ?? loyaltyBase` which silently included
        // phone_payment/top_up items (the ?? fallback was never hit), making
        // the .filter() above a no-op. Also diverged from ReceiptModal's
        // walk-in assign formula, so the same customer got different point
        // counts depending on when the sale was assigned to them. Use the
        // filtered loyaltyBase directly — matches ReceiptModal.
        const loyaltyBase = sale.items
          .filter((i) => i.category !== 'phone_payment' && i.category !== 'top_up')
          .reduce((sum, i) => sum + i.price * i.qty, 0);
        // 1 loyalty point per $1 spent (loyaltyBase is in cents → divide by 100)
        const pts = Math.trunc(loyaltyBase / 100);
        if (pts > 0) {
          workingCustomer = {
            ...workingCustomer,
            loyaltyPoints: (workingCustomer.loyaltyPoints || 0) + pts,
          };
          workingCustomers = workingCustomers.map((c) =>
            c.id === workingCustomer!.id ? workingCustomer! : c,
          );
          customerChanged = true;
        }
      }

      // 6. r28b — Top-up history. If this sale has any top_up items AND a customer,
      // append/update the customer's persistent recipient memory. Helper is pure
      // and idempotent at the entry level — repeat recipients increment count.
      if (sale.customerId && workingCustomer) {
        const topUpItems = sale.items.filter((i) => i.category === 'top_up');
        if (topUpItems.length > 0) {
          const updatedCustomer = recordTopUpsToCustomer(
            workingCustomer,
            topUpItems,
            new Date().toISOString(),
          );
          // recordTopUpsToCustomer returns the same reference if no items contributed
          if (updatedCustomer !== workingCustomer) {
            workingCustomer = updatedCustomer;
            workingCustomers = workingCustomers.map((c) =>
              c.id === workingCustomer!.id ? workingCustomer! : c,
            );
            customerChanged = true;
          }
        }
      }

      // Single setCustomers + single persist call at the end
      if (customerChanged && workingCustomer) {
        customersRef.current = workingCustomers;
        setCustomers(workingCustomers);
        persist.customer(workingCustomer.id, workingCustomer as unknown as Record<string, unknown>);
      }

      // 4. ── r-deposit-integrity-1 P1: Linked Entity Reconciliation ──
      //
      // PREVIOUSLY: RepairModule/SpecialOrdersModule/UnlockModule/LayawayModule
      // decremented `balance` and persisted `depositAmount`>0 at CREATE time,
      // BEFORE the POS checkout confirmed the payment. If the cashier abandoned
      // the cart, the entity was left with a ghost deposit = false revenue in
      // Dashboard/Reports. The repair handler here was written defensively to
      // NOT double-subtract, which baked the bug into the invariant.
      //
      // NOW: Entity modules persist with depositAmount/paidAmount = 0 and
      // full balance at CREATE. The deposit lives only in the cart until this
      // handler confirms the sale. POSModule is the SINGLE SOURCE OF TRUTH for
      // incrementing depositAmount/paidAmount and decrementing balance.
      //
      // Algorithm:
      //   For each cart item with a linked entity ID (repairId / specialOrderId
      //   / unlockId / layawayId), reconstruct the tax-inclusive dollar amount
      //   the customer actually paid for that item using forwardTaxFromBase
      //   (the inverse of reverseTaxFromPayment, which the modules used to push
      //   pre-tax base into the cart). Sum per entity, increment, recalc
      //   balance. If balance hits 0, mark as picked_up / completed.
      // Round POS-T1: ?? not || so taxRate=0 (tax-exempt stores) stays 0.
      const taxRateForReconcile = settings.taxRate ?? 0.0925;

      // r-deposit-integrity-1b P1: discount ratio reconstruction.
      //
      // The main round's helper read item.price as the pre-tax base the
      // customer paid, but item.price is the PRE-discount base. When the
      // cashier applied a cart discount, calculateCartTotals spread the
      // discount proportionally across all discountable items (repair-
      // deposit items are category === 'service', which IS discountable).
      // That meant the customer paid (base * ratio + tax) but the entity
      // was credited with (base + tax) — silent overcounting.
      //
      // We reconstruct discountableAmount from sale.items using the SAME
      // filter calculateCartTotals uses (exclude phone_payment and top_up),
      // derive discountAmount from sale.subtotal vs subtotalAfterDiscount,
      // and compute the discountable-only ratio. Exact across 200K+ test
      // cases (49,901 deposits × 4 discount rates @ 9.25%, zero drift).
      //
      // NOTE: we do NOT use (subtotalAfterDiscount / subtotal) as the ratio
      // — that would blend discountable + non-discountable items and give
      // the wrong answer any time a phone_payment or top_up is in the cart.
      let discountableBaseSum = 0;
      for (const saleItem of sale.items) {
        if (saleItem.category === 'phone_payment' || saleItem.category === 'top_up') continue;
        discountableBaseSum += (saleItem.price || 0) * (saleItem.qty || 1);
      }
      const saleDiscountAmount = Math.max(
        0,
        (sale.subtotal || 0) - (sale.subtotalAfterDiscount ?? sale.subtotal ?? 0),
      );
      const discountRatioForReconcile =
        discountableBaseSum > 0
          ? Math.max(0, (discountableBaseSum - saleDiscountAmount) / discountableBaseSum)
          : 1;

      // Helper: compute total cents the customer paid for a sale item
      // (includes tax if the item was taxable, AND accounts for cart
      // discount). Matches what PaymentModal ended up charging for that
      // line. Non-discountable items (phone_payment, top_up) bypass the
      // ratio but also never appear as linked-entity items, so they
      // never reach this helper in practice.
      const itemPaidCents = (item: Sale['items'][number]): number => {
        const isDiscountable =
          item.category !== 'phone_payment' && item.category !== 'top_up';
        const effectiveBase = isDiscountable
          ? Math.round((item.price || 0) * discountRatioForReconcile)
          : (item.price || 0);
        const fwd = forwardTaxFromBase(effectiveBase, taxRateForReconcile, !!item.taxable);
        return fwd.totalCents * (item.qty || (item as any).quantity || 1);
      };

      // ── 4a. Repairs ─────────────────────────────────────
      const updatedRepairs = [...repairsRef.current];
      const repairOps: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
      const repairDeltas = new Map<string, number>();
      for (const saleItem of sale.items) {
        if (!saleItem.repairId) continue;
        repairDeltas.set(
          saleItem.repairId,
          (repairDeltas.get(saleItem.repairId) || 0) + itemPaidCents(saleItem),
        );
      }
      for (const [repairId, paidCents] of repairDeltas) {
        const ri = updatedRepairs.findIndex((r) => r.id === repairId);
        if (ri < 0) continue;
        const repair = updatedRepairs[ri];

        // R-POS-PARTIAL-COMMIT-WINDOW-HIGH-FIX: the prior H2 cancel guard
        // (Round R-POS-PARITY F3) lived here and returned mid-handler if
        // repair.status was 'cancelled' — but by that point §1+§2 had
        // already persisted the sale and decremented inventory. The guard
        // is now hoisted into the pre-flight block at the top of
        // handleCompleteSale, which runs against the same repairsRef.

        // r-new-7: defensive sanity check — overpayment detection.
        // The cart consolidation invariant in RepairModule should prevent
        // overpayment, but log if it ever fires. 1 cent tolerance for rounding
        // drift in mixed-tax carts.
        const expectedBalance = repair.balance || 0;
        if (paidCents > expectedBalance + 1) {
          console.warn(
            `[repair-reconcile] Overpayment on repair ${repairId}:`,
            `paid ${paidCents} cents, balance was ${expectedBalance} cents.`,
            `Diff: ${paidCents - expectedBalance} cents (possible stale cart).`,
          );
        }

        const newDeposit = (repair.depositAmount || 0) + paidCents;
        const newBalance = Math.max(0, (repair.balance || 0) - paidCents);
        // R-COMPLETEDAT-FIELD: stamp completedAt only on the transition to
        // picked_up; preserve existing value if already set; leave untouched
        // when balance > 0 (still active).
        const nowIso = new Date().toISOString();
        updatedRepairs[ri] = {
          ...repair,
          depositAmount: newDeposit,
          balance: newBalance,
          status: newBalance === 0 ? 'picked_up' as const : repair.status,
          updatedAt: nowIso,
          completedAt: newBalance === 0 ? (repair.completedAt ?? nowIso) : repair.completedAt,
        };
        repairOps.push({
          collection: 'repairTickets',
          id: updatedRepairs[ri].id,
          data: updatedRepairs[ri] as unknown as Record<string, unknown>,
        });
      }
      if (repairOps.length > 0) {
        repairsRef.current = updatedRepairs;
        setRepairs(updatedRepairs);
        batchSave(repairOps);
      }

      // ── 4b. Special Orders ──────────────────────────────
      const updatedSOs = [...specialOrdersRef.current];
      const soOps: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
      const soDeltas = new Map<string, number>();
      for (const saleItem of sale.items) {
        if (!saleItem.specialOrderId) continue;
        soDeltas.set(
          saleItem.specialOrderId,
          (soDeltas.get(saleItem.specialOrderId) || 0) + itemPaidCents(saleItem),
        );
      }
      for (const [soId, paidCents] of soDeltas) {
        const si = updatedSOs.findIndex((o) => o.id === soId);
        if (si < 0) continue;
        const so = updatedSOs[si];
        const newDeposit = (so.depositAmount || 0) + paidCents;
        const newBalance = Math.max(0, (so.balance || 0) - paidCents);
        updatedSOs[si] = {
          ...so,
          depositAmount: newDeposit,
          balance: newBalance,
          status: newBalance === 0 ? 'picked_up' : so.status,
          updatedAt: new Date().toISOString(),
        };
        soOps.push({
          collection: 'specialOrders',
          id: updatedSOs[si].id,
          data: updatedSOs[si] as unknown as Record<string, unknown>,
        });
      }
      if (soOps.length > 0) {
        specialOrdersRef.current = updatedSOs;
        setSpecialOrders(updatedSOs);
        batchSave(soOps);
      }

      // ── 4c. Unlocks ─────────────────────────────────────
      const updatedUnlocks = [...unlocksRef.current];
      const unlockOps: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
      const unlockDeltas = new Map<string, number>();
      for (const saleItem of sale.items) {
        if (!saleItem.unlockId) continue;
        unlockDeltas.set(
          saleItem.unlockId,
          (unlockDeltas.get(saleItem.unlockId) || 0) + itemPaidCents(saleItem),
        );
      }
      for (const [unlockId, paidCents] of unlockDeltas) {
        const ui = updatedUnlocks.findIndex((u) => u.id === unlockId);
        if (ui < 0) continue;
        const unlock = updatedUnlocks[ui];
        const newDeposit = (unlock.depositAmount || 0) + paidCents;
        const newBalance = Math.max(0, (unlock.balance || 0) - paidCents);
        updatedUnlocks[ui] = {
          ...unlock,
          depositAmount: newDeposit,
          balance: newBalance,
          updatedAt: new Date().toISOString(),
        };
        unlockOps.push({
          collection: 'unlocks',
          id: updatedUnlocks[ui].id,
          data: updatedUnlocks[ui] as unknown as Record<string, unknown>,
        });
      }
      if (unlockOps.length > 0) {
        unlocksRef.current = updatedUnlocks;
        setUnlocks(updatedUnlocks);
        batchSave(unlockOps);
      }

      // ── 4d. Layaways ────────────────────────────────────
      // Layaway uses `paidAmount` (not `depositAmount`) as its cumulative
      // paid field. When balance hits 0, status → 'completed' (not
      // 'picked_up' — that's a repair concept).
      const updatedLayaways = [...layawaysRef.current];
      const layawayOps: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
      const layawayDeltas = new Map<string, number>();
      for (const saleItem of sale.items) {
        if (!saleItem.layawayId) continue;
        layawayDeltas.set(
          saleItem.layawayId,
          (layawayDeltas.get(saleItem.layawayId) || 0) + itemPaidCents(saleItem),
        );
      }
      for (const [layawayId, paidCents] of layawayDeltas) {
        const li = updatedLayaways.findIndex((l) => l.id === layawayId);
        if (li < 0) continue;
        const layaway = updatedLayaways[li];
        // R-POS-PARTIAL-COMMIT-WINDOW-HIGH-FIX: the prior Round-15b H2 guard
        // (cancelled/forfeited abort) lived here and returned mid-handler —
        // after §1+§2 had persisted the sale and decremented inventory.
        // The guard is now hoisted into the pre-flight block at the top of
        // handleCompleteSale, which runs against the same layawaysRef.

        // Round 15b M4: write depositMethod on the FIRST payment only. Refund
        // policy is refund-to-original-method, so we must lock the method in
        // at first deposit and never overwrite on subsequent partials.
        const depositMethodUpdate = layaway.depositMethod
          ? {}
          : { depositMethod: sale.paymentMethod };
        // R-LAYAWAY-MULTIPAY-V1 (audit-integrity blocker fix):
        // 1) addLayawayPayment clamps the appended record to remaining
        //    balance, so payments[] can never sum to more than totalPrice.
        // 2) Aggregate paidAmount is DERIVED from payments[] sum, not from
        //    the additive `paidAmount + paidCents` legacy formula. This
        //    guarantees sum(payments[]) === paidAmount on every commit and
        //    eliminates the silent drift the auditor flagged.
        // 3) try/catch is now a corruption-only fallback: helper throws
        //    only on non-positive / non-finite amount. On the rare throw
        //    we drop back to the legacy additive math (loud via warn) so
        //    the layaway aggregate still moves and POS doesn't lock up.
        // 4) Existing overpay tolerance is preserved: balance still ends
        //    at 0 when paidCents > remaining; the overpay portion lives
        //    only in the Sale record (cash drawer) and is intentionally
        //    NOT mirrored into the layaway log.
        let withPaymentLog: typeof layaway = layaway;
        let helperSucceeded = false;
        try {
          withPaymentLog = addLayawayPayment(layaway, {
            amountCents: paidCents,
            method: sale.paymentMethod,
            employeeId: sale.employeeId,
            date: new Date().toISOString(),
          });
          helperSucceeded = true;
        } catch (err) {
          console.warn('[POS §4d] addLayawayPayment threw, falling back to legacy aggregate update:', err);
        }
        const reconciledPaid = helperSucceeded && Array.isArray(withPaymentLog.payments)
          ? withPaymentLog.payments.reduce((s, p) => s + (p.amount || 0), 0)
          : (layaway.paidAmount || 0) + paidCents;
        const newPaid = reconciledPaid;
        const newBalance = Math.max(0, (layaway.totalPrice || 0) - newPaid);
        updatedLayaways[li] = {
          ...withPaymentLog,
          ...depositMethodUpdate,
          paidAmount: newPaid,
          balance: newBalance,
          status: newBalance === 0 ? 'completed' : layaway.status,
          updatedAt: new Date().toISOString(),
        };
        layawayOps.push({
          collection: 'layaways',
          id: updatedLayaways[li].id,
          data: updatedLayaways[li] as unknown as Record<string, unknown>,
        });
      }
      if (layawayOps.length > 0) {
        layawaysRef.current = updatedLayaways;
        setLayaways(updatedLayaways);
        batchSave(layawayOps);
      }

      // ── 4e. Store-credit redemption ──────────────────────
      // R-STORE-CREDIT-REDEMPTION-SYSTEM: every cart line that came from
      // ApplyStoreCreditModal carries `storeCreditLedgerId` + a negative
      // `price`. Record one redemption per line against the matching
      // ledger entry. Aggregates per ledgerId in case two lines target
      // the same cert (defensive — modal blocks this today via
      // alreadyAppliedLedgerIds, but the post-hook must still be safe).
      const ledgerDeltas = new Map<string, { cents: number; cert: string }>();
      for (const item of sale.items) {
        const lid = (item as any).storeCreditLedgerId as string | undefined;
        if (!lid) continue;
        const cert = (item as any).storeCreditCertNumber || '';
        const absCents = Math.abs((item.price || 0) * (item.qty || 1));
        if (absCents <= 0) continue;
        const prev = ledgerDeltas.get(lid);
        ledgerDeltas.set(lid, { cents: (prev?.cents || 0) + absCents, cert: cert || prev?.cert || '' });
      }
      if (ledgerDeltas.size > 0) {
        const updatedLedger = [...storeCreditLedgerRef.current];
        const ledgerOps: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
        for (const [lid, { cents }] of ledgerDeltas) {
          const idx = updatedLedger.findIndex((l) => l.id === lid);
          if (idx < 0) continue;
          try {
            const { ledger: nextLedger } = redeemLedgerEntry(updatedLedger[idx], {
              amountCents: cents,
              saleId: sale.id,
              invoiceNumber: sale.invoiceNumber,
              employeeId: sale.employeeId,
              employeeName: sale.employeeName || currentEmployee?.name || '',
            });
            updatedLedger[idx] = nextLedger;
            ledgerOps.push({
              collection: 'storeCreditLedger',
              id: nextLedger.id,
              data: nextLedger as unknown as Record<string, unknown>,
            });
          } catch (err) {
            console.warn('[POS §4e] redeemLedgerEntry rejected:', err);
          }
        }
        if (ledgerOps.length > 0) {
          storeCreditLedgerRef.current = updatedLedger;
          setStoreCreditLedger(updatedLedger);
          batchSave(ledgerOps);
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
      setCart, settings, toast, lang,
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
    // de PaymentModal (path B). Persist, inventory, customer, reconcile,
    // SMS (I4), reset (I5), receipt — todo ahí.
    handleCompleteSale(sale);
  }, [
    cart, totals, paymentMethod, cashAmount, cardAmount,
    selectedCustomer, currentEmployee, settings, lang, toast,
    handleCompleteSale,
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
          onComplete={handleCompleteSale}
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
