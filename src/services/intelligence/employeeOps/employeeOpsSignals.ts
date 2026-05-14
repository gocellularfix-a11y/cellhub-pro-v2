// CellHub Intelligence — Employee Ops Signal Detectors
// Individual deterministic signal functions. Each returns OperationalSignal|null.
// Pure functions — safe inside useMemo. Operational assistance, not surveillance.

import type { Repair, Layaway, Sale } from '@/store/types';
import type { LiveAction } from '@/services/intelligence/liveContext/contextTypes';
import type { OperationalSignal } from './employeeOpsTypes';
import { toMs } from '@/services/intelligence/customerScoring/customerOpportunitySignals';

const REPAIR_DELAY_DAYS = 7;
const REPAIR_DELAY_MS = REPAIR_DELAY_DAYS * 24 * 60 * 60 * 1000;

// ── Repair status helpers ─────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set([
  'picked_up', 'cancelled', 'refunded', 'refund_pending',
]);

const READY_STATUSES = new Set([
  'completed', 'ready', 'ready_for_pickup',
]);

function repairStatusGroup(status: string): 'active' | 'ready' | 'terminal' {
  const s = String(status || '').toLowerCase().trim();
  if (TERMINAL_STATUSES.has(s)) return 'terminal';
  if (READY_STATUSES.has(s)) return 'ready';
  return 'active';
}

// ── Individual signal detectors ───────────────────────────────────────────────

/**
 * Repairs in active status older than REPAIR_DELAY_DAYS days.
 * Signals that turnaround is slowing — not about any specific employee.
 */
export function detectRepairDelays(repairs: Repair[]): OperationalSignal | null {
  const cutoff = Date.now() - REPAIR_DELAY_MS;
  const delayed = repairs.filter((r) => {
    if (repairStatusGroup(r.status) !== 'active') return false;
    const ts = toMs(r.createdAt);
    return ts > 0 && ts < cutoff;
  });
  if (delayed.length === 0) return null;
  const count = delayed.length;
  return {
    id: 'op_repair_delays',
    kind: 'repair_bottleneck',
    title: count === 1
      ? '1 repair past expected turnaround'
      : `${count} repairs past expected turnaround`,
    detail: 'Repair turnaround slowing down',
    priority: count >= 5 ? 8 : count >= 3 ? 7 : 5,
    severity: count >= 5 ? 'warning' : 'info',
    suggestionKind: 'operational',
    actionId: 'act_open_repairs',
    computedAt: Date.now(),
  };
}

/**
 * Repairs marked ready/completed that haven't been picked up yet.
 * Operational opportunity to notify customers.
 */
export function detectRepairsReadyForPickup(repairs: Repair[]): OperationalSignal | null {
  const ready = repairs.filter((r) => repairStatusGroup(r.status) === 'ready');
  if (ready.length === 0) return null;
  const count = ready.length;
  return {
    id: 'op_repairs_ready',
    kind: 'operational_gap',
    title: count === 1
      ? '1 repair ready for pickup — notify customer'
      : `${count} repairs ready for pickup`,
    priority: 7,
    severity: 'info',
    suggestionKind: 'follow_up',
    actionId: 'act_open_repairs',
    computedAt: Date.now(),
  };
}

/**
 * Layaways with a balance past their due date.
 * Revenue protection signal — actionable collection opportunity.
 */
export function detectOverdueLayaways(layaways: Layaway[]): OperationalSignal | null {
  const now = Date.now();
  const overdue = layaways.filter((l) => {
    const s = String(l.status || '').toLowerCase();
    if (s === 'completed' || s === 'cancelled') return false;
    if (!l.balance || l.balance <= 0) return false;
    if (!l.dueDate) return false;
    const due = toMs(l.dueDate);
    return due > 0 && due < now;
  });
  if (overdue.length === 0) return null;
  const count = overdue.length;
  return {
    id: 'op_overdue_layaways',
    kind: 'revenue_leak',
    title: count === 1
      ? '1 overdue layaway payment'
      : `${count} overdue layaway payments`,
    detail: 'Outstanding balances past due date',
    priority: 8,
    severity: 'warning',
    suggestionKind: 'collect',
    actionId: 'act_open_layaways',
    computedAt: Date.now(),
  };
}

/**
 * Active unfinished external payment workflows.
 * Reminder to complete payment flows started this session.
 */
export function detectUnfinishedWorkflows(pendingWorkflowCount: number): OperationalSignal | null {
  if (pendingWorkflowCount === 0) return null;
  return {
    id: 'op_unfinished_workflows',
    kind: 'workflow_abandonment',
    title: pendingWorkflowCount === 1
      ? 'Unfinished payment workflow'
      : `${pendingWorkflowCount} unfinished payment workflows`,
    detail: 'Resume or complete pending carrier payment flows',
    priority: 9,
    severity: 'warning',
    suggestionKind: 'operational',
    actionId: 'act_resume_external_payment',
    computedAt: Date.now(),
  };
}

/**
 * High discount attempt frequency in this session.
 * Informational — no blame, just operational awareness.
 */
export function detectHighDiscountActivity(recentActions: LiveAction[]): OperationalSignal | null {
  const count = recentActions.filter((a) => a.type === 'discount_attempted').length;
  if (count < 3) return null;
  return {
    id: 'op_discount_activity',
    kind: 'discount_anomaly',
    title: 'Frequent discount activity this session',
    detail: 'Review discount usage',
    priority: 6,
    severity: 'warning',
    suggestionKind: 'operational',
    computedAt: Date.now(),
  };
}

/**
 * Multiple approval requests in this session.
 * Operational awareness — may indicate pricing or policy questions.
 */
export function detectHighApprovalActivity(recentActions: LiveAction[]): OperationalSignal | null {
  const count = recentActions.filter((a) => a.type === 'approval_requested').length;
  if (count < 2) return null;
  return {
    id: 'op_approval_activity',
    kind: 'discount_anomaly',
    title: 'Multiple approvals requested this session',
    priority: 5,
    severity: 'warning',
    suggestionKind: 'operational',
    computedAt: Date.now(),
  };
}

/**
 * Repairs in a completed/terminal state that still carry a balance.
 * Revenue leak — customer owes but record is marked done.
 */
export function detectRepairBalanceLeak(repairs: Repair[]): OperationalSignal | null {
  const leaking = repairs.filter((r) => {
    const group = repairStatusGroup(r.status);
    if (group !== 'terminal' && group !== 'ready') return false;
    return typeof r.balance === 'number' && r.balance > 0;
  });
  if (leaking.length === 0) return null;
  const count = leaking.length;
  return {
    id: 'op_repair_balance_leak',
    kind: 'revenue_leak',
    title: count === 1
      ? '1 repair with outstanding balance'
      : `${count} repairs with outstanding balances`,
    detail: 'Completed repairs still owed payment',
    priority: 7,
    severity: 'warning',
    suggestionKind: 'collect',
    actionId: 'act_open_repairs',
    computedAt: Date.now(),
  };
}

/**
 * Phone payment sales in recent session without accessory attachment.
 * Upsell opportunity — accessories can be offered alongside bill pay.
 */
export function detectAccessoryAttachOpportunity(
  recentActions: LiveAction[],
  sales: Sale[],
): OperationalSignal | null {
  // Check if there was a recent phone_payment sale without accessories
  const hasPhonePaySale = recentActions.some((a) => a.type === 'sale_completed');
  if (!hasPhonePaySale) return null;

  // Look at recent sales (last 5) for phone_payment items without accessory items
  const recentSales = [...sales]
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
    .slice(0, 5);

  const phonePaysWithoutAccessory = recentSales.filter((sale) => {
    const hasPhonePay = sale.items?.some((i) => (i as any).category === 'phone_payment');
    const hasAccessory = sale.items?.some((i) => (i as any).category === 'accessory');
    return hasPhonePay && !hasAccessory;
  });

  if (phonePaysWithoutAccessory.length < 2) return null;
  return {
    id: 'op_accessory_attach_opportunity',
    kind: 'upsell_opportunity',
    title: 'Accessory opportunities being missed',
    detail: 'Recent phone payment sales without accessory attachment',
    priority: 6,
    severity: 'info',
    suggestionKind: 'upsell',
    actionId: 'act_open_pos',
    computedAt: Date.now(),
  };
}
