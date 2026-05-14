// CellHub Intelligence — Action Execution Registry
// Maps suggestion IDs → concrete OperatorExecutableAction implementations.
// All actions are deterministic, fail-safe, and never mutate financial state.

import type { OperatorExecutableAction, ActionExecutionContext } from './actionExecutionTypes';
import { openWhatsApp } from '@/services/whatsapp';
import {
  getPendingExternalPaymentWorkflow,
  completeWorkflow,
  cancelWorkflow,
  resumeWorkflow,
} from '@/services/intelligence/workflowContinuity/workflowContinuityStore';
import { resetReturnCooldown } from '@/services/intelligence/workflowContinuity/externalFlowAwareness';

// ── Navigation primitive ───────────────────────────────────────────────────────

function navigate(
  tab: string,
  ctx: ActionExecutionContext,
  delayedEvent?: () => void,
): void {
  ctx.dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
  if (delayedEvent) {
    // 80 ms matches the existing module-mount defer pattern in the bubble.
    setTimeout(delayedEvent, 80);
  }
}

// ── Concrete action implementations ───────────────────────────────────────────

const openCustomer: OperatorExecutableAction = {
  id: 'act_open_customer',
  label: 'Open Customer',
  category: 'customer',
  priority: 8,
  safetyLevel: 'safe',
  canExecute: (ctx) => !!ctx.customerId,
  execute: (ctx) => navigate('customers', ctx),
};

const viewHistory: OperatorExecutableAction = {
  id: 'act_view_history',
  label: 'View History',
  category: 'customer',
  priority: 7,
  safetyLevel: 'safe',
  canExecute: (ctx) => !!ctx.customerId,
  execute: (ctx) => {
    navigate('customers', ctx, () => {
      try {
        window.dispatchEvent(
          new CustomEvent('cellhub:open-customer-history', {
            detail: { customerId: ctx.customerId },
          }),
        );
      } catch { /* non-CustomEvent environment — silent */ }
    });
  },
};

const whatsAppFollowUp: OperatorExecutableAction = {
  id: 'act_whatsapp_follow_up',
  label: 'WhatsApp',
  category: 'customer',
  priority: 6,
  safetyLevel: 'safe',
  canExecute: (ctx) => !!ctx.customerPhone,
  execute: (ctx) => {
    if (!ctx.customerPhone) return;
    const firstName = ctx.customerName?.split(' ')[0] || 'there';
    const msg =
      `Hi ${firstName}, this is Go Cellular! Just checking in — is there anything we can help you with today?`;
    try {
      openWhatsApp(ctx.customerPhone, msg);
    } catch { /* window.open unavailable — silent */ }
  },
};

const openRepairs: OperatorExecutableAction = {
  id: 'act_open_repairs',
  label: 'Open Repairs',
  category: 'repairs',
  priority: 7,
  safetyLevel: 'safe',
  canExecute: () => true,
  execute: (ctx) => navigate('repairs', ctx),
};

const openLayaways: OperatorExecutableAction = {
  id: 'act_open_layaways',
  label: 'Layaways',
  category: 'payments',
  priority: 6,
  safetyLevel: 'safe',
  canExecute: () => true,
  execute: (ctx) => navigate('layaways', ctx),
};

const openPhonePayments: OperatorExecutableAction = {
  id: 'act_open_phone_payments',
  label: 'Phone Payments',
  category: 'payments',
  priority: 5,
  safetyLevel: 'safe',
  canExecute: () => true,
  execute: (ctx) => navigate('phone-payments', ctx),
};

const openPOS: OperatorExecutableAction = {
  id: 'act_open_pos',
  label: 'Open POS',
  category: 'inventory',
  priority: 5,
  safetyLevel: 'safe',
  canExecute: () => true,
  execute: (ctx) => navigate('pos', ctx),
};

// Navigate to customers list (no specific customer required — used by rhythm mode actions).
const openCustomers: OperatorExecutableAction = {
  id: 'act_open_customers',
  label: 'Open Customers',
  category: 'customer',
  priority: 6,
  safetyLevel: 'safe',
  canExecute: () => true,
  execute: (ctx) => navigate('customers', ctx),
};

/** Navigate to repairs and emit open-customer-history so repairs module can filter. */
const openRepairFollowUp: OperatorExecutableAction = {
  id: 'act_repair_follow_up',
  label: 'Repair Follow-Up',
  category: 'repairs',
  priority: 8,
  safetyLevel: 'safe',
  canExecute: (ctx) => ctx.repairs.some((r) => r.customerId === ctx.customerId),
  execute: (ctx) => navigate('repairs', ctx),
};

// ── Workflow resumption actions (R-INTELLIGENCE-WORKFLOW-RESUMPTION-V1) ───────
// Read-only store access — never mutate financial state.

const actResumeWorkflow: OperatorExecutableAction = {
  id: 'act_resume_workflow',
  label: 'Resume Workflow',
  category: 'operational',
  priority: 10,
  safetyLevel: 'safe',
  canExecute: () => !!getPendingExternalPaymentWorkflow(),
  execute: (ctx) => {
    const w = getPendingExternalPaymentWorkflow();
    if (!w) return;
    resumeWorkflow(w.id);
    navigate('phone-payments', ctx);
  },
};

const actResumeExternalPayment: OperatorExecutableAction = {
  id: 'act_resume_external_payment',
  label: 'Resume Payment',
  category: 'payments',
  priority: 10,
  safetyLevel: 'safe',
  canExecute: () => !!getPendingExternalPaymentWorkflow(),
  execute: (ctx) => {
    const w = getPendingExternalPaymentWorkflow();
    if (!w) return;
    resumeWorkflow(w.id);
    navigate('phone-payments', ctx);
  },
};

const actMarkExternalPaymentPaid: OperatorExecutableAction = {
  id: 'act_mark_external_payment_paid',
  label: 'Mark Paid & Next',
  category: 'payments',
  priority: 9,
  safetyLevel: 'safe',
  canExecute: () => !!getPendingExternalPaymentWorkflow(),
  execute: () => {
    const w = getPendingExternalPaymentWorkflow();
    if (!w) return;
    completeWorkflow(w.id);
    try {
      window.dispatchEvent(new CustomEvent('cellhub:workflow-external-payment-confirm'));
    } catch { /* non-CustomEvent environment — silent */ }
  },
};

const actKeepExternalPaymentPending: OperatorExecutableAction = {
  id: 'act_keep_external_payment_pending',
  label: 'Still Processing',
  category: 'payments',
  priority: 8,
  safetyLevel: 'safe',
  canExecute: () => !!getPendingExternalPaymentWorkflow(),
  execute: () => {
    const w = getPendingExternalPaymentWorkflow();
    if (!w) return;
    resumeWorkflow(w.id); // extend TTL
    resetReturnCooldown();
  },
};

const actCancelWorkflow: OperatorExecutableAction = {
  id: 'act_cancel_workflow',
  label: 'Cancel',
  category: 'operational',
  priority: 7,
  safetyLevel: 'safe',
  canExecute: () => !!getPendingExternalPaymentWorkflow(),
  execute: () => {
    const w = getPendingExternalPaymentWorkflow();
    if (!w) return;
    cancelWorkflow(w.id);
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────
// Keyed by the ContextSuggestion.id from contextSuggestions.ts.
// Each entry lists candidate actions in priority order; the engine
// filters by canExecute and caps at maxActions before rendering.

const REGISTRY: Record<string, OperatorExecutableAction[]> = {
  // ── Customer scoring suggestions (R-INTELLIGENCE-CUSTOMER-SCORING-V1) ──
  scoring_vip_retention:     [viewHistory, openCustomer],
  scoring_churn_high:        [openCustomer, whatsAppFollowUp],
  scoring_churn_medium:      [openCustomer, whatsAppFollowUp],
  scoring_lost_recovery:     [whatsAppFollowUp, openCustomer],
  scoring_collection_high:   [openRepairs, openLayaways],
  scoring_collection_medium: [openRepairs, openLayaways],
  scoring_upsell_strong:     [openPOS, openCustomer],

  // ── Existing context suggestions (contextSuggestions.ts) ──────────────
  retention_inactive:           [openCustomer, whatsAppFollowUp],
  upsell_accessories_phonepay:  [openPOS],
  multiline_promo:              [openPhonePayments, openCustomer],
  repair_accessories_upsell:    [openPOS],
  follow_up_repair_warranty:    [openRepairFollowUp, viewHistory],
  upsell_opportunity:           [openPOS],
  collect_email:                [openCustomer],
  post_sale_review:             [],  // informational — no navigation shortcut

  // ── Workflow resumption (R-INTELLIGENCE-WORKFLOW-RESUMPTION-V1) ──────
  workflow_external_payment: [actResumeExternalPayment, actMarkExternalPaymentPaid, actKeepExternalPaymentPending, actCancelWorkflow],
  workflow_resumption:       [actResumeWorkflow],

  // ── Cross-signal reasoning conclusions (R-INTELLIGENCE-CROSS-SIGNAL-REASONING-V1) ──
  reasoning_critical_customer_recovery: [openCustomers],
  reasoning_operational_overload:       [openRepairs],
  reasoning_collection_escalation:      [openRepairs, openLayaways],
  reasoning_revenue_recovery_window:    [openCustomers, openPOS],
  reasoning_upsell_momentum:            [openPOS],
  reasoning_workflow_stability_risk:    [actResumeExternalPayment, openRepairs],

  // ── Store rhythm modes (R-INTELLIGENCE-STORE-RHYTHM-V1) ──────────────
  rhythm_rush:             [],  // informational — cashier should stay at current task
  rhythm_repair_overload:  [openRepairs],
  rhythm_collection_mode:  [openRepairs, openLayaways],
  rhythm_slow_day:         [openCustomers],
  rhythm_opportunity_window:[openPOS, openCustomers],
  rhythm_revenue_recovery: [openCustomers, openRepairs],
  rhythm_low_activity:     [openCustomers],

  // ── Temporal trend modes (R-INTELLIGENCE-TEMPORAL-TRENDS-V1) ────────
  trend_risk_increasing:        [openRepairs, openLayaways],
  trend_worsening:              [openCustomers, openRepairs],
  trend_slowing:                [openCustomers],
  trend_opportunity_increasing: [openPOS, openCustomers],
  trend_recovering:             [openCustomers],
  trend_accelerating:           [openPOS],
  trend_improving:              [],  // positive — no urgent nav needed

  // ── Operational signals (R-INTELLIGENCE-EMPLOYEE-OPS-V1) ─────────────
  op_unfinished_workflows:          [actResumeExternalPayment],
  op_repair_delays:                 [openRepairs],
  op_repairs_ready:                 [openRepairs],
  op_overdue_layaways:              [openLayaways],
  op_repair_balance_leak:           [openRepairs],
  op_accessory_attach_opportunity:  [openPOS],
  op_discount_activity:             [],  // informational — no nav shortcut
  op_approval_activity:             [],  // informational
};

/**
 * Return the applicable, canExecute-filtered actions for a given suggestion.
 * Pure function — safe inside useMemo / render.
 */
export function getActionsForSuggestion(
  suggestionId: string,
  ctx: ActionExecutionContext,
  maxActions = 2,
): OperatorExecutableAction[] {
  const candidates = REGISTRY[suggestionId] ?? [];
  return candidates
    .filter((a) => a.canExecute(ctx))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxActions);
}
