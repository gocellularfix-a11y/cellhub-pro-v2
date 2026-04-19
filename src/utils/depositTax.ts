// ============================================================
// CellHub Pro — Deposit Tax Helper
// Single source of truth for deposit math across:
//   LayawayModule, RepairModule, SpecialOrdersModule, UnlockModule
//
// Conventions:
//   - All money in CENTS (integer). Conversion to dollars happens
//     in the display layer only via formatCurrency().
//   - taxRate is a decimal (e.g. 0.0925 for 9.25%).
//   - When `taxable === false`, tax rate is forced to 0 internally.
//   - All outputs are rounded to integer cents.
// ============================================================

export interface DepositTotals {
  subtotalCents: number;     // item price in cents (taxable base)
  taxCents: number;          // tax on the full price
  totalWithTaxCents: number; // subtotal + tax
  balanceCents: number;      // totalWithTax - depositCollected (>= 0)
}

export interface ReverseTaxResult {
  baseCents: number;  // pre-tax portion of payment
  taxCents: number;   // tax portion of payment
}

export interface ForwardTaxResult {
  baseCents: number;        // input pre-tax amount
  taxCents: number;         // tax computed on top
  totalCents: number;       // base + tax (what cashier collects)
}

/**
 * Compute the totals for a deposit/layaway/order item.
 *
 * Display formula (what the customer sees):
 *
 *   Phone Price:    $price
 *   Tax (X%):       +$tax
 *   Total w/ Tax:   $totalWithTax
 *   Deposit Paid:   - $deposit
 *   Balance Due:    $balance
 *
 * @param priceCents   Item full price in cents (e.g. 100000 for $1,000)
 * @param depositCents Amount already collected by customer in cents (tax-inclusive)
 * @param taxRate      Decimal rate (e.g. 0.0925)
 * @param taxable      If false, tax is 0
 */
export function calcDepositTotals(
  priceCents: number,
  depositCents: number,
  taxRate: number,
  taxable: boolean,
): DepositTotals {
  const price = Math.max(0, Math.round(priceCents || 0));
  const deposit = Math.max(0, Math.round(depositCents || 0));
  const rate = taxable ? (taxRate || 0) : 0;

  const taxCents = Math.round(price * rate);
  const totalWithTaxCents = price + taxCents;
  const balanceCents = Math.max(0, totalWithTaxCents - deposit);

  return {
    subtotalCents: price,
    taxCents,
    totalWithTaxCents,
    balanceCents,
  };
}

/**
 * Reverse-calculate base and tax from a tax-inclusive payment.
 *
 * Used when the customer hands over a round-number payment (e.g. $500 cash)
 * that already includes tax. We split it into the taxable base + tax portion
 * so the POS sale record persists CDTFA-correct numbers.
 *
 *   payment / (1 + rate) = base
 *   payment - base       = tax
 *
 * Example: $500 paid, 9.25% tax
 *   base = 500 / 1.0925 = $457.65
 *   tax  = $500 - $457.65 = $42.35
 *
 * @param paymentCents Tax-inclusive payment in cents
 * @param taxRate      Decimal rate
 * @param taxable      If false, full payment is base, tax = 0
 */
export function reverseTaxFromPayment(
  paymentCents: number,
  taxRate: number,
  taxable: boolean,
): ReverseTaxResult {
  const payment = Math.max(0, Math.round(paymentCents || 0));
  const rate = taxable ? (taxRate || 0) : 0;

  if (rate <= 0 || payment === 0) {
    return { baseCents: payment, taxCents: 0 };
  }

  const baseCents = Math.round(payment / (1 + rate));
  const taxCents = payment - baseCents;
  return { baseCents, taxCents };
}

/**
 * Forward-calculate tax on top of a pre-tax base.
 *
 * Used when the user enters the pre-tax amount and the system adds tax
 * on top (the "pre-tax mode" in the deposit modal toggle).
 *
 *   base × rate    = tax
 *   base + tax     = total to collect
 *
 * Example: $457.65 base, 9.25%
 *   tax   = 457.65 × 0.0925 = $42.33
 *   total = $499.98 (cashier collects)
 *
 * @param baseCents Pre-tax amount in cents
 * @param taxRate   Decimal rate
 * @param taxable   If false, tax = 0, total = base
 */
export function forwardTaxFromBase(
  baseCents: number,
  taxRate: number,
  taxable: boolean,
): ForwardTaxResult {
  const base = Math.max(0, Math.round(baseCents || 0));
  const rate = taxable ? (taxRate || 0) : 0;
  const taxCents = Math.round(base * rate);
  return {
    baseCents: base,
    taxCents,
    totalCents: base + taxCents,
  };
}
