// ============================================================
// Structured Query Executor — execution (I3-2).
//
// Deterministic, read-only execution of a validated ParsedBusinessQuery
// against canonical data. EVERY authoritative money value is read from
// computeReportMoneyStats projections (via the injected context) or from the
// canonical customer profiles — never re-derived. Scoping selects records;
// the canonical service computes.
// ============================================================

import type { ParsedBusinessQuery, BusinessMetric, BusinessDimension, BusinessQueryOperand } from '../language/types';
import type {
  StructuredBusinessQueryResult, StructuredQueryContext, StructuredScalarValue,
  StructuredQueryRow, StructuredComparisonResult, ResolvedBusinessDateRange,
} from './types';
import { METRIC_REGISTRY } from './canonicalMetricRegistry';
import type { MetricSources } from './canonicalMetricRegistry';
import { resolveBusinessDateRange, derivePreviousPeriod } from './resolveBusinessDateRange';
import {
  scopeSalesByCarrier, scopeSalesByEmployee, discoverCarriers, discoverEmployees,
  snapshotWithSales, posOnlySnapshot,
} from './scopeBusinessQueryData';
import { normalizeCarrier } from '@/utils/normalize';

/** Documented gate: a query executes only at or above this parser confidence. */
export const STRUCTURED_QUERY_MIN_CONFIDENCE = 0.55;

const money = (amount: number): StructuredScalarValue => ({ kind: 'money_cents', amount, meaningful: true });

function fail(parsed: ParsedBusinessQuery, status: StructuredBusinessQueryResult['status'], reason: string): StructuredBusinessQueryResult {
  return { status, parsed, sourceKinds: [], diagnostics: { reason } };
}

/** Canonical sources for metric extraction over a (possibly scoped) snapshot. */
function sourcesFor(ctx: StructuredQueryContext, range: ResolvedBusinessDateRange, scopedSales?: import('@/store/types').Sale[]): MetricSources {
  if (scopedSales) {
    const scoped = snapshotWithSales(ctx.snapshot, scopedSales);
    const stats = ctx.computeForScopedSnapshot(scoped, range.range);
    return { stats, posOnlyStats: stats };   // a scoped snapshot is already sales-only
  }
  const stats = ctx.computeForRange(range.range);
  const posOnlyStats = ctx.computeForScopedSnapshot(posOnlySnapshot(ctx.snapshot), range.range);
  return { stats, posOnlyStats };
}

function extractMetric(metric: BusinessMetric, sources: MetricSources): StructuredScalarValue | null {
  const def = METRIC_REGISTRY[metric];
  if (!def || def.customerScoped || !def.extract) return null;
  return def.extract(sources);
}

// ── comparison math (unit-level, not money math: deltas over canonical values) ──
function compare(leftLabel: string, rightLabel: string, left: StructuredScalarValue, right: StructuredScalarValue): StructuredComparisonResult {
  const deltaAmount = left.amount - right.amount;
  const result: StructuredComparisonResult = { leftLabel, rightLabel, left, right, deltaAmount };
  if (left.kind === 'percentage' || right.kind === 'percentage') {
    result.percentagePointDelta = Math.round((left.amount - right.amount) * 10) / 10;
  } else if (right.amount !== 0) {
    result.percentChange = Math.round(((left.amount - right.amount) / Math.abs(right.amount)) * 1000) / 10;
  }
  return result;
}

// ── entity execution helpers ────────────────────────────────
interface EntityExecution { value: StructuredScalarValue; label: string; excludedMixed?: number }

function executeEntityMetric(
  ctx: StructuredQueryContext,
  range: ResolvedBusinessDateRange,
  metric: BusinessMetric,
  dimension: BusinessDimension,
  operand: BusinessQueryOperand,
): EntityExecution | { error: 'unsupported' | 'not_found'; reason: string } {
  const entity = operand.entity;
  if (!entity) return { error: 'unsupported', reason: 'missing entity operand' };

  if (dimension === 'carrier') {
    const canonical = normalizeCarrier(entity.canonicalName || entity.rawText);
    const scoped = scopeSalesByCarrier(ctx.snapshot.sales || [], canonical);
    if (scoped.sales.length === 0 && scoped.excludedMixedSales === 0) {
      return { error: 'not_found', reason: `no ${canonical} activity` };
    }
    const v = extractMetric(metric, sourcesFor(ctx, range, scoped.sales));
    if (!v) return { error: 'unsupported', reason: `metric ${metric} not extractable` };
    return { value: v, label: canonical, excludedMixed: scoped.excludedMixedSales };
  }

  if (dimension === 'employee') {
    const emp = { id: entity.canonicalId, name: entity.canonicalName || entity.rawText };
    const scoped = scopeSalesByEmployee(ctx.snapshot.sales || [], emp);
    if (scoped.length === 0) return { error: 'not_found', reason: `no sales for ${emp.name}` };
    const v = extractMetric(metric, sourcesFor(ctx, range, scoped));
    if (!v) return { error: 'unsupported', reason: `metric ${metric} not extractable` };
    return { value: v, label: emp.name };
  }

  if (dimension === 'payment_provider') {
    // Canonical per-provider rows (count/totalCents/profitCents) — exact.
    const stats = ctx.computeForRange(range.range);
    const name = entity.canonicalName || entity.rawText;
    const key = Object.keys(stats.phonePaymentsByProvider).find((k) => k.toLowerCase() === name.toLowerCase());
    if (!key) return { error: 'not_found', reason: `no provider activity for ${name}` };
    const bucket = stats.phonePaymentsByProvider[key];
    if (metric === 'gross_sales') return { value: money(bucket.totalCents), label: key };
    if (metric === 'profit') return { value: money(bucket.profitCents), label: key };
    if (metric === 'transaction_count') return { value: { kind: 'count', amount: bucket.count, meaningful: true }, label: key };
    return { error: 'unsupported', reason: `provider rows expose gross/profit/count only (asked ${metric})` };
  }

  if (dimension === 'customer') {
    const profiles = ctx.getCustomerValueProfiles();
    const id = entity.canonicalId;
    const profile = id ? profiles.get(id) : undefined;
    if (!profile) return { error: 'not_found', reason: 'customer profile not found' };
    const label = entity.canonicalName || entity.rawText;
    switch (metric) {
      case 'total_collected': case 'gross_sales': return { value: money(profile.totalCollectedCents), label };
      case 'commissionable_revenue': return { value: money(profile.profitBearingRevenueCents), label };
      case 'customer_profit': case 'profit': return { value: money(profile.profitCents), label };
      case 'customer_margin': case 'margin':
        return { value: { kind: 'percentage', amount: profile.marginPercent, meaningful: profile.marginMeaningful }, label };
      case 'transaction_count': return { value: { kind: 'count', amount: profile.transactionCount, meaningful: true }, label };
      case 'average_ticket': return { value: money(profile.averageTicketCents), label };
      default: return { error: 'unsupported', reason: `customer metric ${metric} unsupported` };
    }
  }

  // store: the snapshot IS the current store's scope; another store's data is
  // not present. service/product entity money: no exact scoping — unsupported.
  return { error: 'unsupported', reason: `dimension ${dimension} has no exact entity scoping` };
}

// ── ranking / summarize rows ────────────────────────────────
function rowsForDimension(
  ctx: StructuredQueryContext,
  range: ResolvedBusinessDateRange,
  dimension: BusinessDimension,
  metric: BusinessMetric,
): StructuredQueryRow[] | { error: 'unsupported'; reason: string } {
  const stats = ctx.computeForRange(range.range);

  if (dimension === 'category') {
    // Canonical GROSS-activity category rows (revenue/cost/profit/margin).
    const pick = (r: { revenueCents: number; costCents: number; profitCents: number; marginPct: number | null }): StructuredScalarValue | null => {
      if (metric === 'gross_sales') return money(r.revenueCents);
      if (metric === 'cost') return money(r.costCents);
      if (metric === 'profit') return money(r.profitCents);
      if (metric === 'margin') return { kind: 'percentage', amount: r.marginPct ?? 0, meaningful: r.marginPct !== null };
      return null;
    };
    const rows: StructuredQueryRow[] = [];
    for (const c of stats.categoriesByRevenue) {
      const v = pick(c);
      if (!v) return { error: 'unsupported', reason: `category rows expose revenue/cost/profit/margin (asked ${metric})` };
      rows.push({ label: c.name, value: v, tieKey: c.name.toLowerCase() });
    }
    return rows;
  }

  if (dimension === 'payment_provider') {
    const rows: StructuredQueryRow[] = [];
    for (const [name, b] of Object.entries(stats.phonePaymentsByProvider)) {
      let v: StructuredScalarValue | null = null;
      if (metric === 'gross_sales') v = money(b.totalCents);
      else if (metric === 'profit') v = money(b.profitCents);
      else if (metric === 'transaction_count') v = { kind: 'count', amount: b.count, meaningful: true };
      if (!v) return { error: 'unsupported', reason: `provider rows expose gross/profit/count (asked ${metric})` };
      rows.push({ label: name, value: v, tieKey: name.toLowerCase() });
    }
    return rows;
  }

  if (dimension === 'product') {
    if (metric !== 'gross_sales') return { error: 'unsupported', reason: 'product rows expose gross line revenue only' };
    return stats.topItems.map((i) => ({ label: i.name, value: money(i.revenueCents), tieKey: i.name.toLowerCase() }));
  }

  if (dimension === 'employee') {
    if (metric === 'gross_sales' || metric === 'transaction_count') {
      return stats.topEmployees.map((e) => ({
        label: e.name,
        value: metric === 'gross_sales' ? money(e.revenueCents) : { kind: 'count', amount: e.transactions, meaningful: true },
        tieKey: e.name.toLowerCase(),
      }));
    }
    // Other metrics (profit/net/…): exact per-employee scoped canonical projections.
    const employees = discoverEmployees(ctx.snapshot.sales || []);
    const rows: StructuredQueryRow[] = [];
    for (const name of employees) {
      const scoped = scopeSalesByEmployee(ctx.snapshot.sales || [], { name });
      const v = extractMetric(metric, sourcesFor(ctx, range, scoped));
      if (!v) return { error: 'unsupported', reason: `metric ${metric} not extractable` };
      rows.push({ label: name, value: v, tieKey: name.toLowerCase() });
    }
    return rows;
  }

  if (dimension === 'carrier') {
    // Exact per-carrier scoped canonical projections over PURE single-carrier sales.
    const carriers = discoverCarriers(ctx.snapshot.sales || []);
    const rows: StructuredQueryRow[] = [];
    for (const carrier of carriers) {
      const scoped = scopeSalesByCarrier(ctx.snapshot.sales || [], carrier);
      const v = extractMetric(metric, sourcesFor(ctx, range, scoped.sales));
      if (!v) return { error: 'unsupported', reason: `metric ${metric} not extractable` };
      rows.push({ label: carrier, value: v, tieKey: carrier.toLowerCase() });
    }
    return rows;
  }

  if (dimension === 'customer') {
    if (metric === 'total_collected' || metric === 'gross_sales') {
      return ctx.getTopCustomersByValue(50).map((c) => ({
        label: c.name || c.customerId, value: money(c.revenueCents), tieKey: c.customerId,
      }));
    }
    if (metric === 'customer_profit' || metric === 'profit') {
      return ctx.getTopCustomersByValue(50).map((c) => ({
        label: c.name || c.customerId, value: money(c.profitCents), tieKey: c.customerId,
      }));
    }
    return { error: 'unsupported', reason: `customer rankings support total_collected / customer_profit (asked ${metric})` };
  }

  return { error: 'unsupported', reason: `dimension ${dimension} has no exact canonical grouping` };
}

function sortRows(rows: StructuredQueryRow[], direction: 'highest' | 'lowest'): StructuredQueryRow[] {
  return [...rows].sort((a, b) =>
    (direction === 'highest' ? b.value.amount - a.value.amount : a.value.amount - b.value.amount)
    || a.label.localeCompare(b.label)
    || a.tieKey.localeCompare(b.tieKey));
}

// ── main ────────────────────────────────────────────────────
export function executeBusinessQuery(parsed: ParsedBusinessQuery, ctx: StructuredQueryContext): StructuredBusinessQueryResult {
  // Validation gate (structured fields, not string matching).
  if (parsed.intent === 'unknown') return fail(parsed, 'unsupported', 'unknown intent');
  if (parsed.confidence < STRUCTURED_QUERY_MIN_CONFIDENCE) return fail(parsed, 'unsupported', 'below confidence gate');

  const range = resolveBusinessDateRange(parsed.dateRange, ctx.referenceDate);
  if (!range && parsed.comparison !== 'between_periods') {
    return fail(parsed, 'ambiguous', 'invalid date range');
  }

  // ── find_customer ──
  if (parsed.intent === 'find_customer') {
    const raw = (parsed.entity?.canonicalName || parsed.entity?.rawText || '').trim();
    // Fallback: strip the find-phrase words and match remaining tokens.
    const nameQuery = raw || parsed.normalizedText
      .replace(/\b(find|look up|search|buscar|busca|encontrar|encontre|procurar|al|a|the|customer|cliente|named|llamado|chamado)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!nameQuery) return fail(parsed, 'not_found', 'no customer name in query');
    const q = nameQuery.toLowerCase();
    const matches = ctx.customers.filter((c) => (c.name || '').toLowerCase().includes(q));
    if (matches.length === 0) return fail(parsed, 'not_found', `no customer matching "${nameQuery}"`);
    if (matches.length > 1) {
      return {
        status: 'ambiguous', parsed, sourceKinds: ['canonical_customer_money'],
        diagnostics: { reason: 'multiple customers match', candidates: matches.slice(0, 5).map((m) => m.name) },
      };
    }
    const h = ctx.getCustomerHistory(matches[0].id);
    if (!h) return fail(parsed, 'not_found', 'customer profile unavailable');
    return {
      status: 'answered', parsed, resolvedRange: range ?? undefined,
      sourceKinds: ['canonical_customer_money'],
      rows: [
        { label: 'total_collected', value: money(h.canonicalMoney.totalCollectedCents), tieKey: '1' },
        { label: 'commissionable_revenue', value: money(h.canonicalMoney.profitBearingRevenueCents), tieKey: '2' },
        { label: 'customer_profit', value: money(h.canonicalMoney.profitCents), tieKey: '3' },
        { label: 'customer_margin', value: { kind: 'percentage', amount: h.canonicalMoney.marginPercent, meaningful: h.canonicalMoney.marginMeaningful }, tieKey: '4' },
        { label: 'transaction_count', value: { kind: 'count', amount: h.canonicalMoney.transactionCount, meaningful: true }, tieKey: '5' },
        { label: 'average_ticket', value: money(h.canonicalMoney.averageTicketCents), tieKey: '6' },
      ],
      value: { kind: 'text', amount: 0, meaningful: true },
      diagnostics: { candidates: [matches[0].name] },
    };
  }

  // ── compare_metric ──
  if (parsed.intent === 'compare_metric') {
    const ops = parsed.comparisonOperands;

    if (parsed.comparison === 'between_metrics' && ops?.left.metric && ops.right.metric) {
      if (!range) return fail(parsed, 'ambiguous', 'invalid date range');
      const sources = sourcesFor(ctx, range);
      const left = extractMetric(ops.left.metric, sources);
      const right = extractMetric(ops.right.metric, sources);
      if (!left || !right) return fail(parsed, 'unsupported', 'operand metric not extractable');
      return {
        status: 'answered', parsed, resolvedRange: range, sourceKinds: ['canonical_report_money'],
        comparisonResult: compare(ops.left.metric, ops.right.metric, left, right),
      };
    }

    if (parsed.comparison === 'between_entities' && ops?.left.entity && ops.right.entity) {
      if (!range) return fail(parsed, 'ambiguous', 'invalid date range');
      const dimension = parsed.dimension ?? ops.left.dimension;
      if (!dimension) return fail(parsed, 'ambiguous', 'comparison dimension unresolved');
      if (ops.left.dimension && ops.right.dimension && ops.left.dimension !== ops.right.dimension) {
        return fail(parsed, 'ambiguous', 'incompatible comparison dimensions');
      }
      const metric = parsed.metric ?? 'gross_sales';
      const L = executeEntityMetric(ctx, range, metric, dimension, ops.left);
      if ('error' in L) return fail(parsed, L.error, L.reason);
      const R = executeEntityMetric(ctx, range, metric, dimension, ops.right);
      if ('error' in R) return fail(parsed, R.error, R.reason);
      return {
        status: 'answered', parsed, resolvedRange: range,
        sourceKinds: dimension === 'customer' ? ['canonical_customer_money'] : ['canonical_report_money'],
        comparisonResult: compare(L.label, R.label, L.value, R.value),
        diagnostics: { excludedMixedCarrierSales: (L.excludedMixed || 0) + (R.excludedMixed || 0) },
      };
    }

    if (parsed.comparison === 'between_periods' && ops?.left.dateRange && ops.right.dateRange) {
      const leftRange = resolveBusinessDateRange(ops.left.dateRange, ctx.referenceDate);
      const rightRange = resolveBusinessDateRange(ops.right.dateRange, ctx.referenceDate);
      if (!leftRange || !rightRange) return fail(parsed, 'ambiguous', 'invalid comparison period');
      const metric = parsed.metric ?? 'gross_sales';
      const left = extractMetric(metric, sourcesFor(ctx, leftRange));
      const right = extractMetric(metric, sourcesFor(ctx, rightRange));
      if (!left || !right) return fail(parsed, 'unsupported', 'metric not extractable');
      return {
        status: 'answered', parsed, resolvedRange: leftRange, sourceKinds: ['canonical_report_money'],
        comparisonResult: compare(leftRange.labelKind, rightRange.labelKind, left, right),
      };
    }

    // versus_previous_period / increase / decrease
    if (parsed.comparison === 'versus_previous_period' || parsed.comparison === 'increase' || parsed.comparison === 'decrease') {
      if (!range) return fail(parsed, 'ambiguous', 'invalid date range');
      const metric = parsed.metric ?? 'gross_sales';
      const previous = derivePreviousPeriod(range);
      const left = extractMetric(metric, sourcesFor(ctx, range));
      const right = extractMetric(metric, sourcesFor(ctx, previous));
      if (!left || !right) return fail(parsed, 'unsupported', 'metric not extractable');
      return {
        status: 'answered', parsed, resolvedRange: range, sourceKinds: ['canonical_report_money'],
        comparisonResult: compare(range.labelKind, 'previous_period', left, right),
      };
    }

    return fail(parsed, 'ambiguous', 'comparison operands missing');
  }

  // ── rank_dimension / summarize_dimension ──
  if (parsed.intent === 'rank_dimension' || parsed.intent === 'summarize_dimension') {
    if (!range) return fail(parsed, 'ambiguous', 'invalid date range');
    const dimension = parsed.dimension;
    if (!dimension) return fail(parsed, 'ambiguous', 'dimension unresolved');
    let metric = parsed.metric ?? 'gross_sales';
    if (dimension === 'customer' && metric === 'gross_sales') metric = 'total_collected';
    const rows = rowsForDimension(ctx, range, dimension, metric);
    if ('error' in rows) return fail(parsed, rows.error, rows.reason);
    const active = rows.filter((r) => r.value.amount !== 0 || r.value.kind === 'percentage');
    if (active.length === 0) return { status: 'no_data', parsed, resolvedRange: range, sourceKinds: ['canonical_report_money'] };
    const direction = parsed.comparison === 'lowest' ? 'lowest' : 'highest';
    const sorted = sortRows(active, direction).slice(0, 5);
    return {
      // Reflect the EFFECTIVE metric (e.g. customer gross_sales → total_collected)
      // so the formatter labels the answer with the metric actually executed.
      status: 'answered', parsed: { ...parsed, metric }, resolvedRange: range,
      sourceKinds: dimension === 'customer' ? ['canonical_customer_money'] : ['canonical_report_money'],
      rows: sorted,
    };
  }

  // ── get_metric ──
  if (parsed.intent === 'get_metric') {
    if (!range) return fail(parsed, 'ambiguous', 'invalid date range');
    const metric = parsed.metric;
    if (!metric) return fail(parsed, 'ambiguous', 'metric unresolved');

    // "Did profit increase this month?" parses as get_metric + an increase/
    // decrease comparison — execute it as a previous-period comparison.
    if (parsed.comparison === 'increase' || parsed.comparison === 'decrease') {
      const previous = derivePreviousPeriod(range);
      const left = extractMetric(metric, sourcesFor(ctx, range));
      const right = extractMetric(metric, sourcesFor(ctx, previous));
      if (!left || !right) return fail(parsed, 'unsupported', 'metric not extractable');
      return {
        status: 'answered', parsed, resolvedRange: range, sourceKinds: ['canonical_report_money'],
        comparisonResult: compare(range.labelKind, 'previous_period', left, right),
      };
    }
    const def = METRIC_REGISTRY[metric];
    if (!def) return fail(parsed, 'unsupported', 'unknown metric');

    // Entity-scoped get_metric.
    if (parsed.entity && parsed.dimension) {
      const r = executeEntityMetric(ctx, range, metric, parsed.dimension, { entity: parsed.entity, dimension: parsed.dimension });
      if ('error' in r) return fail(parsed, r.error, r.reason);
      return {
        status: 'answered', parsed, resolvedRange: range,
        sourceKinds: parsed.dimension === 'customer' ? ['canonical_customer_money'] : ['canonical_report_money'],
        value: r.value,
        rows: [{ label: r.label, value: r.value, tieKey: r.label.toLowerCase() }],
        diagnostics: r.excludedMixed ? { excludedMixedCarrierSales: r.excludedMixed } : undefined,
      };
    }

    // Customer-scoped metrics need a customer/ranking context.
    if (def.customerScoped) return fail(parsed, 'unsupported', 'customer metric without a customer scope');

    const v = extractMetric(metric, sourcesFor(ctx, range));
    if (!v) return fail(parsed, 'unsupported', 'metric not extractable');
    return { status: 'answered', parsed, resolvedRange: range, sourceKinds: ['canonical_report_money'], value: v };
  }

  return fail(parsed, 'unsupported', 'unhandled intent');
}
