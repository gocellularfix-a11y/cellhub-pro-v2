import type { IntelligenceEngine } from '../IntelligenceEngine';

export interface StaleRepairScanResult {
  staleCount: number;
  recoverableCents: number;
}

const PICKUP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

// Scans engine repairs for 'ready' tickets older than 3 days.
// Returns staleCount and total balance owed across stale tickets.
// Caller decides rank formula and push condition (differs per handler).
export function scanStaleRepairs(engine: IntelligenceEngine): StaleRepairScanResult {
  const repairs = engine.getRepairs();
  const now = Date.now();
  let staleCount = 0;
  let recoverableCents = 0;
  for (const r of repairs) {
    const status = String((r as { status?: string }).status || '').toLowerCase();
    if (status !== 'ready') continue;
    const ca = (r as { completedAt?: unknown }).completedAt;
    if (!ca) continue;
    let ts = 0;
    try {
      const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
        ? (ca as { toDate: () => Date }).toDate()
        : (ca as string | Date);
      ts = new Date(d as string | Date).getTime();
    } catch { continue; }
    if (!Number.isFinite(ts) || ts === 0) continue;
    if ((now - ts) <= PICKUP_THRESHOLD_MS) continue;
    staleCount++;
    recoverableCents += (r as { balance?: number }).balance || 0;
  }
  return { staleCount, recoverableCents };
}
