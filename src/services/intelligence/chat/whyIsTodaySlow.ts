// ============================================================
// CellHub Intelligence — Why Is Today Slow
// R-INTELLIGENCE-WHY-IS-TODAY-SLOW
//
// Deterministic operational diagnosis. NOT analytics, NOT a dashboard —
// returns the top 1–3 most likely OPERATIONAL causes of today's slow
// pace, each with a one-line evidence string drawn from real store data
// (sales, repairs, layaways, inventory, payment verifications).
//
// Architecture is strictly additive: reads from engine getters + existing
// payment-verification + localStorage ledger. No new state, no LLM, no
// embeddings. Same inputs → same diagnosis.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Sale, Repair, Layaway, InventoryItem } from '@/store/types';
import { getDueVerification } from '../paymentVerification/paymentVerificationService';
import { tChat, type Lang3, type ChatResponse, type ChatActionUI, COP } from './handlers';

// ── Types ─────────────────────────────────────────────────

export type DiagnosisCategory =
  | 'traffic'
  | 'conversion'
  | 'repairs_intake'
  | 'repairs_pickup'
  | 'phone_payments'
  | 'inventory'
  | 'activity';

export type DiagnosisConfidence = 'high' | 'medium' | 'low';

export interface DiagnosisCause {
  id: string;
  category: DiagnosisCategory;
  headline: string;       // pre-translated
  evidence: string;       // pre-translated, single line with numbers
  recommendedAction: string; // pre-translated
  confidence: DiagnosisConfidence;
  score: number;
  actions: ChatActionUI[];
}

// ── Tunable thresholds (all deterministic) ────────────────

const BASELINE_DAYS                   = 7;       // rolling window for baselines
const TRAFFIC_CRITICAL_RATIO          = 0.5;     // today / baseline
const TRAFFIC_DEGRADED_RATIO          = 0.75;
const REPAIR_PICKUP_STALE_DAYS        = 5;
const ACTIVITY_GAP_MIN_MINUTES        = 90;
const ACTIVITY_GAP_BUSINESS_HOUR_MIN  = 10;
const ACTIVITY_GAP_BUSINESS_HOUR_MAX  = 19;
const EARLY_DAY_HOUR_THRESHOLD        = 11;      // <11am → mark signals low confidence
const DEAD_STOCK_QTY_THRESHOLD        = 10;
const DEAD_STOCK_DAYS_NO_SALE         = 60;
const ABANDONED_LAYAWAY_LOOKBACK_DAYS = 7;
const ABANDONED_LAYAWAY_MIN_COUNT     = 2;
const ACCESSORY_ATTACH_FLOOR_RATIO    = 0.3;
const PHONE_PAYMENT_TRAFFIC_FLOOR     = 0.5;
const MAX_CAUSES                      = 3;
const MIN_SCORE_THRESHOLD             = 20;

// ── Helpers ───────────────────────────────────────────────

function tsOf(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'string') { const n = new Date(v).getTime(); return Number.isFinite(n) ? n : 0; }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && v !== null) {
    const obj = v as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') { try { return obj.toDate().getTime(); } catch { return 0; } }
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return 0;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isSameLocalDay(aMs: number, bMs: number): boolean {
  if (!aMs || !bMs) return false;
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function statusKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '_');
}

function isAccessory(category: unknown): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'accessory' || c === 'accessories';
}

function isPhone(category: unknown): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'phone' || c === 'phones';
}

// ── Aggregated metrics (memoization-friendly) ─────────────

interface DailyMetric {
  transactions: number;
  uniqueCustomerIds: Set<string>;
  phonePaymentItems: number;
  accessoryItems: number;
  phoneItems: number;
  repairsCreated: number;
}

function emptyMetric(): DailyMetric {
  return {
    transactions: 0,
    uniqueCustomerIds: new Set<string>(),
    phonePaymentItems: 0,
    accessoryItems: 0,
    phoneItems: 0,
    repairsCreated: 0,
  };
}

/**
 * Per-day metrics over the last (BASELINE_DAYS + 1) local days. The newest
 * key is today (yyyy-mm-dd). All counts are deterministic; iteration order
 * is fixed by ascending day key.
 */
function buildDailyMetrics(
  sales: Sale[],
  repairs: Repair[],
  nowMs: number,
): Map<string, DailyMetric> {
  const out = new Map<string, DailyMetric>();
  const todayStart = startOfLocalDay(nowMs);
  const earliest = todayStart - BASELINE_DAYS * 86400000;
  for (let i = 0; i <= BASELINE_DAYS; i++) {
    const dayStart = earliest + i * 86400000;
    out.set(localDayKey(dayStart), emptyMetric());
  }

  for (const s of sales || []) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (!ms || ms < earliest) continue;
    const key = localDayKey(ms);
    const bucket = out.get(key);
    if (!bucket) continue;
    bucket.transactions++;
    if (s.customerId) bucket.uniqueCustomerIds.add(s.customerId);
    for (const i of (s.items || [])) {
      if (i.category === 'phone_payment') bucket.phonePaymentItems += (i.qty || 1);
      if (isAccessory(i.category))        bucket.accessoryItems    += (i.qty || 1);
      if (isPhone(i.category))            bucket.phoneItems        += (i.qty || 1);
    }
  }

  for (const r of repairs || []) {
    const ms = tsOf(r.createdAt);
    if (!ms || ms < earliest) continue;
    const key = localDayKey(ms);
    const bucket = out.get(key);
    if (!bucket) continue;
    bucket.repairsCreated++;
  }

  return out;
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

interface Baseline {
  avgTransactions: number;
  avgUniqueCustomers: number;
  avgPhonePaymentItems: number;
  avgAccessoryItems: number;
  avgRepairsCreated: number;
  totalDaysSampled: number;
}

function computeBaseline(daily: Map<string, DailyMetric>, todayKey: string): Baseline {
  let txn = 0, cust = 0, phonePay = 0, acc = 0, rep = 0;
  let n = 0;
  for (const [k, m] of daily.entries()) {
    if (k === todayKey) continue;
    txn += m.transactions;
    cust += m.uniqueCustomerIds.size;
    phonePay += m.phonePaymentItems;
    acc += m.accessoryItems;
    rep += m.repairsCreated;
    n++;
  }
  if (n === 0) {
    return { avgTransactions: 0, avgUniqueCustomers: 0, avgPhonePaymentItems: 0,
             avgAccessoryItems: 0, avgRepairsCreated: 0, totalDaysSampled: 0 };
  }
  return {
    avgTransactions:      txn / n,
    avgUniqueCustomers:   cust / n,
    avgPhonePaymentItems: phonePay / n,
    avgAccessoryItems:    acc / n,
    avgRepairsCreated:    rep / n,
    totalDaysSampled:     n,
  };
}

// ── Signal collectors ────────────────────────────────────

function collectTrafficCause(
  today: DailyMetric,
  baseline: Baseline,
  t: ReturnType<typeof tChat>,
  earlyDay: boolean,
): DiagnosisCause | null {
  if (baseline.totalDaysSampled < 2) return null;
  if (baseline.avgTransactions < 0.5) return null;
  const ratio = today.transactions / baseline.avgTransactions;
  if (ratio >= 1.0) return null;
  let score = 0;
  let confidence: DiagnosisConfidence = 'low';
  if (ratio <= TRAFFIC_CRITICAL_RATIO) { score = 120; confidence = 'high'; }
  else if (ratio <= TRAFFIC_DEGRADED_RATIO) { score = 60; confidence = 'medium'; }
  else { score = 20; confidence = 'low'; }
  if (earlyDay) confidence = downgradeConfidence(confidence);
  const dropPct = Math.round((1 - ratio) * 100);
  return {
    id: 'cause-traffic',
    category: 'traffic',
    headline: t('chat.whyIsTodaySlow.headline.traffic'),
    evidence: t('chat.whyIsTodaySlow.evidence.traffic', today.transactions, baseline.avgTransactions.toFixed(1), dropPct),
    recommendedAction: t('chat.whyIsTodaySlow.action.traffic'),
    confidence,
    score,
    actions: [],
  };
}

function collectRepairsPickupCause(
  repairs: Repair[],
  t: ReturnType<typeof tChat>,
  nowMs: number,
): DiagnosisCause | null {
  let staleCount = 0;
  const staleRepairs: Repair[] = [];
  for (const r of repairs || []) {
    const status = statusKey(r.status);
    if (status !== 'ready' && status !== 'completed' && status !== 'complete') continue;
    const readyAtMs = tsOf((r as any).completedAt) || tsOf(r.updatedAt) || tsOf(r.createdAt);
    if (!readyAtMs) continue;
    const days = Math.floor((nowMs - readyAtMs) / 86400000);
    if (days >= REPAIR_PICKUP_STALE_DAYS) {
      staleCount++;
      staleRepairs.push(r);
    }
  }
  if (staleCount === 0) return null;
  return {
    id: 'cause-repairs-pickup',
    category: 'repairs_pickup',
    headline: t('chat.whyIsTodaySlow.headline.repairsPickup'),
    evidence: t('chat.whyIsTodaySlow.evidence.repairsPickup', staleCount),
    recommendedAction: t('chat.whyIsTodaySlow.action.repairsPickup'),
    confidence: staleCount >= 3 ? 'high' : 'medium',
    score: 70 + Math.min(50, staleCount * 10),
    actions: [],
  };
}

function collectRepairsIntakeCause(
  today: DailyMetric,
  baseline: Baseline,
  t: ReturnType<typeof tChat>,
): DiagnosisCause | null {
  if (baseline.totalDaysSampled < 2) return null;
  if (baseline.avgRepairsCreated < 0.5) return null;
  const ratio = today.repairsCreated / Math.max(0.0001, baseline.avgRepairsCreated);
  if (ratio >= 0.5) return null;
  return {
    id: 'cause-repairs-intake',
    category: 'repairs_intake',
    headline: t('chat.whyIsTodaySlow.headline.repairsIntake'),
    evidence: t('chat.whyIsTodaySlow.evidence.repairsIntake', today.repairsCreated, baseline.avgRepairsCreated.toFixed(1)),
    recommendedAction: t('chat.whyIsTodaySlow.action.repairsIntake'),
    confidence: today.repairsCreated === 0 ? 'medium' : 'low',
    score: 50,
    actions: [],
  };
}

function collectPhonePaymentCause(
  today: DailyMetric,
  baseline: Baseline,
  t: ReturnType<typeof tChat>,
  nowMs: number,
): DiagnosisCause | null {
  const due = getDueVerification(nowMs);
  if (due) {
    const mins = Math.max(0, Math.floor((nowMs - due.remindAt) / 60000));
    return {
      id: 'cause-phone-payment-overdue',
      category: 'phone_payments',
      headline: t('chat.whyIsTodaySlow.headline.phonePaymentOverdue'),
      evidence: t('chat.whyIsTodaySlow.evidence.phonePaymentOverdue', due.carrier || '—', mins, COP(due.amountCents)),
      recommendedAction: t('chat.whyIsTodaySlow.action.phonePaymentOverdue'),
      confidence: mins >= 30 ? 'high' : 'medium',
      score: 50 + Math.min(40, Math.floor(mins / 5)),
      actions: [],
    };
  }
  if (baseline.totalDaysSampled < 2) return null;
  if (baseline.avgPhonePaymentItems < 0.5) return null;
  const ratio = today.phonePaymentItems / baseline.avgPhonePaymentItems;
  if (ratio >= PHONE_PAYMENT_TRAFFIC_FLOOR) return null;
  return {
    id: 'cause-phone-payment-flow',
    category: 'phone_payments',
    headline: t('chat.whyIsTodaySlow.headline.phonePaymentFlow'),
    evidence: t('chat.whyIsTodaySlow.evidence.phonePaymentFlow', today.phonePaymentItems, baseline.avgPhonePaymentItems.toFixed(1)),
    recommendedAction: t('chat.whyIsTodaySlow.action.phonePaymentFlow'),
    confidence: 'medium',
    score: 40,
    actions: [],
  };
}

function collectInventoryCause(
  inventory: InventoryItem[],
  sales: Sale[],
  t: ReturnType<typeof tChat>,
  nowMs: number,
): DiagnosisCause | null {
  const cutoffMs = nowMs - DEAD_STOCK_DAYS_NO_SALE * 86400000;
  const soldRecently = new Set<string>();
  for (const s of sales || []) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (!ms || ms < cutoffMs) continue;
    for (const i of (s.items || [])) {
      if ((i as any).inventoryId) soldRecently.add(String((i as any).inventoryId));
    }
  }
  let deadCount = 0;
  for (const inv of inventory || []) {
    if (!inv.id) continue;
    if ((inv.qty || 0) <= 0) continue;
    if (soldRecently.has(inv.id)) continue;
    deadCount++;
  }
  if (deadCount < DEAD_STOCK_QTY_THRESHOLD) return null;
  return {
    id: 'cause-inventory-dead',
    category: 'inventory',
    headline: t('chat.whyIsTodaySlow.headline.inventoryDead'),
    evidence: t('chat.whyIsTodaySlow.evidence.inventoryDead', deadCount, DEAD_STOCK_DAYS_NO_SALE),
    recommendedAction: t('chat.whyIsTodaySlow.action.inventoryDead'),
    confidence: deadCount >= 25 ? 'high' : 'medium',
    score: 30 + Math.min(30, Math.floor(deadCount / 5)),
    actions: [],
  };
}

function collectAccessoryAttachCause(
  today: DailyMetric,
  t: ReturnType<typeof tChat>,
): DiagnosisCause | null {
  if (today.phoneItems < 1) return null;
  const ratio = today.accessoryItems / today.phoneItems;
  if (ratio >= ACCESSORY_ATTACH_FLOOR_RATIO) return null;
  const pct = Math.round(ratio * 100);
  return {
    id: 'cause-accessory-attach',
    category: 'conversion',
    headline: t('chat.whyIsTodaySlow.headline.accessoryAttach'),
    evidence: t('chat.whyIsTodaySlow.evidence.accessoryAttach', today.accessoryItems, today.phoneItems, pct),
    recommendedAction: t('chat.whyIsTodaySlow.action.accessoryAttach'),
    confidence: 'medium',
    score: 35,
    actions: [],
  };
}

function collectAbandonedLayawayCause(
  layaways: Layaway[],
  t: ReturnType<typeof tChat>,
  nowMs: number,
): DiagnosisCause | null {
  const cutoffMs = nowMs - ABANDONED_LAYAWAY_LOOKBACK_DAYS * 86400000;
  let abandoned = 0;
  for (const l of layaways || []) {
    const status = statusKey(l.status);
    if (status !== 'cancelled' && status !== 'forfeited') continue;
    const ms = tsOf((l as any).cancelledAt) || tsOf(l.updatedAt);
    if (!ms || ms < cutoffMs) continue;
    abandoned++;
  }
  if (abandoned < ABANDONED_LAYAWAY_MIN_COUNT) return null;
  return {
    id: 'cause-conversion-layaway',
    category: 'conversion',
    headline: t('chat.whyIsTodaySlow.headline.layawayAbandon'),
    evidence: t('chat.whyIsTodaySlow.evidence.layawayAbandon', abandoned, ABANDONED_LAYAWAY_LOOKBACK_DAYS),
    recommendedAction: t('chat.whyIsTodaySlow.action.layawayAbandon'),
    confidence: 'medium',
    score: 50,
    actions: [],
  };
}

function collectActivityGapCause(
  sales: Sale[],
  t: ReturnType<typeof tChat>,
  nowMs: number,
): DiagnosisCause | null {
  const hour = new Date(nowMs).getHours();
  if (hour < ACTIVITY_GAP_BUSINESS_HOUR_MIN || hour > ACTIVITY_GAP_BUSINESS_HOUR_MAX) return null;
  let mostRecent = 0;
  for (const s of sales || []) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (ms > mostRecent) mostRecent = ms;
  }
  if (mostRecent === 0) return null;
  const minutesSince = Math.floor((nowMs - mostRecent) / 60000);
  if (minutesSince < ACTIVITY_GAP_MIN_MINUTES) return null;
  return {
    id: 'cause-activity-gap',
    category: 'activity',
    headline: t('chat.whyIsTodaySlow.headline.activityGap'),
    evidence: t('chat.whyIsTodaySlow.evidence.activityGap', minutesSince),
    recommendedAction: t('chat.whyIsTodaySlow.action.activityGap'),
    confidence: minutesSince >= 180 ? 'high' : 'medium',
    score: 25 + Math.min(40, Math.floor(minutesSince / 30) * 5),
    actions: [],
  };
}

function downgradeConfidence(c: DiagnosisConfidence): DiagnosisConfidence {
  if (c === 'high')   return 'medium';
  if (c === 'medium') return 'low';
  return 'low';
}

// ── Action builders ───────────────────────────────────────

function actionsForCause(cause: DiagnosisCause, t: ReturnType<typeof tChat>): ChatActionUI[] {
  const acts: ChatActionUI[] = [];
  const idBase = cause.id;
  switch (cause.category) {
    case 'traffic':
      acts.push({
        id: `${idBase}-outreach`,
        label: t('chat.whyIsTodaySlow.action.openOutreach'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
        triggerQuery: 'who needs attention today',
      });
      break;
    case 'conversion':
      if (cause.id === 'cause-conversion-layaway') {
        acts.push({
          id: `${idBase}-layaways`,
          label: t('chat.whyIsTodaySlow.action.openLayaways'),
          payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
        });
      } else {
        acts.push({
          id: `${idBase}-inventory`,
          label: t('chat.whyIsTodaySlow.action.openInventory'),
          payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
        });
      }
      break;
    case 'repairs_intake':
    case 'repairs_pickup':
      acts.push({
        id: `${idBase}-repairs`,
        label: t('chat.whyIsTodaySlow.action.openRepairs'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'phone_payments':
      acts.push({
        id: `${idBase}-phone-pay`,
        label: t('chat.whyIsTodaySlow.action.openPhonePayments'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'inventory':
      acts.push({
        id: `${idBase}-inventory-dead`,
        label: t('chat.whyIsTodaySlow.action.openDeadStock'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'activity':
      acts.push({
        id: `${idBase}-pos`,
        label: t('chat.whyIsTodaySlow.action.openPos'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
  }
  return acts;
}

const CONFIDENCE_BADGE: Record<DiagnosisConfidence, string> = {
  high:   '🔎',
  medium: '🔍',
  low:    '❓',
};

// ── Public entry point ────────────────────────────────────

/**
 * R-INTELLIGENCE-WHY-IS-TODAY-SLOW
 *
 * Returns up to 3 deterministic operational causes for today's slow pace.
 * No analytics dump — every cause is one headline + one evidence line +
 * one action recommendation, plus executable buttons. Empty state stays
 * calm and honest when no signal is strong enough.
 */
/**
 * R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY: structured-signal export so the
 * focus-today aggregator can consume the same diagnosis pipeline. Returns
 * the filtered + sorted causes; empty array when the early-day or
 * no-baseline guards trip (silent — caller decides what to render).
 */
export function computeTodaySlowCauses(engine: IntelligenceEngine, lang: Lang3): DiagnosisCause[] {
  const t = tChat(lang);
  const nowMs = Date.now();
  const hour = new Date(nowMs).getHours();
  const earlyDay = hour < EARLY_DAY_HOUR_THRESHOLD;

  const sales      = engine.getSales();
  const repairs    = engine.getRepairs();
  const layaways   = engine.getLayaways();
  const inventory  = engine.getInventory();

  const daily      = buildDailyMetrics(sales, repairs, nowMs);
  const todayKey   = localDayKey(nowMs);
  const today      = daily.get(todayKey) || emptyMetric();
  const baseline   = computeBaseline(daily, todayKey);

  if (earlyDay && today.transactions === 0) return [];
  if (baseline.totalDaysSampled === 0) return [];

  const allCauses: DiagnosisCause[] = [];
  const trafficCause          = collectTrafficCause(today, baseline, t, earlyDay);
  if (trafficCause)          allCauses.push(trafficCause);
  const repairsPickupCause    = collectRepairsPickupCause(repairs, t, nowMs);
  if (repairsPickupCause)    allCauses.push(repairsPickupCause);
  const repairsIntakeCause    = collectRepairsIntakeCause(today, baseline, t);
  if (repairsIntakeCause)    allCauses.push(repairsIntakeCause);
  const phonePaymentCause     = collectPhonePaymentCause(today, baseline, t, nowMs);
  if (phonePaymentCause)     allCauses.push(phonePaymentCause);
  const inventoryCause        = collectInventoryCause(inventory, sales, t, nowMs);
  if (inventoryCause)        allCauses.push(inventoryCause);
  const accessoryCause        = collectAccessoryAttachCause(today, t);
  if (accessoryCause)        allCauses.push(accessoryCause);
  const layawayCause          = collectAbandonedLayawayCause(layaways, t, nowMs);
  if (layawayCause)          allCauses.push(layawayCause);
  const activityCause         = collectActivityGapCause(sales, t, nowMs);
  if (activityCause)         allCauses.push(activityCause);

  return allCauses
    .filter((c) => c.score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CAUSES);
}

export function handleWhyIsTodaySlow(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const nowMs = Date.now();
  const hour = new Date(nowMs).getHours();
  const earlyDay = hour < EARLY_DAY_HOUR_THRESHOLD;

  const sales      = engine.getSales();
  const repairs    = engine.getRepairs();

  const daily      = buildDailyMetrics(sales, repairs, nowMs);
  const todayKey   = localDayKey(nowMs);
  const today      = daily.get(todayKey) || emptyMetric();
  const baseline   = computeBaseline(daily, todayKey);

  // Early-day no-data guard: if it's before 11am AND today has zero sales,
  // refuse to fabricate a cause. Honesty over confidence.
  if (earlyDay && today.transactions === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.whyIsTodaySlow.header')}**\n\n${t('chat.whyIsTodaySlow.earlyDay')}`,
    };
  }
  if (baseline.totalDaysSampled === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.whyIsTodaySlow.header')}**\n\n${t('chat.whyIsTodaySlow.noBaseline')}`,
    };
  }

  // Reuse the structured-signal pipeline so we don't duplicate scoring.
  const filtered = computeTodaySlowCauses(engine, lang);

  if (filtered.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.whyIsTodaySlow.header')}**\n\n${t('chat.whyIsTodaySlow.noClearCause')}`,
    };
  }

  for (const c of filtered) {
    c.actions = actionsForCause(c, t);
  }

  const lines: string[] = [`**${t('chat.whyIsTodaySlow.header')}**`, ''];
  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i];
    lines.push(`${i + 1}. ${CONFIDENCE_BADGE[c.confidence]} **${c.headline}**`);
    lines.push(`   📊 ${c.evidence}`);
    lines.push(`   💡 ${c.recommendedAction}`);
  }
  if (earlyDay && filtered.some((c) => c.confidence !== 'low')) {
    lines.push('');
    lines.push(`⏰ ${t('chat.whyIsTodaySlow.earlyDayCaveat')}`);
  }

  const rawActions: ChatActionUI[] = [];
  for (const c of filtered) {
    for (const a of c.actions) rawActions.push(a);
  }

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(rawActions.length > 0 ? { actions: rawActions.slice(0, 6) } : {}),
  };
}
