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

/** Deterministic per-kind evidence classification (I4.1.1: explicit
 *  allowlists; UNKNOWN kinds are NEUTRAL, never supportive). */
type EvidenceClass = 'refusal' | 'negative' | 'supportive' | 'neutral';

const REFUSAL_KINDS: readonly InsightFindingKind[] = ['employee_attribution_incomplete', 'carrier_attribution_mixed'];

const NEGATIVE_KINDS: readonly InsightFindingKind[] = [
  'sales_below_rolling_average', 'margin_drop', 'large_refund_period',
  'carrier_disappeared', 'carrier_declining',
  'employee_unusually_low',
  'product_stopped_selling',
  'customer_declining', 'customer_inactive', 'customer_lost',
  'service_decline',
  'top_negative_contributor',
];

/** EXPLICIT supportive allowlist — only findings whose defined semantics
 *  genuinely prove positive/stable health. Opportunity, informational,
 *  share/composition, contributor and unknown kinds are NOT here: they are
 *  neutral and can never produce healthy. */
const SUPPORTIVE_KINDS: readonly InsightFindingKind[] = [
  'customer_high_value', 'customer_frequent',
  'employee_best_revenue', 'employee_best_profit', 'employee_best_margin',
  'employee_most_repairs', 'employee_most_unlocks', 'employee_highest_avg_ticket',
  'carrier_highest_profit', 'carrier_highest_revenue', 'carrier_highest_transactions',
  'service_growth',
];

function evidenceClassOf(f: InsightFinding): EvidenceClass {
  if (REFUSAL_KINDS.includes(f.kind)) return 'refusal';
  if (NEGATIVE_KINDS.includes(f.kind)) return 'negative';
  // Up/flat trends are stable evidence for their mapped section; down is risk.
  if (f.kind === 'metric_trend') return f.data.direction === 'down' ? 'negative' : 'supportive';
  if (SUPPORTIVE_KINDS.includes(f.kind)) return 'supportive';
  return 'neutral';   // opportunity/informational/share/unknown → insufficient
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
    const refusals = sectionFindings.filter((f) => evidenceClassOf(f) === 'refusal');
    const critical = sectionFindings.filter((f) => f.severity === 'critical' && evidenceClassOf(f) !== 'refusal');
    const negatives = sectionFindings.filter((f) => evidenceClassOf(f) === 'negative');
    const supportive = sectionFindings.filter((f) => evidenceClassOf(f) === 'supportive');

    let status: HealthStatus;
    let reasons: InsightFinding[];
    // I4.1.1 PRECEDENCE: refusal/incomplete-attribution evidence means the
    // section CANNOT be truthfully evaluated — unavailable wins over any
    // apparent critical/warning/positive evidence in the same section.
    if (refusals.length > 0) {
      status = 'unavailable'; reasons = refusals;
    } else if (critical.length > 0) {
      status = 'critical'; reasons = critical;
    } else if (negatives.length > 0) {
      status = 'watch'; reasons = negatives;
    } else if (supportive.length > 0) {
      // Healthy ONLY with explicitly allowlisted positive/stable evidence.
      // Neutral evidence (opportunity/informational/share/unknown) is
      // insufficient and never produces healthy.
      status = 'healthy'; reasons = supportive;
    } else {
      // Neutral-only or no evidence → unavailable, never healthy-by-silence.
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
