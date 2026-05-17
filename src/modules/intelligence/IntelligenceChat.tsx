// ============================================================
// CellHub Intelligence — Chat Interface
// R-INTEL-CHAT-F5
//
// Ask-the-shop chat. Pure client-side intent routing + template
// responses. No LLM calls, no API cost. Handles ~80% of common
// owner questions deterministically.
// ============================================================

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer, CartItem } from '@/store/types';
import { classifyIntent, isFollowUpQuery, enrichFollowUpQuery } from '@/services/intelligence/chat/intentRouter';
import type { OperationalContext } from '@/services/intelligence/chat/intentRouter';
import { handleIntent, handleFollowUp } from '@/services/intelligence/chat/handlers';
import type { ChatActionUI, PanelCampaignDraft, WorkflowSection } from '@/services/intelligence/chat/handlers';
import { executeActionPayload } from '@/services/intelligence/actions/actionExecutor';
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
// R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: convert approved deal → POS cart line.
import { useApp } from '@/store/AppProvider';
import { generateId } from '@/utils/dates';
// R-INTELLIGENCE-PERFORMANCE-AUDIT-V1: temporary perf instrumentation.
import { perfLog, perfTime } from '@/services/intelligence/perfDebug';

interface Props {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es';
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
  compact?: boolean;
  hideInput?: boolean;
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

export default function IntelligenceChat({ engine, customers, lang, externalQuery, onOpenPromote, onPanelCampaign, chipData, compact, hideInput }: Props) {
  const { locale, t } = useTranslation();
  // R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: cart + inventory + dispatch
  // for converting approved deals into POS cart lines. Mirrors the pattern
  // used by RepairModule, UnlockModule, SpecialOrdersModule, ReturnsModule.
  const {
    state: { cart, inventory },
    setCart,
    dispatch,
  } = useApp();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
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

  // Auto-submit when parent fires a quick-action chip.
  const engineRef = useRef(engine);
  const customersRef = useRef(customers);
  const langRef = useRef(lang);
  useEffect(() => { engineRef.current = engine; }, [engine]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { langRef.current = lang; }, [lang]);

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
    // R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1: short follow-up phrases re-use
    // the last intent's context. Early return — no classifyIntent, no scan.
    let response;
    let matchedIntentId: string;
    if (isFollowUpQuery(query) && lastIntentRef.current) {
      response = perfTime('intel.chat.handleFollowUp',
        () => handleFollowUp(lastIntentRef.current!, engineRef.current, langRef.current));
      matchedIntentId = lastIntentRef.current.intentId; // preserve context for chained follow-ups
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
      response = perfTime(`intel.chat.handleIntent.${match.id}`,
        () => handleIntent(match, engineRef.current, langRef.current));
      matchedIntentId = match.id;
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

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = input.trim();
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
      response = handleFollowUp(lastIntentRef.current, engine, lang);
      matchedIntentId = lastIntentRef.current.intentId;
    } else {
      const match = classifyIntent(query, customers, lang);
      response = handleIntent(match, engine, lang);
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
      setInput('');
      return;
    }
    lastResponseRef.current = { text: response.text, ts: now };
    lastIntentRef.current = { intentId: matchedIntentId, query, responseText: response.text, ts: now };

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
    setInput('');
  };

  function handleActionClick(action: ChatActionUI) {
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
      if (text && typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text).then(
          () => setFeedbackForAction(action.id, t('chat.action.copied')),
          () => setFeedbackForAction(action.id, t('chat.action.copyFailed')),
        );
      } else {
        setFeedbackForAction(action.id, t('chat.action.copied'));
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
      case 'open_repair':
        setFeedbackForAction(action.id, t('chat.action.openingTicket'));
        break;
      case 'open_customer':
        setFeedbackForAction(action.id, t('chat.action.openingCustomer'));
        break;
      case 'open_layaway':
        setFeedbackForAction(action.id, t('chat.action.openingLayaway'));
        break;
      case 'open_inventory':
        setFeedbackForAction(action.id, t('chat.action.openingItem'));
        break;
      case 'queue_manager_review':
        setFeedbackForAction(action.id, t('chat.action.openingReview'));
        break;
    }
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
  function handleAddDealToCart(id: string) {
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
    setCart([...cart, cartItem]);

    dispatch({ type: 'SET_PENDING_POS_CUSTOMER', payload: deal.customerId });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'pos' });

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

  const clearChat = () => setMessages([]);

  return (
    <div
      className={compact ? 'overflow-hidden flex flex-col' : 'bg-surface-800 rounded-lg border border-surface-700 overflow-hidden flex flex-col'}
      style={compact ? { flex: 1, minHeight: 0, background: '#080F1E' } : { minHeight: '560px', maxHeight: '760px' }}
    >
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
            <SuggestionChips chipData={chipData} onFireChat={handleSuggestion} locale={locale} mode='row' />
          )}
        </div>
      )}

      {/* Continuity bar — full mode only */}
      {!compact && messages.length > 0 && chipData && (
        <OperatorContinuityBar chipData={chipData} onFireChat={handleSuggestion} locale={locale} />
      )}

      {/* Messages */}
      <div
        ref={messageListRef}
        className={compact ? '' : 'flex-1 overflow-y-auto px-4 py-5'}
        style={compact ? { flex: 1, overflowY: 'auto' } : undefined}
      >
        {compact ? (
          messages.length === 0 ? (
            hideInput
              ? <RightColumnWelcome locale={locale} />
              : <OperatorCommandWelcome locale={locale} chipData={chipData} onSuggestion={handleSuggestion} />
          ) : (
            <div style={{ padding: '14px 16px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} lang={locale} onAction={handleActionClick} feedbackById={actionFeedbackById} />)}
            </div>
          )
        ) : (
          <div className="max-w-3xl mx-auto space-y-3">
            {messages.length === 0 ? (
              <OperatorWelcome locale={locale} chipData={chipData} onSuggestion={handleSuggestion} />
            ) : (
              messages.map((msg) => <MessageBubble key={msg.id} msg={msg} lang={locale} onAction={handleActionClick} feedbackById={actionFeedbackById} />)
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

      {/* Command bar */}
      {compact ? (
        !hideInput && <div style={{ padding: '12px 28px 24px', background: '#080F1E', borderTop: messages.length > 0 ? '1px solid #0D1420' : 'none', flexShrink: 0 }}>
          {messages.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                onClick={clearChat}
                style={{ fontSize: 11, color: '#4B5563', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                {locale === 'es' ? 'Limpiar' : 'Clear'}
              </button>
            </div>
          )}
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 620, margin: '0 auto' }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={locale === 'es' ? 'Pregunta lo que sea…' : 'Ask anything…'}
              style={{
                flex: 1, background: '#0D1625', color: '#E2E8F0',
                borderRadius: 12, padding: '14px 18px', fontSize: 14,
                border: '1px solid #1A2535', outline: 'none', minWidth: 0,
              }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              style={{
                padding: '14px 20px', borderRadius: 12, fontSize: 18,
                background: input.trim() ? '#1E3A6E' : '#0D1625',
                color: input.trim() ? '#93C5FD' : '#2D3A4A',
                border: `1px solid ${input.trim() ? '#2D4E8A' : '#1A2535'}`,
                cursor: input.trim() ? 'pointer' : 'not-allowed',
                flexShrink: 0, transition: 'all 0.12s',
              }}
            >
              →
            </button>
          </form>
        </div>
      ) : (
        <div className='border-t border-surface-700 shrink-0' style={{ padding: '10px 14px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10B981', flexShrink: 0, display: 'inline-block' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#4B5563', letterSpacing: '0.09em' }}>
              {locale === 'es' ? 'OPERADOR LISTO' : locale === 'pt' ? 'OPERADOR PRONTO' : 'OPERATOR READY'}
            </span>
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              type='text'
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
              disabled={!input.trim()}
              style={{
                padding: '10px 15px', borderRadius: 8,
                background: input.trim() ? '#1E3A6E' : '#141E2E',
                color: input.trim() ? '#93C5FD' : '#374151',
                fontSize: 15,
                border: input.trim() ? '1px solid #1D4ED844' : '1px solid #1A2332',
                cursor: input.trim() ? 'pointer' : 'not-allowed',
                transition: 'background 0.12s, color 0.12s', flexShrink: 0,
              }}
            >
              ⏎
            </button>
          </form>
        </div>
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
                  window.open(pendingWaAction.url, '_blank');
                  setFeedbackForAction(pendingWaAction.action.id, t('chat.whatsapp.opened'));
                  // R-INTELLIGENCE-PROPOSAL-FOLLOWUP-INBOX-V1: record the
                  // manual outreach as a 'sent' follow-up. No WhatsApp API,
                  // no scraping — this just stamps that the owner clicked
                  // Open WhatsApp so the chat can later list pending
                  // follow-ups and link pasted replies to a record.
                  const a = pendingWaAction.action;
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
function MessageBubble({ msg, lang, onAction, feedbackById }: { msg: ChatMessage; lang: string; onAction: (action: ChatActionUI) => void; feedbackById: Record<string, { message: string; ts: number }> }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
        <div style={{
          maxWidth: '82%',
          padding: '7px 12px',
          borderRadius: 6,
          background: '#0F1E35',
          border: '1px solid #1E3352',
          color: '#93C5FD',
          fontSize: 13,
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
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
}

// ── Quick Action Grid (R-INTELLIGENCE-INTERFACE-ORGANIZATION-V1) ─────
// Replaces the old chip-style EmptyState with a 2-column grid of larger
// operator-style action cards. Each card auto-submits the matching query
// (matches the IntelligenceModule chip behavior). Reuses existing
// translation keys for titles + the actual queries fired; descriptions
// use inline locale ternary, mirroring the prior EmptyState pattern so
// no new translation keys are needed and bilingual coverage stays
// consistent. UI-only — no logic changes, no new state, no new effects.
function OperatorWelcome({ locale, chipData, onSuggestion }: {
  locale: string;
  chipData?: ChipData;
  onSuggestion: (text: string) => void;
}) {
  const pendingWorkflows = getPendingResumeContexts();
  const resumeLabel = locale === 'es' ? 'RETOMAR' : locale === 'pt' ? 'RETOMAR' : 'RESUME';

  return (
    <div style={{ padding: '16px 4px' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}>⚡</div>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#E2E8F0', margin: 0 }}>
          {locale === 'es' ? 'Listo para operar tu tienda.'
           : locale === 'pt' ? 'Pronto para operar sua loja.'
           : 'Ready to help run your store.'}
        </p>
        <p style={{ fontSize: 11, color: '#6B7280', marginTop: 4, lineHeight: '1.4' }}>
          {locale === 'es' ? 'Pregunta sobre clientes, reparaciones, inventario, impuestos o ganancias.'
           : locale === 'pt' ? 'Pergunte sobre clientes, reparos, inventário, impostos ou lucros.'
           : 'Ask about customers, repairs, taxes, inventory, profit, and workflows.'}
        </p>
      </div>

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
        ? <SuggestionChips chipData={chipData} onFireChat={onSuggestion} locale={locale} mode="welcome" />
        : <QuickActionGrid onQuickAction={onSuggestion} />}
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
function OperatorCommandWelcome({ locale, chipData, onSuggestion }: {
  locale: string;
  chipData?: ChipData;
  onSuggestion: (text: string) => void;
}) {
  const hour = new Date().getHours();
  const es = locale === 'es';
  const greeting = es
    ? (hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches')
    : (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  const greetingEmoji = hour < 12 ? '🌅' : hour < 18 ? '☀️' : '🌙';

  const cards = [
    {
      icon: '💰',
      title: es ? 'Cobrar pagos' : 'Collect Payments',
      subtitle: chipData && chipData.staleRepairCount > 0
        ? `${chipData.staleRepairCount} ${es ? 'reparaciones sin recoger' : 'repairs uncollected'}`
        : es ? 'Revisar balances pendientes' : 'Check outstanding balances',
      accent: '#F59E0B',
      query: es ? 'qué reparaciones están retrasadas' : 'what repairs are delayed',
    },
    {
      icon: '🚀',
      title: es ? 'Promover productos' : 'Promote a Product',
      subtitle: chipData && chipData.productOppsCount > 0
        ? `${chipData.productOppsCount} ${es ? 'productos para promover' : 'items to promote'}`
        : es ? 'Ver oportunidades de venta' : 'See selling opportunities',
      accent: '#8B5CF6',
      query: es ? 'qué productos debo promover hoy' : 'what products should I promote today',
    },
    {
      icon: '✅',
      title: es ? 'Reparaciones listas' : 'Repairs Ready',
      subtitle: chipData && chipData.repairsPending > 0
        ? `${chipData.repairsPending} ${es ? 'listas para entrega' : 'ready for pickup'}`
        : es ? 'Todo al día' : 'All caught up',
      accent: '#10B981',
      query: es ? 'reparaciones listas para entrega' : 'repairs ready for pickup',
    },
    {
      icon: '📞',
      title: es ? 'Contactar clientes' : 'Contact Customers',
      subtitle: chipData && chipData.outreachCount >= 2
        ? `${chipData.outreachCount} ${es ? 'pendientes de contacto' : 'pending outreach'}`
        : es ? 'Lista de WhatsApp' : 'WhatsApp outreach list',
      accent: '#3B82F6',
      query: es ? 'quién debo contactar hoy' : 'who should I contact today',
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

function QuickActionGrid({ onQuickAction }: { onQuickAction: (text: string) => void }) {
  const { t, locale } = useTranslation();

  type Card = { icon: string; titleKey: string; queryKey: string; desc: string };
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
    { icon: '🎯', titleKey: 'intelligence.console.chipWhatSell',   queryKey: 'intelligence.dash.quickSell',              desc: D.sell },
    { icon: '💸', titleKey: 'intelligence.console.chipProfit',     queryKey: 'intelligence.dash.quickProfit',            desc: D.profit },
    { icon: '🚀', titleKey: 'intelligence.console.chipPromote',    queryKey: 'intelligence.console.queryPromoteGeneric', desc: D.promote },
    { icon: '🔧', titleKey: 'intelligence.console.chipReady',      queryKey: 'intelligence.console.queryReadyRepairs',   desc: D.ready },
  ];

  return (
    <div className="py-4">
      <div className="text-center mb-5">
        <div className="text-4xl mb-2">💬</div>
        <p className="text-sm text-slate-300">{t('intelligence.tryQuestion')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map((c) => (
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
