// ============================================================
// CellHub Intelligence — temporary perf instrumentation helper
// R-INTELLIGENCE-PERFORMANCE-AUDIT-V1
//
// Pure tooling. No business logic. No persistence. No UI. Logs only
// when the owner explicitly opts in via:
//   localStorage.setItem('cellhub:intelligence:perfDebug', '1')
// and only emits warnings for blocks that exceed 10ms — keeps the
// console quiet on healthy devices.
//
// Remove (or keep behind the flag) once the freeze root cause is
// identified.
// ============================================================

const FLAG_KEY = 'cellhub:intelligence:perfDebug';

function isEnabled(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

// Read the flag once per module load. Owner must reload after toggling.
const INTEL_PERF_DEBUG = isEnabled();

const THRESHOLD_MS = 10;

/**
 * Log the elapsed milliseconds since `start` if the perf-debug flag
 * is enabled AND the duration crosses the noise threshold.
 *
 * Usage:
 *   const t0 = performance.now();
 *   ...heavy work...
 *   perfLog('intel.module.engine.updateData', t0);
 */
export function perfLog(label: string, start: number): void {
  if (!INTEL_PERF_DEBUG) return;
  const ms = Math.round(performance.now() - start);
  if (ms < THRESHOLD_MS) return;
  // eslint-disable-next-line no-console
  console.warn(`[INTEL PERF] ${label}: ${ms}ms`);
}

/**
 * Convenience: time a synchronous function. Returns its result.
 * Use when the call site is a single expression.
 *   const result = perfTime('intel.engine.analyze', () => engine.analyze());
 */
export function perfTime<T>(label: string, fn: () => T): T {
  if (!INTEL_PERF_DEBUG) return fn();
  const t0 = performance.now();
  const result = fn();
  perfLog(label, t0);
  return result;
}
