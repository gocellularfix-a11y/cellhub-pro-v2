// R-OCE-V1 — Pure query helpers over an OperationalContextSnapshot.
// No I/O, no side effects. All functions are deterministic.

import type {
  OperationalContextSnapshot,
  OperationalSignal,
  OperationalModule,
  OperationalSignalType,
  OperationalSeverity,
} from './operationalContextTypes';

export function getTopOperationalSignals(
  snapshot: OperationalContextSnapshot,
  limit: number,
): OperationalSignal[] {
  return snapshot.signals.slice(0, limit);
}

export function getSignalsByModule(
  snapshot: OperationalContextSnapshot,
  module: OperationalModule,
): OperationalSignal[] {
  return snapshot.signals.filter((s) => s.sourceModule === module);
}

export function getSignalsByType(
  snapshot: OperationalContextSnapshot,
  type: OperationalSignalType,
): OperationalSignal[] {
  return snapshot.signals.filter((s) => s.type === type);
}

export function getCriticalSignals(
  snapshot: OperationalContextSnapshot,
): OperationalSignal[] {
  return snapshot.signals.filter((s) => s.severity === 'critical');
}

export function getActionableSignals(
  snapshot: OperationalContextSnapshot,
): OperationalSignal[] {
  return snapshot.signals.filter((s) => s.actionable);
}

export function getModuleStatus(
  snapshot: OperationalContextSnapshot,
): Array<{
  module: OperationalModule;
  available: boolean;
  signalCount: number;
  highestSeverity?: OperationalSeverity;
}> {
  return (Object.entries(snapshot.modules) as [OperationalModule, NonNullable<OperationalContextSnapshot['modules'][OperationalModule]>][])
    .map(([module, info]) => ({ module, ...info }))
    .sort((a, b) => a.module.localeCompare(b.module));
}
