// ============================================================
// CellHub Pro — Remote Approval Gateway
// (R-COMPANION-REMOTE-APPROVAL-RESOLUTION-V1)
//
// One-shot resolver registry. The bridge adapter calls
// dispatchRemoteApprovalResponse() when Companion mobile sends an
// approve/deny. useApprovalGate registers a per-id handler via
// registerApprovalResolver() when a gate opens. The handler runs
// validateRemoteApprovalActor() before resolving the local prompter
// promise — the gate never sees an unvalidated remote response.
//
// Invariants:
//   - Each approvalId maps to at most one handler (Map semantics).
//   - Handler is called at most once — entry deleted on dispatch.
//   - Expired / unknown / already-resolved ids are silent no-ops.
//   - No I/O, no React, no DOM — safe to import from any layer.
// ============================================================

import type { RemoteApprovalResponse } from './remoteApprovalObserver';

type ApprovalHandler = (response: RemoteApprovalResponse) => void;

const pending = new Map<string, ApprovalHandler>();

/**
 * Register a one-shot resolver for a specific pending approval gate.
 * Returns an unsubscribe fn — call it when the gate resolves locally
 * (cancelled, PIN entered) so the entry is cleaned up.
 */
export function registerApprovalResolver(
  approvalId: string,
  handler: ApprovalHandler,
): () => void {
  pending.set(approvalId, handler);
  return () => { pending.delete(approvalId); };
}

/**
 * Route a remote response to the waiting gate. Returns 'dispatched'
 * when a handler was found and called, 'no_pending' otherwise
 * (gate expired, already resolved, or unknown id). Never throws.
 */
export function dispatchRemoteApprovalResponse(
  response: RemoteApprovalResponse,
): 'dispatched' | 'no_pending' {
  const handler = pending.get(response.approvalId);
  if (!handler) return 'no_pending';
  pending.delete(response.approvalId);
  try {
    handler(response);
  } catch (err) {
    console.warn('[remote-approval-gateway] handler threw', err);
  }
  return 'dispatched';
}
