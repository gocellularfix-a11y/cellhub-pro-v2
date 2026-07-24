// ============================================================
// R-WORTH-A-LOOK-UX-V1 — Worth a Look UX correction tests
//
// 1) Floating launcher: structural locks (fixed positioning, sidebar-safe
//    clamp, aria-expanded, focus return) — no pixel-perfect assertions.
// 2) Advice clarity: carrier-labeling insight presents the DETECTOR'S real
//    measured share (never a fabricated count), explains why reports become
//    incomplete, and carries a direct action + CTA; the positive-performance
//    group uses the honest fallback and never invents category contributors.
// Severity/confidence/identity passthrough is asserted unchanged.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import type {
  ProactiveInsight, ProactiveInsightSeverity, EvidenceQualityCause,
  ResolvedAnalysisWindows, AnalysisWindow,
} from '@/services/intelligence/proactiveInsights/types';
import type { LocalDayRange } from '@/utils/reportRange';
import { buildInsightCard } from '@/services/intelligence/presentation/cardFactory';
import { groupCards } from '@/services/intelligence/presentation/grouping';
import { orderCards } from '@/services/intelligence/presentation/priority';

// ── fixtures (same shapes as presentation.test.ts) ──────────
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

let fp = 0;
const nextFp = (tag: string) => `fp:walu:${tag}:${fp++}`;

function carrierGapInsight(measuredRatio: number | null, severity: ProactiveInsightSeverity = 'watch'): ProactiveInsight {
  return {
    fingerprint: nextFp('eq'), detectorId: 'evidence_quality', category: 'data_quality',
    severity, direction: 'neutral', confidence: 0.9, confidenceReasons: ['complete_periods'],
    evidence: {
      detectorId: 'evidence_quality', metric: 'data_quality', sourceKind: 'canonical_report_money',
      cause: 'excessive_unknown_classification' as EvidenceQualityCause, windows: WINS,
      currentGrossSalesCents: 500000, currentTransactionCount: 30,
      measuredRatio, ratioThreshold: measuredRatio !== null ? 0.2 : null,
      lastActivityYMD: '2026-07-20', earliestActivityYMD: '2026-06-01',
    },
    thresholds: { lowCostCoverage: 0.5 },
  } as ProactiveInsight;
}

function positive(detector: 'sales' | 'margin'): ProactiveInsight {
  if (detector === 'sales') {
    return {
      fingerprint: nextFp('sales'), detectorId: 'sales_momentum', category: 'sales',
      severity: 'watch', direction: 'positive', confidence: 0.8, confidenceReasons: ['complete_periods', 'strong_sample'],
      evidence: {
        detectorId: 'sales_momentum', metric: 'gross_sales', sourceKind: 'canonical_report_money',
        windows: WINS, currentCents: 1120000, baselineCents: 1000000,
        currentTransactionCount: 52, baselineTransactionCount: 40, changePct: 12,
      },
      thresholds: { materialChangePct: 20 },
    } as ProactiveInsight;
  }
  return {
    fingerprint: nextFp('margin'), detectorId: 'gross_margin_pressure', category: 'margin',
    severity: 'watch', direction: 'positive', confidence: 0.8, confidenceReasons: ['complete_periods', 'strong_sample'],
    evidence: {
      detectorId: 'gross_margin_pressure', metric: 'margin', sourceKind: 'canonical_report_money',
      windows: WINS, currentGrossSalesCents: 1120000, baselineGrossSalesCents: 1000000,
      currentGrossProfitCents: 347200, baselineGrossProfitCents: 280000,
      currentMarginPct: 31, baselineMarginPct: 28, marginChangePoints: 3,
      currentCostCoverage: 0.9, baselineCostCoverage: 0.9,
      currentTransactionCount: 52, baselineTransactionCount: 40,
    },
    thresholds: { marginMaterialChangePoints: 5 },
  } as ProactiveInsight;
}

// ── Issue 2: carrier-labeling insight ───────────────────────
describe('carrier-labeling insight — clear, evidence-honest wording', () => {
  it('uses the detector-measured share (never a fabricated count) in EN/ES/PT', () => {
    for (const [lang, needle] of [['en', 'About 23% of recent phone transactions are missing a carrier'],
                                  ['es', 'Cerca del 23% de las transacciones de telefonía recientes'],
                                  ['pt', 'Cerca de 23% das transações recentes de telefonia']] as const) {
      const card = buildInsightCard(carrierGapInsight(0.23), lang);
      expect(card.headline).toContain(needle);
    }
  });

  it('falls back to honest non-numeric wording when the detector supplies no ratio', () => {
    const card = buildInsightCard(carrierGapInsight(null), 'en');
    expect(card.headline).toBe('Some recent phone transactions are missing a carrier assignment.');
    expect(card.headline).not.toMatch(/\d/);   // no implied precision
  });

  it('explains WHY it matters (incomplete carrier reports) with concrete carrier examples', () => {
    for (const lang of ['en', 'es', 'pt'] as const) {
      const card = buildInsightCard(carrierGapInsight(0.23), lang);
      expect(card.summary).toContain('AT&T');
      expect(card.summary).toContain('Verizon');
      expect(card.summary.toLowerCase()).toMatch(/incomplet/); // incomplete/incompletos/incompletos
    }
  });

  it('carries the direct action and the Review-transactions CTA', () => {
    const en = buildInsightCard(carrierGapInsight(0.23), 'en');
    expect(en.recommendation).toBe('Review and assign the correct carrier.');
    expect(en.ctaLabel).toBe('Review transactions');
    expect(buildInsightCard(carrierGapInsight(0.23), 'es').ctaLabel).toBe('Revisar transacciones');
    expect(buildInsightCard(carrierGapInsight(0.23), 'pt').ctaLabel).toBe('Revisar transações');
    // The CTA survives grouping as a singleton group CTA.
    const groups = groupCards(orderCards([buildInsightCard(carrierGapInsight(0.23), 'en')]), 'en');
    expect(groups[0].ctaLabel).toBe('Review transactions');
  });

  it('severity, confidence and identity pass through unchanged', () => {
    const insight = carrierGapInsight(0.23, 'watch');
    const card = buildInsightCard(insight, 'en');
    expect(card.severity).toBe('watch');
    expect(card.confidence).toBe(0.9);
    expect(card.fingerprint).toBe(insight.fingerprint);
    expect(card.detectorId).toBe('evidence_quality');
  });

  it('other data-quality causes keep their own wording and get NO transactions CTA', () => {
    const cost = buildInsightCard({
      ...carrierGapInsight(0.4),
      evidence: { ...(carrierGapInsight(0.4).evidence as unknown as Record<string, unknown>), cause: 'insufficient_cost_coverage' },
    } as unknown as ProactiveInsight, 'en');
    expect(cost.headline).toContain('missing product costs');
    expect(cost.ctaLabel).toBeUndefined();
  });
});

// ── Issue 2: positive performance group ─────────────────────
describe('positive performance group — honest fallback, no invented contributors', () => {
  it('presents the mandated title/body/action and View-performance CTA in EN/ES/PT', () => {
    const cards = orderCards([buildInsightCard(positive('sales'), 'en'), buildInsightCard(positive('margin'), 'en')]);
    const g = groupCards(cards, 'en').find((x) => x.groupKey === 'business_improving')!;
    expect(g).toBeDefined();
    expect(g.headline).toBe('Sales and profit margin improved');
    expect(g.summary).toBe('Sales and profit margin improved compared with the previous completed period.');
    expect(g.recommendation).toBe('Review the category breakdown to see where the improvement came from.');
    expect(g.ctaLabel).toBe('View performance');

    const es = groupCards(orderCards([buildInsightCard(positive('sales'), 'es'), buildInsightCard(positive('margin'), 'es')]), 'es')
      .find((x) => x.groupKey === 'business_improving')!;
    expect(es.headline).toBe('Las ventas y el margen de ganancia mejoraron');
    expect(es.ctaLabel).toBe('Ver desempeño');
  });

  it('never invents category contributors (no category names in the group text)', () => {
    const cards = orderCards([buildInsightCard(positive('sales'), 'en'), buildInsightCard(positive('margin'), 'en')]);
    const g = groupCards(cards, 'en').find((x) => x.groupKey === 'business_improving')!;
    const text = `${g.headline} ${g.summary} ${g.recommendation}`.toLowerCase();
    for (const invented of ['phone payments', 'accessories', 'repairs', 'contributed most']) {
      expect(text).not.toContain(invented);
    }
    // The exact measured deltas remain available on the member cards.
    expect(g.members).toHaveLength(2);
  });
});

// ── Issue 1: floating launcher structural locks ─────────────
describe('Worth a Look launcher — true floating control', () => {
  const src = readFileSync('src/modules/intelligence/proactive/RecommendationBubble.tsx', 'utf8');

  it('uses fixed viewport positioning clamped OUTSIDE the 285px sidebar', () => {
    expect(src).toContain("position: 'fixed'");
    expect(src).toContain('LAUNCHER_LEFT');
    expect(src).toContain("clamp(16px, calc(100vw - 352px), 305px)");
    expect(src).not.toContain('left: 20,');            // old sidebar-overlapping anchor
  });

  it('keeps aria-expanded, dialog role and adds focus-return on close', () => {
    expect(src).toContain('aria-expanded={open}');
    expect(src).toContain("role=\"dialog\"");
    expect(src).toContain('launcherRef.current?.focus()');
    expect(src).toContain('ref={launcherRef}');
  });

  it('open/close + dismiss behavior remains intact and panel stays viewport-bounded', () => {
    expect(src).toContain('setOpen((v) => !v)');
    expect(src).toContain('setDismissed(true)');
    expect(src).toContain("maxWidth: '86vw'");
    expect(src).toContain("maxHeight: '60vh'");
    expect(src).toContain('openManager');               // safe fallback preserved
  });
});
