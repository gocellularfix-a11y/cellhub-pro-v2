// ============================================================
// R-INTELLIGENCE-DECISION-LAYER-F2A: approval shadow-classification types.
//
// Purely additive. These types describe WHETHER and HOW an IntelligenceDecision
// would need approval — they do NOT call approvalGuard, generate an
// ApprovalRequest, or block anything. Used only by the shadow classifier.
// ============================================================

import type { ApprovalActionType } from '@/store/types';
import type { RouteExecutionMode } from '@/services/intelligence/router/types';

/**
 * The approval mechanism a decision's action would route through:
 *  - 'none'       → read-only / navigation; no approval.
 *  - 'soft-queue' → outbound/queued action (WhatsApp, reminder, bundle, review);
 *                   approved via the existing automation-queue UI (owner clicks
 *                   "Approve") — NOT the PIN gate.
 *  - 'hard-gate'  → money override (discount / price / refund); would route
 *                   through approvalGuard's PIN/role gate. Carries approvalActionType.
 */
export type ApprovalKind = 'none' | 'soft-queue' | 'hard-gate';

/** Result of classifying a decision's action plan. */
export interface ActionClassification {
  kind: ApprovalKind;
  /** Only set for hard-gate — the existing ApprovalActionType it maps to. */
  approvalActionType?: ApprovalActionType;
  /** Token fed to the Router so it classifies the action's executionMode. */
  routerActionType: string;
}

/**
 * Shadow approval requirement for one decision. Informational only in F2A —
 * nothing enforces it. (Enforcement is a later phase, F2C.)
 */
export interface IntelligenceApprovalRequirement {
  decisionId: string;
  executionMode: RouteExecutionMode;
  approvalRequired: boolean;
  approvalKind: ApprovalKind;
  approvalActionType?: ApprovalActionType;
  allowedOnSecondary: boolean;
  requiresApprovalReason?: string;
}
