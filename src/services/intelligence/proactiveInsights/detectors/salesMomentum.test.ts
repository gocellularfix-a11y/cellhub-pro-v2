// ============================================================
// I6-0A — Detector 1 tests: sales momentum (canonical 7v7 gross sales).
//
// Locks: growth/decline/stability, insufficient sample, absent baseline,
// honest zero baseline (changePct null, never Infinity), complete periods,
// canonical refund/void semantics, confidence reasons, store scope.
// ============================================================

import { describe, it, expect } from 'vitest';
import { scopeCollection } from '@/store/storeScope';
import { salesMomentumDetector } from './salesMomentumDetector';
import { CONFIDENCE_BANDS } from '../confidence';
import { MIN_BASELINE_REVENUE_CENTS, SALES_CRITICAL_DECLINE_PCT, SALES_MATERIAL_CHANGE_PCT } from '../thresholds';
import type { SalesMomentumEvidence } from '../types';
import { engineWith, windowSales, sale, contextOf } from '../testHarness';

const run = (sales: Parameters<typeof engineWith>[0], storeId?: string) =>
  salesMomentumDetector.run(contextOf(engineWith(sales, storeId)));

describe('I6-0A — sales momentum detector', () => {
  it('material GROWTH emits watch/positive with full canonical evidence', () => {
    // baseline: 5 × $40 = $200 · current: 5 × $60 = $300 → +50%
    const r = run([...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)]);
    expect(r.insights).toHaveLength(1);
    const i = r.insights[0];
    expect(i.detectorId).toBe('sales_momentum');
    expect(i.category).toBe('sales');
    expect(i.direction).toBe('positive');
    expect(i.severity).toBe('watch');
    const ev = i.evidence as SalesMomentumEvidence;
    expect(ev.baselineCents).toBe(20000);
    expect(ev.currentCents).toBe(30000);
    expect(ev.changePct).toBe(50);
    expect(ev.sourceKind).toBe('canonical_report_money');
    expect(i.thresholds.materialChangePct).toBe(SALES_MATERIAL_CHANGE_PCT);
    expect(i.confidence).toBe(CONFIDENCE_BANDS.moderateSample);   // 10 tx combined
    expect(i.confidenceReasons).toEqual(['complete_periods', 'moderate_sample']);
    expect(i.fingerprint).toBe(
      'sales_momentum:single_store:sales:2026-07-08..2026-07-14|2026-07-01..2026-07-07:gross_sales:positive',
    );
    expect(r.diagnostic.status).toBe('emitted');
  });
  it('material DECLINE is important; decline ≥ 40% is critical', () => {
    // important: $300 → $200 = −33.3%
    const warn = run([...windowSales(1, '07', 5, 6000), ...windowSales(8, '07', 5, 4000)]).insights[0];
    expect(warn.direction).toBe('negative');
    expect(warn.severity).toBe('important');
    expect((warn.evidence as SalesMomentumEvidence).changePct).toBe(-33.3);
    // critical: $500 → $200 = −60%
    const crit = run([...windowSales(1, '07', 5, 10000), ...windowSales(8, '07', 5, 4000)]).insights[0];
    expect(crit.severity).toBe('critical');
    expect((crit.evidence as SalesMomentumEvidence).changePct).toBeLessThanOrEqual(-SALES_CRITICAL_DECLINE_PCT);
  });
  it('irrelevant change is SUPPRESSED but stays auditable', () => {
    // $200 → $220 = +10% < 20%
    const r = run([...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 4400)]);
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostic.status).toBe('below_threshold');
    expect(r.diagnostic.reasons).toEqual(['change_below_material_threshold']);
    expect((r.diagnostic.evidence as SalesMomentumEvidence).changePct).toBe(10);
  });
  it('honest insufficiency: thin windows, sub-floor baseline, zero baseline, absent baseline, no data', () => {
    // (a) thin: 2 tx per window < MIN_WINDOW_TRANSACTIONS.
    const thin = run([...windowSales(1, '07', 2, 4000), ...windowSales(8, '07', 2, 8000)]);
    expect(thin.insights).toHaveLength(0);
    expect(thin.diagnostic.status).toBe('insufficient_evidence');
    expect(thin.diagnostic.confidence).toBe(CONFIDENCE_BANDS.insufficient);
    // (b) sub-floor baseline: 4 × $20 = $80 < $100 floor.
    const subFloor = run([...windowSales(1, '07', 4, 2000), ...windowSales(8, '07', 5, 8000)]);
    expect(subFloor.diagnostic.status).toBe('insufficient_evidence');
    expect(subFloor.diagnostic.reasons).toContain('baseline_below_revenue_floor');
    expect((subFloor.diagnostic.evidence as SalesMomentumEvidence).baselineCents).toBeLessThan(MIN_BASELINE_REVENUE_CENTS);
    // (c) absent baseline (no baseline-window sales): changePct null, never Infinity.
    const zero = run(windowSales(8, '07', 5, 8000));
    expect(zero.insights).toHaveLength(0);
    expect((zero.diagnostic.evidence as SalesMomentumEvidence).changePct).toBeNull();
    expect(zero.diagnostic.reasons).toContain('zero_baseline');
    // (d) zero-total baseline sales present (voided): still null, still honest.
    const voidedBaseline = run([
      ...windowSales(1, '07', 5, 6000).map((s) => ({ ...s, status: 'voided' })),
      ...windowSales(8, '07', 5, 8000),
    ] as never);
    expect((voidedBaseline.diagnostic.evidence as SalesMomentumEvidence).changePct).toBeNull();
    expect(voidedBaseline.insights).toHaveLength(0);
    // (e) no data at all.
    const empty = run([]);
    expect(empty.insights).toHaveLength(0);
    expect(empty.diagnostic.status).toBe('insufficient_evidence');
  });
  it('canonical refund/void semantics: refund-audit rows and voided sales never move GROSS momentum', () => {
    const base = [...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)];
    const noisy = [
      ...base,
      sale('2026-07-10T10:00:00', -5000, { invoiceNumber: 'REFUND-77', isRefund: true }),  // refund-representation row
      sale('2026-07-11T10:00:00', 99999, { status: 'voided' }),                            // voided sale
    ];
    const clean = run(base);
    const withNoise = run(noisy);
    expect((withNoise.diagnostic.evidence as SalesMomentumEvidence).currentCents)
      .toBe((clean.diagnostic.evidence as SalesMomentumEvidence).currentCents);
    expect((withNoise.diagnostic.evidence as SalesMomentumEvidence).currentTransactionCount)
      .toBe((clean.diagnostic.evidence as SalesMomentumEvidence).currentTransactionCount);
    expect(withNoise.insights[0].severity).toBe(clean.insights[0].severity);
  });
  it('complete periods only: reference-day sales are ignored (windows end yesterday)', () => {
    const base = [...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)];
    const withToday = [...base, sale('2026-07-15T09:00:00', 99999)];
    expect(run(withToday)).toEqual(run(base));
  });
  it('store scope: other-store sales never affect the detector', () => {
    const storeA = [...windowSales(1, '07', 5, 4000, { storeId: 'store-a' }), ...windowSales(8, '07', 5, 6000, { storeId: 'store-a' })];
    const storeB = [...windowSales(1, '07', 7, 99000, { storeId: 'store-b' }), ...windowSales(8, '07', 7, 500, { storeId: 'store-b' })];
    const scoped = scopeCollection([...storeA, ...storeB], 'store-a', false);
    expect(run(scoped, 'store-a')).toEqual(run(storeA, 'store-a'));
    expect(run(scoped, 'store-a').insights[0].direction).toBe('positive');
  });
  it('deterministic: identical inputs → identical result (fingerprint included)', () => {
    const build = () => run([...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)]);
    expect(build()).toEqual(build());
  });
});
