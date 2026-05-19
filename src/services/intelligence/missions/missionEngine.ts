// INTELLIGENCE-OPERATOR-MISSION-ENGINE-V1
// Aggregates, dedupes, scores, and returns top operator missions.
// Deterministic: no AI, no side effects, no persistence.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { OperatorMission } from './types';
import {
  buildPaymentCollectionMissions,
  buildRepairFollowupMissions,
  buildInventoryPromotionMissions,
  buildWorkflowResumeMissions,
  buildApprovalMissions,
  buildSlowDayRecoveryMissions,
} from './missionBuilder';

// ── Deduplication key ─────────────────────────────────────────────────────────
// Missions with the same entity + type are considered duplicates — keep highest score.

function dedupKey(m: OperatorMission): string {
  if (m.entityId && m.entityKind) return `${m.type}:${m.entityKind}:${m.entityId}`;
  return `${m.type}:${m.id}`;
}

function dedupeByKey(missions: OperatorMission[]): OperatorMission[] {
  const seen = new Map<string, OperatorMission>();
  for (const m of missions) {
    const key = dedupKey(m);
    const existing = seen.get(key);
    if (!existing || m.priority > existing.priority) {
      seen.set(key, m);
    }
  }
  return Array.from(seen.values());
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns top operator missions prioritized by score (highest first).
 * Pure read — no side effects, no auto-execution.
 */
export function getOperatorMissions(
  engine: IntelligenceEngine,
  limit = 5,
): OperatorMission[] {
  const all: OperatorMission[] = [
    ...buildPaymentCollectionMissions(engine),
    ...buildRepairFollowupMissions(engine),
    ...buildInventoryPromotionMissions(engine),
    ...buildWorkflowResumeMissions(),
    ...buildApprovalMissions(engine),
    ...buildSlowDayRecoveryMissions(engine),
  ];

  return dedupeByKey(all)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}
