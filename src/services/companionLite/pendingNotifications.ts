// ============================================================
// Companion Lite — Pending-notifications store.
//
// In-memory only (no persistence — clears on reload). Tracks how many
// unread Companion Lite events the operator has and which sub-tab the
// most recent one came from, so the FloatingOperatorBubble badge knows
// (a) what number to render and (b) where to route on click.
//
// Public surface:
//   - pushPending(source)      — increment + remember source
//   - navigateToCompanionLite()— captures source, resets count,
//                                stages a routeHint for CompanionLitePage
//   - consumeRouteHint()       — CompanionLitePage calls this to read
//                                + clear the staged sub-tab
//   - subscribe(cb)            — listener for badge + page
// ============================================================

export type PendingSource = 'messages' | 'approvals';

export interface PendingState {
  /** How many Companion Lite items are unattended. */
  count: number;
  /** The sub-tab the latest event came from. Drives the badge click route. */
  lastSource: PendingSource | null;
  /** Staged sub-tab for CompanionLitePage to consume on its next render. */
  routeHint: PendingSource | null;
}

let state: PendingState = { count: 0, lastSource: null, routeHint: null };
const listeners = new Set<(s: PendingState) => void>();

function emit(): void {
  const snap = { ...state };
  for (const l of listeners) {
    try { l(snap); } catch { /* isolate */ }
  }
}

export function getState(): PendingState {
  return { ...state };
}

export function pushPending(source: PendingSource): void {
  state = {
    count: state.count + 1,
    lastSource: source,
    routeHint: state.routeHint,
  };
  emit();
}

/** Called by the badge on click. Stages the most-recent source as a
 *  routeHint so CompanionLitePage opens that sub-tab, and zeros the
 *  count. Returns the captured source for the caller's convenience. */
export function navigateToCompanionLite(): PendingSource | null {
  const target = state.lastSource;
  state = { count: 0, lastSource: null, routeHint: target };
  emit();
  return target;
}

/** Called by CompanionLitePage to read + clear the staged sub-tab. */
export function consumeRouteHint(): PendingSource | null {
  const target = state.routeHint;
  if (target !== null) {
    state = { ...state, routeHint: null };
    emit();
  }
  return target;
}

export function subscribe(cb: (s: PendingState) => void): () => void {
  listeners.add(cb);
  // Fire once with current state so subscribers don't miss the initial value.
  try { cb({ ...state }); } catch { /* isolate */ }
  return () => { listeners.delete(cb); };
}
