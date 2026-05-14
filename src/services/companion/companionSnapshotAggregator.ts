// ============================================================
// CellHub Pro — Companion Store Snapshot Aggregator
// (R-COMPANION-SNAPSHOT-AGGREGATOR-V1)
//
// Single source of truth for the operational store snapshot the
// Companion surfaces (desktop UI + mobile push). Previously the
// snapshot math was duplicated in CompanionCenter.tsx and
// CompanionRuntimeMount.tsx with brittle inline filters that did
// NOT use the canonical helpers — resulting in zeros even when the
// store had live data:
//
//   1) clockedIn looked at e.clockLog last-entry-without-clockOut,
//      but CellHub Pro never writes to clockLog on login/logout.
//      handleLogin (App.tsx) only setCurrentEmployee, and
//      handleClockOut (Sidebar) only clears it. Result: always 0.
//
//   2) todaySales used `new Date(s.createdAt as string)
//      .toLocaleDateString('en-CA')` instead of the canonical
//      isToday() helper. Also gated on `status === 'completed'`,
//      which silently excludes partial_refund sales that still
//      contain revenue (Dashboard uses isSaleCountable which only
//      excludes voided/refunded).
//
//   3) openRepairs used ad-hoc `.toLowerCase().replace(/ /g, '_')`
//      instead of normalizeRepairStatus(), missing legacy aliases
//      and dash-separated forms.
//
// This module fixes all three with the canonical helpers and the
// real runtime signal for on-shift (currentEmployee — CellHub Pro
// is single-employee-per-PC). Pure function; no React, no events,
// no side effects.
// ============================================================

import type { Employee, Repair, Sale } from '@/store/types';
import { isToday } from '@/utils/dates';
import { normalizeRepairStatus } from '@/utils/repairStatus';

export interface CompanionStoreSnapshot {
  todayRevenueCents: number;
  todaySalesCount: number;
  openRepairsCount: number;
  clockedInCount: number;
  clockedInNames: string[];
  clockedInEmployees: Employee[];
  pendingApprovalsCount: number;
}

export interface CompanionStoreSnapshotInput {
  sales: Sale[];
  repairs: Repair[];
  employees: Employee[];
  /** Active session — primary on-shift signal in CellHub Pro
   *  (clockLog isn't written today; currentEmployee is the truth). */
  currentEmployee: Employee | null;
  /** Pending count from companionApprovalRuntime (event-driven). */
  pendingApprovalsCount: number;
}

/**
 * Sale is countable for revenue if not voided/refunded. Mirrors the
 * helper Dashboard / Reports use so the Companion totals match the
 * other dashboards exactly. partial_refund stays countable — the
 * refund leg is a separate sale row that subtracts from totals.
 */
function isSaleCountable(s: Sale): boolean {
  const st = (s.status || '').toLowerCase();
  return st !== 'voided' && st !== 'refunded';
}

/** Repair counts as "open" when its status is neither picked_up,
 *  cancelled, nor refunded. normalizeRepairStatus handles legacy
 *  aliases (e.g. "Complete" / "complete" → picked_up) so we don't
 *  miss tickets stored with older status strings. */
function isOpenRepair(r: Repair): boolean {
  const n = normalizeRepairStatus(r.status);
  return n !== 'picked_up' && n !== 'cancelled' && n !== 'refunded';
}

/**
 * Derive the on-shift employee set. Combines two signals:
 *   1) clockLog last-entry-without-clockOut (the persisted form —
 *      kept for future-compat if a real clock-in writer lands)
 *   2) currentEmployee (the runtime session signal CellHub Pro
 *      actually uses today)
 *
 * Returns a deduplicated list, currentEmployee surfaced first when
 * present (its name is the one most likely to be on the store snapshot).
 */
function deriveOnShift(employees: Employee[], currentEmployee: Employee | null): Employee[] {
  const out: Employee[] = [];
  const seen = new Set<string>();

  if (currentEmployee && currentEmployee.active !== false) {
    out.push(currentEmployee);
    seen.add(currentEmployee.id);
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

/**
 * Build the canonical store snapshot from real runtime state.
 * Pure — same inputs always produce the same output. Consumers
 * (desktop CompanionCenter + CompanionRuntimeMount mobile push)
 * should call this from a useMemo keyed on the raw inputs.
 */
export function computeCompanionStoreSnapshot(
  input: CompanionStoreSnapshotInput,
): CompanionStoreSnapshot {
  const todaySales = input.sales.filter((s) => isSaleCountable(s) && isToday(s.createdAt));
  const todayRevenueCents = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);

  const openRepairsCount = input.repairs.filter(isOpenRepair).length;

  const clockedInEmployees = deriveOnShift(input.employees, input.currentEmployee);

  return {
    todayRevenueCents,
    todaySalesCount: todaySales.length,
    openRepairsCount,
    clockedInCount: clockedInEmployees.length,
    clockedInNames: clockedInEmployees.map((e) => e.name),
    clockedInEmployees,
    pendingApprovalsCount: input.pendingApprovalsCount,
  };
}
