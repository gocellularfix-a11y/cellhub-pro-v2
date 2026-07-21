// ============================================================
// I6-C2 — canonical presented-intelligence service (engine.getPresentedInsights).
//
// Verifies the ONE integration entry every visible consumer uses: the engine
// passes its canonical proactive result AND its configured language to the
// I6-C1 presenter, preserves store scope, leaks no raw detector output, and
// handles empty/insufficient-evidence data. Uses the REAL engine over the
// shared proactive test harness (node env — no DOM).
// ============================================================

import { describe, it, expect } from 'vitest';
import { scopeCollection } from '@/store/storeScope';
import { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer, Sale } from '@/store/types';
import { REF, windowSales } from '../proactiveInsights/testHarness';

function build(sales: Sale[], opts: { lang?: 'en' | 'es' | 'pt'; storeId?: string } = {}): IntelligenceEngine {
  return new IntelligenceEngine(
    sales, [] as Customer[], [], [],
    { lang: opts.lang ?? 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15, ...(opts.storeId ? { storeId: opts.storeId } : {}) } as never,
    { customerReturns: [], settings: { defaultCommissionRate: 0.07 } } as never,
  );
}

// +50% material rise (baseline 5×$40 = $200 ≥ floor, current 5×$60 = $300),
// both windows ≥ 3 tx → sales_momentum emits.
const materialGrowth = () => [...windowSales(1, '07', 5, 4000), ...windowSales(8, '07', 5, 6000)];

describe('I6-C2 — getPresentedInsights service wiring', () => {
  it('passes the canonical proactive result through the presenter with the reference date', () => {
    const p = build(materialGrowth()).getPresentedInsights(REF);
    expect(p.referenceYMD).toBe('2026-07-15');
    expect(p.cards.some((c) => c.detectorId === 'sales_momentum')).toBe(true);
    expect(p.executive.headline).toBeTypeOf('string');
  });

  it('localizes using the ENGINE language (en vs es)', () => {
    const en = build(materialGrowth(), { lang: 'en' }).getPresentedInsights(REF);
    const es = build(materialGrowth(), { lang: 'es' }).getPresentedInsights(REF);
    const enSales = en.cards.find((c) => c.detectorId === 'sales_momentum')!;
    const esSales = es.cards.find((c) => c.detectorId === 'sales_momentum')!;
    expect(enSales.headline).toContain('Sales grew');
    expect(esSales.headline).toContain('Las ventas subieron');
    expect(en.lang).toBe('en');
    expect(es.lang).toBe('es');
  });

  it('leaks no raw detector output to consumers (no evidence / ids / fingerprints in visible text)', () => {
    const p = build(materialGrowth()).getPresentedInsights(REF);
    const card = p.cards.find((c) => c.detectorId === 'sales_momentum')!;
    // The card model carries a fingerprint as a stable key, but NEVER exposes
    // raw evidence, and no visible string echoes internal tokens.
    expect((card as unknown as { evidence?: unknown }).evidence).toBeUndefined();
    const visible = [card.headline, card.summary, card.recommendation ?? '', ...card.expandableDetails].join(' ').toLowerCase();
    for (const token of ['sales_momentum', 'fingerprint', 'cents', 'detectorid', 'canonical_report_money']) {
      expect(visible).not.toContain(token);
    }
  });

  it('preserves store scope through the presenter (canonical scopeCollection + fingerprint)', () => {
    // Mirrors the canonical proactive store-scope lock: mixed two-store data,
    // pre-scoped to store-a, must yield exactly the store-a result — and the
    // presented card carries the store-scoped fingerprint.
    const storeA = [...windowSales(1, '07', 5, 4000, { storeId: 'store-a' }), ...windowSales(8, '07', 5, 6000, { storeId: 'store-a' })];
    const storeB = [...windowSales(1, '07', 7, 99000, { storeId: 'store-b', itemOpts: { cost: 0, carrier: 'Cricket' } }), ...windowSales(8, '07', 7, 1000, { storeId: 'store-b', itemOpts: { cost: 0, carrier: 'Cricket' } })];
    const scoped = scopeCollection([...storeA, ...storeB], 'store-a', false);
    const mixed = build(scoped, { storeId: 'store-a' }).getPresentedInsights(REF);
    const pure = build(storeA, { storeId: 'store-a' }).getPresentedInsights(REF);
    expect(mixed).toEqual(pure);                                   // store-b leaked nothing
    const sales = mixed.cards.find((c) => c.detectorId === 'sales_momentum');
    expect(sales).toBeDefined();
    expect(sales!.direction).toBe('positive');                     // store-b alone would be a crash
    expect(sales!.fingerprint).toContain(':store-a:');             // scope preserved into the card
  });

  it('handles empty data without throwing and returns a valid presented shape', () => {
    const p = build([]).getPresentedInsights(REF);
    expect(Array.isArray(p.cards)).toBe(true);
    expect(p.executive.headline).toBeTypeOf('string');
    // Never fabricates a positive "healthy" claim from silence.
    expect(p.executive.headline.toLowerCase()).not.toContain('healthy');
  });

  it('is deterministic for the same data + reference date', () => {
    const a = build(materialGrowth()).getPresentedInsights(REF);
    const b = build(materialGrowth()).getPresentedInsights(REF);
    expect(a).toEqual(b);
  });
});
