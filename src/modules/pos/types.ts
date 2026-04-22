// ============================================================
// CellHub Pro — POS Module Types
// ============================================================

import type { CartItem, StoreSettings } from '@/store/types';

function resolveDefaultCcFeeCents(settings: StoreSettings): number {
  const shadow = (settings as any).creditCardFeeCents as number | undefined;
  if (shadow !== undefined && shadow !== null) return Math.round(shadow);
  const legacy = settings.creditCardFee;
  if (typeof legacy === 'number' && legacy > 0) return Math.round(legacy * 100);
  return 500;
}

/** Totals calculated from the current cart. All fields are cents-as-int. */
export interface CartTotals {
  subtotal: number;           // cents
  discountAmount: number;     // cents
  manualDiscount: number;     // cents
  loyaltyDiscount: number;    // cents
  subtotalAfterDiscount: number; // cents
  salesTax: number;           // cents
  utilityTax: number;         // cents
  mobileSurcharge: number;    // cents
  creditCardFee: number;      // cents (was dollars in legacy — now consistent with the rest)
  cbeFee: number;             // cents
  screenFee: number;          // cents
  total: number;              // cents
}

/** Phone payment form state */
export interface PhonePaymentForm {
  carrier: string;
  phoneNumber: string;
  amount: string;
  plan: string;
  creditCard: boolean;
}

/** Multi-line phone payment entry */
export interface PhonePaymentLine {
  id: string;
  number: string;
  amount: string;
}

/** Discount state */
export interface DiscountState {
  amount: number;
  type: 'percent' | 'dollar';
  reason: string;
}

/** Quick action category button definition */
export interface QuickActionButton {
  id: string;
  icon: string;
  label: string;
  labelEs?: string;
  description: string;
  descriptionEs?: string;
  /** Inventory category filter or special mode */
  category: string;
  /** Tax mode for items added from this category */
  taxMode?: 'sales' | 'phone_payment' | 'none';
}

/** Custom POS category (user-created) */
export interface CustomCategory {
  id: string;
  label: string;
  labelEs?: string;
  icon: string;
  category: string;        // inventory category
  taxMode: 'sales' | 'phone_payment' | 'none';
  description?: string;
}

/** Calculate cart totals */
export function calculateCartTotals(
  cart: CartItem[],
  settings: StoreSettings,
  discount: DiscountState,
  paymentMethod: string,
  addCreditCardFee: boolean,
  selectedCustomerLoyaltyDiscount?: number,
  overrideCreditCardFeeCents?: number,
): CartTotals {
  let subtotal = 0;
  let taxableAmount = 0;
  let utilityTax = 0;
  let mobileSurcharge = 0;
  let cbeFeeTotal = 0;
  let screenFeeTotal = 0;

  for (const item of cart) {
    // Skip already-paid items (repair completions where deposit was collected earlier)
    if ((item as any).alreadyPaid) continue;

    const itemTotal = toIntCents(item.price * item.qty);

    if (item.category === 'phone_payment') {
      // Phone payment: base amount + utility tax + surcharge
      // settings.mobileSurcharge is in DOLLARS (e.g. 0.41), convert to cents.
      utilityTax += toIntCents(itemTotal * (settings.utilityUsersTax || 0.055));
      mobileSurcharge += toIntCents((settings.mobileSurcharge || 0.41) * 100 * item.qty);
    } else if (item.taxable) {
      taxableAmount += itemTotal;
    }

    // CBE fee: per-item toggle + global enable check
    // r-audit-r3 H3: compute raw product first, round once at the end to
    // avoid ±1 cent drift from double-rounding (round-per-unit × qty).
    if (settings.cbeFeeEnabled && (item.cbeEligible || item.cbeOverride)) {
      const cbeRate = settings.cbeFeeRate || 0.015;
      const cbeMaxCents = (settings.cbeFeeMax || 15.0) * 100;
      const cbePerUnitRaw = Math.min(item.price * cbeRate, cbeMaxCents);
      cbeFeeTotal += toIntCents(cbePerUnitRaw * item.qty);
    }

    // Screen fee: per-item toggle
    // r-audit-r3 H3: same single-round pattern.
    if (item.screenFeeEligible) {
      const screenFeeCentsPerUnit = (settings.screenFeeAmount || 0.5) * 100;
      screenFeeTotal += toIntCents(screenFeeCentsPerUnit * item.qty);
    }

    subtotal += itemTotal;
  }

  // Discount — only on discountable items (exclude phone payments and top-ups)
  let discountableAmount = 0;
  for (const item of cart) {
    if ((item as any).alreadyPaid) continue;
    if (item.category !== 'phone_payment' && item.category !== 'top_up') {
      discountableAmount += toIntCents(item.price * item.qty);
    }
  }

  // FIX: dollar-discount input is captured as DOLLARS in Cart.tsx (parseFloat of
  // user input like "5" = $5.00). Must convert to cents before comparing against
  // discountableAmount, which is in cents-as-int. Previously this treated the raw
  // dollar value as cents, making every dollar discount 100x smaller than intended
  // (user asks $5 off → system applies 5¢ off). Same bug pattern as the Unlocks
  // dollars/cents mismatch already fixed in a previous round.
  let manualDiscountAmount = discount.type === 'dollar'
    ? toIntCents(Math.min(discount.amount * 100, discountableAmount))
    : toIntCents((discountableAmount * discount.amount) / 100);

  const loyaltyDiscountAmount = selectedCustomerLoyaltyDiscount || 0;
  const discountAmount = toIntCents(Math.min(manualDiscountAmount + loyaltyDiscountAmount, discountableAmount));

  const subtotalAfterDiscount = toIntCents(subtotal - discountAmount);

  // Apply discount ratio only to taxable items
  const discountRatio = discountableAmount > 0 ? (discountableAmount - discountAmount) / discountableAmount : 1;
  const taxableAfterDiscount = toIntCents(taxableAmount * discountRatio);

  const salesTax = toIntCents(taxableAfterDiscount * (settings.taxRate ?? 0.0925));

  // Credit card fee — fixed dollar amount in cents.
  // New stores: creditCardFeeCents shadow key (e.g. 500 = $5.00).
  // Legacy stores: creditCardFee > 10 is percentage, otherwise cents.
  // Per-transaction override via overrideCreditCardFeeCents.
  const feeCents = overrideCreditCardFeeCents ?? resolveDefaultCcFeeCents(settings);
  const creditCardFee = (addCreditCardFee && (paymentMethod === 'Card' || paymentMethod === 'Split'))
    ? feeCents
    : 0;

  const total = toIntCents(
    subtotalAfterDiscount + salesTax + utilityTax + mobileSurcharge +
    creditCardFee + cbeFeeTotal + screenFeeTotal,
  );

  return {
    subtotal,
    discountAmount,
    manualDiscount: manualDiscountAmount,
    loyaltyDiscount: loyaltyDiscountAmount,
    subtotalAfterDiscount,
    salesTax,
    utilityTax,
    mobileSurcharge,
    creditCardFee,
    cbeFee: cbeFeeTotal,
    screenFee: screenFeeTotal,
    total,
  };
}

// Rounds to integer cents. CartItem.price and all storage values are cents-as-int
// per the project convention. The previous implementation (Math.round(n*100)/100)
// was a dollars-based rounding that left fractional cents in storage, corrupting
// Firestore sales records and CDTFA reports. DO NOT use for dollar values.
function toIntCents(n: number): number {
  return Math.round(n);
}
