// CellHub Intelligence — Temporal Trend Engine
// Facade: runs all detectors, computes momentum scores, selects trend mode.
// Pure function — safe inside useMemo. No side effects, no DOM, no I/O.

import type { TemporalTrendContext, TemporalTrendSnapshot, TemporalTrendSignal, TrendMode } from './temporalTrendTypes';
import {
  detectSalesMomentum,
  detectRepairMomentum,
  detectCollectionMomentum,
  detectCustomerActivityMomentum,
  detectOpportunityMomentum,
  detectWorkflowMomentum,
} from './temporalTrendSignals';
import { computeMomentumScore } from './temporalTrendScoring';
import { toMs } from '@/services/intelligence/customerScoring/customerOpportunitySignals';

const HOUR_MS = 60 * 60 * 1000;
const RECENT_WINDOW_MS = 2 * HOUR_MS;
const PREV_WINDOW_DURATION_MS = 4 * HOUR_MS;

const WORKFLOW_START_TYPES = new Set(['workflow_started', 'external_payment_started']);
const COLLECTION_TYPES     = new Set(['payment_started', 'sale_completed']);
const CUSTOMER_TYPES       = new Set(['customer_selected', 'customer_history_opened', 'phone_number_entered']);
const REPAIR_TYPES         = new Set(['repair_opened']);

/** Select the dominant trend mode from momentum scores. */
function selectTrendMode(
  salesScore: number,
  repairScore: number,
  collectionScore: number,
  workflowScore: number,
  custScore: number,
  oppScore: number,
): TrendMode {
  const coreScores = [salesScore, repairScore, collectionScore, workflowScore, custScore];
  const nImproving = coreScores.filter((s) => s > 60).length;
  const nDeclining = coreScores.filter((s) => s < 40).length;

  if (oppScore > 70)                              return 'opportunity_increasing';
  if (repairScore < 40 && collectionScore < 40)   return 'risk_increasing';
  if (nImproving >= 3 && nDeclining === 0)        return 'accelerating';
  if (nDeclining >= 3)                            return 'worsening';
  if (custScore > 60 && salesScore > 60 && nDeclining >= 1) return 'recovering';
  if (nImproving >= 2 && nDeclining === 0)        return 'improving';
  if (nDeclining >= 2)                            return 'slowing';
  return 'stable';
}

function recommendedActionsForMode(mode: TrendMode): string[] {
  switch (mode) {
    case 'risk_increasing':      return ['act_open_repairs', 'act_open_layaways'];
    case 'worsening':            return ['act_open_customers'];
    case 'slowing':              return ['act_open_customers'];
    case 'opportunity_increasing': return ['act_open_pos', 'act_open_customers'];
    case 'recovering':           return ['act_open_customers'];
    default:                     return [];
  }
}

/**
 * Compute the temporal trend snapshot.
 * Uses two time windows: recent (last 2h) vs. previous (2–6h ago).
 */
export function computeTemporalTrend(ctx: TemporalTrendContext): TemporalTrendSnapshot {
  const now = Date.now();
  const recentStart = now - RECENT_WINDOW_MS;
  const prevStart   = now - RECENT_WINDOW_MS - PREV_WINDOW_DURATION_MS;

  // ── Run signal detectors ──────────────────────────────────────────────────
  const signals: TemporalTrendSignal[] = [];
  function tryDetect(fn: () => TemporalTrendSignal | null): void {
    try {
      const result = fn();
      if (result) signals.push(result);
    } catch { /* non-fatal */ }
  }

  tryDetect(() => detectSalesMomentum(ctx));
  tryDetect(() => detectRepairMomentum(ctx));
  tryDetect(() => detectCollectionMomentum(ctx));
  tryDetect(() => detectCustomerActivityMomentum(ctx));
  tryDetect(() => detectOpportunityMomentum(ctx));
  tryDetect(() => detectWorkflowMomentum(ctx));

  // ── Compute momentum scores (single filter passes per dimension) ──────────
  const recentSales = ctx.sales.filter((s) => toMs(s.createdAt) >= recentStart).length;
  const prevSales   = ctx.sales.filter((s) => { const t = toMs(s.createdAt); return t >= prevStart && t < recentStart; }).length;
  const salesMomentumScore = computeMomentumScore(recentSales, prevSales);

  const recentRepair = ctx.recentActions.filter((a) => a.timestamp >= recentStart && REPAIR_TYPES.has(a.type)).length;
  const prevRepair   = ctx.recentActions.filter((a) => a.timestamp >= prevStart && a.timestamp < recentStart && REPAIR_TYPES.has(a.type)).length;
  const repairMomentumScore = computeMomentumScore(recentRepair, prevRepair);

  const recentColl = ctx.recentActions.filter((a) => a.timestamp >= recentStart && COLLECTION_TYPES.has(a.type)).length;
  const prevColl   = ctx.recentActions.filter((a) => a.timestamp >= prevStart && a.timestamp < recentStart && COLLECTION_TYPES.has(a.type)).length;
  const collectionMomentumScore = computeMomentumScore(recentColl, prevColl);

  const recentWf = ctx.recentActions.filter((a) => a.timestamp >= recentStart && WORKFLOW_START_TYPES.has(a.type)).length;
  const prevWf   = ctx.recentActions.filter((a) => a.timestamp >= prevStart && a.timestamp < recentStart && WORKFLOW_START_TYPES.has(a.type)).length;
  const workflowMomentumScore = computeMomentumScore(recentWf, prevWf);

  const recentCust = ctx.recentActions.filter((a) => a.timestamp >= recentStart && CUSTOMER_TYPES.has(a.type)).length;
  const prevCust   = ctx.recentActions.filter((a) => a.timestamp >= prevStart && a.timestamp < recentStart && CUSTOMER_TYPES.has(a.type)).length;
  const customerActivityMomentumScore = computeMomentumScore(recentCust, prevCust);

  const highConfOpps = ctx.revenueOpportunities.filter((o) => o.confidence !== 'low' && o.priority > 55).length;
  const revenueOpportunityMomentumScore = Math.min(100, highConfOpps * 20);

  // ── Select trend mode ─────────────────────────────────────────────────────
  const trendMode = selectTrendMode(
    salesMomentumScore,
    repairMomentumScore,
    collectionMomentumScore,
    workflowMomentumScore,
    customerActivityMomentumScore,
    revenueOpportunityMomentumScore,
  );

  return {
    trendMode,
    salesMomentumScore,
    repairMomentumScore,
    collectionMomentumScore,
    workflowMomentumScore,
    customerActivityMomentumScore,
    revenueOpportunityMomentumScore,
    detectedTrendSignals: signals,
    recommendedActions: recommendedActionsForMode(trendMode),
    generatedAt: now,
  };
}
