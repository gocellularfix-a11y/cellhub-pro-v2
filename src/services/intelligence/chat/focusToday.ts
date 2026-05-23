// ============================================================
// CellHub Intelligence — Focus Today
// R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY
//
// Cross-engine prioritization aggregator. Consumes the structured outputs
// of the existing operational engines (no scoring duplication) and merges
// them into one unified Top-5 priority list for the operator. Applies
// time-of-day weighting (morning / afternoon / evening boosts different
// categories) and de-duplicates overlapping signals.
//
// CONSUMED ENGINES (all read-only):
//   - whoNeedsAttentionToday.computeAttentionItemsForToday
//   - whatIsLosingMoney.computeLossSignals
//   - restockOpportunity.computeRestockRecommendations
//   - whyIsTodaySlow.computeTodaySlowCauses
//   - whyDidSalesDrop.computeDropSignals
//
// NO LLM, NO embeddings, NO randomness. Same inputs → same priorities.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import {
  computeAttentionItemsForToday,
  actionsForAttentionItem,
  type AttentionItem,
  type AttentionDomain,
} from './whoNeedsAttentionToday';
import {
  computeLossSignals,
  type LossSignal,
  type LossCategory,
} from './whatIsLosingMoney';
import {
  computeRestockRecommendations,
  type RestockRecommendation,
} from './restockOpportunity';
import {
  computeTodaySlowCauses,
  type DiagnosisCause,
  type DiagnosisCategory,
} from './whyIsTodaySlow';
import {
  computeDropSignals,
  type DropSignal,
  type DropSignalCategory,
} from './whyDidSalesDrop';
import { tChat, type Lang3, type ChatResponse, type ChatActionUI, COP } from './handlers';
import {
  getWorkflowSteps,
  renderWorkflowChainText,
  getWorkflowChatActions,
} from '../workflows/workflowRecommendations';

// ── Public types ──────────────────────────────────────────

/**
 * Unified domain bucket used for de-duplication across engines. Different
 * engines surface overlapping operational signals (e.g., "repair pickup
 * stalled" appears in BOTH whoNeedsAttentionToday and whatIsLosingMoney).
 * Mapping each source to a common bucket lets us pick the highest-scoring
 * variant and drop the rest.
 */
export type FocusDomain =
  | 'repair_pickup'
  | 'repair_intake'
  | 'layaway_stale'
  | 'layaway_abandoned'
  | 'special_order'
  | 'ext_payment'
  | 'customer_churn'
  | 'store_credit_liability'
  | 'dead_stock'
  | 'accessory_attach'
  | 'activation_flow'
  | 'restock_opportunity'
  | 'period_drop_overall'
  | 'period_drop_category'
  | 'period_drop_customer'
  | 'period_drop_employee'
  | 'period_drop_product'
  | 'low_margin_items'
  | 'activity_gap'
  | 'misc';

export type FocusUrgency = 'critical' | 'high' | 'medium' | 'low';

/**
 * R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: optional entity link.
 * Carried forward from the underlying source signal. The handler uses the
 * TOP priority's entityRef (when present) to set establishesContext so
 * follow-ups like "open first one" / "contact him" / "show evidence"
 * route through the existing operational-context pipeline.
 */
export interface FocusEntityRef {
  type: 'customer' | 'repair' | 'product';
  value: string;
}

export interface FocusPriority {
  id: string;
  domain: FocusDomain;
  source: 'attention' | 'loss' | 'restock' | 'slow' | 'drop';
  headline: string;
  evidence: string;
  recommendedAction: string;
  estimatedImpactCents?: number;
  urgency: FocusUrgency;
  /** Raw signal score (pre-time-of-day weight). */
  baseScore: number;
  /** Final score after time-of-day boost. */
  score: number;
  actions: ChatActionUI[];
  /** R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY */
  entityRef?: FocusEntityRef;
}

// ── Time-of-day weights ───────────────────────────────────

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'late';

function timeOfDay(nowMs: number): TimeOfDay {
  const h = new Date(nowMs).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'late';
}

/**
 * Domain-specific boost based on operating shift. Morning emphasizes
 * prep + outreach + restock; afternoon emphasizes attach + sales-floor
 * coaching; evening emphasizes unfinished collections + ready pickups.
 * Deterministic table — no heuristics.
 */
const TIME_BOOSTS: Record<TimeOfDay, Partial<Record<FocusDomain, number>>> = {
  morning: {
    customer_churn:         25,
    period_drop_customer:   25,
    restock_opportunity:    25,
    dead_stock:             15,
    accessory_attach:       10,
    period_drop_overall:    15,
  },
  afternoon: {
    accessory_attach:       30,
    activation_flow:        20,
    period_drop_category:   15,
    restock_opportunity:    10,
    repair_intake:          10,
  },
  evening: {
    ext_payment:            40,
    repair_pickup:          30,
    layaway_stale:          15,
    layaway_abandoned:      15,
    special_order:          15,
    store_credit_liability: 10,
  },
  late: {
    ext_payment:            50,
    repair_pickup:          20,
  },
};

// ── Source-to-domain mapping ──────────────────────────────

function attentionDomainToFocus(d: AttentionDomain): FocusDomain {
  switch (d) {
    case 'repair':          return 'repair_pickup';
    case 'layaway':         return 'layaway_stale';
    case 'special_order':   return 'special_order';
    case 'external_payment':return 'ext_payment';
    case 'customer_churn':  return 'customer_churn';
    case 'store_credit':    return 'store_credit_liability';
  }
}

function lossDomainToFocus(c: LossCategory): FocusDomain {
  switch (c) {
    case 'dead_stock':              return 'dead_stock';
    case 'attachment_low':          return 'accessory_attach';
    case 'repairs_stalled':         return 'repair_pickup';
    case 'layaway_abandoned':       return 'layaway_abandoned';
    case 'ext_payment_risk':        return 'ext_payment';
    case 'low_margin_items':        return 'low_margin_items';
    case 'store_credit_liability':  return 'store_credit_liability';
  }
}

function slowDomainToFocus(c: DiagnosisCategory): FocusDomain {
  switch (c) {
    case 'traffic':         return 'period_drop_overall';
    case 'conversion':      return 'accessory_attach';
    case 'repairs_intake':  return 'repair_intake';
    case 'repairs_pickup':  return 'repair_pickup';
    case 'phone_payments':  return 'activation_flow';
    case 'inventory':       return 'dead_stock';
    case 'activity':        return 'activity_gap';
  }
}

function dropDomainToFocus(c: DropSignalCategory): FocusDomain {
  switch (c) {
    case 'overall_revenue':         return 'period_drop_overall';
    case 'category_drop':           return 'period_drop_category';
    case 'customer_disappearance':  return 'period_drop_customer';
    case 'accessory_attach_drop':   return 'accessory_attach';
    case 'activation_decline':      return 'activation_flow';
    case 'repair_decline':          return 'repair_intake';
    case 'employee_decline':        return 'period_drop_employee';
    case 'product_movement_decline':return 'period_drop_product';
  }
}

// ── Urgency / severity normalization ──────────────────────

function severityToUrgency(s: 'critical' | 'high' | 'medium' | 'low'): FocusUrgency {
  return s;
}

// ── Source adapters: turn each engine's signal into FocusPriority ──

function fromAttentionItem(a: AttentionItem, lang: Lang3): FocusPriority {
  // R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: derive entityRef from the
  // attention item's domain. Conservative — only sets entityRef when the
  // mapping to an OperationalContext type is unambiguous.
  let entityRef: FocusEntityRef | undefined;
  if (a.domain === 'repair' && a.entityId) {
    entityRef = { type: 'repair', value: a.entityId };
  } else if (a.domain === 'customer_churn') {
    const v = a.customerId || a.entityId;
    if (v) entityRef = { type: 'customer', value: v };
  } else if (a.domain === 'store_credit' && a.customerId) {
    entityRef = { type: 'customer', value: a.customerId };
  } else if ((a.domain === 'layaway' || a.domain === 'special_order') && a.customerId) {
    // Layaway / SO don't have their own OperationalContext type — map to
    // the linked customer when known so "contact them" still works.
    entityRef = { type: 'customer', value: a.customerId };
  }
  return {
    id: `focus-att-${a.id}`,
    domain: attentionDomainToFocus(a.domain),
    source: 'attention',
    headline: a.entityName ? `${a.reason}` : a.reason,
    evidence: a.reason,
    recommendedAction: a.recommendedAction,
    urgency: severityToUrgency(a.urgency),
    baseScore: a.priorityScore,
    score: a.priorityScore,
    actions: actionsForAttentionItem(a, lang),
    ...(entityRef ? { entityRef } : {}),
  };
}

function fromLossSignal(l: LossSignal, t: ReturnType<typeof tChat>): FocusPriority {
  // R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: LossSignal already carries
  // entityRef when the underlying signal points to one concrete entity
  // (e.g., low_margin_items → product). Pass it through.
  const entityRef: FocusEntityRef | undefined = l.entityRef
    ? { type: l.entityRef.type, value: l.entityRef.value }
    : undefined;
  return {
    id: `focus-loss-${l.id}`,
    domain: lossDomainToFocus(l.category),
    source: 'loss',
    headline: l.headline,
    evidence: l.evidence,
    recommendedAction: l.recommendedAction,
    estimatedImpactCents: l.exposureCents,
    urgency: severityToUrgency(
      l.score >= 200 ? 'critical' :
      l.score >= 120 ? 'high' :
      l.score >= 60  ? 'medium' : 'low'),
    baseScore: l.score,
    score: l.score,
    // Loss signals already carry their own action buttons.
    actions: l.actions.length > 0 ? l.actions : actionsForLossDomain(l, t),
    ...(entityRef ? { entityRef } : {}),
  };
}

function fromRestockRec(r: RestockRecommendation, t: ReturnType<typeof tChat>): FocusPriority {
  return {
    id: `focus-restock-${r.id}`,
    domain: 'restock_opportunity',
    source: 'restock',
    headline: `${r.name}${r.sku ? ` · ${r.sku}` : ''}`,
    evidence: r.reason || '',
    recommendedAction: r.recommendedAction || t('chat.focusToday.action.restockGeneric'),
    estimatedImpactCents: r.marginCents > 0 && r.recentSales14d > 0
      ? r.marginCents * r.recentSales14d
      : undefined,
    urgency: r.qty === 0 ? 'high' : (r.daysOfCover !== null && r.daysOfCover <= 5 ? 'high' : 'medium'),
    baseScore: r.score,
    score: r.score,
    actions: [
      {
        id: `focus-restock-${r.id}-open`,
        label: t('chat.focusToday.action.openInventory'),
        payload: { type: 'operator_action', executable: true, executionTarget: 'open_inventory', entityId: r.id, productName: r.name },
      },
    ],
    // R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: restock items are
    // inventory entities — clear single-product link.
    entityRef: { type: 'product', value: r.id },
  };
}

function fromSlowCause(c: DiagnosisCause, t: ReturnType<typeof tChat>): FocusPriority {
  return {
    id: `focus-slow-${c.id}`,
    domain: slowDomainToFocus(c.category),
    source: 'slow',
    headline: c.headline,
    evidence: c.evidence,
    recommendedAction: c.recommendedAction,
    urgency: c.confidence === 'high' ? 'high' : c.confidence === 'medium' ? 'medium' : 'low',
    baseScore: c.score,
    score: c.score,
    actions: c.actions.length > 0 ? c.actions : [{
      id: `focus-slow-${c.id}-fallback`,
      label: t('chat.focusToday.action.openReports'),
      payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
    }],
  };
}

function fromDropSignal(d: DropSignal, t: ReturnType<typeof tChat>): FocusPriority {
  // R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: pass through entityRef
  // when the underlying drop collector pinned a single entity
  // (customer_disappearance → top absent customer, product_movement_decline
  // → worst missing mover). All other drop categories leave it undefined.
  const entityRef: FocusEntityRef | undefined = d.entityRef
    ? { type: d.entityRef.type, value: d.entityRef.value }
    : undefined;
  return {
    id: `focus-drop-${d.id}`,
    domain: dropDomainToFocus(d.category),
    source: 'drop',
    headline: d.headline,
    evidence: d.evidence,
    recommendedAction: d.recommendedAction,
    estimatedImpactCents: d.estimatedImpactCents,
    urgency: severityToUrgency(d.severity),
    baseScore: d.score,
    score: d.score,
    actions: d.actions.length > 0 ? d.actions : [{
      id: `focus-drop-${d.id}-fallback`,
      label: t('chat.focusToday.action.openReports'),
      payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
    }],
    ...(entityRef ? { entityRef } : {}),
  };
}

// LossSignal.actions is empty until handleWhatIsLosingMoney decorates it
// after compute. We don't run the handler, so we synthesize a minimal
// open-the-right-module button per domain. Deterministic + safe.
function actionsForLossDomain(l: LossSignal, t: ReturnType<typeof tChat>): ChatActionUI[] {
  const id = `focus-loss-${l.id}-act`;
  switch (l.category) {
    case 'dead_stock':
    case 'low_margin_items':
      return [{ id, label: t('chat.focusToday.action.openInventory'),
        payload: { type: 'review', executable: true, executionTarget: 'open_inventory' } }];
    case 'attachment_low':
      return [{ id, label: t('chat.focusToday.action.openAccessories'),
        payload: { type: 'review', executable: true, executionTarget: 'open_inventory' } }];
    case 'repairs_stalled':
      return [{ id, label: t('chat.focusToday.action.openRepairs'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' } }];
    case 'layaway_abandoned':
      return [{ id, label: t('chat.focusToday.action.openLayaways'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' } }];
    case 'ext_payment_risk':
      return [{ id, label: t('chat.focusToday.action.openPos'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' } }];
    case 'store_credit_liability':
      return [{ id, label: t('chat.focusToday.action.openCustomers'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' } }];
  }
}

// ── Aggregation: merge + dedup + weight + rank ────────────

/** Apply time-of-day boost to every priority by domain. Pure. */
function applyTimeOfDayWeight(priorities: FocusPriority[], tod: TimeOfDay): void {
  const table = TIME_BOOSTS[tod];
  for (const p of priorities) {
    const boost = table[p.domain] || 0;
    p.score = p.baseScore + boost;
  }
}

/**
 * Within each FocusDomain bucket, keep only the highest-scoring priority.
 * Different engines can report the same operational situation; we'd rather
 * surface ONE strong signal than three redundant rows.
 */
function dedupeByDomain(priorities: FocusPriority[]): FocusPriority[] {
  const byDomain = new Map<FocusDomain, FocusPriority>();
  for (const p of priorities) {
    const cur = byDomain.get(p.domain);
    if (!cur || p.score > cur.score) byDomain.set(p.domain, p);
  }
  return [...byDomain.values()];
}

// ── Public entry point ────────────────────────────────────

const MAX_PRIORITIES = 5;
const MIN_PRIORITY_SCORE = 25;

const URGENCY_BADGE: Record<FocusUrgency, string> = {
  critical: '🚨',
  high:     '⚠️',
  medium:   '📌',
  low:      'ℹ️',
};

/**
 * R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY
 *
 * Top 3–5 operational priorities right now. Reads the structured outputs
 * of every existing intelligence engine, normalizes them into a single
 * FocusPriority shape, de-dupes overlapping signals by domain, applies a
 * time-of-day boost, and renders an action-first card.
 *
 * Empty / quiet-store state returns honest "no major issues detected".
 */
export function handleFocusToday(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const nowMs = Date.now();
  const tod = timeOfDay(nowMs);

  // Gather structured signals from each engine (read-only).
  const attentionItems = computeAttentionItemsForToday(engine, lang);
  const lossSignals    = computeLossSignals(engine, lang);
  const restockRecs    = computeRestockRecommendations(engine, lang);
  const slowCauses     = computeTodaySlowCauses(engine, lang);
  const dropSignals    = computeDropSignals(engine, lang);

  // Adapt all into a unified priority list.
  const priorities: FocusPriority[] = [];
  for (const a of attentionItems) priorities.push(fromAttentionItem(a, lang));
  for (const l of lossSignals)    priorities.push(fromLossSignal(l, t));
  for (const r of restockRecs)    priorities.push(fromRestockRec(r, t));
  for (const c of slowCauses)     priorities.push(fromSlowCause(c, t));
  for (const d of dropSignals)    priorities.push(fromDropSignal(d, t));

  if (priorities.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.focusToday.header')}**\n\n${t('chat.focusToday.allClear')}`,
    };
  }

  applyTimeOfDayWeight(priorities, tod);

  const deduped = dedupeByDomain(priorities);

  const filtered = deduped
    .filter((p) => p.score >= MIN_PRIORITY_SCORE)
    .sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      // Tie-break by urgency (critical first), then domain (stable).
      const URG_RANK: Record<FocusUrgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      if (URG_RANK[x.urgency] !== URG_RANK[y.urgency]) return URG_RANK[x.urgency] - URG_RANK[y.urgency];
      return x.domain < y.domain ? -1 : x.domain > y.domain ? 1 : 0;
    })
    .slice(0, MAX_PRIORITIES);

  if (filtered.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.focusToday.header')}**\n\n${t('chat.focusToday.allClear')}`,
    };
  }

  const lines: string[] = [
    `**${t('chat.focusToday.header')}**`,
    '',
    `🕐 ${t(`chat.focusToday.shift.${tod}`)}`,
    '',
  ];
  for (let i = 0; i < filtered.length; i++) {
    const p = filtered[i];
    lines.push(`${i + 1}. ${URGENCY_BADGE[p.urgency]} **${p.headline}**`);
    lines.push(`   📊 ${p.evidence}`);
    if (p.estimatedImpactCents !== undefined && p.estimatedImpactCents > 0) {
      lines.push(`   💰 ${t('chat.focusToday.impactLabel', COP(p.estimatedImpactCents))}`);
    }
    lines.push(`   💡 ${p.recommendedAction}`);
  }

  const rawActions: ChatActionUI[] = [];
  for (const p of filtered) for (const a of p.actions) rawActions.push(a);

  // R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: the TOP priority's
  // entityRef (when present) becomes the active operational context so
  // follow-ups like "open first one" / "contact him" / "show evidence"
  // route through the existing pronoun-rewrite + entity_operational_command
  // pipelines. Aggregate priorities (overall drop, attach rate, dead stock
  // as a whole, etc.) leave entityRef undefined — we return no
  // establishesContext rather than fabricate one.
  const topEntityRef = filtered[0]?.entityRef;

  // R-INTELLIGENCE-OPERATOR-WORKFLOW-CHAINING: append deterministic next-step
  // guidance based on the TOP priority's domain. Renders a "Suggested next
  // steps" section + executable buttons. Empty when the domain has no rules.
  //
  // R-INTELLIGENCE-WORKFLOW-CHAIN-DEDUPE-AND-FATIGUE-GUARD: opt into the
  // session-scoped dedupe so repeated "focus today" queries don't surface
  // identical step lists. Urgent domains (ext_payment / repair_pickup /
  // customer_churn) still repeat when the entityKey changes.
  const focusEntityKey = topEntityRef
    ? `${topEntityRef.type}:${topEntityRef.value}`
    : undefined;
  const workflowRecs = getWorkflowSteps(
    { priorityDomain: filtered[0]?.domain },
    t,
    { suppressRecentlyShown: true, entityKey: focusEntityKey },
  );
  const workflowText = renderWorkflowChainText(workflowRecs, t);
  const workflowActions = getWorkflowChatActions(workflowRecs, topEntityRef);

  return {
    kind: 'answer',
    text: lines.join('\n') + workflowText,
    ...(rawActions.length + workflowActions.length > 0
      ? { actions: [...rawActions, ...workflowActions].slice(0, 10) }
      : {}),
    ...(topEntityRef ? { establishesContext: { type: topEntityRef.type, value: topEntityRef.value } } : {}),
  };
}
