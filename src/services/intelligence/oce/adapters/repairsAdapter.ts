// R-OCE-V1 / R-REPAIR-SUBSTATUS-OCE-V1 — Repairs module adapter.
// Signals: repair_ready (ready for pickup), operational_warning (stale >3 days,
//          pickup aging, waiting_parts, past estimate, no movement).

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';
import { scanStaleRepairs } from '../../ranking/staleRepairScanner';

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

function daysSince(ts: unknown, now: number): number {
  const ms = toMs(ts);
  return ms ? Math.floor((now - ms) / 86_400_000) : 0;
}

const repairsAdapter: OperationalModuleAdapter = {
  module: 'repairs',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    // repair_ready: all repairs in 'ready' status
    try {
      const readyRepairs = engine.getRepairs().filter(
        (r) => String((r as { status?: string }).status ?? '').toLowerCase() === 'ready',
      );
      if (readyRepairs.length > 0) {
        signals.push({
          id: 'repairs:repair_ready:aggregate',
          type: 'repair_ready',
          sourceModule: 'repairs',
          severity: readyRepairs.length >= 3 ? 'critical' : 'high',
          title: `${readyRepairs.length} repair${readyRepairs.length > 1 ? 's' : ''} ready for pickup`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_repair',
          score: Math.min(100, 40 + readyRepairs.length * 10),
          tags: ['pickup', 'ready'],
          metadata: { count: readyRepairs.length },
        });
      }
    } catch { /* skip */ }

    // operational_warning: repairs stale >3 days using existing scanner
    try {
      const stale = scanStaleRepairs(engine);
      if (stale.staleCount > 0) {
        signals.push({
          id: 'repairs:operational_warning:stale',
          type: 'operational_warning',
          sourceModule: 'repairs',
          severity: stale.staleCount >= 3 ? 'high' : 'medium',
          title: `${stale.staleCount} repair${stale.staleCount > 1 ? 's' : ''} waiting 3+ days for pickup`,
          createdAt: now,
          actionable: true,
          score: Math.min(100, 30 + stale.staleCount * 10),
          tags: ['stale', 'pickup_overdue'],
          metadata: { staleCount: stale.staleCount, recoverableCents: stale.recoverableCents },
        });
      }
    } catch { /* skip */ }

    // R-REPAIR-SUBSTATUS-OCE-V1: ready repairs aging by days (age-based severity)
    // Complements the count-based repair_ready aggregate — routes to business_risk
    // to avoid double-counting in the pickup_opportunity bucket.
    try {
      const READY = new Set(['ready', 'ready_for_pickup', 'readyforpickup', 'completed', 'done']);
      const aging = engine.getRepairs().filter((r) => {
        if (!READY.has(String(r.status ?? '').toLowerCase().replace(/[\s-]+/g, '_'))) return false;
        return daysSince(r.completedAt ?? r.updatedAt, now) >= 2;
      });
      if (aging.length > 0) {
        const oldest = aging.reduce((best, r) =>
          daysSince(r.completedAt ?? r.updatedAt, now) > daysSince(best.completedAt ?? best.updatedAt, now) ? r : best);
        const maxDays = daysSince(oldest.completedAt ?? oldest.updatedAt, now);
        signals.push({
          id: 'repairs:operational_warning:pickup_aging',
          type: 'operational_warning',
          sourceModule: 'repairs',
          severity: maxDays >= 5 ? 'critical' : 'high',
          title: `${aging.length} repair${aging.length > 1 ? 's' : ''} ready ${maxDays}+ day${maxDays !== 1 ? 's' : ''} — customer not picking up`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_repair',
          entityId: oldest.id,
          customerId: oldest.customerId,
          score: Math.min(100, 50 + aging.length * 8),
          tags: ['repair_pickup_waiting'],
          metadata: { count: aging.length, maxDays },
        });
      }
    } catch { /* skip */ }

    // R-REPAIR-SUBSTATUS-OCE-V1: waiting_parts 5+ days — supplier follow-up
    try {
      const waitingParts = engine.getRepairs().filter((r) => {
        if (String(r.status ?? '').toLowerCase().replace(/[\s-]+/g, '_') !== 'waiting_parts') return false;
        return daysSince(r.updatedAt ?? r.createdAt, now) >= 5;
      });
      if (waitingParts.length > 0) {
        const oldest = waitingParts.reduce((best, r) =>
          daysSince(r.updatedAt ?? r.createdAt, now) > daysSince(best.updatedAt ?? best.createdAt, now) ? r : best);
        const maxDays = daysSince(oldest.updatedAt ?? oldest.createdAt, now);
        signals.push({
          id: 'repairs:operational_warning:waiting_parts',
          type: 'operational_warning',
          sourceModule: 'repairs',
          severity: maxDays >= 7 ? 'high' : 'medium',
          title: `${waitingParts.length} repair${waitingParts.length > 1 ? 's' : ''} waiting on parts ${maxDays}+ day${maxDays !== 1 ? 's' : ''} — follow up supplier`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_repair',
          entityId: oldest.id,
          customerId: oldest.customerId,
          score: Math.min(100, 35 + waitingParts.length * 8),
          tags: ['repair_waiting_parts'],
          metadata: { count: waitingParts.length, maxDays },
        });
      }
    } catch { /* skip */ }

    // R-REPAIR-SUBSTATUS-OCE-V1: in_progress past estimatedCompletion
    try {
      const overdue = engine.getRepairs().filter((r) => {
        if (String(r.status ?? '').toLowerCase().replace(/[\s-]+/g, '_') !== 'in_progress') return false;
        const estMs = toMs(r.estimatedCompletion);
        return estMs > 0 && estMs < now;
      });
      if (overdue.length > 0) {
        const worst = overdue.reduce((best, r) => {
          const bMs = toMs(best.estimatedCompletion);
          const rMs = toMs(r.estimatedCompletion);
          return (bMs > 0 && rMs > 0 && rMs < bMs) ? r : best;
        });
        const daysOver = Math.floor((now - toMs(worst.estimatedCompletion)) / 86_400_000);
        signals.push({
          id: 'repairs:operational_warning:past_estimate',
          type: 'operational_warning',
          sourceModule: 'repairs',
          severity: 'high',
          title: `${overdue.length} repair${overdue.length > 1 ? 's' : ''} past estimated completion — operational delay`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_repair',
          entityId: worst.id,
          customerId: worst.customerId,
          score: Math.min(100, 40 + overdue.length * 8),
          tags: ['repair_past_estimate'],
          metadata: { count: overdue.length, daysOver },
        });
      }
    } catch { /* skip */ }

    // R-REPAIR-SUBSTATUS-OCE-V1: received/diagnosing 3+ days no movement
    try {
      const STUCK = new Set(['received', 'diagnosing', 'diagnosed']);
      const stuck = engine.getRepairs().filter((r) => {
        if (!STUCK.has(String(r.status ?? '').toLowerCase().replace(/[\s-]+/g, '_'))) return false;
        return daysSince(r.updatedAt ?? r.createdAt, now) >= 3;
      });
      if (stuck.length > 0) {
        const oldest = stuck.reduce((best, r) =>
          daysSince(r.updatedAt ?? r.createdAt, now) > daysSince(best.updatedAt ?? best.createdAt, now) ? r : best);
        const maxDays = daysSince(oldest.updatedAt ?? oldest.createdAt, now);
        signals.push({
          id: 'repairs:operational_warning:no_movement',
          type: 'operational_warning',
          sourceModule: 'repairs',
          severity: 'medium',
          title: `${stuck.length} repair${stuck.length > 1 ? 's' : ''} stuck at intake/diagnosis ${maxDays}+ day${maxDays !== 1 ? 's' : ''} — no movement`,
          createdAt: now,
          actionable: true,
          actionTarget: 'open_repair',
          entityId: oldest.id,
          customerId: oldest.customerId,
          score: Math.min(100, 25 + stuck.length * 6),
          tags: ['repair_no_movement'],
          metadata: { count: stuck.length, maxDays },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { repairsAdapter };
