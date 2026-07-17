// CellHub Intelligence — Sales Analyzer
import type { Sale, Customer } from '@/store/types';
import { Insight, SalesMetrics, AnalysisWindow, ForecastResult } from '../types';
import { calculateGrowthRate, linearRegression } from '../utils/statistics';
import { getDaysAgo } from '../utils/dateHelpers';
import { formatCurrency } from '@/utils/currency';
// I2B-2: canonical gross-activity classifier — a voided sale and a refund
// audit row are NOT gross activity (Reports excludes both). Classifier only;
// no money math is imported.
import { isRefundAuditSale } from '@/services/reports/computeReportMoneyStats';
// I2B-2.1: canonical range money — authoritative totals come from here.
import type { CanonicalWindowProvider } from '../adapters/reportMoneyAdapter';

/** Gross-activity money set (canonical population): non-voided, non-refund-audit. */
function isGrossActivitySale(s: Sale): boolean {
  return s.status !== 'voided' && !isRefundAuditSale(s);
}

export class SalesAnalyzer {
  private sales: Sale[];
  private customers: Customer[];
  private storeId?: string;
  private lang: string;
  private getCanonical?: CanonicalWindowProvider;

  constructor(
    sales: Sale[],
    customers: Customer[],
    storeId?: string,
    lang: string = 'en',
    getCanonical?: CanonicalWindowProvider,
  ) {
    this.sales = sales;
    this.customers = customers;
    this.storeId = storeId;
    this.lang = lang;
    this.getCanonical = getCanonical;
  }

  /** I2B-2.1: authoritative money REQUIRES the canonical range provider — no
   *  silent manual-reduce fallback. Callers (the engine) always wire it;
   *  provider-less construction may still use the non-money operational
   *  methods, but the money-bearing getMetrics fails loudly. */
  private canonical(window: AnalysisWindow) {
    if (!this.getCanonical) {
      throw new Error('SalesAnalyzer.getMetrics requires a canonical money provider (I2B-2.1)');
    }
    return this.getCanonical(window);
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
    // I2B-2.1: AUTHORITATIVE money from the canonical range projection — no
    // manual reduce. totalRevenue is explicitly GROSS activity (grossSales);
    // netRevenueCents is canonical net (can be NEGATIVE, unclamped).
    const c = this.canonical(window);
    const totalRevenue = c.grossSalesCents;      // canonical GROSS (POS + standalone services) — unchanged
    const transactionCount = c.txCount;          // canonical POS transaction count — unchanged

    // POS gross-activity population (non-voided, non-refund-audit POS sales) —
    // the SAME set canonical txCount counts. SalesAnalyzer.sales holds POS
    // sales only, so standalone repairs/unlocks are structurally absent here.
    const activity = this.filterByStore(this.filterByWindow(window)).filter(isGrossActivitySale);

    // I2B-2.3: average POS TRANSACTION value. Numerator = POS gross activity
    // (NOT canonical grossSalesCents, which also includes standalone repair/
    // unlock revenue with no matching transaction); denominator = canonical
    // POS txCount. Same population both sides → standalone services never
    // inflate the average. Reuses the established gross-activity filter — no
    // new money formula, no standalone subtraction.
    const posGrossRevenueCents = activity.reduce((sum, s) => sum + (s.total || 0), 0);
    const avgTransactionSize = transactionCount > 0 ? Math.round(posGrossRevenueCents / transactionCount) : 0;

    // Payment breakdown = canonical tender (cash/card/store_credit). Reconciles
    // with Reports; unknown/other tender is not modeled by the canonical
    // service and is intentionally omitted here.
    const paymentBreakdown: Record<string, number> = {
      cash: c.cashCents,
      card: c.cardCents,
      store_credit: c.storeCreditCents,
    };

    // Category breakdown = canonical GROSS revenue per category.
    const categoryBreakdown: Record<string, number> = {};
    for (const cat of c.categoriesByRevenue) {
      categoryBreakdown[cat.name] = cat.revenueCents;
    }

    // dailyRevenue is an OPERATIONAL gross-activity sparkline (per-day series,
    // NOT a canonical range total) — voided + refund-audit excluded (I2B-2).
    const dailyRevenue: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = getDaysAgo(i);
      const dayEnd = getDaysAgo(i - 1);
      const daySales = activity.filter(s => {
        const d = new Date(s.createdAt as string);
        return d >= dayStart && d < dayEnd;
      });
      dailyRevenue.push(daySales.reduce((sum, s) => sum + (s.total || 0), 0));
    }

    return {
      totalRevenue,
      netRevenueCents: c.netSalesCents,
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

  // Operational item ranking. EXPLICIT METRIC: gross item revenue
  // (price × qty) over gross-activity sales (voided + refund-audit excluded,
  // I2B-2). I2B-2.1: deterministic tie-break — revenue desc, then name asc.
  getBestSellingItems(count: number = 5): Array<{ name: string; quantity: number; revenue: number }> {
    const itemMap: Record<string, { quantity: number; revenue: number }> = {};
    const recentSales = this.filterByWindow({ start: getDaysAgo(30), end: new Date(), label: 'Last 30 days' })
      .filter(isGrossActivitySale);
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
      .sort((a, b) => (b.revenue - a.revenue) || a.name.localeCompare(b.name))
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

  // R-INTELLIGENCE-CONTEXTUAL-BASELINE-ENGINE-V1: per-occurrence DOW gap vs
  // store daily average. Replaces the former best-vs-slowest 30d accumulation
  // which produced inflated, unrealistic figures. Only fires when slowest DOW
  // is >= 15% below the store's own trading-day average.
  getMissedRevenueByDay(): { slowDayLossCents: number; slowestDayName: string } {
    const DAY_EN    = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const cutoffMs  = getDaysAgo(30).getTime();

    const dowTotals: number[]      = new Array(7).fill(0);
    const dowDates:  Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
    const tradingDays              = new Set<string>();

    for (const s of this.sales) {
      const ts = new Date(s.createdAt as string).getTime();
      if (!ts || ts < cutoffMs) continue;
      if (String((s as { status?: string }).status || '').toLowerCase() === 'voided') continue;
      const d       = new Date(ts);
      const dateKey = d.toISOString().slice(0, 10);
      const dow     = d.getDay();
      dowTotals[dow] += s.total || 0;
      dowDates[dow].add(dateKey);
      tradingDays.add(dateKey);
    }

    if (tradingDays.size < 7) return { slowDayLossCents: 0, slowestDayName: '' };

    // Per-occurrence avg requires ≥2 dates per DOW for a stable estimate
    const dowAvg: (number | null)[] = new Array(7).fill(null);
    for (let d = 0; d < 7; d++) {
      const occ = dowDates[d].size;
      if (occ >= 2) dowAvg[d] = dowTotals[d] / occ;
    }

    const totalRev       = dowTotals.reduce((a, b) => a + b, 0);
    const storeAvgPerDay = totalRev / tradingDays.size;
    if (storeAvgPerDay <= 0) return { slowDayLossCents: 0, slowestDayName: '' };

    // Find DOW with the lowest per-occurrence avg that is >= 15% below store average
    let slowestDow = -1;
    let slowestAvg = Infinity;
    for (let d = 0; d < 7; d++) {
      const avg = dowAvg[d];
      if (avg === null) continue;
      const deviationFrac = (storeAvgPerDay - avg) / storeAvgPerDay;
      if (deviationFrac >= 0.15 && avg < slowestAvg) {
        slowestAvg = avg;
        slowestDow = d;
      }
    }

    if (slowestDow < 0) return { slowDayLossCents: 0, slowestDayName: '' };

    return {
      slowDayLossCents: Math.round(storeAvgPerDay - slowestAvg),
      slowestDayName:   DAY_EN[slowestDow],
    };
  }

  // R-INTELLIGENCE-CONTEXTUAL-BASELINE-ENGINE-V1: per-day revenue gap for
  // active hours that are > 20% below the median active-hour daily average.
  // Replaces the former peak-vs-all-hours 30d accumulation which produced
  // inflated figures (e.g. $29k) by comparing everything against peak.
  getMissedRevenueByHour(): { slowHourLossCents: number } {
    const cutoffMs  = getDaysAgo(30).getTime();
    const tradingDays   = new Set<string>();
    const hourlyTotals  = new Array(24).fill(0) as number[];

    for (const s of this.sales) {
      const ts = new Date(s.createdAt as string).getTime();
      if (!ts || ts < cutoffMs) continue;
      if (String((s as { status?: string }).status || '').toLowerCase() === 'voided') continue;
      const d = new Date(ts);
      tradingDays.add(d.toISOString().slice(0, 10));
      hourlyTotals[d.getHours()] += s.total || 0;
    }

    const days = tradingDays.size;
    if (days < 3) return { slowHourLossCents: 0 };

    // Per-day average per hour (not 30d total)
    const hourlyAvg = hourlyTotals.map(t => t / days);

    // Active hours: those with a meaningful per-day average
    const activeAvgs = hourlyAvg.filter(v => v > 0);
    if (activeAvgs.length < 2) return { slowHourLossCents: 0 };

    // Median of active-hour averages — robust against a single peak-hour outlier
    const sorted = [...activeAvgs].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    const medianAvg = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

    if (medianAvg <= 0) return { slowHourLossCents: 0 };

    // Sum deviations only for hours > 20% below the median (meaningful signal)
    let gapSum = 0;
    for (const v of activeAvgs) {
      if (v < medianAvg * 0.8) gapSum += medianAvg * 0.8 - v;
    }

    // Cap at 1× daily total so a single extreme outlier doesn't inflate the result
    const dailyTotal = activeAvgs.reduce((a, b) => a + b, 0);
    return { slowHourLossCents: Math.round(Math.min(gapSum, dailyTotal)) };
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