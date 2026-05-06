// ============================================================
// CellHub Intelligence — Chat Intent Handlers
// R-INTEL-CHAT-F5
//
// Per-intent response builders. Each handler receives an engine +
// match + lang and returns a markdown-ish string for display.
// Reuses summarizeDashboard / summarizeCustomerHistory from nlg.ts
// so chat responses have the same prose style as the dashboard card.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { IntentMatch, OperationalContext } from './intentRouter';
import type { ActionType, ActionQueueItem } from '../types';
import type { ActionPayload } from '../actions/actionEngine';
import type { AutomationKind } from '../automation/automationQueue';
import { getDealPerformance } from '../automation/automationQueue';
import { buildActionPayload } from '../actions/actionEngine';
// R-INTELLIGENCE-PENDING-DEAL-V1: deterministic deal builder for owner-mediated
// offer drafting. Pure helper — no mutation, no cart writes.
import { buildPendingDeal } from '../deals/dealEngine';
import type { PendingDeal } from '../deals/dealTypes';
// R-INTELLIGENCE-CONVERSATION-RUNNER-MODULE-V1: handler extracted to its
// own per-domain module per the modularity rule.
import { handleConversationRunner, classifyReply } from './conversationRunner';
import type { ReplyCategory } from './conversationRunner';
// R-INTELLIGENCE-PROPOSAL-FOLLOWUP-INBOX-V1: manual proposal-tracking
// helpers for the new proposal_followup + record_reply intents.
// R-INTELLIGENCE-DEAL-PIPELINE-V1: deal-pipeline helpers + types.
import {
  getProposalFollowups,
  updateProposalFollowup,
  findOpenFollowupByCustomerOrProduct,
  getDealPipeline,
  updateDealPipelineItem,
  findOpenDealByCustomerOrProduct,
  closeDealPipelineItem,
} from '../automation/automationQueue';
import type { DealStage } from '../automation/automationQueue';
// R-INTELLIGENCE-PRODUCT-PROMOTION-MODULE-V1: product-promotion handlers
// extracted. runProductPush is re-exported below so the InventoryModule
// "Promote" button (which imports from this file) keeps working without
// any change to its own import path.
import { handleProductPush, handleProductOpportunities } from './productPromotion';
export { runProductPush } from './productPromotion';
import { summarizeCustomerHistory } from '../nlg';
import { translations } from '@/i18n/translations';
// R-INTEL-AUTO-ACTION-QUEUE-ARCH-FIX: queue creation moved here from
// engine.refresh() — only handleWhoToContactToday triggers the queue.
import { enqueueOutreachActions } from '../actions';
import { getActionImpact, getActionLearning } from '../actions/actionExecutor';
// R-INTEL-CELLHUB-DATA-ACCESS-LAYER: universal data_query intent reads
// engine arrays via read-only getters and routes through the data
// access layer for deterministic operational answers.
import {
  getSalesSummary, getInventorySummary, getLowStockItems, getDeadStockItems,
  getCustomerSummary, getTopCustomers, getInactiveCustomers,
  getRepairSummary, getReadyRepairs,
  getUnlockSummary, getLayawaySummary, getPendingLayaways,
  getPhonePaymentSummary, getSpecialOrderSummary, getReturnSummary,
  getExpenseSummary,
  getEmployeePerformance,
  getAppointmentSummary,
  getLiabilitySummary,
  type DateRange,
} from '../dataAccess/cellhubDataAccess';

// R-INTELLIGENCE-PRODUCT-PROMOTION-MODULE-V1: exported so per-domain
// modules (productPromotion.ts, etc.) can format cents→display verbatim.
export const COP = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  whatsapp: 'WhatsApp',
  discount: 'Discount',
  bundle:   'Bundle',
  review:   'Review',
  reminder: 'Reminder',
};

// Standalone translation lookup — mirrors useTranslation() logic without
// requiring React context. Used by pure-TS chat handlers.
// R-INTELLIGENCE-CONVERSATION-RUNNER-MODULE-V1: exported so per-domain
// modules (conversationRunner.ts, etc.) can import without duplication.
export type Lang3 = 'en' | 'es' | 'pt';
export function tChat(lang: Lang3) {
  return (key: string, ...args: any[]): string => {
    const entry = translations[key];
    if (!entry) return key;
    const value = entry[lang] ?? entry.en;
    return typeof value === 'function' ? value(...args) : value;
  };
}

export interface ChatActionUI {
  id: string;
  label: string;
  actionType?: ActionType;
  payload: ActionPayload;
  // R-INTELLIGENCE-PENDING-DEAL-V1: optional override so a chat action gets
  // queued under a specific AutomationKind instead of the default actionType
  // → kind map. Used for 'pending_deal' so deal drafts don't get bucketed as
  // generic whatsapp_reconnect items.
  queueKind?: AutomationKind;
  // R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: full deal record so the
  // queue item carries everything needed for the later "Add to POS Cart"
  // click (productName, proposedPriceCents, originalPriceCents, qty, etc.).
  // Only populated for pending_deal actions.
  pendingDeal?: PendingDeal;
  // R-INTELLIGENCE-ACTION-BUTTONS-V1: optional chat-replay hook. When set,
  // clicking the button RE-FIRES the chat query through the existing
  // fireQuery → classifyIntent → handleIntent pipeline (no new execution
  // system, no autonomous send). Used by the "Promote Product" button on
  // operator-style product opportunity responses.
  triggerQuery?: string;
}

export interface ChatResponse {
  text: string;
  kind: 'answer' | 'disambiguation' | 'error' | 'help';
  actions?: ChatActionUI[];
  // R-INTELLIGENCE-CONTEXT-MEMORY-V1: optional hint that this response
  // established an actionable entity worth remembering for the NEXT
  // user turn (e.g., the product the owner just asked about). The chat
  // shell stamps a timestamp and stores at depth-1; handlers stay
  // clock-agnostic. Pure data; no behavior change for existing callers.
  establishesContext?: { type: OperationalContext['type']; value: string };
}

export function handleIntent(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const es = lang === 'es';

  switch (match.id) {
    case 'best_customer':
      return handleBestCustomer(engine, lang);

    case 'least_profitable_customers':
      return handleLeastProfitable(engine, lang);

    case 'multi_phone_customers':
      return handleMultiPhoneCustomers(engine, lang);

    case 'customer_history':
      return handleCustomerHistory(match, engine, es);

    case 'daily_brief':
      return handleDailyBrief(engine, lang);

    case 'today_sales':
      return handleTodaySales(engine, lang);

    case 'action_impact':
      return handleActionImpact(engine, lang);

    case 'action_learning':
      return handleActionLearning(engine, lang);

    case 'propose_deal':
      return handleProposeDeal(match, engine, lang);

    case 'deal_performance':
      return handleDealPerformance(lang);

    case 'proactive_opportunities':
      return handleProactiveOpportunities(engine, lang);

    case 'conversation_runner':
      return handleConversationRunner(match, lang);

    case 'daily_operator_brief':
      return handleDailyOperatorBrief(engine, lang);

    case 'today_money_map':
      return handleTodayMoneyMap(engine, lang);

    case 'operator_mode':
      return handleOperatorMode(engine, lang);

    case 'proposal_followup':
      return handleProposalFollowup(match, lang);

    case 'deal_pipeline':
      return handleDealPipeline(lang);

    case 'mark_deal_stage':
      return handleMarkDealStage(match, lang);

    case 'today_summary':
      return handleTodaySummary(engine, lang);

    case 'sales_summary':
      return handleSalesSummary(engine, es);

    case 'inventory_low':
      return handleInventoryLow(engine, lang);

    case 'inventory_dead':
      return handleInventoryDead(engine, es);

    case 'inventory_dying':
      return handleInventoryDying(engine, es);

    case 'top_items':
      return handleTopItems(engine, es);

    case 'repairs_overdue':
      return handleRepairsOverdue(engine, es);

    case 'health_check':
      return handleHealthCheck(engine, es);

    case 'forecast_items':
      return handleForecastItems(engine, es);

    case 'anomaly_days':
      return handleAnomalyDays(engine, es);

    case 'who_to_contact':
      return handleWhoToContact(engine, lang);

    case 'who_to_contact_today':
      return handleWhoToContactToday(engine, lang);

    case 'marketing_campaign':
      return handleMarketingCampaign(engine, lang);

    case 'product_push':
      return handleProductPush(match, engine, lang);

    case 'what_hurting_profit':
      return handleWhatHurtingProfit(engine, lang);

    case 'product_opportunities':
      return handleProductOpportunities(engine, lang);

    case 'root_cause':
      return handleRootCause(engine, lang);

    case 'slow_day_root_cause':
      return handleSlowDayRootCause(engine, lang);

    case 'dead_stock_root_cause':
      return handleDeadStockRootCause(engine, lang);

    case 'customer_churn_root_cause':
      return handleChurnRootCause(engine, lang);

    case 'help':
      return handleHelp(es);

    case 'data_query':
      return handleDataQuery(match, engine, lang);

    case 'fallback_question':
      return handleFallbackQuestion(match, engine, lang);

    case 'unknown':
    default:
      return handleUnknown(es);
  }
}

// ── Best customer ───────────────────────────────────────────
function handleBestCustomer(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const result = engine.refresh();
  const scores = result.customerScores;

  if (scores.length === 0) {
    return { kind: 'answer', text: t('chat.bestCustomer.empty') };
  }

  const top = scores.slice().sort((a, b) => b.score - a.score)[0];
  const history = engine.getCustomerHistory(top.customerId);

  if (!history) {
    return { kind: 'answer', text: t('chat.bestCustomer.empty') };
  }

  const lastDays = history.lastVisit
    ? Math.floor((Date.now() - history.lastVisit.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const summary = t('chat.bestCustomer.summary',
    history.customer.name,
    COP(history.grossRevenue),
    history.visitCount,
    lastDays,
  );

  return {
    kind: 'answer',
    text: `${t('chat.bestCustomer.header')}\n\n${summary}\n\n${t('chat.bestCustomer.recommendation')}`,
  };
}

// ── Least profitable customers (R-INTENT-LEAST-PROFITABLE) ──
// Bottom-3 ranked by profit ASC. Eligibility filters protect against
// shaming low-data customers: visitCount ≥ 2, grossRevenue ≥ $50,
// costCoverage ≥ 0.5. Approximate-tag shown when costCoverage < 0.7.
// Refund-rate note when refund/gross > 20%. Read-only — no queue writes.
function handleLeastProfitable(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const customers = engine.getCustomers();

  const results = [];
  for (const c of customers) {
    const h = engine.getCustomerHistory(c.id);
    if (!h) continue;
    if (h.visitCount < 2) continue;
    if (h.grossRevenue < 5000) continue;
    if (h.costCoverage < 0.5) continue;
    results.push(h);
  }

  if (results.length === 0) {
    return { kind: 'answer', text: t('chat.leastProfitable.empty') };
  }

  results.sort((a, b) => a.profit - b.profit);
  const top = results.slice(0, 3);

  const lines: string[] = [];
  lines.push(t('chat.leastProfitable.header'));

  for (const h of top) {
    lines.push(t('chat.leastProfitable.row',
      h.customer.name,
      COP(h.profit),
      h.visitCount,
      COP(h.avgTicket),
    ));
    if (h.costCoverage < 0.7) {
      lines.push(t('chat.leastProfitable.approximate'));
    }
    const ratio = h.grossRevenue > 0 ? h.totalRefunded / h.grossRevenue : 0;
    if (ratio > 0.2) {
      lines.push(t('chat.leastProfitable.refundWarning', Math.round(ratio * 100)));
    }
  }

  lines.push(t('chat.leastProfitable.recommendation'));

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Multi-phone customers (R-INTEL-MULTI-PHONE-CUSTOMERS) ──
// Deterministic exact count of customers carrying more than one phone
// number. Pure pass-through to engine.countMultiPhoneCustomers() — no
// queue, no campaigns, no fallback, no approximations. Inline EN/ES/PT
// strings (spec did not list translations.ts; this is a single-line
// answer with simple plural/singular grammar).
function handleMultiPhoneCustomers(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const count = engine.countMultiPhoneCustomers();

  type Lines = { count: (n: number) => string; none: string };
  const tables: Record<Lang3, Lines> = {
    en: {
      count: (n) => `${n} customer${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} more than one phone number.`,
      none: 'No customers have multiple phone numbers.',
    },
    es: {
      count: (n) => `${n} cliente${n === 1 ? '' : 's'} ${n === 1 ? 'tiene' : 'tienen'} más de un número de teléfono.`,
      none: 'Ningún cliente tiene múltiples números de teléfono.',
    },
    pt: {
      count: (n) => `${n} cliente${n === 1 ? '' : 's'} ${n === 1 ? 'tem' : 'têm'} mais de um número de telefone.`,
      none: 'Nenhum cliente tem múltiplos números de telefone.',
    },
  };
  const lines = tables[lang] ?? tables.en;
  const text = count === 0 ? lines.none : lines.count(count);

  return { kind: 'answer', text };
}

// ── Customer history ────────────────────────────────────────
function handleCustomerHistory(
  match: IntentMatch,
  engine: IntelligenceEngine,
  es: boolean,
): ChatResponse {
  if (match.candidateCustomers && match.candidateCustomers.length > 1) {
    const list = match.candidateCustomers.map((c) => `• ${c.name}${c.phone ? ` (${c.phone})` : ''}`).join('\n');
    return {
      kind: 'disambiguation',
      text: es
        ? `Encontré varios clientes con "${match.extractedName}". ¿Cuál?\n${list}`
        : `I found multiple customers matching "${match.extractedName}". Which one?\n${list}`,
    };
  }

  if (!match.matchedCustomer) {
    return {
      kind: 'error',
      text: es
        ? `No encontré un cliente con ese nombre${match.extractedName ? ` ("${match.extractedName}")` : ''}. Verifica ortografía o usa el teléfono/número de cliente.`
        : `I couldn't find a customer with that name${match.extractedName ? ` ("${match.extractedName}")` : ''}. Check spelling or try phone / customer number.`,
    };
  }

  const history = engine.getCustomerHistory(match.matchedCustomer.id);
  if (!history) {
    return {
      kind: 'error',
      text: es ? 'Error obteniendo historial.' : 'Error fetching history.',
    };
  }

  return {
    kind: 'answer',
    text: summarizeCustomerHistory(history, es ? 'es' : 'en'),
    // R-INTELLIGENCE-CONTEXT-MEMORY-V1: stamp customer so vague follow-ups
    // (e.g., "show another", "anything else") can resolve back to this
    // customer on the next turn. V1 enrichment rules only target product
    // context; customer context is recorded for symmetry / future use.
    establishesContext: { type: 'customer', value: match.matchedCustomer.name },
  };
}

// ── Today summary (R-INTELLIGENCE-CHAT-TODAY-UX-TWEAK) ─────
// Module-level timestamp for the "no major change since last check"
// compact follow-up. Within a single chat session, repeated today queries
// inside the follow-up window get the compact variant. Resets on process
// restart — acceptable for a UX nicety.
let lastTodaySummaryAt = 0;
const TODAY_SUMMARY_FOLLOWUP_WINDOW_MS = 30_000;

function handleTodaySummary(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const m = engine.getTodayMetrics();
  const now = Date.now();
  const isFollowup = (now - lastTodaySummaryAt) < TODAY_SUMMARY_FOLLOWUP_WINDOW_MS;
  lastTodaySummaryAt = now;

  // Empty path — no sales today yet.
  if (m.transactions === 0) {
    return { kind: 'answer', text: t('chat.today.empty') };
  }

  // Compact follow-up — same intent within the window.
  if (isFollowup) {
    return {
      kind: 'answer',
      text: t(
        'chat.today.followup',
        COP(m.revenueCents),
        m.transactions,
        COP(m.avgTicketCents),
      ),
    };
  }

  // Full card.
  const lines: string[] = [];
  lines.push(t('chat.today.header'));
  lines.push('');
  lines.push(`• ${t('chat.today.revenueLabel')}: ${COP(m.revenueCents)}`);
  lines.push(`• ${t('chat.today.transactionsLabel')}: ${m.transactions}`);
  lines.push(`• ${t('chat.today.avgTicketLabel')}: ${COP(m.avgTicketCents)}`);
  if (m.topSeller) {
    lines.push(`• ${t('chat.today.topSellerLabel')}: ${m.topSeller.name}`);
  }
  // Action recommendation — varies on whether we have a topSeller.
  const actionText = m.topSeller
    ? t('chat.today.actionWithTopSeller', m.topSeller.name)
    : t('chat.today.actionGeneric');
  lines.push('');
  lines.push(`💡 ${t('chat.today.actionLabel')}: ${actionText}`);

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Root-cause analysis (R-INTELLIGENCE-ROOT-CAUSE-CHAINS-V1) ──
// Single-pass analyzer for today_sales follow-up only. Walks sales once,
// buckets by local-day midnight, computes 7-day prior averages excluding
// today, then classifies via deterministic thresholds. Pure compute; no
// state, no localStorage, no engine mutation. Runs ONLY when user asks
// "why?" after a today_sales response — never on hot keystroke paths.
type TodaySalesCause =
  | 'not_enough_data'
  | 'no_sales_today'
  | 'revenue_above_average'
  | 'low_transactions'
  | 'low_avg_ticket'
  | 'both_low'
  | 'normal';

interface TodaySalesCauseResult {
  cause: TodaySalesCause;
  todayRevenueCents: number;
  todayTransactions: number;
  todayAvgTicketCents: number;
  avg7RevenueCents: number;
  avg7Transactions: number;
  avg7TicketCents: number;
  comparableDays: number;
}

function analyzeTodaySalesCause(engine: IntelligenceEngine): TodaySalesCauseResult {
  const m = engine.getTodayMetrics();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const ms7Back = todayMs - 7 * 86400000;

  // Single pass: bucket non-voided/non-refunded sales from the last 7 days
  // (EXCLUDING today) into local-day buckets.
  const byDay = new Map<number, { revenueCents: number; transactions: number }>();
  for (const s of engine.getSales()) {
    const ca = (s as { createdAt?: unknown }).createdAt;
    if (!ca) continue;
    let ts: number;
    try {
      const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
        ? (ca as { toDate: () => Date }).toDate()
        : (ca as string | Date);
      ts = new Date(d as string | Date).getTime();
    } catch { continue; }
    if (!Number.isFinite(ts) || ts >= todayMs || ts < ms7Back) continue;
    const status = String((s as { status?: string }).status || '').toLowerCase();
    if (status === 'voided' || status === 'refunded') continue;

    const dayMidnight = new Date(ts); dayMidnight.setHours(0, 0, 0, 0);
    const dayKey = dayMidnight.getTime();
    const entry = byDay.get(dayKey) || { revenueCents: 0, transactions: 0 };
    entry.revenueCents += (s as { total?: number }).total || 0;
    entry.transactions++;
    byDay.set(dayKey, entry);
  }

  const comparableDays = byDay.size;
  let totalRev = 0, totalTx = 0;
  for (const d of byDay.values()) { totalRev += d.revenueCents; totalTx += d.transactions; }
  const avg7RevenueCents = comparableDays > 0 ? Math.round(totalRev / comparableDays) : 0;
  const avg7Transactions = comparableDays > 0 ? totalTx / comparableDays : 0;
  const avg7TicketCents = totalTx > 0 ? Math.round(totalRev / totalTx) : 0;

  // Cause selection — spec order (first matching wins):
  // 1. comparableDays < 3 → not_enough_data
  // 2. transactions === 0 → no_sales_today
  // 3. revenue >= 110% of 7d avg → revenue_above_average
  // 4. tx < 80% of 7d avg AND ticket < 90% of 7d avg → both_low
  // 5. tx < 80% of 7d avg → low_transactions
  // 6. ticket < 90% of 7d avg → low_avg_ticket
  // 7. else normal
  let cause: TodaySalesCause;
  if (comparableDays < 3) {
    cause = 'not_enough_data';
  } else if (m.transactions === 0) {
    cause = 'no_sales_today';
  } else if (m.revenueCents >= avg7RevenueCents * 1.1) {
    cause = 'revenue_above_average';
  } else {
    const lowTx = m.transactions < avg7Transactions * 0.8;
    const lowTicket = m.avgTicketCents < avg7TicketCents * 0.9;
    if (lowTx && lowTicket) cause = 'both_low';
    else if (lowTx) cause = 'low_transactions';
    else if (lowTicket) cause = 'low_avg_ticket';
    else cause = 'normal';
  }

  return {
    cause,
    todayRevenueCents: m.revenueCents,
    todayTransactions: m.transactions,
    todayAvgTicketCents: m.avgTicketCents,
    avg7RevenueCents,
    avg7Transactions: Math.round(avg7Transactions),
    avg7TicketCents,
    comparableDays,
  };
}

const TODAY_CAUSE_KEYS: Record<TodaySalesCause, string> = {
  not_enough_data:       'chat.todaySalesCause.notEnoughData',
  no_sales_today:        'chat.todaySalesCause.noSalesToday',
  revenue_above_average: 'chat.todaySalesCause.revenueAboveAverage',
  low_transactions:      'chat.todaySalesCause.lowTransactions',
  low_avg_ticket:        'chat.todaySalesCause.lowAvgTicket',
  both_low:              'chat.todaySalesCause.bothLow',
  normal:                'chat.todaySalesCause.normal',
};

const TODAY_CAUSE_ACTION_KEYS: Record<TodaySalesCause, string> = {
  not_enough_data:       'chat.todaySalesCause.action.notEnoughData',
  no_sales_today:        'chat.todaySalesCause.action.noSalesToday',
  revenue_above_average: 'chat.todaySalesCause.action.revenueAboveAverage',
  low_transactions:      'chat.todaySalesCause.action.lowTransactions',
  low_avg_ticket:        'chat.todaySalesCause.action.lowAvgTicket',
  both_low:              'chat.todaySalesCause.action.bothLow',
  normal:                'chat.todaySalesCause.action.normal',
};

// R-INTELLIGENCE-TODAY-SALES-ROOT-CAUSE-ACTIONS-V1: which causes get
// follow-up "tip" lines pointing to existing safe intents. No ChatActionUI
// buttons attached — those would require concrete customerId/SKU targets
// the cause analyzer doesn't have. Tip text routes user to the existing
// safe intents (who_to_contact_today, product_push) which already include
// consent filtering, 24h dedup, and manual approval.
const TODAY_CAUSE_TIPS: Record<TodaySalesCause, string[]> = {
  not_enough_data:       [],
  no_sales_today:        ['chat.todaySalesCause.tipContact'],
  revenue_above_average: ['chat.todaySalesCause.tipPromote'],
  low_transactions:      ['chat.todaySalesCause.tipContact'],
  low_avg_ticket:        ['chat.todaySalesCause.tipPromote'],
  both_low:              ['chat.todaySalesCause.tipContact', 'chat.todaySalesCause.tipPromote'],
  normal:                [],
};

// ── Follow-up handler (R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1) ───
// Re-uses the LAST matched intent's context to answer short follow-ups
// ("why?", "what should I do?", etc.) without re-running classifyIntent
// or scanning all data. Single switch on intentId, single engine call
// only when the topic genuinely needs a fresh number (today_sales).
// All other branches are text-only — pure helpers per spec perf rules.
export interface FollowUpContext {
  intentId: string;
  query: string;
  responseText: string;
  ts: number;
}

export function handleFollowUp(
  context: FollowUpContext,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const t = tChat(lang);
  const lines: string[] = [t('chat.followup.header')];
  // R-INTELLIGENCE-EXECUTABLE-ACTIONS-V2-CONTACT: optional ChatActionUI[]
  // attached only by the today_sales contact-cause branch below.
  let actionsOut: ChatActionUI[] | undefined;

  switch (context.intentId) {
    case 'today_sales': {
      // R-INTELLIGENCE-ROOT-CAUSE-CHAINS-V1: replace generic explanation
      // with deterministic cause + evidence + action chain.
      const r = analyzeTodaySalesCause(engine);
      lines.length = 0; // drop the generic followup header — use root-cause header instead
      lines.push(t('chat.todaySalesCause.header'));
      lines.push(t(TODAY_CAUSE_KEYS[r.cause]));
      if (r.comparableDays >= 3) {
        lines.push(t('chat.todaySalesCause.evidence',
          COP(r.todayRevenueCents), r.todayTransactions, COP(r.todayAvgTicketCents),
          COP(r.avg7RevenueCents), r.avg7Transactions, COP(r.avg7TicketCents)));
      }
      lines.push(t('chat.todaySalesCause.action', t(TODAY_CAUSE_ACTION_KEYS[r.cause])));
      // R-INTELLIGENCE-TODAY-SALES-ROOT-CAUSE-ACTIONS-V1: per-cause tips
      // pointing user to existing safe intents (no auto-execution, no new
      // queue items, no consent risk).
      for (const tipKey of TODAY_CAUSE_TIPS[r.cause]) {
        lines.push(t(tipKey));
      }
      // R-INTELLIGENCE-EXECUTABLE-ACTIONS-V2-CONTACT: WhatsApp deep-link
      // buttons for contact-style causes only. Reuses engine helper that
      // already filters consent + phone presence. Promotion-style causes
      // (low_avg_ticket, revenue_above_average) stay text-only — no safe
      // SKU resolution from today_sales context.
      if (r.cause === 'no_sales_today' || r.cause === 'low_transactions' || r.cause === 'both_low') {
        const candidates = engine.buildOutreachQueueItems().slice(0, 3);
        if (candidates.length > 0) {
          const nameById = new Map(engine.getCustomers().map((c) => [c.id, c.name]));
          const built: ChatActionUI[] = [];
          for (const item of candidates) {
            if (!item.customerId) continue;
            const name = nameById.get(item.customerId) || item.phone || '';
            if (!name) continue;
            built.push({
              id: `ts-contact-${item.customerId}`,
              label: t('chat.action.contactCustomer', name),
              actionType: 'whatsapp',
              payload: {
                type: 'whatsapp',
                messageKey: 'whatsapp.template.reconnect',
                customerId: item.customerId,
                customerName: nameById.get(item.customerId),
                executable: true,
                executionTarget: 'whatsapp_url',
              },
            });
          }
          if (built.length > 0) actionsOut = built;
        }
      }
      break;
    }
    case 'product_opportunities':
    case 'product_push':
    case 'marketing_campaign': {
      lines.push(t('chat.followup.because', t('chat.followup.productOpportunity')));
      lines.push(t('chat.followup.action', t('chat.followup.actionProduct')));
      break;
    }
    case 'best_customer': {
      lines.push(t('chat.followup.because', t('chat.followup.bestCustomer')));
      lines.push(t('chat.followup.action', t('chat.followup.actionBestCustomer')));
      break;
    }
    case 'who_to_contact':
    case 'who_to_contact_today': {
      lines.push(t('chat.followup.because', t('chat.followup.contactToday')));
      lines.push(t('chat.followup.action', t('chat.followup.actionContact')));
      break;
    }
    default:
      lines.push(t('chat.followup.fallback'));
  }
  return { kind: 'answer', text: lines.join('\n'), actions: actionsOut };
}

// ── Today sales (R-INTELLIGENCE-TODAY-SALES-DATA-INTENT) ─────
// Focused today-only summary. Reuses engine.getTodayMetrics() for the
// canonical local-day filter (mirrors AppointmentsModule today logic).
// Adds payment-method breakdown by walking today's sales once with the
// same filter — no new date helper, no engine change.
function handleTodaySales(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const m = engine.getTodayMetrics();

  if (m.transactions === 0) {
    return { kind: 'answer', text: t('chat.todaySales.empty') };
  }

  const lines: string[] = [];
  lines.push(t('chat.todaySales.header'));
  lines.push('');
  lines.push(`• ${t('chat.todaySales.summary', COP(m.revenueCents))}`);
  lines.push(`• ${t('chat.todaySales.transactions', m.transactions)}`);
  lines.push(`• ${t('chat.todaySales.avgTicket', COP(m.avgTicketCents))}`);
  if (m.topSeller) {
    lines.push(`• ${t('chat.todaySales.topItem', m.topSeller.name, COP(m.topSeller.revenueCents))}`);
  }

  // Payment-method breakdown for today's countable sales (same filter as
  // getTodayMetrics: status !== voided/refunded, createdAt >= midnight).
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const tsOf = (sale: { createdAt?: unknown }): number => {
    const ca = sale.createdAt;
    if (!ca) return 0;
    try {
      const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
        ? (ca as { toDate: () => Date }).toDate()
        : (ca as string | Date);
      return new Date(d as string | Date).getTime();
    } catch { return 0; }
  };
  const byMethod: Record<string, { count: number; cents: number }> = {};
  for (const s of engine.getSales()) {
    const tt = tsOf(s as { createdAt?: unknown });
    if (!tt || tt < todayMs) continue;
    const status = String((s as { status?: string }).status || '').toLowerCase();
    if (status === 'voided' || status === 'refunded') continue;
    const method = String((s as { paymentMethod?: string }).paymentMethod || 'Unknown');
    if (!byMethod[method]) byMethod[method] = { count: 0, cents: 0 };
    byMethod[method].count++;
    byMethod[method].cents += (s as { total?: number }).total || 0;
  }
  const methodEntries = Object.entries(byMethod).sort((a, b) => b[1].cents - a[1].cents);
  if (methodEntries.length > 0) {
    lines.push('');
    lines.push(t('chat.todaySales.paymentBreakdown'));
    for (const [method, d] of methodEntries) {
      lines.push(`  ${method}: ${COP(d.cents)} (${d.count})`);
    }
  }

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Action impact (R-INTELLIGENCE-ACTION-IMPACT-TRACKING-V1) ─
// Reads execution log + walks engine sales (already in memory) to attribute
// revenue. Single-pass map build; no background jobs; runs only on user
// query. Strict 72h post-action customerId match.
function handleActionImpact(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const r = getActionImpact(engine.getSales());
  if (r.totalActions === 0) {
    return { kind: 'answer', text: t('chat.actionImpact.empty') };
  }
  return {
    kind: 'answer',
    text: t('chat.actionImpact.summary', r.totalActions, r.conversions, COP(r.revenue)),
  };
}

// ── Action learning (R-INTELLIGENCE-LEARNING-LOOP-V1) ────────
// Wraps existing action-impact attribution with a deterministic
// recommendation bucket. Pure read; no log writes; runs only on user query.
function handleActionLearning(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const r = getActionLearning(engine.getSales());
  if (r.totalActions === 0) {
    return { kind: 'answer', text: t('chat.actionLearning.empty') };
  }
  const ratePct = Math.round(r.conversionRate * 100);
  const recKey: Record<typeof r.recommendation, string> = {
    not_enough_data:    'chat.actionLearning.notEnoughData',
    needs_more_actions: 'chat.actionLearning.needsMoreActions',
    working:            'chat.actionLearning.working',
    keep_contacting:    'chat.actionLearning.keepContacting',
  };
  const lines = [
    t('chat.actionLearning.summary', r.totalActions, r.conversions, ratePct, COP(r.revenue)),
    '',
    t(recKey[r.recommendation]),
  ];
  return { kind: 'answer', text: lines.join('\n') };
}

// ── Propose Deal (R-INTELLIGENCE-PENDING-DEAL-V1) ───────────
// Owner-mediated deal drafting:
//   query → parse customer + product + price → buildPendingDeal → guard →
//   ChatActionUI(approve / cancel). Approval opens WhatsApp with the offer
//   text; the owner sends manually. NO cart write, NO inventory mutation,
//   NO checkout — guards (no_inventory_match, below_cost) short-circuit
//   before any queue item is created.
function handleProposeDeal(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const t = tChat(lang);
  const rawQuery = (match.query || '').toLowerCase();

  // Extract proposed price — first $-prefixed or bare decimal number.
  const priceMatch = rawQuery.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!priceMatch) {
    return { kind: 'error', text: t('chat.proposeDeal.missingPrice') };
  }
  const proposedPriceCents = Math.round(parseFloat(priceMatch[1]) * 100);
  if (proposedPriceCents <= 0) {
    return { kind: 'error', text: t('chat.proposeDeal.missingPrice') };
  }

  // Resolve customer — substring match against full name; fallback to first
  // name as a word-boundary match (avoids "Ana" matching "Banana").
  const customers = engine.getCustomers();
  const customerMatches = customers.filter((c) => {
    const name = (c.name || '').toLowerCase().trim();
    if (!name) return false;
    if (rawQuery.includes(name)) return true;
    const first = name.split(' ')[0] || '';
    if (first.length < 3) return false;
    const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(rawQuery);
  });
  if (customerMatches.length === 0) {
    return { kind: 'error', text: t('chat.proposeDeal.missingCustomer') };
  }
  if (customerMatches.length > 1) {
    return {
      kind: 'disambiguation',
      text: t(
        'chat.proposeDeal.ambiguousCustomer',
        customerMatches.slice(0, 5).map((c) => c.name).join(', '),
      ),
    };
  }
  const customer = customerMatches[0];

  // Resolve product — substring match against name; fallback to sku.
  const inventory = engine.getInventory();
  const itemMatches = inventory.filter((i) => {
    const name = (i.name || '').toLowerCase().trim();
    if (!name) return false;
    return rawQuery.includes(name);
  });
  if (itemMatches.length === 0) {
    const skuMatches = inventory.filter((i) => {
      const sku = ((i as { sku?: string }).sku || '').toLowerCase().trim();
      return !!sku && rawQuery.includes(sku);
    });
    if (skuMatches.length === 1) itemMatches.push(skuMatches[0]);
  }
  if (itemMatches.length === 0) {
    return { kind: 'error', text: t('chat.proposeDeal.missingProduct') };
  }
  if (itemMatches.length > 1) {
    return {
      kind: 'disambiguation',
      text: t(
        'chat.proposeDeal.ambiguousProduct',
        itemMatches.slice(0, 5).map((i) => i.name).join(', '),
      ),
    };
  }
  const item = itemMatches[0];

  const deal = buildPendingDeal(
    { customerId: customer.id, inventoryId: item.id, proposedPriceCents },
    engine,
  );

  if (deal.guardResult === 'no_inventory_match') {
    return { kind: 'error', text: t('chat.proposeDeal.noInventory') };
  }
  if (deal.guardResult === 'below_cost') {
    return {
      kind: 'error',
      text: t('chat.proposeDeal.belowCost', COP(deal.costCentsAtDraft || 0)),
    };
  }

  const action: ChatActionUI = {
    id: `deal-${Date.now()}-${customer.id}`,
    label: t('chat.proposeDeal.approveLabel', customer.name),
    actionType: 'whatsapp',
    queueKind: 'pending_deal',
    pendingDeal: deal,
    payload: {
      type: 'whatsapp',
      customMessage: deal.offerText,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: (customer as { phone?: string }).phone,
      executable: true,
      executionTarget: 'whatsapp_url',
    },
  };

  const draftText = t(
    'chat.proposeDeal.draft',
    customer.name, item.name,
    COP(deal.originalPriceCents), COP(deal.proposedPriceCents),
    deal.offerText,
  );

  return {
    kind: 'answer',
    text: `${t('chat.proposeDeal.header')}\n\n${draftText}`,
    actions: [action],
    // R-INTELLIGENCE-CONTEXT-MEMORY-V1: a successfully drafted deal
    // establishes the product as the active operational entity — the
    // owner is now thinking about this item; vague follow-ups should
    // route back to it.
    establishesContext: { type: 'product', value: item.name },
  };
}

// ── Proactive Opportunities (R-INTELLIGENCE-PROACTIVE-OPPORTUNITIES-V1) ─
// Composes 1-3 ranked operator opportunities from EXISTING engine helpers
// and the existing localStorage chat queue. Pure read — no engine writes,
// no background work, no polling, no AI. Runs ONLY when the user asks.
// Each candidate source is wrapped in try/catch so a missing/empty source
// silently skips without taking the others down.
function handleProactiveOpportunities(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);

  type Op = {
    title: string;
    reason: string;
    action: string;
    rank: number;
  };
  const ops: Op[] = [];

  // Source 1: Dead stock — reuses engine.getMissedRevenue().
  // Floor at $100 to filter noise from stores with one cheap dust-bunny.
  try {
    const missed = engine.getMissedRevenue();
    const dead = missed?.deadStockLockedCents ?? 0;
    if (dead >= 10000) {
      ops.push({
        title: t('chat.opportunities.deadStock.title'),
        reason: t('chat.opportunities.deadStock.reason', COP(dead)),
        action: t('chat.opportunities.deadStock.action'),
        rank: dead,
      });
    }
  } catch { /* skip */ }

  // Source 2: Repairs ready for pickup older than 3 days. Recoverable
  // revenue = sum of remaining balances. Caps the scan at the engine's
  // current repairs slice (already in memory; no external read).
  try {
    const repairs = engine.getRepairs();
    const PICKUP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let staleCount = 0;
    let recoverable = 0;
    for (const r of repairs) {
      const status = String((r as { status?: string }).status || '').toLowerCase();
      if (status !== 'ready') continue;
      const ca = (r as { completedAt?: unknown }).completedAt;
      if (!ca) continue;
      let ts = 0;
      try {
        const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
          ? (ca as { toDate: () => Date }).toDate()
          : (ca as string | Date);
        ts = new Date(d as string | Date).getTime();
      } catch { continue; }
      if (!Number.isFinite(ts) || ts === 0) continue;
      if ((now - ts) <= PICKUP_THRESHOLD_MS) continue;
      staleCount++;
      recoverable += (r as { balance?: number }).balance || 0;
    }
    if (staleCount > 0) {
      ops.push({
        title: t('chat.opportunities.staleRepairs.title'),
        reason: t('chat.opportunities.staleRepairs.reason', staleCount, COP(recoverable)),
        action: t('chat.opportunities.staleRepairs.action'),
        rank: recoverable + staleCount * 1000,
      });
    }
  } catch { /* skip */ }

  // Source 3: Outreach candidates — reuses engine.buildOutreachQueueItems().
  // The engine already applies consent + 24h dedup; we just count.
  // R-INTELLIGENCE-SIGNAL-QUALITY-V1: require >=2 candidates so a single
  // borderline customer doesn't burn an opportunity slot.
  try {
    const candidates = engine.buildOutreachQueueItems();
    if (candidates.length >= 2) {
      ops.push({
        title: t('chat.opportunities.outreach.title'),
        reason: t('chat.opportunities.outreach.reason', candidates.length),
        action: t('chat.opportunities.outreach.action'),
        rank: candidates.length * 500,
      });
    }
  } catch { /* skip */ }

  // Source 4: Top product opportunity — reuses engine.getProductOpportunities(1).
  // R-INTELLIGENCE-SIGNAL-QUALITY-V1: require impactCents >= $10 so noisy
  // tiny-margin entries don't surface as top-3 operator picks.
  try {
    const opps = engine.getProductOpportunities(1);
    if (opps && opps.length > 0) {
      const top = opps[0];
      const impact = top.impactCents || 0;
      if (impact >= 1000) {
        ops.push({
          title: t('chat.opportunities.productPush.title'),
          reason: t('chat.opportunities.productPush.reason', top.name, COP(impact)),
          action: t('chat.opportunities.productPush.action', top.name),
          rank: impact,
        });
      }
    }
  } catch { /* skip */ }

  // Source 5: Approved pending deals waiting to be closed. Reads the
  // existing chat queue localStorage key; cap scan at 200 entries (queue
  // is user-bounded but keep defensive). No new persistence.
  try {
    const raw = localStorage.getItem('cellhub:intelligence:automationQueue:v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const slice = parsed.length > 200 ? parsed.slice(parsed.length - 200) : parsed;
        let approved = 0;
        for (const q of slice) {
          if (q && q.kind === 'pending_deal' && q.status === 'approved') approved++;
        }
        if (approved > 0) {
          ops.push({
            title: t('chat.opportunities.pendingDeals.title'),
            reason: t('chat.opportunities.pendingDeals.reason', approved),
            action: t('chat.opportunities.pendingDeals.action'),
            rank: approved * 800,
          });
        }
      }
    }
  } catch { /* incognito / quota / parse fail — skip */ }

  if (ops.length === 0) {
    return { kind: 'answer', text: t('chat.opportunities.empty') };
  }

  ops.sort((a, b) => b.rank - a.rank);
  const top = ops.slice(0, 3);

  const lines: string[] = [];
  lines.push(t('chat.opportunities.header'));
  lines.push('');
  top.forEach((op, i) => {
    lines.push(`${i + 1}. ${op.title}`);
    lines.push(`   ${op.reason}`);
    lines.push(`   → ${op.action}`);
    if (i < top.length - 1) lines.push('');
  });

  return { kind: 'answer', text: lines.join('\n') };
}

// R-INTELLIGENCE-CONVERSATION-RUNNER-MODULE-V1: extracted to its own
// module (./conversationRunner.ts). The dispatcher case below imports
// handleConversationRunner; everything else stays unchanged.

// ── Deal Performance (R-INTELLIGENCE-DEAL-PERFORMANCE-INSIGHTS-V1) ─
// Reads getDealOutcomeLog() (via getDealPerformance aggregator) and returns
// a deterministic summary + recommendation. Pure read; no UI, no charts,
// no autonomous learning. Runs only on user query.
function handleDealPerformance(lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const r = getDealPerformance();

  if (r.totalDeals < 3) {
    return { kind: 'answer', text: t('chat.dealPerformance.notEnoughData') };
  }
  if (r.won === 0) {
    return { kind: 'answer', text: t('chat.dealPerformance.noWins') };
  }

  const winRatePct = Math.round(r.winRate * 100);
  const lines: string[] = [];
  lines.push(t('chat.dealPerformance.header'));
  lines.push(t('chat.dealPerformance.summary', r.totalDeals, r.won, winRatePct, r.avgDiscountPercent));

  if (r.bestCategory) {
    lines.push(t('chat.dealPerformance.bestCategory', r.bestCategory.category, r.bestCategory.wins));
  }
  if (r.bestDiscountRange) {
    const rangeRatePct = Math.round(r.bestDiscountRange.winRate * 100);
    lines.push(t(
      'chat.dealPerformance.bestDiscountRange',
      r.bestDiscountRange.range, rangeRatePct, r.bestDiscountRange.sample,
    ));
  }
  lines.push('');
  lines.push(t('chat.dealPerformance.recommendation', winRatePct, r.avgDiscountPercent));

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Daily Operator Brief (R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-V1) ──
// Action-first daily focus list. Composes max 3 priorities from existing
// engine helpers + the existing chat queue. Pure read — no engine writes,
// no background work, no polling, no AI. Each source is wrapped in
// try/catch so a missing/empty source silently skips. Reuses the same
// `chat.opportunities.*` translation keys as proactive_opportunities for
// the per-priority Why/Action lines (no new strings duplicated).
function handleDailyOperatorBrief(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  type Pri = { title: string; why: string; action: string; rank: number };
  const pris: Pri[] = [];

  // Source 1: No sales today (highest urgency — always wins #1).
  try {
    const m = engine.getTodayMetrics();
    if (m && m.transactions === 0) {
      pris.push({
        title: t('chat.dailyBrief2.noSalesToday.title'),
        why: t('chat.dailyBrief2.noSalesToday.why'),
        action: t('chat.dailyBrief2.noSalesToday.action'),
        rank: 99999,
      });
    }
  } catch { /* skip */ }

  // Source 2: Stale repairs ready for pickup (>3 days).
  try {
    const repairs = engine.getRepairs();
    const PICKUP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let staleCount = 0;
    let recoverable = 0;
    for (const r of repairs) {
      const status = String((r as { status?: string }).status || '').toLowerCase();
      if (status !== 'ready') continue;
      const ca = (r as { completedAt?: unknown }).completedAt;
      if (!ca) continue;
      let ts = 0;
      try {
        const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
          ? (ca as { toDate: () => Date }).toDate()
          : (ca as string | Date);
        ts = new Date(d as string | Date).getTime();
      } catch { continue; }
      if (!Number.isFinite(ts) || ts === 0) continue;
      if ((now - ts) <= PICKUP_THRESHOLD_MS) continue;
      staleCount++;
      recoverable += (r as { balance?: number }).balance || 0;
    }
    if (staleCount > 0) {
      pris.push({
        title: t('chat.opportunities.staleRepairs.title'),
        why: t('chat.opportunities.staleRepairs.reason', staleCount, COP(recoverable)),
        action: t('chat.opportunities.staleRepairs.action'),
        rank: recoverable + staleCount * 1000,
      });
    }
  } catch { /* skip */ }

  // Source 3: Outreach candidates (consent + 24h dedup already applied).
  try {
    const candidates = engine.buildOutreachQueueItems();
    if (candidates.length >= 2) {
      pris.push({
        title: t('chat.opportunities.outreach.title'),
        why: t('chat.opportunities.outreach.reason', candidates.length),
        action: t('chat.opportunities.outreach.action'),
        rank: candidates.length * 500,
      });
    }
  } catch { /* skip */ }

  // Source 4: Approved pending deals waiting in chat queue (cap 200 entries).
  try {
    const raw = localStorage.getItem('cellhub:intelligence:automationQueue:v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const slice = parsed.length > 200 ? parsed.slice(parsed.length - 200) : parsed;
        let approved = 0;
        for (const q of slice) {
          if (q && q.kind === 'pending_deal' && q.status === 'approved') approved++;
        }
        if (approved > 0) {
          pris.push({
            title: t('chat.opportunities.pendingDeals.title'),
            why: t('chat.opportunities.pendingDeals.reason', approved),
            action: t('chat.opportunities.pendingDeals.action'),
            rank: approved * 800,
          });
        }
      }
    }
  } catch { /* incognito / quota / parse fail — skip */ }

  // Source 5: Strong product opportunity (impact >= $10).
  try {
    const opps = engine.getProductOpportunities(1);
    if (opps && opps.length > 0) {
      const top = opps[0];
      const impact = top.impactCents || 0;
      if (impact >= 1000) {
        pris.push({
          title: t('chat.opportunities.productPush.title'),
          why: t('chat.opportunities.productPush.reason', top.name, COP(impact)),
          action: t('chat.opportunities.productPush.action', top.name),
          rank: impact,
        });
      }
    }
  } catch { /* skip */ }

  // Source 6: Dead stock locked (>= $100).
  try {
    const missed = engine.getMissedRevenue();
    const dead = missed?.deadStockLockedCents ?? 0;
    if (dead >= 10000) {
      pris.push({
        title: t('chat.opportunities.deadStock.title'),
        why: t('chat.opportunities.deadStock.reason', COP(dead)),
        action: t('chat.opportunities.deadStock.action'),
        rank: dead,
      });
    }
  } catch { /* skip */ }

  if (pris.length === 0) {
    return { kind: 'answer', text: `${t('chat.dailyBrief2.header')}\n\n${t('chat.dailyBrief2.empty')}` };
  }

  pris.sort((a, b) => b.rank - a.rank);
  const top3 = pris.slice(0, 3);

  const lines: string[] = [];
  lines.push(t('chat.dailyBrief2.header'));
  lines.push('');
  top3.forEach((p, i) => {
    lines.push(`${i + 1}. ${t('chat.dailyBrief2.priorityLabel')} ${p.title}`);
    lines.push(`   ${t('chat.dailyBrief2.whyLabel')} ${p.why}`);
    lines.push(`   ${t('chat.dailyBrief2.actionLabel')} ${p.action}`);
    if (i < top3.length - 1) lines.push('');
  });

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Today Money Map (R-INTELLIGENCE-TODAY-MONEY-MAP-V1) ──────
// Tactical "where can revenue move fastest TODAY" — ranks by speed-to-
// close, not theoretical impact. Reuses the same engine helpers as the
// daily-operator-brief / proactive-opportunities composers but biases
// toward already-approved deals + money-already-owed signals. Pure
// deterministic read; no engine mutation, no AI, no auto-send.
function handleTodayMoneyMap(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  type Mo = { title: string; money: string; move: string; rank: number };
  const ops: Mo[] = [];

  // Source 1: Stale ready repairs (>= $20 recoverable, > 3 days waiting).
  // "money already owed" — boosted rank.
  try {
    const repairs = engine.getRepairs();
    const PICKUP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let staleCount = 0;
    let recoverable = 0;
    for (const r of repairs) {
      const status = String((r as { status?: string }).status || '').toLowerCase();
      if (status !== 'ready') continue;
      const ca = (r as { completedAt?: unknown }).completedAt;
      if (!ca) continue;
      let ts = 0;
      try {
        const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
          ? (ca as { toDate: () => Date }).toDate()
          : (ca as string | Date);
        ts = new Date(d as string | Date).getTime();
      } catch { continue; }
      if (!Number.isFinite(ts) || ts === 0) continue;
      if ((now - ts) <= PICKUP_THRESHOLD_MS) continue;
      staleCount++;
      recoverable += (r as { balance?: number }).balance || 0;
    }
    if (staleCount > 0 && recoverable >= 2000) {
      ops.push({
        title: t('chat.opportunities.staleRepairs.title'),
        money: t('chat.opportunities.staleRepairs.reason', staleCount, COP(recoverable)),
        move: t('chat.opportunities.staleRepairs.action'),
        rank: recoverable + staleCount * 1500,
      });
    }
  } catch { /* skip */ }

  // Source 2: Approved pending deals — already-approved is the fastest
  // close path; bias toward the top of the briefing.
  try {
    const raw = localStorage.getItem('cellhub:intelligence:automationQueue:v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const slice = parsed.length > 200 ? parsed.slice(parsed.length - 200) : parsed;
        let approved = 0;
        for (const q of slice) {
          if (q && q.kind === 'pending_deal' && q.status === 'approved') approved++;
        }
        if (approved > 0) {
          ops.push({
            title: t('chat.opportunities.pendingDeals.title'),
            money: t('chat.opportunities.pendingDeals.reason', approved),
            move: t('chat.opportunities.pendingDeals.action'),
            rank: approved * 2000,
          });
        }
      }
    }
  } catch { /* skip */ }

  // Source 3: Strong product opportunity (>= $10 impact). Theoretical —
  // de-prioritized vs already-approved deals.
  try {
    const opps = engine.getProductOpportunities(1);
    if (opps && opps.length > 0) {
      const top = opps[0];
      const impact = top.impactCents || 0;
      if (impact >= 1000) {
        ops.push({
          title: t('chat.opportunities.productPush.title'),
          money: t('chat.opportunities.productPush.reason', top.name, COP(impact)),
          move: t('chat.opportunities.productPush.action', top.name),
          rank: impact,
        });
      }
    }
  } catch { /* skip */ }

  // Source 4: Outreach candidates (>= 2). Immediate-contact opportunity.
  try {
    const candidates = engine.buildOutreachQueueItems();
    if (candidates.length >= 2) {
      ops.push({
        title: t('chat.opportunities.outreach.title'),
        money: t('chat.opportunities.outreach.reason', candidates.length),
        move: t('chat.opportunities.outreach.action'),
        rank: candidates.length * 600,
      });
    }
  } catch { /* skip */ }

  // Source 5: Dead stock liquidation (>= $100 locked). Low-dollar
  // inventory de-prioritized — rank halved.
  try {
    const missed = engine.getMissedRevenue();
    const dead = missed?.deadStockLockedCents ?? 0;
    if (dead >= 10000) {
      ops.push({
        title: t('chat.opportunities.deadStock.title'),
        money: t('chat.opportunities.deadStock.reason', COP(dead)),
        move: t('chat.opportunities.deadStock.action'),
        rank: Math.floor(dead / 2),
      });
    }
  } catch { /* skip */ }

  if (ops.length === 0) {
    return { kind: 'answer', text: `${t('chat.moneyMap.header')}\n\n${t('chat.moneyMap.empty')}` };
  }

  ops.sort((a, b) => b.rank - a.rank);
  const top3 = ops.slice(0, 3);

  const lines: string[] = [];
  lines.push(t('chat.moneyMap.header'));
  lines.push('');
  top3.forEach((o, i) => {
    lines.push(`${i + 1}. ${t('chat.moneyMap.opportunityLabel')} ${o.title}`);
    lines.push(`   ${t('chat.moneyMap.moneyLabel')} ${o.money}`);
    lines.push(`   ${t('chat.moneyMap.moveLabel')} ${o.move}`);
    if (i < top3.length - 1) lines.push('');
  });

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Operator Mode (R-INTELLIGENCE-OPERATOR-MODE-V1) ──────────
// Combines 5 distinct intelligence sources into ONE coordinated action
// plan. Reuses existing engine helpers + the existing chat queue
// localStorage; no new infrastructure. Pure deterministic composition —
// no AI agents, no orchestration engine, no scheduler, no memory layer.
// Each source is wrapped in try/catch so a missing/empty source skips.
function handleOperatorMode(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  type Plan = {
    title: string;
    why: string;
    move: string;
    actions?: ChatActionUI[];
    rank: number;
  };
  const plan: Plan[] = [];

  // Source 1: Stale ready repairs — money already owed, fastest collect.
  try {
    const repairs = engine.getRepairs();
    const PICKUP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let staleCount = 0;
    let recoverable = 0;
    for (const r of repairs) {
      const status = String((r as { status?: string }).status || '').toLowerCase();
      if (status !== 'ready') continue;
      const ca = (r as { completedAt?: unknown }).completedAt;
      if (!ca) continue;
      let ts = 0;
      try {
        const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
          ? (ca as { toDate: () => Date }).toDate()
          : (ca as string | Date);
        ts = new Date(d as string | Date).getTime();
      } catch { continue; }
      if (!Number.isFinite(ts) || ts === 0) continue;
      if ((now - ts) <= PICKUP_THRESHOLD_MS) continue;
      staleCount++;
      recoverable += (r as { balance?: number }).balance || 0;
    }
    if (staleCount > 0 && recoverable >= 2000) {
      plan.push({
        title: t('chat.opportunities.staleRepairs.title'),
        why: t('chat.opportunities.staleRepairs.reason', staleCount, COP(recoverable)),
        move: t('chat.opportunities.staleRepairs.action'),
        rank: recoverable + staleCount * 1500,
      });
    }
  } catch { /* skip */ }

  // Source 2: Approved pending deals — easiest execution + same-day close.
  // Highest rank weight per spec ordering rules.
  try {
    const raw = localStorage.getItem('cellhub:intelligence:automationQueue:v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const slice = parsed.length > 200 ? parsed.slice(parsed.length - 200) : parsed;
        let approved = 0;
        for (const q of slice) {
          if (q && q.kind === 'pending_deal' && q.status === 'approved') approved++;
        }
        if (approved > 0) {
          plan.push({
            title: t('chat.opportunities.pendingDeals.title'),
            why: t('chat.opportunities.pendingDeals.reason', approved),
            move: t('chat.opportunities.pendingDeals.action'),
            rank: approved * 2000,
          });
        }
      }
    }
  } catch { /* skip */ }

  // Source 3: Top outreach candidate — best customer to contact.
  try {
    const candidates = engine.buildOutreachQueueItems();
    if (candidates.length >= 2) {
      plan.push({
        title: t('chat.opportunities.outreach.title'),
        why: t('chat.opportunities.outreach.reason', candidates.length),
        move: t('chat.opportunities.outreach.action'),
        rank: candidates.length * 600,
      });
    }
  } catch { /* skip */ }

  // Source 4: Top product opportunity — attaches a "Promote {name}"
  // chat-replay button per R-INTELLIGENCE-ACTION-BUTTONS-V1 (existing
  // safe path; no new execution system).
  try {
    const opps = engine.getProductOpportunities(1);
    if (opps && opps.length > 0) {
      const top = opps[0];
      const impact = top.impactCents || 0;
      if (impact >= 1000) {
        const promoteAction: ChatActionUI = {
          id: `op-mode-promote-${top.name}-${Date.now()}`,
          label: t('chat.productOps.promoteAction', top.name),
          actionType: 'whatsapp',
          triggerQuery: `promote ${top.name}`,
          payload: {
            type: 'whatsapp',
            executable: true,
            executionTarget: 'none',
          },
        };
        plan.push({
          title: t('chat.opportunities.productPush.title'),
          why: t('chat.opportunities.productPush.reason', top.name, COP(impact)),
          move: t('chat.opportunities.productPush.action', top.name),
          actions: [promoteAction],
          rank: impact,
        });
      }
    }
  } catch { /* skip */ }

  // Source 5: Operational risk — dead stock locked.
  try {
    const missed = engine.getMissedRevenue();
    const dead = missed?.deadStockLockedCents ?? 0;
    if (dead >= 10000) {
      plan.push({
        title: t('chat.opportunities.deadStock.title'),
        why: t('chat.opportunities.deadStock.reason', COP(dead)),
        move: t('chat.opportunities.deadStock.action'),
        rank: Math.floor(dead / 2),
      });
    }
  } catch { /* skip */ }

  if (plan.length === 0) {
    return { kind: 'answer', text: `${t('chat.operatorMode.header')}\n\n${t('chat.operatorMode.empty')}` };
  }

  plan.sort((a, b) => b.rank - a.rank);
  const top = plan.slice(0, 5);

  // Collect any inline action buttons across the priorities.
  const actions: ChatActionUI[] = [];
  for (const p of top) {
    if (p.actions) actions.push(...p.actions);
  }

  const lines: string[] = [];
  lines.push(t('chat.operatorMode.header'));
  lines.push('');
  top.forEach((p, i) => {
    lines.push(`${i + 1}. ${t('chat.operatorMode.focusLabel')} ${p.title}`);
    lines.push(`   ${t('chat.operatorMode.whyLabel')} ${p.why}`);
    lines.push(`   ${t('chat.operatorMode.moveLabel')} ${p.move}`);
    if (i < top.length - 1) lines.push('');
  });

  return {
    kind: 'answer',
    text: lines.join('\n'),
    actions: actions.length > 0 ? actions : undefined,
  };
}

// ── Proposal Follow-up Inbox (R-INTELLIGENCE-PROPOSAL-FOLLOWUP-INBOX-V1)
// Manual-only follow-up tracker for WhatsApp proposals. Owner clicks
// Open WhatsApp → IntelligenceChat records a 'sent' follow-up; owner
// later pastes a reply → record_reply handler links + classifies.
// Pure deterministic — no inbound API, no scraping, no auto-send.

function formatTimeSince(t: (key: string, ...args: unknown[]) => string, ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return t('chat.followups.timeMinutes', minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('chat.followups.timeHours', hours);
  const days = Math.floor(hours / 24);
  return t('chat.followups.timeDays', days);
}

// Parse a pasted reply query — supports both colon-anchored
// ("Juan replied: ...") and non-colon ("Juan replied I'll take it",
// "Maria said she wants pictures") patterns. Pure regex; no engine call.
function parseReplyQuery(rawQuery: string): { name?: string; replyText: string } | null {
  const q = rawQuery.trim();
  if (!q) return null;
  // Single regex covers EN/ES/PT verbs with optional colon. Captures
  // the first split point — words BEFORE belong to the name slot,
  // words AFTER are the reply text.
  const splitRegex = /\b(replied|reply|said|respondi[óo]|respondeu|contest[óo]|me dijo|me respondeu)\b\s*:?\s*/i;
  const m = q.match(splitRegex);
  if (!m || m.index === undefined) return null;
  const before = q.slice(0, m.index).trim();
  const after = q.slice(m.index + m[0].length).trim();
  if (!after) return null;
  // Strip leading filler words from "before" to leave just the name.
  const name = before
    .replace(/^(customer|el cliente|la cliente|cliente|el|la|the|mi cliente|o cliente|a cliente)\s+/i, '')
    .trim();
  return { name: name || undefined, replyText: after };
}

// R-INTELLIGENCE-DEAL-PIPELINE-V1: deterministic mapping from a
// classified reply category to the corresponding deal stage.
function categoryToStage(cat: ReplyCategory): DealStage {
  switch (cat) {
    case 'READY_TO_BUY':       return 'pending_pickup';
    case 'PRICE_NEGOTIATION':
    case 'PRICE_TOO_HIGH':     return 'negotiating';
    case 'INTERESTED':
    case 'ASKING_PHOTOS':
    case 'ASKING_LOCATION':
    case 'HOLD_REQUEST':       return 'interested';
    case 'MAYBE_LATER':
    case 'UNKNOWN':
    default:                   return 'customer_replied';
  }
}

// Single intent handler — branches on whether the query parses as a
// pasted reply ("{name} replied ...") or is a list query ("who needs
// follow up?"). Pure deterministic; reuses handleConversationRunner
// for the suggested-move briefing on reply-record path.
function handleProposalFollowup(match: IntentMatch, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const rawQuery = (match.query || '').trim();

  // Branch A: pasted reply path
  const parsed = parseReplyQuery(rawQuery);
  if (parsed) {
    const followup = findOpenFollowupByCustomerOrProduct(parsed.name);
    if (!followup) {
      return { kind: 'answer', text: t('chat.followups.replyNoMatch') };
    }
    updateProposalFollowup(followup.id, {
      status: 'replied',
      lastReplyText: parsed.replyText,
      lastReplyAt: Date.now(),
    });
    // R-INTELLIGENCE-DEAL-PIPELINE-V1: map the classified reply to a
    // pipeline stage and update the matching open deal in place. No
    // pipeline mutation if no deal exists for this customer.
    const replyCategory = classifyReply(parsed.replyText);
    const newStage = categoryToStage(replyCategory);
    const deal = findOpenDealByCustomerOrProduct(
      parsed.name || followup.customerName,
      followup.customerPhone,
      followup.productName,
    );
    if (deal) {
      updateDealPipelineItem(deal.id, {
        stage: newStage,
        lastReplyText: parsed.replyText,
        lastRecommendation: replyCategory,
      });
    }
    // Defer to conversation runner for the suggested move. Pass the
    // parsed reply text only so the classifier reads the reply alone.
    const innerMatch: IntentMatch = { id: 'conversation_runner', confidence: 1, query: parsed.replyText };
    const sub = handleConversationRunner(innerMatch, lang);
    const customer = followup.customerName || parsed.name || t('chat.followups.unknownCustomer');
    const lead = t('chat.followups.replyHeader', customer);
    return { kind: 'answer', text: `${lead}\n\n${sub.text}` };
  }

  // Branch B: list-open-followups path
  const all = getProposalFollowups();
  const open = all.filter(
    (f) => f.status === 'sent' || f.status === 'replied' || f.status === 'interested',
  );
  if (open.length === 0) {
    return { kind: 'answer', text: `${t('chat.followups.headerEmpty')}\n\n${t('chat.followups.empty')}` };
  }
  // Ranking: oldest unanswered first (sent), then replied/interested
  // (most recent activity), then recent sent. Group + sort.
  const now = Date.now();
  open.sort((a, b) => {
    // Oldest sent (no reply yet) gets top priority.
    const aAge = a.status === 'sent' ? (now - a.sentAt) : 0;
    const bAge = b.status === 'sent' ? (now - b.sentAt) : 0;
    if (aAge !== bAge) return bAge - aAge;
    // Then by status weight: replied/interested (active) > sent (cold).
    const w = (s: string) => (s === 'interested' ? 3 : s === 'replied' ? 2 : 1);
    return w(b.status) - w(a.status);
  });
  const top = open.slice(0, 5);
  const lines: string[] = [];
  lines.push(t('chat.followups.header', open.length));
  lines.push('');
  top.forEach((f, i) => {
    const customer = f.customerName || f.customerPhone || t('chat.followups.unknownCustomer');
    const product = f.productName || t('chat.followups.unknownProduct');
    const since = formatTimeSince(t, now - f.sentAt);
    lines.push(`${i + 1}. ${customer} · ${product} · ${since}`);
    lines.push(`   ${t('chat.followups.statusLabel')} ${t(`chat.followups.status.${f.status}`)}`);
    lines.push(`   ${t('chat.followups.suggestLabel')} ${t(`chat.followups.suggest.${f.status}`)}`);
    if (i < top.length - 1) lines.push('');
  });
  return { kind: 'answer', text: lines.join('\n') };
}

// ── Deal Pipeline (R-INTELLIGENCE-DEAL-PIPELINE-V1) ──────────
// Manual sales-pipeline tracker. List + manual stage update only — no
// autonomous transitions. Stage changes from owner pasting a customer
// reply happen inside handleProposalFollowup above; this section
// handles "active deals" listing + "mark X deal won/lost" commands.

const DEAL_STAGE_RANK: Record<DealStage, number> = {
  pending_pickup:    100,
  pending_approval:  90,
  negotiating:       80,
  interested:        70,
  customer_replied:  60,
  proposal_sent:     50,
  won:               0,   // suppressed from active list
  lost:              0,   // suppressed from active list
};

function handleDealPipeline(lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const all = getDealPipeline();
  const active = all.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  if (active.length === 0) {
    return { kind: 'answer', text: `${t('chat.dealPipeline.headerEmpty')}\n\n${t('chat.dealPipeline.empty')}` };
  }
  // Rank by stage priority desc, then most recently updated.
  active.sort((a, b) => {
    const sa = DEAL_STAGE_RANK[a.stage] || 0;
    const sb = DEAL_STAGE_RANK[b.stage] || 0;
    if (sa !== sb) return sb - sa;
    return b.updatedAt - a.updatedAt;
  });
  const top = active.slice(0, 5);
  const lines: string[] = [];
  lines.push(t('chat.dealPipeline.header', active.length));
  lines.push('');
  top.forEach((d, i) => {
    const customer = d.customerName || d.customerPhone || t('chat.dealPipeline.unknownCustomer');
    const product = d.productName || t('chat.dealPipeline.unknownProduct');
    lines.push(`${i + 1}. ${customer} · ${product}`);
    lines.push(`   ${t('chat.dealPipeline.stageLabel')} ${t(`chat.dealPipeline.stage.${d.stage}`)}`);
    if (d.lastReplyText) {
      const reply = d.lastReplyText.length > 80 ? d.lastReplyText.slice(0, 80) + '…' : d.lastReplyText;
      lines.push(`   ${t('chat.dealPipeline.replyLabel')} "${reply}"`);
    }
    lines.push(`   ${t('chat.dealPipeline.moveLabel')} ${t(`chat.dealPipeline.move.${d.stage}`)}`);
    if (i < top.length - 1) lines.push('');
  });
  return { kind: 'answer', text: lines.join('\n') };
}

// Parse "mark Juan deal won" / "Juan trato ganado" / "mark Maria deal
// pending pickup" / "Pedro venda fechada" — extract { name, stage }.
// Pure regex; no engine call.
function parseMarkDealQuery(rawQuery: string): { name?: string; stage: DealStage } | null {
  const q = rawQuery.toLowerCase().trim();
  if (!q) return null;
  // Stage keyword detection — first match wins.
  const stagePatterns: Array<{ pat: RegExp; stage: DealStage }> = [
    { pat: /\b(deal|trato|venda)\b.*\b(won|ganado|ganho|fechad[ao])\b/, stage: 'won' },
    { pat: /\b(deal|trato|venda|negocio|negócio)\b.*\b(lost|perdid[ao])\b/, stage: 'lost' },
    { pat: /\b(deal|trato|venda)\b.*\b(pending pickup|pickup|recogida|retirada)\b/, stage: 'pending_pickup' },
    { pat: /\b(deal|trato|venda)\b.*\b(pending|pendiente)\b/, stage: 'pending_approval' },
    { pat: /\b(won|ganado|ganho|fechad[ao]|cerrad[ao])\b/, stage: 'won' },
    { pat: /\b(lost|perdid[ao])\b/, stage: 'lost' },
  ];
  let matchedStage: DealStage | null = null;
  for (const sp of stagePatterns) {
    if (sp.pat.test(q)) {
      matchedStage = sp.stage;
      break;
    }
  }
  if (!matchedStage) return null;
  // Extract name — strip command verbs and stage keywords, keep the rest.
  const name = q
    .replace(/\b(mark|marcar|el|la|the)\b/g, '')
    .replace(/\b(deal|trato|venda|negocio|negócio|sale|venta)\b/g, '')
    .replace(/\b(won|lost|ganado|perdido|ganho|fechad[ao]|cerrad[ao]|pending(?: pickup)?|pendiente|recogida|retirada|perdid[ao])\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { name: name || undefined, stage: matchedStage };
}

function handleMarkDealStage(match: IntentMatch, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const rawQuery = (match.query || '').trim();
  const parsed = parseMarkDealQuery(rawQuery);
  if (!parsed) {
    return { kind: 'help', text: t('chat.dealPipeline.markHowTo') };
  }
  const deal = findOpenDealByCustomerOrProduct(parsed.name);
  if (!deal) {
    return { kind: 'answer', text: t('chat.dealPipeline.markNoMatch') };
  }
  if (parsed.stage === 'won' || parsed.stage === 'lost') {
    closeDealPipelineItem(deal.id, parsed.stage);
  } else {
    updateDealPipelineItem(deal.id, { stage: parsed.stage });
  }
  const customer = deal.customerName || parsed.name || t('chat.dealPipeline.unknownCustomer');
  return {
    kind: 'answer',
    text: t('chat.dealPipeline.markedHeader', customer, t(`chat.dealPipeline.stage.${parsed.stage}`)),
  };
}

// ── Daily Brief (R-DAILY-BRIEF-HANDLER-V1) ──────────────────
// Composes existing engine signals into one action-first answer. Pure read —
// no queue writes, no side effects. Customer name is resolved via
// engine.getCustomerHistory(customerId) because ActionQueueItem has no name
// field (deliberate — queue is keyed on customerId + phone for dedup).
function handleDailyBrief(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const b = engine.getDailyBrief();

  const lines: string[] = [];
  lines.push(t('chat.dailyBrief.header'));
  lines.push(t('chat.dailyBrief.today', COP(b.today.revenueCents), b.today.transactions));

  if (b.outreach.length > 0) {
    const top = b.outreach[0];
    const h = top.customerId ? engine.getCustomerHistory(top.customerId) : null;
    const name = h?.customer.name || top.phone || '';
    if (name) lines.push(t('chat.dailyBrief.outreach', name));
  }

  if (b.reorder.length > 0) {
    lines.push(t('chat.dailyBrief.reorder', b.reorder[0].name));
  }

  if (b.missed.slowDayLossCents > 0) {
    lines.push(t('chat.dailyBrief.slowDay'));
  }

  if (b.missed.deadStockLockedCents > 0) {
    lines.push(t('chat.dailyBrief.deadStock'));
  }

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Sales summary ───────────────────────────────────────────
function handleSalesSummary(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const kpi = result.kpiDashboard;
  const trendArrow = kpi.revenue.trend === 'up' ? '📈'
    : kpi.revenue.trend === 'down' ? '📉' : '→';
  const topItem = kpi.topItems?.[0];

  const lines: string[] = [];
  lines.push(es
    ? `Ingresos últimos 30 días: ${COP(kpi.revenue.current)} ${trendArrow} ${kpi.revenue.trendPercent >= 0 ? '+' : ''}${kpi.revenue.trendPercent.toFixed(1)}% vs semana pasada.`
    : `Last 30 days revenue: ${COP(kpi.revenue.current)} ${trendArrow} ${kpi.revenue.trendPercent >= 0 ? '+' : ''}${kpi.revenue.trendPercent.toFixed(1)}% vs last week.`);
  lines.push(es
    ? `${kpi.transactions.count} transacciones, ticket promedio ${COP(kpi.transactions.avgSize)}.`
    : `${kpi.transactions.count} transactions, avg ticket ${COP(kpi.transactions.avgSize)}.`);
  if (topItem) {
    lines.push(es
      ? `Top seller: ${topItem.name} (${topItem.quantity} uds, ${COP(topItem.revenue)}).`
      : `Top seller: ${topItem.name} (${topItem.quantity} units, ${COP(topItem.revenue)}).`);
  }
  return { kind: 'answer', text: lines.join('\n') };
}

// ── Inventory low-stock / reorder recommendations ───────────
// R-INTEL-2-REORDER: upgraded from binary alert to full recommendation
// list with suggested qty, priority, and lost-revenue risk.
function handleInventoryLow(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const recs = engine.getReorderRecommendations();

  if (recs.length === 0) {
    return { kind: 'answer', text: t('chat.reorder.empty') };
  }

  const PRIORITY_LABEL: Record<string, string> = {
    CRITICAL: t('chat.reorder.priorityCritical'),
    HIGH:     t('chat.reorder.priorityHigh'),
    MEDIUM:   t('chat.reorder.priorityMedium'),
    LOW:      t('chat.reorder.priorityLow'),
  };

  const lines = recs.slice(0, 8).map(r => {
    const daysRounded = Math.round(r.daysLeft);
    const days = r.daysLeft < 1 ? t('chat.reorder.daysLessThanOne') : t('chat.reorder.days', daysRounded);
    const risk = r.lostRevenueRiskCents > 0
      ? ` ⚠️ ${COP(r.lostRevenueRiskCents)} ${t('chat.reorder.risk')}`
      : '';
    return `${PRIORITY_LABEL[r.priority]} • ${r.name} — ${t('chat.reorder.orderVerb')} ${r.suggestedOrderQty} ${t('chat.reorder.units')} (${days}${risk})`;
  });

  return { kind: 'answer', text: `${t('chat.reorder.header', recs.length)}\n${lines.join('\n')}` };
}

// ── Inventory dead-stock ────────────────────────────────────
function handleInventoryDead(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const count = result.kpiDashboard.inventory.deadStockCount;
  const insights = result.insights.filter((i) => i.id === 'inventory-dead-stock');
  const dead = insights[0];

  if (count === 0) {
    return {
      kind: 'answer',
      text: es ? 'No hay stock muerto. Todo tu inventario se está moviendo.' : 'No dead stock. All inventory is moving.',
    };
  }

  const data = dead?.data as { items?: Array<{ name: string; qty: number }> } | undefined;
  const items = data?.items?.slice(0, 5) || [];
  const list = items.map(i => `• ${i.name} (${i.qty} uds)`).join('\n');
  return {
    kind: 'answer',
    text: es
      ? `${count} artículos con stock muerto (sin ventas en 60+ días):\n${list}\n\nConsidera precios de liquidación.`
      : `${count} items in dead stock (no sales 60+ days):\n${list}\n\nConsider clearance pricing.`,
  };
}

// ── Inventory dying (velocity-based F2) ─────────────────────
function handleInventoryDying(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const dying = result.insights.find((i) => i.id === 'inventory-dying-stock');

  if (!dying) {
    return {
      kind: 'answer',
      text: es ? 'No hay artículos perdiendo velocidad significativa.' : 'No items losing significant momentum.',
    };
  }

  const data = dying.data as {
    items?: Array<{ name: string; velocity: number; salesLastWindow: number }>
  } | undefined;
  const items = data?.items?.slice(0, 5) || [];
  const list = items
    .map((i) => `• ${i.name} (velocity ${(i.velocity * 100).toFixed(0)}%, ${i.salesLastWindow} uds últimos 90d)`)
    .join('\n');

  return {
    kind: 'answer',
    text: es
      ? `Artículos perdiendo velocidad:\n${list}\n\nActúa antes de que caigan muertos.`
      : `Items losing momentum:\n${list}\n\nAct before they go fully dead.`,
  };
}

// ── Top items ───────────────────────────────────────────────
function handleTopItems(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const top = result.kpiDashboard.topItems || [];
  if (top.length === 0) {
    return { kind: 'answer', text: es ? 'Sin datos de ventas todavía.' : 'No sales data yet.' };
  }
  const list = top
    .slice(0, 5)
    .map((t, idx) => `${idx + 1}. ${t.name} — ${t.quantity} uds, ${COP(t.revenue)}`)
    .join('\n');
  return {
    kind: 'answer',
    text: es ? `Tus top 5 artículos (últimos 30 días):\n${list}` : `Your top 5 items (last 30 days):\n${list}`,
  };
}

// ── Repairs overdue ─────────────────────────────────────────
function handleRepairsOverdue(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const overdue = result.kpiDashboard.repairs.overdue;
  const pending = result.kpiDashboard.repairs.pending;
  if (overdue === 0) {
    return {
      kind: 'answer',
      text: es
        ? `Sin reparaciones atrasadas. ${pending} completadas recientemente.`
        : `No overdue repairs. ${pending} completed recently.`,
    };
  }
  return {
    kind: 'answer',
    text: es
      ? `🔧 ${overdue} reparaciones atrasadas (>7 días sin completar). Ve al módulo Repairs para revisarlas.`
      : `🔧 ${overdue} overdue repairs (>7 days without completion). Check the Repairs module to follow up.`,
  };
}

// ── Health check ────────────────────────────────────────────
function handleHealthCheck(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const h = result.healthScore;
  const factors = h.factors.length > 0
    ? `\n\n${es ? 'Factores' : 'Factors'}: ${h.factors.join(', ')}.`
    : '';
  return {
    kind: 'answer',
    text: es
      ? `Salud de la tienda: ${h.grade} (${h.score}/100).${factors}`
      : `Store health: ${h.grade} (${h.score}/100).${factors}`,
  };
}

// ── Forecast items ──────────────────────────────────────────
function handleForecastItems(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const forecasts = result.insights.filter((i) => i.id.startsWith('sales-forecast-'));
  if (forecasts.length === 0) {
    return {
      kind: 'answer',
      text: es
        ? 'Sin señales de proyección confiables (necesita >=14 días de ventas por SKU).'
        : 'No reliable forecast signals (need >=14 days of sales per SKU).',
    };
  }
  const lines = forecasts.slice(0, 5).map((f) => `• ${es ? f.descriptionEs : f.description}`).join('\n');
  return {
    kind: 'answer',
    text: es ? `Proyecciones activas:\n${lines}` : `Active forecasts:\n${lines}`,
  };
}

// ── Anomaly days ────────────────────────────────────────────
function handleAnomalyDays(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const anomalies = result.insights.filter((i) => i.id.startsWith('financial-anomaly-'));
  if (anomalies.length === 0) {
    return {
      kind: 'answer',
      text: es
        ? 'Sin anomalías en los últimos 30 días. Ingresos dentro del rango normal.'
        : 'No anomalies in the last 30 days. Revenue within normal range.',
    };
  }
  const lines = anomalies.slice(0, 5).map((a) => `• ${es ? a.descriptionEs : a.description}`).join('\n');
  return {
    kind: 'answer',
    text: es ? `Días fuera de lo normal:\n${lines}` : `Unusual days:\n${lines}`,
  };
}

// ── What is hurting profit (R-INTEL-2-MISSED) ───────────────
const DAY_NAMES_LOCALIZED: Record<Lang3, Record<string, string>> = {
  en: {},
  es: { Sunday: 'Domingo', Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves', Friday: 'Viernes', Saturday: 'Sábado' },
  pt: { Sunday: 'Domingo', Monday: 'Segunda', Tuesday: 'Terça', Wednesday: 'Quarta', Thursday: 'Quinta', Friday: 'Sexta', Saturday: 'Sábado' },
};

// R-INTEL-PHASE2B-FIX: numeric-indexed DOW names (0=Sunday…6=Saturday).
// Used by handleSlowDayRootCause so localization is not dependent on
// string-matching the English day name from the report.
const DAY_NAMES_BY_INDEX: Record<Lang3, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  pt: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
};

function handleWhatHurtingProfit(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getMissedRevenue();

  const losses: Array<{ label: string; cents: number; note: string }> = [];

  if (report.deadStockLockedCents > 0) {
    losses.push({
      label: t('chat.missed.deadStock.label'),
      cents: report.deadStockLockedCents,
      note: t('chat.missed.deadStock.note', COP(report.opportunityCostCents)),
    });
  }

  if (report.slowDayLossCents > 0) {
    const localDay = DAY_NAMES_LOCALIZED[lang][report.slowestDayName] ?? report.slowestDayName;
    losses.push({
      label: t('chat.missed.slowDay.label', localDay),
      cents: report.slowDayLossCents,
      note: t('chat.missed.slowDay.note'),
    });
  }

  if (report.slowHourLossCents > 0) {
    losses.push({
      label: t('chat.missed.offPeak.label'),
      cents: report.slowHourLossCents,
      note: t('chat.missed.offPeak.note'),
    });
  }

  if (losses.length === 0) {
    return { kind: 'answer', text: t('chat.missed.empty') };
  }

  losses.sort((a, b) => b.cents - a.cents);

  const lines = losses.map((l, i) =>
    `${i + 1}. ${l.label}: ${COP(l.cents)}\n   ${l.note}`,
  );

  return { kind: 'answer', text: `${t('chat.missed.header')}\n\n${lines.join('\n\n')}` };
}

// ── Who to contact (R-INTEL-2-CONTACT) ─────────────────────
// R-INTELLIGENCE-OPERATOR-RESPONSES-V1: cap visible list to top 3; summarize
// the rest as a one-line count instead of dumping all 10. Same engine call,
// same scoring — presentation only.
function handleWhoToContact(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const rawPredictions = engine.getNextVisitPredictions(10);

  // R-INTELLIGENCE-SIGNAL-QUALITY-V1: only show reachable + actually-overdue
  // customers. No phone = no actionable channel; overdueByDays <= 0 = not
  // yet due. Engine ranking is preserved; this is a defensive post-filter.
  const predictions = rawPredictions.filter((p) => !!p.phone && p.overdueByDays > 0);

  if (predictions.length === 0) {
    return { kind: 'answer', text: t('chat.contact.empty') };
  }

  const top = predictions.slice(0, 3);
  const remaining = Math.max(0, predictions.length - top.length);
  const now = Date.now();

  const lines = top.map(p => {
    const phone = p.phone ? ` · ${p.phone}` : '';
    const overdue = p.overdueByDays === 1
      ? t('chat.contact.daySingular')
      : t('chat.contact.dayPlural', p.overdueByDays);
    const msg = t('chat.contact.message', p.name.split(' ')[0], p.overdueByDays);
    return `• ${p.name}${phone} — ${t('chat.contact.overdue')} ${overdue}\n  ${msg}`;
  });

  // R-INTELLIGENCE-ACTION-BUTTONS-V1: attach one WhatsApp action per top
  // prediction. Reuses the EXISTING actionType='whatsapp' /
  // executionTarget='whatsapp_url' path → executeActionPayload opens wa.me
  // with the prepared message. Owner manually sends. No autonomous send,
  // no new infrastructure. Customers without a phone are skipped (executor
  // would fail "missing_customer" anyway).
  const actions: ChatActionUI[] = [];
  for (const p of top) {
    if (!p.phone) continue;
    const firstName = p.name.split(' ')[0] || p.name;
    actions.push({
      id: `contact-${p.customerId}-${now}`,
      label: t('chat.contact.waActionLabel', firstName),
      actionType: 'whatsapp',
      payload: {
        type: 'whatsapp',
        customMessage: t('chat.contact.message', firstName, p.overdueByDays),
        customerId: p.customerId,
        customerName: p.name,
        customerPhone: p.phone,
        executable: true,
        executionTarget: 'whatsapp_url',
      },
    });
  }

  const body = `${t('chat.contact.header', predictions.length)}\n\n${lines.join('\n\n')}`;
  const text = remaining > 0 ? `${body}\n\n${t('chat.contact.remaining', remaining)}` : body;
  return actions.length > 0
    ? { kind: 'answer', text, actions }
    : { kind: 'answer', text };
}

// ── Who to contact today (R-INTEL-WHO-TO-CONTACT-TODAY) ────
// Deterministic top-3 outreach list ranked by:
//   score = grossRevenueDollars + daysSinceLastVisit*2 + visitCount*10
// Eligibility: customer has phone, ≥1 prior visit, valid lastVisit. Prefers
// customers inactive ≥14 days; falls back to all qualifying customers when
// fewer than 3 satisfy that filter. Reason + action are picked from a
// deterministic decision tree (no randomness, no API calls).
function handleWhoToContactToday(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const scores = engine.getCustomerScores();
  if (scores.length === 0) {
    return { kind: 'answer', text: t('chat.whoToContact.empty') };
  }
  // R-INTENT-CONTACT-TODAY-CONSENT-GUARD: consent lookup. CustomerHistorySummary
  // exposes a narrow customer projection without consent, so read it from the
  // engine's full customers array. Undefined = allowed (legacy records).
  const consentById = new Map(engine.getCustomers().map((c) => [c.id, c.communicationConsent]));

  type Candidate = {
    name: string;
    phone: string;
    grossRevenue: number;
    visitCount: number;
    daysSinceLastVisit: number;
    repairCount: number;
    rankScore: number;
  };

  const now = Date.now();
  const candidates: Candidate[] = [];
  for (const cs of scores) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h) continue;
    const phone = h.customer.phone || '';
    if (!phone) continue;                     // require contact channel
    // R-INTENT-CONTACT-TODAY-CONSENT-GUARD: skip customers who explicitly
    // opted out of communications. Undefined treated as allowed (legacy
    // records pre-dating the consent field).
    if (consentById.get(cs.customerId) === false) continue;
    if (h.visitCount < 1) continue;           // require prior purchase
    if (!h.lastVisit) continue;               // require valid last-visit date
    const daysSinceLastVisit = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
    const rankScore = (h.grossRevenue / 100) + daysSinceLastVisit * 2 + h.visitCount * 10;
    candidates.push({
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit,
      repairCount: h.linkedEntities?.repairCount || 0,
      rankScore,
    });
  }

  if (candidates.length === 0) {
    return { kind: 'answer', text: t('chat.whoToContact.empty') };
  }

  // Prefer inactive 14+ days; fall back to full pool if <3 qualify.
  const inactivePool = candidates.filter((c) => c.daysSinceLastVisit >= 14);
  const pool = inactivePool.length >= 3 ? inactivePool : candidates;

  // High-spender threshold = 75th percentile of grossRevenue across the full
  // candidate set (not just the chosen pool — keeps the threshold stable).
  const sortedSpend = candidates.map((c) => c.grossRevenue).sort((a, b) => a - b);
  const q3Index = Math.max(0, Math.floor(sortedSpend.length * 0.75));
  const highSpenderThreshold = sortedSpend[q3Index] || 0;

  const top = pool.slice().sort((a, b) => b.rankScore - a.rankScore).slice(0, 3);

  // R-INTEL-AUTO-ACTION-QUEUE-ARCH-FIX: persist queue items at handler-level
  // so only this intent (who_to_contact_today) creates queue entries. Engine
  // method is the canonical source — same scoring/eligibility/decision-tree;
  // we just route the result to the persisted queue here. 24h dedup in
  // actions.ts keeps repeat invocations idempotent. No auto-send.
  try {
    enqueueOutreachActions(engine.buildOutreachQueueItems());
  } catch {
    // Queue persistence is best-effort; never block chat response on it.
  }

  const lines = top.map((c) => {
    const inactive = c.daysSinceLastVisit >= 14;
    const recent = !inactive;
    const highSpender = c.grossRevenue >= highSpenderThreshold && c.grossRevenue > 0;

    // Reason: describes the WHY (3 buckets per spec).
    let reason: string;
    if (recent) {
      reason = t('chat.whoToContact.reasonRecentBuyer', c.name, c.daysSinceLastVisit);
    } else if (highSpender) {
      reason = t('chat.whoToContact.reasonHighValueInactive', c.name, c.daysSinceLastVisit, COP(c.grossRevenue));
    } else {
      reason = t('chat.whoToContact.reasonFrequentInactive', c.name, c.visitCount, c.daysSinceLastVisit);
    }

    // Action: 4 buckets per spec, repair-customer takes priority.
    let action: string;
    if (c.repairCount > 0) {
      action = t('chat.whoToContact.actionFollowUp');
    } else if (recent) {
      action = t('chat.whoToContact.actionAccessory');
    } else if (highSpender) {
      action = t('chat.whoToContact.actionComeback');
    } else {
      action = t('chat.whoToContact.actionRefill');
    }

    return `• ${c.name} · ${c.phone} · ${COP(c.grossRevenue)} total\n  ${reason}\n  ${action}`;
  });

  return {
    kind: 'answer',
    text: `${t('chat.whoToContact.header')}\n\n${lines.join('\n\n')}`,
  };
}

// ── Marketing engine V1 (R-INTEL-MARKETING-ENGINE-V1) ──────
// Deterministic 3-campaign output: Comeback (inactive 14+ days, high spend
// or frequent), Accessory Upsell (recent buyers OR repair pickups), Dead
// Stock Push (general — uses ProductOpportunity DEAD_STOCK signals). For
// each customer-targeted campaign, persists up to 5 draft items to the
// outreach queue with status='pending_approval'. Owner approves before
// any send (not implemented in V1 — queue is owner-facing only). All
// strings via tChat; no API calls; no randomness.
function handleMarketingCampaign(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);

  type Cand = {
    customerId: string;
    name: string;
    phone: string;
    grossRevenue: number;
    visitCount: number;
    daysSinceLastVisit: number;
    repairCount: number;
  };

  const now = Date.now();
  const scores = engine.getCustomerScores();
  const candidates: Cand[] = [];
  for (const cs of scores) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h) continue;
    const phone = h.customer.phone || '';
    if (!phone) continue;
    if (h.visitCount < 1) continue;
    if (!h.lastVisit) continue;
    const days = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
    candidates.push({
      customerId: cs.customerId,
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit: days,
      repairCount: h.linkedEntities?.repairCount || 0,
    });
  }

  // High-spender threshold = 75th percentile across all candidates.
  const sortedSpend = candidates.map((c) => c.grossRevenue).sort((a, b) => a - b);
  const q3Index = Math.max(0, Math.floor(sortedSpend.length * 0.75));
  const highSpenderThreshold = sortedSpend[q3Index] || 0;

  // Campaign 1 — Comeback: inactive 14+ days AND (high spend OR frequent).
  const comebackTargets = candidates.filter(
    (c) => c.daysSinceLastVisit >= 14
      && ((c.grossRevenue >= highSpenderThreshold && c.grossRevenue > 0) || c.visitCount >= 5),
  );

  // Campaign 2 — Accessory Upsell: recent visit (<14d) OR has any repair.
  const accessoryTargets = candidates.filter(
    (c) => c.daysSinceLastVisit < 14 || c.repairCount > 0,
  );

  // Campaign 3 — Dead Stock Push: not customer-keyed, general campaign idea
  // backed by current dead-stock SKUs (top 3 by name for the message hint).
  const deadStock = engine.getProductOpportunities().filter((p) => p.type === 'DEAD_STOCK');
  const deadStockSample = deadStock.slice(0, 3).map((p) => p.name).join(', ');

  type CampaignDef = {
    nameKey: string;
    priority: 'high' | 'medium' | 'low';
    priorityKey: string;
    priorityWeight: number;
    targetLabel: string;
    why: string;
    messageTemplate: string;     // for chat display, contains {customer} placeholder
    queueTargets: Cand[];
    enabled: boolean;
  };

  const campaigns: CampaignDef[] = [];

  if (comebackTargets.length > 0) {
    const top = comebackTargets.slice().sort((a, b) => b.grossRevenue - a.grossRevenue).slice(0, 5);
    campaigns.push({
      nameKey: 'chat.marketing.campaignComeback.name',
      priority: 'high',
      priorityKey: 'chat.marketing.priorityHigh',
      priorityWeight: 2000,
      targetLabel: t('chat.marketing.campaignComeback.target', comebackTargets.length),
      why: t('chat.marketing.campaignComeback.why', comebackTargets.length),
      messageTemplate: t('chat.marketing.campaignComeback.message', '{customer}'),
      queueTargets: top,
      enabled: true,
    });
  }

  if (accessoryTargets.length > 0) {
    const top = accessoryTargets.slice().sort((a, b) => b.grossRevenue - a.grossRevenue).slice(0, 5);
    campaigns.push({
      nameKey: 'chat.marketing.campaignAccessory.name',
      priority: 'medium',
      priorityKey: 'chat.marketing.priorityMedium',
      priorityWeight: 1000,
      targetLabel: t('chat.marketing.campaignAccessory.target', accessoryTargets.length),
      why: t('chat.marketing.campaignAccessory.why', accessoryTargets.length),
      messageTemplate: t('chat.marketing.campaignAccessory.message', '{customer}'),
      queueTargets: top,
      enabled: true,
    });
  }

  if (deadStock.length > 0) {
    // R-INTEL-MARKETING-ENGINE-FIX: dead-stock still needs outreach targets.
    // Rank from full eligible candidate pool by grossRevenue desc (top
    // spenders most likely to respond to a clearance push). Top 5.
    const top = candidates.slice().sort((a, b) => b.grossRevenue - a.grossRevenue).slice(0, 5);
    campaigns.push({
      nameKey: 'chat.marketing.campaignDeadStock.name',
      priority: 'low',
      priorityKey: 'chat.marketing.priorityLow',
      priorityWeight: 500,
      targetLabel: t('chat.marketing.campaignDeadStock.target', deadStock.length, deadStockSample),
      why: t('chat.marketing.campaignDeadStock.why', deadStockSample),
      messageTemplate: t('chat.marketing.campaignDeadStock.message', deadStockSample),
      queueTargets: top,
      enabled: true,
    });
  }

  if (campaigns.length === 0) {
    return { kind: 'answer', text: t('chat.marketing.empty') };
  }

  // Persist draft queue items (pending_approval) for customer-targeted
  // campaigns. Existing 24h dedup in actions.ts skips overlap with prior
  // who_to_contact_today entries. Best-effort — never block chat response.
  const queueItems: ActionQueueItem[] = [];
  for (const camp of campaigns) {
    for (const c of camp.queueTargets) {
      const firstName = c.name.split(' ')[0] || c.name;
      const messageKey = camp.priority === 'high'
        ? 'chat.marketing.campaignComeback.message'
        : camp.priority === 'medium'
          ? 'chat.marketing.campaignAccessory.message'
          : 'chat.marketing.campaignDeadStock.message';
      queueItems.push({
        id: `mkt-${camp.priority}-${c.customerId}-${now}`,
        // R-INTEL-MARKETING-ENGINE-FIX: distinct type from who_to_contact_today's
        // 'whatsapp' so the 24h dedup in actions.ts does NOT collide — same
        // customer can hold both an outreach item and a marketing draft.
        type: 'marketing_whatsapp',
        customerId: c.customerId,
        phone: c.phone,
        message: t(messageKey, firstName),
        priority: camp.priorityWeight,
        reason: camp.why,
        createdAt: now,
        status: 'pending_approval',
      });
    }
  }
  if (queueItems.length > 0) {
    try {
      enqueueOutreachActions(queueItems);
    } catch {
      // Queue persistence is best-effort.
    }
  }

  // Format chat response.
  const targetWord = t('chat.marketing.targetLabel');
  const whyWord = t('chat.marketing.whyLabel');
  const messageWord = t('chat.marketing.messageLabel');
  const lines = campaigns.map((camp) => {
    const priorityText = t(camp.priorityKey);
    return `📣 ${t(camp.nameKey)} [${priorityText}]\n  ${targetWord}: ${camp.targetLabel}\n  ${whyWord}: ${camp.why}\n  ${messageWord}: 💬 "${camp.messageTemplate}"`;
  });

  return {
    kind: 'answer',
    text: `${t('chat.marketing.header')}\n\n${lines.join('\n\n')}`,
  };
}

// R-INTELLIGENCE-PRODUCT-PROMOTION-MODULE-V1: handleProductPush /
// runProductPush / handleProductOpportunities extracted to
// ./productPromotion.ts. The dispatcher cases above import them; this
// file re-exports runProductPush so InventoryModule's existing import
// path keeps resolving. Behavior is byte-for-byte identical.


// ── Dead stock root cause (R-INTEL-PHASE2C-RC) ─────────────
function handleDeadStockRootCause(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const reports = engine.getDeadStockRootCause();

  if (reports.length === 0) {
    return { kind: 'answer', text: t('chat.deadStock.empty') };
  }

  const DIAG_KEY: Record<string, string> = {
    no_demand:      'chat.deadStock.diagNoDemand',
    low_visibility: 'chat.deadStock.diagLowVisibility',
    pricing_issue:  'chat.deadStock.diagPricing',
    mixed:          'chat.deadStock.diagMixed',
  };

  const top = reports.slice(0, 5);
  const header = t('chat.deadStock.header', top.length);

  const sections = top.map((r, i) => {
    const lines: string[] = [];
    lines.push(`${i + 1}. ${r.name}`);
    lines.push(t(DIAG_KEY[r.diagnosis]));
    lines.push(t('chat.deadStock.evidence.days', r.daysWithoutSale));
    lines.push(t('chat.deadStock.evidence.velocity', Number(r.avgWeeklySales.toFixed(1))));
    lines.push(t('chat.deadStock.evidence.stock', r.stockUnits));
    lines.push(t('chat.rootCause.confidence', Math.round(r.confidence * 100)));
    lines.push(t('chat.rootCause.actionsHeader'));
    r.actions.forEach((a, ai) => lines.push(`  ${ai + 1}. ${t(a.labelKey)}${a.actionType ? ` → [${ACTION_TYPE_LABEL[a.actionType] ?? a.actionType}]` : ''}`));
    return lines.join('\n');
  });

  const actionUI: ChatActionUI[] = top.flatMap((r, ri) =>
    r.actions.map((a, ai) => ({
      id: `dead-${ri}-${ai}-${a.labelKey}`,
      label: `${r.name}: ${t(a.labelKey)}`,
      actionType: a.actionType,
      payload: buildActionPayload(
        { ...a, sku: a.sku ?? r.sku },
        { sku: r.sku },
      ),
    }))
  ).slice(0, 10);

  return { kind: 'answer', text: `${header}\n\n${sections.join('\n\n')}`, actions: actionUI };
}

// ── Slow day root cause (R-INTEL-PHASE2B-RC) ───────────────
function handleSlowDayRootCause(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getSlowDayRootCause();

  if (!report) {
    return { kind: 'answer', text: t('chat.slowRoot.notEnoughData') };
  }

  const localDay  = DAY_NAMES_BY_INDEX[lang][report.slowestDayIndex] ?? report.slowestDayName;
  const localBest = DAY_NAMES_BY_INDEX[lang][report.bestDayIndex]    ?? report.bestDayName;

  const DIAG_KEY: Record<string, string> = {
    traffic: 'chat.slowRoot.diagTraffic',
    ticket:  'chat.slowRoot.diagTicket',
    mixed:   'chat.slowRoot.diagMixed',
  };

  const lines: string[] = [];
  lines.push(t('chat.slowRoot.header', localDay));
  lines.push('');
  lines.push(t(DIAG_KEY[report.diagnosis], localDay));
  lines.push('');
  lines.push(t('chat.slowRoot.evidence.revGap',
    COP(report.weeklyGapCents), COP(report.slowDayRevenueCents), localBest, COP(report.bestDayRevenueCents)));

  if (report.txDiffPct >= 5) {
    lines.push(t('chat.slowRoot.evidence.txDiff',
      report.txDiffPct, report.slowDayTxCount, report.bestDayTxCount));
  } else {
    lines.push(t('chat.slowRoot.evidence.txSimilar', report.slowDayTxCount));
  }

  if (report.ticketDiffPct >= 5) {
    lines.push(t('chat.slowRoot.evidence.ticketDiff',
      report.ticketDiffPct,
      COP(report.slowDayAvgTicketCents), COP(report.bestDayAvgTicketCents)));
  } else {
    lines.push(t('chat.slowRoot.evidence.ticketSimilar', COP(report.slowDayAvgTicketCents)));
  }

  lines.push('');
  lines.push(t('chat.rootCause.confidence', Math.round(report.confidence * 100)));
  lines.push('');
  lines.push(t('chat.rootCause.actionsHeader'));
  report.actions.forEach((a, i) => {
    lines.push(`${i + 1}. ${t(a.labelKey)}${a.actionType ? ` → [${ACTION_TYPE_LABEL[a.actionType] ?? a.actionType}]` : ''}`);
  });

  const actionUI: ChatActionUI[] = report.actions.map((a, i) => ({
    id: `slow-${i}-${a.labelKey}`,
    label: t(a.labelKey),
    actionType: a.actionType,
    payload: buildActionPayload(a, {}),
  }));

  return { kind: 'answer', text: lines.join('\n'), actions: actionUI };
}

// ── Revenue decline root cause (R-INTEL-PHASE2-RC) ─────────
function handleRootCause(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getRevenueRootCause();

  if (!report) {
    return { kind: 'answer', text: t('chat.rootCause.notDown') };
  }

  const DIAG_KEY: Record<string, string> = {
    traffic: 'chat.rootCause.diagTraffic',
    ticket:  'chat.rootCause.diagTicket',
    both:    'chat.rootCause.diagBoth',
  };

  const lines: string[] = [];
  lines.push(t('chat.rootCause.header'));
  lines.push('');
  lines.push(t(DIAG_KEY[report.diagnosis]));
  lines.push('');
  lines.push(t('chat.rootCause.evidence.revDrop',
    COP(report.revDropCents), COP(report.revCurrentCents), COP(report.revPreviousCents)));

  if (report.txDropPct >= 5) {
    lines.push(t('chat.rootCause.evidence.txDrop',
      report.txDropPct, report.txCurrent, report.txPrevious));
  } else {
    lines.push(t('chat.rootCause.evidence.txStable', report.txCurrent));
  }

  if (report.ticketDropPct >= 5) {
    lines.push(t('chat.rootCause.evidence.ticketDrop',
      report.ticketDropPct,
      COP(report.avgTicketCurrentCents), COP(report.avgTicketPreviousCents)));
  } else {
    lines.push(t('chat.rootCause.evidence.ticketStable', COP(report.avgTicketCurrentCents)));
  }

  lines.push('');
  lines.push(t('chat.rootCause.confidence', Math.round(report.confidence * 100)));
  lines.push('');
  lines.push(t('chat.rootCause.actionsHeader'));
  report.actions.forEach((a, i) => {
    lines.push(`${i + 1}. ${t(a.labelKey)}${a.actionType ? ` → [${ACTION_TYPE_LABEL[a.actionType] ?? a.actionType}]` : ''}`);
  });

  const actionUI: ChatActionUI[] = report.actions.map((a, i) => ({
    id: `revenue-${i}-${a.labelKey}`,
    label: t(a.labelKey),
    actionType: a.actionType,
    payload: buildActionPayload(a, {}),
  }));

  return { kind: 'answer', text: lines.join('\n'), actions: actionUI };
}

// ── Customer churn root cause (R-INTEL-PHASE2D-RC) ──────────
function handleChurnRootCause(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const reports = engine.getChurnRootCause().slice(0, 5);

  if (reports.length === 0) {
    return { kind: 'answer', text: t('chat.churn.noChurn') };
  }

  const DIAG_KEY: Record<string, string> = {
    lost_habit:        'chat.churn.diagLostHabit',
    price_sensitivity: 'chat.churn.diagPrice',
    one_time:          'chat.churn.diagOneTime',
    mixed:             'chat.churn.diagMixed',
  };

  const lines: string[] = [];
  lines.push(t('chat.churn.header'));

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    lines.push('');
    lines.push(`${i + 1}. ${r.name}`);
    lines.push(t(DIAG_KEY[r.diagnosis]));
    lines.push(t('chat.churn.evidence.lastVisit', r.lastVisitDaysAgo));
    lines.push(t('chat.churn.evidence.gap', r.avgVisitGapDays));
    lines.push(t('chat.churn.evidence.visits', r.totalVisits));
    lines.push(t('chat.rootCause.confidence', Math.round(r.confidence * 100)));
    lines.push(t('chat.rootCause.actionsHeader'));
    r.actions.forEach((a, ai) => {
      lines.push(`${ai + 1}. ${t(a.labelKey)}${a.actionType ? ` → [${ACTION_TYPE_LABEL[a.actionType] ?? a.actionType}]` : ''}`);
    });
  }

  const actionUI: ChatActionUI[] = reports.flatMap((r, ri) =>
    r.actions.map((a, ai) => ({
      id: `churn-${ri}-${ai}-${a.labelKey}`,
      label: `${r.name}: ${t(a.labelKey)}`,
      actionType: a.actionType,
      payload: buildActionPayload(
        { ...a, customerId: a.customerId ?? r.customerId },
        { customerName: r.name },
      ),
    }))
  ).slice(0, 10);

  return { kind: 'answer', text: lines.join('\n'), actions: actionUI };
}

// ── Help ────────────────────────────────────────────────────
function handleHelp(es: boolean): ChatResponse {
  const items = es
    ? [
      '• "mi mejor cliente" — cliente top por valor',
      '• "historial de <nombre>" — historial completo de un cliente',
      '• "cómo van las ventas" — resumen de ventas',
      '• "qué me falta" — stock bajo / reorden',
      '• "qué no se vende" — dead stock',
      '• "qué está perdiendo velocidad" — dying stock',
      '• "qué vendo más" — top items',
      '• "reparaciones atrasadas" — overdue repairs',
      '• "a quién llamar" — clientes con visita esperada atrasada',
      '• "por qué bajaron las ventas" — diagnóstico de caída de ingresos',
      '• "por qué el domingo está lento" — diagnóstico de día lento',
      '• "por qué no se vende X" — causa raíz de stock muerto',
      '• "por qué no regresan clientes" — diagnóstico de clientes perdidos',
      '• "qué está afectando mi ganancia" — ingreso perdido por área',
      '• "oportunidades de producto" — promover, descontar o revisar por margen',
      '• "cómo está la tienda" — health score',
      '• "proyecciones" — forecast por SKU',
      '• "días raros" / "anomalías" — cash-flow anomalies',
    ]
    : [
      '• "best customer" — top customer by value',
      '• "history of <name>" — full customer history',
      '• "how are sales" — sales summary',
      '• "what do I need" — low stock / reorder',
      '• "what is not selling" — dead stock',
      '• "what is losing momentum" — dying stock',
      '• "top items" — best sellers',
      '• "overdue repairs" — overdue repairs',
      '• "who should I contact" — customers with overdue expected visit',
      '• "why are sales down" — revenue decline diagnosis',
      '• "why is Sunday slow" — slow day diagnosis',
      '• "dead stock reason" — dead stock root cause diagnosis',
      '• "why customers stopped coming" — churn root cause diagnosis',
      '• "what is hurting my profit" — missed revenue by area',
      '• "product opportunities" — items to promote, discount, or review by margin',
      '• "store health" — health score',
      '• "forecasts" — per-SKU demand projection',
      '• "anomalies" — unusual revenue days',
    ];
  return {
    kind: 'help',
    text: (es ? 'Puedo responder:\n' : 'I can answer:\n') + items.join('\n'),
  };
}

// ── Universal data query handler (R-INTEL-CELLHUB-DATA-ACCESS-LAYER) ─
// Inspects the raw query, picks the right data access function, returns a
// concise operator-format answer (header + key numbers + optional list +
// action). Topic detection is regex-based and deterministic. Range
// detection (today/yesterday/this_week/this_month/last_30_days) is
// inferred from the query — defaults to last_30_days.
function detectDataQueryRange(q: string): DateRange {
  if (/today|hoy|hoje/.test(q)) return 'today';
  if (/yesterday|ayer|ontem/.test(q)) return 'yesterday';
  if (/this week|esta semana/.test(q)) return 'this_week';
  if (/this month|este mes|este mês/.test(q)) return 'this_month';
  return 'last_30_days';
}

function rangeLabel(range: DateRange, lang: Lang3): string {
  const labels: Record<DateRange, Record<Lang3, string>> = {
    today: { en: 'today', es: 'hoy', pt: 'hoje' },
    yesterday: { en: 'yesterday', es: 'ayer', pt: 'ontem' },
    this_week: { en: 'this week', es: 'esta semana', pt: 'esta semana' },
    this_month: { en: 'this month', es: 'este mes', pt: 'este mês' },
    last_30_days: { en: 'last 30 days', es: 'últimos 30 días', pt: 'últimos 30 dias' },
  };
  return labels[range][lang] ?? labels[range].en;
}

function handleDataQuery(match: IntentMatch, engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const q = (match.query || '').toLowerCase();
  const range = detectDataQueryRange(q);
  const actionLbl = t('chat.dataQuery.action');

  // ── Liability: store credit + loyalty (R-DATA-LIABILITY-V1) ──
  // Read-only. Points displayed as "X points" — NEVER converted to dollars.
  // Tested BEFORE other branches so "store credit" / "puntos" / "pontos"
  // doesn't get caught by the customer / sales regex.
  if (/store credit|loyalty|points|crédito|credito|puntos|pontos|liability/.test(q)) {
    const sum = getLiabilitySummary(engine.getCustomers());
    if (sum.storeCredit.customerCount === 0 && sum.loyalty.customerCount === 0) {
      return { kind: 'answer', text: t('chat.dataQuery.liabilityEmpty') };
    }
    const lines = [t('chat.dataQuery.liabilityHeader'), ''];
    if (sum.storeCredit.totalCents > 0 || sum.storeCredit.customerCount > 0) {
      lines.push(`• ${t('chat.dataQuery.liabilityCreditTotal', COP(sum.storeCredit.totalCents))}`);
      lines.push(`• ${t('chat.dataQuery.liabilityCreditCount', sum.storeCredit.customerCount)}`);
      sum.storeCredit.top.forEach((r) => {
        lines.push(`  ${t('chat.dataQuery.liabilityTopRow', r.name, COP(r.cents || 0))}`);
      });
    }
    if (sum.loyalty.totalPoints > 0 || sum.loyalty.customerCount > 0) {
      if (lines.length > 2) lines.push('');
      lines.push(`• ${t('chat.dataQuery.liabilityPointsTotal', sum.loyalty.totalPoints)}`);
      lines.push(`• ${t('chat.dataQuery.liabilityPointsCount', sum.loyalty.customerCount)}`);
      sum.loyalty.top.forEach((r) => {
        lines.push(`  ${t('chat.dataQuery.liabilityTopRow', r.name, `${r.points || 0} pts`)}`);
      });
    }
    return { kind: 'answer', text: lines.join('\n') };
  }

  // ── Appointments (R-DATA-APPOINTMENT-ACCESS-V1) ─────────
  // Counts derived from estimatedDropOff midnight-anchored to local timezone,
  // mirrors AppointmentsModule.tsx:96-106. Tested BEFORE other branches so the
  // word "appointment" / "cita" / "agendamento" doesn't collide.
  if (/appointment|cita|agendamento/.test(q)) {
    const sum = getAppointmentSummary(engine.getAppointments());
    if (sum.total === 0) return { kind: 'answer', text: t('chat.dataQuery.appointmentsEmpty') };
    const lines = [
      t('chat.dataQuery.appointmentsHeader'),
      '',
      `• ${t('chat.dataQuery.appointmentsToday', sum.today)}`,
      `• ${t('chat.dataQuery.appointmentsTomorrow', sum.tomorrow)}`,
      `• ${t('chat.dataQuery.appointmentsUpcoming', sum.upcoming7d)}`,
    ];
    if (sum.noShows > 0) {
      lines.push(`• ${t('chat.dataQuery.appointmentsNoShows', sum.noShows)}`);
    }
    return { kind: 'answer', text: lines.join('\n') };
  }

  // ── Employee performance (R-DATA-EMPLOYEE-ACCESS-V1) ────
  // Top 3 by revenue (DESC). Mirrors Reports' employeeStats. Tested
  // BEFORE the sales branch so "ventas por empleado" / "top employee"
  // route here, not into the generic sales summary.
  if (/employee|empleado|funcionário|funcionario/.test(q)) {
    const rows = getEmployeePerformance(engine.getSales(), range);
    if (rows.length === 0) return { kind: 'answer', text: t('chat.dataQuery.employeesEmpty') };
    const lines = [t('chat.dataQuery.employeesHeader'), ''];
    rows.slice(0, 3).forEach((r, i) => {
      lines.push(`${i + 1}. ${t('chat.dataQuery.employeesRow', r.name, COP(r.revenueCents), r.transactions)}`);
    });
    return { kind: 'answer', text: lines.join('\n') };
  }

  // ── Expenses (R-DATA-EXPENSE-ACCESS-V1) ─────────────────
  // Read-only summary. Does NOT compute net profit — sales-side profit
  // formula is unresolved (see audit). Test BEFORE other branches so the
  // word "spend" / "gasto" / "despesa" doesn't collide with sales regex.
  if (/expense|spend|gasto|despesa/.test(q)) {
    const sum = getExpenseSummary(engine.getExpenses(), range);
    if (sum.count === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
    const lines = [
      t('chat.dataQuery.expensesHeader'),
      '',
      `• ${t('chat.dataQuery.expensesTotal', COP(sum.totalCents))}`,
      `• ${t('chat.dataQuery.expensesCount', sum.count)}`,
    ];
    const topCat = Object.entries(sum.byCategory).sort((a, b) => b[1] - a[1])[0];
    if (topCat && topCat[1] > 0) {
      lines.push(`• ${t('chat.dataQuery.expensesTopCategory', topCat[0], COP(topCat[1]))}`);
    }
    return { kind: 'answer', text: lines.join('\n') };
  }

  // ── Repairs ────────────────────────────────────────────
  if (/repair|repara|reparo/.test(q)) {
    if (/ready|listas|listos|prontos/.test(q)) {
      const list = getReadyRepairs(engine.getRepairs(), 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.repairsHeader')} — ${t('chat.dataQuery.readyItems')}: ${list.length}`, ''];
      list.forEach((r, i) => {
        const name = (r as { customerName?: string }).customerName || (r as { customer?: string }).customer || '—';
        const dev = (r as { itemDescription?: string; deviceModel?: string }).itemDescription || (r as { deviceModel?: string }).deviceModel || '';
        const total = (r as { total?: number; estimatedCost?: number }).total || (r as { estimatedCost?: number }).estimatedCost || 0;
        lines.push(`${i + 1}. ${name}${dev ? ` — ${dev}` : ''}${total ? ` — ${COP(total)}` : ''}`);
      });
      lines.push('');
      lines.push(`💡 ${actionLbl}: ${lang === 'es' ? 'manda WhatsApp a estos clientes para que pasen hoy' : lang === 'pt' ? 'envie WhatsApp para esses clientes virem hoje' : 'WhatsApp these customers to pick up today'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    const sum = getRepairSummary(engine.getRepairs());
    const lines = [
      t('chat.dataQuery.repairsHeader'),
      '',
      `• ${t('chat.dataQuery.readyItems')}: ${sum.ready}${sum.overdue > 0 ? ` (${sum.overdue} overdue)` : ''}`,
      `• ${lang === 'es' ? 'Activas' : lang === 'pt' ? 'Ativas' : 'Active'}: ${sum.active}`,
      `• ${lang === 'es' ? 'Recogidas' : lang === 'pt' ? 'Retiradas' : 'Picked up'}: ${sum.pickedUp}`,
    ];
    if (sum.ready > 0) {
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'contacta a los clientes con reparación lista' : lang === 'pt' ? 'contate clientes com reparo pronto' : 'contact customers with ready repairs'}`);
    }
    return { kind: 'answer', text: lines.join('\n') };
  }

  // ── Layaways ───────────────────────────────────────────
  if (/layaway|apartado|reserva/.test(q)) {
    if (/pend|partial|pendientes|pendentes/.test(q)) {
      const list = getPendingLayaways(engine.getLayaways(), 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.layawaysHeader')} — ${t('chat.dataQuery.pendingItems')}: ${list.length}`, ''];
      list.forEach((l, i) => {
        const name = (l as { customerName?: string }).customerName || '—';
        const desc = (l as { itemDescription?: string }).itemDescription || '';
        const balance = (l as { balance?: number }).balance || 0;
        lines.push(`${i + 1}. ${name}${desc ? ` — ${desc}` : ''} — ${COP(balance)} ${lang === 'es' ? 'pendiente' : lang === 'pt' ? 'pendente' : 'due'}`);
      });
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'contacta para cobrar el saldo pendiente' : lang === 'pt' ? 'contate para receber o saldo pendente' : 'reach out to collect the outstanding balance'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    const sum = getLayawaySummary(engine.getLayaways());
    return {
      kind: 'answer',
      text: [
        t('chat.dataQuery.layawaysHeader'),
        '',
        `• ${lang === 'es' ? 'Activos' : lang === 'pt' ? 'Ativos' : 'Active'}: ${sum.active}`,
        `• ${t('chat.dataQuery.pendingItems')}: ${sum.pending}`,
        `• ${lang === 'es' ? 'Completados' : lang === 'pt' ? 'Concluídos' : 'Completed'}: ${sum.completed}`,
      ].join('\n'),
    };
  }

  // ── Inventory: low / dead / general ────────────────────
  if (/inventor|stock|product|invent[áa]rio|estoque|produto/.test(q)) {
    if (/low|baj|baixo|short|escaso/.test(q)) {
      const list = getLowStockItems(engine.getInventory(), 5, 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.inventoryHeader')} — ${lang === 'es' ? 'bajo inventario' : lang === 'pt' ? 'estoque baixo' : 'low stock'}: ${list.length}`, ''];
      list.slice(0, 5).forEach((it, i) => {
        const name = (it as { name?: string }).name || '—';
        const qty = (it as { qty?: number }).qty || 0;
        lines.push(`${i + 1}. ${name} — ${qty}`);
      });
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'repón primero los que más se venden' : lang === 'pt' ? 'reabasteça primeiro os que mais vendem' : 'restock the fast movers first'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    if (/dead|muerto|parado|sin venta/.test(q)) {
      const list = getDeadStockItems(engine.getInventory(), engine.getSales(), 60, 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.inventoryHeader')} — ${lang === 'es' ? 'sin movimiento (60d)' : lang === 'pt' ? 'sem movimento (60d)' : 'dead stock (60d)'}: ${list.length}`, ''];
      list.slice(0, 5).forEach((it, i) => {
        const name = (it as { name?: string }).name || '—';
        const qty = (it as { qty?: number }).qty || 0;
        lines.push(`${i + 1}. ${name} — ${qty}`);
      });
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'descuenta o promociona estos productos' : lang === 'pt' ? 'desconto ou promova esses produtos' : 'discount or promote these items'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    const sum = getInventorySummary(engine.getInventory(), 5);
    return {
      kind: 'answer',
      text: [
        t('chat.dataQuery.inventoryHeader'),
        '',
        `• ${lang === 'es' ? 'Total de productos' : lang === 'pt' ? 'Total de itens' : 'Total items'}: ${sum.totalItems}`,
        `• ${lang === 'es' ? 'Valor en venta' : lang === 'pt' ? 'Valor em venda' : 'Retail value'}: ${COP(sum.totalValueCents)}`,
        `• ${lang === 'es' ? 'Costo total' : lang === 'pt' ? 'Custo total' : 'Cost basis'}: ${COP(sum.totalCostCents)}`,
        `• ${lang === 'es' ? 'Bajo inventario' : lang === 'pt' ? 'Estoque baixo' : 'Low stock'}: ${sum.lowStockCount}`,
      ].join('\n'),
    };
  }

  // ── Customers: top / inactive / general ────────────────
  if (/customer|cliente/.test(q)) {
    if (/top|mejor|melhor|best/.test(q)) {
      const list = getTopCustomers(engine.getCustomers(), engine.getSales(), 5);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.customersHeader')} — top ${list.length}`, ''];
      list.forEach((c, i) => {
        lines.push(`${i + 1}. ${c.name || '—'} — ${COP(c.revenueCents)} (${c.visitCount} ${lang === 'es' ? 'visitas' : lang === 'pt' ? 'visitas' : 'visits'})`);
      });
      return { kind: 'answer', text: lines.join('\n') };
    }
    if (/inactive|inactivo|inativo/.test(q)) {
      const list = getInactiveCustomers(engine.getCustomers(), engine.getSales(), 30, 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.customersHeader')} — ${lang === 'es' ? 'inactivos 30d+' : lang === 'pt' ? 'inativos 30d+' : 'inactive 30d+'}: ${list.length}`, ''];
      list.slice(0, 5).forEach((c, i) => {
        lines.push(`${i + 1}. ${c.name} — ${c.daysSinceLastVisit}d`);
      });
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'envía oferta de regreso' : lang === 'pt' ? 'envie oferta de retorno' : 'send a comeback offer'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    const sum = getCustomerSummary(engine.getCustomers(), engine.getSales());
    return {
      kind: 'answer',
      text: [
        t('chat.dataQuery.customersHeader'),
        '',
        `• Total: ${sum.total}`,
        `• ${lang === 'es' ? 'Activos (30d)' : lang === 'pt' ? 'Ativos (30d)' : 'Active (30d)'}: ${sum.active30d}`,
        `• ${lang === 'es' ? 'Inactivos (30d+)' : lang === 'pt' ? 'Inativos (30d+)' : 'Inactive (30d+)'}: ${sum.inactive30d}`,
      ].join('\n'),
    };
  }

  // ── Unlocks ────────────────────────────────────────────
  if (/unlock|desbloque/.test(q)) {
    const sum = getUnlockSummary(engine.getUnlocks());
    return {
      kind: 'answer',
      text: [
        t('chat.dataQuery.unlocksHeader'),
        '',
        `• ${lang === 'es' ? 'Activos' : lang === 'pt' ? 'Ativos' : 'Active'}: ${sum.active}`,
        `• ${lang === 'es' ? 'Completados' : lang === 'pt' ? 'Concluídos' : 'Completed'}: ${sum.completed}`,
      ].join('\n'),
    };
  }

  // ── Phone payments ─────────────────────────────────────
  if (/phone payment|pagos? de tel|pagamento.*tel|recharge|recarga/.test(q)) {
    const sum = getPhonePaymentSummary(engine.getSales(), range);
    if (sum.count === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
    return {
      kind: 'answer',
      text: [
        `${t('chat.dataQuery.phonePaymentsHeader')} — ${rangeLabel(range, lang)}`,
        '',
        `• ${lang === 'es' ? 'Cantidad' : lang === 'pt' ? 'Quantidade' : 'Count'}: ${sum.count}`,
        `• ${lang === 'es' ? 'Volumen' : lang === 'pt' ? 'Volume' : 'Volume'}: ${COP(sum.revenueCents)}`,
      ].join('\n'),
    };
  }

  // ── Special orders ─────────────────────────────────────
  if (/special order|pedido especial|encargo|encomenda/.test(q)) {
    const sum = getSpecialOrderSummary(engine.getSpecialOrders());
    return {
      kind: 'answer',
      text: [
        '📦 ' + (lang === 'es' ? 'Pedidos especiales' : lang === 'pt' ? 'Pedidos especiais' : 'Special orders'),
        '',
        `• ${lang === 'es' ? 'Activos' : lang === 'pt' ? 'Ativos' : 'Active'}: ${sum.active}`,
        `• ${t('chat.dataQuery.readyItems')}: ${sum.ready}`,
        `• ${lang === 'es' ? 'Recogidos' : lang === 'pt' ? 'Retirados' : 'Picked up'}: ${sum.pickedUp}`,
      ].join('\n'),
    };
  }

  // ── Returns ────────────────────────────────────────────
  if (/return|devolu|reembols/.test(q)) {
    const sum = getReturnSummary(engine.getReturns(), range);
    return {
      kind: 'answer',
      text: [
        '↩️ ' + (lang === 'es' ? 'Devoluciones' : lang === 'pt' ? 'Devoluções' : 'Returns') + ` — ${rangeLabel(range, lang)}`,
        '',
        `• ${lang === 'es' ? 'Cantidad' : lang === 'pt' ? 'Quantidade' : 'Count'}: ${sum.count}`,
        `• ${lang === 'es' ? 'Total reembolsado' : lang === 'pt' ? 'Total reembolsado' : 'Total refunded'}: ${COP(sum.totalRefundedCents)}`,
      ].join('\n'),
    };
  }

  // ── Sales (default for "how much / cuánto / quanto / vendi") ───
  if (/sale|venta|sold|vendi|how much|cuanto|cuánto|quanto|profit|ganancia|lucro/.test(q)) {
    const sum = getSalesSummary(engine.getSales(), range);
    if (sum.count === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
    const lines = [
      `${t('chat.dataQuery.salesHeader')} — ${rangeLabel(range, lang)}`,
      '',
      `• ${lang === 'es' ? 'Ventas' : lang === 'pt' ? 'Vendas' : 'Revenue'}: ${COP(sum.revenueCents)}`,
      `• ${lang === 'es' ? 'Transacciones' : lang === 'pt' ? 'Transações' : 'Transactions'}: ${sum.count}`,
      `• ${lang === 'es' ? 'Ticket promedio' : lang === 'pt' ? 'Ticket médio' : 'Avg ticket'}: ${COP(sum.avgTicketCents)}`,
    ];
    if (sum.topSeller) {
      lines.push(`• ${lang === 'es' ? 'Más vendido' : lang === 'pt' ? 'Mais vendido' : 'Top seller'}: ${sum.topSeller.name}`);
    }
    if (range === 'today') {
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'revisa pagos pendientes para cerrar más antes de terminar el día' : lang === 'pt' ? 'cobre pagamentos pendentes para fechar mais antes do fim do dia' : 'collect pending payments to close more before end of day'}`);
    }
    return { kind: 'answer', text: lines.join('\n') };
  }

  // No topic match — defer to fallback message.
  return { kind: 'answer', text: t('chat.dataQuery.noData') };
}

// ── Fallback open-question handler ──────────────────────────
// R-INTEL-FALLBACK-OPEN-QUESTIONS: deterministic answer for queries that
// don't trigger any keyword bank. R-INTEL-FALLBACK-QUESTION-AWARE: response
// adapts to topic keywords detected in the raw query (day/product/customer/
// why/time) so different questions produce different answers instead of
// always returning the full dashboard. Uses only existing engine data
// (KPI, root-cause reports, opportunities, scores) — never invents numbers,
// never mutates queue, never executes actions. engine.refresh() hits the
// 60s cache, so cost is near-zero on hot path.
function handleFallbackQuestion(match: IntentMatch, engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  void lang;
  // EN-only inline strings — fallback is meta-content (data summary +
  // routing hints to specific intents); spec did not list translations.ts.
  const rawQuery = (match.query || '').toLowerCase();

  // ── Topic detection ────────────────────────────────────────
  // Cheap substring/regex checks. EN + ES + PT keyword variants where
  // overlap with existing keyword banks is minimal (otherwise the query
  // would have hit a deterministic intent and never landed here).
  const WEEKDAYS = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo',
    'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta',
  ];
  let weekdayHit: string | null = null;
  for (const d of WEEKDAYS) {
    if (rawQuery.includes(d)) { weekdayHit = d; break; }
  }
  const hasDay = weekdayHit !== null || /\bday\b|\bd[íi]a\b|\bdia\b/.test(rawQuery);
  const hasProduct = /\bproduct\b|\bsku\b|\bitem\b|\bproducto\b|\bproduto\b/.test(rawQuery);
  const hasCustomer = /\bcustomer\b|\bbuyer\b|\bcliente\b/.test(rawQuery);
  const hasWhy = /\bwhy\b|\bpor\s*qu[ée]\b|\bporque\b|\bcausa\b|\breason\b/.test(rawQuery);
  const timeWindow: 'today' | 'week' | 'month' | null = (() => {
    if (rawQuery.includes('today') || rawQuery.includes('hoy') || rawQuery.includes('hoje')) return 'today';
    if (rawQuery.includes('week') || rawQuery.includes('semana')) return 'week';
    if (rawQuery.includes('month') || rawQuery.includes('mes') || rawQuery.includes('mês')) return 'month';
    return null;
  })();

  const insights: string[] = [];
  const actions: string[] = [];

  // ── Day / weekday / traffic pattern ──────────────────────
  if (hasDay) {
    const slow = engine.getSlowDayRootCause();
    if (slow) {
      insights.push(`📅 Slowest day is ${slow.slowestDayName} (${COP(slow.slowDayRevenueCents)} avg); best day is ${slow.bestDayName} (${COP(slow.bestDayRevenueCents)} avg).`);
      if (slow.weeklyGapCents > 0) {
        insights.push(`📉 Weekly gap between best and slowest day: ${COP(slow.weeklyGapCents)}.`);
      }
      actions.push(`Run "why is ${slow.slowestDayName.toLowerCase()} slow" for the full slow-day diagnosis`);
    }
  }

  // ── Product focus ────────────────────────────────────────
  if (hasProduct) {
    const opps = engine.getProductOpportunities();
    if (opps.length > 0) {
      const top = opps[0];
      const oppType = top.type.toLowerCase().replace(/_/g, ' ');
      insights.push(`📦 Top product signal: ${top.action.toLowerCase()} "${top.name}" — ${oppType}, impact ~${COP(top.impactCents)}.`);
      if (opps.length > 1) {
        insights.push(`📦 ${opps.length - 1} more product opportunit${opps.length - 1 === 1 ? 'y' : 'ies'} surfaced.`);
      }
      actions.push(`Run "promote this product ${top.name}" to draft outreach to top buyers`);
    }
  }

  // ── Customer focus ───────────────────────────────────────
  if (hasCustomer) {
    const scores = engine.getCustomerScores();
    if (scores.length > 0) {
      const sorted = scores.slice().sort((a, b) => b.score - a.score);
      const top = sorted[0];
      insights.push(`👤 ${scores.length} customer${scores.length === 1 ? '' : 's'} scored — top tier is "${top.tier}" (score ${Math.round(top.score)}).`);
      const atRisk = sorted.filter((s) => s.tier === 'bronze' || s.riskScore > 50);
      if (atRisk.length > 0) {
        insights.push(`⚠️ ${atRisk.length} customer${atRisk.length === 1 ? '' : 's'} flagged as at-risk by score.`);
      }
      actions.push(`Run "who should I contact today" for the ranked top-3 outreach list`);
    }
  }

  // ── Why / root cause ─────────────────────────────────────
  if (hasWhy) {
    const revRC = engine.getRevenueRootCause();
    if (revRC && revRC.revDropCents > 0) {
      insights.push(`📉 Revenue diagnosis: ${revRC.diagnosis} — drop of ${COP(revRC.revDropCents)} (${revRC.txDropPct}% tx drop, ${revRC.ticketDropPct}% ticket drop).`);
      actions.push(`Run "why are sales down" for the full breakdown`);
    } else {
      const missed = engine.getMissedRevenue();
      if (missed) {
        const losses = [missed.deadStockLockedCents ?? 0, missed.slowDayLossCents ?? 0, missed.slowHourLossCents ?? 0];
        const biggest = Math.max(...losses);
        if (biggest > 0) {
          insights.push(`🔍 Largest missed-revenue signal is ${COP(biggest)}.`);
          actions.push(`Run "what is hurting my profit" for the breakdown`);
        }
      }
    }
  }

  // ── Time window only (no other topic) ────────────────────
  // If the query is purely time-scoped (e.g. "anything for today")
  // and no other category fired, surface the today/week KPI snapshot.
  if (timeWindow && insights.length === 0) {
    const kpi = engine.refresh().kpiDashboard;
    if (kpi) {
      const rev = kpi.revenue?.current ?? 0;
      const tx = kpi.transactions?.count ?? 0;
      if (rev > 0 || tx > 0) {
        insights.push(`📊 ${kpi.period}: ${COP(rev)} revenue across ${tx} transaction${tx === 1 ? '' : 's'}.`);
      }
    }
  }

  // ── Generic mini-summary fallback ────────────────────────
  // Only when NOTHING topic-specific fired. Trimmed to the most actionable
  // signals (reorder + missed-revenue) — no full dashboard dump.
  if (insights.length === 0) {
    const reorderRecs = engine.getReorderRecommendations();
    if (reorderRecs.length > 0) {
      const top = reorderRecs[0];
      const days = Number.isFinite(top.daysLeft) ? Math.round(top.daysLeft) : 0;
      insights.push(`📦 Most urgent reorder: "${top.name}" (${top.priority}, ~${days} day(s) of stock left).`);
      actions.push(`Run "what should I reorder" for the full list`);
    }
    const missed = engine.getMissedRevenue();
    if (missed) {
      const losses = [missed.deadStockLockedCents ?? 0, missed.slowDayLossCents ?? 0, missed.slowHourLossCents ?? 0];
      const biggest = Math.max(...losses);
      if (biggest > 0) {
        insights.push(`💸 Largest missed-revenue signal is ${COP(biggest)}.`);
        actions.push(`Run "what is hurting my profit" for the breakdown`);
      }
    }
  }

  // ── Compose response ─────────────────────────────────────
  const finalInsights = insights.slice(0, 3);
  const finalActions = actions.slice(0, 3);

  if (finalInsights.length === 0 && finalActions.length === 0) {
    return {
      kind: 'answer',
      text: 'Not enough data yet to answer specifically. Try a deterministic intent like "who should I contact today", "what is hurting my profit", "marketing", or "what should I reorder".',
    };
  }

  const lines: string[] = [];
  lines.push('Based on your question and store data:');
  lines.push('');
  if (finalInsights.length > 0) {
    lines.push('📊 What I see:');
    finalInsights.forEach((i) => lines.push(`  ${i}`));
  }
  if (finalActions.length > 0) {
    if (finalInsights.length > 0) lines.push('');
    lines.push('💡 Suggested next steps:');
    finalActions.forEach((a, idx) => lines.push(`  ${idx + 1}. ${a}`));
  }

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Unknown fallback ────────────────────────────────────────
function handleUnknown(es: boolean): ChatResponse {
  return {
    kind: 'help',
    text: es
      ? 'No entendí tu pregunta. Escribe "ayuda" para ver lo que puedo responder.'
      : 'I didn\'t understand. Type "help" to see what I can answer.',
  };
}
