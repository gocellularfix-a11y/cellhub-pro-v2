// Companion — Daily report snapshot builder.
// R-COMPANION-CLOUD-REPORTS-V2
// Produces a DailyReportSnapshot from the raw sales array for a given calendar date.
// Pure function — no side effects, no API calls, no persistence.

import type { Sale } from '@/store/types';
import type { DailyReportSnapshot, DailyReportCategory, DailyReportTopItem } from '@/types/companion';

const TOP_ITEMS_LIMIT = 10;

function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v as string | number);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toLocalDateStr(d: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const y  = parts.find(p => p.type === 'year')?.value  ?? '';
    const m  = parts.find(p => p.type === 'month')?.value ?? '';
    const dy = parts.find(p => p.type === 'day')?.value   ?? '';
    return `${y}-${m}-${dy}`;
  } catch {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
  }
}

type NormalizedPm = 'cash' | 'card' | 'store_credit' | 'split' | 'other';

function normalizePaymentMethod(pm: string): NormalizedPm {
  const lower = pm.toLowerCase();
  if (lower === 'cash') return 'cash';
  if (lower === 'card') return 'card';
  if (lower === 'store_credit' || lower === 'storecredit') return 'store_credit';
  if (lower === 'split') return 'split';
  return 'other';
}

function isCountable(s: Sale): boolean {
  return s.status !== 'voided' && s.status !== 'refunded';
}

/**
 * Builds a DailyReportSnapshot for the given date from raw sales data.
 *
 * @param sales - Full sales array from the store (all dates).
 * @param date  - YYYY-MM-DD in the store's local timezone.
 * @param storeId - Stored in the snapshot for server-side identity.
 * @param timezone - IANA timezone string, e.g. 'America/Los_Angeles'.
 */
export function buildDailyReportSnapshot(
  sales: Sale[],
  date: string,
  storeId: string,
  timezone: string,
): DailyReportSnapshot {
  const daySales = sales.filter(s => {
    if (!isCountable(s)) return false;
    const d = toDateSafe(s.createdAt);
    if (!d) return false;
    return toLocalDateStr(d, timezone) === date;
  });

  let grossRevenueCents = 0;
  let salesTaxCents = 0;
  let utilityTaxCents = 0;
  let mobileSurchargeCents = 0;
  let cashCents = 0;
  let cardCents = 0;
  let storeCreditCents = 0;
  let otherCents = 0;
  let refundCount = 0;

  const categoryMap = new Map<string, { revenueCents: number; qty: number }>();
  const itemMap     = new Map<string, { revenueCents: number; qty: number }>();
  const nameMap     = new Map<string, string>(); // normalized key → display name

  for (const s of daySales) {
    grossRevenueCents   += s.total;
    salesTaxCents       += s.salesTax       ?? 0;
    utilityTaxCents     += s.utilityTax     ?? 0;
    mobileSurchargeCents += s.mobileSurcharge ?? 0;
    if (s.total < 0) refundCount++;

    const pm = normalizePaymentMethod(s.paymentMethod ?? '');
    if (pm === 'split' && s.splitPayment) {
      const sp = s.splitPayment;
      cashCents         += sp.cash        ?? 0;
      cardCents         += sp.card        ?? 0;
      storeCreditCents  += sp.storeCredit ?? 0;
      const splitSum = (sp.cash ?? 0) + (sp.card ?? 0) + (sp.storeCredit ?? 0);
      // Any difference (CBE fees, surcharges) → other
      const diff = s.total - splitSum;
      if (diff !== 0) otherCents += diff;
    } else if (pm === 'cash') {
      cashCents += s.total;
    } else if (pm === 'card') {
      cardCents += s.total;
    } else if (pm === 'store_credit') {
      storeCreditCents += s.total;
    } else {
      otherCents += s.total;
    }

    for (const item of s.items ?? []) {
      const lineCents = (item.price ?? 0) * (item.qty ?? 1);
      const cat = String(item.category ?? 'Other');
      const catBucket = categoryMap.get(cat) ?? { revenueCents: 0, qty: 0 };
      catBucket.revenueCents += lineCents;
      catBucket.qty          += item.qty ?? 1;
      categoryMap.set(cat, catBucket);

      const rawName = String(item.name ?? '').trim();
      const nameKey = rawName.toLowerCase();
      if (nameKey) {
        const itemBucket = itemMap.get(nameKey) ?? { revenueCents: 0, qty: 0 };
        itemBucket.revenueCents += lineCents;
        itemBucket.qty          += item.qty ?? 1;
        itemMap.set(nameKey, itemBucket);
        if (!nameMap.has(nameKey)) nameMap.set(nameKey, rawName);
      }
    }
  }

  const categoryBreakdown: DailyReportCategory[] = Array.from(categoryMap.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const topItems: DailyReportTopItem[] = Array.from(itemMap.entries())
    .map(([key, v]) => ({ name: nameMap.get(key) ?? key, ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, TOP_ITEMS_LIMIT);

  return {
    storeId,
    date,
    grossRevenueCents,
    salesTaxCents,
    utilityTaxCents,
    mobileSurchargeCents,
    cashCents,
    cardCents,
    storeCreditCents,
    otherCents,
    salesCount: daySales.length,
    refundCount,
    categoryBreakdown,
    topItems,
    builtAt: new Date().toISOString(),
  };
}
