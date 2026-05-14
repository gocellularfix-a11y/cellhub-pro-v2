// ============================================================
// CellHub Pro — Live Context Store (R-INTELLIGENCE-LIVE-CONTEXT-V1)
// Singleton observable. No React, no DOM dependencies.
// Persists to localStorage; observers notified synchronously.
// ============================================================

import type { LiveContext, LiveAction } from './contextTypes';

const STORAGE_KEY = 'cellhub:liveContext:v1';
const MAX_ACTIONS = 25;

const DEFAULT_CONTEXT: LiveContext = {
  activeModule: 'pos',
  activeCustomer: null,
  activeProduct: null,
  cart: null,
  recentActions: [],
  activeEmployeeId: null,
  activeEmployeeName: null,
  session: {
    lastCustomerId: null,
    lastRepairId: null,
    lastSearchedPhone: null,
    lastViewedItemSku: null,
    sessionStartAt: Date.now(),
  },
  updatedAt: Date.now(),
};

type Listener = (ctx: LiveContext) => void;

let _ctx: LiveContext = { ...DEFAULT_CONTEXT };
const _listeners = new Set<Listener>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<LiveContext>;
    if (parsed && typeof parsed === 'object') {
      _ctx = {
        ...DEFAULT_CONTEXT,
        ...parsed,
        // Always reset session start on a new page load
        session: {
          ...DEFAULT_CONTEXT.session,
          ...(parsed.session || {}),
          sessionStartAt: Date.now(),
        },
        recentActions: Array.isArray(parsed.recentActions) ? parsed.recentActions : [],
      };
    }
  } catch { /* corrupt storage — use default */ }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_ctx));
  } catch { /* storage unavailable — continue in-memory only */ }
}

function notify(): void {
  _listeners.forEach((fn) => {
    try { fn(_ctx); } catch { /* guard against broken listener */ }
  });
}

// ── Public API ────────────────────────────────────────────

/** Read the current context snapshot. Always returns a valid object. */
export function getContext(): LiveContext {
  return _ctx;
}

/**
 * Merge a partial update into the context, persist, and notify all listeners.
 * `updatedAt` is always refreshed.
 */
export function updateContext(partial: Partial<LiveContext>): void {
  _ctx = { ..._ctx, ...partial, updatedAt: Date.now() };
  persist();
  notify();
}

/**
 * Append an action to the history, capping at MAX_ACTIONS.
 * Also updates session timeline pointers derived from the action payload.
 */
export function addAction(action: LiveAction): void {
  const actions = [action, ..._ctx.recentActions].slice(0, MAX_ACTIONS);
  const session = { ..._ctx.session };

  if (action.metadata?.customerId && typeof action.metadata.customerId === 'string') {
    session.lastCustomerId = action.metadata.customerId;
  }
  if (action.metadata?.repairId && typeof action.metadata.repairId === 'string') {
    session.lastRepairId = action.metadata.repairId;
  }
  if (action.metadata?.phone && typeof action.metadata.phone === 'string') {
    session.lastSearchedPhone = action.metadata.phone;
  }
  if (action.metadata?.sku && typeof action.metadata.sku === 'string') {
    session.lastViewedItemSku = action.metadata.sku;
  }

  _ctx = { ..._ctx, recentActions: actions, session, updatedAt: Date.now() };
  persist();
  notify();
}

/** Wipe context back to defaults (preserve sessionStartAt epoch). */
export function resetContext(): void {
  _ctx = {
    ...DEFAULT_CONTEXT,
    session: { ...DEFAULT_CONTEXT.session, sessionStartAt: Date.now() },
    updatedAt: Date.now(),
  };
  persist();
  notify();
}

/**
 * Subscribe to context changes.
 * The listener is called immediately with the current context.
 * Returns an unsubscribe function.
 */
export function subscribe(fn: Listener): () => void {
  _listeners.add(fn);
  try { fn(_ctx); } catch { /* guard */ }
  return () => { _listeners.delete(fn); };
}

// Bootstrap: load persisted context at module import time.
load();
