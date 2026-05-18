// R-INTELLIGENCE-AMBIENT-AWARENESS-V1
// Passive ambient awareness — lightweight entity-open detectors with anti-spam.
// Emits 'cellhub:ambient-insight' events that FloatingOperatorBubble picks up
// and feeds into its existing hint state machine (6s auto-dismiss, no popups).
//
// Rules:
//  - Same hint suppressed for 5 minutes per entity (COOLDOWN_MS)
//  - Only surfaces actionable conditions (overdue, low stock, near-complete)
//  - Never fires for terminal entities (cancelled, completed, picked_up)
//  - No network, no store access — pure in-memory computation over args passed in

import type { Repair, Layaway, InventoryItem, Unlock, SpecialOrder, Customer, Sale } from '@/store/types';
import { calculateLayawayTotals } from '@/services/layaway/payments';
import { buildCustomerCrossModuleProfile } from '../context/customerCrossModuleProfile';
import { rankOpportunitiesForNBA } from '../context/nextBestActionEngine';

// ── Event shape ───────────────────────────────────────────────────────────────

export const AMBIENT_INSIGHT_EVENT = 'cellhub:ambient-insight';

export interface AmbientInsightDetail {
  i18nKey: string;
  args: Array<string | number>;
  severity: 'info' | 'alert';
}

// ── Anti-spam ─────────────────────────────────────────────────────────────────

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const _shownAt = new Map<string, number>();

function canShow(entityKey: string): boolean {
  const last = _shownAt.get(entityKey) ?? 0;
  return Date.now() - last > COOLDOWN_MS;
}

function markShown(entityKey: string): void {
  _shownAt.set(entityKey, Date.now());
}

// ── Emit helper ───────────────────────────────────────────────────────────────

function emit(detail: AmbientInsightDetail): void {
  try {
    window.dispatchEvent(new CustomEvent(AMBIENT_INSIGHT_EVENT, { detail }));
  } catch { /* non-CustomEvent environments — silent */ }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') { const n = new Date(ts).getTime(); return Number.isFinite(n) ? n : 0; }
  if (typeof ts === 'object') {
    const obj = ts as Record<string, unknown>;
    if (typeof obj['toDate'] === 'function') { try { return (obj['toDate'] as () => Date)().getTime(); } catch { return 0; } }
    if (typeof obj['seconds'] === 'number') return (obj['seconds'] as number) * 1000;
  }
  return 0;
}

function daysSince(ts: unknown): number {
  const ms = toMs(ts);
  if (!ms) return 0;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

// ── Status helpers ────────────────────────────────────────────────────────────

const REPAIR_TERMINAL = new Set([
  'cancelled', 'picked_up', 'pickedup', 'refunded', 'delivered', 'closed', 'void',
]);
const REPAIR_READY = new Set([
  'ready', 'ready_for_pickup', 'readyforpickup',
]);

// ── Repair ────────────────────────────────────────────────────────────────────

/**
 * Call when a repair modal opens. Fires ambient hint if:
 *   - Device is READY and waiting ≥1 day (customer hasn't picked up yet)
 *   - Device is active and in-shop ≥3 days without status update
 * No hint for terminal statuses.
 */
export function emitRepairAmbient(repair: Repair): void {
  const s = String(repair.status || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (REPAIR_TERMINAL.has(s)) return;

  const deviceName = (repair as unknown as Record<string, unknown>)['name'] as string | undefined
    ?? `#${repair.id.slice(-6).toUpperCase()}`;

  if (REPAIR_READY.has(s)) {
    const refTs = (repair as unknown as Record<string, unknown>)['completedAt'] ?? repair.updatedAt;
    const days = daysSince(refTs);
    if (days < 1) return;
    const key = `repair_ready:${repair.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({
      i18nKey: 'ambient.repair.ready',
      args: [deviceName, days],
      severity: 'info',
    });
    return;
  }

  // Active / in-progress — days since last status update
  const days = daysSince(repair.updatedAt ?? (repair as unknown as Record<string, unknown>)['createdAt']);
  if (days < 3) return;
  const key = `repair_overdue:${repair.id}`;
  if (!canShow(key)) return;
  markShown(key);
  emit({
    i18nKey: 'ambient.repair.overdue',
    args: [deviceName, days],
    severity: days >= 7 ? 'alert' : 'info',
  });
}

// ── Layaway ───────────────────────────────────────────────────────────────────

/**
 * Call when a layaway form opens. Fires ambient hint if:
 *   - Due date is in the past (overdue)
 *   - Remaining balance ≤ 20% of total (near completion, ≥$10 remaining)
 * No hint for completed/cancelled.
 */
export function emitLayawayAmbient(layaway: Layaway): void {
  const s = String((layaway as unknown as Record<string, unknown>)['status'] ?? '').toLowerCase();
  if (s === 'completed' || s === 'cancelled') return;

  const totals = calculateLayawayTotals(layaway);
  const remainingCents = totals.remainingBalanceCents ?? 0;
  const totalCents = (totals.totalPaidCents ?? 0) + remainingCents;

  const displayName = (layaway as unknown as Record<string, unknown>)['customerName'] as string | undefined
    ?? layaway.items?.[0]?.name
    ?? `LAY-${layaway.id.slice(-6).toUpperCase()}`;

  // Overdue check
  const dueDateStr = (layaway as unknown as Record<string, unknown>)['dueDate'] as string | undefined;
  if (dueDateStr) {
    const dueMs = new Date(dueDateStr).getTime();
    if (Number.isFinite(dueMs) && dueMs < Date.now() && remainingCents > 0) {
      const key = `layaway_overdue:${layaway.id}`;
      if (canShow(key)) {
        markShown(key);
        emit({
          i18nKey: 'ambient.layaway.overdue',
          args: [displayName, `$${(remainingCents / 100).toFixed(2)}`],
          severity: 'info',
        });
        return;
      }
    }
  }

  // Near-completion check (≤20% remaining, ≥$10 left)
  if (totalCents > 0 && remainingCents >= 1_000 && remainingCents / totalCents <= 0.2) {
    const key = `layaway_near:${layaway.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({
      i18nKey: 'ambient.layaway.near',
      args: [displayName, `$${(remainingCents / 100).toFixed(2)}`],
      severity: 'info',
    });
  }
}

// ── Inventory ─────────────────────────────────────────────────────────────────

/**
 * Call when an inventory item modal opens.
 * `recentSalesCount` = number of sales lines for this item in the last 30 days
 * (caller computes this from the sales array — keeps the service free of store deps).
 *
 * Fires ambient hint if:
 *   - Low stock: qty ≤ effective minQty AND at least 1 recent sale (worth restocking)
 *   - Dead stock: no sales in 45+ days (caller passes 0 for recentSalesCount, daysWithoutSale ≥ 45)
 */
export function emitInventoryAmbient(
  item: InventoryItem,
  recentSalesCount: number,
  daysWithoutSale: number,
): void {
  const qty = item.qty ?? 0;
  const minQty = (item as unknown as Record<string, unknown>)['minQty'] as number | undefined ?? 1;
  const name = item.name || item.sku || `Item ${item.id.slice(-6)}`;

  // Low stock (qty at/below threshold + has recent demand)
  if (qty <= minQty && recentSalesCount >= 1) {
    const key = `inventory_low:${item.id}`;
    if (canShow(key)) {
      markShown(key);
      emit({ i18nKey: 'ambient.inventory.low', args: [name, qty], severity: 'info' });
      return;
    }
  }

  // Dead stock (no movement in 45+ days)
  if (recentSalesCount === 0 && daysWithoutSale >= 45 && qty > 0) {
    const key = `inventory_dead:${item.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({ i18nKey: 'ambient.inventory.dead', args: [name, daysWithoutSale], severity: 'info' });
  }
}

// ── Unlock ────────────────────────────────────────────────────────────────────

const UNLOCK_TERMINAL_AMBIENT = new Set(['completed', 'failed', 'cancelled']);

/**
 * Call when an unlock modal opens. Fires ambient hint if:
 *   - Code is received and not yet delivered (unlockCode present, not terminal)
 *   - Waiting on supplier 3+ days without a code
 *   - Unpaid balance ≥ $5
 * No hint for terminal statuses.
 */
export function emitUnlockAmbient(unlock: Unlock): void {
  const s = String(unlock.status || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (UNLOCK_TERMINAL_AMBIENT.has(s)) return;

  const name = unlock.customerName || `#${unlock.id.slice(-6).toUpperCase()}`;
  const device = unlock.device || 'device';

  if (unlock.unlockCode) {
    const key = `unlock_ready:${unlock.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({ i18nKey: 'ambient.unlock.ready', args: [name, device], severity: 'info' });
    return;
  }

  const days = daysSince(unlock.createdAt);
  if (days >= 3) {
    const key = `unlock_waiting:${unlock.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({
      i18nKey: 'ambient.unlock.waiting',
      args: [name, days],
      severity: days >= 7 ? 'alert' : 'info',
    });
    return;
  }

  if (unlock.balance >= 500) {
    const key = `unlock_balance:${unlock.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({
      i18nKey: 'ambient.unlock.balance',
      args: [name, `$${(unlock.balance / 100).toFixed(2)}`],
      severity: 'info',
    });
  }
}

// ── Special Order ─────────────────────────────────────────────────────────────

const SO_TERMINAL_AMBIENT = new Set(['picked_up', 'cancelled', 'refunded']);

/**
 * Call when a special order modal opens. Fires ambient hint if:
 *   - Item arrived (received/ready) — notify customer
 *   - Still waiting 5+ days without status change
 *   - Unpaid balance ≥ $5
 * No hint for terminal statuses.
 */
export function emitSpecialOrderAmbient(order: SpecialOrder): void {
  const s = String(order.status || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (SO_TERMINAL_AMBIENT.has(s)) return;

  const name = order.customerName || `#${order.id.slice(-6).toUpperCase()}`;
  const item = order.itemDescription || 'item';

  if (s === 'received' || s === 'ready') {
    const key = `so_arrived:${order.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({ i18nKey: 'ambient.specialorder.arrived', args: [name, item], severity: 'info' });
    return;
  }

  const days = daysSince(order.createdAt);
  if ((s === 'ordered' || s === 'in_transit') && days >= 5) {
    const key = `so_waiting:${order.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({
      i18nKey: 'ambient.specialorder.waiting',
      args: [name, days],
      severity: days >= 14 ? 'alert' : 'info',
    });
    return;
  }

  if (order.balance >= 500) {
    const key = `so_balance:${order.id}`;
    if (!canShow(key)) return;
    markShown(key);
    emit({
      i18nKey: 'ambient.specialorder.balance',
      args: [name, `$${(order.balance / 100).toFixed(2)}`],
      severity: 'info',
    });
  }
}

// ── Customer (cross-module) ───────────────────────────────────────────────────

export interface CustomerAmbientParams {
  customer: Customer;
  repairs: Repair[];
  unlocks: Unlock[];
  specialOrders: SpecialOrder[];
  layaways: Layaway[];
  sales: Sale[];
  customers: Customer[];
  now?: number;
}

const SUMMARY_TO_AMBIENT: Record<string, string> = {
  'ctx.customer.repair_ready':   'ambient.customer.repair_ready',
  'ctx.customer.so_arrived':     'ambient.customer.so_arrived',
  'ctx.customer.unlock_ready':   'ambient.customer.unlock_ready',
  'ctx.customer.balance':        'ambient.customer.balance',
  'ctx.customer.unlock_waiting': 'ambient.customer.unlock_waiting',
  'ctx.customer.inactive':       'ambient.customer.inactive',
  'ctx.customer.repeat_repair':  'ambient.customer.repeat_repair',
};

/**
 * Call when a customer profile modal opens.
 * Runs the cross-module profile, picks the top NBA signal, and emits one hint.
 * Suppressed for 5 minutes per customer (COOLDOWN_MS).
 */
export function emitCustomerAmbient(params: CustomerAmbientParams): void {
  const { customer, repairs, unlocks, specialOrders, layaways, sales, customers, now = Date.now() } = params;

  const cooldownKey = `customer_top:${customer.id}`;
  if (!canShow(cooldownKey)) return;

  const opps = buildCustomerCrossModuleProfile({
    customerId: customer.id,
    customers,
    repairs,
    unlocks,
    specialOrders,
    layaways,
    sales,
    now,
  });

  const result = rankOpportunitiesForNBA(opps);
  if (!result) return;

  const i18nKey = SUMMARY_TO_AMBIENT[result.primary.summaryKey];
  if (!i18nKey) return;

  markShown(cooldownKey);
  emit({
    i18nKey,
    args: result.primary.evidence,
    severity: result.primary.severity === 'critical' || result.primary.severity === 'high' ? 'alert' : 'info',
  });
}

// ── Cooldown reset (testing / manual clear) ───────────────────────────────────

export function resetAmbientCooldowns(): void {
  _shownAt.clear();
}
