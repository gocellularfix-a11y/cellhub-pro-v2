// ============================================================
// I6-0 — Proactive Insight foundation tests.
//
// Deterministic fixtures with an explicit reference date through the REAL
// engine API (engine.getProactiveInsights → canonical computeForRange).
// Locks: window math (full days, no overlap, no partial today), canonical
// values, threshold behavior in both directions, honest insufficiency,
// confidence bands, determinism, structure-only output (no free text).
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { resolveAnalysisWindows, ANALYSIS_WINDOW_DAYS } from './analysisWindow';
import { evaluateEvidenceConfidence, CONFIDENCE_BANDS } from './confidence';
import {
  SALES_MATERIAL_CHANGE_PCT, SALES_CRITICAL_DECLINE_PCT,
  MIN_BASELINE_REVENUE_CENTS, MIN_WINDOW_TRANSACTIONS, MIN_CONFIDENCE,
} from './thresholds';
import type { ProactiveEvidence } from './types';
import type { Customer, Sale, SaleItem } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);   // Wed 2026-07-15
// current window  = 2026-07-08 … 2026-07-14 (7 full days, ends yesterday)
// baseline window = 2026-07-01 … 2026-07-07 (previous 7, no overlap)

let seq = 0;
const item = (price: number, name = 'Case'): SaleItem =>
  ({ id: `it-${++seq}`, name, category: 'accessory' as SaleItem['category'], price, qty: 1, cost: Math.round(price / 2), cbeEligible: false, taxable: true } as SaleItem);
const sale = (createdAt: string, price: number): Sale =>
  ({ id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items: [item(price)], subtotal: price, taxAmount: 0, cbeTotal: 0, total: price,
     paymentMethod: 'cash', status: 'completed', createdAt, employeeName: 'Ana' } as unknown as Sale);

function engineWith(sales: Sale[]): IntelligenceEngine {
  return new IntelligenceEngine(
    sales, [] as Customer[], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
  );
}
/** N sales of `each` cents spread across the window days (deterministic). */
function windowSales(startDay: number, month: string, n: number, each: number): Sale[] {
  return Array.from({ length: n }, (_, i) => sale(`2026-${month}-${String(startDay + (i % 7)).padStart(2, '0')}T10:00:00`, each));
}

describe('I6-0 — analysis windows (pure)', () => {
  it('current = 7 FULL days ending yesterday; baseline = previous 7; no overlap; no partial today', () => {
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
  it('month boundary resolves correctly (reference Jul 3 → baseline reaches June)', () => {
    const w = resolveAnalysisWindows(new Date(2026, 6, 3, 9, 0, 0));
    expect(w.current.startYMD).toBe('2026-06-26');
    expect(w.current.endYMD).toBe('2026-07-02');
    expect(w.baseline.startYMD).toBe('2026-06-19');
    expect(w.baseline.endYMD).toBe('2026-06-25');
  });
  it('deterministic: same reference date → identical windows', () => {
    expect(resolveAnalysisWindows(REF)).toEqual(resolveAnalysisWindows(REF));
  });
});

describe('I6-0 — sales material change detector (live engine API)', () => {
  it('material INCREASE emits a positive insight with full evidence + thresholds', () => {
    // baseline: 5 × $40 = $200 · current: 5 × $60 = $300 → +50%
    const engine = engineWith([...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)]);
    const r = engine.getProactiveInsights(REF);
    expect(r.insights).toHaveLength(1);
    const i = r.insights[0];
    expect(i.kind).toBe('sales_material_change');
    expect(i.direction).toBe('increase');
    expect(i.severity).toBe('positive');
    expect(i.id).toBe('sales_material_change:2026-07-08:2026-07-14');
    expect(i.evidence.baselineCents).toBe(20000);
    expect(i.evidence.currentCents).toBe(30000);
    expect(i.evidence.changePct).toBe(50);
    expect(i.evidence.sourceKind).toBe('canonical_report_money');
    expect(i.thresholds.materialChangePct).toBe(SALES_MATERIAL_CHANGE_PCT);
    expect(i.confidence).toBe(CONFIDENCE_BANDS.moderateSample);   // 10 tx combined
    expect(r.evaluations[0].status).toBe('emitted');
  });
  it('material DECLINE emits warning; 40%+ decline is critical', () => {
    // warning: $300 → $200 = −33.3%
    const warn = engineWith([...windowSales(1, '07', 5, 6000), ...windowSales(8, '07', 5, 4000)])
      .getProactiveInsights(REF).insights[0];
    expect(warn.direction).toBe('decline');
    expect(warn.severity).toBe('warning');
    expect(warn.evidence.changePct).toBe(-33.3);
    // critical: $500 → $200 = −60%
    const crit = engineWith([...windowSales(1, '07', 5, 10000), ...windowSales(8, '07', 5, 4000)])
      .getProactiveInsights(REF).insights[0];
    expect(crit.severity).toBe('critical');
    expect(crit.evidence.changePct).toBeLessThanOrEqual(-SALES_CRITICAL_DECLINE_PCT);
  });
  it('below-threshold change emits NOTHING but stays auditable', () => {
    // $200 → $220 = +10% < 20%
    const r = engineWith([...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 4400)]).getProactiveInsights(REF);
    expect(r.insights).toHaveLength(0);
    expect(r.evaluations[0].status).toBe('below_threshold');
    expect(r.evaluations[0].evidence.changePct).toBe(10);
  });
  it('honest insufficiency: thin windows, sub-floor baseline and zero baseline never claim anything', () => {
    // (a) thin: 2 tx per window < MIN_WINDOW_TRANSACTIONS.
    const thin = engineWith([...windowSales(1, '07', 2, 4000), ...windowSales(8, '07', 2, 8000)]).getProactiveInsights(REF);
    expect(thin.insights).toHaveLength(0);
    expect(thin.evaluations[0].status).toBe('insufficient_evidence');
    expect(thin.evaluations[0].confidence).toBe(CONFIDENCE_BANDS.insufficient);
    // (b) sub-floor baseline: 4 × $20 = $80 < $100 floor.
    const subFloor = engineWith([...windowSales(1, '07', 4, 2000), ...windowSales(8, '07', 5, 8000)]).getProactiveInsights(REF);
    expect(subFloor.evaluations[0].status).toBe('insufficient_evidence');
    expect(subFloor.evaluations[0].evidence.baselineCents).toBeLessThan(MIN_BASELINE_REVENUE_CENTS);
    // (c) zero baseline: changePct is null, never Infinity.
    const zero = engineWith(windowSales(8, '07', 5, 8000)).getProactiveInsights(REF);
    expect(zero.insights).toHaveLength(0);
    expect(zero.evaluations[0].evidence.changePct).toBeNull();
    // (d) no data at all.
    const empty = engineWith([]).getProactiveInsights(REF);
    expect(empty.insights).toHaveLength(0);
    expect(empty.evaluations[0].status).toBe('insufficient_evidence');
  });
  it("today's partial sales never move the windows (sale dated on the reference day is ignored)", () => {
    const base = [...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)];
    const withToday = [...base, sale('2026-07-15T09:00:00', 99999)];
    expect(engineWith(withToday).getProactiveInsights(REF)).toEqual(engineWith(base).getProactiveInsights(REF));
  });
  it('deterministic: identical inputs → identical result, repeated', () => {
    const build = () => engineWith([...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)]).getProactiveInsights(REF);
    expect(build()).toEqual(build());
  });
  it('structure-only contract: no free-text fields anywhere in the result', () => {
    const r = engineWith([...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)]).getProactiveInsights(REF);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/text|message|title|description/);
    expect(json).not.toMatch(/undefined|NaN|Infinity/);
  });
});

describe('I6-0 — confidence bands (pure contract)', () => {
  const ev = (cur: number, base: number): ProactiveEvidence => ({
    metric: 'gross_sales', sourceKind: 'canonical_report_money',
    windows: resolveAnalysisWindows(REF),
    currentCents: 100000, baselineCents: 100000,
    currentTransactionCount: cur, baselineTransactionCount: base, changePct: 0,
  });
  it('bands are deterministic and exported', () => {
    expect(evaluateEvidenceConfidence(ev(2, 20))).toBe(CONFIDENCE_BANDS.insufficient);
    expect(evaluateEvidenceConfidence(ev(MIN_WINDOW_TRANSACTIONS, MIN_WINDOW_TRANSACTIONS))).toBe(CONFIDENCE_BANDS.smallSample);
    expect(evaluateEvidenceConfidence(ev(5, 5))).toBe(CONFIDENCE_BANDS.moderateSample);
    expect(evaluateEvidenceConfidence(ev(15, 15))).toBe(CONFIDENCE_BANDS.strongSample);
    expect(MIN_CONFIDENCE).toBeGreaterThan(CONFIDENCE_BANDS.insufficient);
  });
});
