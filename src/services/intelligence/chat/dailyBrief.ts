// ============================================================
// CellHub Intelligence — Daily Operator Brief
// R-INTELLIGENCE-OPERATOR-DAILY-BRIEF
//
// Deterministic compressed store-state briefing. Composes its output
// from the structured exports of the existing engines:
//   - computeAttentionItemsForToday (whoNeedsAttentionToday)
//   - computeLossSignals          (whatIsLosingMoney)
//   - computeRestockRecommendations (restockOpportunity)
//   - computeDropSignals          (whyDidSalesDrop)
//
// NO new heavy scans. NO LLM. NO inference. Same inputs → same brief.
//
// Shape (max ~20 lines):
//   ☀️ Daily Operator Brief
//   📊 Store status — 3 short lines
//   🔥 Top priorities — up to 3
//   ⚠️ Risks — up to 3 (deduped vs priorities)
//   💰 Opportunities — up to 3 (deduped vs priorities + risks)
//   🧠 Suggested focus — single sentence
//   (optional: Suggested next steps from workflow engine, top priority only)
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import {
  computeAttentionItemsForToday,
  type AttentionItem,
  type AttentionDomain,
} from './whoNeedsAttentionToday';
import { computeLossSignals } from './whatIsLosingMoney';
import { computeRestockRecommendations } from './restockOpportunity';
import { computeDropSignals } from './whyDidSalesDrop';
import { tChat, type Lang3, type ChatResponse, type ChatActionUI, COP } from './handlers';
import {
  getWorkflowSteps,
  renderWorkflowChainText,
  getWorkflowChatActions,
} from '../workflows/workflowRecommendations';

// ── Time-of-day classification (deterministic) ───────────

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'late';
function timeOfDay(nowMs: number): TimeOfDay {
  const h = new Date(nowMs).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'late';
}

// ── Mapping helpers ──────────────────────────────────────

const ATTN_TO_WORKFLOW: Record<AttentionDomain, string> = {
  repair: 'repair_pickup',
  layaway: 'layaway_stale',
  special_order: 'special_order',
  external_payment: 'ext_payment',
  customer_churn: 'customer_churn',
  store_credit: 'store_credit_liability',
};

const ATTN_DOMAIN_BUCKET: Record<AttentionDomain, string> = {
  repair: 'repair_pickup',
  layaway: 'layaway_stale',
  special_order: 'special_order',
  external_payment: 'ext_payment',
  customer_churn: 'customer_churn',
  store_credit: 'store_credit_liability',
};

// ── Top-of-brief status lines ────────────────────────────

interface StatusLines {
  paceLine: string;
  repairLine: string;
  alertsLine: string;
}

function buildStatusLines(
  engine: IntelligenceEngine,
  lang: Lang3,
  attnItems: AttentionItem[],
  t: ReturnType<typeof tChat>,
): StatusLines {
  // Revenue pace via computeDropSignals' overall_revenue signal.
  const drops = computeDropSignals(engine, lang);
  const overall = drops.find((d) => d.category === 'overall_revenue');
  let paceLine: string;
  if (!overall) {
    paceLine = t('chat.operatorBriefV3.status.paceHealthy');
  } else {
    const m = overall.evidence.match(/(\d+)% drop/i);
    const pct = m ? parseInt(m[1], 10) : 0;
    if (pct >= 25) paceLine = t('chat.operatorBriefV3.status.paceDownSharp', pct);
    else if (pct >= 10) paceLine = t('chat.operatorBriefV3.status.paceDownMild', pct);
    else paceLine = t('chat.operatorBriefV3.status.paceHealthy');
  }

  // Repair queue count from attention items (repair_pickup domain).
  const repairWaiting = attnItems.filter((a) => a.domain === 'repair').length;
  const repairLine = repairWaiting === 0
    ? t('chat.operatorBriefV3.status.repairsHealthy')
    : t('chat.operatorBriefV3.status.repairsWaiting', repairWaiting);

  // Alerts count: attention items with urgency >= medium.
  const alerts = attnItems.filter((a) => a.urgency === 'critical' || a.urgency === 'high' || a.urgency === 'medium').length;
  const alertsLine = alerts === 0
    ? t('chat.operatorBriefV3.status.alertsClear')
    : t('chat.operatorBriefV3.status.alertsCount', alerts);

  return { paceLine, repairLine, alertsLine };
}

// ── Section builders ─────────────────────────────────────

interface Section {
  lines: string[];
  /** Domains already covered by this section — used for downstream dedup. */
  domainsSurfaced: Set<string>;
  /** Buttons attached to surfaced items. */
  actions: ChatActionUI[];
}

function emptySection(): Section {
  return { lines: [], domainsSurfaced: new Set<string>(), actions: [] };
}

const TOP_PRIORITIES_CAP = 3;
const RISKS_CAP          = 3;
const OPPORTUNITIES_CAP  = 3;

const PRIORITY_BADGE: Record<AttentionItem['urgency'], string> = {
  critical: '🚨',
  high:     '⚠️',
  medium:   '📌',
  low:      'ℹ️',
};

function buildPriorities(
  attnItems: AttentionItem[],
  t: ReturnType<typeof tChat>,
): Section {
  const out = emptySection();
  const top = attnItems.slice(0, TOP_PRIORITIES_CAP);
  for (let i = 0; i < top.length; i++) {
    const a = top[i];
    out.lines.push(`${i + 1}. ${PRIORITY_BADGE[a.urgency]} ${a.reason}`);
    out.domainsSurfaced.add(ATTN_DOMAIN_BUCKET[a.domain]);
  }
  void t;
  return out;
}

/**
 * Risks pull from loss signals that map to "risk" categories. Skip any
 * loss whose domain is already in the priorities section — no duplicate
 * rows. Limit to RISKS_CAP. Pre-rendered evidence reused verbatim.
 */
function buildRisks(
  engine: IntelligenceEngine,
  lang: Lang3,
  priorityDomains: Set<string>,
  t: ReturnType<typeof tChat>,
): Section {
  const out = emptySection();
  const losses = computeLossSignals(engine, lang);
  const RISK_TO_BUCKET: Record<string, string> = {
    ext_payment_risk:       'ext_payment',
    repairs_stalled:        'repair_pickup',
    layaway_abandoned:      'layaway_abandoned',
    dead_stock:             'dead_stock',
    low_margin_items:       'low_margin_items',
    store_credit_liability: 'store_credit_liability',
    attachment_low:         'accessory_attach',
  };
  for (const l of losses) {
    if (out.lines.length >= RISKS_CAP) break;
    const bucket = RISK_TO_BUCKET[l.category];
    if (!bucket || priorityDomains.has(bucket) || out.domainsSurfaced.has(bucket)) continue;
    out.lines.push(`• ${l.evidence}`);
    out.domainsSurfaced.add(bucket);
  }
  void t;
  return out;
}

/**
 * Opportunities = restock recommendations + customer_churn / period_drop
 * attention items not already shown. Restock items always come first
 * because they're the most actionable revenue lever.
 */
function buildOpportunities(
  engine: IntelligenceEngine,
  lang: Lang3,
  attnItems: AttentionItem[],
  priorityDomains: Set<string>,
  riskDomains: Set<string>,
  t: ReturnType<typeof tChat>,
): Section {
  const out = emptySection();
  const taken = (b: string) => priorityDomains.has(b) || riskDomains.has(b) || out.domainsSurfaced.has(b);

  // 1. Restock — top 1–2.
  const restock = computeRestockRecommendations(engine, lang);
  for (const r of restock) {
    if (out.lines.length >= OPPORTUNITIES_CAP) break;
    if (taken('restock_opportunity')) break;
    out.lines.push(`• ${t('chat.operatorBriefV3.opp.restock', r.name)}`);
    out.domainsSurfaced.add('restock_opportunity');
    break; // surface only the single best restock candidate to keep brief compact
  }

  // 2. Customer outreach — any attention item with customer_churn.
  for (const a of attnItems) {
    if (out.lines.length >= OPPORTUNITIES_CAP) break;
    const bucket = ATTN_DOMAIN_BUCKET[a.domain];
    if (bucket !== 'customer_churn') continue;
    if (taken(bucket)) continue;
    out.lines.push(`• ${t('chat.operatorBriefV3.opp.contactCustomer', a.entityName)}`);
    out.domainsSurfaced.add(bucket);
    break;
  }

  // 3. Repair pickups not yet covered.
  for (const a of attnItems) {
    if (out.lines.length >= OPPORTUNITIES_CAP) break;
    const bucket = ATTN_DOMAIN_BUCKET[a.domain];
    if (bucket !== 'repair_pickup') continue;
    if (taken(bucket)) continue;
    out.lines.push(`• ${t('chat.operatorBriefV3.opp.repairPickup', a.entityName)}`);
    out.domainsSurfaced.add(bucket);
    break;
  }

  return out;
}

// ── Suggested focus sentence ─────────────────────────────

/**
 * Single deterministic sentence keyed on (time-of-day, top priority domain).
 * Falls back to a calm "stick to the plan" message when no top priority.
 */
function buildSuggestedFocus(
  tod: TimeOfDay,
  top: AttentionItem | undefined,
  t: ReturnType<typeof tChat>,
): string {
  if (!top) return t('chat.operatorBriefV3.focus.allClear');
  const bucket = ATTN_DOMAIN_BUCKET[top.domain];
  // Per-domain templates already capture the operational instruction.
  // Time-of-day prefix lets the same message read naturally morning / pm.
  return t(`chat.operatorBriefV3.focus.${tod}.${bucket}`);
}

// ── Public entry point ───────────────────────────────────

const URGENCY_RANK: Record<AttentionItem['urgency'], number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

export function handleOperatorDailyBriefV3(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const nowMs = Date.now();
  const tod = timeOfDay(nowMs);

  // Reuse cross-domain attention list — already deduped + scored.
  const attnItems = computeAttentionItemsForToday(engine, lang);

  const status      = buildStatusLines(engine, lang, attnItems, t);
  const priorities  = buildPriorities(attnItems, t);
  const risks       = buildRisks(engine, lang, priorities.domainsSurfaced, t);
  const opportunities = buildOpportunities(engine, lang, attnItems, priorities.domainsSurfaced, risks.domainsSurfaced, t);

  const top = attnItems[0];
  const focusSentence = buildSuggestedFocus(tod, top, t);

  // Detect calm-state when nothing meaningful surfaced.
  const nothingFlagged =
    priorities.lines.length === 0 &&
    risks.lines.length === 0 &&
    opportunities.lines.length === 0;

  const lines: string[] = [];
  lines.push(`**☀️ ${t('chat.operatorBriefV3.header')}**`);
  lines.push(`🕐 ${t(`chat.operatorBriefV3.shift.${tod}`)}`);
  lines.push('');

  if (nothingFlagged) {
    lines.push(t('chat.operatorBriefV3.allHealthy'));
    return {
      kind: 'answer',
      text: lines.join('\n'),
    };
  }

  // Status section
  lines.push(`**📊 ${t('chat.operatorBriefV3.statusHeader')}**`);
  lines.push(`• ${status.paceLine}`);
  lines.push(`• ${status.repairLine}`);
  lines.push(`• ${status.alertsLine}`);

  // Top priorities
  if (priorities.lines.length > 0) {
    lines.push('');
    lines.push(`**🔥 ${t('chat.operatorBriefV3.prioritiesHeader')}**`);
    for (const l of priorities.lines) lines.push(l);
  }

  // Risks
  if (risks.lines.length > 0) {
    lines.push('');
    lines.push(`**⚠️ ${t('chat.operatorBriefV3.risksHeader')}**`);
    for (const l of risks.lines) lines.push(l);
  }

  // Opportunities
  if (opportunities.lines.length > 0) {
    lines.push('');
    lines.push(`**💰 ${t('chat.operatorBriefV3.opportunitiesHeader')}**`);
    for (const l of opportunities.lines) lines.push(l);
  }

  // Suggested focus — single sentence
  lines.push('');
  lines.push(`**🧠 ${t('chat.operatorBriefV3.focusHeader')}** ${focusSentence}`);

  // Buttons: pull from the top priority's actions OR a small set of
  // generic openers based on whichever sections fired.
  const actions: ChatActionUI[] = [];
  const addedTargets = new Set<string>();
  const pushAction = (id: string, label: string, target: string, entityId?: string) => {
    if (addedTargets.has(target + '|' + (entityId || ''))) return;
    addedTargets.add(target + '|' + (entityId || ''));
    actions.push({
      id,
      label,
      payload: {
        type: 'review',
        executable: true,
        executionTarget: target as 'open_repair' | 'open_customer' | 'open_inventory' | 'queue_manager_review' | 'whatsapp_url',
        ...(entityId ? { entityId } : {}),
      },
    });
  };

  // Reuse the workflow chaining engine for the top priority's domain so
  // the brief surfaces the next operational step inline (fatigue-guarded).
  let topEntityRef: { type: 'customer' | 'repair'; value: string } | undefined;
  let ctxType: 'customer' | 'repair' | undefined;
  let ctxValue: string | undefined;
  if (top) {
    ctxType = top.domain === 'repair' ? 'repair' : 'customer';
    ctxValue = top.domain === 'repair' ? top.entityId : (top.customerId || top.entityId);
    if (ctxValue) topEntityRef = { type: ctxType, value: ctxValue };
  }
  let workflowText = '';
  let workflowActions: ChatActionUI[] = [];
  if (top) {
    const workflowKey = ATTN_TO_WORKFLOW[top.domain];
    const entityKey = topEntityRef ? `${topEntityRef.type}:${topEntityRef.value}` : undefined;
    const workflowRecs = getWorkflowSteps(
      { priorityDomain: workflowKey },
      t,
      { suppressRecentlyShown: true, entityKey },
    );
    workflowText = renderWorkflowChainText(workflowRecs, t);
    workflowActions = getWorkflowChatActions(workflowRecs, topEntityRef);
  }
  for (const a of workflowActions) actions.push(a);

  // Always offer Open Reports as a generic exit point.
  pushAction('brief-open-reports', t('chat.operatorBriefV3.action.openReports'), 'queue_manager_review');

  void COP; // currently unused (compact brief avoids dollar signs in section lines)

  return {
    kind: 'answer',
    text: lines.join('\n') + workflowText,
    ...(actions.length > 0 ? { actions: actions.slice(0, 8) } : {}),
    ...(topEntityRef ? { establishesContext: { type: topEntityRef.type, value: topEntityRef.value } } : {}),
  };
}

// urgency rank exported so test helpers / future consumers can sort by it.
export { URGENCY_RANK };
