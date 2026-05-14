// CellHub Intelligence — Customer Opportunity Signals
// Pure deterministic pattern/signal detection. No randomness, no AI, no external deps.

import type { Customer, Repair, Sale, Layaway, Unlock } from '@/store/types';

const PREMIUM_BRANDS = ['iphone', 'ipad', 'samsung galaxy', 'galaxy', 'pixel', 'macbook', 'oneplus', 'motorola'] as const;

// ── Timestamp normaliser (handles Firestore Timestamp | Date | string | number) ──
export function toMs(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return Date.parse(val) || 0;
  if (val instanceof Date) return val.getTime();
  if (val && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    try { return (val as { toDate: () => Date }).toDate().getTime(); } catch { return 0; }
  }
  return 0;
}

export function detectDeviceBrand(device: string): string | null {
  if (!device) return null;
  const lower = device.toLowerCase();
  for (const brand of PREMIUM_BRANDS) {
    if (lower.includes(brand)) return brand;
  }
  return null;
}

export function hasPremiumDevice(repairs: Repair[]): boolean {
  return repairs.some((r) => detectDeviceBrand(r.device) !== null);
}

/** Returns unique brands from repair device fields. */
export function detectRepairBrands(repairs: Repair[]): string[] {
  const seen = new Set<string>();
  for (const r of repairs) {
    const b = detectDeviceBrand(r.device);
    if (b) seen.add(b);
  }
  return Array.from(seen);
}

/** True when the customer has service records but zero completed retail sales. */
export function isServiceOnlyCustomer(
  sales: Sale[],
  repairs: Repair[],
  unlocks: Unlock[],
  layaways: Layaway[],
): boolean {
  const hasServices = repairs.length > 0 || unlocks.length > 0 || layaways.length > 0;
  const completedSales = sales.filter(
    (s) => s.status === 'completed' || (s.status as string | undefined) === undefined,
  );
  return hasServices && completedSales.length === 0;
}

/**
 * True when the customer had a repair within windowDays but NO completed sale
 * in the same window — a missed accessory upsell opportunity.
 */
export function hasRepairWithoutRecentSale(
  repairs: Repair[],
  sales: Sale[],
  windowDays = 90,
): boolean {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const recentRepairs = repairs.filter((r) => toMs(r.createdAt) >= cutoff);
  if (recentRepairs.length === 0) return false;
  const recentCompletedSales = sales.filter(
    (s) => toMs(s.createdAt) >= cutoff && (s.status === 'completed' || !s.status),
  );
  return recentCompletedSales.length === 0;
}

/** Detect human-readable patterns for the profile. Returns up to 5 strings. */
export function detectPatterns(
  customer: Customer,
  sales: Sale[],
  repairs: Repair[],
  unlocks: Unlock[],
  layaways: Layaway[],
  lastVisitAt: Date | null,
): string[] {
  const patterns: string[] = [];

  if (repairs.length >= 3) patterns.push('High-value repeat customer');

  const phones = customer.phones ?? (customer.phone ? [customer.phone] : []);
  if (phones.length >= 2) patterns.push('Frequent phone payment customer');

  if (isServiceOnlyCustomer(sales, repairs, unlocks, layaways)) {
    patterns.push('Service-only customer — no retail purchases');
  } else if (sales.filter((s) => s.status === 'completed' || !s.status).length >= 5) {
    patterns.push('Repeat purchaser');
  }

  const brands = detectRepairBrands(repairs);
  if (brands.length > 0) {
    const label = brands[0].charAt(0).toUpperCase() + brands[0].slice(1);
    patterns.push(`Usually brings ${label} devices`);
  }

  if (lastVisitAt) {
    const daysSince = (Date.now() - lastVisitAt.getTime()) / 86_400_000;
    if (daysSince >= 90) patterns.push('Long inactivity detected');
  }

  if (layaways.length >= 2) patterns.push('Frequent layaway customer');

  // Dominant carrier pattern
  const primaryCarrier = customer.carrier || (customer.carriers?.[0]);
  if (primaryCarrier) patterns.push(`Primary carrier: ${primaryCarrier}`);

  return patterns.slice(0, 5);
}
