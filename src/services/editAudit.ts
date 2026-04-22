/**
 * R-EDIT-AUDIT — Edit audit trail service.
 *
 * IMPORTANT: persist.ts localSaveRecord OVERWRITES non-settings collections.
 * Every caller that saves after using these helpers MUST pass the full entity
 * spread: persist.repair(id, { ...entity, ...changes }).
 * NEVER pass partial data.
 */

// ── Money fields per module (used by computeDiff to detect money-impacting edits) ──

export const REPAIR_MONEY_FIELDS = [
  'laborCost', 'estimatedCost', 'depositAmount', 'taxable',
] as const;

export const UNLOCK_MONEY_FIELDS = [
  'price', 'cost', 'depositAmount', 'taxable',
] as const;

export const SPECIAL_ORDER_MONEY_FIELDS = [
  'price', 'cost', 'depositAmount', 'taxable',
] as const;

export type EditReason = 'additional_balance' | 'absorbed' | 'refund' | 'typo_correction';

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface EditEntry {
  editedAt: string;
  editedBy: string;
  pinUsedBy: string;
  reason: EditReason;
  fieldsChanged: FieldChange[];
  note?: string;
  sideEffects?: {
    balanceChange?: number;        // cents delta
    statusChange?: { from: string; to: string };
    refundOwedAmount?: number;     // cents (only for refund reason)
    absorbedAmount?: number;       // cents (only for absorbed reason)
  };
}

export interface OriginalSnapshot {
  capturedAt: string;
  snapshot: Record<string, unknown>;
}

// ── Max edit history entries ──
const EDIT_HISTORY_CAP = 100;
const EDIT_HISTORY_WARNING = 80;

/**
 * Capture a snapshot of the entity's current money + info fields.
 * Called ONCE on first post-completion edit. Never overwritten after that.
 */
export function captureSnapshot(entity: Record<string, unknown>): OriginalSnapshot {
  // Shallow clone of all enumerable fields — sufficient because
  // money fields are primitives, not nested objects.
  // Excludes: audit fields, heavy blobs, volatile timestamps, arrays.
  const EXCLUDE = new Set([
    'editHistory', 'originalSnapshot',  // audit fields (circular)
    'parts',                             // RepairPart[] array (heavy, not money)
    'devicePhoto',                       // base64 blob (huge)
    'updatedAt',                         // volatile, changes on every save
    'trackingToken',                     // internal, not user-facing
  ]);
  const snapshot: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(entity)) {
    if (EXCLUDE.has(key)) continue;
    snapshot[key] = val;
  }
  return {
    capturedAt: new Date().toISOString(),
    snapshot,
  };
}

/**
 * Compare current form values against the fresh persisted entity.
 *
 * IMPORTANT: `reference` should be the FRESH entity read from ref
 * (entitiesRef.current.find(...)), NOT the originalSnapshot.
 * originalSnapshot is only for receipt "Previously:" display.
 *
 * Returns array of changed fields. Empty array = no changes.
 */
export function computeDiff(
  reference: Record<string, unknown>,
  current: Record<string, unknown>,
  fieldsToCheck: readonly string[],
): FieldChange[] {
  if (!reference || !current) return [];
  const changes: FieldChange[] = [];
  for (const field of fieldsToCheck) {
    const oldVal = reference[field];
    const newVal = current[field];
    // Treat null/undefined/'' as equivalent (avoids false positives from
    // undefined vs null vs '' which are semantically identical in our forms)
    const bothEmpty =
      (oldVal == null || oldVal === '') &&
      (newVal == null || newVal === '');
    if (!bothEmpty && oldVal !== newVal) {
      changes.push({ field, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

/**
 * Check if any of the changed fields are money fields.
 */
export function hasMoneyChanges(
  changes: FieldChange[],
  moneyFields: readonly string[],
): boolean {
  return changes.some((c) => (moneyFields as readonly string[]).includes(c.field));
}

/**
 * Append an edit entry to the entity's editHistory array.
 * Returns the updated editHistory array (caller must spread into entity before persist).
 *
 * Returns null if history is at cap (100) — caller should toast and block save.
 */
export function appendEditEntry(
  existingHistory: EditEntry[] | undefined,
  entry: EditEntry,
): EditEntry[] | null {
  const history = existingHistory ? [...existingHistory] : [];
  if (history.length >= EDIT_HISTORY_CAP) {
    return null; // Caller must toast "edit history full" and block
  }
  history.push(entry);
  return history;
}

/**
 * Check if edit history is approaching the cap.
 * Returns 'warning' at 80+, 'full' at 100, 'ok' otherwise.
 */
export function checkEditHistoryStatus(
  history: EditEntry[] | undefined,
): 'ok' | 'warning' | 'full' {
  const len = history?.length ?? 0;
  if (len >= EDIT_HISTORY_CAP) return 'full';
  if (len >= EDIT_HISTORY_WARNING) return 'warning';
  return 'ok';
}

/**
 * All fields to check for diff (money + info).
 * Module-specific — caller picks the right set.
 */
export const REPAIR_ALL_FIELDS = [
  // Money
  'laborCost', 'estimatedCost', 'depositAmount', 'taxable',
  // Info
  'customerName', 'customerPhone', 'device', 'deviceModel', 'imei',
  'issue', 'techNotes', 'priority', 'warranty', 'estimatedCompletion',
  'employeeName', 'notes',
] as const;

export const UNLOCK_ALL_FIELDS = [
  // Money
  'price', 'cost', 'depositAmount', 'taxable',
  // Info
  'customerName', 'customerPhone', 'device', 'imei', 'carrier',
  'targetCarrier', 'unlockType', 'unlockCode', 'supplier',
  'orderDate', 'completionDate', 'notes', 'employeeName',
] as const;

export const SPECIAL_ORDER_ALL_FIELDS = [
  // Money
  'price', 'cost', 'depositAmount', 'taxable',
  // Info
  'customerName', 'customerPhone', 'itemDescription', 'supplier',
  'estimatedArrival', 'notes', 'employeeName',
] as const;
