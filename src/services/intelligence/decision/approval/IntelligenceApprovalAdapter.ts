// ============================================================
// R-INTELLIGENCE-DECISION-LAYER-F2B: ApprovalRequest generation for hard-gate
// Intelligence decisions.
//
// Pure + deterministic + NON-EXECUTING. It builds the ApprovalRequest objects a
// future enforcement phase (F2C) would hand to approvalGuard. It does NOT import
// approvalGuard's runtime (the ApprovalRequest type is a TYPE-ONLY import, fully
// erased at compile time), never calls requestApproval, and never blocks anything.
// ============================================================

import type { ApprovalRequest } from '@/services/security/approvalGuard';
import type { ApprovalActionType } from '@/store/types';
import type { PendingDeal } from '@/services/intelligence/deals/dealTypes';
import type { IntelligenceDecision } from '../IntelligenceDecision';
import { classifyAction } from './classifyAction';

export interface IntelligenceApprovalContext {
  /** The operator the decision would be attributed to (the requester). */
  currentEmployee?: { id?: string | null } | null;
}

/** First pending-deal draft attached to the decision's action plan, if any. */
function pendingDealOf(decision: IntelligenceDecision) {
  for (const a of decision.actionPlan.actions) {
    if (a.pendingDeal) return a.pendingDeal;
  }
  return undefined;
}

/**
 * affectedAmount (integer cents) for the approval.
 *
 * For deal/discount drafts the precise figure is the price delta
 * (original − proposed) × qty — strictly more correct than decision.impactCents,
 * whose meaning varies by source (exposure / margin / recoverable revenue).
 * Falls back to decision.impactCents when no deal draft is attached.
 */
export function deriveAffectedAmount(decision: IntelligenceDecision): number | undefined {
  const pd = pendingDealOf(decision);
  if (pd && Number.isFinite(pd.originalPriceCents) && Number.isFinite(pd.proposedPriceCents)) {
    const qty = Number.isFinite(pd.qty) && pd.qty > 0 ? pd.qty : 1;
    return Math.max(0, pd.originalPriceCents - pd.proposedPriceCents) * qty;
  }
  return decision.impactCents;
}

/**
 * entityId for the approval. A deal draft targets a concrete inventory item, so
 * its inventoryId is the most precise entity; otherwise use the decision's
 * normalized entityRef id. Undefined when neither is present.
 */
export function deriveEntityId(decision: IntelligenceDecision): string | undefined {
  const pd = pendingDealOf(decision);
  return pd?.inventoryId ?? decision.entityRef?.id;
}

/**
 * Pure field-mapper given an explicit ApprovalActionType. Covers all money
 * mappings (DISCOUNT_OVERRIDE / PRICE_OVERRIDE / REFUND) with identical field
 * sources. Does NOT decide whether approval is needed — see classifyAction.
 *
 * Field sources:
 *   actionType            ← caller (or classifyAction's approvalActionType)
 *   requestedByEmployeeId ← ctx.currentEmployee.id (empty string if absent)
 *   entityId              ← deal.inventoryId ?? decision.entityRef.id
 *   affectedAmount        ← deal price-delta ?? decision.impactCents
 *   reason                ← decision.reasoning
 */
export function buildApprovalRequest(
  actionType: ApprovalActionType,
  decision: IntelligenceDecision,
  ctx: IntelligenceApprovalContext,
): ApprovalRequest {
  return {
    actionType,
    requestedByEmployeeId: ctx.currentEmployee?.id ?? '',
    entityId: deriveEntityId(decision),
    affectedAmount: deriveAffectedAmount(decision),
    reason: decision.reasoning,
  };
}

/**
 * Build an ApprovalRequest for a decision IFF it is hard-gate. Returns null for
 * soft-queue / none classifications (those never route through approvalGuard's
 * PIN gate). Still NON-EXECUTING — the caller decides what to do with the result.
 */
export function toApprovalRequest(
  decision: IntelligenceDecision,
  ctx: IntelligenceApprovalContext,
): ApprovalRequest | null {
  const cls = classifyAction(decision);
  if (cls.kind !== 'hard-gate' || !cls.approvalActionType) return null;
  return buildApprovalRequest(cls.approvalActionType, decision, ctx);
}

/**
 * R-INTELLIGENCE-DECISION-LAYER-F2C: build an ApprovalRequest directly from a
 * PendingDeal. Used by handleAddDealToCart, which already holds the raw deal —
 * wrapping it in an IntelligenceDecision would add a pointless translation layer.
 *
 * A deal is a discount → DISCOUNT_OVERRIDE. affectedAmount is the exact price
 * delta (pendingDeal always carries it here, so impactCents is never needed):
 *   max(0, originalPriceCents − proposedPriceCents) × qty
 */
export function approvalRequestFromPendingDeal(
  deal: PendingDeal,
  ctx: IntelligenceApprovalContext,
): ApprovalRequest {
  const qty = Number.isFinite(deal.qty) && deal.qty > 0 ? deal.qty : 1;
  const affectedAmount = Math.max(0, deal.originalPriceCents - deal.proposedPriceCents) * qty;
  return {
    actionType: 'DISCOUNT_OVERRIDE',
    requestedByEmployeeId: ctx.currentEmployee?.id ?? '',
    entityId: deal.inventoryId,
    affectedAmount,
    reason: deal.reason || deal.offerText,
  };
}
