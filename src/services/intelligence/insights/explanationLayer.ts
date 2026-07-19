// ============================================================
// Business Analyst — answer explanation layer (I3-3 Part 1).
//
// Enriches a structured ANSWERED whole-store metric answer with:
//   ▲/▼ trend vs the previous equivalent period
//   biggest increase / largest decline (exact canonical contributors)
// ONLY when mathematically available (trend computable; contributors exist
// only for metrics with an exact canonical grouping). Never invents reasons:
// no data → no line. Localized EN/ES/PT here (findings stay structured).
// ============================================================

import { formatCurrency } from '@/utils/currency';
import type { BusinessLanguage } from '../language/types';
import type { StructuredBusinessQueryResult, StructuredQueryContext } from '../query/types';
import { computeMetricTrend } from './trendAnalysis';
import { computeContributors } from './contributorAnalysis';
import type { TrendResult } from './types';

type L3 = BusinessLanguage;

export function formatTrendLine(t: TrendResult, lang: L3): string | null {
  if (!t.meaningful) return null;
  if (t.direction === 'flat') {
    return lang === 'es' ? '= Sin cambio vs período anterior.'
      : lang === 'pt' ? '= Sem mudança vs período anterior.'
      : '= No change vs previous period.';
  }
  const arrow = t.direction === 'up' ? '▲' : '▼';
  const upWord = lang === 'es' ? (t.direction === 'up' ? 'Subió' : 'Bajó')
    : lang === 'pt' ? (t.direction === 'up' ? 'Subiu' : 'Caiu')
    : (t.direction === 'up' ? 'Up' : 'Down');
  const vsWord = lang === 'es' ? 'vs período anterior' : lang === 'pt' ? 'vs período anterior' : 'vs previous period';
  let magnitude: string;
  if (t.percentagePointDelta !== null) {
    const pts = lang === 'es' ? 'puntos' : lang === 'pt' ? 'pontos' : 'points';
    magnitude = `${Math.abs(t.percentagePointDelta).toFixed(1)} ${pts}`;
  } else if (t.percentChange !== null) {
    magnitude = `${Math.abs(t.percentChange).toFixed(1)}%`;
  } else {
    // Zero baseline → absolute delta only (never a fabricated percentage).
    magnitude = t.kind === 'money_cents' ? formatCurrency(Math.abs(t.deltaAmount)) : String(Math.abs(t.deltaAmount));
  }
  const prev = t.kind === 'money_cents' ? formatCurrency(t.previous) : String(t.previous);
  return `${arrow} ${upWord} ${magnitude} ${vsWord} (${prev}).`;
}

/** Extra localized lines for an answered whole-store get_metric result.
 *  Empty array when nothing is mathematically available. */
export function buildAnswerExplanation(
  result: StructuredBusinessQueryResult,
  ctx: StructuredQueryContext,
  lang: L3,
): string[] {
  if (result.status !== 'answered' || !result.resolvedRange) return [];
  const p = result.parsed;
  // Whole-store single metrics only (entity-scoped answers keep their focused
  // reply; comparisons already explain themselves).
  if (p.intent !== 'get_metric' || p.entity || result.comparisonResult) return [];
  const metric = p.metric;
  if (!metric) return [];

  const lines: string[] = [];
  const trend = computeMetricTrend(ctx, metric, result.resolvedRange);
  if (!trend) return [];
  const trendLine = formatTrendLine(trend, lang);
  if (trendLine) lines.push(trendLine);

  // Contributors — only where an exact canonical grouping exists.
  const contributors = computeContributors(ctx, metric, result.resolvedRange);
  if (contributors) {
    const upLabel = lang === 'es' ? 'Mayor aumento' : lang === 'pt' ? 'Maior aumento' : 'Biggest increase';
    const downLabel = lang === 'es' ? 'Mayor caída' : lang === 'pt' ? 'Maior queda' : 'Largest decline';
    const top = contributors.positive[0];
    if (top) lines.push(`${upLabel}: ${top.label} (+${formatCurrency(top.deltaCents)}).`);
    const bottom = contributors.negative[0];
    if (bottom) lines.push(`${downLabel}: ${bottom.label} (−${formatCurrency(Math.abs(bottom.deltaCents))}).`);
  }
  return lines;
}
