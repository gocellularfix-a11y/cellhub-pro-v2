// CellHub Intelligence — Workflow Continuity Engine
// Pure function — safe to call inside useMemo.

import { getPendingExternalPaymentWorkflow } from './workflowContinuityStore';
import type { WorkflowConfirmationSignal } from './workflowContinuityTypes';

/**
 * Build the current confirmation signal from store state + caller-supplied
 * return-detection flag. Stateless — every call reads fresh from localStorage.
 */
export function getConfirmationSignal(returnDetected: boolean): WorkflowConfirmationSignal {
  const pending = getPendingExternalPaymentWorkflow();
  return {
    hasPending: !!pending,
    pendingWorkflow: pending,
    returnDetected,
  };
}
