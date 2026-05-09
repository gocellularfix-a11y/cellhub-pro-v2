// ============================================================
// CellHub Pro — Floating Operator / Intelligence Bubble
// (R-OPERATOR-FLOATING-BUBBLE-V1)
//
// A small, draggable, fixed-position button mounted at the AppShell
// level so the cashier/owner can jump to Intelligence from anywhere.
//
// Behavior:
//   - Click  → toggle navigation to/from the Intelligence tab.
//              Tab state is the existing source of truth — we don't
//              spin up a second engine instance or render a custom
//              panel that would duplicate IntelligenceModule.
//   - Drag   → move the bubble. Click vs drag is decided by movement
//              threshold (>5px = drag, no nav fires).
//   - Resize → bubble is clamped back inside the viewport.
//   - Persist → final position is saved to localStorage so the next
//               session restores it.
//
// Performance notes:
//   - mousemove / mouseup listeners are attached only WHILE dragging.
//   - No engine instantiation, no analyze() calls, no global timers.
//   - Re-renders only when position state changes during drag or
//     activeTab flips between intelligence ↔ other.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';

// ── Constants ─────────────────────────────────────────────
const STORAGE_KEY = 'cellhub:operatorBubble:position:v1';
const BUBBLE_SIZE = 56;          // px diameter
const DRAG_THRESHOLD_PX = 5;     // movement above this = drag (suppresses click)
const EDGE_PADDING = 16;         // px clamp from viewport edges
const Z_INDEX = 880;             // below modals (1000+) and AI panel (1001), above tabs

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
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed === 'object'
      && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore corrupt JSON; fall back to default
  }
  return null;
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

// ── Component ─────────────────────────────────────────────
export default function FloatingOperatorBubble() {
  const { state, dispatch } = useApp();
  const { activeTab } = state;
  const { t } = useTranslation();

  const [position, setPosition] = useState<Position>(() =>
    clampToViewport(loadPosition() || defaultPosition())
  );
  const [isDragging, setIsDragging] = useState(false);

  // Mutable refs avoid stale-closure issues during a drag without forcing
  // re-renders for every mousemove. Position-during-drag is committed to
  // state once movement crosses the threshold so the bubble actually moves.
  const dragStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const movedRef = useRef(false);
  const previousTabRef = useRef<string>(activeTab && activeTab !== 'intelligence' ? activeTab : 'dashboard');

  const isOnIntelligence = activeTab === 'intelligence';

  // Track the last NON-intelligence tab so a second click on the bubble
  // returns the user to where they were rather than dumping them on the
  // dashboard.
  useEffect(() => {
    if (activeTab && activeTab !== 'intelligence') {
      previousTabRef.current = activeTab;
    }
  }, [activeTab]);

  // ── Click toggle ────────────────────────────────────────
  const toggleIntelligence = useCallback(() => {
    if (isOnIntelligence) {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: previousTabRef.current || 'dashboard' });
    } else {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'intelligence' });
    }
  }, [isOnIntelligence, dispatch]);

  // ── Drag start ──────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    // Only respond to primary button. Right-click / middle-click ignored.
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      px: position.x,
      py: position.y,
    };
    movedRef.current = false;
  }, [position]);

  // ── Drag/click resolver ─────────────────────────────────
  // mousemove + mouseup are attached only while a drag candidate exists.
  // We re-attach when dragStartRef flips (via re-render after handleMouseDown).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.mx;
      const dy = e.clientY - start.my;
      const dist = Math.hypot(dx, dy);
      if (!movedRef.current && dist > DRAG_THRESHOLD_PX) {
        movedRef.current = true;
        setIsDragging(true);
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
        // Persist final clamped position. Using functional setter so the
        // value we read is the same one the last onMove committed.
        setPosition((p) => {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
          } catch {
            // localStorage may be unavailable (private mode, quota) — ignore.
          }
          return p;
        });
      } else {
        // No movement past threshold → treat as a click.
        toggleIntelligence();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [toggleIntelligence]);

  // ── Window resize clamp ─────────────────────────────────
  useEffect(() => {
    const onResize = () => setPosition((p) => clampToViewport(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Render ──────────────────────────────────────────────
  const tooltip = isOnIntelligence
    ? t('operator.bubble.closeTooltip')
    : t('operator.bubble.openTooltip');

  return (
    <button
      type="button"
      onMouseDown={handleMouseDown}
      title={tooltip}
      aria-label={tooltip}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: BUBBLE_SIZE,
        height: BUBBLE_SIZE,
        borderRadius: '50%',
        background: isOnIntelligence
          ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
          : 'linear-gradient(135deg, #1e293b, #334155)',
        border: `1px solid ${isOnIntelligence ? 'rgba(167,139,250,0.55)' : 'rgba(255,255,255,0.12)'}`,
        boxShadow: isOnIntelligence
          ? '0 0 24px rgba(139,92,246,0.45), 0 8px 16px rgba(0,0,0,0.45)'
          : '0 6px 18px rgba(0,0,0,0.45)',
        color: '#e2e8f0',
        fontSize: '1.5rem',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        zIndex: Z_INDEX,
        transition: isDragging
          ? 'none'
          : 'background 0.2s, box-shadow 0.2s, border-color 0.2s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        outline: 'none',
      }}
    >
      <span aria-hidden="true" style={{ pointerEvents: 'none' }}>🧠</span>
    </button>
  );
}
