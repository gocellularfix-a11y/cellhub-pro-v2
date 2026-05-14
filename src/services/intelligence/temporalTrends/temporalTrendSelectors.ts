// CellHub Intelligence — Temporal Trend Selectors
// Pure read-only helpers for TemporalTrendSnapshot.

import type { TemporalTrendSnapshot, TrendMode, TemporalTrendSignal, TemporalTrendSignalKind } from './temporalTrendTypes';

/** Short badge label for the bubble preview strip (≤ 36 chars). */
export function getTrendModeLabel(mode: TrendMode): string {
  const LABELS: Record<TrendMode, string> = {
    stable:                'Activity stable',
    improving:             'Store improving',
    worsening:             'Conditions worsening',
    accelerating:          'Momentum accelerating',
    slowing:               'Sales momentum slowing',
    recovering:            'Store recovering',
    risk_increasing:       'Repair risk increasing',
    opportunity_increasing:'Opportunity pressure rising',
  };
  return LABELS[mode] ?? 'Activity stable';
}

/** True when the trend mode is non-stable and worth surfacing. */
export function isTemporalTrendActionable(snapshot: TemporalTrendSnapshot): boolean {
  return snapshot.trendMode !== 'stable';
}

/** Highest-priority trend signal, or null when none. */
export function getTopTrendSignal(snapshot: TemporalTrendSnapshot): TemporalTrendSignal | null {
  if (!snapshot.detectedTrendSignals.length) return null;
  return [...snapshot.detectedTrendSignals].sort((a, b) => b.priority - a.priority)[0];
}

/** All signals of a given kind. */
export function getTrendSignalsByKind(
  snapshot: TemporalTrendSnapshot,
  kind: TemporalTrendSignalKind,
): TemporalTrendSignal[] {
  return snapshot.detectedTrendSignals.filter((s) => s.kind === kind);
}
