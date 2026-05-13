// ============================================================
// CellHub Pro — Approval Event Log (R-APPROVAL-PIN-V1)
// Append-only audit storage. localStorage-backed (no Firestore
// dependency yet — keeps the feature offline-safe).
//
// SECURITY: this module never reads or writes a PIN. Events
// only carry IDs and metadata. The log is intentionally NOT
// piped through services/persist.ts so it stays out of the
// dual-mode auto-sync pipeline until F-LATER ships a viewer.
// ============================================================

import { saveLocal, loadLocal } from '@/services/storage';
import { generateId } from '@/utils/dates';
import type { ApprovalEvent } from '@/store/types';

const STORAGE_KEY = 'approval_events';

// Cap so a runaway log can't exhaust localStorage. Plenty for daily
// audit; oldest entries fall off when the cap is reached.
const MAX_EVENTS = 5000;

/**
 * Append a new approval event. `id` and `createdAt` are filled if missing.
 * Returns the persisted event.
 */
export function appendApprovalEvent(
  partial: Omit<ApprovalEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): ApprovalEvent {
  const event: ApprovalEvent = {
    id: partial.id || generateId(),
    requestedByEmployeeId: partial.requestedByEmployeeId,
    approvedByEmployeeId: partial.approvedByEmployeeId,
    actionType: partial.actionType,
    category: partial.category,
    status: partial.status,
    entityId: partial.entityId,
    createdAt: partial.createdAt ?? Date.now(),
  };
  const list = loadLocal<ApprovalEvent[]>(STORAGE_KEY, []);
  list.push(event);
  if (list.length > MAX_EVENTS) {
    list.splice(0, list.length - MAX_EVENTS);
  }
  saveLocal(STORAGE_KEY, list);
  return event;
}

/**
 * Read-only accessor. No viewer UI exists yet (per auditor F1 scope) —
 * exposed so future Mobile Companion / Reports modules can consume.
 */
export function listApprovalEvents(): ApprovalEvent[] {
  return loadLocal<ApprovalEvent[]>(STORAGE_KEY, []);
}
