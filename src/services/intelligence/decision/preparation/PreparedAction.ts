// ============================================================
// R-INTELLIGENCE-F4A: PreparedAction canonical model (Action Preparation).
//
// F4 moves Intelligence from "recommended action" → "prepared action ready for
// approval". A PreparedAction is the deterministic, template-driven projection
// of a single ranked Top Action (IntelligenceDecision) — it carries a draft of
// what WOULD be done, but performs NO execution, NO sending, NO customer
// contact, NO persistence, and NO side effects.
//
// It is PURELY ADDITIVE. It does not alter F3B ranking, scoring, or approval
// enforcement. A PreparedAction's IDENTITY is its `id` + `sourceTopActionId`
// (both derived from the decision id == TopAction.decisionId) — NOT a timestamp.
// Each PreparedAction links back 1:1 to the Top Action it was derived from.
//
// Determinism contract: the same IntelligenceDecision + lang always produce a
// byte-identical PreparedAction. No Date.now() and no randomness anywhere in the
// preparation path. Lifecycle timestamps (queuedAt / approvedAt / executedAt)
// belong to F5/F6; `preparedAt` is optional and present ONLY when a caller
// explicitly stamps it (opts.now) — the default F4A output carries none.
// ============================================================

import type { ApprovalKind } from '../approval/types';

/**
 * Canonical preparation categories. Each maps to one entry in the template
 * registry (see templates.ts). GENERIC is the deterministic fallback for
 * internal-analysis decisions that are not a customer-contact draft
 * (inventory restock, slow-day diagnosis, money-leak analysis, ops approvals).
 */
export type PreparedActionType =
  | 'READY_PICKUP'
  | 'STALE_REPAIR'
  | 'OVERDUE_LAYAWAY'
  | 'OUTREACH'
  | 'PAYMENT_OPPORTUNITY'
  | 'GENERIC';

/**
 * A prepared, approval-ready action. Foundation-only: it describes WHAT would be
 * done and carries the draft message, but nothing here executes or sends.
 */
export interface PreparedAction {
  /** Deterministic, idempotent: `prep:${sourceTopActionId}`. */
  id: string;
  /** The IntelligenceDecision id this was prepared from (== TopAction.decisionId). */
  sourceTopActionId: string;
  /** Preparation category — drives which template produced `draftContent`. */
  type: PreparedActionType;
  /** Short label (from the decision's reasoning/headline). Already translated. */
  title: string;
  /** One-line why (from the decision's observation/reason). Already translated. */
  summary: string;
  /** Whether the prepared action would require approval before execution. */
  approvalRequired: boolean;
  /** How approval would be obtained (mirrors the Top Action; not enforced here). */
  approvalKind: ApprovalKind;
  /**
   * Template-generated draft. For customer-contact types this is the message
   * body; for GENERIC (internal) it is a deterministic internal action note.
   */
  draftContent: string;
  /** True when the action surfaces owner-only money figures (UI redaction hint). */
  financialSensitive: boolean;
  /**
   * Optional preparation timestamp (epoch ms). NOT part of identity. Present
   * only when a caller explicitly stamps it via opts.now; the default F4A
   * pipeline leaves it undefined so output stays deterministic. Lifecycle
   * timestamps (queued/approved/executed) are an F5/F6 concern.
   */
  preparedAt?: number;
}
