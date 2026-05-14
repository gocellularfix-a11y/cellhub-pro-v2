// CellHub Intelligence — Store Rhythm Selectors
// Pure read-only helpers for StoreRhythmSnapshot.

import type { StoreRhythmSnapshot, StoreMode, RhythmSignal, StoreRhythmSignalKind } from './storeRhythmTypes';

/** Short badge label for the current mode — fits in the bubble preview strip. */
export function getRhythmModeLabel(mode: StoreMode): string {
  const LABELS: Record<StoreMode, string> = {
    normal:            'Store rhythm normal',
    slow_day:          'Slow day · recover customers',
    rush:              'Rush — stay focused',
    repair_overload:   'Repair overload detected',
    collection_mode:   'Collection mode active',
    revenue_recovery:  'Revenue recovery window',
    low_activity:      'Store quiet — follow up',
    opportunity_window:'Opportunity window active',
  };
  return LABELS[mode] ?? 'Store rhythm normal';
}

/** True when the mode is non-normal and warrants surfacing to the cashier. */
export function isRhythmActionable(snapshot: StoreRhythmSnapshot): boolean {
  return snapshot.currentMode !== 'normal';
}

/** Highest-priority rhythm signal, or null when none. */
export function getTopRhythmSignal(snapshot: StoreRhythmSnapshot): RhythmSignal | null {
  if (!snapshot.detectedRhythmSignals.length) return null;
  return [...snapshot.detectedRhythmSignals].sort((a, b) => b.priority - a.priority)[0];
}

/** Signals filtered by kind. */
export function getRhythmSignalsByKind(
  snapshot: StoreRhythmSnapshot,
  kind: StoreRhythmSignalKind,
): RhythmSignal[] {
  return snapshot.detectedRhythmSignals.filter((s) => s.kind === kind);
}

/** True when repair or payment load is high enough to warrant attention. */
export function isUnderOperationalPressure(snapshot: StoreRhythmSnapshot): boolean {
  return snapshot.operationalLoadScore >= 40;
}
