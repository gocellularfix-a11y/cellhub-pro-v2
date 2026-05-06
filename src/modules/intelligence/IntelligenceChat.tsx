// ============================================================
// CellHub Intelligence — Chat Interface
// R-INTEL-CHAT-F5
//
// Ask-the-shop chat. Pure client-side intent routing + template
// responses. No LLM calls, no API cost. Handles ~80% of common
// owner questions deterministically.
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer, CartItem } from '@/store/types';
import { classifyIntent, isFollowUpQuery } from '@/services/intelligence/chat/intentRouter';
import { handleIntent, handleFollowUp } from '@/services/intelligence/chat/handlers';
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';
import { executeActionPayload } from '@/services/intelligence/actions/actionExecutor';
import {
  createAutomationItem,
  approveAutomationItem,
  cancelAutomationItem,
  markAutomationExecuted,
  markAutomationFailed,
  addAutomationOutcome,
  addAutomationExecutionLog,
} from '@/services/intelligence/automation/automationQueue';
import type { AutomationQueueItem, AutomationOutcome } from '@/services/intelligence/automation/automationQueue';
import { scoreAutomationItem } from '@/services/intelligence/automation/automationPriority';
import { Modal, useToast } from '@/components/ui';
import { useTranslation } from '@/i18n';
// R-INTELLIGENCE-PENDING-DEAL-ADD-TO-CART-V1: convert approved deal → POS cart line.
import { useApp } from '@/store/AppProvider';
import { generateId } from '@/utils/dates';

interface Props {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es';
  // When this changes (new seq), the chat auto-submits the query text.
  externalQuery?: { text: string; seq: number };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  kind?: 'answer' | 'disambiguation' | 'error' | 'help';
  actions?: ChatActionUI[];
}

const AUTOMATION_QUEUE_STORAGE_KEY = 'cellhub:intelligence:automationQueue:v1';

export default function IntelligenceChat({ engine, customers, lang, externalQuery }: Props) {
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
    try {
      const raw = localStorage.getItem(AUTOMATION_QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
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

  const fireQuery = useCallback((query: string) => {
    // R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1: short follow-up phrases re-use
    // the last intent's context. Early return — no classifyIntent, no scan.
    let response;
    let matchedIntentId: string;
    if (isFollowUpQuery(query) && lastIntentRef.current) {
      response = handleFollowUp(lastIntentRef.current, engineRef.current, langRef.current);
      matchedIntentId = lastIntentRef.current.intentId; // preserve context for chained follow-ups
    } else {
      const match = classifyIntent(query, customersRef.current, langRef.current);
      response = handleIntent(match, engineRef.current, langRef.current);
      matchedIntentId = match.id;
    }
    // R-INTELLIGENCE-INTENT-DEDUP-ISOLATION: skip identical assistant push
    // within 500ms of the last identical response (prevents double-render
    // from StrictMode/race re-fire). Always refresh the timestamp so a
    // legitimate repeat query later still pushes.
    const now = Date.now();
    if (response.text === lastResponseRef.current.text && now - lastResponseRef.current.ts < 500) {
      lastResponseRef.current.ts = now;
      return;
    }
    lastResponseRef.current = { text: response.text, ts: now };
    // R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1: store last intent for next follow-up.
    lastIntentRef.current = { intentId: matchedIntentId, query, responseText: response.text, ts: now };
    clearActionFeedback();
    if (response.actions?.length) {
      addAutomationItems(response.actions.map(createQueueItemFromChatAction));
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
  useEffect(() => {
    const STORAGE_KEY = 'cellhub:intelligence:dailyAutomation:lastRun';
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    try {
      if (localStorage.getItem(STORAGE_KEY) === today) return;
    } catch { /* incognito / quota — proceed without guard */ }

    const eng = engineRef.current;
    const m = eng.getTodayMetrics();

    // Reuse existing safe contact pipeline (consent-filtered + 24h-deduped).
    const candidates = eng.buildOutreachQueueItems().slice(0, 3);
    if (candidates.length === 0) {
      // No candidates → skip without storing, so a later analyze pass with
      // populated scores can still trigger.
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
    addAutomationItems(built.map(createQueueItemFromChatAction));
    try { localStorage.setItem(STORAGE_KEY, today); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // R-INTELLIGENCE-INTENT-DEDUP-ISOLATION: same dedup guard as fireQuery.
    const now = Date.now();
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
    };

    clearActionFeedback();
    if (response.actions?.length) {
      addAutomationItems(response.actions.map(createQueueItemFromChatAction));
    }
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
  };

  function handleActionClick(action: ChatActionUI) {
    const result = executeActionPayload(action.payload);
    if (!result.ok) {
      setFeedbackForAction(action.id, `Action not available: ${result.reason}`);
      return;
    }
    switch (result.type) {
      case 'whatsapp_url':
        setPendingWaAction({ action, url: result.url });
        return;
      case 'pos_discount':
        setFeedbackForAction(action.id, 'Discount action prepared.');
        break;
      case 'pos_bundle':
        setFeedbackForAction(action.id, 'Bundle action prepared.');
        break;
      case 'review_panel':
        setFeedbackForAction(action.id, 'Review action prepared.');
        break;
      case 'reminder_queue':
        setFeedbackForAction(action.id, 'Reminder action prepared.');
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

  const handleSuggestion = (suggestion: string) => {
    setInput(suggestion);
  };

  const clearChat = () => setMessages([]);

  return (
    <div className="bg-surface-800 rounded-lg border border-surface-700 overflow-hidden flex flex-col" style={{ minHeight: '400px', maxHeight: '600px' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-700 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-200">
            💬 {t('intelligence.askYourShop')}
          </h3>
          <p className="text-xs text-slate-400">
            {t('intelligence.chatDescription')}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-slate-300"
          >
            {t('intelligence.clear')}
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={messageListRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <EmptyState onSuggestion={handleSuggestion} />
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} es={locale === 'es'} onAction={handleActionClick} feedbackById={actionFeedbackById} />)
        )}
      </div>

      {/* Automation Queue */}
      {automationQueue.length > 0 && (
        <div className="border-t border-surface-700 px-3 py-2 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-slate-400">Automation Queue</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500">
                Pending: {automationQueue.filter(i => i.status === 'pending').length}
              </span>
              <button
                onClick={() => setAutomationQueue(prev => prev.filter(i => i.status !== 'completed' && i.status !== 'cancelled'))}
                className="text-[10px] text-slate-500 hover:text-slate-300 underline"
              >
                Clear completed
              </button>
            </div>
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {[...automationQueue].sort((a, b) => scoreAutomationItem(b).score - scoreAutomationItem(a).score).map(item => {
              const priority = scoreAutomationItem(item);
              return (
              <div key={item.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-surface-700 border border-surface-600">
                <div className="min-w-0 flex-1">
                  <span className="text-xs text-slate-300 truncate block">{item.label}</span>
                  <span className="text-[10px] text-slate-500">
                    {item.kind}{item.customerName ? ` · ${item.customerName}` : ''}{item.sku ? ` · ${item.sku}` : ''}
                    {' · '}
                    <span title={priority.reasons.join(', ')}>Priority: {priority.score}</span>
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
                      Outcome: {item.outcomeLog[item.outcomeLog.length - 1].outcome}
                    </span>
                  ) : null}
                  {item.status === 'completed' && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {([
                        ['customer_responded', 'Responded'],
                        ['sale_created', 'Sale'],
                        ['no_response', 'No Response'],
                        ['not_relevant', 'Not Relevant'],
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
                  {item.status !== 'pending' ? (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      item.status === 'completed' ? 'border-green-600/50 text-green-400' :
                      item.status === 'approved'  ? 'border-blue-600/50 text-blue-400' :
                      item.status === 'failed'    ? 'border-red-600/50 text-red-400' :
                      'border-slate-600 text-slate-500'
                    }`}>
                      {item.status}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleApproveAutomation(item.id)}
                        className="text-[10px] px-2 py-0.5 rounded border border-green-700 text-green-400 hover:bg-green-900/30"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleCancelAutomation(item.id)}
                        className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:bg-surface-600"
                      >
                        Cancel
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

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-surface-700 p-3 flex gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('intelligence.chatPlaceholder')}
          className="flex-1 bg-surface-700 text-slate-200 rounded px-3 py-2 text-sm border border-surface-600 focus:outline-none focus:border-blue-500"
          style={{ transform: 'translateZ(0)' }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-surface-700 disabled:text-slate-500 text-white text-sm font-medium"
        >
          {t('intelligence.send')}
        </button>
      </form>

      <Modal
        open={!!pendingWaAction}
        onClose={() => setPendingWaAction(null)}
        title="Open WhatsApp?"
        size="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setPendingWaAction(null)}
              className="px-4 py-2 rounded bg-surface-700 hover:bg-surface-600 text-slate-300 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (pendingWaAction) {
                  window.open(pendingWaAction.url, '_blank');
                  setFeedbackForAction(pendingWaAction.action.id, 'WhatsApp opened.');
                }
                setPendingWaAction(null);
              }}
              className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
            >
              Open WhatsApp
            </button>
          </>
        }
      >
        <p className="text-slate-300 text-sm mb-2">
          This will open WhatsApp with a prepared message.
        </p>
        <p className="text-slate-200 text-sm font-medium">
          {pendingWaAction?.action.payload.customerName ?? 'Customer'}
        </p>
      </Modal>
    </div>
  );
}

// ── Message bubble ──────────────────────────────────────────
function MessageBubble({ msg, es, onAction, feedbackById }: { msg: ChatMessage; es: boolean; onAction: (action: ChatActionUI) => void; feedbackById: Record<string, { message: string; ts: number }> }) {
  const isUser = msg.role === 'user';
  const kindColor = {
    answer: 'border-blue-500/30 bg-blue-500/5',
    disambiguation: 'border-amber-500/30 bg-amber-500/5',
    error: 'border-red-500/30 bg-red-500/5',
    help: 'border-slate-500/30 bg-slate-500/5',
  };
  const colorClass = !isUser && msg.kind ? kindColor[msg.kind] : '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-blue-600 text-white'
            : `bg-surface-700 text-slate-200 border ${colorClass}`
        }`}
      >
        {!isUser && <div className="text-xs text-slate-400 mb-1">🤖 {es ? 'Intelligence' : 'Intelligence'}</div>}
        {msg.content}
        {!isUser && msg.actions && msg.actions.length > 0 && (
          <div className="flex flex-wrap mt-2">
            {msg.actions.map(action => (
              <div key={action.id} className="inline-block mr-2 mt-2 align-top">
                <button
                  onClick={() => onAction(action)}
                  disabled={!action.payload.executable}
                  title={action.payload.executable ? '' : 'Missing data to execute'}
                  className="px-3 py-1 rounded border border-slate-600 text-xs text-slate-300 hover:bg-surface-600 active:scale-[0.98] disabled:opacity-50"
                >
                  {action.label}
                  {action.actionType && (
                    <span className="ml-1 text-[10px] opacity-60">[{action.actionType}]</span>
                  )}
                </button>
                {feedbackById[action.id]?.message && (
                  <div className="mt-1 text-[11px] text-slate-400">
                    {feedbackById[action.id]?.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state with suggestions ────────────────────────────
function EmptyState({ onSuggestion }: { es?: boolean; onSuggestion: (s: string) => void }) {
  const { t, locale } = useTranslation();
  const suggestions = locale === 'es'
    ? ['cómo van las ventas', 'qué vendo más', 'qué me falta', 'cómo está la tienda', 'reparaciones atrasadas', 'ayuda']
    : locale === 'pt'
    ? ['como estão as vendas', 'itens mais vendidos', 'o que preciso', 'saúde da loja', 'reparos atrasados', 'ajuda']
    : ['how are sales', 'top items', 'what do I need', 'store health', 'overdue repairs', 'help'];

  return (
    <div className="text-center py-6">
      <div className="text-4xl mb-2">💬</div>
      <p className="text-sm text-slate-300 mb-4">
        {t('intelligence.tryQuestion')}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestion(s)}
            className="px-3 py-1 text-xs rounded-full bg-surface-700 hover:bg-surface-600 text-slate-300 border border-surface-600"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
