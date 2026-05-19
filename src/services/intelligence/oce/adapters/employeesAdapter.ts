// R-EMPLOYEE-OCE-V1 — Employees module OCE adapter.
// Signals: technician_repair_backlog, technician_stuck_repairs, employee_void_activity.
// Read-only analysis only. No discount signals (discountsAdapter covers those).

import type { Repair, Sale } from '@/store/types';
import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

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

function daysSince(ms: number, now: number): number {
  return (now - ms) / 86_400_000;
}

const TERMINAL = new Set(['picked_up', 'cancelled', 'refunded', 'Picked Up', 'Cancelled', 'Refunded']);
const ACTIVE_STATUS = (s: string) => !TERMINAL.has(s);

const STUCK_STATUSES = new Set(['waiting_parts', 'in_progress']);
const STUCK_DAYS = 5;

const employeesAdapter: OperationalModuleAdapter = {
  module: 'employees',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    let repairs: Repair[];
    let sales: Sale[];
    try { repairs = engine.getRepairs(); } catch { return []; }
    try { sales = engine.getSales(); } catch { sales = []; }

    const activeRepairs = repairs.filter((r) => r.status && ACTIVE_STATUS(String(r.status)));

    // 1. Repair backlog per technician — 5+ active repairs assigned to one employee
    try {
      const byTech = new Map<string, Repair[]>();
      for (const r of activeRepairs) {
        const key = r.employeeName || r.employeeId;
        if (!key) continue;
        const bucket = byTech.get(key);
        if (bucket) bucket.push(r); else byTech.set(key, [r]);
      }

      const overloaded = Array.from(byTech.entries())
        .filter(([, rs]) => rs.length >= 5)
        .sort(([, a], [, b]) => b.length - a.length)
        .slice(0, 3);

      for (const [techName, rs] of overloaded) {
        // actionTarget: oldest repair for that tech
        const oldest = rs.reduce((a, b) => toMs(a.createdAt) < toMs(b.createdAt) ? a : b);
        signals.push({
          id: `employees:margin_risk:backlog:${techName.slice(0, 20).replace(/\s+/g, '_')}`,
          type: 'margin_risk',
          sourceModule: 'employees',
          severity: rs.length >= 8 ? 'high' : 'medium',
          title: `${techName} — ${rs.length} active repairs in queue`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_repair',
          entityId: oldest.id,
          score: Math.min(100, 40 + rs.length * 5),
          tags: ['employee_repair_backlog', 'technician_bottleneck'],
          metadata: { count: rs.length, techName },
        });
      }
    } catch { /* skip */ }

    // 2. Technician stuck repairs — 3+ waiting_parts ≥5d OR in_progress past estimatedCompletion
    try {
      const byTechStuck = new Map<string, Repair[]>();
      for (const r of activeRepairs) {
        if (!STUCK_STATUSES.has(String(r.status))) continue;
        const key = r.employeeName || r.employeeId;
        if (!key) continue;
        const isStuck =
          (String(r.status) === 'waiting_parts' && daysSince(toMs(r.createdAt), now) >= STUCK_DAYS) ||
          (String(r.status) === 'in_progress' && r.estimatedCompletion && toMs(r.estimatedCompletion) < now);
        if (!isStuck) continue;
        const bucket = byTechStuck.get(key);
        if (bucket) bucket.push(r); else byTechStuck.set(key, [r]);
      }

      const bottlenecked = Array.from(byTechStuck.entries())
        .filter(([, rs]) => rs.length >= 3)
        .sort(([, a], [, b]) => b.length - a.length)
        .slice(0, 3);

      for (const [techName, rs] of bottlenecked) {
        const oldest = rs.reduce((a, b) => toMs(a.createdAt) < toMs(b.createdAt) ? a : b);
        signals.push({
          id: `employees:margin_risk:stuck:${techName.slice(0, 20).replace(/\s+/g, '_')}`,
          type: 'margin_risk',
          sourceModule: 'employees',
          severity: 'high',
          title: `${techName} — ${rs.length} stuck repair${rs.length !== 1 ? 's' : ''} (waiting parts / past estimate)`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_repair',
          entityId: oldest.id,
          score: Math.min(100, 55 + rs.length * 5),
          tags: ['technician_bottleneck'],
          metadata: { count: rs.length, techName },
        });
      }
    } catch { /* skip */ }

    // 3. Employee void activity today — 2+ voided sales by same employee
    try {
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      const todayVoids = sales.filter((s) =>
        String(s.status ?? '').toLowerCase() === 'voided' &&
        toMs(s.createdAt) >= todayMs,
      );

      const byEmp = new Map<string, number>();
      for (const s of todayVoids) {
        const key = s.employeeName || s.employeeId;
        if (!key) continue;
        byEmp.set(key, (byEmp.get(key) ?? 0) + 1);
      }

      const highVoid = Array.from(byEmp.entries())
        .filter(([, count]) => count >= 2)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);

      for (const [empName, count] of highVoid) {
        signals.push({
          id: `employees:margin_risk:voids:${empName.slice(0, 20).replace(/\s+/g, '_')}`,
          type: 'margin_risk',
          sourceModule: 'employees',
          severity: count >= 4 ? 'high' : 'medium',
          title: `${empName} — ${count} void${count !== 1 ? 's' : ''} today — review`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 35 + count * 8),
          tags: ['employee_void_risk'],
          metadata: { count, employeeName: empName },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { employeesAdapter };
