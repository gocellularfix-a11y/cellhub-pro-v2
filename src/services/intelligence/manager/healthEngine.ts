// ============================================================
// Business Manager — health sections (I4 Part 5).
//
// Independent per-area health with EXACT reasons (the finding ids that drove
// the status). Deterministic mapping: any critical finding in the section →
// critical; any warning → watch; otherwise healthy.
// ============================================================

import type { InsightFinding, InsightFindingKind } from '../insights/types';
import type { HealthSection, HealthSectionKey, HealthStatus } from './types';

/** Which finding kinds belong to which health section. metric_trend findings
 *  route by their metric. */
const SECTION_KINDS: Record<HealthSectionKey, InsightFindingKind[]> = {
  revenue: ['sales_below_rolling_average'],
  profit: [],
  margin: ['margin_drop'],
  customers: ['customer_high_value', 'customer_frequent', 'customer_returning_after_absence', 'customer_declining', 'customer_inactive', 'customer_lost'],
  employees: ['employee_best_revenue', 'employee_best_profit', 'employee_best_margin', 'employee_most_repairs', 'employee_most_unlocks', 'employee_highest_avg_ticket', 'employee_attribution_incomplete', 'employee_unusually_low'],
  inventory: ['product_stopped_selling'],
  services: ['service_growth', 'service_decline', 'service_share'],
  carriers: ['carrier_fastest_growing', 'carrier_declining', 'carrier_highest_profit', 'carrier_highest_revenue', 'carrier_highest_transactions', 'carrier_attribution_mixed', 'carrier_disappeared'],
};

const SECTION_ORDER: HealthSectionKey[] = ['revenue', 'profit', 'margin', 'customers', 'employees', 'inventory', 'services', 'carriers'];

function sectionOf(f: InsightFinding): HealthSectionKey | null {
  if (f.kind === 'metric_trend') {
    if (f.data.metric === 'gross_sales') return 'revenue';
    if (f.data.metric === 'profit') return 'profit';
    if (f.data.metric === 'margin') return 'margin';
    return null;
  }
  if (f.kind === 'large_refund_period') return 'revenue';
  for (const key of SECTION_ORDER) {
    if (SECTION_KINDS[key].includes(f.kind)) return key;
  }
  return null;
}

export function computeHealthSections(findings: InsightFinding[]): HealthSection[] {
  const bySection = new Map<HealthSectionKey, InsightFinding[]>(SECTION_ORDER.map((k) => [k, []]));
  for (const f of findings) {
    const key = sectionOf(f);
    if (key) bySection.get(key)!.push(f);
  }
  return SECTION_ORDER.map((key) => {
    const sectionFindings = bySection.get(key)!;
    let status: HealthStatus = 'healthy';
    // Any critical → critical; any warning → watch. Reasons = the findings
    // that drove the (non-healthy) status; healthy keeps no reasons.
    const critical = sectionFindings.filter((f) => f.severity === 'critical');
    const warning = sectionFindings.filter((f) => f.severity === 'warning');
    let reasons: InsightFinding[] = [];
    if (critical.length > 0) { status = 'critical'; reasons = [...critical, ...warning]; }
    else if (warning.length > 0) { status = 'watch'; reasons = warning; }
    return { key, status, reasonFindingIds: reasons.map((f) => f.id) };
  });
}
