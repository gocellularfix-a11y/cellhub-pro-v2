// R-OCE-COVERAGE-V1 — Phone Payments module adapter.
// Phone payments are sale line items with type='phone_payment'.
// Signal: outreach_opportunity for customers whose last phone payment was 25+ days ago
// (likely due for their next billing cycle).

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

const MS_PER_DAY = 86_400_000;
const CYCLE_DAYS = 25;       // minimum days since last payment to flag as due
const MAX_SIGNALS = 5;       // cap per refresh to avoid signal flood
const LOOKBACK_DAYS = 90;    // only consider sales within 90 days

const phonePaymentsAdapter: OperationalModuleAdapter = {
  module: 'phone_payments',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    try {
      const sales = engine.getSales();
      const cutoff = now - LOOKBACK_DAYS * MS_PER_DAY;

      // Map: customerId → { name, phone, lastPaymentTs }
      const lastPayment = new Map<string, { name: string; phone: string; ts: number }>();

      for (const sale of sales) {
        if (!sale.customerId) continue;
        const status = String((sale as { status?: string }).status ?? '').toLowerCase();
        if (status === 'voided' || status === 'refunded') continue;

        // Check if any item is a phone_payment type
        const hasPhonePayment = (sale.items ?? []).some(
          (item) => String((item as { type?: string }).type ?? '') === 'phone_payment',
        );
        if (!hasPhonePayment) continue;

        let ts = 0;
        try {
          const ca = (sale as { createdAt?: unknown }).createdAt;
          if (ca) {
            ts = typeof (ca as { toDate?: () => Date }).toDate === 'function'
              ? (ca as { toDate: () => Date }).toDate().getTime()
              : new Date(ca as string | Date).getTime();
          }
        } catch { /* skip */ }

        if (!ts || ts < cutoff) continue;

        const existing = lastPayment.get(sale.customerId);
        if (!existing || ts > existing.ts) {
          lastPayment.set(sale.customerId, {
            name: String((sale as { customerName?: string }).customerName ?? sale.customerId),
            phone: String((sale as { customerPhone?: string }).customerPhone ?? ''),
            ts,
          });
        }
      }

      // Emit outreach_opportunity for customers due for next cycle
      let emitted = 0;
      for (const [customerId, info] of lastPayment) {
        if (emitted >= MAX_SIGNALS) break;
        const daysSince = Math.floor((now - info.ts) / MS_PER_DAY);
        if (daysSince < CYCLE_DAYS) continue;

        signals.push({
          id: `phone_payments:outreach_opportunity:${customerId}`,
          type: 'outreach_opportunity',
          sourceModule: 'phone_payments',
          severity: daysSince >= 35 ? 'medium' : 'low',
          title: `${info.name} — phone payment likely due (${daysSince}d ago)`,
          entityId: customerId,
          entityType: 'customer',
          customerId,
          createdAt: now,
          actionable: Boolean(info.phone),
          actionTarget: 'open_customer',
          score: Math.min(100, 20 + Math.min(daysSince, 30)),
          tags: ['phone_payment', 'outreach'],
          metadata: { daysSince, phone: info.phone },
        });
        emitted++;
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { phonePaymentsAdapter };
