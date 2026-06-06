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
import { consumePendingPromoteProduct, consumePendingIntelligenceAction } from '@/services/intelligence/context/intelligenceContext';
import {
  readOperatorQueue,
  completeOperatorQueueItem,
  dismissOperatorQueueItem,
  addOperatorQueueItem,
} from '@/services/intelligence/operatorQueue/operatorQueue';
import type { OperatorQueueItem, OperatorTaskType } from '@/services/intelligence/operatorQueue/operatorQueue';
import { getOutcomeAdjustment } from '@/services/intelligence/operatorQueue/outcomeLearning';
import {
  generateProactiveMissions,
  readDismissedMissions,
  dismissMission as dismissProactiveMission,
} from '@/services/intelligence/proactive/proactiveMissions';
import type { ProactiveMission } from '@/services/intelligence/proactive/proactiveMissions';
import {
  detectStoreState,
  type StoreStateResult,
  type StoreStateType,
} from '@/services/intelligence/storeState/storeStateEngine';
import {
  generateContinuityItems,
  readDismissedContinuity,
  dismissContinuityItem,
  resumeContinuityItem,
  type ContinuityItem,
} from '@/services/intelligence/continuity/continuityEngine';
import ContinuityPanel from '@/components/ContinuityPanel';
import {
  generateDailyBriefing,
  type DailyBriefingResult,
} from '@/services/intelligence/briefing/dailyBriefing';
import DailyBriefingSection from '@/components/DailyBriefingSection';
import {
  computeFocusMode,
  type FocusModeResult,
} from '@/services/intelligence/focus/operatorFocusMode';
import {
  generateBusinessMemory,
  recordStoreStateEvent,
  recordTaskOutcomeEvent,
  type BusinessMemoryResult,
} from '@/services/intelligence/memory/businessMemory';
import BusinessMemorySection from '@/components/BusinessMemorySection';
import {
  generateStrategicInsights,
  type StrategicOperatorResult,
} from '@/services/intelligence/strategy/strategicOperator';
import StrategicInsightsSection from '@/components/StrategicInsightsSection';
import {
  generateRecommendations,
  type RecommendationResult,
  type RecommendationAction,
} from '@/services/intelligence/recommendations/operatorRecommendations';
import RecommendedActionsSection from '@/components/RecommendedActionsSection';
import {
  generateOperationalHealth,
  type OperationalHealthResult,
} from '@/services/intelligence/health/operationalHealth';
import OperationalHealthSection from '@/components/OperationalHealthSection';
import {
  generateWeeklyReview,
  type WeeklyReviewResult,
} from '@/services/intelligence/review/weeklyOperatorReview';
import WeeklyReviewSection from '@/components/WeeklyReviewSection';
import {
  generateExecutionChain,
  dismissChain as dismissExecutionChain,
  type ExecutionChain,
  type ChainedAction,
} from '@/services/intelligence/execution/executionChaining';
import ExecutionChainPanel from '@/components/ExecutionChainPanel';
import {
  computeRoleRouting,
  type RoleRoutingResult,
} from '@/services/intelligence/routing/roleIntelligenceRouting';
import SimpleOperatorView from './SimpleOperatorView';
import FloatingOperatorBubble from '@/components/FloatingOperatorBubble';
import PaymentVerificationNudge from '@/components/PaymentVerificationNudge';
import type { LiveAssistSuggestion, LiveAssistContext } from '@/services/intelligence/live/types';
import { recordAttentionSignal } from '@/services/intelligence/attention/store';
// INTELLIGENCE-PROACTIVE-OPERATOR-SURFACES-V1
import { getAttentionFeed } from '@/services/intelligence/attention/attentionEngine';
import { setAttentionPressure, severityToLevel } from '@/services/intelligence/attention/attentionPressureStore';
import { formatCurrency } from '@/utils/currency';
import { matchesSearch } from '@/utils/fuzzyMatch';
import { useTranslation } from '@/i18n';

const CARD_BG     = '#111827';
const CARD_BORDER = '#1F2937';
const PAGE_BG     = '#0B1220';

// INTEL-PERF-LEGACY-GATE-V1: stable stub results returned by the legacy-only
// memo chain while showLegacySections === false (the 3-column operator shell
// doesn't render those sections, but their memos still recomputed on every
// data change). Module-scope constants → stable identity, so downstream
// legacy memos don't even re-run. When showLegacySections flips back to true
// the full computations resume untouched. Display-only values (generatedAt 0
// etc.) — nothing outside the hidden legacy JSX reads them (verified: every
// consumer, including chainContextRef readers, is wired inside the
// showLegacySections block).
const LEGACY_STUB_STORE_STATE: StoreStateResult = { state: 'normal' as StoreStateType, confidence: 100, reason: '', detectedAt: 0, recommendedFocus: 'balanced' as const };
const LEGACY_STUB_BRIEFING: DailyBriefingResult = { generatedAt: 0, tone: 'operational', items: [] };
const LEGACY_STUB_FOCUS_MODE: FocusModeResult = { mode: 'balanced', reason: '', accentColor: '#9CA3AF', highlightedSections: [], suppressedSections: [], missionsDefaultCollapsed: false, queueDefaultCollapsed: false, isUrgentOverride: false };
const LEGACY_STUB_BUSINESS_MEMORY: BusinessMemoryResult = { generatedAt: 0, insights: [] };
const LEGACY_STUB_STRATEGIC: StrategicOperatorResult = { generatedAt: 0, insights: [] };
const LEGACY_STUB_RECOMMENDATIONS: RecommendationResult = { generatedAt: 0, recommendations: [] };
const LEGACY_STUB_HEALTH: OperationalHealthResult = { overallScore: 100, overallStatus: 'stable', dimensions: [], summary: '' };
const LEGACY_STUB_WEEKLY: WeeklyReviewResult = { generatedAt: 0, overallWeekStatus: 'stable', reviewItems: [] };

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
    specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, storeCreditLedger,
    currentStoreId, consolidatedView,
    // R-CUSTOMER-PROFIT-PARITY-V1: settings carry carrierCommissions +
    // defaultCommissionRate. Engine uses them inside getCustomerHistory
    // to translate phone_payment items into their real economic cost.
    settings,
    // R-INTELLIGENCE-ROLE-ROUTING-V1: current operator for role-aware routing.
    currentEmployee,
  } = state;
  const { locale, t } = useTranslation();
  const engineLang: 'en' | 'es' | 'pt' = locale as 'en' | 'es' | 'pt';
  // R-INTELLIGENCE-USE-APP-LANGUAGE-V1: the chat/operator view now receives the
  // FULL app locale (incl. pt). Previously a pt→en `apiLang` collapse forced
  // Portuguese users to see English chat responses even though tChat() has pt
  // entries (with en fallback for any missing key). Intent detection still
  // understands ES/EN/PT input; only the response COPY follows the app language.

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

  // R-INTELLIGENCE-OPERATOR-QUEUE-V1: operator task queue state
  const [taskQueue, setTaskQueue] = useState<OperatorQueueItem[]>(() => readOperatorQueue());
  const [showAllTaskQueue, setShowAllTaskQueue] = useState(false);

  // R-INTELLIGENCE-PROACTIVE-MISSIONS-V1: dismissed mission tracking.
  const [dismissedMissions, setDismissedMissions] = useState<Record<string, number>>(() => readDismissedMissions());

  // R-INTELLIGENCE-CONTINUITY-V1: dismissed continuity item tracking.
  const [dismissedContinuity, setDismissedContinuity] = useState<Record<string, number>>(() => readDismissedContinuity());

  // R-INTELLIGENCE-FOCUS-MODE-V1: collapse toggles for focus mode.
  // Seeded by computeFocusMode on first render; user can override manually.
  const [missionsCollapsed, setMissionsCollapsed] = useState(false);
  const [taskQueueCollapsed, setTaskQueueCollapsed] = useState(false);

  // R-INTELLIGENCE-EXECUTION-CHAINING-V1: active chain state.
  const [activeChain, setActiveChain] = useState<ExecutionChain | null>(null);

  // R-INTELLIGENCE-ROLE-ROUTING-V1: role-driven section collapse defaults.
  // Seeded by roleRouting on role change; user can expand manually.
  const [weeklyReviewCollapsed, setWeeklyReviewCollapsed] = useState(false);
  const [strategicInsightsCollapsed, setStrategicInsightsCollapsed] = useState(false);
  const [businessMemoryCollapsed, setBusinessMemoryCollapsed] = useState(false);

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
      { specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, storeCreditLedger, settings },
    );
    engineConfigSigRef.current = engineConfigSig;
    if (INTEL_PERF_ENABLED) perfLog('intel.module.engine.create', _t);
  }
  const engine = engineRef.current;

  {
    const _t = INTEL_PERF_ENABLED ? performance.now() : 0;
    engine.updateData(sales, customers, inventory, repairs, {
      specialOrders, unlocks, layaways, customerReturns, expenses, employees, appointments, storeCreditLedger, settings,
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

  // INTELLIGENCE-PROACTIVE-OPERATOR-SURFACES-V1: push attention pressure to
  // the bubble bridge. Computed once per panel open (empty deps intentional —
  // feed is a one-time snapshot, not a live subscription).
  useEffect(() => {
    const feed = getAttentionFeed(engineRef.current!);
    const topSeverity = feed[0]?.severity ?? 0;
    setAttentionPressure({
      level: severityToLevel(feed.length, topSeverity),
      count: feed.length,
      topSeverity,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // R-INTELLIGENCE-MANAGER-QUEUE-V1: reload queue when a new item is pushed.
  const reloadQueue = useCallback(() => { setQueueItems(getQueue()); }, []);
  const reloadTaskQueue = useCallback(() => { setTaskQueue(readOperatorQueue()); }, []);

  useEffect(() => {
    window.addEventListener('cellhub:open-manager-review', reloadQueue);
    return () => window.removeEventListener('cellhub:open-manager-review', reloadQueue);
  }, [reloadQueue]);

  // R-INTELLIGENCE-OPERATOR-QUEUE-V1: refresh task queue when IntelligenceChat adds an item.
  useEffect(() => {
    window.addEventListener('cellhub:operator-queue-updated', reloadTaskQueue);
    return () => window.removeEventListener('cellhub:operator-queue-updated', reloadTaskQueue);
  }, [reloadTaskQueue]);

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
      case 'unlock':
        window.dispatchEvent(new CustomEvent('cellhub:open-unlock',         { detail: { unlockId:   item.entityId } })); break;
      case 'special_order':
        window.dispatchEvent(new CustomEvent('cellhub:open-special-order',  { detail: { orderId:    item.entityId } })); break;
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

  // R-INTELLIGENCE-OPERATOR-QUEUE-V1: task queue action handlers
  const handleTaskComplete = useCallback((id: string) => {
    const item = taskQueue.find((t) => t.id === id);
    completeOperatorQueueItem(id);
    setTaskQueue(readOperatorQueue());
    if (item) {
      recordTaskOutcomeEvent(item.type, 'completed');
      // R-INTELLIGENCE-EXECUTION-CHAINING-V1: generate next-step chain.
      const ctx = {
        ...chainContextRef.current,
        pendingQueueCount: Math.max(0, chainContextRef.current.pendingQueueCount - 1),
      };
      const chain = generateExecutionChain({ source: 'task_complete', completedType: item.type }, ctx);
      if (chain) setActiveChain(chain);
    }
  }, [taskQueue]); // chainContextRef is a ref — no dep needed

  const handleTaskDismiss = useCallback((id: string) => {
    const item = taskQueue.find((t) => t.id === id);
    dismissOperatorQueueItem(id);
    setTaskQueue(readOperatorQueue());
    if (item) recordTaskOutcomeEvent(item.type, 'dismissed');
  }, [taskQueue]);

  const handleTaskWhatsApp = useCallback((item: OperatorQueueItem) => {
    if (!item.phone) return;
    const url = `https://wa.me/${item.phone.replace(/\D/g, '')}?text=${encodeURIComponent(item.suggestedMessage)}`;
    window.open(url, '_blank');
  }, []);

  const handleTaskCopyMessage = useCallback((item: OperatorQueueItem) => {
    if (!item.suggestedMessage) return;
    navigator.clipboard?.writeText(item.suggestedMessage).catch(() => {});
  }, []);

  const handleTaskView = useCallback((item: OperatorQueueItem) => {
    if (!item.relatedEntityId) return;
    const isRepair = item.type === 'repair_follow_up' || item.type === 'repair_escalate' || item.type === 'repair_waiting';
    if (isRepair) {
      window.dispatchEvent(new CustomEvent('cellhub:open-repair', { detail: { repairId: item.relatedEntityId } }));
    } else {
      window.dispatchEvent(new CustomEvent('cellhub:open-customer', { detail: { customerId: item.relatedEntityId } }));
    }
  }, []);

  // R-INTELLIGENCE-PROACTIVE-MISSIONS-V1: mission action handlers
  const handleMissionDismiss = useCallback((missionId: string) => {
    dismissProactiveMission(missionId);
    setDismissedMissions(readDismissedMissions());
  }, []);

  const handleMissionAddToQueue = useCallback((mission: ProactiveMission) => {
    const { scoreAdjustment, confidenceLabel } = getOutcomeAdjustment(mission.type as OperatorTaskType);
    const finalScore = Math.max(0, Math.min(100, mission.priorityScore + scoreAdjustment));
    addOperatorQueueItem({
      type: mission.type as OperatorTaskType,
      customerName: mission.customerName || '',
      phone: mission.phone || '',
      relatedEntityId: mission.relatedEntityId,
      summary: mission.title,
      suggestedMessage: mission.suggestedMessage || '',
      priorityScore: finalScore,
      urgencyLevel: mission.urgencyLevel,
      impactReason: mission.reason,
      confidenceLabel,
    });
    setTaskQueue(readOperatorQueue());
    window.dispatchEvent(new CustomEvent('cellhub:operator-queue-updated'));
  }, []);

  const handleMissionWhatsApp = useCallback((mission: ProactiveMission) => {
    if (!mission.phone) return;
    const url = `https://wa.me/${mission.phone.replace(/\D/g, '')}?text=${encodeURIComponent(mission.suggestedMessage || '')}`;
    window.open(url, '_blank');
  }, []);

  const handleMissionCopyMessage = useCallback((mission: ProactiveMission) => {
    if (!mission.suggestedMessage) return;
    navigator.clipboard?.writeText(mission.suggestedMessage).catch(() => {});
  }, []);

  const handleMissionView = useCallback((mission: ProactiveMission) => {
    if (!mission.relatedEntityId) return;
    const isRepair = mission.type === 'repair_follow_up' || mission.type === 'repair_escalate';
    if (isRepair) {
      window.dispatchEvent(new CustomEvent('cellhub:open-repair', { detail: { repairId: mission.relatedEntityId } }));
    } else {
      window.dispatchEvent(new CustomEvent('cellhub:open-customer', { detail: { customerId: mission.relatedEntityId } }));
    }
  }, []);

  // R-INTELLIGENCE-CONTINUITY-V1: continuity action handlers
  const handleContinuityDismiss = useCallback((id: string) => {
    dismissContinuityItem(id);
    setDismissedContinuity(readDismissedContinuity());
  }, []);

  const handleContinuityResume = useCallback((item: ContinuityItem) => {
    resumeContinuityItem(item.id);
    setDismissedContinuity(readDismissedContinuity());
    // R-INTELLIGENCE-EXECUTION-CHAINING-V1: generate next-step chain for workflow resumption.
    {
      const ctx = {
        ...chainContextRef.current,
        continuityItemCount: Math.max(0, chainContextRef.current.continuityItemCount - 1),
      };
      const chain = generateExecutionChain({ source: 'continuity_resume', continuityType: item.type }, ctx);
      if (chain) setActiveChain(chain);
    }
    // outreach_pending with phone → WhatsApp
    if (item.type === 'outreach_pending' && item.phone) {
      const url = `https://wa.me/${item.phone.replace(/\D/g, '')}`;
      window.open(url, '_blank');
      return;
    }
    // Navigate via existing event infrastructure
    if (item.openEventType) {
      window.dispatchEvent(new CustomEvent(item.openEventType, { detail: item.openEventDetail ?? {} }));
      return;
    }
    if (item.navigateTo) {
      window.dispatchEvent(new CustomEvent('cellhub:navigate-tab', { detail: { tab: item.navigateTo } }));
    }
  }, []);

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

  // R-INTELLIGENCE-OPERATOR-QUEUE-V1: derived task queue lists
  const TASK_QUEUE_PREVIEW = 5;
  const pendingTaskItems = useMemo(
    () => taskQueue
      .filter((i) => i.status === 'pending')
      .slice()
      .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0)),
    [taskQueue],
  );
  const visibleTaskItems = showAllTaskQueue ? pendingTaskItems : pendingTaskItems.slice(0, TASK_QUEUE_PREVIEW);

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

  const yesterdayRevenue = useMemo(() => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yStart = new Date(y); yStart.setHours(0, 0, 0, 0);
    const yEnd   = new Date(y); yEnd.setHours(23, 59, 59, 999);
    return sales
      .filter(s => {
        const t = new Date((s as any).createdAt).getTime();
        return t >= yStart.getTime() && t <= yEnd.getTime() && (s as any).status !== 'voided';
      })
      .reduce((sum, s) => sum + ((s as any).total || 0), 0);
  }, [sales]);

  const activeCustomers30d = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const ids = new Set<string>();
    for (const s of sales) {
      if ((s as any).status !== 'voided' && new Date((s as any).createdAt).getTime() >= cutoff) {
        if ((s as any).customerId) ids.add((s as any).customerId);
      }
    }
    for (const r of repairs) {
      if (new Date((r as any).createdAt).getTime() >= cutoff) {
        if ((r as any).customerId) ids.add((r as any).customerId);
      }
    }
    return ids.size;
  }, [sales, repairs]);

  const repairsInProgress = useMemo(() =>
    repairs.filter(r => !['completed', 'picked_up', 'cancelled', 'refunded'].includes(String((r as any).status || '').toLowerCase())).length,
  [repairs]);

  const layawaysActive = useMemo(() =>
    layaways.filter(l => !['completed', 'cancelled', 'picked_up'].includes(String((l as any).status || '').toLowerCase())).length,
  [layaways]);

  const unlocksActive = useMemo(() =>
    unlocks.filter(u => !['completed', 'cancelled', 'delivered'].includes(String((u as any).status || '').toLowerCase())).length,
  [unlocks]);

  const specialOrdersActive = useMemo(() =>
    specialOrders.filter(o => !['completed', 'cancelled', 'delivered', 'picked_up'].includes(String((o as any).status || '').toLowerCase())).length,
  [specialOrders]);

  const hourlySales = useMemo(() => {
    const buckets = new Array(24).fill(0) as number[];
    for (const s of todaySales) {
      const h = new Date((s as any).createdAt).getHours();
      buckets[h] += (s as any).total || 0;
    }
    return buckets;
  }, [todaySales]);

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

  // R-INTELLIGENCE-OPERATOR-SIGNALS-V3: lightweight deterministic operational
  // scans over already-loaded arrays for the Operator Home briefing. Single
  // pass each, no effects/polling/persistence. COUNTS ONLY — no money values
  // are surfaced (collectible amounts stay private). Mirrors the toDate-
  // tolerant timestamp parsing used by staleRepairStats above.
  const operatorSignalsV3 = useMemo(() => perfTime('intel.module.cards.operatorSignalsV3', () => {
    const now = Date.now();
    const AGED_MS = 30 * 24 * 60 * 60 * 1000; // 30d without a due date ⇒ collection risk
    const toMs = (raw: unknown): number => {
      if (!raw) return 0;
      try {
        const d = typeof (raw as { toDate?: () => Date }).toDate === 'function'
          ? (raw as { toDate: () => Date }).toDate()
          : (raw as string | Date);
        const ts = new Date(d as string | Date).getTime();
        return Number.isFinite(ts) ? ts : 0;
      } catch { return 0; }
    };
    const LAYAWAY_DONE = ['completed', 'cancelled', 'picked_up'];

    // Layaways: overdue (aged + collectible) and collectible (any balance).
    let overdueLayawayCount = 0;
    let layawayCollectible = 0;
    for (const l of layaways) {
      const st = String((l as { status?: string }).status || '').toLowerCase();
      if (LAYAWAY_DONE.includes(st)) continue;
      const bal = (l as { balance?: number }).balance || 0;
      if (bal <= 0) continue;
      layawayCollectible++;
      const due = (l as { dueDate?: unknown }).dueDate ? toMs((l as { dueDate?: unknown }).dueDate) : 0;
      const created = toMs((l as { createdAt?: unknown }).createdAt);
      const isOverdue = (due > 0 && due < now) || (due === 0 && created > 0 && (now - created) > AGED_MS);
      if (isOverdue) overdueLayawayCount++;
    }

    // Repairs: ready-for-pickup (all ready) + collectible ready (balance > 0).
    let readyPickupCount = 0;
    let repairCollectible = 0;
    for (const r of repairs) {
      const st = String((r as { status?: string }).status || '').toLowerCase();
      if (st !== 'ready') continue;
      readyPickupCount++;
      if (((r as { balance?: number }).balance || 0) > 0) repairCollectible++;
    }

    // Roll-up count of records with money waiting to be collected. COUNT ONLY.
    const paymentOpportunityCount = layawayCollectible + repairCollectible;

    return { overdueLayawayCount, readyPickupCount, paymentOpportunityCount };
  }), [layaways, repairs]);

  // R-INTELLIGENCE-OPERATOR-SIGNALS-V3: activations completed today. Reuses the
  // already-filtered todaySales array (no new date scan). Same activation
  // detection the receipt/saleBuilder use: category 'activation'/'sim' or the
  // explicit isActivation flag. Count only — non-financial.
  const todayActivationCount = useMemo(() => {
    let n = 0;
    for (const s of todaySales) {
      const items = (s as { items?: unknown[] }).items || [];
      const hasActivation = items.some((it) => {
        const c = (it as { category?: string }).category;
        return c === 'activation' || c === 'sim' || (it as { isActivation?: boolean }).isActivation === true;
      });
      if (hasActivation) n++;
    }
    return n;
  }, [todaySales]);

  // Phase 1: operator shell takes over. Legacy sections preserved but hidden.
  // INTEL-PERF-LEGACY-GATE-V1: declaration moved up from the render section so
  // the legacy-only memo chain below can short-circuit to stable stubs.
  const showLegacySections = false;

  // R-INTELLIGENCE-STORE-STATE-V1: deterministic operational state detection.
  // Must be after outreachCount to avoid TS2448 use-before-declaration.
  // INTEL-PERF-LEGACY-GATE-V1: gated — consumers are legacy-only (legacy JSX,
  // CommandCenterHeader, chainContextRef whose readers are legacy-wired
  // handlers, and the recordStoreStateEvent memory effect feeding the
  // legacy-only businessMemory).
  const storeState: StoreStateResult = useMemo(() => {
    if (!showLegacySections) return LEGACY_STUB_STORE_STATE;
    try {
      return detectStoreState({
        sales: sales as Parameters<typeof detectStoreState>[0]['sales'],
        repairs: repairs as Parameters<typeof detectStoreState>[0]['repairs'],
        layaways: layaways as Parameters<typeof detectStoreState>[0]['layaways'],
        outreachCandidateCount: outreachCount,
      });
    } catch {
      return { state: 'normal' as StoreStateType, confidence: 100, reason: '', detectedAt: Date.now(), recommendedFocus: 'balanced' as const };
    }
  }, [sales, repairs, layaways, outreachCount, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // R-INTELLIGENCE-PROACTIVE-MISSIONS-V1: deterministic mission generation.
  // INTEL-PERF-LEGACY-GATE-V1: gated — mission cards/handlers live only in
  // the legacy JSX block.
  const missions = useMemo(
    () => showLegacySections ? generateProactiveMissions(engine, pendingTaskItems, dismissedMissions, engineLang, Date.now(), storeState.state) : [],
    [engine, result, pendingTaskItems, dismissedMissions, engineLang, storeState.state], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // R-INTELLIGENCE-CONTINUITY-V1: deterministic continuity item generation.
  // INTEL-PERF-LEGACY-GATE-V1: gated — continuity rows/resume handler are
  // legacy-wired only.
  const continuityItems = useMemo(
    () => showLegacySections ? generateContinuityItems({
      repairs: repairs as Parameters<typeof generateContinuityItems>[0]['repairs'],
      managerQueueItems: queueItems,
      operatorQueueItems: taskQueue,
      dismissedIds: dismissedContinuity,
    }) : [],
    [repairs, queueItems, taskQueue, dismissedContinuity, refreshKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // R-INTELLIGENCE-DAILY-BRIEFING-V1: compact operational briefing.
  // INTEL-PERF-LEGACY-GATE-V1: gated — briefing renders only in legacy JSX.
  const briefing: DailyBriefingResult = useMemo(
    () => !showLegacySections ? LEGACY_STUB_BRIEFING : generateDailyBriefing({
      storeState,
      repairs: repairs as Parameters<typeof generateDailyBriefing>[0]['repairs'],
      layaways: layaways as Parameters<typeof generateDailyBriefing>[0]['layaways'],
      sales: sales as Parameters<typeof generateDailyBriefing>[0]['sales'],
      missions,
      continuityItems,
      pendingQueueTasks: pendingTaskItems,
      managerQueueItems: queueItems,
      lang: engineLang,
    }),
    [storeState, repairs, layaways, sales, missions, continuityItems, pendingTaskItems, queueItems, engineLang, refreshKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // R-INTELLIGENCE-FOCUS-MODE-V1: deterministic attention management.
  // INTEL-PERF-LEGACY-GATE-V1: gated — FocusModeIndicator + section
  // suppression/collapse defaults only affect legacy sections.
  const focusMode: FocusModeResult = useMemo(
    () => !showLegacySections ? LEGACY_STUB_FOCUS_MODE : computeFocusMode({
      storeState,
      pendingQueueCount: pendingTaskItems.length,
    }),
    [storeState, pendingTaskItems.length, refreshKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Sync collapse state when focus mode changes. User can still manually
  // toggle after — this only fires on mode transition.
  useEffect(() => {
    setMissionsCollapsed(focusMode.missionsDefaultCollapsed);
    setTaskQueueCollapsed(focusMode.queueDefaultCollapsed);
  }, [focusMode.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter info-severity briefing items when focus mode suppresses them.
  const visibleBriefingItems = useMemo(
    () => focusMode.suppressedSections.includes('briefing_info')
      ? briefing.items.filter((i) => i.severity !== 'info')
      : briefing.items,
    [briefing.items, focusMode.suppressedSections],
  );

  // R-INTELLIGENCE-BUSINESS-MEMORY-V1: longitudinal pattern memory.
  // INTEL-PERF-LEGACY-GATE-V1: gated — reads localStorage + builds insights
  // rendered only in the legacy Business Memory section.
  const businessMemory: BusinessMemoryResult = useMemo(
    () => showLegacySections ? generateBusinessMemory() : LEGACY_STUB_BUSINESS_MEMORY,
    [refreshKey, storeState.state], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // R-INTELLIGENCE-STRATEGIC-OPERATOR-V1: deterministic strategic observations.
  // INTEL-PERF-LEGACY-GATE-V1: gated — legacy section only.
  const strategicInsights: StrategicOperatorResult = useMemo(
    () => !showLegacySections ? LEGACY_STUB_STRATEGIC : generateStrategicInsights({
      storeState,
      businessMemoryInsights: businessMemory.insights,
      repairs: repairs as Parameters<typeof generateStrategicInsights>[0]['repairs'],
      layaways: layaways as Parameters<typeof generateStrategicInsights>[0]['layaways'],
      missions: missions as Parameters<typeof generateStrategicInsights>[0]['missions'],
      continuityItems: continuityItems as Parameters<typeof generateStrategicInsights>[0]['continuityItems'],
      outreachCandidateCount: outreachCount,
    }),
    [storeState, businessMemory.insights, repairs, layaways, missions, continuityItems, outreachCount, refreshKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // R-INTELLIGENCE-DECISION-RECOMMENDATION-V1: actionable recommendations.
  // INTEL-PERF-LEGACY-GATE-V1: gated — legacy section only.
  const recommendations: RecommendationResult = useMemo(
    () => !showLegacySections ? LEGACY_STUB_RECOMMENDATIONS : generateRecommendations({
      storeState,
      focusMode,
      strategicInsights: strategicInsights.insights,
      businessMemoryInsights: businessMemory.insights,
      continuityItems: continuityItems as Parameters<typeof generateRecommendations>[0]['continuityItems'],
      missions: missions as Parameters<typeof generateRecommendations>[0]['missions'],
      pendingQueueCount: pendingTaskItems.length,
      outreachCandidateCount: outreachCount,
      repairs: repairs as Parameters<typeof generateRecommendations>[0]['repairs'],
      layaways: layaways as Parameters<typeof generateRecommendations>[0]['layaways'],
    }),
    [storeState, focusMode, strategicInsights.insights, businessMemory.insights, continuityItems, missions, pendingTaskItems.length, outreachCount, repairs, layaways, refreshKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // R-INTELLIGENCE-OPERATIONAL-HEALTH-V1: deterministic health scoring.
  // INTEL-PERF-LEGACY-GATE-V1: gated — health panel renders only in legacy;
  // chainContextRef readers are legacy-wired handlers.
  const operationalHealth: OperationalHealthResult = useMemo(
    () => !showLegacySections ? LEGACY_STUB_HEALTH : generateOperationalHealth({
      storeState,
      businessMemoryInsights: businessMemory.insights,
      strategicInsights: strategicInsights.insights,
      recommendations: recommendations.recommendations,
      repairs: repairs as Parameters<typeof generateOperationalHealth>[0]['repairs'],
      layaways: layaways as Parameters<typeof generateOperationalHealth>[0]['layaways'],
      managerQueueItems: queueItems as Parameters<typeof generateOperationalHealth>[0]['managerQueueItems'],
      continuityItems: continuityItems as Parameters<typeof generateOperationalHealth>[0]['continuityItems'],
      missions: missions as Parameters<typeof generateOperationalHealth>[0]['missions'],
      pendingQueueCount: pendingTaskItems.length,
      outreachCandidateCount: outreachCount,
    }),
    [storeState, businessMemory.insights, strategicInsights.insights, recommendations.recommendations, repairs, layaways, queueItems, continuityItems, missions, pendingTaskItems.length, outreachCount, refreshKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // R-INTELLIGENCE-WEEKLY-REVIEW-V1: deterministic week-in-review summary.
  // INTEL-PERF-LEGACY-GATE-V1: gated — legacy section only.
  const weeklyReview: WeeklyReviewResult = useMemo(
    () => !showLegacySections ? LEGACY_STUB_WEEKLY : generateWeeklyReview({
      operationalHealth,
      businessMemoryInsights: businessMemory.insights,
      strategicInsights: strategicInsights.insights,
      recommendations: recommendations.recommendations,
      continuityItemCount: continuityItems.length,
      pendingQueueCount: pendingTaskItems.length,
      outreachCandidateCount: outreachCount,
    }),
    [operationalHealth, businessMemory.insights, strategicInsights.insights, recommendations.recommendations, continuityItems.length, pendingTaskItems.length, outreachCount, refreshKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // R-INTELLIGENCE-ROLE-ROUTING-V1: deterministic role-aware routing.
  const roleRouting: RoleRoutingResult = useMemo(
    () => computeRoleRouting(currentEmployee as { role: string } | null),
    [currentEmployee?.role], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Sync role-driven collapse defaults when role changes.
  // User manual expansions are preserved across focus-mode changes;
  // only a role switch resets defaults.
  useEffect(() => {
    setWeeklyReviewCollapsed(roleRouting.weeklyReviewDefaultCollapsed);
    setStrategicInsightsCollapsed(roleRouting.strategicInsightsDefaultCollapsed);
    setBusinessMemoryCollapsed(roleRouting.businessMemoryDefaultCollapsed);
  }, [roleRouting.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // R-INTELLIGENCE-EXECUTION-CHAINING-V1: stable ref for chain context.
  // Updated each render so chain-generating callbacks read current values
  // without stale closure risk (anti-stale-closure pattern from CLAUDE.md).
  const chainContextRef = useRef<import('@/services/intelligence/execution/executionChaining').ChainContext>({
    storeState,
    operationalHealth,
    pendingQueueCount: pendingTaskItems.length,
    continuityItemCount: continuityItems.length,
    outreachCandidateCount: outreachCount,
  });
  chainContextRef.current = {
    storeState,
    operationalHealth,
    pendingQueueCount: pendingTaskItems.length,
    continuityItemCount: continuityItems.length,
    outreachCandidateCount: outreachCount,
  };

  // Record store state transitions so the memory layer can detect patterns.
  useEffect(() => {
    if (storeState.state !== 'normal') {
      recordStoreStateEvent(storeState.state);
    }
  }, [storeState.state]);

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

  // Bubble-query relay A — mount path: pick up queries stashed in sessionStorage
  // by FloatingOperatorBubble when the user navigates FROM another tab.
  useEffect(() => {
    let pending = '';
    try {
      pending = sessionStorage.getItem('cellhub:bubble:pendingQuery') || '';
      if (pending) sessionStorage.removeItem('cellhub:bubble:pendingQuery');
    } catch { /* sessionStorage unavailable */ }
    if (!pending) return;
    const tid = window.setTimeout(() => fireChat(pending), 0);
    return () => window.clearTimeout(tid);
  }, [fireChat]);

  // Bubble-query relay B — event path: picks up queries when already mounted
  // (user was already on Intelligence tab; no unmount/remount triggers relay A).
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text || '';
      if (!text) return;
      // Clear sessionStorage so relay A won't double-fire on a future mount.
      try { sessionStorage.removeItem('cellhub:bubble:pendingQuery'); } catch { /* ignore */ }
      fireChat(text);
    };
    window.addEventListener('cellhub:bubble-query', handler);
    return () => window.removeEventListener('cellhub:bubble-query', handler);
  }, [fireChat]);

  // Refs to scroll-target panels
  const promoteRef = useRef<HTMLDivElement>(null);
  const focusPromote = useCallback(() => {
    promoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Scroll promote panel into view after React renders it (panel only appears when selectedProduct is set)
  useEffect(() => {
    if (selectedProduct) {
      const tid = window.setTimeout(() => {
        promoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return () => window.clearTimeout(tid);
    }
  }, [selectedProduct?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // On mount, consume any pending promote product set by Inventory's Promote
  // button. Deferred via setTimeout(0) so the first paint completes before
  // the chat query fires (same pattern as the daily-brief auto-fire).
  useEffect(() => {
    const pending = consumePendingPromoteProduct();
    if (!pending) return;
    const tid = window.setTimeout(() => handleOpenPromote(pending.id, pending.name), 0);
    return () => window.clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount, consume any general Intelligence action query set by other modules
  // (Customer recover/VIP, Repair follow-up/escalate). Fires the prefilled query
  // into chat immediately, giving the operator actionable context on arrival.
  useEffect(() => {
    const pending = consumePendingIntelligenceAction();
    if (!pending) return;
    const tid = window.setTimeout(() => fireChat(pending.query), 0);
    return () => window.clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // INTEL-PERF-TIMER-HYGIENE-V1: skip the engine call while the app
      // window is hidden/minimized — the suggestion card isn't visible and
      // a hidden window can't be a checkout burst. Next visible tick
      // (≤2 min) refreshes normally. Interval itself stays registered so
      // timing semantics are unchanged when visible.
      if (document.visibilityState === 'hidden') return;
      const idleMs = Date.now() - lastInteractionAtRef.current;

      // R-INTELLIGENCE-ATTENTION-MODEL-V1: record checkout_burst when operator
      // has been actively interacting — proxy for a busy/checkout period.
      if (idleMs < 60_000) {
        recordAttentionSignal('checkout_burst');
      }

      const context: LiveAssistContext = {
        idleMs,
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
            repair:         'cellhub:open-repair',
            customer:       'cellhub:open-customer',
            layaway:        'cellhub:open-layaway',
            inventory:      'cellhub:open-inventory-item',
            unlock:         'cellhub:open-unlock',
            special_order:  'cellhub:open-special-order',
          };
          const keyMap: Record<string, string> = {
            repair: 'repairId', customer: 'customerId', layaway: 'layawayId', inventory: 'itemId',
            unlock: 'unlockId', special_order: 'orderId',
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

  // R-INTELLIGENCE-DECISION-RECOMMENDATION-V1: recommendation action shortcuts.
  // Navigates to external tabs; same-page targets (missions/queue) have no button shown.
  const handleRecommendationAction = useCallback((action: RecommendationAction) => {
    const tabMap: Record<string, string> = {
      open_repairs: 'repairs',
      open_customers: 'customers',
    };
    const tab = tabMap[action];
    if (tab) {
      window.dispatchEvent(new CustomEvent('cellhub:navigate-tab', { detail: { tab } }));
    }
    // R-INTELLIGENCE-EXECUTION-CHAINING-V1: generate contextual next-step chain.
    const chain = generateExecutionChain(
      { source: 'recommendation_action', recommendationAction: action },
      chainContextRef.current,
    );
    if (chain) setActiveChain(chain);
  }, []); // chainContextRef is a ref — stable, no dep needed

  // R-INTELLIGENCE-EXECUTION-CHAINING-V1: chain action handler.
  // Navigate to target tab if specified; chain is consumed on any action.
  const handleChainAction = useCallback((action: ChainedAction) => {
    if (action.navigationTarget) {
      window.dispatchEvent(new CustomEvent('cellhub:navigate-tab', { detail: { tab: action.navigationTarget } }));
    }
    setActiveChain(null);
  }, []);

  // Dismiss records to localStorage so the chain won't reappear for 4 hours.
  const handleChainDismiss = useCallback(() => {
    setActiveChain((current) => {
      if (current) dismissExecutionChain(current.chainId);
      return null;
    });
  }, []);

  // Auto-expire the active chain when its TTL is reached.
  useEffect(() => {
    if (!activeChain) return;
    const remaining = activeChain.expiresAt - Date.now();
    if (remaining <= 0) { setActiveChain(null); return; }
    const tid = window.setTimeout(() => setActiveChain(null), remaining);
    return () => window.clearTimeout(tid);
  }, [activeChain?.chainId]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = result.kpiDashboard;
  const totalAlerts = kpi.inventory.lowStockCount + kpi.repairs.overdue;

  // R-INTELLIGENCE-PERFORMANCE-AUDIT-V1: total render-prep cost for the
  // module. JSX construction itself is React-internal and not measured
  // here — only the synchronous work above (engine + memos + cards).
  if (INTEL_PERF_ENABLED) perfLog('intel.module.render.total', _renderT0);

  // Phase 1: operator shell takes over. Legacy sections preserved but hidden.
  // INTEL-PERF-LEGACY-GATE-V1: showLegacySections now declared above the
  // legacy memo chain (before storeState) so those memos can short-circuit.

  return (
    <div style={{ background: PAGE_BG, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── OPERATOR COMMAND CENTER — 3-column layout ── */}
      <SimpleOperatorView
        engine={engine}
        customers={customers}
        lang={engineLang}
        externalQuery={externalQuery}
        onOpenPromote={handleOpenPromote}
        onPanelCampaign={handlePanelCampaign}
        chipData={{
          outreachCount,
          staleRepairCount: staleRepairStats.count,
          repairsPending: kpi.repairs.pending,
          productOppsCount: productOpps.length,
          biggestLeakCents: biggestLeak,
          deadStockLockedCents: missedRev.deadStockLockedCents,
          // R-INTELLIGENCE-OPERATOR-SIGNALS-V2: reuse already-computed active
          // counts (same useMemos passed as standalone props below). No new
          // scans — just threaded into chipData for the Operator Home briefing.
          activeLayawayCount: layawaysActive,
          activeUnlockCount: unlocksActive,
          activeSpecialOrderCount: specialOrdersActive,
          // R-INTELLIGENCE-OPERATOR-SIGNALS-V3: deterministic operational scans
          // (counts only — no money). See operatorSignalsV3 / todayActivationCount.
          overdueLayawayCount: operatorSignalsV3.overdueLayawayCount,
          readyPickupCount: operatorSignalsV3.readyPickupCount,
          paymentOpportunityCount: operatorSignalsV3.paymentOpportunityCount,
          todayActivationCount,
        }}
        todayRevenue={todayRevenue}
        todaySalesCount={todaySales.length}
        totalAlerts={totalAlerts}
        staleRecoverable={staleRepairStats.recoverable}
        deadStockLocked={missedRev.deadStockLockedCents}
        biggestLeak={biggestLeak}
        yesterdayRevenue={yesterdayRevenue}
        activeCustomers30d={activeCustomers30d}
        repairsInProgress={repairsInProgress}
        layawaysActive={layawaysActive}
        unlocksActive={unlocksActive}
        specialOrdersActive={specialOrdersActive}
        hourlySales={hourlySales}
      />

      {showLegacySections && (<>
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

      {/* ── WEEKLY REVIEW ── R-INTELLIGENCE-WEEKLY-REVIEW-V1 ── */}
      {weeklyReview.reviewItems.length > 0 && (
        weeklyReviewCollapsed ? (
          <CollapsedSectionPill
            icon="📅"
            label={locale === 'es' ? 'Resumen Semanal' : locale === 'pt' ? 'Revisão Semanal' : 'Weekly Review'}
            count={weeklyReview.reviewItems.length}
            onExpand={() => setWeeklyReviewCollapsed(false)}
          />
        ) : (
          <div>
            <SectionCollapseRow onCollapse={() => setWeeklyReviewCollapsed(true)} />
            <WeeklyReviewSection
              review={weeklyReview}
              lang={locale as 'en' | 'es' | 'pt'}
            />
          </div>
        )
      )}

      {/* ── DAILY BRIEFING ── R-INTELLIGENCE-DAILY-BRIEFING-V1 ── */}
      {visibleBriefingItems.length > 0 && (
        <DailyBriefingSection
          items={visibleBriefingItems}
          lang={locale as 'en' | 'es' | 'pt'}
        />
      )}

      {/* ── BUSINESS MEMORY ── R-INTELLIGENCE-BUSINESS-MEMORY-V1 ── */}
      {businessMemory.insights.length > 0 && (
        businessMemoryCollapsed ? (
          <CollapsedSectionPill
            icon="🧠"
            label={locale === 'es' ? 'Patrones de Negocio' : locale === 'pt' ? 'Padrões do Negócio' : 'Business Patterns'}
            count={businessMemory.insights.length}
            onExpand={() => setBusinessMemoryCollapsed(false)}
          />
        ) : (
          <div>
            <SectionCollapseRow onCollapse={() => setBusinessMemoryCollapsed(true)} />
            <BusinessMemorySection
              insights={businessMemory.insights}
              lang={locale as 'en' | 'es' | 'pt'}
            />
          </div>
        )
      )}

      {/* ── STRATEGIC INSIGHTS ── R-INTELLIGENCE-STRATEGIC-OPERATOR-V1 ── */}
      {strategicInsights.insights.length > 0 && (
        strategicInsightsCollapsed ? (
          <CollapsedSectionPill
            icon="📡"
            label={locale === 'es' ? 'Perspectivas Estratégicas' : locale === 'pt' ? 'Perspectivas Estratégicas' : 'Strategic Insights'}
            count={strategicInsights.insights.length}
            onExpand={() => setStrategicInsightsCollapsed(false)}
          />
        ) : (
          <div>
            <SectionCollapseRow onCollapse={() => setStrategicInsightsCollapsed(true)} />
            <StrategicInsightsSection
              insights={strategicInsights.insights}
              lang={locale as 'en' | 'es' | 'pt'}
            />
          </div>
        )
      )}

      {/* ── RECOMMENDED ACTIONS ── R-INTELLIGENCE-DECISION-RECOMMENDATION-V1 ── */}
      {recommendations.recommendations.length > 0 && (
        <RecommendedActionsSection
          recommendations={recommendations.recommendations}
          lang={locale as 'en' | 'es' | 'pt'}
          onAction={handleRecommendationAction}
        />
      )}

      {/* ── OPERATIONAL HEALTH ── R-INTELLIGENCE-OPERATIONAL-HEALTH-V1 ── */}
      <OperationalHealthSection
        health={operationalHealth}
        lang={locale as 'en' | 'es' | 'pt'}
      />

      {/* ── EXECUTION CHAIN ── R-INTELLIGENCE-EXECUTION-CHAINING-V1 ── */}
      {activeChain && (
        <ExecutionChainPanel
          chain={activeChain}
          lang={locale as 'en' | 'es' | 'pt'}
          onDismiss={handleChainDismiss}
          onAction={handleChainAction}
        />
      )}

      {/* ── COMMAND CENTER HEADER ── R-INTELLIGENCE-COMMAND-CENTER-V1 ── */}
      {(storeState.state !== 'normal' || continuityItems.length > 0 || missions.length > 0 || pendingTaskItems.length > 0) && (
        <CommandCenterHeader
          storeState={storeState}
          continuityCount={continuityItems.length}
          missionCount={missions.length}
          queueCount={pendingTaskItems.length}
          lang={locale as 'en' | 'es' | 'pt'}
        />
      )}

      {/* ── FOCUS MODE INDICATOR + ROLE BADGE ── R-INTELLIGENCE-FOCUS-MODE-V1 / ROLE-ROUTING-V1 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <FocusModeIndicator focusMode={focusMode} lang={locale} />
        <RoleBadge role={roleRouting.role} lang={locale} />
      </div>

      {/* ── STORE STATE BANNER ── R-INTELLIGENCE-STORE-STATE-V1 ── */}
      {storeState.state !== 'normal' && (
        <StoreBanner state={storeState} lang={locale as 'en' | 'es' | 'pt'} />
      )}

      {/* ── CONTINUITY PANEL ── R-INTELLIGENCE-CONTINUITY-V1 ── */}
      {continuityItems.length > 0 && (
        <div style={{
          borderRadius: 8,
          border: `1px solid ${focusMode.highlightedSections.includes('continuity') ? focusMode.accentColor + '60' : 'transparent'}`,
          padding: focusMode.highlightedSections.includes('continuity') ? 2 : 0,
        }}>
          <ContinuityPanel
            items={continuityItems}
            lang={locale as 'en' | 'es' | 'pt'}
            onResume={handleContinuityResume}
            onDismiss={handleContinuityDismiss}
          />
        </div>
      )}

      {/* ── 4. TODAY'S MISSIONS ── */}
      {missions.length > 0 && (
        <div
          className="rounded-lg border p-3"
          style={{
            background: CARD_BG,
            borderColor: focusMode.highlightedSections.includes('missions') ? focusMode.accentColor + '60' : CARD_BORDER,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              🎯 {locale === 'es' ? 'Misiones de hoy' : locale === 'pt' ? 'Missões de hoje' : "Today's Missions"}
              <span className="ml-2 text-[11px] font-normal text-slate-400">({missions.length})</span>
            </p>
            <button
              onClick={() => setMissionsCollapsed((v) => !v)}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition px-1"
              title={missionsCollapsed ? 'Expand' : 'Collapse'}
            >
              {missionsCollapsed ? '▶' : '▼'}
            </button>
          </div>
          {!missionsCollapsed && (
            <div className="flex flex-col gap-2">
              {missions.map((mission) => (
                <MissionCard
                  key={mission.id}
                  mission={mission}
                  lang={locale as 'en' | 'es' | 'pt'}
                  onAddToQueue={handleMissionAddToQueue}
                  onDismiss={handleMissionDismiss}
                  onCopyMessage={handleMissionCopyMessage}
                  onWhatsApp={handleMissionWhatsApp}
                  onView={handleMissionView}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 5. OPERATOR TASK QUEUE ── */}
      {pendingTaskItems.length > 0 && (
        <div
          className="rounded-lg border p-3"
          style={{
            background: CARD_BG,
            borderColor: focusMode.highlightedSections.includes('queue') ? focusMode.accentColor + '60' : CARD_BORDER,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              {t('oq.title')}
              <span className="ml-2 text-[11px] font-normal text-slate-400">({pendingTaskItems.length})</span>
            </p>
            <button
              onClick={() => setTaskQueueCollapsed((v) => !v)}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition px-1"
              title={taskQueueCollapsed ? 'Expand' : 'Collapse'}
            >
              {taskQueueCollapsed ? '▶' : '▼'}
            </button>
          </div>
          {!taskQueueCollapsed && (
            <>
              <div className="flex flex-col gap-2">
                {visibleTaskItems.map((item) => (
                  <OperatorTaskCard
                    key={item.id}
                    item={item}
                    lang={locale as 'en' | 'es' | 'pt'}
                    onComplete={handleTaskComplete}
                    onDismiss={handleTaskDismiss}
                    onWhatsApp={handleTaskWhatsApp}
                    onCopyMessage={handleTaskCopyMessage}
                    onView={handleTaskView}
                  />
                ))}
              </div>
              {pendingTaskItems.length > TASK_QUEUE_PREVIEW && (
                <button
                  onClick={() => setShowAllTaskQueue((v) => !v)}
                  className="mt-2 text-[11px] text-slate-400 hover:text-slate-300 transition"
                >
                  {showAllTaskQueue ? t('oq.showLess') : t('oq.showAll')}
                </button>
              )}
            </>
          )}
        </div>
      )}
      </>)}

      {/* ── 6. SECONDARY TOOLS ────────────────────────────────────────────── */}
      {/* Promote panel renders independently of legacy sections when a product is selected */}
      {(showLegacySections || !!selectedProduct) && (
      <div className="grid grid-cols-12 gap-3">

        {/* Promote Inventory */}
        <div ref={promoteRef} className={`${showLegacySections ? 'col-span-12 lg:col-span-6' : 'col-span-12'} rounded-lg border p-3`}
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

        {/* Customer Lookup — legacy sections only */}
        {showLegacySections && (
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
        )}
      </div>
      )}

      {showLegacySections && (
      <div className="flex justify-end">
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="text-xs px-3 py-1.5 rounded border border-surface-700 hover:border-surface-500 text-slate-400 hover:text-slate-300 transition disabled:opacity-50 disabled:cursor-wait"
        >
          🔄 {t('intelligence.refresh')}
        </button>
      </div>
      )}

      {/* ── LIVE OPERATOR BUBBLE ─────────────────────────────────────────────── */}
      <FloatingOperatorBubble
        suggestion={liveSuggestion}
        lang={locale as 'en' | 'es' | 'pt'}
        onAction={handleLiveAction}
        onDismiss={handleLiveDismiss}
      />

      {/* ── PAYMENT VERIFICATION NUDGE ──────────────────────────────────────── */}
      {/* R-INTELLIGENCE-PAYMENT-VERIFY-V1: 2-min delayed reminder card */}
      <PaymentVerificationNudge lang={locale as 'en' | 'es' | 'pt'} />
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

// R-INTELLIGENCE-PROACTIVE-MISSIONS-V1: compact mission card.
const MISSION_TYPE_LABEL: Record<string, { en: string; es: string; pt: string }> = {
  recover_customer: { en: 'Re-engage',   es: 'Reconectar',   pt: 'Reconectar'  },
  vip_outreach:     { en: 'VIP',         es: 'VIP',           pt: 'VIP'         },
  repair_follow_up: { en: 'Follow-up',   es: 'Seguimiento',   pt: 'Acompanhar'  },
  repair_escalate:  { en: 'Escalate',    es: 'Escalar',       pt: 'Escalar'     },
};

// ── Store State Banner ─────────────────────────────────────
// R-INTELLIGENCE-STORE-STATE-V1: compact non-intrusive banner above missions.

const STATE_CONFIG: Record<string, {
  color: string;
  bg: string;
  border: string;
  icon: string;
  label: { en: string; es: string; pt: string };
  focus: { en: string; es: string; pt: string };
}> = {
  slow_day: {
    color: '#93C5FD', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)',
    icon: '🌙',
    label:  { en: 'Slow Day',         es: 'Día lento',         pt: 'Dia lento'       },
    focus:  { en: 'focus on customer outreach', es: 'enfócate en contactar clientes', pt: 'foque em contato com clientes' },
  },
  rush_mode: {
    color: '#FCA5A5', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)',
    icon: '⚡',
    label:  { en: 'Rush Mode',        es: 'Modo rush',         pt: 'Modo rush'       },
    focus:  { en: 'prioritize fast operational actions', es: 'prioriza acciones rápidas', pt: 'priorize ações rápidas' },
  },
  repair_overload: {
    color: '#FCD34D', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)',
    icon: '🔧',
    label:  { en: 'Repair Overload',  es: 'Sobrecarga de reparaciones', pt: 'Sobrecarga de reparos' },
    focus:  { en: 'prioritize repair management', es: 'prioriza el manejo de reparaciones', pt: 'priorize gerenciamento de reparos' },
  },
  collection_mode: {
    color: '#C4B5FD', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.25)',
    icon: '💰',
    label:  { en: 'Collection Mode',  es: 'Modo cobro',        pt: 'Modo cobrança'   },
    focus:  { en: 'focus on payment recovery', es: 'enfócate en cobrar saldos', pt: 'foque em recuperação de pagamentos' },
  },
  opportunity_window: {
    color: '#6EE7B7', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)',
    icon: '🌟',
    label:  { en: 'Opportunity Window', es: 'Ventana de oportunidad', pt: 'Janela de oportunidade' },
    focus:  { en: 'focus on VIP outreach', es: 'enfócate en clientes VIP', pt: 'foque em contato VIP' },
  },
};

function StoreBanner({ state, lang }: { state: StoreStateResult; lang: 'en' | 'es' | 'pt' }) {
  const cfg = STATE_CONFIG[state.state];
  if (!cfg) return null;
  const l = lang === 'pt' ? 'pt' : lang === 'es' ? 'es' : 'en';
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '7px 12px',
      borderRadius: 8,
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
    }}>
      <span style={{ fontSize: 14 }}>{cfg.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: cfg.color, fontWeight: 700, fontSize: 12 }}>
          {cfg.label[l]}
        </span>
        <span style={{ color: '#9CA3AF', fontSize: 11, marginLeft: 4 }}>
          — {cfg.focus[l]}
        </span>
      </div>
      <span style={{
        fontSize: 10,
        color: '#6B7280',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid #374151',
        borderRadius: 4,
        padding: '1px 5px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {state.confidence}%
      </span>
    </div>
  );
}

// ── Command Center Header ──────────────────────────────────
// R-INTELLIGENCE-COMMAND-CENTER-V1: one-sentence operational
// summary above the command flow sections. Uses only existing
// computed data — no new calculations.

const CC_FOCUS: Record<string, Record<string, string>> = {
  balanced:          { en: 'balanced operations',    es: 'operación equilibrada',      pt: 'operação equilibrada' },
  customer_outreach: { en: 'customer outreach',      es: 'contacto con clientes',      pt: 'contato com clientes' },
  fast_operational:  { en: 'fast operations',        es: 'acciones rápidas',           pt: 'ações rápidas' },
  repair_management: { en: 'repair management',      es: 'manejo de reparaciones',     pt: 'gerenciamento de reparos' },
  payment_recovery:  { en: 'payment recovery',       es: 'cobro de pagos',             pt: 'recuperação de pagamentos' },
  vip_outreach:      { en: 'VIP outreach',           es: 'contacto VIP',               pt: 'contato VIP' },
};

const CC_STATE: Record<string, Record<string, string>> = {
  normal:            { en: 'Operations normal',        es: 'Operaciones normales',         pt: 'Operações normais' },
  slow_day:          { en: 'Slow day detected',        es: 'Día lento detectado',           pt: 'Dia lento detectado' },
  rush_mode:         { en: 'Rush mode active',         es: 'Modo rush activo',              pt: 'Modo rush ativo' },
  repair_overload:   { en: 'Repair overload',          es: 'Sobrecarga de reparaciones',    pt: 'Sobrecarga de reparos' },
  collection_mode:   { en: 'Collection mode',          es: 'Modo cobro',                    pt: 'Modo cobrança' },
  opportunity_window:{ en: 'Opportunity window',       es: 'Ventana de oportunidad',         pt: 'Janela de oportunidade' },
};

function CommandCenterHeader({
  storeState, continuityCount, missionCount, queueCount, lang,
}: {
  storeState: StoreStateResult;
  continuityCount: number;
  missionCount: number;
  queueCount: number;
  lang: 'en' | 'es' | 'pt';
}) {
  const l = lang === 'pt' ? 'pt' : lang === 'es' ? 'es' : 'en';
  const stateLabel = CC_STATE[storeState.state]?.[l] ?? storeState.state;
  const focusLabel = CC_FOCUS[storeState.recommendedFocus]?.[l] ?? storeState.recommendedFocus;

  // Build counts phrase (only non-zero counts included)
  const parts: string[] = [];
  if (lang === 'es') {
    if (continuityCount > 0) parts.push(`${continuityCount} pendiente${continuityCount !== 1 ? 's' : ''}`);
    if (missionCount > 0)    parts.push(`${missionCount} ${missionCount !== 1 ? 'misiones' : 'misión'}`);
    if (queueCount > 0)      parts.push(`${queueCount} en cola`);
  } else if (lang === 'pt') {
    if (continuityCount > 0) parts.push(`${continuityCount} pendência${continuityCount !== 1 ? 's' : ''}`);
    if (missionCount > 0)    parts.push(`${missionCount} ${missionCount !== 1 ? 'missões' : 'missão'}`);
    if (queueCount > 0)      parts.push(`${queueCount} na fila`);
  } else {
    if (continuityCount > 0) parts.push(`${continuityCount} pending`);
    if (missionCount > 0)    parts.push(`${missionCount} mission${missionCount !== 1 ? 's' : ''}`);
    if (queueCount > 0)      parts.push(`${queueCount} queued`);
  }

  const countsStr = parts.join(', ');
  const focusPrefix = lang === 'es' ? 'Enfoque' : lang === 'pt' ? 'Foco' : 'Focus';
  const showFocus = storeState.recommendedFocus !== 'balanced' || storeState.state !== 'normal';

  let sentence = stateLabel;
  if (countsStr) sentence += ` — ${countsStr}`;
  if (showFocus) sentence += `. ${focusPrefix}: ${focusLabel}.`;

  const headerLabel = lang === 'es' ? 'Centro de Operaciones' : lang === 'pt' ? 'Central de Operações' : 'Command Center';
  const stateColor = STATE_CONFIG[storeState.state]?.color ?? '#9CA3AF';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      borderRadius: 8,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid #1E293B',
    }}>
      <span style={{ fontSize: 13, flexShrink: 0 }}>🎛️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.07em', marginRight: 8 }}>
          {headerLabel}
        </span>
        <span style={{ fontSize: 12, color: '#D1D5DB' }}>{sentence}</span>
      </div>
      {/* Glanceable count chips — only rendered for non-zero values */}
      <div style={{ display: 'flex', gap: 3, flexShrink: 0, alignItems: 'center' }}>
        {continuityCount > 0 && (
          <span style={{ fontSize: 10, color: '#C4B5FD', background: 'rgba(196,181,253,0.08)', border: '1px solid rgba(196,181,253,0.18)', borderRadius: 4, padding: '1px 5px' }}>
            ↩️ {continuityCount}
          </span>
        )}
        {missionCount > 0 && (
          <span style={{ fontSize: 10, color: stateColor, background: 'rgba(255,255,255,0.04)', border: `1px solid ${stateColor}30`, borderRadius: 4, padding: '1px 5px' }}>
            🎯 {missionCount}
          </span>
        )}
        {queueCount > 0 && (
          <span style={{ fontSize: 10, color: '#818CF8', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 4, padding: '1px 5px' }}>
            📋 {queueCount}
          </span>
        )}
      </div>
    </div>
  );
}

// R-INTELLIGENCE-FOCUS-MODE-V1: small indicator badge shown between Command
// Center and Store Banner. Hidden when mode is 'balanced' (no signal needed).
const FOCUS_LABEL: Record<FocusModeResult['mode'], Record<string, string>> = {
  balanced:        { en: 'Balanced',        es: 'Equilibrado',     pt: 'Equilibrado'    },
  execution_focus: { en: 'Execution Focus', es: 'Modo Ejecución',  pt: 'Foco Execução'  },
  outreach_focus:  { en: 'Outreach Focus',  es: 'Modo Contacto',   pt: 'Foco Contato'   },
  repair_focus:    { en: 'Repair Focus',    es: 'Modo Reparación', pt: 'Foco Reparos'   },
  collection_focus:{ en: 'Collection Focus',es: 'Modo Cobranza',   pt: 'Foco Cobrança'  },
  rush_focus:      { en: 'Rush Mode',       es: 'Modo Rush',       pt: 'Modo Rush'      },
};

function FocusModeIndicator({ focusMode, lang }: { focusMode: FocusModeResult; lang: string }) {
  if (focusMode.mode === 'balanced') return null;
  const l = lang === 'pt' ? 'pt' : lang === 'es' ? 'es' : 'en';
  const label = FOCUS_LABEL[focusMode.mode][l];
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 8px',
      borderRadius: 6,
      background: `${focusMode.accentColor}10`,
      border: `1px solid ${focusMode.accentColor}28`,
    }}>
      <span style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: focusMode.accentColor,
        flexShrink: 0,
        boxShadow: focusMode.isUrgentOverride ? `0 0 4px ${focusMode.accentColor}` : 'none',
      }} />
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        color: focusMode.accentColor,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
    </div>
  );
}

function MissionCard({
  mission, lang, onAddToQueue, onDismiss, onCopyMessage, onWhatsApp, onView,
}: {
  mission: ProactiveMission;
  lang: 'en' | 'es' | 'pt';
  onAddToQueue:  (m: ProactiveMission) => void;
  onDismiss:     (id: string) => void;
  onCopyMessage: (m: ProactiveMission) => void;
  onWhatsApp:    (m: ProactiveMission) => void;
  onView:        (m: ProactiveMission) => void;
}) {
  const typeLabel = (MISSION_TYPE_LABEL[mission.type] ?? { en: mission.type, es: mission.type, pt: mission.type })[lang];
  const urgency = URGENCY_STYLE[mission.urgencyLevel] ?? null;

  return (
    <div className="rounded border p-2.5" style={{ background: '#0A1628', borderColor: urgency?.border ?? '#1E3A5F' }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
            style={{ background: '#1E3A5F', color: '#60A5FA' }}>
            {typeLabel}
          </span>
          {urgency && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
              style={{ background: urgency.bg, color: urgency.text, border: `1px solid ${urgency.border}` }}>
              {urgency.label[lang]}
            </span>
          )}
          <span className="text-[11px] font-semibold text-slate-200 truncate">{mission.title}</span>
        </div>
        <button
          onClick={() => onDismiss(mission.id)}
          className="text-[11px] text-slate-600 hover:text-slate-400 transition shrink-0 leading-none"
          title={lang === 'es' ? 'Descartar 24h' : lang === 'pt' ? 'Descartar 24h' : 'Dismiss 24h'}
        >
          ✕
        </button>
      </div>
      <p className="text-[10px] text-slate-500 mb-2">{mission.reason}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => onAddToQueue(mission)}
          className="px-2 py-0.5 text-[10px] font-semibold rounded transition"
          style={{ background: '#6366F122', color: '#818CF8', border: '1px solid #6366F144' }}>
          + {lang === 'es' ? 'Cola' : lang === 'pt' ? 'Fila' : 'Queue'}
        </button>
        {mission.phone && (
          <button onClick={() => onWhatsApp(mission)}
            className="px-2 py-0.5 text-[10px] font-semibold rounded transition"
            style={{ background: '#25D36622', color: '#25D366', border: '1px solid #25D36644' }}>
            WA
          </button>
        )}
        {mission.suggestedMessage && (
          <button onClick={() => onCopyMessage(mission)}
            className="px-2 py-0.5 text-[10px] rounded transition"
            style={{ background: '#8B5CF622', color: '#A78BFA', border: '1px solid #8B5CF644' }}>
            {lang === 'es' ? 'Copiar' : lang === 'pt' ? 'Copiar' : 'Copy'}
          </button>
        )}
        {mission.relatedEntityId && (
          <button onClick={() => onView(mission)}
            className="px-2 py-0.5 text-[10px] rounded transition"
            style={{ background: '#37415155', color: '#9CA3AF', border: '1px solid #37415188' }}>
            ↗ {lang === 'es' ? 'Ver' : lang === 'pt' ? 'Ver' : 'View'}
          </button>
        )}
      </div>
    </div>
  );
}

// R-INTELLIGENCE-OUTCOME-LEARNING-V1: confidence label style map.
const CONFIDENCE_STYLE: Record<string, { color: string; label: string }> = {
  new:    { color: '#475569', label: 'New'    },
  weak:   { color: '#64748B', label: 'Weak'   },
  proven: { color: '#60A5FA', label: 'Proven' },
  strong: { color: '#34D399', label: 'Strong' },
};

// R-INTELLIGENCE-PRIORITY-ENGINE-V1: urgency badge style map.
const URGENCY_STYLE: Record<string, { bg: string; text: string; border: string; label: { en: string; es: string; pt: string } }> = {
  critical: { bg: '#EF444422', text: '#EF4444', border: '#EF444444', label: { en: 'Critical', es: 'Crítico', pt: 'Crítico' } },
  high:     { bg: '#F59E0B22', text: '#F59E0B', border: '#F59E0B44', label: { en: 'High',     es: 'Alto',    pt: 'Alto'    } },
  medium:   { bg: '#6366F122', text: '#818CF8', border: '#6366F144', label: { en: 'Medium',   es: 'Medio',   pt: 'Médio'   } },
  low:      { bg: '#6B728022', text: '#9CA3AF', border: '#37415155', label: { en: 'Low',      es: 'Bajo',    pt: 'Baixo'   } },
};

// R-INTELLIGENCE-OPERATOR-QUEUE-V1: compact card for operator task queue items.
const TASK_TYPE_LABEL: Record<string, { en: string; es: string; pt: string }> = {
  recover_customer:  { en: 'Re-engage',   es: 'Reconectar',   pt: 'Reconectar' },
  vip_outreach:      { en: 'VIP',          es: 'VIP',           pt: 'VIP' },
  product_promotion: { en: 'Promo',        es: 'Promo',         pt: 'Promo' },
  repair_follow_up:  { en: 'Follow-up',    es: 'Seguimiento',   pt: 'Acompanhar' },
  repair_escalate:   { en: 'Escalate',     es: 'Escalar',       pt: 'Escalar' },
  repair_waiting:    { en: 'Waiting',      es: 'En espera',     pt: 'Aguardando' },
};

function OperatorTaskCard({
  item, lang, onComplete, onDismiss, onWhatsApp, onCopyMessage, onView,
}: {
  item: OperatorQueueItem;
  lang: 'en' | 'es' | 'pt';
  onComplete:     (id: string) => void;
  onDismiss:      (id: string) => void;
  onWhatsApp:     (item: OperatorQueueItem) => void;
  onCopyMessage:  (item: OperatorQueueItem) => void;
  onView:         (item: OperatorQueueItem) => void;
}) {
  const typeLabel = (TASK_TYPE_LABEL[item.type] ?? { en: item.type, es: item.type, pt: item.type })[lang];
  const age = relativeTime(item.createdAt);
  const urgency = item.urgencyLevel ? (URGENCY_STYLE[item.urgencyLevel] ?? null) : null;
  const confidence = item.confidenceLabel ? (CONFIDENCE_STYLE[item.confidenceLabel] ?? null) : null;

  return (
    <div className="rounded border p-2.5" style={{ background: '#0D1B2A', borderColor: urgency?.border ?? '#1E3A5F' }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <span
            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
            style={{ background: '#1E3A5F', color: '#60A5FA' }}
          >
            {typeLabel}
          </span>
          {urgency && (
            <span
              className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
              style={{ background: urgency.bg, color: urgency.text, border: `1px solid ${urgency.border}` }}
            >
              {urgency.label[lang]}
            </span>
          )}
          {confidence && (
            <span className="text-[8px] font-medium shrink-0" style={{ color: confidence.color }}>
              {confidence.label}
            </span>
          )}
          <span className="text-[11px] font-semibold text-slate-200 truncate">{item.summary}</span>
        </div>
        <span className="text-[10px] text-slate-500 shrink-0">{age}</span>
      </div>
      {item.impactReason && (
        <p className="text-[10px] text-slate-500 mb-1">{item.impactReason}</p>
      )}
      {item.suggestedMessage && (
        <p className="text-[11px] text-slate-400 italic mb-2 line-clamp-2">{item.suggestedMessage}</p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => onComplete(item.id)}
          className="px-2 py-0.5 text-[10px] font-semibold rounded transition"
          style={{ background: '#10B98122', color: '#10B981', border: '1px solid #10B98144' }}
        >
          ✓ {lang === 'es' ? 'Completar' : lang === 'pt' ? 'Concluir' : 'Complete'}
        </button>
        {item.phone && (
          <button
            onClick={() => onWhatsApp(item)}
            className="px-2 py-0.5 text-[10px] font-semibold rounded transition"
            style={{ background: '#25D36622', color: '#25D366', border: '1px solid #25D36644' }}
          >
            WA
          </button>
        )}
        {item.suggestedMessage && (
          <button
            onClick={() => onCopyMessage(item)}
            className="px-2 py-0.5 text-[10px] rounded transition"
            style={{ background: '#6366F122', color: '#818CF8', border: '1px solid #6366F144' }}
          >
            {lang === 'es' ? 'Copiar' : lang === 'pt' ? 'Copiar' : 'Copy'}
          </button>
        )}
        {item.relatedEntityId && (
          <button
            onClick={() => onView(item)}
            className="px-2 py-0.5 text-[10px] rounded transition"
            style={{ background: '#8B5CF622', color: '#A78BFA', border: '1px solid #8B5CF644' }}
          >
            ↗ {lang === 'es' ? 'Ver' : lang === 'pt' ? 'Ver' : 'View'}
          </button>
        )}
        <button
          onClick={() => onDismiss(item.id)}
          className="px-2 py-0.5 text-[10px] rounded transition"
          style={{ background: '#37415155', color: '#9CA3AF', border: '1px solid #37415188' }}
        >
          {lang === 'es' ? 'Descartar' : lang === 'pt' ? 'Descartar' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}

// R-INTELLIGENCE-ROLE-ROUTING-V1: compact collapsed section pill.
// Shows when a section is role-suppressed. One click expands it.
function CollapsedSectionPill({
  icon, label, count, onExpand,
}: {
  icon: string;
  label: string;
  count: number;
  onExpand: () => void;
}) {
  return (
    <button
      onClick={onExpand}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        background: '#111827',
        border: '1px solid #1F2937',
        borderRadius: 6,
        padding: '5px 10px',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 11, color: '#4B5563' }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: '#4B5563', flex: 1 }}>{label}</span>
      <span style={{
        fontSize: 9,
        color: '#374151',
        background: '#1F2937',
        borderRadius: 3,
        padding: '1px 5px',
        fontWeight: 700,
      }}>
        {count}
      </span>
      <span style={{ fontSize: 10, color: '#374151' }}>▶</span>
    </button>
  );
}

// R-INTELLIGENCE-ROLE-ROUTING-V1: inline collapse row above expanded suppressed sections.
function SectionCollapseRow({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
      <button
        onClick={onCollapse}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 9,
          color: '#374151',
          padding: '0 2px',
          fontWeight: 600,
          letterSpacing: '0.03em',
        }}
      >
        ▼ collapse
      </button>
    </div>
  );
}

// R-INTELLIGENCE-ROLE-ROUTING-V1: compact role badge chip.
// Only visible for non-owner roles; owner is the default solo-operator mode.
function RoleBadge({ role, lang }: { role: import('@/services/intelligence/routing/roleIntelligenceRouting').OperatorRole; lang: string }) {
  if (role === 'owner') return null;

  const ROLE_LABEL: Record<string, Record<string, string>> = {
    employee: { en: 'Employee View', es: 'Vista Empleado', pt: 'Vista Funcionário' },
    manager:  { en: 'Manager View',  es: 'Vista Gerente',  pt: 'Vista Gerente'     },
  };
  const l = lang === 'pt' ? 'pt' : lang === 'es' ? 'es' : 'en';
  const label = ROLE_LABEL[role]?.[l] ?? '';

  const ROLE_COLOR: Record<string, string> = {
    employee: '#6B7280',
    manager:  '#8B5CF6',
  };
  const color = ROLE_COLOR[role] ?? '#6B7280';

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 8px',
      borderRadius: 6,
      background: `${color}10`,
      border: `1px solid ${color}28`,
    }}>
      <span style={{ fontSize: 9, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
    </div>
  );
}
