// CellHub Intelligence — Store Rhythm Signal Detectors
// Each detector is a pure function returning RhythmSignal | null.
// Conservative confidence — never pretend certainty.

import type { RhythmSignal, StoreRhythmContext, StoreRhythmSignalKind, RhythmConfidence } from './storeRhythmTypes';
import { toMs } from '@/services/intelligence/customerScoring/customerOpportunitySignals';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

const TERMINAL_STATUSES = new Set(['picked_up', 'cancelled', 'refunded', 'refund_pending']);
const READY_STATUSES    = new Set(['completed', 'ready', 'ready_for_pickup']);

function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function makeSignal(
  id: string,
  kind: StoreRhythmSignalKind,
  title: string,
  confidence: RhythmConfidence,
  priority: number,
  detail?: string,
): RhythmSignal {
  return { id, kind, title, detail, confidence, priority, computedAt: Date.now() };
}

// ── 1. Slow day ────────────────────────────────────────────────────────────────

export function detectSlowDay(ctx: StoreRhythmContext): RhythmSignal | null {
  const hour = ctx.currentHour ?? new Date().getHours();
  if (hour < 11) return null; // too early to call slow

  const today = todayStartMs();
  const todaySales = ctx.sales.filter((s) => toMs(s.createdAt) >= today);
  const count = todaySales.length;

  if (hour >= 13 && count < 3) {
    const conf: RhythmConfidence = ctx.sales.length >= 20 ? 'medium' : 'low';
    return makeSignal('rhythm_slow_day', 'slow_day', 'Slow day detected', conf, 7,
      `${count} sale${count !== 1 ? 's' : ''} so far today`);
  }
  if (hour >= 15 && count < 5) {
    return makeSignal('rhythm_slow_day', 'slow_day', 'Below-pace day', 'low', 5,
      `${count} sales — below expected afternoon pace`);
  }
  return null;
}

// ── 2. Rush ────────────────────────────────────────────────────────────────────

export function detectRush(ctx: StoreRhythmContext): RhythmSignal | null {
  const now = Date.now();
  const window15 = now - 15 * MIN_MS;
  const recentCount = ctx.recentActions.filter((a) => a.timestamp >= window15).length;

  const activeRepairs = ctx.repairs.filter((r) => {
    const s = String(r.status || '').toLowerCase().trim();
    return !TERMINAL_STATUSES.has(s) && !READY_STATUSES.has(s);
  }).length;

  if (recentCount >= 10) {
    return makeSignal('rhythm_rush', 'rush', 'High activity — rush mode', 'high', 10,
      `${recentCount} actions in the last 15 min`);
  }
  if (recentCount >= 5 && (activeRepairs >= 6 || ctx.pendingWorkflows.length >= 2)) {
    return makeSignal('rhythm_rush', 'rush', 'Elevated activity', 'medium', 8,
      `${recentCount} recent actions, ${activeRepairs} active repairs`);
  }
  return null;
}

// ── 3. Repair overload ─────────────────────────────────────────────────────────

export function detectRepairOverload(ctx: StoreRhythmContext): RhythmSignal | null {
  const now = Date.now();
  const delayCutoff = now - 7 * DAY_MS;

  let activeCount = 0;
  let delayedCount = 0;
  let readyCount = 0;

  for (const r of ctx.repairs) {
    const s = String(r.status || '').toLowerCase().trim();
    if (TERMINAL_STATUSES.has(s)) continue;
    if (READY_STATUSES.has(s)) { readyCount++; continue; }
    activeCount++;
    const ts = toMs(r.createdAt);
    if (ts > 0 && ts < delayCutoff) delayedCount++;
  }

  if (delayedCount >= 4 || activeCount >= 12) {
    return makeSignal('rhythm_repair_overload', 'repair_overload',
      'Repair overload detected', 'high', 9,
      `${delayedCount} delayed · ${activeCount} active · ${readyCount} ready`);
  }
  if (delayedCount >= 2 || (activeCount >= 7 && readyCount >= 3)) {
    return makeSignal('rhythm_repair_overload', 'repair_overload',
      'Repair queue building up', 'medium', 7,
      `${delayedCount} delayed · ${readyCount} awaiting pickup`);
  }
  return null;
}

// ── 4. Collection mode ─────────────────────────────────────────────────────────

export function detectCollectionMode(ctx: StoreRhythmContext): RhythmSignal | null {
  let totalBalanceCents = 0;
  let balanceCount = 0;

  for (const r of ctx.repairs) {
    const s = String(r.status || '').toLowerCase().trim();
    if (TERMINAL_STATUSES.has(s)) continue;
    const bal = typeof r.balance === 'number' ? r.balance : 0;
    if (bal > 0) { totalBalanceCents += bal; balanceCount++; }
  }
  for (const l of ctx.layaways) {
    const s = String(l.status || '').toLowerCase();
    if (s === 'completed' || s === 'cancelled') continue;
    const bal = typeof l.balance === 'number' ? l.balance : 0;
    if (bal > 0) { totalBalanceCents += bal; balanceCount++; }
  }
  for (const w of ctx.pendingWorkflows) {
    const amt = (w.metadata as Record<string, unknown>)?.amountCents;
    if (typeof amt === 'number' && amt > 0) { totalBalanceCents += amt; balanceCount++; }
  }

  const dollars = (totalBalanceCents / 100).toFixed(0);

  if (totalBalanceCents >= 20_000 || balanceCount >= 5) {
    return makeSignal('rhythm_collection_mode', 'collection_mode',
      'Collection mode — unpaid balances', 'high', 9,
      `$${dollars} owed across ${balanceCount} account${balanceCount !== 1 ? 's' : ''}`);
  }
  if (totalBalanceCents >= 5_000 || balanceCount >= 3) {
    return makeSignal('rhythm_collection_mode', 'collection_mode',
      'Unpaid balances need attention', 'medium', 7,
      `$${dollars} outstanding`);
  }
  return null;
}

// ── 5. Opportunity window ──────────────────────────────────────────────────────

export function detectOpportunityWindow(ctx: StoreRhythmContext): RhythmSignal | null {
  if (ctx.revenueOpportunities.length < 3) return null;

  const now = Date.now();
  const window30 = now - 30 * MIN_MS;
  const recentCount = ctx.recentActions.filter((a) => a.timestamp >= window30).length;

  const today = todayStartMs();
  const todaySalesCount = ctx.sales.filter((s) => toMs(s.createdAt) >= today).length;

  if (recentCount <= 3 && todaySalesCount < 8) {
    const n = ctx.revenueOpportunities.length;
    return makeSignal('rhythm_opportunity_window', 'opportunity_window',
      'Opportunity window — good time to follow up', 'medium', 8,
      `${n} opportunit${n !== 1 ? 'ies' : 'y'} · store activity low`);
  }
  return null;
}

// ── 6. Low activity ────────────────────────────────────────────────────────────

export function detectLowActivity(ctx: StoreRhythmContext): RhythmSignal | null {
  const hour = ctx.currentHour ?? new Date().getHours();
  if (hour < 9) return null; // before store opens

  const now = Date.now();
  const window45 = now - 45 * MIN_MS;
  const recentCount = ctx.recentActions.filter((a) => a.timestamp >= window45).length;

  const today = todayStartMs();
  const todaySalesCount = ctx.sales.filter((s) => toMs(s.createdAt) >= today).length;

  if (recentCount === 0 && todaySalesCount === 0 && hour >= 11) {
    return makeSignal('rhythm_low_activity', 'low_activity',
      'Low activity — no sales or actions today', 'high', 8,
      'Consider reaching out to customers');
  }
  if (recentCount === 0 && ctx.recentActions.length > 0) {
    return makeSignal('rhythm_low_activity', 'low_activity',
      'Store quiet — no recent activity', 'medium', 5,
      'No actions in the last 45 minutes');
  }
  return null;
}
