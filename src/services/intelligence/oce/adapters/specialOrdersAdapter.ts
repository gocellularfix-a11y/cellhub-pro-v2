// R-OCE-COVERAGE-V1 — Special Orders module adapter.
// Signals: payment_due (balance owed), operational_warning (arrived, not picked up).

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

const TERMINAL_STATUSES = new Set(['picked_up', 'cancelled', 'refunded']);

const specialOrdersAdapter: OperationalModuleAdapter = {
  module: 'special_orders',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    try {
      const orders = engine.getSpecialOrders();

      // payment_due: orders with balance > 0 and non-terminal status
      const balanceDue = orders.filter(
        (o) => (o.balance ?? 0) > 0 && !TERMINAL_STATUSES.has(String(o.status ?? '').toLowerCase()),
      );
      if (balanceDue.length > 0) {
        const totalCents = balanceDue.reduce((s, o) => s + (o.balance ?? 0), 0);
        signals.push({
          id: 'special_orders:payment_due:aggregate',
          type: 'payment_due',
          sourceModule: 'special_orders',
          severity: balanceDue.length >= 3 ? 'high' : 'medium',
          title: `${balanceDue.length} special order${balanceDue.length > 1 ? 's' : ''} with balance due`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_special_order',
          score: Math.min(100, 30 + balanceDue.length * 8),
          tags: ['balance_due', 'special_orders'],
          metadata: { count: balanceDue.length, totalCents },
        });
      }
    } catch { /* skip */ }

    try {
      const orders = engine.getSpecialOrders();

      // operational_warning: orders with status 'ready' waiting for pickup
      const readyOrders = orders.filter(
        (o) => String(o.status ?? '').toLowerCase() === 'ready',
      );
      if (readyOrders.length > 0) {
        signals.push({
          id: 'special_orders:operational_warning:ready',
          type: 'operational_warning',
          sourceModule: 'special_orders',
          severity: readyOrders.length >= 3 ? 'high' : 'medium',
          title: `${readyOrders.length} special order${readyOrders.length > 1 ? 's' : ''} arrived — awaiting pickup`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_special_order',
          score: Math.min(100, 25 + readyOrders.length * 10),
          tags: ['ready', 'pickup_pending', 'special_orders'],
          metadata: { count: readyOrders.length },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { specialOrdersAdapter };
