// ============================================================
// CellHub Pro — Colibrí launcher resolution (P1-COLIBRI-LAUNCHER)
//
// Pure decision layer for the Colibrí launcher page. Colibrí is an
// INDEPENDENT application: CellHub only resolves a configured launch
// target and classifies how (or whether) it can be opened. No Colibrí
// code, database, or API is touched here — and an unavailable Colibrí
// never affects CellHub.
//
// Accepted targets:
//   - https:// (or http://) URL → opened with the existing external-URL
//     hardening (window.open → Electron setWindowOpenHandler → system
//     browser; plain browser tab outside Electron).
//   - Absolute Windows .exe path → opened ONLY through the narrow
//     validated electron channel (colibriLaunch); impossible in a plain
//     browser session.
// Anything else is invalid — the launcher shows Not Configured / invalid
// state instead of guessing.
// ============================================================

export type ColibriLaunchKind = 'url' | 'path';

export type ColibriLaunchState =
  | { state: 'disabled' }
  | { state: 'not_configured' }
  | { state: 'invalid_target'; raw: string }
  | { state: 'ready'; kind: ColibriLaunchKind; target: string }
  | { state: 'path_needs_desktop'; target: string };

export interface ColibriConfig {
  enabled: boolean;
  target: string;
  lastLaunchAt?: string;
}

/** Read the launcher config from settings (double-cast pattern — no store types touched). */
export function readColibriConfig(settings: unknown): ColibriConfig {
  const s = (settings || {}) as Record<string, unknown>;
  return {
    enabled: s.colibriEnabled === true,
    target: typeof s.colibriTarget === 'string' ? s.colibriTarget.trim() : '',
    lastLaunchAt: typeof s.colibriLastLaunchAt === 'string' ? s.colibriLastLaunchAt : undefined,
  };
}

/** True for an http(s) URL parseable by the URL constructor. */
export function isApprovedUrl(target: string): boolean {
  try {
    const u = new URL(target);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** True for an absolute Windows .exe path (C:\...\App.exe or UNC \\host\...). */
export function isExecutablePath(target: string): boolean {
  const t = target.trim();
  if (!/\.exe$/i.test(t)) return false;
  return /^[a-zA-Z]:[\\/]/.test(t) || /^\\\\/.test(t);
}

/**
 * Classify the configured target. `canLaunchPath` = the narrow Electron
 * channel is actually available in this session (desktop app).
 */
export function resolveColibriLaunch(
  config: ColibriConfig,
  canLaunchPath: boolean,
): ColibriLaunchState {
  if (!config.enabled) return { state: 'disabled' };
  if (!config.target) return { state: 'not_configured' };
  if (isApprovedUrl(config.target)) return { state: 'ready', kind: 'url', target: config.target };
  if (isExecutablePath(config.target)) {
    return canLaunchPath
      ? { state: 'ready', kind: 'path', target: config.target }
      : { state: 'path_needs_desktop', target: config.target };
  }
  return { state: 'invalid_target', raw: config.target };
}

/** Validation used by the config form before saving. */
export function isValidColibriTarget(target: string): boolean {
  const t = target.trim();
  if (!t) return false;
  return isApprovedUrl(t) || isExecutablePath(t);
}
