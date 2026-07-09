// ============================================================
// CellHub Intelligence — Chat Interface
// R-INTEL-CHAT-F5
//
// Ask-the-shop chat. Pure client-side intent routing + template
// responses. No LLM calls, no API cost. Handles ~80% of common
// owner questions deterministically.
// ============================================================

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer, CartItem } from '@/store/types';
import { classifyIntent, isFollowUpQuery, enrichFollowUpQuery } from '@/services/intelligence/chat/intentRouter';
import type { OperationalContext } from '@/services/intelligence/chat/intentRouter';
import { handleIntent, handleFollowUp, tChat } from '@/services/intelligence/chat/handlers';
// R-INTEL-V2-PHASE1B: AR reminder outreach tracking (append-only, read-only of source).
import { recordArReminder, buildMessagePreview } from '@/services/intelligence/ar/arReminderStore';
import type { ChatActionUI, PanelCampaignDraft, WorkflowSection, Lang3 } from '@/services/intelligence/chat/handlers';
// R-INTELLIGENCE-F3D: canonical Top 3 Actions Today (F3B) — the Daily Brief's
// single priority source. Prop-drilled in (computed once in IntelligenceModule,
// F3C); never recomputed here.
import type { TopAction } from '@/services/intelligence/decision/ranking/topActionsRanking';
// R-INTELLIGENCE-F3D3: shared row renderer (same data rendering as the panel card).
import TopActionRow from './TopActionRow';
import { executeActionPayload } from '@/services/intelligence/actions/actionExecutor';
// R-INTELLIGENCE-OPERATOR-CONTINUITY-V2: deterministic post-action next-steps.
import { resolvePostActionContinuity } from '@/services/intelligence/continuity/postActionContinuity';
// R-INTELLIGENCE-OPERATOR-SESSIONS-V1: lightweight active-workflow tracking.
import {
  deriveOperatorSessionFromAction, shouldShowSessionHint, sessionHintKey,
  type OperatorSession,
} from '@/services/intelligence/continuity/operatorSession';
import {
  createAutomationItem,
  approveAutomationItem,
  cancelAutomationItem,
  markAutomationExecuted,
  markAutomationFailed,
  addAutomationOutcome,
  addAutomationExecutionLog,
  addDealOutcomeLog,
  addProposalFollowup,
  addDealPipelineItem,
  findOpenDealByCustomerOrProduct,
} from '@/services/intelligence/automation/automationQueue';
import type { AutomationQueueItem, AutomationOutcome, DealOutcome } from '@/services/intelligence/automation/automationQueue';
import { scoreAutomationItem } from '@/services/intelligence/automation/automationPriority';
import { addOperatorQueueItem } from '@/services/intelligence/operatorQueue/operatorQueue';
import type { OperatorTaskType } from '@/services/intelligence/operatorQueue/operatorQueue';
import { getOutcomeAdjustment } from '@/services/intelligence/operatorQueue/outcomeLearning';
import { Modal, useToast } from '@/components/ui';
import { useTranslation } from '@/i18n';
import ResponseCard from './ResponseCard';
import SuggestionChips, { type ChipData } from './SuggestionChips';
import OperatorContinuityBar from './OperatorContinuityBar';
import { getPendingResumeContexts } from '@/services/intelligence/workflowContinuity/workflowContinuityStore';
import { pushSessionContext, getSessionContext, clearSessionContext } from '@/services/intelligence/chat/sessionContext';
// CUSTOMER-RECOVER-BUTTON-INTEL-CONTEXT-FIX-V1: one-shot explicit customer
// set by module action buttons (Customers Recover/VIP) — wins over text parsing.
import { consumePendingExplicitCustomer } from '@/services/intelligence/context/intelligenceContext';
// R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: convert approved deal → POS cart line.
import { useApp } from '@/store/AppProvider';
import { generateId } from '@/utils/dates';
import { resolveOwnerFinancialAccess } from '@/utils/financialPrivacy';
// R-INTELLIGENCE-DECISION-LAYER-F2C: approval enforcement for the one money-
// changing Intelligence path (deal → discounted cart line). Narrow by design.
import { useApprovalGate } from '@/hooks/useApprovalGate';
import { useGlobalCart } from '@/hooks/useGlobalCart';
import { approvalRequestFromPendingDeal } from '@/services/intelligence/decision/approval/IntelligenceApprovalAdapter';
import { getConnection } from '@/services/lan/lanService';
// R-INTEL-ROUTER-V1 (shadow mode): deterministic route classification computed
// before handleIntent. Observed only (dev console + ref); changes no behavior.
import { routeIntelligenceRequest } from '@/services/intelligence/router/routeIntelligenceRequest';
import type { IntelligenceRoute } from '@/services/intelligence/router/types';
// R-INTELLIGENCE-PERFORMANCE-AUDIT-V1: temporary perf instrumentation.
import { perfLog, perfTime } from '@/services/intelligence/perfDebug';
import { recordOperatorAction } from '@/services/intelligence/history/operatorActionHistory';
// INTELLIGENCE-PROACTIVE-OPERATOR-SURFACES-V1
import { getAttentionFeed } from '@/services/intelligence/attention/attentionEngine';
import type { OperatorAttentionItem } from '@/services/intelligence/attention/types';
// INTELLIGENCE-OPERATOR-TIMELINE-V1
import { recordActionClicked } from '@/services/intelligence/timeline/timelineRecorder';

interface Props {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es' | 'pt';
  // When this changes (new seq), the chat auto-submits the query text.
  externalQuery?: { text: string; seq: number };
  // R-OPERATOR-EXECUTABLE-ACTIONS-V1: callback invoked when the user clicks
  // an open_promote_panel action. The parent IntelligenceModule wires this
  // to setSelectedProduct + scrollIntoView so clicking "Promote {name}"
  // jumps directly to the Promote Inventory panel with the exact product
  // already selected. No manual search, no chat-replay dead-end.
  onOpenPromote?: (productId: string, productName: string) => void;
  // R-OPERATOR-PROMOTE-PANEL-PREVIEW-V1: callback invoked whenever a chat
  // response carries a panelCampaign draft (today: only product_push).
  // The parent IntelligenceModule renders an editable textarea + per-
  // recipient WhatsApp buttons inside the Promote Inventory panel using
  // the existing buildWhatsAppUrl helper. No autonomous send, no API.
  onPanelCampaign?: (draft: PanelCampaignDraft) => void;
  chipData?: ChipData;
  // R-INTELLIGENCE-F3D: canonical Top 3 Actions Today (F3B), computed once in
  // IntelligenceModule and drilled in. The Daily Brief renders these directly.
  topActions?: TopAction[];
  compact?: boolean;
  hideInput?: boolean;
  clearSeq?: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  kind?: 'answer' | 'disambiguation' | 'error' | 'help';
  actions?: ChatActionUI[];
  workflowSections?: WorkflowSection[];
}

const AUTOMATION_QUEUE_STORAGE_KEY = 'cellhub:intelligence:automationQueue:v1';

export default function IntelligenceChat({ engine, customers, lang, externalQuery, onOpenPromote, onPanelCampaign, chipData, topActions, compact, hideInput, clearSeq }: Props) {
  const { locale, t } = useTranslation();
  // R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: cart + inventory + dispatch
  // for converting approved deals into POS cart lines. Mirrors the pattern
  // used by RepairModule, UnlockModule, SpecialOrdersModule, ReturnsModule.
  const {
    state: { cart, inventory, settings, isAdminMode, currentEmployee, employees },
    dispatch,
  } = useApp();
  // R-GLOBAL-CART-UNIFY-V1: deal → cart → stay in Intelligence → auto-open drawer.
  const { commitCart } = useGlobalCart();
  // R-FINANCIAL-PRIVACY-V2 + R-FINANCIAL-PRIVACY-POLICY-C C3: intercept dispatch
  // of profit-intent queries so non-owner employees see a redacted reply instead
  // of profit/margin/cost. Policy C: role-aware via resolveOwnerFinancialAccess —
  // owner always sees; managers see ONLY when managersCanViewFinancials is on;
  // isAdminMode (admin/PIN unlock) alone does NOT grant manager/employee access.
  const canSeeOwnerFinancialsRef = useRef(resolveOwnerFinancialAccess({
    settings,
    currentEmployee,
    isAdminMode,
  }));
  useEffect(() => {
    canSeeOwnerFinancialsRef.current = resolveOwnerFinancialAccess({
      settings,
      currentEmployee,
      isAdminMode,
    });
  }, [settings, isAdminMode, currentEmployee]);
  const { toast } = useToast();
  // R-INTELLIGENCE-DECISION-LAYER-F2C: PIN gate for deal → discounted-cart-line.
  // Own instance (the hook is intentionally per-module). Modal rendered below.
  const dealApprovalGate = useApprovalGate({
    employees,
    settings,
    attemptedByName: currentEmployee?.name,
  });
  // F2C: ref-mirror of cart so the post-approval (post-await) cart write in
  // handleAddDealToCart appends to the freshest array, not a stale closure.
  const cartRef = useRef(cart);
  useEffect(() => { cartRef.current = cart; }, [cart]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // INTEL-PERF-CHAT-MEMO-V1: the command-bar text state moved into
  // ChatCommandBar (bottom of file) so keystrokes re-render only that small
  // component instead of the whole chat (history + queue + modals).
  const [pendingWaAction, setPendingWaAction] = useState<{ action: ChatActionUI; url: string } | null>(null);
  const [actionFeedbackById, setActionFeedbackById] = useState<
    Record<string, { message: string; ts: number }>
  >({});
  const [automationQueue, setAutomationQueue] = useState<AutomationQueueItem[]>(() => {
    const _t = performance.now();
    let parsed: AutomationQueueItem[] = [];
    try {
      const raw = localStorage.getItem(AUTOMATION_QUEUE_STORAGE_KEY);
      if (raw) {
        const candidate = JSON.parse(raw);
        if (Array.isArray(candidate)) parsed = candidate;
      }
    } catch {
      /* incognito / quota — proceed with empty */
    }
    // R-INTELLIGENCE-REFRESH-FREEZE-QUEUE-CLEANUP-REPAIR-INTENT-FIX:
    // strip legacy non-executable queue items so the persisted
    // "whatsapp_reconnect · failed: not_executable" leftovers from
    // earlier sessions disappear on hydrate. Two cleanup rules:
    //   1. payload.actionPayload.executionTarget === 'none' (chat-replay
    //      shortcuts that never had a real executor)
    //   2. status === 'failed' AND last execution-log reason ===
    //      'not_executable' (already-failed legacy items)
    // Persist back so the cleanup is durable; only writes when the
    // filtered list differs to avoid spurious persistence churn.
    const cleaned = parsed.filter((item) => {
      const ap = item.payload?.actionPayload;
      if (ap?.executionTarget === 'none') return false;
      const log = item.executionLog;
      if (item.status === 'failed' && log && log.length > 0) {
        const last = log[log.length - 1];
        if (last && last.reason === 'not_executable') return false;
      }
      return true;
    });
    if (cleaned.length !== parsed.length) {
      try { localStorage.setItem(AUTOMATION_QUEUE_STORAGE_KEY, JSON.stringify(cleaned)); } catch {}
    }
    perfLog('intel.chat.queue.hydrate', _t);
    return cleaned;
  });
  const messageListRef = useRef<HTMLDivElement>(null);
  const prevExternalSeq = useRef(-1);
  // R-INTELLIGENCE-INTENT-DEDUP-ISOLATION: defensive last-response guard.
  // Prevents identical back-to-back assistant pushes within a short window
  // (StrictMode double-invoke, race-condition re-fire, etc.). Same query
  // fired again later (different click, different seq) is still allowed.
  const lastResponseRef = useRef<{ text: string; ts: number }>({ text: '', ts: 0 });
  // R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1: remember last matched intent so
  // short follow-ups ("why?", "qué hago", "explica") can re-use its
  // context instead of running classifyIntent over a generic phrase.
  const lastIntentRef = useRef<{ intentId: string; query: string; responseText: string; ts: number } | null>(null);
  // R-INTELLIGENCE-CONTEXT-MEMORY-V1: session-only operational context
  // (max depth 1). Populated when a context-establishing handler returns
  // ChatResponse.establishesContext + non-error kind. Read by the
  // enrichFollowUpQuery rewrite step below. Ref-based (no re-render),
  // not persisted, not synced — a page refresh clears it. O(1) read.
  const operationalContextRef = useRef<OperationalContext | null>(null);
  // R-INTEL-ROUTER-V1 (shadow): last computed route — dev/debug only, no render.
  const lastRouteRef = useRef<IntelligenceRoute | null>(null);

  // Auto-submit when parent fires a quick-action chip.
  const engineRef = useRef(engine);
  const customersRef = useRef(customers);
  const langRef = useRef(lang);
  useEffect(() => { engineRef.current = engine; }, [engine]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // R-INTELLIGENCE-SESSION-CONTEXT-V1: restore context from localStorage on mount.
  // Lets "contact him" and "why?" work even after a tab switch or page reload,
  // as long as the previous context hasn't expired (30-min TTL).
  useEffect(() => {
    const saved = getSessionContext();
    if (!saved) return;
    if (saved.lastIntent) {
      lastIntentRef.current = { intentId: saved.lastIntent, query: '', responseText: '', ts: saved.timestamp };
    }
    if (saved.lastCustomerId) {
      operationalContextRef.current = { type: 'customer', value: saved.lastCustomerId, timestamp: saved.timestamp };
    } else if (saved.lastRepairId) {
      operationalContextRef.current = { type: 'repair', value: saved.lastRepairId, timestamp: saved.timestamp };
    }
  }, []); // once on mount — intentional

  function setFeedbackForAction(actionId: string, message: string) {
    const ts = Date.now();
    setActionFeedbackById((prev) => ({ ...prev, [actionId]: { message, ts } }));
    window.setTimeout(() => {
      setActionFeedbackById((prev) => {
        if (prev[actionId]?.ts !== ts) return prev;
        const next = { ...prev };
        delete next[actionId];
        return next;
      });
    }, 5000);
  }

  function clearActionFeedback() {
    setActionFeedbackById({});
  }

  // R-PERF-HARDENING-V1 #1: pre-compute priority scores ONCE per render
  // instead of calling scoreAutomationItem twice per item (sort comparator
  // + map body). Single pass; only re-runs when automationQueue changes.
  const sortedQueueWithPriority = useMemo(() => perfTime('intel.chat.queue.scoreAndSort', () => {
    return automationQueue
      .map((item) => ({ item, priority: scoreAutomationItem(item) }))
      .sort((a, b) => b.priority.score - a.priority.score);
  }), [automationQueue]);

  function createQueueItemFromChatAction(action: ChatActionUI): AutomationQueueItem {
    const kindMap = {
      whatsapp: 'whatsapp_reconnect',
      discount: 'discount_review',
      bundle:   'bundle_review',
      reminder: 'reminder_followup',
      review:   'manual_review',
    } as const;
    return createAutomationItem({
      // R-INTELLIGENCE-PENDING-DEAL-V1: queueKind overrides the default
      // actionType→kind map (e.g., 'pending_deal' instead of 'whatsapp_reconnect').
      kind: action.queueKind ?? kindMap[action.actionType ?? 'review'],
      label: action.label,
      customerId: action.payload.customerId,
      customerName: action.payload.customerName,
      sku: action.payload.sku,
      // R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: persist the full deal record
      // alongside the actionPayload so the later "Add to POS Cart" click can
      // read proposedPriceCents / originalPriceCents / qty without re-deriving.
      payload: action.pendingDeal
        ? { actionPayload: action.payload, pendingDeal: action.pendingDeal }
        : { actionPayload: action.payload },
    });
  }

  function automationKey(item: AutomationQueueItem): string {
    return [item.kind, item.label, item.customerId ?? '', item.customerName ?? '', item.sku ?? ''].join('|');
  }

  function addAutomationItems(items: AutomationQueueItem[]) {
    setAutomationQueue(prev => {
      const existing = new Set(prev.map(automationKey));
      const next = items.filter(item => !existing.has(automationKey(item)));
      return [...prev, ...next];
    });
  }

  // R-INTELLIGENCE-AUTOMATION-QUEUE-FAIL-FREEZE-FIX: only enqueue actions
  // that map to a real executor. Chat-replay (triggerQuery) shortcuts and
  // actions with executionTarget='none' would land in the queue, then fail
  // with reason='not_executable' on Approve — surfacing a confusing
  // "whatsapp_reconnect · failed: not_executable" item to the owner.
  function isQueueableAction(action: ChatActionUI): boolean {
    if (action.triggerQuery && action.triggerQuery.trim().length > 0) return false;
    if (action.payload.executionTarget === 'none') return false;
    return true;
  }

  const fireQuery = useCallback((query: string) => {
    // R-INTELLIGENCE-PERFORMANCE-AUDIT-V1: time the full chat dispatch path
    // (classify + handle). Heaviest single hot path on the Intelligence tab.
    const _fireT0 = performance.now();
    // CUSTOMER-RECOVER-BUTTON-INTEL-CONTEXT-FIX-V1: consume the one-shot at
    // the top of EVERY fired query so it can never linger past the query it
    // was set for. Applied below only for customer outreach intents; manual
    // typing (handleSubmit) never consumes or sets it.
    const explicitCustomer = consumePendingExplicitCustomer();
    // R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1: short follow-up phrases re-use
    // the last intent's context. Early return — no classifyIntent, no scan.
    let response;
    let matchedIntentId: string;
    if (isFollowUpQuery(query) && lastIntentRef.current) {
      response = perfTime('intel.chat.handleFollowUp',
        () => handleFollowUp(lastIntentRef.current!, engineRef.current, langRef.current, operationalContextRef.current, query));
      matchedIntentId = lastIntentRef.current.intentId; // preserve context for chained follow-ups
    } else if (isFollowUpQuery(query)) {
      // Follow-up phrase with no prior context — clarify instead of mis-routing to classifyIntent.
      response = { kind: 'answer' as const, text: langRef.current === 'es' ? 'No hay contexto reciente. Haz una pregunta completa.' : langRef.current === 'pt' ? 'Sem contexto recente. Faça uma pergunta completa.' : 'No recent context to reference. Please ask a complete question.' };
      matchedIntentId = 'followup_no_context';
    } else {
      // R-INTELLIGENCE-CONTEXT-MEMORY-V1: deterministic operational
      // follow-up enrichment. If the raw query matches a known vague
      // follow-up pattern AND we have an active context (depth 1),
      // rewrite the query into a fully-specified one BEFORE classify.
      // O(1) over a small fixed rule list. Pure, no AI, no I/O.
      const enrichedQuery = enrichFollowUpQuery(query, operationalContextRef.current);
      const queryToRoute = enrichedQuery ?? query;
      const match = perfTime('intel.chat.classifyIntent',
        () => classifyIntent(queryToRoute, customersRef.current, langRef.current));
      // CUSTOMER-RECOVER-BUTTON-INTEL-CONTEXT-FIX-V1: a button-originated
      // query carries the exact customer — it overrides whatever the text
      // parser resolved (or failed to resolve). Text parsing remains the
      // fallback for typed prompts and for a stale/missing id.
      if (explicitCustomer && (match.id === 'recover_customer' || match.id === 'vip_outreach')) {
        const exact = customersRef.current.find((c) => c && c.id === explicitCustomer.customerId);
        if (exact) {
          match.matchedCustomer = exact;
          match.extractedName = exact.name;
          match.candidateCustomers = undefined;
        }
      }
      // R-INTEL-ROUTER-V1 (shadow mode): classify the route BEFORE dispatch.
      // Pure + deterministic; observed only — does NOT alter the response.
      const _route = routeIntelligenceRequest({
        source: 'chat', query, intentId: match.id, devMode: import.meta.env.DEV,
      });
      lastRouteRef.current = _route;
      if (import.meta.env.DEV) console.debug('[IntelligenceRouter:shadow]', _route.reasonCode, _route);
      // R-FINANCIAL-PRIVACY-V2: intercept profit-intent queries when the
      // viewer cannot see owner financials. We never invoke the handler so
      // its profit/margin/cost numbers cannot leak. Operational intents are
      // unaffected.
      const PROFIT_SENSITIVE_INTENTS: ReadonlySet<string> = new Set([
        'best_customer', 'least_profitable_customers',
        'what_hurting_profit', 'what_is_losing_money',
        // R-FINANCIAL-PRIVACY-V5 (audit Priority B): product_opportunities is
        // fully blocked — its whole reply is margin/profit framing. NOTE:
        // restock_opportunity is NOT full-blocked anymore (Tier 2): employees
        // keep the operational restock list; only the per-item margin line is
        // redacted inside handleRestockOpportunity via canSeeOwnerFinancials.
        'product_opportunities',
      ]);
      if (!canSeeOwnerFinancialsRef.current && PROFIT_SENSITIVE_INTENTS.has(match.id)) {
        const es = langRef.current === 'es';
        response = {
          kind: 'answer' as const,
          text: es
            ? 'Esta vista (ganancia, costo, margen) está oculta por la configuración de Privacidad Financiera. Pídele al propietario que la active si la necesitas.'
            : 'This view (profit, cost, margin) is hidden by the Financial Privacy setting. Ask the owner to grant access if you need it.',
        };
        matchedIntentId = match.id;
      } else {
        response = perfTime(`intel.chat.handleIntent.${match.id}`,
          () => handleIntent(match, engineRef.current, langRef.current, canSeeOwnerFinancialsRef.current));
        matchedIntentId = match.id;
      }
    }
    perfLog('intel.chat.fireQuery.total', _fireT0);
    const now = Date.now();
    // R-OPERATOR-PROMOTE-EXECUTION-FIX-V1: forward panelCampaign BEFORE the
    // dedup early-return. Previously the dedup at "skip identical assistant
    // push within 500ms" returned ahead of this block, so a re-clicked
    // Promote button (or StrictMode double-effect) would leave the module's
    // panelCampaign stuck at null after handleOpenPromote cleared it.
    // panelCampaign forwarding is idempotent (React state updates dedupe
    // when the value is reference-equal, and same-content re-applies are
    // harmless), so safe to run before dedup.
    if (response.panelCampaign && onPanelCampaign) {
      onPanelCampaign(response.panelCampaign);
    }
    // R-INTELLIGENCE-INTENT-DEDUP-ISOLATION: skip identical assistant push
    // within 500ms of the last identical response (prevents double-render
    // from StrictMode/race re-fire). Always refresh the timestamp so a
    // legitimate repeat query later still pushes.
    if (response.text === lastResponseRef.current.text && now - lastResponseRef.current.ts < 500) {
      lastResponseRef.current.ts = now;
      return;
    }
    lastResponseRef.current = { text: response.text, ts: now };
    // R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1: store last intent for next follow-up.
    lastIntentRef.current = { intentId: matchedIntentId, query, responseText: response.text, ts: now };
    // R-INTELLIGENCE-CONTEXT-MEMORY-V1: capture operational context only
    // on successful actionable responses (kind !== 'error'). Replace any
    // prior context — depth-1 single-slot, session-only, no persistence.
    if (response.establishesContext && response.kind !== 'error') {
      operationalContextRef.current = {
        type: response.establishesContext.type,
        value: response.establishesContext.value,
        timestamp: now,
      };
    }
    // R-INTELLIGENCE-SESSION-CONTEXT-V1: persist context for cross-tab/reload continuity.
    pushSessionContext({
      lastIntent: matchedIntentId,
      lastRecommendationType: matchedIntentId,
      ...(response.establishesContext?.type === 'customer' ? { lastCustomerId: response.establishesContext.value } : {}),
      ...(response.establishesContext?.type === 'repair'   ? { lastRepairId:   response.establishesContext.value } : {}),
    });
    clearActionFeedback();
    if (response.actions?.length) {
      const queueable = response.actions.filter(isQueueableAction);
      if (queueable.length > 0) {
        addAutomationItems(queueable.map(createQueueItemFromChatAction));
      }
    }
    setMessages(prev => [
      ...prev,
      { id: `u-${now}`, role: 'user', content: query, timestamp: new Date() },
      { id: `a-${now + 1}`, role: 'assistant', content: response.text, timestamp: new Date(), kind: response.kind, actions: response.actions },
    ]);
  }, []);

  useEffect(() => {
    if (!externalQuery || externalQuery.seq === prevExternalSeq.current) return;
    prevExternalSeq.current = externalQuery.seq;
    fireQuery(externalQuery.text);
  }, [externalQuery, fireQuery]);

  // R-INTELLIGENCE-DAILY-AUTOMATION-V1 + R-INTELLIGENCE-PRIORITY-SCORING-V1:
  // once-per-device-per-day auto-trigger with deterministic priority scoring.
  // Mounts → checks localStorage guard → computes today metrics → builds
  // consent-filtered candidates → scores 3 mutually-overlapping options
  // (no_sales_today=100, low_transactions=80, contact_customers_available=60)
  // → picks highest. Reuses existing engine helpers; no auto-send; max 1
  // message per day; max 3 buttons.
  // R-INTELLIGENCE-AUTOMATION-QUEUE-FAIL-FREEZE-FIX: body deferred via
  // setTimeout(0) so the heavy engine pipeline build + customer-Map
  // construction runs AFTER first paint instead of blocking the
  // Intelligence tab's mount.
  useEffect(() => {
    const STORAGE_KEY = 'cellhub:intelligence:dailyAutomation:lastRun';
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    try {
      if (localStorage.getItem(STORAGE_KEY) === today) return;
    } catch { /* incognito / quota — proceed without guard */ }

    const tid = window.setTimeout(() => {
      runDailyAutomation(STORAGE_KEY, today);
    }, 0);
    return () => window.clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runDailyAutomation(STORAGE_KEY: string, today: string) {
    // R-INTEL-DAILY-AUTOMATION-GUARD-FIX: stamp the storage guard at the
    // START of the run, not at success. Previously the early returns at
    // candidates=[] / built=[] left STORAGE_KEY unwritten, so the next
    // mount that day re-fired the entire pipeline (engine.getTodayMetrics
    // + buildOutreachQueueItems including full customer scoring). Empty-
    // state shops with no recent sales hit this on every tab switch /
    // page reload / Electron window reopen — observable mount lag.
    // Setting the guard up-front means "we attempted today" — exactly
    // what the once-per-day semantic should mean. Failures (incognito,
    // quota) silently skip; the rest of the flow proceeds either way.
    try { localStorage.setItem(STORAGE_KEY, today); } catch { /* incognito / quota */ }

    const _t = performance.now();
    const eng = engineRef.current;
    const m = perfTime('intel.chat.daily.getTodayMetrics', () => eng.getTodayMetrics());

    // Reuse existing safe contact pipeline (consent-filtered + 24h-deduped).
    const candidates = perfTime('intel.chat.daily.buildOutreachQueueItems',
      () => eng.buildOutreachQueueItems()).slice(0, 3);
    if (candidates.length === 0) {
      return;
    }
    const nameById = new Map(eng.getCustomers().map((c) => [c.id, c.name]));
    const built: ChatActionUI[] = [];
    for (const item of candidates) {
      if (!item.customerId) continue;
      const name = nameById.get(item.customerId) || item.phone || '';
      if (!name) continue;
      built.push({
        id: `da-contact-${item.customerId}`,
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
    if (built.length === 0) return;

    // R-INTELLIGENCE-PRIORITY-SCORING-V1: build all applicable options, then
    // pick highest-scoring. Only one daily message ever pushed.
    type DailyAutomationOption = { kind: string; score: number; text: string };
    const options: DailyAutomationOption[] = [];
    if (m.transactions === 0) {
      options.push({ kind: 'no_sales_today', score: 100, text: t('chat.dailyAutomation.noSalesToday') });
    }
    if (m.transactions > 0 && m.transactions < 5) {
      options.push({ kind: 'low_transactions', score: 80, text: t('chat.dailyAutomation.lowTransactions') });
    }
    // contact_customers_available is unconditional when candidates exist.
    options.push({ kind: 'contact_customers_available', score: 60, text: t('chat.dailyAutomation.contactCustomersAvailable') });

    options.sort((a, b) => b.score - a.score);
    const best = options[0];
    if (!best) {
      // Defensive — should not happen since contact_customers_available is
      // always added when candidates exist. If it ever does, store today so
      // we don't loop on retries.
      try { localStorage.setItem(STORAGE_KEY, today); } catch {}
      return;
    }

    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      { id: `a-${now}`, role: 'assistant', content: best.text, timestamp: new Date(), kind: 'answer', actions: built },
    ]);
    addAutomationItems(built.filter(isQueueableAction).map(createQueueItemFromChatAction));
    try { localStorage.setItem(STORAGE_KEY, today); } catch {}
    perfLog('intel.chat.daily.runDailyAutomation.total', _t);
  }

  useEffect(() => {
    try {
      localStorage.setItem(AUTOMATION_QUEUE_STORAGE_KEY, JSON.stringify(automationQueue));
    } catch {
      // ignore persistence failure
    }
  }, [automationQueue]);

  // Scroll message list to bottom — does NOT scroll the page.
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  // INTEL-PERF-CHAT-MEMO-V1: takes the submitted text as a param (was: read
  // from the removed `input` state). ChatCommandBar owns the text and clears
  // itself after onSend — submit semantics (trim, empty-guard, clear-after-
  // send including the dedup early-return path) are unchanged.
  const handleSubmit = (raw: string) => {
    const query = raw.trim();
    if (!query) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date(),
    };

    // R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1: same follow-up branch as fireQuery.
    let response;
    let matchedIntentId: string;
    if (isFollowUpQuery(query) && lastIntentRef.current) {
      response = handleFollowUp(lastIntentRef.current, engine, lang, operationalContextRef.current, query);
      matchedIntentId = lastIntentRef.current.intentId;
    } else if (isFollowUpQuery(query)) {
      response = { kind: 'answer' as const, text: lang === 'es' ? 'No hay contexto reciente. Haz una pregunta completa.' : lang === 'pt' ? 'Sem contexto recente. Faça uma pergunta completa.' : 'No recent context to reference. Please ask a complete question.' };
      matchedIntentId = 'followup_no_context';
    } else {
      const match = classifyIntent(query, customers, lang);
      // R-INTEL-ROUTER-V1 (shadow mode): classify the route BEFORE dispatch.
      const _route = routeIntelligenceRequest({
        source: 'chat', query, intentId: match.id, devMode: import.meta.env.DEV,
      });
      lastRouteRef.current = _route;
      if (import.meta.env.DEV) console.debug('[IntelligenceRouter:shadow]', _route.reasonCode, _route);
      // R-FINANCIAL-PRIVACY-V2: same gate as fireQuery — short-circuit
      // profit-intent dispatches when the viewer is not admin/owner.
      const PROFIT_SENSITIVE_INTENTS: ReadonlySet<string> = new Set([
        'best_customer', 'least_profitable_customers',
        'what_hurting_profit', 'what_is_losing_money',
        // R-FINANCIAL-PRIVACY-V5 (audit Priority B): product_opportunities is
        // fully blocked — its whole reply is margin/profit framing. NOTE:
        // restock_opportunity is NOT full-blocked anymore (Tier 2): employees
        // keep the operational restock list; only the per-item margin line is
        // redacted inside handleRestockOpportunity via canSeeOwnerFinancials.
        'product_opportunities',
      ]);
      if (!canSeeOwnerFinancialsRef.current && PROFIT_SENSITIVE_INTENTS.has(match.id)) {
        const es = lang === 'es';
        response = {
          kind: 'answer' as const,
          text: es
            ? 'Esta vista (ganancia, costo, margen) está oculta por la configuración de Privacidad Financiera. Pídele al propietario que la active si la necesitas.'
            : 'This view (profit, cost, margin) is hidden by the Financial Privacy setting. Ask the owner to grant access if you need it.',
        };
      } else {
        response = handleIntent(match, engine, lang, canSeeOwnerFinancialsRef.current);
      }
      matchedIntentId = match.id;
    }

    const now = Date.now();
    // R-OPERATOR-PROMOTE-EXECUTION-FIX-V1: forward panelCampaign BEFORE the
    // dedup early-return — same fix as fireQuery. Idempotent.
    if (response.panelCampaign && onPanelCampaign) {
      onPanelCampaign(response.panelCampaign);
    }
    // R-INTELLIGENCE-INTENT-DEDUP-ISOLATION: same dedup guard as fireQuery.
    if (response.text === lastResponseRef.current.text && now - lastResponseRef.current.ts < 500) {
      lastResponseRef.current.ts = now;
      return;
    }
    lastResponseRef.current = { text: response.text, ts: now };
    lastIntentRef.current = { intentId: matchedIntentId, query, responseText: response.text, ts: now };
    // R-INTELLIGENCE-CONTEXT-MEMORY-V1: mirror fireQuery's operationalContext update.
    if (response.establishesContext && response.kind !== 'error') {
      operationalContextRef.current = {
        type: response.establishesContext.type,
        value: response.establishesContext.value,
        timestamp: now,
      };
    }
    // R-INTELLIGENCE-SESSION-CONTEXT-V1: persist for cross-tab/reload continuity.
    pushSessionContext({
      lastIntent: matchedIntentId,
      lastRecommendationType: matchedIntentId,
      ...(response.establishesContext?.type === 'customer' ? { lastCustomerId: response.establishesContext.value } : {}),
      ...(response.establishesContext?.type === 'repair'   ? { lastRepairId:   response.establishesContext.value } : {}),
    });

    const assistantMsg: ChatMessage = {
      id: `a-${now}`,
      role: 'assistant',
      content: response.text,
      timestamp: new Date(),
      kind: response.kind,
      actions: response.actions,
      workflowSections: response.workflowSections,
    };

    clearActionFeedback();
    if (response.actions?.length) {
      const queueable = response.actions.filter(isQueueableAction);
      if (queueable.length > 0) {
        addAutomationItems(queueable.map(createQueueItemFromChatAction));
      }
    }
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
  };

  // R-INTELLIGENCE-OPERATOR-CONTINUITY-V2: short-lived per-(target+entity)
  // cooldown so repeated clicks / re-opens don't spam continuity suggestions.
  const continuityCooldownRef = useRef<Map<string, number>>(new Map());
  const CONTINUITY_COOLDOWN_MS = 45_000;

  // R-INTELLIGENCE-OPERATOR-SESSIONS-V1: single active workflow session (V1).
  // State-only — it does NOT generate actions/continuity; it just lets the
  // assistant surface one subtle "continuing X workflow" hint.
  const operatorSessionRef = useRef<OperatorSession | null>(null);

  // After an action executes: advance the workflow session (state only) AND
  // offer deterministic next-step suggestions through ONE deferred-push path.
  // Loop-safe (continuity actions tagged `cont-…` never spawn more continuity),
  // cooldown-safe, and the session hint appears at most once per session.
  const maybePushContinuity = useCallback((
    executionTarget: string,
    payload: ChatActionUI['payload'],
    sourceActionId: string,
  ) => {
    // R-INTELLIGENCE-CONTINUITY-RUNTIME-AUDIT-V1 (CHECK 4): defer one macrotask
    // so the message lands after the click's navigation/render transition and
    // the [messages] scroll effect reliably reaches it.
    const pushLine = (content: string, actions?: ChatActionUI[]) => {
      const stamp = Date.now();
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          { id: `m-${stamp}-${prev.length}`, role: 'assistant' as const, content, timestamp: new Date(), kind: 'answer' as const, ...(actions ? { actions } : {}) },
        ]);
      }, 0);
    };

    // SESSION: advance workflow state from this executed action (incl. cont-…
    // clicks, which continue the same workflow). State only — no actions.
    operatorSessionRef.current = deriveOperatorSessionFromAction(
      executionTarget, payload, engineRef.current, operatorSessionRef.current,
    );
    const session = operatorSessionRef.current;
    let hint: string | null = null;
    if (session && shouldShowSessionHint(session)) {
      session.hintShown = true;                 // once per session
      hint = t(sessionHintKey(session.type));
    }

    // CONTINUITY: a continuity action must not spawn more continuity, but the
    // session may still surface its one-time hint.
    if (sourceActionId.startsWith('cont-')) {
      if (hint) pushLine(hint);
      return;
    }
    const key = `${executionTarget}:${payload.entityId ?? payload.customerId ?? ''}`;
    const now = Date.now();
    if (now - (continuityCooldownRef.current.get(key) ?? 0) < CONTINUITY_COOLDOWN_MS) {
      if (hint) pushLine(hint);
      return;
    }
    const sugg = resolvePostActionContinuity(executionTarget, payload, engineRef.current, t);
    if (!sugg || sugg.actions.length === 0) {
      if (hint) pushLine(hint);
      return;
    }
    continuityCooldownRef.current.set(key, now);
    // Bound the cooldown map — drop entries older than 10 min.
    if (continuityCooldownRef.current.size > 40) {
      for (const [k, ts] of continuityCooldownRef.current) {
        if (now - ts > 600_000) continuityCooldownRef.current.delete(k);
      }
    }
    const tagged = sugg.actions.slice(0, 3).map((a, i) => ({ ...a, id: `cont-${now}-${i}-${a.id}` }));
    // Prepend the one-line session hint to the continuity message (single push).
    pushLine(hint ? `${hint}\n\n${sugg.text}` : sugg.text, tagged);
  }, [t]);

  function handleActionClick(action: ChatActionUI) {
    // INTELLIGENCE-OPERATOR-TIMELINE-V1: record every user-clicked action.
    recordActionClicked(
      action.label,
      action.payload?.executionTarget ?? (action.triggerQuery ? 'trigger_query' : undefined),
      action.payload?.entityId ?? undefined,
      action.payload?.customerName ?? undefined,
    );

    // R-INTELLIGENCE-ACTION-BUTTONS-V1: chat-replay buttons (e.g., "Promote
    // {product}") fire a follow-up query through the SAME fireQuery
    // pipeline the user already uses. No new execution system, no
    // autonomous send — the button is a deterministic shortcut that
    // re-asks the question.
    if (action.triggerQuery && action.triggerQuery.trim().length > 0) {
      fireQuery(action.triggerQuery);
      return;
    }
    // R-INTELLIGENCE-EXECUTION-OUTPUTS-V1: clipboard copy — handled here so
    // browser API stays out of the pure executor.
    if (action.payload?.executionTarget === 'copy_to_clipboard') {
      const text = action.payload.customMessage || '';
      // R-INTEL-V2-PHASE1B: record an AR reminder 'copied' event only on a
      // successful copy, and only when the action carries arReminder metadata
      // (i.e. it came from unpaid_balances). Records outreach, never payment.
      const ar = action.payload.arReminder;
      const recordCopied = () => {
        if (!ar) return;
        recordArReminder({
          type: 'ar_reminder_copied', channel: 'copy',
          customerId: ar.customerId, customerName: ar.customerName, phone: ar.phone,
          entityType: ar.entityType, entityId: ar.entityId, balanceCents: ar.balanceCents,
          language: ar.language, messagePreview: buildMessagePreview(text),
          timestamp: Date.now(), source: 'unpaid_balances',
        });
      };
      if (text && typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text).then(
          () => { setFeedbackForAction(action.id, t('chat.action.copied')); recordCopied(); },
          () => setFeedbackForAction(action.id, t('chat.action.copyFailed')),
        );
      } else {
        setFeedbackForAction(action.id, t('chat.action.copied'));
        recordCopied();
      }
      return;
    }
    // R-INTELLIGENCE-OPERATOR-QUEUE-V1: add to operator task queue — handled here, not in executor.
    if (action.payload?.executionTarget === 'add_to_operator_queue') {
      const { customerName = '', customerPhone, entityId, customMessage = '', queueType, queueSummary, priorityMeta } = action.payload;
      const taskType = (queueType as OperatorTaskType) || 'recover_customer';
      // R-INTELLIGENCE-OUTCOME-LEARNING-V1: apply outcome-based adjustment to base score.
      const { scoreAdjustment, confidenceLabel } = getOutcomeAdjustment(taskType);
      const adjustedScore = priorityMeta
        ? Math.max(0, Math.min(100, priorityMeta.priorityScore + scoreAdjustment))
        : undefined;
      addOperatorQueueItem({
        type: taskType,
        customerName,
        phone: customerPhone || '',
        relatedEntityId: entityId,
        summary: queueSummary || customerName,
        suggestedMessage: customMessage,
        priorityScore: adjustedScore,
        urgencyLevel: priorityMeta?.urgencyLevel,
        impactReason: priorityMeta?.impactReason,
        confidenceLabel,
      });
      window.dispatchEvent(new CustomEvent('cellhub:operator-queue-updated'));
      // R-INTELLIGENCE-OPERATOR-SESSIONS-V1: a queued follow-up/reminder advances
      // the active workflow session (this path returns before maybePushContinuity).
      operatorSessionRef.current = deriveOperatorSessionFromAction(
        'add_to_operator_queue', action.payload, engineRef.current, operatorSessionRef.current,
      );
      setFeedbackForAction(action.id, t('chat.action.addedToQueue'));
      return;
    }
    const result = executeActionPayload(action.payload);
    if (!result.ok) {
      // R-INTELLIGENCE-ACTION-UX-STABILITY-V1: bilingual safe feedback — no crash, auto-clears in 5s
      setFeedbackForAction(action.id, t('chat.action.notAvailable'));
      return;
    }
    switch (result.type) {
      case 'whatsapp_url':
        setPendingWaAction({ action, url: result.url });
        return;
      case 'pos_discount':
        setFeedbackForAction(action.id, t('chat.action.discountReady'));
        break;
      case 'pos_bundle':
        setFeedbackForAction(action.id, t('chat.action.bundleReady'));
        break;
      case 'review_panel':
        setFeedbackForAction(action.id, t('chat.action.reviewReady'));
        break;
      case 'reminder_queue':
        setFeedbackForAction(action.id, t('chat.action.reminderReady'));
        break;
      // R-OPERATOR-EXECUTABLE-ACTIONS-V1: deterministic hand-off into the
      // Promote Inventory panel. Parent module callback opens the panel +
      // auto-selects the product. No chat-replay, no audience dead-end.
      case 'open_promote_panel':
        if (onOpenPromote) {
          onOpenPromote(result.productId, result.productName);
          setFeedbackForAction(action.id, t('chat.promote.opening', result.productName));
        } else {
          setFeedbackForAction(action.id, t('chat.promote.unavailable'));
        }
        break;
      // R-INTELLIGENCE-EXECUTABLE-ACTIONS-V1: navigation events dispatched by
      // executeActionPayload; we only add feedback labels here — the modules
      // listening to cellhub:* events drive the actual navigation.
      case 'open_repair': {
        const _now = Date.now();
        setFeedbackForAction(action.id, t('chat.action.openingTicket'));
        recordOperatorAction({
          actionType: 'open_repair',
          entityType: 'repair',
          entityId: action.payload.entityId,
          entityName: action.payload.customerName,
          sourceIntent: lastIntentRef.current?.intentId,
          timestamp: _now,
        });
        if (action.payload.entityId) {
          operationalContextRef.current = { type: 'repair', value: action.payload.entityId, timestamp: _now };
        }
        break;
      }
      case 'open_customer': {
        const _now = Date.now();
        setFeedbackForAction(action.id, t('chat.action.openingCustomer'));
        recordOperatorAction({
          actionType: 'open_customer',
          entityType: 'customer',
          entityId: action.payload.entityId || action.payload.customerId,
          entityName: action.payload.customerName,
          sourceIntent: lastIntentRef.current?.intentId,
          timestamp: _now,
        });
        const _custId = action.payload.entityId || action.payload.customerId;
        if (_custId) {
          operationalContextRef.current = { type: 'customer', value: _custId, timestamp: _now };
        }
        break;
      }
      case 'record_outreach_outcome':
        setFeedbackForAction(action.id, t('chat.action.outcomeSaved'));
        break;
      case 'open_layaway':
        setFeedbackForAction(action.id, t('chat.action.openingLayaway'));
        if (action.payload.customerId) {
          operationalContextRef.current = { type: 'customer', value: action.payload.customerId, timestamp: Date.now() };
        }
        break;
      case 'open_unlock':
        setFeedbackForAction(action.id, t('chat.action.openingUnlock'));
        if (action.payload.customerId) {
          operationalContextRef.current = { type: 'customer', value: action.payload.customerId, timestamp: Date.now() };
        }
        break;
      case 'open_special_order':
        setFeedbackForAction(action.id, t('chat.action.openingSpecialOrder'));
        if (action.payload.customerId) {
          operationalContextRef.current = { type: 'customer', value: action.payload.customerId, timestamp: Date.now() };
        }
        break;
      case 'open_inventory':
        setFeedbackForAction(action.id, t('chat.action.openingItem'));
        break;
      case 'queue_manager_review':
        setFeedbackForAction(action.id, t('chat.action.openingReview'));
        break;
    }
    // R-INTELLIGENCE-OPERATOR-CONTINUITY-V2: chain deterministic next-step
    // suggestions after a successful navigation/queue action. (whatsapp_url
    // returns early above and is handled on its send-confirm instead.)
    maybePushContinuity(result.type, action.payload, action.id);
  }

  function handleApproveAutomation(id: string) {
    setAutomationQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (!item) return prev;

      const actionPayload = item.payload?.actionPayload;
      if (!actionPayload) {
        return prev.map(i => i.id === id ? markAutomationFailed(i, 'missing_action_payload') : i);
      }

      const result = executeActionPayload(actionPayload);
      if (!result.ok) {
        return prev.map(i => i.id === id ? markAutomationFailed(i, result.reason) : i);
      }

      switch (result.type) {
        case 'whatsapp_url':
          window.open(result.url, '_blank');
          break;
        case 'pos_discount':
          console.log('Approved discount automation:', result.sku);
          break;
        case 'pos_bundle':
          console.log('Approved bundle automation:', result.sku);
          break;
        case 'review_panel':
          console.log('Approved review automation');
          break;
        case 'reminder_queue':
          console.log('Approved reminder automation:', result.customerName);
          break;
        // R-OPERATOR-EXECUTABLE-ACTIONS-V1: same hand-off when the action
        // came in via the queue instead of an inline chat button.
        case 'open_promote_panel':
          if (onOpenPromote) onOpenPromote(result.productId, result.productName);
          break;
      }

      // R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: pending_deal stays at
      // 'approved' after the WhatsApp window opens, so the owner can later
      // click "Add to POS Cart". All other kinds keep the existing
      // approve+complete-in-one-step behavior (unchanged).
      if (item.kind === 'pending_deal') {
        return prev.map(i =>
          i.id === id
            ? addAutomationExecutionLog(approveAutomationItem(i), {
                executedAt: new Date().toISOString(),
                result: 'success',
                resultType: result.type,
              })
            : i,
        );
      }

      return prev.map(i => i.id === id ? markAutomationExecuted(approveAutomationItem(i), result.type) : i);
    });
  }

  // R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: convert an approved deal into
  // a POS cart line. Re-validates against current inventory (stock + cost
  // floor); does NOT decrement inventory, NOT create a sale, NOT auto-checkout.
  // Owner runs the normal POS checkout afterwards.
  async function handleAddDealToCart(id: string) {
    const item = automationQueue.find((i) => i.id === id);
    if (!item) return;
    const deal = (item.payload as { pendingDeal?: import('@/services/intelligence/deals/dealTypes').PendingDeal })?.pendingDeal;
    if (!deal) {
      toast(t('chat.proposeDeal.invalidDeal'), 'error');
      setAutomationQueue((prev) => prev.map((i) => (i.id === id ? markAutomationFailed(i, 'missing_pending_deal') : i)));
      return;
    }

    const inv = inventory.find((i) => i.id === deal.inventoryId);
    if (!inv) {
      toast(t('chat.proposeDeal.invalidDeal'), 'error');
      setAutomationQueue((prev) => prev.map((i) => (i.id === id ? markAutomationFailed(i, 'inventory_not_found') : i)));
      return;
    }

    // Re-check stock against current inventory (deal could be hours/days old).
    // Services are unlimited; everything else needs qty > 0.
    const currentQty = (inv.qty ?? (inv as { quantity?: number }).quantity ?? 0);
    if (inv.category !== 'service' && currentQty <= 0) {
      toast(t('chat.proposeDeal.outOfStock'), 'warning');
      return;
    }

    // Re-validate cost floor in case product cost was edited up since draft.
    if (deal.proposedPriceCents <= 0 || deal.proposedPriceCents < (inv.cost || 0)) {
      toast(t('chat.proposeDeal.invalidDeal'), 'error');
      return;
    }

    // ── R-INTELLIGENCE-DECISION-LAYER-F2C: money-change enforcement ──
    // Adding the deal injects a DISCOUNTED price line — the same change a manual
    // cart discount would gate. Enforce here (the single Intelligence money path).
    //
    // 1. Secondary-terminal rule: never run the hard-gate money action on a
    //    read-only LAN Secondary, and never prompt for a local PIN there (that
    //    would be a bypass). Block BEFORE the PIN modal. The cart is ephemeral
    //    state (not a persist write), so the persist LAN guard does not catch it.
    let isSecondaryTerminal = false;
    try { isSecondaryTerminal = getConnection().role === 'secondary'; } catch { /* default primary */ }
    if (isSecondaryTerminal) {
      toast(t('chat.proposeDeal.secondaryBlocked'), 'warning');
      return;
    }

    // 2. Approval gate. requestApproval returns approved when approvals are
    //    disabled (feature_disabled) or not required for the role — so existing
    //    behavior is preserved for shops not using approvals. Only mutate on approval.
    const approvalReq = approvalRequestFromPendingDeal(deal, { currentEmployee });
    const approval = await dealApprovalGate.requestApproval(approvalReq);
    if (!approval.approved) {
      toast(t('chat.proposeDeal.approvalDenied'), 'warning');
      return; // denied/cancelled → no cart mutation, no navigation, no markExecuted
    }

    const taxable = !['service', 'quick_charge', 'phone_payment', 'top_up'].includes(inv.category);

    const cartItem: CartItem = {
      id: generateId(),
      inventoryId: inv.id,
      name: deal.productName,
      sku: inv.sku,
      imei: (inv as { imei?: string }).imei,
      category: inv.category,
      price: deal.proposedPriceCents,
      originalPrice: deal.originalPriceCents,
      cost: inv.cost,
      qty: deal.qty || 1,
      taxable,
      cbeEligible: !!inv.cbeEligible,
      screenFeeEligible: !!(inv as { screenFeeEligible?: boolean }).screenFeeEligible,
      notes: `Deal — was $${(deal.originalPriceCents / 100).toFixed(2)}`,
    };

    // Direct push — DO NOT merge with any existing line at the original price
    // (different intent). New cart line keyed by generateId(); inventoryId is
    // preserved for stock decrement at checkout.
    // F2C: read the freshest cart via cartRef — the approval await above means
    // the closure `cart` may be stale (anti-stale-closure pattern).
    // R-GLOBAL-CART-UNIFY-V1: write via the hook + attach customer + auto-open
    // drawer. Stay in Intelligence (no forced navigate to POS). Uses cartRef for
    // the freshest cart (approval await above can stale the closure `cart`).
    commitCart([...cartRef.current, cartItem], {
      openDrawer: true,
      customerId: deal.customerId,
    });

    setAutomationQueue((prev) =>
      prev.map((i) => (i.id === id ? markAutomationExecuted(i, 'cart_added') : i)),
    );

    toast(t('chat.proposeDeal.addedToCart'), 'success');
  }

  // R-INTELLIGENCE-DEAL-OUTCOME-TRACKING-V1: owner records the real-world
  // outcome of a pending deal after WhatsApp outreach. Pure logging — no
  // sale creation, no inventory mutation, no auto-checkout. The queue item
  // moves to 'completed' with resultType=`deal_${outcome}` so the existing
  // status pill + completed-section UX still works.
  function handleDealOutcome(id: string, outcome: DealOutcome) {
    const item = automationQueue.find((i) => i.id === id);
    if (!item) return;
    const deal = (item.payload as { pendingDeal?: import('@/services/intelligence/deals/dealTypes').PendingDeal })?.pendingDeal;
    if (!deal) {
      toast(t('chat.proposeDeal.invalidDeal'), 'error');
      return;
    }

    // Re-resolve inventory category at outcome time for analytics. May be
    // missing if the item was deleted since the deal was drafted — that's
    // fine, we log without it.
    const inv = inventory.find((i) => i.id === deal.inventoryId);

    addDealOutcomeLog({
      id: generateId(),
      dealId: item.id,
      customerId: deal.customerId,
      inventoryId: deal.inventoryId,
      category: inv?.category,
      proposedPriceCents: deal.proposedPriceCents,
      originalPriceCents: deal.originalPriceCents,
      outcome,
      timestamp: Date.now(),
    });

    setAutomationQueue((prev) =>
      prev.map((i) => (i.id === id ? markAutomationExecuted(i, `deal_${outcome}`) : i)),
    );

    toast(t('chat.proposeDeal.outcomeSaved'), 'success');
  }

  function handleCancelAutomation(id: string) {
    setAutomationQueue(prev =>
      prev.map(item => item.id === id ? cancelAutomationItem(item) : item)
    );
  }

  function handleAutomationOutcome(id: string, outcome: AutomationOutcome) {
    setAutomationQueue(prev =>
      prev.map(item => item.id === id ? addAutomationOutcome(item, outcome) : item)
    );
  }

  // R-INTELLIGENCE-INTERFACE-ORGANIZATION-V1: Quick Action cards auto-submit
  // (matches the IntelligenceModule chip pattern). The plain EmptyState
  // suggestions used setInput-only; the new larger cards fire immediately
  // so the operator command-center feel is consistent across the page.
  const handleSuggestion = useCallback((suggestion: string) => {
    fireQuery(suggestion);
  }, [fireQuery]);

  const clearChat = () => {
    setMessages([]);
    lastIntentRef.current = null;
    operationalContextRef.current = null;
    clearSessionContext();
  };

  const prevClearSeqRef = useRef(-1);
  useEffect(() => {
    if (clearSeq === undefined || clearSeq === prevClearSeqRef.current) return;
    prevClearSeqRef.current = clearSeq;
    clearChat();
  // clearChat is stable (only refs + setMessages) — no dep needed
  }, [clearSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  // INTELLIGENCE-PROACTIVE-OPERATOR-SURFACES-V1: compute peek item once on
  // mount (ref lazy init). No re-compute on keystrokes, no polling.
  const peekItemRef = useRef<OperatorAttentionItem | null | undefined>(undefined);
  if (peekItemRef.current === undefined) {
    const feed = getAttentionFeed(engine, 1);
    peekItemRef.current = (feed[0]?.severity ?? 0) >= 70 ? (feed[0] ?? null) : null;
  }
  const peekItem = peekItemRef.current;

  // INTEL-PERF-CHAT-MEMO-V1: referentially-stable wrappers (latest-ref
  // pattern) so memo(MessageBubble) and memo(ChatCommandBar) aren't defeated
  // by handleActionClick/handleSubmit getting a new identity every render.
  // The refs are refreshed post-render, before any user interaction can fire.
  const handleActionClickRef = useRef(handleActionClick);
  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleActionClickRef.current = handleActionClick;
    handleSubmitRef.current = handleSubmit;
  });
  const onActionStable = useCallback((action: ChatActionUI) => { handleActionClickRef.current(action); }, []);
  const onSendStable = useCallback((text: string) => { handleSubmitRef.current(text); }, []);

  return (
    <div
      className={compact ? 'overflow-hidden flex flex-col' : 'bg-surface-800 rounded-lg border border-surface-700 overflow-hidden flex flex-col'}
      style={compact ? { flex: 1, minHeight: 0, background: 'transparent' } : { minHeight: '560px', maxHeight: '760px' }}
    >
      {/* R-INTELLIGENCE-DECISION-LAYER-F2C: PIN gate for deal → discounted cart line. */}
      {dealApprovalGate.modal}
      {/* Header — full mode only */}
      {!compact && (
        <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(31,41,55,0.8)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: chipData ? 8 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em' }}>
              ⚡ {t('intelligence.askYourShop')}
            </span>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'transparent', border: '1px solid #1F2937', color: '#6B7280', cursor: 'pointer' }}
              >
                {t('intelligence.clear')}
              </button>
            )}
          </div>
          {chipData && (
            <SuggestionChips chipData={chipData} onFireChat={handleSuggestion} locale={locale} mode='row' canSeeOwnerFinancials={canSeeOwnerFinancialsRef.current} />
          )}
        </div>
      )}

      {/* Continuity bar — full mode only */}
      {!compact && messages.length > 0 && chipData && (
        <OperatorContinuityBar chipData={chipData} onFireChat={handleSuggestion} locale={locale} canSeeOwnerFinancials={canSeeOwnerFinancialsRef.current} />
      )}

      {/* INTELLIGENCE-PROACTIVE-OPERATOR-SURFACES-V1: proactive peek card.
          Shown only when messages are empty (panel just opened) and top
          attention item severity >= 70. Disappears once the user asks anything.
          Read-only — no auto-execution, no mutation. */}
      {peekItem && messages.length === 0 && (
        <div
          aria-live="polite"
          style={{
            margin: '8px 14px 0',
            background: 'rgba(249,115,22,0.07)',
            border: '1px solid rgba(249,115,22,0.28)',
            borderRadius: '0.5rem',
            padding: '0.55rem 0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem',
          }}
        >
          <div style={{ fontSize: '0.62rem', color: '#fb923c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {locale === 'es' ? 'Requiere atención' : locale === 'pt' ? 'Requer atenção' : 'Needs attention'}
          </div>
          <div style={{ fontSize: '0.83rem', fontWeight: 700, color: '#f3f4f6', lineHeight: 1.3 }}>
            {peekItem.title}
          </div>
          <div style={{ fontSize: '0.76rem', color: '#94a3b8', lineHeight: 1.35 }}>
            {peekItem.reason}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem' }}>
            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
              {locale === 'es' ? 'Severidad' : 'Severity'}: {peekItem.severity}/100
            </span>
            <button
              type="button"
              onClick={() => handleSuggestion('what needs attention')}
              style={{
                padding: '0.22rem 0.6rem',
                borderRadius: '0.9rem',
                fontSize: '0.70rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid rgba(249,115,22,0.45)',
                background: 'rgba(249,115,22,0.12)',
                color: '#fb923c',
              }}
            >
              {locale === 'es' ? 'Ver todo' : locale === 'pt' ? 'Ver tudo' : 'See all'}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messageListRef}
        className={compact ? '' : 'flex-1 overflow-y-auto px-4 py-5'}
        // INTELLIGENCE-CHAT-LAYOUT-CONTAINMENT-V1: explicit minHeight: 0 so the
        // list can never force its flex parent taller than the bounded panel;
        // overflowX hidden is the backstop so unbroken strings can't widen it.
        style={compact ? { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } : undefined}
      >
        {compact ? (
          messages.length === 0 ? (
            hideInput
              ? <RightColumnWelcome locale={locale} />
              : <OperatorCommandWelcome locale={locale} chipData={chipData} topActions={topActions} onSuggestion={handleSuggestion} />
          ) : (
            <div style={{ padding: '14px 16px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} lang={locale} onAction={onActionStable} feedbackById={actionFeedbackById} />)}
            </div>
          )
        ) : (
          <div className="max-w-3xl mx-auto space-y-3">
            {messages.length === 0 ? (
              <OperatorWelcome locale={locale} chipData={chipData} topActions={topActions} onSuggestion={handleSuggestion} canSeeOwnerFinancials={canSeeOwnerFinancialsRef.current} />
            ) : (
              messages.map((msg) => <MessageBubble key={msg.id} msg={msg} lang={locale} onAction={onActionStable} feedbackById={actionFeedbackById} />)
            )}
          </div>
        )}
      </div>

      {/* Automation Queue — full mode only */}
      {!compact && automationQueue.length > 0 && (
        <div className="border-t border-surface-700 px-3 py-2 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-400">{t('chat.queue.header')}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500">
                {t('chat.queue.pending')} {automationQueue.filter(i => i.status === 'pending').length}
              </span>
              <button
                onClick={() => setAutomationQueue(prev => prev.filter(i => i.status !== 'completed' && i.status !== 'cancelled'))}
                className="text-[10px] text-slate-500 hover:text-slate-300 underline"
              >
                {t('chat.queue.clearCompleted')}
              </button>
            </div>
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {sortedQueueWithPriority.map(({ item, priority }) => {
              return (
              <div key={item.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-surface-700 border border-surface-600">
                <div className="min-w-0 flex-1">
                  <span className="text-xs text-slate-300 truncate block">{item.label}</span>
                  <span className="text-[10px] text-slate-500">
                    {item.kind}{item.customerName ? ` · ${item.customerName}` : ''}{item.sku ? ` · ${item.sku}` : ''}
                    {' · '}
                    <span title={priority.reasons.join(', ')}>{t('chat.queue.priority')} {priority.score}</span>
                  </span>
                  {item.executionLog?.length ? (
                    <span className="text-[10px] text-slate-500 block">
                      {item.executionLog[item.executionLog.length - 1].result}
                      {': '}
                      {item.executionLog[item.executionLog.length - 1].resultType ?? item.executionLog[item.executionLog.length - 1].reason ?? ''}
                    </span>
                  ) : null}
                  {item.outcomeLog?.length ? (
                    <span className="text-[10px] text-slate-500 block">
                      {t('chat.queue.outcome')} {item.outcomeLog[item.outcomeLog.length - 1].outcome}
                    </span>
                  ) : null}
                  {item.status === 'completed' && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {([
                        ['customer_responded', t('chat.outcome.responded')],
                        ['sale_created', t('chat.outcome.sale')],
                        ['no_response', t('chat.outcome.noResponse')],
                        ['not_relevant', t('chat.outcome.notRelevant')],
                      ] as [AutomationOutcome, string][]).map(([outcome, label]) => (
                        <button
                          key={outcome}
                          onClick={() => handleAutomationOutcome(item.id, outcome)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-400 hover:bg-surface-600"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: approved deals
                      surface an "Add to POS Cart" button. Sits next to the
                      status pill (rendered below) so the owner can act after
                      the WhatsApp message has opened. */}
                  {item.kind === 'pending_deal' && item.status === 'approved' && (
                    <button
                      onClick={() => handleAddDealToCart(item.id)}
                      className="text-[10px] px-2 py-0.5 rounded border border-blue-700 text-blue-300 hover:bg-blue-900/30"
                    >
                      {t('chat.proposeDeal.addToCart')}
                    </button>
                  )}
                  {/* R-INTELLIGENCE-DEAL-OUTCOME-TRACKING-V1: owner records
                      Won / Lost / No Response after the WhatsApp send. Pure
                      logging — no sale creation, no checkout. Visible only
                      while approved; click moves item to 'completed'. */}
                  {item.kind === 'pending_deal' && item.status === 'approved' && (
                    <>
                      <button
                        onClick={() => handleDealOutcome(item.id, 'won')}
                        className="text-[10px] px-2 py-0.5 rounded border border-green-700 text-green-300 hover:bg-green-900/30"
                      >
                        {t('chat.proposeDeal.won')}
                      </button>
                      <button
                        onClick={() => handleDealOutcome(item.id, 'lost')}
                        className="text-[10px] px-2 py-0.5 rounded border border-red-700 text-red-300 hover:bg-red-900/30"
                      >
                        {t('chat.proposeDeal.lost')}
                      </button>
                      <button
                        onClick={() => handleDealOutcome(item.id, 'no_response')}
                        className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-surface-600"
                      >
                        {t('chat.proposeDeal.noResponse')}
                      </button>
                    </>
                  )}
                  {item.status !== 'pending' ? (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      item.status === 'completed' ? 'border-green-600/50 text-green-400' :
                      item.status === 'approved'  ? 'border-blue-600/50 text-blue-400' :
                      item.status === 'failed'    ? 'border-red-600/50 text-red-400' :
                      'border-slate-600 text-slate-500'
                    }`}>
                      {t(`chat.queue.status.${item.status}`)}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleApproveAutomation(item.id)}
                        className="text-[10px] px-2 py-0.5 rounded border border-green-700 text-green-400 hover:bg-green-900/30"
                      >
                        {t('chat.queue.approve')}
                      </button>
                      <button
                        onClick={() => handleCancelAutomation(item.id)}
                        className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:bg-surface-600"
                      >
                        {t('chat.queue.cancel')}
                      </button>
                    </>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Command bar — INTEL-PERF-CHAT-MEMO-V1: extracted to ChatCommandBar
          (memoized, owns its text state) so typing re-renders only the bar,
          not the message history above. Same JSX, same submit semantics. */}
      {compact ? (
        !hideInput && <ChatCommandBar compact locale={locale} onSend={onSendStable} />
      ) : (
        <ChatCommandBar locale={locale} onSend={onSendStable} />
      )}

      <Modal
        open={!!pendingWaAction}
        onClose={() => setPendingWaAction(null)}
        title={t('chat.whatsapp.modalTitle')}
        size="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setPendingWaAction(null)}
              className="px-4 py-2 rounded bg-surface-700 hover:bg-surface-600 text-slate-300 text-sm"
            >
              {t('chat.whatsapp.cancel')}
            </button>
            <button
              onClick={() => {
                if (pendingWaAction) {
                  const waWindow = window.open(pendingWaAction.url, '_blank');
                  if (!waWindow) {
                    // Popup blocked or open failed: do NOT record the
                    // outreach as sent (no follow-up, no pipeline item, no
                    // continuity) so a blocked send never leaves a phantom
                    // 'proposal_sent' record the owner would chase.
                    setFeedbackForAction(pendingWaAction.action.id, t('chat.whatsapp.blocked'));
                    setPendingWaAction(null);
                    return;
                  }
                  setFeedbackForAction(pendingWaAction.action.id, t('chat.whatsapp.opened'));
                  // R-INTELLIGENCE-PROPOSAL-FOLLOWUP-INBOX-V1: record the
                  // manual outreach as a 'sent' follow-up. No WhatsApp API,
                  // no scraping — this just stamps that the owner clicked
                  // Open WhatsApp so the chat can later list pending
                  // follow-ups and link pasted replies to a record.
                  const a = pendingWaAction.action;
                  // R-INTEL-V2-PHASE1B: record an AR reminder 'whatsapp_opened'
                  // event — only reached AFTER the popup-block guard above, so a
                  // blocked open records nothing. Only for unpaid_balances
                  // reminders (arReminder present). Records outreach, never payment.
                  const arWa = a.payload.arReminder;
                  if (arWa) {
                    recordArReminder({
                      type: 'ar_reminder_whatsapp_opened', channel: 'whatsapp',
                      customerId: arWa.customerId, customerName: arWa.customerName, phone: arWa.phone,
                      entityType: arWa.entityType, entityId: arWa.entityId, balanceCents: arWa.balanceCents,
                      language: arWa.language, messagePreview: buildMessagePreview(a.payload.customMessage || ''),
                      timestamp: Date.now(), source: 'unpaid_balances',
                    });
                  }
                  recordOperatorAction({
                    actionType: 'whatsapp',
                    entityType: 'customer',
                    entityId: a.payload.customerId,
                    entityName: a.payload.customerName,
                    sourceIntent: lastIntentRef.current?.intentId,
                    timestamp: Date.now(),
                  });
                  if (a.payload.customerId || a.payload.customerPhone || a.payload.customerName) {
                    const followupId = generateId();
                    addProposalFollowup({
                      id: followupId,
                      customerId: a.payload.customerId,
                      customerName: a.payload.customerName,
                      customerPhone: a.payload.customerPhone,
                      productName: a.pendingDeal?.productName,
                      proposedPriceCents: a.pendingDeal?.proposedPriceCents,
                      sourceActionId: a.id,
                      status: 'sent',
                      sentAt: Date.now(),
                    });
                    // R-INTELLIGENCE-DEAL-PIPELINE-V1: also stamp a
                    // pipeline item at stage='proposal_sent'. Skip if
                    // there's already an open deal for the same customer
                    // + product to avoid duplicates. Pure status record;
                    // no cart, no sale, no autonomous transitions.
                    const dup = findOpenDealByCustomerOrProduct(
                      a.payload.customerName,
                      a.payload.customerPhone,
                      a.pendingDeal?.productName,
                    );
                    if (!dup) {
                      const nowMs = Date.now();
                      addDealPipelineItem({
                        id: generateId(),
                        customerId: a.payload.customerId,
                        customerName: a.payload.customerName,
                        customerPhone: a.payload.customerPhone,
                        productName: a.pendingDeal?.productName,
                        proposedPriceCents: a.pendingDeal?.proposedPriceCents,
                        stage: 'proposal_sent',
                        sourceFollowupId: followupId,
                        sourceActionId: a.id,
                        createdAt: nowMs,
                        updatedAt: nowMs,
                      });
                    }
                  }
                  // R-INTELLIGENCE-OPERATOR-CONTINUITY-V2: chain next-steps after send.
                  maybePushContinuity('whatsapp_url', a.payload, a.id);
                }
                setPendingWaAction(null);
              }}
              className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
            >
              {t('chat.whatsapp.confirm')}
            </button>
          </>
        }
      >
        <p className="text-slate-300 text-sm mb-2">
          {t('chat.whatsapp.body')}
        </p>
        <p className="text-slate-200 text-sm font-medium">
          {pendingWaAction?.action.payload.customerName ?? t('chat.whatsapp.customer')}
        </p>
      </Modal>
    </div>
  );
}

// ── Message bubble ──────────────────────────────────────────
// INTEL-PERF-CHAT-MEMO-V1: memoized — a bubble re-renders only when its own
// props change (msg objects are append-only; onAction is the stable wrapper),
// not on every parent state change. Mirrors the existing memo(ResponseCard).
const MessageBubble = memo(function MessageBubble({ msg, lang, onAction, feedbackById }: { msg: ChatMessage; lang: string; onAction: (action: ChatActionUI) => void; feedbackById: Record<string, { message: string; ts: number }> }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          maxWidth: '80%',
          padding: '12px 14px',
          borderRadius: 14,
          background: '#1b2430',
          color: '#f3f4f6',
          fontSize: 14,
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
          // INTELLIGENCE-CHAT-LAYOUT-CONTAINMENT-V1: long unbroken strings
          // (URLs, IMEIs) wrap instead of widening the chat column.
          overflowWrap: 'anywhere',
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start w-full">
      <div style={{ width: '100%', maxWidth: '96%' }}>
        <ResponseCard
          content={msg.content}
          kind={msg.kind}
          actions={msg.actions}
          workflowSections={msg.workflowSections}
          onAction={onAction}
          feedbackById={feedbackById}
          lang={lang}
        />
      </div>
    </div>
  );
});

// ── Command bar (INTEL-PERF-CHAT-MEMO-V1) ───────────────────────────
// Owns its text state so keystrokes re-render ONLY this component — the
// message history above never re-renders while typing. JSX copied verbatim
// from the previous inline forms; submit semantics preserved (preventDefault,
// trim + empty-guard, clear after send). `onSend` must be referentially
// stable (see onSendStable in IntelligenceChat).
const ChatCommandBar = memo(function ChatCommandBar({ compact, locale, onSend }: {
  compact?: boolean;
  locale: string;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };

  if (compact) {
    return (
      <div style={{
        borderTop: `1px solid #1d2633`, padding: 18, flexShrink: 0,
      }}>
        <form
          onSubmit={submit}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#171f2a', borderRadius: 16, padding: '12px 14px',
          }}
        >
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={locale === 'es' ? 'Pregunta a Intelligence…' : locale === 'pt' ? 'Pergunte ao Intelligence…' : 'Ask Intelligence…'}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              outline: 'none', color: 'white', fontSize: 14,
            }}
          />
          <button
            type="submit"
            disabled={!text.trim()}
            style={{
              width: 42, height: 42, border: 'none', borderRadius: 12,
              background: text.trim() ? '#2563eb' : '#1d2633',
              color: 'white', fontSize: 18,
              cursor: text.trim() ? 'pointer' : 'not-allowed',
              flexShrink: 0, transition: 'background 0.12s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            →
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className='border-t border-surface-700 shrink-0' style={{ padding: '10px 14px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7 }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10B981', flexShrink: 0, display: 'inline-block' }} />
        <span style={{ fontSize: 9, fontWeight: 700, color: '#4B5563', letterSpacing: '0.09em' }}>
          {locale === 'es' ? 'OPERADOR LISTO' : locale === 'pt' ? 'OPERADOR PRONTO' : 'OPERATOR READY'}
        </span>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          type='text'
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            locale === 'es' ? 'Pregunta sobre clientes, reparaciones, inventario, impuestos o ganancias…'
            : locale === 'pt' ? 'Pergunte sobre clientes, reparos, inventário, impostos ou lucros…'
            : 'Ask about customers, repairs, inventory, taxes, or profit…'
          }
          className='focus:border-slate-500/50'
          style={{
            flex: 1, background: '#0B1220', color: '#E2E8F0',
            borderRadius: 8, padding: '11px 15px', fontSize: 13,
            border: '1px solid #1F2937', outline: 'none', minWidth: 0,
          }}
        />
        <button
          type='submit'
          disabled={!text.trim()}
          style={{
            padding: '10px 15px', borderRadius: 8,
            background: text.trim() ? '#1E3A6E' : '#141E2E',
            color: text.trim() ? '#93C5FD' : '#374151',
            fontSize: 15,
            border: text.trim() ? '1px solid #1D4ED844' : '1px solid #1A2332',
            cursor: text.trim() ? 'pointer' : 'not-allowed',
            transition: 'background 0.12s, color 0.12s', flexShrink: 0,
          }}
        >
          ⏎
        </button>
      </form>
    </div>
  );
});

// ── Quick Action Grid (R-INTELLIGENCE-INTERFACE-ORGANIZATION-V1) ─────
// Replaces the old chip-style EmptyState with a 2-column grid of larger
// operator-style action cards. Each card auto-submits the matching query
// (matches the IntelligenceModule chip behavior). Reuses existing
// translation keys for titles + the actual queries fired; descriptions
// use inline locale ternary, mirroring the prior EmptyState pattern so
// no new translation keys are needed and bilingual coverage stays
// consistent. UI-only — no logic changes, no new state, no new effects.
// ── R-INTELLIGENCE-OPERATOR-HOME-V1: deterministic TODAY briefing ─────
// Pure render of the SAME chipData counts the action chips already use —
// no engine calls, no data access, no effects. Turns the pre-computed
// operator signals into a compact "store briefing" so the idle
// Intelligence state reads like an operator console instead of a generic
// chatbot intro. Money-derived lines are gated by canSeeOwnerFinancials
// (cashier privacy parity with SuggestionChips). Bilingual EN/ES/PT via
// inline ternary, matching the existing welcome-component pattern (these
// components deliberately avoid new translation keys — see the
// QuickActionGrid note below).
function OperatorTodayBriefing({ chipData, locale, topActions, canSeeOwnerFinancials = true, onSuggestion }: {
  chipData?: ChipData;
  locale: string;
  // R-INTELLIGENCE-F3D: canonical Top 3 Actions Today (F3B) — the single
  // priority source. Rendered at the top; the legacy action-priority lines that
  // overlapped these were removed (F3D2). Info-only counts stay below.
  topActions?: TopAction[];
  canSeeOwnerFinancials?: boolean;
  // R-INTELLIGENCE-OPERATOR-ACTIONS-V1: optional callback to fire an existing
  // deterministic chat prompt. When absent the lines render info-only.
  onSuggestion?: (text: string) => void;
}) {
  const es = locale === 'es';
  const pt = locale === 'pt';
  const todayLabel = es ? 'HOY' : pt ? 'HOJE' : 'TODAY';
  // R-INTELLIGENCE-F3D: standalone translator for the reused intelligence.topActions.* strings.
  const tc = tChat(locale as Lang3);
  const topList = topActions ?? [];

  // R-INTELLIGENCE-OPERATOR-ACTIONS-V1: action labels (EN/ES/PT). Each briefing
  // line may carry ONE compact action that reuses an existing mechanism only:
  //   - kind 'nav' → cellhub:navigate-tab CustomEvent (AppShell handler,
  //     R-INTELLIGENCE-RUNTIME-NAVIGATION-V1) with a canonical TabId.
  //   - kind 'chat' → onSuggestion(query) firing a deterministic prompt the
  //     existing welcome cards/chips already use. No new command system.
  const L = {
    openRepairs:   es ? 'Abrir Reparaciones'    : pt ? 'Abrir Reparos'            : 'Open Repairs',
    openLayaways:  es ? 'Abrir Apartados'        : pt ? 'Abrir Reservas'           : 'Open Layaways',
    openUnlocks:   es ? 'Abrir Desbloqueos'      : pt ? 'Abrir Desbloqueios'       : 'Open Unlocks',
    openSpecial:   es ? 'Abrir Órdenes Esp.'     : pt ? 'Abrir Pedidos Esp.'       : 'Open Special Orders',
    contact:       es ? 'Contactar Clientes'     : pt ? 'Contatar Clientes'        : 'Contact Customers',
    push:          es ? 'Promover Productos'     : pt ? 'Promover Produtos'        : 'Push Products',
    collect:       es ? 'Cobrar Pagos'           : pt ? 'Cobrar Pagamentos'        : 'Collect Payments',
  };
  // R-INTELLIGENCE-F3D2: the deterministic chat-prompt map (Q) was removed with
  // the action-priority lines that used it — those actions now come from F3B.
  type BriefAction =
    | { kind: 'nav'; tab: string; label: string }
    | { kind: 'chat'; query: string; label: string };
  type BriefLine = { id: string; icon: string; text: string; action?: BriefAction };
  const lines: BriefLine[] = [];

  // Deterministic lines built ONLY from the existing ChipData counts the
  // action chips already consume — no engine calls, no new data access.
  if (chipData) {
    // R-INTELLIGENCE-F3D2: the action-priority lines (ready pickups, stale
    // repairs, overdue layaways, balance collection, ready-for-delivery,
    // outreach, product opportunities) were REMOVED — those recommendations now
    // come from the canonical Top 3 Actions Today (F3B), rendered above. Only
    // the informational counts below remain (no ranking, no duplicate actions).
    // R-INTELLIGENCE-OPERATOR-SIGNALS-V2: deterministic active-count signals
    // (already-computed module useMemos). Non-financial — shown for all roles.
    if ((chipData.activeLayawayCount ?? 0) > 0) {
      lines.push({ id: 'layawayActive', icon: '🏷️',
        text: es ? `${chipData.activeLayawayCount} apartados activos`
            : pt ? `${chipData.activeLayawayCount} reservas ativas`
            : `${chipData.activeLayawayCount} active layaways`,
        action: { kind: 'nav', tab: 'layaways', label: L.openLayaways } });
    }
    if ((chipData.activeSpecialOrderCount ?? 0) > 0) {
      lines.push({ id: 'specialOrderActive', icon: '📦',
        text: es ? `${chipData.activeSpecialOrderCount} órdenes especiales abiertas`
            : pt ? `${chipData.activeSpecialOrderCount} pedidos especiais abertos`
            : `${chipData.activeSpecialOrderCount} special orders open`,
        action: { kind: 'nav', tab: 'specialOrders', label: L.openSpecial } });
    }
    if ((chipData.activeUnlockCount ?? 0) > 0) {
      lines.push({ id: 'unlockActive', icon: '🔓',
        text: es ? `${chipData.activeUnlockCount} desbloqueos en progreso`
            : pt ? `${chipData.activeUnlockCount} desbloqueios em andamento`
            : `${chipData.activeUnlockCount} unlocks in progress`,
        action: { kind: 'nav', tab: 'unlocks', label: L.openUnlocks } });
    }
    // R-INTELLIGENCE-OPERATOR-SIGNALS-V3: activations completed today (info).
    if ((chipData.todayActivationCount ?? 0) > 0) {
      lines.push({ id: 'todayActivation', icon: '📶',
        text: es ? `${chipData.todayActivationCount} activaciones hoy`
            : pt ? `${chipData.todayActivationCount} ativações hoje`
            : `${chipData.todayActivationCount} activations today` });
    }
    if (canSeeOwnerFinancials && chipData.biggestLeakCents > 0) {
      const amt = `$${(chipData.biggestLeakCents / 100).toFixed(0)}`;
      lines.push({ id: 'leak', icon: '💸',
        text: es ? `${amt} en ganancia recuperable`
            : pt ? `${amt} em lucro recuperável`
            : `${amt} recoverable profit` });
    }
    if (canSeeOwnerFinancials && chipData.deadStockLockedCents > 0) {
      const amt = `$${(chipData.deadStockLockedCents / 100).toFixed(0)}`;
      lines.push({ id: 'deadStock', icon: '📦',
        text: es ? `${amt} bloqueado en stock muerto`
            : pt ? `${amt} preso em estoque parado`
            : `${amt} locked in dead stock` });
    }
  }

  // R-INTELLIGENCE-OPERATOR-ACTIONS-V1: run a line's action via an EXISTING
  // mechanism only — navigate-tab CustomEvent (AppShell) or onSuggestion chat
  // prompt. No new command system, no direct mutations, no money exposure.
  const runAction = (a: BriefAction) => {
    if (a.kind === 'nav') {
      try {
        window.dispatchEvent(new CustomEvent('cellhub:navigate-tab', { detail: { tab: a.tab } }));
      } catch { /* env without CustomEvent — silent */ }
    } else if (a.kind === 'chat') {
      onSuggestion?.(a.query);
    }
  };

  return (
    <div style={{ marginBottom: 14, textAlign: 'left' }}>
      {/* R-INTELLIGENCE-F3D: canonical Top 3 Actions Today (F3B) — the single
          priority source. Read-only; $ redacted for non-owners (financialSensitive). */}
      {topList.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: '#64748B', marginBottom: 8 }}>
            ⚡ {tc('intelligence.topActions.title')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {topList.map((a, i) => (
              <TopActionRow
                key={a.decisionId}
                action={a}
                index={i}
                t={tc}
                canSeeOwnerFinancials={canSeeOwnerFinancials}
                variant="brief"
              />
            ))}
          </div>
        </div>
      )}

      {/* Informational counts only (no ranking, no actions duplicated from F3B). */}
      {lines.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: '#64748B', marginBottom: 8 }}>
            {todayLabel}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {lines.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#CBD5E1' }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{l.icon}</span>
                <span style={{ flex: 1 }}>{l.text}</span>
                {l.action && (
                  <button
                    type="button"
                    onClick={() => runAction(l.action!)}
                    style={{
                      flexShrink: 0, fontSize: 10.5, fontWeight: 600,
                      padding: '2px 8px', borderRadius: 5, cursor: 'pointer',
                      background: 'rgba(59,130,246,0.12)', color: '#93C5FD',
                      border: '1px solid rgba(59,130,246,0.28)', whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {l.action.label}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* All-clear only when there is truly nothing to surface. */}
      {topList.length === 0 && lines.length === 0 && (
        <div style={{ fontSize: 12.5, color: '#94A3B8', lineHeight: '1.5' }}>
          {es ? '✓ Todo al día. Sin pendientes urgentes — revisa las oportunidades abajo.'
           : pt ? '✓ Tudo em dia. Nada urgente — veja as oportunidades abaixo.'
           : '✓ All clear. No urgent items — review the opportunities below.'}
        </div>
      )}
    </div>
  );
}

function OperatorWelcome({ locale, chipData, topActions, onSuggestion, canSeeOwnerFinancials = true }: {
  locale: string;
  chipData?: ChipData;
  topActions?: TopAction[];
  onSuggestion: (text: string) => void;
  canSeeOwnerFinancials?: boolean;
}) {
  const pendingWorkflows = getPendingResumeContexts();
  const resumeLabel = locale === 'es' ? 'RETOMAR' : locale === 'pt' ? 'RETOMAR' : 'RESUME';

  return (
    <div style={{ padding: '16px 4px' }}>
      {/* R-INTELLIGENCE-OPERATOR-HOME-V1: operational briefing replaces the
          generic chatbot helper copy. The deterministic TODAY summary reads
          like an operator console; action chips/cards below stay unchanged.
          R-INTELLIGENCE-OPERATOR-ACTIONS-V1: onSuggestion enables per-line
          executable buttons (reuses existing chat + navigate-tab handlers). */}
      <OperatorTodayBriefing chipData={chipData} locale={locale} topActions={topActions} canSeeOwnerFinancials={canSeeOwnerFinancials} onSuggestion={onSuggestion} />

      {pendingWorkflows.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pendingWorkflows.slice(0, 2).map((wf) => (
            <div key={wf.workflowId} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 11px',
              borderRadius: 7,
              border: '1px solid #F59E0B33',
              background: '#F59E0B0D',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#F59E0B', letterSpacing: '0.07em' }}>
                  {resumeLabel}
                </div>
                <div style={{ fontSize: 12, color: '#CBD5E1', marginTop: 1, lineHeight: '1.3' }}>
                  {wf.resumeDescription}
                </div>
              </div>
              <button
                onClick={() => onSuggestion(wf.resumeLabel)}
                style={{
                  marginLeft: 10, flexShrink: 0,
                  fontSize: 11, padding: '4px 10px', borderRadius: 5,
                  background: '#F59E0B18', border: '1px solid #F59E0B44',
                  color: '#F59E0B', cursor: 'pointer', whiteSpace: 'nowrap' as const,
                }}
              >
                {wf.resumeLabel}
              </button>
            </div>
          ))}
        </div>
      )}

      {chipData
        ? <SuggestionChips chipData={chipData} onFireChat={onSuggestion} locale={locale} mode="welcome" canSeeOwnerFinancials={canSeeOwnerFinancials} />
        : <QuickActionGrid onQuickAction={onSuggestion} canSeeOwnerFinancials={canSeeOwnerFinancials} />}
    </div>
  );
}

// ── Right-column idle state when input lives in center ───────
function RightColumnWelcome({ locale }: { locale: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', padding: '28px 22px', textAlign: 'center', gap: 14,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        border: '1px solid #0E1A2B', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 14, color: '#1A2B3C',
      }}>
        ↗
      </div>
      <p style={{ fontSize: 12, color: '#2D3D52', lineHeight: 1.75, margin: 0, maxWidth: 200 }}>
        {locale === 'es'
          ? 'Selecciona una acción o escribe una pregunta.'
          : 'Select an action or type a question to get started.'}
      </p>
    </div>
  );
}

// ── Option-2 welcome: large action cards for compact/command-center mode ──
function OperatorCommandWelcome({ locale, chipData, topActions, onSuggestion }: {
  locale: string;
  chipData?: ChipData;
  topActions?: TopAction[];
  onSuggestion: (text: string) => void;
}) {
  const hour = new Date().getHours();
  const es = locale === 'es';
  // R-INTELLIGENCE-USE-APP-LANGUAGE-V1: pt branch so the operational action cards
  // + greeting follow the app language (was es-or-English only). query strings
  // stay as-is — they are not displayed and classifyIntent understands ES/EN/PT.
  const pt = locale === 'pt';
  const greeting = es
    ? (hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches')
    : pt
    ? (hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite')
    : (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  const greetingEmoji = hour < 12 ? '🌅' : hour < 18 ? '☀️' : '🌙';

  const cards = [
    {
      icon: '💰',
      title: es ? 'Cobrar pagos' : pt ? 'Cobrar pagamentos' : 'Collect Payments',
      subtitle: chipData && chipData.staleRepairCount > 0
        ? `${chipData.staleRepairCount} ${es ? 'reparaciones sin recoger' : pt ? 'reparos não retirados' : 'repairs uncollected'}`
        : es ? 'Revisar balances pendientes' : pt ? 'Verificar saldos pendentes' : 'Check outstanding balances',
      accent: '#F59E0B',
      query: es ? 'qué reparaciones están retrasadas' : 'what repairs are delayed',
    },
    {
      icon: '🚀',
      title: es ? 'Promover productos' : pt ? 'Promover um produto' : 'Promote a Product',
      subtitle: chipData && chipData.productOppsCount > 0
        ? `${chipData.productOppsCount} ${es ? 'productos para promover' : pt ? 'itens para promover' : 'items to promote'}`
        : es ? 'Ver oportunidades de venta' : pt ? 'Ver oportunidades de venda' : 'See selling opportunities',
      accent: '#8B5CF6',
      query: es ? 'qué productos debo promover hoy' : 'what products should I promote today',
    },
    {
      icon: '✅',
      title: es ? 'Reparaciones listas' : pt ? 'Reparos prontos' : 'Repairs Ready',
      subtitle: chipData && chipData.repairsPending > 0
        ? `${chipData.repairsPending} ${es ? 'listas para entrega' : pt ? 'prontos para retirada' : 'ready for pickup'}`
        : es ? 'Todo al día' : pt ? 'Tudo em dia' : 'All caught up',
      accent: '#10B981',
      query: es ? 'reparaciones listas para entrega' : 'repairs ready for pickup',
    },
    {
      icon: '📞',
      title: es ? 'Contactar clientes' : pt ? 'Contatar clientes' : 'Contact Customers',
      subtitle: chipData && chipData.outreachCount >= 2
        ? `${chipData.outreachCount} ${es ? 'pendientes de contacto' : pt ? 'pendentes de contato' : 'pending outreach'}`
        : es ? 'Lista de WhatsApp' : pt ? 'Lista de WhatsApp' : 'WhatsApp outreach list',
      accent: '#3B82F6',
      // CONTACT-CUSTOMERS-CARD-ROUTE-TO-ATTENTION-V1: route to the proven
      // attention_feed flow (same output as typing "what needs attention").
      query: es ? 'qué necesita atención' : 'what needs attention',
    },
  ];

  return (
    <div style={{ padding: '52px 28px 32px', maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: '#F1F5F9', margin: '0 0 10px', lineHeight: 1.2 }}>
          {greeting} {greetingEmoji}
        </h2>
        <p style={{ fontSize: 16, color: '#6B7280', margin: 0 }}>
          {es ? '¿Qué quieres manejar?' : 'What would you like to handle?'}
        </p>
      </div>
      {/* R-INTELLIGENCE-OPERATOR-HOME-V1: deterministic TODAY briefing above
          the command cards. Operational-only (no money figures) to match the
          compact command-center cards.
          R-INTELLIGENCE-OPERATOR-ACTIONS-V1: onSuggestion enables per-line
          executable buttons (reuses existing chat + navigate-tab handlers). */}
      <OperatorTodayBriefing chipData={chipData} locale={locale} topActions={topActions} canSeeOwnerFinancials={false} onSuggestion={onSuggestion} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {cards.map((card) => (
          <button
            key={card.query}
            onClick={() => onSuggestion(card.query)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 12, padding: '22px', borderRadius: 14, textAlign: 'left',
              background: '#0D1625', border: `1px solid ${card.accent}22`,
              cursor: 'pointer', transition: 'background 0.12s',
            }}
          >
            <span style={{ fontSize: 30, lineHeight: 1 }}>{card.icon}</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: card.accent, marginBottom: 5, lineHeight: 1.2 }}>
                {card.title}
              </div>
              <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.4 }}>
                {card.subtitle}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickActionGrid({ onQuickAction, canSeeOwnerFinancials = true }: { onQuickAction: (text: string) => void; canSeeOwnerFinancials?: boolean }) {
  const { t, locale } = useTranslation();

  type Card = { icon: string; titleKey: string; queryKey: string; desc: string; ownerOnly?: boolean };
  const D = {
    today:    locale === 'es' ? 'Ingresos, transacciones y ritmo de hoy.'
            : locale === 'pt' ? 'Receita, transações e ritmo de hoje.'
            : "Today's revenue, transactions, and pace.",
    contact:  locale === 'es' ? 'Clientes valiosos para contactar por WhatsApp hoy.'
            : locale === 'pt' ? 'Clientes valiosos para contatar pelo WhatsApp hoje.'
            : 'High-value customers worth a WhatsApp today.',
    sell:     locale === 'es' ? 'Oportunidades de mayor margen para hoy.'
            : locale === 'pt' ? 'Oportunidades de maior margem para hoje.'
            : 'Highest-margin opportunities for today.',
    profit:   locale === 'es' ? 'Días lentos, stock muerto e ingresos perdidos.'
            : locale === 'pt' ? 'Dias lentos, estoque morto e receita perdida.'
            : 'Slow days, dead stock, and missed revenue.',
    promote:  locale === 'es' ? 'Promociona un producto a tus clientes top.'
            : locale === 'pt' ? 'Promova um produto para seus clientes top.'
            : 'Push a specific item to top customers.',
    ready:    locale === 'es' ? 'Reparaciones listas para entrega ahora.'
            : locale === 'pt' ? 'Reparos prontos para retirada agora.'
            : 'Repairs ready for pickup right now.',
  };

  const cards: Card[] = [
    { icon: '📊', titleKey: 'intelligence.console.chipToday',      queryKey: 'intelligence.console.queryToday',          desc: D.today },
    { icon: '📞', titleKey: 'intelligence.console.chipWhoContact', queryKey: 'intelligence.console.queryContactToday',   desc: D.contact },
    // R-FINANCIAL-PRIVACY-V4: "Highest-margin opportunities" + "Slow days,
    // dead stock, missed revenue" are owner-only chips. Marked here and
    // filtered out below when the viewer cannot see owner financials.
    { icon: '🎯', titleKey: 'intelligence.console.chipWhatSell',   queryKey: 'intelligence.dash.quickSell',              desc: D.sell,    ownerOnly: true },
    { icon: '💸', titleKey: 'intelligence.console.chipProfit',     queryKey: 'intelligence.dash.quickProfit',            desc: D.profit,  ownerOnly: true },
    { icon: '🚀', titleKey: 'intelligence.console.chipPromote',    queryKey: 'intelligence.console.queryPromoteGeneric', desc: D.promote },
    { icon: '🔧', titleKey: 'intelligence.console.chipReady',      queryKey: 'intelligence.console.queryReadyRepairs',   desc: D.ready },
  ];
  const visibleCards = canSeeOwnerFinancials ? cards : cards.filter((c) => !c.ownerOnly);

  return (
    <div className="py-4">
      <div className="text-center mb-5">
        <div className="text-4xl mb-2">💬</div>
        <p className="text-sm text-slate-300">{t('intelligence.tryQuestion')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visibleCards.map((c) => (
          <button
            key={c.titleKey}
            onClick={() => onQuickAction(t(c.queryKey))}
            className="text-left rounded-lg border border-surface-600 bg-surface-700/50 hover:bg-surface-700 px-4 py-3.5 transition-colors duration-150 active:scale-[0.99]"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none shrink-0 mt-0.5">{c.icon}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100">{t(c.titleKey)}</div>
                <div className="text-xs text-slate-400 mt-0.5 leading-snug">{c.desc}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
