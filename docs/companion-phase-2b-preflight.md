# Companion Remote Approval — Phase 2B Preflight Checklist

**Status:** GATE DOCUMENT — Phase 2B is **not** open until every item below
returns PASS and the auditor signs off.

**Companion design parent:** [`companion-remote-approval-authority.md`](./companion-remote-approval-authority.md)

This is the last document standing between the codebase as-shipped and the
round that grants a paired Companion mobile the power to resolve a desktop
approval gate. The decision is intentionally separate from the
implementation prompt — Phase 2B should not be drafted until this preflight
passes.

---

## 1. What is already implemented

The work below is **on disk** as of this preflight. Every item is either
already-committed (in `cellhub-companion`) or staged in the working tree
(in `cellhub-pro-v2`, uncommitted across several rounds).

### Bridge (cellhub-companion, committed `6e80755`)

- `bridge/src/desktop/posBridgeClient.ts` — single socket transport,
  status + reject lifecycle.
- `bridge/src/desktop/approvalEmitter.ts` — shared-socket pattern, 60 s
  per-`requestId` dedup on `onResponse`.
- `bridge/src/desktop/messageEmitter.ts` — symmetric inbound listeners.
- `bridge/src/desktop/intelligenceEmitter.ts` — `push` + `onDismissed`.
- `bridge/src/eventRouter.ts` — `INTELLIGENCE_DISMISSED` routes
  store-wide (POS room receives dismissals).
- `bridge/test/posIntegrationTest.ts` — round-trip integration test
  covering approvals, messages, intelligence with dedup assertions.

### Desktop (cellhub-pro-v2, uncommitted working tree)

- `src/services/companion/sdk/` — verbatim copy of bridge SDK, vendored
  for desktop consumption.
- `src/services/companion/companionBridgeAdapter.ts` — singleton-guarded
  lifecycle; outbound APPROVAL_CREATED + INTELLIGENCE_ALERT_CREATED
  translation; **inbound observe-only** approval-response listener;
  inbound intelligence-dismissal listener wired to `AlertEngine.acknowledge`
  via active-engine slot; 500-entry FIFO dedup cache cleared on stop.
- `src/services/companion/remoteApprovalObserver.ts` — Phase 2A
  scaffolding (types + factory; **no callers**, true no-op).
- `src/services/intelligence/index.ts` — `setActiveIntelligenceEngine`
  registry slot.
- `src/services/intelligence/IntelligenceEngine.ts` — `acknowledgeAlert`
  passthrough.
- `src/services/companion/receivers/intelligenceAckReceiver.ts` —
  dispatches to active engine after normalisation.
- `src/services/companion/receivers/approvalActionReceiver.ts` —
  **unchanged shell**; explicitly does NOT call `approvalGuard`.
- `src/services/companion/companionMockBridge.ts` — drains queued
  events through the adapter on connect.
- `src/store/types.ts` — `companionBridgeEnabled?`, `companionBridgeUrl?`,
  `companionRemoteApprovalEnabled?` settings fields (all optional,
  default `undefined` → coerced to `false`).
- `src/modules/companion/CompanionCenter.tsx` — adapter lifecycle
  effect; status pill (`Bridge · Idle/Connecting…/Connected/…`);
  disabled-state banner.
- `src/modules/intelligence/IntelligenceModule.tsx` — registers the
  live engine in the active-engine slot.
- `src/modules/settings/SettingsModule.tsx` — bilingual toggle for
  `companionRemoteApprovalEnabled` with ⚠️ warning copy.
- `src/i18n/translations.ts` — EN/ES/PT keys for bridge status,
  disabled banner, remote-approval toggle copy.
- `src/services/mock/mockData.ts` — approvals seeded in integer cents.

### Design + gate documents

- `docs/companion-remote-approval-authority.md` — Phase 2 design.
- `docs/companion-phase-2b-preflight.md` — this file.

### Untouched (and must stay so until Phase 2B)

- `src/services/security/approvalGuard.ts` — local PIN authority.
- `src/hooks/useApprovalGate.ts` — local PIN prompter.
- `src/services/security/permissions.ts` — `requiresApproval`,
  `canCurrentEmployeeApproveSelf`.
- `src/services/security/pin.ts` — PIN verification.
- `src/services/approvalLog.ts` — audit sink.
- POS modules, money helpers, `persist.ts`, `src/store/` (except the
  three optional settings fields added in earlier rounds).

---

## 2. What must be runtime-tested by Jorge

These items can only be confirmed on the real shop PC with the real
Companion mobile app, a running bridge server, and real reducer state.
Static analysis is **insufficient** for any of them. Jorge runs them; the
auditor reads the result.

Run order matters — items 1 → 10 are dependencies for item 11 onward.

### Stage A — Disabled-by-default (no bridge connectivity)

1. **App boots clean with all Companion settings off.**
   Confirm `companionBridgeEnabled` and `companionRemoteApprovalEnabled`
   both render as unchecked in Settings → Employees. Bridge transport
   shows the long "Bridge transport disabled — enable in Settings" banner
   in CompanionCenter.

2. **Local PIN approval flow unchanged.**
   Trigger a `CANCEL_LAYAWAY`. PIN modal opens, accepts a valid PIN,
   approval completes. `localStorage.approval_events` shows ONE row with
   `approvedByEmployeeId` = the approver's empId (or
   `'approver:admin'`). No bridge logs in DevTools.

3. **Reload preserves disabled state.** Refresh the app. Both toggles
   stay off. PIN flow still works.

### Stage B — Bridge enabled, mock pair only

4. **Toggle `companionBridgeEnabled` on, mock-pair a device.**
   CompanionCenter banner replaced by the small pill. Pill goes
   `Idle → Connecting… → Connected` (or `Disconnected` if no bridge
   server is running). No double-flashing.

5. **Outbound `APPROVAL_CREATED` fires once per approval.**
   Trigger CANCEL_LAYAWAY. DevTools console shows
   `[companion-bridge-adapter] APPROVAL_CREATED → bridge id=…` exactly
   once. Local PIN flow continues normally — modal still required.

6. **Outbound `INTELLIGENCE_ALERT_CREATED` fires once per alert.**
   Force an alert via Intelligence module. Console shows
   `[companion-bridge-adapter] INTELLIGENCE_ALERT_CREATED → bridge alertId=…`
   exactly once. Re-running evaluate within the cooldown window does
   not produce a second log (the dedup cache catches the replay).

7. **Inbound approval response (observe-only).**
   With a paired Companion app + running bridge, tap "Approve" on the
   mobile card from step 5. Desktop console shows
   `[companion-bridge-adapter] inbound APPROVAL_APPROVE (OBSERVE-ONLY)`.
   **Local PIN modal still required on the desktop.** Cashier completes
   via local PIN. `localStorage.approval_events` shows ONE row, source
   = local (no `source` field is written yet).

8. **Inbound intelligence dismissal reaches AlertEngine.**
   Dismiss the alert from step 6 on mobile. Desktop console shows
   `[intelligence] acknowledged alertId=…`. Confirm the alert's status
   moved to `'acknowledged'` in engine state (verifiable via the
   Intelligence module's alert count).

### Stage C — Stress + persistence

9. **No duplicate subscriptions across navigation.**
   Navigate Companion → POS → Companion → POS ten times. DevTools
   console does NOT flood with adapter start/stop pairs.
   `[companion-bridge-adapter] stopped` appears at most once per real
   bridge-disable action.

10. **Duplicate-event protection.**
    Manually call `emitCompanionEvent` twice for the same approvalId
    via the dev panel. Console shows ONE outbound translation followed
    by `[companion-bridge-adapter] duplicate event skipped key=APPROVAL_CREATED:…`
    for the second.

11. **Settings persist across reload.**
    Toggle `companionBridgeEnabled` on, reload. Toggle stays on.
    Bridge starts only after Connect is pressed (mock state resets on
    reload, which is expected).

12. **Operator kill switch works.**
    Flip `companionBridgeEnabled` off while connected. Adapter stops.
    Status pill replaced by the disabled banner. Outbound translation
    stops immediately. Inbound subscriptions cleaned up. Re-enable +
    reconnect works.

### Stage D — Security smoke

13. **Mobile cannot resolve desktop approval (the critical invariant).**
    With a pending local PIN modal open, tap "Approve" on mobile.
    Desktop receives the response, logs OBSERVE-ONLY, but the PIN
    modal stays open. Cashier still must type a local PIN.
    `localStorage.approval_events` shows no remote-sourced row.

14. **`localStorage.approval_events` integrity.**
    Run 10 approvals through the local PIN flow plus 5 mobile taps
    while bridge is on. The events log should contain 10 rows (one
    per local resolution). The 5 mobile taps produced no rows — they
    were inbox-only.

15. **No PII on the wire.**
    Open the bridge's `/health` endpoint while running an approval.
    The event stats show counters but no customer / employee /
    transaction payload data. The desktop's outbound payload (visible
    in DevTools network or via the bridge's stdout) should contain
    only IDs (`approvalId`, `employeeId`, `storeId`), no names, no
    notes.

---

## 3. Exact PASS/FAIL checklist

Copy this checklist into the runtime report. Each item must be **PASS**
to open Phase 2B. Mark **FAIL** if the observed behavior diverges or if
a test cannot be performed.

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | App boots clean with all Companion settings off |  |  |
| 2 | Local PIN approval flow unchanged |  |  |
| 3 | Reload preserves disabled state |  |  |
| 4 | Bridge enabled + mock pair → pill `Idle → Connecting → Connected` |  |  |
| 5 | Outbound APPROVAL_CREATED fires exactly once |  |  |
| 6 | Outbound INTELLIGENCE_ALERT_CREATED fires exactly once |  |  |
| 7 | Inbound approval response logs OBSERVE-ONLY; PIN modal stays open |  |  |
| 8 | Inbound intelligence dismissal reaches AlertEngine.acknowledge |  |  |
| 9 | No duplicate subscriptions across 10× navigation |  |  |
| 10 | Duplicate event protection — second emit skipped |  |  |
| 11 | Settings persist across reload |  |  |
| 12 | Operator kill switch works (disable while connected) |  |  |
| 13 | Mobile approve does NOT resolve desktop PIN modal |  |  |
| 14 | `approval_events` log has zero remote-sourced rows |  |  |
| 15 | No PII on the wire — payloads carry IDs only |  |  |

**Pass rule:** all 15 rows = PASS. Any FAIL or "could not test"
blocks Phase 2B and triggers a remediation round.

---

## 4. Security risks blocking Phase 2B

These are the risks that must be assessed and mitigated **before** any
code allows a mobile response to resolve a desktop approval. None of
them are blockers for the observe-only path that ships today.

### 4.1 Bridge auth is currently permissive — **BLOCKER**

Status: `bridge/src/realtimeServer.ts` `validateAuth` accepts any
non-empty `storeId` + `role`. Comment in source: `// TODO: validate
payload.authToken against license server`. Any process that can reach
the bridge over LAN can emit `APPROVAL_RESPONDED`.

**Impact under Phase 2B:** trivial unauthenticated approval bypass.

**Mitigation required before Phase 2B:**

- Bridge `validateAuth` validates `authToken` against a real signer
  (license server, signed JWT, or a long-lived shared secret per
  paired device).
- Bridge rejects any `manager` role connection whose token does not
  prove possession of the paired-device secret.
- Desktop logs `AUTH_REJECTED` reasons distinctly so a misconfigured
  pair surfaces in the bridge status pill (`rejected` state).

This work lives in `cellhub-companion` (separate repo) and is its own
round. The desktop side already plumbs `authToken` through (currently
a placeholder string) — the bridge-server change is the lift.

### 4.2 `managerId` trust boundary — **HIGH**

The Companion mobile payload carries `managerId`. Today the inbox
receiver shell forwards it verbatim — no cross-check against local
employees. Phase 2B MUST:

- Resolve `managerId` against `state.employees` BEFORE accepting the
  response as authoritative. Unknown id → `unknown_approver` denial.
- Confirm the matched employee has an approver role for the specific
  `actionType` via the existing `requiresApproval(...)` matrix.
- Reject `managerId === ADMIN_APPROVER_ID` (the admin-PIN constant)
  from the remote path; admin authority is a local-only fallback.

### 4.3 Self-approval over remote path — **HIGH**

Today's local helper `canCurrentEmployeeApproveSelf` exempts owners
and otherwise blocks self-approval. The remote path must invoke the
same helper. A manager whose `managerId === requestedByEmployeeId`
gets `self_approval_blocked` unless the owner-exemption clause
applies — and we must reach the same decision the local PIN flow
would reach with the same inputs.

### 4.4 Expiry + race-window correctness — **MEDIUM**

`APPROVAL_CREATED` carries `expiresAt = now + 10 min`. The hybrid
prompter's expiry timer must:

- Fire `prompter.reject({ reason: 'expired' })` when reached.
- Clear the per-approvalId remote listener.
- Reject any subsequent inbound response for that `approvalId`
  (the local "already resolved" check in design §3.5).

The bridge SDK's 60 s dedup is **not enough** here — it prevents
double-fire of the same event, not late-fire after expiry. The
expiry timer is a separate guard.

### 4.5 Two-managers-respond-simultaneously — **MEDIUM**

Bridge router broadcasts `APPROVAL_RESPONDED` to all managers in the
room (multi-device sync) and to POS. If two phones approve at the
same time, two `APPROVAL_RESPONDED` events land. The hybrid prompter
must resolve on the first and drop the second as a duplicate-resolve.
Audit log captures the winner; loser logged at console.info for
traceability.

### 4.6 `companionRemoteApprovalEnabled` kill-switch consistency — **MEDIUM**

The setting must be read at **response time**, not at **gate-open
time**. A manager who disables the setting mid-gate must immediately
stop the remote path from resolving. Implementation note for Phase
2B: the `isEnabled` accessor passed to
`createRemoteApprovalObserver` must read live settings (closure over
a ref or a getter, not a value snapshot).

### 4.7 Hot-reload / mid-gate desktop state loss — **LOW**

Pending gates are React state; hot reload or Electron restart drops
them. A late mobile response then hits `unknown_request`. Acceptable
behavior — design §4 row "Manager hot-reloads desktop mid-gate"
already documents this.

### 4.8 PII on the wire — **CONTAINED**

Today payloads carry IDs only. Phase 2B's `managerNote` field (if
adopted) introduces user-typed free text. Open question per design
§9: max 240 chars, server-side sanitisation, audit row stores
verbatim. Decision required before adoption.

### 4.9 Audit-log schema — **CONTAINED**

`ApprovalEvent` does not currently carry `source`. Phase 2B adds it
as an optional field. No reader exists today
(`approvalLog.ts:48 "F-LATER ships a viewer"`), so the migration is
append-only-safe. Phase 2B's logger writes `source: 'companion_remote'`
on remote-resolved rows.

---

## 5. Required conditions before enabling real remote approve / deny

Phase 2B may **not** be implemented until all of the following are
true and signed off by the auditor:

1. **Runtime checklist §3 returns 15/15 PASS** with Jorge's hands-on
   confirmation. No "could not test" allowed.

2. **Bridge auth is real** (§4.1). At minimum a signed token verified
   by the bridge server; per-store secret acceptable as a v1 if the
   threat model is "LAN only" and the operator owns the LAN.

3. **`managerId` validation contract defined** (§4.2). Phase 2B
   implementation prompt explicitly calls out:
   - The cross-check against `employees`
   - The role-permission lookup via `requiresApproval`
   - The `ADMIN_APPROVER_ID` rejection
   - The `unknown_approver` denial reason

4. **Self-approval helper reuse confirmed** (§4.3). The Phase 2B prompt
   declares "uses existing `canCurrentEmployeeApproveSelf` — no new
   rule path" and the auditor confirms by reading the diff.

5. **Expiry timer design locked** (§4.4). Single timer per pending
   gate, fires before bridge SDK dedup window expires, cleans up
   the per-approvalId remote listener.

6. **`isEnabled` live-read pattern documented** (§4.6). The accessor
   passed to `createRemoteApprovalObserver` reads live settings (e.g.
   `() => store.getState().settings.companionRemoteApprovalEnabled === true`),
   not a snapshot captured at gate-open.

7. **Audit schema migration approved** (§4.9). One optional field
   (`source`) added to `ApprovalEvent` under the double-cast pattern.

8. **`managerNote` policy decided** (§4.8). Either accepted with
   length cap + sanitisation, or deferred to Phase 2C.

9. **Phase 2B implementation prompt drafted** referencing each of the
   above by section number, and reviewed by the auditor.

10. **Rollback plan documented.** If Phase 2B ships and Jorge sees
    unexpected behavior in the first hour, what's the fastest revert?
    Recommendation: `companionRemoteApprovalEnabled = false` is the
    operator-side kill switch; Phase 2B implementation should also
    publish a one-commit revert path that restores Phase 2A
    scaffolding without ripping out the SDK or adapter.

---

## 6. Go / No-Go decision

### Auditor recommendation

**NO-GO for Phase 2B at this time.** Specifically:

- **Bridge auth (§4.1) is the binding constraint.** Without a real
  authentication check at the bridge, Phase 2B opens an
  unauthenticated approval-bypass attack across the LAN. This must
  ship in the `cellhub-companion` repo before Phase 2B is drafted in
  `cellhub-pro-v2`.

- **Runtime checklist (§3) has not yet been executed.** Static
  analysis says everything wires correctly, but Phase 2B is too
  high-stakes to skip a hands-on validation pass. Jorge running the
  15 tests is a prerequisite.

- **`managerId` validation policy (§4.2) is undecided.** The
  receiver shell forwards `managerId` verbatim today; Phase 2B needs
  the cross-check rule locked in writing before the prompt is drafted.

### What unblocks Phase 2B

- Bridge-side round: harden `validateAuth` with real token
  validation. Acceptance: a connection without a valid token receives
  `AUTH_REJECTED` and the desktop's bridge status pill shows
  `Rejected`. Manual test: connect a stub client with a bogus token,
  observe rejection.
- Desktop runtime tests §3 PASS 15/15 by Jorge.
- Two-page Phase 2B implementation prompt drafted citing §4 rules,
  reviewed by auditor.

### What is safe to ship today

- Everything currently in the working tree is observe-only and
  preserves the local-PIN authority. The work can be committed and
  dogfooded **without** enabling `companionRemoteApprovalEnabled`.
- The setting can stay visible in Settings as a future-feature stub.
  Jorge can flip it on for testing and observe the OBSERVE-ONLY logs
  — the underlying code is not yet authority-wired, so flipping the
  setting on does not change behavior.

### What absolutely should NOT happen before this preflight passes

- Drafting a Phase 2B implementation prompt that wires
  `useApprovalGate` to resolve from the remote path.
- Touching `approvalGuard.ts`, `useApprovalGate.ts`, or the receiver
  shells beyond their current state.
- Removing the `companionRemoteApprovalEnabled` setting or making it
  default-true.
- Shipping the desktop changes to production stores before the bridge
  auth round lands.

---

## 7. When this preflight is re-run

After each of these events the auditor must re-evaluate the gate:

- A bridge-auth round lands in `cellhub-companion`.
- Any new feature touches the approval / messaging / intelligence
  surfaces.
- Jorge reports a failing runtime test (§3 returns FAIL on any row).
- A vulnerability is reported against the bridge or the desktop
  observe-only path.

Each re-run produces a new dated section at the bottom of this file
recording the outcome. The file is append-only; previous decisions
stay visible for audit traceability.

---

## 8. Sign-off

**Auditor (recommendation):** NO-GO until §5 items 1–10 PASS.
**Operator (Jorge):** _pending §3 runtime checklist_
**Date opened:** 2026-05-12
**Date closed:** _pending — phase 2B implementation prompt blocked_

---

## 2026-05-12 — Preflight Update

Three blocker items have moved since the original sign-off. The
overall gate remains **NO-GO for Phase 2B authority**; the bridge-auth
blocker is closed; the runtime checklist and the Phase 2B
implementation prompt are still open.

### Bridge auth blocker (§4.1) — CLOSED

- **Previously:** BLOCKER. `bridge/src/realtimeServer.ts` `validateAuth`
  accepted any non-empty `storeId + role`.
- **Now:** PASS. Round `R-BRIDGE-AUTH-HARDENING-V1` shipped in
  `cellhub-companion` (commit on `main` after `6e80755`).
- **Verifier:** `bridge/src/auth/bridgeTokenVerifier.ts` exports
  `verifyBridgeAuthToken({ token, storeId, deviceId, role })` and
  returns one of seven stable reason codes on failure
  (`missing_token`, `malformed_token`, `bad_signature`,
  `invalid_role`, `expired_token`, `store_mismatch`,
  `dev_token_not_allowed`). HMAC-SHA256 signature check uses
  `crypto.timingSafeEqual`.
- **Token formats:**
  - STRICT (production-safe): `<base64url(payload)>.<hex(HMAC)>` with
    `payload = { storeId, deviceId, role, exp(ms), iat? }`. Secret
    sourced from `BRIDGE_AUTH_SECRET` env var.
  - DEV-prefix (NODE_ENV !== 'production' only):
    `dev.<storeId>.<deviceId>.<role>`.
- **Acceptance test:** `bridge/test/bridgeAuthTest.ts` covers all
  seven rejection reasons + both valid paths.
  Result: **PASS 11 / 11**.
- **Regression test:** existing `npm run test:approval` and
  `posIntegrationTest.ts` updated to use DEV-prefix tokens. Both pass.
- **Bridge build:** `npm run type-check` exit 0; `npm run build` exit 0.

### Desktop dev token patch — PASS

- Round `R-COMPANION-DESKTOP-DEV-TOKEN-PATCH-V1` in `cellhub-pro-v2`.
- `src/modules/companion/CompanionCenter.tsx`:
  `authToken: cellhub-pro-v2-${storeId}` → `authToken: dev.${storeId}.${deviceId}.pos`.
- `deviceId` in the token matches `RegisterPayload.deviceId` (same
  variable used four lines above).
- `tsc --noEmit` exit 0; `npm run build` exit 0.
- **Status:** desktop bridge client now connects in dev observe-only
  mode against the hardened bridge. No production-token mint path
  exists yet — that lives in a future round once a license-server
  signer is available.

### Manager trust boundary (§4.2) — PASS as helper-only

- Round `R-COMPANION-MANAGER-TRUST-BOUNDARY-PREFLIGHT-V1` in
  `cellhub-pro-v2`.
- New file: `src/services/companion/remoteApprovalTrust.ts`.
  Exports `validateRemoteApprovalActor(input)` returning a tagged
  result `{ valid: true; manager }` or
  `{ valid: false; reason }` with the eight stable reason codes from
  the spec (`remote_approval_disabled`, `missing_manager_id`,
  `admin_approver_not_allowed_remote`, `manager_not_found`,
  `manager_not_authorized`, `self_approval_blocked`,
  `approval_rule_failed`, `invalid_gate_context`).
- Uses already-exported `permissions.ts` helpers: `getEffectivePermissions`,
  `requiresApproval`, `canCurrentEmployeeApproveSelf`,
  `SYSTEM_APPROVER_PREFIX`. **No changes to `approvalGuard.ts` or
  `permissions.ts`.**
- `companionRemoteApprovalEnabled` is checked at RESPONSE time via
  the `isRemoteEnabled: () => boolean` accessor — callers cannot
  capture a stale value.
- **Status:** helper compiles and is wired to no consumer. Phase 2B
  will be the first caller. **No authority granted by this round.**
- `tsc --noEmit` exit 0; `npm run build` exit 0.

### Remaining NO-GO items

- **§3 runtime checklist (15 items)** — still pending Jorge's
  hands-on validation. Static analysis remains green; runtime
  confirmation is the prerequisite for any authority round.
- **§5 item 9 — Phase 2B implementation prompt** — not drafted. The
  prompt must cite §4 by section number, declare reuse of the
  existing `requiresApproval` / `canCurrentEmployeeApproveSelf`
  helpers (no parallel rule paths), and integrate `validateRemoteApprovalActor`
  before any resolver call.
- **Remote approval resolver** — not wired. `approvalGuard.ts` and
  `useApprovalGate.ts` are unchanged; `PrompterResponse` has no
  `remote` branch; the inbound observe-only path in
  `companionBridgeAdapter.ts` still only logs + submits to the
  inbox shell.
- **Audit + rollback plan** — Phase 2B implementation must:
  - extend `ApprovalEvent` with optional `source: 'local_pin' \| 'companion_remote'` (append-only schema change).
  - write `source: 'companion_remote'` audit rows only when
    `validateRemoteApprovalActor` returns `{ valid: true }`.
  - publish a one-commit revert path that returns the codebase to
    Phase 2A scaffolding without disturbing the SDK, adapter, or
    bridge-auth round.
- **`managerNote` policy (§4.8)** — open question from the original
  preflight. Cap length, sanitisation, and storage policy still
  undecided.

### Updated recommendation

Still **NO-GO** for Phase 2B authority. The bridge-auth blocker is
closed and the manager-trust-boundary helper is on disk; the path
forward is narrower but not yet open.

**Next two rounds in order:**

1. Jorge executes the §3 runtime checklist (15 items) and reports
   PASS / FAIL for each. The checklist is unchanged — the new
   pre-conditions (real bridge auth, dev token, trust helper) do
   not retire any test; they just make the OBSERVE-ONLY signal more
   meaningful.
2. Auditor drafts the Phase 2B implementation prompt against the
   stable shapes defined this session
   (`createRemoteApprovalObserver`, `validateRemoteApprovalActor`).
   No code change permitted in that drafting round.

After both are signed off, Phase 2B is unblocked.

### Updated sign-off

**Auditor (recommendation, revised):** NO-GO. Bridge-auth blocker
closed (§4.1 → PASS); manager-trust-boundary helper landed (§4.2 →
PASS-helper-only). Remaining gates: §3 runtime checklist and §5 item 9
(implementation prompt).
**Operator (Jorge):** _pending §3 runtime checklist — checklist
itself unchanged_
**Date of this update:** 2026-05-12
