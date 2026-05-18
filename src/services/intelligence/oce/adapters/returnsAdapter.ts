// R-RETURNS-OCE-V1 — Returns module OCE adapter.
// Signals: repeat_return_customer, sku_return_risk, unresolved_store_credit, high_value_return.
// All signals use margin_risk type → business_risk category in GPO.
// No detection logic duplicated — return analysis helpers (getReturnSummary, etc.) are unrelated.

import type { CustomerReturn } from '@/store/types';
import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

function toMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') { const n = new Date(ts).getTime(); return Number.isFinite(n) ? n : 0; }
  if (typeof ts === 'object' && ts !== null) {
    const obj = ts as Record<string, unknown>;
    if (typeof obj['toDate'] === 'function') { try { return (obj['toDate'] as () => Date)().getTime(); } catch { return 0; } }
    if (typeof obj['seconds'] === 'number') return (obj['seconds'] as number) * 1000;
  }
  return 0;
}

// Canonical cents: prefer totalCents; fall back to legacy total (dollars) × 100
function returnCents(r: CustomerReturn): number {
  if (r.totalCents > 0) return r.totalCents;
  const legacy = (r as unknown as { total?: number }).total ?? 0;
  return legacy > 0 ? Math.round(legacy * 100) : 0;
}

const MS_30D = 30 * 86_400_000;
const MS_60D = 60 * 86_400_000;

const returnsAdapter: OperationalModuleAdapter = {
  module: 'returns',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    let returns: ReturnType<typeof engine.getReturns>;
    try { returns = engine.getReturns(); } catch { return []; }
    if (!returns || returns.length === 0) return [];

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const recent30 = returns.filter((r) => {
      const ms = toMs(r.createdAt);
      return ms > 0 && (now - ms) <= MS_30D;
    });

    // 1. Repeat return customer — same phone 3+ returns in 30 days
    try {
      const byPhone = new Map<string, CustomerReturn[]>();
      for (const r of recent30) {
        if (!r.customerPhone) continue;
        const bucket = byPhone.get(r.customerPhone);
        if (bucket) bucket.push(r); else byPhone.set(r.customerPhone, [r]);
      }

      let customers: ReturnType<typeof engine.getCustomers> = [];
      try { customers = engine.getCustomers(); } catch { /* skip lookup */ }

      // Sort by count desc, cap at 3 signals to avoid spam
      const repeaters = Array.from(byPhone.entries())
        .filter(([, recs]) => recs.length >= 3)
        .sort(([, a], [, b]) => b.length - a.length)
        .slice(0, 3);

      for (const [phone, recs] of repeaters) {
        const cust = customers.find((c) => c.phone === phone);
        const customerId = cust?.id;
        const name = recs[0].customerName || phone;
        signals.push({
          id: `returns:margin_risk:repeat_customer:${phone.replace(/\D/g, '').slice(-10)}`,
          type: 'margin_risk',
          sourceModule: 'returns',
          severity: 'high',
          title: `${name} — ${recs.length} returns this month — review account`,
          createdAt: now,
          actionable: Boolean(customerId),
          actionTarget: customerId ? 'open_customer' : undefined,
          entityId: customerId,
          customerId,
          score: Math.min(100, 50 + recs.length * 8),
          tags: ['repeat_return_customer'],
          metadata: { count: recs.length, customerName: name },
        });
      }
    } catch { /* skip */ }

    // 2. SKU return risk — same item name 3+ times in 30 days
    try {
      const byItem = new Map<string, number>();
      for (const r of recent30) {
        for (const item of r.items ?? []) {
          if (!item.name) continue;
          const key = item.name.toLowerCase().trim();
          byItem.set(key, (byItem.get(key) ?? 0) + Math.max(item.qty, 1));
        }
      }

      let inventory: ReturnType<typeof engine.getInventory> = [];
      try { inventory = engine.getInventory(); } catch { /* skip lookup */ }

      // Top 3 problematic SKUs by return count
      const riskySkus = Array.from(byItem.entries())
        .filter(([, count]) => count >= 3)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);

      for (const [itemKey, count] of riskySkus) {
        const found = inventory.find((i) => i.name?.toLowerCase().trim() === itemKey);
        const inventoryId = found?.id;
        signals.push({
          id: `returns:margin_risk:sku_risk:${itemKey.replace(/\W+/g, '-').slice(0, 40)}`,
          type: 'margin_risk',
          sourceModule: 'returns',
          severity: 'high',
          title: `"${found?.name ?? itemKey}" returned ${count}x this month — review item quality`,
          createdAt: now,
          actionable: Boolean(inventoryId),
          actionTarget: inventoryId ? 'open_inventory' : undefined,
          entityId: inventoryId,
          score: Math.min(100, 45 + count * 8),
          tags: ['sku_return_risk'],
          metadata: { count, itemName: itemKey, inventoryId },
        });
      }
    } catch { /* skip */ }

    // 3. Unresolved store credit accumulation — last 60 days, 3+ credits
    try {
      const storeCredits = returns.filter((r) => {
        if (String(r.resolution ?? '').toLowerCase() !== 'store_credit') return false;
        const ms = toMs(r.createdAt);
        return ms > 0 && (now - ms) <= MS_60D;
      });
      if (storeCredits.length >= 3) {
        const totalCents = storeCredits.reduce((s, r) => s + returnCents(r), 0);
        signals.push({
          id: 'returns:margin_risk:store_credit',
          type: 'margin_risk',
          sourceModule: 'returns',
          severity: storeCredits.length >= 5 || totalCents >= 20_000 ? 'high' : 'medium',
          title: `${storeCredits.length} store credits issued ($${(totalCents / 100).toFixed(0)} total) — may be outstanding`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 30 + storeCredits.length * 6),
          tags: ['unresolved_store_credit'],
          metadata: { count: storeCredits.length, totalCents },
        });
      }
    } catch { /* skip */ }

    // 4. High-value return today — ≥ $100 return today
    try {
      const bigToday = returns.filter((r) => {
        const ms = toMs(r.createdAt);
        return ms >= todayMs && returnCents(r) >= 10_000;
      });
      if (bigToday.length > 0) {
        const largest = bigToday.reduce((best, r) =>
          returnCents(r) > returnCents(best) ? r : best);
        const totalCents = bigToday.reduce((s, r) => s + returnCents(r), 0);

        let customerId: string | undefined;
        try {
          if (largest.customerPhone) {
            const customers = engine.getCustomers();
            const cust = customers.find((c) => c.phone === largest.customerPhone);
            customerId = cust?.id;
          }
        } catch { /* skip */ }

        signals.push({
          id: 'returns:margin_risk:high_value_today',
          type: 'margin_risk',
          sourceModule: 'returns',
          severity: 'medium',
          title: bigToday.length > 1
            ? `${bigToday.length} high-value returns today — $${(totalCents / 100).toFixed(0)} total`
            : `$${(returnCents(largest) / 100).toFixed(0)} return today — ${largest.customerName}`,
          createdAt: now,
          actionable: Boolean(customerId),
          actionTarget: customerId ? 'open_customer' : undefined,
          entityId: customerId,
          customerId,
          score: Math.min(100, 35 + bigToday.length * 5),
          tags: ['high_value_return'],
          metadata: { count: bigToday.length, totalCents, customerName: largest.customerName },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { returnsAdapter };
