// R-GLOBAL-OPERATOR-CONSOLE-V1 — Unlocks module OCE adapter.
// Signals: code_ready (pickup_pending), waiting_on_supplier, payment_due.

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

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

const unlocksAdapter: OperationalModuleAdapter = {
  module: 'unlocks',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];
    let unlocks: ReturnType<typeof engine.getUnlocks>;
    try { unlocks = engine.getUnlocks(); } catch { return []; }

    const active = unlocks.filter(
      (u) => !TERMINAL.has(String(u.status ?? '').toLowerCase().replace(/[\s-]+/g, '_')),
    );
    if (active.length === 0) return [];

    // 1. Unlock codes ready — deliver to customer (pickup_pending → pickup_opportunity)
    try {
      const ready = active.filter((u) => !!u.unlockCode);
      if (ready.length > 0) {
        signals.push({
          id: 'unlocks:operational_warning:code_ready',
          type: 'operational_warning',
          sourceModule: 'unlocks',
          severity: ready.length >= 2 ? 'high' : 'medium',
          title: `${ready.length} unlock${ready.length > 1 ? 's' : ''} code-ready — deliver to customer`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_unlock',
          entityId: ready[0].id,
          customerId: ready[0].customerId,
          score: Math.min(100, 40 + ready.length * 10),
          tags: ['pickup_pending', 'unlocks'],
          metadata: { count: ready.length },
        });
      }
    } catch { /* skip */ }

    // 2. Waiting on supplier 3+ days
    try {
      const waiting: typeof active = [];
      let maxDays = 0;
      let oldest = active[0];
      for (const u of active) {
        if (u.unlockCode) continue;
        const days = Math.floor((now - toMs(u.createdAt)) / 86_400_000);
        if (days >= 3) {
          waiting.push(u);
          if (days > maxDays) { maxDays = days; oldest = u; }
        }
      }
      if (waiting.length > 0) {
        signals.push({
          id: 'unlocks:operational_warning:waiting',
          type: 'operational_warning',
          sourceModule: 'unlocks',
          severity: maxDays >= 7 ? 'high' : 'medium',
          title: `${waiting.length} unlock${waiting.length > 1 ? 's' : ''} waiting ${maxDays} day(s) for supplier code`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_unlock',
          entityId: oldest.id,
          customerId: oldest.customerId,
          score: Math.min(100, 25 + waiting.length * 8),
          tags: ['supplier_delay', 'unlocks'],
          metadata: { count: waiting.length, maxDays },
        });
      }
    } catch { /* skip */ }

    // 3. Outstanding balances ≥ $5
    try {
      const balanceDue = active.filter((u) => (u.balance ?? 0) >= 500);
      if (balanceDue.length > 0) {
        const totalCents = balanceDue.reduce((s, u) => s + (u.balance ?? 0), 0);
        signals.push({
          id: 'unlocks:payment_due:aggregate',
          type: 'payment_due',
          sourceModule: 'unlocks',
          severity: balanceDue.length >= 3 ? 'high' : 'medium',
          title: `${balanceDue.length} unlock${balanceDue.length > 1 ? 's' : ''} with balance due`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_unlock',
          score: Math.min(100, 25 + balanceDue.length * 8),
          tags: ['balance_due', 'unlocks'],
          metadata: { count: balanceDue.length, totalCents },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { unlocksAdapter };
