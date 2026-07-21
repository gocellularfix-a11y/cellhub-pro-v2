// ============================================================
// I6-0B — Detector 3 tests: carrier concentration (STRICT population).
//
// Population contract: eligible = store-scoped, inside the 30 full local
// days, canonically countable, and STRUCTURALLY carrier-classified —
// canonical carrier-activity item (phone payment / top-up / activation)
// whose explicit carrier FIELD full-matches a KNOWN carrier. Free text
// (names, brands, customer data, phone numbers) NEVER classifies.
// Locks: mandated false-carrier exclusions, legitimate structured
// activity, decontaminated totals, ties, sample floor, store scope,
// 30-day window, legacy-vs-strict divergence (chat keeps itemCarrier).
// ============================================================

import { describe, it, expect } from 'vitest';
import { scopeCollection } from '@/store/storeScope';
import { itemCarrier, resolveStructuredCarrier } from '../../query/scopeBusinessQueryData';
import { carrierConcentrationDetector } from './carrierConcentrationDetector';
import {
  CARRIER_HIGH_CONCENTRATION_SHARE, CARRIER_MIN_ELIGIBLE_TRANSACTIONS, CARRIER_SEVERE_CONCENTRATION_SHARE,
} from '../thresholds';
import type { CarrierConcentrationEvidence } from '../types';
import { engineWith, windowSales, sale, item, contextOf } from '../testHarness';

const run = (sales: Parameters<typeof engineWith>[0], storeId?: string) =>
  carrierConcentrationDetector.run(contextOf(engineWith(sales, storeId)));

// STRUCTURED pure single-carrier phone payments inside the 30-day window
// (2026-06-15…07-14) — the real PhonePaymentModal item shape.
const carrierWeek = (startDay: number, n: number, carrier: string) =>
  windowSales(startDay, '07', n, 5000, { itemOpts: { carrier, name: 'Bill Payment', category: 'phone_payment' } });

describe('I6-0B — strict structured carrier classification (shared resolver)', () => {
  const productNames = [
    'Ultra Case', 'Ultra Screen Protector', 'Verizon Case', 'AT&T Charger',
    'Cricket Tempered Glass', 'Simple Mobile Cable', 'H2O Bottle', 'Page Plus Accessory',
  ];
  it('MANDATED false carriers: product names that start with a carrier NEVER classify', () => {
    for (const name of productNames) {
      expect(resolveStructuredCarrier(item(2000, { name }))).toBe('');
    }
  });
  it('the legacy fallback DOES classify some of those names — divergence is deliberate (chat/insights keep it)', () => {
    expect(itemCarrier(item(2000, { name: 'Ultra Case' }))).not.toBe('');       // the I6-0A reported bug
    expect(resolveStructuredCarrier(item(2000, { name: 'Ultra Case' }))).toBe('');
  });
  it('carrier FIELD on a NON-carrier-activity item never classifies (products/repairs/unlocks/services)', () => {
    expect(resolveStructuredCarrier(item(2000, { carrier: 'Verizon' }))).toBe('');                          // accessory
    expect(resolveStructuredCarrier(item(9000, { carrier: 'Verizon', category: 'service' }))).toBe('');
    expect(resolveStructuredCarrier({ ...item(9000, { carrier: 'Verizon' }), repairId: 'r1' } as never)).toBe('');
    expect(resolveStructuredCarrier({ ...item(9000, { carrier: 'Verizon' }), unlockId: 'u1' } as never)).toBe('');
  });
  it('carrier-activity item WITHOUT a structured field never classifies (name alone is not evidence)', () => {
    expect(resolveStructuredCarrier(item(5000, { name: 'Verizon Bill Payment', category: 'phone_payment' }))).toBe('');
    expect(itemCarrier(item(5000, { name: 'Verizon Bill Payment', category: 'phone_payment' }))).toBe('Verizon');  // legacy keeps it
  });
  it('field value must FULL-match a known carrier — substring/unknown values are explicit non-carriers', () => {
    expect(resolveStructuredCarrier(item(5000, { carrier: 'Ultra Case', category: 'phone_payment' }))).toBe('');
    expect(resolveStructuredCarrier(item(5000, { carrier: 'BansheeTel', category: 'phone_payment' }))).toBe('');
    expect(resolveStructuredCarrier(item(5000, { carrier: 'Ultra Mobile', category: 'phone_payment' }))).toBe('Ultra Mobile');
  });
  it('LEGITIMATE structured activity classifies (payments, top-ups, activations)', () => {
    expect(resolveStructuredCarrier(item(5000, { carrier: 'AT&T', category: 'phone_payment' }))).toBe('AT&T');
    expect(resolveStructuredCarrier(item(5000, { carrier: 'Verizon', category: 'activation' }))).toBe('Verizon');
    expect(resolveStructuredCarrier(item(5000, { carrier: 'T-Mobile', category: 'phone_payment' }))).toBe('T-Mobile');
    expect(resolveStructuredCarrier(item(5000, { carrier: 'Cricket', category: 'phone_payment', isActivation: true }))).toBe('Cricket');
    expect(resolveStructuredCarrier(item(5000, { carrier: 'H2O', category: 'topup' }))).toBe('H2O');
    expect(resolveStructuredCarrier(item(5000, { carrier: 'Simple Mobile', category: 'phone_payment' }))).toBe('Simple Mobile');
    expect(resolveStructuredCarrier(item(5000, { carrier: 'Page Plus', category: 'phone_payment' }))).toBe('Page Plus');
  });
});

describe('I6-0B — carrier concentration detector (strict population)', () => {
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
    expect(i.direction).toBe('neutral');
    expect(i.severity).toBe('watch');
    expect(i.thresholds.carrierHighConcentrationShare).toBe(CARRIER_HIGH_CONCENTRATION_SHARE);
    expect(i.fingerprint).toBe(
      'carrier_concentration:single_store:carriers:2026-06-15..2026-07-14:verizon:neutral',
    );
  });
  it('SEVERE concentration (≥0.8) is important', () => {
    const r = run([...carrierWeek(1, 7, 'Verizon'), ...carrierWeek(8, 7, 'Verizon'), ...carrierWeek(8, 2, 'Cricket')]);
    const ev = r.insights[0].evidence as CarrierConcentrationEvidence;
    expect(ev.concentration).toBe(0.875);
    expect(ev.concentration).toBeGreaterThanOrEqual(CARRIER_SEVERE_CONCENTRATION_SHARE);
    expect(r.insights[0].severity).toBe('important');
  });
  it('DECONTAMINATION: false-carrier products no longer inflate the population', () => {
    // 12 structured Verizon payments + 6 "Ultra Case" product sales.
    // Pre-I6-0B the legacy resolver discovered a fake 'Ultra Case' carrier
    // → total 18, concentration 12/18 = 0.667. Strict population: 12/12 = 1.
    const ultraCases = windowSales(1, '07', 6, 2000, { itemOpts: { name: 'Ultra Case' } });
    const r = run([...carrierWeek(8, 12, 'Verizon'), ...ultraCases]);
    const ev = r.insights[0].evidence as CarrierConcentrationEvidence;
    expect(ev.perCarrier.map((c) => c.carrier)).toEqual(['Verizon']);   // no fake carrier row
    expect(ev.totalEligibleTransactionCount).toBe(12);                  // was 18 contaminated
    expect(ev.concentration).toBe(1);                                   // was 0.667 contaminated
    expect(ev.excludedMixedSales).toBe(0);                              // products are OUTSIDE, not "mixed"
    expect(r.insights[0].severity).toBe('important');
  });
  it('MANDATED product-name fixtures are all excluded from the population', () => {
    const products = [
      'Ultra Case', 'Ultra Screen Protector', 'Verizon Case', 'AT&T Charger',
      'Cricket Tempered Glass', 'Simple Mobile Cable', 'H2O Bottle', 'Page Plus Accessory',
    ].map((name, i) => sale(`2026-07-${String(8 + (i % 7)).padStart(2, '0')}T10:00:00`, 3000, { items: [item(3000, { name })] }));
    const r = run(products);
    expect((r.diagnostic.evidence as CarrierConcentrationEvidence).perCarrier).toEqual([]);
    expect((r.diagnostic.evidence as CarrierConcentrationEvidence).totalEligibleTransactionCount).toBe(0);
    expect(r.diagnostic.reasons).toEqual(['no_eligible_carrier_activity']);
  });
  it('customer names, phone numbers and repair/unlock/service items never create carriers', () => {
    const r = run([
      sale('2026-07-08T10:00:00', 9000, { items: [item(9000, { name: 'iPhone Repair - Screen', category: 'service' })] }),
      sale('2026-07-09T10:00:00', 3000, { items: [item(3000, { name: '805-555-0199 Payment' })] }),
      sale('2026-07-10T10:00:00', 2500, { customerName: 'Veronica Cricket', items: [item(2500, { name: 'Charger' })] }),
      sale('2026-07-11T10:00:00', 6000, { items: [{ ...item(6000, { name: 'Network Unlock' }), unlockId: 'u9' } as never] }),
    ]);
    expect((r.diagnostic.evidence as CarrierConcentrationEvidence).perCarrier).toEqual([]);
    expect(r.diagnostic.reasons).toEqual(['no_eligible_carrier_activity']);
  });
  it('legacy name-only phone payments are conservatively outside the strict population', () => {
    const legacy = windowSales(8, '07', 12, 5000, { itemOpts: { name: 'Verizon Bill Payment', category: 'phone_payment' } });
    const r = run(legacy);
    expect((r.diagnostic.evidence as CarrierConcentrationEvidence).totalEligibleTransactionCount).toBe(0);
    expect(r.diagnostic.reasons).toEqual(['no_eligible_carrier_activity']);
  });
  it('mixed (carrier-impure) sales are EXCLUDED and counted, never allocated', () => {
    const mixed = Array.from({ length: 3 }, (_, i) =>
      sale(`2026-07-${String(8 + i).padStart(2, '0')}T10:00:00`, 7000, {
        items: [item(5000, { carrier: 'Verizon', name: 'Bill Payment', category: 'phone_payment' }), item(2000, { name: 'Case' })],
      }));
    const r = run([...carrierWeek(1, 7, 'Verizon'), ...carrierWeek(8, 5, 'Verizon'), ...carrierWeek(8, 4, 'Cricket'), ...mixed]);
    const ev = r.insights[0].evidence as CarrierConcentrationEvidence;
    expect(ev.totalEligibleTransactionCount).toBe(16);       // mixed never entered
    expect(ev.excludedMixedSales).toBe(3);
    expect(ev.concentration).toBe(0.75);
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
  it('ties are deterministic: count desc, then carrier name asc; tied carriers reported', () => {
    const r = run([...carrierWeek(1, 4, 'Verizon'), ...carrierWeek(8, 4, 'Verizon'), ...carrierWeek(1, 4, 'Cricket'), ...carrierWeek(8, 4, 'Cricket')]);
    const ev = r.diagnostic.evidence as CarrierConcentrationEvidence;
    expect(ev.topCarrier).toBe('Cricket');                   // alphabetical winner
    expect(ev.tiedWith).toEqual(['Verizon']);
    expect(ev.concentration).toBe(0.5);
    expect(r.diagnostic.status).toBe('below_threshold');
  });
  it('window boundary: structured carrier sales OUTSIDE the 30 full days are invisible', () => {
    const inWindow = carrierWeek(8, 12, 'Verizon');
    const outOfWindow = [
      sale('2026-06-14T10:00:00', 5000, { items: [item(5000, { carrier: 'Cricket', category: 'phone_payment' })] }),  // day before window
      sale('2026-07-15T10:00:00', 5000, { items: [item(5000, { carrier: 'Cricket', category: 'phone_payment' })] }),  // partial today
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
