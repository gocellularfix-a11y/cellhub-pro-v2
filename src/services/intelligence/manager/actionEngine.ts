// ============================================================
// Business Manager — action engine (I4 Part 3).
//
// Deterministic finding → action mapping. Typed, prioritized, no text (the
// presenter renders localized wording). An action exists ONLY because a
// finding exists — nothing invented.
// ============================================================

import type { InsightFinding } from '../insights/types';
import type { BusinessAction, BusinessActionKind, BusinessActionPriority } from './types';

const PRIORITY_RANK: Record<BusinessActionPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface ActionRule { kind: BusinessActionKind; priority: BusinessActionPriority }

/** The deterministic finding-kind → action rule table. */
const ACTION_RULES: Partial<Record<InsightFinding['kind'], ActionRule>> = {
  product_stopped_selling: { kind: 'review_inventory_pricing', priority: 'medium' },
  carrier_declining: { kind: 'compare_carrier_previous_period', priority: 'medium' },
  carrier_disappeared: { kind: 'compare_carrier_previous_period', priority: 'high' },
  customer_lost: { kind: 'contact_customer', priority: 'high' },
  customer_declining: { kind: 'contact_customer', priority: 'medium' },
  customer_inactive: { kind: 'contact_customer', priority: 'low' },
  service_decline: { kind: 'review_service_promotion', priority: 'medium' },
  margin_drop: { kind: 'review_pricing_and_costs', priority: 'high' },
  sales_below_rolling_average: { kind: 'review_day_operations', priority: 'critical' },
  large_refund_period: { kind: 'review_refunds', priority: 'high' },
  employee_unusually_low: { kind: 'review_employee_activity', priority: 'low' },
  customer_returning_after_absence: { kind: 'thank_returning_customer', priority: 'low' },
  carrier_fastest_growing: { kind: 'lean_into_carrier_growth', priority: 'low' },
};

export function actionsForFindings(findings: InsightFinding[]): BusinessAction[] {
  const actions: BusinessAction[] = [];
  for (const f of findings) {
    const rule = ACTION_RULES[f.kind];
    if (!rule) continue;
    actions.push({
      id: `${rule.kind}:${f.id}`,
      kind: rule.kind,
      priority: rule.priority,
      status: 'created',
      relatedFindingId: f.id,
      createdYMD: f.dateRange.endYMD,
      data: { ...f.data },
    });
  }
  // Deterministic order: priority rank → related finding magnitude is already
  // encoded in the findings order (they arrive priority-sorted) → id asc.
  return actions.sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id));
}

export { PRIORITY_RANK as ACTION_PRIORITY_RANK };
