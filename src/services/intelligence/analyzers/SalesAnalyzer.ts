// CellHub Intelligence — Sales Analyzer
import type { Sale, Customer } from '@/store/types';
import { Insight, SalesMetrics, AnalysisWindow } from '../types';
import { movingAverage, calculateGrowthRate, percentile } from '../utils/statistics';
import { getWeekBoundaries, getDaysAgo } from '../utils/dateHelpers';
import { formatCurrency } from '@/utils/currency';

export class SalesAnalyzer {
  private sales: Sale[];
  private customers: Customer[];
  private storeId?: string;
  private lang: string;

  constructor(sales: Sale[], customers: Customer[], storeId?: string, lang: string = 'en') {
    this.sales = sales;
    this.customers = customers;
    this.storeId = storeId;
    this.lang = lang;
  }

  filterByWindow(window: AnalysisWindow): Sale[] {
    return this.sales.filter(s => {
      const created = new Date(s.createdAt as string);
      return created >= window.start && created <= window.end;
    });
  }

  filterByStore(sales: Sale[]): Sale[] {
    if (!this.storeId) return sales;
    return sales.filter(s => (s as any).storeId === this.storeId);
  }

  getMetrics(window: AnalysisWindow): SalesMetrics {
    const filtered = this.filterByStore(this.filterByWindow(window));
    const totalRevenue = filtered.reduce((sum, s) => sum + (s.total || 0), 0);
    const transactionCount = filtered.length;
    const avgTransactionSize = transactionCount > 0 ? totalRevenue / transactionCount : 0;

    const paymentBreakdown: Record<string, number> = {};
    for (const sale of filtered) {
      const pm = String(sale.paymentMethod || '').toLowerCase();
      paymentBreakdown[pm] = (paymentBreakdown[pm] || 0) + (sale.total || 0);
    }

    const dailyRevenue: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = getDaysAgo(i);
      const dayEnd = getDaysAgo(i - 1);
      const daySales = filtered.filter(s => {
        const d = new Date(s.createdAt as string);
        return d >= dayStart && d < dayEnd;
      });
      dailyRevenue.push(daySales.reduce((sum, s) => sum + (s.total || 0), 0));
    }

    const categoryBreakdown: Record<string, number> = {};
    for (const sale of filtered) {
      for (const item of sale.items || []) {
        const cat = item.category || 'unknown';
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (item.price * item.qty);
      }
    }

    return {
      totalRevenue,
      transactionCount,
      avgTransactionSize,
      paymentMethodBreakdown: paymentBreakdown,
      dailyRevenue,
      categoryBreakdown,
    };
  }

  getDailyRevenueTrend(): { trend: 'up' | 'down' | 'flat'; percent: number } {
    const last7 = this.getMetrics({ start: getDaysAgo(7), end: new Date(), label: 'Last 7 days' });
    const prev7 = this.getMetrics({ start: getDaysAgo(14), end: getDaysAgo(7), label: 'Previous 7 days' });
    const percent = calculateGrowthRate(last7.totalRevenue, prev7.totalRevenue);
    if (percent > 5) return { trend: 'up', percent };
    if (percent < -5) return { trend: 'down', percent };
    return { trend: 'flat', percent };
  }

  getBestSellingItems(count: number = 5): Array<{ name: string; quantity: number; revenue: number }> {
    const itemMap: Record<string, { quantity: number; revenue: number }> = {};
    const recentSales = this.filterByWindow({ start: getDaysAgo(30), end: new Date(), label: 'Last 30 days' });
    for (const sale of recentSales) {
      for (const item of sale.items || []) {
        const key = item.name || 'Unknown';
        itemMap[key] = {
          quantity: (itemMap[key]?.quantity || 0) + item.qty,
          revenue: (itemMap[key]?.revenue || 0) + (item.price * item.qty),
        };
      }
    }
    return Object.entries(itemMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, count);
  }

  getSlowestDays(): { day: string; revenue: number }[] {
    const dayRevenue: Record<string, number> = {};
    const recentSales = this.filterByWindow({ start: getDaysAgo(30), end: new Date(), label: 'Last 30 days' });
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayNamesEs = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    for (let i = 0; i < 7; i++) {
      dayRevenue[i] = 0;
    }
    for (const sale of recentSales) {
      const day = new Date(sale.createdAt as string).getDay();
      dayRevenue[day] = (dayRevenue[day] || 0) + (sale.total || 0);
    }
    return Object.entries(dayRevenue)
      .map(([day, revenue]) => ({
        day: this.lang === 'es' ? dayNamesEs[parseInt(day)] : dayNames[parseInt(day)],
        revenue,
      }))
      .sort((a, b) => a.revenue - b.revenue);
  }

  getHourlyHeatmap(): Record<number, number> {
    const hourly: Record<number, number> = {};
    const recentSales = this.filterByWindow({ start: getDaysAgo(30), end: new Date(), label: 'Last 30 days' });
    for (let h = 0; h < 24; h++) hourly[h] = 0;
    for (const sale of recentSales) {
      const hour = new Date(sale.createdAt as string).getHours();
      hourly[hour] = (hourly[hour] || 0) + (sale.total || 0);
    }
    return hourly;
  }

  generateInsights(window: AnalysisWindow): Insight[] {
    const insights: Insight[] = [];
    const metrics = this.getMetrics(window);
    const trend = this.getDailyRevenueTrend();
    const slowDays = this.getSlowestDays();

    if (trend.percent > 20) {
      insights.push({
        id: 'sales-revenue-up',
        category: 'sales',
        severity: 'info',
        title: 'Revenue Surge Detected',
        titleEs: 'Aumento de Ingresos Detectado',
        description: `Revenue is ${trend.percent.toFixed(1)}% higher than last week.`,
        descriptionEs: `Los ingresos son ${trend.percent.toFixed(1)}% más altos que la semana pasada.`,
        metric: metrics.totalRevenue,
        metricLabel: this.lang === 'es' ? 'Ingresos totales' : 'Total Revenue',
        trend: trend.trend,
        trendPercent: trend.percent,
        confidence: 0.85,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    } else if (trend.percent < -15) {
      insights.push({
        id: 'sales-revenue-down',
        category: 'sales',
        severity: 'warning',
        title: 'Revenue Decline Alert',
        titleEs: 'Alerta de Caída de Ingresos',
        description: `Revenue dropped ${Math.abs(trend.percent).toFixed(1)}% vs last week.`,
        descriptionEs: `Los ingresos cayeron ${Math.abs(trend.percent).toFixed(1)}% vs semana pasada.`,
        metric: metrics.totalRevenue,
        metricLabel: this.lang === 'es' ? 'Ingresos totales' : 'Total Revenue',
        trend: trend.trend,
        trendPercent: trend.percent,
        actionLabel: this.lang === 'es' ? 'Ver Análisis' : 'View Analysis',
        actionRoute: 'sales',
        confidence: 0.9,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    const slowest = slowDays[0];
    if (slowest && slowest.revenue > 0) {
      insights.push({
        id: 'sales-slowest-day',
        category: 'sales',
        severity: 'opportunity',
        title: `${slowest.day} is Your Slowest Day`,
        titleEs: `${slowest.day} es Tu Día Más Lento`,
        description: `Consider promotions on ${slowest.day} to boost revenue.`,
        descriptionEs: `Considera promociones el ${slowest.day} para aumentar ingresos.`,
        metric: slowest.revenue,
        metricLabel: this.lang === 'es' ? 'Ingresos del día' : 'Day Revenue',
        confidence: 0.8,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
    }

    const bestItems = this.getBestSellingItems(3);
    if (bestItems.length > 0) {
      insights.push({
        id: 'sales-top-items',
        category: 'sales',
        severity: 'info',
        title: 'Top Selling Items',
        titleEs: 'Artículos Más Vendidos',
        description: `${bestItems.map(i => i.name).join(', ')} are your top performers.`,
        descriptionEs: `${bestItems.map(i => i.name).join(', ')} son tus mejores vendedores.`,
        metric: bestItems[0]?.revenue || 0,
        metricLabel: this.lang === 'es' ? 'Ventas del top 1' : 'Top item sales',
        confidence: 0.95,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    return insights;
  }
}