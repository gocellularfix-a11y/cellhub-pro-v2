// ============================================================
// CellHub Pro — Floating Operator Bubble
// Combined ledger:
//   V1            — draggable shortcut, position persistence
//   AWARE-V1      — activity-aware hint pipeline + bridge events
//   OVERLAY-V2    — left-click opens a mini overlay anchored to the
//                   bubble. Navigation to Intelligence is now an
//                   explicit action *inside* the overlay.
//
// The bubble itself never navigates anymore. It stays on the
// current screen, surfaces a short contextual hint when the rules
// engine produces one, and lets the cashier choose whether to drill
// into Intelligence via the overlay's "Open Full Intelligence" button.
// ============================================================

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import {
  computeHintFromEvent,
  computeHintFromGlobalState,
  computeInsightsForContext,
  computeOperatorContextFromEvent,
  computeOperatorContextFromGlobalState,
  OPERATOR_ACTIVITY_EVENT,
  type OperatorActiveContext,
  type OperatorActivityEventDetail,
  type OperatorActivityInputs,
  type OperatorBubbleState,
  type OperatorHint,
  type OperatorInsight,
  type OperatorInsightTone,
} from '@/services/operator/operatorActivityHints';
import { getContext, subscribe } from '@/services/intelligence/liveContext/liveContextStore';
import { initLiveContextEngine, syncFromAppState } from '@/services/intelligence/liveContext/liveContextEngine';
import { computeContextSuggestions, getMinimizedPreviewText } from '@/services/intelligence/liveContext/contextSuggestions';
import type { LiveContext } from '@/services/intelligence/liveContext/contextTypes';
import { getCustomerBusinessProfile } from '@/services/intelligence/customerScoring/customerScoringSelectors';
import type { CustomerBusinessProfile, CustomerTier } from '@/services/intelligence/customerScoring/customerScoringTypes';
import { buildActionExecutionContext } from '@/services/intelligence/actionExecution/actionExecutionContext';
import { resolveSuggestionActions } from '@/services/intelligence/actionExecution/actionExecutionEngine';
import { logBubbleAction } from '@/services/intelligence/actionExecution/actionExecutionQueue';
import type { OperatorExecutableAction } from '@/services/intelligence/actionExecution/actionExecutionTypes';
import {
  getPendingWorkflows,
  getPendingExternalPaymentWorkflow,
  completeWorkflow,
  cancelWorkflow,
  subscribeWorkflowContinuity,
} from '@/services/intelligence/workflowContinuity/workflowContinuityStore';
import { initExternalFlowAwareness, subscribeExternalFlowReturn, resetReturnCooldown } from '@/services/intelligence/workflowContinuity/externalFlowAwareness';
import type { PendingWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';

// ── Constants ─────────────────────────────────────────────
const POSITION_KEY = 'cellhub:operatorBubble:position:v1';
const ENABLED_KEY  = 'cellhub:operatorBubble:enabled:v1';
const BUBBLE_SIZE  = 110;         // R-COMPANION-BUBBLE-REDESIGN: 72 → 110 px (iridescent orb)
const OVERLAY_WIDTH = 296;
const DRAG_THRESHOLD_PX = 5;
const EDGE_PADDING = 16;
const Z_INDEX = 880;
const ACTIVITY_DEBOUNCE_MS = 300;
const HINT_AUTO_DISMISS_MS = 6_000;
const KEYFRAMES_STYLE_ID = 'cellhub-operator-bubble-keyframes';

interface Position { x: number; y: number; }

// ── Local helpers ─────────────────────────────────────────
function defaultPosition(): Position {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: Math.max(EDGE_PADDING, window.innerWidth  - BUBBLE_SIZE - 24),
    y: Math.max(EDGE_PADDING, window.innerHeight - BUBBLE_SIZE - 24),
  };
}

function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch { /* corrupt JSON — fall through */ }
  return null;
}

function loadEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw === null) return true;
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

function clampToViewport(p: Position): Position {
  if (typeof window === 'undefined') return p;
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: Math.max(EDGE_PADDING, Math.min(w - BUBBLE_SIZE - EDGE_PADDING, p.x)),
    y: Math.max(EDGE_PADDING, Math.min(h - BUBBLE_SIZE - EDGE_PADDING, p.y)),
  };
}

// One-time CSS keyframes injection. Idempotent via id check.
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_STYLE_ID;
  style.textContent = `
/* R-COMPANION-BUBBLE-REDESIGN: iridescent orb keyframes. The float
   amplitude bumped 3px → 8px to give the bubble a clear "alive" lift.
   Hue-rotate filters drive the iridescent shimmer per state — the
   linearGradient stops stay constant, the filter swivels them. */
@keyframes cellhubOperatorBubbleFloat {
  0%, 100% { transform: translateY(0px);  }
  50%      { transform: translateY(-8px); }
}
@keyframes cellhubOperatorIdleHue {
  0%, 100% { filter: hue-rotate(0deg)  brightness(1);    }
  50%      { filter: hue-rotate(25deg) brightness(1.05); }
}
@keyframes cellhubOperatorThinkHue {
  from { filter: hue-rotate(0deg);   }
  to   { filter: hue-rotate(360deg); }
}
@keyframes cellhubOperatorHintHue {
  0%, 100% { filter: hue-rotate(0deg);  }
  50%      { filter: hue-rotate(15deg); }
}
@keyframes cellhubOperatorStatusDotPulse {
  0%, 100% { transform: scale(1);   }
  50%      { transform: scale(1.4); }
}
@keyframes cellhubOperatorPulseRing {
  0%   { transform: scale(0.92); opacity: 0.65; }
  70%  { transform: scale(1.28); opacity: 0;    }
  100% { transform: scale(1.28); opacity: 0;    }
}
@keyframes cellhubOperatorOverlayIn {
  0%   { opacity: 0; transform: translateY(-4px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0)    scale(1);    }
}
/* R-COMPANION-BUBBLE-REDESIGN: hover lift via attribute selector
   so inline style keeps owning the float animation. The selector
   excludes the active state so press-and-drag doesn't double the
   transform with the drag offset. */
button[data-cellhub-operator-bubble="true"]:hover:not(:active) {
  transform: scale(1.06);
}
`;
  document.head.appendChild(style);
}

function stateColor(s: OperatorBubbleState): string {
  switch (s) {
    case 'sleeping': return '#475569';
    case 'watching': return '#38bdf8';
    case 'thinking': return '#a78bfa';
    case 'ready':    return '#22c55e';
    case 'alert':    return '#ef4444';
  }
}

// ── Component ─────────────────────────────────────────────
export default function FloatingOperatorBubble() {
  const { state, dispatch } = useApp();
  const {
    activeTab, cart, customers, sales, layaways, repairs,
    currentEmployee,
    pendingPosCustomer, pendingPhonePaymentCustomerId, pendingBarcodeInvoice,
    unlocks,
  } = state;
  const { t, locale } = useTranslation();

  // SVG <defs> ids must be globally unique. useId() returns a stable
  // per-instance string; we sanitise out non-id-safe characters (React
  // 18 emits ':' which CSS url() references tolerate in evergreen
  // browsers but not in older renderers). R-COMPANION-BUBBLE-REDESIGN
  // reuses this id for the bubble's three gradient defs (fill, rim,
  // specular).
  const reactInstanceId = useId().replace(/[^a-zA-Z0-9]/g, '');

  // ── Position + drag ────────────────────────────────────
  const [position, setPosition] = useState<Position>(() =>
    clampToViewport(loadPosition() || defaultPosition())
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const movedRef = useRef(false);

  // ── Awareness state ────────────────────────────────────
  const [enabled, setEnabled] = useState<boolean>(() => loadEnabled());
  const [bubbleState, setBubbleState] = useState<OperatorBubbleState>('sleeping');
  const [hint, setHint] = useState<OperatorHint | null>(null);
  // R-OPERATOR-ACTIVITY-CONTEXT-V1: persistent context survives the
  // hint's auto-dismiss timer so the overlay still has something useful
  // to show when the cashier opens it minutes after the original ping.
  const [activeContext, setActiveContext] = useState<OperatorActiveContext | null>(null);
  // Brief "Copied!" flash after the Copy-Phone quick action.
  const [copiedFlash, setCopiedFlash] = useState(false);

  // ── Workflow continuity (R-INTELLIGENCE-WORKFLOW-CONTINUITY-V1) ────
  const [pendingWorkflows, setPendingWorkflows] = useState<PendingWorkflow[]>(() => getPendingWorkflows());
  const [returnDetected, setReturnDetected] = useState(false);

  // ── Live context (R-INTELLIGENCE-LIVE-CONTEXT-V1) ──────
  const [liveCtx, setLiveCtx] = useState<LiveContext>(() => getContext());
  const [previewTick, setPreviewTick] = useState(0);

  // ── Overlay (V2) ───────────────────────────────────────
  // Replaces the V1-AWARE right-click menu. Toggled by left-click
  // (post-drag-detection). Always closes on outside-click or ESC.
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOnIntelligence = activeTab === 'intelligence';

  // ── Inputs snapshot for the rules engine ───────────────
  const inputs: OperatorActivityInputs = useMemo(() => ({
    activeTab,
    cart,
    customers,
    sales,
    layaways,
    repairs,
    pendingPosCustomer,
    pendingPhonePaymentCustomerId,
    pendingBarcodeInvoice,
  }), [activeTab, cart, customers, sales, layaways, repairs, pendingPosCustomer, pendingPhonePaymentCustomerId, pendingBarcodeInvoice]);

  const inputsRef = useRef(inputs);
  useEffect(() => { inputsRef.current = inputs; }, [inputs]);

  // ── Click toggles overlay (V2) ────────────────────────
  // Left-click that survived drag-detection opens/closes the overlay.
  // Right-click is suppressed so the OS context menu doesn't appear,
  // but it doesn't open anything either — the overlay is the single
  // discovery surface for controls.
  const toggleOverlay = useCallback(() => {
    setIsOverlayOpen((v) => !v);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartRef.current = { mx: e.clientX, my: e.clientY, px: position.x, py: position.y };
    movedRef.current = false;
  }, [position]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    // Suppress the browser's native right-click menu. Don't open anything;
    // the overlay (left-click) is the canonical control surface.
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.mx;
      const dy = e.clientY - start.my;
      if (!movedRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        movedRef.current = true;
        setIsDragging(true);
        // If the overlay was open when drag started, close it so the
        // user isn't dragging the bubble out from under their UI.
        setIsOverlayOpen(false);
      }
      if (movedRef.current) {
        setPosition(clampToViewport({ x: start.px + dx, y: start.py + dy }));
      }
    };
    const onUp = () => {
      const start = dragStartRef.current;
      if (!start) return;
      dragStartRef.current = null;
      if (movedRef.current) {
        setIsDragging(false);
        setPosition((p) => {
          try { localStorage.setItem(POSITION_KEY, JSON.stringify(p)); } catch { /* ignore */ }
          return p;
        });
      } else {
        toggleOverlay();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [toggleOverlay]);

  // ── Resize clamp ───────────────────────────────────────
  useEffect(() => {
    const onResize = () => setPosition((p) => clampToViewport(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Keyframes (one-time) ──────────────────────────────
  useEffect(() => { ensureKeyframes(); }, []);

  // ── Live context engine — init once on mount ───────────
  useEffect(() => { initLiveContextEngine(); }, []);

  // ── Live context store — subscribe for re-renders ──────
  useEffect(() => subscribe(setLiveCtx), []);

  // ── Workflow continuity store — subscribe for re-renders ─
  useEffect(() => {
    setPendingWorkflows(getPendingWorkflows());
    return subscribeWorkflowContinuity(() => setPendingWorkflows(getPendingWorkflows()));
  }, []);

  // ── External flow awareness — detect portal return ────────
  useEffect(() => {
    const cleanupAwareness = initExternalFlowAwareness();
    const unsubReturn = subscribeExternalFlowReturn(() => {
      if (getPendingExternalPaymentWorkflow()) {
        setReturnDetected(true);
        setIsOverlayOpen(true);
      }
    });
    return () => { cleanupAwareness(); unsubReturn(); };
  }, []);

  // ── Sync AppState → live context store ─────────────────
  useEffect(() => {
    syncFromAppState({
      activeTab,
      currentEmployee,
      cart,
      customers,
      pendingPhonePaymentCustomerId,
      pendingPosCustomer,
    });
  }, [activeTab, currentEmployee, cart, customers, pendingPhonePaymentCustomerId, pendingPosCustomer]);

  // ── Rotate preview badge text every 4 s ────────────────
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setPreviewTick((t) => t + 1), 4000);
    return () => clearInterval(id);
  }, [enabled]);

  // ── Hint pipeline (disable cleanup) ───────────────────
  useEffect(() => {
    if (!enabled) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (dismissRef.current)  clearTimeout(dismissRef.current);
      setHint(null);
      setActiveContext(null);
      setBubbleState('sleeping');
    }
  }, [enabled]);

  // Global-state derived hints, debounced.
  useEffect(() => {
    if (!enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (dismissRef.current)  clearTimeout(dismissRef.current);

    // Context derivation runs alongside the hint pipeline. Returns null
    // when global state doesn't carry a context-worthy signal — in that
    // case we keep the prior context (user may still be working on it
    // even though no fresh ping is firing).
    const ctx = computeOperatorContextFromGlobalState(inputs);
    if (ctx) setActiveContext(ctx);

    const next = computeHintFromGlobalState(inputs);
    if (!next) {
      setHint(null);
      setBubbleState('sleeping');
      return;
    }

    setBubbleState('watching');
    debounceRef.current = setTimeout(() => {
      setHint(next);
      setBubbleState(next.severity === 'alert' ? 'alert' : 'ready');
      dismissRef.current = setTimeout(() => {
        setHint(null);
        setBubbleState('sleeping');
      }, HINT_AUTO_DISMISS_MS);
    }, ACTIVITY_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (dismissRef.current)  clearTimeout(dismissRef.current);
    };
  }, [enabled, inputs]);

  // Bridge events.
  useEffect(() => {
    if (!enabled) return;
    const onActivity = (e: Event) => {
      const detail = (e as CustomEvent<OperatorActivityEventDetail>).detail;
      // Context first — independent of hint, longer-lived. Helper
      // returns null when the event lacks context-worthy signal (e.g.
      // unknown phone number) so prior context is preserved.
      const ctx = computeOperatorContextFromEvent(detail || null, inputsRef.current);
      if (ctx) setActiveContext(ctx);

      const next = computeHintFromEvent(detail || null, inputsRef.current);
      if (!next) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (dismissRef.current)  clearTimeout(dismissRef.current);
      setBubbleState('watching');
      debounceRef.current = setTimeout(() => {
        setHint(next);
        setBubbleState(next.severity === 'alert' ? 'alert' : 'ready');
        dismissRef.current = setTimeout(() => {
          setHint(null);
          setBubbleState('sleeping');
        }, HINT_AUTO_DISMISS_MS);
      }, ACTIVITY_DEBOUNCE_MS);
    };
    window.addEventListener(OPERATOR_ACTIVITY_EVENT, onActivity as EventListener);
    return () => window.removeEventListener(OPERATOR_ACTIVITY_EVENT, onActivity as EventListener);
  }, [enabled]);

  // Click-outside-to-close + ESC for the overlay.
  useEffect(() => {
    if (!isOverlayOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-cellhub-operator-overlay]')) return;
      if (target?.closest?.('[data-cellhub-operator-bubble]')) return;
      setIsOverlayOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOverlayOpen(false);
    };
    window.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOverlayOpen]);

  // ── Overlay actions ───────────────────────────────────
  const toggleEnabled = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      try { localStorage.setItem(ENABLED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const dismissHintNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (dismissRef.current)  clearTimeout(dismissRef.current);
    setHint(null);
    setBubbleState('sleeping');
  }, []);

  const openFullIntelligence = useCallback(() => {
    setIsOverlayOpen(false);
    if (!isOnIntelligence) {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'intelligence' });
    }
  }, [isOnIntelligence, dispatch]);

  const resetPosition = useCallback(() => {
    const next = defaultPosition();
    setPosition(next);
    try { localStorage.removeItem(POSITION_KEY); } catch { /* ignore */ }
    setIsOverlayOpen(false);
  }, []);

  // R-OPERATOR-ACTIVITY-CONTEXT-V1 quick actions ────────────
  const copyContextPhone = useCallback(() => {
    const phone = activeContext?.phone || '';
    if (!phone) return;
    try {
      void navigator.clipboard?.writeText(phone);
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 1500);
    } catch { /* clipboard unavailable — silent */ }
  }, [activeContext]);

  const viewCustomerHistory = useCallback(() => {
    if (!activeContext?.customerId) return;
    const customerId = activeContext.customerId;
    setIsOverlayOpen(false);
    // R-OPERATOR-VIEW-HISTORY-DIRECT-V1: open the actual history modal
    // instead of just filtering the customers list. Navigate to the
    // Customers tab so CustomerModule mounts, then dispatch the open
    // event with a small defer (same 80 ms timing BarcodeActionModal
    // uses for goToReturns) so the listener has attached.
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'customers' });
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('cellhub:open-customer-history', {
          detail: { customerId },
        }));
      } catch { /* environments without CustomEvent — silent */ }
    }, 80);
  }, [activeContext, dispatch]);

  const clearContext = useCallback(() => {
    setActiveContext(null);
  }, []);

  // R-OPERATOR-AMBIENT-AWARENESS-V1: Create Customer quick action for
  // unknown_phone context. Navigates to Customers tab, dispatches the
  // open-new-customer-form event (with the phone payload prefilled),
  // and silently copies the phone to clipboard as belt-and-suspenders
  // in case the cashier wants to paste it elsewhere.
  const createCustomerFromContext = useCallback(() => {
    const phone = activeContext?.phone || '';
    if (!phone) return;
    setIsOverlayOpen(false);
    try { void navigator.clipboard?.writeText(phone); } catch { /* ignore */ }
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'customers' });
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('cellhub:open-new-customer-form', {
          detail: { phone },
        }));
      } catch { /* environments without CustomEvent — silent */ }
    }, 80);
  }, [activeContext, dispatch]);

  // Memoise insights so the rules engine runs only when context or
  // the input slices it reads from actually change. Empty list when
  // no context — overlay simply omits the section.
  const insights: OperatorInsight[] = useMemo(
    () => enabled ? computeInsightsForContext(activeContext, inputs) : [],
    [enabled, activeContext, inputs],
  );

  // Active customer business profile — computed only when a customer is active.
  // Memoized on the customer id + array references so it does not recompute
  // on every preview-tick rotation (which changes only previewTick, not these deps).
  const activeCustomerProfile = useMemo<CustomerBusinessProfile | null>(() => {
    const custId = liveCtx.activeCustomer?.id;
    if (!custId || !enabled) return null;
    return getCustomerBusinessProfile(custId, customers, sales, repairs, layaways, unlocks ?? []);
  }, [liveCtx.activeCustomer?.id, customers, sales, repairs, layaways, unlocks, enabled]);

  // Live-context suggestions and badge preview text.
  const suggestions = useMemo(
    () => enabled ? computeContextSuggestions(liveCtx, inputs, activeCustomerProfile ?? undefined) : [],
    [enabled, liveCtx, inputs, activeCustomerProfile],
  );

  const previewText = useMemo(
    () => enabled ? getMinimizedPreviewText(liveCtx, inputs, previewTick, activeCustomerProfile ?? undefined) : '',
    [enabled, liveCtx, inputs, previewTick, activeCustomerProfile],
  );

  // Action execution context — built from bubble runtime state.
  // Resolves effective customer from liveCtx (preferred) or activeContext (fallback).
  const execCtx = useMemo(
    () => buildActionExecutionContext(
      dispatch as (action: { type: string; payload?: unknown }) => void,
      liveCtx.activeCustomer?.id ?? activeContext?.customerId ?? null,
      customers,
      repairs,
      layaways,
      activeCustomerProfile,
    ),
    // dispatch is stable; the rest are reactive deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveCtx.activeCustomer?.id, activeContext?.customerId, customers, repairs, layaways, activeCustomerProfile],
  );

  // Pair each suggestion with its canExecute-filtered action buttons.
  const suggestionsWithActions = useMemo(
    () => resolveSuggestionActions(suggestions, execCtx),
    [suggestions, execCtx],
  );

  // Tracks which suggestion's action was last clicked (for "Opened" flash).
  const [flashedSuggId, setFlashedSuggId] = useState<string | null>(null);

  // Execute a bubble action: run it, log it, flash feedback, close overlay.
  // Declared after execCtx so the dep array reference is valid.
  const handleActionClick = useCallback((
    action: OperatorExecutableAction,
    suggestionId: string,
  ) => {
    try { action.execute(execCtx); } catch { /* safe — never throw */ }
    logBubbleAction(action.id, execCtx.customerId, suggestionId);
    setFlashedSuggId(suggestionId);
    setTimeout(() => {
      setFlashedSuggId(null);
      setIsOverlayOpen(false);
    }, 700);
  }, [execCtx]);

  // ── Workflow continuity derived state + handlers ───────────────────────────

  const pendingExternalPayment = pendingWorkflows.find(
    (w) => w.type === 'external_payment' && w.status === 'pending',
  ) ?? null;

  // Cashier confirmed they completed the carrier payment — dispatch event to
  // PhonePaymentModal, complete the workflow, and reset detection state.
  // NEVER auto-records revenue. Human click is the only trigger.
  const handleConfirmExternalPaid = useCallback(() => {
    if (!pendingExternalPayment) return;
    completeWorkflow(pendingExternalPayment.id);
    try {
      window.dispatchEvent(new CustomEvent('cellhub:workflow-external-payment-confirm'));
    } catch { /* non-CustomEvent environment — silent */ }
    resetReturnCooldown();
    setReturnDetected(false);
    setIsOverlayOpen(false);
  }, [pendingExternalPayment]);

  // Cashier says payment is still processing — dismiss the card but keep
  // the workflow pending so it can be re-surfaced on next return.
  const handleExternalStillProcessing = useCallback(() => {
    resetReturnCooldown();
    setReturnDetected(false);
  }, []);

  // Cashier explicitly cancels — mark workflow cancelled and dismiss.
  const handleCancelExternalPayment = useCallback(() => {
    if (!pendingExternalPayment) return;
    cancelWorkflow(pendingExternalPayment.id);
    resetReturnCooldown();
    setReturnDetected(false);
  }, [pendingExternalPayment]);

  const insightToneColor = (tone: OperatorInsightTone): string => {
    switch (tone) {
      case 'positive': return '#22c55e';
      case 'warning':  return '#f59e0b';
      case 'info':
      default:         return '#a5b4fc';
    }
  };

  // Tier badge colour helper — maps CustomerTier to a small inline pill style.
  const tierBadgeColors = useMemo<{ bg: string; color: string } | null>(() => {
    const tier: CustomerTier | undefined = activeCustomerProfile?.estimatedCustomerTier;
    if (!tier || tier === 'Casual') return null; // Casual = no badge (not notable)
    const map: Record<CustomerTier, { bg: string; color: string }> = {
      VIP:      { bg: 'rgba(245,158,11,0.20)',  color: '#f59e0b' },
      Loyal:    { bg: 'rgba(129,140,248,0.20)', color: '#818cf8' },
      Active:   { bg: 'rgba(34,197,94,0.18)',   color: '#4ade80' },
      'At Risk':{ bg: 'rgba(249,115,22,0.20)',  color: '#f97316' },
      Lost:     { bg: 'rgba(239,68,68,0.20)',   color: '#f87171' },
      Casual:   { bg: 'transparent',            color: 'transparent' },
    };
    return map[tier] ?? null;
  }, [activeCustomerProfile]);

  // Override the badge preview text when a carrier payment is awaiting confirmation.
  const effectivePreviewText = (pendingExternalPayment && returnDetected)
    ? (locale === 'es' ? 'Confirmar pago del carrier' : 'Confirm carrier payment')
    : previewText;

  // ── Render decisions ───────────────────────────────────
  const tooltip = isOverlayOpen
    ? t('operator.bubble.closeTooltip')
    : t('operator.bubble.openTooltip');

  const hintText = hint
    ? (t as (k: string, ...a: Array<string | number>) => string)(hint.i18nKey, ...hint.args)
    : '';

  // Overlay & pill flip side based on which half of the viewport the
  // bubble currently sits in. Pure viewport math — no DOM scans.
  const pillOnLeft = typeof window !== 'undefined'
    ? position.x + BUBBLE_SIZE / 2 > window.innerWidth / 2
    : true;

  // Hint pill is a passive ambient surface. It hides while the overlay
  // is open (overlay shows the same hint inside its body).
  const showPill = enabled && bubbleState === 'ready' && !!hintText && !isDragging && !isOverlayOpen;
  const showRing = enabled && (bubbleState === 'ready' || bubbleState === 'alert');

  const statusLabel = t(`operator.status.${enabled ? bubbleState : 'sleeping'}`);

  // R-COMPANION-BUBBLE-REDESIGN: collapse the existing 5-state bubble
  // into the 3 visual modes the new iridescent orb supports.
  //   sleeping / watching → 'idle'      (soft blue/purple/pink rim)
  //   thinking            → 'thinking'  (saturated rim + full hue spin)
  //   ready / alert       → 'hint'      (green rim + hint ring)
  // Bubble state stays the canonical state — this is only a render
  // discriminator so the SVG can stay declarative.
  const visualMode: 'idle' | 'thinking' | 'hint' =
    !enabled                                           ? 'idle'
    : bubbleState === 'thinking'                       ? 'thinking'
    : (bubbleState === 'ready' || bubbleState === 'alert') ? 'hint'
    : 'idle';

  // Status-dot palette — distinct from the iridescent rim so the dot
  // reads cleanly against any state. Idle = blue, thinking = purple,
  // hint = green.
  const dotPalette =
    visualMode === 'thinking' ? { bg: '#a78bfa', shadow: '0 0 10px #a78bfa' }
    : visualMode === 'hint'   ? { bg: '#34d399', shadow: '0 0 12px #34d399' }
    :                            { bg: '#93c5fd', shadow: '0 0 8px #93c5fd'  };
  const dotAnim =
    visualMode === 'thinking' ? 'cellhubOperatorStatusDotPulse 1s ease-in-out infinite'
    : visualMode === 'hint'   ? 'cellhubOperatorStatusDotPulse 1.8s ease-in-out infinite'
    : 'none';

  // R-COMPANION-BUBBLE-REDESIGN: the button itself is now transparent.
  // The iridescent orb SVG below owns 100% of the visual; the old
  // radial-gradient backgrounds (overlay-open / intelligence-active /
  // default) are gone.

  // R-COMPANION-BUBBLE-REDESIGN: per-state filter animation. Composed
  // with the always-on float so the bubble shimmers and lifts at the
  // same time. Drag suspends both (handled inline).
  const filterAnim =
    visualMode === 'thinking' ? 'cellhubOperatorThinkHue 1.8s linear infinite'
    : visualMode === 'hint'   ? 'cellhubOperatorHintHue 3s ease-in-out infinite'
    : 'cellhubOperatorIdleHue 5s ease-in-out infinite';

  // Linear-gradient rim stops vary per visual mode.
  const rimStops =
    visualMode === 'thinking' ? [
      { o: '0%',   c: '#80b0ff', a: 0.65 },
      { o: '30%',  c: '#c080ff', a: 0.75 },
      { o: '60%',  c: '#ff90c0', a: 0.60 },
      { o: '85%',  c: '#80e0ff', a: 0.65 },
      { o: '100%', c: '#9080ff', a: 0.65 },
    ]
    : visualMode === 'hint' ? [
      { o: '0%',   c: '#60e8b0', a: 0.70 },
      { o: '30%',  c: '#80d0ff', a: 0.65 },
      { o: '60%',  c: '#a0ffe0', a: 0.60 },
      { o: '85%',  c: '#40d8a0', a: 0.75 },
      { o: '100%', c: '#60e8b0', a: 0.70 },
    ]
    : [
      { o: '0%',   c: '#a0c8ff', a: 0.55 },
      { o: '25%',  c: '#d4a0ff', a: 0.65 },
      { o: '50%',  c: '#ffb8d4', a: 0.50 },
      { o: '75%',  c: '#a0e8ff', a: 0.60 },
      { o: '100%', c: '#c0a8ff', a: 0.55 },
    ];

  // Specular tint per mode — mirrors the rim's dominant hue.
  const specularTint =
    visualMode === 'thinking' ? '#c080ff'
    : visualMode === 'hint'   ? '#80d0ff'
    :                            '#d4a0ff';

  // Interior fill colour (very low opacity) per mode.
  const fillTint =
    visualMode === 'thinking' ? '#9080ff'
    : visualMode === 'hint'   ? '#60e8b0'
    :                            '#a0c8ff';

  // Overlay vertical anchor: prefer below the bubble, but flip above
  // when the bubble is near the bottom edge so the panel stays on-screen.
  const overlayBelow = typeof window !== 'undefined'
    ? position.y + BUBBLE_SIZE + 8 + 220 < window.innerHeight - EDGE_PADDING
    : true;
  const overlayTop = overlayBelow
    ? position.y + BUBBLE_SIZE + 8
    : Math.max(EDGE_PADDING, position.y - 220 - 8);
  const overlayLeft = pillOnLeft
    ? Math.max(EDGE_PADDING, position.x + BUBBLE_SIZE - OVERLAY_WIDTH)
    : Math.min(
        (typeof window !== 'undefined' ? window.innerWidth : OVERLAY_WIDTH) - OVERLAY_WIDTH - EDGE_PADDING,
        position.x,
      );

  return (
    <>
      <button
        type="button"
        data-cellhub-operator-bubble="true"
        data-cellhub-bubble-visual-mode={visualMode}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        title={tooltip}
        aria-label={tooltip}
        aria-expanded={isOverlayOpen}
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
          borderRadius: '50%',
          // R-COMPANION-BUBBLE-REDESIGN: the orb SVG owns 100% of the
          // visual — the button stays transparent so the iridescent
          // rim shows cleanly against the page.
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
          padding: 0,
          color: '#e2e8f0',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
          zIndex: Z_INDEX,
          // Hover scale is applied via CSS :hover selector. The inline
          // transform is reserved for the float keyframe.
          transition: isDragging ? 'none' : 'transform 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          outline: 'none',
          // R-COMPANION-BUBBLE-REDESIGN: float is the canonical
          // motion. Drag suspends it so the cursor stays 1:1 with
          // the bubble during a drag.
          animation: isDragging
            ? 'none'
            : 'cellhubOperatorBubbleFloat 4s ease-in-out infinite',
        }}
      >
        {/* ─── R-COMPANION-BUBBLE-REDESIGN: iridescent soap-bubble orb ───
            Six SVG layers replace the old brain/halo/conic/pulse-ring
            stack:
              1. interior fill (very low opacity, mode-tinted)
              2. iridescent rim (linear gradient, 5-stop, mode-tinted)
              3. inner rim (subtle white inner contour)
              4. specular fill overlay (radial, top-left)
              5. specular highlight ellipses (top-left)
              6. hint ring (only on visualMode === 'hint')
            The per-mode hue-rotate filter on the wrapper shimmers the
            rim without re-rendering React; cero rAF, cero canvas. */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            animation: isDragging ? 'none' : filterAnim,
          }}
        >
          <svg
            width={BUBBLE_SIZE}
            height={BUBBLE_SIZE}
            viewBox="0 0 110 110"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block', overflow: 'visible' }}
          >
            <defs>
              <radialGradient id={`bubbleFill-${reactInstanceId}`} cx="50%" cy="35%" r="55%">
                <stop offset="0%"   stopColor={fillTint} stopOpacity="0.09" />
                <stop offset="100%" stopColor={fillTint} stopOpacity="0" />
              </radialGradient>
              <linearGradient id={`bubbleRim-${reactInstanceId}`} x1="0%" y1="0%" x2="100%" y2="100%">
                {rimStops.map((s) => (
                  <stop key={s.o} offset={s.o} stopColor={s.c} stopOpacity={s.a} />
                ))}
              </linearGradient>
              <radialGradient id={`bubbleSpec-${reactInstanceId}`} cx="38%" cy="30%" r="28%">
                <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.90" />
                <stop offset="55%"  stopColor={specularTint} stopOpacity="0.30" />
                <stop offset="100%" stopColor={specularTint} stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* CAPA 6 — hint ring (outer soft green halo). Only ready/alert. */}
            {visualMode === 'hint' && (
              <circle cx="55" cy="55" r="51" fill="none" stroke="rgba(52,211,153,0.10)" strokeWidth="8" />
            )}

            {/* CAPA 1 — interior fill */}
            <circle cx="55" cy="55" r="45" fill={`url(#bubbleFill-${reactInstanceId})`} />

            {/* CAPA 2 — iridescent rim (the headliner) */}
            <circle cx="55" cy="55" r="45" fill="none" stroke={`url(#bubbleRim-${reactInstanceId})`} strokeWidth="4" />

            {/* CAPA 3 — inner soft rim */}
            <circle cx="55" cy="55" r="43" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />

            {/* CAPA 4 — specular fill overlay */}
            <circle cx="55" cy="55" r="45" fill={`url(#bubbleSpec-${reactInstanceId})`} />

            {/* CAPA 5 — specular highlight ellipses */}
            <g transform="translate(37 32) rotate(-22)">
              <ellipse cx="0" cy="0" rx="13" ry="8" fill="white" fillOpacity="0.50" />
              <ellipse cx="-3" cy="-3" rx="5"  ry="3" fill="white" fillOpacity="0.75" />
            </g>
          </svg>
        </span>

        {/* Optional outer pulse ring — keeps the existing
            cellhubOperatorPulseRing behaviour for ready/alert so the
            hint ring inside the SVG is reinforced with a slow outward
            pulse. CSS-only, pointer-events none. */}
        {showRing && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: -6,
              borderRadius: '50%',
              border: '2px solid rgba(52,211,153,0.55)',
              animation: 'cellhubOperatorPulseRing 1.6s ease-out infinite',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Status dot — bigger (16×16), pulses when thinking/hint.
            Border colour matches the page background tone so it reads
            as cleanly "stuck on" the orb. */}
        <span
          aria-hidden="true"
          title={statusLabel}
          style={{
            position: 'absolute',
            top: 4, right: 4,
            width: 16, height: 16,
            borderRadius: '50%',
            background: dotPalette.bg,
            border: '3px solid rgba(15,23,42,0.95)',
            boxShadow: dotPalette.shadow,
            pointerEvents: 'none',
            animation: isDragging ? 'none' : dotAnim,
          }}
        />
      </button>

      {/* Context badge — small pill below the bubble, shows customer name
          or rotating suggestion preview. Hidden when overlay or hint is open. */}
      {enabled && !isDragging && !isOverlayOpen && !showPill && effectivePreviewText && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: position.y + BUBBLE_SIZE + 5,
            left: position.x + BUBBLE_SIZE / 2,
            transform: 'translateX(-50%)',
            background: (pendingExternalPayment && returnDetected)
              ? 'rgba(245,158,11,0.15)'
              : 'rgba(15,23,42,0.82)',
            border: (pendingExternalPayment && returnDetected)
              ? '1px solid rgba(245,158,11,0.4)'
              : '1px solid rgba(148,163,184,0.18)',
            borderRadius: '1rem',
            padding: '0.18rem 0.55rem',
            color: (pendingExternalPayment && returnDetected) ? '#fbbf24' : '#94a3b8',
            fontSize: '0.68rem',
            whiteSpace: 'nowrap',
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            zIndex: Z_INDEX,
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none',
          }}
        >
          {effectivePreviewText}
        </div>
      )}

      {/* Ambient hint pill */}
      {showPill && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            top: position.y + (BUBBLE_SIZE / 2) - 18,
            ...(pillOnLeft
              ? { left: Math.max(EDGE_PADDING, position.x - 12 - 280), maxWidth: 280 }
              : { left: position.x + BUBBLE_SIZE + 12,                  maxWidth: 280 }),
            background: 'rgba(15,23,42,0.92)',
            border: `1px solid ${stateColor(bubbleState)}55`,
            borderRadius: '0.6rem',
            padding: '0.55rem 0.75rem',
            color: '#e2e8f0',
            fontSize: '0.82rem',
            lineHeight: 1.35,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: Z_INDEX,
            backdropFilter: 'blur(6px)',
            pointerEvents: 'none',
          }}
        >
          {hintText}
        </div>
      )}

      {/* V2 mini overlay — opened by left-click. Stays anchored to the
          bubble; auto-flips horizontally and vertically based on viewport
          half so it never escapes the screen. */}
      {isOverlayOpen && (
        <div
          data-cellhub-operator-overlay="true"
          role="dialog"
          aria-label={t('operator.menu.title')}
          style={{
            position: 'fixed',
            top: overlayTop,
            left: overlayLeft,
            width: OVERLAY_WIDTH,
            background: 'rgba(15,23,42,0.96)',
            border: '1px solid rgba(148,163,184,0.25)',
            borderRadius: '0.75rem',
            padding: '0.65rem',
            color: '#e2e8f0',
            fontSize: '0.85rem',
            boxShadow: '0 16px 36px rgba(0,0,0,0.55)',
            zIndex: Z_INDEX + 1,
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            animation: 'cellhubOperatorOverlayIn 0.18s ease-out',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <span aria-hidden="true" style={{ fontSize: '1.05rem' }}>🧠</span>
              <span style={{ fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap' }}>
                {t('operator.menu.title')}
              </span>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#94a3b8' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotPalette.bg }} />
              {statusLabel}
            </span>
          </div>

          {/* R-INTELLIGENCE-WORKFLOW-CONTINUITY-V1: external payment confirmation card.
              Only shown when the cashier opened a carrier portal AND returned to CellHub.
              NEVER auto-confirms — three explicit human choices required. */}
          {pendingExternalPayment && returnDetected && (
            <div style={{
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid rgba(245,158,11,0.45)',
              borderRadius: '0.5rem',
              padding: '0.6rem 0.7rem',
              display: 'flex', flexDirection: 'column', gap: '0.4rem',
            }}>
              <div style={{ fontSize: '0.70rem', color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {locale === 'es' ? 'Pago externo pendiente' : 'External payment pending'}
              </div>
              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.35 }}>
                {locale === 'es'
                  ? '¿Completaste el pago en el portal del carrier?'
                  : 'Did you complete the payment on the carrier website?'}
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.1rem' }}>
                <button
                  type="button"
                  onClick={handleConfirmExternalPaid}
                  style={{
                    flex: '1 1 auto',
                    padding: '0.38rem 0.55rem',
                    borderRadius: '0.45rem',
                    background: 'rgba(34,197,94,0.16)',
                    border: '1px solid rgba(34,197,94,0.45)',
                    color: '#86efac',
                    cursor: 'pointer',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {locale === 'es' ? '✓ Pagado · Siguiente' : '✓ Mark Paid & Next'}
                </button>
                <button
                  type="button"
                  onClick={handleExternalStillProcessing}
                  style={{
                    flex: '1 1 auto',
                    padding: '0.38rem 0.55rem',
                    borderRadius: '0.45rem',
                    background: 'rgba(148,163,184,0.08)',
                    border: '1px solid rgba(148,163,184,0.25)',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {locale === 'es' ? '⏳ En proceso' : '⏳ Still Processing'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelExternalPayment}
                  style={{
                    flex: '0 0 auto',
                    padding: '0.38rem 0.55rem',
                    borderRadius: '0.45rem',
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    color: '#fca5a5',
                    cursor: 'pointer',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Body — priority: context block > hint > placeholder */}
          {activeContext ? (() => {
            const ctxCust = activeContext.customerId
              ? customers.find((c) => c && c.id === activeContext.customerId) || null
              : null;
            const ctxName = ctxCust
              ? (`${ctxCust.firstName || ''} ${ctxCust.lastName || ''}`.trim() || ctxCust.name || '')
              : '';
            const titleKey = `operator.context.title.${activeContext.contextType}`;
            const phoneFmt = activeContext.phone || '';
            const lines = activeContext.lineCount;
            const last = activeContext.lastPaymentCents;
            const cur = activeContext.amountCents;
            return (
              <div style={{
                background: 'rgba(99,102,241,0.08)',
                border: `1px solid ${stateColor(bubbleState)}55`,
                borderRadius: '0.5rem',
                padding: '0.6rem 0.7rem',
                display: 'flex', flexDirection: 'column', gap: '0.25rem',
              }}>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t(titleKey)}
                </div>
                {ctxName && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>{ctxName}</span>
                    {tierBadgeColors && activeCustomerProfile && (
                      <span style={{
                        fontSize: '0.60rem',
                        fontWeight: 700,
                        padding: '0.10rem 0.38rem',
                        borderRadius: '0.8rem',
                        background: tierBadgeColors.bg,
                        color: tierBadgeColors.color,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}>
                        {activeCustomerProfile.estimatedCustomerTier}
                      </span>
                    )}
                  </div>
                )}
                {phoneFmt && (
                  <div style={{ fontSize: '0.82rem', color: '#cbd5e1', fontFamily: 'Courier New, monospace' }}>
                    📞 {phoneFmt}
                  </div>
                )}
                {typeof lines === 'number' && lines > 0 && (
                  <div style={{ fontSize: '0.78rem', color: '#a5b4fc' }}>
                    {(t as (k: string, ...a: Array<string | number>) => string)('operator.context.linesOnFile', lines)}
                  </div>
                )}
                {typeof last === 'number' && last > 0 && (
                  <div style={{ fontSize: '0.78rem', color: '#34d399' }}>
                    {(t as (k: string, ...a: Array<string | number>) => string)('operator.context.lastPayment', (last / 100).toFixed(2))}
                  </div>
                )}
                {typeof cur === 'number' && cur > 0 && (
                  <div style={{ fontSize: '0.78rem', color: '#fbbf24' }}>
                    {(t as (k: string, ...a: Array<string | number>) => string)('operator.context.currentAmount', (cur / 100).toFixed(2))}
                  </div>
                )}
                {hintText && (
                  <div style={{ marginTop: '0.3rem', paddingTop: '0.3rem', borderTop: '1px dashed rgba(255,255,255,0.08)', fontSize: '0.78rem', color: '#cbd5e1', fontStyle: 'italic' }}>
                    {hintText}
                  </div>
                )}
              </div>
            );
          })() : (
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${hintText ? stateColor(bubbleState) + '55' : 'rgba(148,163,184,0.18)'}`,
              borderRadius: '0.5rem',
              padding: '0.55rem 0.65rem',
              fontSize: '0.82rem',
              lineHeight: 1.4,
              color: hintText ? '#e2e8f0' : '#94a3b8',
              minHeight: '2.6rem',
            }}>
              {hintText || (enabled ? t('operator.overlay.watching') : t('operator.menu.hintsOff'))}
            </div>
          )}

          {/* Operational insights — sectioned list of deterministic
              observations about the current activeContext. Only
              rendered when at least one rule fires. */}
          {insights.length > 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(148,163,184,0.18)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.65rem',
              display: 'flex', flexDirection: 'column', gap: '0.25rem',
            }}>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem' }}>
                {t('operator.insights.title')}
              </div>
              {insights.map((ins) => {
                const text = (t as (k: string, ...a: Array<string | number>) => string)(ins.i18nKey, ...ins.args);
                const color = insightToneColor(ins.tone);
                return (
                  <div key={ins.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.78rem', lineHeight: 1.35 }}>
                    <span aria-hidden="true" style={{ flexShrink: 0, width: 6, height: 6, marginTop: 6, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}88` }} />
                    <span style={{ color: '#e2e8f0' }}>{text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Context-aware quick actions — only when context exists */}
          {activeContext && (activeContext.phone || activeContext.customerId) && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {activeContext.phone && (
                <button
                  type="button"
                  onClick={copyContextPhone}
                  style={{
                    flex: '1 1 calc(50% - 0.2rem)',
                    minWidth: 0,
                    textAlign: 'center',
                    padding: '0.4rem 0.5rem',
                    borderRadius: '0.45rem',
                    background: copiedFlash ? 'rgba(34,197,94,0.18)' : 'rgba(56,189,248,0.10)',
                    border: `1px solid ${copiedFlash ? 'rgba(34,197,94,0.4)' : 'rgba(56,189,248,0.3)'}`,
                    color: copiedFlash ? '#86efac' : '#7dd3fc',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  {copiedFlash ? `✓ ${t('operator.action.copyPhoneDone')}` : `📋 ${t('operator.action.copyPhone')}`}
                </button>
              )}
              {activeContext.customerId && (
                <button
                  type="button"
                  onClick={viewCustomerHistory}
                  style={{
                    flex: '1 1 calc(50% - 0.2rem)',
                    minWidth: 0,
                    textAlign: 'center',
                    padding: '0.4rem 0.5rem',
                    borderRadius: '0.45rem',
                    background: 'rgba(167,139,250,0.10)',
                    border: '1px solid rgba(167,139,250,0.3)',
                    color: '#c4b5fd',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  📋 {t('operator.action.viewHistory')}
                </button>
              )}
              {activeContext.contextType === 'unknown_phone' && activeContext.phone && (
                <button
                  type="button"
                  onClick={createCustomerFromContext}
                  style={{
                    flex: '1 1 calc(50% - 0.2rem)',
                    minWidth: 0,
                    textAlign: 'center',
                    padding: '0.4rem 0.5rem',
                    borderRadius: '0.45rem',
                    background: 'rgba(34,197,94,0.12)',
                    border: '1px solid rgba(34,197,94,0.35)',
                    color: '#86efac',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  ＋ {t('operator.action.createCustomer')}
                </button>
              )}
            </div>
          )}

          {/* Live-context suggestions + executable actions (R-INTELLIGENCE-ACTION-EXECUTION-V1) */}
          {suggestionsWithActions.length > 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(251,191,36,0.2)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.65rem',
              display: 'flex', flexDirection: 'column', gap: '0.35rem',
            }}>
              <div style={{ fontSize: '0.68rem', color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.1rem' }}>
                {t('operator.suggestions.title')}
              </div>
              {suggestionsWithActions.map(({ suggestion: s, actions: sActions }) => {
                const kindColor =
                  s.kind === 'upsell'     ? '#34d399'
                  : s.kind === 'retention' ? '#f59e0b'
                  : s.kind === 'collect'   ? '#60a5fa'
                  : s.kind === 'follow_up' ? '#a78bfa'
                  :                          '#a5b4fc';
                const isFlashed = flashedSuggId === s.id;
                return (
                  <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {/* Suggestion text row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.78rem', lineHeight: 1.35 }}>
                      <span aria-hidden="true" style={{ flexShrink: 0, width: 6, height: 6, marginTop: 6, borderRadius: '50%', background: kindColor, boxShadow: `0 0 5px ${kindColor}88` }} />
                      <span style={{ color: '#e2e8f0', flex: 1 }}>{s.text}</span>
                      {sActions.length === 0 && s.actionTab && (
                        <button
                          type="button"
                          onClick={() => { dispatch({ type: 'SET_ACTIVE_TAB', payload: s.actionTab! }); setIsOverlayOpen(false); }}
                          style={{ flexShrink: 0, fontSize: '0.68rem', color: '#a5b4fc', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.15rem', lineHeight: 1 }}
                          title="Go there"
                        >
                          →
                        </button>
                      )}
                    </div>
                    {/* Executable action pill buttons */}
                    {sActions.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', paddingLeft: '0.95rem' }}>
                        {sActions.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => handleActionClick(a, s.id)}
                            style={{
                              padding: '0.22rem 0.55rem',
                              borderRadius: '0.9rem',
                              fontSize: '0.70rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: `1px solid ${kindColor}55`,
                              background: isFlashed ? `${kindColor}22` : 'rgba(255,255,255,0.06)',
                              color: isFlashed ? kindColor : '#cbd5e1',
                              transition: 'background 0.15s, color 0.15s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isFlashed ? '✓ Opened' : a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Action: open full Intelligence */}
          <button
            type="button"
            onClick={openFullIntelligence}
            style={{
              textAlign: 'left',
              padding: '0.5rem 0.65rem',
              borderRadius: '0.5rem',
              background: 'rgba(99,102,241,0.14)',
              border: '1px solid rgba(99,102,241,0.4)',
              color: '#a5b4fc',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
            }}
          >
            <span aria-hidden="true">🧠</span>
            {t('operator.menu.openIntel')}
          </button>

          {/* Toggle: hints ON/OFF */}
          <button
            type="button"
            onClick={toggleEnabled}
            aria-pressed={enabled}
            style={{
              textAlign: 'left',
              padding: '0.45rem 0.65rem',
              borderRadius: '0.5rem',
              background: enabled ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.08)',
              border: `1px solid ${enabled ? 'rgba(34,197,94,0.35)' : 'rgba(148,163,184,0.2)'}`,
              color: enabled ? '#86efac' : '#cbd5e1',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {enabled ? `✓ ${t('operator.menu.hintsOn')}` : `○ ${t('operator.menu.hintsOff')}`}
          </button>

          {/* Action: dismiss current hint (only when one is active) */}
          {hint && (
            <button
              type="button"
              onClick={dismissHintNow}
              style={{
                textAlign: 'left',
                padding: '0.45rem 0.65rem',
                borderRadius: '0.5rem',
                background: 'rgba(148,163,184,0.08)',
                border: '1px solid rgba(148,163,184,0.2)',
                color: '#cbd5e1',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              ✕ {t('operator.menu.dismiss')}
            </button>
          )}

          {/* Action: clear persistent context (only when one is active) */}
          {activeContext && (
            <button
              type="button"
              onClick={clearContext}
              style={{
                textAlign: 'left',
                padding: '0.45rem 0.65rem',
                borderRadius: '0.5rem',
                background: 'rgba(148,163,184,0.08)',
                border: '1px solid rgba(148,163,184,0.2)',
                color: '#cbd5e1',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              ⌫ {t('operator.action.clearContext')}
            </button>
          )}

          {/* Action: reset bubble position */}
          <button
            type="button"
            onClick={resetPosition}
            style={{
              textAlign: 'left',
              padding: '0.45rem 0.65rem',
              borderRadius: '0.5rem',
              background: 'rgba(148,163,184,0.05)',
              border: '1px solid rgba(148,163,184,0.18)',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.78rem',
            }}
          >
            ↺ {t('operator.overlay.resetPosition')}
          </button>
        </div>
      )}
    </>
  );
}
