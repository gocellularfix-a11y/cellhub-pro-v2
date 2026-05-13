# Companion Remote Approval Authority — Design

**Status:** DESIGN ONLY — no code changes in this round.
**Scope:** How to let a manager approve / deny a restricted action from the
Companion mobile app without weakening the existing local-PIN authority.
**Round marker (future):** `R-COMPANION-REMOTE-APPROVAL-AUTHORITY-V1`.

---

## 1. Current approval authority flow

Today the local desktop is the **only** authority. The chain is:

```
employee triggers restricted action (LayawayModule, repairs, etc.)
   │
   ▼
useApprovalGate.requestApproval(req)                   [src/hooks/useApprovalGate.ts]
   │  - opens <ApprovalPinModal>
   │  - injected `prompter` returns the typed PIN
   │
   ▼
approvalGuard.requestApproval(req, ctx)                [src/services/security/approvalGuard.ts]
   │  - settings.approvalsEnabled gate (feature_disabled → passthrough)
   │  - isApprovalNeeded() (not_required → passthrough)
   │  - emit APPROVAL_CREATED (companionEventBus + adapter to bridge)
   │  - call prompter → PIN
   │  - verifyApprovalPin(pin, employees)
   │     ├─ canCurrentEmployeeApproveSelf() guard (self_approval_blocked)
   │     └─ matched employee id   → approved
   │  - else verifyAdminPin(pin, settings)
   │     └─ admin                  → approved (ADMIN_APPROVER_ID)
   │  - else                       → denied (invalid_pin)
   │
   ▼
approvalLog.appendApprovalEvent(...)                   [src/services/approvalLog.ts]
   │
   ▼
APPROVAL_APPROVED / APPROVAL_DENIED emitted on the bus.
Caller proceeds ONLY when result.approved === true.
```

Key invariants:

- `approvalGuard` is a **pure orchestrator** — decoupled from React + DOM by
  design. Its `prompter` parameter is modal-agnostic. The local-PIN flow is
  one implementation of `ApprovalPrompter`; a remote-driven flow can be
  another.
- `approvalsEnabled = false` short-circuits at the top of the guard.
  Manager/admin can flip the kill-switch in Settings instantly.
- `APPROVAL_CREATED` / `APPROVAL_APPROVED` / `APPROVAL_DENIED` are emitted
  to the companion event bus regardless of bridge state — the read-model
  (`companionApprovalRuntime`) tracks pending counts locally.

---

## 2. Required remote approval flow

The future flow lets a remote manager (Companion mobile) respond to the same
gate without touching the desktop. Local-PIN remains a parallel option.

```
employee triggers restricted action
   │
   ▼
useApprovalGate.requestApproval(req)
   │  if (settings.companionRemoteApprovalEnabled && bridge connected):
   │     start a HYBRID prompter that:
   │        - shows the local PIN modal AS USUAL
   │        - in parallel, registers a "pending remote response" listener
   │          keyed by approvalId
   │        - first responder wins; the other is cancelled
   │  else: behaves exactly as today (local PIN only)
   │
   ▼
approvalGuard.requestApproval(req, ctx)
   │  - emits APPROVAL_CREATED → companion bridge sees it
   │
   ▼
HYBRID prompter awaits the FIRST of:
   ┌─────────────────────────────────────────────┐
   │  A) local PIN submitted (existing path)      │  →  PrompterResponse { pin }
   │  B) remote approve/deny arrives via bridge   │  →  PrompterResponse{remote}
   │  C) timeout / cancel                         │  →  PrompterResponse{cancelled}
   └─────────────────────────────────────────────┘
   │
   ▼
approvalGuard validates the response:
   - Local PIN path:  unchanged (employee match | admin | bad PIN | self-block)
   - Remote path:     validates against security rules in §3
   - Final ApprovalResult identical shape; caller proceeds on `approved`
```

The hybrid prompter is the **single** insertion point. `approvalGuard`,
`approvalLog`, and the caller modules (LayawayModule, etc.) do not change
their contract.

---

## 3. Security rules

These are **mandatory** for any phase that resolves real approvals via the
remote path. Phase 1 (logging-only) ignores them — but the design must
enforce them by phase 2.

1. **Local PIN remains authority until remote authority is explicitly
   enabled.** A new setting `companionRemoteApprovalEnabled?: boolean`
   gates the remote path. Default `false`. The local PIN modal is always
   shown; remote responses arriving when the setting is off are
   acknowledged and logged but **never** resolve a pending gate.

2. **No self-approval.** A remote response whose `managerId` matches the
   `requestedByEmployeeId` of the pending request is denied with reason
   `self_approval_blocked`. Owners are exempt **only if the local
   `canCurrentEmployeeApproveSelf` policy already exempts them** —
   the remote path defers to the same helper, never reinvents it.

3. **Admin / manager role required.** The remote response carries a
   `managerId`. The guard validates this id belongs to an employee
   with a role permitted to approve the specific `actionType` (same
   `requiresApproval(actionType, requester, settings)` check used
   locally). Unrecognised `managerId` → denied with reason
   `unknown_approver`.

4. **Approval must not be expired.** Each pending request carries
   `expiresAt`. Remote responses received after `expiresAt` are denied
   with reason `expired`. The hybrid prompter MUST clear the pending
   listener on expiry so a late-arriving response cannot retroactively
   resolve a gate.

5. **Approval must match a pending request id.** Responses carry
   `requestId`. If the desktop has no pending gate with that id (already
   resolved, never opened, or different store), the response is logged
   and dropped — `unknown_request`. The guard never resolves a stale
   pending request that was already terminated.

6. **Duplicate approve/deny ignored.** Once a pending gate is resolved
   (locally or remotely), the hybrid prompter clears its remote listener.
   Bridge SDK already dedupes by `requestId` for 60s (see
   `bridge/desktop/approvalEmitter.ts` `isDuplicate`); the desktop adds
   a second-line dedup so even if the SDK dedup window misses (cross-
   reconnect, hot-reload), a second response is a no-op.

7. **Bridge transport off ≠ feature off.** When
   `settings.companionBridgeEnabled = false` OR the bridge is in
   `disconnected` / `rejected` state, the hybrid prompter falls back to
   local-PIN-only. Remote responses cannot arrive without a transport.

8. **PIN bypass forbidden.** A remote response never carries a PIN. It
   carries `{ requestId, action, managerId, respondedAt, managerNote? }`.
   The guard maps `managerId` to a verified employee identity (must be
   already-registered + role-allowed). Mobile cannot inject a PIN
   replacement.

9. **Permission scope respected.** If a manager's role can approve
   `DISCOUNT_OVERRIDE` but not `REFUND`, the remote response for a
   `REFUND` from that manager is denied — even if the manager id is
   valid. Same check as local.

---

## 4. Race conditions

| Race | Outcome | Mitigation |
|---|---|---|
| **Local manager and mobile manager respond simultaneously** | First-to-arrive resolves the gate; second is dropped as a duplicate-resolve. | Hybrid prompter resolves on first response via `Promise.race`; cancels the other listener. Audit log records the winner only; loser is logged at `console.info` for traceability. |
| **Approval expires while mobile screen is open** | Gate auto-denied with `expired`. Mobile button taps after expiry are dropped (rule §3.4). | Desktop runs an `expiresAt` timer that calls `prompter.reject({ reason: 'expired' })` when fired. Bridge expiry event (`APPROVAL_EXPIRED`) is also emitted so mobile UI greys out the card. |
| **Employee retries same restricted action** | Each invocation of `useApprovalGate.requestApproval` generates a **new** `approvalId`. Old pending gates auto-expire. Mobile may see 2+ cards for the "same" action — that's by design; UX treats each as a distinct request. | Document for mobile UX: never reuse `approvalId` across retries on the desktop side. |
| **Bridge reconnect replays event** | Bridge SDK + adapter dedup by `requestId`. If a duplicate `APPROVAL_RESPONDED` arrives, the in-process dedup map in `approvalEmitter` swallows it within 60s. Beyond 60s, the desktop's local "already resolved" check (rule §3.5) catches it. | Dedup at both transport and orchestrator layers; never trust the network alone. |
| **Manager hot-reloads desktop mid-gate** | Pending gate is lost on reload (React state, not persisted). Mobile may still send a response. Desktop sees `unknown_request` and drops it. Employee re-runs the action; new gate opens. | Acceptable behavior. Persisting in-flight gates across reload is **out of scope** — desktop is a fresh-start surface. |
| **Two managers on two mobiles approve at the same time** | Bridge fans out `APPROVAL_RESPONDED` to all manager devices (multi-manager sync). Desktop receives both responses; one wins, other dropped as duplicate (rule §3.6). Audit records the winner. | Bridge already broadcasts updates to managers room — that's the established multi-device path. |
| **Approval succeeds locally but mobile timeout fires** | Mobile UI shows "timeout"; desktop already processed the local approval. The action proceeds locally. Mobile receives a stale-state correction via `APPROVAL_UPDATED` event. | Mobile should NOT mutate desktop on its own timeout — the timeout is local-UX only. Bridge contract: only the desktop emits terminal status. |
| **Manager dismisses mobile alert that maps to no pending gate (already resolved)** | Drop with `unknown_request` log. No-op. | Hybrid prompter's listener is keyed by current `requestId`. Stale responses on stale ids are ignored. |
| **Adapter not started but mobile sends a response** | Bridge SDK buffers (offline queue, 24h TTL). When adapter starts and reconnects, response arrives → goes through normal resolution path. If the desktop has no pending gate by then, dropped per §3.5. | Acceptable: offline-resilient by transport, gate freshness by desktop. |
| **Employee cancels their own restricted action client-side before mobile responds** | Desktop's PIN modal close → prompter resolves with `cancelled`. Late mobile response → `unknown_request`. Mobile UI shows the request as expired/cancelled via `APPROVAL_UPDATED`. | Standard "first-resolver wins". Mobile is a passive observer once cancelled. |

---

## 5. Audit requirements

Every approval decision — local or remote — produces ONE `ApprovalEvent`
appended to `approvalLog`. Today the schema is:

```ts
interface ApprovalEvent {
  id: string;
  requestedByEmployeeId: string;
  approvedByEmployeeId: string;     // empId | 'approver:admin' | ''
  actionType: ApprovalActionType;
  category?: ApprovalCategory;
  status?: ApprovalStatus;
  entityId?: string;
  createdAt: number;                // ms epoch
}
```

Required additions for remote authority (proposed; not added in this round):

| New field | Type | Notes |
|---|---|---|
| `source` | `'local_pin' \| 'companion_remote'` | Required. Records which authority resolved this gate. |
| `approvalId` | `string` | Same id used end-to-end (companion bus, bridge, mobile UI). Enables join across logs + bus history. |
| `deviceId?` | `string` | When `source === 'companion_remote'`, the paired Companion device that responded. Helps trace if a single phone is responsible for unusual patterns. |
| `respondedAt?` | `number` | Server-side ms timestamp from the bridge response, in addition to local `createdAt`. Latency surface. |
| `managerNote?` | `string` | Optional free-text note the manager attached on mobile. Capped at 240 chars. **Subject to PII review** — see §11 Open questions. |

Schema migration: append-only fields, all optional. No reader currently
exists (per the existing approvalLog comment: "F-LATER ships a viewer").
Bumping the schema today is safe; consumers default to local-only
semantics.

Required logger behavior:

- Local-PIN path: writes `source: 'local_pin'`, no `deviceId`,
  `approvalId` = current gate id.
- Remote path: writes `source: 'companion_remote'`, `deviceId` from
  paired device, `respondedAt` from bridge payload, `managerNote` if
  present (after server-side length cap).
- Denial reasons (existing `ApprovalDenialReason` union) remain
  authoritative for the `status: 'denied'` rows.

---

## 6. Implementation plan

### Phase 1 — Remote response **received but logged only**

- Adapter subscribes to `approvalEmitter.onResponse(callback)` from the
  bridge SDK (the desktop-side equivalent of `intelligenceEmitter.onDismissed`
  added in `R-COMPANION-INTELLIGENCE-ACK-INBOUND-V1`).
- On each response, the adapter:
  - emits a **new** local event type `APPROVAL_REMOTE_RESPONSE_RECEIVED`
    on `companionEventBus` carrying `{ approvalId, action, managerId,
    respondedAt, managerNote? }`.
  - submits an inbox action of type `approve_request` / `deny_request`
    (already typed in `companionTypes.ts`).
  - Calls `processApprovalAction(actionId)` to mark handled.
  - **Does NOT** call `approvalGuard` or resolve any pending gate.
- Audit: phase 1 writes a `source: 'companion_remote_observed'` row
  to `approvalLog` for traceability — purely observational; the local
  PIN flow remains the only resolver.
- UX: the local PIN modal stays the only resolver. Mobile button taps
  are visibly "received" via the new event but do not unblock the
  employee. Acceptable for dogfooding.

**Exit criteria:** Jorge can dismiss test approvals from his phone and
see desktop console logs + audit entries, with zero changes to the local
PIN flow. Validates contract + dedup + race assumptions before any
authority transfer.

### Phase 2 — Remote response **validates and resolves pending approval**

- Introduce `useRemoteApprovalGate` hook (or extend `useApprovalGate`)
  that returns a **hybrid prompter** to `approvalGuard.requestApproval`.
- Hybrid prompter:
  - Opens local PIN modal as before.
  - Registers a one-shot listener with a new module-level
    `subscribeRemoteApprovalResponses(approvalId, callback)` in
    `services/companion/companionApprovalRuntime.ts` (read-only today,
    extended to relay specific-id responses).
  - On expiry timer fires OR either path resolves, clears the other.
- `approvalGuard` learns to accept a new `PrompterResponse` variant:
  ```ts
  type PrompterResponse =
    | { cancelled: true; reason?: 'cancelled' | 'timeout' | 'expired' }
    | { cancelled: false; pin: string }
    | { cancelled: false; remote: { managerId: string; action: 'approve' | 'deny' | 'request_explanation'; respondedAt: number; managerNote?: string } };
  ```
- Validation reuses the existing helpers — `canCurrentEmployeeApproveSelf`,
  `requiresApproval`, employee role checks — so no parallel rule paths.
- Setting gate: `companionRemoteApprovalEnabled` (default false).
  Mirrors `companionBridgeEnabled` pattern. Toggled in Settings.
- Audit row writes `source: 'companion_remote'`.

**Exit criteria:** Jorge can approve a `CANCEL_LAYAWAY` from his phone
and watch the desktop's PIN modal close + the cancellation proceed,
with the audit log showing `source: 'companion_remote'`. Local PIN still
works as fallback. Both paths log distinctly.

### Phase 3 — UI polish + notifications

- Mobile receives APPROVAL_APPROVED / APPROVAL_DENIED echoes so the
  card shows terminal state across all paired devices.
- Desktop shows a small "pending mobile response" indicator inside the
  PIN modal so the cashier sees the in-flight remote attempt.
- Push notifications wired (already in mobile SDK; needs server-side
  push registration). Out of scope today.
- Audit viewer page (the `F-LATER` from `approvalLog.ts`).
- Bilingual EN/ES strings for all new states.

**Exit criteria:** Cashier UX clearly communicates that a manager is
responding remotely. Manager UX clearly shows the request lifecycle.
Audit page lets the owner review who approved what from where.

---

## 7. Files likely to change later

Phase 1:

- `src/services/companion/companionBridgeAdapter.ts` — add
  `approvalEmitter.onResponse(...)` inbound subscription alongside the
  existing `intelligenceEmitter.onDismissed` one. Singleton cleanup on
  stop, dedup gate already in place.
- `src/services/companion/companionTypes.ts` — append
  `APPROVAL_REMOTE_RESPONSE_RECEIVED` to `CompanionEventType` and a
  matching `CompanionRemoteApprovalResponsePayload`.
- `src/services/approvalLog.ts` — extend `appendApprovalEvent` to
  carry optional `source` field (with safe default for legacy callers).
- `src/store/types.ts` — extend `ApprovalEvent` schema (append-only
  fields per CLAUDE.md double-cast pattern). Add
  `companionRemoteApprovalEnabled?: boolean` setting.

Phase 2:

- `src/services/security/approvalGuard.ts` — extend `PrompterResponse`
  union; add a remote-response branch in the resolution logic that
  validates `managerId` against employees + role (reuses existing
  permission helpers — no parallel rule path).
- `src/hooks/useApprovalGate.ts` — add hybrid prompter mode behind the
  setting gate; preserve current local-only behavior when the setting
  is off.
- `src/services/companion/companionApprovalRuntime.ts` — add
  `subscribeRemoteApprovalResponses(approvalId, callback)` channel.
- `src/services/companion/receivers/approvalActionReceiver.ts` — the
  receiver currently stays a shell. Phase 2 wires it through the
  hybrid prompter's listener, **not** by directly calling
  `approvalGuard`. Same indirection pattern as
  `R-COMPANION-INTELLIGENCE-ACK-INBOUND-V1`.

Phase 3:

- `src/components/shared/ApprovalPinModal.tsx` — small "remote
  responder live" indicator. No layout redesign.
- `src/modules/companion/CompanionCenter.tsx` — surface remote-approval
  status pill (similar to the bridge-transport pill).
- `src/i18n/translations.ts` — EN/ES/PT strings.
- `src/services/security/permissions.ts` — confirm the role-permission
  matrix carries the right scopes for remote approvers. Read-only audit;
  changes only if a current gap is discovered.

Bridge / mobile / SDK files in `cellhub-companion` (separate repo) —
not changed by this repo's rounds. Cross-repo follow-ups will be tracked
as separate rounds when phases 2 and 3 ship.

---

## 8. Forbidden shortcuts

These are tempting shortcuts that **must not** be taken at any phase:

1. **Bypassing `approvalGuard` from the receiver.** The receiver shell
   explicitly does not call any approval mutation. Phase 2 also does
   not — the hybrid prompter is the **only** integration point.
   Anything else creates parallel rule paths and an audit gap.

2. **Auto-approving on mobile presence.** Pairing a phone does not
   grant approval authority. A response must always arrive in-band per
   action.

3. **Skipping the local PIN modal when bridge is connected.** The local
   PIN modal opens for every gate (even with remote authority on); it
   is the fallback path and the only working option when bridge is
   down. The hybrid prompter races them; it never short-circuits the
   local path.

4. **Trusting `managerId` from the bridge payload.** The desktop maps
   the `managerId` to an employee record locally. Never use the
   payload's `managerName` for decision-making — it's display-only.

5. **Persisting in-flight gates across hot reload.** The desktop is a
   fresh-start surface. Persisting pending gates invites stale-state
   bugs and a more complex storage path. Mobile sees expired cards via
   `APPROVAL_EXPIRED`; that's enough.

6. **Allowing self-approval through the remote path.** Even if a
   mobile-side UI lets a manager tap "approve" on their own request,
   the desktop denies it per rule §3.2. Same helper, no exceptions
   beyond the existing owner-exempt clause.

7. **Logging the PIN.** `approvalLog` already never carries a PIN. The
   remote path also never carries a PIN. Any audit row that includes
   PIN-shaped data is a bug.

8. **Reusing `approvalId` across retries.** Each `requestApproval`
   invocation gets a fresh id. Reusing breaks dedup, race resolution,
   and mobile UI deduplication.

9. **Using `dismiss` for cancellation flows.** `dismiss` is for hiding
   notifications. Approval cancellation is a denial path; reuse
   `cancelled` / `timeout` / `expired` reasons.

10. **Cross-store mixing.** A response carries `storeId`. The desktop
    only resolves gates whose `storeId` matches. Multi-store scenarios
    open a separate question — not in scope here.

11. **Skipping the `companionRemoteApprovalEnabled` gate.** Phase 2
    must keep the off-by-default behavior. The setting is the
    operator's kill switch. Removing the gate at any phase is a regression.

---

## 9. Open questions (need owner / auditor decision before phase 2)

- **Manager note PII.** Allow free-text notes on mobile? If yes, what
  filter? Recommendation: max 240 chars, server-side sanitisation
  (strip newlines, control characters), audit row stores verbatim.
- **Push notifications.** Phase 3 needs an OS-level push token
  registration backend. Currently `cellhub-companion/src/services/notifications/pushHandlers.ts`
  has a TODO "Token → POST to your backend". Who runs the backend?
- **Multi-store responder scope.** If a manager has access to multiple
  stores, can their phone respond to any store's approvals? Likely
  scoped to currently-paired storeId — confirm.
- **Audit retention.** `approvalLog` caps at 5000 events. Remote rows
  approximately double the volume. Bump the cap or add archival?
- **Connection-state-recovery edge case.** Bridge offers a 2-minute
  reconnect grace. If a mobile manager taps "approve" during that
  grace, the desktop's pending gate may still be open — what's the
  source-of-truth ordering when both local PIN and remote response
  arrive in quick succession with cross-network latency variance?
  Existing `Promise.race` should handle it, but worth a stress test
  in phase 2.
- **Permission matrix.** Does `requiresApproval` currently support
  per-manager role scopes (e.g. "manager-A can approve discounts up
  to $50 but not refunds")? Confirm before phase 2 or design a
  follow-up.

---

## 10. Validation expectations for each phase

Phase 1:
- `tsc --noEmit` clean, build clean, manual flow: dismiss from mobile
  → desktop console + audit log entry, zero state changes.

Phase 2:
- Manual matrix:
  1. Remote-only resolve happy path.
  2. Local-only resolve happy path (bridge off).
  3. Both arrive within 1s — winner determinism.
  4. Expired before either responds.
  5. Self-approval attempt from mobile.
  6. Unknown `managerId` from mobile.
  7. Stale `requestId` from mobile.
  8. Permission-scope denial.
  9. Setting `companionRemoteApprovalEnabled = false` while pending.
- Audit-log diff inspection: every row carries `source` + `approvalId`.

Phase 3:
- UX walkthrough with Jorge on a real store device. Bilingual sanity.
- Soak test: a full sales day with ~100 approvals to verify dedup +
  expiry timer + no leaked listeners on remount.

---

## 11. Round closure rule

This document is the design contract. Implementation rounds reference
it by section. Changes to it require auditor approval and a versioned
revision (`V2`, `V3`, etc.) — not in-place edits — so the implementation
team can pin behavior to a specific revision.
