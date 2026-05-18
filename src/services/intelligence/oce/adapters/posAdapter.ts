// R-OCE-V1 — POS module adapter.
// Signals: system_status (no sales today), slow_day.

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

const posAdapter: OperationalModuleAdapter = {
  module: 'pos',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    try {
      const m = engine.getTodayMetrics();
      if (m && m.transactions === 0) {
        signals.push({
          id: 'pos:system_status:no_sales_today',
          type: 'system_status',
          sourceModule: 'pos',
          severity: 'critical',
          title: 'No sales recorded today',
          createdAt: now,
          actionable: true,
          score: 80,
          tags: ['no_sales', 'today'],
        });
      }
    } catch { /* skip */ }

    try {
      const slowDay = engine.getSlowDayRootCause();
      if (slowDay) {
        signals.push({
          id: 'pos:slow_day:detected',
          type: 'slow_day',
          sourceModule: 'pos',
          severity: 'medium',
          title: 'Slow day trend detected',
          createdAt: now,
          actionable: false,
          score: 60,
          tags: ['slow_day', 'trend'],
          metadata: { confidence: (slowDay as { confidence?: number }).confidence ?? 0 },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { posAdapter };
