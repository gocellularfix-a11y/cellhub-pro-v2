// ============================================================
// I3-3 Business Analyst — insights engine tests.
//
// Every expected money value is computed through the canonical service in
// the fixture. Fixed reference date (no Date.now). Proves: trend
// correctness, exact contributors, no fabricated explanations, priority
// ordering, anomaly rules, customer/employee/carrier/service patterns,
// suggestions determinism, typed cards.
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { computeReportMoneyStats } from '@/services/reports/computeReportMoneyStats';
import { normalizeLocalDayRange } from '@/utils/reportRange';
import { resolveBusinessDateRange } from '../query/resolveBusinessDateRange';
import { computeMetricTrend } from './trendAnalysis';
import { computeContributors } from './contributorAnalysis';
import { detectAnomalies, MARGIN_DROP_PP } from './anomalyDetection';
import { detectCustomerPatterns, LOST_DAYS, RETURNING_ABSENCE_DAYS } from './customerPatterns';
import { analyzeEmployees } from './employeePatterns';
import { analyzeCarriers } from './carrierAnalysis';
import { analyzeServiceMix } from './serviceAnalysis';
import { collectBusinessFindings, sortFindings } from './findingsEngine';
import { suggestQuestions, MAX_SUGGESTIONS } from './suggestedQuestions';
import { buildInsightCards } from './insightCards';
import { formatFindings } from './formatFindings';
import { SEVERITY_RANK } from './types';
import type { InsightFinding } from './types';
import type { Customer, Sale, SaleItem, Repair, Unlock } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);
const portal = (id: string, name: string) => ({ id, name, label: name, emoji: '', color: '', matchCarriers: [], matchUrlSnippets: [] });
const SETTINGS = {
  carrierCommissions: { 'AT&T': 0.10, 'Verizon': 0.07 },
  defaultCommissionRate: 0.07,
  paymentPortals: [portal('ePay', 'ePay'), portal('VidaPay', 'VidaPay')],
};
const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;
const LOST: Customer = { id: 'cust-lost', name: 'PEDRO GOMEZ', phone: '8050001111' } as unknown as Customer;
const BACK: Customer = { id: 'cust-back', name: 'MARIA SOTO', phone: '8052223333' } as unknown as Customer;

let seq = 0;
function item(over: Partial<SaleItem> & { portal?: string }): SaleItem {
  return { id: `it-${++seq}`, name: 'Item', category: 'accessory' as SaleItem['category'], price: 0, qty: 1, cbeEligible: false, taxable: true, ...over } as SaleItem;
}
function sale(over: Partial<Sale>): Sale {
  const total = over.total ?? 0;
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items: [], subtotal: over.subtotal ?? total,
    taxAmount: 0, cbeTotal: 0, total, paymentMethod: 'cash' as Sale['paymentMethod'],
    status: 'completed' as Sale['status'], createdAt: '2026-07-05T10:00:00', employeeName: 'Ana', ...over,
  } as Sale;
}
const att = (day: string, emp = 'Ana') => sale({
  createdAt: `${day}T10:00:00`, customerId: 'cust-jenny', customerPhone: '8054523932', employeeName: emp,
  items: [item({ name: 'AT&T - X', category: 'phone_payment' as SaleItem['category'], price: 6500, qty: 1, carrier: 'AT&T', portal: 'ePay' })],
  subtotal: 6500, total: 6500,
});
const accessory = (day: string, price: number, cost: number, emp = 'Luis') => sale({
  createdAt: `${day}T09:00:00`, employeeName: emp,
  items: [item({ name: `Case-${day}`, price, qty: 1, cost })],
  subtotal: price, total: price,
});

// World: July (current month, days 1-15) vs June activity.
function buildWorld() {
  const sales: Sale[] = [
    // July: AT&T grows (3 payments), accessories shrink.
    att('2026-07-03'), att('2026-07-06'), att('2026-07-09'),
    accessory('2026-07-05', 2000, 800),
    // Jenny frequent history (5+ tx, short cadence). Early-June dates keep the
    // previous window (Jun 16-30) AT&T-free so July shows real carrier growth.
    att('2026-06-05'), att('2026-06-08'), att('2026-06-12'),
    // June: only 1 AT&T + big accessories (so July: AT&T ↑, accessories ↓).
    accessory('2026-06-18', 9000, 4000), accessory('2026-06-22', 7000, 3000),
    // Lost customer: one old sale (> LOST_DAYS before REF).
    sale({ createdAt: '2026-03-01T10:00:00', customerId: 'cust-lost', customerPhone: '8050001111', items: [item({ name: 'OldCase', price: 3000, qty: 1, cost: 1000 })], subtotal: 3000, total: 3000 }),
    // Returning customer: long-ago sale + very recent sale (absence > 60d).
    sale({ createdAt: '2026-04-01T10:00:00', customerId: 'cust-back', customerPhone: '8052223333', items: [item({ name: 'A', price: 2000, qty: 1, cost: 500 })], subtotal: 2000, total: 2000 }),
    sale({ createdAt: '2026-07-14T10:00:00', customerId: 'cust-back', customerPhone: '8052223333', items: [item({ name: 'B', price: 2500, qty: 1, cost: 700 })], subtotal: 2500, total: 2500 }),
  ];
  const repairs: Repair[] = [
    { id: 'rep-1', customerId: 'x', status: 'picked_up', balance: 0, total: 9000, laborCost: 2000, employeeName: 'Ana', parts: [{ id: 'p', name: 'Screen', price: 0, cost: 1500, qty: 1 }], createdAt: '2026-07-05T12:00:00' } as unknown as Repair,
    { id: 'rep-2', customerId: 'x', status: 'picked_up', balance: 0, total: 5000, laborCost: 1000, employeeName: 'Ana', parts: [], createdAt: '2026-06-20T12:00:00' } as unknown as Repair,
  ];
  const unlocks: Unlock[] = [
    { id: 'unl-1', customerId: 'x', status: 'completed', balance: 0, price: 4000, cost: 500, employeeName: 'Luis', createdAt: '2026-07-06T12:00:00' } as unknown as Unlock,
  ];
  return { sales, repairs, unlocks };
}

function buildEngine(world = buildWorld()): IntelligenceEngine {
  return new IntelligenceEngine(
    world.sales as unknown as Sale[], [JENNY, LOST, BACK], [], world.repairs as never,
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { unlocks: world.unlocks, customerReturns: [], vendorReturns: [], settings: SETTINGS, employees: [{ id: 'emp-ana', name: 'Ana' }, { id: 'emp-luis', name: 'Luis' }] } as never,
  );
}

const MONTH = resolveBusinessDateRange({ kind: 'this_month' }, REF)!;
const ctxOf = (engine: IntelligenceEngine) => engine.getStructuredQueryContext(REF);

function canonicalFor(world: ReturnType<typeof buildWorld>, startYMD: string, endYMD: string, over: Partial<{ repairs: Repair[]; unlocks: Unlock[] }> = {}) {
  return computeReportMoneyStats({
    sales: world.sales, repairs: over.repairs ?? world.repairs, unlocks: over.unlocks ?? world.unlocks,
    specialOrders: [], layaways: [], inventory: [], customerReturns: [], vendorReturns: [],
    settings: SETTINGS as never, periodRange: normalizeLocalDayRange(startYMD, endYMD),
    labels: { noProvider: '(No provider)', noCarrier: '(No carrier)', unknownEmployee: 'Unknown' },
  });
}

// ══ Trend (Part 4) ══════════════════════════════════════════
describe('I3-3 — trend analysis (canonical parity)', () => {
  const world = buildWorld();
  const ctx = ctxOf(buildEngine(world));

  it('month-to-date vs previous equal period — canonical values both sides', () => {
    const t = computeMetricTrend(ctx, 'profit', MONTH)!;
    // Jul 1-15 (15 days) vs Jun 16-30 (15 days) — canonical expected.
    const cur = canonicalFor(world, '2026-07-01', '2026-07-15');
    const prev = canonicalFor(world, '2026-06-16', '2026-06-30');
    expect(t.current).toBe(cur.totalProfitCents);
    expect(t.previous).toBe(prev.totalProfitCents);
    expect(t.deltaAmount).toBe(cur.totalProfitCents - prev.totalProfitCents);
    expect(t.direction).toBe(t.deltaAmount > 0 ? 'up' : t.deltaAmount < 0 ? 'down' : 'flat');
    expect(t.previousRange).toEqual({ startYMD: '2026-06-16', endYMD: '2026-06-30' });
  });
  it('zero baseline → percentChange null (never a fabricated %)', () => {
    const t = computeMetricTrend(ctx, 'store_credit', MONTH)!;
    expect(t.previous).toBe(0);
    expect(t.percentChange).toBeNull();
  });
  it('margin trend uses percentage points, meaningful flag honored', () => {
    const t = computeMetricTrend(ctx, 'margin', MONTH)!;
    expect(t.percentagePointDelta).not.toBeNull();
    expect(t.percentChange).toBeNull();
  });
});

// ══ Contributors (Part 5) ═══════════════════════════════════
describe('I3-3 — contributors (exact canonical rows only)', () => {
  const world = buildWorld();
  const ctx = ctxOf(buildEngine(world));

  it('profit delta decomposes into canonical category deltas (AT&T-payments up, accessories down)', () => {
    const c = computeContributors(ctx, 'profit', MONTH)!;
    const cur = canonicalFor(world, '2026-07-01', '2026-07-15');
    const prev = canonicalFor(world, '2026-06-16', '2026-06-30');
    // Expected per-category deltas straight from canonical rows.
    const curBy = new Map(cur.categoriesByRevenue.map((r) => [r.name, r.profitCents]));
    const prevBy = new Map(prev.categoriesByRevenue.map((r) => [r.name, r.profitCents]));
    for (const d of [...c.positive, ...c.negative].filter((x) => x.dimension === 'category')) {
      expect(d.deltaCents).toBe((curBy.get(d.label) ?? 0) - (prevBy.get(d.label) ?? 0));
    }
    expect(c.positive.length).toBeGreaterThan(0);
    expect(c.negative.length).toBeGreaterThan(0);
    // Deterministic ordering by |delta|.
    for (let i = 1; i < c.positive.length; i++) {
      expect(Math.abs(c.positive[i - 1].deltaCents)).toBeGreaterThanOrEqual(Math.abs(c.positive[i].deltaCents));
    }
  });
  it('metrics without exact grouping return null (no fabricated contributors)', () => {
    expect(computeContributors(ctx, 'net_sales', MONTH)).toBeNull();
    expect(computeContributors(ctx, 'cash', MONTH)).toBeNull();
    expect(computeContributors(ctx, 'margin', MONTH)).toBeNull();
  });
});

// ══ Anomalies (Part 6) ══════════════════════════════════════
describe('I3-3 — anomaly rules (deterministic)', () => {
  it('margin drop fires only at/below the -10pp threshold', () => {
    // Current month: low-margin accessory; previous: high-margin.
    const world = { sales: [accessory('2026-07-05', 10000, 9500), accessory('2026-06-20', 10000, 1000)], repairs: [] as Repair[], unlocks: [] as Unlock[] };
    const ctx = ctxOf(buildEngine(world as ReturnType<typeof buildWorld>));
    const findings = detectAnomalies(ctx, MONTH);
    const drop = findings.find((f) => f.kind === 'margin_drop');
    expect(drop).toBeTruthy();
    expect(Number(drop!.data.dropPp)).toBeLessThanOrEqual(-MARGIN_DROP_PP);
  });
  it('carrier disappeared (pure ranges): active before, silent now', () => {
    const world = { sales: [att('2026-06-20'), accessory('2026-07-05', 2000, 800)], repairs: [] as Repair[], unlocks: [] as Unlock[] };
    const ctx = ctxOf(buildEngine(world as ReturnType<typeof buildWorld>));
    const f = detectAnomalies(ctx, MONTH).find((x) => x.kind === 'carrier_disappeared');
    expect(f?.data.carrier).toBe('AT&T');
  });
  it('large refund period: canonical refunds above 20% of gross', () => {
    const refundSale = sale({
      createdAt: '2026-07-10T10:00:00', invoiceNumber: 'REFUND-1', total: -5000, subtotal: -5000,
      items: [item({ name: 'Refund', price: -5000, qty: 1 })],
    });
    const world = { sales: [accessory('2026-07-05', 10000, 4000), refundSale], repairs: [] as Repair[], unlocks: [] as Unlock[] };
    const ctx = ctxOf(buildEngine(world as ReturnType<typeof buildWorld>));
    const findings = detectAnomalies(ctx, MONTH);
    const cur = ctx.computeForRange(MONTH.range);
    const f = findings.find((x) => x.kind === 'large_refund_period');
    if (cur.grossSalesCents > 0 && cur.returnAndRefundAdjustmentsCents > cur.grossSalesCents * 0.2) {
      expect(f).toBeTruthy();
      expect(f!.data.refundedCents).toBe(cur.returnAndRefundAdjustmentsCents);
    } else {
      expect(f).toBeUndefined();   // rule honestly did not apply to canonical numbers
    }
  });
  it('no anomalies are fabricated on a quiet, healthy world', () => {
    const world = { sales: [accessory('2026-07-05', 2000, 800), accessory('2026-06-25', 2100, 800)], repairs: [] as Repair[], unlocks: [] as Unlock[] };
    const ctx = ctxOf(buildEngine(world as ReturnType<typeof buildWorld>));
    const findings = detectAnomalies(ctx, MONTH);
    expect(findings.filter((f) => f.kind === 'margin_drop' || f.kind === 'sales_below_rolling_average')).toEqual([]);
  });
});

// ══ Customer patterns (Part 7) ══════════════════════════════
describe('I3-3 — customer patterns (canonical profiles)', () => {
  const findings = detectCustomerPatterns(ctxOf(buildEngine()));

  it('high value + frequent: Jenny', () => {
    expect(findings.find((f) => f.id === 'customer_high_value:cust-jenny')).toBeTruthy();
    expect(findings.find((f) => f.id === 'customer_frequent:cust-jenny')).toBeTruthy();
  });
  it(`lost: no visit in ${LOST_DAYS}+ days`, () => {
    const f = findings.find((x) => x.id === 'customer_lost:cust-lost');
    expect(f).toBeTruthy();
    expect(Number(f!.data.daysSinceLastVisit)).toBeGreaterThanOrEqual(LOST_DAYS);
  });
  it(`returning after ${RETURNING_ABSENCE_DAYS}+ day absence`, () => {
    const f = findings.find((x) => x.id === 'customer_returning_after_absence:cust-back');
    expect(f).toBeTruthy();
    expect(Number(f!.data.absenceDays)).toBeGreaterThanOrEqual(RETURNING_ABSENCE_DAYS);
  });
});

// ══ Employee patterns (Part 8) ══════════════════════════════
describe('I3-3 — employee patterns (exact or refuse)', () => {
  it('attributed world: winners from canonical scoped projections (services included)', () => {
    const world = buildWorld();
    const ctx = ctxOf(buildEngine(world));
    const findings = analyzeEmployees(ctx, MONTH);
    const bestProfit = findings.find((f) => f.kind === 'employee_best_profit');
    expect(bestProfit).toBeTruthy();
    // Ana's July profit includes her attributed standalone repair (canonical).
    const anaOnly = canonicalFor({ ...world, sales: world.sales.filter((s) => s.employeeName === 'Ana') }, '2026-07-01', '2026-07-15', { unlocks: [] });
    if (bestProfit!.data.employee === 'Ana') expect(bestProfit!.data.value).toBe(anaOnly.totalProfitCents);
    expect(findings.find((f) => f.kind === 'employee_most_repairs')?.data.employee).toBe('Ana');
    expect(findings.find((f) => f.kind === 'employee_most_unlocks')?.data.employee).toBe('Luis');
  });
  it('unattributed service in range → single refusal finding, zero per-employee numbers', () => {
    const world = buildWorld();
    (world.repairs[0] as unknown as { employeeName?: string }).employeeName = undefined;
    const findings = analyzeEmployees(ctxOf(buildEngine(world)), MONTH);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('employee_attribution_incomplete');
  });
});

// ══ Carrier + service (Parts 9-10) ══════════════════════════
describe('I3-3 — carrier + service analysis', () => {
  it('carrier: highest revenue/profit + fastest growing (pure world)', () => {
    const findings = analyzeCarriers(ctxOf(buildEngine()), MONTH);
    expect(findings.find((f) => f.kind === 'carrier_highest_revenue')?.data.carrier).toBe('AT&T');
    expect(findings.find((f) => f.kind === 'carrier_fastest_growing')?.data.carrier).toBe('AT&T');
  });
  it('carrier: mixed sale → single refusal finding', () => {
    const world = buildWorld();
    world.sales.push(sale({
      createdAt: '2026-07-12T10:00:00',
      items: [
        item({ name: 'AT&T - X', category: 'phone_payment' as SaleItem['category'], price: 6500, qty: 1, carrier: 'AT&T', portal: 'ePay' }),
        item({ name: 'Verizon - Y', category: 'phone_payment' as SaleItem['category'], price: 6000, qty: 1, carrier: 'Verizon', portal: 'VidaPay' }),
      ],
      subtotal: 12500, total: 12500,
    }));
    const findings = analyzeCarriers(ctxOf(buildEngine(world)), MONTH);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('carrier_attribution_mixed');
  });
  it('service mix: shares are canonical ratios; populations canonical', () => {
    const world = buildWorld();
    const ctx = ctxOf(buildEngine(world));
    const findings = analyzeServiceMix(ctx, MONTH);
    const repairShare = findings.find((f) => f.id === 'service_share:repairs');
    expect(repairShare).toBeTruthy();
    const repairsOnly = canonicalFor({ ...world, sales: [] }, '2026-07-01', '2026-07-15', { unlocks: [] });
    const total = canonicalFor(world, '2026-07-01', '2026-07-15');
    expect(repairShare!.data.revenueCents).toBe(repairsOnly.grossSalesCents);
    expect(repairShare!.data.revenueSharePct).toBe(Math.round((repairsOnly.grossSalesCents / total.grossSalesCents) * 1000) / 10);
  });
});

// ══ Findings engine + priority (Part 3) ═════════════════════
describe('I3-3 — findings engine priority', () => {
  it('deterministic ordering: severity rank → magnitude desc → id asc', () => {
    const findings = collectBusinessFindings(ctxOf(buildEngine()), MONTH);
    expect(findings.length).toBeGreaterThan(3);
    for (let i = 1; i < findings.length; i++) {
      const a = findings[i - 1]; const b = findings[i];
      const cmp = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        || b.magnitude - a.magnitude || a.id.localeCompare(b.id);
      expect(cmp).toBeLessThanOrEqual(0);
    }
    // Identical twice — fully deterministic.
    const again = collectBusinessFindings(ctxOf(buildEngine()), MONTH);
    expect(again.map((f) => f.id)).toEqual(findings.map((f) => f.id));
  });
  it('findings carry structured data only (no pre-formatted sentences)', () => {
    const findings = collectBusinessFindings(ctxOf(buildEngine()), MONTH);
    for (const f of findings) {
      expect(f.id).toContain(':');
      expect(typeof f.magnitude).toBe('number');
      expect(f.dateRange.startYMD).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ══ Suggestions + cards + presenter (Parts 11-12) ═══════════
describe('I3-3 — suggestions, cards, presenter', () => {
  const engine = buildEngine();
  const findings = collectBusinessFindings(ctxOf(engine), MONTH);

  it('suggested questions: deterministic, capped, localized EN/ES/PT', () => {
    const en = suggestQuestions(findings, 'en');
    expect(en.length).toBeGreaterThan(0);
    expect(en.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(suggestQuestions(findings, 'en')).toEqual(en);   // deterministic
    const es = suggestQuestions(findings, 'es');
    const pt = suggestQuestions(findings, 'pt');
    expect(es.every((s) => s.text.length > 0 && s.sourceFindingId)).toBe(true);
    expect(pt.every((s) => s.text.length > 0)).toBe(true);
  });
  it('cards: typed API with canonical headline values', () => {
    const ctx = ctxOf(engine);
    const cards = buildInsightCards(ctx, MONTH, findings);
    const revenue = cards.find((c) => c.kind === 'revenue_card')!;
    expect(revenue.value).toBe(ctx.computeForRange(MONTH.range).grossSalesCents);
    expect(revenue.trend).toBeTruthy();
    const profit = cards.find((c) => c.kind === 'profit_card')!;
    expect(profit.value).toBe(ctx.computeForRange(MONTH.range).totalProfitCents);
    expect(cards.find((c) => c.kind === 'customer_alert')).toBeTruthy();   // lost customer exists
  });
  it('engine.getBusinessInsights: public API end-to-end', () => {
    const insights = engine.getBusinessInsights(REF, 'this_month');
    expect(insights.findings.length).toBeGreaterThan(0);
    expect(insights.cards.length).toBeGreaterThan(0);
    expect(insights.generatedForRange).toEqual({ startYMD: '2026-07-01', endYMD: '2026-07-15' });
  });
  it('presenter renders every finding kind without dev terminology', () => {
    const lines = formatFindings(findings, 'es');
    expect(lines.length).toBe(findings.length);
    for (const line of lines) {
      expect(line).not.toMatch(/canonical|_attribution|undefined/i);
      expect(line.includes('NaN')).toBe(false);   // case-sensitive ("Ganancia" contains "nan")
    }
  });
  it('sortFindings is stable for equal severity/magnitude (id asc)', () => {
    const a: InsightFinding = { id: 'a:x', kind: 'service_share', severity: 'information', confidence: 1, source: 'canonical_report_money', relatedMetrics: [], dateRange: { startYMD: '2026-07-01', endYMD: '2026-07-15' }, magnitude: 10, data: {} };
    const b: InsightFinding = { ...a, id: 'b:x' };
    expect(sortFindings([b, a]).map((f) => f.id)).toEqual(['a:x', 'b:x']);
  });
});
