import type { IntelligenceOutcome, OutcomeStats } from './outcomeTypes';
// R-INTELLIGENCE-OUTCOME-TRACKING-V1 — additional imports
import type { OperationalOutcome, OutcomeCategory } from './types';
import type { OperationalWorkflow, WorkflowCategory } from '../workflows/types';
import type { Sale, Repair, Layaway, InventoryItem } from '@/store/types';
import {
  createOutcome as persistCreateOutcome,
  completeOutcome as persistCompleteOutcome,
  getPendingOutcomes,
  getOutcomesByWorkflow,
  getOutcomes,
} from './store';
import { recordOutcomeFeedback } from '../feedback/store';
import { getQueue } from '../managerQueue/actions';

// Maps chain source IDs → their corresponding strategy suggestion IDs.
// Used to suppress/dampen strategy suggestions when chains complete or are repeatedly skipped.
const CHAIN_TO_SUGGESTION: Record<string, string> = {
  collection_recovery:    'strategy_collection_focus',
  repair_cleanup:         'strategy_repair_cleanup_focus',
  vip_customer_recovery:  'strategy_customer_retention_focus',
  workflow_stabilization: 'strategy_workflow_stabilization_focus',
  upsell_momentum:        'strategy_upsell_focus',
};

/**
 * Aggregate IntelligenceOutcome records into an OutcomeStats snapshot.
 * Pure function — safe inside useMemo.
 */
export function computeOutcomeStats(outcomes: IntelligenceOutcome[]): OutcomeStats {
  const now = Date.now();
  const oneDayAgo   = now - 24 * 60 * 60 * 1000;
  const twoHoursAgo = now - 2  * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let completedCount = 0, skippedCount = 0, dismissedCount = 0, recoveredCount = 0, unresolvedCount = 0;
  let recoveredImpactCents = 0;

  const completedBySource  = new Map<string, number>();
  const skippedBySource24h = new Map<string, number>();
  const recentChainCompletions: string[] = [];

  for (const o of outcomes) {
    switch (o.outcome) {
      case 'completed':  completedCount++;  break;
      case 'skipped':    skippedCount++;    break;
      case 'dismissed':  dismissedCount++;  break;
      case 'recovered':  recoveredCount++;  recoveredImpactCents += o.estimatedImpactCents ?? 0; break;
      case 'unresolved': unresolvedCount++; break;
    }

    if ((o.outcome === 'completed' || o.outcome === 'recovered') && o.createdAt > sevenDaysAgo) {
      completedBySource.set(o.sourceId, (completedBySource.get(o.sourceId) ?? 0) + 1);
    }

    if ((o.outcome === 'skipped' || o.outcome === 'dismissed') && o.createdAt > oneDayAgo) {
      skippedBySource24h.set(o.sourceId, (skippedBySource24h.get(o.sourceId) ?? 0) + 1);
    }

    // Whole-chain completions (no stepId tag) within the 2h window.
    if (
      o.sourceType === 'chain' &&
      o.outcome === 'completed' &&
      o.metadata?.type === 'chain' &&
      (o.completedAt ?? 0) > twoHoursAgo
    ) {
      recentChainCompletions.push(o.sourceId);
    }
  }

  const total = completedCount + skippedCount + dismissedCount + recoveredCount + unresolvedCount;

  const topCompletedSourceIds = [...completedBySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  // Sources skipped/dismissed ≥3× in 24h → dampen their strategy suggestion priority.
  const recentlyIgnoredSourceIds: string[] = [];
  for (const [sourceId, count] of skippedBySource24h.entries()) {
    if (count >= 3) {
      const suggId = CHAIN_TO_SUGGESTION[sourceId];
      if (suggId) recentlyIgnoredSourceIds.push(suggId);
    }
  }

  // Recently completed chains → suppress their strategy suggestions for 2h cooldown.
  const recentlyCompletedSourceIds = [
    ...new Set(recentChainCompletions.map((t) => CHAIN_TO_SUGGESTION[t]).filter(Boolean)),
  ];

  return {
    completedCount,
    skippedCount,
    dismissedCount,
    recoveredCount,
    unresolvedCount,
    completionRate: total > 0 ? (completedCount + recoveredCount) / total : 0,
    recoveredImpactCents,
    topCompletedSourceIds,
    recentlyIgnoredSourceIds,
    recentlyCompletedSourceIds,
  };
}

// ── R-INTELLIGENCE-OUTCOME-TRACKING-V1 ───────────────────────────────────────
// Deterministic outcome tracking — did our operational actions actually work?
// All evaluation is state-based. No time-based failure detection in V1
// (prefer staying pending over false negatives — never hallucinate outcomes).

// Structural interface satisfied by IntelligenceEngine — avoids circular import.
export interface OutcomeEvalContext {
  getSales(): Sale[];
  getRepairs(): Repair[];
  getLayaways(): Layaway[];
  getInventory(): InventoryItem[];
}

const WORKFLOW_TO_OUTCOME: Record<WorkflowCategory, OutcomeCategory> = {
  repair_followup:   'repair_pickup',
  collection:        'collection_recovered',
  vip_retention:     'vip_returned',
  inventory_action:  'inventory_recovered',
  approval_review:   'approval_completed',
};

const EXPECTED_SIGNAL: Record<OutcomeCategory, string> = {
  repair_pickup:          'Repair status changes to picked_up',
  collection_recovered:   'Entity balance reaches zero',
  vip_returned:           'Customer makes a purchase after outreach',
  inventory_recovered:    'Inventory qty rises above minimum threshold',
  approval_completed:     'Approval queue item manually resolved',
};

// ── createOutcomeForWorkflow ──────────────────────────────────────────────────
// Idempotent: returns existing outcome for the workflow, or creates one.
// Called by flowEngine.ensureOperationalWorkflow after workflow creation.
export function createOutcomeForWorkflow(
  workflow: Pick<OperationalWorkflow, 'id' | 'category' | 'entityType' | 'entityId'>,
  queueItemId?: string,
): OperationalOutcome {
  const existing = getOutcomesByWorkflow(workflow.id);
  if (existing.length > 0) return existing[0];

  const category = WORKFLOW_TO_OUTCOME[workflow.category];
  return persistCreateOutcome({
    workflowId: workflow.id,
    queueItemId,
    category,
    status: 'pending',
    entityType: workflow.entityType,
    entityId: workflow.entityId,
    expectedSignal: EXPECTED_SIGNAL[category],
  });
}

// ── Rule functions ─────────────────────────────────────────────────────────────
// Pure evaluation — no store writes. Returns 'successful' or 'pending' (no change).

function evalRepairPickup(outcome: OperationalOutcome, ctx: OutcomeEvalContext): 'successful' | 'pending' {
  if (!outcome.entityId) return 'pending';
  const repair = ctx.getRepairs().find(r => r.id === outcome.entityId);
  if (!repair) return 'pending';
  const status = String((repair as unknown as { status?: string }).status || '').toLowerCase();
  return ['picked_up', 'cancelled', 'closed'].includes(status) ? 'successful' : 'pending';
}

function evalCollectionRecovered(outcome: OperationalOutcome, ctx: OutcomeEvalContext): 'successful' | 'pending' {
  if (!outcome.entityId) return 'pending';
  // Check layaways first, then repairs — both can carry outstanding balances.
  const layaway = ctx.getLayaways().find(l => l.id === outcome.entityId);
  if (layaway) return (((layaway as unknown as { balance?: number }).balance ?? 1) <= 0) ? 'successful' : 'pending';
  const repair = ctx.getRepairs().find(r => r.id === outcome.entityId);
  if (repair) return ((repair.balance ?? 1) <= 0) ? 'successful' : 'pending';
  return 'pending';
}

function evalVipReturned(outcome: OperationalOutcome, ctx: OutcomeEvalContext): 'successful' | 'pending' {
  if (!outcome.entityId) return 'pending';
  const customerId = outcome.entityId;
  const threshold = outcome.createdAt;
  const hasSale = ctx.getSales().some(s => {
    if (s.customerId !== customerId) return false;
    const status = String((s as unknown as { status?: string }).status || '').toLowerCase();
    if (status === 'voided' || status === 'refunded') return false;
    return extractSaleTs(s) > threshold;
  });
  return hasSale ? 'successful' : 'pending';
}

function evalInventoryRecovered(outcome: OperationalOutcome, ctx: OutcomeEvalContext): 'successful' | 'pending' {
  if (!outcome.entityId) return 'pending';
  const item = ctx.getInventory().find(i => i.id === outcome.entityId);
  if (!item) return 'pending';
  const qty = (item as unknown as { qty?: number; quantity?: number }).qty
    ?? (item as unknown as { quantity?: number }).quantity
    ?? 0;
  const minQty = (item as unknown as { minQty?: number }).minQty;
  if (minQty == null) return 'pending'; // no threshold → cannot determine success
  return qty > minQty ? 'successful' : 'pending';
}

function evalApprovalCompleted(outcome: OperationalOutcome): 'successful' | 'pending' {
  if (!outcome.queueItemId) return 'pending';
  const item = getQueue().find(i => i.id === outcome.queueItemId);
  if (!item) return 'pending';
  return item.status !== 'pending' ? 'successful' : 'pending';
}

function extractSaleTs(s: Sale): number {
  const ca = (s as unknown as { createdAt?: unknown }).createdAt;
  if (!ca) return 0;
  try {
    if (typeof (ca as { toDate?: unknown }).toDate === 'function') {
      return (ca as { toDate: () => Date }).toDate().getTime();
    }
    return new Date(ca as string | Date).getTime();
  } catch { return 0; }
}

// ── evaluateOutcome ───────────────────────────────────────────────────────────
// Pure evaluation, no store writes. Returns resolved status, or null (no change).
export function evaluateOutcome(
  outcome: OperationalOutcome,
  ctx: OutcomeEvalContext,
): 'successful' | 'failed' | 'unknown' | null {
  if (outcome.status !== 'pending') return null;
  let next: 'successful' | 'pending';
  switch (outcome.category) {
    case 'repair_pickup':        next = evalRepairPickup(outcome, ctx); break;
    case 'collection_recovered': next = evalCollectionRecovered(outcome, ctx); break;
    case 'vip_returned':         next = evalVipReturned(outcome, ctx); break;
    case 'inventory_recovered':  next = evalInventoryRecovered(outcome, ctx); break;
    case 'approval_completed':   next = evalApprovalCompleted(outcome); break;
    default: return null;
  }
  return next === 'successful' ? 'successful' : null;
}

// ── evaluatePendingOutcomes ───────────────────────────────────────────────────
// Scans all pending outcomes, evaluates each, persists resolved ones,
// and fires feedback events. Returns count of newly resolved outcomes.
export function evaluatePendingOutcomes(ctx: OutcomeEvalContext): number {
  const pending = getPendingOutcomes();
  let count = 0;
  for (const outcome of pending) {
    const resolved = evaluateOutcome(outcome, ctx);
    if (!resolved) continue;
    const updated = persistCompleteOutcome(outcome.id, resolved);
    if (!updated) continue;
    count++;
    if (outcome.workflowId) {
      recordOutcomeFeedback({
        queueItemId: outcome.queueItemId,
        workflowId: outcome.workflowId,
        fingerprint: outcome.fingerprint,
        status: resolved === 'successful' ? 'successful' : 'failed',
      });
    }
  }
  return count;
}

// ── getCategorySuccessRate ────────────────────────────────────────────────────
// R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1: deterministic 0–1 success rate
// for a given outcome category. Used by the proactive engine to adjust
// confidence scores based on historical outcome data.
// Returns 0.5 (neutral) when there is no resolved outcome history yet.
export function getCategorySuccessRate(category: OutcomeCategory): number {
  const relevant = getOutcomes().filter(o => o.category === category && o.status !== 'pending');
  if (relevant.length === 0) return 0.5;
  const successful = relevant.filter(o => o.status === 'successful').length;
  return successful / relevant.length;
}

// ── completeOutcomeFromSignal ─────────────────────────────────────────────────
// External override — caller already confirmed the outcome (e.g., operator
// manually marked a repair picked up in the UI). Idempotent on already-terminal.
export function completeOutcomeFromSignal(
  outcomeId: string,
  status: 'successful' | 'failed' | 'unknown',
  actualSignal?: string,
  revenueImpactCents?: number,
): OperationalOutcome | null {
  return persistCompleteOutcome(outcomeId, status, actualSignal, revenueImpactCents);
}
