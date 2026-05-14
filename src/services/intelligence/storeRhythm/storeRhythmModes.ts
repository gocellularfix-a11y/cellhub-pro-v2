// CellHub Intelligence — Store Mode Selection
// Deterministic mode selection from detected rhythm signals.
// Priority order: rush > repair_overload > collection_mode > opportunity_window
//                 > slow_day > low_activity > revenue_recovery > normal

import type { StoreMode, StoreRhythmSignalKind, RhythmSignal } from './storeRhythmTypes';

function hasSignal(signals: RhythmSignal[], kind: StoreRhythmSignalKind): boolean {
  return signals.some((s) => s.kind === kind);
}

/** Deterministically select the store's current operating mode from detected signals. */
export function selectStoreMode(
  signals: RhythmSignal[],
  revenueOpportunityCount: number,
): StoreMode {
  if (hasSignal(signals, 'rush'))             return 'rush';
  if (hasSignal(signals, 'repair_overload'))  return 'repair_overload';
  if (hasSignal(signals, 'collection_mode'))  return 'collection_mode';
  if (hasSignal(signals, 'opportunity_window') && hasSignal(signals, 'low_activity')) {
    return 'opportunity_window';
  }
  if (hasSignal(signals, 'slow_day'))         return 'slow_day';
  if (hasSignal(signals, 'low_activity'))     return 'low_activity';
  if (revenueOpportunityCount >= 4)           return 'revenue_recovery';
  return 'normal';
}

/** Recommended tab action IDs for the current mode (informational only). */
export function getRecommendedActionsForMode(mode: StoreMode): string[] {
  switch (mode) {
    case 'rush':             return [];
    case 'repair_overload':  return ['act_open_repairs'];
    case 'collection_mode':  return ['act_open_repairs', 'act_open_layaways'];
    case 'opportunity_window': return ['act_open_customers', 'act_open_pos'];
    case 'slow_day':         return ['act_open_customers'];
    case 'low_activity':     return ['act_open_customers'];
    case 'revenue_recovery': return ['act_open_customers', 'act_open_repairs'];
    default:                 return [];
  }
}
