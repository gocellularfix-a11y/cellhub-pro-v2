// R-INTELLIGENCE-AUTO-RESOLUTION-V1
// Deterministic auto-resolution rules for manager queue items.
// Pure operational state checks — no AI, no ML, no heuristics.
//
// Prefer false negatives over false positives.
// When entity data is missing or state is ambiguous: leave pending.
//
// V1 rules:
//   repair   — status picked_up / cancelled / closed
//   layaway  — balance ≤ 0 OR status completed / cancelled / forfeited
//   inventory — qty > minQty (only when minQty is explicitly set)
//   customer  — made a non-voided purchase in the last 30 days

import type { ManagerQueueItem } from '../managerQueue/types';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { ResolutionResult } from '../managerQueue/types';

const NO = (id: string): ResolutionResult => ({ queueItemId: id, resolved: false });
const OK = (id: string, reason: string): ResolutionResult => ({
  queueItemId: id,
  resolved: true,
  reason,
  resolvedAt: Date.now(),
});

// Repair statuses that indicate the underlying problem is gone.
// Adapter normalizes 'complete'/'completed' → 'picked_up', so 'picked_up'
// covers all three source values. 'cancelled' and 'closed' pass through unchanged.
const REPAIR_DONE = new Set(['picked_up', 'cancelled', 'closed']);

// Layaway statuses where the item lifecycle ended.
const LAYAWAY_DONE = new Set(['completed', 'cancelled', 'forfeited']);

// Customer: purchase within the last 30 days counts as "returned".
const CUSTOMER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function evaluateQueueAutoResolution(
  item: ManagerQueueItem,
  engine: IntelligenceEngine,
): ResolutionResult {
  // Only pending items are candidates.
  if (item.status !== 'pending') return NO(item.id);

  // Safety: critical items without a linked entity require manual review.
  if (item.severity === 'critical' && !item.entityId) return NO(item.id);

  // Route to the appropriate rule by entity type.
  if (item.entityType === 'repair'    && item.entityId) return evalRepair(item, engine);
  if (item.entityType === 'layaway'   && item.entityId) return evalLayaway(item, engine);
  if (item.entityType === 'inventory' && item.entityId) return evalInventory(item, engine);
  if (item.entityType === 'customer'  && item.entityId) return evalCustomer(item, engine);

  // No matching rule — leave pending.
  return NO(item.id);
}

// ── Rule: Repair ─────────────────────────────────────────────────────────────

function evalRepair(item: ManagerQueueItem, engine: IntelligenceEngine): ResolutionResult {
  const repair = engine.getRepairs().find(r => r.id === item.entityId);
  // Entity missing → ambiguous state → leave pending.
  if (!repair) return NO(item.id);
  const status = String(repair.status || '');
  if (REPAIR_DONE.has(status)) return OK(item.id, 'repair completed.');
  return NO(item.id);
}

// ── Rule: Layaway ────────────────────────────────────────────────────────────

function evalLayaway(item: ManagerQueueItem, engine: IntelligenceEngine): ResolutionResult {
  const layaway = engine.getLayaways().find(l => l.id === item.entityId);
  if (!layaway) return NO(item.id);
  const status = String(layaway.status || '').toLowerCase();
  if (LAYAWAY_DONE.has(status)) return OK(item.id, 'layaway completed.');
  if ((layaway.balance ?? Infinity) <= 0) return OK(item.id, 'balance collected.');
  return NO(item.id);
}

// ── Rule: Inventory low stock ─────────────────────────────────────────────────
// Only resolves when there is a concrete per-item minimum (minQty) to compare
// against. Without minQty, the threshold is unknowable deterministically — we
// prefer the false negative and leave the item pending.

function evalInventory(item: ManagerQueueItem, engine: IntelligenceEngine): ResolutionResult {
  const inv = engine.getInventory().find(i => i.id === item.entityId);
  if (!inv) return NO(item.id);
  if (inv.minQty == null) return NO(item.id); // no concrete threshold — leave pending
  if (inv.qty > inv.minQty) return OK(item.id, 'inventory replenished.');
  return NO(item.id);
}

// ── Rule: Customer churn ──────────────────────────────────────────────────────
// A customer is considered "returned" if they have a non-voided, non-refunded
// sale within the last 30 days. Iterates the sales array O(n) once.

function evalCustomer(item: ManagerQueueItem, engine: IntelligenceEngine): ResolutionResult {
  const cutoff = Date.now() - CUSTOMER_WINDOW_MS;
  for (const s of engine.getSales()) {
    if (s.customerId !== item.entityId) continue;
    const status = String((s as { status?: string }).status || '').toLowerCase();
    if (status === 'voided' || status === 'refunded') continue;
    // Timestamp extraction — mirrors trendDirection.ts saleTs() pattern.
    let ts = 0;
    try {
      const ca = (s as { createdAt?: unknown }).createdAt;
      const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
        ? (ca as { toDate: () => Date }).toDate()
        : new Date(ca as string | Date);
      ts = d.getTime();
    } catch { ts = 0; }
    if (Number.isFinite(ts) && ts >= cutoff) return OK(item.id, 'customer returned.');
  }
  return NO(item.id);
}
