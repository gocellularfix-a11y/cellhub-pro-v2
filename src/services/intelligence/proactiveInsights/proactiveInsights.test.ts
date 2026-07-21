// ============================================================
// I6-0A — Proactive Insight foundation: windows + engine contract.
//
// Locks: window math (full local days, no overlap, no partial today, DST-
// safe local-calendar arithmetic, 30-day carrier window), engine behavior
// (deterministic registry order, failure isolation, finite-number guard,
// fingerprint dedup, stable ordering, result cap, injected referenceDate,
// store scope, structure-only output) and the confidence band contract.
// ============================================================

import { describe, it, expect } from 'vitest';
import { scopeCollection } from '@/store/storeScope';
import { runProactiveInsightDetectors, PROACTIVE_DETECTORS, hasNonFinitePublicValue } from './proactiveInsightEngine';
import { resolveAnalysisWindows, resolveTrailingWindow, resolveCarrierWindow, ANALYSIS_WINDOW_DAYS } from './analysisWindow';
import { sampleBandConfidence, capConfidence, CONFIDENCE_BANDS } from './confidence';
import { buildFingerprint } from './fingerprint';
import { MIN_WINDOW_TRANSACTIONS, MIN_CONFIDENCE, MAX_INSIGHTS_PER_RUN, CARRIER_WINDOW_DAYS } from './thresholds';
import type { ProactiveInsight, ProactiveInsightDetector } from './types';
import { REF, engineWith, windowSales, sale } from './testHarness';

describe('I6-0A — analysis windows (pure, shared)', () => {
  it('7v7: current = 7 FULL days ending yesterday; baseline = previous 7; no overlap; no partial today', () => {
    const w = resolveAnalysisWindows(REF);
    expect(w.referenceYMD).toBe('2026-07-15');
    expect(w.current.startYMD).toBe('2026-07-08');
    expect(w.current.endYMD).toBe('2026-07-14');       // yesterday, never today
    expect(w.baseline.startYMD).toBe('2026-07-01');
    expect(w.baseline.endYMD).toBe('2026-07-07');      // ends the day BEFORE current starts
    expect(w.current.dayCount).toBe(ANALYSIS_WINDOW_DAYS);
    expect(w.current.range.valid).toBe(true);
    expect(w.baseline.range.valid).toBe(true);
  });
  it('30-day carrier window: 30 full local days ending yesterday', () => {
    const w = resolveCarrierWindow(REF);
    expect(w.startYMD).toBe('2026-06-15');
    expect(w.endYMD).toBe('2026-07-14');
    expect(w.dayCount).toBe(CARRIER_WINDOW_DAYS);
    expect(w.range.valid).toBe(true);
  });
  it('month boundary resolves correctly (reference Jul 3 → baseline reaches June)', () => {
    const w = resolveAnalysisWindows(new Date(2026, 6, 3, 9, 0, 0));
    expect(w.current.startYMD).toBe('2026-06-26');
    expect(w.current.endYMD).toBe('2026-07-02');
    expect(w.baseline.startYMD).toBe('2026-06-19');
    expect(w.baseline.endYMD).toBe('2026-06-25');
  });
  it('DST transition (US spring-forward Mar 8 2026) never skews a local day', () => {
    const w = resolveAnalysisWindows(new Date(2026, 2, 12, 9, 0, 0));  // Mar 12
    expect(w.current.startYMD).toBe('2026-03-05');
    expect(w.current.endYMD).toBe('2026-03-11');       // crosses Mar 8 DST
    expect(w.baseline.startYMD).toBe('2026-02-26');
    expect(w.baseline.endYMD).toBe('2026-03-04');
  });
  it('trailing helper is pure and deterministic', () => {
    expect(resolveTrailingWindow(REF, 7, 'current_7_full_days')).toEqual(resolveAnalysisWindows(REF).current);
    expect(resolveAnalysisWindows(REF)).toEqual(resolveAnalysisWindows(REF));
  });
});

describe('I6-0A — engine contract', () => {
  const materialGrowth = () => [...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)];

  it('registry order is the mandated deterministic order', () => {
    expect(PROACTIVE_DETECTORS.map((d) => d.id)).toEqual([
      'sales_momentum', 'gross_margin_pressure', 'carrier_concentration', 'evidence_quality',
    ]);
  });
  it('same snapshot + same referenceDate → identical result (fingerprints included), repeated', () => {
    const build = () => engineWith(materialGrowth()).getProactiveInsights(REF);
    expect(build()).toEqual(build());
  });
  it('one diagnostic per registered detector, every run', () => {
    const r = engineWith(materialGrowth()).getProactiveInsights(REF);
    expect(r.diagnostics.map((d) => d.detectorId)).toEqual(PROACTIVE_DETECTORS.map((d) => d.id));
  });
  it('injected reference date moves the windows; no real-clock dependence', () => {
    const engine = engineWith(materialGrowth());
    const a = engine.getProactiveInsights(REF);
    const b = engine.getProactiveInsights(new Date(2026, 6, 22, 12, 0, 0));
    expect(a.referenceYMD).toBe('2026-07-15');
    expect(b.referenceYMD).toBe('2026-07-22');
    expect(a).not.toEqual(b);
  });
  it("today's partial sales never move the result (sale dated on the reference day is ignored)", () => {
    const base = materialGrowth();
    const withToday = [...base, sale('2026-07-15T09:00:00', 99999)];
    expect(engineWith(withToday).getProactiveInsights(REF)).toEqual(engineWith(base).getProactiveInsights(REF));
  });

  // ── isolation / guard / dedup / cap (stub detectors — engine mechanics) ──
  const stubInsight = (fingerprint: string, severity: ProactiveInsight['severity'] = 'info'): ProactiveInsight => ({
    fingerprint, detectorId: 'sales_momentum', category: 'sales', severity,
    direction: 'neutral', confidence: 0.9, confidenceReasons: ['complete_periods'],
    evidence: {
      detectorId: 'sales_momentum', metric: 'gross_sales', sourceKind: 'canonical_report_money',
      windows: resolveAnalysisWindows(REF), currentCents: 1, baselineCents: 1,
      currentTransactionCount: 5, baselineTransactionCount: 5, changePct: 0,
    },
    thresholds: {},
  });
  const okDetector = (fingerprints: string[], severity?: ProactiveInsight['severity']): ProactiveInsightDetector => ({
    id: 'sales_momentum', category: 'sales',
    run: () => ({
      insights: fingerprints.map((f) => stubInsight(f, severity)),
      diagnostic: { detectorId: 'sales_momentum', status: 'emitted', reasons: [], evidence: null, confidence: 0.9, emittedCount: fingerprints.length },
    }),
  });

  it('a throwing detector is ISOLATED as detector_error — others still run, no fake insights', () => {
    const boom: ProactiveInsightDetector = {
      id: 'gross_margin_pressure', category: 'margin',
      run: () => { throw new Error('boom'); },
    };
    const ctx = engineWith(materialGrowth()).getStructuredQueryContext(REF);
    const r = runProactiveInsightDetectors(ctx, [okDetector(['a']), boom]);
    expect(r.insights).toHaveLength(1);
    expect(r.diagnostics[1].status).toBe('detector_error');
    expect(r.diagnostics[1].reasons).toEqual(['detector_exception']);
    expect(r.diagnostics[1].emittedCount).toBe(0);
  });
  it('non-finite public numbers demote the whole detector to detector_error (fail safe)', () => {
    const bad: ProactiveInsightDetector = {
      id: 'carrier_concentration', category: 'carriers',
      run: () => {
        const i = stubInsight('bad');
        (i as unknown as { confidence: number }).confidence = Number.NaN;
        return { insights: [i], diagnostic: { detectorId: 'carrier_concentration', status: 'emitted', reasons: [], evidence: null, confidence: 0.9, emittedCount: 1 } };
      },
    };
    const ctx = engineWith(materialGrowth()).getStructuredQueryContext(REF);
    const r = runProactiveInsightDetectors(ctx, [bad]);
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostics[0].status).toBe('detector_error');
    expect(r.diagnostics[0].reasons).toEqual(['non_finite_public_number']);
  });
  it('duplicate fingerprints dedup (first occurrence wins)', () => {
    const ctx = engineWith(materialGrowth()).getStructuredQueryContext(REF);
    const r = runProactiveInsightDetectors(ctx, [okDetector(['dup', 'dup', 'unique'])]);
    expect(r.insights.map((i) => i.fingerprint).sort()).toEqual(['dup', 'unique']);
  });
  it('stable ordering: severity rank → category → fingerprint; cap applies after sort', () => {
    const many = Array.from({ length: MAX_INSIGHTS_PER_RUN + 5 }, (_, i) => `fp-${String(i).padStart(2, '0')}`);
    const ctx = engineWith(materialGrowth()).getStructuredQueryContext(REF);
    const r = runProactiveInsightDetectors(ctx, [okDetector(['z-info']), okDetector(['a-critical'], 'critical'), okDetector(many)]);
    expect(r.insights).toHaveLength(MAX_INSIGHTS_PER_RUN);
    expect(r.insights[0].fingerprint).toBe('a-critical');     // critical outranks info
    const rest = r.insights.slice(1).map((i) => i.fingerprint);
    expect(rest).toEqual([...rest].sort());                    // fingerprint-stable within band
  });

  // ── live integration: real registry over a rich fixture ──
  it('live run: insights are severity-ordered, fingerprint-deduped and capped', () => {
    // Critical sales decline + margin collapse + carrier concentration
    // (structured June phone payments: inside the 30-day carrier window,
    // outside both 7v7 windows — I6-0B strict population).
    const baseline = windowSales(1, '07', 7, 20000, { itemOpts: { cost: 12000 } });   // margin 40%
    const current = windowSales(8, '07', 7, 8000, { itemOpts: { cost: 6400 } });      // margin 20%, −60% sales
    const carrierJune = windowSales(16, '06', 12, 5000, { itemOpts: { carrier: 'Verizon', name: 'Bill Payment', category: 'phone_payment' } });
    const r = engineWith([...baseline, ...current, ...carrierJune]).getProactiveInsights(REF);
    expect(r.insights.length).toBeGreaterThanOrEqual(3);
    expect(r.insights.length).toBeLessThanOrEqual(MAX_INSIGHTS_PER_RUN);
    const ranks = { critical: 0, important: 1, watch: 2, info: 3 } as const;
    const order = r.insights.map((i) => ranks[i.severity]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(r.insights.map((i) => i.fingerprint)).size).toBe(r.insights.length);
    expect(hasNonFinitePublicValue(r)).toBe(false);
  });
  it('structure-only contract: no free-text fields, no undefined/NaN/Infinity anywhere', () => {
    const r = engineWith(materialGrowth()).getProactiveInsights(REF);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/text|message|title|description/);
    expect(json).not.toMatch(/undefined|NaN|Infinity/);
  });

  // ── store scope: mixed two-store data through the CANONICAL mechanism ──
  it('store scope: other-store records never affect the scoped result (canonical scopeCollection)', () => {
    const storeA = [
      ...windowSales(1, '07', 5, 4000, { storeId: 'store-a' }),
      ...windowSales(8, '07', 5, 6000, { storeId: 'store-a' }),
    ];
    const storeB = [
      ...windowSales(1, '07', 7, 99000, { storeId: 'store-b', itemOpts: { cost: 0, carrier: 'Cricket' } }),
      ...windowSales(8, '07', 7, 1000, { storeId: 'store-b', itemOpts: { cost: 0, carrier: 'Cricket' } }),
    ];
    const scoped = scopeCollection([...storeA, ...storeB], 'store-a', false);
    const mixed = engineWith(scoped, 'store-a').getProactiveInsights(REF);
    const pure = engineWith(storeA, 'store-a').getProactiveInsights(REF);
    expect(mixed).toEqual(pure);                                   // B leaked nothing
    const momentum = mixed.insights.find((i) => i.detectorId === 'sales_momentum');
    expect(momentum).toBeDefined();
    expect(momentum!.direction).toBe('positive');                  // B alone would be a crash −99%
    expect(momentum!.fingerprint).toContain(':store-a:');          // store in fingerprint
  });
});

describe('I6-0A — confidence bands (pure contract)', () => {
  it('bands are deterministic, reasons explain every value', () => {
    expect(sampleBandConfidence(2, 20)).toEqual({ value: CONFIDENCE_BANDS.insufficient, reasons: ['complete_periods', 'insufficient_sample'] });
    expect(sampleBandConfidence(MIN_WINDOW_TRANSACTIONS, MIN_WINDOW_TRANSACTIONS)).toEqual({ value: CONFIDENCE_BANDS.smallSample, reasons: ['complete_periods', 'small_sample'] });
    expect(sampleBandConfidence(5, 5)).toEqual({ value: CONFIDENCE_BANDS.moderateSample, reasons: ['complete_periods', 'moderate_sample'] });
    expect(sampleBandConfidence(15, 15)).toEqual({ value: CONFIDENCE_BANDS.strongSample, reasons: ['complete_periods', 'strong_sample'] });
    expect(MIN_CONFIDENCE).toBeGreaterThan(CONFIDENCE_BANDS.insufficient);
  });
  it('capConfidence lowers value, records the reason once, never raises', () => {
    const base = sampleBandConfidence(15, 15);
    const capped = capConfidence(base, 0.5, 'low_cost_coverage');
    expect(capped.value).toBe(0.5);
    expect(capped.reasons).toContain('low_cost_coverage');
    expect(capConfidence(capped, 0.7, 'low_cost_coverage')).toEqual(capped);  // no raise, no dup
  });
  it('fingerprints derive ONLY from detector/store/category/ranges/dimension/direction', () => {
    const fp = buildFingerprint({
      detectorId: 'sales_momentum', storeId: null, category: 'sales',
      ranges: [{ startYMD: '2026-07-08', endYMD: '2026-07-14' }, { startYMD: '2026-07-01', endYMD: '2026-07-07' }],
      dimension: 'gross_sales', direction: 'negative',
    });
    expect(fp).toBe('sales_momentum:single_store:sales:2026-07-08..2026-07-14|2026-07-01..2026-07-07:gross_sales:negative');
  });
});
