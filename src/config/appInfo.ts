// ============================================================
// R-PRODUCTION-B6.1: safe About/Diagnostics info (renderer-only).
//
// Assembles ONLY non-sensitive identification data for the in-app diagnostics
// surface so remote support can confirm version/platform/log location. It must
// NEVER carry license keys, hardware fingerprints, secrets, or customer/payment
// data. `containsSensitiveDiagnosticText` is a defensive guard used by tests to
// prove the rendered info is clean. Pure + deterministic.
// ============================================================

export interface SafeDiagnosticsInfo {
  version: string;
  platform: string;
  /** Static hint — where B3.1 writes logs. NOT a live filesystem path. */
  logsHint: string;
}

/** Static logs-location hint (B3.1 writes to userData/logs). */
export const LOGS_PATH_HINT =
  'Windows: %APPDATA%\\CellHub Pro\\logs\\cellhub-YYYY-MM-DD.log';

/** Pure assembler. Falls back to 'unknown' on empty inputs. Deterministic. */
export function getSafeDiagnosticsInfo(version: string, platform: string): SafeDiagnosticsInfo {
  return {
    version: version || 'unknown',
    platform: platform || 'unknown',
    logsHint: LOGS_PATH_HINT,
  };
}

/**
 * Defensive guard: true if `input` contains anything resembling a secret / key
 * / fingerprint that must never appear in the diagnostics surface. Used by
 * tests to assert the rendered info stays clean.
 */
export function containsSensitiveDiagnosticText(input: string): boolean {
  if (!input) return false;
  const s = String(input);
  if (/CHPRO-[A-Za-z0-9-]+/.test(s)) return true; // license key
  if (
    /(?:vite_bridge_auth_secret|api[_-]?key|access[_-]?token|secret|token|password|passwd|pwd|authorization|bearer|fingerprint|license[_-]?key)\s*[:=]/i.test(
      s,
    )
  ) {
    return true; // sensitive key/value pair
  }
  if (/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/.test(s)) return true; // long token-looking run
  return false;
}
