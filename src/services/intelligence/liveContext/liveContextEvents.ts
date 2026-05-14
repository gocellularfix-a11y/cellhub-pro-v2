// ============================================================
// CellHub Pro — Live Context Event Emitters (R-INTELLIGENCE-EVENT-INSTRUMENTATION-V1)
// Centralized helpers for dispatching lightweight operational events.
//
// Rules:
//   - Payloads are SMALL identifiers only (IDs, SKUs, counts, flags)
//   - NO full objects, NO financial amounts, NO personal data
//   - All dispatches are fire-and-forget; callers never await
//   - Each helper wraps window.dispatchEvent in try/catch so it can
//     never throw into the calling module
// ============================================================

import { OPERATOR_ACTIVITY_EVENT } from '@/services/operator/operatorActivityHints';

function emit(type: string, payload: Record<string, string | number | boolean> = {}): void {
  try {
    window.dispatchEvent(new CustomEvent(OPERATOR_ACTIVITY_EVENT, {
      detail: { type, payload },
    }));
  } catch { /* env without CustomEvent — silent */ }
}

// ── Customer ──────────────────────────────────────────────

export function emitCustomerSelected(customerId: string): void {
  emit('customer.selected', { customerId });
}

export function emitCustomerSearched(query: string): void {
  // Only emit when query is meaningful (>= 2 chars) to avoid noise
  if (query.trim().length < 2) return;
  emit('customer.searched', { query: query.trim().slice(0, 40) });
}

export function emitCustomerHistoryViewed(customerId: string): void {
  emit('customer.history_opened', { customerId });
}

// ── POS / Cart ────────────────────────────────────────────

export function emitItemAdded(opts: {
  sku?: string;
  category: string;
  itemCount: number;
}): void {
  const payload: Record<string, string | number | boolean> = {
    category: opts.category,
    itemCount: opts.itemCount,
  };
  if (opts.sku) payload.sku = opts.sku;
  emit('item.added', payload);
}

export function emitDiscountAttempted(): void {
  emit('discount.attempted', {});
}

export function emitSaleCompleted(opts: { customerId?: string; amountCents: number }): void {
  const payload: Record<string, string | number | boolean> = {
    amountCents: opts.amountCents,
  };
  if (opts.customerId) payload.customerId = opts.customerId;
  emit('sale.completed', payload);
}

// ── Repairs ───────────────────────────────────────────────

export function emitRepairOpened(repairId: string): void {
  emit('repair.opened', { repairId });
}

export function emitRepairCompleted(repairId: string, customerId?: string): void {
  const payload: Record<string, string | number | boolean> = { repairId };
  if (customerId) payload.customerId = customerId;
  emit('repair.completed', payload);
}

// ── Layaways ──────────────────────────────────────────────

export function emitLayawayOpened(layawayId: string): void {
  emit('layaway.opened', { layawayId });
}

export function emitLayawayPaymentStarted(layawayId: string, customerId?: string): void {
  const payload: Record<string, string | number | boolean> = { layawayId };
  if (customerId) payload.customerId = customerId;
  emit('layaway.payment.started', payload);
}

// ── Phone Payments ────────────────────────────────────────

export function emitPhonePaymentStarted(customerId?: string, phone?: string): void {
  const payload: Record<string, string | number | boolean> = {};
  if (customerId) payload.customerId = customerId;
  if (phone) payload.phone = phone;
  emit('phone.payment.flow_started', payload);
}

// ── Inventory ─────────────────────────────────────────────

export function emitInventoryLookup(opts: { sku?: string; itemName?: string }): void {
  const payload: Record<string, string | number | boolean> = {};
  if (opts.sku) payload.sku = opts.sku;
  if (opts.itemName) payload.itemName = opts.itemName.slice(0, 40);
  emit('inventory.item_opened', payload);
}

// ── Approvals ─────────────────────────────────────────────

export function emitApprovalRequested(actionType: string): void {
  emit('approval.requested', { actionType });
}

export function emitApprovalAccepted(actionType: string): void {
  emit('approval.accepted', { actionType });
}

export function emitApprovalDenied(actionType: string): void {
  emit('approval.denied', { actionType });
}

// ── Generic ───────────────────────────────────────────────

/** Low-level emitter for action types not covered by the typed helpers. */
export function emitLiveContextAction(
  type: string,
  payload: Record<string, string | number | boolean> = {},
): void {
  emit(type, payload);
}
