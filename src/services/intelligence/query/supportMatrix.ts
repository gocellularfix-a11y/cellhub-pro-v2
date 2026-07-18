// ============================================================
// Structured Query Executor — typed support matrix (I3-2 Part J).
//
// The authoritative metric/dimension support declaration. The executor
// ENFORCES these outcomes (mixed-carrier and employee-attribution conditions
// are checked at execution time); this module makes the contract typed,
// exported and test-checkable.
// ============================================================

import type { BusinessDimension, BusinessMetric } from '../language/types';
import type { SupportLevel } from './types';

export interface SupportEntry {
  level: SupportLevel;
  /** Present for exact_supported_with_condition — the runtime condition the
   *  executor enforces (typed reasons fire when it does not hold). */
  condition?: string;
}

const FINANCIAL_METRICS: readonly BusinessMetric[] = [
  'gross_sales', 'net_sales', 'returns', 'cost', 'profit', 'margin',
  'gross_tax', 'net_tax', 'cash', 'card', 'store_credit', 'transaction_count', 'average_ticket',
];

const CARRIER_CONDITION = 'exact only when every carrier-touching sale in the range is purely attributable to a single carrier (no mixed-carrier or carrier+unattributed-item sales); otherwise mixed_carrier_attribution';
const EMPLOYEE_CONDITION = 'exact only when every completed service record in the range carries employee attribution; otherwise employee_attribution_incomplete';

/** Support level for a metric × dimension pair (dimension undefined = whole store). */
export function getSupportLevel(metric: BusinessMetric, dimension?: BusinessDimension): SupportEntry {
  if (!dimension) {
    if (FINANCIAL_METRICS.includes(metric)) return { level: 'exact_supported' };
    return { level: 'unsupported_exactness' };   // customer metrics need a customer scope
  }
  switch (dimension) {
    case 'carrier':
      if (FINANCIAL_METRICS.includes(metric)) return { level: 'exact_supported_with_condition', condition: CARRIER_CONDITION };
      return { level: 'unsupported_exactness' };
    case 'employee':
      if (FINANCIAL_METRICS.includes(metric)) return { level: 'exact_supported_with_condition', condition: EMPLOYEE_CONDITION };
      return { level: 'unsupported_exactness' };
    case 'payment_provider':
      if (metric === 'gross_sales' || metric === 'profit' || metric === 'transaction_count') return { level: 'exact_supported' };
      return { level: 'unsupported_exactness' };
    case 'category':
      if (metric === 'gross_sales' || metric === 'cost' || metric === 'profit' || metric === 'margin') return { level: 'exact_supported' };
      return { level: 'unsupported_exactness' };
    case 'product':
      if (metric === 'gross_sales') return { level: 'exact_supported' };
      return { level: 'unsupported_exactness' };
    case 'customer':
      if (['total_collected', 'commissionable_revenue', 'customer_profit', 'customer_margin',
        'transaction_count', 'average_ticket', 'gross_sales', 'profit', 'margin'].includes(metric)) {
        return { level: 'exact_supported' };   // canonical customer profiles
      }
      return { level: 'unsupported_exactness' };
    case 'store':
      // Only the active-store snapshot exists in this context.
      return { level: 'unavailable_context' };
    case 'service':
    case 'payment_method':
      return { level: 'unsupported_exactness' };
    default:
      return { level: 'unsupported_exactness' };
  }
}
