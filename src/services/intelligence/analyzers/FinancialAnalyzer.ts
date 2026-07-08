// CellHub Intelligence — Financial Analyzer
import type { Sale, Repair } from '@/store/types';
import { Insight, FinancialMetrics } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';
import { standardDeviation, zScore } from '../utils/statistics';

export interface ExpenseCategory {
  name: string;
  amount: number;
  isFixed: boolean;
}

export class FinancialAnalyzer {
  private sales: Sale[];
  private repairs: Repair[];
  private expenses: ExpenseCategory[];
  private storeId?: string;
  private lang: string;

  constructor(
    sales: Sale[],
    repairs: Repair[],
    expenses: ExpenseCategory[] = [],
    storeId?: string,
    lang: string = 'en'
  ) {
    this.sales = sales;
    this.repairs = repairs;
    this.expenses = expenses;
    this.storeId = storeId;
    this.lang = lang;
  }

  filterByStore<T extends { storeId?: string }>(items: T[]): T[] {
    if (!this.storeId) return items;
    return items.filter(item => (item as any).storeId === this.storeId);
  }

  getMetrics(window?: { start: Date; end: Date }): FinancialMetrics {
    const salesFiltered = this.filterByStore(
      window
        ? this.sales.filter(s => {
            const created = new Date(s.createdAt as string);
            return created >= window.start && created <= window.end;
          })
        : this.sales
    );

    const repairsFiltered = this.filterByStore(
      window
        ? this.repairs.filter(r => {
            const created = new Date(r.createdAt as string);
            return created >= window.start && created <= window.end;
          })
        : this.repairs
    );

    const revenue = salesFiltered.reduce((sum, s) => sum + (s.total || 0), 0);
    const repairRevenue = repairsFiltered.reduce((sum, r) => sum + (r.total || r.estimatedCost || 0), 0);
    const grossRevenue = revenue + repairRevenue;

    let totalCOGS = 0;
    for (const sale of salesFiltered) {
      for (const item of sale.items || []) {
        const cost = (item as any).cost || 0;
        totalCOGS += cost * item.qty;
      }
    }
    for (const repair of repairsFiltered) {
      totalCOGS += repair.laborCost || 0;
      for (const part of repair.parts || []) {
        totalCOGS += (part.cost || 0) * part.qty;
      }
    }

    const grossMargin = grossRevenue > 0 
      ? ((grossRevenue - totalCOGS) / grossRevenue) * 100 
      : 0;

    const totalExpenses = this.expenses.reduce((sum, e) => sum + e.amount, 0);
    const expenseRatio = grossRevenue > 0 
      ? (totalExpenses / grossRevenue) * 100 
      : 0;

    const cbeCollected = repairsFiltered.reduce((sum, r) => sum + (r.depositAmount || 0), 0);

    // Money is integer cents: 2.9% of revenue-cents + a flat 30-cent
    // ($0.30) per-transaction fee. (Previously used 0.30, which added a
    // third of a cent per sale instead of 30 cents.)
    const cardFees = revenue * 0.029 + salesFiltered.length * 30;
    const creditCardFees = Math.round(cardFees);

    const cashFlowByDay: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const day = getDaysAgo(i);
      const dayStr = day.toISOString().split('T')[0];
      const daySales = salesFiltered.filter(s => {
        const d = new Date(s.createdAt as string);
        return d.toISOString().split('T')[0] === dayStr;
      });
      cashFlowByDay[dayStr] = daySales.reduce((sum, s) => sum + (s.total || 0), 0);
    }

    return {
      grossMargin: Math.round(grossMargin * 100) / 100,
      expenseRatio: Math.round(expenseRatio * 100) / 100,
      cbeCollected,
      creditCardFees,
      cashFlowByDay,
    };
  }

  getProfitabilityByCategory(): Record<string, { revenue: number; cost: number; profit: number }> {
    const result: Record<string, { revenue: number; cost: number; profit: number }> = {};

    for (const sale of this.filterByStore(this.sales)) {
      for (const item of sale.items || []) {
        const cat = item.category || 'unknown';
        if (!result[cat]) result[cat] = { revenue: 0, cost: 0, profit: 0 };
        result[cat].revenue += (item.price || 0) * item.qty;
        result[cat].cost += ((item as any).cost || 0) * item.qty;
      }
    }

    for (const cat of Object.keys(result)) {
      result[cat].profit = result[cat].revenue - result[cat].cost;
    }

    return result;
  }

  getDailyCashFlow(days: number = 30): { date: string; inflow: number; outflow: number; net: number }[] {
    const result: { date: string; inflow: number; outflow: number; net: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const day = getDaysAgo(i);
      const dayStr = day.toISOString().split('T')[0];

      const daySales = this.sales.filter(s => {
        const d = new Date(s.createdAt as string);
        return d.toISOString().split('T')[0] === dayStr;
      });

      const inflow = daySales.reduce((sum, s) => sum + (s.total || 0), 0);
      const outflow = 0;
      const net = inflow - outflow;

      result.push({ date: dayStr, inflow, outflow, net });
    }

    return result;
  }

  getExpenseBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {};
    for (const expense of this.expenses) {
      breakdown[expense.name] = (breakdown[expense.name] || 0) + expense.amount;
    }
    return breakdown;
  }

  getMonthlyRevenue(): { month: string; revenue: number }[] {
    const result: { month: string; revenue: number }[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = monthDate.toISOString().slice(0, 7);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const monthSales = this.sales.filter(s => {
        const created = new Date(s.createdAt as string);
        return created >= monthDate && created < nextMonth;
      });

      const revenue = monthSales.reduce((sum, s) => sum + (s.total || 0), 0);
      result.push({ month: monthStr, revenue });
    }

    return result;
  }

  // R-INTEL-SMARTER-F1: statistical anomaly detection on daily revenue.
  // Computes mean + stdDev across the last N days, flags any day with
  // |z-score| ≥ 2 (≈top/bottom 2.5% under normal). Useful for "weirdness
  // detection" without hardcoded thresholds — adaptive per-shop baseline.
  //
  // Returns array sorted by absolute z-score (most anomalous first).
  // Empty if fewer than 14 days of data or stdDev is zero (flat baseline).
  getCashFlowAnomalies(windowDays: number = 30): Array<{
    date: string;
    revenue: number;
    zScore: number;
    baseline: number;
  }> {
    const salesFiltered = this.filterByStore(this.sales);

    // Daily revenue map for last `windowDays` days.
    const dailyRevenue: number[] = [];
    const dayStrings: string[] = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const day = getDaysAgo(i);
      const dayStr = day.toISOString().split('T')[0];
      dayStrings.push(dayStr);
      const daySales = salesFiltered.filter(s => {
        if (s.status === 'voided') return false;
        const d = new Date(s.createdAt as string);
        return d.toISOString().split('T')[0] === dayStr;
      });
      dailyRevenue.push(daySales.reduce((sum, s) => sum + (s.total || 0), 0));
    }

    if (dailyRevenue.length < 14) return [];

    const mean = dailyRevenue.reduce((a, b) => a + b, 0) / dailyRevenue.length;
    const stdDev = standardDeviation(dailyRevenue);
    if (stdDev === 0) return [];

    const anomalies: Array<{ date: string; revenue: number; zScore: number; baseline: number }> = [];
    for (let i = 0; i < dailyRevenue.length; i++) {
      const z = zScore(dailyRevenue[i], mean, stdDev);
      if (Math.abs(z) >= 2) {
        anomalies.push({
          date: dayStrings[i],
          revenue: dailyRevenue[i],
          zScore: z,
          baseline: Math.round(mean),
        });
      }
    }

    return anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  }

  generateInsights(window?: { start: Date; end: Date }): Insight[] {
    const insights: Insight[] = [];
    const metrics = this.getMetrics(window);
    const profitability = this.getProfitabilityByCategory();

    if (metrics.grossMargin < 20) {
      insights.push({
        id: 'financial-margin-low',
        category: 'financial',
        severity: 'critical',
        title: 'Low Gross Margin',
        titleEs: 'Margen Bruto Bajo',
        description: `Gross margin is ${metrics.grossMargin.toFixed(1)}%. Review pricing and COGS.`,
        descriptionEs: `El margen bruto es ${metrics.grossMargin.toFixed(1)}%. Revisa precios y COGS.`,
        metric: metrics.grossMargin,
        metricLabel: this.lang === 'es' ? 'Margen bruto (%)' : 'Gross margin (%)',
        actionLabel: this.lang === 'es' ? 'Ver Reporte' : 'View Report',
        actionRoute: 'reports',
        confidence: 0.9,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    if (metrics.expenseRatio > 80) {
      insights.push({
        id: 'financial-expense-high',
        category: 'financial',
        severity: 'warning',
        title: 'High Expense Ratio',
        titleEs: 'Ratio de Gastos Alto',
        description: `Expenses are ${metrics.expenseRatio.toFixed(1)}% of revenue.`,
        descriptionEs: `Los gastos son ${metrics.expenseRatio.toFixed(1)}% de los ingresos.`,
        metric: metrics.expenseRatio,
        metricLabel: this.lang === 'es' ? 'Ratio de gastos (%)' : 'Expense ratio (%)',
        actionLabel: this.lang === 'es' ? 'Ver Reporte' : 'View Report',
        actionRoute: 'reports',
        confidence: 0.85,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    const lowestCategory = Object.entries(profitability)
      .sort((a, b) => a[1].profit - b[1].profit)[0];
    if (lowestCategory && lowestCategory[1].profit < 0) {
      insights.push({
        id: 'financial-loss-category',
        category: 'financial',
        severity: 'critical',
        title: 'Loss-Making Category',
        titleEs: 'Categoría con Pérdidas',
        description: `${lowestCategory[0]} category is losing money.`,
        descriptionEs: `La categoría ${lowestCategory[0]} está perdiendo dinero.`,
        metric: lowestCategory[1].profit,
        metricLabel: this.lang === 'es' ? 'Pérdida' : 'Loss',
        actionLabel: this.lang === 'es' ? 'Ver Reporte' : 'View Report',
        actionRoute: 'reports',
        confidence: 0.9,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    if (metrics.cbeCollected > 0) {
      insights.push({
        id: 'financial-cbe',
        category: 'financial',
        severity: 'info',
        title: 'CBE Deposits Collected',
        titleEs: 'Depósitos CBE Recaudados',
        description: `$${(metrics.cbeCollected / 100).toFixed(2)} in repair deposits.`,
        descriptionEs: `$${(metrics.cbeCollected / 100).toFixed(2)} en depósitos de reparaciones.`,
        metric: metrics.cbeCollected,
        metricLabel: this.lang === 'es' ? 'Depósitos CBE' : 'CBE deposits',
        confidence: 0.95,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      });
    }

    // R-INTEL-SMARTER-F1: cash-flow anomaly insights.
    // Surfaces up to 3 most-anomalous days (|z| ≥ 2) from last 30 days.
    // "Shop talks back" — tells you when you had an unusually good/bad day
    // relative to YOUR OWN baseline (not a hardcoded threshold).
    const anomalies = this.getCashFlowAnomalies(30);
    for (const a of anomalies.slice(0, 3)) {
      const positive = a.zScore > 0;
      const revenueDollars = (a.revenue / 100).toFixed(2);
      const baselineDollars = (a.baseline / 100).toFixed(2);
      const zAbs = Math.abs(a.zScore).toFixed(1);
      const d = new Date(a.date);
      const dayLabel = d.toLocaleDateString(this.lang === 'es' ? 'es-MX' : 'en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });

      insights.push({
        id: `financial-anomaly-${a.date}`,
        category: 'financial',
        severity: positive ? 'info' : 'warning',
        title: positive ? 'Unusually Strong Day' : 'Unusually Weak Day',
        titleEs: positive ? 'Día Inusualmente Fuerte' : 'Día Inusualmente Débil',
        description: positive
          ? `${dayLabel}: $${revenueDollars} — ${zAbs}σ above your $${baselineDollars} daily baseline.`
          : `${dayLabel}: $${revenueDollars} — ${zAbs}σ below your $${baselineDollars} daily baseline.`,
        descriptionEs: positive
          ? `${dayLabel}: $${revenueDollars} — ${zAbs}σ sobre tu baseline diario de $${baselineDollars}.`
          : `${dayLabel}: $${revenueDollars} — ${zAbs}σ bajo tu baseline diario de $${baselineDollars}.`,
        metric: a.revenue,
        metricLabel: this.lang === 'es' ? 'Ingresos del día' : 'Day revenue',
        trend: positive ? 'up' : 'down',
        trendPercent: a.baseline > 0 ? ((a.revenue - a.baseline) / a.baseline) * 100 : 0,
        confidence: Math.min(0.95, Math.abs(a.zScore) / 3),
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        data: { date: a.date, zScore: a.zScore, baseline: a.baseline },
      });
    }

    return insights;
  }
}