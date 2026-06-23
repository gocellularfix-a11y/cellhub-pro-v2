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
// enforcement. Each PreparedAction links back 1:1 to the Top Action it was
// derived from via `sourceTopActionId` (== the decision id == TopAction.decisionId).
//
// Determinism contract: the same IntelligenceDecision + lang always produce the
// same PreparedAction (modulo the explicitly-injected `createdAt`). No Date.now()
// and no randomness inside the pure builder — the timestamp is supplied by the
// impure wiring boundary (see getPreparedActionsToday.ts).
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
  /** Injected at the impure boundary (epoch ms). 0 when not supplied. */
  createdAt: number;
}
