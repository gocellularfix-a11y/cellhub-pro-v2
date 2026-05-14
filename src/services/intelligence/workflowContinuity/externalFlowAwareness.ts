// CellHub Intelligence — External Flow Awareness
// Detects when the cashier returns to CellHub after visiting a carrier portal.
// Uses visibilitychange + window focus. 30-second cooldown prevents repeat fires.
// Pure side-effectful module — no React, no store writes.

const COOLDOWN_MS = 30_000;

let lastFiredAt = 0;
let initialized = false;
const subscribers = new Set<() => void>();

function fireReturnSignal(): void {
  const now = Date.now();
  if (now - lastFiredAt < COOLDOWN_MS) return;
  lastFiredAt = now;
  subscribers.forEach((cb) => { try { cb(); } catch { /* subscriber errors are non-fatal */ } });
}

function onVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    fireReturnSignal();
  }
}

function onWindowFocus(): void {
  fireReturnSignal();
}

/**
 * Attach document.visibilitychange + window.focus listeners.
 * Idempotent — calling more than once is safe.
 * Returns a cleanup function that removes listeners and resets state.
 */
export function initExternalFlowAwareness(): () => void {
  if (initialized) {
    return () => { /* already running — caller's cleanup is a no-op */ };
  }
  initialized = true;
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onWindowFocus);
  }
  return () => {
    initialized = false;
    lastFiredAt = 0;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onWindowFocus);
    }
  };
}

/** Subscribe to return-detection events. Returns an unsubscribe function. */
export function subscribeExternalFlowReturn(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Reset the cooldown timer (e.g. after the cashier acknowledges the confirmation). */
export function resetReturnCooldown(): void {
  lastFiredAt = 0;
}
