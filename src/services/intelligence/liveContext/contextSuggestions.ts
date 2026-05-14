// ============================================================
// CellHub Pro — Context Suggestions (R-INTELLIGENCE-LIVE-CONTEXT-V1 +
//               R-INTELLIGENCE-EVENT-INSTRUMENTATION-V1)
// Deterministic suggestions from live context + action patterns.
// No AI, no randomness, no external dependencies.
// ============================================================

import type { LiveContext, ContextSuggestion } from './contextTypes';
import type { OperatorActivityInputs } from '@/services/operator/operatorActivityHints';
import {
  getActiveCustomer,
  hasPhonePaymentFlow,
  hasRepairFlow,
  hasUpsellOpportunity,
  hasLongInactiveCustomer,
  hasMultiLineCustomer,
  hasPendingApprovalFlow,
} from './contextSignals';
import {
  countCustomerFrequency,
  countActionTypeFrequency,
  countRepairFrequency,
  getRecentRepairs,
} from './contextSelectors';

// ── Priority scoring constants ────────────────────────────
// Higher = shown first in overlay. Slots:
//   10    – critical / pending approval
//   9     – urgent operational (inactive, repeated views)
//   8     – strong upsell (phone payment + no accessories)
//   7–6   – moderate upsell / retention
//   5–4   – standard follow-up / operational
//   3     – data collection
//   2–1   – ambient / informational

/**
 * Compute the deterministic suggestion list for the current live context.
 * Returns up to 5 suggestions sorted by priority descending.
 * Pure function — safe inside useMemo.
 */
export function computeContextSuggestions(
  ctx: LiveContext,
  inputs: OperatorActivityInputs,
): ContextSuggestion[] {
  const out: ContextSuggestion[] = [];
  const cust = getActiveCustomer(ctx, inputs);

  // ── CRITICAL: pending approval ────────────────────────────
  if (hasPendingApprovalFlow(ctx)) {
    out.push({
      id: 'pending_approval',
      text: 'Approval requested — manager attention needed',
      detail: 'A restricted action is waiting for authorization.',
      kind: 'operational',
      priority: 10,
    });
  }

  // ── Pattern: same customer viewed 3+ times in 10 min ─────
  const activeId = ctx.activeCustomer?.id;
  if (activeId && countCustomerFrequency(ctx, activeId, 600_000) >= 3) {
    out.push({
      id: 'repeat_customer_view',
      text: 'Customer checked multiple times — schedule a follow-up?',
      kind: 'follow_up',
      priority: 9,
      actionTab: 'customers',
    });
  }

  // ── Pattern: repeated discount attempts ──────────────────
  const discountCount = countActionTypeFrequency(ctx, 'discount_attempted', 600_000);
  if (discountCount >= 2) {
    out.push({
      id: 'repeated_discounts',
      text: `${discountCount} discount attempts this session — consider manager review`,
      kind: 'operational',
      priority: 8,
    });
  }

  // ── Pattern: repair viewed repeatedly ────────────────────
  const recentRepairs = getRecentRepairs(ctx, 3);
  for (const repairId of recentRepairs) {
    if (countRepairFrequency(ctx, repairId, 900_000) >= 2) {
      out.push({
        id: `repair_repeat_${repairId}`,
        text: 'Repair checked multiple times — consider a status update or follow-up',
        kind: 'follow_up',
        priority: 8,
        actionTab: 'repairs',
      });
      break; // only one of this type
    }
  }

  // ── Phone payment flow ────────────────────────────────────
  if (hasPhonePaymentFlow(ctx)) {
    if (!ctx.cart?.hasAccessories) {
      out.push({
        id: 'upsell_accessories_phonepay',
        text: 'Offer a case or charger with the phone payment',
        kind: 'upsell',
        priority: 8,
        actionTab: 'pos',
      });
    }
    if (cust && hasMultiLineCustomer(ctx, inputs)) {
      out.push({
        id: 'multiline_promo',
        text: 'Multi-line account — ask about promotions for all lines',
        kind: 'upsell',
        priority: 7,
        actionTab: 'phone-payments',
      });
    }
  }

  // ── Repair flow ───────────────────────────────────────────
  if (hasRepairFlow(ctx)) {
    out.push({
      id: 'repair_accessories_upsell',
      text: 'Offer screen protector or case with the repair',
      kind: 'upsell',
      priority: 6,
      actionTab: 'pos',
    });
    out.push({
      id: 'follow_up_repair_warranty',
      text: 'Remind customer about the repair warranty',
      kind: 'follow_up',
      priority: 4,
    });
  }

  // ── Customer-anchored signals ─────────────────────────────
  if (cust) {
    if (hasLongInactiveCustomer(ctx, inputs)) {
      out.push({
        id: 'retention_inactive',
        text: 'Welcome back — offer a loyalty reward or plan upgrade',
        kind: 'retention',
        priority: 9,
      });
    }

    if (hasUpsellOpportunity(ctx)) {
      out.push({
        id: 'upsell_opportunity',
        text: 'Mention accessories or a protection plan',
        kind: 'upsell',
        priority: 5,
        actionTab: 'pos',
      });
    }

    const fullCust = inputs.customers.find((c) => c && c.id === cust.id);
    if (fullCust && !fullCust.email) {
      out.push({
        id: 'collect_email',
        text: 'Ask for customer email for digital receipts',
        kind: 'collect',
        priority: 3,
        actionTab: 'customers',
      });
    }
  }

  // ── Post-sale operational ─────────────────────────────────
  if (ctx.recentActions.slice(0, 5).some((a) => a.type === 'sale_completed')) {
    out.push({
      id: 'post_sale_review',
      text: 'Ask the customer to leave a Google review',
      kind: 'operational',
      priority: 5,
    });
  }

  // Deduplicate, sort by priority desc, cap at 5
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.priority - a.priority)
    .filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; })
    .slice(0, 5);
}

/**
 * Returns true when any suggestion has urgency priority >= 9
 * (used by the bubble to intensify its visual pulse).
 */
export function hasUrgentSuggestion(
  ctx: LiveContext,
  inputs: OperatorActivityInputs,
): boolean {
  return computeContextSuggestions(ctx, inputs).some((s) => s.priority >= 9);
}

/**
 * A short (≤ 38 char) preview string for the badge below the bubble.
 * `tickIndex` increments externally; used to rotate through suggestions.
 */
export function getMinimizedPreviewText(
  ctx: LiveContext,
  inputs: OperatorActivityInputs,
  tickIndex: number,
): string {
  const suggestions = computeContextSuggestions(ctx, inputs);

  // Even ticks: customer name (or module label). Odd ticks: cycle suggestions.
  if (tickIndex % 2 === 1 && suggestions.length > 0) {
    const s = suggestions[tickIndex % suggestions.length];
    return s.text.length > 36 ? s.text.slice(0, 34) + '…' : s.text;
  }

  if (ctx.activeCustomer?.name) {
    return ctx.activeCustomer.name;
  }

  const moduleLabels: Record<string, string> = {
    pos: 'POS',
    repairs: 'Repairs',
    customers: 'Customers',
    'phone-payments': 'Phone Payments',
    unlocks: 'Unlocks',
    'special-orders': 'Special Orders',
    layaways: 'Layaways',
    appointments: 'Appointments',
    intelligence: 'Intelligence',
  };
  return moduleLabels[ctx.activeModule] ?? ctx.activeModule;
}
