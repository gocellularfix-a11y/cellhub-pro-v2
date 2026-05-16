// R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1
// Correlates signals across modules to infer what is actually happening in the
// business right now. Deterministic weighted confidence — no ML, no LLM.
//
// Named crossSystemEngine.ts to coexist with reasoningEngine.ts (contextSuggestions system).

import type { TrendDirectionReport, MissedRevenueReport } from '../types';
import type { ProactiveOperationsReport } from '../proactive/types';
import type { ExecutionReport } from '../execution/types';
import type { AttentionSnapshot } from '../attention/types';
import { getStaleWorkflows } from '../workflows/store';
import { getQueue } from '../managerQueue/actions';
import type {
  OperationalCondition,
  OperationalReasoning,
  OperationalReasoningReport,
  ReasoningSignal,
} from './types';

// Structural interface — satisfied by IntelligenceEngine without direct import.
export interface ReasoningEvalContext {
  getTrendDirectionReport(): TrendDirectionReport;
  getProactiveReport(): ProactiveOperationsReport;
  getExecutionReport(): ExecutionReport;
  getAttentionSnapshot(): AttentionSnapshot;
  getMissedRevenue(): MissedRevenueReport;
}

// ── Confidence model ──────────────────────────────────────────────────────────
// confidence = min(0.95, Σ min(signal.value, 0.35))
function computeConfidence(signals: ReasoningSignal[]): number {
  const sum = signals.reduce((acc, s) => acc + Math.min(s.value, 0.35), 0);
  return Math.min(0.95, sum);
}

function build(
  condition: OperationalCondition,
  signals: ReasoningSignal[],
  headline: string,
  recommendation: string,
): OperationalReasoning {
  return { condition, confidence: computeConfidence(signals), signals, headline, recommendation };
}

// ── Condition evaluators ──────────────────────────────────────────────────────

function evalLowFootTraffic(ctx: ReasoningEvalContext): OperationalReasoning | null {
  const trend  = ctx.getTrendDirectionReport();
  const missed = ctx.getMissedRevenue();

  const badRevenue = trend.signals.filter(
    s => (s.direction === 'declining' || s.direction === 'worsening') &&
         (s.category === 'sales' || s.category === 'repairs' || s.category === 'accessories'),
  );

  const signals: ReasoningSignal[] = [];

  for (const s of badRevenue.slice(0, 2)) {
    signals.push({
      id: `trend_${s.category}`,
      description: s.title,
      value: (s.severity === 'high' || s.severity === 'critical') ? 0.30 : 0.20,
    });
  }

  if (missed.slowDayLossCents > 0) {
    signals.push({
      id: 'slow_day_loss',
      description: `${missed.slowestDayName} consistently underperforms`,
      value: 0.20,
    });
  }

  const confidence = computeConfidence(signals);
  if (confidence < 0.4) return null;

  return build(
    'low_foot_traffic',
    signals,
    'Low foot traffic across key revenue categories',
    'Run a promotion or contact inactive customers to drive walk-in traffic.',
  );
}

function evalFollowupBreakdown(ctx: ReasoningEvalContext): OperationalReasoning | null {
  const stale = getStaleWorkflows(72 * 60 * 60 * 1000);
  const exec  = ctx.getExecutionReport();
  const trend = ctx.getTrendDirectionReport();
  const queue = getQueue();

  const signals: ReasoningSignal[] = [];

  if (stale.length >= 2) {
    signals.push({
      id: 'stale_workflows',
      description: `${stale.length} workflow${stale.length === 1 ? '' : 's'} stalled 3+ days`,
      value: Math.min(stale.length * 0.10, 0.30),
    });
  }

  const collectionExecs = exec.executions.filter(e => e.category === 'collection');
  if (collectionExecs.length >= 2) {
    signals.push({
      id: 'collection_queue',
      description: `${collectionExecs.length} collection follow-up${collectionExecs.length === 1 ? '' : 's'} pending`,
      value: Math.min(collectionExecs.length * 0.10, 0.25),
    });
  }

  const collectionsTrend = trend.signals.find(
    s => s.category === 'collections' &&
         (s.direction === 'declining' || s.direction === 'worsening'),
  );
  if (collectionsTrend) {
    signals.push({
      id: 'collections_declining',
      description: collectionsTrend.title,
      value: 0.30,
    });
  }

  const pendingQueue = queue.filter(i => i.status === 'pending');
  if (pendingQueue.length >= 2) {
    signals.push({
      id: 'pending_approvals',
      description: `${pendingQueue.length} manager queue item${pendingQueue.length === 1 ? '' : 's'} awaiting action`,
      value: Math.min(pendingQueue.length * 0.08, 0.20),
    });
  }

  const confidence = computeConfidence(signals);
  if (confidence < 0.4) return null;

  return build(
    'followup_breakdown',
    signals,
    'Follow-up pipeline is breaking down',
    'Clear the collection queue and resolve stalled workflows before taking on new intake.',
  );
}

function evalInventoryPressure(ctx: ReasoningEvalContext): OperationalReasoning | null {
  const proactive = ctx.getProactiveReport();
  const missed    = ctx.getMissedRevenue();
  const trend     = ctx.getTrendDirectionReport();

  const signals: ReasoningSignal[] = [];

  const inventoryActions = proactive.actions.filter(a => a.category === 'inventory');
  if (inventoryActions.length >= 1) {
    signals.push({
      id: 'inventory_actions',
      description: `${inventoryActions.length} inventory action${inventoryActions.length === 1 ? '' : 's'} needed`,
      value: Math.min(inventoryActions.length * 0.15, 0.30),
    });
  }

  if (missed.deadStockLockedCents > 50000) {
    signals.push({
      id: 'dead_stock',
      description: `$${(missed.deadStockLockedCents / 100).toFixed(0)} locked in dead inventory`,
      value: 0.25,
    });
  }

  const inventoryTrend = trend.signals.find(
    s => s.category === 'inventory' &&
         (s.direction === 'worsening' || s.direction === 'declining'),
  );
  if (inventoryTrend) {
    signals.push({
      id: 'inventory_trend',
      description: inventoryTrend.title,
      value: (inventoryTrend.severity === 'high' || inventoryTrend.severity === 'critical') ? 0.30 : 0.20,
    });
  }

  const confidence = computeConfidence(signals);
  if (confidence < 0.4) return null;

  return build(
    'inventory_pressure',
    signals,
    'Inventory pressure building',
    'Prioritize reorders on fast-movers and clear dead stock before ordering new units.',
  );
}

function evalOperatorOverload(ctx: ReasoningEvalContext): OperationalReasoning | null {
  const snapshot = ctx.getAttentionSnapshot();
  const stale    = getStaleWorkflows(72 * 60 * 60 * 1000);

  const signals: ReasoningSignal[] = [];

  if (snapshot.state === 'overloaded') {
    signals.push({
      id: 'attention_overloaded',
      description: 'Operator attention model indicates overload',
      value: 0.35,
    });
  } else if (snapshot.state === 'busy') {
    signals.push({
      id: 'attention_busy',
      description: 'Operator is handling high activity',
      value: 0.20,
    });
  }

  if (snapshot.unresolvedCriticalCount >= 2) {
    signals.push({
      id: 'critical_queue',
      description: `${snapshot.unresolvedCriticalCount} unresolved critical item${snapshot.unresolvedCriticalCount === 1 ? '' : 's'}`,
      value: Math.min(snapshot.unresolvedCriticalCount * 0.12, 0.25),
    });
  }

  if (stale.length >= 3) {
    signals.push({
      id: 'stale_overflow',
      description: `${stale.length} stalled workflow${stale.length === 1 ? '' : 's'} need attention`,
      value: Math.min(stale.length * 0.08, 0.25),
    });
  }

  if (snapshot.recentDismissals >= 3) {
    signals.push({
      id: 'dismissal_pattern',
      description: 'Repeated suggestion dismissals signal interruption fatigue',
      value: Math.min(snapshot.recentDismissals * 0.07, 0.20),
    });
  }

  const confidence = computeConfidence(signals);
  if (confidence < 0.4) return null;

  return build(
    'operator_overload',
    signals,
    'Operator showing signs of overload',
    'Focus on the single highest-priority item. Defer non-critical tasks to tomorrow.',
  );
}

function evalRevenueFocusImbalance(ctx: ReasoningEvalContext): OperationalReasoning | null {
  const exec      = ctx.getExecutionReport();
  const trend     = ctx.getTrendDirectionReport();
  const missed    = ctx.getMissedRevenue();
  const proactive = ctx.getProactiveReport();

  const signals: ReasoningSignal[] = [];

  const collectionExecs = exec.executions.filter(e => e.category === 'collection');
  const salesDeclining  = trend.signals.some(
    s => s.category === 'sales' && (s.direction === 'declining' || s.direction === 'worsening'),
  );

  if (collectionExecs.length >= 2 && salesDeclining) {
    signals.push({
      id: 'collection_while_declining',
      description: `${collectionExecs.length} uncollected balance${collectionExecs.length === 1 ? '' : 's'} while sales are declining`,
      value: 0.30,
    });
  } else if (collectionExecs.length >= 3) {
    signals.push({
      id: 'collection_backlog',
      description: `${collectionExecs.length} uncollected balance${collectionExecs.length === 1 ? '' : 's'} need follow-up`,
      value: Math.min(collectionExecs.length * 0.08, 0.25),
    });
  }

  if (missed.slowDayLossCents > 50000) {
    signals.push({
      id: 'slow_day_revenue',
      description: `$${(missed.slowDayLossCents / 100).toFixed(0)} average loss on ${missed.slowestDayName}s`,
      value: 0.20,
    });
  }

  const vipActions = proactive.actions.filter(a => a.category === 'vip_retention');
  if (vipActions.length >= 1) {
    signals.push({
      id: 'vip_inactivity',
      description: `${vipActions.length} high-value customer${vipActions.length === 1 ? '' : 's'} at risk of churn`,
      value: Math.min(vipActions.length * 0.15, 0.25),
    });
  }

  const confidence = computeConfidence(signals);
  if (confidence < 0.4) return null;

  return build(
    'revenue_focus_imbalance',
    signals,
    'Revenue recovery opportunities being missed',
    'Collect outstanding balances and re-engage VIP customers before chasing new sales.',
  );
}

function buildHealthyOperation(): OperationalReasoning {
  return {
    condition: 'healthy_operation',
    confidence: 0.40,
    signals: [{ id: 'no_critical', description: 'No critical operational issues detected', value: 0.40 }],
    headline: 'Store is operating within normal parameters',
    recommendation: 'Focus on proactive outreach and product promotion to grow revenue.',
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateOperationalReasoningReport(
  ctx: ReasoningEvalContext,
): OperationalReasoningReport {
  const evaluators = [
    evalOperatorOverload,
    evalFollowupBreakdown,
    evalRevenueFocusImbalance,
    evalInventoryPressure,
    evalLowFootTraffic,
  ];

  const allConditions: OperationalReasoning[] = [];
  for (const evaluator of evaluators) {
    const result = evaluator(ctx);
    if (result) allConditions.push(result);
  }

  allConditions.sort((a, b) => b.confidence - a.confidence);

  if (allConditions.length === 0) {
    const healthy = buildHealthyOperation();
    return { topCondition: healthy, allConditions: [healthy], generatedAt: Date.now() };
  }

  return { topCondition: allConditions[0], allConditions, generatedAt: Date.now() };
}
