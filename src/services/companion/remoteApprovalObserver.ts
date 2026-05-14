// ============================================================
// CellHub Pro — Remote Approval Observer
// (R-COMPANION-REMOTE-APPROVAL-AUTHORITY-V1 PHASE 2A)
//
// PHASE 2A — SCAFFOLDING ONLY. This file defines the shape that the
// future hybrid prompter (Phase 2B) will consume. It does NOT:
//   - call approvalGuard
//   - call useApprovalGate
//   - resolve any pending PIN modal promise
//   - mutate any approval / store / money / inventory state
//   - bypass the local PIN authority
//
// When `companionRemoteApprovalEnabled === false` (the default) the
// observer is a true no-op even when invoked. When the setting is on,
// PHASE 2A still only LOGS and forwards to an optional listener —
// resolution remains the local PIN modal's job until PHASE 2B ships.
//
// PHASE 2B will:
//   - replace the adapter's current inbound approval-response logging
//     with a call to observer.observe(response)
//   - register a per-approvalId resolver from useApprovalGate so the
//     hybrid prompter can resolve when a matching response arrives
//   - extend approvalGuard's PrompterResponse union with a `remote`
//     branch that respects every existing security check
//     (canCurrentEmployeeApproveSelf, requiresApproval, role scope)
//
// See docs/companion-remote-approval-authority.md §6 Phase 2 for the
// full plan and security invariants.
// ============================================================

/** Action communicated by the Companion mobile app for an approval.
 *  `request_explanation` is a Phase 2C+ variant and is intentionally
 *  NOT in this union — Phase 2A scope is binary approve/deny only. */
export type RemoteApprovalAction = 'approve' | 'deny';

/** Normalised remote approval response. The desktop receives this
 *  shape after the bridge SDK validates the inbound payload. Only
 *  IDs flow — no manager names, no notes, no transaction data. */
export interface RemoteApprovalResponse {
  approvalId: string;
  action: RemoteApprovalAction;
  /** Employee id of the responding manager (already validated by the
   *  bridge SDK). PHASE 2B will additionally cross-check this against
   *  the local employees + role-permission matrix before resolution. */
  managerId: string;
  /** Audit-log source discriminator — always 'companion_remote' for
   *  responses produced by this observer. The local PIN flow writes
   *  the corresponding 'local_pin' value through its own audit path. */
  source: 'companion_remote';
  /** ms epoch the bridge delivered the response to the desktop. */
  receivedAt: number;
  /** Optional free-text note the manager entered on the Companion app.
   *  Read-only display only — never persisted, never used for auth. */
  managerNote?: string;
}

/** Options for the factory. The two slots are the only public surface
 *  needed to drive Phase 2B without re-touching this file. */
export interface RemoteApprovalObserverOptions {
  /** Returns the current value of settings.companionRemoteApprovalEnabled.
   *  Called per-observe; the caller is responsible for plumbing settings
   *  through. The default in production is `() => false`. */
  isEnabled: () => boolean;

  /** Optional Phase 2B hook. Phase 2A logs and (if provided) forwards
   *  to this listener. Phase 2B will register a per-approvalId resolver
   *  here from useApprovalGate. Errors thrown by the listener are
   *  isolated — they never poison the adapter's bus pipeline. */
  onResponse?: (response: RemoteApprovalResponse) => void;
}

/** The observer instance returned by the factory. Today the only
 *  method is `observe`. Phase 2B may add `subscribeForApproval(...)`
 *  for per-id resolver registration; not in this round. */
export interface RemoteApprovalObserver {
  /** Forward a normalised remote response through the observer. Safe
   *  to call regardless of the feature flag — gated internally. */
  observe(response: RemoteApprovalResponse): void;
}

/**
 * Build a Phase 2A observer.
 *
 * Behaviour (this round):
 *  - When `isEnabled()` returns false → no-op return.
 *  - When `isEnabled()` returns true  → log a single console.info line
 *    carrying the approvalId + action + managerId (no manager name,
 *    no note body), then forward to the optional `onResponse` listener
 *    if one was provided.
 *  - NEVER touches approvalGuard, useApprovalGate, persist, money
 *    helpers, store, or POS.
 *
 * Future (Phase 2B):
 *  - The adapter will swap its current inbound approval-response
 *    logging for `observer.observe(response)`.
 *  - useApprovalGate will register an `onResponse` listener scoped to
 *    the currently-pending approvalId and resolve its hybrid prompter
 *    promise — subject to the security rules in §3 of the design doc.
 *  - approvalGuard's PrompterResponse union will gain a `remote`
 *    branch with full permission/self-approval/role validation.
 */
export function createRemoteApprovalObserver(
  opts: RemoteApprovalObserverOptions,
): RemoteApprovalObserver {
  return {
    observe(response: RemoteApprovalResponse): void {
      // PHASE 2A no-op gate — must be the first line so a stale invoker
      // with stale state still gets the disabled-path semantics.
      if (!opts.isEnabled()) return;

      // Log only. No PII (manager name, note body) ever passes through.
      console.info(
        `[remote-approval-observer] PHASE-2A observed approvalId=${response.approvalId} action=${response.action} managerId=${response.managerId} source=${response.source} receivedAt=${response.receivedAt} (log-only)`,
      );

      // Optional forwarder — isolated so a listener bug cannot poison
      // the adapter's bus pipeline. PHASE 2B will treat this as the
      // hybrid-prompter resolution channel; PHASE 2A treats it as a
      // pure observation hook.
      if (typeof opts.onResponse === 'function') {
        try {
          opts.onResponse(response);
        } catch (err) {
          console.warn('[remote-approval-observer] onResponse listener threw', err);
        }
      }
    },
  };
}
