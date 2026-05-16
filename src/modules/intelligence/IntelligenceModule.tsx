// CellHub Intelligence — Operator Console
// R-INTELLIGENCE-UI-OPERATOR-REDESIGN + R-INTELLIGENCE-QUEUE-UI-FIX
//
// Action-first Windows desktop layout:
//   1. Top Operator Summary (compact, action-oriented)
//   2. Make Money tiles
//   3. Ask Your Shop chat (owns its own queue UI + handlers)
//   4. WhatsApp Actions
//   5. Promote Inventory
//   6. Customer Lookup (preserved)
//
// Queue rendering and execution are owned by IntelligenceChat — this
// module does not duplicate that logic, does not touch localStorage,
// and does not execute action payloads.

import { useMemo, useState, useCallback, useRef, useEffect, useTransition } from 'react';
// R-INTELLIGENCE-MANAGER-QUEUE-V1 + R-INTELLIGENCE-FEEDBACK-LOOP-V1
import { getQueue, approveQueueItem, dismissQueueItem, resolveQueueItem, snoozeQueueItem } from '@/services/intelligence/managerQueue/actions';
import { advanceWorkflowStep } from '@/services/intelligence/workflows/flowEngine';
import { getPendingItems, getQueueSummary } from '@/services/intelligence/managerQueue/selectors';
import type { ManagerQueueItem, QueueItemSeverity } from '@/services/intelligence/managerQueue/types';
import { addFeedbackEvent, getFeedbackEvents } from '@/services/intelligence/feedback/store';
import { buildScoreMap } from '@/services/intelligence/feedback/scoring';
import type { IntelligenceFeedbackType } from '@/services/intelligence/feedback/types';
import { useApp } from '@/store/AppProvider';
import {
  IntelligenceEngine,
  type EngineResult,
  type CustomerHistorySummary,
  summarizeCustomerHistory,
  // R-COMPANION-INTELLIGENCE-ACK-INBOUND-V1 — register the live engine
  // so the Companion intelligence ack receiver can mark alerts
  // acknowledged via AlertEngine.acknowledge while this module is mounted.
  setActiveIntelligenceEngine,
} from '@/services/intelligence';
import type { PanelCampaignDraft } from '@/services/intelligence/chat/handlers';
// R-OPERATOR-PROMOTE-PANEL-PREVIEW-V1: canonical wa.me builder reused for
// the per-recipient buttons inside the new panel widget. No new send path.
import { buildWhatsAppUrl } from '@/services/whatsapp';
// R-INTELLIGENCE-PERFORMANCE-AUDIT-V1: temporary perf instrumentation.
// R-INTEL-RENDER-INSTRUMENTATION-CLEANUP: import the flag so the
// `performance.now()` calls in render-prep can be skipped entirely
// when perfDebug is off (which is always, in production).
import { perfLog, perfTime, INTEL_PERF_ENABLED } from '@/services/intelligence/perfDebug';
import IntelligenceChat from './IntelligenceChat';
import FloatingOperatorBubble from '@/components/FloatingOperatorBubble';
import type { LiveAssistSuggestion, LiveAssistContext } from '@/services/intelligence/live/types';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { useTranslation } from '@/i18n';

const CARD_BG     = '#111827';
const CARD_BORDER = '#1F2937';
const PAGE_BG     = '#0B1220';

// Day name localization map for the top-insight sentence.
const DAY_LOCAL: Record<string, Record<string, string>> = {
  es: { Sunday: 'Domingo', Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves', Friday: 'Viernes', Saturday: 'Sábado' },
  pt: { Sunday: 'Domingo', Monday: 'Segunda', Tuesday: 'Terça', Wednesday: 'Quarta', Thursday: 'Quinta', Friday: 'Sexta', Saturday: 'Sábado' },
};

export default function IntelligenceModule() {
  // R-INTELLIGENCE-PERFORMANCE-AUDIT-V1: time the full render-prep block.
  // R-INTEL-RENDER-INSTRUMENTATION-CLEANUP: only allocate when the flag is on
  // (off in production by default). Previously this ran on every render even
  // though the matching perfLog at the bottom would skip emission.
  const _renderT0 = INTEL_PERF_ENABLED ? performance.now() : 0;
  const { state } = useApp();
  const {
    sales, customers, inventory, repairs,
    specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments,
    currentStoreId, consolidatedView,
    // R-CUSTOMER-PROFIT-PARITY-V1: settings carry carrierCommissions +
    // defaultCommissionRate. Engine uses them inside getCustomerHistory
    // to translate phone_payment items into their real economic cost.
    settings,
  } = state;
  const { locale, t } = useTranslation();
  const engineLang: 'en' | 'es' | 'pt' = locale as 'en' | 'es' | 'pt';
  const apiLang: 'es' | 'en' = locale === 'pt' ? 'en' : locale as 'es' | 'en';

  const [refreshKey, setRefreshKey] = useState(0);
  const [lookupQuery, setLookupQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [externalQuery, setExternalQuery] = useState<{ text: string; seq: number } | undefined>(undefined);

  // R-INTELLIGENCE-MANAGER-QUEUE-V1 + R-INTELLIGENCE-FEEDBACK-LOOP-V1
  const [queueItems, setQueueItems] = useState<ManagerQueueItem[]>(() => getQueue());
  const [showAllQueue, setShowAllQueue] = useState(false);
  const queueSectionRef = useRef<HTMLDivElement>(null);
  // feedbackVersion bumps whenever feedback is written — triggers scoreMap recompute.
  const [feedbackVersion, setFeedbackVersion] = useState(0);

  // Promote Inventory state
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string } | null>(null);
  // R-OPERATOR-PROMOTE-PANEL-PREVIEW-V1: campaign draft + locally-edited
  // message text. Draft arrives from runProductPush via the chat callback
  // (auto-fired in handleOpenPromote). Cleared whenever the selected
  // product changes — avoids showing a stale draft for product B after
  // the user re-selects product A.
  // R-CAMPAIGN-QUEUE-V1: per-recipient single-selection (radio) replaced
  // by multi-select (`selectedRecipientIds`). On "Iniciar campaña" the
  // selected set is frozen into `campaignQueue` (status per recipient)
  // and the panel switches into queue-progress mode. Empty queue ⇒
  // pre-campaign UI (checkboxes); non-empty ⇒ in-campaign UI (auto-
  // advance through pending recipients, one wa.me at a time). Queue
  // and draft are persisted to localStorage so a reload mid-campaign
  // restores progress.
  const [panelCampaign, setPanelCampaign] = useState<PanelCampaignDraft | null>(null);
  const [draftMessage, setDraftMessage] = useState<string>('');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  type CampaignQueueItem = {
    customerId: string;
    name: string;
    phone: string;
    status: 'pending' | 'sent' | 'skipped';
  };
  const [campaignQueue, setCampaignQueue] = useState<CampaignQueueItem[]>([]);

  // R-PERF-INTELLIGENCE-CACHE: useRef-stable engine — preserved verbatim.
  // R-OPERATOR-STABILIZATION-AUDIT-V1: refreshKey REMOVED from sig. Including
  // it forced a brand-new engine instance (5 analyzers + 3 scorers + 4 adapter
  // passes) on every Refresh click — defeating the whole point of the
  // useRef-stable engine + updateData() pattern. Refresh now invalidates the
  // 60s analyze() cache via engine.invalidateCache() and bumps refreshKey only
  // for the result useMemo deps (forcing analyze() to re-run against fresh
  // data without rebuilding analyzers/scorers).
  const engineRef = useRef<IntelligenceEngine | null>(null);
  const engineConfigSigRef = useRef<string>('');
  const engineConfigSig = `${engineLang}|${currentStoreId ?? ''}|${consolidatedView ? '1' : '0'}`;

  if (!engineRef.current || engineConfigSigRef.current !== engineConfigSig) {
    // R-INTEL-RENDER-INSTRUMENTATION-CLEANUP: gate timestamp allocations.
    const _t = INTEL_PERF_ENABLED ? performance.now() : 0;
    engineRef.current = new IntelligenceEngine(
      sales, customers, inventory, repairs,
      { lang: engineLang, storeId: consolidatedView ? undefined : currentStoreId, enableAlerts: true, enableScoring: true, cacheTimeoutMinutes: 15 },
      { specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, settings },
    );
    engineConfigSigRef.current = engineConfigSig;
    if (INTEL_PERF_ENABLED) perfLog('intel.module.engine.create', _t);
  }
  const engine = engineRef.current;

  {
    const _t = INTEL_PERF_ENABLED ? performance.now() : 0;
    engine.updateData(sales, customers, inventory, repairs, {
      specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, settings,
    });
    if (INTEL_PERF_ENABLED) perfLog('intel.module.engine.updateData', _t);
  }

  // R-COMPANION-INTELLIGENCE-ACK-INBOUND-V1 — register/deregister the
  // currently-live engine with the intelligence active-engine slot. The
  // Companion intelligence ack receiver dispatches AlertEngine.acknowledge
  // through this slot. Cero side effects when no Companion ack is in
  // flight; cleanup unregisters on unmount or engine rebuild.
  useEffect(() => {
    setActiveIntelligenceEngine(engine);
    return () => { setActiveIntelligenceEngine(null); };
  }, [engine]);

  // R-INTELLIGENCE-MANAGER-QUEUE-V1: reload queue when a new item is pushed.
  const reloadQueue = useCallback(() => { setQueueItems(getQueue()); }, []);

  useEffect(() => {
    window.addEventListener('cellhub:open-manager-review', reloadQueue);
    return () => window.removeEventListener('cellhub:open-manager-review', reloadQueue);
  }, [reloadQueue]);

  // R-INTELLIGENCE-AUTO-RESOLUTION-V1: silently resolve queue items whose
  // underlying operational issue has cleared. Runs after each data update —
  // no notifications, no popups. reloadQueue() fires only when items actually
  // changed (count > 0) to avoid a spurious state update on every render.
  useEffect(() => {
    const resolved = engine.runAutoResolution();
    if (resolved > 0) reloadQueue();
  }, [engine, sales, repairs, layaways, inventory, reloadQueue]); // eslint-disable-line react-hooks/exhaustive-deps

  // R-INTELLIGENCE-FEEDBACK-LOOP-V1: scoreMap rebuilt whenever feedback changes.
  // O(n) over feedback events — fast for < 1000 entries.
  const feedbackScoreMap = useMemo(() => buildScoreMap(getFeedbackEvents()), [feedbackVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Low-level feedback writer — bumps version so scoreMap and sort re-evaluate.
  const writeFeedback = useCallback((item: ManagerQueueItem, type: IntelligenceFeedbackType) => {
    addFeedbackEvent({ queueItemId: item.id, fingerprint: item.fingerprint, type });
    setFeedbackVersion(v => v + 1);
  }, []);

  // Queue action callbacks — all accept full item (fingerprint needed for feedback).
  const handleQueueApprove = useCallback((item: ManagerQueueItem) => {
    approveQueueItem(item.id);
    // R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1: advancing the queue item = operator
    // acted on the recommendation → advance the workflow to the next step.
    if (item.workflowId) advanceWorkflowStep(item.workflowId);
    writeFeedback(item, 'useful');   // auto-signal: approved = useful
    setQueueItems(getQueue());
  }, [writeFeedback]);

  const handleQueueDismiss = useCallback((item: ManagerQueueItem) => {
    dismissQueueItem(item.id);
    setQueueItems(getQueue());
    // No auto-feedback on dismiss — neutral, operator may dismiss for any reason.
  }, []);

  const handleQueueResolve = useCallback((item: ManagerQueueItem) => {
    resolveQueueItem(item.id);
    writeFeedback(item, 'resolved'); // auto-signal: resolved = strong positive
    setQueueItems(getQueue());
  }, [writeFeedback]);

  // R-INTELLIGENCE-QUEUE-DEDUP-NAVIGATION-V1 + R-INTELLIGENCE-FEEDBACK-LOOP-V1:
  // navigation reuses existing CustomEvents; opening entity = implicit useful signal.
  const handleQueueOpen = useCallback((item: ManagerQueueItem) => {
    if (!item.entityId || !item.entityType) return;
    switch (item.entityType) {
      case 'repair':
        window.dispatchEvent(new CustomEvent('cellhub:open-repair',         { detail: { repairId:   item.entityId } })); break;
      case 'customer':
        window.dispatchEvent(new CustomEvent('cellhub:open-customer',       { detail: { customerId: item.entityId } })); break;
      case 'layaway':
        window.dispatchEvent(new CustomEvent('cellhub:open-layaway',        { detail: { layawayId:  item.entityId } })); break;
      case 'inventory':
        window.dispatchEvent(new CustomEvent('cellhub:open-inventory-item', { detail: { itemId:     item.entityId } })); break;
      default: break;
    }
    writeFeedback(item, 'useful');   // auto-signal: navigating to entity = useful
  }, [writeFeedback]);

  // Explicit feedback buttons — operator-driven signals.
  const handleFeedbackUseful    = useCallback((item: ManagerQueueItem) => { writeFeedback(item, 'useful'); },    [writeFeedback]);
  const handleFeedbackNotUseful = useCallback((item: ManagerQueueItem) => { writeFeedback(item, 'not_useful'); },[writeFeedback]);
  const handleFeedbackSnooze    = useCallback((item: ManagerQueueItem) => {
    snoozeQueueItem(item.id);
    writeFeedback(item, 'snoozed'); // snoozed = mild negative signal
    setQueueItems(getQueue());
  }, [writeFeedback]);

  // Derived pending list — scoreMap fed into sort comparator.
  const pendingQueueItems = useMemo(
    () => getPendingItems(queueItems, feedbackScoreMap),
    [queueItems, feedbackScoreMap],
  );
  const queueSummary = useMemo(
    () => getQueueSummary(queueItems, feedbackScoreMap),
    [queueItems, feedbackScoreMap],
  );
  const QUEUE_PREVIEW = 5;
  const visibleQueueItems = showAllQueue ? pendingQueueItems : pendingQueueItems.slice(0, QUEUE_PREVIEW);

  // R-OPERATOR-STABILIZATION-AUDIT-V1: deps now include the full set of
  // collections updateData() propagates (added expenses/employees/appointments)
  // plus refreshKey. refreshKey is the explicit "force re-analyze" signal from
  // the Refresh button — combined with engine.invalidateCache() in the handler,
  // this re-runs analyze() against fresh data without rebuilding the engine.
  const result: EngineResult = useMemo(
    () => perfTime('intel.module.engine.analyze', () => engine.analyze()),
    [engine, sales, customers, inventory, repairs, specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, refreshKey],
  );

  // ── Engine-derived data ──────────────────────────────────
  // R-OPERATOR-STABILIZATION-AUDIT-V1: include `result` in deps so these
  // getters invalidate when analyze() reruns (engine internals refreshed).
  // Without this, after Bug #1 fix the engine ref is stable across refresh,
  // so [engine] alone would never re-trigger the getters.
  const reorderRecs  = useMemo(() => perfTime('intel.module.getReorderRecommendations', () => engine.getReorderRecommendations()), [engine, result]);
  const productOpps  = useMemo(() => perfTime('intel.module.getProductOpportunities',   () => engine.getProductOpportunities(3)), [engine, result]);
  const missedRev    = useMemo(() => perfTime('intel.module.getMissedRevenue',          () => engine.getMissedRevenue()), [engine, result]);

  const todaySales = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return sales.filter(s => new Date((s as any).createdAt).getTime() >= todayStart.getTime() && (s as any).status !== 'voided');
  }, [sales]);
  const todayRevenue = useMemo(() => todaySales.reduce((sum, s) => sum + ((s as any).total || 0), 0), [todaySales]);

  const biggestLeak = useMemo(() =>
    Math.max(missedRev.slowDayLossCents, missedRev.slowHourLossCents, missedRev.deadStockLockedCents),
  [missedRev]);

  // R-INTELLIGENCE-LIVE-OPERATOR-CARDS-V1: lightweight derived stats for
  // the 6 operator cards. Pure useMemo over already-in-scope state — no
  // new effects, no polling, no background. Same threshold logic the
  // chat handlers use (handleProactiveOpportunities, today_money_map).
  const staleRepairStats = useMemo(() => perfTime('intel.module.cards.staleRepairStats', () => {
    const PICKUP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let count = 0;
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
      count++;
      recoverable += (r as { balance?: number }).balance || 0;
    }
    return { count, recoverable };
  }), [repairs]);

  // R-OPERATOR-STABILIZATION-AUDIT-V1: include `result` so refresh invalidates
  // this — buildOutreachQueueItems reads cachedResult.customerScores populated
  // by analyze().
  const outreachCount = useMemo(() => perfTime('intel.module.cards.outreachCount', () => {
    try { return engine.buildOutreachQueueItems().length; }
    catch { return 0; }
  }), [engine, result]);

  const topInsight = useMemo(() => {
    const localDay = DAY_LOCAL[locale]?.[missedRev.slowestDayName] ?? missedRev.slowestDayName;
    if (missedRev.slowDayLossCents > 0)
      return t('intelligence.dash.insightSlowDay', localDay, formatCurrency(missedRev.slowDayLossCents));
    const risky = reorderRecs.find(r => r.lostRevenueRiskCents > 0);
    if (risky)
      return t('intelligence.dash.insightReorder', risky.name, formatCurrency(risky.lostRevenueRiskCents));
    return t('intelligence.dash.insightAllGood');
  }, [missedRev, reorderRecs, locale, t]);

  // R-INTELLIGENCE-REFRESH-FREEZE-QUEUE-CLEANUP-REPAIR-INTENT-FIX +
  // R-OPERATOR-STABILIZATION-AUDIT-V1: wrap refresh work in useTransition so
  // the heavy memo cascade happens off the urgent render path. Button is
  // disabled while pending so the owner can't stack work. Refresh now
  // invalidates the engine's analyze() cache (cheap — two assignments)
  // instead of rebuilding the engine instance; the refreshKey bump only
  // exists to invalidate the result memo dep.
  const [isRefreshing, startRefreshTransition] = useTransition();
  const handleRefresh = useCallback(() => {
    if (isRefreshing) return;
    engineRef.current?.invalidateCache();
    startRefreshTransition(() => setRefreshKey((k) => k + 1));
  }, [isRefreshing]);
  const matches = useMemo(() => {
    const q = lookupQuery.trim();
    if (q.length < 2) return [];
    return customers
      .filter(c => matchesSearch(q, c.name, c.phone, (c as { customerNumber?: string }).customerNumber))
      .slice(0, 8);
  }, [lookupQuery, customers]);

  const history: CustomerHistorySummary | null = useMemo(() => {
    if (!selectedCustomerId) return null;
    return engine.getCustomerHistory(selectedCustomerId);
  }, [engine, selectedCustomerId]);

  // Product matches for Promote Inventory
  const productMatches = useMemo(() => {
    const q = productSearch.trim();
    if (q.length < 2) return [];
    return inventory
      .filter(i =>
        matchesSearch(q, i.name, i.sku, (i as { brand?: string }).brand)
        && (i as { qty?: number }).qty !== 0,
      )
      .slice(0, 8);
  }, [productSearch, inventory]);

  // Fire a chat query (uses externalQuery seq pattern already wired in chat).
  const fireChat = useCallback((text: string) => {
    setExternalQuery({ text, seq: Date.now() });
  }, []);

  const fireChipKey = useCallback((queryKey: string) => {
    fireChat(t(queryKey));
  }, [t, fireChat]);

  // R-DAILY-BRIEF-AUTO-V1: fire the daily brief once per store per day.
  // Read-only — handler does not enqueue. Storage key scoped by storeId so
  // multi-store operators see the brief once per shop. Failures (incognito,
  // quota) silently skip; brief stays manually accessible via the chat.
  // R-INTELLIGENCE-AUTOMATION-QUEUE-FAIL-FREEZE-FIX: deferred via
  // setTimeout(0) so the heavy synchronous chain (fireChat → externalQuery
  // → classifyIntent → handleIntent → engine analyze) runs AFTER the tab's
  // first paint instead of blocking the mount.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const sid = currentStoreId || 'default';
    const key = `dailyBriefLastSeen:${sid}:${today}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      return;
    }
    const tid = window.setTimeout(() => {
      try {
        fireChat('daily brief');
        localStorage.setItem(key, '1');
      } catch {
        /* localStorage unavailable — skip silently. */
      }
    }, 0);
    return () => window.clearTimeout(tid);
  }, [currentStoreId, fireChat]);

  // Refs to scroll-target panels
  const promoteRef = useRef<HTMLDivElement>(null);
  const focusPromote = useCallback(() => {
    promoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // R-OPERATOR-EXECUTABLE-ACTIONS-V1: hand-off callback for chat-action
  // "Promote {name}" clicks. Auto-selects the exact product (productId is
  // the real inventory id from ProductOpportunity.inventoryId, not a
  // string-matched reconstruction), clears the search field so the
  // confirmation card renders immediately, and scrolls the panel into
  // view. No chat-replay, no manual product search step.
  // R-OPERATOR-PROMOTE-AUTO-PREPARE-V1: also auto-fires the campaign chat
  // query so the user doesn't have to click "Generate Campaign" — the
  // draft (per-customer WhatsApp messages with action buttons, OR the
  // broad-campaign fallback text) appears immediately in the chat
  // sidebar. The chat handler is the same one used when the user types
  // "promote {name}" manually, so behavior is unified. The 500ms chat
  // dedup guard already prevents accidental double-fire on rapid clicks.
  // R-OPERATOR-PROMOTE-EXECUTION-FIX-V1: only reset panel-side draft state
  // when the user is switching to a DIFFERENT product. Previously we cleared
  // panelCampaign/draftMessage/recipient unconditionally — combined with the
  // chat dedup early-return (now fixed), a re-clicked Promote on the same
  // product wiped panel state and never repopulated it. With this guard,
  // re-clicking the same Promote button is a safe no-op for panel state
  // (the chat re-fire will still run, but the existing draft survives if
  // the dispatch is dedup'd).
  const handleOpenPromote = useCallback((productId: string, productName: string) => {
    setSelectedProduct((prev) => {
      if (!prev || prev.id !== productId) {
        // Different product (or first selection) — reset draft state.
        // R-CAMPAIGN-QUEUE-V1: also reset multi-select + queue so any
        // in-progress campaign for product A doesn't leak into product B.
        setPanelCampaign(null);
        setDraftMessage('');
        setSelectedRecipientIds(new Set());
        setCampaignQueue([]);
      }
      return { id: productId, name: productName };
    });
    setProductSearch('');
    promoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fireChat(`${t('intelligence.console.queryPromoteThis')} ${productName}`);
  }, [fireChat, t]);

  // R-OPERATOR-PROMOTE-PANEL-PREVIEW-V1: callback invoked by IntelligenceChat
  // when a chat response carries panelCampaign. Stash the draft + seed the
  // local textarea content. If the panel currently shows a different
  // product than the draft references, ignore — draft belongs to a
  // different selection (defensive — in practice the auto-fire flow keeps
  // them aligned, but a manual chat query for a different product
  // shouldn't override the user's panel selection).
  const handlePanelCampaign = useCallback((draft: PanelCampaignDraft) => {
    if (selectedProduct && selectedProduct.id !== draft.productId) return;
    setPanelCampaign(draft);
    setDraftMessage(draft.templateMessage);
    // R-CAMPAIGN-QUEUE-V1: default-select every candidate so the
    // cashier can hit "Iniciar campaña" immediately. They can untick
    // anyone they don't want before starting. Empty candidates ⇒ no
    // selection (broadcast button shown instead, single-shot wa.me).
    setSelectedRecipientIds(new Set(draft.candidates.map((c) => c.customerId)));
    // Also clear any leftover queue from a prior product so we land
    // in pre-campaign mode for the freshly drafted campaign.
    setCampaignQueue([]);
  }, [selectedProduct]);

  // R-CAMPAIGN-QUEUE-V1: per-recipient send is now handled by
  // sendCurrentRecipient (queue-driven). The legacy handlePanelSend
  // single-shot has been removed; broadcast (no-candidates path) still
  // uses handlePanelBroadcast below.

  // R-OPERATOR-PROMOTE-PANEL-PREVIEW-V1: broadcast send for the empty-
  // candidates case. Substitutes {customer} with empty string (the broad
  // template typically reads naturally with or without a name) and opens
  // the wa.me recipient picker.
  const handlePanelBroadcast = useCallback(() => {
    const finalText = draftMessage.replace(/\{customer\}/g, '').replace(/\s+/g, ' ').trim();
    const url = `https://wa.me/?text=${encodeURIComponent(finalText)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [draftMessage]);

  const handleGenerateCampaign = useCallback(() => {
    if (!selectedProduct) return;
    fireChat(`${t('intelligence.console.queryPromoteThis')} ${selectedProduct.name}`);
  }, [selectedProduct, fireChat, t]);

  // ── R-CAMPAIGN-QUEUE-V1: queue + persistence ──────────────
  // The current pending recipient drives the single primary action
  // button while the campaign is in flight. Derived from the queue —
  // first item with status 'pending'. null when no queue or all done.
  const currentRecipient = useMemo(
    () => campaignQueue.find((q) => q.status === 'pending') || null,
    [campaignQueue],
  );
  const queueProcessedCount = useMemo(
    () => campaignQueue.filter((q) => q.status !== 'pending').length,
    [campaignQueue],
  );
  const inCampaign = campaignQueue.length > 0;
  const allDone = inCampaign && !currentRecipient;

  // Toggle one recipient in the pre-campaign multi-select.
  const toggleRecipient = useCallback((id: string) => {
    setSelectedRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Bulk select / deselect all candidates.
  const toggleAllRecipients = useCallback(() => {
    if (!panelCampaign) return;
    setSelectedRecipientIds((prev) => {
      if (prev.size === panelCampaign.candidates.length) return new Set();
      return new Set(panelCampaign.candidates.map((c) => c.customerId));
    });
  }, [panelCampaign]);

  // Build the queue from selected recipients and switch into in-campaign UI.
  const startCampaign = useCallback(() => {
    if (!panelCampaign) return;
    if (selectedRecipientIds.size === 0) return;
    if (!draftMessage.trim()) return;
    const items: CampaignQueueItem[] = panelCampaign.candidates
      .filter((c) => selectedRecipientIds.has(c.customerId))
      .map((c) => ({
        customerId: c.customerId,
        name: c.name,
        phone: c.phone,
        status: 'pending',
      }));
    setCampaignQueue(items);
  }, [panelCampaign, selectedRecipientIds, draftMessage]);

  // Open wa.me for the current recipient and mark them as 'sent'.
  // The cashier still has to press Send inside WhatsApp — wa.me has no
  // autonomous delivery. "Sent" here means "we opened the wa.me link
  // for this contact"; the cashier can re-open from history if needed.
  const sendCurrentRecipient = useCallback(() => {
    if (!currentRecipient) return;
    const firstName = currentRecipient.name.split(' ')[0] || currentRecipient.name;
    const finalText = draftMessage.replace(/\{customer\}/g, firstName);
    const url = currentRecipient.phone
      ? buildWhatsAppUrl(currentRecipient.phone, finalText)
      : `https://wa.me/?text=${encodeURIComponent(finalText)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setCampaignQueue((prev) =>
      prev.map((q) => (q.customerId === currentRecipient.customerId ? { ...q, status: 'sent' } : q)),
    );
  }, [currentRecipient, draftMessage]);

  // Skip current recipient without opening WhatsApp.
  const skipCurrentRecipient = useCallback(() => {
    if (!currentRecipient) return;
    setCampaignQueue((prev) =>
      prev.map((q) => (q.customerId === currentRecipient.customerId ? { ...q, status: 'skipped' } : q)),
    );
  }, [currentRecipient]);

  // End the campaign and return to the pre-campaign UI. Clears the
  // queue + selection so a fresh campaign starts from scratch (the
  // panel still shows the same product/draft so the user can adjust
  // selection and re-run if needed).
  const endCampaign = useCallback(() => {
    setCampaignQueue([]);
    if (panelCampaign) {
      setSelectedRecipientIds(new Set(panelCampaign.candidates.map((c) => c.customerId)));
    }
  }, [panelCampaign]);

  // Persistence — only while a campaign is in flight. Pre-campaign
  // selections are intentionally NOT persisted (low value, more state
  // to invalidate). Storage key namespaced so it can't collide.
  const CAMPAIGN_STORAGE_KEY = 'cellhub_pro_campaign_session_v1';
  useEffect(() => {
    if (!inCampaign || !selectedProduct || !panelCampaign) {
      try { localStorage.removeItem(CAMPAIGN_STORAGE_KEY); } catch {}
      return;
    }
    try {
      localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify({
        selectedProduct,
        panelCampaign,
        draftMessage,
        queue: campaignQueue,
      }));
    } catch {}
  }, [inCampaign, selectedProduct, panelCampaign, draftMessage, campaignQueue]);

  // Restore on mount — guarded so this only fires once and only if the
  // panel has no campaign in memory yet (first paint).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(CAMPAIGN_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        selectedProduct?: { id: string; name: string };
        panelCampaign?: PanelCampaignDraft;
        draftMessage?: string;
        queue?: CampaignQueueItem[];
      };
      if (
        !saved.selectedProduct?.id ||
        !saved.panelCampaign?.productId ||
        !Array.isArray(saved.queue) ||
        saved.queue.length === 0
      ) return;
      setSelectedProduct(saved.selectedProduct);
      setPanelCampaign(saved.panelCampaign);
      setDraftMessage(saved.draftMessage || saved.panelCampaign.templateMessage || '');
      setCampaignQueue(saved.queue);
    } catch {
      // Corrupt storage — drop it.
      try { localStorage.removeItem(CAMPAIGN_STORAGE_KEY); } catch {}
    }
  }, []);

  // R-INTELLIGENCE-LIVE-OPERATING-ASSISTANT-V1 ──────────────────────────────
  const lastInteractionAtRef = useRef(Date.now());
  const [liveSuggestion, setLiveSuggestion] = useState<LiveAssistSuggestion | null>(null);

  // Computed once per mount: is this the first time Intelligence is opened today?
  const isFirstOpenTodayRef = useRef<boolean | null>(null);
  if (isFirstOpenTodayRef.current === null) {
    const key = `cellhub:intelligenceOpenToday:${new Date().toISOString().slice(0, 10)}`;
    try {
      isFirstOpenTodayRef.current = !localStorage.getItem(key);
      if (isFirstOpenTodayRef.current) localStorage.setItem(key, '1');
    } catch {
      isFirstOpenTodayRef.current = false;
    }
  }
  const isFirstOpenToday = isFirstOpenTodayRef.current ?? false;

  // Track idle time via document events.
  useEffect(() => {
    const update = () => { lastInteractionAtRef.current = Date.now(); };
    document.addEventListener('mousemove', update, { passive: true });
    document.addEventListener('keydown',   update, { passive: true });
    document.addEventListener('click',     update, { passive: true });
    return () => {
      document.removeEventListener('mousemove', update);
      document.removeEventListener('keydown',   update);
      document.removeEventListener('click',     update);
    };
  }, []);

  // Poll for live assist suggestion every 2 minutes (also fires on mount).
  useEffect(() => {
    const check = () => {
      const context: LiveAssistContext = {
        idleMs:           Date.now() - lastInteractionAtRef.current,
        modalOpen:        false,
        isFirstOpenToday,
      };
      setLiveSuggestion(engine.getLiveAssistSuggestion(context));
    };
    check();
    const id = window.setInterval(check, 2 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [engine, isFirstOpenToday]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLiveAction = useCallback((s: LiveAssistSuggestion) => {
    setLiveSuggestion(null);
    switch (s.action.type) {
      case 'open_manager_queue':
        queueSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'open_execution_queue':
        fireChat('execution queue');
        break;
      case 'open_morning_digest':
        fireChat('morning digest');
        break;
      case 'open_entity':
        if (s.action.entityType && s.action.entityId) {
          const evtMap: Record<string, string> = {
            repair:    'cellhub:open-repair',
            customer:  'cellhub:open-customer',
            layaway:   'cellhub:open-layaway',
            inventory: 'cellhub:open-inventory-item',
          };
          const keyMap: Record<string, string> = {
            repair: 'repairId', customer: 'customerId', layaway: 'layawayId', inventory: 'itemId',
          };
          const evtName = evtMap[s.action.entityType];
          const detailKey = keyMap[s.action.entityType];
          if (evtName && detailKey) {
            window.dispatchEvent(new CustomEvent(evtName, { detail: { [detailKey]: s.action.entityId } }));
          }
        }
        break;
      case 'open_intelligence':
      default:
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
    }
  }, [fireChat]);

  const handleLiveDismiss = useCallback((_s: LiveAssistSuggestion) => {
    setLiveSuggestion(null);
  }, []);
  // ── end live assist ──────────────────────────────────────────────────────────

  const kpi = result.kpiDashboard;
  const totalAlerts = kpi.inventory.lowStockCount + kpi.repairs.overdue;

  // R-INTELLIGENCE-PERFORMANCE-AUDIT-V1: total render-prep cost for the
  // module. JSX construction itself is React-internal and not measured
  // here — only the synchronous work above (engine + memos + cards).
  if (INTEL_PERF_ENABLED) perfLog('intel.module.render.total', _renderT0);

  return (
    <div className="space-y-3 p-3 pb-8" style={{ background: PAGE_BG, minHeight: '100%' }}>

      {/* ── 1. TOP OPERATOR SUMMARY ─────────────────────────── */}
      <div
        className="rounded-lg border px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 justify-between"
        style={{ background: CARD_BG, borderColor: CARD_BORDER }}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[10px] font-semibold text-slate-500 tracking-widest">
            {t('intelligence.console.todayLabel')}
          </span>
          <span className="text-base font-bold text-emerald-400">
            {formatCurrency(todayRevenue)} <span className="text-xs font-normal text-slate-500">{t('intelligence.console.salesAbbr')}</span>
          </span>
          <span className="text-sm text-slate-300">
            {todaySales.length} <span className="text-xs text-slate-500">{t('intelligence.console.ordersAbbr')}</span>
          </span>
          <span className={`text-sm ${totalAlerts > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {totalAlerts} <span className="text-xs text-slate-500">{t('intelligence.console.alertsAbbr')}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t('intelligence.console.biggestOpportunity')}</span>
          <span className="text-xs font-medium text-purple-300">
            {productOpps.length > 0
              ? t(
                  'intelligence.console.opportunitiesFound',
                  productOpps.length,
                  formatCurrency(productOpps.reduce((s, o) => s + o.impactCents, 0)),
                )
              : (biggestLeak > 0 ? topInsight : t('intelligence.dash.noneYet'))
            }
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConsoleBtn label={t('intelligence.console.collectPayments')} accent="#10B981"
            onClick={() => fireChipKey('intelligence.console.queryContactToday')} />
          <ConsoleBtn label={t('intelligence.console.promoteProduct')} accent="#8B5CF6"
            onClick={focusPromote} />
          <ConsoleBtn label={t('intelligence.console.contactCustomers')} accent="#3B82F6"
            onClick={() => fireChipKey('intelligence.console.queryContactToday')} />
        </div>
      </div>

      {/* ── 2. OPERATIONAL CARDS (LEFT) + CHAT PANEL (RIGHT) ──
          R-INTELLIGENCE-OPERATOR-UX-V1: redesigned to a Quick-Actions-
          inspired command-center hierarchy. 6 large action cards
          dominate the left; chat lives in a narrower right sidebar so
          it supports operations instead of dominating the viewport.
          All firing actions reuse the existing fireChat / focusPromote
          callbacks — no intelligence logic changed. */}
      <div className="grid grid-cols-12 gap-3">

        {/* LEFT: Operational cards grid */}
        <div className="col-span-12 lg:col-span-8">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
            {t('intelligence.console.makeMoneyTitle')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <OpCard
              icon="💰"
              title={t('intelligence.console.collectMoneyTitle')}
              description={t('intelligence.console.collectMoneySub')}
              stat={
                staleRepairStats.recoverable >= 2000
                  ? formatCurrency(staleRepairStats.recoverable)
                  : missedRev.deadStockLockedCents > 0
                    ? formatCurrency(missedRev.deadStockLockedCents)
                    : undefined
              }
              accent="#10B981"
              onClick={() => fireChat('where is money stuck')}
            />
            <OpCard
              icon="🤝"
              title={t('intelligence.console.closeDealsTitle')}
              description={t('intelligence.console.closeDealsSub')}
              accent="#22C55E"
              onClick={() => fireChat('help me close sales today')}
            />
            <OpCard
              icon="🚀"
              title={t('intelligence.console.promoteProduct')}
              description={t('intelligence.console.promoteSub')}
              stat={productOpps.length > 0 ? String(productOpps.length) : undefined}
              accent="#8B5CF6"
              onClick={focusPromote}
            />
            <OpCard
              icon="📞"
              title={t('intelligence.console.contactCustomers')}
              description={t('intelligence.console.contactSub')}
              stat={outreachCount >= 2 ? String(outreachCount) : undefined}
              accent="#3B82F6"
              onClick={() => fireChipKey('intelligence.console.queryContactToday')}
            />
            <OpCard
              icon="🔧"
              title={t('intelligence.console.repairsReadyTitle')}
              description={t('intelligence.console.repairsReadySub')}
              stat={
                kpi.repairs.pending > 0
                  ? (staleRepairStats.count > 0
                      ? `${kpi.repairs.pending} · ${staleRepairStats.count} ${t('intelligence.console.staleLabel')}`
                      : String(kpi.repairs.pending))
                  : undefined
              }
              accent="#F59E0B"
              onClick={() => fireChipKey('intelligence.console.queryReadyRepairs')}
            />
            <OpCard
              icon="💸"
              title={t('intelligence.console.fixProfitTitle')}
              description={t('intelligence.console.fixProfitSub')}
              stat={biggestLeak > 0 ? formatCurrency(biggestLeak) : undefined}
              accent="#EF4444"
              onClick={() => fireChipKey('intelligence.dash.quickProfit')}
            />
          </div>
        </div>

        {/* RIGHT: Chat sidebar — narrower assistant panel */}
        <div className="col-span-12 lg:col-span-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
            {t('intelligence.console.askTitle')}
          </p>
          <IntelligenceChat engine={engine} customers={customers} lang={apiLang} externalQuery={externalQuery} onOpenPromote={handleOpenPromote} onPanelCampaign={handlePanelCampaign} />
        </div>
      </div>

      {/* ── 3. MANAGER QUEUE ─────────────────────────────────────────────── */}
      <div
        ref={queueSectionRef}
        className="rounded-lg border p-3"
        style={{ background: CARD_BG, borderColor: CARD_BORDER }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              📋 {t('mq.sectionTitle')}
            </span>
            {queueSummary.totalPending > 0 && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{
                  background: queueSummary.critical > 0 ? '#EF444422' : queueSummary.high > 0 ? '#F59E0B22' : '#6B728022',
                  color: queueSummary.critical > 0 ? '#EF4444' : queueSummary.high > 0 ? '#F59E0B' : '#9CA3AF',
                  border: `1px solid ${queueSummary.critical > 0 ? '#EF444444' : queueSummary.high > 0 ? '#F59E0B44' : '#374151'}`,
                }}
              >
                {t('mq.pendingCount', queueSummary.totalPending)}
              </span>
            )}
          </div>
          <button
            onClick={() => fireChat(t('mq.sectionTitle'))}
            className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-300 hover:border-slate-500 transition"
          >
            {locale === 'es' ? 'Ver en chat' : locale === 'pt' ? 'Ver no chat' : 'Ask AI'}
          </button>
        </div>

        {queueSummary.totalPending === 0 ? (
          <p className="text-xs text-slate-500 italic py-2">{t('mq.emptyState')}</p>
        ) : (
          <>
            <div className="space-y-2">
              {visibleQueueItems.map((item) => (
                <QueueCard
                  key={item.id}
                  item={item}
                  lang={locale as 'en' | 'es' | 'pt'}
                  onApprove={handleQueueApprove}
                  onDismiss={handleQueueDismiss}
                  onResolve={handleQueueResolve}
                  onOpen={handleQueueOpen}
                  onFeedbackUseful={handleFeedbackUseful}
                  onFeedbackNotUseful={handleFeedbackNotUseful}
                  onFeedbackSnooze={handleFeedbackSnooze}
                />
              ))}
            </div>
            {pendingQueueItems.length > QUEUE_PREVIEW && (
              <button
                onClick={() => setShowAllQueue(v => !v)}
                className="mt-2 text-[11px] text-slate-400 hover:text-slate-300 transition"
              >
                {showAllQueue
                  ? t('mq.showLess')
                  : t('mq.showAll', pendingQueueItems.length)}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── 4. SECONDARY TOOLS (Promote Inventory + Customer Lookup below) ── */}
      <div className="grid grid-cols-12 gap-3">

        {/* Promote Inventory */}
        <div ref={promoteRef} className="col-span-12 lg:col-span-6 rounded-lg border p-3"
          style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            {t('intelligence.console.promoteInvTitle')}
          </p>
          {!selectedProduct ? (
            <div>
              <input
                type="text"
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                placeholder={t('intelligence.console.searchProduct')}
                className="w-full bg-surface-700 text-slate-200 rounded px-3 py-2 text-sm border border-surface-600 focus:outline-none focus:border-purple-500"
              />
              {productMatches.length > 0 ? (
                <div className="mt-2 rounded border border-surface-700 divide-y divide-surface-700 max-h-44 overflow-y-auto">
                  {productMatches.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProduct({ id: p.id, name: p.name }); setProductSearch(''); }}
                      className="w-full text-left px-3 py-2 hover:bg-surface-700 transition"
                    >
                      <div className="text-sm text-slate-200 font-medium truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-500 flex gap-3">
                        <span>SKU {p.sku}</span>
                        {(p as { qty?: number }).qty !== undefined && <span>Qty {(p as { qty?: number }).qty}</span>}
                        {(p as { price?: number }).price !== undefined && <span>{formatCurrency((p as { price?: number }).price ?? 0)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : productSearch.trim().length < 2 ? (
                <p className="text-[11px] text-slate-500 italic mt-2">{t('intelligence.console.promoteInvEmpty')}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {/* ── 1. PRODUCT / STRATEGY SUMMARY (top) ────────────────── */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-purple-500/30 bg-purple-500/5">
                <div className="min-w-0">
                  <div className="text-sm text-slate-100 font-medium truncate">{selectedProduct.name}</div>
                  {/* R-OPERATOR-PROMOTE-WORKSPACE-HIERARCHY-V1: strategy line
                      derived from candidates — targeted vs broad. Pure read,
                      no scan. */}
                  {panelCampaign && panelCampaign.productId === selectedProduct.id && (
                    <div className="text-[11px] text-purple-300 mt-0.5">
                      {panelCampaign.candidates.length > 0
                        ? t('intelligence.console.campaignStrategyTargeted', panelCampaign.candidates.length)
                        : t('intelligence.console.campaignStrategyBroad')}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setSelectedProduct(null);
                    setPanelCampaign(null);
                    setDraftMessage('');
                    // R-CAMPAIGN-QUEUE-V1: also clear queue + selection
                    // so a fresh product start lands in pre-campaign mode.
                    setSelectedRecipientIds(new Set());
                    setCampaignQueue([]);
                  }}
                  className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:bg-surface-600 shrink-0"
                >
                  {t('intelligence.console.changeProduct')}
                </button>
              </div>

              {/* ── 2. NO-CAMPAIGN STATE: manual generate fallback ─────── */}
              {(!panelCampaign || panelCampaign.productId !== selectedProduct.id) && (
                <button
                  onClick={handleGenerateCampaign}
                  className="w-full px-3 py-2 rounded text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white transition"
                >
                  🚀 {t('intelligence.console.generateCampaign')}
                </button>
              )}

              {/* ── 3. CAMPAIGN WORKSPACE ──────────────────────────────
                  R-OPERATOR-PROMOTE-WORKSPACE-HIERARCHY-V1: selectable rows
                  (no per-row buttons), single primary action at the bottom.
                  Layout order matches spec: textarea → recipients → action. */}
              {panelCampaign && panelCampaign.productId === selectedProduct.id && (
                <>
                  {/* 3a. Campaign draft textarea (center) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        {t('intelligence.console.campaignDraftTitle')}
                      </span>
                      {draftMessage !== panelCampaign.templateMessage && (
                        <span className="text-[10px] text-amber-400">
                          {t('intelligence.console.campaignEditedHint')}
                        </span>
                      )}
                    </div>
                    <textarea
                      value={draftMessage}
                      onChange={(e) => setDraftMessage(e.target.value)}
                      rows={4}
                      className="w-full bg-surface-700 text-slate-200 rounded px-3 py-2 text-xs border border-surface-600 focus:outline-none focus:border-purple-500 font-mono leading-relaxed"
                      placeholder={t('intelligence.console.campaignDraftPlaceholder')}
                    />
                    <p className="text-[10px] text-slate-500 italic">
                      {t('intelligence.console.campaignSubstitutionHint')}
                    </p>
                  </div>

                  {/* 3b. Recipients — R-CAMPAIGN-QUEUE-V1: pre-campaign
                      shows multi-select checkboxes with a "select-all"
                      header; in-campaign shows the queue with per-item
                      status icons. Switching modes is driven entirely
                      by `inCampaign` (campaignQueue.length > 0). */}
                  {panelCampaign.candidates.length > 0 && !inCampaign && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-slate-400">
                          {t('intelligence.console.campaignRecipientsLabel', panelCampaign.candidates.length)}
                        </p>
                        <button
                          type="button"
                          onClick={toggleAllRecipients}
                          className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-surface-600"
                        >
                          {selectedRecipientIds.size === panelCampaign.candidates.length
                            ? t('intelligence.console.campaignDeselectAll')
                            : t('intelligence.console.campaignSelectAll')}
                        </button>
                      </div>
                      <div className="rounded border border-surface-700 divide-y divide-surface-700 overflow-hidden">
                        {panelCampaign.candidates.map((c) => {
                          const isSelected = selectedRecipientIds.has(c.customerId);
                          const confidenceClass = c.confidence === 'high'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : c.confidence === 'medium'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-slate-500/20 text-slate-400';
                          const confidenceLabel = c.confidence === 'high'
                            ? t('intelligence.console.confidenceHigh')
                            : c.confidence === 'medium'
                              ? t('intelligence.console.confidenceMedium')
                              : t('intelligence.console.confidenceLow');
                          return (
                            <button
                              key={c.customerId}
                              type="button"
                              onClick={() => toggleRecipient(c.customerId)}
                              className={`w-full text-left flex items-center gap-2 px-3 py-2 transition ${
                                isSelected ? 'bg-purple-500/10' : 'hover:bg-surface-700'
                              }`}
                            >
                              {/* Checkbox-style indicator */}
                              <span
                                className={`w-4 h-4 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center text-[10px] leading-none ${
                                  isSelected ? 'border-purple-400 bg-purple-500 text-white' : 'border-slate-500'
                                }`}
                                aria-hidden
                              >
                                {isSelected ? '✓' : ''}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className={`text-sm truncate ${isSelected ? 'text-purple-200 font-medium' : 'text-slate-200'}`}>
                                  {c.name}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono truncate">{c.phone}</div>
                                {c.reasonKey && (
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[11px] text-slate-400 truncate">
                                      💡 {t(c.reasonKey, c.reasonArg)}
                                    </span>
                                    {c.confidence && (
                                      <span className={`px-1.5 py-0 text-[9px] font-bold rounded shrink-0 ${confidenceClass}`}>
                                        {confidenceLabel}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 3b'. In-campaign queue view — progress + status list. */}
                  {inCampaign && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-slate-400">
                        {t('intelligence.console.campaignProgressLabel', queueProcessedCount, campaignQueue.length)}
                      </p>
                      <div className="rounded border border-surface-700 divide-y divide-surface-700 overflow-hidden max-h-56 overflow-y-auto">
                        {campaignQueue.map((q) => {
                          const isCurrent = q.status === 'pending' && currentRecipient?.customerId === q.customerId;
                          const icon = q.status === 'sent' ? '✅'
                            : q.status === 'skipped' ? '⏭️'
                            : isCurrent ? '👉'
                            : '⏳';
                          return (
                            <div
                              key={q.customerId}
                              className={`flex items-center gap-2 px-3 py-2 ${
                                isCurrent ? 'bg-emerald-500/10' : ''
                              }`}
                            >
                              <span className="text-base shrink-0" aria-hidden>{icon}</span>
                              <div className="min-w-0 flex-1">
                                <div className={`text-sm truncate ${
                                  q.status === 'sent' ? 'text-emerald-300'
                                  : q.status === 'skipped' ? 'text-slate-500 line-through'
                                  : isCurrent ? 'text-emerald-200 font-medium'
                                  : 'text-slate-300'
                                }`}>
                                  {q.name}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono truncate">{q.phone}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 3c. Action buttons — R-CAMPAIGN-QUEUE-V1
                      pre-campaign: "Iniciar campaña (N)"
                      in-campaign:  "Abrir WhatsApp con {nombre}" + skip + end
                      all-done:     "Cerrar campaña"
                      no candidates (broadcast):  unchanged single-shot wa.me */}
                  {panelCampaign.candidates.length === 0 ? (
                    <button
                      onClick={handlePanelBroadcast}
                      disabled={!draftMessage.trim()}
                      className="w-full px-3 py-2.5 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      📲 {t('intelligence.console.campaignBroadcastLabel')}
                    </button>
                  ) : !inCampaign ? (
                    <button
                      onClick={startCampaign}
                      disabled={!draftMessage.trim() || selectedRecipientIds.size === 0}
                      className="w-full px-3 py-2.5 rounded text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('intelligence.console.campaignSendTooltip')}
                    >
                      🚀 {t('intelligence.console.campaignStartLabel', selectedRecipientIds.size)}
                    </button>
                  ) : allDone ? (
                    <button
                      onClick={endCampaign}
                      className="w-full px-3 py-2.5 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition"
                    >
                      ✅ {t('intelligence.console.campaignDoneLabel')}
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      <button
                        onClick={sendCurrentRecipient}
                        className="w-full px-3 py-2.5 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition"
                      >
                        📲 {t('intelligence.console.campaignOpenWithLabel', currentRecipient?.name || '')}
                      </button>
                      <div className="flex gap-1.5">
                        <button
                          onClick={skipCurrentRecipient}
                          className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition"
                        >
                          ⏭️ {t('intelligence.console.campaignSkipLabel')}
                        </button>
                        <button
                          onClick={endCampaign}
                          className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-rose-700/70 hover:bg-rose-600/70 text-rose-100 transition"
                        >
                          ✋ {t('intelligence.console.campaignEndLabel')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Customer Lookup — sibling to Promote Inventory (same grid row) */}
        <div className="col-span-12 lg:col-span-6 rounded-lg p-4 border" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-200">🔍 {t('intelligence.customerHistory')}</h3>
              <p className="text-xs text-slate-400">{t('intelligence.searchPlaceholder')}</p>
          </div>
          {selectedCustomerId && (
            <button
              onClick={() => { setSelectedCustomerId(null); setLookupQuery(''); }}
              className="px-2 py-1 text-xs rounded bg-surface-700 hover:bg-surface-600 text-slate-300"
            >
              {t('intelligence.clear')}
            </button>
          )}
        </div>

        {!selectedCustomerId && (
          <div>
            <input
              type="text"
              value={lookupQuery}
              onChange={e => setLookupQuery(e.target.value)}
              placeholder={t('intelligence.searchPlaceholder')}
              className="w-full bg-surface-700 text-slate-200 rounded px-3 py-2 text-sm border border-surface-600 focus:outline-none focus:border-blue-500"
            />
            {matches.length > 0 && (
              <div className="mt-2 rounded border border-surface-700 divide-y divide-surface-700 max-h-64 overflow-y-auto">
                {matches.map(c => (
                  <button key={c.id} onClick={() => setSelectedCustomerId(c.id)}
                    className="w-full text-left px-3 py-2 hover:bg-surface-700 transition">
                    <div className="text-sm text-slate-200 font-medium">{c.name}</div>
                    <div className="text-xs text-slate-400 flex gap-3">
                      {c.phone && <span>📱 {c.phone}</span>}
                      {(c as { customerNumber?: string }).customerNumber && (
                        <span>#{(c as { customerNumber?: string }).customerNumber}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {lookupQuery.trim().length >= 2 && matches.length === 0 && (
              <div className="mt-2 text-xs text-slate-500 px-1">{t('intelligence.noMatches')}</div>
            )}
          </div>
        )}

          {history && <CustomerHistoryCard history={history} />}
        </div>
      </div>

      {/* Refresh button (bottom) */}
      <div className="flex justify-end">
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="text-xs px-3 py-1.5 rounded border border-surface-700 hover:border-surface-500 text-slate-400 hover:text-slate-300 transition disabled:opacity-50 disabled:cursor-wait"
        >
          🔄 {t('intelligence.refresh')}
        </button>
      </div>

      {/* ── LIVE OPERATOR BUBBLE ─────────────────────────────────────────────── */}
      <FloatingOperatorBubble
        suggestion={liveSuggestion}
        lang={locale as 'en' | 'es' | 'pt'}
        onAction={handleLiveAction}
        onDismiss={handleLiveDismiss}
      />
    </div>
  );
}

// ── Presentational sub-components ─────────────────────────────

// R-INTELLIGENCE-OPERATOR-UX-V1: large operational action card —
// Quick-Actions inspired. Action-first, optional stat, clear CTA.
// No animations, no shadows, no blur — lightweight transitions only.
function OpCard({
  icon, title, description, stat, accent, onClick,
}: {
  icon: string;
  title: string;
  description: string;
  stat?: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border p-4 hover:border-slate-500 transition-colors duration-150 active:scale-[0.99] w-full"
      style={{
        background: CARD_BG,
        borderColor: CARD_BORDER,
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-100 leading-snug">{title}</div>
          {stat && (
            <div className="text-lg font-bold mt-1" style={{ color: accent }}>{stat}</div>
          )}
          <div className="text-xs text-slate-400 mt-1 leading-snug">{description}</div>
        </div>
      </div>
    </button>
  );
}

function ConsoleBtn({ label, accent, onClick }: { label: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded text-xs font-semibold transition hover:opacity-90 active:scale-95"
      style={{ background: accent, color: '#0B1220' }}
    >
      {label}
    </button>
  );
}

function MoneyTile({ title, sub, accent, onClick }: { title: string; sub: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border p-3 hover:opacity-90 active:scale-[0.98] transition"
      style={{ background: CARD_BG, borderColor: accent + '55' }}
    >
      <p className="text-sm font-semibold" style={{ color: accent }}>{title}</p>
      <p className="text-[11px] text-slate-400 mt-1 leading-snug">{sub}</p>
    </button>
  );
}

function Chip({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-0.5 rounded-full text-[11px] font-medium transition hover:opacity-80 active:scale-95"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {label}
    </button>
  );
}

function WaBtn({ label, accent, onClick }: { label: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 rounded text-xs font-medium transition hover:opacity-90 active:scale-95 text-left"
      style={{ background: `${accent}1F`, color: accent, border: `1px solid ${accent}55` }}
    >
      {label}
    </button>
  );
}

// ── Customer History Card (unchanged from original) ────────────
interface CustomerHistoryCardProps { history: CustomerHistorySummary; }

function CustomerHistoryCard({ history }: CustomerHistoryCardProps) {
  const { locale, t } = useTranslation();
  const dateLoc = ({ en: 'en-US', es: 'es-MX', pt: 'pt-BR' } as Record<string, string>)[locale] ?? 'en-US';
  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString(dateLoc, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const lowCostCoverage = history.costCoverage < 0.5 && history.visitCount > 0;
  const summarySentence = summarizeCustomerHistory(history, locale as 'en' | 'es' | 'pt');

  return (
    <div className="space-y-4">
      <div className="border-t border-surface-700 pt-3 pb-1">
        <p className="text-sm text-slate-200 leading-relaxed bg-blue-500/5 border border-blue-500/20 rounded p-3">
          💬 {summarySentence}
        </p>
      </div>
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h4 className="text-xl font-bold text-slate-100">{history.customer.name}</h4>
            <div className="text-xs text-slate-400 mt-1 flex gap-3 flex-wrap">
              {history.customer.phone && <span>📱 {history.customer.phone}</span>}
              {history.customer.customerNumber && <span>#{history.customer.customerNumber}</span>}
              {history.customer.carrier && <span>📡 {history.customer.carrier}</span>}
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>{t('intelligence.firstVisit')}: {fmtDate(history.firstVisit)}</div>
            <div>{t('intelligence.lastVisit')}: {fmtDate(history.lastVisit)}</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricTile label={t('intelligence.transactions')} value={String(history.visitCount)}
          sub={history.avgDaysBetweenVisits !== null ? t('intelligence.everyXDays', history.avgDaysBetweenVisits) : undefined} />
        <MetricTile label={t('intelligence.totalSpent')} value={formatCurrency(history.netRevenue)}
          sub={history.totalRefunded > 0 ? t('intelligence.refundedX', formatCurrency(history.totalRefunded)) : undefined} />
        <MetricTile label={t('intelligence.businessProfit')} value={formatCurrency(history.profit)}
          sub={t('intelligence.marginLabel', history.margin.toFixed(1))} accent="emerald" />
        <MetricTile label={t('intelligence.avgTicket')} value={formatCurrency(history.avgTicket)}
          sub={history.preferredPaymentMethod ? t('intelligence.prefersX', history.preferredPaymentMethod) : undefined} />
      </div>
      {lowCostCoverage && (
        <div className="text-xs rounded px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-300">
          ⚠️ {t('intelligence.approxProfit', Math.round(history.costCoverage * 100))}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <InfoRow icon="🔧" label={t('intelligence.repairs')}
          value={history.linkedEntities.repairCount > 0 ? `${history.linkedEntities.repairCount} (${formatCurrency(history.linkedEntities.repairTotalValue)})` : '0'} />
        <InfoRow icon="📦" label={t('intelligence.specialOrders')} value={String(history.linkedEntities.specialOrderCount)} />
        <InfoRow icon="🔓" label={t('intelligence.unlocks')} value={String(history.linkedEntities.unlockCount)} />
        <InfoRow icon="🏷️" label={t('intelligence.layaways')} value={String(history.linkedEntities.layawayCount)} />
        <InfoRow icon="🎁" label={t('intelligence.loyaltyPoints')} value={history.customer.loyaltyPoints.toLocaleString()} />
        <InfoRow icon="💳" label={t('intelligence.storeCredit')} value={formatCurrency(history.customer.storeCredit)} />
      </div>
      {history.linkedEntities.activeBalance > 0 && (
        <div className="text-xs rounded px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-300">
          💰 {t('intelligence.outstandingBalance')}: <strong>{formatCurrency(history.linkedEntities.activeBalance)}</strong>
        </div>
      )}
      {history.topItems.length > 0 && (
        <div>
          <h5 className="text-sm font-semibold text-slate-300 mb-2">{t('intelligence.top5Items')}</h5>
          <div className="rounded border border-surface-700 divide-y divide-surface-700">
            {history.topItems.map((item, idx) => (
              <div key={idx} className="px-3 py-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-4">#{idx + 1}</span>
                  <span className="text-slate-200">{item.name}</span>
                </div>
                <div className="text-right">
                  <div className="text-slate-200">{formatCurrency(item.revenue)}</div>
                  <div className="text-xs text-slate-500">{item.quantity} {t('intelligence.qty')}</div>
                </div>
              </div>
            ))}
          </div>
          {history.topCategoryByProfit && (
            <div className="text-xs text-slate-400 mt-2">
              {t('intelligence.mostProfitableCategory')}: <strong>{history.topCategoryByProfit}</strong> ({formatCurrency(history.topCategoryProfit)})
            </div>
          )}
        </div>
      )}
      {history.visitCount === 0 && (
        <div className="text-sm text-slate-500 italic text-center py-4">{t('intelligence.noSalesForCustomer')}</div>
      )}
    </div>
  );
}

function MetricTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'emerald' }) {
  const valueClass = accent === 'emerald' ? 'text-emerald-400' : 'text-slate-100';
  return (
    <div className="bg-surface-900/50 rounded p-3 border border-surface-700">
      <div className="text-[0.68rem] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-surface-900/40 rounded px-2 py-1.5 border border-surface-700">
      <span className="text-slate-400">{icon} {label}</span>
      <span className="text-slate-200 font-medium">{value}</span>
    </div>
  );
}

// R-INTELLIGENCE-QUEUE-DEDUP-NAVIGATION-V1: upgraded operational review card.
// Adds: occurrence badge, last-seen age, Open button for entity navigation.

const SEVERITY_COLOR: Record<QueueItemSeverity, { bg: string; text: string; border: string }> = {
  critical: { bg: '#EF444422', text: '#EF4444', border: '#EF444444' },
  high:     { bg: '#F59E0B22', text: '#F59E0B', border: '#F59E0B44' },
  medium:   { bg: '#6366F122', text: '#818CF8', border: '#6366F144' },
  low:      { bg: '#6B728022', text: '#9CA3AF', border: '#37415155' },
};

// Lightweight relative-time formatter — no external lib, no i18n overhead.
function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function QueueCard({
  item, lang, onApprove, onDismiss, onResolve, onOpen,
  onFeedbackUseful, onFeedbackNotUseful, onFeedbackSnooze,
}: {
  item: ManagerQueueItem;
  lang: 'en' | 'es' | 'pt';
  onApprove:           (item: ManagerQueueItem) => void;
  onDismiss:           (item: ManagerQueueItem) => void;
  onResolve:           (item: ManagerQueueItem) => void;
  onOpen:              (item: ManagerQueueItem) => void;
  onFeedbackUseful:    (item: ManagerQueueItem) => void;
  onFeedbackNotUseful: (item: ManagerQueueItem) => void;
  onFeedbackSnooze:    (item: ManagerQueueItem) => void;
}) {
  const colors = SEVERITY_COLOR[item.severity];
  const occurrences = item.occurrenceCount ?? 1;
  const lastSeen = item.lastSeenAt ?? item.updatedAt;
  const hasEntity = Boolean(item.entityId && item.entityType);

  const SEVER: Record<QueueItemSeverity, Record<'en' | 'es' | 'pt', string>> = {
    critical: { en: 'Critical', es: 'Crítico',  pt: 'Crítico' },
    high:     { en: 'High',     es: 'Alto',      pt: 'Alto' },
    medium:   { en: 'Medium',   es: 'Medio',     pt: 'Médio' },
    low:      { en: 'Low',      es: 'Bajo',      pt: 'Baixo' },
  };
  const L = {
    approve:    { en: 'Approve',    es: 'Aprobar',   pt: 'Aprovar' }[lang],
    dismiss:    { en: 'Dismiss',    es: 'Descartar', pt: 'Descartar' }[lang],
    resolve:    { en: 'Resolve',    es: 'Resolver',  pt: 'Resolver' }[lang],
    open:       { en: 'Open',       es: 'Abrir',     pt: 'Abrir' }[lang],
    useful:     { en: 'Useful',     es: 'Útil',      pt: 'Útil' }[lang],
    notUseful:  { en: 'Not useful', es: 'No útil',   pt: 'Inútil' }[lang],
    snooze:     { en: 'Snooze 1h',  es: 'Posponer',  pt: 'Adiar' }[lang],
    times:      lang === 'es' ? 'veces' : lang === 'pt' ? 'vezes' : 'times',
  };

  return (
    <div
      className="rounded border p-3"
      style={{ background: CARD_BG, borderColor: CARD_BORDER, borderLeftWidth: 3, borderLeftColor: colors.text }}
    >
      {/* Header row: severity badge + title + occurrence badge */}
      <div className="flex items-start gap-2 mb-1.5">
        <span
          className="shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
          style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
        >
          {SEVER[item.severity][lang]}
        </span>
        <span className="text-sm font-semibold text-slate-100 flex-1 leading-snug min-w-0 truncate">
          {item.title}
        </span>
        {occurrences > 1 && (
          <span
            className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
            title={`${occurrences} ${L.times}`}
          >
            ×{occurrences}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-slate-400 leading-snug mb-1.5">{item.description}</p>

      {/* Recommended action */}
      {item.recommendedAction && (
        <p className="text-[11px] text-slate-500 italic mb-1.5">→ {item.recommendedAction}</p>
      )}

      {/* Last-seen age — only when recurring or recent */}
      {(occurrences > 1 || (Date.now() - lastSeen) < 3_600_000) && (
        <p className="text-[10px] text-slate-600 mb-2">{relativeTime(lastSeen)}</p>
      )}

      {/* Primary action buttons */}
      <div className="flex flex-wrap gap-1.5">
        {hasEntity && (
          <button
            onClick={() => onOpen(item)}
            className="px-2 py-1 text-[10px] font-semibold rounded transition"
            style={{ background: '#8B5CF622', color: '#A78BFA', border: '1px solid #8B5CF644' }}
          >
            ↗ {L.open}
          </button>
        )}
        <button
          onClick={() => onApprove(item)}
          className="px-2 py-1 text-[10px] font-semibold rounded transition"
          style={{ background: '#10B98122', color: '#10B981', border: '1px solid #10B98144' }}
        >
          ✓ {L.approve}
        </button>
        <button
          onClick={() => onResolve(item)}
          className="px-2 py-1 text-[10px] font-semibold rounded transition"
          style={{ background: '#3B82F622', color: '#3B82F6', border: '1px solid #3B82F644' }}
        >
          ✔ {L.resolve}
        </button>
        <button
          onClick={() => onDismiss(item)}
          className="px-2 py-1 text-[10px] font-medium rounded transition"
          style={{ background: '#37415155', color: '#9CA3AF', border: '1px solid #37415188' }}
        >
          {L.dismiss}
        </button>
      </div>

      {/* R-INTELLIGENCE-FEEDBACK-LOOP-V1: compact feedback signals.
          Small, non-intrusive. No labels beyond minimal text. */}
      <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-800">
        <span className="text-[9px] text-slate-600 uppercase tracking-wide shrink-0">
          {lang === 'es' ? 'Feedback' : lang === 'pt' ? 'Feedback' : 'Feedback'}:
        </span>
        <button
          onClick={() => onFeedbackUseful(item)}
          className="text-[10px] text-slate-500 hover:text-emerald-400 transition px-1"
          title={L.useful}
        >
          👍
        </button>
        <button
          onClick={() => onFeedbackSnooze(item)}
          className="text-[10px] text-slate-500 hover:text-amber-400 transition px-1"
          title={L.snooze}
        >
          💤
        </button>
        <button
          onClick={() => onFeedbackNotUseful(item)}
          className="text-[10px] text-slate-500 hover:text-rose-400 transition px-1"
          title={L.notUseful}
        >
          👎
        </button>
      </div>
    </div>
  );
}
