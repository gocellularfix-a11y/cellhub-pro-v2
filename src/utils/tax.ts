import type { StoreSettings, CartItem, SaleItem } from '@/store/types';

/**
 * Check if a category is taxable with standard sales tax.
 * Phone payments have their own tax (utility users tax + surcharge).
 */
export function isTaxableCategory(category: string): boolean {
  const nonTaxable = ['service', 'quick_charge', 'phone_payment', 'top_up'];
  return !nonTaxable.includes(category);
}

/**
 * Check if an item is a phone payment (has special tax rules).
 */
export function isPhonePayment(category: string): boolean {
  return category === 'phone_payment';
}

/**
 * Calculate sales tax for a standard taxable item.
 */
export function calcSalesTax(priceCents: number, taxRate: number): number {
  return Math.round(priceCents * taxRate);
}

/**
 * Calculate phone payment taxes (utility users tax + mobile surcharge).
 */
export function calcPhonePaymentTax(
  priceCents: number,
  utilityUsersTax: number,
  mobileSurcharge: number,
): number {
  const utilityTax = Math.round(priceCents * utilityUsersTax);
  const surcharge = Math.round(mobileSurcharge * 100); // mobileSurcharge is already in dollars
  return utilityTax + surcharge;
}

/**
 * Calculate CBE (Covered Battery-Embedded) fee for a single item.
 * Rate: cbeFeeRate (1.5%) of selling price, capped at cbeFeeMax ($15).
 */
export function calcCbeFee(
  priceCents: number,
  settings: Pick<StoreSettings, 'cbeFeeEnabled' | 'cbeFeeRate' | 'cbeFeeMax'>,
  itemCbeEligible: boolean,
  overrideCbe?: boolean,
): number {
  const eligible = overrideCbe ?? itemCbeEligible;
  if (!settings.cbeFeeEnabled || !eligible) return 0;

  const fee = Math.round(priceCents * settings.cbeFeeRate);
  const maxCents = Math.round(settings.cbeFeeMax * 100);
  return Math.min(fee, maxCents);
}

/**
 * Calculate screen recycling fee.
 */
export function calcScreenFee(
  settings: Pick<StoreSettings, 'screenFeeAmount'>,
  eligible: boolean,
): number {
  if (!eligible) return 0;
  return Math.round(settings.screenFeeAmount * 100);
}

/**
 * Calculate totals for a cart or sale items array.
 */
export function calculateTotals(
  items: (CartItem | SaleItem)[],
  settings: StoreSettings,
): {
  subtotal: number;
  taxAmount: number;
  cbeTotal: number;
  screenFeeTotal: number;
  total: number;
} {
  let subtotal = 0;
  let taxAmount = 0;
  let cbeTotal = 0;
  let screenFeeTotal = 0;

  for (const item of items) {
    const lineTotal = item.price * item.qty;
    subtotal += lineTotal;

    // Tax
    if (isPhonePayment(item.category)) {
      taxAmount += calcPhonePaymentTax(
        lineTotal,
        settings.utilityUsersTax,
        settings.mobileSurcharge,
      ) * item.qty;
    } else if (item.taxable !== false && isTaxableCategory(item.category)) {
      taxAmount += calcSalesTax(lineTotal, settings.taxRate);
    }

    // CBE fee
    cbeTotal += calcCbeFee(
      item.price,
      settings,
      item.cbeEligible,
      'cbeOverride' in item ? (item as CartItem).cbeOverride : undefined,
    ) * item.qty;

    // Screen fee
    screenFeeTotal += calcScreenFee(
      settings,
      item.screenFeeEligible ?? false,
    ) * item.qty;
  }

  const total = subtotal + taxAmount + cbeTotal + screenFeeTotal;

  return { subtotal, taxAmount, cbeTotal, screenFeeTotal, total };
}
