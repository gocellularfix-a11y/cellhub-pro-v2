// CellHub Intelligence — Store Rhythm Engine
// Facade: runs all detectors, computes scores, selects mode.
// Pure function — safe inside useMemo. No side effects, no DOM, no I/O.

import type { StoreRhythmContext, StoreRhythmSnapshot, RhythmSignal } from './storeRhythmTypes';
import {
  detectSlowDay,
  detectRush,
  detectRepairOverload,
  detectCollectionMode,
  detectOpportunityWindow,
  detectLowActivity,
} from './storeRhythmSignals';
import { selectStoreMode, getRecommendedActionsForMode } from './storeRhythmModes';
import { toMs } from '@/services/intelligence/customerScoring/customerOpportunitySignals';
import { computeTemporalTrend } from '@/services/intelligence/temporalTrends/temporalTrendEngine';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

const TERMINAL_STATUSES = new Set(['picked_up', 'cancelled', 'refunded', 'refund_pending']);
const READY_STATUSES    = new Set(['completed', 'ready', 'ready_for_pickup']);

function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Compute the store rhythm snapshot from the current state.
 * Each detector runs independently — a failure in one never blocks others.
 */
export function computeStoreRhythm(ctx: StoreRhythmContext): StoreRhythmSnapshot {
  const now = Date.now();

  // ── Run all signal detectors ──────────────────────────────────────────────
  const signals: RhythmSignal[] = [];
  function tryDetect(fn: () => RhythmSignal | null): void {
    try {
      const result = fn();
      if (result) signals.push(result);
    } catch { /* detector failure — non-fatal */ }
  }

  tryDetect(() => detectRush(ctx));
  tryDetect(() => detectRepairOverload(ctx));
  tryDetect(() => detectCollectionMode(ctx));
  tryDetect(() => detectOpportunityWindow(ctx));
  tryDetect(() => detectSlowDay(ctx));
  tryDetect(() => detectLowActivity(ctx));

  // ── Select mode and recommended actions ───────────────────────────────────
  const currentMode = selectStoreMode(signals, ctx.revenueOpportunities.length);
  const recommendedActions = getRecommendedActionsForMode(currentMode);

  // ── Compute scores (single O(R), O(L), O(S) passes) ──────────────────────

  const today = todayStartMs();
  const todaySalesCount = ctx.sales.filter((s) => toMs(s.createdAt) >= today).length;
  const salesPaceScore = Math.min(100, Math.round(todaySalesCount * 9));

  let activeRepairs = 0;
  let delayedRepairs = 0;
  let readyRepairs = 0;
  let repairBalanceCount = 0;
  const delayCutoff = now - 7 * DAY_MS;

  for (const r of ctx.repairs) {
    const s = String(r.status || '').toLowerCase().trim();
    if (TERMINAL_STATUSES.has(s)) continue;
    if (READY_STATUSES.has(s)) { readyRepairs++; continue; }
    activeRepairs++;
    const ts = toMs(r.createdAt);
    if (ts > 0 && ts < delayCutoff) delayedRepairs++;
    if (typeof r.balance === 'number' && r.balance > 0) repairBalanceCount++;
  }
  const repairLoadScore = Math.min(100,
    (activeRepairs * 5) + (delayedRepairs * 12) + (readyRepairs * 3));

  let layawayBalanceCount = 0;
  for (const l of ctx.layaways) {
    const s = String(l.status || '').toLowerCase();
    if (s === 'completed' || s === 'cancelled') continue;
    if (typeof l.balance === 'number' && l.balance > 0) layawayBalanceCount++;
  }
  const balanceCount = repairBalanceCount + layawayBalanceCount;
  const paymentFlowScore = Math.min(100,
    (ctx.pendingWorkflows.length * 25) + (balanceCount * 10));

  const window30 = now - 30 * MIN_MS;
  const recentCustActions = ctx.recentActions.filter((a) => a.timestamp >= window30).length;
  const customerActivityScore = Math.min(100, Math.round(recentCustActions * 14));

  const opportunityPressureScore = Math.min(100, ctx.revenueOpportunities.length * 12);

  const operationalLoadScore = Math.min(100, Math.round(
    (repairLoadScore * 0.4) + (paymentFlowScore * 0.4) + (ctx.pendingWorkflows.length * 10),
  ));

  const temporalTrend = computeTemporalTrend({
    sales: ctx.sales,
    recentActions: ctx.recentActions,
    pendingWorkflows: ctx.pendingWorkflows,
    revenueOpportunities: ctx.revenueOpportunities,
  });

  return {
    currentMode,
    salesPaceScore,
    repairLoadScore,
    paymentFlowScore,
    customerActivityScore,
    opportunityPressureScore,
    operationalLoadScore,
    detectedRhythmSignals: signals,
    recommendedActions,
    temporalTrend,
    generatedAt: now,
  };
}
