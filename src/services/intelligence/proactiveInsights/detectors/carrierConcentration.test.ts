// ============================================================
// I6-0A — Detector 3 tests: carrier concentration (30 full days).
//
// Locks: high/severe concentration, balanced population, minimum sample,
// canonical exclusions (products, brands, repair-like names, customer
// names, phone numbers, mixed sales), deterministic ties, store scope.
// Population is the CANONICAL carrier classification (itemCarrier —
// KNOWN carriers only, exact-or-exclude) reused from the I3-2 executor.
// ============================================================

import { describe, it, expect } from 'vitest';
import { scopeCollection } from '@/store/storeScope';
import { carrierConcentrationDetector } from './carrierConcentrationDetector';
import {
  CARRIER_HIGH_CONCENTRATION_SHARE, CARRIER_MIN_ELIGIBLE_TRANSACTIONS, CARRIER_SEVERE_CONCENTRATION_SHARE,
} from '../thresholds';
import type { CarrierConcentrationEvidence } from '../types';
import { engineWith, windowSales, sale, item, contextOf } from '../testHarness';

const run = (sales: Parameters<typeof engineWith>[0], storeId?: string) =>
  carrierConcentrationDetector.run(contextOf(engineWith(sales, storeId)));

// Pure single-carrier sales inside the 30-day window (2026-06-15…07-14).
const carrierWeek = (startDay: number, n: number, carrier: string) =>
  windowSales(startDay, '07', n, 5000, { itemOpts: { carrier, name: 'Bill Payment' } });

describe('I6-0A — carrier concentration detector', () => {
  it('HIGH concentration (0.75) emits watch/neutral with full population evidence', () => {
    const r = run([...carrierWeek(1, 7, 'Verizon'), ...carrierWeek(8, 5, 'Verizon'), ...carrierWeek(8, 4, 'Cricket')]);
    expect(r.insights).toHaveLength(1);
    const i = r.insights[0];
    const ev = i.evidence as CarrierConcentrationEvidence;
    expect(ev.topCarrier).toBe('Verizon');
    expect(ev.topCarrierTransactionCount).toBe(12);
    expect(ev.totalEligibleTransactionCount).toBe(16);
    expect(ev.concentration).toBe(0.75);
    expect(ev.concentration).toBeGreaterThanOrEqual(CARRIER_HIGH_CONCENTRATION_SHARE);
    expect(ev.window.startYMD).toBe('2026-06-15');
    expect(ev.window.endYMD).toBe('2026-07-14');
    expect(i.category).toBe('carriers');
    expect(i.direction).toBe('neutral');                     // exposure, not performance
    expect(i.severity).toBe('watch');
    expect(i.thresholds.carrierHighConcentrationShare).toBe(CARRIER_HIGH_CONCENTRATION_SHARE);
  });
  it('SEVERE concentration (≥0.8) is important', () => {
    const r = run([...carrierWeek(1, 7, 'Verizon'), ...carrierWeek(8, 7, 'Verizon'), ...carrierWeek(8, 2, 'Cricket')]);
    const ev = r.insights[0].evidence as CarrierConcentrationEvidence;
    expect(ev.concentration).toBe(0.875);
    expect(ev.concentration).toBeGreaterThanOrEqual(CARRIER_SEVERE_CONCENTRATION_SHARE);
    expect(r.insights[0].severity).toBe('important');
  });
  it('balanced population is suppressed but auditable', () => {
    const r = run([...carrierWeek(1, 6, 'Verizon'), ...carrierWeek(8, 6, 'Cricket'), ...carrierWeek(1, 6, 'H2O')]);
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostic.status).toBe('below_threshold');
    expect(r.diagnostic.reasons).toEqual(['concentration_below_threshold']);
    expect((r.diagnostic.evidence as CarrierConcentrationEvidence).concentration).toBeCloseTo(0.333, 3);
  });
  it('minimum sample: fewer eligible transactions than the floor claim nothing', () => {
    const r = run(carrierWeek(8, CARRIER_MIN_ELIGIBLE_TRANSACTIONS - 1, 'Verizon'));
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostic.status).toBe('insufficient_evidence');
    expect(r.diagnostic.reasons).toEqual(['insufficient_sample']);
  });
  it('absent carrier activity: honest refusal, never a fake population', () => {
    const r = run(windowSales(8, '07', 6, 4000));            // plain accessories
    expect(r.insights).toHaveLength(0);
    expect(r.diagnostic.status).toBe('insufficient_evidence');
    expect(r.diagnostic.reasons).toEqual(['no_eligible_carrier_activity']);
    expect((r.diagnostic.evidence as CarrierConcentrationEvidence).totalEligibleTransactionCount).toBe(0);
  });
  it('EXCLUSIONS: products, brands, repair names, customer names and phone numbers never classify as carriers', () => {
    const r = run([
      sale('2026-07-08T10:00:00', 4000, { items: [item(4000, { name: 'Samsung Screen Protector' })] }),
      sale('2026-07-09T10:00:00', 9000, { items: [item(9000, { name: 'iPhone Repair - Screen' })] }),
      sale('2026-07-10T10:00:00', 3000, { items: [item(3000, { name: '805-555-0199 Payment' })] }),
      sale('2026-07-11T10:00:00', 2500, { customerName: 'Veronica Cricket', items: [item(2500, { name: 'Charger' })] }),
    ]);
    expect((r.diagnostic.evidence as CarrierConcentrationEvidence).perCarrier).toEqual([]);
    expect(r.diagnostic.reasons).toEqual(['no_eligible_carrier_activity']);
  });
  it('mixed (carrier-impure) sales are EXCLUDED and counted, never allocated', () => {
    const mixed = Array.from({ length: 3 }, (_, i) =>
      sale(`2026-07-${String(8 + i).padStart(2, '0')}T10:00:00`, 7000, {
        items: [item(5000, { carrier: 'Verizon', name: 'Bill Payment' }), item(2000, { name: 'Case' })],
      }));
    const r = run([...carrierWeek(1, 7, 'Verizon'), ...carrierWeek(8, 5, 'Verizon'), ...carrierWeek(8, 4, 'Cricket'), ...mixed]);
    const ev = r.insights[0].evidence as CarrierConcentrationEvidence;
    expect(ev.totalEligibleTransactionCount).toBe(16);       // mixed never entered
    expect(ev.excludedMixedSales).toBe(3);
    expect(ev.concentration).toBe(0.75);
  });
  it('ties are deterministic: count desc, then carrier name asc; tied carriers reported', () => {
    const r = run([...carrierWeek(1, 4, 'Verizon'), ...carrierWeek(8, 4, 'Verizon'), ...carrierWeek(1, 4, 'Cricket'), ...carrierWeek(8, 4, 'Cricket')]);
    const ev = r.diagnostic.evidence as CarrierConcentrationEvidence;
    expect(ev.topCarrier).toBe('Cricket');                   // alphabetical winner
    expect(ev.tiedWith).toEqual(['Verizon']);
    expect(ev.concentration).toBe(0.5);
    expect(r.diagnostic.status).toBe('below_threshold');     // 0.5 < 0.6 — no exposure claim
  });
  it('window boundary: carrier sales OUTSIDE the 30 full days are invisible', () => {
    const inWindow = carrierWeek(8, 12, 'Verizon');
    const outOfWindow = [
      sale('2026-06-14T10:00:00', 5000, { items: [item(5000, { carrier: 'Cricket', name: 'Bill Payment' })] }),  // day before window
      sale('2026-07-15T10:00:00', 5000, { items: [item(5000, { carrier: 'Cricket', name: 'Bill Payment' })] }),  // partial today
    ];
    const r = run([...inWindow, ...outOfWindow]);
    const ev = r.insights[0].evidence as CarrierConcentrationEvidence;
    expect(ev.perCarrier.map((c) => c.carrier)).toEqual(['Verizon']);
    expect(ev.concentration).toBe(1);
  });
  it('store scope: other-store carrier activity never affects the scoped population', () => {
    const storeA = [...carrierWeek(1, 7, 'Verizon'), ...carrierWeek(8, 5, 'Verizon'), ...carrierWeek(8, 4, 'Cricket')]
      .map((s) => ({ ...s, storeId: 'store-a' }));
    const storeB = carrierWeek(8, 20, 'H2O').map((s) => ({ ...s, storeId: 'store-b' }));
    const scoped = scopeCollection([...storeA, ...storeB] as never[], 'store-a', false);
    expect(run(scoped as never, 'store-a')).toEqual(run(storeA as never, 'store-a'));
    expect((run(scoped as never, 'store-a').insights[0].evidence as CarrierConcentrationEvidence).topCarrier).toBe('Verizon');
  });
});
