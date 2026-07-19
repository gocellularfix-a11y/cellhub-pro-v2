// ============================================================
// Business Analyst — employee patterns (I3-3 Part 8).
//
// Best revenue / profit / margin / avg ticket / most repairs / most unlocks —
// ONLY when exact attribution exists (same I3-2 guard: any completed service
// record in range without employee attribution → a single refusal finding,
// no per-employee numbers). All money via canonical scoped projections.
// ============================================================

import type { StructuredQueryContext, ResolvedBusinessDateRange } from '../query/types';
import {
  employeeSnapshot, discoverEmployees, countUnattributedServiceRecords,
} from '../query/scopeBusinessQueryData';
import { isRepairCompleted, isUnlockCompleted } from '@/services/reports/computeReportMoneyStats';
import { isWithinLocalDayRange } from '@/utils/reportRange';
import type { InsightFinding } from './types';

const rangeOf = (r: ResolvedBusinessDateRange) => ({ startYMD: r.startYMD, endYMD: r.endYMD });

interface EmployeeRow {
  name: string;
  revenueCents: number;
  profitCents: number;
  marginPct: number | null;    // null when not meaningful
  avgTicketCents: number | null;
  repairs: number;
  unlocks: number;
}

export function analyzeEmployees(ctx: StructuredQueryContext, range: ResolvedBusinessDateRange): InsightFinding[] {
  // EXACTNESS GUARD (Part 8: "only when exact attribution exists. Otherwise refuse.")
  if (countUnattributedServiceRecords(ctx.snapshot, range.range) > 0) {
    return [{
      id: 'employee_attribution_incomplete:range', kind: 'employee_attribution_incomplete',
      severity: 'information', confidence: 1, source: 'canonical_report_money',
      relatedMetrics: ['gross_sales', 'profit'], dateRange: rangeOf(range), magnitude: 0,
      data: { reason: 'unattributed_service_records_in_range' },
    }];
  }

  const inRange = (createdAt: unknown): boolean => {
    const d = new Date(createdAt as string | Date);
    return !isNaN(d.getTime()) && isWithinLocalDayRange(d, range.range);
  };

  const rows: EmployeeRow[] = [];
  for (const name of discoverEmployees(ctx.snapshot)) {
    const scoped = employeeSnapshot(ctx.snapshot, { name });
    const stats = ctx.computeForScopedSnapshot(scoped, range.range);
    const posOnly = ctx.computeForScopedSnapshot({ ...scoped, repairs: [], unlocks: [] }, range.range);
    rows.push({
      name,
      revenueCents: stats.grossSalesCents,
      profitCents: stats.totalProfitCents,
      marginPct: stats.profitMarginMeaningful ? stats.profitMargin : null,
      avgTicketCents: posOnly.txCount > 0 ? Math.round(posOnly.grossSalesCents / posOnly.txCount) : null,
      repairs: (scoped.repairs || []).filter((r) => isRepairCompleted(r) && inRange(r.createdAt)).length,
      unlocks: (scoped.unlocks || []).filter((u) => isUnlockCompleted(u) && inRange(u.createdAt)).length,
    });
  }
  const active = rows.filter((r) => r.revenueCents > 0 || r.repairs > 0 || r.unlocks > 0);
  if (active.length === 0) return [];

  const findings: InsightFinding[] = [];
  const best = <K extends keyof EmployeeRow>(key: K, filter?: (r: EmployeeRow) => boolean): EmployeeRow | null => {
    const pool = (filter ? active.filter(filter) : active)
      .filter((r) => typeof r[key] === 'number' && (r[key] as number) > 0);
    if (pool.length === 0) return null;
    return pool.sort((a, b) => (b[key] as number) - (a[key] as number) || a.name.localeCompare(b.name))[0];
  };
  const push = (kind: InsightFinding['kind'], row: EmployeeRow | null, value: number | null, metrics: InsightFinding['relatedMetrics']) => {
    if (!row || value === null || value <= 0) return;
    findings.push({
      id: `${kind}:${row.name.toLowerCase()}`, kind, severity: 'positive', confidence: 1,
      source: 'canonical_report_money', relatedMetrics: metrics, dateRange: rangeOf(range),
      magnitude: value, data: { employee: row.name, value },
    });
  };

  const revBest = best('revenueCents');
  push('employee_best_revenue', revBest, revBest?.revenueCents ?? null, ['gross_sales']);
  const profitBest = best('profitCents');
  push('employee_best_profit', profitBest, profitBest?.profitCents ?? null, ['profit']);
  const marginBest = active.filter((r) => r.marginPct !== null)
    .sort((a, b) => (b.marginPct as number) - (a.marginPct as number) || a.name.localeCompare(b.name))[0] ?? null;
  push('employee_best_margin', marginBest, marginBest?.marginPct ?? null, ['margin']);
  const repairBest = best('repairs');
  push('employee_most_repairs', repairBest, repairBest?.repairs ?? null, ['transaction_count']);
  const unlockBest = best('unlocks');
  push('employee_most_unlocks', unlockBest, unlockBest?.unlocks ?? null, ['transaction_count']);
  const ticketBest = active.filter((r) => r.avgTicketCents !== null)
    .sort((a, b) => (b.avgTicketCents as number) - (a.avgTicketCents as number) || a.name.localeCompare(b.name))[0] ?? null;
  push('employee_highest_avg_ticket', ticketBest, ticketBest?.avgTicketCents ?? null, ['average_ticket']);

  return findings;
}
