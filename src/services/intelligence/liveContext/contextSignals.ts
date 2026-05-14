// ============================================================
// CellHub Pro — Live Context Signals (R-INTELLIGENCE-LIVE-CONTEXT-V1)
// Boolean predicates derived from LiveContext + OperatorActivityInputs.
// Pure functions — no side effects, no I/O, no React.
// ============================================================

import type { LiveContext } from './contextTypes';
import type { OperatorActivityInputs } from '@/services/operator/operatorActivityHints';
import { getRecentActionOfType } from './contextSelectors';
import type { Customer } from '@/store/types';

const MS_PER_DAY = 86_400_000;
const INACTIVE_DAYS = 90;
const MULTI_LINE_MIN = 3;

// ── Internal helpers ──────────────────────────────────────

function lineCountFor(cust: Customer): number {
  const phones = (cust as { phones?: string[] }).phones;
  if (Array.isArray(phones) && phones.length > 0) return phones.length;
  return cust.phone ? 1 : 0;
}

function lastSaleDaysAgoFor(
  inputs: OperatorActivityInputs,
  customerId: string,
): number | null {
  let bestTs = -Infinity;
  for (const s of inputs.sales) {
    if (!s || s.customerId !== customerId) continue;
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ca = s.createdAt;
    let ts = -Infinity;
    if (typeof ca === 'string') { const p = Date.parse(ca); if (Number.isFinite(p)) ts = p; }
    else if (typeof ca === 'number') ts = ca;
    else if (ca instanceof Date) ts = ca.getTime();
    else if (ca && typeof (ca as { toDate?: () => Date }).toDate === 'function') {
      try { ts = (ca as { toDate: () => Date }).toDate().getTime(); } catch { /* skip */ }
    }
    if (ts > bestTs) bestTs = ts;
  }
  if (!Number.isFinite(bestTs) || bestTs === -Infinity) return null;
  return Math.floor((Date.now() - bestTs) / MS_PER_DAY);
}

// ── Public signals ────────────────────────────────────────

/**
 * Resolve the full Customer record for the active customer in context.
 * Returns null when there's no active customer or the record isn't loaded.
 */
export function getActiveCustomer(
  ctx: LiveContext,
  inputs: OperatorActivityInputs,
): Customer | null {
  const id = ctx.activeCustomer?.id;
  if (!id) return null;
  return inputs.customers.find((c) => c && c.id === id) ?? null;
}

/** Cart has phone-payment items, or a recent payment/number-entry action fired. */
export function hasPhonePaymentFlow(ctx: LiveContext): boolean {
  if (ctx.cart?.hasPhonePayments) return true;
  return ctx.recentActions
    .slice(0, 8)
    .some((a) => a.type === 'payment_started' || a.type === 'phone_number_entered');
}

/** Cart has repair-linked items, or a repair_opened action fired recently. */
export function hasRepairFlow(ctx: LiveContext): boolean {
  if (ctx.cart?.hasRepairItems) return true;
  return ctx.recentActions.slice(0, 8).some((a) => a.type === 'repair_opened');
}

/**
 * Customer is in context, has a service-oriented flow, but cart lacks accessories —
 * good moment to upsell a case / screen protector / charger.
 */
export function hasUpsellOpportunity(ctx: LiveContext): boolean {
  if (!ctx.activeCustomer) return false;
  if (ctx.cart?.hasAccessories) return false;
  return hasPhonePaymentFlow(ctx) || hasRepairFlow(ctx);
}

/** Active customer has not transacted in INACTIVE_DAYS days (retention signal). */
export function hasLongInactiveCustomer(
  ctx: LiveContext,
  inputs: OperatorActivityInputs,
): boolean {
  const id = ctx.activeCustomer?.id;
  if (!id) return false;
  const days = lastSaleDaysAgoFor(inputs, id);
  return days !== null && days > INACTIVE_DAYS;
}

/** Active customer has 3 or more phone lines (multi-line promotion signal). */
export function hasMultiLineCustomer(
  ctx: LiveContext,
  inputs: OperatorActivityInputs,
): boolean {
  const id = ctx.activeCustomer?.id;
  if (!id) return false;
  const cust = inputs.customers.find((c) => c && c.id === id);
  return !!cust && lineCountFor(cust) >= MULTI_LINE_MIN;
}

/** A recent approval_requested action was logged in this session. */
export function hasPendingApprovalFlow(ctx: LiveContext): boolean {
  return getRecentActionOfType(ctx, 'approval_requested') !== null;
}
