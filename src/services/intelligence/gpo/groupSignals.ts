// R-GPO-V1 — Signal grouping engine.
// Groups OCE signals into OperationalPriorityCategory buckets.
// Deterministic — same signals always produce the same groups.
// No data loss: sourceSignals preserved in every group.

import type { OperationalSignal } from '../oce/operationalContextTypes';
import type { OperationalPriorityCategory } from './types';

function categorizeSignal(signal: OperationalSignal): OperationalPriorityCategory {
  switch (signal.type) {
    case 'repair_ready':
      return 'pickup_opportunity';

    case 'operational_warning': {
      // Pickup-tagged warnings: stale repairs waiting for pickup, special orders arrived
      const tags = signal.tags ?? [];
      if (tags.some((t) => t === 'pickup_overdue' || t === 'pickup_pending')) {
        return 'pickup_opportunity';
      }
      return 'system_attention';
    }

    case 'payment_due':
      return 'payment_collection';

    case 'vip_customer':
    case 'inactive_customer':
    case 'sale_opportunity':
    case 'outreach_opportunity':
      return 'customer_outreach';

    case 'inventory_risk':
    case 'dead_stock':
      return 'inventory_attention';

    case 'slow_day':
    case 'outreach_underperforming':
    case 'system_status':
      return 'business_risk';

    case 'approval_needed':
    default:
      return 'system_attention';
  }
}

export function groupSignalsByCategory(
  signals: OperationalSignal[],
): Map<OperationalPriorityCategory, OperationalSignal[]> {
  const groups = new Map<OperationalPriorityCategory, OperationalSignal[]>();

  for (const signal of signals) {
    const category = categorizeSignal(signal);
    const bucket = groups.get(category);
    if (bucket) {
      bucket.push(signal);
    } else {
      groups.set(category, [signal]);
    }
  }

  return groups;
}
