// R-INTELLIGENCE-MANAGER-QUEUE-V1 + R-INTELLIGENCE-QUEUE-DEDUP-NAVIGATION-V1
// Pure derived selectors over ManagerQueueItem[].
// No side effects, no I/O — pure functions over the array passed in.

import type { ManagerQueueItem, QueueItemSeverity } from './types';

export const SEVERITY_RANK: Record<QueueItemSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

// Sort: severity DESC → occurrenceCount DESC → updatedAt DESC.
// Critical repeated problems always surface first.
export function getPendingItems(queue: ManagerQueueItem[]): ManagerQueueItem[] {
  return queue
    .filter(i => i.status === 'pending')
    .sort((a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      || (b.occurrenceCount ?? 1) - (a.occurrenceCount ?? 1)
      || b.updatedAt - a.updatedAt,
    );
}

export interface QueueSummary {
  totalPending: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export function getQueueSummary(queue: ManagerQueueItem[]): QueueSummary {
  const pending = getPendingItems(queue);
  return {
    totalPending: pending.length,
    critical: pending.filter(i => i.severity === 'critical').length,
    high:     pending.filter(i => i.severity === 'high').length,
    medium:   pending.filter(i => i.severity === 'medium').length,
    low:      pending.filter(i => i.severity === 'low').length,
  };
}
