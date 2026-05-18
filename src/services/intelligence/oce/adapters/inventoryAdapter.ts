// R-OCE-V1 — Inventory module adapter.
// Signals: dead_stock, inventory_risk.

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

const inventoryAdapter: OperationalModuleAdapter = {
  module: 'inventory',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    try {
      const dead = engine.getDeadStockRootCause();
      if (dead.length > 0) {
        signals.push({
          id: 'inventory:dead_stock:aggregate',
          type: 'dead_stock',
          sourceModule: 'inventory',
          severity: dead.length > 5 ? 'high' : 'medium',
          title: `${dead.length} dead stock item${dead.length > 1 ? 's' : ''} detected`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 20 + dead.length * 4),
          tags: ['dead_stock', 'inventory'],
          metadata: { count: dead.length },
        });
      }
    } catch { /* skip */ }

    try {
      const gaps = engine.getRepairInventoryGaps();
      if (gaps.length > 0) {
        signals.push({
          id: 'inventory:inventory_risk:repair_gaps',
          type: 'inventory_risk',
          sourceModule: 'inventory',
          severity: gaps.length >= 3 ? 'high' : 'medium',
          title: `${gaps.length} repair inventory gap${gaps.length > 1 ? 's' : ''} detected`,
          createdAt: now,
          actionable: true,
          score: Math.min(100, 25 + gaps.length * 5),
          tags: ['repair_gaps', 'stock'],
          metadata: { gapCount: gaps.length },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { inventoryAdapter };
