// Round R2: canonical repair status helper (snake_case source of truth).
//
// Canonical statuses match src/store/types.ts comment:
//   'received' | 'diagnosing' | 'waiting_parts' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled'
// The UI historically wrote PascalCase ('Complete', 'Cancelled', 'In Progress'),
// while POSModule and intelligence services write/read canonical snake_case.
// This helper reconciles both, and on-save normalization + the Round R2 sweep
// converge persisted data to snake_case.

export const REPAIR_STATUS = {
  RECEIVED: 'received',
  IN_PROGRESS: 'in_progress',
  WAITING_PARTS: 'waiting_parts',
  READY: 'ready',
  PICKED_UP: 'picked_up',
  CANCELLED: 'cancelled',
} as const;

export type RepairStatusCanonical = typeof REPAIR_STATUS[keyof typeof REPAIR_STATUS];

// Legacy/alias map — anything normalized (lowercase, underscored) that
// doesn't match a canonical value falls through to canonical via this map.
// Unknown inputs return their normalized form untouched.
const LEGACY_MAP: Record<string, RepairStatusCanonical> = {
  received: REPAIR_STATUS.RECEIVED,
  in_progress: REPAIR_STATUS.IN_PROGRESS,
  waiting_parts: REPAIR_STATUS.WAITING_PARTS,
  ready: REPAIR_STATUS.READY,
  picked_up: REPAIR_STATUS.PICKED_UP,
  cancelled: REPAIR_STATUS.CANCELLED,
  // Historic aliases (pre-R2 persisted forms)
  complete: REPAIR_STATUS.PICKED_UP,
  completed: REPAIR_STATUS.PICKED_UP,
  canceled: REPAIR_STATUS.CANCELLED,
};

export function normalizeRepairStatus(s: unknown): string {
  if (s === null || s === undefined) return '';
  const normalized = String(s).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return '';
  return LEGACY_MAP[normalized] ?? normalized;
}

export const orderedRepairStatusOptions: RepairStatusCanonical[] = [
  REPAIR_STATUS.RECEIVED,
  REPAIR_STATUS.IN_PROGRESS,
  REPAIR_STATUS.WAITING_PARTS,
  REPAIR_STATUS.READY,
  REPAIR_STATUS.PICKED_UP,
  REPAIR_STATUS.CANCELLED,
];

export function isDoneRepairStatus(status: unknown): boolean {
  const n = normalizeRepairStatus(status);
  return n === REPAIR_STATUS.PICKED_UP || n === REPAIR_STATUS.CANCELLED;
}
