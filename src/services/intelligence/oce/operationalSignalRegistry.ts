// R-OCE-V1 — Signal registry helpers.
// normalize, dedupe, sort, snapshot — all deterministic, no I/O.

import type {
  OperationalSignal,
  OperationalSeverity,
  OperationalModule,
  OperationalContextSnapshot,
} from './operationalContextTypes';

const SEVERITY_ORDER: Record<OperationalSeverity, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
};

export function normalizeSignal(signal: OperationalSignal): OperationalSignal {
  return {
    ...signal,
    score: Math.max(0, Math.min(100, signal.score)),
    createdAt: signal.createdAt > 0 ? signal.createdAt : Date.now(),
  };
}

// Dedupe by signal id — ids are stable, unique per detection condition per adapter.
// Prior type:entityId:sourceModule key collapsed all no-entityId signals from the
// same module+type into one, silently dropping distinct detections (expenses, approvals,
// employees, discounts adapters all affected).
export function dedupeOperationalSignals(
  signals: OperationalSignal[],
): OperationalSignal[] {
  const seen = new Set<string>();
  const out: OperationalSignal[] = [];
  for (const s of signals) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

// Sort: severity asc → score desc → createdAt desc.
export function sortOperationalSignals(
  signals: OperationalSignal[],
): OperationalSignal[] {
  return [...signals].sort((a, b) => {
    const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return b.createdAt - a.createdAt;
  });
}

export function buildOperationalContextSnapshot(
  signals: OperationalSignal[],
): OperationalContextSnapshot {
  const now = Date.now();
  const modules: OperationalContextSnapshot['modules'] = {};

  for (const sig of signals) {
    const m = sig.sourceModule as OperationalModule;
    if (!modules[m]) {
      modules[m] = { available: true, signalCount: 0 };
    }
    modules[m]!.signalCount++;
    const current = modules[m]!.highestSeverity;
    if (!current || SEVERITY_ORDER[sig.severity] < SEVERITY_ORDER[current]) {
      modules[m]!.highestSeverity = sig.severity;
    }
  }

  return { generatedAt: now, signals, modules };
}
