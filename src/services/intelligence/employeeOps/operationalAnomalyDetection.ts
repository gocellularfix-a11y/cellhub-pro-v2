// CellHub Intelligence — Operational Anomaly Detection
// Runs all signal detectors and returns a sorted, capped anomaly list.
// Pure function — safe inside useMemo. Max 8 signals returned.

import type { OperationalHealthContext, OperationalSignal } from './employeeOpsTypes';
import {
  detectRepairDelays,
  detectRepairsReadyForPickup,
  detectOverdueLayaways,
  detectUnfinishedWorkflows,
  detectHighDiscountActivity,
  detectHighApprovalActivity,
  detectRepairBalanceLeak,
  detectAccessoryAttachOpportunity,
} from './employeeOpsSignals';

const MAX_SIGNALS = 8;

/**
 * Run all anomaly detectors against the current operational context.
 * Returns signals sorted by priority descending, capped at MAX_SIGNALS.
 * All detectors are fail-safe — a detector error yields no signal, never throws.
 */
export function computeAnomalies(ctx: OperationalHealthContext): OperationalSignal[] {
  const signals: OperationalSignal[] = [];

  function tryDetect(fn: () => OperationalSignal | null): void {
    try {
      const result = fn();
      if (result) signals.push(result);
    } catch { /* detector failure — non-fatal, never blocks other detectors */ }
  }

  // Workflow completion (highest operational priority)
  tryDetect(() => detectUnfinishedWorkflows(ctx.pendingWorkflowCount));

  // Revenue protection
  tryDetect(() => detectOverdueLayaways(ctx.layaways));
  tryDetect(() => detectRepairBalanceLeak(ctx.repairs));

  // Repair operations
  tryDetect(() => detectRepairDelays(ctx.repairs));
  tryDetect(() => detectRepairsReadyForPickup(ctx.repairs));

  // Session behavior signals
  tryDetect(() => detectHighDiscountActivity(ctx.recentActions));
  tryDetect(() => detectHighApprovalActivity(ctx.recentActions));

  // Upsell opportunities
  tryDetect(() => detectAccessoryAttachOpportunity(ctx.recentActions, ctx.sales));

  return signals
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_SIGNALS);
}
