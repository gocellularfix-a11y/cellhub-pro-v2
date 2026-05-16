// Companion — Snapshot computation (desktop).
//
// Pure derivation from POS state. Uses ONLY core POS helpers
// (@/utils/dates, @/utils/repairStatus) — does NOT import from the
// legacy companion aggregator under src/services/companion.
//
// Mirrors the subset of fields required by Companion's
// StoreStatusSnapshot.

import type { Employee, Layaway, Repair, Sale } from '@/store/types';
import { isToday } from '@/utils/dates';
import { normalizeRepairStatus } from '@/utils/repairStatus';

export interface SnapshotInputs {
  sales: Sale[];
  repairs: Repair[];
  layaways: Layaway[];
  employees: Employee[];
  currentEmployee: Employee | null;
}

export interface LiteSnapshot {
  todayRevenueCents: number;
  todaySalesCount: number;
  openRepairsCount: number;
  pendingLayawaysCount: number;
  clockedInCount: number;
  clockedInNames: string[];
}

function isSaleCountable(s: Sale): boolean {
  const st = (s.status || '').toLowerCase();
  return st !== 'voided' && st !== 'refunded';
}

function isOpenRepair(r: Repair): boolean {
  const n = normalizeRepairStatus(r.status);
  return n !== 'picked_up' && n !== 'cancelled' && n !== 'refunded';
}

function isPendingLayaway(l: Layaway): boolean {
  const s = (l.status || '').toLowerCase();
  return s === 'active' || s === '';
}

function deriveOnShift(employees: Employee[], current: Employee | null): Employee[] {
  const out: Employee[] = [];
  const seen = new Set<string>();
  if (current && current.active !== false) {
    out.push(current);
    seen.add(current.id);
  }
  for (const e of employees) {
    if (!e || !e.active) continue;
    const log = e.clockLog || [];
    if (log.length === 0) continue;
    const last = log[log.length - 1];
    if (!last || last.clockOut) continue;
    if (seen.has(e.id)) continue;
    out.push(e);
    seen.add(e.id);
  }
  return out;
}

export function computeLiteSnapshot(input: SnapshotInputs): LiteSnapshot {
  const todaySales = input.sales.filter((s) => isSaleCountable(s) && isToday(s.createdAt));
  const todayRevenueCents = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);

  const openRepairsCount = input.repairs.filter(isOpenRepair).length;
  const pendingLayawaysCount = input.layaways.filter(isPendingLayaway).length;

  const clockedInEmployees = deriveOnShift(input.employees, input.currentEmployee);

  return {
    todayRevenueCents,
    todaySalesCount: todaySales.length,
    openRepairsCount,
    pendingLayawaysCount,
    clockedInCount: clockedInEmployees.length,
    clockedInNames: clockedInEmployees.map(e => e.name),
  };
}
