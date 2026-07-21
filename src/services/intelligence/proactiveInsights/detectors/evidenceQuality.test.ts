// ============================================================
// I6-0A — Detector 4 tests: evidence quality (structural root causes).
//
// Locks: low/adequate cost coverage, insufficient history, excessive
// unknown carrier classification, missing customer attribution, stale
// activity, absent activity (supersedes stale), root-cause dedup and the
// ownership contract (business detector suppresses; evidence_quality owns
// the cause ONCE), original totals preserved, store scope.
// ============================================================

import { describe, it, expect } from 'vitest';
import { scopeCollection } from '@/store/storeScope';
import { evidenceQualityDetector } from './evidenceQualityDetector';
import {
  EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE, LOW_COST_COVERAGE, MIN_CUSTOMER_ATTRIBUTION_SHARE,
} from '../thresholds';
import { resolveAnalysisWindows } from '../analysisWindow';
import { customerAttributionShare } from '../evidenceMeasures';
import type { EvidenceQualityEvidence } from '../types';
import { REF, engineWith, windowSales, sale, item, contextOf } from '../testHarness';

const run = (sales: Parameters<typeof engineWith>[0], storeId?: string) =>
  evidenceQualityDetector.run(contextOf(engineWith(sales, storeId)));

const causesOf = (r: ReturnType<typeof run>) =>
  r.insights.map((i) => (i.evidence as EvidenceQualityEvidence).cause).sort();

// Healthy two-week fixture: costed, attributed, current through yesterday.
const healthy = () => [...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 7, 4400)];

describe('I6-0A — evidence quality detector', () => {
  it('healthy data emits NO causes — auditable as below_threshold, never as a health claim', () => {
    const r = run(healthy());
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostic.status).toBe('below_threshold');
    expect(r.diagnostic.reasons).toEqual(['no_quality_issues_detected']);
  });
  it('LOW COST COVERAGE is a structural cause with the measured ratio and ORIGINAL totals preserved', () => {
    const current = windowSales(8, '07', 7, 4400, { itemOpts: { cost: 0 } });
    const r = run([...windowSales(1, '07', 5, 4000), ...current]);
    expect(causesOf(r)).toContain('insufficient_cost_coverage');
    const i = r.insights.find((x) => (x.evidence as EvidenceQualityEvidence).cause === 'insufficient_cost_coverage')!;
    const ev = i.evidence as EvidenceQualityEvidence;
    expect(ev.measuredRatio).toBe(0);
    expect(ev.ratioThreshold).toBe(LOW_COST_COVERAGE);
    expect(ev.currentGrossSalesCents).toBe(7 * 4400);        // totals untouched
    expect(ev.currentTransactionCount).toBe(7);
    expect(i.category).toBe('data_quality');
    expect(i.direction).toBe('neutral');
    expect(i.severity).toBe('watch');
  });
  it('adequate coverage produces no coverage cause', () => {
    expect(causesOf(run(healthy()))).not.toContain('insufficient_cost_coverage');
  });
  it('INSUFFICIENT HISTORY: data that does not span the baseline window is a cause', () => {
    const r = run(windowSales(8, '07', 7, 4400));            // current week only
    expect(causesOf(r)).toContain('insufficient_history');
    const ev = r.insights.find((x) => (x.evidence as EvidenceQualityEvidence).cause === 'insufficient_history')!
      .evidence as EvidenceQualityEvidence;
    expect(ev.earliestActivityYMD).toBe('2026-07-08');       // after baseline start 07-01
  });
  it('EXCESSIVE UNKNOWN CLASSIFICATION: ambiguous CARRIER-ACTIVITY share ≥ threshold is a cause', () => {
    const pure = windowSales(8, '07', 7, 5000, { itemOpts: { carrier: 'Verizon', name: 'Bill Payment', category: 'phone_payment' } });
    const mixed = Array.from({ length: 3 }, (_, i) =>
      sale(`2026-07-${String(9 + i).padStart(2, '0')}T11:00:00`, 7000, {
        items: [item(5000, { carrier: 'Verizon', name: 'Bill Payment', category: 'phone_payment' }), item(2000, { name: 'Case' })],
      }));
    const r = run([...healthy(), ...pure, ...mixed]);        // 10 touching, 3 ambiguous = 0.3
    expect(causesOf(r)).toContain('excessive_unknown_classification');
    const ev = r.insights.find((x) => (x.evidence as EvidenceQualityEvidence).cause === 'excessive_unknown_classification')!
      .evidence as EvidenceQualityEvidence;
    expect(ev.measuredRatio).toBe(0.3);
    expect(ev.ratioThreshold).toBe(EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE);
  });
  it('I6-0B: NORMAL PRODUCTS are outside the carrier population — never "unknown carriers"', () => {
    // Pre-I6-0B these product names were carrier-touching via the legacy
    // name fallback and could explode into data-quality noise.
    const products = [
      'Ultra Case', 'Ultra Screen Protector', 'Verizon Case', 'AT&T Charger',
      'Cricket Tempered Glass', 'Simple Mobile Cable', 'H2O Bottle', 'Page Plus Accessory',
    ].map((name, i) => sale(`2026-07-${String(8 + (i % 7)).padStart(2, '0')}T10:00:00`, 3000, { items: [item(3000, { name })] }));
    const r = run([...healthy(), ...products]);
    expect(causesOf(r)).not.toContain('excessive_unknown_classification');
  });
  it('I6-0B: carrier-activity WITHOUT a structured carrier IS unknown classification', () => {
    // 8 structured + 2 structurally-unknown phone payments → share 0.2.
    const pure = windowSales(8, '07', 8, 5000, { itemOpts: { carrier: 'Verizon', name: 'Bill Payment', category: 'phone_payment' } });
    const unknown = [
      sale('2026-07-09T12:00:00', 5000, { items: [item(5000, { name: 'Bill Payment', category: 'phone_payment' })] }),          // no field
      sale('2026-07-10T12:00:00', 5000, { items: [item(5000, { carrier: 'BansheeTel', category: 'phone_payment' })] }),          // unknown value
    ];
    const r = run([...healthy(), ...pure, ...unknown]);
    expect(causesOf(r)).toContain('excessive_unknown_classification');
    const ev = r.insights.find((x) => (x.evidence as EvidenceQualityEvidence).cause === 'excessive_unknown_classification')!
      .evidence as EvidenceQualityEvidence;
    expect(ev.measuredRatio).toBe(0.2);
  });
  it('MISSING CUSTOMER ATTRIBUTION is measurement-only: NEVER emitted while no active detector requires it', () => {
    // Fully unattributed data — the measurement sees share 0…
    const sales = [...windowSales(1, '07', 5, 4000, { customerId: null }), ...windowSales(8, '07', 7, 4400, { customerId: null })];
    expect(customerAttributionShare(sales as never, resolveAnalysisWindows(REF).current.range)).toBe(0);
    // …but no cause is emitted (future debt is not a current business problem).
    const r = run(sales);
    expect(causesOf(r)).not.toContain('missing_customer_attribution');
    expect(r.insights).toHaveLength(0);
    // The vocabulary and threshold remain reserved for future detectors.
    expect(MIN_CUSTOMER_ATTRIBUTION_SHARE).toBeGreaterThan(0);
  });
  it('STALE ACTIVITY: history exists but nothing recent; ABSENT ACTIVITY supersedes stale', () => {
    // Stale: current window has sales only on 07-08/07-09 (> 3 days before REF).
    const stale = run([...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 2, 4400)]);
    expect(causesOf(stale)).toContain('stale_activity');
    expect(causesOf(stale)).not.toContain('absent_activity');
    const ev = stale.insights.find((x) => (x.evidence as EvidenceQualityEvidence).cause === 'stale_activity')!
      .evidence as EvidenceQualityEvidence;
    expect(ev.lastActivityYMD).toBe('2026-07-09');
    // Absent: nothing in the current window at all → absent only, stale suppressed.
    const absent = run(windowSales(1, '07', 5, 4000));
    expect(causesOf(absent)).toContain('absent_activity');
    expect(causesOf(absent)).not.toContain('stale_activity');
    // Empty dataset: absent_activity, and no history/attribution noise.
    const empty = run([]);
    expect(causesOf(empty)).toEqual(['absent_activity']);
  });
  it('root-cause DEDUP + ownership: margin suppresses on low coverage, evidence_quality owns the cause ONCE', () => {
    const current = windowSales(8, '07', 7, 4400, { itemOpts: { cost: 0 } });
    const engine = engineWith([...windowSales(1, '07', 5, 4000), ...current]);
    const full = engine.getProactiveInsights(REF);
    const marginDiag = full.diagnostics.find((d) => d.detectorId === 'gross_margin_pressure')!;
    expect(marginDiag.status).toBe('insufficient_evidence');
    expect(marginDiag.reasons).toContain('low_cost_coverage');
    expect(full.insights.filter((i) => i.detectorId === 'gross_margin_pressure')).toHaveLength(0);
    const coverageInsights = full.insights.filter(
      (i) => i.detectorId === 'evidence_quality' && (i.evidence as EvidenceQualityEvidence).cause === 'insufficient_cost_coverage');
    expect(coverageInsights).toHaveLength(1);                // exactly once, owned here
  });
  it('each cause appears at most once per run (fingerprint per cause)', () => {
    const r = run([...windowSales(8, '07', 7, 4400, { itemOpts: { cost: 0 }, customerId: null })]);
    const causes = causesOf(r);
    expect(new Set(causes).size).toBe(causes.length);
    expect(new Set(r.insights.map((i) => i.fingerprint)).size).toBe(r.insights.length);
  });
  it('original canonical totals are NEVER altered by quality findings', () => {
    const sales = [...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 7, 4400, { itemOpts: { cost: 0 } })];
    const engine = engineWith(sales);
    const r = evidenceQualityDetector.run(contextOf(engine));
    const canonical = engine.getStructuredQueryContext(REF).computeForRange(resolveAnalysisWindows(REF).current.range);
    for (const i of r.insights) {
      const ev = i.evidence as EvidenceQualityEvidence;
      expect(ev.currentGrossSalesCents).toBe(canonical.grossSalesCents);
      expect(ev.currentTransactionCount).toBe(canonical.txCount);
    }
  });
  it('store scope: other-store defects never create causes for the scoped store', () => {
    const storeA = healthy().map((s) => ({ ...s, storeId: 'store-a' }));
    const storeB = windowSales(8, '07', 7, 9000, { storeId: 'store-b', itemOpts: { cost: 0 }, customerId: null });
    const scoped = scopeCollection([...storeA, ...storeB] as never[], 'store-a', false);
    expect(run(scoped as never, 'store-a')).toEqual(run(storeA as never, 'store-a'));
    expect(run(scoped as never, 'store-a').insights).toHaveLength(0);
  });
});
