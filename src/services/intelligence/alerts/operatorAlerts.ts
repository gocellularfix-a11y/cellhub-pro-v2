// ============================================================
// CellHub Intelligence — Proactive Operator Alerts
// R-INTELLIGENCE-PROACTIVE-OPERATOR-ALERTS
//
// Deterministic operational alert surfacing. Lightweight passive
// awareness layer — "you should know this right now" — derived
// from the existing intelligence compute pipelines:
//   - computeAttentionItemsForToday (whoNeedsAttentionToday)
//   - computeLossSignals            (whatIsLosingMoney)
//   - computeDropSignals            (whyDidSalesDrop)
//   - computeRestockRecommendations (restockOpportunity)
//   - computeTodaySlowCauses        (whyIsTodaySlow)
//
// NO scoring engines duplicated. NO LLM. NO embeddings. NO background
// jobs. NO server. NO autonomous actions. NO push notifications. Pure
// pull-based: consumers call getActiveOperatorAlerts() when they need a
// fresh snapshot. Output is bounded to MAX_ALERTS = 5.
//
// SEPARATION FROM EXISTING AlertEngine:
// AlertEngine (AlertEngine.ts) is a threshold-based engine that scans
// raw Sale / Inventory / Repair / Customer arrays. operatorAlerts is a
// HIGHER-LEVEL view that consumes the already-translated, already-scored
// outputs of the chat compute pipelines and presents them as a compact
// urgency feed. Different shape, different namespace, no overlap.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import {
  computeAttentionItemsForToday,
  type AttentionItem,
} from '../chat/whoNeedsAttentionToday';
import {
  computeLossSignals,
  type LossSignal,
} from '../chat/whatIsLosingMoney';
import {
  computeDropSignals,
  type DropSignal,
} from '../chat/whyDidSalesDrop';
import {
  computeRestockRecommendations,
  type RestockRecommendation,
} from '../chat/restockOpportunity';
import {
  computeTodaySlowCauses,
  type DiagnosisCause,
  type DiagnosisCategory,
} from '../chat/whyIsTodaySlow';
import { tChat, type Lang3 } from '../chat/handlers';

// ── Public types ──────────────────────────────────────────

export type OperatorAlertCategory =
  | 'repair'
  | 'payment'
  | 'inventory'
  | 'customer'
  | 'revenue'
  | 'staff';

export type OperatorAlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface OperatorAlertEntityRef {
  type: 'product' | 'customer' | 'repair';
  value: string;
}

export interface OperatorAlert {
  id: string;
  category: OperatorAlertCategory;
  severity: OperatorAlertSeverity;
  /** Pre-translated short headline (reused from the source compute). */
  title: string;
  /** Pre-translated single-line evidence with numbers. */
  message: string;
  /** Optional entity continuity hook — used by establishesContext consumers. */
  entityRef?: OperatorAlertEntityRef;
  /** Pre-translated label for an optional UI button. */
  actionLabel?: string;
  /** Existing executionTarget literal (e.g., 'open_repair', 'open_customer'). */
  actionType?: string;
  /** Snapshot timestamp (ms epoch). */
  createdAt: number;
  /** Snapshot timestamp + category TTL (informational; consumers may filter). */
  expiresAt?: number;
  /** Internal score for dedupe tie-break and ordering — not for display. */
  score: number;
}

export interface PrecomputedSignals {
  attentionItems?: AttentionItem[];
  lossSignals?: LossSignal[];
  dropSignals?: DropSignal[];
  restockRecs?: RestockRecommendation[];
  slowCauses?: DiagnosisCause[];
}

// ── Tunables (deterministic) ──────────────────────────────

const MAX_ALERTS = 5;

const SEVERITY_RANK: Record<OperatorAlertSeverity, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
};

/**
 * TTL by category — informational only. Derived alerts are re-computed
 * fresh on every getActiveOperatorAlerts() call, so the natural expiry
 * mechanism is "the source signal stopped firing." expiresAt lets a
 * cached snapshot (e.g., a UI feed memoizing the last render) suppress
 * an alert that has aged past its category's relevance window.
 */
const TTL_BY_CATEGORY: Record<OperatorAlertCategory, number> = {
  payment:   4  * 60 * 60 * 1000,  // 4h — carrier portal turnover
  repair:    6  * 60 * 60 * 1000,  // 6h — pickup-day relevance
  inventory: 12 * 60 * 60 * 1000,
  customer:  24 * 60 * 60 * 1000,
  revenue:   24 * 60 * 60 * 1000,
  staff:     12 * 60 * 60 * 1000,
};

/**
 * Reuse existing focus-today action label keys instead of adding a new
 * label per category. Keeps translations.ts churn-free.
 */
const CATEGORY_ACTION_KEY: Record<OperatorAlertCategory, string> = {
  repair:    'chat.focusToday.action.openRepairs',
  payment:   'chat.focusToday.action.openPos',
  inventory: 'chat.focusToday.action.openInventory',
  customer:  'chat.focusToday.action.openCustomers',
  revenue:   'chat.focusToday.action.openReports',
  staff:     'chat.focusToday.action.openReports',
};

const CATEGORY_ACTION_TARGET: Record<OperatorAlertCategory, string> = {
  repair:    'queue_manager_review',
  payment:   'queue_manager_review',
  inventory: 'open_inventory',
  customer:  'queue_manager_review',
  revenue:   'queue_manager_review',
  staff:     'queue_manager_review',
};

// ── Time-of-day ordering boost ────────────────────────────

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'late';

function timeOfDay(nowMs: number): TimeOfDay {
  const h = new Date(nowMs).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'late';
}

/**
 * Time-of-day boost AFFECTS ORDERING ONLY — never severity. Spec is
 * explicit: "no fake urgency". A morning inventory alert and an evening
 * payment alert both keep their underlying severity; the boost only
 * decides which of two same-severity alerts shows first.
 */
const TIME_ORDER_BOOST: Record<TimeOfDay, Partial<Record<OperatorAlertCategory, number>>> = {
  morning:   { inventory: 30, customer: 25, staff: 15 },
  afternoon: { revenue: 30, repair: 20 },
  evening:   { payment: 40, repair: 30 },
  late:      { payment: 50, repair: 20 },
};

// ── Source-signal → OperatorAlert adapters ────────────────

const ATTENTION_TO_CATEGORY: Record<AttentionItem['domain'], OperatorAlertCategory> = {
  repair:           'repair',
  layaway:          'customer',
  special_order:    'customer',
  external_payment: 'payment',
  customer_churn:   'customer',
  store_credit:     'payment',
};

const ATTENTION_TO_ACTION_TARGET: Record<AttentionItem['domain'], string> = {
  repair:           'open_repair',
  layaway:          'open_layaway',
  special_order:    'open_special_order',
  external_payment: 'open_customer',
  customer_churn:   'open_customer',
  store_credit:     'open_customer',
};

function fromAttentionItem(
  a: AttentionItem,
  nowMs: number,
  t: ReturnType<typeof tChat>,
): OperatorAlert {
  const category = ATTENTION_TO_CATEGORY[a.domain];
  // CLASS-ENT: entityId for store_credit/external_payment is cert/payment ID,
  // not a customer ID. No valid EntityRef type exists for those — emit
  // undefined + warn. repair uses its own type; all other domains use customerId.
  let entityRef: OperatorAlertEntityRef | undefined;
  if (a.customerId) {
    entityRef = { type: 'customer', value: a.customerId };
  } else if (a.domain === 'repair') {
    entityRef = { type: 'repair', value: a.entityId };
  } else if (a.domain === 'store_credit' || a.domain === 'external_payment') {
    console.warn('[intelligence] operatorAlerts: missing customerId on cert/payment domain', { domain: a.domain, entityId: a.entityId });
    entityRef = undefined;
  } else {
    entityRef = { type: 'customer', value: a.entityId };
  }
  return {
    id: `attn-${a.id}`,
    category,
    severity: a.urgency,
    title: a.reason,
    message: a.recommendedAction,
    entityRef,
    actionLabel: t(CATEGORY_ACTION_KEY[category]),
    actionType: ATTENTION_TO_ACTION_TARGET[a.domain],
    createdAt: nowMs,
    expiresAt: nowMs + TTL_BY_CATEGORY[category],
    score: a.priorityScore,
  };
}

const LOSS_TO_CATEGORY: Record<LossSignal['category'], OperatorAlertCategory> = {
  dead_stock:             'inventory',
  attachment_low:         'revenue',
  repairs_stalled:        'repair',
  layaway_abandoned:      'revenue',
  ext_payment_risk:       'payment',
  low_margin_items:       'revenue',
  store_credit_liability: 'payment',
};

function lossSeverity(score: number): OperatorAlertSeverity {
  if (score >= 120) return 'high';
  if (score >= 60)  return 'medium';
  return 'low';
}

function fromLossSignal(
  l: LossSignal,
  nowMs: number,
  t: ReturnType<typeof tChat>,
): OperatorAlert {
  const category = LOSS_TO_CATEGORY[l.category];
  return {
    id: `loss-${l.id}`,
    category,
    severity: lossSeverity(l.score),
    title: l.headline,
    message: l.evidence,
    ...(l.entityRef ? { entityRef: { type: l.entityRef.type, value: l.entityRef.value } } : {}),
    actionLabel: t(CATEGORY_ACTION_KEY[category]),
    actionType: CATEGORY_ACTION_TARGET[category],
    createdAt: nowMs,
    expiresAt: nowMs + TTL_BY_CATEGORY[category],
    score: l.score,
  };
}

const DROP_TO_CATEGORY: Record<DropSignal['category'], OperatorAlertCategory> = {
  overall_revenue:         'revenue',
  category_drop:           'revenue',
  customer_disappearance:  'customer',
  accessory_attach_drop:   'revenue',
  activation_decline:      'revenue',
  repair_decline:          'repair',
  employee_decline:        'staff',
  product_movement_decline:'inventory',
};

function fromDropSignal(
  d: DropSignal,
  nowMs: number,
  t: ReturnType<typeof tChat>,
): OperatorAlert {
  const category = DROP_TO_CATEGORY[d.category];
  return {
    id: `drop-${d.id}`,
    category,
    severity: d.severity,
    title: d.headline,
    message: d.evidence,
    ...(d.entityRef ? { entityRef: { type: d.entityRef.type, value: d.entityRef.value } } : {}),
    actionLabel: t(CATEGORY_ACTION_KEY[category]),
    actionType: CATEGORY_ACTION_TARGET[category],
    createdAt: nowMs,
    expiresAt: nowMs + TTL_BY_CATEGORY[category],
    score: d.score,
  };
}

function restockSeverity(r: RestockRecommendation): OperatorAlertSeverity {
  if (r.daysOfCover !== null && r.daysOfCover <= 3) return 'high';
  if (r.daysOfCover !== null && r.daysOfCover <= 7) return 'medium';
  return 'low';
}

function fromRestockRec(
  r: RestockRecommendation,
  nowMs: number,
  t: ReturnType<typeof tChat>,
): OperatorAlert {
  return {
    id: `restock-${r.id}`,
    category: 'inventory',
    severity: restockSeverity(r),
    title: r.reason,
    message: r.recommendedAction,
    entityRef: { type: 'product', value: r.name },
    actionLabel: t(CATEGORY_ACTION_KEY.inventory),
    actionType: 'open_inventory',
    createdAt: nowMs,
    expiresAt: nowMs + TTL_BY_CATEGORY.inventory,
    score: r.score,
  };
}

const SLOW_TO_CATEGORY: Record<DiagnosisCategory, OperatorAlertCategory> = {
  traffic:        'revenue',
  conversion:     'revenue',
  repairs_intake: 'repair',
  repairs_pickup: 'repair',
  phone_payments: 'payment',
  inventory:      'inventory',
  activity:       'staff',
};

function slowSeverity(c: DiagnosisCause): OperatorAlertSeverity {
  let sev: OperatorAlertSeverity = c.score >= 80 ? 'high' : c.score >= 50 ? 'medium' : 'low';
  // Low-confidence signals must not present as high — defensive against
  // early-morning false positives ("activity gap" before opening hour).
  if (c.confidence === 'low' && sev === 'high') sev = 'medium';
  return sev;
}

function fromSlowCause(
  c: DiagnosisCause,
  nowMs: number,
  t: ReturnType<typeof tChat>,
): OperatorAlert {
  const category = SLOW_TO_CATEGORY[c.category];
  return {
    id: `slow-${c.id}`,
    category,
    severity: slowSeverity(c),
    title: c.headline,
    message: c.evidence,
    actionLabel: t(CATEGORY_ACTION_KEY[category]),
    actionType: CATEGORY_ACTION_TARGET[category],
    createdAt: nowMs,
    expiresAt: nowMs + TTL_BY_CATEGORY[category],
    score: c.score,
  };
}

// ── Dedupe / order / cap ──────────────────────────────────

/**
 * Two alerts collapse when they share a (category, entity) pair. When
 * one alert lacks an entityRef, its dedupe key is just the category —
 * multiple aggregate alerts in the same category collapse to one.
 */
function dedupeKey(a: OperatorAlert): string {
  return `${a.category}:${a.entityRef?.value || ''}`;
}

function dedupe(alerts: OperatorAlert[]): OperatorAlert[] {
  const best = new Map<string, OperatorAlert>();
  for (const a of alerts) {
    const k = dedupeKey(a);
    const cur = best.get(k);
    if (!cur) { best.set(k, a); continue; }
    if (SEVERITY_RANK[a.severity] < SEVERITY_RANK[cur.severity]) {
      best.set(k, a);
    } else if (a.severity === cur.severity && a.score > cur.score) {
      best.set(k, a);
    }
  }
  return [...best.values()];
}

function orderAndCap(alerts: OperatorAlert[], tod: TimeOfDay): OperatorAlert[] {
  const tboost = TIME_ORDER_BOOST[tod];
  return [...alerts]
    .sort((x, y) => {
      // 1) Severity (critical first)
      const sevDelta = SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity];
      if (sevDelta !== 0) return sevDelta;
      // 2) Time-of-day ordering boost (higher wins)
      const xb = tboost[x.category] || 0;
      const yb = tboost[y.category] || 0;
      if (xb !== yb) return yb - xb;
      // 3) Raw score (higher wins)
      if (x.score !== y.score) return y.score - x.score;
      // 4) Stable: category alpha, then id alpha
      if (x.category !== y.category) return x.category < y.category ? -1 : 1;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    })
    .slice(0, MAX_ALERTS);
}

// ── Public entry points ───────────────────────────────────

/**
 * Compose a fresh OperatorAlert feed from the existing intelligence
 * compute pipelines. Up to MAX_ALERTS (5) entries, deterministic order.
 *
 * Optional `pre` lets callers that already ran the source computes
 * (focusToday, dailyBrief) hand them in to avoid duplicate scans.
 */
export function getActiveOperatorAlerts(
  engine: IntelligenceEngine,
  lang: Lang3,
  nowMs: number = Date.now(),
  pre: PrecomputedSignals = {},
): OperatorAlert[] {
  const t = tChat(lang);
  const tod = timeOfDay(nowMs);

  const attentionItems = pre.attentionItems ?? computeAttentionItemsForToday(engine, lang);
  const lossSignals    = pre.lossSignals    ?? computeLossSignals(engine, lang);
  const dropSignals    = pre.dropSignals    ?? computeDropSignals(engine, lang);
  const restockRecs    = pre.restockRecs    ?? computeRestockRecommendations(engine, lang);
  const slowCauses     = pre.slowCauses     ?? computeTodaySlowCauses(engine, lang);

  const raw: OperatorAlert[] = [];
  for (const a of attentionItems) raw.push(fromAttentionItem(a, nowMs, t));
  for (const l of lossSignals)    raw.push(fromLossSignal(l, nowMs, t));
  for (const d of dropSignals)    raw.push(fromDropSignal(d, nowMs, t));
  for (const r of restockRecs)    raw.push(fromRestockRec(r, nowMs, t));
  for (const c of slowCauses)     raw.push(fromSlowCause(c, nowMs, t));

  return orderAndCap(dedupe(raw), tod);
}

/**
 * Same feed, filtered to severity >= 'high'. Use for compact "you should
 * know this right now" surfacing (daily brief urgent strip, focus today
 * alert mini-bar). Returns at most 2 alerts unless an explicit cap is
 * passed.
 */
export function getUrgentOperatorAlerts(
  engine: IntelligenceEngine,
  lang: Lang3,
  nowMs: number = Date.now(),
  pre: PrecomputedSignals = {},
  max: number = 2,
): OperatorAlert[] {
  return getActiveOperatorAlerts(engine, lang, nowMs, pre)
    .filter((a) => a.severity === 'critical' || a.severity === 'high')
    .slice(0, max);
}

/**
 * Severity → emoji prefix used by lightweight surfacers (daily brief,
 * focus today). Mirrors the canonical URGENCY_BADGE used elsewhere so
 * the visual language stays consistent across handlers.
 */
export const ALERT_SEVERITY_BADGE: Record<OperatorAlertSeverity, string> = {
  critical: '🚨',
  high:     '⚠️',
  medium:   '📌',
  low:      'ℹ️',
};
