// R-INTELLIGENCE-MANAGER-QUEUE-V1 + R-INTELLIGENCE-QUEUE-DEDUP-NAVIGATION-V1
// + R-INTELLIGENCE-FEEDBACK-LOOP-V1
// Pure derived selectors over ManagerQueueItem[]. No I/O.

import type { ManagerQueueItem, QueueItemSeverity } from './types';

export const SEVERITY_RANK: Record<QueueItemSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

// Sort: severity → feedback score → occurrenceCount → updatedAt DESC.
// Snoozed items (snoozedUntil > now) are excluded from pending view.
// scoreMap is optional — when absent, falls back to V1 sort behavior.
export function getPendingItems(
  queue: ManagerQueueItem[],
  scoreMap?: Map<string, number>,
): ManagerQueueItem[] {
  const now = Date.now();
  return queue
    .filter(i => i.status === 'pending' && (!i.snoozedUntil || i.snoozedUntil <= now))
    .sort((a, b) => {
      const scoreA = scoreMap?.get(a.fingerprint ?? '') ?? 0;
      const scoreB = scoreMap?.get(b.fingerprint ?? '') ?? 0;
      return (
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
        || scoreB - scoreA
        || (b.occurrenceCount ?? 1) - (a.occurrenceCount ?? 1)
        || b.updatedAt - a.updatedAt
      );
    });
}

export interface QueueSummary {
  totalPending: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export function getQueueSummary(queue: ManagerQueueItem[], scoreMap?: Map<string, number>): QueueSummary {
  const pending = getPendingItems(queue, scoreMap);
  return {
    totalPending: pending.length,
    critical: pending.filter(i => i.severity === 'critical').length,
    high:     pending.filter(i => i.severity === 'high').length,
    medium:   pending.filter(i => i.severity === 'medium').length,
    low:      pending.filter(i => i.severity === 'low').length,
  };
}
