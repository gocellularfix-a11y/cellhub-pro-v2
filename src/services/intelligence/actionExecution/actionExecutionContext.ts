// CellHub Intelligence — Action Execution Context Builder
// Pure function. Assembles the ActionExecutionContext from bubble props.

import type { Customer, Repair, Layaway } from '@/store/types';
import type { CustomerBusinessProfile } from '@/services/intelligence/customerScoring/customerScoringTypes';
import type { ActionExecutionContext } from './actionExecutionTypes';

/**
 * Build an ActionExecutionContext from the bubble's runtime state.
 * Safe to call inside useMemo — pure function, no side effects.
 *
 * @param customerId  Active customer id from liveCtx or activeContext (whichever is present).
 */
export function buildActionExecutionContext(
  dispatch: (action: { type: string; payload?: unknown }) => void,
  customerId: string | null | undefined,
  customers: Customer[],
  repairs: Repair[],
  layaways: Layaway[],
  profile: CustomerBusinessProfile | null | undefined,
): ActionExecutionContext {
  const customer = customerId
    ? (customers.find((c) => c && c.id === customerId) ?? null)
    : null;

  const resolvedName = customer
    ? (customer.name || `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || null)
    : null;

  const resolvedPhone =
    customer?.phone ||
    customer?.phones?.[0] ||
    null;

  return {
    dispatch,
    customerId: customerId ?? null,
    customerName: resolvedName,
    customerPhone: resolvedPhone ?? null,
    repairs,
    layaways,
    customers,
    profile: profile ?? null,
  };
}
