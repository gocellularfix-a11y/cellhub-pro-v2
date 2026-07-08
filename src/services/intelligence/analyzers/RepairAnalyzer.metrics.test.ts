// ============================================================
// R-INTEL-V2-PHASE0: repairs "pending" KPI regression test.
// The KPI dashboard used to populate repairs.pending from totalCompleted
// (picked-up count). getMetrics now also returns totalActive = open tickets
// (not picked_up / cancelled), which is what the KPI should show.
// ============================================================

import { describe, it, expect } from 'vitest';
import { RepairAnalyzer } from './RepairAnalyzer';
import type { Repair } from '@/store/types';

const now = new Date().toISOString();

const repairs = [
  { id: 'r1', status: 'picked_up',  createdAt: now, completedAt: now },
  { id: 'r2', status: 'in_progress', createdAt: now },
  { id: 'r3', status: 'ready',       createdAt: now },
  { id: 'r4', status: 'cancelled',   createdAt: now },
  { id: 'r5', status: 'received',    createdAt: now },
] as unknown as Repair[];

describe('RepairAnalyzer.getMetrics — totalActive vs totalCompleted', () => {
  const m = new RepairAnalyzer(repairs).getMetrics();

  it('totalCompleted counts only picked_up repairs', () => {
    expect(m.totalCompleted).toBe(1);
  });

  it('totalActive counts open tickets (not picked_up / cancelled)', () => {
    // in_progress + ready + received = 3
    expect(m.totalActive).toBe(3);
  });

  it('active and completed are distinct (the KPI bug would have made pending=1)', () => {
    expect(m.totalActive).not.toBe(m.totalCompleted);
  });
});
