// CellHub Intelligence — Customer Analyzer
import type { Customer, Sale } from '@/store/types';
import { Insight, CustomerMetrics } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';
import { percentile } from '../utils/statistics';

export class CustomerAnalyzer {
  private customers: Customer[];
  private sales: Sale[];
  private storeId?: string;
  private lang: string;

  constructor(customers: Customer[], sales: Sale[], storeId?: string, lang: string = 'en') {
    this.customers = customers;
    this.sales = sales;
    this.storeId = storeId;
    this.lang = lang;
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

    let totalLTV = 0;
    const customerSales: Record<string, number> = {};
    for (const sale of this.sales) {
      if (!sale.customerId) continue;
      customerSales[sale.customerId] = (customerSales[sale.customerId] || 0) + (sale.total || 0);
    }
    for (const ltv of Object.values(customerSales)) {
      totalLTV += ltv;
    }
    const avgLTV = Object.keys(customerSales).length > 0 ? totalLTV / Object.keys(customerSales).length : 0;

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
      const customerTotal: Record<string, number> = {};
      for (const sale of this.sales) {
        if (!sale.customerId) continue;
        customerTotal[sale.customerId] = (customerTotal[sale.customerId] || 0) + (sale.total || 0);
      }
      return filtered
        .sort((a, b) => (customerTotal[b.id] || 0) - (customerTotal[a.id] || 0))
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
    const ltv: Record<string, number> = {};
    for (const sale of this.sales) {
      if (!sale.customerId) continue;
      ltv[sale.customerId] = (ltv[sale.customerId] || 0) + (sale.total || 0);
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