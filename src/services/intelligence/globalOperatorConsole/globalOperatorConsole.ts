// R-GLOBAL-OPERATOR-CONSOLE-V1
// Store-wide operator intelligence layer.
// Wraps the existing OCE + GPO pipeline — no duplicated business logic.
// Converts AggregatedPriority[] → GlobalOperatorPriority[] with executable actions.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { ExecutableOpportunityAction, OpportunityActionType } from '../moduleWideOpportunities/moduleWideOpportunityTypes';
import type { ActionPayload } from '../actions/actionEngine';
import { buildOperationalContext } from '../oce/buildOperationalContext';
import { buildGlobalPriorities } from '../gpo/buildGlobalPriorities';

// ── Public type ───────────────────────────────────────────────────────────────

export interface GlobalOperatorPriority {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  headline: string;
  reason: string;
  actions: ExecutableOpportunityAction[];
  score: number;
}

// ── Action conversion ─────────────────────────────────────────────────────────

// Only these executionTargets map cleanly to OpportunityActionType
const OPEN_TARGETS = new Set([
  'open_repair', 'open_customer', 'open_layaway',
  'open_unlock', 'open_special_order', 'open_inventory',
]);

const LABEL_KEY: Partial<Record<string, string>> = {
  open_repair:        'oppo.action.openRepair',
  open_customer:      'oppo.action.openCustomer',
  open_layaway:       'oppo.action.openLayaway',
  open_unlock:        'oppo.action.openUnlock',
  open_special_order: 'oppo.action.openSpecialOrder',
  open_inventory:     'oppo.action.openInventory',
};

function toExecutableActions(topActions: ActionPayload[]): ExecutableOpportunityAction[] {
  return topActions
    .filter((a) => a.executable && OPEN_TARGETS.has(a.executionTarget))
    .map((a) => ({
      actionType: a.executionTarget as OpportunityActionType,
      labelKey: LABEL_KEY[a.executionTarget] ?? 'oppo.action.openRepair',
      entityId: a.entityId,
      customerId: a.customerId,
    }));
}

// ── Public entry point ────────────────────────────────────────────────────────

export function computeGlobalOperatorPriorities(engine: IntelligenceEngine): GlobalOperatorPriority[] {
  const snapshot   = buildOperationalContext(engine);
  const priorities = buildGlobalPriorities(snapshot);
  return priorities.slice(0, 5).map((p) => ({
    id:       p.id,
    severity: p.severity,
    headline: p.title,
    reason:   p.summary,
    actions:  toExecutableActions(p.topActions ?? []),
    score:    p.score,
  }));
}
