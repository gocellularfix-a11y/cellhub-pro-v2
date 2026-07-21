// ============================================================
// I6-C1 — unified presentation layer tests (deterministic).
//
// Verifies the presenter over hand-built canonical ProactiveInsight fixtures
// (isolated from the detectors, which have their own suites): ordering,
// localization, grouping, deduplication, suppression, recommendation
// generation, executive summary faithfulness, consumer-ready shape, future
// detector compatibility, and full determinism.
// ============================================================

import { describe, it, expect } from 'vitest';
import type { LocalDayRange } from '@/utils/reportRange';
import type {
  AnalysisWindow, ResolvedAnalysisWindows, ProactiveInsight, ProactiveInsightsResult,
  ProactiveInsightDiagnostic, ProactiveInsightSeverity, ProactiveInsightDirection,
  EvidenceQualityCause,
} from '../proactiveInsights/types';
import { presentProactiveInsights } from './presenter';
import { orderCards } from './priority';
import { buildInsightCard } from './cardFactory';

// ── fixtures ────────────────────────────────────────────────
const R = (s: string, e: string): LocalDayRange => ({
  start: new Date(`${s}T00:00:00`), end: new Date(`${e}T23:59:59`), valid: true, invalidReason: null,
});
const W = (label: AnalysisWindow['label'], s: string, e: string, days: number): AnalysisWindow => ({
  label, startYMD: s, endYMD: e, range: R(s, e), dayCount: days,
});
const WINS: ResolvedAnalysisWindows = {
  referenceYMD: '2026-07-21',
  current: W('current_7_full_days', '2026-07-14', '2026-07-20', 7),
  baseline: W('baseline_previous_7_days', '2026-07-07', '2026-07-13', 7),
};
const W30 = W('current_30_full_days', '2026-06-21', '2026-07-20', 30);

let fp = 0;
const nextFp = (tag: string) => `fp:${tag}:${fp++}`;

function salesInsight(changePct: number, severity: ProactiveInsightSeverity, direction: ProactiveInsightDirection, confidence = 0.8): ProactiveInsight {
  return {
    fingerprint: nextFp('sales'), detectorId: 'sales_momentum', category: 'sales',
    severity, direction, confidence, confidenceReasons: ['complete_periods', 'strong_sample'],
    evidence: {
      detectorId: 'sales_momentum', metric: 'gross_sales', sourceKind: 'canonical_report_money',
      windows: WINS, currentCents: 780000, baselineCents: 1000000,
      currentTransactionCount: 40, baselineTransactionCount: 52, changePct,
    },
    thresholds: { materialChangePct: 20 },
  };
}

function marginInsight(points: number, severity: ProactiveInsightSeverity, direction: ProactiveInsightDirection, confidence = 0.8): ProactiveInsight {
  return {
    fingerprint: nextFp('margin'), detectorId: 'gross_margin_pressure', category: 'margin',
    severity, direction, confidence, confidenceReasons: ['complete_periods', 'strong_sample'],
    evidence: {
      detectorId: 'gross_margin_pressure', metric: 'margin', sourceKind: 'canonical_report_money',
      windows: WINS, currentGrossSalesCents: 780000, baselineGrossSalesCents: 1000000,
      currentGrossProfitCents: 249600, baselineGrossProfitCents: 400000,
      currentMarginPct: 32, baselineMarginPct: 40, marginChangePoints: points,
      currentCostCoverage: 0.9, baselineCostCoverage: 0.9,
      currentTransactionCount: 40, baselineTransactionCount: 52,
    },
    thresholds: { marginMaterialChangePoints: 5 },
  };
}

function carrierInsight(concentration: number, severity: ProactiveInsightSeverity, confidence = 0.85): ProactiveInsight {
  return {
    fingerprint: nextFp('carrier'), detectorId: 'carrier_concentration', category: 'carriers',
    severity, direction: 'neutral', confidence, confidenceReasons: ['complete_periods', 'strong_sample'],
    evidence: {
      detectorId: 'carrier_concentration', metric: 'transaction_count', sourceKind: 'canonical_report_money',
      window: W30, topCarrier: 'Verizon', tiedWith: [], topCarrierTransactionCount: 81,
      totalEligibleTransactionCount: 100, concentration, perCarrier: [
        { carrier: 'Verizon', transactionCount: 81 }, { carrier: 'AT&T', transactionCount: 19 },
      ], excludedMixedSales: 4,
    },
    thresholds: { carrierHighConcentrationShare: 0.6 },
  };
}

function evidenceQualityInsight(cause: EvidenceQualityCause, severity: ProactiveInsightSeverity): ProactiveInsight {
  return {
    fingerprint: nextFp(`eq:${cause}`), detectorId: 'evidence_quality', category: 'data_quality',
    severity, direction: 'neutral', confidence: 0.9, confidenceReasons: ['complete_periods'],
    evidence: {
      detectorId: 'evidence_quality', metric: 'data_quality', sourceKind: 'canonical_report_money',
      cause, windows: WINS, currentGrossSalesCents: 500000, currentTransactionCount: 30,
      measuredRatio: cause === 'insufficient_cost_coverage' ? 0.4 : null,
      ratioThreshold: cause === 'insufficient_cost_coverage' ? 0.5 : null,
      lastActivityYMD: '2026-07-15', earliestActivityYMD: '2026-07-10',
    },
    thresholds: { lowCostCoverage: 0.5 },
  };
}

const result = (insights: ProactiveInsight[], diagnostics: ProactiveInsightDiagnostic[] = []): ProactiveInsightsResult =>
  ({ referenceYMD: '2026-07-21', insights, diagnostics });

// ── ordering ────────────────────────────────────────────────
describe('priority ordering', () => {
  it('orders critical → important → watch → positive → info regardless of input order', () => {
    const insights = [
      evidenceQualityInsight('insufficient_history', 'info'),
      salesInsight(25, 'watch', 'positive'),
      carrierInsight(0.81, 'important'),
      salesInsight(-45, 'critical', 'negative'),
    ];
    const cards = orderCards(insights.map((i) => buildInsightCard(i, 'en')));
    expect(cards.map((c) => c.priority)).toEqual(['critical', 'important', 'positive', 'info']);
  });

  it('breaks ties by confidence desc then detector then fingerprint', () => {
    const a = { ...carrierInsight(0.81, 'watch', 0.6), fingerprint: 'zzz' };
    const b = { ...carrierInsight(0.81, 'watch', 0.9), fingerprint: 'aaa' };
    const cards = orderCards([a, b].map((i) => buildInsightCard(i, 'en')));
    expect(cards[0].confidence).toBe(0.9);
  });
});

// ── localization ────────────────────────────────────────────
describe('localization', () => {
  it('produces Spanish and Portuguese wording without English leakage on the headline', () => {
    const i = salesInsight(-22, 'important', 'negative');
    expect(buildInsightCard(i, 'en').headline).toContain('Sales dropped');
    expect(buildInsightCard(i, 'es').headline).toContain('Las ventas bajaron');
    expect(buildInsightCard(i, 'pt').headline).toContain('As vendas caíram');
  });

  it('localizes recommendations in all three languages', () => {
    const i = salesInsight(-22, 'important', 'negative');
    expect(buildInsightCard(i, 'en').recommendation).toBe('Review recent sales activity first.');
    expect(buildInsightCard(i, 'es').recommendation).toBe('Revisa primero la actividad de ventas reciente.');
    expect(buildInsightCard(i, 'pt').recommendation).toBe('Revise primeiro a atividade de vendas recente.');
  });

  it('formats money and signed percentages faithfully in details', () => {
    const card = buildInsightCard(salesInsight(-22, 'important', 'negative'), 'en');
    expect(card.expandableDetails[0]).toContain('$7,800.00');
    expect(card.expandableDetails[2]).toContain('−22%');
  });
});

// ── grouping ────────────────────────────────────────────────
describe('grouping', () => {
  it('collapses sales decline + margin decline into one profitability theme', () => {
    const p = presentProactiveInsights(result([
      salesInsight(-22, 'important', 'negative'),
      marginInsight(-8, 'important', 'negative'),
    ]), 'en');
    const theme = p.groups.find((g) => g.groupKey === 'profitability_pressure');
    expect(theme).toBeTruthy();
    expect(theme!.members).toHaveLength(2);
    expect(theme!.headline).toBe('Sales and profit margin are both down.');
    expect(theme!.recommendation).toContain('recent sales');
  });

  it('groups two or more data-quality gaps together', () => {
    const p = presentProactiveInsights(result([
      evidenceQualityInsight('insufficient_cost_coverage', 'watch'),
      evidenceQualityInsight('excessive_unknown_classification', 'watch'),
    ]), 'en');
    const g = p.groups.find((x) => x.groupKey === 'data_quality');
    expect(g).toBeTruthy();
    expect(g!.members).toHaveLength(2);
  });

  it('keeps unrelated findings as singleton groups', () => {
    const p = presentProactiveInsights(result([
      salesInsight(-22, 'important', 'negative'),
      carrierInsight(0.81, 'important'),
    ]), 'en');
    expect(p.groups).toHaveLength(2);
    expect(p.groups.every((g) => g.members.length === 1)).toBe(true);
  });
});

// ── deduplication (every card in exactly one group) ─────────
describe('deduplication', () => {
  it('assigns every visible card to exactly one group with no repeats', () => {
    const p = presentProactiveInsights(result([
      salesInsight(-45, 'critical', 'negative'),
      marginInsight(-12, 'critical', 'negative'),
      carrierInsight(0.81, 'important'),
      evidenceQualityInsight('insufficient_cost_coverage', 'watch'),
    ]), 'en');
    const grouped = p.groups.flatMap((g) => g.members.map((m) => m.fingerprint));
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(p.cards.map((c) => c.fingerprint)));
  });
});

// ── suppression ─────────────────────────────────────────────
describe('suppression', () => {
  it('shows at most one info card when an actionable card exists', () => {
    const p = presentProactiveInsights(result([
      salesInsight(-45, 'critical', 'negative'),
      evidenceQualityInsight('insufficient_history', 'info'),
      evidenceQualityInsight('missing_customer_attribution', 'info'),
    ]), 'en');
    expect(p.cards.filter((c) => c.priority === 'info')).toHaveLength(1);
    expect(p.suppressed).toHaveLength(1);
  });

  it('shows up to three info cards when nothing actionable exists', () => {
    const p = presentProactiveInsights(result([
      evidenceQualityInsight('insufficient_history', 'info'),
      evidenceQualityInsight('missing_customer_attribution', 'info'),
    ]), 'en');
    expect(p.suppressed).toHaveLength(0);
  });
});

// ── recommendation faithfulness ─────────────────────────────
describe('recommendations', () => {
  it('carrier concentration recommends comparing other carriers', () => {
    const card = buildInsightCard(carrierInsight(0.81, 'important'), 'en');
    expect(card.recommendation).toBe('Consider reviewing whether other carrier sales are declining.');
  });

  it('does not fabricate a "healthy" recommendation for exposure cards', () => {
    const card = buildInsightCard(carrierInsight(0.81, 'important'), 'en');
    expect(card.summary.toLowerCase()).not.toContain('healthy');
    expect(card.headline.toLowerCase()).not.toContain('healthy');
  });
});

// ── executive summary ───────────────────────────────────────
describe('executive summary', () => {
  it('counts actionable findings and lists faithful clauses', () => {
    const p = presentProactiveInsights(result([
      salesInsight(-45, 'critical', 'negative'),
      carrierInsight(0.81, 'important'),
    ]), 'en');
    expect(p.executive.headline).toBe('Today I found 2 important things.');
    expect(p.executive.lines).toContain('Most carrier activity depends on Verizon.');
    // Never fabricates positives about un-emitted areas.
    expect(p.executive.lines.join(' ').toLowerCase()).not.toContain('healthy');
  });

  it('uses singular for a single actionable finding', () => {
    const p = presentProactiveInsights(result([salesInsight(-45, 'critical', 'negative')]), 'en');
    expect(p.executive.headline).toBe('Today I found 1 important thing.');
  });

  it('distinguishes no-material-change from no-evidence when nothing emits', () => {
    const belowThreshold = presentProactiveInsights(result([], [
      { detectorId: 'sales_momentum', status: 'below_threshold', reasons: ['change_below_material_threshold'], evidence: null, confidence: 0.8, emittedCount: 0 },
    ]), 'en');
    expect(belowThreshold.executive.headline).toBe('No material changes in the recent period.');

    const noEvidence = presentProactiveInsights(result([], [
      { detectorId: 'sales_momentum', status: 'insufficient_evidence', reasons: ['insufficient_sample'], evidence: null, confidence: 0.2, emittedCount: 0 },
    ]), 'en');
    expect(noEvidence.executive.headline).toContain("isn't enough complete evidence");
  });
});

// ── consumer-ready shape ────────────────────────────────────
describe('consumer-ready card shape', () => {
  it('exposes every field the Bubble / Manager / Chat need', () => {
    const p = presentProactiveInsights(result([salesInsight(-45, 'critical', 'negative')]), 'en');
    const card = p.cards[0];
    expect(card).toEqual(expect.objectContaining({
      fingerprint: expect.any(String),
      priority: 'critical',
      icon: expect.any(String),
      headline: expect.any(String),
      summary: expect.any(String),
      confidencePct: expect.any(Number),
    }));
    expect(card.recommendation).toBeTypeOf('string');
    expect(Array.isArray(card.expandableDetails)).toBe(true);
    expect(Array.isArray(card.actions)).toBe(true);
    expect(p.executive.headline).toBeTypeOf('string');
    expect(Array.isArray(p.executive.lines)).toBe(true);
  });
});

// ── future detector compatibility ───────────────────────────
describe('future detector compatibility', () => {
  it('passes an unknown detector through the pipeline without throwing', () => {
    // Simulates a NOT-YET-KNOWN detector: the generic stages must not crash;
    // it simply sorts last and carries empty wording until strings are added.
    const future = {
      ...salesInsight(-22, 'important', 'negative'),
      detectorId: 'profit_momentum' as unknown as ProactiveInsight['detectorId'],
      evidence: { ...salesInsight(-22, 'important', 'negative').evidence, detectorId: 'profit_momentum' } as unknown as ProactiveInsight['evidence'],
    };
    expect(() => presentProactiveInsights(result([future]), 'en')).not.toThrow();
    const p = presentProactiveInsights(result([future]), 'en');
    expect(p.cards).toHaveLength(1);
  });
});

// ── determinism ─────────────────────────────────────────────
describe('determinism', () => {
  it('same result + same lang → identical presentation', () => {
    const insights = [
      salesInsight(-45, 'critical', 'negative'),
      marginInsight(-12, 'critical', 'negative'),
      carrierInsight(0.81, 'important'),
      evidenceQualityInsight('insufficient_cost_coverage', 'watch'),
    ];
    const a = presentProactiveInsights(result(insights), 'es');
    const b = presentProactiveInsights(result(insights), 'es');
    expect(a).toEqual(b);
  });
});
