// R-INTELLIGENCE-TREND-DIRECTION-V1
// Detects whether the store is improving, declining, stable, recovering,
// or worsening. Pure deterministic comparison — no ML, no AI APIs.
//
// Direction rules (widened by volatilityScore for high-variance stores):
//   stable:    |changePct| < 8%
//   improving: changePct >= +8% AND current >= 30d baseline
//   declining: changePct <= -8% AND current >= 30d baseline
//   recovering: changePct >= +8% AND current < 30d baseline  (getting better but still low)
//   worsening:  changePct <= -8% AND current < 30d baseline  (double-bad signal)
//
// Severity thresholds:
//   low: <15%  medium: 15-25%  high: 25-35%  critical: >35%

import type { Sale } from '@/store/types';
import type {
  ContextualBaseline,
  TrendDirection,
  TrendSignal,
  TrendDirectionReport,
} from '../types';

function saleTs(s: Sale): number {
  try {
    const ca = s.createdAt;
    const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
      ? (ca as { toDate: () => Date }).toDate()
      : new Date(ca as string | Date);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch { return 0; }
}

function windowRev(sales: Sale[], from: number, to: number): number {
  let sum = 0;
  for (const s of sales) {
    const t = saleTs(s);
    if (!t || t < from || t >= to) continue;
    if (String((s as { status?: string }).status || '').toLowerCase() === 'voided') continue;
    sum += (s as { total?: number }).total || 0;
  }
  return sum;
}

// Revenue for items whose category string includes `catSubstr` (lowercase).
function windowCatRev(sales: Sale[], from: number, to: number, catSubstr: string): number {
  let sum = 0;
  for (const s of sales) {
    const t = saleTs(s);
    if (!t || t < from || t >= to) continue;
    if (String((s as { status?: string }).status || '').toLowerCase() === 'voided') continue;
    for (const it of (s.items || [])) {
      const cat = String((it as { category?: string }).category || '').toLowerCase();
      if (!cat.includes(catSubstr)) continue;
      const price = (it as { price?: number }).price || 0;
      const qty   = (it as { qty?: number; quantity?: number }).qty
        ?? (it as { quantity?: number }).quantity
        ?? 0;
      sum += price * qty;
    }
  }
  return sum;
}

function classifyDir(
  changePct: number,
  vsBaselinePct: number,
  volatility: number,
): TrendDirection {
  const thresh = 8 + volatility * 5; // widen for high-variance stores
  if (Math.abs(changePct) < thresh) return 'stable';
  const belowBaseline = vsBaselinePct < -5;
  if (changePct > 0) return belowBaseline ? 'recovering' : 'improving';
  return belowBaseline ? 'worsening' : 'declining';
}

function classifySev(absPct: number): TrendSignal['severity'] {
  if (absPct < 15) return 'low';
  if (absPct < 25) return 'medium';
  if (absPct < 35) return 'high';
  return 'critical';
}

function safePct(current: number, previous: number): number {
  if (previous <= 0) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

function fmt(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function baselineLabel(vsBaselinePct: number): string {
  const abs = Math.abs(Math.round(vsBaselinePct));
  if (abs < 8) return 'within your normal range';
  return vsBaselinePct >= 0
    ? `${abs}% above your 30-day average`
    : `${abs}% below your 30-day average`;
}

function revTitle(dir: TrendDirection, absPct: number): string {
  switch (dir) {
    case 'improving':  return `Revenue up ${absPct}% this week`;
    case 'declining':  return `Revenue down ${absPct}% this week`;
    case 'stable':     return 'Revenue stable this week';
    case 'recovering': return `Revenue recovering — up ${absPct}% vs last week`;
    case 'worsening':  return `Revenue worsening — down ${absPct}% vs last week`;
  }
}

export function computeTrendDirectionReport(
  sales: Sale[],
  baseline: ContextualBaseline,
): TrendDirectionReport {
  const now = Date.now();
  const d7  = now -  7 * 24 * 60 * 60 * 1000;
  const d14 = now - 14 * 24 * 60 * 60 * 1000;

  const last7      = windowRev(sales, d7, now);
  const prev7      = windowRev(sales, d14, d7);
  const baseline7  = baseline.rolling7dAverage * 7;
  const vsBase7Pct = baseline7 > 0 ? ((last7 - baseline7) / baseline7) * 100 : 0;

  const signals: TrendSignal[] = [];

  // ── Overall revenue trend ──────────────────────────────────────────────────
  if (last7 > 0 || prev7 > 0) {
    const changePct = safePct(last7, prev7);
    const dir       = classifyDir(changePct, vsBase7Pct, baseline.volatilityScore);
    const sev       = classifySev(Math.abs(changePct));
    const absPct    = Math.abs(changePct);
    const bLabel    = baselineLabel(vsBase7Pct);

    let explanation: string;
    let recommendedAction: string | undefined;

    switch (dir) {
      case 'stable':
        explanation = prev7 > 0
          ? `Revenue is flat vs last week (${fmt(last7)} vs ${fmt(prev7)}) — ${bLabel}.`
          : `Revenue this week: ${fmt(last7)}. No prior-week data yet.`;
        break;
      case 'improving':
        explanation = `Revenue up ${absPct}% vs last week (${fmt(last7)} vs ${fmt(prev7)}) and ${bLabel}. Momentum is positive.`;
        recommendedAction = 'Capitalize — push accessory upsells and new arrivals.';
        break;
      case 'declining':
        explanation = `Revenue down ${absPct}% vs last week (${fmt(last7)} vs ${fmt(prev7)}). ${bLabel.charAt(0).toUpperCase() + bLabel.slice(1)}.`;
        recommendedAction = 'Follow up on pending repairs and collections before the weekend.';
        break;
      case 'recovering':
        explanation = `Revenue improved ${absPct}% vs last week (${fmt(last7)} vs ${fmt(prev7)}), but still ${bLabel}. Recovery in progress.`;
        recommendedAction = 'Keep the momentum — prioritize high-value customers and open balances.';
        break;
      case 'worsening':
        explanation = `Revenue down ${absPct}% vs last week and ${bLabel}. This is a compounding decline.`;
        recommendedAction = 'Run a flash promo and contact inactive high-value customers today.';
        break;
    }

    signals.push({
      id: 'trend-revenue',
      category: 'sales',
      direction: dir,
      severity: sev,
      title: revTitle(dir, absPct),
      explanation,
      recommendedAction,
      currentValue: last7,
      previousValue: prev7,
      changePercent: changePct,
      detectedAt: now,
    });
  }

  // ── Repair revenue trend (optional — only if ≥$50 combined) ───────────────
  const repLast7 = windowCatRev(sales, d7, now, 'repair');
  const repPrev7 = windowCatRev(sales, d14, d7, 'repair');
  if (repLast7 + repPrev7 >= 5000 && repPrev7 > 0) {
    const changePct = safePct(repLast7, repPrev7);
    if (Math.abs(changePct) >= 12) {
      const up: TrendDirection = 'improving';
      const dn: TrendDirection = 'declining';
      const dir = changePct > 0 ? up : dn;
      signals.push({
        id: 'trend-repairs',
        category: 'repairs',
        direction: dir,
        severity: classifySev(Math.abs(changePct)),
        title: dir === 'improving'
          ? `Repair revenue up ${Math.abs(changePct)}%`
          : `Repair revenue down ${Math.abs(changePct)}%`,
        explanation: `Repair revenue is ${dir === 'improving' ? 'up' : 'down'} ${Math.abs(changePct)}% vs last week (${fmt(repLast7)} vs ${fmt(repPrev7)}).`,
        recommendedAction: dir === 'declining'
          ? 'Follow up on in-progress repairs and upsell protection plans.'
          : undefined,
        currentValue: repLast7,
        previousValue: repPrev7,
        changePercent: changePct,
        detectedAt: now,
      });
    }
  }

  // ── Accessory sales trend (optional — only if ≥$50 combined) ──────────────
  const accLast7 = windowCatRev(sales, d7, now, 'accessor');
  const accPrev7 = windowCatRev(sales, d14, d7, 'accessor');
  if (accLast7 + accPrev7 >= 5000 && accPrev7 > 0) {
    const changePct = safePct(accLast7, accPrev7);
    if (Math.abs(changePct) >= 12) {
      const up: TrendDirection = 'improving';
      const dn: TrendDirection = 'declining';
      const dir = changePct > 0 ? up : dn;
      signals.push({
        id: 'trend-accessories',
        category: 'accessories',
        direction: dir,
        severity: classifySev(Math.abs(changePct)),
        title: dir === 'improving'
          ? `Accessory sales up ${Math.abs(changePct)}%`
          : `Accessory attach rate down ${Math.abs(changePct)}%`,
        explanation: `Accessory sales are ${dir === 'improving' ? 'up' : 'down'} ${Math.abs(changePct)}% vs last week (${fmt(accLast7)} vs ${fmt(accPrev7)}).`,
        recommendedAction: dir === 'declining'
          ? 'Proactively offer accessories at checkout.'
          : undefined,
        currentValue: accLast7,
        previousValue: accPrev7,
        changePercent: changePct,
        detectedAt: now,
      });
    }
  }

  const summary = signals[0]?.explanation
    ?? 'Not enough sales data to determine trend direction.';

  return { generatedAt: now, signals, summary };
}
