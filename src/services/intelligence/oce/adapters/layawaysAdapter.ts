// R-OCE-COVERAGE-V1 — Layaways module adapter.
// Signals: payment_due (active balance), operational_warning (past due date).

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

const layawaysAdapter: OperationalModuleAdapter = {
  module: 'layaways',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    try {
      const layaways = engine.getLayaways();
      const active = layaways.filter(
        (l) => String(l.status ?? '').toLowerCase() === 'active',
      );

      // payment_due: active layaways with remaining balance
      const withBalance = active.filter((l) => (l.balance ?? 0) > 0);
      if (withBalance.length > 0) {
        const totalCents = withBalance.reduce((s, l) => s + (l.balance ?? 0), 0);
        signals.push({
          id: 'layaways:payment_due:aggregate',
          type: 'payment_due',
          sourceModule: 'layaways',
          severity: withBalance.length >= 3 ? 'high' : 'medium',
          title: `${withBalance.length} layaway${withBalance.length > 1 ? 's' : ''} with balance due`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_layaway',
          score: Math.min(100, 30 + withBalance.length * 8),
          tags: ['balance_due', 'layaways'],
          metadata: { count: withBalance.length, totalCents },
        });
      }
    } catch { /* skip */ }

    try {
      const layaways = engine.getLayaways();

      // operational_warning: layaways past their dueDate with remaining balance
      const overdue = layaways.filter((l) => {
        if (!l.dueDate) return false;
        if ((l.balance ?? 0) <= 0) return false;
        const status = String(l.status ?? '').toLowerCase();
        if (status !== 'active') return false;
        try {
          return new Date(l.dueDate).getTime() < now;
        } catch { return false; }
      });

      if (overdue.length > 0) {
        signals.push({
          id: 'layaways:operational_warning:overdue',
          type: 'operational_warning',
          sourceModule: 'layaways',
          severity: overdue.length >= 2 ? 'high' : 'medium',
          title: `${overdue.length} layaway${overdue.length > 1 ? 's' : ''} past due date`,
          createdAt: now,
          actionable: true,
          score: Math.min(100, 35 + overdue.length * 10),
          tags: ['overdue', 'layaways'],
          metadata: { count: overdue.length },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { layawaysAdapter };
