// CellHub Intelligence — Customer Analyzer
import type { Customer, Sale } from '@/store/types';
import { Insight, CustomerMetrics, NextVisitPrediction } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';
import { percentile } from '../utils/statistics';
import type { CustomerMoneyProfile } from '@/services/customers/customerMoneyProfile';

/** I2B-2: lazy provider of canonical per-customer money profiles (batched).
 *  The engine supplies this so the analyzer's monetary methods share the
 *  SAME canonical Total Collected / profit / margin the customer list and
 *  Customer 360 use — never a legacy sum(sale.total) reduce. Optional so
 *  standalone/test construction still works (falls back to gross sale.total
 *  ONLY when no provider is given). */
export type CustomerValueProfileProvider = () => Map<string, CustomerMoneyProfile>;

export class CustomerAnalyzer {
  private customers: Customer[];
  private sales: Sale[];
  private storeId?: string;
  private lang: string;
  private getValueProfiles?: CustomerValueProfileProvider;

  constructor(
    customers: Customer[],
    sales: Sale[],
    storeId?: string,
    lang: string = 'en',
    getValueProfiles?: CustomerValueProfileProvider,
  ) {
    this.customers = customers;
    this.sales = sales;
    this.storeId = storeId;
    this.lang = lang;
    this.getValueProfiles = getValueProfiles;
  }

  // I2B-2: canonical Total Collected per customer, returns-aware and
  // attribution-correct (id → linkage → phone). Falls back to the legacy
  // customerId-only gross reduce ONLY when no canonical provider is wired
  // (keeps standalone/test construction working).
  private collectedByCustomer(): Map<string, number> {
    if (this.getValueProfiles) {
      const profiles = this.getValueProfiles();
      const out = new Map<string, number>();
      for (const c of this.filterByStore(this.customers)) {
        out.set(c.id, profiles.get(c.id)?.totalCollectedCents ?? 0);
      }
      return out;
    }
    const legacy = new Map<string, number>();
    for (const sale of this.sales) {
      if (!sale.customerId) continue;
      legacy.set(sale.customerId, (legacy.get(sale.customerId) || 0) + (sale.total || 0));
    }
    return legacy;
  }

  filterByStore<T extends { storeId?: string }>(items: T[]): T[] {
    if (!this.storeId) return items;
    return items.filter(item => (item as any).storeId === this.storeId);
  }

  getMetrics(window?: { start: Date; end: Date }): CustomerMetrics {
    const filtered = this.filterByStore(this.customers);
    const totalCustomers = filtered.length;

    const cutoff = getDaysAgo(30);
    const recentCustomers = filtered.filter(c => {
      const created = new Date((c as any).createdAt as string);
      return created >= cutoff;
    });

    const recentSales = this.sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= cutoff;
    });
    const recentCustomerIds = new Set(recentSales.map(s => s.customerId).filter(Boolean));

    const repeatCustomers = filtered.filter(c => {
      const customerSales = this.sales.filter(s => s.customerId === c.id);
      return customerSales.length > 1;
    });

    const lowBalance = filtered.filter(c => c.storeCredit < 0);
    const noActivity = filtered.filter(c => {
      const lastSale = this.sales
        .filter(s => s.customerId === c.id)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())[0];
      if (!lastSale) return true;
      return new Date(lastSale.createdAt as string) < getDaysAgo(90);
    });

    // I2B-2: LTV = canonical Total Collected per customer (returns-aware),
    // averaged over customers with any collected activity — no longer a raw
    // sum(sale.total) that ignored returns and phone-linked attribution.
    const collected = this.collectedByCustomer();
    let totalLTV = 0;
    let ltvCustomerCount = 0;
    for (const value of collected.values()) {
      if (value === 0) continue;   // no activity → not part of the average
      totalLTV += value;
      ltvCustomerCount++;
    }
    const avgLTV = ltvCustomerCount > 0 ? totalLTV / ltvCustomerCount : 0;

    return {
      totalCustomers,
      newCustomers: recentCustomers.length,
      returningCustomers: repeatCustomers.length,
      churnRiskCount: noActivity.length,
      vipCount: filtered.filter(c => c.loyaltyPoints >= 500).length,
      avgLTV,
    };
  }

  getTopCustomers(by: 'spend' | 'visits' | 'points' = 'spend', count: number = 10): Customer[] {
    const filtered = this.filterByStore(this.customers);

    if (by === 'spend') {
      // I2B-2: rank by canonical Total Collected (returns-aware,
      // attribution-correct). Deterministic tie-break by id.
      const collected = this.collectedByCustomer();
      return filtered
        .slice()
        .sort((a, b) =>
          ((collected.get(b.id) || 0) - (collected.get(a.id) || 0)) || a.id.localeCompare(b.id))
        .slice(0, count);
    }

    if (by === 'visits') {
      const visitCount: Record<string, number> = {};
      for (const sale of this.sales) {
        if (!sale.customerId) continue;
        visitCount[sale.customerId] = (visitCount[sale.customerId] || 0) + 1;
      }
      return filtered
        .sort((a, b) => (visitCount[b.id] || 0) - (visitCount[a.id] || 0))
        .slice(0, count);
    }

    return filtered.sort((a, b) => b.loyaltyPoints - a.loyaltyPoints).slice(0, count);
  }

  getCustomerLifetimeValue(): Record<string, number> {
    // I2B-2: canonical Total Collected per customer (returns-aware,
    // attribution-correct) — same value the Customer 360 card shows.
    const ltv: Record<string, number> = {};
    for (const [id, value] of this.collectedByCustomer()) {
      if (value !== 0) ltv[id] = value;
    }
    return ltv;
  }

  getAtRiskCustomers(): Customer[] {
    const cutoff = getDaysAgo(90);
    return this.filterByStore(this.customers).filter(c => {
      const lastSale = this.sales
        .filter(s => s.customerId === c.id)
        .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())[0];
      if (!lastSale) return true;
      return new Date(lastSale.createdAt as string) < cutoff;
    });
  }

  getVIPs(threshold: number = 500): Customer[] {
    return this.filterByStore(this.customers)
      .filter(c => c.loyaltyPoints >= threshold)
      .sort((a, b) => b.loyaltyPoints - a.loyaltyPoints);
  }

  getCarrierDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const customer of this.filterByStore(this.customers)) {
      const carrier = customer.carrier || 'unknown';
      dist[carrier] = (dist[carrier] || 0) + 1;
    }
    return dist;
  }

  // R-INTEL-2-CONTACT: predict next expected visit per customer and return
  // overdue customers sorted by urgency. Requires visitCount >= 2 to have
  // a meaningful cadence. Confidence grows with visit history (capped at 5).
  getNextVisitPredictions(topN: number = 10): NextVisitPrediction[] {
    const today = Date.now();
    const result: NextVisitPrediction[] = [];

    for (const customer of this.filterByStore(this.customers)) {
      const customerSales = this.sales
        .filter(s => s.customerId === customer.id && s.status !== 'voided')
        .map(s => new Date(s.createdAt as string).getTime())
        .filter(t => !Number.isNaN(t))
        .sort((a, b) => a - b);

      if (customerSales.length < 2) continue;

      const visitCount = customerSales.length;
      const lastVisitMs = customerSales[customerSales.length - 1];

      // Avg gap between consecutive visits (ms → days).
      let totalGapMs = 0;
      for (let i = 1; i < customerSales.length; i++) {
        totalGapMs += customerSales[i] - customerSales[i - 1];
      }
      const avgDaysBetweenVisits = totalGapMs / (visitCount - 1) / (1000 * 60 * 60 * 24);

      if (avgDaysBetweenVisits <= 0) continue;

      const predictedNextVisitMs = lastVisitMs + avgDaysBetweenVisits * 24 * 60 * 60 * 1000;
      const overdueByDays = (today - predictedNextVisitMs) / (1000 * 60 * 60 * 24);

      if (overdueByDays <= 0) continue;  // not yet due

      const urgencyScore = overdueByDays / avgDaysBetweenVisits;
      const confidence = Math.min(visitCount / 5, 1);

      result.push({
        customerId: customer.id,
        name: customer.name,
        phone: customer.phone,
        lastVisit: new Date(lastVisitMs),
        avgDaysBetweenVisits: Math.round(avgDaysBetweenVisits),
        predictedNextVisit: new Date(predictedNextVisitMs),
        overdueByDays: Math.round(overdueByDays),
        urgencyScore,
        confidence,
      });
    }

    return result
      .sort((a, b) => b.urgencyScore - a.urgencyScore)
      .slice(0, topN);
  }

  generateInsights(window?: { start: Date; end: Date }): Insight[] {
    const insights: Insight[] = [];
    const metrics = this.getMetrics(window);
    const atRisk = this.getAtRiskCustomers();
    const vips = this.getVIPs();

    if (atRisk.length > 5) {
      insights.push({
        id: 'customer-churn-risk',
        category: 'customers',
        severity: 'warning',
        title: 'Customers At Risk',
        titleEs: 'Clientes en Riesgo',
        description: `${atRisk.length} customers have no activity in 90+ days.`,
        descriptionEs: `${atRisk.length} clientes sin actividad en 90+ días.`,
        metric: atRisk.length,
        metricLabel: this.lang === 'es' ? 'Clientes en riesgo' : 'At-risk customers',
        actionLabel: this.lang === 'es' ? 'Ver Clientes' : 'View Customers',
        actionRoute: 'customers',
        confidence: 0.85,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    if (vips.length > 0) {
      insights.push({
        id: 'customer-vip',
        category: 'customers',
        severity: 'info',
        title: 'VIP Customers',
        titleEs: 'Clientes VIP',
        description: `${vips.length} customers with 500+ loyalty points.`,
        descriptionEs: `${vips.length} clientes con 500+ puntos de lealtad.`,
        metric: vips.length,
        metricLabel: this.lang === 'es' ? 'Clientes VIP' : 'VIP customers',
        actionLabel: this.lang === 'es' ? 'Ver Clientes' : 'View Customers',
        actionRoute: 'customers',
        confidence: 0.95,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    if (metrics.newCustomers > 0) {
      const growthRate = metrics.totalCustomers > 0 
        ? (metrics.newCustomers / metrics.totalCustomers) * 100 
        : 0;
      insights.push({
        id: 'customer-new',
        category: 'customers',
        severity: 'info',
        title: 'New Customer Acquisition',
        titleEs: 'Adquisición de Nuevos Clientes',
        description: `${metrics.newCustomers} new customers in last 30 days (${growthRate.toFixed(1)}% growth).`,
        descriptionEs: `${metrics.newCustomers} nuevos clientes en últimos 30 días (${growthRate.toFixed(1)}% crecimiento).`,
        metric: metrics.newCustomers,
        metricLabel: this.lang === 'es' ? 'Nuevos clientes' : 'New customers',
        confidence: 0.9,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    const carrierDist = this.getCarrierDistribution();
    const topCarrier = Object.entries(carrierDist)
      .sort((a, b) => b[1] - a[1])[0];
    if (topCarrier && topCarrier[1] > metrics.totalCustomers * 0.5) {
      insights.push({
        id: 'customer-carrier-concentration',
        category: 'customers',
        severity: 'opportunity',
        title: 'Carrier Concentration Risk',
        titleEs: 'Riesgo de Concentración de Carrier',
        description: `${topCarrier[0]} represents >50% of customers. Consider diversification.`,
        descriptionEs: `${topCarrier[0]} representa >50% de clientes. Considera diversificación.`,
        metric: topCarrier[1],
        metricLabel: this.lang === 'es' ? 'Clientes del carrier' : 'Carrier customers',
        confidence: 0.8,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
    }

    return insights;
  }
}