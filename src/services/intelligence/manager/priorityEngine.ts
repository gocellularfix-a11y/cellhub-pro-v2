// ============================================================
// Business Manager — priority engine (I4 Part 6).
//
// Merges findings + actions into ONE stable ordered queue:
//   urgency (critical first) → business impact (magnitude) → confidence →
//   date (newer first) → id. Fully deterministic and stable.
// ============================================================

import type { InsightFinding } from '../insights/types';
import { SEVERITY_RANK } from '../insights/types';
import type { BusinessAction, PriorityItem } from './types';
import { ACTION_PRIORITY_RANK } from './actionEngine';

/** Unified urgency rank across finding severities and action priorities.
 *  Actions rank just below findings of equal urgency (the finding is the
 *  evidence; the action is the response). */
function urgencyRank(item: PriorityItem): number {
  if (item.itemType === 'finding') {
    return SEVERITY_RANK[item.severity as keyof typeof SEVERITY_RANK] * 2;
  }
  return ACTION_PRIORITY_RANK[item.severity as keyof typeof ACTION_PRIORITY_RANK] * 2 + 1;
}

export function buildPriorityQueue(findings: InsightFinding[], actions: BusinessAction[]): PriorityItem[] {
  const items: PriorityItem[] = [
    ...findings.map<PriorityItem>((f) => ({
      itemType: 'finding', refId: f.id, severity: f.severity,
      impact: f.magnitude, confidence: f.confidence, dateYMD: f.dateRange.endYMD,
    })),
    ...actions.map<PriorityItem>((a) => {
      const related = findings.find((f) => f.id === a.relatedFindingId);
      return {
        itemType: 'action', refId: a.id, severity: a.priority,
        impact: related?.magnitude ?? 0, confidence: related?.confidence ?? 1, dateYMD: a.createdYMD,
      };
    }),
  ];
  return items.sort((a, b) =>
    urgencyRank(a) - urgencyRank(b)
    || b.impact - a.impact
    || b.confidence - a.confidence
    || b.dateYMD.localeCompare(a.dateYMD)
    || a.refId.localeCompare(b.refId));
}
