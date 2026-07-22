// ============================================================
// P0-C1c (F-B / F-F) — shared, idempotent phone-payment workflow cleanup.
//
// A committed sale (local POS OR LAN-forwarded checkout on the Primary) must
// close exactly the external-payment workflows of the phone-payment lines it
// sold — the set computed by finalizeSaleCore → sideEffects.completeWorkflowIds.
// Before this, ONLY local POS applied that side effect; the LAN dispatcher
// finalized the sale but never completed the workflows, leaving them pending
// (F-B). This is the ONE cleanup used by every real finalizeSaleCore caller so
// they can never diverge.
//
// Contract:
//   - MUST be called only AFTER the sale is committed/persisted (never before,
//     never on a rejected/failed finalize).
//   - Idempotent: completeWorkflow() no-ops on an already-completed/missing id,
//     so a retry / double-fire is safe.
//   - Defensive dedupe.
//   - NEVER throws — a localStorage cleanup failure must never revert a sale
//     that already persisted (F-F). Failures are logged (truncated id, no PII)
//     and surfaced via the returned failedIds for observability.
//
// NOTE (LAN topology, documented limitation): the workflow continuity store is
// localStorage-backed and MACHINE-LOCAL. A Secondary that launched the portal
// owns the pending workflow record; when its checkout is forwarded, the Primary
// commits the sale and calls this cleanup, but the Primary's store does not hold
// the Secondary's workflow id → completeWorkflow() no-ops there (idempotent, no
// error). Cross-machine completion propagation is out of P0-C1c scope. This
// still correctly closes any workflow that lives on the committing machine.
// ============================================================

import { completeWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityStore';

// P0-C1d: 'lan-secondary' = the Secondary completes its OWN machine-local
// workflow after a committed forwarded checkout (the owning machine); the
// Primary uses 'lan-primary' (idempotent no-op for ids it does not own).
export type WorkflowCleanupContext = 'local' | 'lan-primary' | 'lan-secondary';

export interface WorkflowCleanupResult {
  /** Distinct ids attempted after dedupe. */
  attempted: number;
  /** How many completeWorkflow() calls returned without throwing. */
  completed: number;
  /** Ids whose completeWorkflow() threw — for observability, never fatal. */
  failedIds: string[];
}

/** Truncate a synthetic workflow id for safe logging (never full PII). */
function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-2)}`;
}

/**
 * Complete the given phone-payment workflow ids for a COMMITTED sale. Pure of
 * UI; performs the store writes. Deduped, idempotent, never throws.
 */
export function completeCommittedPhonePaymentWorkflows(
  ids: ReadonlyArray<string> | null | undefined,
  context: WorkflowCleanupContext,
  saleId?: string,
): WorkflowCleanupResult {
  const unique = [...new Set((ids || []).filter((id): id is string => !!id))];
  const failedIds: string[] = [];
  let completed = 0;

  for (const id of unique) {
    try {
      completeWorkflow(id);
      completed++;
    } catch (err) {
      failedIds.push(id);
      try {
        // eslint-disable-next-line no-console
        console.warn('[phone-payment-cleanup] completeWorkflow failed', {
          context,
          workflowId: shortId(id),
          saleId,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch { /* logging must never throw */ }
    }
  }

  if (failedIds.length > 0) {
    try {
      // eslint-disable-next-line no-console
      console.warn('[phone-payment-cleanup] some workflows failed to complete', {
        context,
        saleId,
        failedCount: failedIds.length,
      });
    } catch { /* noop */ }
  }

  return { attempted: unique.length, completed, failedIds };
}
