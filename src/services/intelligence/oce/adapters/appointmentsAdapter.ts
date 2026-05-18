// R-APPOINTMENTS-OCE-V1 — Appointments module OCE adapter.
// Signals: no_show/missed today, overdue (past time, not converted),
//          upcoming within 2 hours, high-value customer appointment today.

import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';

const TERMINAL = new Set(['converted', 'cancelled']);

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

const appointmentsAdapter: OperationalModuleAdapter = {
  module: 'appointments',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    let appointments: ReturnType<typeof engine.getAppointments>;
    try { appointments = engine.getAppointments(); } catch { return []; }
    if (!appointments || appointments.length === 0) return [];

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayMs   = todayStart.getTime();
    const todayEnd  = todayMs + 86_400_000;
    const in2Hours  = now + 2 * 3_600_000;

    const active = appointments.filter(
      (a) => !TERMINAL.has(String(a.status ?? '').toLowerCase()),
    );

    // 1. No-show / missed today — explicit no_show status, scheduled today
    try {
      const noShows = appointments.filter((a) => {
        if (String(a.status ?? '').toLowerCase() !== 'no_show') return false;
        const ms = toMs(a.estimatedDropOff);
        return ms >= todayMs && ms < todayEnd;
      });
      // Also count: scheduled appointments that are past their time today (implicit miss)
      const implicitMiss = active.filter((a) => {
        if (String(a.status ?? '').toLowerCase() !== 'scheduled') return false;
        const ms = toMs(a.estimatedDropOff);
        return ms >= todayMs && ms < now; // today but already passed
      });
      const missed = [...noShows, ...implicitMiss];
      if (missed.length > 0) {
        const first = missed[0];
        signals.push({
          id: 'appointments:appointment_risk:missed_today',
          type: 'appointment_risk',
          sourceModule: 'appointments',
          severity: 'high',
          title: `${missed.length} appointment${missed.length > 1 ? 's' : ''} missed/no-show today`,
          createdAt: now,
          actionable: Boolean(first.customerId),
          actionTarget: first.customerId ? 'open_customer' : undefined,
          entityId: first.customerId,
          customerId: first.customerId,
          score: Math.min(100, 50 + missed.length * 8),
          tags: ['appointment_missed'],
          metadata: { count: missed.length, customerName: first.customerName, device: first.device },
        });
      }
    } catch { /* skip */ }

    // 2. Overdue — past scheduled time, still scheduled or arrived (not converted/cancelled)
    try {
      const overdue = active.filter((a) => {
        const s = String(a.status ?? '').toLowerCase();
        if (s !== 'scheduled' && s !== 'arrived') return false;
        const ms = toMs(a.estimatedDropOff);
        // exclude today implicit misses (already in signal 1) — only strict past-time overdue
        return ms > 0 && ms < now && !(ms >= todayMs && s === 'scheduled');
      });
      if (overdue.length > 0) {
        const oldest = overdue.reduce((best, a) => {
          return toMs(a.estimatedDropOff) < toMs(best.estimatedDropOff) ? a : best;
        });
        signals.push({
          id: 'appointments:appointment_risk:overdue',
          type: 'appointment_risk',
          sourceModule: 'appointments',
          severity: 'high',
          title: `${overdue.length} appointment${overdue.length > 1 ? 's' : ''} past scheduled time — not converted`,
          createdAt: now,
          actionable: Boolean(oldest.customerId),
          actionTarget: oldest.customerId ? 'open_customer' : undefined,
          entityId: oldest.customerId,
          customerId: oldest.customerId,
          score: Math.min(100, 45 + overdue.length * 8),
          tags: ['appointment_overdue'],
          metadata: { count: overdue.length, customerName: oldest.customerName },
        });
      }
    } catch { /* skip */ }

    // 3. Upcoming within 2 hours (status = scheduled, estimatedDropOff in [now, now+2h])
    try {
      const upcoming = active.filter((a) => {
        if (String(a.status ?? '').toLowerCase() !== 'scheduled') return false;
        const ms = toMs(a.estimatedDropOff);
        return ms >= now && ms <= in2Hours;
      });
      if (upcoming.length > 0) {
        // Sort by soonest first
        const soonest = upcoming.slice().sort(
          (a, b) => toMs(a.estimatedDropOff) - toMs(b.estimatedDropOff),
        )[0];
        const minsAway = Math.round((toMs(soonest.estimatedDropOff) - now) / 60_000);
        signals.push({
          id: 'appointments:appointment_risk:upcoming',
          type: 'appointment_risk',
          sourceModule: 'appointments',
          severity: 'medium',
          title: `${upcoming.length} appointment${upcoming.length > 1 ? 's' : ''} in next 2 hours — next: ${soonest.customerName} in ${minsAway}min`,
          createdAt: now,
          actionable: Boolean(soonest.customerId),
          actionTarget: soonest.customerId ? 'open_customer' : undefined,
          entityId: soonest.customerId,
          customerId: soonest.customerId,
          score: Math.min(100, 30 + upcoming.length * 5),
          tags: ['appointment_upcoming'],
          metadata: { count: upcoming.length, customerName: soonest.customerName, minsAway },
        });
      }
    } catch { /* skip */ }

    // 4. High-value customer appointment today — linked customer with ≥ $150 total sales
    try {
      const todayActive = active.filter((a) => {
        const ms = toMs(a.estimatedDropOff);
        return ms >= todayMs && ms < todayEnd;
      });
      if (todayActive.length > 0) {
        const sales = engine.getSales();
        // Tally total revenue per customer
        const revByCustomer = new Map<string, number>();
        for (const s of sales) {
          if (!s.customerId) continue;
          if (String(s.status ?? '').toLowerCase() === 'voided') continue;
          revByCustomer.set(s.customerId, (revByCustomer.get(s.customerId) ?? 0) + (s.total ?? 0));
        }
        const vipAppts = todayActive.filter(
          (a) => a.customerId && (revByCustomer.get(a.customerId) ?? 0) >= 15_000,
        );
        if (vipAppts.length > 0) {
          const top = vipAppts[0];
          signals.push({
            id: 'appointments:appointment_risk:high_value',
            type: 'appointment_risk',
            sourceModule: 'appointments',
            severity: 'medium',
            title: `${vipAppts.length > 1 ? `${vipAppts.length} high-value` : top.customerName} — VIP appointment${vipAppts.length > 1 ? 's' : ''} today`,
            createdAt: now,
            actionable: Boolean(top.customerId),
            actionTarget: top.customerId ? 'open_customer' : undefined,
            entityId: top.customerId,
            customerId: top.customerId,
            score: Math.min(100, 35 + vipAppts.length * 5),
            tags: ['high_value_appointment'],
            metadata: { count: vipAppts.length, customerName: top.customerName },
          });
        }
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { appointmentsAdapter };
