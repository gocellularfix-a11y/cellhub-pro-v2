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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import {
  computeHintFromEvent,
  computeHintFromGlobalState,
  OPERATOR_ACTIVITY_EVENT,
  type OperatorActivityEventDetail,
  type OperatorActivityInputs,
  type OperatorBubbleState,
  type OperatorHint,
} from '@/services/operator/operatorActivityHints';

// ── Constants ─────────────────────────────────────────────
const POSITION_KEY = 'cellhub:operatorBubble:position:v1';
const ENABLED_KEY  = 'cellhub:operatorBubble:enabled:v1';
const BUBBLE_SIZE  = 64;
const OVERLAY_WIDTH = 280;
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
  0%   { transform: scale(0.95); opacity: 0.55; }
  70%  { transform: scale(1.20); opacity: 0;    }
  100% { transform: scale(1.20); opacity: 0;    }
}
@keyframes cellhubOperatorBreath {
  0%, 100% { box-shadow: 0 6px 18px rgba(0,0,0,0.45); }
  50%      { box-shadow: 0 6px 18px rgba(0,0,0,0.45), 0 0 22px rgba(99,102,241,0.45); }
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
      setBubbleState('sleeping');
    }
  }, [enabled]);

  // Global-state derived hints, debounced.
  useEffect(() => {
    if (!enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (dismissRef.current)  clearTimeout(dismissRef.current);

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

  const bubbleBg = isOnIntelligence
    ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
    : 'linear-gradient(135deg, #1e293b, #334155)';

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
          fontSize: '1.9rem',
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
        <span aria-hidden="true" style={{ pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>🧠</span>

        {showRing && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: -4,
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
            top: 4, right: 4,
            width: 10, height: 10,
            borderRadius: '50%',
            background: dotColor,
            border: '2px solid rgba(15,23,42,0.85)',
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

          {/* Hint body */}
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
            {hintText || (enabled ? t('operator.overlay.noHint') : t('operator.menu.hintsOff'))}
          </div>

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
