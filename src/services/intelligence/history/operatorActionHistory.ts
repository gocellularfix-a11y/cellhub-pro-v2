// R-INTELLIGENCE-OPERATOR-ACTION-HISTORY-V1
// Backward-compatible wrapper over intelligenceExecutionHistory.
//
// All writes now go to the canonical store (cellhub.intelligence.executionHistory.v1).
// The old separate storage key is abandoned; existing entries from it are not migrated
// (safe — suppressions simply reset on upgrade, which is conservative not dangerous).
//
// Exported API is unchanged — all callers (opportunityUrgency, IntelligenceChat) work
// without modification.

import {
  recordIntelligenceExecution,
  getIntelligenceExecutionHistory,
  getRecentIntelligenceExecutions,
  hasRecentIntelligenceExecution,
  pruneIntelligenceExecutionHistory,
} from '../execution/intelligenceExecutionHistory';
import type { IntelligenceExecutionHistoryEntry } from '../execution/intelligenceExecutionHistory';

export type OperatorActionType =
  | 'whatsapp'
  | 'open_customer'
  | 'open_repair'
  | 'dismissed'
  | 'completed'
  | 'ignored';

export interface OperatorActionHistoryEntry {
  id: string;
  actionType: OperatorActionType;
  entityType?: 'customer' | 'repair' | 'product';
  entityId?: string;
  entityName?: string;
  sourceIntent?: string;
  timestamp: number;
}

// OAH types are a strict subset of IntelligenceExecutionType.
// Values are identical — only the field name differs (actionType vs type).
const OAH_TYPES = new Set<string>([
  'whatsapp', 'open_customer', 'open_repair', 'dismissed', 'completed', 'ignored',
]);

function toOAH(e: IntelligenceExecutionHistoryEntry): OperatorActionHistoryEntry {
  return {
    id: e.id,
    actionType: e.type as OperatorActionType,
    entityType: e.entityType as OperatorActionHistoryEntry['entityType'],
    entityId: e.entityId,
    entityName: e.entityName,
    sourceIntent: e.sourceIntent,
    timestamp: e.timestamp,
  };
}

export function recordOperatorAction(
  entry: Omit<OperatorActionHistoryEntry, 'id'> & { id?: string },
): void {
  recordIntelligenceExecution({
    id: entry.id,
    type: entry.actionType,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityName: entry.entityName,
    sourceIntent: entry.sourceIntent,
    sourceModule: 'chat',
    timestamp: entry.timestamp,
  });
}

export function getOperatorActionHistory(): OperatorActionHistoryEntry[] {
  return getIntelligenceExecutionHistory()
    .filter((e) => OAH_TYPES.has(e.type))
    .map(toOAH);
}

export function getRecentOperatorActions(
  entityId: string,
  withinMs: number,
): OperatorActionHistoryEntry[] {
  return getRecentIntelligenceExecutions(entityId, withinMs)
    .filter((e) => OAH_TYPES.has(e.type))
    .map(toOAH);
}

export function hasRecentOperatorAction(
  entityId: string,
  actionType: OperatorActionType,
  withinMs: number,
): boolean {
  // actionType values are identical to IntelligenceExecutionType values.
  return hasRecentIntelligenceExecution(entityId, actionType, withinMs);
}

export function pruneOperatorActionHistory(): void {
  pruneIntelligenceExecutionHistory();
}
