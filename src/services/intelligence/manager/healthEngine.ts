// ============================================================
// Business Manager — health sections (I4 Part 5, I4.1 truth contract).
//
// TRUTH RULES:
//   • Absence of a negative finding is NEVER evidence of health.
//   • healthy requires explicit POSITIVE/STABLE evidence (its reasons cite
//     those findings).
//   • critical requires explicit critical evidence; watch requires explicit
//     risk evidence (including information-severity negatives like an
//     inactive customer or a product that stopped selling).
//   • refusal/incomplete-attribution findings → unavailable, never healthy.
//   • no applicable findings → unavailable (confidence 0).
// No synthetic findings are created; health is only ever derived from real
// I3-3 evidence.
// ============================================================

import type { InsightFinding, InsightFindingKind } from '../insights/types';
import type { BusinessAction, HealthSection, HealthSectionKey, HealthStatus } from './types';

/** Deterministic per-kind evidence classification. */
type EvidenceClass = 'negative' | 'refusal' | 'supportive';

const REFUSAL_KINDS: readonly InsightFindingKind[] = ['employee_attribution_incomplete', 'carrier_attribution_mixed'];

const NEGATIVE_KINDS: readonly InsightFindingKind[] = [
  'sales_below_rolling_average', 'margin_drop', 'large_refund_period',
  'carrier_disappeared', 'carrier_declining',
  'employee_unusually_low',
  'product_stopped_selling',
  'customer_declining', 'customer_inactive', 'customer_lost',
  'service_decline',
];

function evidenceClassOf(f: InsightFinding): EvidenceClass {
  if (REFUSAL_KINDS.includes(f.kind)) return 'refusal';
  if (NEGATIVE_KINDS.includes(f.kind)) return 'negative';
  if (f.kind === 'metric_trend') return f.data.direction === 'down' ? 'negative' : 'supportive';
  return 'supportive';
}

const SECTION_KINDS: Record<HealthSectionKey, InsightFindingKind[]> = {
  revenue: ['sales_below_rolling_average', 'large_refund_period'],
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
  for (const key of SECTION_ORDER) {
    if (SECTION_KINDS[key].includes(f.kind)) return key;
  }
  return null;
}

export function computeHealthSections(findings: InsightFinding[], actions: BusinessAction[] = []): HealthSection[] {
  const bySection = new Map<HealthSectionKey, InsightFinding[]>(SECTION_ORDER.map((k) => [k, []]));
  for (const f of findings) {
    const key = sectionOf(f);
    if (key) bySection.get(key)!.push(f);
  }
  const findingSection = new Map<string, HealthSectionKey>();
  for (const [key, fs] of bySection) for (const f of fs) findingSection.set(f.id, key);

  return SECTION_ORDER.map((key) => {
    const sectionFindings = bySection.get(key)!;   // priority-sorted upstream
    const critical = sectionFindings.filter((f) => f.severity === 'critical');
    const negatives = sectionFindings.filter((f) => evidenceClassOf(f) === 'negative');
    const refusals = sectionFindings.filter((f) => evidenceClassOf(f) === 'refusal');
    const supportive = sectionFindings.filter((f) => evidenceClassOf(f) === 'supportive' && !REFUSAL_KINDS.includes(f.kind));

    let status: HealthStatus;
    let reasons: InsightFinding[];
    if (critical.length > 0) {
      status = 'critical'; reasons = critical;
    } else if (negatives.length > 0) {
      status = 'watch'; reasons = negatives;
    } else if (refusals.length > 0) {
      // Refusal evidence can NEVER become healthy — the area is unevaluable.
      status = 'unavailable'; reasons = refusals;
    } else if (supportive.length > 0) {
      // Healthy ONLY with explicit positive/stable evidence, cited as reasons.
      status = 'healthy'; reasons = supportive;
    } else {
      // No applicable evidence at all → unavailable, never healthy-by-silence.
      status = 'unavailable'; reasons = [];
    }

    const evaluable = status !== 'unavailable';
    const relatedActionIds = actions
      .filter((a) => findingSection.get(a.relatedFindingId) === key)
      .map((a) => a.id);

    return {
      key,
      status,
      confidence: evaluable ? 1 : 0,
      evaluable,
      evidenceFindingIds: sectionFindings.map((f) => f.id),
      reasonFindingIds: reasons.map((f) => f.id),
      topPositiveFindingId: supportive[0]?.id ?? null,
      topRiskFindingId: critical[0]?.id ?? negatives[0]?.id ?? null,
      relatedActionIds,
    };
  });
}

export { REFUSAL_KINDS as HEALTH_REFUSAL_KINDS, NEGATIVE_KINDS as HEALTH_NEGATIVE_KINDS };
