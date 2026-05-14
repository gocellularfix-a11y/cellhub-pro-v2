// CellHub Intelligence — Employee Ops Engine
// Facade: assembles all sub-engines into one OperationalHealthSnapshot.
// Pure function — safe inside useMemo. No side effects, no DOM, no I/O.

import type { OperationalHealthContext, OperationalHealthSnapshot } from './employeeOpsTypes';
import { computeAnomalies } from './operationalAnomalyDetection';
import { toMs } from '@/services/intelligence/customerScoring/customerOpportunitySignals';

const READY_STATUSES = new Set(['completed', 'ready', 'ready_for_pickup']);
const TERMINAL_STATUSES = new Set(['picked_up', 'cancelled', 'refunded', 'refund_pending']);

/**
 * Compute the full operational health snapshot from the current store state.
 * Call inside a useMemo keyed on repairs, layaways, sales, recentActions.
 */
export function computeOperationalHealth(ctx: OperationalHealthContext): OperationalHealthSnapshot {
  const now = Date.now();
  const signals = computeAnomalies(ctx);

  // Quick aggregate counts for the snapshot (O(R) + O(L) passes).
  const overdueRepairCutoff = now - 7 * 24 * 60 * 60 * 1000;

  let overdueRepairCount = 0;
  let readyForPickupCount = 0;

  for (const r of ctx.repairs) {
    const s = String(r.status || '').toLowerCase().trim();
    if (TERMINAL_STATUSES.has(s)) continue;
    if (READY_STATUSES.has(s)) {
      readyForPickupCount++;
      continue;
    }
    // Active repair — check age
    const ts = toMs(r.createdAt);
    if (ts > 0 && ts < overdueRepairCutoff) overdueRepairCount++;
  }

  let overdueLayawayCount = 0;
  for (const l of ctx.layaways) {
    const s = String(l.status || '').toLowerCase();
    if (s === 'completed' || s === 'cancelled') continue;
    if (!l.balance || l.balance <= 0 || !l.dueDate) continue;
    const due = toMs(l.dueDate);
    if (due > 0 && due < now) overdueLayawayCount++;
  }

  return {
    signals,
    activeWorkflowCount: ctx.pendingWorkflowCount,
    overdueRepairCount,
    readyForPickupCount,
    overdueLayawayCount,
    computedAt: now,
  };
}
