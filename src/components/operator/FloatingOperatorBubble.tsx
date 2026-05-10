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
  computeOperatorContextFromEvent,
  computeOperatorContextFromGlobalState,
  OPERATOR_ACTIVITY_EVENT,
  type OperatorActiveContext,
  type OperatorActivityEventDetail,
  type OperatorActivityInputs,
  type OperatorBubbleState,
  type OperatorHint,
} from '@/services/operator/operatorActivityHints';

// ── Constants ─────────────────────────────────────────────
const POSITION_KEY = 'cellhub:operatorBubble:position:v1';
const ENABLED_KEY  = 'cellhub:operatorBubble:enabled:v1';
const BUBBLE_SIZE  = 72;          // R-OPERATOR-LIVE-BUBBLE-OVERLAY-V2 fix: 64 → 72 px
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
@keyframes cellhubOperatorPulseRing {
  0%   { transform: scale(0.92); opacity: 0.65; }
  70%  { transform: scale(1.28); opacity: 0;    }
  100% { transform: scale(1.28); opacity: 0;    }
}
@keyframes cellhubOperatorBreath {
  0%, 100% { box-shadow: 0 8px 22px rgba(0,0,0,0.5), 0 0 0 rgba(99,102,241,0); }
  50%      { box-shadow: 0 8px 22px rgba(0,0,0,0.5), 0 0 28px rgba(139,92,246,0.45); }
}
@keyframes cellhubOperatorConicSpin {
  to { transform: rotate(360deg); }
}
@keyframes cellhubOperatorOverlayIn {
  0%   { opacity: 0; transform: translateY(-4px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0)    scale(1);    }
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
    pendingPosCustomer, pendingPhonePaymentCustomerId, pendingBarcodeInvoice,
  } = state;
  const { t } = useTranslation();

  // R-OPERATOR-BRAIN-SVG: SVG <defs> ids must be globally unique. useId()
  // returns a stable per-instance string; we sanitise out non-id-safe
  // characters (React 18 emits ':' which CSS url() references tolerate
  // in evergreen browsers but not in older renderers). One ID derived
  // here covers both gradients in the inline brain glyph below.
  const reactInstanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const brainFillId = `brainFill-${reactInstanceId}`;
  const brainSheenId = `brainSheen-${reactInstanceId}`;

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
  const showBreath = enabled && !isDragging && bubbleState === 'sleeping' && !isOverlayOpen;

  const dotColor = stateColor(enabled ? bubbleState : 'sleeping');
  const statusLabel = t(`operator.status.${enabled ? bubbleState : 'sleeping'}`);

  // Premium gradient palette. Default state has subtle indigo undertone
  // so the bubble reads as "alive but quiet"; intelligence-active and
  // overlay-open promote to a brighter cosmic gradient.
  const bubbleBg = (isOverlayOpen || isOnIntelligence)
    ? 'radial-gradient(circle at 30% 30%, #818cf8 0%, #6366f1 40%, #4338ca 100%)'
    : 'radial-gradient(circle at 30% 30%, #475569 0%, #1e293b 50%, #0f172a 100%)';

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
          background: bubbleBg,
          border: `1px solid ${isOverlayOpen ? 'rgba(167,139,250,0.55)' : 'rgba(255,255,255,0.12)'}`,
          boxShadow: isOverlayOpen
            ? '0 0 24px rgba(139,92,246,0.4), 0 8px 16px rgba(0,0,0,0.45)'
            : '0 6px 18px rgba(0,0,0,0.45)',
          color: '#e2e8f0',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
          zIndex: Z_INDEX,
          transition: isDragging ? 'none' : 'background 0.2s, box-shadow 0.2s, border-color 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          outline: 'none',
          animation: showBreath ? 'cellhubOperatorBreath 4s ease-in-out infinite' : 'none',
        }}
      >
        <svg
          aria-hidden="true"
          width="38"
          height="38"
          viewBox="0 0 38 38"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ pointerEvents: 'none', display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
        >
          <defs>
            <radialGradient id={brainFillId} cx="42%" cy="35%" r="62%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="50%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#4c1d95" />
            </radialGradient>
            <radialGradient id={brainSheenId} cx="32%" cy="22%" r="45%">
              <stop offset="0%" stopColor="#ede9fe" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Left hemisphere */}
          <path
            d="M17 9.5 C16 7 12.5 6.5 11.5 9 C10.5 6.5 7.5 7 7 9.5 C5.5 10 5 12.5 6.5 13.5 C5.5 14.5 5.5 17 7 17.5 C6.5 19.5 8 21.5 10 21 C10.5 22.5 12.5 23 14 21.5 C15 22.5 17 22 17.5 20.5 L17.5 9.5 Z"
            fill={`url(#${brainFillId})`}
          />
          {/* Right hemisphere */}
          <path
            d="M21 9.5 C22 7 25.5 6.5 26.5 9 C27.5 6.5 30.5 7 31 9.5 C32.5 10 33 12.5 31.5 13.5 C32.5 14.5 32.5 17 31 17.5 C31.5 19.5 30 21.5 28 21 C27.5 22.5 25.5 23 24 21.5 C23 22.5 21 22 20.5 20.5 L20.5 9.5 Z"
            fill={`url(#${brainFillId})`}
          />
          {/* Sheen overlay */}
          <path
            d="M17 9.5 C16 7 12.5 6.5 11.5 9 C10.5 6.5 7.5 7 7 9.5 C5.5 10 5 12.5 6.5 13.5 C5.5 14.5 5.5 17 7 17.5 C6.5 19.5 8 21.5 10 21 C10.5 22.5 12.5 23 14 21.5 C15 22.5 17 22 17.5 20.5 L17.5 9.5 Z"
            fill={`url(#${brainSheenId})`}
          />
          <path
            d="M21 9.5 C22 7 25.5 6.5 26.5 9 C27.5 6.5 30.5 7 31 9.5 C32.5 10 33 12.5 31.5 13.5 C32.5 14.5 32.5 17 31 17.5 C31.5 19.5 30 21.5 28 21 C27.5 22.5 25.5 23 24 21.5 C23 22.5 21 22 20.5 20.5 L20.5 9.5 Z"
            fill={`url(#${brainSheenId})`}
          />
          {/* Center divide */}
          <line x1="19" y1="9.5" x2="19" y2="21" stroke="#6d28d9" strokeWidth="0.8" strokeOpacity="0.6" />
          {/* Left folds */}
          <path d="M9 11 C8 12.5 9 14 10.5 13.5"     stroke="#6d28d9" strokeWidth="0.7" strokeLinecap="round" fill="none" />
          <path d="M7.5 15 C8 16.5 10 17 10.5 16"    stroke="#6d28d9" strokeWidth="0.7" strokeLinecap="round" fill="none" />
          <path d="M8.5 18.5 C9.5 20 11.5 20 12 18.5" stroke="#6d28d9" strokeWidth="0.7" strokeLinecap="round" fill="none" />
          <path d="M12.5 10.5 C13 12 12 13.5 10.5 13.5" stroke="#6d28d9" strokeWidth="0.6" strokeLinecap="round" fill="none" />
          {/* Right folds */}
          <path d="M29 11 C30 12.5 29 14 27.5 13.5"    stroke="#6d28d9" strokeWidth="0.7" strokeLinecap="round" fill="none" />
          <path d="M30.5 15 C30 16.5 28 17 27.5 16"    stroke="#6d28d9" strokeWidth="0.7" strokeLinecap="round" fill="none" />
          <path d="M29.5 18.5 C28.5 20 26.5 20 26 18.5" stroke="#6d28d9" strokeWidth="0.7" strokeLinecap="round" fill="none" />
          <path d="M25.5 10.5 C25 12 26 13.5 27.5 13.5" stroke="#6d28d9" strokeWidth="0.6" strokeLinecap="round" fill="none" />
          {/* Bottom stem */}
          <path
            d="M17.5 21 L17.5 24 C17.5 25 19 26 19 26 C19 26 20.5 25 20.5 24 L20.5 21"
            stroke="#7c3aed" strokeWidth="0.8" strokeLinecap="round" fill="none" strokeOpacity="0.7"
          />
          {/* Cyan accent dots — neural activity */}
          <circle cx="11" cy="19" r="1"   fill="#00d4ff" opacity="0.7" />
          <circle cx="27" cy="19" r="1"   fill="#00d4ff" opacity="0.7" />
          <circle cx="14" cy="15" r="0.7" fill="#00d4ff" opacity="0.5" />
          <circle cx="24" cy="15" r="0.7" fill="#00d4ff" opacity="0.5" />
        </svg>

        {/* Slow-rotating conic ring — premium "live assistant" sheen.
            Only spins while the bubble is actively surfacing something
            (ready/alert) so idle CPU stays at zero. CSS-only, GPU
            transform — no rAF, no JS animation lib. */}
        {showRing && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: '50%',
              padding: 2,
              background: `conic-gradient(from 0deg, ${stateColor(bubbleState)}, rgba(167,139,250,0.85), ${stateColor(bubbleState)}, rgba(99,102,241,0.55), ${stateColor(bubbleState)})`,
              WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              WebkitMaskComposite: 'xor',
              mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              maskComposite: 'exclude',
              animation: 'cellhubOperatorConicSpin 4s linear infinite',
              pointerEvents: 'none',
              opacity: 0.85,
            }}
          />
        )}
        {showRing && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: -6,
              borderRadius: '50%',
              border: `2px solid ${stateColor(bubbleState)}`,
              animation: 'cellhubOperatorPulseRing 1.6s ease-out infinite',
              pointerEvents: 'none',
            }}
          />
        )}

        <span
          aria-hidden="true"
          title={statusLabel}
          style={{
            position: 'absolute',
            top: 5, right: 5,
            width: 12, height: 12,
            borderRadius: '50%',
            background: dotColor,
            border: '2px solid rgba(15,23,42,0.9)',
            boxShadow: enabled && (bubbleState === 'ready' || bubbleState === 'alert')
              ? `0 0 8px ${dotColor}`
              : 'none',
            pointerEvents: 'none',
          }}
        />
      </button>

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
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
              {statusLabel}
            </span>
          </div>

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
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>{ctxName}</div>
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

          {/* Context-aware quick actions — only when context exists */}
          {activeContext && (activeContext.phone || activeContext.customerId) && (
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {activeContext.phone && (
                <button
                  type="button"
                  onClick={copyContextPhone}
                  style={{
                    flex: 1,
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
                    flex: 1,
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
