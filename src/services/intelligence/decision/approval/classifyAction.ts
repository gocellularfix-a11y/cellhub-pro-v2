// ============================================================
// R-INTELLIGENCE-DECISION-LAYER-F2A: deterministic action classifier.
// Pure — no I/O, no Date.now(), no randomness. Maps a decision's action plan
// to an approval mechanism (none | soft-queue | hard-gate).
// ============================================================

import type { ApprovalActionType } from '@/store/types';
import type { IntelligenceDecision } from '../IntelligenceDecision';
import type { ActionClassification } from './types';

/**
 * Money-action token → existing ApprovalActionType. Forward-ready for F2B:
 * 'refund' and 'price' are not emitted by any current Intelligence generator
 * (Intelligence recommends collections/outreach, never refunds), but the
 * mapping is wired so a future generator/action routes correctly.
 */
const MONEY_APPROVAL: Record<string, ApprovalActionType> = {
  discount: 'DISCOUNT_OVERRIDE',
  price: 'PRICE_OVERRIDE',
  refund: 'REFUND',
};

export function moneyApprovalTypeFor(token: string): ApprovalActionType | undefined {
  return MONEY_APPROVAL[token];
}

// Outbound / queued actions that go through the automation-queue UI gate.
const SOFT_ACTION_TYPES = new Set(['whatsapp', 'bundle', 'review', 'reminder']);
const SOFT_QUEUE_KINDS = new Set([
  'whatsapp_reconnect',
  'bundle_review',
  'reminder_followup',
  'manual_review',
]);

/**
 * Classify a decision's action plan. Order matters: hard-gate (money) wins over
 * soft-queue, which wins over none. An empty / navigation-only plan is 'none'.
 */
export function classifyAction(decision: IntelligenceDecision): ActionClassification {
  const actions = decision.actionPlan.actions;

  // 1. hard-gate — any price/discount override, including deal drafts.
  for (const a of actions) {
    if (
      a.actionType === 'discount' ||
      a.queueKind === 'discount_review' ||
      a.queueKind === 'pending_deal' ||
      a.pendingDeal !== undefined
    ) {
      return {
        kind: 'hard-gate',
        approvalActionType: MONEY_APPROVAL.discount,
        routerActionType: 'discount',
      };
    }
  }

  // 2. soft-queue — outbound/queued actions (WhatsApp, reminder, bundle, review).
  for (const a of actions) {
    if (
      (a.actionType && SOFT_ACTION_TYPES.has(a.actionType)) ||
      (a.queueKind && SOFT_QUEUE_KINDS.has(a.queueKind))
    ) {
      return { kind: 'soft-queue', routerActionType: a.actionType ?? 'outreach' };
    }
  }

  // 3. none — navigation (open_*), read-only, or empty plan.
  return { kind: 'none', routerActionType: 'open' };
}
