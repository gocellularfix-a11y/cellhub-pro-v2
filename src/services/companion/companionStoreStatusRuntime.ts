// ============================================================
// CellHub Pro — Companion Store Status Runtime Store
// (R-COMPANION-STORE-STATUS-RUNTIME-V1)
//
// Passive read-model over store-status Companion events. Aggregates
// STORE_OPENED / STORE_CLOSED / STORE_STATUS_UPDATED into a single
// latest-wins snapshot so the Companion Center can surface
// open/closed state + on-shift counts + alert level without
// re-walking the bus log.
//
// Desktop remains the source of truth — this runtime owns cero
// operational logic, cero POS state, cero employee mutation.
// Cero networking, cero persistence, cero websocket, cero polling,
// cero timers. In-memory only.
// ============================================================

import { subscribe } from './companionEventBus';
import type {
  CompanionStoreAlertLevel,
  CompanionStoreOperatingMode,
  CompanionStoreStatusPayload,
  CompanionStoreStatusRuntimeListener,
  CompanionStoreStatusRuntimeSnapshot,
} from './companionTypes';

// ── Module-private state ──────────────────────────────────

interface InternalState {
  status: CompanionStoreOperatingMode;
  statusId: string | null;
  source?: string;
  reason?: string;
  lastUpdatedAt: number | null;
  cashiersOnShift: number;
  ringingPosCount: number;
  lastEventType: 'STORE_OPENED' | 'STORE_CLOSED' | 'STORE_STATUS_UPDATED' | null;
}

const state: InternalState = {
  status: 'unknown',
  statusId: null,
  source: undefined,
  reason: undefined,
  lastUpdatedAt: null,
  cashiersOnShift: 0,
  ringingPosCount: 0,
  lastEventType: null,
};

const listeners = new Set<CompanionStoreStatusRuntimeListener>();

// ── Helpers ──────────────────────────────────────────────

/**
 * Derive alert prominence from the current state. Conservative
 * heuristic — bumps to 'critical' on explicit emergency reasons or
 * when status is 'unknown' after an emit; bumps to 'warning' when
 * the store is closed (any reason) since closed-during-operation is
 * the surface the owner cares about. Future emitters can pass a
 * richer reason to push the level higher.
 */
function deriveAlertLevel(s: InternalState): CompanionStoreAlertLevel {
  const reason = (s.reason ?? '').toLowerCase();
  if (reason.includes('emergency') || reason.includes('panic') || reason.includes('critical')) {
    return 'critical';
  }
  if (s.status === 'unknown' && s.lastEventType) {
    return 'critical';
  }
  if (s.status === 'closed') return 'warning';
  return 'normal';
}

function buildSnapshot(): CompanionStoreStatusRuntimeSnapshot {
  return {
    status: state.status,
    statusId: state.statusId,
    source: state.source,
    reason: state.reason,
    lastUpdatedAt: state.lastUpdatedAt,
    cashiersOnShift: state.cashiersOnShift,
    ringingPosCount: state.ringingPosCount,
    activeEmployees: [],
    lastEventType: state.lastEventType,
    alertLevel: deriveAlertLevel(state),
  };
}

function notify(): void {
  const snap = buildSnapshot();
  listeners.forEach((listener) => {
    try { listener(snap); } catch (err) {
      console.warn('[companion-store-status-runtime] listener threw', err);
    }
  });
}

function applyPayload(
  eventType: 'STORE_OPENED' | 'STORE_CLOSED' | 'STORE_STATUS_UPDATED',
  payload: CompanionStoreStatusPayload,
): void {
  // STORE_OPENED / STORE_CLOSED carry an implicit status when payload
  // omits one — open or closed respectively. STORE_STATUS_UPDATED
  // is the explicit form and trusts payload.status (falls back to
  // 'unknown' so the runtime stays defined).
  const inferred: CompanionStoreOperatingMode =
    eventType === 'STORE_OPENED' ? 'open'
    : eventType === 'STORE_CLOSED' ? 'closed'
    : 'unknown';
  state.status = payload.status ?? inferred;
  state.statusId = payload.statusId ?? null;
  state.source = payload.source;
  state.reason = payload.reason;
  state.lastUpdatedAt = payload.updatedAt ?? Date.now();
  state.cashiersOnShift = typeof payload.cashiersOnShift === 'number' ? payload.cashiersOnShift : 0;
  state.ringingPosCount = typeof payload.ringingPosCount === 'number' ? payload.ringingPosCount : 0;
  state.lastEventType = eventType;
  notify();
}

// ── Event subscriptions (module-singleton) ───────────────
// Attached at file load. Each subscriber narrows the discriminated
// CompanionEvent union so payload typing is preserved.

subscribe('STORE_OPENED', (event) => {
  if (event.type !== 'STORE_OPENED') return;
  applyPayload('STORE_OPENED', event.payload);
});

subscribe('STORE_CLOSED', (event) => {
  if (event.type !== 'STORE_CLOSED') return;
  applyPayload('STORE_CLOSED', event.payload);
});

subscribe('STORE_STATUS_UPDATED', (event) => {
  if (event.type !== 'STORE_STATUS_UPDATED') return;
  applyPayload('STORE_STATUS_UPDATED', event.payload);
});

// ── Public API ────────────────────────────────────────────

/** Read the current snapshot. Always a fresh object — safe for
 *  direct React useState seed. */
export function getStoreStatusRuntimeSnapshot(): CompanionStoreStatusRuntimeSnapshot {
  return buildSnapshot();
}

/** Subscribe to runtime changes. Returns an unsubscribe handle. */
export function subscribeStoreStatusRuntime(
  listener: CompanionStoreStatusRuntimeListener,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Reset the runtime view back to the initial 'unknown' state.
 *  Listeners untouched. Dev-only. */
export function clearStoreStatusRuntime(): void {
  if (state.lastEventType === null && state.status === 'unknown'
      && state.cashiersOnShift === 0 && state.ringingPosCount === 0) {
    return;
  }
  state.status = 'unknown';
  state.statusId = null;
  state.source = undefined;
  state.reason = undefined;
  state.lastUpdatedAt = null;
  state.cashiersOnShift = 0;
  state.ringingPosCount = 0;
  state.lastEventType = null;
  notify();
}
