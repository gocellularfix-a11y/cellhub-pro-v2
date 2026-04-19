// CellHub Intelligence — Customer Scorer
import type { Customer, Sale } from '@/store/types';
import { getDaysAgo } from '../utils/dateHelpers';
import { percentile, movingAverage } from '../utils/statistics';

export interface CustomerScore {
  customerId: string;
  score: number;
  tier: 'platinum' | 'gold' | 'silver' | 'bronze' | 'standard';
  loyaltyScore: number;
  engagementScore: number;
  valueScore: number;
  riskScore: number;
  factors: string[];
}

export class CustomerScorer {
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

  private filterByStore<T extends { storeId?: string }>(items: T[]): T[] {
    if (!this.storeId) return items;
    return items.filter(item => (item as any).storeId === this.storeId);
  }

  calculateScore(customer: Customer): CustomerScore {
    const customerSales = this.sales.filter(s => s.customerId === customer.id);
    const loyaltyScore = this.calculateLoyaltyScore(customer, customerSales);
    const engagementScore = this.calculateEngagementScore(customer, customerSales);
    const valueScore = this.calculateValueScore(customer, customerSales);
    const riskScore = this.calculateRiskScore(customer, customerSales);

    const totalScore = (loyaltyScore * 0.3 + engagementScore * 0.3 + valueScore * 0.25 + riskScore * 0.15);

    const tiers: Array<{ tier: CustomerScore['tier']; min: number }> = [
      { tier: 'platinum', min: 80 },
      { tier: 'gold', min: 60 },
      { tier: 'silver', min: 40 },
      { tier: 'bronze', min: 20 },
      { tier: 'standard', min: 0 },
    ];

    const tier = tiers.find(t => totalScore >= t.min)?.tier || 'standard';

    const factors: string[] = [];
    if (loyaltyScore >= 50) factors.push(this.lang === 'es' ? 'Alta lealtad' : 'High loyalty');
    if (valueScore >= 60) factors.push(this.lang === 'es' ? 'Alto valor' : 'High value');
    if (engagementScore >= 50) factors.push(this.lang === 'es' ? 'Alto engagement' : 'High engagement');
    if (riskScore > 50) factors.push(this.lang === 'es' ? 'Riesgo de cancelación' : 'Churn risk');

    return {
      customerId: customer.id,
      score: Math.round(totalScore),
      tier,
      loyaltyScore,
      engagementScore,
      valueScore,
      riskScore,
      factors,
    };
  }

  private calculateLoyaltyScore(customer: Customer, sales: Sale[]): number {
    let score = 0;

    score += Math.min(customer.loyaltyPoints / 10, 40);

    if (customer.referralCode && customer.referredBy) score += 20;

    const recentReferrals = this.customers.filter(c => c.referredBy === customer.referralCode).length;
    score += Math.min(recentReferrals * 5, 15);

    if (customer.storeCredit > 0) score += 10;

    return Math.min(score, 100);
  }

  private calculateEngagementScore(customer: Customer, sales: Sale[]): number {
    let score = 0;

    const now = getDaysAgo(0);
    const last30 = getDaysAgo(30);
    const last90 = getDaysAgo(90);

    const recentSales = sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= last30;
    });
    const olderSales = sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= last90 && created < last30;
    });

    if (recentSales.length > 0) {
      if (recentSales.length >= 3) score += 30;
      else score += recentSales.length * 10;

      if (olderSales.length > 0 && recentSales.length > olderSales.length) score += 15;
      else if (olderSales.length === 0 && recentSales.length > 0) score += 10;
    }

    if (customer.phones && customer.phones.length > 1) score += 5;
    if (customer.email) score += 5;
    if (customer.smsConsent) score += 5;

    return Math.min(score, 100);
  }

  private calculateValueScore(customer: Customer, sales: Sale[]): number {
    let score = 0;

    const totalSpent = sales.reduce((sum, s) => sum + (s.total || 0), 0);
    const avgSpent = sales.length > 0 ? totalSpent / sales.length : 0;

    if (totalSpent >= 50000) score += 40;
    else if (totalSpent >= 20000) score += 30;
    else if (totalSpent >= 10000) score += 20;
    else if (totalSpent >= 5000) score += 10;
    else if (totalSpent > 0) score += 5;

    if (avgSpent >= 10000) score += 20;
    else if (avgSpent >= 5000) score += 15;
    else if (avgSpent >= 2000) score += 10;
    else if (avgSpent > 0) score += 5;

    if (sales.length >= 10) score += 20;
    else if (sales.length >= 5) score += 15;
    else if (sales.length >= 2) score += 10;
    else if (sales.length === 1) score += 5;

    if (customer.carrier2) score += 5;

    return Math.min(score, 100);
  }

  private calculateRiskScore(customer: Customer, sales: Sale[]): number {
    let score = 0;

    const cutoff90 = getDaysAgo(90);
    const cutoff180 = getDaysAgo(180);

    const recentSales = sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= cutoff90;
    });

    if (recentSales.length === 0) {
      const oldestSale = sales.sort((a, b) => 
        new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime()
      )[0];

      if (oldestSale) {
        const daysSince = (Date.now() - new Date(oldestSale.createdAt as string).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince >= 180) score += 80;
        else if (daysSince >= 90) score += 50;
        else score += 20;
      } else {
        score += 100;
      }
    } else {
      const lastPurchase = sales.sort((a, b) => 
        new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime()
      )[0];
      const daysSinceLast = (Date.now() - new Date(lastPurchase.createdAt as string).getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceLast >= 90) score += 60;
      else if (daysSinceLast >= 60) score += 40;
      else if (daysSinceLast >= 30) score += 20;
      else score += 10;
    }

    if (customer.storeCredit < 0) score += 15;

    return Math.min(score, 100);
  }

  scoreAll(): CustomerScore[] {
    const filtered = this.filterByStore(this.customers);
    return filtered.map(c => this.calculateScore(c)).sort((a, b) => b.score - a.score);
  }

  getTopCustomers(count: number = 10): CustomerScore[] {
    return this.scoreAll().slice(0, count);
  }

  getAtRiskCustomers(): CustomerScore[] {
    return this.scoreAll().filter(s => s.riskScore > 50);
  }

  getDistribution(): Record<CustomerScore['tier'], number> {
    const all = this.scoreAll();
    const dist: Record<string, number> = {};
    for (const score of all) {
      dist[score.tier] = (dist[score.tier] || 0) + 1;
    }
    return dist as Record<CustomerScore['tier'], number>;
  }
}