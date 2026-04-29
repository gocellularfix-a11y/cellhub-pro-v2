// CellHub Intelligence — Sales Analyzer
import type { Sale, Customer } from '@/store/types';
import { Insight, SalesMetrics, AnalysisWindow, ForecastResult } from '../types';
import { calculateGrowthRate, linearRegression } from '../utils/statistics';
import { getDaysAgo } from '../utils/dateHelpers';
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

  // R-INTEL-2-MISSED: weekly revenue gap — compares the slowest DOW against
  // the best DOW over the last 30 days. The gap is the per-week opportunity.
  getMissedRevenueByDay(): { slowDayLossCents: number; slowestDayName: string } {
    const days = this.getSlowestDays(); // sorted ASC by revenue; uses EN names by default
    if (days.length < 2) return { slowDayLossCents: 0, slowestDayName: '' };
    const slowest = days[0];
    const best = days[days.length - 1];
    // Re-derive English name regardless of analyzer lang (stored data = English DOW)
    const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const DAY_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const esIdx = DAY_ES.indexOf(slowest.day);
    const slowestDayName = esIdx >= 0 ? DAY_EN[esIdx] : slowest.day;
    return {
      slowDayLossCents: Math.max(0, best.revenue - slowest.revenue),
      slowestDayName,
    };
  }

  // R-INTEL-2-MISSED: daily off-peak gap — sum of (peakHour - eachActiveHour)
  // for the last 30 days. Hours with zero revenue are excluded (assumed closed).
  getMissedRevenueByHour(): { slowHourLossCents: number } {
    const hourly = this.getHourlyHeatmap();
    const activeRevenues = Object.values(hourly).filter(rev => rev > 0);
    if (activeRevenues.length === 0) return { slowHourLossCents: 0 };
    const peakHourRevenue = Math.max(...activeRevenues);
    const slowHourLossCents = activeRevenues.reduce(
      (sum, rev) => sum + (peakHourRevenue - rev),
      0,
    );
    return { slowHourLossCents };
  }

  // R-INTEL-SMARTER-F1: per-SKU demand forecasting via linear regression
  // over daily unit sales. Returns only items with r² ≥ 0.3 (some signal;
  // lower than that is noise). Projects 7 and 30 days.
  //
  // Input window: last 60 days by default. Fewer than 14 days of data per
  // item → skip (can't fit a meaningful line).
  getItemForecasts(topN: number = 10, windowDays: number = 60): ForecastResult[] {
    const windowStart = getDaysAgo(windowDays);
    const recentSales = this.sales.filter(s => {
      const d = new Date(s.createdAt as string);
      return d >= windowStart && s.status !== 'voided';
    });

    // Aggregate item sales by day. Map: itemKey → Map<dayIndex, qty>
    const seriesByItem = new Map<string, { id?: string; name: string; byDay: Map<number, number>; totalQty: number }>();
    for (const sale of recentSales) {
      const dayIdx = Math.floor(
        (new Date(sale.createdAt as string).getTime() - windowStart.getTime())
        / (1000 * 60 * 60 * 24),
      );
      for (const item of sale.items || []) {
        // Skip phone_payment/top_up — not real SKUs with demand curves.
        if (item.category === 'phone_payment' || item.category === 'top_up') continue;
        const key = item.inventoryId || item.name || 'unknown';
        const qty = item.qty || 0;
        if (qty <= 0) continue;
        let entry = seriesByItem.get(key);
        if (!entry) {
          entry = { id: item.inventoryId, name: item.name || key, byDay: new Map(), totalQty: 0 };
          seriesByItem.set(key, entry);
        }
        entry.byDay.set(dayIdx, (entry.byDay.get(dayIdx) || 0) + qty);
        entry.totalQty += qty;
      }
    }

    // Rank items by total volume, take top N.
    const ranked = Array.from(seriesByItem.entries())
      .map(([key, e]) => ({ key, ...e }))
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, topN);

    const forecasts: ForecastResult[] = [];
    for (const entry of ranked) {
      // Need ≥14 distinct days of data to trust the fit.
      if (entry.byDay.size < 14) continue;

      // Build [dayIdx, qty] pairs across the full window (zero-fill missing days).
      const points: [number, number][] = [];
      for (let i = 0; i < windowDays; i++) {
        points.push([i, entry.byDay.get(i) || 0]);
      }

      const { slope, intercept, r2 } = linearRegression(points);
      if (r2 < 0.3) continue;

      // Predict future day N = windowDays, windowDays+7, windowDays+30
      // relative to windowStart. Sum the per-day prediction for the horizon.
      let pred7 = 0;
      let pred30 = 0;
      for (let d = 1; d <= 30; d++) {
        const pred = Math.max(0, slope * (windowDays + d) + intercept);
        if (d <= 7) pred7 += pred;
        pred30 += pred;
      }

      forecasts.push({
        inventoryId: entry.id || entry.key,
        itemName: entry.name,
        predictedDemand7Days: Math.round(pred7),
        predictedDemand30Days: Math.round(pred30),
        confidence: Math.min(1, Math.max(0, r2)),
      });
    }

    return forecasts.sort((a, b) => b.predictedDemand30Days - a.predictedDemand30Days);
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

    // R-INTEL-SMARTER-F1: forecasting insights — rising / falling trend
    // on top-volume SKUs. Only surfaces the strongest (by r²).
    const forecasts = this.getItemForecasts(10, 60);
    for (const f of forecasts.slice(0, 3)) {
      // Compare 30-day projection vs observed last 30 days to get direction.
      const last30Start = getDaysAgo(30);
      let observed30 = 0;
      for (const sale of this.sales) {
        if (sale.status === 'voided') continue;
        const d = new Date(sale.createdAt as string);
        if (d < last30Start) continue;
        for (const item of sale.items || []) {
          const key = item.inventoryId || item.name || 'unknown';
          if (key === f.inventoryId || item.name === f.itemName) {
            observed30 += item.qty || 0;
          }
        }
      }
      const deltaPct = observed30 > 0
        ? ((f.predictedDemand30Days - observed30) / observed30) * 100
        : 0;

      // Only emit if meaningful change (>15% projected) OR shrinking fast.
      if (Math.abs(deltaPct) < 15) continue;

      const rising = deltaPct > 0;
      insights.push({
        id: `sales-forecast-${f.inventoryId}`,
        category: 'sales',
        severity: rising ? 'opportunity' : 'warning',
        title: rising ? 'Demand Rising' : 'Demand Declining',
        titleEs: rising ? 'Demanda Subiendo' : 'Demanda Bajando',
        description: rising
          ? `${f.itemName} projected at ${f.predictedDemand30Days} units next 30 days (vs ${observed30} observed). Consider stocking more.`
          : `${f.itemName} projected at ${f.predictedDemand30Days} units next 30 days (vs ${observed30} observed). Trend is down ${Math.abs(deltaPct).toFixed(0)}%.`,
        descriptionEs: rising
          ? `${f.itemName} proyecta ${f.predictedDemand30Days} uds en 30 días (vs ${observed30} observadas). Considera más stock.`
          : `${f.itemName} proyecta ${f.predictedDemand30Days} uds en 30 días (vs ${observed30} observadas). Tendencia baja ${Math.abs(deltaPct).toFixed(0)}%.`,
        metric: f.predictedDemand30Days,
        metricLabel: this.lang === 'es' ? 'Demanda proyectada 30d' : 'Projected demand 30d',
        trend: rising ? 'up' : 'down',
        trendPercent: deltaPct,
        confidence: f.confidence,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        data: { forecast: f as unknown as Record<string, unknown>, observed30 },
      });
    }

    return insights;
  }
}