// R-GPO-V1 — Top action extractor.
// Prevents action spam by deduplicating and capping the global action set.
// Max 5 actions across all priorities, deduplicated by executionTarget + entityId.

import type { ActionPayload } from '../actions/actionEngine';
import type { AggregatedPriority, OperationalPriorityCategory } from './types';

const MAX_GLOBAL_ACTIONS = 5;

// Process categories in urgency order to ensure highest-value actions are picked first.
const CATEGORY_ORDER: OperationalPriorityCategory[] = [
  'pickup_opportunity',
  'payment_collection',
  'customer_outreach',
  'inventory_attention',
  'business_risk',
  'system_attention',
];

function actionKey(action: ActionPayload): string {
  return `${action.executionTarget}:${action.entityId ?? action.customerId ?? action.productId ?? ''}`;
}

export function extractTopActions(
  priorities: AggregatedPriority[],
): ActionPayload[] {
  const seen   = new Set<string>();
  const result: ActionPayload[] = [];

  const sorted = priorities.slice().sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );

  for (const priority of sorted) {
    for (const action of priority.topActions ?? []) {
      if (result.length >= MAX_GLOBAL_ACTIONS) break;
      const key = actionKey(action);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(action);
    }
    if (result.length >= MAX_GLOBAL_ACTIONS) break;
  }

  return result;
}
