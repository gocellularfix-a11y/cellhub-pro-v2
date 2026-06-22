// ============================================================
// R-INTELLIGENCE-DECISION-LAYER-F2A: shadow approval-requirement computation.
//
// Deterministic + additive. Combines the pure action classifier with the pure
// Router to produce an IntelligenceApprovalRequirement. It NEVER calls
// approvalGuard, NEVER builds an ApprovalRequest, and NEVER blocks execution —
// it only describes what WOULD be required. Enforcement is a later phase (F2C).
// ============================================================

import type { IntelligenceDecision } from '../IntelligenceDecision';
import { routeIntelligenceRequest } from '@/services/intelligence/router/routeIntelligenceRequest';
import type { RouteSource } from '@/services/intelligence/router/types';
import { classifyAction } from './classifyAction';
import type { IntelligenceApprovalRequirement } from './types';

/** Decision domain → Router intent hint, so the Router classifies the subject. */
const INTENT_BY_DOMAIN: Record<IntelligenceDecision['domain'], string> = {
  inventory: 'inventory',
  customer: 'customer',
  repair: 'repair',
  cash: 'sales',
  marketing: 'marketing',
  tax: 'tax',
  ops: 'general',
};

export interface ApprovalRequirementOptions {
  /** Whether the request originates from a secondary terminal. */
  isSecondary?: boolean;
}

/**
 * Compute the (shadow) approval requirement for a decision. Pure: same inputs
 * → same output. `approvalKind` is the decision's intrinsic action mechanism;
 * `approvalRequired` is the Router's verdict on the resulting executionMode.
 */
export function computeApprovalRequirement(
  decision: IntelligenceDecision,
  opts: ApprovalRequirementOptions = {},
): IntelligenceApprovalRequirement {
  const cls = classifyAction(decision);
  // A 'none' classification is a passive suggestion (no executable action) →
  // route as 'insight'; soft/hard are real actions → route as 'action'.
  const source: RouteSource = cls.kind === 'none' ? 'insight' : 'action';

  const route = routeIntelligenceRequest({
    source,
    actionType: cls.routerActionType,
    intentId: INTENT_BY_DOMAIN[decision.domain],
    isSecondary: opts.isSecondary === true,
    hasApproval: false,
  });

  const approvalRequired =
    route.executionMode === 'requireApproval' || route.executionMode === 'triggerModule';

  return {
    decisionId: decision.id,
    executionMode: route.executionMode,
    approvalRequired,
    approvalKind: cls.kind,
    approvalActionType: cls.approvalActionType,
    // Secondary-safe only when BOTH the decision and the Router agree it is.
    allowedOnSecondary: decision.safeToRunOnSecondary && route.safeToRunOnSecondary,
    requiresApprovalReason: route.requiresApprovalReason,
  };
}

/**
 * Shadow log a requirement to the dev console. Observation only — never blocks,
 * mirrors the Router's own '[IntelligenceRouter:shadow]' pattern. No-op outside
 * dev builds.
 */
export function logApprovalRequirementShadow(req: IntelligenceApprovalRequirement): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.debug(
    '[IntelligenceApproval:shadow]',
    req.decisionId,
    req.executionMode,
    req.approvalKind,
    req.approvalRequired,
    req.approvalActionType,
    req.allowedOnSecondary,
  );
}
