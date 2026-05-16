// R-INTELLIGENCE-ATTENTION-MODEL-V1
// localStorage-backed attention signal log. Append-only, rolling 2-hour window.
// Tracks lightweight operational signals only.
// NO keystroke logging. NO invasive telemetry. NO external analytics.

const STORAGE_KEY    = 'cellhub:attentionSignals:v1';
const MAX_SIGNALS    = 200;
const WINDOW_2H_MS   = 2 * 60 * 60 * 1000;

export type AttentionSignalType =
  | 'bubble_dismissed'
  | 'suggestion_accepted'
  | 'suggestion_ignored'
  | 'checkout_burst'
  | 'workflow_completed';

export interface AttentionSignal {
  type:       AttentionSignalType;
  timestamp:  number;
  trigger?:   string;
}

// ── Internal I/O ──────────────────────────────────────────────────────────────

function readAll(): AttentionSignal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AttentionSignal[]) : [];
  } catch { return []; }
}

function writeAll(signals: AttentionSignal[]): void {
  try {
    const cutoff  = Date.now() - WINDOW_2H_MS;
    const trimmed = signals.filter(s => s.timestamp >= cutoff).slice(-MAX_SIGNALS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota / incognito — best-effort */ }
}

// ── Public writes ─────────────────────────────────────────────────────────────

export function recordAttentionSignal(
  type: AttentionSignalType,
  meta?: { trigger?: string },
): void {
  const all = readAll();
  all.push({ type, timestamp: Date.now(), trigger: meta?.trigger });
  writeAll(all);
}

// ── Public reads ──────────────────────────────────────────────────────────────

export function readRecentSignals(windowMs = 30 * 60 * 1000): AttentionSignal[] {
  const cutoff = Date.now() - windowMs;
  return readAll().filter(s => s.timestamp >= cutoff);
}

export function countSignals(
  type:     AttentionSignalType,
  windowMs = 30 * 60 * 1000,
): number {
  return readRecentSignals(windowMs).filter(s => s.type === type).length;
}

// Dismissal count for a specific trigger — used for dismissal-learning multiplier.
export function getTriggerDismissalCount(
  trigger:  string,
  windowMs = 60 * 60 * 1000,
): number {
  return readRecentSignals(windowMs).filter(
    s => s.type === 'bubble_dismissed' && s.trigger === trigger,
  ).length;
}
