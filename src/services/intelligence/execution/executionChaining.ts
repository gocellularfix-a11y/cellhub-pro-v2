// ============================================================
// CellHub Intelligence — Execution Chaining Engine
// R-INTELLIGENCE-EXECUTION-CHAINING-V1
//
// Deterministic guided next-step suggestions after operator
// actions complete. NO automation, NO AI inference, NO
// autonomous behavior. Suggestions only — operator decides.
//
// Rules: no ML, no predictions, no global event bus rewrite.
// Max 3 chained actions. Chains expire after 15 minutes.
// Suppressed during overload, below min confidence, or dismissed.
// ============================================================

import type { StoreStateResult } from '../storeState/storeStateEngine';
import type { OperationalHealthResult, HealthDimensionKey } from '../health/operationalHealth';
import type { OperatorTaskType } from '../operatorQueue/operatorQueue';
import type { RecommendationAction } from '../recommendations/operatorRecommendations';

// ── Types ─────────────────────────────────────────────────

export type ChainTriggerSource =
  | 'task_complete'
  | 'continuity_resume'
  | 'recommendation_action'
  | 'mission_complete';

export interface ChainTrigger {
  source: ChainTriggerSource;
  completedType?: OperatorTaskType;
  continuityType?: string;
  recommendationAction?: RecommendationAction;
  missionType?: string;
}

export interface ChainedAction {
  type: string;
  title: string;
  summary: string;
  suggestedFocus?: string;
  navigationTarget?: 'repairs' | 'customers' | 'layaways' | 'intelligence';
}

export interface ExecutionChain {
  chainId: string;
  sourceAction: string;
  nextActions: ChainedAction[];
  confidence: number;
  reason: string;
  expiresAt: number;
  generatedAt: number;
}

export interface ChainContext {
  storeState: StoreStateResult;
  operationalHealth: OperationalHealthResult;
  pendingQueueCount: number;
  continuityItemCount: number;
  outreachCandidateCount: number;
}

// ── Constants ──────────────────────────────────────────────

export const CHAIN_TTL_MS   = 15 * 60_000;   // chains expire after 15 minutes
const DISMISS_TTL_MS = 4 * 3600_000;          // dismissals remembered for 4 hours
const MIN_CONFIDENCE = 55;
const MAX_ACTIONS    = 3;

// ── Dismiss storage ────────────────────────────────────────

const DISMISSED_KEY = 'cellhub:intelligence:executionChain:dismissed:v1';

function readDismissed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch { return {}; }
}

function writeDismissed(data: Record<string, number>): void {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(data)); } catch {}
}

export function dismissChain(chainId: string): void {
  const now = Date.now();
  const data = readDismissed();
  for (const k of Object.keys(data)) {
    if (now - data[k] > DISMISS_TTL_MS) delete data[k];
  }
  data[chainId] = now;
  writeDismissed(data);
}

function isDismissed(id: string, now: number): boolean {
  const data = readDismissed();
  const t = data[id];
  return !!t && now - t < DISMISS_TTL_MS;
}

// ── Helpers ────────────────────────────────────────────────

function makeChainId(prefix: string): string {
  return `${prefix}:${new Date().toISOString().slice(0, 10)}`;
}

function dimScore(health: OperationalHealthResult, key: HealthDimensionKey): number {
  return health.dimensions.find((d) => d.dimension === key)?.score ?? 70;
}

interface SuppressOpts {
  allowDuringRush?: boolean;
  allowDuringOverload?: boolean;
}

function shouldSuppress(
  ctx: ChainContext,
  confidence: number,
  opts: SuppressOpts = {},
): boolean {
  if (!opts.allowDuringRush && ctx.storeState.state === 'rush_mode') return true;
  if (!opts.allowDuringOverload && ctx.storeState.state === 'repair_overload') return true;
  return confidence < MIN_CONFIDENCE;
}

// ── Flow builders ──────────────────────────────────────────

// REPAIR FLOW — triggers on repair task completion.
// Repair follow-up complete → pickup reminder → accessory upsell → backlog review.
function buildRepairChain(trigger: ChainTrigger, ctx: ChainContext, now: number): ExecutionChain | null {
  const REPAIR_TYPES: OperatorTaskType[] = ['repair_follow_up', 'repair_escalate', 'repair_waiting'];

  const fromTask    = trigger.source === 'task_complete'   && REPAIR_TYPES.includes(trigger.completedType ?? '' as OperatorTaskType);
  const fromMission = trigger.source === 'mission_complete' && (trigger.missionType ?? '').includes('repair');
  if (!fromTask && !fromMission) return null;

  // Allow during repair_overload — it's the relevant flow. Suppress during rush.
  if (shouldSuppress(ctx, 75, { allowDuringOverload: true })) return null;

  const id = makeChainId('repair_chain');
  if (isDismissed(id, now)) return null;

  const repairScore = dimScore(ctx.operationalHealth, 'repair_health');
  const actions: ChainedAction[] = [];

  actions.push({
    type: 'pickup_reminder',
    title: 'Contact pickup-ready customers',
    summary: 'Repairs marked ready may need a pickup notification',
    navigationTarget: 'repairs',
  });

  if (ctx.outreachCandidateCount > 0) {
    actions.push({
      type: 'accessory_upsell',
      title: 'Offer accessory with pickup',
      summary: 'Pickup visit is a natural upsell opportunity',
      navigationTarget: 'intelligence',
    });
  }

  if (repairScore < 70) {
    actions.push({
      type: 'backlog_review',
      title: 'Review delayed repair backlog',
      summary: 'Remaining overdue repairs may need escalation',
      navigationTarget: 'repairs',
    });
  }

  if (actions.length === 0) return null;

  return {
    chainId: id,
    sourceAction: 'Repair follow-up completed',
    nextActions: actions.slice(0, MAX_ACTIONS),
    confidence: 75,
    reason: 'Repair workflow continuation',
    expiresAt: now + CHAIN_TTL_MS,
    generatedAt: now,
  };
}

// VIP OUTREACH FLOW — triggers on vip_outreach task completion.
// VIP contacted → accessory promotion → payment recovery → additional VIP outreach.
function buildVipOutreachChain(trigger: ChainTrigger, ctx: ChainContext, now: number): ExecutionChain | null {
  const fromTask    = trigger.source === 'task_complete'   && trigger.completedType === 'vip_outreach';
  const fromMission = trigger.source === 'mission_complete' && trigger.missionType === 'vip_outreach';
  if (!fromTask && !fromMission) return null;
  if (shouldSuppress(ctx, 72)) return null;

  const id = makeChainId('vip_outreach_chain');
  if (isDismissed(id, now)) return null;

  const collectionScore = dimScore(ctx.operationalHealth, 'collection_health');
  const actions: ChainedAction[] = [];

  actions.push({
    type: 'accessory_promotion',
    title: 'Promote accessories to VIP customers',
    summary: 'High-value customers are prime candidates for accessory upgrades',
    navigationTarget: 'intelligence',
  });

  if (collectionScore < 75) {
    actions.push({
      type: 'payment_recovery',
      title: 'Check payment recovery',
      summary: 'Review outstanding balances while engagement is high',
      navigationTarget: 'customers',
    });
  }

  if (ctx.outreachCandidateCount >= 3) {
    actions.push({
      type: 'additional_vip',
      title: 'Contact additional VIP customers',
      summary: `${ctx.outreachCandidateCount} outreach candidates remaining`,
      navigationTarget: 'customers',
    });
  }

  if (actions.length === 0) return null;

  return {
    chainId: id,
    sourceAction: 'VIP customer contacted',
    nextActions: actions.slice(0, MAX_ACTIONS),
    confidence: 72,
    reason: 'VIP outreach continuation',
    expiresAt: now + CHAIN_TTL_MS,
    generatedAt: now,
  };
}

// COLLECTION FLOW — triggers on recover_customer task or open_customers recommendation action.
// Collection outreach done → review other overdue balances → contact high-value pending.
function buildCollectionChain(trigger: ChainTrigger, ctx: ChainContext, now: number): ExecutionChain | null {
  const fromTask    = trigger.source === 'task_complete'         && trigger.completedType === 'recover_customer';
  const fromRec     = trigger.source === 'recommendation_action' && trigger.recommendationAction === 'open_customers';
  const fromMission = trigger.source === 'mission_complete'      && trigger.missionType === 'recover_customer';
  if (!fromTask && !fromRec && !fromMission) return null;
  if (shouldSuppress(ctx, 68)) return null;

  const id = makeChainId('collection_chain');
  if (isDismissed(id, now)) return null;

  const collectionScore = dimScore(ctx.operationalHealth, 'collection_health');
  const actions: ChainedAction[] = [];

  if (collectionScore < 80) {
    actions.push({
      type: 'overdue_review',
      title: 'Review other overdue balances',
      summary: 'Check remaining outstanding accounts for recovery opportunities',
      navigationTarget: 'layaways',
    });
  }

  if (ctx.outreachCandidateCount >= 2) {
    actions.push({
      type: 'high_value_accounts',
      title: 'Contact high-value pending accounts',
      summary: `${ctx.outreachCandidateCount} customers still waiting for outreach`,
      navigationTarget: 'customers',
    });
  }

  if (ctx.pendingQueueCount >= 3) {
    actions.push({
      type: 'queue_review',
      title: 'Clear remaining queue tasks',
      summary: `${ctx.pendingQueueCount} pending tasks in queue`,
    });
  }

  if (actions.length === 0) return null;

  return {
    chainId: id,
    sourceAction: 'Collection outreach completed',
    nextActions: actions.slice(0, MAX_ACTIONS),
    confidence: 68,
    reason: 'Collection recovery continuation',
    expiresAt: now + CHAIN_TTL_MS,
    generatedAt: now,
  };
}

// RUSH MODE FLOW — triggers on interrupted_workflow continuity resume.
// Workflow resumed → resolve remaining continuity items → prioritize fast queue tasks.
function buildRushModeChain(trigger: ChainTrigger, ctx: ChainContext, now: number): ExecutionChain | null {
  if (trigger.source !== 'continuity_resume' || trigger.continuityType !== 'interrupted_workflow') return null;

  // Require at least something left to chain to
  if (ctx.continuityItemCount === 0 && ctx.pendingQueueCount < 2) return null;

  // Rush chain: allowed during rush_mode (that's its purpose). Suppress during repair_overload.
  if (shouldSuppress(ctx, 70, { allowDuringRush: true })) return null;

  const id = makeChainId('rush_mode_chain');
  if (isDismissed(id, now)) return null;

  const execScore = dimScore(ctx.operationalHealth, 'execution_health');
  const actions: ChainedAction[] = [];

  if (ctx.continuityItemCount > 0) {
    actions.push({
      type: 'resolve_continuity',
      title: 'Resolve remaining continuity items',
      summary: `${ctx.continuityItemCount} more interrupted workflow${ctx.continuityItemCount !== 1 ? 's' : ''} to resume`,
    });
  }

  if (ctx.pendingQueueCount >= 2) {
    actions.push({
      type: 'fast_queue',
      title: 'Prioritize fast queue tasks',
      summary: 'Clear quick wins from the task queue to reduce backlog pressure',
    });
  }

  if (execScore < 65) {
    actions.push({
      type: 'execution_review',
      title: 'Review execution bottlenecks',
      summary: 'Execution health below expected — check for stale approvals',
    });
  }

  if (actions.length === 0) return null;

  return {
    chainId: id,
    sourceAction: 'Interrupted workflow resumed',
    nextActions: actions.slice(0, MAX_ACTIONS),
    confidence: 70,
    reason: 'Rush mode workflow recovery',
    expiresAt: now + CHAIN_TTL_MS,
    generatedAt: now,
  };
}

// SLOW DAY FLOW — triggers on recover_customer completion during a slow day.
// Customer contacted → promote accessories → contact additional VIP customers.
function buildSlowDayChain(trigger: ChainTrigger, ctx: ChainContext, now: number): ExecutionChain | null {
  if (ctx.storeState.state !== 'slow_day') return null;

  const fromTask    = trigger.source === 'task_complete'   && trigger.completedType === 'recover_customer';
  const fromMission = trigger.source === 'mission_complete' && trigger.missionType === 'recover_customer';
  if (!fromTask && !fromMission) return null;

  // slow_day is neither rush nor overload — noiseCheck won't block it unless confidence too low
  if (shouldSuppress(ctx, 65)) return null;

  const id = makeChainId('slow_day_chain');
  if (isDismissed(id, now)) return null;

  const actions: ChainedAction[] = [];

  actions.push({
    type: 'promote_accessories',
    title: 'Promote accessories',
    summary: 'Slow day is an opportunity to drive accessory revenue',
    navigationTarget: 'intelligence',
  });

  if (ctx.outreachCandidateCount >= 2) {
    actions.push({
      type: 'additional_vip_slow',
      title: 'Contact additional VIP customers',
      summary: `${ctx.outreachCandidateCount} high-value customers available to contact`,
      navigationTarget: 'customers',
    });
  }

  actions.push({
    type: 'review_opportunities',
    title: 'Review upsell opportunities',
    summary: 'Use downtime to identify revenue opportunities',
    navigationTarget: 'intelligence',
  });

  return {
    chainId: id,
    sourceAction: 'Customer recovery completed',
    nextActions: actions.slice(0, MAX_ACTIONS),
    confidence: 65,
    reason: 'Slow day opportunity expansion',
    expiresAt: now + CHAIN_TTL_MS,
    generatedAt: now,
  };
}

// ── Main export ────────────────────────────────────────────

// Builders evaluated in priority order. First match wins.
// Slow day is checked before collection so the contextual slow-day flow
// takes precedence over the generic collection chain on slow days.
export function generateExecutionChain(
  trigger: ChainTrigger,
  context: ChainContext,
): ExecutionChain | null {
  const now = Date.now();

  return (
    buildRepairChain(trigger, context, now) ??
    buildSlowDayChain(trigger, context, now) ??
    buildVipOutreachChain(trigger, context, now) ??
    buildCollectionChain(trigger, context, now) ??
    buildRushModeChain(trigger, context, now)
  );
}
