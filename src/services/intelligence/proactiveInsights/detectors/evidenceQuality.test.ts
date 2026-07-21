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
  it('EXCESSIVE UNKNOWN CLASSIFICATION: carrier-impure share ≥ threshold is a cause', () => {
    const pure = windowSales(8, '07', 7, 5000, { itemOpts: { carrier: 'Verizon', name: 'Bill Payment' } });
    const mixed = Array.from({ length: 3 }, (_, i) =>
      sale(`2026-07-${String(9 + i).padStart(2, '0')}T11:00:00`, 7000, {
        items: [item(5000, { carrier: 'Verizon', name: 'Bill Payment' }), item(2000, { name: 'Case' })],
      }));
    const r = run([...healthy(), ...pure, ...mixed]);        // 10 touching, 3 impure = 0.3
    expect(causesOf(r)).toContain('excessive_unknown_classification');
    const ev = r.insights.find((x) => (x.evidence as EvidenceQualityEvidence).cause === 'excessive_unknown_classification')!
      .evidence as EvidenceQualityEvidence;
    expect(ev.measuredRatio).toBe(0.3);
    expect(ev.ratioThreshold).toBe(EXCESSIVE_UNKNOWN_CLASSIFICATION_SHARE);
  });
  it('MISSING CUSTOMER ATTRIBUTION: unattributed sales below the share floor are a cause', () => {
    const r = run([...windowSales(1, '07', 5, 4000, { customerId: null }), ...windowSales(8, '07', 7, 4400, { customerId: null })]);
    expect(causesOf(r)).toContain('missing_customer_attribution');
    const ev = r.insights.find((x) => (x.evidence as EvidenceQualityEvidence).cause === 'missing_customer_attribution')!
      .evidence as EvidenceQualityEvidence;
    expect(ev.measuredRatio).toBe(0);
    expect(ev.ratioThreshold).toBe(MIN_CUSTOMER_ATTRIBUTION_SHARE);
    expect(r.insights.find((x) => (x.evidence as EvidenceQualityEvidence).cause === 'missing_customer_attribution')!.severity).toBe('info');
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
