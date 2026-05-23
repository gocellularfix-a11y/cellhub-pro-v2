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
  // R-INTEL-QUEUE-PARSE-DEDUP: shared helper for approved pending-deals count.
  countApprovedPendingDeals,
} from '../automation/automationQueue';
import type { DealStage } from '../automation/automationQueue';
// R-INTELLIGENCE-PRODUCT-PROMOTION-MODULE-V1: product-promotion handlers
// extracted. runProductPush is re-exported below so the InventoryModule
// "Promote" button (which imports from this file) keeps working without
// any change to its own import path.
import { handleProductPush, handleProductOpportunities } from './productPromotion';
export { runProductPush } from './productPromotion';
// R-INTELLIGENCE-EXECUTION-OUTPUTS-V1: operator outreach + repair intelligence
import { handleRecoverCustomer, handleVipOutreach } from './customerOutreach';
import { handleRepairFollowUp, handleRepairEscalate } from './repairIntelligence';
import { validateCustomerContext, validateRepairContext } from '../context/contextValidator';
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
// R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1
import { computeModuleWideOpportunities } from '../moduleWideOpportunities/moduleWideOpportunityService';
// R-INTELLIGENCE-EXECUTABLE-ACTIONS-V1 / R-INTELLIGENCE-ACTION-UX-STABILITY-V1
import { buildChatActionsFromOpportunity, dedupeAndLimitActions } from './opportunityActionAdapter';
// R-INTELLIGENCE-CONTEXT-AWARE-V1
import { getIntelligenceContext } from '../context/intelligenceContext';
import { computeContextualOpportunities } from '../context/contextualOpportunityService';
// R-NEXT-BEST-ACTION-ENGINE-V1
import { rankOpportunitiesForNBA } from '../context/nextBestActionEngine';
// R-INTELLIGENCE-MANAGER-QUEUE-V1
import { getQueue } from '../managerQueue/actions';
import { getPendingItems, getQueueSummary } from '../managerQueue/selectors';
// R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-V1: pure aggregator — extracts data
// collection from handleDailyOperatorBrief so the struct can be reused by
// future UI widgets without re-running the handler.
import { generateDailyOperatorBrief } from '../operator/dailyBrief';
// R-INTELLIGENCE-SLOW-DAY-DIAGNOSTIC-V1: deviation classifier for real-time
// "why is today slow" diagnosis against store-calibrated hourly baseline.
import { isMeaningfulDeviation } from '../baseline/contextualBaseline';
// R-INTELLIGENCE-BUY-TODAY-RANKING-V1: multi-signal buyer ranker.
import { getCustomersMostLikelyToBuyToday } from '../opportunities/buyTodayRanking';
// R-SMART-OUTREACH-CAMPAIGN-V1: grouped deterministic outreach campaign.
import { generateOutreachCampaign } from '../outreach/generateOutreachCampaign';
// R-OUTREACH-OUTCOME-FEEDBACK-V1: performance summary for outreach_performance intent.
import { getOutreachPerformanceSummary } from '../outreach/outreachEffectiveness';
// R-OPERATOR-DAILY-BRIEF-V2: unified aggregated operational briefing.
import { generateDailyBriefV2 } from '../operatorBrief/operatorDailyBriefV2';
import type { BriefV2Section } from '../operatorBrief/operatorDailyBriefV2';
// R-OCE-V1: operational context engine for debug status intent.
import { buildOperationalContext } from '../oce/buildOperationalContext';
import { getTopOperationalSignals, getModuleStatus } from '../oce/operationalContextQueries';
// R-GPO-V1: global priority orchestrator
import { buildGlobalPriorities } from '../gpo/buildGlobalPriorities';
import { extractTopActions } from '../gpo/extractTopActions';
// R-GLOBAL-OPERATOR-CONSOLE-V1
import { computeGlobalOperatorPriorities } from '../globalOperatorConsole/globalOperatorConsole';
// R-INTELLIGENCE-EXTRACT-RANKERS-FROM-HANDLERS-V1: pure ranking functions.
import { scanStaleRepairs } from '../ranking/staleRepairScanner';
import { scoreDealsForCloseToday, dealCloseLikelihood } from '../ranking/closeTodayRanker';
import { rankContactTodayCandidates } from '../ranking/contactTodayRanker';
// R-INTELLIGENCE-WHO-NEEDS-ATTENTION-RIGHT-NOW-V1
import { computeEntityAttentionPriorities } from '../attention/entityPriorityEngine';
import type { AttentionAction } from '../attention/entityPriorityTypes';
// R-INTELLIGENCE-WHO-NEEDS-ATTENTION-TODAY: cross-domain operator decision engine.
import { handleWhoNeedsAttentionToday } from './whoNeedsAttentionToday';
// R-INTELLIGENCE-RECOMMENDED-NEXT-BEST-ACTION: single top-priority action.
import { handleRecommendedNextBestAction } from './nextBestAction';
// R-INTELLIGENCE-WHY-IS-TODAY-SLOW: deterministic operational diagnosis.
import { handleWhyIsTodaySlow } from './whyIsTodaySlow';
// R-INTELLIGENCE-LOW-STOCK-OPPORTUNITY-ENGINE: deterministic restock list.
import { handleRestockOpportunity } from './restockOpportunity';
// R-INTELLIGENCE-WHAT-IS-LOSING-ME-MONEY: deterministic money-leak detector.
import { handleWhatIsLosingMoney } from './whatIsLosingMoney';
// R-INTELLIGENCE-WHY-DID-SALES-DROP: period-over-period drop diagnosis.
import { handleWhyDidSalesDrop } from './whyDidSalesDrop';
// R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY: cross-engine prioritization.
import { handleFocusToday } from './focusToday';
// R-INTELLIGENCE-CUSTOMER-TIMELINE-MEMORY: deterministic behavioral context.
import { buildCustomerTimeline, formatTimelineContext, formatTimelineTagLabel } from '../customerTimeline/customerTimelineEngine';
// INTELLIGENCE-ATTENTION-FEED-INTEGRATION-V1
import { getAttentionFeed } from '../attention/attentionEngine';
// INTELLIGENCE-OPERATOR-TIMELINE-V1
import { recordAttentionShown, recordWorkflowContinued, recordWorkflowCompleted } from '../timeline/timelineRecorder';
// R-FUSION-CHAT-INTEGRATION-V1
import { generateFusedInsights } from '../fusion/fusionEngine';
import type { EscalationTier } from '../fusion/fusionTypes';
// R-ENTITY-FIRST-INTELLIGENCE-ROUTING-V1
import { resolveOperationalEntity } from './entityResolver';
import type { OperationalEntityMatch } from './entityResolver';
// INTELLIGENCE-ENTITY-INTEGRATION-V1
import { resolveEntityIntent } from '../entityAccess/entityIntentResolver';
import type { EntityIntentResult } from '../entityAccess/entityIntentResolver';
import type { ResolvedEntity, EntityAction } from '../entityAccess/types';
// R-GOER-V2: deterministic follow-up entity resolution
import { resolveEntityReference } from '../oce/entityResolution/resolveEntityReference';
// R-GOER-V3: session-only active entity memory
import { rememberResolvedEntity } from '../oce/entityResolution/activeEntityMemory';
// R-ACTION-REGISTRY-V1: centralized action descriptors
// Direct path required — ../actions resolves to the existing actions.ts flat file.
import { getActionDescriptor } from '../actions/operationalActionRegistry';
// R-PERMISSION-GATE-V1: deterministic action permission evaluation
import { evaluateActionPermission } from '../permissions/actionPermissionGate';
import type { OperationalEntityKind } from '../actions/types';
// R-EXECUTION-PIPELINE-V1: execution request builder
import { buildExecutionRequest } from '../executionPipeline/executionRequestBuilder';
// R-OPERATOR-EVENTS-V1: operational event bus
import { publishOperatorEvent } from '../events/operatorEventBus';
// INTELLIGENCE-OPERATIONAL-EXECUTION-REGISTRY-V1
import { entityKindToExecutionPayload, toActionPayload } from '../execution/executionResolver';
import { getExecutionDescriptor } from '../execution/executionRegistry';
import type { ExecutionPayload } from '../execution/types';
// INTELLIGENCE-OPERATOR-CONTINUITY-RUNTIME-V1
import {
  getActiveWorkflowSession,
  resolveWorkflowFollowUp,
  getWorkflowNextStep,
  advanceWorkflowSession,
  completeWorkflowSession,
  expireWorkflowSession,
} from '../workflows/workflowContinuity';
import { getWorkflowDefinition } from '../workflows/workflowRegistry';
import type { WorkflowSession } from '../workflows/types';
import type { OperationalExecutionAction } from '../execution/types';

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
export function tChat(lang: Lang3): (key: string, ...args: any[]) => string {
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

// R-OPERATOR-PROMOTE-PANEL-PREVIEW-V1: optional hand-off shape for the
// Promote Inventory panel widget. Producer (runProductPush) populates this
// alongside the existing chat response when product-push intent fires;
// consumer (IntelligenceChat → IntelligenceModule via new prop callback)
// renders the editable template + recipient list inside the panel itself,
// not just the chat sidebar. Empty `candidates` means broad campaign mode
// (no targeted audience). Existing callers ignoring this field are
// unaffected — purely additive.
export interface PanelCampaignDraft {
  productId: string;
  productName: string;
  templateMessage: string;        // contains {customer} placeholder for substitution
  candidates: Array<{
    customerId: string;
    name: string;
    phone: string;
    // R-OPERATOR-PROMOTE-RECIPIENT-REASON-V1: optional explanation of WHY
    // this customer was selected — drives the small reason line + confidence
    // badge under each recipient row in the Promote panel. All fields
    // optional so older callers stay compatible. reasonKey is a
    // translation key; reasonArg threads parametric values (visit count,
    // days-since-visit) when the reason is parametric.
    reasonKey?: string;
    reasonArg?: number | string;
    confidence?: 'high' | 'medium' | 'low';
    lastVisitDays?: number;
  }>;
}

export interface WorkflowRow {
  label: string;
  meta?: string;
  badge?: string;
  badgeAccent?: string;
}

export interface WorkflowSection {
  title: string;
  icon?: string;
  rows?: WorkflowRow[];
  accent?: string;
  summary?: string;
}

export interface ChatResponse {
  text: string;
  kind: 'answer' | 'disambiguation' | 'error' | 'help';
  actions?: ChatActionUI[];
  establishesContext?: { type: OperationalContext['type']; value: string };
  panelCampaign?: PanelCampaignDraft;
  workflowSections?: WorkflowSection[];
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

    case 'close_today':
      return handleCloseToday(lang);

    case 'daily_revenue_missions':
      return handleDailyRevenueMissions(engine, lang);

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

    case 'repairs_ready':
      return handleRepairsReady(engine, lang);

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

    case 'likely_to_buy_today':
      return handleLikelyToBuyToday(engine, lang);

    case 'who_is_most_likely_to_buy_today':
      return handleWhoIsMostLikelyToBuyToday(engine, lang);

    case 'smart_outreach_campaign':
      return handleSmartOutreachCampaign(engine, lang);

    case 'outreach_performance':
      return handleOutreachPerformance(lang);

    case 'operator_daily_brief_v2':
      return handleOperatorDailyBriefV2(engine, lang);

    case 'operational_context_status':
      return handleOperationalContextStatus(engine, lang);

    // R-GPO-V1: global priority orchestrator
    case 'global_priority_status':
      return handleGlobalPriorityStatus(engine, lang);

    case 'marketing_campaign':
      return handleMarketingCampaign(engine, lang);

    case 'product_push':
      return handleProductPush(match, engine, lang);

    case 'what_hurting_profit':
      return handleWhatHurtingProfit(engine, lang);

    case 'product_opportunities':
      return handleProductOpportunities(engine, lang);

    case 'push_right_now':
      return handlePushRightNow(engine, lang);

    // R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1
    case 'proactive_operations':
      return handleProactiveOperations(engine, lang);

    // R-INTELLIGENCE-AUTOMATED-EXECUTION-V1
    case 'execution_queue':
      return handlePreparedExecutions(engine, lang);

    // R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1
    case 'morning_digest':
      return handleMorningDigest(engine, lang);

    // R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1
    case 'operational_reasoning':
      return handleOperationalReasoning(engine, lang);

    // R-INTELLIGENCE-DECISION-RECOMMENDATION-V1
    case 'decision_recommendation':
      return handleDecisionRecommendation(engine, lang);

    // R-INTELLIGENCE-TREND-DIRECTION-V1
    case 'trend_direction':
      return handleTrendDirection(engine, lang);

    case 'root_cause':
      return handleRootCause(engine, lang);

    case 'slow_day_root_cause':
      return handleSlowDayRootCause(engine, lang);

    case 'slow_day_diagnostic':
      return handleSlowDayDiagnostic(engine, lang);

    case 'dead_stock_root_cause':
      return handleDeadStockRootCause(engine, lang);

    case 'customer_churn_root_cause':
      return handleChurnRootCause(engine, lang);

    case 'help':
      return handleHelp(es);

    case 'data_query':
      return handleDataQuery(match, engine, lang);

    // R-INTELLIGENCE-CONTEXT-AWARE-V1
    case 'active_context_query':
      return handleActiveContextQuery(engine, lang);

    // R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1
    case 'what_to_do_today':
      return handleWhatToDoToday(engine, lang);

    case 'where_losing_money':
      return handleWhereLoosingMoney(engine, lang);

    case 'what_needs_attention':
      return handleWhatNeedsAttention(engine, lang);

    // R-INTELLIGENCE-WHO-NEEDS-ATTENTION-TODAY: cross-domain operator decision engine.
    case 'who_needs_attention_today':
      return handleWhoNeedsAttentionToday(engine, lang);

    // R-INTELLIGENCE-RECOMMENDED-NEXT-BEST-ACTION: single top action.
    case 'recommended_next_best_action':
      return handleRecommendedNextBestAction(engine, lang);

    // R-INTELLIGENCE-WHY-IS-TODAY-SLOW: deterministic operational diagnosis.
    case 'why_is_today_slow':
      return handleWhyIsTodaySlow(engine, lang);

    // R-INTELLIGENCE-LOW-STOCK-OPPORTUNITY-ENGINE: deterministic restock list.
    case 'restock_opportunity':
      return handleRestockOpportunity(engine, lang);

    // R-INTELLIGENCE-WHAT-IS-LOSING-ME-MONEY: deterministic money-leak detector.
    case 'what_is_losing_money':
      return handleWhatIsLosingMoney(engine, lang);

    // R-INTELLIGENCE-WHY-DID-SALES-DROP: period-over-period drop diagnosis.
    case 'why_did_sales_drop':
      return handleWhyDidSalesDrop(engine, lang);

    // R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY: cross-engine prioritization.
    case 'focus_today':
      return handleFocusToday(engine, lang);

    // R-FUSION-CHAT-INTEGRATION-V1
    case 'fusion_insights':
      return handleFusionInsights(lang);

    // R-INTELLIGENCE-MANAGER-QUEUE-V1
    case 'manager_queue':
      return handleManagerQueue(lang);

    // R-INTELLIGENCE-EXECUTION-OUTPUTS-V1: operator outreach + repair intents
    case 'recover_customer':
      return handleRecoverCustomer(match, engine, lang);

    case 'vip_outreach':
      return handleVipOutreach(match, engine, lang);

    case 'repair_follow_up':
      return handleRepairFollowUp(match, engine, lang);

    case 'repair_escalate':
      return handleRepairEscalate(match, engine, lang);

    // INTELLIGENCE-OPERATOR-CONTINUITY-RUNTIME-V1
    case 'workflow_continuity':
      return handleWorkflowContinuityCommand(match, engine, lang);

    // INTELLIGENCE-ATTENTION-FEED-INTEGRATION-V1
    case 'attention_feed':
      return handleAttentionFeed(engine, lang);

    // INTELLIGENCE-ENTITY-INTEGRATION-V1
    case 'entity_operational_command':
      return handleOperationalEntityCommand(match, engine, lang);

    case 'fallback_question': {
      // R-ENTITY-FIRST-INTELLIGENCE-ROUTING-V1: try deterministic entity
      // resolution before falling through to the analytics summary.
      const entityMatch = resolveOperationalEntity(match.query || '', engine);
      if (entityMatch) return handleEntityLookup(entityMatch, engine, lang);
      return handleFallbackQuestion(match, engine, lang);
    }

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
    // R-INTELLIGENCE-SESSION-CONTEXT-V1: establishes customer context so
    // "contact him" follow-ups can resolve the correct customer.
    establishesContext: { type: 'customer', value: top.customerId },
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

  // R-INTELLIGENCE-CUSTOMER-TIMELINE-MEMORY §4: append operational profile.
  // Pure additive — never replaces summarizeCustomerHistory output; appends
  // 1-3 short rule-derived lines so the operator immediately sees cadence,
  // streak, repair pattern, and credit holdings without opening Reports.
  const lang3: Lang3 = es ? 'es' : 'en';
  const t = tChat(lang3);
  let appended = '';
  try {
    const timeline = buildCustomerTimeline({
      customerId: match.matchedCustomer.id,
      sales: engine.getSales(),
      repairs: engine.getRepairs(),
      layaways: engine.getLayaways(),
      // storeCreditLedger pulled from localStorage by the engine when omitted.
    });
    const lines = formatTimelineContext(timeline, t as unknown as (k: string, ...a: unknown[]) => string);
    const tagsLabel = timeline.tags
      .map((tag) => formatTimelineTagLabel(tag, t as unknown as (k: string, ...a: unknown[]) => string))
      .filter(Boolean);
    const block: string[] = [];
    if (lines.length > 0 || tagsLabel.length > 0) {
      block.push('');
      block.push(`**${t('customerTimeline.headerOperational')}**`);
      for (const ln of lines) block.push(`• ${ln}`);
      if (tagsLabel.length > 0) {
        block.push(`🏷 ${tagsLabel.join(' · ')}`);
      }
    }
    appended = block.join('\n');
  } catch { /* timeline is enrichment-only — never block the main answer */ }

  return {
    kind: 'answer',
    text: summarizeCustomerHistory(history, lang3) + (appended ? `\n${appended}` : ''),
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
  operationalContext?: OperationalContext | null,
  currentQuery?: string,
): ChatResponse {
  const t = tChat(lang);

  // R-INTELLIGENCE-SESSION-CONTEXT-V1: resolve pronoun/entity follow-ups
  // before the switch. These patterns require the operational context slot
  // (type + value) rather than the intent-specific text in the switch below.
  const cq = (currentQuery ?? '').toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();

  // "contact him/her/them" — customer pronoun reference
  const isContactRef = /^(contact h[ei]m|contact her|contact them|call h[ei]m|call her|message h[ei]m|message her|contactal[oa]|contactalos|llamal[oa]|contata ele|contata ela)\b/.test(cq);
  if (isContactRef) {
    if (operationalContext?.type === 'customer') {
      // R-INTELLIGENCE-CONTEXT-VALIDATOR-V1: block execution if entity gone from store
      if (!validateCustomerContext(engine, operationalContext).valid) {
        return { kind: 'answer', text: t('chat.followup.staleContext') };
      }
      const custId = operationalContext.value;
      const customer = engine.getCustomers().find((c) => c.id === custId);
      if (customer) {
        const phone = (customer as { phone?: string }).phone || '';
        const action: ChatActionUI = {
          id: `fu-contact-${custId}`,
          label: t('chat.followup.contactAction', customer.name),
          actionType: 'whatsapp',
          payload: {
            type: 'whatsapp',
            messageKey: 'whatsapp.template.reconnect',
            customerId: custId,
            customerName: customer.name,
            customerPhone: phone,
            executable: !!phone,
            executionTarget: 'whatsapp_url',
          },
        };
        return {
          kind: 'answer',
          text: t('chat.followup.contactHeader', customer.name),
          actions: [action],
        };
      }
    }
    return { kind: 'answer', text: t('chat.followup.noContext') };
  }

  // "open it/that" — entity reference navigation
  const isOpenRef = /^(open it|open that|show it|[aá]brelo|abrelo|abra isso|mostre isso)\b/.test(cq);
  if (isOpenRef && operationalContext) {
    if (operationalContext.type === 'repair') {
      // R-INTELLIGENCE-CONTEXT-VALIDATOR-V1: block if repair no longer in store
      if (!validateRepairContext(engine, operationalContext).valid) {
        return { kind: 'answer', text: t('chat.followup.staleContext') };
      }
      const action: ChatActionUI = {
        id: `fu-open-repair-${operationalContext.value}`,
        label: t('chat.followup.openRepairLabel'),
        actionType: 'review',
        payload: { type: 'review', entityId: operationalContext.value, executable: true, executionTarget: 'open_repair' },
      };
      return { kind: 'answer', text: t('chat.followup.openRepairHeader'), actions: [action] };
    }
    if (operationalContext.type === 'customer') {
      // R-INTELLIGENCE-CONTEXT-VALIDATOR-V1: block if customer no longer in store
      if (!validateCustomerContext(engine, operationalContext).valid) {
        return { kind: 'answer', text: t('chat.followup.staleContext') };
      }
      const custId = operationalContext.value;
      const customer = engine.getCustomers().find((c) => c.id === custId);
      const action: ChatActionUI = {
        id: `fu-open-cust-${custId}`,
        label: t('chat.followup.openCustomerLabel'),
        actionType: 'review',
        payload: { type: 'review', entityId: custId, customerId: custId, customerName: customer?.name, executable: true, executionTarget: 'open_customer' },
      };
      return { kind: 'answer', text: t('chat.followup.openCustomerHeader'), actions: [action] };
    }
  }

  // R-GOER-V2: supplementary entity resolution for follow-up trigger phrases.
  // Runs after the contact/open patterns above so existing behavior is unchanged.
  // Covers: trigger phrases whose session context type is not yet handled above
  // (e.g. "open it" with a layaway/product context), and explicit entity
  // mentions (R-XXXX, phone) embedded in follow-up phrasing.
  if (currentQuery && isGoerTrigger(cq)) {
    const goerResp = handleGoerFollowUp(currentQuery, operationalContext, engine, lang);
    if (goerResp) return goerResp;
    return { kind: 'answer', text: t('chat.entityResolution.needMoreDetail') };
  }

  // "show more" — re-run previous list handler for fresh results
  const isShowMore = /^(show more|show me more|give me more|more results|see more|ver m[aá]s|dame m[aá]s|mu[eé]strame m[aá]s|ver mais|mostrar mais|me d[eê] mais)\b/.test(cq);
  if (isShowMore) {
    switch (context.intentId) {
      case 'daily_operator_brief':
      case 'what_to_do_today':
      case 'proactive_opportunities':
        return handleDailyOperatorBrief(engine, lang);
      case 'who_to_contact':
      case 'who_to_contact_today':
      case 'likely_to_buy_today':
        return handleLikelyToBuyToday(engine, lang);
      case 'push_right_now':
      case 'product_push':
      case 'product_opportunities':
        return handlePushRightNow(engine, lang);
      case 'who_is_most_likely_to_buy_today':
        return handleWhoIsMostLikelyToBuyToday(engine, lang);
      case 'smart_outreach_campaign':
        return handleSmartOutreachCampaign(engine, lang);
      case 'outreach_performance':
        return handleOutreachPerformance(lang);
      case 'operator_daily_brief_v2':
        return handleOperatorDailyBriefV2(engine, lang);
      case 'operational_context_status':
        return handleOperationalContextStatus(engine, lang);
      case 'slow_day_diagnostic':
        return handleSlowDayDiagnostic(engine, lang);
      default:
        return { kind: 'answer', text: t('chat.followup.fallback') };
    }
  }

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
    case 'slow_day_diagnostic':
    case 'slow_day_root_cause':
    case 'root_cause':
      return handleSlowDayDiagnostic(engine, lang);
    case 'daily_operator_brief':
    case 'what_to_do_today':
    case 'daily_revenue_missions':
      return handleDailyOperatorBrief(engine, lang);
    case 'push_right_now':
      return handlePushRightNow(engine, lang);
    case 'likely_to_buy_today':
      return handleLikelyToBuyToday(engine, lang);
    case 'who_is_most_likely_to_buy_today':
      return handleWhoIsMostLikelyToBuyToday(engine, lang);
    case 'smart_outreach_campaign':
      return handleSmartOutreachCampaign(engine, lang);
    case 'outreach_performance':
      return handleOutreachPerformance(lang);
    case 'operator_daily_brief_v2':
      return handleOperatorDailyBriefV2(engine, lang);
    case 'operational_context_status':
      return handleOperationalContextStatus(engine, lang);
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

  // Source 2: Repairs ready for pickup older than 3 days.
  try {
    const { staleCount, recoverableCents: recoverable } = scanStaleRepairs(engine);
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

  // Source 5: Approved pending deals waiting to be closed.
  // R-INTEL-QUEUE-PARSE-DEDUP: shared count helper (was: inline parse + iterate).
  {
    const approved = countApprovedPendingDeals();
    if (approved > 0) {
      ops.push({
        title: t('chat.opportunities.pendingDeals.title'),
        reason: t('chat.opportunities.pendingDeals.reason', approved),
        action: t('chat.opportunities.pendingDeals.action'),
        rank: approved * 800,
      });
    }
  }

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

// ── Daily Operator Brief (R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-V1 updated) ──
// Calls generateDailyOperatorBrief (pure aggregator) for data, then formats
// bilingually using tChat(lang) + existing translation keys. Manager queue
// section is new — surfaced below the top-3 priorities if there are pending
// items. Existing priority logic is preserved verbatim for bilingual fidelity.
function handleDailyOperatorBrief(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);

  // Pull structured data from aggregator (includes manager queue + feedback scores).
  const brief = generateDailyOperatorBrief(engine);

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
  // Reuses counts from brief.metrics so we don't re-scan the repairs array.
  if (brief.metrics.overdueRepairs > 0) {
    const recoverable = brief.metrics.recoverableRevenue;
    pris.push({
      title: t('chat.opportunities.staleRepairs.title'),
      why: t('chat.opportunities.staleRepairs.reason', brief.metrics.overdueRepairs, COP(recoverable)),
      action: t('chat.opportunities.staleRepairs.action'),
      rank: recoverable + brief.metrics.overdueRepairs * 1000,
    });
  }

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

  // Source 4: Approved pending deals waiting in chat queue.
  // R-INTEL-QUEUE-PARSE-DEDUP: shared count helper.
  {
    const approved = countApprovedPendingDeals();
    if (approved > 0) {
      pris.push({
        title: t('chat.opportunities.pendingDeals.title'),
        why: t('chat.opportunities.pendingDeals.reason', approved),
        action: t('chat.opportunities.pendingDeals.action'),
        rank: approved * 800,
      });
    }
  }

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

  // Source 7: Manager queue critical items (R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-V1).
  if (brief.metrics.criticalQueueItems > 0) {
    pris.push({
      title: t('chat.dailyBrief2.queueCritical.title'),
      why: t('chat.dailyBrief2.queueCritical.why', brief.metrics.criticalQueueItems),
      action: t('chat.dailyBrief2.queueCritical.action'),
      rank: brief.metrics.criticalQueueItems * 1200,
    });
  }

  if (pris.length === 0) {
    return { kind: 'answer', text: `${t('chat.dailyBrief2.header')}\n\n${t('chat.dailyBrief2.empty')}` };
  }

  pris.sort((a, b) => b.rank - a.rank);
  const top5 = pris.slice(0, 5);

  const lines: string[] = [];
  lines.push(t('chat.dailyBrief2.header'));
  lines.push('');
  top5.forEach((p, i) => {
    lines.push(`${i + 1}. ${t('chat.dailyBrief2.priorityLabel')} ${p.title}`);
    lines.push(`   ${t('chat.dailyBrief2.whyLabel')} ${p.why}`);
    lines.push(`   ${t('chat.dailyBrief2.actionLabel')} ${p.action}`);
    if (i < top5.length - 1) lines.push('');
  });

  // Manager queue summary footer — shown if there are pending items not in top-5.
  if (brief.metrics.pendingQueueItems > 0) {
    lines.push('');
    lines.push(t('mq.chat.summary', brief.metrics.pendingQueueItems));
  }

  // Attach executable action payloads from ranked module-wide opportunities.
  const opps = mwoOpps(engine);
  const actions = dedupeAndLimitActions(
    opps.slice(0, 5).flatMap((opp) =>
      opp.actions ? buildChatActionsFromOpportunity(opp.actions, opp.id, lang) : [],
    ),
    5,
  );

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(actions.length > 0 ? { actions } : {}),
  };
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
    const { staleCount, recoverableCents: recoverable } = scanStaleRepairs(engine);
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
  // R-INTEL-QUEUE-PARSE-DEDUP: shared count helper.
  {
    const approved = countApprovedPendingDeals();
    if (approved > 0) {
      ops.push({
        title: t('chat.opportunities.pendingDeals.title'),
        money: t('chat.opportunities.pendingDeals.reason', approved),
        move: t('chat.opportunities.pendingDeals.action'),
        rank: approved * 2000,
      });
    }
  }

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
    const { staleCount, recoverableCents: recoverable } = scanStaleRepairs(engine);
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
  // R-INTEL-QUEUE-PARSE-DEDUP: shared count helper.
  {
    const approved = countApprovedPendingDeals();
    if (approved > 0) {
      plan.push({
        title: t('chat.opportunities.pendingDeals.title'),
        why: t('chat.opportunities.pendingDeals.reason', approved),
        move: t('chat.opportunities.pendingDeals.action'),
        rank: approved * 2000,
      });
    }
  }

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

// ── Close Today (R-INTELLIGENCE-CLOSE-TODAY-V1) ──────────────
// Deterministic ranker for active deals most likely to close today.
// READ-ONLY — does not mutate the pipeline, does not create follow-ups,
// does not create WhatsApp actions, does not touch POS/cart/checkout.
function handleCloseToday(lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const all = getDealPipeline();
  const active = all.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  if (active.length === 0) {
    return { kind: 'answer', text: `${t('chat.closeToday.headerEmpty')}\n\n${t('chat.closeToday.empty')}` };
  }

  const scored = scoreDealsForCloseToday(active);
  const top = scored.slice(0, 5);

  const lines: string[] = [];
  lines.push(t('chat.closeToday.header'));
  lines.push('');
  top.forEach(({ deal: d, score }, i) => {
    const customer = d.customerName || d.customerPhone || t('chat.closeToday.unknownCustomer');
    const product = d.productName || t('chat.closeToday.unknownProduct');
    const lbl = dealCloseLikelihood(score);
    lines.push(`${i + 1}. ${customer} · ${product}`);
    lines.push(`   ${t('chat.closeToday.likelihoodLabel')} ${t(`chat.closeToday.label.${lbl}`)}`);
    lines.push(`   ${t('chat.closeToday.whyLabel')} ${t(`chat.closeToday.why.${d.stage}`)}`);
    // Reuse the existing chat.dealPipeline.move.{stage} keys — they
    // already cover all 6 active stages with the right operator-style
    // next-move text.
    lines.push(`   ${t('chat.closeToday.nextLabel')} ${t(`chat.dealPipeline.move.${d.stage}`)}`);
    if (i < top.length - 1) lines.push('');
  });

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Daily Revenue Missions (R-INTELLIGENCE-DAILY-REVENUE-MISSIONS-V1)
// Composes top-7 money-making tasks from existing pipeline + follow-up
// + engine signals. READ-ONLY — no mutations, no autonomous actions,
// no automation/queue writes, no WhatsApp drafts, no POS/cart/checkout.
function handleDailyRevenueMissions(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  type Mission = { priority: number; title: string; why: string; nextAction: string };
  const missions: Mission[] = [];
  const now = Date.now();
  const HOUR_24 = 24 * 60 * 60 * 1000;

  // Source A: Active pipeline deals worth closing today.
  try {
    const pipeline = getDealPipeline();
    const stagePri: Record<string, number> = {
      pending_pickup: 100,
      negotiating:    80,
      interested:     60,
    };
    for (const d of pipeline) {
      const pri = stagePri[d.stage];
      if (!pri) continue; // skip won/lost/proposal_sent/etc
      const customer = d.customerName || d.customerPhone || t('chat.missions.unknownCustomer');
      const product = d.productName || t('chat.missions.unknownProduct');
      missions.push({
        priority: pri,
        title: t('chat.missions.closeTitle', customer, product),
        why: t(`chat.missions.closeWhy.${d.stage}`),
        nextAction: t(`chat.missions.closeNext.${d.stage}`),
      });
    }
  } catch { /* skip */ }

  // Source B: Open follow-ups (replied → highest, stale > 24h → next).
  try {
    const followups = getProposalFollowups();
    for (const f of followups) {
      if (f.status === 'won' || f.status === 'lost' || f.status === 'no_response') continue;
      const replied = f.status === 'replied' || f.status === 'interested';
      const stale = f.status === 'sent' && (now - f.sentAt) > HOUR_24;
      if (!replied && !stale) continue;
      const customer = f.customerName || f.customerPhone || t('chat.missions.unknownCustomer');
      missions.push({
        priority: replied ? 70 : 50,
        title: t('chat.missions.followupTitle', customer),
        why: replied ? t('chat.missions.followupWhyReplied') : t('chat.missions.followupWhyStale'),
        nextAction: replied ? t('chat.missions.followupNextReplied') : t('chat.missions.followupNextStale'),
      });
    }
  } catch { /* skip */ }

  // Source C: Dead-stock push (when locked >= $100).
  try {
    const missed = engine.getMissedRevenue();
    const dead = missed?.deadStockLockedCents ?? 0;
    if (dead >= 10000) {
      missions.push({
        priority: 40,
        title: t('chat.missions.deadStockTitle'),
        why: t('chat.missions.deadStockWhy', COP(dead)),
        nextAction: t('chat.missions.deadStockNext'),
      });
    }
  } catch { /* skip */ }

  // Source D: Customer reactivation (>= 2 outreach candidates).
  try {
    const candidates = engine.buildOutreachQueueItems();
    if (candidates.length >= 2) {
      missions.push({
        priority: 35,
        title: t('chat.missions.outreachTitle', candidates.length),
        why: t('chat.missions.outreachWhy'),
        nextAction: t('chat.missions.outreachNext'),
      });
    }
  } catch { /* skip */ }

  if (missions.length === 0) {
    return { kind: 'answer', text: `${t('chat.missions.headerEmpty')}\n\n${t('chat.missions.empty')}` };
  }

  missions.sort((a, b) => b.priority - a.priority);
  const top = missions.slice(0, 7);

  const lines: string[] = [];
  lines.push(t('chat.missions.header'));
  lines.push('');
  top.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.title}`);
    lines.push(`   ${t('chat.missions.whyLabel')} ${m.why}`);
    lines.push(`   ${t('chat.missions.nextLabel')} ${m.nextAction}`);
    if (i < top.length - 1) lines.push('');
  });
  return { kind: 'answer', text: lines.join('\n') };
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

// ── R-INTELLIGENCE-CONTEXT-AWARE-V1 ─────────────────────────

// Shared helper: build the contextual preamble section for MWO handlers.
// Returns null when no active context or no contextual opportunities found.
function buildContextualPreamble(
  engine: IntelligenceEngine,
  lang: Lang3,
): { text: string; actions: ChatActionUI[] } | null {
  const ctx = getIntelligenceContext();
  if (!ctx) return null;
  const ctxOpps = computeContextualOpportunities(ctx, engine);
  if (ctxOpps.length === 0) return null;

  const nba = rankOpportunitiesForNBA(ctxOpps);
  if (!nba) return null;

  const t = tChat(lang);
  const { primary, secondary } = nba;
  const name = primary.evidence[0] ?? '';
  const headlineKey = `nba.action.${primary.recommendedAction ?? ''}`;
  const rawHeadline = t(headlineKey, name);
  const headline = rawHeadline !== headlineKey ? rawHeadline : t(primary.summaryKey, ...primary.evidence);

  const lines: string[] = [`**${t('chat.context.header')}**`, headline, ''];

  // Primary + 1 supporting signal as compact context
  [primary, ...secondary.slice(0, 1)].forEach((opp) => {
    const badge = opp.severity === 'critical' ? '🚨 ' : opp.severity === 'high' ? '⚡ ' : '';
    lines.push(`• ${badge}${t(opp.summaryKey, ...opp.evidence)}`);
  });

  const actions = dedupeAndLimitActions(
    primary.actions ? buildChatActionsFromOpportunity(primary.actions, primary.id, lang) : [],
    3,
  );

  return { text: lines.join('\n'), actions };
}

function handleActiveContextQuery(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const ctx = getIntelligenceContext();
  if (!ctx) return { kind: 'answer', text: t('chat.context.noContext') };

  const ctxOpps = computeContextualOpportunities(ctx, engine);
  if (ctxOpps.length === 0) return { kind: 'answer', text: t('chat.context.noContext') };

  const nba = rankOpportunitiesForNBA(ctxOpps);
  if (!nba) return { kind: 'answer', text: t('chat.context.noContext') };

  const { primary, secondary } = nba;
  const name = primary.evidence[0] ?? '';
  const headlineKey = `nba.action.${primary.recommendedAction ?? ''}`;
  const rawHeadline = t(headlineKey, name);
  const headline = rawHeadline !== headlineKey ? rawHeadline : t(primary.summaryKey, ...primary.evidence);

  const lines: string[] = [
    t('nba.header'),
    headline,
    '',
    t('nba.why'),
    `• ${t(primary.summaryKey, ...primary.evidence)}`,
  ];

  // Up to 3 secondary signals contribute supporting context to "Why"
  secondary.slice(0, 3).forEach((opp) => {
    lines.push(`• ${t(opp.summaryKey, ...opp.evidence)}`);
  });

  // Remaining lower-priority signals go to "Also"
  const tail = secondary.slice(3);
  if (tail.length > 0) {
    lines.push('', t('nba.also'));
    tail.forEach((opp) => {
      lines.push(`• ${t(opp.summaryKey, ...opp.evidence)}`);
    });
  }

  // Actions from primary only — deduplicated
  const actions = dedupeAndLimitActions(
    primary.actions ? buildChatActionsFromOpportunity(primary.actions, primary.id, lang) : [],
  );

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// ── R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1 ───────────────────

function mwoOpps(engine: IntelligenceEngine) {
  return computeModuleWideOpportunities({
    repairs: engine.getRepairs(),
    inventory: engine.getInventory(),
    customers: engine.getCustomers(),
    sales: engine.getSales(),
    layaways: engine.getLayaways(),
  });
}

function handleWhatToDoToday(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const preamble = buildContextualPreamble(engine, lang);
  const opps = mwoOpps(engine);

  if (opps.length === 0 && !preamble) {
    return {
      kind: 'answer',
      text: `**${t('chat.whatToDo.header')}**\n\n${t('chat.whatToDo.empty')}`,
    };
  }

  const parts: string[] = [];
  if (preamble) { parts.push(preamble.text); parts.push(''); }

  const topOpps = opps.slice(0, 7);
  if (topOpps.length > 0) {
    parts.push(`**${t('chat.whatToDo.header')}**`, '');
    topOpps.forEach((opp, i) => { parts.push(`${i + 1}. ${t(opp.summaryKey, ...opp.evidence)}`); });
  }

  const globalActions = dedupeAndLimitActions(
    topOpps.flatMap((opp) =>
      opp.actions ? buildChatActionsFromOpportunity(opp.actions, opp.id, lang) : [],
    ),
    3,
  );
  const actions = dedupeAndLimitActions([...(preamble?.actions ?? []), ...globalActions]);

  return {
    kind: 'answer',
    text: parts.join('\n'),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// ── Push Right Now (R-INTELLIGENCE-PUSH-RIGHT-NOW-V1) ───────────────────────
// Single-best-opportunity aggregator for "what should I push right now?".
// Reuses existing engine.getProductOpportunities(), slow-day detection, and
// the module-wide action payload pipeline. Returns ONE primary recommendation
// with reasoning, revenue potential, audience signal, and executable buttons.
function handlePushRightNow(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);

  // Pull and qualify product opportunities (existing engine signal).
  const oppsRaw = engine.getProductOpportunities(10);
  const opps = oppsRaw.filter(o =>
    o.type !== 'HIGH_RETURN' &&          // skip problem items
    (o.impactCents >= 500 || o.type === 'DEAD_STOCK' || o.marginPct >= 35),
  );

  if (opps.length === 0) {
    return { kind: 'answer', text: t('chat.pushNow.noOpps') };
  }

  // Slow-day context: amplifies urgency when today is below baseline.
  let isSlowDay = false;
  try {
    const m = engine.getTodayMetrics();
    const b = engine.getContextualBaseline();
    isSlowDay = m.transactions === 0 ||
      (b.dailyAverage > 0 && m.revenueCents < b.expectedRangeLow * 0.6);
  } catch { /* skip */ }

  // "Right now" urgency scoring:
  // Dead stock wins — cash locked, clearance is immediate.
  // High margin next — every sale is premium profit.
  // Low margin last — needs velocity but not the top pick.
  const scored = opps
    .map(opp => {
      let score = opp.impactCents;
      if (opp.type === 'DEAD_STOCK')  score += 60000;
      if (opp.type === 'HIGH_MARGIN') score += 25000;
      if (isSlowDay) score = Math.round(score * 1.3);
      return { opp, score };
    })
    .sort((a, b) => b.score - a.score);

  const { opp: top } = scored[0];
  const secondary = scored.slice(1, 3).map(s => s.opp);

  // Outreach audience — reuse existing signal.
  let audienceCount = 0;
  try { audienceCount = engine.buildOutreachQueueItems().length; } catch { /* skip */ }

  const REASON_KEY: Record<string, string> = {
    HIGH_MARGIN: 'chat.pushNow.reason.highMargin',
    LOW_MARGIN:  'chat.pushNow.reason.lowMargin',
    DEAD_STOCK:  'chat.pushNow.reason.deadStock',
  };
  // Reuse the existing productOps action labels — same strings, no duplication.
  const ACTION_KEY: Record<string, string> = {
    PROMOTE:  'chat.productOps.action.promote',
    DISCOUNT: 'chat.productOps.action.discount',
    BUNDLE:   'chat.productOps.action.bundle',
    REVIEW:   'chat.productOps.action.review',
  };

  const lines: string[] = [];
  lines.push(t('chat.pushNow.header'));
  lines.push('');
  lines.push(top.name);
  lines.push('');
  lines.push(`${t('chat.pushNow.whyLabel')} ${t(REASON_KEY[top.type] ?? 'chat.pushNow.reason.generic')}`);
  if (top.impactCents > 0) {
    lines.push(`${t('chat.pushNow.potentialLabel')} ~${COP(top.impactCents)}`);
  }
  if (isSlowDay) {
    lines.push('');
    lines.push(t('chat.pushNow.slowDaySignal'));
  }
  if (audienceCount >= 2) {
    lines.push('');
    lines.push(t('chat.pushNow.audience', audienceCount));
  }
  lines.push('');
  lines.push(`${t('chat.pushNow.actionLabel')} ${t(ACTION_KEY[top.action] ?? 'chat.productOps.action.review')}`);

  if (secondary.length > 0) {
    lines.push('');
    lines.push(t('chat.pushNow.alsoConsider'));
    for (const s of secondary) {
      lines.push(`• ${s.name}`);
    }
  }

  // Promote action — same payload shape as buildOpenPromoteAction in productPromotion.ts.
  const promoteAction: ChatActionUI = {
    id: `prn-${top.inventoryId}-${Date.now()}`,
    label: t('chat.productOps.promoteAction', top.name),
    actionType: 'whatsapp',
    payload: {
      type: 'promote_product',
      productId: top.inventoryId,
      productName: top.name,
      strategy: audienceCount > 0 ? 'targeted_whatsapp' : 'broad_campaign',
      recommendedChannel: audienceCount > 0 ? 'whatsapp' : 'whatsapp_status',
      executable: true,
      executionTarget: 'open_promote_panel',
    },
  };

  // Additional actions from module-wide opportunities (outreach, open repair, etc.).
  const mwoActions = dedupeAndLimitActions(
    mwoOpps(engine).slice(0, 4).flatMap(opp =>
      opp.actions ? buildChatActionsFromOpportunity(opp.actions, opp.id, lang) : [],
    ),
    4,
  );

  const actions = dedupeAndLimitActions([promoteAction, ...mwoActions], 5);

  return { kind: 'answer', text: lines.join('\n'), actions };
}

function handleWhereLoosingMoney(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const preamble = buildContextualPreamble(engine, lang);
  const opps = mwoOpps(engine);

  const moneyOpps = opps.filter((o) =>
    o.module === 'inventory' ||
    o.module === 'customers' ||
    o.module === 'layaways' ||
    (o.module === 'repairs' && (o.severity === 'critical' || o.severity === 'high')),
  );

  const parts: string[] = [];
  if (preamble) { parts.push(preamble.text); parts.push(''); }

  parts.push(`**${t('chat.whereLosing.header')}**`, '');
  const topMoneyOpps = moneyOpps.slice(0, 5);
  if (topMoneyOpps.length === 0) {
    parts.push(t('chat.whereLosing.empty'));
  } else {
    topMoneyOpps.forEach((opp, i) => { parts.push(`${i + 1}. ${t(opp.summaryKey, ...opp.evidence)}`); });
  }

  const missedRev = engine.getMissedRevenue();
  if (missedRev.deadStockLockedCents > 10_000) {
    parts.push('', t('chat.whereLosing.deadStockNote', COP(missedRev.deadStockLockedCents)));
  }

  const globalActions = dedupeAndLimitActions(
    topMoneyOpps.flatMap((opp) =>
      opp.actions ? buildChatActionsFromOpportunity(opp.actions, opp.id, lang) : [],
    ),
    3,
  );
  const actions = dedupeAndLimitActions([...(preamble?.actions ?? []), ...globalActions]);

  return {
    kind: 'answer',
    text: parts.join('\n'),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// Converts an AttentionAction to a ChatActionUI using the existing execution targets.
// Skips 'whatsapp' — no phone number in AttentionAction payload; open_customer suffices.
function attentionActionToChat(
  act: AttentionAction,
  itemId: string,
  idx: number,
): ChatActionUI | null {
  const id = `attn-${itemId}-${act.actionType}-${idx}`;
  const { payload } = act;
  switch (act.actionType) {
    case 'open_repair':
      return {
        id, label: act.label,
        payload: { type: 'review', entityId: String(payload?.repairId ?? ''), executable: !!payload?.repairId, executionTarget: 'open_repair' },
      };
    case 'open_customer':
      return {
        id, label: act.label,
        payload: { type: 'review', entityId: String(payload?.customerId ?? ''), executable: !!payload?.customerId, executionTarget: 'open_customer' },
      };
    case 'open_layaway':
      return {
        id, label: act.label,
        payload: { type: 'review', entityId: String(payload?.layawayId ?? ''), executable: !!payload?.layawayId, executionTarget: 'open_layaway' },
      };
    case 'query':
      return {
        id, label: act.label,
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      };
    default:
      return null;
  }
}

function handleWhatNeedsAttention(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const { items } = computeEntityAttentionPriorities(engine, lang);

  if (items.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.attention.header')}**\n\n${t('chat.attention.empty')}`,
    };
  }

  const BADGE: Record<string, string> = {
    critical: '🚨', high: '⚠️', medium: '📌', low: 'ℹ️',
  };

  const lines: string[] = [`**${t('chat.attention.header')}**`, ''];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const badge = BADGE[item.urgency] ?? '•';
    const name = item.entityName ? ` — ${item.entityName}` : '';
    lines.push(`${i + 1}. ${badge} ${item.reason}${name}`);
    lines.push(`   💡 ${item.recommendedAction}`);
  }

  const rawActions: ChatActionUI[] = [];
  let actIdx = 0;
  for (const item of items) {
    for (const act of item.actions ?? []) {
      const ui = attentionActionToChat(act, item.id, actIdx++);
      if (ui) rawActions.push(ui);
    }
  }

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(rawActions.length > 0 ? { actions: dedupeAndLimitActions(rawActions) } : {}),
  };
}

// ── Fusion Insights ─────────────────────────────────────────
function handleFusionInsights(lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = generateFusedInsights();

  if (report.insights.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.fusion.header')}**\n\n${t('chat.fusion.empty')}`,
    };
  }

  const SEV: Record<string, string> = {
    critical: '🚨', high: '⚠️', medium: '📌', low: 'ℹ️',
  };

  const critHigh = report.criticalCount + report.highCount;
  const lines: string[] = [
    `**${t('chat.fusion.header')}**`,
    '',
    t('chat.fusion.summary', report.insights.length, critHigh),
    '',
  ];

  const TIER_KEY: Record<EscalationTier, string> = {
    watch:    'chat.fusion.tier.watch',
    warning:  'chat.fusion.tier.warning',
    urgent:   'chat.fusion.tier.urgent',
    critical: 'chat.fusion.tier.critical',
  };

  for (const insight of report.insights) {
    const badge   = SEV[insight.severity] ?? '•';
    const title   = lang === 'es' ? insight.titleEs   : lang === 'pt' ? insight.titlePt   : insight.title;
    const summary = lang === 'es' ? insight.summaryEs : lang === 'pt' ? insight.summaryPt : insight.summary;
    lines.push(`• ${badge} ${title}`);
    lines.push(`   ${summary}`);
    if (insight.escalationTier === 'urgent' || insight.escalationTier === 'critical') {
      lines.push(`   ⏱ ${t(TIER_KEY[insight.escalationTier])}`);
    }
  }

  const actions: ChatActionUI[] = [];
  let actIdx = 0;
  for (const insight of report.insights.slice(0, 4)) {
    if (!insight.actionType) continue;
    const id       = `fusion-${insight.id}-${actIdx++}`;
    const entityId = insight.actionTargetId ?? '';
    const phone    = insight.actionTargetPhone ?? '';

    switch (insight.actionType) {
      case 'open_repair':
        if (entityId) actions.push({
          id,
          label: lang === 'es' ? 'Abrir Reparación' : lang === 'pt' ? 'Abrir Reparo' : 'Open Repair',
          payload: { type: 'review', entityId, executable: true, executionTarget: 'open_repair' },
        });
        break;
      case 'open_customer':
        if (entityId) actions.push({
          id,
          label: lang === 'es' ? 'Abrir Cliente' : lang === 'pt' ? 'Abrir Cliente' : 'Open Customer',
          payload: { type: 'review', entityId, executable: true, executionTarget: 'open_customer' },
        });
        break;
      case 'send_whatsapp':
        if (phone) actions.push({
          id,
          label: 'WhatsApp',
          actionType: 'whatsapp',
          payload: { type: 'whatsapp', customerPhone: phone, executable: true, executionTarget: 'whatsapp_url' },
        });
        break;
      case 'open_manager_queue':
        actions.push({
          id,
          label: t('chat.fusion.actions'),
          payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
        });
        break;
    }
  }

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(actions.length > 0 ? { actions: dedupeAndLimitActions(actions) } : {}),
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
// ── Repairs Ready (R-INTELLIGENCE-REFRESH-FREEZE-QUEUE-CLEANUP-REPAIR-INTENT-FIX)
// Mirrors the live operator card's logic: kpi.repairs.pending for the
// total ready-for-pickup count + a stale-3-day scan for stragglers.
// Pure read; no engine/inventory mutation, no automation.
function handleRepairsReady(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const result = engine.refresh();
  const ready = result.kpiDashboard.repairs.pending;

  if (ready === 0) {
    return { kind: 'answer', text: t('chat.repairsReady.empty') };
  }

  const { staleCount } = scanStaleRepairs(engine);

  const lines: string[] = [];
  lines.push(t('chat.repairsReady.header', ready));
  if (staleCount > 0) {
    lines.push(t('chat.repairsReady.stale', staleCount));
  }
  lines.push('');
  lines.push(`💡 ${t('chat.repairsReady.action')}`);
  return { kind: 'answer', text: lines.join('\n') };
}

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
// ── Likely To Buy Today (R-INTELLIGENCE-LIKELY-TO-BUY-TODAY-V1) ────────────
// Aggregates three existing signals ranked by conversion confidence:
//   1. Repair-ready customers (highest — they're coming in anyway, owe money)
//   2. Outreach queue candidates (consent-filtered, deduped by engine)
//   3. Overdue next-visit predictions (fill gaps when pool is thin)
// No new scoring engine — reuses engine.getRepairs(), buildOutreachQueueItems(),
// and getNextVisitPredictions(). WhatsApp + Open Repair actions via existing payloads.
function handleLikelyToBuyToday(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);

  type Candidate = {
    customerId: string;
    name: string;
    phone: string;
    reason: string;
    signal: 'repair_ready' | 'outreach' | 'overdue';
    repairId?: string;
    rank: number;
  };

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const now = Date.now();

  // Signal 1: Repair-ready customers — certain visit + optional balance collection.
  try {
    const repairs = engine.getRepairs();
    for (const r of repairs) {
      if (String(r.status || '').toLowerCase() !== 'ready') continue;
      if (!r.customerPhone) continue;
      const key = (r.customerId && r.customerId.trim()) || r.customerPhone;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        customerId: r.customerId || '',
        name: r.customerName,
        phone: r.customerPhone,
        reason: r.balance > 0
          ? t('chat.likelyBuy.reason.repairBalance', COP(r.balance))
          : t('chat.likelyBuy.reason.repairReady'),
        signal: 'repair_ready',
        repairId: r.id,
        rank: 90000 + r.balance,
      });
    }
  } catch { /* skip */ }

  // Signal 2: Outreach queue (consent-filtered, priority-ranked by engine).
  try {
    const outreach = engine.buildOutreachQueueItems();
    for (const item of outreach.slice(0, 8)) {
      const itemCid = item.customerId ?? '';
      const itemPhone = item.phone ?? '';
      if (!itemPhone && !itemCid) continue;
      const key = itemCid || itemPhone;
      if (seen.has(key)) continue;
      seen.add(key);
      const h = itemCid ? engine.getCustomerHistory(itemCid) : null;
      const days = h?.lastVisit
        ? Math.floor((now - h.lastVisit.getTime()) / 86400000)
        : 0;
      candidates.push({
        customerId: itemCid,
        name: h?.customer.name ?? itemPhone,
        phone: itemPhone,
        reason: t('chat.likelyBuy.reason.outreach', days),
        signal: 'outreach',
        rank: 50000 + ((h?.grossRevenue ?? 0) / 100),
      });
    }
  } catch { /* skip */ }

  // Signal 3: Overdue visit predictions — fill when pool is thin.
  if (candidates.length < 5) {
    try {
      const predictions = engine.getNextVisitPredictions(10);
      for (const p of predictions) {
        if (p.overdueByDays <= 0 || !p.phone) continue;
        const key = p.customerId || p.phone;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          customerId: p.customerId,
          name: p.name,
          phone: p.phone,
          reason: t('chat.likelyBuy.reason.overdue', p.overdueByDays),
          signal: 'overdue',
          rank: 30000 + Math.round(p.urgencyScore * 1000),
        });
      }
    } catch { /* skip */ }
  }

  if (candidates.length === 0) {
    return { kind: 'answer', text: t('chat.likelyBuy.empty') };
  }

  candidates.sort((a, b) => b.rank - a.rank);
  const top = candidates.slice(0, 5);

  // Action buttons: WhatsApp (message tailored to signal) + Open Repair when applicable.
  const actions: ChatActionUI[] = [];
  for (const c of top.slice(0, 3)) {
    const firstName = c.name.split(' ')[0] || c.name;
    if (c.phone) {
      const msg = c.signal === 'repair_ready'
        ? t('chat.likelyBuy.waMsg.repairReady', firstName)
        : t('chat.likelyBuy.waMsg.followUp', firstName);
      actions.push({
        id: `lbt-wa-${c.customerId || c.phone}-${now}`,
        label: t('chat.contact.waActionLabel', firstName),
        actionType: 'whatsapp',
        payload: {
          type: 'whatsapp',
          customMessage: msg,
          ...(c.customerId ? { customerId: c.customerId } : {}),
          customerName: c.name,
          customerPhone: c.phone,
          executable: true,
          executionTarget: 'whatsapp_url',
        },
      });
    }
    if (c.repairId) {
      actions.push({
        id: `lbt-repair-${c.repairId}-${now}`,
        label: t('chat.likelyBuy.openRepair'),
        actionType: 'review',
        payload: {
          type: 'review',
          entityId: c.repairId,
          executable: true,
          executionTarget: 'open_repair',
        },
      });
    }
  }

  const lines: string[] = [];
  lines.push(t('chat.likelyBuy.header'));
  lines.push('');
  top.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.name} · ${c.phone}`);
    lines.push(`   ${c.reason}`);
    if (i < top.length - 1) lines.push('');
  });

  const dedupedActions = dedupeAndLimitActions(actions, 5);
  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(dedupedActions.length > 0 ? { actions: dedupedActions } : {}),
  };
}

// R-INTELLIGENCE-BUY-TODAY-RANKING-V1 ─────────────────────────────────────
// Multi-signal ranked buyer list. Uses buyTodayRanking.ts for scoring;
// attaches WhatsApp + Open Customer + Open Repair actions per candidate.
// Establishes context on the top candidate for "contact him" follow-ups.
// Does NOT block: no consent override, no auto-send.
function handleWhoIsMostLikelyToBuyToday(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const now = Date.now();

  const candidates = getCustomersMostLikelyToBuyToday(engine, lang);

  if (candidates.length === 0) {
    return { kind: 'answer', text: t('chat.buyToday.empty') };
  }

  const lines: string[] = [t('chat.buyToday.header'), ''];
  const actions: ChatActionUI[] = [];

  // Consent map — exclude opted-out customers from WhatsApp actions.
  const consentById = new Map(engine.getCustomers().map((c) => [c.id, c.communicationConsent]));

  candidates.forEach((c, i) => {
    const firstName = c.customerName.split(' ')[0] || c.customerName;
    const phoneDisplay = c.phone ? ` · ${c.phone}` : '';
    const urgencyBadge = c.urgencyLevel === 'urgent'
      ? ` ${t('chat.buyToday.urgent')}`
      : c.urgencyLevel === 'active'
        ? ` ${t('chat.buyToday.activeNow')}`
        : '';
    lines.push(`${i + 1}. ${c.customerName}${phoneDisplay}${urgencyBadge}`);
    c.reasons.forEach((r) => lines.push(`   • ${r}`));
    const actionLabel = c.opportunityType === 'repair_ready'
      ? t('chat.buyToday.action.contact')
      : t('chat.buyToday.action.followUp');
    lines.push(`   ${t('chat.buyToday.recommendedAction')} ${actionLabel}`);
    if (i < candidates.length - 1) lines.push('');

    // Attach actions for top 3 only.
    if (i >= 3) return;

    // WhatsApp (consent-safe).
    const consentOk = consentById.get(c.customerId) !== false;
    if (c.phone && consentOk) {
      const msg = c.opportunityType === 'repair_ready'
        ? t('chat.buyToday.waMsg.repairReady', firstName)
        : t('chat.buyToday.waMsg.followUp', firstName);
      actions.push({
        id: `btr-wa-${c.customerId}-${now}`,
        label: t('chat.buyToday.action.whatsapp', firstName),
        actionType: 'whatsapp',
        payload: {
          type: 'whatsapp',
          customMessage: msg,
          customerId: c.customerId,
          customerName: c.customerName,
          customerPhone: c.phone,
          executable: true,
          executionTarget: 'whatsapp_url',
        },
      });
    }

    // Open Customer.
    actions.push({
      id: `btr-cust-${c.customerId}-${now}`,
      label: t('chat.buyToday.action.openCustomer'),
      actionType: 'review',
      payload: {
        type: 'review',
        entityId: c.customerId,
        customerId: c.customerId,
        customerName: c.customerName,
        executable: true,
        executionTarget: 'open_customer',
      },
    });

    // Open Repair (when repair_ready was the primary signal).
    if (c.repairId) {
      actions.push({
        id: `btr-repair-${c.repairId}-${now}`,
        label: t('chat.buyToday.action.openRepair'),
        actionType: 'review',
        payload: {
          type: 'review',
          entityId: c.repairId,
          executable: true,
          executionTarget: 'open_repair',
        },
      });
    }
  });

  const top = candidates[0];
  const dedupedActions = dedupeAndLimitActions(actions, 6);
  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(dedupedActions.length > 0 ? { actions: dedupedActions } : {}),
    // Establish context on top candidate so "contact him" follow-up resolves correctly.
    establishesContext: { type: 'customer', value: top.customerId },
  };
}

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

  const workflowRows: WorkflowRow[] = top.map((p, i) => ({
    label: `${i + 1}. ${p.name}`,
    meta: `${lang === 'es' ? 'Atrasado' : lang === 'pt' ? 'Atrasado' : 'Overdue'} ${p.overdueByDays}${lang === 'es' ? 'd' : lang === 'pt' ? 'd' : 'd'}`,
    badge: p.overdueByDays >= 14 ? (lang === 'es' ? 'URGENTE' : 'URGENT') : undefined,
    badgeAccent: '#EF4444',
  }));

  const body = `${t('chat.contact.header', predictions.length)}\n\n${lines.join('\n\n')}`;
  const text = remaining > 0 ? `${body}\n\n${t('chat.contact.remaining', remaining)}` : body;
  const sectionTitle = lang === 'es' ? 'Prioridad de contacto' : lang === 'pt' ? 'Prioridade de contato' : 'Contact Priority';
  const workflowSections: WorkflowSection[] = [{ title: sectionTitle, icon: '📞', accent: '#3B82F6', rows: workflowRows }];
  return actions.length > 0
    ? { kind: 'answer', text, actions, workflowSections }
    : { kind: 'answer', text, workflowSections };
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
  const { top, highSpenderThreshold } = rankContactTodayCandidates(scores, engine);

  if (top.length === 0) {
    return { kind: 'answer', text: t('chat.whoToContact.empty') };
  }

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

  const contactWorkflowRows: WorkflowRow[] = top.map((c, i) => {
    const highSpender = c.grossRevenue >= highSpenderThreshold && c.grossRevenue > 0;
    const badge = highSpender ? 'VIP'
      : c.daysSinceLastVisit >= 30 ? (lang === 'es' ? 'INACTIVO' : lang === 'pt' ? 'INATIVO' : 'OVERDUE')
      : undefined;
    return {
      label: `${i + 1}. ${c.name}`,
      meta: `${COP(c.grossRevenue)} · ${c.daysSinceLastVisit}${lang === 'es' ? 'd sin visita' : lang === 'pt' ? 'd sem visita' : 'd inactive'}`,
      badge,
      badgeAccent: badge === 'VIP' ? '#8B5CF6' : '#EF4444',
    };
  });
  const contactSectionTitle = lang === 'es' ? 'Prioridad de contacto' : lang === 'pt' ? 'Prioridade de contato' : 'Contact Priority';

  return {
    kind: 'answer',
    text: `${t('chat.whoToContact.header')}\n\n${lines.join('\n\n')}`,
    workflowSections: [{ title: contactSectionTitle, icon: '📞', accent: '#3B82F6', rows: contactWorkflowRows }],
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

// ── Slow Day Diagnostic (R-INTELLIGENCE-SLOW-DAY-DIAGNOSTIC-V1) ────────────
// Real-time "why is today slow" aggregator. Compares today's live metrics
// against the store's hourly baseline and surfaces causes + recovery actions.
// Does NOT duplicate logic from handleSlowDayRootCause (which analyzes
// historical weekday patterns). All data pulled from existing engine signals.
function handleSlowDayDiagnostic(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);

  type Cause = { title: string; evidence: string; rank: number };
  const causes: Cause[] = [];

  // Signal 1: today's metrics vs. hourly baseline.
  let todayM: ReturnType<typeof engine.getTodayMetrics> | null = null;
  let baseline: ReturnType<typeof engine.getContextualBaseline> | null = null;
  try {
    todayM   = engine.getTodayMetrics();
    baseline = engine.getContextualBaseline();
  } catch { /* skip */ }

  if (!todayM || !baseline || baseline.dailyAverage === 0) {
    return { kind: 'answer', text: t('chat.slowDiag.noData') };
  }

  if (todayM.transactions === 0) {
    causes.push({
      title:    t('chat.slowDiag.cause.noSales.title'),
      evidence: t('chat.slowDiag.cause.noSales.evidence'),
      rank: 99999,
    });
  } else {
    // Sum hourly baseline up to (and including) current hour → expected so far.
    const nowHour = new Date().getHours();
    let expectedSoFar = 0;
    for (let h = 0; h <= nowHour; h++) {
      expectedSoFar += (baseline.hourlyAverage[h] ?? 0);
    }
    // Fallback: fraction of daily average when hourly data is sparse.
    if (expectedSoFar < 100 && baseline.dailyAverage > 0) {
      expectedSoFar = baseline.dailyAverage * Math.min((nowHour + 1) / 12, 1);
    }
    if (expectedSoFar > 500) {
      const dev = isMeaningfulDeviation(todayM.revenueCents, expectedSoFar, baseline.volatilityScore);
      if (dev.isDeviation && dev.pct < 0) {
        causes.push({
          title:    t('chat.slowDiag.cause.lowRevenue.title', Math.abs(Math.round(dev.pct))),
          evidence: t('chat.slowDiag.cause.lowRevenue.evidence', COP(todayM.revenueCents), COP(expectedSoFar)),
          rank: Math.abs(dev.pct) * 80,
        });
      }
    }
  }

  // Signal 2: repairs ready for pickup — uncollected cash.
  try {
    const repairs = engine.getRepairs();
    const ready = repairs.filter(
      r => String((r as { status?: string }).status || '').toLowerCase() === 'ready',
    );
    const balance = ready.reduce((s, r) => s + ((r as { balance?: number }).balance || 0), 0);
    if (ready.length >= 2 && balance >= 2000) {
      causes.push({
        title:    t('chat.slowDiag.cause.repairs.title', ready.length, COP(balance)),
        evidence: t('chat.slowDiag.cause.repairs.evidence'),
        rank: balance,
      });
    }
  } catch { /* skip */ }

  // Signal 3: outreach candidates — potential walk-in traffic.
  try {
    const outreach = engine.buildOutreachQueueItems();
    if (outreach.length >= 2) {
      causes.push({
        title:    t('chat.slowDiag.cause.outreach.title', outreach.length),
        evidence: t('chat.slowDiag.cause.outreach.evidence'),
        rank: outreach.length * 500,
      });
    }
  } catch { /* skip */ }

  // Signal 4: dead stock — locked capital.
  try {
    const missed = engine.getMissedRevenue();
    const dead = missed?.deadStockLockedCents ?? 0;
    if (dead >= 10000) {
      causes.push({
        title:    t('chat.slowDiag.cause.deadStock.title', COP(dead)),
        evidence: t('chat.slowDiag.cause.deadStock.evidence'),
        rank: dead / 5,
      });
    }
  } catch { /* skip */ }

  // Signal 5: high-margin product opportunity.
  try {
    const opps = engine.getProductOpportunities(1);
    if (opps.length > 0) {
      const top = opps[0];
      const impact = top.impactCents || 0;
      if (impact >= 1000) {
        causes.push({
          title:    t('chat.slowDiag.cause.productOpp.title', top.name),
          evidence: t('chat.slowDiag.cause.productOpp.evidence', COP(impact)),
          rank: impact / 10,
        });
      }
    }
  } catch { /* skip */ }

  if (causes.length === 0) {
    return { kind: 'answer', text: t('chat.slowDiag.looksNormal') };
  }

  causes.sort((a, b) => b.rank - a.rank);
  const top = causes.slice(0, 5);

  const lines: string[] = [];
  lines.push(t('chat.slowDiag.header'));
  lines.push('');
  top.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.title}`);
    lines.push(`   ${c.evidence}`);
    if (i < top.length - 1) lines.push('');
  });
  lines.push('');
  lines.push(t('chat.slowDiag.recovery'));

  // Executable action buttons from ranked module-wide opportunities.
  const globalOpps = mwoOpps(engine);
  const actions = dedupeAndLimitActions(
    globalOpps.slice(0, 5).flatMap(opp =>
      opp.actions ? buildChatActionsFromOpportunity(opp.actions, opp.id, lang) : [],
    ),
    5,
  );

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(actions.length > 0 ? { actions } : {}),
  };
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
// R-ENTITY-FIRST-INTELLIGENCE-ROUTING-V1: build a chat response from a
// resolved operational entity. No mutations, no cart writes, no analytics.
function handleEntityLookup(
  match: OperationalEntityMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const es = lang === 'es';

  // ── Ambiguous customer disambiguation ──────────────────────────────────
  if (match.kind === 'ambiguous_customer') {
    const lines = match.matches.map((c, i) => {
      const phone = c.phone || (c as any).phones?.[0] || '';
      return `${i + 1}. **${c.name}**${phone ? ` — ${phone}` : ''}`;
    });
    // One action per candidate: triggerQuery uses "cust:<id>" so the entity
    // resolver resolves exactly to that customer without further ambiguity.
    const actions: ChatActionUI[] = match.matches.map(c => {
      const phone = c.phone || (c as any).phones?.[0] || '';
      return {
        id: `disambig-${c.id}`,
        label: phone ? `${c.name} (${phone})` : c.name,
        triggerQuery: `cust:${c.id}`,
        payload: {
          type: 'operator_action' as const,
          executable: false,
          executionTarget: 'none' as const,
          customerName: c.name,
          customerId: c.id,
        },
      };
    });
    return {
      kind: 'disambiguation',
      text: (es
        ? `Encontré ${match.matches.length} clientes con ese nombre:\n`
        : `Found ${match.matches.length} customers with that name:\n`)
        + lines.join('\n') + '\n\n'
        + (es ? '¿Cuál de ellos buscas?' : 'Which one are you looking for?'),
      actions,
    };
  }

  // ── Single repair match (ticket-ID lookup) ─────────────────────────────
  if (match.kind === 'repair') {
    const r = match.repair;
    const ticketNum = String((r as any).ticketNumber || r.id.slice(-8).toUpperCase());
    const actions: ChatActionUI[] = [
      {
        id: `open-repair-${r.id}`,
        label: es ? 'Ver Ticket' : 'Open Ticket',
        payload: { type: 'operator_action', executable: true, executionTarget: 'open_repair', entityId: r.id, customerName: r.customerName },
      },
    ];
    if ((r.balance || 0) > 0 && match.customer?.phone) {
      actions.push({
        id: `whatsapp-repair-${r.id}`,
        label: 'WhatsApp',
        actionType: 'whatsapp',
        payload: {
          type: 'whatsapp', executable: true, executionTarget: 'whatsapp_url',
          customerPhone: match.customer.phone, customerName: r.customerName,
          customMessage: es
            ? `Hola ${r.customerName}, tu reparación de ${r.device} está lista. Balance: ${COP(r.balance || 0)}`
            : `Hi ${r.customerName}, your ${r.device} repair is ready. Balance due: ${COP(r.balance || 0)}`,
        },
      });
    }
    const balLine = (r.balance || 0) > 0
      ? `**${es ? 'Balance' : 'Balance due'}: ${COP(r.balance || 0)}**`
      : (es ? 'Pagado en su totalidad ✓' : 'Paid in full ✓');
    return {
      kind: 'answer',
      text: [
        `**${es ? 'Ticket' : 'Ticket'} #${ticketNum}**`,
        `${es ? 'Cliente' : 'Customer'}: ${r.customerName || '—'}`,
        `${es ? 'Dispositivo' : 'Device'}: ${r.device || '—'}`,
        `${es ? 'Estado' : 'Status'}: ${r.status}`,
        balLine,
      ].join('\n'),
      actions,
      establishesContext: { type: 'repair', value: r.id },
    };
  }

  // ── Product match ──────────────────────────────────────────────────────
  if (match.kind === 'product') {
    const p = match.product;
    return {
      kind: 'answer',
      text: [
        `**${p.name}**`,
        `SKU: ${p.sku}`,
        `${es ? 'En existencia' : 'In stock'}: ${p.qty}`,
        `${es ? 'Precio' : 'Price'}: ${COP(p.price)}`,
      ].join('\n'),
      actions: [
        {
          id: `open-inventory-${p.id}`,
          label: es ? 'Ver en Inventario' : 'View in Inventory',
          payload: { type: 'operator_action', executable: true, executionTarget: 'open_inventory', entityId: p.id, productName: p.name },
        },
      ],
      establishesContext: { type: 'product', value: p.id },
    };
  }

  // ── Customer match — full operational summary ──────────────────────────
  if (match.kind !== 'customer') {
    return { kind: 'answer', text: es ? 'Entidad no encontrada.' : 'Entity not found.' };
  }
  const customer = match.customer;

  const allRepairs   = engine.getRepairs().filter(r => r.customerId === customer.id || r.customerName === customer.name);
  const allUnlocks   = engine.getUnlocks().filter(u => u.customerId === customer.id || u.customerName === customer.name);
  const allSOs       = engine.getSpecialOrders().filter(o => o.customerId === customer.id || o.customerName === customer.name);
  const allLayaways  = engine.getLayaways().filter(l => l.customerId === customer.id || l.customerName === customer.name);

  const terminalRepair  = (s: string) => ['cancelled', 'picked_up'].includes(s.toLowerCase());
  const terminalGeneric = (s: string) => ['cancelled', 'picked_up', 'completed'].includes(s.toLowerCase());

  const activeRepairs  = allRepairs.filter(r => !terminalRepair(String(r.status || '')));
  const activeUnlocks  = allUnlocks.filter(u => !terminalGeneric(String(u.status || '')));
  const activeSOs      = allSOs.filter(o => !terminalGeneric(String(o.status || '')));
  const activeLayaways = allLayaways.filter(l => !terminalGeneric(String(l.status || '')));

  const totalBalance =
    activeRepairs.reduce((s, r)  => s + (r.balance  || 0), 0) +
    activeUnlocks.reduce((s, u)  => s + (u.balance  || 0), 0) +
    activeSOs.reduce((s, o)      => s + (o.balance  || 0), 0) +
    activeLayaways.reduce((s, l) => s + (l.balance  || 0), 0);

  const phone = customer.phone || (customer as any).phones?.[0] || '';
  const lines: string[] = [`**${customer.name}**${phone ? ` — ${phone}` : ''}`];

  if (activeRepairs.length > 0) {
    lines.push(`\n${es ? 'Reparaciones activas' : 'Active repairs'} (${activeRepairs.length}):`);
    for (const r of activeRepairs.slice(0, 5)) {
      const tn = String((r as any).ticketNumber || r.id.slice(-8).toUpperCase());
      const bal = (r.balance || 0) > 0 ? ` — **${COP(r.balance!)}**` : '';
      lines.push(`  • #${tn} ${r.device || ''} [${r.status}]${bal}`);
    }
  }
  if (activeUnlocks.length > 0) {
    lines.push(`\n${es ? 'Unlocks activos' : 'Active unlocks'} (${activeUnlocks.length}):`);
    for (const u of activeUnlocks.slice(0, 3)) {
      const bal = (u.balance || 0) > 0 ? ` — ${COP(u.balance!)}` : '';
      lines.push(`  • ${u.device || '—'} [${u.status}]${bal}`);
    }
  }
  if (activeSOs.length > 0) {
    lines.push(`\n${es ? 'Órdenes especiales' : 'Special orders'} (${activeSOs.length}):`);
    for (const o of activeSOs.slice(0, 3)) {
      const bal = (o.balance || 0) > 0 ? ` — ${COP(o.balance!)}` : '';
      lines.push(`  • ${o.itemDescription || '—'} [${o.status}]${bal}`);
    }
  }
  if (activeLayaways.length > 0) {
    lines.push(`\n${es ? 'Layaways activos' : 'Active layaways'} (${activeLayaways.length}):`);
    for (const l of activeLayaways.slice(0, 3)) {
      const total = l.totalPrice ? COP(l.totalPrice) : '—';
      const bal = (l.balance || 0) > 0 ? ` — ${COP(l.balance!)}` : '';
      lines.push(`  • ${total} [${l.status}]${bal}`);
    }
  }

  const hasActive = activeRepairs.length + activeUnlocks.length + activeSOs.length + activeLayaways.length > 0;
  if (!hasActive) {
    lines.push(es ? '\nSin tickets activos.' : '\nNo active tickets.');
  } else if (totalBalance > 0) {
    lines.push(`\n**${es ? 'Total balance pendiente' : 'Total balance owed'}: ${COP(totalBalance)}**`);
  }

  const actions: ChatActionUI[] = [
    {
      id: `open-customer-${customer.id}`,
      label: es ? 'Ver Cliente' : 'View Customer',
      payload: { type: 'operator_action', executable: true, executionTarget: 'open_customer', entityId: customer.id, customerName: customer.name },
    },
  ];
  if (phone) {
    actions.push({
      id: `whatsapp-${customer.id}`,
      label: 'WhatsApp',
      actionType: 'whatsapp',
      payload: { type: 'whatsapp', executable: true, executionTarget: 'whatsapp_url', customerPhone: phone, customerName: customer.name },
    });
  }
  for (const r of activeRepairs.slice(0, 2)) {
    const tn = String((r as any).ticketNumber || r.id.slice(-8).toUpperCase());
    actions.push({
      id: `open-repair-${r.id}`,
      label: `${es ? 'Ver' : 'Open'} #${tn}`,
      payload: { type: 'operator_action', executable: true, executionTarget: 'open_repair', entityId: r.id, customerName: r.customerName },
    });
  }

  return {
    kind: 'answer',
    text: lines.join('\n'),
    actions,
    establishesContext: { type: 'customer', value: customer.id },
  };
}

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

// R-INTELLIGENCE-MANAGER-QUEUE-V1: manager queue chat handler.
// Returns a plain-text summary of pending items — no engine reads needed.
function handleManagerQueue(lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const queue = getQueue();
  const summary = getQueueSummary(queue);

  if (summary.totalPending === 0) {
    return { kind: 'answer', text: t('mq.chat.empty') };
  }

  const pending = getPendingItems(queue);
  const lines: string[] = [t('mq.chat.summary', summary.totalPending)];

  if (summary.critical > 0) lines.push(`🔴 ${t('mq.severity.critical')}: ${summary.critical}`);
  if (summary.high > 0)     lines.push(`🟠 ${t('mq.severity.high')}: ${summary.high}`);
  if (summary.medium > 0)   lines.push(`🟡 ${t('mq.severity.medium')}: ${summary.medium}`);
  if (summary.low > 0)      lines.push(`⚪ ${t('mq.severity.low')}: ${summary.low}`);

  lines.push('');
  pending.slice(0, 3).forEach((item, i) => {
    lines.push(`**${i + 1}. ${item.title}**`);
    lines.push(item.description);
    if (item.recommendedAction) lines.push(`→ ${item.recommendedAction}`);
    lines.push('');
  });

  if (pending.length > 3) {
    lines.push(t('mq.chat.more', pending.length - 3));
  }

  return { kind: 'answer', text: lines.join('\n').trim() };
}

// ── Proactive operations ──────────────────────────────────────────────────────
// R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1
function handleProactiveOperations(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getProactiveReport();

  if (report.actions.length === 0) {
    return { kind: 'answer', text: t('chat.proactive.empty') };
  }

  const es = lang === 'es';
  const PRIORITY_ICON: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡' };
  const lines: string[] = [t('chat.proactive.header'), ''];

  for (const action of report.actions.slice(0, 5)) {
    const icon = PRIORITY_ICON[action.priority] ?? '•';
    const impact = action.estimatedImpactCents
      ? ` (${es ? 'recuperable' : 'recoverable'}: $${(action.estimatedImpactCents / 100).toFixed(0)})`
      : '';
    lines.push(`${icon} ${action.title}${impact}`);
  }

  if (report.topAction) {
    lines.push('');
    lines.push(`💡 **${t('chat.proactive.bestNext')}:**`);
    lines.push(report.topAction.recommendedAction);
  }

  return { kind: 'answer', text: lines.join('\n').trim() };
}

// ── Trend direction ─────────────────────────────────────────────────────────
// R-INTELLIGENCE-TREND-DIRECTION-V1
function handleTrendDirection(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getTrendDirectionReport();

  if (report.signals.length === 0) {
    return { kind: 'answer', text: t('chat.trend.empty') };
  }

  const dirIcon: Record<string, string> = {
    improving: '📈', declining: '📉', stable: '➡️', recovering: '🔄', worsening: '⚠️',
  };
  const sevIcon: Record<string, string> = {
    low: '', medium: '🟡 ', high: '🟠 ', critical: '🔴 ',
  };

  const lines: string[] = [t('chat.trend.header'), ''];

  for (const sig of report.signals) {
    const icon = dirIcon[sig.direction] ?? '';
    const sev = sevIcon[sig.severity] ?? '';
    lines.push(`${sev}${icon} **${sig.title}**`);
    lines.push(sig.explanation);
    if (sig.recommendedAction) lines.push(`→ ${sig.recommendedAction}`);
    lines.push('');
  }

  lines.push(`💡 ${t('chat.trend.nextStep')}`);

  return { kind: 'answer', text: lines.join('\n').trim() };
}

// ── Prepared executions ────────────────────────────────────────────────────────
// R-INTELLIGENCE-AUTOMATED-EXECUTION-V1
// V1: prepares draft messages only — NO auto-send, NO automated outreach.
function handlePreparedExecutions(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getExecutionReport();

  if (report.executions.length === 0) {
    return { kind: 'answer', text: t('chat.execution.empty') };
  }

  const es = lang === 'es';
  const PRIORITY_ICON: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡' };
  const CAT_ICON: Record<string, string> = {
    repair_followup: '🔧',
    collection: '💰',
    vip_recovery: '⭐',
    approval_review: '✅',
    inventory_order: '📦',
  };

  const lines: string[] = [t('chat.execution.header'), ''];

  for (const exec of report.executions.slice(0, 5)) {
    const icon = PRIORITY_ICON[exec.priority] ?? '•';
    const cat = CAT_ICON[exec.category] ?? '•';
    const impact = exec.estimatedImpactCents
      ? ` — $${(exec.estimatedImpactCents / 100).toFixed(0)} ${es ? 'recuperable' : 'recoverable'}`
      : '';
    lines.push(`${icon}${cat} **${exec.customerName ?? exec.category}**${impact}`);
    lines.push(`   ${exec.draftMessage}`);
    lines.push('');
  }

  if (report.topExecution) {
    lines.push(`💬 **${t('chat.execution.topDraft')}:**`);
    lines.push(report.topExecution.draftMessage);
  }

  const disclaimer = es
    ? '⚠️ *Los mensajes son borradores — el operador los envía manualmente.*'
    : '⚠️ *Messages are drafts — operator sends manually.*';
  lines.push('');
  lines.push(disclaimer);

  return { kind: 'answer', text: lines.join('\n').trim() };
}

// ── Morning operator digest ───────────────────────────────────────────────────
// R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1
function handleMorningDigest(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const digest = engine.getMorningDigest();

  if (digest.sections.length === 0) {
    return {
      kind: 'answer',
      text: `${t('chat.digest.header')}\n\n${t('chat.digest.empty')}`,
    };
  }

  const es = lang === 'es';
  const PRIORITY_ICON: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡' };
  const lines: string[] = [t('chat.digest.header'), ''];

  for (const section of digest.sections) {
    const pIcon = PRIORITY_ICON[section.priority] ?? '•';
    lines.push(`${pIcon} **${section.title}**`);
    for (const line of section.lines.slice(0, 2)) {
      lines.push(`  ${line}`);
    }
    lines.push('');
  }

  if (digest.estimatedRecoverableCents && digest.estimatedRecoverableCents > 0) {
    const amt = `$${(digest.estimatedRecoverableCents / 100).toFixed(0)}`;
    lines.push(
      es
        ? `💵 ${amt} potencialmente recuperable hoy.`
        : `💵 ${amt} potentially recoverable today.`,
    );
    lines.push('');
  }

  if (digest.recommendedFocus) {
    lines.push(`💡 **${t('chat.digest.focus')}:**`);
    lines.push(digest.recommendedFocus);
  }

  return { kind: 'answer', text: lines.join('\n').trim() };
}

// ── Operational reasoning ─────────────────────────────────────────────────────
// R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1
function handleOperationalReasoning(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t  = tChat(lang);
  const es = lang === 'es';
  const report = engine.getOperationalReasoningReport();

  if (!report.topCondition) {
    return { kind: 'answer', text: t('chat.reasoning.empty') };
  }

  const top = report.topCondition;

  const COND_ICON: Record<string, string> = {
    low_foot_traffic:        '📉',
    followup_breakdown:      '📋',
    inventory_pressure:      '📦',
    operator_overload:       '⚡',
    revenue_focus_imbalance: '💰',
    healthy_operation:       '✅',
  };

  const lines: string[] = [t('chat.reasoning.header'), ''];

  const icon      = COND_ICON[top.condition] ?? '🔍';
  const pct       = Math.round(top.confidence * 100);
  const condLabel = t(`chat.reasoning.condition.${top.condition}`);
  const confLabel = es ? 'confianza' : 'confidence';
  lines.push(`${icon} **${condLabel}** (${pct}% ${confLabel})`);
  lines.push('');
  lines.push(top.recommendation);

  if (top.signals.length > 0) {
    lines.push('');
    lines.push(es ? '**Señales detectadas:**' : '**Signals detected:**');
    for (const s of top.signals.slice(0, 4)) {
      lines.push(`• ${s.description}`);
    }
  }

  if (report.allConditions.length > 1) {
    const extra = report.allConditions.length - 1;
    lines.push('');
    lines.push(
      es
        ? `*${extra} condición${extra === 1 ? '' : 'es'} adicional${extra === 1 ? '' : 'es'} detectada${extra === 1 ? '' : 's'}.*`
        : `*${extra} additional condition${extra === 1 ? '' : 's'} detected.*`,
    );
  }

  return { kind: 'answer', text: lines.join('\n').trim() };
}

// ── Decision recommendation ───────────────────────────────────────────────────
// R-INTELLIGENCE-DECISION-RECOMMENDATION-V1
function handleDecisionRecommendation(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t  = tChat(lang);
  const es = lang === 'es';
  const report = engine.getDecisionRecommendationReport();

  if (!report.topRecommendation) {
    return { kind: 'answer', text: t('chat.decision.empty') };
  }

  const top = report.topRecommendation;
  const lines: string[] = [t('chat.decision.header'), ''];

  lines.push(`**${top.title}**`);
  lines.push('');
  lines.push(`• ${top.recommendedMove}`);

  if (top.reasoning) {
    lines.push('');
    lines.push(es ? `**Razón:**` : `**Reason:**`);
    lines.push(top.reasoning);
  }

  if (top.expectedBenefit) {
    lines.push('');
    lines.push(es ? `**Beneficio esperado:**` : `**Expected benefit:**`);
    lines.push(top.expectedBenefit);
  }

  if (report.recommendations.length > 1) {
    lines.push('');
    const second = report.recommendations[1];
    lines.push(
      es
        ? `*También considera: ${second.title}.*`
        : `*Also consider: ${second.title}.*`,
    );
  }

  return { kind: 'answer', text: lines.join('\n').trim() };
}

// R-SMART-OUTREACH-CAMPAIGN-V1 ─────────────────────────────────────────────
// Grouped deterministic outreach campaign. Reuses buyTodayRanking signals;
// groups by opportunity type; attaches executable WhatsApp + navigation actions.
// Anti-spam: 24h cooldown — score reduced + badge shown; WA button withheld.
function handleSmartOutreachCampaign(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const campaign = generateOutreachCampaign(engine, lang);

  if (campaign.totalCandidates === 0 || campaign.groups.length === 0) {
    return { kind: 'answer', text: t('chat.outreachCampaign.empty') };
  }

  const consentById = new Map(engine.getCustomers().map((c) => [c.id, c.communicationConsent]));
  const now = Date.now();
  const lines: string[] = [t('chat.outreachCampaign.header', campaign.totalCandidates), ''];
  const actions: ChatActionUI[] = [];
  let actionSlots = 6;

  for (const grp of campaign.groups) {
    lines.push(t(grp.groupLabelKey));
    grp.entries.forEach((entry, i) => {
      const firstName = entry.customerName.split(' ')[0] || entry.customerName;
      const urgencyBadge = entry.urgencyLevel === 'urgent'
        ? ` ${t('chat.buyToday.urgent')}`
        : entry.urgencyLevel === 'active'
          ? ` ${t('chat.buyToday.activeNow')}`
          : '';
      const cooldownBadge = entry.recentlyContacted
        ? ` ${t('chat.outreachCampaign.cooldown')}` : '';
      lines.push(`${i + 1}. ${entry.customerName} · ${entry.phone}${urgencyBadge}${cooldownBadge}`);
      entry.reasons.slice(0, 2).forEach((r) => lines.push(`   • ${r}`));
      lines.push(`   💬 "${entry.waMessage}"`);

      if (actionSlots <= 0) return;
      const consentOk = consentById.get(entry.customerId) !== false;

      if (!entry.recentlyContacted && consentOk && entry.phone) {
        actions.push({
          id: `oc-wa-${entry.customerId}-${now}`,
          label: t('chat.buyToday.action.whatsapp', firstName),
          actionType: 'whatsapp',
          payload: {
            type: 'whatsapp',
            customMessage: entry.waMessage,
            customerId: entry.customerId,
            customerName: entry.customerName,
            customerPhone: entry.phone,
            executable: true,
            executionTarget: 'whatsapp_url',
          },
        });
        actionSlots--;
      }

      if (actionSlots > 0) {
        actions.push({
          id: `oc-cust-${entry.customerId}-${now}`,
          label: t('chat.buyToday.action.openCustomer'),
          actionType: 'review',
          payload: {
            type: 'review',
            entityId: entry.customerId,
            customerId: entry.customerId,
            customerName: entry.customerName,
            executable: true,
            executionTarget: 'open_customer',
          },
        });
        actionSlots--;
      }

      if (actionSlots > 0 && entry.repairId) {
        actions.push({
          id: `oc-repair-${entry.repairId}-${now}`,
          label: t('chat.buyToday.action.openRepair'),
          actionType: 'review',
          payload: {
            type: 'review',
            entityId: entry.repairId,
            executable: true,
            executionTarget: 'open_repair',
          },
        });
        actionSlots--;
      }
    });
    lines.push('');
  }

  if (lines[lines.length - 1] === '') lines.pop();

  // R-OUTREACH-OUTCOME-FEEDBACK-V1: add Mark Replied + Mark Ignored buttons
  // for top-2 candidates (non-cooldown only — skip if already recently contacted).
  const topCandidates = campaign.groups
    .flatMap((g) => g.entries.map((e) => ({ ...e, group: g.group })))
    .filter((e) => !e.recentlyContacted)
    .slice(0, 2);

  for (const entry of topCandidates) {
    const firstName = entry.customerName.split(' ')[0] || entry.customerName;
    if (actionSlots > 0) {
      actions.push({
        id: `oc-replied-${entry.customerId}-${now}`,
        label: tChat(lang)('chat.outreachCampaign.action.markReplied', firstName),
        actionType: 'review',
        payload: {
          type: 'outcome',
          customerId: entry.customerId,
          customerName: entry.customerName,
          outreachGroup: entry.group,
          outreachOutcome: 'replied',
          executable: true,
          executionTarget: 'record_outreach_outcome',
        },
      });
      actionSlots--;
    }
    if (actionSlots > 0) {
      actions.push({
        id: `oc-ignored-${entry.customerId}-${now}`,
        label: tChat(lang)('chat.outreachCampaign.action.markIgnored', firstName),
        actionType: 'review',
        payload: {
          type: 'outcome',
          customerId: entry.customerId,
          customerName: entry.customerName,
          outreachGroup: entry.group,
          outreachOutcome: 'ignored',
          executable: true,
          executionTarget: 'record_outreach_outcome',
        },
      });
      actionSlots--;
    }
  }

  const dedupedActions = dedupeAndLimitActions(actions, 6);
  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(dedupedActions.length > 0 ? { actions: dedupedActions } : {}),
  };
}

// R-OUTREACH-OUTCOME-FEEDBACK-V1: performance summary for last 30 days.
function handleOutreachPerformance(lang: Lang3): ChatResponse {
  const summary = getOutreachPerformanceSummary(lang, 30);
  return { kind: 'answer', text: summary };
}

// R-OCE-V1: development debug intent — shows module availability + top signals.
function handleOperationalContextStatus(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const snapshot = buildOperationalContext(engine);
  const modules = getModuleStatus(snapshot);
  const top5 = getTopOperationalSignals(snapshot, 5);

  const lines: string[] = [t('chat.oceStatus.header'), ''];

  lines.push(t('chat.oceStatus.modulesHeader'));
  if (modules.length === 0) {
    lines.push(t('chat.oceStatus.noSignals'));
  } else {
    for (const m of modules) {
      const sev = m.highestSeverity ? ` (${m.highestSeverity})` : '';
      lines.push(`• ${m.module} — ${m.signalCount} signal${m.signalCount !== 1 ? 's' : ''}${sev}`);
    }
  }

  if (top5.length > 0) {
    lines.push('');
    lines.push(t('chat.oceStatus.topSignalsHeader'));
    top5.forEach((sig, i) => {
      lines.push(`${i + 1}. [${sig.severity}] ${sig.title}`);
    });
  }

  return { kind: 'answer', text: lines.join('\n') };
}

// R-GLOBAL-OPERATOR-CONSOLE-V1: store-wide priority view — TOP PRIORITY + WHY + OTHER ITEMS.
function handleGlobalOperatorConsole(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const priorities = computeGlobalOperatorPriorities(engine);

  if (priorities.length === 0) {
    return { kind: 'answer', text: `${t('goc.header')}\n\n${t('goc.empty')}` };
  }

  const [first, ...rest] = priorities;
  const lines: string[] = [
    t('goc.header'),
    '',
    t('nba.header'),
    first.headline,
    '',
    t('nba.why'),
    `• ${first.reason}`,
  ];

  if (rest.length > 0) {
    lines.push('', t('goc.others'));
    rest.forEach((p, i) => {
      const badge = p.severity === 'critical' ? '🚨 ' : p.severity === 'high' ? '⚡ ' : '';
      lines.push(`${i + 2}. ${badge}${p.headline}`);
    });
  }

  const actions = dedupeAndLimitActions(
    first.actions.length > 0
      ? buildChatActionsFromOpportunity(first.actions, first.id, lang)
      : [],
  );

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// R-GPO-V1: delegates to GOC handler (now uses full OCE pipeline incl. unlocks).
function handleGlobalPriorityStatus(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  return handleGlobalOperatorConsole(engine, lang);
}

// R-OPERATOR-DAILY-BRIEF-V2: unified aggregated operational briefing.
function handleOperatorDailyBriefV2(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const brief = generateDailyBriefV2(engine, lang);

  const totalItems = Object.values(brief.sections).reduce((s, arr) => s + (arr?.length ?? 0), 0);
  if (totalItems === 0) {
    return { kind: 'answer', text: t('chat.briefV2.noData') };
  }

  const SECTION_ORDER: BriefV2Section[] = [
    'critical_actions',
    'revenue_opportunities',
    'customer_outreach',
    'risk_detection',
    'operational_warnings',
    'momentum_signals',
  ];

  const SECTION_KEY: Record<BriefV2Section, string> = {
    critical_actions:     'chat.briefV2.section.criticalActions',
    revenue_opportunities: 'chat.briefV2.section.revenueOpps',
    customer_outreach:    'chat.briefV2.section.customerOutreach',
    risk_detection:       'chat.briefV2.section.riskDetection',
    operational_warnings: 'chat.briefV2.section.operationalWarnings',
    momentum_signals:     'chat.briefV2.section.momentumSignals',
  };

  const lines: string[] = [t('chat.briefV2.header'), ''];

  for (const section of SECTION_ORDER) {
    const items = brief.sections[section];
    if (!items || items.length === 0) continue;
    lines.push(t(SECTION_KEY[section]));
    for (const item of items) {
      lines.push(`- ${item.text}`);
    }
    lines.push('');
  }

  if (lines[lines.length - 1] === '') lines.pop();

  // Build ChatActionUI from topActions (max 5)
  const now = Date.now();
  const actions: ChatActionUI[] = [];
  for (const payload of brief.topActions) {
    if (actions.length >= 5) break;
    if (payload.executionTarget === 'whatsapp_url') {
      const name = payload.customerName?.split(' ')[0] ?? '';
      actions.push({
        id: `brief-wa-${payload.customerId ?? 'na'}-${now}`,
        label: t('chat.briefV2.action.whatsapp', name),
        actionType: 'whatsapp',
        payload,
      });
    } else if (payload.executionTarget === 'open_repair') {
      actions.push({
        id: `brief-repair-${payload.entityId ?? 'na'}-${now}`,
        label: t('chat.briefV2.action.openRepairs'),
        actionType: 'review',
        payload,
      });
    } else if (payload.executionTarget === 'open_customer') {
      const name = payload.customerName?.split(' ')[0] ?? '';
      actions.push({
        id: `brief-cust-${payload.customerId ?? 'na'}-${now}`,
        label: t('chat.briefV2.action.openCustomer', name),
        actionType: 'review',
        payload,
      });
    }
  }

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// ── INTELLIGENCE-ENTITY-INTEGRATION-V1 ─────────────────────────────────────

// Build a primary open/nav action button for a ResolvedEntity.
// Reuses existing executionTarget values — no new navigation system.
function buildEntityOpenAction(entity: ResolvedEntity, es: boolean): ChatActionUI | null {
  const ep = entityKindToExecutionPayload(entity);
  if (!ep) return null;
  const descriptor = getExecutionDescriptor(ep.action);
  const label = descriptor ? (es ? descriptor.labelEs : descriptor.labelEn) : (es ? 'Ver' : 'Open');
  return {
    id: `ec-${entity.kind}-${entity.id}`,
    label,
    payload: toActionPayload(ep),
  };
}

// Build a WhatsApp action if entity has a phone in its raw data.
function buildEntityWhatsAppAction(entity: ResolvedEntity, _es: boolean): ChatActionUI | null {
  const ep = entityKindToExecutionPayload(entity, 'whatsapp');
  if (!ep) return null;
  return {
    id: `ec-wa-${entity.id}`,
    label: 'WhatsApp',
    actionType: 'whatsapp',
    payload: toActionPayload(ep),
  };
}

// Build a Promote action for inventory products.
function buildEntityPromoteAction(entity: ResolvedEntity): ChatActionUI {
  const ep: ExecutionPayload = { action: 'promote_product', productId: entity.id, productName: entity.title };
  return {
    id: `ec-promote-${entity.id}`,
    label: 'Promote',
    triggerQuery: `promote ${entity.title}`,
    payload: toActionPayload(ep),
  };
}

// Single entity → compact summary + action buttons.
function buildEntityCommandResponse(
  entity: ResolvedEntity,
  action: EntityAction | undefined,
  es: boolean,
): ChatResponse {
  const openAction = buildEntityOpenAction(entity, es);
  const waAction = buildEntityWhatsAppAction(entity, es);
  const actions: ChatActionUI[] = [];

  // For 'open_history' on a customer, delegate to the customer lookup.
  // The caller already checks this; this is a safety guard.

  // Primary action depends on intent verb
  if (action === 'promote' && entity.kind === 'inventory_product') {
    actions.push(buildEntityPromoteAction(entity));
  } else if (action === 'whatsapp' && waAction) {
    actions.push(waAction);
    if (openAction) actions.push(openAction);
  } else if (action === 'call' && waAction) {
    // No native call executionTarget — show phone + WhatsApp as CTA
    actions.push(waAction);
    if (openAction) actions.push(openAction);
  } else {
    if (openAction) actions.push(openAction);
    if (waAction && entity.availableActions.includes('whatsapp')) actions.push(waAction);
  }

  const text = entity.subtitle
    ? `**${entity.title}**\n${entity.subtitle}`
    : `**${entity.title}**`;

  return {
    kind: 'answer',
    text,
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// Disambiguation when multiple candidates exist.
function buildEntityDisambiguation(
  candidates: ResolvedEntity[],
  es: boolean,
): ChatResponse {
  const top = candidates.slice(0, 5);
  const lines = top.map((e, i) =>
    `${i + 1}. **${e.title}**${e.subtitle ? ` — ${e.subtitle}` : ''}`,
  );
  const disambigActions: ChatActionUI[] = top.map(e => {
    const openBtn = buildEntityOpenAction(e, es);
    return openBtn ?? {
      id: `ec-disambig-${e.id}`,
      label: e.title,
      payload: { type: 'operator_action', executable: false, executionTarget: 'none' },
    };
  });
  return {
    kind: 'disambiguation',
    text: (es
      ? `Encontré ${top.length} resultados:\n`
      : `Found ${top.length} results:\n`)
      + lines.join('\n')
      + '\n\n'
      + (es ? '¿Cuál buscas?' : 'Which one are you looking for?'),
    actions: disambigActions,
  };
}

// ── R-GOER-V2: safe follow-up resolver ───────────────────────────────────────
// Deterministic entity resolution for follow-up trigger phrases.
// Wired into handleFollowUp (session context) and handleOperationalEntityCommand
// (OCE snapshot). Returns null → caller falls through to existing logic.

const GOER_TRIGGER_RE = /\b(?:open (?:it|this)|show (?:it|this)|contact (?:him|her|them)|message (?:him|her)|that (?:customer|repair|product|layaway))\b/;

function isGoerTrigger(q: string): boolean {
  return GOER_TRIGGER_RE.test(q);
}

function handleGoerFollowUp(
  query: string,
  operationalContext: unknown,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse | null {
  const tc = tChat(lang);
  const goer = resolveEntityReference({ query, operationalContext });
  if (!goer) return null;

  // R-GOER-V3: stamp the resolved entity into session memory so subsequent
  // follow-ups ("open it", "contact him") can resolve without re-stating.
  rememberResolvedEntity(goer);

  // R-OPERATOR-EVENTS-V1: publish entity_resolved event
  const resolvedEntityId: string = goer.type === 'customer'  ? goer.customerId
                                 : goer.type === 'repair'    ? goer.repairId
                                 : goer.type === 'inventory' ? goer.sku
                                 : goer.type === 'layaway'   ? goer.layawayId
                                 : goer.saleId;
  publishOperatorEvent({
    id:         `event-entity-resolved-${goer.type}-${resolvedEntityId}`,
    type:       'entity_resolved',
    source:     'intelligence',
    entityType: goer.type,
    entityId:   resolvedEntityId,
  });

  if (goer.type === 'customer') {
    const c = engine.getCustomers().find(
      cu => cu.id === goer.customerId || (cu as any).phone === goer.customerId,
    );
    const name = c
      ? String((c as any).name || '').trim() || goer.customerId
      : goer.customerId;
    // R-EXECUTION-PIPELINE-V1: derive open action via execution request builder
    // TODO: replace 'owner' with current session role once role mgmt is wired
    // Future (R-APPROVAL-QUEUE-V1): when openReq.status === 'requires_approval',
    //   create approval queue item and surface approval message to the user.
    const openDesc = getActionDescriptor('customer', 'open')!;
    const openPerm = evaluateActionPermission({ role: 'owner', descriptor: openDesc, entityKind: 'customer', actionKey: 'open' });
    const openReq  = buildExecutionRequest({ entity: goer, action: openDesc, permission: openPerm })!;
    publishOperatorEvent({
      id:         `event-execution-request-${openReq.id}`,
      type:       'execution_request_created',
      source:     'intelligence',
      entityType: goer.type,
      entityId:   openReq.payload.entityId,
      actionKey:  openDesc.key,
      requestId:  openReq.id,
      status:     openReq.status,
    });
    const actions: ChatActionUI[] = [{
      id:      openReq.id,
      label:   tc(openDesc.labelKey),
      payload: openReq.payload as ActionPayload,
    }];
    if (c && (c as any).phone) {
      actions.push({
        id: `goer-wa-${goer.customerId}`,
        label: tc(getActionDescriptor('customer', 'whatsapp')!.labelKey, name),
        payload: {
          type: 'whatsapp',
          customerId: goer.customerId,
          customerName: name,
          customerPhone: (c as any).phone,
          executable: true,
          executionTarget: 'whatsapp_url',
        },
      });
    }
    return { kind: 'answer', text: tc('chat.entityResolution.resolvedCustomer', name), actions };
  }

  if (goer.type === 'repair') {
    const r = engine.getRepairs().find(re => re.id === goer.repairId);
    const desc = r
      ? `${(r as any).ticketNumber ?? goer.repairId}${(r as any).customerName ? ` — ${(r as any).customerName}` : ''}`
      : goer.repairId;
    // R-EXECUTION-PIPELINE-V1
    const openDesc = getActionDescriptor('repair', 'open')!;
    const openPerm = evaluateActionPermission({ role: 'owner', descriptor: openDesc, entityKind: 'repair', actionKey: 'open' });
    const openReq  = buildExecutionRequest({ entity: goer, action: openDesc, permission: openPerm })!;
    publishOperatorEvent({
      id:         `event-execution-request-${openReq.id}`,
      type:       'execution_request_created',
      source:     'intelligence',
      entityType: goer.type,
      entityId:   openReq.payload.entityId,
      actionKey:  openDesc.key,
      requestId:  openReq.id,
      status:     openReq.status,
    });
    return {
      kind: 'answer',
      text: tc('chat.entityResolution.resolvedRepair', desc),
      actions: [{ id: openReq.id, label: tc(openDesc.labelKey), payload: openReq.payload as ActionPayload }],
    };
  }

  if (goer.type === 'layaway') {
    const l = engine.getLayaways().find(la => la.id === goer.layawayId);
    const desc = l ? String((l as any).customerName ?? goer.layawayId) : goer.layawayId;
    // R-EXECUTION-PIPELINE-V1
    const openDesc = getActionDescriptor('layaway', 'open')!;
    const openPerm = evaluateActionPermission({ role: 'owner', descriptor: openDesc, entityKind: 'layaway', actionKey: 'open' });
    const openReq  = buildExecutionRequest({ entity: goer, action: openDesc, permission: openPerm })!;
    publishOperatorEvent({
      id:         `event-execution-request-${openReq.id}`,
      type:       'execution_request_created',
      source:     'intelligence',
      entityType: goer.type,
      entityId:   openReq.payload.entityId,
      actionKey:  openDesc.key,
      requestId:  openReq.id,
      status:     openReq.status,
    });
    return {
      kind: 'answer',
      text: tc('chat.entityResolution.resolvedLayaway', desc),
      actions: [{ id: openReq.id, label: tc(openDesc.labelKey), payload: openReq.payload as ActionPayload }],
    };
  }

  if (goer.type === 'inventory') {
    const inv = engine.getInventory().find(i => i.id === goer.sku || (i as any).sku === goer.sku);
    const desc = inv ? String((inv as any).name ?? goer.sku) : goer.sku;
    // R-EXECUTION-PIPELINE-V1
    const openDesc = getActionDescriptor('inventory', 'open')!;
    const openPerm = evaluateActionPermission({ role: 'owner', descriptor: openDesc, entityKind: 'inventory', actionKey: 'open' });
    const openReq  = buildExecutionRequest({ entity: goer, action: openDesc, permission: openPerm })!;
    publishOperatorEvent({
      id:         `event-execution-request-${openReq.id}`,
      type:       'execution_request_created',
      source:     'intelligence',
      entityType: goer.type,
      entityId:   openReq.payload.entityId,
      actionKey:  openDesc.key,
      requestId:  openReq.id,
      status:     openReq.status,
    });
    return {
      kind: 'answer',
      text: tc('chat.entityResolution.resolvedInventory', desc),
      actions: [{ id: openReq.id, label: tc(openDesc.labelKey), payload: openReq.payload as ActionPayload }],
    };
  }

  if (goer.type === 'sale') {
    return { kind: 'answer', text: tc('chat.entityResolution.resolvedSale', goer.saleId) };
  }

  return null;
}

function handleOperationalEntityCommand(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const es = lang === 'es';
  const rawQuery = match.query || '';

  // R-GOER-V2: try deterministic follow-up resolution before entity intent lookup.
  // Uses OCE snapshot for context (session context not available at this call site).
  const q = rawQuery.toLowerCase().trim();
  if (isGoerTrigger(q)) {
    const goerResp = handleGoerFollowUp(rawQuery, buildOperationalContext(engine), engine, lang);
    if (goerResp) return goerResp;
    // GOER couldn't resolve — fall through to existing entity intent resolver
  }

  const result: EntityIntentResult = resolveEntityIntent(rawQuery, engine);

  // Nothing found → try old resolver as fallback, then generic fallback
  if (!result.entity) {
    const oldMatch = resolveOperationalEntity(rawQuery, engine);
    if (oldMatch) return handleEntityLookup(oldMatch, engine, lang);
    return {
      kind: 'answer',
      text: es
        ? 'No encontré ningún resultado para esa búsqueda.'
        : 'No results found for that search.',
    };
  }

  // 'open_history' on customer → delegate to existing full history handler
  if (result.action === 'open_history' && result.entity.kind === 'customer') {
    const fakeMatch: IntentMatch = {
      id: 'customer_history',
      confidence: 0.9,
      matchedCustomer: result.entity.raw as import('@/store/types').Customer,
    };
    return handleCustomerHistory(fakeMatch, engine, es);
  }

  // Multiple candidates of same kind → disambiguation
  const sameKind = result.candidates.filter(c => c.kind === result.entity!.kind);
  if (sameKind.length > 1) {
    return buildEntityDisambiguation(sameKind, es);
  }

  return buildEntityCommandResponse(result.entity, result.action, es);
}

// ── INTELLIGENCE-OPERATOR-CONTINUITY-RUNTIME-V1 ───────────────────────────────

function kindToOpenAction(kind: string): OperationalExecutionAction | null {
  switch (kind) {
    case 'repair':             return 'open_repair';
    case 'customer':           return 'open_customer';
    case 'layaway':            return 'open_layaway';
    case 'unlock':             return 'open_unlock';
    case 'special_order':      return 'open_special_order';
    case 'inventory_product':  return 'open_inventory';
    default:                   return null;
  }
}

function buildWorkflowOpenAction(session: WorkflowSession, es: boolean): ChatActionUI | null {
  const act = session.entityKind ? kindToOpenAction(session.entityKind) : null;
  if (!act || !session.entityId) return null;
  const ep: ExecutionPayload = {
    action: act,
    entityId: session.entityId,
    customerName: session.entityName,
  };
  return {
    id: `wf-open-${session.entityId}`,
    label: es ? 'Abrir' : 'Open',
    payload: toActionPayload(ep),
  };
}

function buildWorkflowWhatsAppAction(session: WorkflowSession): ChatActionUI | null {
  if (!session.entityPhone) return null;
  const ep: ExecutionPayload = {
    action: 'whatsapp_url',
    customerPhone: session.entityPhone,
    customerName: session.entityName,
  };
  return {
    id: `wf-wa-${session.entityId ?? 'unknown'}`,
    label: 'WhatsApp',
    payload: toActionPayload(ep),
  };
}

// INTELLIGENCE-ATTENTION-FEED-INTEGRATION-V1
// Read-only — never mutates missions, workflows, or attention state.

function attentionActionLabel(action: string, es: boolean): string {
  switch (action) {
    case 'open_repair':         return es ? 'Ver Ticket'      : 'Open Ticket';
    case 'open_customer':       return es ? 'Ver Cliente'     : 'View Customer';
    case 'open_layaway':        return es ? 'Ver Layaway'     : 'View Layaway';
    case 'open_unlock':         return es ? 'Ver Unlock'      : 'View Unlock';
    case 'open_special_order':  return es ? 'Ver Orden'       : 'View Order';
    case 'open_inventory':      return es ? 'Ver Inventario'  : 'View Inventory';
    case 'whatsapp_url':        return 'WhatsApp';
    case 'promote_product':     return es ? 'Promover'        : 'Promote';
    default:                    return es ? 'Ver'             : 'View';
  }
}

function handleAttentionFeed(
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const es = lang === 'es';
  const feed = getAttentionFeed(engine, 5);

  // INTELLIGENCE-OPERATOR-TIMELINE-V1: record each visible item.
  for (const item of feed) recordAttentionShown(item);

  if (feed.length === 0) {
    return {
      kind: 'answer',
      text: es
        ? 'Sin items urgentes en este momento. Todo está al día.'
        : 'No urgent items right now. Everything is up to date.',
    };
  }

  const header = es ? '**Requiere atención ahora:**' : '**Needs attention now:**';

  const lines = feed.map((item, i) => {
    const rank = i + 1;
    const sevLabel = es ? 'Severidad' : 'Severity';
    return `${rank}. **${item.title}**\n${item.reason}\n${sevLabel}: ${item.severity}/100`;
  });

  const text = `${header}\n\n${lines.join('\n\n')}`;

  // Build action buttons — open entity + WhatsApp + continue-workflow trigger
  const actions: ChatActionUI[] = [];

  for (const item of feed) {
    if (!item.executionPayload) continue;

    const ep = item.executionPayload;
    const openLabel = attentionActionLabel(ep.action, es);

    actions.push({
      id: `attn-open-${item.id}`,
      label: openLabel,
      payload: toActionPayload(ep),
    });

    // WhatsApp action when phone is available
    if ('customerPhone' in ep && ep.customerPhone) {
      const waEp: import('../execution/types').ExecutionPayload = {
        action: 'whatsapp_url',
        customerPhone: ep.customerPhone,
        customerName: ('customerName' in ep ? ep.customerName : undefined),
      };
      actions.push({
        id: `attn-wa-${item.id}`,
        label: 'WhatsApp',
        payload: toActionPayload(waEp),
      });
    }

    // Unfinished workflow items get a re-fire button that routes to workflow_continuity
    if (item.type === 'unfinished_workflow') {
      actions.push({
        id: `attn-wf-${item.id}`,
        label: es ? 'Continuar flujo' : 'Continue workflow',
        payload: toActionPayload({ action: 'open_repair', entityId: item.entityId ?? '', customerName: item.title }),
        triggerQuery: 'continue',
      });
    }
  }

  return {
    kind: 'answer',
    text,
    actions: actions.length > 0 ? actions : undefined,
  };
}

function handleWorkflowContinuityCommand(
  match: IntentMatch,
  _engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const es = lang === 'es';

  // 1. Check for active session
  const session = getActiveWorkflowSession();
  if (!session) {
    return {
      kind: 'answer',
      text: es
        ? 'No hay ningún flujo de trabajo activo en este momento. Inicia uno con un comando como "cobrar a Juan" o "seguimiento reparación 1032".'
        : 'No active workflow right now. Start one with a command like "collect payment from John" or "follow up repair 1032".',
    };
  }

  // 2. Classify follow-up action
  const rawQuery = match.query ?? '';
  const followUp = resolveWorkflowFollowUp(rawQuery);
  const action = followUp.action ?? 'continue';

  // 3. Cancel — expire session immediately
  if (action === 'cancel') {
    expireWorkflowSession(session.id);
    recordWorkflowCompleted(session, 'Cancelled'); // INTELLIGENCE-OPERATOR-TIMELINE-V1
    return {
      kind: 'answer',
      text: es ? 'Flujo de trabajo cancelado.' : 'Workflow cancelled.',
    };
  }

  // 4. Complete — mark done, no side effects
  if (action === 'complete') {
    completeWorkflowSession(session.id);
    recordWorkflowCompleted(session); // INTELLIGENCE-OPERATOR-TIMELINE-V1
    const def = getWorkflowDefinition(session.type);
    const entityPart = session.entityName ? ` — ${session.entityName}` : '';
    return {
      kind: 'answer',
      text: es
        ? `✓ ${def.labelEs}${entityPart} marcado como completado.`
        : `✓ ${def.labelEn}${entityPart} marked as complete.`,
    };
  }

  // 5. Continue — advance one step
  const advanced = action === 'continue' ? advanceWorkflowSession(session.id) : session;
  const activeSession = advanced ?? session;
  recordWorkflowContinued(activeSession); // INTELLIGENCE-OPERATOR-TIMELINE-V1

  // 6. Build next-step guidance (no auto-execution)
  const nextStep = getWorkflowNextStep(activeSession);

  // 7. Attach safe actions — open entity and/or WhatsApp draft only
  const safeActions: ChatActionUI[] = [];

  const openAction = buildWorkflowOpenAction(activeSession, es);
  const waAction = buildWorkflowWhatsAppAction(activeSession);

  if (
    nextStep.suggestedAction === 'open_entity' ||
    action === 'open_entity'
  ) {
    if (openAction) safeActions.push(openAction);
  }

  if (
    nextStep.suggestedAction === 'send_message' ||
    action === 'send_message'
  ) {
    if (waAction) safeActions.push(waAction);
    if (openAction && !safeActions.includes(openAction)) safeActions.push(openAction);
  }

  const stepText = activeSession.completed
    ? (es ? `✓ ${nextStep.labelEs} — flujo completado.` : `✓ ${nextStep.labelEn} — workflow complete.`)
    : (es ? nextStep.labelEs : nextStep.labelEn);

  return {
    kind: 'answer',
    text: stepText,
    actions: safeActions.length > 0 ? safeActions : undefined,
  };
}
