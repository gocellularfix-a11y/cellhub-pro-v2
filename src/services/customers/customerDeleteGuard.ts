// ============================================================
// R-CUSTOMER-DELETE-FIX-V1
// Pure, deterministic evaluation of a customer-delete request. Extracted
// from CustomerModule's inline guard so the decision logic is unit-testable
// and the UI layer only orchestrates dialogs.
//
// Design (unchanged from the existing product behavior):
//   - Deleting a customer removes ONLY the customer record. Historical
//     business records (sales, repairs, layaways, unlocks, orders, returns,
//     AR history) are NEVER cascade-deleted — they keep their embedded
//     customer name/phone snapshots.
//   - Active ties (store credit, loyalty points, open repairs/layaways/
//     unlocks) do not BLOCK deletion; they produce explicit warnings the
//     owner must confirm through a second, clearly-worded dialog.
//   - A missing id fails safe with an explicit result (never a silent
//     no-op).
// ============================================================

import type { Customer, Repair, Layaway, Unlock } from '@/store/types';

export type CustomerDeleteWarning =
  | { type: 'store_credit'; amountCents: number }
  | { type: 'loyalty'; points: number }
  | { type: 'active_repairs'; count: number }
  | { type: 'active_layaways'; count: number }
  | { type: 'active_unlocks'; count: number };

export type CustomerDeleteEvaluation =
  | { kind: 'missing' }
  | { kind: 'ok'; customer: Customer }
  | { kind: 'warn'; customer: Customer; warnings: CustomerDeleteWarning[] };

const digits = (p: unknown): string => String(p || '').replace(/\D/g, '');

const REPAIR_TERMINAL = ['Complete', 'completed', 'Cancelled', 'cancelled'];
const UNLOCK_TERMINAL = ['completed', 'Complete', 'failed', 'cancelled', 'Cancelled'];

/**
 * Evaluate a delete request. Pure: no store access, no side effects.
 * Linked-record matching mirrors the pre-existing rules exactly
 * (customerId OR normalized-phone match; active = non-terminal status).
 */
export function evaluateCustomerDelete(
  id: string,
  customers: readonly Customer[],
  linked: {
    repairs: readonly Repair[];
    layaways: readonly Layaway[];
    unlocks: readonly Unlock[];
  },
): CustomerDeleteEvaluation {
  const customer = customers.find((c) => c.id === id);
  if (!customer) return { kind: 'missing' };

  const phone = digits(customer.phone);
  const matches = (recCustomerId: unknown, recPhone: unknown): boolean =>
    recCustomerId === id || (!!phone && digits(recPhone) === phone);

  const warnings: CustomerDeleteWarning[] = [];

  const storeCredit = customer.storeCredit || 0;
  if (storeCredit > 0) warnings.push({ type: 'store_credit', amountCents: storeCredit });

  const loyalty = customer.loyaltyPoints || 0;
  if (loyalty > 0) warnings.push({ type: 'loyalty', points: loyalty });

  const activeRepairs = linked.repairs.filter(
    (r) => matches((r as any).customerId, r.customerPhone) && !REPAIR_TERMINAL.includes(r.status || ''),
  ).length;
  if (activeRepairs > 0) warnings.push({ type: 'active_repairs', count: activeRepairs });

  const activeLayaways = linked.layaways.filter(
    (l) => matches((l as any).customerId, l.customerPhone) && l.status === 'active',
  ).length;
  if (activeLayaways > 0) warnings.push({ type: 'active_layaways', count: activeLayaways });

  const activeUnlocks = linked.unlocks.filter(
    (u) => matches((u as any).customerId, u.customerPhone) && !UNLOCK_TERMINAL.includes(u.status || ''),
  ).length;
  if (activeUnlocks > 0) warnings.push({ type: 'active_unlocks', count: activeUnlocks });

  return warnings.length > 0
    ? { kind: 'warn', customer, warnings }
    : { kind: 'ok', customer };
}
