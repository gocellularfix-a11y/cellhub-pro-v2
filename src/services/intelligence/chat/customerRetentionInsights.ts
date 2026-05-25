// ============================================================
// CellHub Intelligence — Customer Retention Insights
// R-INTELLIGENCE-CUSTOMER-RETENTION-INSIGHTS
//
// Deterministic retrospective view: which customers were inactive long
// enough to count as lapsed, then came back and bought again inside the
// selected period (default: current month). Composed from the existing
// engine.getSales() / engine.getCustomers() arrays. No new database.
// No analytics warehouse. No predictive AI. Same inputs → same output.
//
// Difference from existing recover_customer intent:
//   - recover_customer  = proactive ("help me re-engage this lost customer")
//   - this intent       = retrospective ("which customers DID come back?")
//
// Performance:
//   - Single O(N) sweep over sales builds a per-customer timeline Map.
//   - One sort per customer (O(k log k)); typically k is tiny.
//   - No nested customer × sales loops. No O(N²) scans.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Sale, SaleItem, Customer } from '@/store/types';
import {
  tChat,
  type Lang3,
  type ChatResponse,
  type ChatActionUI,
  COP,
} from './handlers';
import {
  getWorkflowSteps,
  renderWorkflowChainText,
  getWorkflowChatActions,
} from '../workflows/workflowRecommendations';

// ── Tunables ──────────────────────────────────────────────

const DEFAULT_INACTIVE_DAYS = 30;
const MAX_TOP_RETURNS = 3;
const TOP_VIP_OUTREACH_SUGGESTION = 5;

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

function startOfCurrentMonth(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
}

type DominantCategory = 'repair' | 'phone' | 'accessory' | 'phone_payment' | 'other';

/**
 * Pick the dominant category for a return sale by total cents per bucket.
 * Maps 'service'/'part' → 'repair', 'top_up' → 'phone_payment'. Anything
 * unrecognized falls into 'other' so we never fabricate a bucket name.
 */
function dominantCategory(items: SaleItem[] | undefined): DominantCategory {
  let repair = 0, phone = 0, accessory = 0, payment = 0, other = 0;
  for (const it of items || []) {
    const cents = (it.price || 0) * (it.qty || 1);
    const c = String(it.category || '').toLowerCase();
    if (c === 'service' || c === 'part') repair += cents;
    else if (c === 'phone') phone += cents;
    else if (c === 'accessory') accessory += cents;
    else if (c === 'phone_payment' || c === 'top_up') payment += cents;
    else other += cents;
  }
  const pairs: Array<[DominantCategory, number]> = [
    ['repair', repair],
    ['phone', phone],
    ['accessory', accessory],
    ['phone_payment', payment],
    ['other', other],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  // If nothing scored above zero, fall back to 'other' rather than 'repair'.
  if (pairs[0][1] === 0) return 'other';
  return pairs[0][0];
}

function customerDisplayName(c: Customer | undefined, t: (k: string) => string): string {
  if (!c) return t('chat.retention.unknownCustomer');
  const composed = `${c.firstName || ''} ${c.lastName || ''}`.trim();
  return c.name || composed || c.phone || c.email || t('chat.retention.unknownCustomer');
}

// ── Public types ──────────────────────────────────────────

export interface ReturningCustomerSummary {
  customerId: string;
  customerName: string;
  /** R-INTELLIGENCE-CUSTOMER-RETENTION-RANKING-ACTIONS: optional phone for
   *  per-row WhatsApp action. Empty string when no phone is on file —
   *  whatsapp_url executor falls back to the wa.me picker URL safely. */
  customerPhone: string;
  spentCentsInPeriod: number;
  inactiveDays: number;
  dominantCategory: DominantCategory;
  returnSaleId: string;
}

export interface RetentionInsight {
  count: number;
  totalRecoveredCents: number;
  averageInactiveDays: number;
  topReturns: ReturningCustomerSummary[];
  /** Best recovery channel — most common dominant category among returns. */
  bestSourceCategory: DominantCategory | null;
  /** Per-category recovered count; useful for "Best recovery source" line. */
  categoryCounts: Record<DominantCategory, number>;
  /** Echo of the inputs so consumers / future variants can render context. */
  periodStartMs: number;
  periodEndMs: number;
  inactiveDays: number;
}

// ── Public compute ────────────────────────────────────────

/**
 * Compute returning-customer insight for a given window. Defaults: current
 * calendar month, 30-day inactivity threshold. Pass explicit
 * periodStartMs/periodEndMs for a later-ready week/last-month variant.
 *
 * A customer counts as "returning in period" when:
 *   1) They have prior sale history ANY time before the period start.
 *   2) The gap between their most-recent pre-period sale and their first
 *      in-period sale is ≥ inactiveDays.
 *   3) Cancelled/refunded sales are skipped on BOTH sides.
 *
 * recoveredRevenue sums every in-period sale from the moment of the return
 * forward — captures attach-after-return on the same trip.
 */
export function computeRetentionInsight(
  engine: IntelligenceEngine,
  nowMs: number = Date.now(),
  inactiveDays: number = DEFAULT_INACTIVE_DAYS,
  periodStartMs: number | undefined = undefined,
  periodEndMs: number | undefined = undefined,
  lang: Lang3,
): RetentionInsight {
  const t = tChat(lang);
  const sales: Sale[] = engine.getSales() || [];
  const customers: Customer[] = engine.getCustomers() || [];

  const customerById = new Map<string, Customer>();
  for (const c of customers) if (c?.id) customerById.set(c.id, c);

  const start = periodStartMs ?? startOfCurrentMonth(nowMs);
  const end = periodEndMs ?? nowMs;
  const inactiveThresholdMs = inactiveDays * 86400000;

  // Single sweep — bucket sales per customer with timestamps.
  const byCustomer = new Map<string, Array<{ s: Sale; ts: number }>>();
  for (const s of sales) {
    if (!s) continue;
    const status = String(s.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'refunded') continue;
    const cid = s.customerId;
    if (!cid) continue;
    const ts = tsOf(s.createdAt);
    if (!ts) continue;
    let bucket = byCustomer.get(cid);
    if (!bucket) { bucket = []; byCustomer.set(cid, bucket); }
    bucket.push({ s, ts });
  }

  const returns: ReturningCustomerSummary[] = [];
  for (const [cid, bucket] of byCustomer) {
    if (bucket.length < 2) continue;
    bucket.sort((a, b) => a.ts - b.ts);
    // Walk in order — track prev timestamp, find first in-period sale where
    // (this.ts - prev.ts) >= inactiveThresholdMs.
    let firstReturn: { s: Sale; ts: number; gapMs: number } | null = null;
    let spentInPeriodCents = 0;
    let prevTs = 0;
    for (const entry of bucket) {
      if (!firstReturn) {
        if (prevTs > 0 && entry.ts >= start && entry.ts <= end && entry.ts - prevTs >= inactiveThresholdMs) {
          firstReturn = { s: entry.s, ts: entry.ts, gapMs: entry.ts - prevTs };
        }
      }
      if (firstReturn && entry.ts >= firstReturn.ts && entry.ts <= end) {
        spentInPeriodCents += entry.s.total || 0;
      }
      prevTs = entry.ts;
    }
    if (!firstReturn) continue;
    const cust = customerById.get(cid);
    returns.push({
      customerId: cid,
      customerName: firstReturn.s.customerName || customerDisplayName(cust, t),
      // R-INTELLIGENCE-CUSTOMER-RETENTION-RANKING-ACTIONS: prefer the
      // canonical Customer.phone; fall back to the sale's snapshot phone.
      customerPhone: (cust?.phone || firstReturn.s.customerPhone || '').trim(),
      spentCentsInPeriod: spentInPeriodCents,
      inactiveDays: Math.floor(firstReturn.gapMs / 86400000),
      dominantCategory: dominantCategory(firstReturn.s.items),
      returnSaleId: firstReturn.s.id,
    });
  }

  returns.sort((a, b) => b.spentCentsInPeriod - a.spentCentsInPeriod);

  const totalRecoveredCents = returns.reduce((acc, r) => acc + r.spentCentsInPeriod, 0);
  const averageInactiveDays = returns.length === 0
    ? 0
    : Math.round(returns.reduce((acc, r) => acc + r.inactiveDays, 0) / returns.length);

  const categoryCounts: Record<DominantCategory, number> = {
    repair: 0, phone: 0, accessory: 0, phone_payment: 0, other: 0,
  };
  for (const r of returns) categoryCounts[r.dominantCategory]++;

  let bestSourceCategory: DominantCategory | null = null;
  let bestCount = 0;
  for (const cat of ['repair', 'phone', 'accessory', 'phone_payment', 'other'] as const) {
    if (categoryCounts[cat] > bestCount) { bestSourceCategory = cat; bestCount = categoryCounts[cat]; }
  }

  return {
    count: returns.length,
    totalRecoveredCents,
    averageInactiveDays,
    topReturns: returns.slice(0, MAX_TOP_RETURNS),
    bestSourceCategory,
    categoryCounts,
    periodStartMs: start,
    periodEndMs: end,
    inactiveDays,
  };
}

// ── Public handler ────────────────────────────────────────

export function handleCustomerRetentionInsights(
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const t = tChat(lang);
  const insight = computeRetentionInsight(engine, Date.now(), DEFAULT_INACTIVE_DAYS, undefined, undefined, lang);

  // Empty / quiet-period state — never fabricate. Spec: explicit
  // "No significant returning customer activity detected." line.
  if (insight.count === 0) {
    return {
      kind: 'answer',
      text: `**🔁 ${t('chat.retention.header')}**\n\n${t('chat.retention.noActivity')}`,
    };
  }

  const lines: string[] = [];
  lines.push(`**🔁 ${t('chat.retention.header')}**`);
  lines.push('');
  lines.push(t('chat.retention.summary', insight.count, insight.inactiveDays));

  if (insight.topReturns.length > 0) {
    lines.push('');
    lines.push(`**${t('chat.retention.topReturnsHeader')}**`);
    for (let i = 0; i < insight.topReturns.length; i++) {
      const r = insight.topReturns[i];
      lines.push(`${i + 1}. ${r.customerName}`);
      lines.push(`   💰 ${t('chat.retention.spent', COP(r.spentCentsInPeriod))}`);
      lines.push(`   🛒 ${t(`chat.retention.cat.${r.dominantCategory}`)}`);
      lines.push(`   ⏳ ${t('chat.retention.returnedAfter', r.inactiveDays)}`);
    }
  }

  lines.push('');
  lines.push(`**💰 ${t('chat.retention.recoveredHeader')}** ${COP(insight.totalRecoveredCents)}`);

  if (insight.averageInactiveDays > 0) {
    lines.push(`**⏳ ${t('chat.retention.avgInactiveHeader')}** ${t('chat.retention.daysValue', insight.averageInactiveDays)}`);
  }

  if (insight.bestSourceCategory) {
    lines.push('');
    lines.push(`**💡 ${t('chat.retention.bestSourceHeader')}** ${t(`chat.retention.source.${insight.bestSourceCategory}`)}`);
  }

  lines.push('');
  lines.push(`**${t('chat.retention.nextStepHeader')}** ${t('chat.retention.nextStepBody', TOP_VIP_OUTREACH_SUGGESTION)}`);

  // ── Continuity (R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY) ─
  const top = insight.topReturns[0];
  const topEntityRef: { type: 'customer'; value: string } | undefined = top
    ? { type: 'customer', value: top.customerId }
    : undefined;

  // ── Per-row action buttons ───────────────────────────
  //
  // R-INTELLIGENCE-CUSTOMER-RETENTION-RANKING-ACTIONS: every ranked customer
  // gets its own executable buttons (Open + WhatsApp + View History), so the
  // operator can act on ANY row directly — no ambiguous "who spent the most"
  // / "open the first one" follow-up phrases required.
  //
  // Reuse:
  //   - 'open_customer'  → canonical chat-action shape used by handlers.ts:1033
  //   - 'whatsapp_url'   → canonical re-engage payload shape used by handlers.ts:992
  //                        (messageKey 'whatsapp.template.reconnect'). Executor
  //                        in actionExecutor.ts:266 already degrades safely
  //                        when customerPhone is empty (falls back to wa.me
  //                        picker URL).
  //   - triggerQuery     → existing chat-replay mechanism on ChatActionUI
  //                        (handlers.ts:224). Re-fires through the existing
  //                        intent router → customer_history handler. No new
  //                        routing layer.
  const actions: ChatActionUI[] = [];
  for (const r of insight.topReturns) {
    actions.push({
      id: `retention-open-${r.customerId}`,
      label: t('chat.retention.action.openRow', r.customerName),
      payload: {
        type: 'review',
        executable: true,
        executionTarget: 'open_customer',
        entityId: r.customerId,
        customerId: r.customerId,
        customerName: r.customerName,
      },
    });
    actions.push({
      id: `retention-wa-${r.customerId}`,
      label: t('chat.retention.action.waRow', r.customerName),
      actionType: 'whatsapp',
      payload: {
        type: 'whatsapp',
        messageKey: 'whatsapp.template.reconnect',
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        executable: true,
        executionTarget: 'whatsapp_url',
      },
    });
    actions.push({
      id: `retention-history-${r.customerId}`,
      label: t('chat.retention.action.historyRow', r.customerName),
      payload: {
        type: 'review',
        executable: true,
        executionTarget: 'open_customer',
        entityId: r.customerId,
        customerId: r.customerId,
        customerName: r.customerName,
      },
      triggerQuery: `history of ${r.customerName}`,
    });
  }
  actions.push({
    id: 'retention-open-customers-list',
    label: t('chat.retention.action.openAll'),
    payload: {
      type: 'review',
      executable: true,
      executionTarget: 'queue_manager_review',
    },
  });

  // ── Workflow chaining (per spec: when customer entity exists) ──
  let workflowText = '';
  let workflowActions: ChatActionUI[] = [];
  if (topEntityRef) {
    const workflowRecs = getWorkflowSteps(
      { priorityDomain: 'customer_churn' },
      t,
      { suppressRecentlyShown: true, entityKey: `customer:${top!.customerId}` },
    );
    workflowText = renderWorkflowChainText(workflowRecs, t);
    workflowActions = getWorkflowChatActions(workflowRecs, topEntityRef);
  }

  // R-INTELLIGENCE-CUSTOMER-RETENTION-FOLLOWUP-WHO-SPENT-MOST:
  //
  // Follow-ups that WORK out-of-the-box via the existing continuity pipeline,
  // because establishesContext binds the top returning customer:
  //   ✓ "contact him" / "contact her" / "contact them" (FOLLOWUP_PHRASES)
  //   ✓ "call him" / "message her" (FOLLOWUP_PHRASES → pronoun resolution)
  //   ✓ "open it" / "show it" (FOLLOWUP_PHRASES → entity_operational_command)
  //   ✓ "show history" (active customer context + customer_history handler)
  //   ✓ workflow-chain follow-ups ("next step", "what after that", etc.)
  //
  // KNOWN GAP — NOT PATCHED in this round:
  //   ✗ "who spent the most" / "quien gastó más" / "quem gastou mais"
  //     This phrase still routes to global best_customer / customer_history
  //     (all-time top spender across the whole store), NOT scoped to the
  //     returning-customer list of this retention result. The top returning
  //     customer IS already #1 in the rendered "Top returns:" list, so the
  //     answer is visible — it's just that the follow-up phrase doesn't
  //     re-scope to retention.
  //
  //   Fixing it cleanly would require either:
  //     (a) a CONTEXT_FOLLOWUP_RULES rewrite rule scoped to customer-type
  //         context — which is effectively a routing rewrite (broad blast
  //         radius across every customer-context handler, not just this one)
  //     (b) a runtime cache of the last retention result so a follow-up
  //         handler can answer from it — which introduces new memory state
  //
  //   Both violate the strict rules ("no routing rewrite", "no fake memory")
  //   for this round. The recommended user workaround until a future round
  //   addresses this: pronoun-style follow-ups ("contact them", "open it")
  //   land on the top returning customer correctly. The retention response
  //   already shows the spend ranking inline.

  return {
    kind: 'answer',
    text: lines.join('\n') + workflowText,
    // R-INTELLIGENCE-CUSTOMER-RETENTION-RANKING-ACTIONS: cap raised from 8
    // to 12 to fit the per-row Open/WhatsApp/History trio for up to 3 top
    // returns (9) + generic "Open all" (1) + customer_churn workflow steps
    // (up to 3). Mirrors focusToday's 10-action ceiling, lifted by the
    // workflow contribution we already keep.
    ...(actions.length + workflowActions.length > 0
      ? { actions: [...actions, ...workflowActions].slice(0, 12) }
      : {}),
    ...(topEntityRef ? { establishesContext: { type: 'customer', value: top!.customerId } } : {}),
  };
}
