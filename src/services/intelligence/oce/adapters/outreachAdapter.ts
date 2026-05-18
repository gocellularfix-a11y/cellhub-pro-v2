// R-OCE-V1 — Outreach module adapter.
// Signals: outreach_opportunity, outreach_underperforming.

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';
import { generateOutreachCampaign } from '../../outreach/generateOutreachCampaign';
import { getOutreachEffectiveness } from '../../outreach/outreachEffectiveness';

const outreachAdapter: OperationalModuleAdapter = {
  module: 'outreach',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    try {
      const campaign = generateOutreachCampaign(engine, 'en');
      const total = campaign.groups.reduce((s, g) => s + g.entries.length, 0);
      if (total > 0) {
        signals.push({
          id: 'outreach:outreach_opportunity:aggregate',
          type: 'outreach_opportunity',
          sourceModule: 'outreach',
          severity: total >= 5 ? 'high' : 'medium',
          title: `${total} outreach contact${total > 1 ? 's' : ''} ready`,
          createdAt: now,
          actionable: true,
          score: Math.min(100, 20 + total * 5),
          tags: ['campaign', 'contacts'],
          metadata: { totalContacts: total, groupCount: campaign.groups.length },
        });
      }
    } catch { /* skip */ }

    try {
      const eff = getOutreachEffectiveness(30);
      if (eff.totalSent > 0 && eff.responseRate < 0.1) {
        signals.push({
          id: 'outreach:outreach_underperforming:low_response',
          type: 'outreach_underperforming',
          sourceModule: 'outreach',
          severity: 'medium',
          title: `Outreach response rate low (${Math.round(eff.responseRate * 100)}%)`,
          createdAt: now,
          actionable: false,
          score: 40,
          tags: ['performance', 'response_rate'],
          metadata: {
            responseRate: eff.responseRate,
            conversionRate: eff.conversionRate,
            totalSent: eff.totalSent,
          },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { outreachAdapter };
