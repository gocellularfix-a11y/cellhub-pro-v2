// ============================================================
// R-ENTITY-VALIDATION-V1 — Live re-validation of resolved entity references.
//
// resolveEntityReference() resolves a query/context into a ResolvedEntity but,
// by its own safety contract, "Callers must validate returned IDs against live
// store before acting." This module is that validation step: given a resolved
// reference + live store accessors, confirm the entity STILL exists and is in
// an actionable state before any executable action is produced.
//
// Pure, deterministic, no side effects, no mutation. Returns a typed result;
// callers decide how to surface a failure (safe chat message, no-op, etc.).
// Never throws — unknown shapes degrade to a safe failure result.
// ============================================================

import type { ResolvedEntity } from './types';
import type { Customer, Repair, Layaway, InventoryItem } from '@/store/types';
import { normalizeRepairStatus, REPAIR_STATUS } from '@/utils/repairStatus';

export type EntityValidationReason =
  | 'not_found'        // id/sku no longer maps to any live record
  | 'deleted'          // record exists but is flagged deleted/archived
  | 'cancelled'        // terminal: cancelled / refunded / forfeited / voided
  | 'completed'        // terminal: picked_up / completed / redeemed
  | 'ambiguous'        // reserved — resolver returns null on ambiguity today
  | 'unsupported'      // type carries no executable action to validate (sale)
  | 'stale_reference'; // reserved — generic stale marker for future paths

export type ValidatedEntityType = ResolvedEntity['type'];

export type EntityValidationResult =
  | { ok: true;  type: ValidatedEntityType; id: string }
  | { ok: false; type: ValidatedEntityType; id: string; reason: EntityValidationReason };

// Minimal structural accessors over live store collections. IntelligenceEngine
// satisfies this directly (getCustomers/getRepairs/getLayaways/getInventory);
// tests can pass a lightweight stub returning fixed arrays.
export interface EntityValidationStore {
  getCustomers(): Customer[];
  getRepairs(): Repair[];
  getLayaways(): Layaway[];
  getInventory(): InventoryItem[];
}

function isFlaggedRemoved(rec: unknown): boolean {
  const r = rec as Record<string, unknown>;
  return r.deleted === true || r.archived === true || r.isDeleted === true;
}

/**
 * Re-validates a resolved entity reference against live store data.
 *
 * Decision per type:
 *   customer   — must exist (match by id OR phone, mirroring the resolver's own
 *                lookup) and not be flagged deleted/archived.
 *   repair     — must exist; cancelled/refunded/refund_pending → 'cancelled';
 *                picked_up (terminal "done") → 'completed'.
 *   layaway    — must exist; cancelled/forfeited/voided → 'cancelled';
 *                completed/redeemed/fulfilled → 'completed'.
 *   inventory  — must exist (match by id OR sku) and not be flagged removed.
 *   sale       — 'unsupported' (GOER produces no executable action for sales).
 */
export function validateResolvedEntity(
  entity: ResolvedEntity,
  store: EntityValidationStore,
): EntityValidationResult {
  switch (entity.type) {
    case 'customer': {
      const id = entity.customerId;
      const c = store.getCustomers().find(
        (cu) => cu.id === id || (cu as { phone?: unknown }).phone === id,
      );
      if (!c) return { ok: false, type: 'customer', id, reason: 'not_found' };
      if (isFlaggedRemoved(c)) return { ok: false, type: 'customer', id, reason: 'deleted' };
      return { ok: true, type: 'customer', id };
    }

    case 'repair': {
      const id = entity.repairId;
      const r = store.getRepairs().find((re) => re.id === id);
      if (!r) return { ok: false, type: 'repair', id, reason: 'not_found' };
      const s = normalizeRepairStatus((r as { status?: unknown }).status);
      if (s === REPAIR_STATUS.CANCELLED || s === REPAIR_STATUS.REFUNDED || s === REPAIR_STATUS.REFUND_PENDING) {
        return { ok: false, type: 'repair', id, reason: 'cancelled' };
      }
      if (s === REPAIR_STATUS.PICKED_UP) {
        return { ok: false, type: 'repair', id, reason: 'completed' };
      }
      return { ok: true, type: 'repair', id };
    }

    case 'layaway': {
      const id = entity.layawayId;
      const l = store.getLayaways().find((la) => la.id === id);
      if (!l) return { ok: false, type: 'layaway', id, reason: 'not_found' };
      const s = String((l as { status?: unknown }).status || '').trim().toLowerCase();
      if (s === 'cancelled' || s === 'canceled' || s === 'forfeited' || s === 'voided') {
        return { ok: false, type: 'layaway', id, reason: 'cancelled' };
      }
      if (s === 'completed' || s === 'redeemed' || s === 'fulfilled' || s === 'picked_up') {
        return { ok: false, type: 'layaway', id, reason: 'completed' };
      }
      return { ok: true, type: 'layaway', id };
    }

    case 'inventory': {
      const id = entity.sku;
      const i = store.getInventory().find(
        (it) => it.id === id || (it as { sku?: unknown }).sku === id,
      );
      if (!i) return { ok: false, type: 'inventory', id, reason: 'not_found' };
      if (isFlaggedRemoved(i)) return { ok: false, type: 'inventory', id, reason: 'deleted' };
      return { ok: true, type: 'inventory', id };
    }

    case 'sale':
      // GOER surfaces sales as text only — no executable action to guard.
      return { ok: false, type: 'sale', id: entity.saleId, reason: 'unsupported' };

    default:
      return { ok: false, type: (entity as { type: ValidatedEntityType }).type, id: '', reason: 'unsupported' };
  }
}
