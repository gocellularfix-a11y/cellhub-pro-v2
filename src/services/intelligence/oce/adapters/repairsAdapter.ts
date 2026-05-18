// R-OCE-V1 — Repairs module adapter.
// Signals: repair_ready (ready for pickup), operational_warning (stale >3 days).

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';
import { scanStaleRepairs } from '../../ranking/staleRepairScanner';

const repairsAdapter: OperationalModuleAdapter = {
  module: 'repairs',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    // repair_ready: all repairs in 'ready' status
    try {
      const readyRepairs = engine.getRepairs().filter(
        (r) => String((r as { status?: string }).status ?? '').toLowerCase() === 'ready',
      );
      if (readyRepairs.length > 0) {
        signals.push({
          id: 'repairs:repair_ready:aggregate',
          type: 'repair_ready',
          sourceModule: 'repairs',
          severity: readyRepairs.length >= 3 ? 'critical' : 'high',
          title: `${readyRepairs.length} repair${readyRepairs.length > 1 ? 's' : ''} ready for pickup`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_repair',
          score: Math.min(100, 40 + readyRepairs.length * 10),
          tags: ['pickup', 'ready'],
          metadata: { count: readyRepairs.length },
        });
      }
    } catch { /* skip */ }

    // operational_warning: repairs stale >3 days using existing scanner
    try {
      const stale = scanStaleRepairs(engine);
      if (stale.staleCount > 0) {
        signals.push({
          id: 'repairs:operational_warning:stale',
          type: 'operational_warning',
          sourceModule: 'repairs',
          severity: stale.staleCount >= 3 ? 'high' : 'medium',
          title: `${stale.staleCount} repair${stale.staleCount > 1 ? 's' : ''} waiting 3+ days for pickup`,
          createdAt: now,
          actionable: true,
          score: Math.min(100, 30 + stale.staleCount * 10),
          tags: ['stale', 'pickup_overdue'],
          metadata: { staleCount: stale.staleCount, recoverableCents: stale.recoverableCents },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { repairsAdapter };
