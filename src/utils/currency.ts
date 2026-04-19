/**
 * Format cents as a dollar string.
 * formatCurrency(1299) → "$12.99"
 */
export function formatCurrency(cents: number, locale = 'en-US', currency = 'USD'): string {
  // r-audit-r3: guard against undefined/NaN propagating as "$NaN" in the UI.
  // Root cause: inventory items imported without price/cost fields.
  const safe = (typeof cents === 'number' && !isNaN(cents)) ? cents : 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe / 100);
}

/**
 * Convert a dollar amount (number or string) to cents (integer).
 * toCents(12.99) → 1299
 * toCents("12.99") → 1299
 */
export function toCents(dollars: number | string): number {
  const num = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Convert cents to dollars.
 * toDollars(1299) → 12.99
 */
export function toDollars(cents: number): number {
  return cents / 100;
}

/**
 * Format a number as a percentage string.
 * formatPercent(0.0925) → "9.25%"
 */
export function formatPercent(rate: number, decimals = 2): string {
  return `${(rate * 100).toFixed(decimals)}%`;
}
