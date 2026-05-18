// R-OCE-V1 — Customers module adapter.
// Signals: vip_customer, inactive_customer, sale_opportunity, payment_due.

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';
import { getCustomersMostLikelyToBuyToday } from '../../opportunities/buyTodayRanking';

const customersAdapter: OperationalModuleAdapter = {
  module: 'customers',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    try {
      const candidates = getCustomersMostLikelyToBuyToday(engine, 'en');
      for (const c of candidates) {
        const type =
          c.opportunityType === 'vip_outreach'
            ? 'vip_customer'
            : c.opportunityType === 'inactive_high_value'
              ? 'inactive_customer'
              : c.opportunityType === 'payment_due'
                ? 'payment_due'
                : 'sale_opportunity';

        const severity =
          c.urgencyLevel === 'urgent' ? 'critical'
          : c.urgencyLevel === 'active' ? 'high'
          : 'medium';

        signals.push({
          id: `customers:${type}:${c.customerId}`,
          type,
          sourceModule: 'customers',
          severity,
          title: `${c.customerName} — ${c.opportunityType}`,
          entityId: c.customerId,
          entityType: 'customer',
          customerId: c.customerId,
          createdAt: now,
          actionable: Boolean(c.phone),
          actionTarget: c.repairId ? 'open_repair' : 'open_customer',
          score: c.score,
          tags: c.reasons.slice(0, 3),
          metadata: {
            opportunityType: c.opportunityType,
            phone: c.phone,
            repairId: c.repairId,
          },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { customersAdapter };
