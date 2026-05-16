// R-INTELLIGENCE-DECISION-RECOMMENDATION-V1
// Translates operational conditions → best strategic move for the operator.
// Composes existing engine reports — no duplicate scanners.
// Deterministic confidence only — no ML, no AI APIs.

import type { OperationalReasoningReport } from '../reasoning/types';
import type { ProactiveOperationsReport } from '../proactive/types';
import type { ExecutionReport } from '../execution/types';
import type { AttentionSnapshot } from '../attention/types';
import type { TrendDirectionReport, MissedRevenueReport } from '../types';
import type {
  DecisionCategory,
  DecisionRecommendation,
  DecisionRecommendationReport,
} from './types';

// Structural interface — satisfied by IntelligenceEngine without direct import.
export interface DecisionEvalContext {
  getOperationalReasoningReport(): OperationalReasoningReport;
  getProactiveReport(): ProactiveOperationsReport;
  getExecutionReport(): ExecutionReport;
  getAttentionSnapshot(): AttentionSnapshot;
  getTrendDirectionReport(): TrendDirectionReport;
  getMissedRevenue(): MissedRevenueReport;
}

// ── Confidence helpers ────────────────────────────────────────────────────────

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2 } as const;

function capConfidence(base: number, ...boosts: number[]): number {
  return Math.min(0.92, base + boosts.reduce((a, b) => a + b, 0));
}

function rec(
  id: string,
  category: DecisionCategory,
  priority: 'critical' | 'high' | 'medium',
  title: string,
  reasoning: string,
  recommendedMove: string,
  confidence: number,
  extras: Partial<Pick<DecisionRecommendation, 'expectedBenefit' | 'relatedConditionId' | 'entityType' | 'entityId'>> = {},
): DecisionRecommendation {
  return {
    id,
    category,
    priority,
    title,
    reasoning,
    recommendedMove,
    confidence,
    createdAt: Date.now(),
    ...extras,
  };
}

// ── Decision rules ────────────────────────────────────────────────────────────

function decisionForLowFootTraffic(ctx: DecisionEvalContext): DecisionRecommendation | null {
  const reasoning = ctx.getOperationalReasoningReport();
  const condition = reasoning.allConditions.find(c => c.condition === 'low_foot_traffic');
  if (!condition) return null;

  const exec     = ctx.getExecutionReport();
  const proactive = ctx.getProactiveReport();

  const repairExecs = exec.executions.filter(e => e.category === 'repair_followup');
  const vipActions  = proactive.actions.filter(a => a.category === 'vip_retention');

  const confidence = capConfidence(
    condition.confidence,
    repairExecs.length > 0 ? 0.08 : 0,
    vipActions.length  > 0 ? 0.05 : 0,
  );

  let recommendedMove = 'Use the quiet window to contact repair customers and VIPs before inventory work.';
  let expectedBenefit: string | undefined;
  let entityType: string | undefined;
  let entityId: string | undefined;

  if (repairExecs.length > 0) {
    const top = repairExecs[0];
    recommendedMove = top.customerName
      ? `Contact ${top.customerName} about their repair pickup first.`
      : 'Follow up on ready repairs — this is recoverable money with no new workload.';
    expectedBenefit = top.estimatedImpactCents && top.estimatedImpactCents > 0
      ? `Recover $${(top.estimatedImpactCents / 100).toFixed(0)} from ready repairs.`
      : 'Clear ready repairs and collect balances.';
    entityType = top.entityType;
    entityId   = top.entityId;
  } else if (vipActions.length > 0) {
    recommendedMove = 'Reach out to a high-value customer — quiet days are the best time for personal outreach.';
    expectedBenefit = 'Build loyalty revenue without disrupting shop flow.';
  }

  return rec(
    'decision-low-foot-traffic',
    'recover_revenue',
    'high',
    'Use quiet window for follow-up revenue',
    'Traffic is below normal. High-effort new sales campaigns underperform in slow windows — focus on ready money instead.',
    recommendedMove,
    confidence,
    { expectedBenefit, relatedConditionId: 'low_foot_traffic', entityType, entityId },
  );
}

function decisionForFollowupBreakdown(ctx: DecisionEvalContext): DecisionRecommendation | null {
  const reasoning = ctx.getOperationalReasoningReport();
  const condition = reasoning.allConditions.find(c => c.condition === 'followup_breakdown');
  if (!condition) return null;

  const exec = ctx.getExecutionReport();

  const collectionExecs = exec.executions.filter(e => e.category === 'collection');
  const repairExecs     = exec.executions.filter(e => e.category === 'repair_followup');

  const confidence = capConfidence(
    condition.confidence,
    collectionExecs.length > 0 ? 0.08 : 0,
    repairExecs.length     > 0 ? 0.05 : 0,
  );

  let recommendedMove = 'Clear stalled workflows before accepting new work — pipeline is backing up.';
  let expectedBenefit: string | undefined;

  if (collectionExecs.length > 0) {
    const top = collectionExecs[0];
    recommendedMove = top.customerName
      ? `Start with ${top.customerName}'s outstanding balance, then work down the list.`
      : `Work through ${collectionExecs.length} collection follow-up${collectionExecs.length === 1 ? '' : 's'} before taking new intake.`;
    if (top.estimatedImpactCents && top.estimatedImpactCents > 0) {
      expectedBenefit = `Recover $${(top.estimatedImpactCents / 100).toFixed(0)} from top collection.`;
    }
  } else if (repairExecs.length > 0) {
    recommendedMove = 'Contact ready-repair customers first — their pickups unblock downstream capacity.';
    expectedBenefit = 'Each pickup closes a workflow slot and frees the operator for new intake.';
  }

  return rec(
    'decision-followup-breakdown',
    'protect_operations',
    'high',
    'Clear the pipeline before new intake',
    'Follow-up activity is falling behind. Taking new work without clearing existing obligations creates compounding delays.',
    recommendedMove,
    confidence,
    { expectedBenefit, relatedConditionId: 'followup_breakdown' },
  );
}

function decisionForInventoryPressure(ctx: DecisionEvalContext): DecisionRecommendation | null {
  const reasoning = ctx.getOperationalReasoningReport();
  const condition = reasoning.allConditions.find(c => c.condition === 'inventory_pressure');
  if (!condition) return null;

  const proactive = ctx.getProactiveReport();

  const inventoryActions = proactive.actions.filter(a => a.category === 'inventory');
  const topInventory     = inventoryActions[0];

  const confidence = capConfidence(
    condition.confidence,
    topInventory ? 0.08 : 0,
  );

  const recommendedMove = topInventory
    ? topInventory.recommendedAction
    : 'Reorder fast-moving items before promoting accessories that depend on them.';

  const expectedBenefit = topInventory?.estimatedImpactCents && topInventory.estimatedImpactCents > 0
    ? `Protect $${(topInventory.estimatedImpactCents / 100).toFixed(0)} in at-risk inventory revenue.`
    : 'Avoid stockout losses and protect high-velocity item availability.';

  return rec(
    'decision-inventory-pressure',
    'protect_inventory',
    'high',
    'Protect inventory before pushing sales',
    'Stock pressure is building. Pushing sales on items running low will create fulfillment problems and damage trust.',
    recommendedMove,
    confidence,
    { expectedBenefit, relatedConditionId: 'inventory_pressure' },
  );
}

function decisionForOperatorOverload(ctx: DecisionEvalContext): DecisionRecommendation | null {
  const reasoning = ctx.getOperationalReasoningReport();
  const condition = reasoning.allConditions.find(c => c.condition === 'operator_overload');
  if (!condition) return null;

  const snapshot = ctx.getAttentionSnapshot();

  const confidence = capConfidence(
    condition.confidence,
    snapshot.state === 'overloaded' ? 0.10 : 0,
    snapshot.unresolvedCriticalCount >= 2 ? 0.07 : 0,
  );

  const priority = snapshot.state === 'overloaded' ? 'critical' : 'high';

  const recommendedMove = snapshot.unresolvedCriticalCount >= 2
    ? `Resolve the ${snapshot.unresolvedCriticalCount} critical manager queue item${snapshot.unresolvedCriticalCount === 1 ? '' : 's'} — everything else waits.`
    : 'Pick only the single highest-priority open item. Acknowledge then defer the rest.';

  return rec(
    'decision-operator-overload',
    'reduce_overload',
    priority,
    'Reduce workload before adding more',
    'Too many open threads are reducing decision quality. Closing the critical path first recovers capacity faster than parallelizing.',
    recommendedMove,
    confidence,
    {
      expectedBenefit: 'Restored focus reduces errors and accelerates closure on the critical path.',
      relatedConditionId: 'operator_overload',
    },
  );
}

function decisionForRevenueFocusImbalance(ctx: DecisionEvalContext): DecisionRecommendation | null {
  const reasoning = ctx.getOperationalReasoningReport();
  const condition = reasoning.allConditions.find(c => c.condition === 'revenue_focus_imbalance');
  if (!condition) return null;

  const exec      = ctx.getExecutionReport();
  const proactive = ctx.getProactiveReport();

  const collectionExecs = exec.executions.filter(e => e.category === 'collection');
  const vipActions      = proactive.actions.filter(a => a.category === 'vip_retention');

  const confidence = capConfidence(
    condition.confidence,
    collectionExecs.length > 0 ? 0.08 : 0,
    vipActions.length      > 0 ? 0.05 : 0,
  );

  let recommendedMove = 'Shift energy from new sales to recovery — existing revenue is being left on the table.';
  let expectedBenefit: string | undefined;

  const totalCollectionCents = collectionExecs.reduce((sum, e) => sum + (e.estimatedImpactCents ?? 0), 0);
  if (collectionExecs.length > 0 && totalCollectionCents > 0) {
    recommendedMove = `Collect $${(totalCollectionCents / 100).toFixed(0)} in outstanding balances before pushing new sales.`;
    expectedBenefit = 'Recovering existing owed revenue costs less effort than generating equivalent new sales.';
  } else if (vipActions.length > 0) {
    recommendedMove = 'Re-engage your top customers — their repeat revenue is more reliable than new prospects right now.';
    expectedBenefit = 'Retaining a VIP costs 5× less than replacing them.';
  }

  return rec(
    'decision-revenue-focus-imbalance',
    'recover_revenue',
    'high',
    'Balance revenue recovery vs new sales',
    'Revenue effort is concentrated in the wrong area. Outstanding balances and VIP churn risk are higher-yield targets.',
    recommendedMove,
    confidence,
    { expectedBenefit, relatedConditionId: 'revenue_focus_imbalance' },
  );
}

function decisionForHealthyOperation(ctx: DecisionEvalContext): DecisionRecommendation {
  const proactive = ctx.getProactiveReport();
  const exec      = ctx.getExecutionReport();

  const topProactive = proactive.topAction;
  const topExec      = exec.topExecution;

  let recommendedMove = 'Run proactive outreach to accelerate growth — the store has capacity right now.';
  let category: DecisionCategory = 'increase_sales';
  let expectedBenefit: string | undefined;

  if (topProactive) {
    recommendedMove = topProactive.recommendedAction;
    category = topProactive.category === 'vip_retention' ? 'retain_customers' : 'increase_sales';
    if (topProactive.estimatedImpactCents && topProactive.estimatedImpactCents > 0) {
      expectedBenefit = `Potential $${(topProactive.estimatedImpactCents / 100).toFixed(0)} impact from top priority action.`;
    }
  } else if (topExec) {
    recommendedMove = topExec.customerName
      ? `Start with ${topExec.customerName} — your top prepared outreach draft is ready to send.`
      : 'Send your top prepared outreach draft — execution queue is ready.';
    category = 'increase_sales';
  }

  return rec(
    'decision-healthy-operation',
    category,
    'medium',
    'Store is healthy — focus on growth',
    'No critical conditions detected. This is the right time for proactive moves.',
    recommendedMove,
    0.55,
    { expectedBenefit, relatedConditionId: 'healthy_operation' },
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateDecisionRecommendationReport(
  ctx: DecisionEvalContext,
): DecisionRecommendationReport {
  const now = Date.now();

  const decisors = [
    decisionForOperatorOverload,
    decisionForFollowupBreakdown,
    decisionForRevenueFocusImbalance,
    decisionForInventoryPressure,
    decisionForLowFootTraffic,
  ];

  const recommendations: DecisionRecommendation[] = [];
  for (const decisor of decisors) {
    const result = decisor(ctx);
    if (result) recommendations.push(result);
  }

  // Sort: priority rank first, confidence second.
  recommendations.sort((a, b) => {
    const pd = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pd !== 0) return pd;
    return b.confidence - a.confidence;
  });

  if (recommendations.length === 0) {
    const healthy = decisionForHealthyOperation(ctx);
    return {
      generatedAt: now,
      summary: healthy.reasoning,
      recommendations: [healthy],
      topRecommendation: healthy,
    };
  }

  const top = recommendations[0];
  const summary = `${top.title}. ${top.reasoning}`;

  return { generatedAt: now, summary, recommendations, topRecommendation: top };
}
