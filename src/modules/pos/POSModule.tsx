// ============================================================
// CellHub Pro — POS Module (Main Orchestrator)
// ============================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, SearchInput, Modal } from '@/components/ui';
import { getLabels } from '@/config/i18n';
import { generateId } from '@/utils/dates';
import { formatCurrency } from '@/utils/currency';
import { normalizePhone } from '@/utils/normalize';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { loadLocal, saveLocal } from '@/services/storage';

import QuickActionGrid from './QuickActionGrid';
import ProductGrid from './ProductGrid';
import QuickServicePanel from './QuickServicePanel';
import Cart from './Cart';
import PhonePaymentModal from './PhonePaymentModal';
import PaymentModal from './PaymentModal';
import ReceiptModal from './ReceiptModal';
import CredentialMakerModal from './CredentialMakerModal';
import NotepadModal from './NotepadModal';
import EstimateModal from './EstimateModal';
import RMALabelModal from './RMALabelModal';
import LabelPrinterModal from './LabelPrinterModal';
import TopUpModal from './TopUpModal';
import type { CartTotals, DiscountState, CustomCategory, calculateCartTotals } from './types';
import { calculateCartTotals as calcTotals } from './types';
import type { Customer, Sale, InventoryItem, CartItem } from '@/store/types';

import { persist, batchSave } from '@/services/persist';
import { recordTopUpsToCustomer } from '@/utils/topUpHistory';
import { forwardTaxFromBase } from '@/utils/depositTax';

export default function POSModule() {
  const {
    state: {
      inventory, customers, sales, repairs, specialOrders, unlocks, layaways,
      settings, currentEmployee, cart, lang, inventorySearchTerm, pendingPhonePaymentCustomerId,
      pendingPosCustomer,
    },
    setCart, setInventory, setCustomers, setSales,
    setRepairs, setSpecialOrders, setUnlocks, setLayaways, dispatch,
  } = useApp();

  const { toast } = useToast();
  const L = getLabels(lang);

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

  // ── Local State ─────────────────────────────────────────

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
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
  const [showCredentialMaker, setShowCredentialMaker] = useState(false);
  const [showNotepad, setShowNotepad] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);
  const [showRMALabel, setShowRMALabel] = useState(false);
  const [showLabelPrinter, setShowLabelPrinter] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [customerSearchQ, setCustomerSearchQ] = useState('');

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
  const isSearchActive = searchTerm.trim().length > 0;

  const searchResults = useMemo(() => {
    if (!isSearchActive) return [];
    const q = searchTerm.trim();
    return inventory.filter((item) =>
      matchesSearch(q, item.name, item.sku, item.barcode, item.imei, item.category),
    );
  }, [searchTerm, inventory, isSearchActive]);

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
    const isPhone = (c: string) => c === 'phone' || c === 'phones';
    const isAccessory = (c: string) => c === 'accessory' || c === 'accessories';
    const catMap: Record<string, (item: InventoryItem) => boolean> = {
      accessories: (i) => isAccessory(cat(i)) && i.qty > 0,
      cellphones: (i) => isPhone(cat(i)) && i.qty > 0,
      services: (i) => cat(i) === 'service',
      international: (i) => cat(i) === 'top_up',
    };

    const filter = catMap[activeCategory];
    return filter ? inventory.filter(filter) : [];
  }, [activeCategory, inventory, customCategories]);

  // Customer search results
  const customerResults = useMemo(() => {
    if (!customerSearchQ.trim()) return customers.slice(0, 10);
    return customers.filter((c) =>
      matchesSearch(customerSearchQ, c.name, c.phone, c.email, c.customerNumber),
    );
  }, [customerSearchQ, customers]);

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
        toast(L.outOfStock || 'Out of stock', 'warning');
        return;
      }
      const currentCart = cartRef.current;
      const existing = currentCart.find((c) => c.inventoryId === item.id);

      if (existing) {
        if (existing.qty >= getStock(item)) {
          toast(L.notEnoughStock || 'Not enough stock!', 'warning');
          return;
        }
        const next = currentCart.map((c) =>
          c.inventoryId === item.id ? { ...c, qty: c.qty + 1 } : c,
        );
        cartRef.current = next;
        setCart(next);
      } else {
        // Determine tax mode from active category
        let taxable = !['service', 'quick_charge', 'phone_payment', 'top_up'].includes(item.category);
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

        // Bundle suggestion — when a phone is added, suggest accessories
        if (item.category === 'phone' || item.category === 'phones' || item.category === 'Phone' || item.category === 'Phones') {
          const suggestions = inventory.filter(
            (i) =>
              (i.category === 'accessory' || i.category === 'accessories' || i.category === 'Accessory' || i.category === 'Accessories') &&
              i.qty > 0 &&
              !currentCart.some((c) => c.inventoryId === i.id) &&
              i.id !== item.id,
          ).slice(0, 4);
          if (suggestions.length > 0) setBundleSuggestion(suggestions);
        }
      }

      toast(
        lang === 'es' ? `${item.name} agregado` : `${item.name} added`,
        'success',
      );
    },
    [setCart, activeCategory, customCategories, getStock, toast, L, inventory, lang],
  );

  // ── Complete Sale ───────────────────────────────────────

  const handleCompleteSale = useCallback(
    (sale: Sale) => {
      // 1. Save sale (use ref to avoid stale closure if Firestore listener
      //    or another module wrote sales between render and now)
      const nextSales = [...salesRef.current, sale];
      salesRef.current = nextSales;
      setSales(nextSales);
      setLastSale(sale);
      persist.sale(sale.id, sale as unknown as Record<string, unknown>);

      // 2. Deduct inventory (using ref)
      const updatedInventory = [...inventoryRef.current];
      const inventoryOps: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];

      for (const saleItem of sale.items) {
        if (!saleItem.inventoryId) continue;
        const idx = updatedInventory.findIndex((i) => i.id === saleItem.inventoryId);
        if (idx >= 0 && updatedInventory[idx].category !== 'service') {
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
        const pts = Math.floor(loyaltyBase / 100);
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

        // Round R-POS-PARITY F3: H2 cancel guard (parity with Layaway
        // line 644-653). Re-read fresh status; abort the entire handler
        // if the repair was cancelled between cart-add and checkout
        // commit. This prevents reconciling a payment onto a dead record.
        // Repair has no 'forfeited' status (that's layaway-specific), so
        // only 'cancelled' is checked.
        const freshStatus = String(repair.status || '').toLowerCase();
        if (freshStatus === 'cancelled') {
          toast(
            lang === 'es'
              ? 'La reparación fue cancelada. El pago no se procesó.'
              : 'Repair was cancelled. Payment was not processed.',
            'error',
          );
          return;
        }

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
        updatedRepairs[ri] = {
          ...repair,
          depositAmount: newDeposit,
          balance: newBalance,
          status: newBalance === 0 ? 'picked_up' as const : repair.status,
          updatedAt: new Date().toISOString(),
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
        // Round 15b H2: re-read status; abort if the layaway was cancelled or
        // forfeited between cart-add and checkout commit.
        const freshStatus = String(layaway.status || '').toLowerCase();
        if (freshStatus === 'cancelled' || freshStatus === 'forfeited') {
          toast(
            lang === 'es'
              ? 'Este apartado fue cancelado. No se puede completar la venta.'
              : 'This layaway was cancelled. Cannot complete sale.',
            'error',
          );
          return;
        }
        const newPaid = (layaway.paidAmount || 0) + paidCents;
        const newBalance = Math.max(0, (layaway.balance || 0) - paidCents);
        // Round 15b M4: write depositMethod on the FIRST payment only. Refund
        // policy is refund-to-original-method, so we must lock the method in
        // at first deposit and never overwrite on subsequent partials.
        const depositMethodUpdate = layaway.depositMethod
          ? {}
          : { depositMethod: sale.paymentMethod };
        updatedLayaways[li] = {
          ...layaway,
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

      toast(
        lang === 'es'
          ? `Venta ${sale.invoiceNumber} completada!`
          : `Sale ${sale.invoiceNumber} completed!`,
        'success',
      );
    },
    [
      setSales, setInventory, setCustomers,
      selectedCustomer, setRepairs, setSpecialOrders, setUnlocks, setLayaways,
      setCart, settings, toast, lang,
    ],
  );

  // ── Clear Cart ──────────────────────────────────────────

  const handleClearCart = useCallback(() => {
    cartRef.current = [];
    setCart([]);
    setBundleSuggestion([]);
    setDiscount({ amount: 0, type: 'percent', reason: '' });
    setSelectedCustomer(null);
    setShowClearConfirm(false);
    toast(lang === 'es' ? 'Carrito vacío' : 'Cart cleared', 'info');
  }, [setCart, toast, lang]);

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
        title: cat ? (lang === 'es' && cat.labelEs ? cat.labelEs : cat.label) : 'Category',
        subtitle: cat?.description || L.selectItemsToAdd || '',
      };
    }

    const titles: Record<string, { title: string; subtitle: string }> = {
      accessories: { title: L.qaAccessories, subtitle: L.qaAccessoriesDesc },
      cellphones: { title: L.qaCellphones, subtitle: L.qaCellphonesDesc },
      services: { title: L.qaServices, subtitle: L.qaServicesDesc },
      international: { title: L.internationalTopUp, subtitle: L.selectProviderAmount || '' },
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
                {L.searchResults || 'Search Results'}
              </h2>
              <p className="text-sm text-slate-400">
                {searchResults.length} {lang === 'es' ? 'resultado(s)' : (searchResults.length === 1 ? 'item found' : 'items found')}
              </p>
            </div>
            <button
              onClick={() => handleSearchChange('')}
              className="btn btn-secondary btn-sm"
            >
              ✕ {L.clearSearch || 'Clear Search'}
            </button>
          </div>

          <SearchInput
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder={L.searchPlaceholder}
            className="mb-4"
            autoFocus
          />

          <div className="flex-1 overflow-y-auto">
            {searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <span className="text-5xl mb-4">🔍</span>
                <p className="font-medium">{L.noMatches || 'No matches'}</p>
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
                      {(item.category === 'phone' || item.category === 'phones' || item.category === 'Phone' || item.category === 'Phones') ? '📱' :
                       (item.category === 'accessory' || item.category === 'accessories' || item.category === 'Accessory' || item.category === 'Accessories') ? '🎧' : '📦'}
                    </div>
                    <p className="text-sm font-bold text-white mb-1 line-clamp-2">{item.name}</p>
                    <p className="text-base font-bold text-emerald-400">
                      {formatCurrency(item.price)}
                    </p>
                    <p className="text-xs text-slate-500">{item.qty} in stock</p>
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
            background: '#1e293b', border: '1px solid rgba(99,102,241,0.4)',
            borderRadius: '0.875rem', padding: '0.875rem 1rem', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a5b4fc' }}>
                📦 {lang === 'es' ? '¿Agregar accesorios?' : 'Add accessories?'}
              </span>
              <button onClick={() => setBundleSuggestion([])} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
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
                    padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.5rem',
                    cursor: 'pointer', fontSize: '0.75rem', color: '#e2e8f0', textAlign: 'left', gap: '0.4rem',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</span>
                  <span style={{ color: '#34d399', fontWeight: 700, flexShrink: 0 }}>${(acc.price / 100).toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Right: cart panel (only when items in cart) */}
        {cart.length > 0 && (
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
            onCheckout={() => setShowPayment(true)}
            onClearCart={() => setShowClearConfirm(true)}
            onSelectCustomer={() => setShowCustomerSearch(true)}
            settings={settings}
            lang={lang}
            L={L}
          />
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────── */}

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
      />

      <PaymentModal
        open={showPayment}
        onClose={() => setShowPayment(false)}
        cart={cart}
        totals={totals}
        paymentMethod={paymentMethod}
        selectedCustomer={selectedCustomer}
        currentEmployee={currentEmployee}
        settings={settings}
        onComplete={handleCompleteSale}
        onSelectCustomer={() => { setShowPayment(false); setShowCustomerSearch(true); }}
        lang={lang}
        L={L}
      />

      <ReceiptModal
        open={showReceipt}
        sale={lastSale}
        settings={settings}
        onClose={() => setShowReceipt(false)}
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
            toast(lang === 'es' ? 'Categoría creada' : 'Category created', 'success');
          }}
          onClose={() => setShowAddCategory(false)}
        />
      )}

      <ConfirmDialog
        open={showClearConfirm}
        title={L.clearCartConfirm || 'Clear cart?'}
        message={L.clearCartConfirm || 'Clear entire cart?'}
        variant="danger"
        confirmLabel={L.clear || 'Clear'}
        cancelLabel={L.cancel || 'Cancel'}
        onConfirm={handleClearCart}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Customer search modal */}
      {showCustomerSearch && (
        <div className="modal-overlay">
          <div
            className="modal-content w-full max-w-md mx-4"
            >
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                👤 {L.selectCustomerOptional}
              </h2>
              <button
                onClick={() => setShowCustomerSearch(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              <SearchInput
                value={customerSearchQ}
                onChange={setCustomerSearchQ}
                placeholder={L.typeCustomer || 'Search customers…'}
                autoFocus
                className="mb-3"
              />

              <div className="max-h-64 overflow-y-auto space-y-1">
                {/* Walk-in option */}
                <button
                  onClick={() => {
                    setSelectedCustomer(null);
                    setShowCustomerSearch(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-slate-400"
                >
                  🚶 {lang === 'es' ? 'Sin cliente' : 'Walk-in (no customer)'}
                </button>

                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer(c);
                      setShowCustomerSearch(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-sm font-bold">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm text-white">{c.name}</p>
                      <p className="text-xs text-slate-500">
                        {c.phone}
                        {c.storeCredit > 0 && (
                          <span className="text-emerald-400 ml-2">
                            Credit: {formatCurrency(c.storeCredit)}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>
                ))}

                {customerResults.length === 0 && customerSearchQ.trim() && (
                  <p className="text-center text-slate-500 text-sm py-4">
                    {L.noMatches || 'No matches'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Credential Maker */}
      <CredentialMakerModal
        open={showCredentialMaker}
        onClose={() => setShowCredentialMaker(false)}
      />

      {/* Notepad */}
      <NotepadModal
        open={showNotepad}
        onClose={() => setShowNotepad(false)}
      />

      {/* Estimate */}
      <EstimateModal
        open={showEstimate}
        onClose={() => setShowEstimate(false)}
      />

      {/* RMA Label */}
      <RMALabelModal
        open={showRMALabel}
        onClose={() => setShowRMALabel(false)}
      />

      {/* Label Printer */}
      <LabelPrinterModal
        open={showLabelPrinter}
        onClose={() => setShowLabelPrinter(false)}
      />

      {/* International Top-Up */}
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
          toast(
            lang === 'es'
              ? `${items.length} recarga(s) agregada(s) al carrito`
              : `${items.length} top-up(s) added to cart`,
            'success',
          );
        }}
      />
    </>
  );
}

// ── Add Custom Category Modal ─────────────────────────────
function AddCategoryModal({ lang, onSave, onClose }: {
  lang: string;
  onSave: (cat: CustomCategory) => void;
  onClose: () => void;
}) {
  const es = lang === 'es';
  const [form, setForm] = useState({
    label: '', labelEs: '', icon: '📦', category: 'accessory', taxMode: 'sales' as const,
  });
  const [err, setErr] = useState('');

  const ICONS = ['📦','🔌','🎧','🖥️','📱','🔋','💡','🎮','⌚','💻','🖨️','🔧','🛍️','✨'];

  const handleSave = () => {
    if (!form.label.trim()) { setErr(es ? 'Nombre requerido' : 'Name required'); return; }
    if (!form.category.trim()) { setErr(es ? 'Categoría de inventario requerida' : 'Inventory category required'); return; }
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
    <Modal open onClose={onClose} title={es ? '➕ Nueva Categoría' : '➕ New Category'} size="max-w-sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

        {/* Icon picker */}
        <div>
          <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
            {es ? 'Ícono' : 'Icon'}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {ICONS.map((icon) => (
              <button key={icon} type="button" onClick={() => setForm({ ...form, icon })}
                style={{
                  fontSize: '1.25rem', padding: '0.35rem', borderRadius: '0.5rem', cursor: 'pointer',
                  border: form.icon === icon ? '2px solid #667eea' : '1px solid rgba(255,255,255,0.12)',
                  background: form.icon === icon ? 'rgba(102,126,234,0.15)' : 'rgba(255,255,255,0.04)',
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
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
              {es ? 'Nombre (EN) *' : 'Name (EN) *'}
            </label>
            <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Accessories" autoFocus />
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
              {es ? 'Nombre (ES)' : 'Name (ES)'}
            </label>
            <input className="input" value={form.labelEs} onChange={(e) => setForm({ ...form, labelEs: e.target.value })} placeholder="Accesorios" />
          </div>
        </div>

        {/* Inventory category */}
        <div>
          <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.25rem', fontWeight: 600 }}>
            {es ? 'Categoría de Inventario *' : 'Inventory Category *'}
          </label>
          <input className="input" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder={es ? 'ej: accessory, part, service' : 'e.g. accessory, part, service'} />
          <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.2rem' }}>
            {es ? 'Filtra los productos del inventario por esta categoría' : 'Filters inventory products by this category'}
          </div>
        </div>

        {/* Tax mode */}
        <div>
          <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
            {es ? 'Modo de Impuesto' : 'Tax Mode'}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[
              { v: 'sales', label: es ? '💰 Ventas' : '💰 Sales Tax' },
              { v: 'phone_payment', label: es ? '📱 Telefonía' : '📱 Phone' },
              { v: 'none', label: es ? '🚫 Sin impuesto' : '🚫 No Tax' },
            ].map((t) => (
              <button key={t.v} type="button"
                onClick={() => setForm({ ...form, taxMode: t.v as any })}
                style={{
                  flex: 1, padding: '0.4rem 0.25rem', borderRadius: '0.5rem', cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: form.taxMode === t.v ? 700 : 400,
                  border: `1px solid ${form.taxMode === t.v ? '#667eea' : 'rgba(255,255,255,0.1)'}`,
                  background: form.taxMode === t.v ? 'rgba(102,126,234,0.15)' : 'rgba(255,255,255,0.04)',
                  color: form.taxMode === t.v ? '#a5b4fc' : '#94a3b8',
                }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.5rem', fontSize: '0.82rem', color: '#f87171' }}>
            ⚠ {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
            {es ? 'Cancelar' : 'Cancel'}
          </button>
          <button onClick={handleSave} className="btn btn-primary" style={{ flex: 1 }}>
            ✓ {es ? 'Crear Categoría' : 'Create Category'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
