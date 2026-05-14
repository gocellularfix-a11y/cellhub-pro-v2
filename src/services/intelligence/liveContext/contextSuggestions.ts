// ============================================================
// CellHub Pro — Context Suggestions (R-INTELLIGENCE-LIVE-CONTEXT-V1)
// Deterministic suggestions derived from live context + activity inputs.
// No AI, no randomness, no external dependencies.
// ============================================================

import type { LiveContext, ContextSuggestion } from './contextTypes';
import type { OperatorActivityInputs } from '@/services/operator/operatorActivityHints';
import type { CustomerBusinessProfile } from '@/services/intelligence/customerScoring/customerScoringTypes';
import type { OperationalHealthSnapshot } from '@/services/intelligence/employeeOps/employeeOpsTypes';
import {
  getActiveCustomer,
  hasPhonePaymentFlow,
  hasRepairFlow,
  hasUpsellOpportunity,
  hasLongInactiveCustomer,
  hasMultiLineCustomer,
} from './contextSignals';

/**
 * Compute the deterministic suggestion list for the current live context.
 * Returns up to 6 suggestions sorted by priority (highest first).
 * Pure function — safe to call on every render inside useMemo.
 *
 * @param profile   Optional CustomerBusinessProfile — scoring-aware suggestions.
 * @param opHealth  Optional OperationalHealthSnapshot — store-level operational signals.
 */
export function computeContextSuggestions(
  ctx: LiveContext,
  inputs: OperatorActivityInputs,
  profile?: CustomerBusinessProfile,
  opHealth?: OperationalHealthSnapshot,
): ContextSuggestion[] {
  const out: ContextSuggestion[] = [];
  const cust = getActiveCustomer(ctx, inputs);

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
    // Inactive customer — highest priority retention nudge
    if (hasLongInactiveCustomer(ctx, inputs)) {
      out.push({
        id: 'retention_inactive',
        text: 'Welcome back — offer a loyalty reward or plan upgrade',
        kind: 'retention',
        priority: 9,
      });
    }

    // General upsell moment (service flow, no accessories yet)
    if (hasUpsellOpportunity(ctx)) {
      out.push({
        id: 'upsell_opportunity',
        text: 'Mention accessories or a protection plan',
        kind: 'upsell',
        priority: 5,
        actionTab: 'pos',
      });
    }

    // Collect missing email
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

  // ── Customer scoring signals (injected when profile is available) ────
  if (profile) {
    const { vipScore, churnRisk, upsellOpportunity, collectionPriority, estimatedCustomerTier } = profile;

    // VIP — highest retention priority
    if (estimatedCustomerTier === 'VIP') {
      out.push({
        id: 'scoring_vip_retention',
        text: 'VIP customer — prioritize retention and offer loyalty reward',
        kind: 'retention',
        priority: 10,
        actionTab: 'customers',
      });
    }

    // High churn risk — urgent follow-up
    if (churnRisk >= 70 && estimatedCustomerTier !== 'VIP') {
      out.push({
        id: 'scoring_churn_high',
        text: 'High churn risk — follow up immediately to recover the relationship',
        kind: 'follow_up',
        priority: 9,
        actionTab: 'customers',
      });
    } else if (churnRisk >= 50 && estimatedCustomerTier !== 'VIP') {
      out.push({
        id: 'scoring_churn_medium',
        text: 'Customer showing inactivity — offer an incentive to come back',
        kind: 'retention',
        priority: 7,
      });
    }

    // Collection priority
    if (collectionPriority >= 60) {
      out.push({
        id: 'scoring_collection_high',
        text: 'Outstanding balance detected — prioritize payment collection today',
        kind: 'collect',
        priority: 9,
      });
    } else if (collectionPriority >= 35) {
      out.push({
        id: 'scoring_collection_medium',
        text: 'Customer has an open balance — good moment to ask about payment',
        kind: 'collect',
        priority: 6,
      });
    }

    // Strong upsell signal (overrides generic accessory suggestion)
    if (upsellOpportunity >= 65 && vipScore >= 40) {
      out.push({
        id: 'scoring_upsell_strong',
        text: 'Strong upsell opportunity — offer a bundle or protection plan now',
        kind: 'upsell',
        priority: 8,
        actionTab: 'pos',
      });
    }

    // Lost customer recovery
    if (estimatedCustomerTier === 'Lost') {
      out.push({
        id: 'scoring_lost_recovery',
        text: 'Long-inactive customer — offer a welcome-back promotion',
        kind: 'retention',
        priority: 8,
      });
    }
  }

  // ── Operational health signals (R-INTELLIGENCE-EMPLOYEE-OPS-V1) ─────────────
  // Injected last so priority sorting naturally positions them relative to
  // customer signals. Operational signals compete on priority — a repair
  // delay at p=7 will outrank a upsell suggestion at p=5.
  if (opHealth?.signals.length) {
    for (const sig of opHealth.signals) {
      out.push({
        id: sig.id,
        text: sig.title,
        detail: sig.detail,
        kind: sig.suggestionKind,
        priority: sig.priority,
        actionKey: sig.actionId,
      });
    }
  }

  // Sort by priority descending, deduplicate by id, take top 6
  // (bumped from 5 to give operational signals room alongside customer signals)
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.priority - a.priority)
    .filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; })
    .slice(0, 6);
}

/**
 * A short (≤ 38 char) preview string for the badge below the bubble.
 * `tickIndex` increments externally; used to rotate through suggestions.
 * When a profile is present, notable tiers surface in the even-tick customer label.
 */
export function getMinimizedPreviewText(
  ctx: LiveContext,
  inputs: OperatorActivityInputs,
  tickIndex: number,
  profile?: CustomerBusinessProfile,
  opHealth?: OperationalHealthSnapshot,
): string {
  const suggestions = computeContextSuggestions(ctx, inputs, profile, opHealth);

  // Even ticks: customer name (with tier prefix for notable tiers). Odd ticks: cycle suggestions.
  if (tickIndex % 2 === 1 && suggestions.length > 0) {
    const s = suggestions[tickIndex % suggestions.length];
    return s.text.length > 36 ? s.text.slice(0, 34) + '…' : s.text;
  }

  if (ctx.activeCustomer?.name) {
    const name = ctx.activeCustomer.name;
    const tier = profile?.estimatedCustomerTier;
    if (tier === 'VIP') return `VIP · ${name}`.slice(0, 36);
    if (tier === 'At Risk') return `At Risk · ${name}`.slice(0, 36);
    if (tier === 'Lost') return `Lost · ${name}`.slice(0, 36);
    return name;
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
