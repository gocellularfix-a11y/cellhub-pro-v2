// CellHub Intelligence — Temporal Trend Signal Detectors
// Each detector compares a recent window (last 2h) vs. a previous window (2–6h ago).
// Returns TemporalTrendSignal | null. Null = no actionable trend detected.

import type { TemporalTrendContext, TemporalTrendSignal, TemporalTrendSignalKind, TrendDirection, TrendConfidence } from './temporalTrendTypes';
import { computeMomentumScore, momentumDirection, momentumConfidence } from './temporalTrendScoring';
import { toMs } from '@/services/intelligence/customerScoring/customerOpportunitySignals';

const HOUR_MS = 60 * 60 * 1000;
const RECENT_WINDOW_MS = 2 * HOUR_MS;       // last 2h
const PREV_WINDOW_DURATION_MS = 4 * HOUR_MS; // 2–6h ago

function windows(): { now: number; recentStart: number; prevStart: number } {
  const now = Date.now();
  return {
    now,
    recentStart: now - RECENT_WINDOW_MS,
    prevStart: now - RECENT_WINDOW_MS - PREV_WINDOW_DURATION_MS,
  };
}

function makeSignal(
  id: string,
  kind: TemporalTrendSignalKind,
  direction: TrendDirection,
  title: string,
  confidence: TrendConfidence,
  priority: number,
  detail?: string,
): TemporalTrendSignal {
  return { id, kind, direction, title, detail, confidence, priority, computedAt: Date.now() };
}

// ── 1. Sales Momentum ──────────────────────────────────────────────────────────

export function detectSalesMomentum(ctx: TemporalTrendContext): TemporalTrendSignal | null {
  const { recentStart, prevStart } = windows();
  const recent = ctx.sales.filter((s) => toMs(s.createdAt) >= recentStart).length;
  const prev   = ctx.sales.filter((s) => { const t = toMs(s.createdAt); return t >= prevStart && t < recentStart; }).length;

  const score = computeMomentumScore(recent, prev);
  const dir   = momentumDirection(score);
  const conf  = momentumConfidence(recent, prev);

  if (dir === 'flat') return null;
  // Only surface low-confidence signals when the drop is complete (0 recent)
  if (conf === 'low' && !(recent === 0 && prev > 0)) return null;

  if (dir === 'down') {
    return makeSignal('trend_sales_slowing', 'sales_momentum', 'down',
      'Sales momentum slowing', conf, 7,
      `${recent} sale${recent !== 1 ? 's' : ''} (recent) vs ${prev} (earlier)`);
  }
  return makeSignal('trend_sales_improving', 'sales_momentum', 'up',
    'Sales pace increasing', conf, 5,
    `${recent} sale${recent !== 1 ? 's' : ''} (recent) vs ${prev} (earlier)`);
}

// ── 2. Repair Momentum ─────────────────────────────────────────────────────────
// Proxied via 'repair_opened' actions — most observable repair signal.

const REPAIR_ACTION_TYPES = new Set(['repair_opened']);

export function detectRepairMomentum(ctx: TemporalTrendContext): TemporalTrendSignal | null {
  const { recentStart, prevStart } = windows();
  const recent = ctx.recentActions.filter((a) => a.timestamp >= recentStart && REPAIR_ACTION_TYPES.has(a.type)).length;
  const prev   = ctx.recentActions.filter((a) => a.timestamp >= prevStart && a.timestamp < recentStart && REPAIR_ACTION_TYPES.has(a.type)).length;

  const score = computeMomentumScore(recent, prev);
  const dir   = momentumDirection(score);
  const conf  = momentumConfidence(recent, prev);

  if (dir === 'flat') return null;
  if (conf === 'low') return null; // repair signal too sparse — skip

  if (dir === 'down') {
    return makeSignal('trend_repair_declining', 'repair_momentum', 'down',
      'Repair activity declining', conf, 6,
      `${recent} repair${recent !== 1 ? 's' : ''} opened recently vs ${prev} earlier`);
  }
  return makeSignal('trend_repair_activity', 'repair_momentum', 'up',
    'Repair activity picking up', conf, 5,
    `${recent} repair${recent !== 1 ? 's' : ''} opened recently`);
}

// ── 3. Collection Momentum ─────────────────────────────────────────────────────
// Proxied via 'payment_started' actions.

const COLLECTION_ACTION_TYPES = new Set(['payment_started', 'sale_completed']);

export function detectCollectionMomentum(ctx: TemporalTrendContext): TemporalTrendSignal | null {
  const { recentStart, prevStart } = windows();
  const recent = ctx.recentActions.filter((a) => a.timestamp >= recentStart && COLLECTION_ACTION_TYPES.has(a.type)).length;
  const prev   = ctx.recentActions.filter((a) => a.timestamp >= prevStart && a.timestamp < recentStart && COLLECTION_ACTION_TYPES.has(a.type)).length;

  const score = computeMomentumScore(recent, prev);
  const dir   = momentumDirection(score);
  const conf  = momentumConfidence(recent, prev);

  if (dir === 'flat') return null;
  if (conf === 'low' && !(recent === 0 && prev >= 2)) return null;

  if (dir === 'down') {
    return makeSignal('trend_collection_pressure', 'collection_momentum', 'down',
      'Collection activity slowing', conf, 8,
      `Payment/collection activity down from ${prev} to ${recent}`);
  }
  return makeSignal('trend_collection_recovering', 'collection_momentum', 'up',
    'Collection activity recovering', conf, 6,
    `Payment activity up from ${prev} to ${recent}`);
}

// ── 4. Customer Activity Momentum ──────────────────────────────────────────────

const CUSTOMER_ACTION_TYPES = new Set([
  'customer_selected', 'customer_history_opened', 'phone_number_entered',
]);

export function detectCustomerActivityMomentum(ctx: TemporalTrendContext): TemporalTrendSignal | null {
  const { recentStart, prevStart } = windows();
  const recent = ctx.recentActions.filter((a) => a.timestamp >= recentStart && CUSTOMER_ACTION_TYPES.has(a.type)).length;
  const prev   = ctx.recentActions.filter((a) => a.timestamp >= prevStart && a.timestamp < recentStart && CUSTOMER_ACTION_TYPES.has(a.type)).length;

  const score = computeMomentumScore(recent, prev);
  const dir   = momentumDirection(score);
  const conf  = momentumConfidence(recent, prev);

  if (dir === 'flat') return null;
  if (conf === 'low' && !(recent === 0 && prev >= 2)) return null;

  if (dir === 'down') {
    return makeSignal('trend_customer_activity_dropped', 'customer_activity_momentum', 'down',
      'Customer activity dropped', conf, 7,
      `Customer interactions down from ${prev} to ${recent}`);
  }
  return makeSignal('trend_customer_activity_rising', 'customer_activity_momentum', 'up',
    'Customer engagement increasing', conf, 5,
    `Customer interactions up from ${prev} to ${recent}`);
}

// ── 5. Opportunity Momentum ────────────────────────────────────────────────────
// Without historical snapshots, proxied by high-confidence opportunity density.

export function detectOpportunityMomentum(ctx: TemporalTrendContext): TemporalTrendSignal | null {
  const highConf = ctx.revenueOpportunities.filter((o) => o.confidence !== 'low' && o.priority > 55);
  const n = highConf.length;

  if (n === 0) return null;

  // Need at least 3 high-priority opportunities to signal rising pressure
  if (n >= 5) {
    return makeSignal('trend_opportunity_rising', 'opportunity_momentum', 'up',
      'Revenue opportunities rising', 'high', 8,
      `${n} high-confidence opportunities active`);
  }
  if (n >= 3) {
    return makeSignal('trend_opportunity_building', 'opportunity_momentum', 'up',
      'Opportunity pressure building', 'medium', 7,
      `${n} high-priority opportunities pending action`);
  }
  return null;
}

// ── 6. Workflow Momentum ───────────────────────────────────────────────────────

const WORKFLOW_START_ACTION_TYPES = new Set([
  'workflow_started', 'external_payment_started',
]);

export function detectWorkflowMomentum(ctx: TemporalTrendContext): TemporalTrendSignal | null {
  const { recentStart, prevStart } = windows();

  // Prefer action-based tracking (more granular than startedAt timestamps)
  const recent = ctx.recentActions.filter((a) => a.timestamp >= recentStart && WORKFLOW_START_ACTION_TYPES.has(a.type)).length;
  const prev   = ctx.recentActions.filter((a) => a.timestamp >= prevStart && a.timestamp < recentStart && WORKFLOW_START_ACTION_TYPES.has(a.type)).length;

  const score = computeMomentumScore(recent, prev);
  const dir   = momentumDirection(score);
  const conf  = momentumConfidence(recent, prev);

  if (dir !== 'up' || conf === 'low') return null; // only surface accumulation

  return makeSignal('trend_workflow_accumulating', 'workflow_momentum', 'up',
    'Workflow activity increasing', conf, 7,
    `${recent} workflow action${recent !== 1 ? 's' : ''} recently vs ${prev} earlier`);
}
