// ============================================================
// CellHub Pro — Companion Approval Runtime Store
// (R-COMPANION-APPROVAL-RUNTIME-V1)
//
// Aggregates the desktop approval lifecycle so the Companion Center
// can surface pending counts + latest decisions without re-walking
// the Companion Event Bus log. The store is a thin projection over
// three event types — APPROVAL_CREATED, APPROVAL_APPROVED,
// APPROVAL_DENIED — same approvalId ties them together (per
// approvalGuard contract).
//
// Cero networking. Cero persistence. Cero approval business logic
// changes — this store is a read model over events the guard already
// emits. PIN, permission, and approval mutation paths live in
// services/security/approvalGuard and are intentionally not touched.
// ============================================================

import { subscribe } from './companionEventBus';
import type {
  CompanionApprovalRuntimeItem,
  CompanionApprovalRuntimeListener,
  CompanionApprovalRuntimeSnapshot,
} from './companionTypes';

// ── Module-private state ──────────────────────────────────

const items = new Map<string, CompanionApprovalRuntimeItem>();
const listeners = new Set<CompanionApprovalRuntimeListener>();

// ── Helpers ──────────────────────────────────────────────

function buildSnapshot(): CompanionApprovalRuntimeSnapshot {
  // Most-recently-updated first. Shallow-copy entries so callers
  // can't mutate module state.
  const arr = Array.from(items.values())
    .map((i) => ({ ...i }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  let pending = 0;
  for (const i of arr) if (i.status === 'pending') pending += 1;
  return {
    items: arr,
    pendingCount: pending,
    latest: arr.length > 0 ? arr[0] : null,
  };
}

function notify(): void {
  const snap = buildSnapshot();
  listeners.forEach((listener) => {
    try { listener(snap); } catch (err) {
      console.warn('[companion-approval-runtime] listener threw', err);
    }
  });
}

// ── Event subscriptions (module-singleton) ───────────────
// Attached at file load. Each subscriber narrows the discriminated
// CompanionEvent union so payload typing is preserved.

subscribe('APPROVAL_CREATED', (event) => {
  if (event.type !== 'APPROVAL_CREATED') return;
  const p = event.payload;
  const now = Date.now();
  // A late-arriving APPROVAL_CREATED with the same id is treated as
  // an upsert — refresh metadata + reset to 'pending'. Should be
  // rare given the guard generates a fresh approvalId per call.
  items.set(p.approvalId, {
    approvalId: p.approvalId,
    actionType: p.actionType,
    source: p.source,
    status: 'pending',
    requestedByEmployeeId: p.requestedByEmployeeId,
    createdAt: now,
    updatedAt: now,
  });
  notify();
});

subscribe('APPROVAL_APPROVED', (event) => {
  if (event.type !== 'APPROVAL_APPROVED') return;
  const p = event.payload;
  const existing = items.get(p.approvalId);
  const now = Date.now();
  // If we never saw the CREATED (e.g. event bus subscriber ordering
  // edge case), insert a synthetic entry so the approved state still
  // shows up in the runtime view.
  items.set(p.approvalId, existing
    ? { ...existing, status: 'approved', approvedByEmployeeId: p.approvedByEmployeeId, updatedAt: now }
    : {
        approvalId: p.approvalId,
        actionType: p.actionType,
        source: p.source,
        status: 'approved',
        requestedByEmployeeId: p.requestedByEmployeeId,
        approvedByEmployeeId: p.approvedByEmployeeId,
        createdAt: now,
        updatedAt: now,
      });
  notify();
});

subscribe('APPROVAL_DENIED', (event) => {
  if (event.type !== 'APPROVAL_DENIED') return;
  const p = event.payload;
  const existing = items.get(p.approvalId);
  const now = Date.now();
  items.set(p.approvalId, existing
    ? { ...existing, status: 'denied', reason: p.reason, updatedAt: now }
    : {
        approvalId: p.approvalId,
        actionType: p.actionType,
        source: p.source,
        status: 'denied',
        requestedByEmployeeId: p.requestedByEmployeeId,
        reason: p.reason,
        createdAt: now,
        updatedAt: now,
      });
  notify();
});

// ── Public API ────────────────────────────────────────────

/** Read the current snapshot. Always a copy — safe for direct
 *  React useState seed. */
export function getApprovalRuntimeSnapshot(): CompanionApprovalRuntimeSnapshot {
  return buildSnapshot();
}

/** Subscribe to runtime changes. Returns an unsubscribe handle. */
export function subscribeApprovalRuntime(
  listener: CompanionApprovalRuntimeListener,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Convenience accessor: pending approvals only, most-recent first. */
export function getPendingCompanionApprovals(): CompanionApprovalRuntimeItem[] {
  return Array.from(items.values())
    .filter((i) => i.status === 'pending')
    .map((i) => ({ ...i }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Drop the entire runtime view. Listeners untouched. Dev-only. */
export function clearApprovalRuntime(): void {
  if (items.size === 0) return;
  items.clear();
  notify();
}
