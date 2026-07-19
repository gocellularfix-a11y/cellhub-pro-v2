// ============================================================
// I4 Business Manager — tests.
//
// Fixed reference date; the manager layer consumes real I3-3 insights built
// from a deterministic canonical fixture. Proves: executive summary, action
// engine, business score reproducibility, health sections, priority
// ordering stability, brief, dashboard, digest, smart follow-ups (EN/ES/PT),
// notification contracts, and full determinism.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { handleIntent } from '../chat/handlers';
import { clearAnalyticalContext } from '../query/analyticalContext';
import { actionsForFindings } from './actionEngine';
import { computeBusinessScore, SCORE_BASE, SCORE_WEIGHTS, SCORE_POSITIVE_CAP } from './businessScore';
import { computeHealthSections } from './healthEngine';
import { buildPriorityQueue } from './priorityEngine';
import { buildBusinessBrief, buildExecutiveSummary } from './businessBriefBuilder';
import { buildManagerDashboard } from './managerDashboard';
import { tryHandleManagerQuestion } from './smartFollowups';
import { buildNotificationContracts } from './notificationContracts';
import { formatBusinessBrief, formatSummaryItem } from './formatManager';
import { SEVERITY_RANK } from '../insights/types';
import type { InsightFinding } from '../insights/types';
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
const att = (day: string) => sale({
  createdAt: `${day}T10:00:00`, customerId: 'cust-jenny', customerPhone: '8054523932',
  items: [item({ name: 'AT&T - X', category: 'phone_payment' as SaleItem['category'], price: 6500, qty: 1, carrier: 'AT&T', portal: 'ePay' })],
  subtotal: 6500, total: 6500,
});
const accessory = (day: string, price: number, cost: number) => sale({
  createdAt: `${day}T09:00:00`, employeeName: 'Luis',
  items: [item({ name: `Case-${day}`, price, qty: 1, cost })],
  subtotal: price, total: price,
});

function buildWorld() {
  const sales: Sale[] = [
    att('2026-07-03'), att('2026-07-06'), att('2026-07-09'),
    accessory('2026-07-05', 2000, 800),
    att('2026-06-05'), att('2026-06-08'), att('2026-06-12'),
    accessory('2026-06-18', 9000, 4000), accessory('2026-06-22', 7000, 3000),
    sale({ createdAt: '2026-03-01T10:00:00', customerId: 'cust-lost', customerPhone: '8050001111', items: [item({ name: 'OldCase', price: 3000, qty: 1, cost: 1000 })], subtotal: 3000, total: 3000 }),
    sale({ createdAt: '2026-04-01T10:00:00', customerId: 'cust-back', customerPhone: '8052223333', items: [item({ name: 'A', price: 2000, qty: 1, cost: 500 })], subtotal: 2000, total: 2000 }),
    sale({ createdAt: '2026-07-14T10:00:00', customerId: 'cust-back', customerPhone: '8052223333', items: [item({ name: 'B', price: 2500, qty: 1, cost: 700 })], subtotal: 2500, total: 2500 }),
  ];
  const repairs: Repair[] = [
    { id: 'rep-1', customerId: 'x', status: 'picked_up', balance: 0, total: 9000, laborCost: 2000, employeeName: 'Ana', parts: [], createdAt: '2026-07-05T12:00:00' } as unknown as Repair,
    { id: 'rep-2', customerId: 'x', status: 'picked_up', balance: 0, total: 15000, laborCost: 2000, employeeName: 'Ana', parts: [], createdAt: '2026-06-20T12:00:00' } as unknown as Repair,
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

beforeEach(() => clearAnalyticalContext());

const insightsOf = (engine: IntelligenceEngine) => engine.getBusinessInsights(REF, 'this_month');

// ══ Executive summary (Part 2) ══════════════════════════════
describe('I4 — executive summary', () => {
  it('built only from findings, headline metrics first, deterministic', () => {
    const insights = insightsOf(buildEngine());
    const summary = buildExecutiveSummary(insights.findings);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary[0].kind).toBe('metric_direction');
    expect(summary[0].data.metric).toBe('gross_sales');
    // Customer returned + lost customer present (fixture guarantees both).
    expect(summary.find((s) => s.kind === 'customer_returned')?.data.name).toBe('MARIA SOTO');
    expect(summary.find((s) => s.kind === 'customers_lost')?.data.count).toBe(1);
    // Determinism.
    expect(buildExecutiveSummary(insights.findings)).toEqual(summary);
  });
  it('empty findings → single no_significant_changes item', () => {
    expect(buildExecutiveSummary([])).toEqual([{ kind: 'no_significant_changes', data: {} }]);
  });
  it('summary items render localized (EN/ES/PT), never inventing', () => {
    const item: ReturnType<typeof buildExecutiveSummary>[0] = { kind: 'metric_direction', data: { metric: 'profit', direction: 'up' } };
    expect(formatSummaryItem(item, 'en')).toBe('Profit increased.');
    expect(formatSummaryItem(item, 'es')).toBe('Ganancia subió.');
    expect(formatSummaryItem(item, 'pt')).toBe('Lucro subiu.');
  });
});

// ══ Action engine (Part 3) ══════════════════════════════════
describe('I4 — action engine', () => {
  it('deterministic finding→action mapping, prioritized, ids stable', () => {
    const insights = insightsOf(buildEngine());
    const actions = actionsForFindings(insights.findings);
    // Lost customer → contact_customer (high).
    const contact = actions.find((a) => a.kind === 'contact_customer' && a.relatedFindingId === 'customer_lost:cust-lost');
    expect(contact).toBeTruthy();
    expect(contact!.priority).toBe('high');
    expect(contact!.status).toBe('proposed');   // I4.1 lifecycle default
    expect(contact!.id).toBe('contact_customer:customer_lost:cust-lost');
    // Priority ordering: no lower-priority action before a higher one.
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    for (let i = 1; i < actions.length; i++) {
      expect(rank[actions[i - 1].priority]).toBeLessThanOrEqual(rank[actions[i].priority]);
    }
    // Determinism.
    expect(actionsForFindings(insights.findings)).toEqual(actions);
  });
  it('no finding → no action (nothing invented)', () => {
    expect(actionsForFindings([])).toEqual([]);
  });
});

// ══ Business score (Part 4) ═════════════════════════════════
describe('I4 — business score', () => {
  it('reproducible and exactly derived from the exported weights', () => {
    const insights = insightsOf(buildEngine());
    const score = computeBusinessScore(insights.findings);
    const b = score.breakdown;
    const positiveDelta = Math.min(SCORE_POSITIVE_CAP, b.opportunityCount * SCORE_WEIGHTS.opportunity + b.positiveCount * SCORE_WEIGHTS.positive);
    const expected = Math.max(0, Math.min(100, SCORE_BASE
      + b.criticalCount * SCORE_WEIGHTS.critical
      + b.warningCount * SCORE_WEIGHTS.warning
      + positiveDelta
      + (b.trendDirection === 'up' ? SCORE_WEIGHTS.trendUp : b.trendDirection === 'down' ? SCORE_WEIGHTS.trendDown : 0)));
    expect(score.score).toBe(expected);
    expect(computeBusinessScore(insights.findings)).toEqual(score);   // no randomness
  });
  it('clamped to 0..100', () => {
    const critical = (i: number): InsightFinding => ({
      id: `sales_below_rolling_average:x${i}`, kind: 'sales_below_rolling_average', severity: 'critical',
      confidence: 1, source: 'canonical_report_money', relatedMetrics: [], dateRange: { startYMD: '2026-07-01', endYMD: '2026-07-15' }, magnitude: 1, data: {},
    });
    const score = computeBusinessScore([1, 2, 3, 4, 5, 6].map(critical));
    expect(score.score).toBe(0);
  });
});

// ══ Health sections (Part 5) ════════════════════════════════
describe('I4 — health sections', () => {
  it('eight sections, statuses driven by finding severities with exact reasons', () => {
    const insights = insightsOf(buildEngine());
    const health = computeHealthSections(insights.findings);
    expect(health.map((h) => h.key)).toEqual(['revenue', 'profit', 'margin', 'customers', 'employees', 'inventory', 'services', 'carriers']);
    const customers = health.find((h) => h.key === 'customers')!;
    expect(customers.status).toBe('watch');   // lost customer = warning-class risk
    expect(customers.reasonFindingIds).toContain('customer_lost:cust-lost');
    // I4.1: healthy REQUIRES cited positive/stable evidence; no evidence →
    // unavailable, never healthy-by-silence.
    for (const h of health.filter((x) => x.status === 'healthy')) {
      expect(h.reasonFindingIds.length).toBeGreaterThan(0);
      expect(h.evaluable).toBe(true);
    }
    for (const h of health.filter((x) => x.status === 'unavailable')) {
      expect(h.evaluable).toBe(false);
      expect(h.confidence).toBe(0);
    }
  });
  it('critical finding escalates its section to critical', () => {
    const f: InsightFinding = {
      id: 'sales_below_rolling_average:gross_sales', kind: 'sales_below_rolling_average', severity: 'critical',
      confidence: 1, source: 'canonical_report_money', relatedMetrics: ['gross_sales'], dateRange: { startYMD: '2026-07-01', endYMD: '2026-07-15' }, magnitude: 100, data: {},
    };
    const health = computeHealthSections([f]);
    expect(health.find((h) => h.key === 'revenue')!.status).toBe('critical');
    expect(health.find((h) => h.key === 'revenue')!.reasonFindingIds).toEqual([f.id]);
  });
});

// ══ Priority engine (Part 6) ════════════════════════════════
describe('I4 — priority engine', () => {
  it('merged queue: urgency → impact → confidence → date → id; stable', () => {
    const insights = insightsOf(buildEngine());
    const actions = actionsForFindings(insights.findings);
    const queue = buildPriorityQueue(insights.findings, actions);
    expect(queue.length).toBe(insights.findings.length + actions.length);
    // Critical/warning findings come before low-priority actions.
    const firstWarning = queue.findIndex((i) => i.itemType === 'finding' && i.severity === 'warning');
    const lastLowAction = queue.map((i, idx) => ({ i, idx })).filter((x) => x.i.itemType === 'action' && x.i.severity === 'low').pop();
    if (firstWarning >= 0 && lastLowAction) expect(firstWarning).toBeLessThan(lastLowAction.idx);
    // Stability: identical inputs → identical queue.
    expect(buildPriorityQueue(insights.findings, actions)).toEqual(queue);
  });
});

// ══ Brief + dashboard + digest (Parts 1, 7, 8, 12) ══════════
describe('I4 — brief, dashboard, digest', () => {
  const engine = buildEngine();

  it('brief: all sections present and deterministic', () => {
    const brief = engine.getBusinessBrief(REF, 'this_month');
    expect(brief.generatedForRange).toEqual({ startYMD: '2026-07-01', endYMD: '2026-07-15' });
    expect(brief.executiveSummary.length).toBeGreaterThan(0);
    expect(brief.warnings.length).toBeGreaterThan(0);          // lost customer
    expect(brief.recommendedActions.length).toBeGreaterThan(0);
    expect(brief.suggestedQuestions.length).toBeGreaterThan(0);
    expect(brief.health.length).toBe(8);
    expect(brief.priorityQueue.length).toBeGreaterThan(0);
    expect(engine.getBusinessBrief(REF, 'this_month')).toEqual(brief);   // deterministic
  });
  it('dashboard: every section representable (Part 12 owner experience)', () => {
    const dash = engine.getManagerDashboard(REF, 'this_month');
    expect(dash.overview.score.score).toBeGreaterThanOrEqual(0);
    expect(dash.overview.health.length).toBe(8);
    expect(dash.todaysFocus).not.toBeNull();
    expect(dash.alerts.length).toBeGreaterThan(0);
    expect(dash.recommendedActions.length).toBeGreaterThan(0);
    expect(dash.quickQuestions.length).toBeGreaterThan(0);
    expect(Array.isArray(dash.topOpportunities)).toBe(true);
    expect(Array.isArray(dash.recentImprovements)).toBe(true);
    expect(Array.isArray(dash.recentDeclines)).toBe(true);
  });
  it('digest: every supported range kind, deterministic', () => {
    for (const kind of ['today', 'yesterday', 'this_week', 'this_month', 'last_30_days'] as const) {
      const digest = engine.getBusinessDigest(kind, REF);
      expect(digest.rangeKind).toBe(kind);
      expect(digest.brief.health.length).toBe(8);
      expect(engine.getBusinessDigest(kind, REF)).toEqual(digest);
    }
  });
  it('notification contracts: deterministic finding mapping, contracts only', () => {
    const insights = insightsOf(engine);
    const notifications = buildNotificationContracts(insights.findings);
    expect(notifications.length).toBeGreaterThan(0);
    const lost = notifications.find((n) => n.sourceFindingId === 'customer_lost:cust-lost');
    expect(lost?.kind).toBe('alert');   // warning severity → alert contract
    const recovery = notifications.find((n) => n.kind === 'recovery');
    expect(recovery?.sourceFindingId).toBe('customer_returning_after_absence:cust-back');
  });
});

// ══ Smart follow-ups (Part 9) ═══════════════════════════════
describe('I4 — smart follow-ups (rule engine, live chat)', () => {
  it('"What should I focus on today?" → full brief (EN)', () => {
    const r = tryHandleManagerQuestion(buildEngine(), 'What should I focus on today?', 'en', REF);
    expect(r?.text).toContain('Business brief');
    expect(r?.text).toContain('/100');
    expect(r?.text).toContain('Recommended actions:');
  });
  it('ES/PT focus phrasings', () => {
    expect(tryHandleManagerQuestion(buildEngine(), '¿En qué me enfoco hoy?', 'es', REF)?.text).toContain('Resumen del negocio');
    expect(tryHandleManagerQuestion(buildEngine(), 'Em que devo focar hoje?', 'pt', REF)?.text).toContain('Resumo do negócio');
  });
  it('"What is my biggest problem?" → highest-priority issue + action', () => {
    const r = tryHandleManagerQuestion(buildEngine(), 'What is my biggest problem?', 'en', REF);
    expect(r?.text).toBeTruthy();
    expect(r!.text.split('\n').length).toBeLessThanOrEqual(3);   // concise: issue (+ action)
  });
  it('"What opportunity am I missing?" → top opportunity', () => {
    const r = tryHandleManagerQuestion(buildEngine(), 'What opportunity am I missing?', 'en', REF);
    expect(r?.text).toBeTruthy();
  });
  it('unmatched text → null (all existing chat behavior preserved)', () => {
    expect(tryHandleManagerQuestion(buildEngine(), 'profit this month', 'en', REF)).toBeNull();
    expect(tryHandleManagerQuestion(buildEngine(), 'tell me a joke', 'en', REF)).toBeNull();
  });
  it('live routing: handleIntent(data_query) reaches the manager brief', () => {
    const res = handleIntent({ id: 'data_query', confidence: 1, query: 'What should I focus on today?' } as never, buildEngine(), 'en');
    expect(res.kind).toBe('answer');
    expect((res as { text: string }).text).toContain('Business brief');
  });
  it('brief presenter renders without dev terminology', () => {
    const engine = buildEngine();
    const insights = insightsOf(engine);
    const brief = engine.getBusinessBrief(REF, 'this_month');
    const text = formatBusinessBrief(brief, 'es', new Map(insights.findings.map((f) => [f.id, f])));
    expect(text).not.toMatch(/canonical|_attribution|undefined/i);
    expect(text.includes('NaN')).toBe(false);
  });
});

// ══ Determinism + severity contract ═════════════════════════
describe('I4 — determinism regression', () => {
  it('two identical engines → identical brief, dashboard, score, queue', () => {
    const a = buildEngine().getBusinessBrief(REF, 'this_month');
    const b = buildEngine().getBusinessBrief(REF, 'this_month');
    expect(b).toEqual(a);
  });
  it('priority queue ordering respects SEVERITY_RANK for findings', () => {
    const brief = buildEngine().getBusinessBrief(REF, 'this_month');
    const findingItems = brief.priorityQueue.filter((i) => i.itemType === 'finding');
    for (let i = 1; i < findingItems.length; i++) {
      const prev = SEVERITY_RANK[findingItems[i - 1].severity as keyof typeof SEVERITY_RANK];
      const cur = SEVERITY_RANK[findingItems[i].severity as keyof typeof SEVERITY_RANK];
      expect(prev).toBeLessThanOrEqual(cur);
    }
  });
});
