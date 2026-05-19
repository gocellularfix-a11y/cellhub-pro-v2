// INTELLIGENCE-OPERATOR-MISSION-ENGINE-V1
// Mission builders — deterministic, no AI, no side effects.
//
// Collection / repair / inventory / approval builders delegate to
// engine.getProactiveReport() (already memoized) to avoid duplicating the
// deep scoring logic in proactiveEngine.ts.
//
// workflow_resume and slow_day_recovery are net-new; built directly here.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { ProactiveAction } from '../proactive/types';
import type { OperatorMission } from './types';
import {
  scoreMissionUrgency,
  scoreMissionMoneyImpact,
  scoreMissionAge,
  scoreMissionConfidence,
  combineMissionScore,
} from './missionScoring';
import { getActiveWorkflowSessions } from '../workflows/workflowSession';
import { getWorkflowDefinition } from '../workflows/workflowRegistry';
import type { ExecutionPayload, OperationalExecutionAction } from '../execution/types';

// ── Internal helpers ──────────────────────────────────────────────────────────

function proactivePriorityToUrgency(p: ProactiveAction['priority']): number {
  return scoreMissionUrgency(p);
}

function entityTypeToOpenAction(entityType: string | undefined): OperationalExecutionAction | null {
  switch (entityType) {
    case 'repair':    return 'open_repair';
    case 'customer':  return 'open_customer';
    case 'layaway':   return 'open_layaway';
    case 'inventory': return 'open_inventory';
    default:          return null;
  }
}

function missionFromProactive(
  action: ProactiveAction,
  type: OperatorMission['type'],
  actionLabel: string,
  engine: IntelligenceEngine,
): OperatorMission {
  const now = Date.now();
  const ageMs = now - action.createdAt;

  const urgency = proactivePriorityToUrgency(action.priority);
  const money = scoreMissionMoneyImpact(action.estimatedImpactCents ?? 0);
  const age = scoreMissionAge(ageMs);
  const conf = scoreMissionConfidence(action.confidence);
  const priority = combineMissionScore(urgency, money, age, conf);

  // Resolve customer phone from entity when available
  let entityPhone: string | undefined;
  let entityName: string | undefined;
  if (action.entityType === 'repair' && action.entityId) {
    const r = engine.getRepairs().find(x => x.id === action.entityId);
    if (r) { entityPhone = r.customerPhone || undefined; entityName = r.customerName || undefined; }
  } else if (action.entityType === 'customer' && action.entityId) {
    const c = engine.getCustomers().find(x => x.id === action.entityId);
    if (c) { entityPhone = c.phone || undefined; entityName = c.name || undefined; }
  } else if (action.entityType === 'layaway' && action.entityId) {
    const l = engine.getLayaways().find(x => x.id === action.entityId);
    if (l) { entityPhone = l.customerPhone || undefined; entityName = l.customerName || undefined; }
  }

  const openAction = entityTypeToOpenAction(action.entityType);
  const executionPayload: ExecutionPayload | undefined = openAction && action.entityId
    ? { action: openAction, entityId: action.entityId, customerName: entityName, customerPhone: entityPhone }
    : undefined;

  return {
    id: `mission-${action.id}`,
    type,
    title: action.title,
    reason: action.reason,
    priority,
    estimatedImpactCents: action.estimatedImpactCents,
    entityKind: action.entityType,
    entityId: action.entityId,
    entityName,
    entityPhone,
    workflowId: action.workflowId,
    actionLabel,
    executionPayload,
  };
}

// ── Spec-required builders ────────────────────────────────────────────────────

export function buildPaymentCollectionMissions(engine: IntelligenceEngine): OperatorMission[] {
  const report = engine.getProactiveReport();
  return report.actions
    .filter(a => a.category === 'collection')
    .map(a => missionFromProactive(a, 'collect_payment', 'Open', engine));
}

export function buildRepairFollowupMissions(engine: IntelligenceEngine): OperatorMission[] {
  const report = engine.getProactiveReport();
  return report.actions
    .filter(a => a.category === 'repair_followup')
    .map(a => missionFromProactive(a, 'repair_followup', 'Open Repair', engine));
}

export function buildInventoryPromotionMissions(engine: IntelligenceEngine): OperatorMission[] {
  const report = engine.getProactiveReport();
  // 'inventory' category in proactive = low-stock reorder risk — not promotion.
  // For promotion (sell slow-moving stock), use grade D/F items from inventory scorer.
  const scores = engine.getInventoryScores();
  const promotable = scores.filter(s => s.grade === 'D' || s.grade === 'F');
  if (promotable.length === 0) return [];

  const now = Date.now();
  const inventoryMap = new Map(engine.getInventory().map(i => [i.id, i]));

  return promotable
    .slice(0, 3)
    .map(score => {
      const item = inventoryMap.get(score.itemId);
      if (!item || item.qty <= 0) return null;

      const ageMs = (() => {
        try {
          const ca = (item as any).createdAt;
          if (!ca) return 0;
          const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
            ? (ca as { toDate: () => Date }).toDate()
            : new Date(ca as string | Date);
          return now - d.getTime();
        } catch { return 0; }
      })();

      const value = item.qty * item.price;
      const urgency = scoreMissionUrgency(score.grade === 'F' ? 'high' : 'medium');
      const money = scoreMissionMoneyImpact(value);
      const age = scoreMissionAge(ageMs, 180 * 86_400_000);
      const priority = combineMissionScore(urgency, money, age, scoreMissionConfidence(0.7));

      const ep: ExecutionPayload = { action: 'open_inventory', entityId: item.id, productName: item.name };
      return {
        id: `mission-ip-${item.id}`,
        type: 'inventory_promotion' as const,
        title: `Promote — ${item.name}`,
        reason: score.recommendationEs ? score.recommendation : score.recommendation,
        priority,
        estimatedImpactCents: value,
        entityKind: 'inventory_product',
        entityId: item.id,
        entityName: item.name,
        actionLabel: 'Open Inventory',
        executionPayload: ep,
      } satisfies OperatorMission;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null) as OperatorMission[];
}

export function buildWorkflowResumeMissions(): OperatorMission[] {
  const sessions = getActiveWorkflowSessions();
  if (sessions.length === 0) return [];

  const now = Date.now();

  return sessions.slice(0, 2).map(s => {
    const def = getWorkflowDefinition(s.type);
    const ttl = s.expiresAt - s.createdAt;
    const elapsed = now - s.createdAt;

    const urgency = scoreMissionUrgency('medium');
    const age = scoreMissionAge(elapsed, ttl);
    const priority = combineMissionScore(urgency, 0, age, scoreMissionConfidence(0.85));

    const openAction = s.entityKind ? entityTypeToOpenAction(s.entityKind) : null;
    const ep: ExecutionPayload | undefined = openAction && s.entityId
      ? { action: openAction, entityId: s.entityId, customerName: s.entityName, customerPhone: s.entityPhone }
      : undefined;

    return {
      id: `mission-wf-${s.id}`,
      type: 'workflow_resume' as const,
      title: def.labelEn + (s.entityName ? ` — ${s.entityName}` : ''),
      reason: 'Active workflow session waiting for next action.',
      priority,
      entityKind: s.entityKind,
      entityId: s.entityId,
      entityName: s.entityName,
      entityPhone: s.entityPhone,
      workflowId: s.id,
      actionLabel: 'Continue',
      executionPayload: ep,
    } satisfies OperatorMission;
  });
}

// ── Additional builders (approval + slow day) ─────────────────────────────────

export function buildApprovalMissions(engine: IntelligenceEngine): OperatorMission[] {
  const report = engine.getProactiveReport();
  return report.actions
    .filter(a => a.category === 'approval')
    .map(a => missionFromProactive(a, 'approval_needed', 'Open Queue', engine));
}

export function buildSlowDayRecoveryMissions(engine: IntelligenceEngine): OperatorMission[] {
  const today = engine.getTodayMetrics();
  if (today.transactions > 0) return [];

  const now = Date.now();
  const hour = new Date(now).getHours();
  // Only surface if it's business hours (8am–8pm) with zero sales
  if (hour < 8 || hour >= 20) return [];

  // Urgency climbs as the day progresses with no sales
  const dayProgress = Math.max(0, (hour - 8) / 12); // 0 at 8am, 1 at 8pm
  const urgency = scoreMissionUrgency(dayProgress > 0.5 ? 'high' : 'medium');
  const priority = combineMissionScore(urgency, 0, Math.round(dayProgress * 100), scoreMissionConfidence(0.8));

  return [{
    id: 'mission-slow-day',
    type: 'slow_day_recovery',
    title: 'No sales yet today',
    reason: 'Zero transactions recorded. Focus on outreach or proactive selling.',
    priority,
    actionLabel: 'View Opportunities',
  }];
}
