// ============================================================
// I6-0A — Detector 2 tests: gross margin pressure.
//
// Locks: percentage-POINT math (40% → 32% = −8, NEVER "−20% margin"),
// deterioration/critical/improvement/stability, low cost coverage
// suppression (ownership → evidence_quality), zero revenue, invalid
// denominator, canonical parity, store scope.
// ============================================================

import { describe, it, expect } from 'vitest';
import { scopeCollection } from '@/store/storeScope';
import { grossMarginPressureDetector } from './grossMarginPressureDetector';
import { MARGIN_CRITICAL_DROP_POINTS, MIN_COST_COVERAGE_FOR_MARGIN_CLAIM } from '../thresholds';
import { resolveAnalysisWindows } from '../analysisWindow';
import type { GrossMarginPressureEvidence } from '../types';
import { REF, engineWith, windowSales, contextOf } from '../testHarness';

const run = (sales: Parameters<typeof engineWith>[0], storeId?: string) =>
  grossMarginPressureDetector.run(contextOf(engineWith(sales, storeId)));

// 5 sales of $200 per window; margin controlled entirely by item cost.
const week = (startDay: number, costCents: number) =>
  windowSales(startDay, '07', 5, 20000, { itemOpts: { cost: costCents } });

describe('I6-0A — gross margin pressure detector', () => {
  it('MANDATED example: 40% → 32% is marginChangePoints −8 (percentage points, NOT −20%)', () => {
    const r = run([...week(1, 12000), ...week(8, 13600)]);   // 40% → 32%
    expect(r.insights).toHaveLength(1);
    const i = r.insights[0];
    const ev = i.evidence as GrossMarginPressureEvidence;
    expect(ev.baselineMarginPct).toBe(40);
    expect(ev.currentMarginPct).toBe(32);
    expect(ev.marginChangePoints).toBe(-8);                  // the point of the contract
    expect(ev.currentGrossSalesCents).toBe(100000);
    expect(ev.currentGrossProfitCents).toBe(32000);
    expect(i.category).toBe('margin');
    expect(i.direction).toBe('negative');
    expect(i.severity).toBe('important');                    // −8 < critical 10
    expect(r.diagnostic.status).toBe('emitted');
  });
  it('drop of 10+ percentage points is critical', () => {
    const r = run([...week(1, 12000), ...week(8, 14400)]);   // 40% → 28% = −12
    expect((r.insights[0].evidence as GrossMarginPressureEvidence).marginChangePoints).toBe(-12);
    expect(r.insights[0].severity).toBe('critical');
    expect(Math.abs((r.insights[0].evidence as GrossMarginPressureEvidence).marginChangePoints!))
      .toBeGreaterThanOrEqual(MARGIN_CRITICAL_DROP_POINTS);
  });
  it('material IMPROVEMENT emits positive movement — never labeled pressure/negative', () => {
    const r = run([...week(1, 14000), ...week(8, 12000)]);   // 30% → 40% = +10
    expect(r.insights).toHaveLength(1);
    expect(r.insights[0].direction).toBe('positive');
    expect(r.insights[0].severity).toBe('watch');
    expect((r.insights[0].evidence as GrossMarginPressureEvidence).marginChangePoints).toBe(10);
  });
  it('irrelevant change is suppressed but auditable', () => {
    const r = run([...week(1, 12000), ...week(8, 11600)]);   // 40% → 42% = +2
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostic.status).toBe('below_threshold');
    expect(r.diagnostic.reasons).toEqual(['margin_change_below_material_threshold']);
  });
  it('LOW COST COVERAGE: margin conclusion is never presented as fact; confidence capped with reason', () => {
    // Current window: 2 costed + 3 zero-cost sales → coverage 0.4 < 0.7.
    const current = [
      ...windowSales(8, '07', 2, 20000, { itemOpts: { cost: 12000 } }),
      ...windowSales(10, '07', 3, 20000, { itemOpts: { cost: 0 } }),
    ];
    const r = run([...week(1, 12000), ...current]);
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostic.status).toBe('insufficient_evidence');
    expect(r.diagnostic.reasons).toEqual(['low_cost_coverage']);
    const ev = r.diagnostic.evidence as GrossMarginPressureEvidence;
    expect(ev.currentCostCoverage).toBe(0.4);
    expect(ev.currentCostCoverage!).toBeLessThan(MIN_COST_COVERAGE_FOR_MARGIN_CLAIM);
  });
  it('zero revenue / invalid denominator: margin is never fabricated as 0%', () => {
    // No current-window sales at all → profitMarginMeaningful false.
    const r = run(week(1, 12000));
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostic.status).toBe('insufficient_evidence');
    expect(r.diagnostic.reasons).toEqual(['invalid_margin_denominator']);
    const ev = r.diagnostic.evidence as GrossMarginPressureEvidence;
    expect(ev.currentMarginPct).toBeNull();
    expect(ev.marginChangePoints).toBeNull();
  });
  it('canonical parity: evidence margins EQUAL the canonical profitMargin fields', () => {
    const engine = engineWith([...week(1, 12000), ...week(8, 13600)]);
    const r = grossMarginPressureDetector.run(contextOf(engine));
    const ctx = engine.getStructuredQueryContext(REF);
    const w = resolveAnalysisWindows(REF);
    const cur = ctx.computeForRange(w.current.range);
    const base = ctx.computeForRange(w.baseline.range);
    const ev = r.insights[0].evidence as GrossMarginPressureEvidence;
    expect(cur.profitMarginMeaningful).toBe(true);
    expect(ev.currentMarginPct).toBe(Math.round(cur.profitMargin * 10) / 10);
    expect(ev.baselineMarginPct).toBe(Math.round(base.profitMargin * 10) / 10);
    expect(ev.currentGrossSalesCents).toBe(cur.grossSalesCents);
    expect(ev.currentGrossProfitCents).toBe(cur.totalProfitCents);
  });
  it('store scope: other-store sales never affect the margin', () => {
    const storeA = [...week(1, 12000).map((s) => ({ ...s, storeId: 'store-a' })), ...week(8, 13600).map((s) => ({ ...s, storeId: 'store-a' }))];
    const storeB = windowSales(8, '07', 7, 50000, { storeId: 'store-b', itemOpts: { cost: 0 } });
    const scoped = scopeCollection([...storeA, ...storeB] as never[], 'store-a', false);
    expect(run(scoped as never, 'store-a')).toEqual(run(storeA as never, 'store-a'));
    expect((run(scoped as never, 'store-a').insights[0].evidence as GrossMarginPressureEvidence).marginChangePoints).toBe(-8);
  });
});
