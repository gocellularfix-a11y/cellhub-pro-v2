// CellHub Intelligence — Employee Ops Selectors
// Index-first data access. All selectors are pure, memoizable, fail-safe.

import type { Sale, Customer } from '@/store/types';
import type { LiveAction } from '@/services/intelligence/liveContext/contextTypes';
import type {
  EmployeeOperationalProfile,
  OperationalSignal,
  OperationalHealthContext,
} from './employeeOpsTypes';
import { toMs } from '@/services/intelligence/customerScoring/customerOpportunitySignals';
import { computeAnomalies } from './operationalAnomalyDetection';

const PROFILE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Operational health signals ────────────────────────────────────────────────

/** All operational signals for the current context, priority-sorted. */
export function getOperationalHealthSignals(ctx: OperationalHealthContext): OperationalSignal[] {
  return computeAnomalies(ctx);
}

/** Signals with severity === 'warning' and priority >= 6. */
export function getHighRiskOperationalSignals(signals: OperationalSignal[]): OperationalSignal[] {
  return signals.filter((s) => s.severity === 'warning' && s.priority >= 6);
}

/** Signals relating to unfinished/abandoned workflows. */
export function getWorkflowCompletionSignals(signals: OperationalSignal[]): OperationalSignal[] {
  return signals.filter((s) => s.kind === 'workflow_abandonment');
}

/** Signals indicating uncollected money (overdue layaways, repair balance leaks). */
export function getRevenueLeakSignals(signals: OperationalSignal[]): OperationalSignal[] {
  return signals.filter((s) => s.kind === 'revenue_leak');
}

// ── Employee operational profile ──────────────────────────────────────────────

/**
 * Compute an operational profile for the active employee from available data.
 * Index-first: builds sale index in one O(S) pass before scoring.
 */
export function getEmployeeOperationalProfile(
  employeeId: string,
  employeeName: string,
  sales: Sale[],
  customers: Customer[],
  recentActions: LiveAction[],
  pendingWorkflowCount: number,
): EmployeeOperationalProfile {
  const now = Date.now();
  const windowStart = now - PROFILE_WINDOW_MS;

  // ── Build index: customerId → purchase timestamps for this employee ──────────
  const customerPurchaseTimes = new Map<string, number[]>();

  let totalSales = 0;
  let salesWithAccessory = 0;

  for (const sale of sales) {
    if (sale.employeeId !== employeeId) continue;
    const ts = toMs(sale.createdAt);
    if (ts < windowStart) continue;
    totalSales++;

    if (sale.customerId) {
      const times = customerPurchaseTimes.get(sale.customerId) ?? [];
      times.push(ts);
      customerPurchaseTimes.set(sale.customerId, times);
    }

    if (sale.items?.some((i) => (i as any).category === 'accessory')) {
      salesWithAccessory++;
    }
  }

  // ── Session action counts ─────────────────────────────────────────────────────
  const totalActions = recentActions.length;
  const discountCount = recentActions.filter((a) => a.type === 'discount_attempted').length;
  const approvalCount = recentActions.filter((a) => a.type === 'approval_requested').length;

  // ── Score components ──────────────────────────────────────────────────────────

  const shiftActivityScore = Math.min(100, totalActions * 5);

  const discountFrequencyScore = totalActions > 0
    ? Math.min(100, Math.round((discountCount / totalActions) * 100))
    : 0;

  const approvalRequestScore = totalActions > 0
    ? Math.min(100, Math.round((approvalCount / totalActions) * 100))
    : 0;

  // Retention: customers with ≥2 purchases / total unique customers with purchases
  const uniqueCustomers = customerPurchaseTimes.size;
  const repeatCustomers = [...customerPurchaseTimes.values()].filter((ts) => ts.length >= 2).length;
  const customerRetentionScore = uniqueCustomers > 0
    ? Math.round((repeatCustomers / uniqueCustomers) * 100)
    : 50; // neutral when no attributed sales

  // Upsell: accessory attach rate
  const upsellActivityScore = totalSales > 0
    ? Math.round((salesWithAccessory / totalSales) * 100)
    : 50; // neutral

  // Workflow completion: inverse of pending count (capped)
  const workflowCompletionScore = Math.max(0, 100 - pendingWorkflowCount * 20);

  // Operational risk: weighted composite (discount + approval + unfinished workflows)
  const operationalRiskScore = Math.min(100, Math.round(
    discountFrequencyScore * 0.40
    + approvalRequestScore * 0.30
    + (pendingWorkflowCount >= 2 ? 30 : pendingWorkflowCount * 15),
  ));

  // ── Pattern detection ─────────────────────────────────────────────────────────
  const detectedPatterns: string[] = [];
  if (discountCount >= 3) detectedPatterns.push('frequent_discount_activity');
  if (approvalCount >= 2) detectedPatterns.push('high_approval_requests');
  if (repeatCustomers > 0 && uniqueCustomers > 0 && repeatCustomers / uniqueCustomers >= 0.5) {
    detectedPatterns.push('strong_customer_retention');
  }
  if (upsellActivityScore >= 40) detectedPatterns.push('active_accessory_attachment');
  if (pendingWorkflowCount >= 2) detectedPatterns.push('incomplete_workflow_pattern');

  const suggestedActions: string[] = [];
  if (pendingWorkflowCount > 0) suggestedActions.push('act_resume_external_payment');
  if (discountCount >= 3) suggestedActions.push('act_open_pos'); // review pricing

  return {
    employeeId,
    employeeName,
    shiftActivityScore,
    discountFrequencyScore,
    approvalRequestScore,
    customerRetentionScore,
    upsellActivityScore,
    workflowCompletionScore,
    operationalRiskScore,
    detectedPatterns,
    suggestedActions,
    computedAt: now,
  };
}
