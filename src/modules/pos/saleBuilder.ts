// ============================================================
// CellHub Pro — Sale Builder Helpers
//
// Extracted from PaymentModal.tsx (Round R-POS-PAY-DEDUPE F1).
// Single source of truth for Sale object construction and invoice
// number generation. Consumed by both checkout paths:
//   - bypass (POSModule.onCheckout — added in F4)
//   - PaymentModal slim (phone_payment portal flow — F3)
//
// Behavior MUST be identical to pre-extraction PaymentModal logic.
// No persistence, no side effects — pure builders.
// ============================================================

import { generateId } from '@/utils/dates';
import type { CartItem, Customer, Employee, Sale, StoreSettings } from '@/store/types';
import type { CartTotals } from './types';

/**
 * Input contract for buildSale. Both checkout paths (bypass + phone)
 * MUST use this exact shape — no optional fields that one path uses
 * and the other doesn't (invariant I7).
 */
export interface BuildSaleInput {
  cart: CartItem[];
  totals: CartTotals;
  paymentMethod: string;
  /** DOLLARS (matches Cart/POSModule state convention; converted to cents inside). */
  cashAmount: number;
  /** DOLLARS. */
  cardAmount: number;
  selectedCustomer: Customer | null;
  currentEmployee: Employee | null;
  settings: StoreSettings;
  /** Optional — multi-store stamping. Preserved as undefined if omitted (matches current PaymentModal, F0 Q3). */
  storeId?: string;
}

/**
 * Build a Sale object from checkout state. Pure function — no side effects,
 * no persistence, no state mutation. Consumers persist the returned Sale
 * via handleCompleteSale (POSModule single post-sale layer, invariant I1).
 *
 * CRITICAL: payment values (cashAmount, cardAmount, paymentMethod) MUST
 * come directly from checkout state (POSModule/Cart). Do NOT recompute,
 * derive from totals, or read from DOM — this prevents drift between UI
 * and persisted sale (invariant I3).
 */
export function buildSale(input: BuildSaleInput): Sale {
  const {
    cart, totals, paymentMethod,
    cashAmount, cardAmount,
    selectedCustomer, currentEmployee,
    settings: _settings,
    storeId,
  } = input;

  const cashNum = cashAmount || 0;
  const cardNum = cardAmount || 0;
  const cashCents = Math.round(cashNum * 100);
  const changeDue = paymentMethod === 'Cash'
    ? Math.max(0, cashCents - totals.total)
    : 0;

  const now = new Date().toISOString();
  const invoiceNum = generateInvoiceNumber(_settings);

  // Determine customer info
  let customerName = 'Walk-in';
  let customerId: string | undefined;
  let customerPhone: string | undefined;

  if (selectedCustomer) {
    customerName = selectedCustomer.name;
    customerId = selectedCustomer.id;
    customerPhone = selectedCustomer.phone;
  } else {
    // Walk-in phone_payment fallback: synthesize customer info from the
    // first phone_payment item that has a phoneNumber. Lives INSIDE
    // buildSale (not in a path) so both checkout paths get identical
    // fallback behavior — invariant I7 (reaffirmed in F0 Q5).
    const ppItem = cart.find((i) => i.category === 'phone_payment' && i.phoneNumber);
    if (ppItem) {
      customerName = `${ppItem.carrier || ''} ${ppItem.phoneNumber || ''}`.trim();
      customerPhone = ppItem.phoneNumber;
    }
  }

  const sale: Sale = {
    id: generateId(),
    invoiceNumber: invoiceNum,
    customerId,
    customerName,
    customerPhone,
    items: cart.map((item) => ({
      id: item.id,
      inventoryId: item.inventoryId,
      name: item.name,
      sku: item.sku,
      imei: item.imei,
      category: item.category,
      price: item.price,
      originalPrice: item.originalPrice,
      cost: item.cost,
      qty: item.qty,
      notes: item.notes,
      taxable: item.taxable,
      cbeEligible: item.cbeEligible,
      screenFeeEligible: item.screenFeeEligible,
      phoneNumber: item.phoneNumber,
      carrier: item.carrier,
      portal: item.portal,
      repairId: item.repairId,
      specialOrderId: item.specialOrderId,
      unlockId: item.unlockId,
      layawayId: item.layawayId,
    })),
    subtotal: totals.subtotal,
    subtotalAfterDiscount: totals.subtotalAfterDiscount,
    taxAmount: totals.salesTax + totals.utilityTax + totals.mobileSurcharge,
    salesTax: totals.salesTax,
    utilityTax: totals.utilityTax,
    mobileSurcharge: totals.mobileSurcharge,
    cbeTotal: totals.cbeFee,
    screenFeeTotal: totals.screenFee,
    creditCardFee: totals.creditCardFee > 0 ? totals.creditCardFee : undefined,
    total: totals.total,
    paymentMethod: paymentMethod as Sale['paymentMethod'],
    splitPayment:
      paymentMethod === 'Split'
        ? { cash: Math.round(cashNum * 100), card: Math.round(cardNum * 100), storeCredit: 0 }
        : undefined,
    cashReceived: paymentMethod === 'Cash' ? cashCents : undefined,
    changeDue: paymentMethod === 'Cash' ? changeDue : undefined,
    status: 'completed',
    employeeId: currentEmployee?.id,
    employeeName: currentEmployee?.name,
    notes: '',
    createdAt: now,
    ...(storeId ? { storeId } : {}),
  };

  return sale;
}

/**
 * Compute total paid cents based on payment method and user inputs.
 * Shared by both checkout paths (bypass + phone portal) — single source
 * of truth for payment sufficiency guard (invariant I2).
 *
 * cashDollars and cardDollars are DOLLARS (matches Cart/POSModule state
 * convention). Number() coercion is defensive against future accidental
 * string inputs — cero costo runtime, protege código de dinero.
 *
 * Card fallback: if cardCents === 0 (user never edited the prefilled
 * field or useEffect timing drift), treat as paying the full total —
 * matches Cart.tsx auto-prefill semantics and avoids blocking valid
 * checkouts with phantom "insufficient payment" toasts. The general
 * guard still catches users who explicitly typed a lower amount
 * (cardCents > 0 && cardCents < totalCents).
 */
export function computePaidCents(
  method: string,
  cashDollars: number,
  cardDollars: number,
  storeCreditCents: number,
  totalCents: number,
): number {
  const cashCents = Math.round(Number(cashDollars || 0) * 100);
  const cardCents = Math.round(Number(cardDollars || 0) * 100);
  if (method === 'Cash') return cashCents;
  if (method === 'Card') {
    return cardCents > 0 ? cardCents : totalCents;
  }
  if (method === 'Split') return cashCents + cardCents;
  if (method === 'Store Credit') {
    return Math.min(storeCreditCents, totalCents);
  }
  return 0;
}

/**
 * Generate invoice number — timestamp-based to avoid Math.random collisions
 * in multi-station setups. Format: PREFIX-YYMMDD-HHMM-RAND4
 *
 * Two sales in the same minute on different stations: ~1/10000 collision.
 * Two sales in the same minute on the same station: extremely rare.
 *
 * NOTE: ignores settings.invoiceCounterLength because Math.random was
 * the source of the original duplicate-invoice bug (it was never a real counter).
 */
export function generateInvoiceNumber(settings: StoreSettings): string {
  const prefix = settings.invoicePrefix || 'INV';
  const includeDate = settings.invoiceIncludeDate !== false;

  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

  const datePart = includeDate ? `${yy}${mo}${dd}` : '';
  return `${prefix}-${datePart}${datePart ? '-' : ''}${hh}${mm}-${rand}`;
}
