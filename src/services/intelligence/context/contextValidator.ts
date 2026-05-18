// R-INTELLIGENCE-CONTEXT-VALIDATOR-V1
// Deterministic entity validation for follow-up actions.
// Prevents stale or missing context from executing entity-specific actions
// (WhatsApp, open repair, open customer) when the referenced entity no longer
// exists in the current store data.
//
// Rules:
// - Pure — no I/O, no AI, no embeddings, no side effects
// - Reads engine arrays only (getCustomers / getRepairs / getInventory)
// - context.value semantics match what establishesContext writes:
//     customer → customerId OR customerName (handler-dependent)
//     repair   → repair.customerName
//     product  → item.name
// - Does NOT block diagnostic re-runs (slow_day, push_right_now, show_more)

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { OperationalContext } from '../chat/intentRouter';

export interface ValidationResult {
  valid: boolean;
}

const VALID: ValidationResult = { valid: true };
const INVALID: ValidationResult = { valid: false };

export function validateCustomerContext(
  engine: IntelligenceEngine,
  context: OperationalContext | null | undefined,
): ValidationResult {
  if (!context || context.type !== 'customer' || !context.value) return INVALID;
  const v = context.value;
  // Value may be a customer ID (best_customer path) or a customer name
  // (customer_history / outreach paths). Check both.
  const found = engine.getCustomers().some((c) => c.id === v || c.name === v);
  return found ? VALID : INVALID;
}

export function validateRepairContext(
  engine: IntelligenceEngine,
  context: OperationalContext | null | undefined,
): ValidationResult {
  if (!context || context.type !== 'repair' || !context.value) return INVALID;
  // repairIntelligence.ts writes repair.customerName into context.value
  const found = engine.getRepairs().some((r) => r.customerName === context.value);
  return found ? VALID : INVALID;
}

export function validateProductContext(
  engine: IntelligenceEngine,
  context: OperationalContext | null | undefined,
): ValidationResult {
  if (!context || context.type !== 'product' || !context.value) return INVALID;
  // productPromotion.ts writes item.name into context.value
  const found = engine.getInventory().some((item) => item.name === context.value);
  return found ? VALID : INVALID;
}

export function validateOperationalContext(
  engine: IntelligenceEngine,
  context: OperationalContext | null | undefined,
): ValidationResult {
  if (!context || !context.value) return INVALID;
  switch (context.type) {
    case 'customer': return validateCustomerContext(engine, context);
    case 'repair':   return validateRepairContext(engine, context);
    case 'product':  return validateProductContext(engine, context);
    default:         return INVALID;
  }
}
