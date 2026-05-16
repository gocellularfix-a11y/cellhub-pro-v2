// ============================================================
// CellHub Intelligence — Longitudinal Business Memory
// R-INTELLIGENCE-BUSINESS-MEMORY-V1
//
// Deterministic observational pattern memory. Accumulates
// lightweight operational event buckets over time and surfaces
// reliable tendencies when confidence crosses threshold.
//
// Rules: no ML, no AI, no predictions, no charts, no server.
// Confidence = observation frequency. Max 3 surfaced insights.
// Min 3 observations + min 60 confidence to surface.
// ============================================================

import type { StoreStateType } from '../storeState/storeStateEngine';
import type { OperatorTaskType } from '../operatorQueue/operatorQueue';

// ── Types ─────────────────────────────────────────────────

export type MemoryCategory =
  | 'sales_rhythm'
  | 'repairs'
  | 'customer_outreach'
  | 'collections'
  | 'operational';

export type MemoryTimeframe = '7d' | '30d' | '90d';

export interface BusinessMemoryInsight {
  category: MemoryCategory;
  confidence: number;    // 0–100
  insight: string;       // short factual observation
  supportingSignal: string; // e.g. "Observed across 4 Mondays"
  timeframe: MemoryTimeframe;
}

// ── Persisted event bucket ─────────────────────────────────
// Each bucket is a lightweight aggregation, NOT raw events.

export interface StoreStateEvent {
  state: StoreStateType;
  dayOfWeek: number;     // 0=Sun … 6=Sat
  hourBucket: number;    // 0–23
  ts: number;
}

export interface TaskOutcomeEvent {
  type: OperatorTaskType;
  status: 'completed' | 'dismissed';
  dayOfWeek: number;
  hourBucket: number;
  ts: number;
}

export interface BusinessMemoryStore {
  storeStateEvents: StoreStateEvent[];
  taskOutcomeEvents: TaskOutcomeEvent[];
  version: 1;
}

const STORAGE_KEY = 'cellhub:intelligence:businessMemory:v1';
const MAX_EVENTS = 200;          // total cap to keep localStorage lean
const MAX_AGE_MS = 90 * 86_400_000; // 90 days

// ── Persistence ────────────────────────────────────────────

function read(): BusinessMemoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { storeStateEvents: [], taskOutcomeEvents: [], version: 1 };
    return JSON.parse(raw) as BusinessMemoryStore;
  } catch { return { storeStateEvents: [], taskOutcomeEvents: [], version: 1 }; }
}

function write(store: BusinessMemoryStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

function purgeOld(store: BusinessMemoryStore, now: number): BusinessMemoryStore {
  const cutoff = now - MAX_AGE_MS;
  const storeStateEvents = store.storeStateEvents
    .filter((e) => e.ts >= cutoff)
    .slice(-MAX_EVENTS);
  const taskOutcomeEvents = store.taskOutcomeEvents
    .filter((e) => e.ts >= cutoff)
    .slice(-MAX_EVENTS);
  return { ...store, storeStateEvents, taskOutcomeEvents };
}

// Expose raw store for week-over-week analysis in weeklyOperatorReview.
export function readBusinessMemoryStore(): BusinessMemoryStore {
  return read();
}

// ── Event recording ────────────────────────────────────────

export function recordStoreStateEvent(state: StoreStateType, now = Date.now()): void {
  const d = new Date(now);
  const store = purgeOld(read(), now);
  // Dedupe: skip if same state was recorded in the last 30 minutes
  const last = store.storeStateEvents[store.storeStateEvents.length - 1];
  if (last && last.state === state && now - last.ts < 30 * 60_000) return;
  store.storeStateEvents.push({
    state,
    dayOfWeek: d.getDay(),
    hourBucket: d.getHours(),
    ts: now,
  });
  write(store);
}

export function recordTaskOutcomeEvent(
  type: OperatorTaskType,
  status: 'completed' | 'dismissed',
  now = Date.now(),
): void {
  const d = new Date(now);
  const store = purgeOld(read(), now);
  store.taskOutcomeEvents.push({
    type, status,
    dayOfWeek: d.getDay(),
    hourBucket: d.getHours(),
    ts: now,
  });
  write(store);
}

// ── Analysis helpers ───────────────────────────────────────

const MIN_OBSERVATIONS = 3;
const MIN_CONFIDENCE   = 60;
const MAX_INSIGHTS     = 3;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const FULL_DAY  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function withinAge(ts: number, days: number, now: number) {
  return ts >= now - days * 86_400_000;
}

function confidenceFromCount(count: number, max: number): number {
  // confidence grows with sample frequency relative to expected max
  return Math.min(100, Math.round((count / Math.max(max, 1)) * 100));
}

// Most common day for a given state within the timeframe.
function dominantDayForState(
  events: StoreStateEvent[],
  state: StoreStateType,
  days: number,
  now: number,
): { day: number; count: number; totalWeeks: number } | null {
  const filtered = events.filter((e) => e.state === state && withinAge(e.ts, days, now));
  if (filtered.length < MIN_OBSERVATIONS) return null;
  const dayCounts = new Array<number>(7).fill(0);
  filtered.forEach((e) => dayCounts[e.dayOfWeek]++);
  const maxCount = Math.max(...dayCounts);
  const day = dayCounts.indexOf(maxCount);
  const totalWeeks = Math.round(days / 7);
  return { day, count: maxCount, totalWeeks };
}

// Most common hour bucket for a given state.
function dominantHourForState(
  events: StoreStateEvent[],
  state: StoreStateType,
  days: number,
  now: number,
): { hour: number; count: number } | null {
  const filtered = events.filter((e) => e.state === state && withinAge(e.ts, days, now));
  if (filtered.length < MIN_OBSERVATIONS) return null;
  const hourCounts = new Array<number>(24).fill(0);
  filtered.forEach((e) => hourCounts[e.hourBucket]++);
  const maxCount = Math.max(...hourCounts);
  const hour = hourCounts.indexOf(maxCount);
  return { hour, count: maxCount };
}

// Completion rate for a task type in a given hour range.
function taskCompletionRateByHour(
  events: TaskOutcomeEvent[],
  type: OperatorTaskType,
  hourMin: number,
  hourMax: number,
  days: number,
  now: number,
): { rate: number; count: number } {
  const filtered = events.filter(
    (e) => e.type === type && withinAge(e.ts, days, now)
      && e.hourBucket >= hourMin && e.hourBucket <= hourMax,
  );
  const completed = filtered.filter((e) => e.status === 'completed').length;
  return { rate: filtered.length > 0 ? completed / filtered.length : 0, count: filtered.length };
}

function taskCompletionRateByDay(
  events: TaskOutcomeEvent[],
  type: OperatorTaskType,
  days: number,
  now: number,
): { bestDay: number; rate: number; count: number } | null {
  const filtered = events.filter((e) => e.type === type && withinAge(e.ts, days, now));
  if (filtered.length < MIN_OBSERVATIONS) return null;
  const dayCounts = new Array<number>(7).fill(0);
  const dayCompleted = new Array<number>(7).fill(0);
  filtered.forEach((e) => {
    dayCounts[e.dayOfWeek]++;
    if (e.status === 'completed') dayCompleted[e.dayOfWeek]++;
  });
  // Find the day with the best completion rate (minimum 2 samples)
  let bestDay = -1, bestRate = 0;
  for (let d = 0; d < 7; d++) {
    if (dayCounts[d] < 2) continue;
    const r = dayCompleted[d] / dayCounts[d];
    if (r > bestRate) { bestRate = r; bestDay = d; }
  }
  if (bestDay < 0) return null;
  return { bestDay, rate: bestRate, count: dayCounts[bestDay] };
}

// ── Builders: one per memory category ─────────────────────

function buildSalesRhythm(
  events: StoreStateEvent[],
  now: number,
): BusinessMemoryInsight | null {
  // Slow day pattern — does it cluster on a specific day?
  const slow30 = dominantDayForState(events, 'slow_day', 30, now);
  if (slow30 && slow30.count >= MIN_OBSERVATIONS) {
    const dayName = FULL_DAY[slow30.day];
    const conf = Math.min(95, confidenceFromCount(slow30.count, slow30.totalWeeks));
    if (conf >= MIN_CONFIDENCE) {
      return {
        category: 'sales_rhythm',
        confidence: conf,
        insight: `${dayName}s tend to be slow`,
        supportingSignal: `Observed ${slow30.count}× in 30d`,
        timeframe: '30d',
      };
    }
  }

  // Rush clusters at a specific hour?
  const rushHour = dominantHourForState(events, 'rush_mode', 30, now);
  if (rushHour && rushHour.count >= MIN_OBSERVATIONS) {
    const conf = Math.min(90, confidenceFromCount(rushHour.count, 30));
    if (conf >= MIN_CONFIDENCE) {
      const h = rushHour.hour;
      const label = h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
      return {
        category: 'sales_rhythm',
        confidence: conf,
        insight: `Rush mode commonly starts around ${label}`,
        supportingSignal: `Observed ${rushHour.count}× in 30d`,
        timeframe: '30d',
      };
    }
  }

  return null;
}

function buildRepairs(
  events: StoreStateEvent[],
  now: number,
): BusinessMemoryInsight | null {
  const overload30 = dominantDayForState(events, 'repair_overload', 30, now);
  if (overload30 && overload30.count >= MIN_OBSERVATIONS) {
    const dayName = FULL_DAY[overload30.day];
    const conf = Math.min(90, confidenceFromCount(overload30.count, overload30.totalWeeks));
    if (conf >= MIN_CONFIDENCE) {
      return {
        category: 'repairs',
        confidence: conf,
        insight: `Repair overload commonly appears on ${dayName}s`,
        supportingSignal: `Observed ${overload30.count}× in 30d`,
        timeframe: '30d',
      };
    }
  }
  return null;
}

function buildCustomerOutreach(
  taskEvents: TaskOutcomeEvent[],
  now: number,
): BusinessMemoryInsight | null {
  // VIP outreach — does it complete better in the afternoon (12–17)?
  const vipAft = taskCompletionRateByHour(taskEvents, 'vip_outreach', 12, 17, 30, now);
  const vipMor = taskCompletionRateByHour(taskEvents, 'vip_outreach', 8, 11, 30, now);
  if (vipAft.count >= MIN_OBSERVATIONS && vipAft.rate > vipMor.rate + 0.15) {
    const conf = Math.min(90, Math.round(vipAft.rate * 100));
    if (conf >= MIN_CONFIDENCE) {
      return {
        category: 'customer_outreach',
        confidence: conf,
        insight: 'VIP outreach completion improves afternoons',
        supportingSignal: `${Math.round(vipAft.rate * 100)}% completion rate`,
        timeframe: '30d',
      };
    }
  }

  // Recovery outreach — best day?
  const recov = taskCompletionRateByDay(taskEvents, 'recover_customer', 30, now);
  if (recov && recov.count >= MIN_OBSERVATIONS && recov.rate >= 0.6) {
    const conf = Math.min(88, Math.round(recov.rate * 100));
    if (conf >= MIN_CONFIDENCE) {
      return {
        category: 'customer_outreach',
        confidence: conf,
        insight: `Recovery outreach completes best on ${FULL_DAY[recov.bestDay]}s`,
        supportingSignal: `${Math.round(recov.rate * 100)}% completion rate`,
        timeframe: '30d',
      };
    }
  }

  return null;
}

function buildCollections(
  events: StoreStateEvent[],
  taskEvents: TaskOutcomeEvent[],
  now: number,
): BusinessMemoryInsight | null {
  // Collection mode — strongest day of week?
  const coll30 = dominantDayForState(events, 'collection_mode', 30, now);
  if (coll30 && coll30.count >= MIN_OBSERVATIONS) {
    const dayName = FULL_DAY[coll30.day];
    const conf = Math.min(88, confidenceFromCount(coll30.count, coll30.totalWeeks));
    if (conf >= MIN_CONFIDENCE) {
      return {
        category: 'collections',
        confidence: conf,
        insight: `Collection pressure commonly peaks on ${dayName}s`,
        supportingSignal: `Observed ${coll30.count}× in 30d`,
        timeframe: '30d',
      };
    }
  }

  // Does repair follow-up correlate with collection mode? (proxy: early-week pattern)
  const followUp = taskCompletionRateByDay(taskEvents, 'repair_follow_up', 30, now);
  if (followUp && followUp.count >= MIN_OBSERVATIONS && followUp.rate >= 0.65
    && (followUp.bestDay >= 1 && followUp.bestDay <= 3)) {  // Mon–Wed
    const conf = Math.min(85, Math.round(followUp.rate * 100));
    if (conf >= MIN_CONFIDENCE) {
      return {
        category: 'collections',
        confidence: conf,
        insight: 'Payment follow-ups complete best early in the week',
        supportingSignal: `${Math.round(followUp.rate * 100)}% on ${DAY_NAMES[followUp.bestDay]}`,
        timeframe: '30d',
      };
    }
  }

  return null;
}

function buildOperational(
  events: StoreStateEvent[],
  now: number,
): BusinessMemoryInsight | null {
  // Does rush_mode frequently coincide with opportunity_window suppression?
  // Proxy: rush events on days that also have few opportunity_window events.
  const rushCount30 = events.filter(
    (e) => e.state === 'rush_mode' && withinAge(e.ts, 30, now),
  ).length;
  const opCount30 = events.filter(
    (e) => e.state === 'opportunity_window' && withinAge(e.ts, 30, now),
  ).length;

  if (rushCount30 >= MIN_OBSERVATIONS && opCount30 < rushCount30 * 0.4) {
    const conf = Math.min(85, confidenceFromCount(rushCount30, 30));
    if (conf >= MIN_CONFIDENCE) {
      return {
        category: 'operational',
        confidence: conf,
        insight: 'Rush mode frequently suppresses outreach opportunities',
        supportingSignal: `${rushCount30} rush events vs ${opCount30} outreach windows`,
        timeframe: '30d',
      };
    }
  }

  return null;
}

// ── Main export ────────────────────────────────────────────

export interface BusinessMemoryResult {
  generatedAt: number;
  insights: BusinessMemoryInsight[];
}

export function generateBusinessMemory(now = Date.now()): BusinessMemoryResult {
  const store = purgeOld(read(), now);
  const { storeStateEvents, taskOutcomeEvents } = store;

  const candidates: BusinessMemoryInsight[] = [];

  const sr = buildSalesRhythm(storeStateEvents, now);
  if (sr) candidates.push(sr);

  const rep = buildRepairs(storeStateEvents, now);
  if (rep) candidates.push(rep);

  const cust = buildCustomerOutreach(taskOutcomeEvents, now);
  if (cust) candidates.push(cust);

  const coll = buildCollections(storeStateEvents, taskOutcomeEvents, now);
  if (coll) candidates.push(coll);

  const ops = buildOperational(storeStateEvents, now);
  if (ops) candidates.push(ops);

  // Sort by confidence descending, take top MAX_INSIGHTS.
  const insights = candidates
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_INSIGHTS);

  return { generatedAt: now, insights };
}
