// ============================================================
// R-INTELLIGENCE-F4A: deterministic Preparation Engine.
//
// Converts ONE ranked IntelligenceDecision (the canonical object a Top Action is
// a projection of) into a PreparedAction. Pure + deterministic: same
// (decision, lang) → same PreparedAction, except for the explicitly-injected
// `createdAt`. NO execution, NO persistence, NO sending, NO AI/LLM, NO
// randomness, NO Date.now().
//
// Template selection reads the verbatim `source` discriminated union — never
// parses translated text — so it is structurally exact and zero-info-loss.
//
// Approval requirement is READ via the existing computeApprovalRequirement (the
// same read F3B's toTopAction performs). This does NOT enforce or alter approval.
// ============================================================

import type { IntelligenceDecision } from '../IntelligenceDecision';
import { computeApprovalRequirement } from '../approval/computeApprovalRequirement';
import type { Lang3 } from '@/services/intelligence/chat/handlers';
import type { PreparedAction, PreparedActionType } from './PreparedAction';
import { renderDraft } from './templates';

export interface PrepareOptions {
  lang?: Lang3;
  /** Injected timestamp (epoch ms). Omitted → 0, keeping the builder pure. */
  now?: number;
  /** Whether the request originates from a secondary terminal (passed to approval). */
  isSecondary?: boolean;
}

/**
 * Deterministically map a decision to its preparation template type using the
 * verbatim source signal — no text parsing. Anything that is not a
 * customer-contact recovery/outreach/promotion falls back to GENERIC.
 */
export function derivePreparedType(decision: IntelligenceDecision): PreparedActionType {
  const src = decision.source;
  switch (src.kind) {
    case 'attention':
      switch (src.signal.domain) {
        case 'repair':
          // AttentionItem repair = repair is READY but not picked up (≥3 days).
          return 'READY_PICKUP';
        case 'layaway':
        case 'external_payment':
          return 'OVERDUE_LAYAWAY';
        case 'customer_churn':
        case 'store_credit':
          return 'OUTREACH';
        case 'special_order':
        default:
          return 'GENERIC';
      }
    case 'proactive':
      switch (src.signal.category) {
        case 'repair_followup':
          return 'STALE_REPAIR';
        case 'collection':
          return 'OVERDUE_LAYAWAY';
        case 'vip_retention':
          return 'OUTREACH';
        case 'revenue':
          return 'PAYMENT_OPPORTUNITY';
        case 'inventory':
        case 'approval':
        default:
          return 'GENERIC';
      }
    // Internal-analysis signals (no customer-contact draft).
    case 'loss':
    case 'drop':
    case 'diagnosis':
    case 'restock':
    default:
      return 'GENERIC';
  }
}

/**
 * Pure builder: IntelligenceDecision → PreparedAction. The decision is the
 * canonical source a Top Action is built from; `sourceTopActionId` links the
 * prepared action back to its Top Action (decision.id === TopAction.decisionId).
 */
export function prepareAction(
  decision: IntelligenceDecision,
  opts: PrepareOptions = {},
): PreparedAction {
  const lang: Lang3 = opts.lang ?? 'en';
  const type = derivePreparedType(decision);
  const req = computeApprovalRequirement(decision, { isSecondary: opts.isSecondary });

  const draftContent = renderDraft(type, {
    lang,
    customerName: decision.entityRef?.name,
    title: decision.reasoning,
    reason: decision.observation,
    action: decision.decision,
  });

  return {
    id: `prep:${decision.id}`,
    sourceTopActionId: decision.id,
    type,
    title: decision.reasoning,
    summary: decision.observation,
    approvalRequired: req.approvalRequired,
    approvalKind: req.approvalKind,
    draftContent,
    financialSensitive: decision.financialSensitive,
    createdAt: opts.now ?? 0,
  };
}
