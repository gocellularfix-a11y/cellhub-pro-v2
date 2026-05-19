// R-APPROVALS-OCE-V1 — Approvals module OCE adapter.
// Signals: repeated_entity_approval, approval_denial_spike,
//          employee_override_volume, high_risk_override.
//
// Reads from the approval log via listApprovalEvents() directly — the
// log is localStorage-backed and NOT part of the engine data pipeline.
// Read-only. No approval workflow or permission behavior is changed.

import type { ApprovalActionType, ApprovalEvent } from '@/store/types';
import type { IntelligenceEngine } from '../../IntelligenceEngine';
import type { OperationalModuleAdapter, OperationalSignal } from '../operationalModuleAdapter';
import { listApprovalEvents } from '@/services/approvalLog';

// ApprovalEvent.createdAt is already ms epoch — no toMs needed.

// Action types where the entityId maps to a navigable entity
const ACTION_TO_TARGET: Partial<Record<ApprovalActionType, string>> = {
  CANCEL_REPAIR:        'open_repair',
  CANCEL_LAYAWAY:       'open_layaway',
  CANCEL_UNLOCK:        'open_unlock',
  CANCEL_SPECIAL_ORDER: 'open_special_order',
};

// High-risk action types that warrant close monitoring
const HIGH_RISK = new Set<ApprovalActionType>(['REFUND', 'PRICE_OVERRIDE', 'DISCOUNT_OVERRIDE']);

const approvalsAdapter: OperationalModuleAdapter = {
  module: 'approvals',

  collectSignals(engine: IntelligenceEngine): OperationalSignal[] {
    const now = Date.now();
    const signals: OperationalSignal[] = [];

    let events: ApprovalEvent[];
    try { events = listApprovalEvents(); } catch { return []; }
    if (!events || events.length === 0) return [];

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const todayEvents = events.filter((e) => e.createdAt >= todayMs);
    if (todayEvents.length === 0) return [];

    // 1. Repeated approvals for same entity today — 3+ events on one entityId
    try {
      const byEntity = new Map<string, ApprovalEvent[]>();
      for (const e of todayEvents) {
        if (!e.entityId) continue;
        const bucket = byEntity.get(e.entityId);
        if (bucket) bucket.push(e); else byEntity.set(e.entityId, [e]);
      }
      const flagged = Array.from(byEntity.entries())
        .filter(([, evts]) => evts.length >= 3)
        .sort(([, a], [, b]) => b.length - a.length)
        .slice(0, 3);

      for (const [entityId, evts] of flagged) {
        const first = evts[0];
        const target = ACTION_TO_TARGET[first.actionType];
        signals.push({
          id: `approvals:approval_risk:repeated_entity:${entityId.slice(-12)}`,
          type: 'approval_risk',
          sourceModule: 'approvals',
          severity: 'high',
          title: `${evts.length} approval requests on same entity today — review activity`,
          createdAt: now,
          actionable: Boolean(target),
          actionTarget: target,
          entityId: target ? entityId : undefined,
          score: Math.min(100, 55 + evts.length * 5),
          tags: ['repeated_entity_approval'],
          metadata: { count: evts.length, actionType: first.actionType, entityId },
        });
      }
    } catch { /* skip */ }

    // 2. Denial spike — 3+ denied approvals today
    try {
      const denied = todayEvents.filter((e) => e.status === 'denied');
      if (denied.length >= 3) {
        signals.push({
          id: 'approvals:approval_risk:denial_spike',
          type: 'approval_risk',
          sourceModule: 'approvals',
          severity: denied.length >= 5 ? 'high' : 'medium',
          title: `${denied.length} approval${denied.length !== 1 ? 's' : ''} denied today — friction increasing`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 40 + denied.length * 5),
          tags: ['approval_denial_spike'],
          metadata: { count: denied.length },
        });
      }
    } catch { /* skip */ }

    // 3. Employee override volume — 5+ requests from same employee today
    try {
      const byEmp = new Map<string, number>();
      for (const e of todayEvents) {
        if (!e.requestedByEmployeeId) continue;
        byEmp.set(e.requestedByEmployeeId, (byEmp.get(e.requestedByEmployeeId) ?? 0) + 1);
      }

      let employees: ReturnType<typeof engine.getEmployees> = [];
      try { employees = engine.getEmployees(); } catch { /* skip lookup */ }

      const highVolume = Array.from(byEmp.entries())
        .filter(([, count]) => count >= 5)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);

      for (const [empId, count] of highVolume) {
        const emp = employees.find((e) => e.id === empId);
        const name = emp?.name || empId;
        signals.push({
          id: `approvals:approval_risk:emp_volume:${empId.slice(-12)}`,
          type: 'approval_risk',
          sourceModule: 'approvals',
          severity: count >= 8 ? 'high' : 'medium',
          title: `${name} — ${count} approval requests today — review override activity`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 35 + count * 5),
          tags: ['employee_override_volume'],
          metadata: { count, employeeId: empId, employeeName: name },
        });
      }
    } catch { /* skip */ }

    // 4. High-risk action type volume — 5+ REFUND / PRICE_OVERRIDE / DISCOUNT_OVERRIDE today
    try {
      const highRisk = todayEvents.filter((e) => HIGH_RISK.has(e.actionType));
      if (highRisk.length >= 5) {
        const byCat = new Map<string, number>();
        for (const e of highRisk) {
          byCat.set(e.actionType, (byCat.get(e.actionType) ?? 0) + 1);
        }
        const top = Array.from(byCat.entries()).sort(([, a], [, b]) => b - a)[0];
        signals.push({
          id: 'approvals:approval_risk:high_risk_volume',
          type: 'approval_risk',
          sourceModule: 'approvals',
          severity: highRisk.length >= 8 ? 'high' : 'medium',
          title: `${highRisk.length} high-risk approval${highRisk.length !== 1 ? 's' : ''} today (${top[0].toLowerCase().replace(/_/g, ' ')}: ${top[1]})`,
          createdAt: now,
          actionable: false,
          score: Math.min(100, 35 + highRisk.length * 4),
          tags: ['high_risk_override'],
          metadata: { count: highRisk.length, breakdown: Object.fromEntries(byCat) },
        });
      }
    } catch { /* skip */ }

    return signals;
  },
};

export { approvalsAdapter };
