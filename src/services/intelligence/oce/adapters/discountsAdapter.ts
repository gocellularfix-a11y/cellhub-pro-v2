// R-DISCOUNT-OCE-BRIDGE-V1 — Discount / margin-risk OCE bridge adapter.
// Delegates ALL detection to the existing detectDiscountOpportunities().
// Converts ModuleOpportunity[] → OperationalSignal[] — no duplicate logic.

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';
import type { ModuleOpportunity } from '../../moduleWideOpportunities/moduleWideOpportunityTypes';
import { detectDiscountOpportunities } from '../../moduleWideOpportunities/moduleWideOpportunityDetectors';

function oppTitle(opp: ModuleOpportunity): string {
  const [a = '', b = ''] = opp.evidence ?? [];
  if (opp.summaryKey === 'oppo.discount.employee') {
    return `${a}: ${b} discount${Number(b) !== 1 ? 's' : ''} today — review`;
  }
  // excessive: evidence = [count, avgPct]
  const count = Number(a);
  return `${count} discount${count !== 1 ? 's' : ''} today — avg ${b}% off`;
}

const discountsAdapter: OperationalModuleAdapter = {
  module: 'approvals',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    let sales: ReturnType<typeof engine.getSales>;
    try { sales = engine.getSales(); } catch { return []; }

    let opps: ModuleOpportunity[];
    try { opps = detectDiscountOpportunities(sales, now); } catch { return []; }
    if (opps.length === 0) return [];

    return opps.map((opp, i) => ({
      id: `approvals:margin_risk:discount:${opp.summaryKey ?? String(i)}`,
      type: 'margin_risk' as const,
      sourceModule: 'approvals' as const,
      severity: opp.severity === 'high' || opp.severity === 'critical' ? 'high' : 'medium',
      title: oppTitle(opp),
      createdAt: now,
      actionable: false, // no navigable entity — manager reviews sales list directly
      score: opp.severity === 'high' || opp.severity === 'critical' ? 55 : 30,
      tags: [opp.recommendedAction ?? 'margin_risk', 'discount_abuse'],
      metadata: { summaryKey: opp.summaryKey, evidence: opp.evidence },
    }));
  },
};

export { discountsAdapter };
