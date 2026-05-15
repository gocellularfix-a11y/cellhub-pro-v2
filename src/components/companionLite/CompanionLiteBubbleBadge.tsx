// ============================================================
// Companion Lite — Persistent badge anchored to the floating
// operator bubble. Shows the unattended count of Companion Lite
// events (messages, approval responses, approval-thread messages).
//
// Click on the badge:
//   1. captures the most-recent source ('messages' | 'approvals')
//   2. switches the sidebar to the 'companionLite' tab
//   3. stages a routeHint so CompanionLitePage opens the right
//      sub-tab (Messages / Approvals)
//   4. zeroes the count
//
// Does NOT modify FloatingOperatorBubble. Reads the bubble's stored
// position from localStorage and anchors itself on top-right corner.
// Polls every 250ms to follow drag-end repositioning.
// ============================================================

import { useEffect, useState } from 'react';
import { useApp } from '@/store/AppProvider';
import {
  navigateToCompanionLite,
  subscribe as subscribePending,
} from '@/services/companionLite/pendingNotifications';

// Mirror constants from FloatingOperatorBubble (kept here so we don't
// import from that component — purely positional, not behavioral).
const POSITION_KEY = 'cellhub:operatorBubble:position:v1';
const BUBBLE_SIZE = 110;
const BUBBLE_Z_INDEX = 880;
const POLL_MS = 250;
const EDGE_PADDING = 16;

interface Position { x: number; y: number; }

/** Default bubble position when localStorage has no entry yet — the
 *  FloatingOperatorBubble uses the same formula until the operator
 *  drags it. We mirror it here so the badge renders correctly on the
 *  very first session, before any drag has persisted a position. */
function defaultBubblePosition(): Position {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: Math.max(EDGE_PADDING, window.innerWidth  - BUBBLE_SIZE - 24),
    y: Math.max(EDGE_PADDING, window.innerHeight - BUBBLE_SIZE - 24),
  };
}

function readBubblePosition(): Position {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Position>;
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          return { x: parsed.x, y: parsed.y };
        }
      }
    } catch { /* ignore */ }
  }
  return defaultBubblePosition();
}

const KEYFRAMES_STYLE_ID = 'companion-lite-badge-keyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_STYLE_ID;
  style.textContent = `
@keyframes cellhubLiteBadgePulse {
  0%   { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.55); }
  70%  { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);   }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);     }
}`;
  document.head.appendChild(style);
}

export default function CompanionLiteBubbleBadge() {
  const { setActiveTab } = useApp();
  const [count, setCount] = useState(0);
  const [pos, setPos] = useState<Position>(() => readBubblePosition());

  // Inject pulse keyframes once.
  useEffect(() => { ensureKeyframes(); }, []);

  // Subscribe to the pending-notifications store.
  useEffect(() => {
    const unsub = subscribePending((s) => setCount(s.count));
    return unsub;
  }, []);

  // Follow the bubble's position. localStorage 'storage' events only fire
  // for OTHER tabs, so we also poll at 250ms — cheap, and the position is
  // written rarely (only on drag-end).
  useEffect(() => {
    const tick = () => {
      const next = readBubblePosition();
      setPos(prev => (prev.x === next.x && prev.y === next.y) ? prev : next);
    };
    tick();
    const handle = setInterval(tick, POLL_MS);
    const onStorage = (e: StorageEvent) => { if (e.key === POSITION_KEY) tick(); };
    const onResize = () => tick();
    window.addEventListener('storage', onStorage);
    window.addEventListener('resize', onResize);
    return () => {
      clearInterval(handle);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  if (count === 0) return null;

  // Anchor top-right of the bubble (slightly overlapping for visibility).
  const left = pos.x + BUBBLE_SIZE - 18;
  const top  = pos.y - 4;

  const handleClick = () => {
    const source = navigateToCompanionLite();
    setActiveTab('companionLite');
    void source; // CompanionLitePage will read it via consumeRouteHint.
  };

  const label = count > 9 ? '9+' : String(count);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${count} new Companion Lite ${count === 1 ? 'item' : 'items'}`}
      title={`${count} new Companion ${count === 1 ? 'item' : 'items'} — click to open`}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: BUBBLE_Z_INDEX + 1,
        minWidth: 26,
        height: 26,
        padding: '0 7px',
        borderRadius: 999,
        background: '#ef4444',
        color: '#fff',
        fontSize: 12,
        fontWeight: 800,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        letterSpacing: 0.2,
        border: '2px solid #07090F',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        animation: 'cellhubLiteBadgePulse 1.6s ease-out infinite',
      }}
    >
      {label}
    </button>
  );
}
