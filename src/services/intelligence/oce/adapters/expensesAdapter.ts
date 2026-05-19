// R-EXPENSES-OCE-V1 — Expenses module OCE adapter.
// Signals: expense_spike, payroll_pressure, cashflow_pressure, manual_expense_risk.
// All margin_risk type → business_risk in GPO. No accounting logic duplicated.

import type { Expense } from '@/store/types';
import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

// ISO "YYYY-MM-DD" string N days before a given timestamp
function isoDateOffset(ms: number, daysBack: number): string {
  return new Date(ms - daysBack * 86_400_000).toISOString().slice(0, 10);
}

function toMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') { const n = new Date(ts).getTime(); return Number.isFinite(n) ? n : 0; }
  if (typeof ts === 'object' && ts !== null) {
    const obj = ts as Record<string, unknown>;
    if (typeof obj['toDate'] === 'function') { try { return (obj['toDate'] as () => Date)().getTime(); } catch { return 0; } }
    if (typeof obj['seconds'] === 'number') return (obj['seconds'] as number) * 1000;
  }
  return 0;
}

function sumCents(expenses: Expense[]): number {
  return expenses.reduce((s, e) => s + (e.amount || 0), 0);
}

const expensesAdapter: OperationalModuleAdapter = {
  module: 'expenses',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    let expenses: ReturnType<typeof engine.getExpenses>;
    try { expenses = engine.getExpenses(); } catch { return []; }
    if (!expenses || expenses.length === 0) return [];

    const todayIso    = isoDateOffset(now, 0);
    const ago7Iso     = isoDateOffset(now, 7);
    const ago30Iso    = isoDateOffset(now, 30);

    const todayExp    = expenses.filter((e) => e.date === todayIso);
    const last7Exp    = expenses.filter((e) => e.date >= ago7Iso && e.date <= todayIso);
    const last30Exp   = expenses.filter((e) => e.date >= ago30Iso && e.date <= todayIso);

    const todayCents  = sumCents(todayExp);
    const last30Cents = sumCents(last30Exp);
    // daily average excludes today to avoid inflating the baseline
    const prior29     = last30Exp.filter((e) => e.date < todayIso);
    const dailyAvg    = prior29.length > 0 ? sumCents(prior29) / 29 : 0;

    // 1. Expense spike today — today ≥ $50 AND ≥ 2× 30-day daily average
    try {
      if (todayCents >= 5_000 && (dailyAvg === 0 || todayCents >= 2 * dailyAvg)) {
        const ratio = dailyAvg > 0 ? (todayCents / dailyAvg).toFixed(1) : '—';
        signals.push({
          id: 'expenses:margin_risk:spike',
          type: 'margin_risk',
          sourceModule: 'expenses',
          severity: todayCents >= 3 * dailyAvg || todayCents >= 50_000 ? 'high' : 'medium',
          title: `Expenses unusually high today ($${(todayCents / 100).toFixed(0)})${dailyAvg > 0 ? ` — ${ratio}× daily avg` : ''}`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 40 + Math.floor(todayCents / 5_000)),
          tags: ['expense_spike'],
          metadata: { todayCents, dailyAvgCents: Math.round(dailyAvg) },
        });
      }
    } catch { /* skip */ }

    // 2. Payroll pressure — 7-day payroll ≥ $1,000 or single entry ≥ $300 today
    try {
      const payroll7 = last7Exp.filter((e) => e.category === 'payroll');
      const payroll7Cents = sumCents(payroll7);
      const payrollToday = sumCents(payroll7.filter((e) => e.date === todayIso));
      if (payroll7Cents >= 100_000 || payrollToday >= 30_000) {
        signals.push({
          id: 'expenses:margin_risk:payroll',
          type: 'margin_risk',
          sourceModule: 'expenses',
          severity: payroll7Cents >= 200_000 || payrollToday >= 50_000 ? 'high' : 'medium',
          title: `Payroll $${(payroll7Cents / 100).toFixed(0)} in 7 days${payrollToday > 0 ? ` ($${(payrollToday / 100).toFixed(0)} today)` : ''}`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 35 + Math.floor(payroll7Cents / 10_000)),
          tags: ['payroll_pressure'],
          metadata: { payroll7Cents, payrollTodayCents: payrollToday },
        });
      }
    } catch { /* skip */ }

    // 3. Cash-flow pressure — today expenses ≥ $50 AND expenses > today's revenue
    try {
      if (todayCents >= 5_000) {
        const todaySalesCents = engine.getSales()
          .filter((s) => {
            if (String(s.status ?? '').toLowerCase() === 'voided') return false;
            const ms = toMs(s.createdAt);
            return ms > 0 && new Date(ms).toISOString().slice(0, 10) === todayIso;
          })
          .reduce((s, sale) => s + (sale.total ?? 0), 0);

        if (todayCents > todaySalesCents) {
          const ratio = todaySalesCents > 0
            ? `expenses $${(todayCents / 100).toFixed(0)} vs revenue $${(todaySalesCents / 100).toFixed(0)}`
            : `expenses $${(todayCents / 100).toFixed(0)} with no revenue yet`;
          signals.push({
            id: 'expenses:margin_risk:cashflow',
            type: 'margin_risk',
            sourceModule: 'expenses',
            severity: todaySalesCents === 0 || todayCents >= 2 * todaySalesCents ? 'high' : 'medium',
            title: `Cash-flow pressure today — ${ratio}`,
            createdAt: now,
            actionable: false,
            score: Math.min(100, 45 + Math.floor((todayCents - todaySalesCents) / 5_000)),
            tags: ['cashflow_pressure'],
            metadata: { expenseCents: todayCents, revenueCents: todaySalesCents },
          });
        }
      }
    } catch { /* skip */ }

    // 4. Manual cash expense risk — 3+ cash entries ≥ $25 each in 7 days, or total ≥ $200
    try {
      const largeCash = last7Exp.filter(
        (e) => e.paymentMethod === 'cash' && (e.amount || 0) >= 2_500,
      );
      const cashTotal = sumCents(largeCash);
      if (largeCash.length >= 3 || cashTotal >= 20_000) {
        signals.push({
          id: 'expenses:margin_risk:manual_cash',
          type: 'margin_risk',
          sourceModule: 'expenses',
          severity: 'medium',
          title: `${largeCash.length} manual cash expense${largeCash.length !== 1 ? 's' : ''} this week ($${(cashTotal / 100).toFixed(0)} total) — review`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 25 + largeCash.length * 5),
          tags: ['manual_expense_risk'],
          metadata: { count: largeCash.length, cashTotalCents: cashTotal },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { expensesAdapter };
