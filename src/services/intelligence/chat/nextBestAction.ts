// ============================================================
// CellHub Intelligence — Recommended Next Best Action
// R-INTELLIGENCE-RECOMMENDED-NEXT-BEST-ACTION
//
// Single-action operator command. Reuses the deterministic scoring pipeline
// from whoNeedsAttentionToday (no duplicate scoring) and renders the #1
// ranked item as a focused decision card: headline + why + concrete step
// + executable actions. Empty state stays calm so the cashier knows to
// switch to other work (POS / inventory).
//
// NO LLM, NO embeddings, NO randomness. Same inputs → same single action.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { ChatResponse } from './handlers';
import { tChat, type Lang3 } from './handlers';
import {
  computeAttentionItemsForToday,
  actionsForAttentionItem,
  type AttentionItem,
  type AttentionDomain,
} from './whoNeedsAttentionToday';
import {
  getWorkflowSteps,
  renderWorkflowChainText,
  getWorkflowChatActions,
} from '../workflows/workflowRecommendations';

/**
 * Map a scored AttentionItem to the four lines the operator sees:
 *   - headline    → "Call Maria now — repair ready 6d, $320 waiting"
 *   - whyKey      → i18n key for the WHY paragraph
 *   - stepKey     → i18n key for the EXACT next step
 *   - urgency     → drives the badge emoji
 *
 * Pure switch over `domain`. Caller passes the active translator.
 */
function renderTopAction(item: AttentionItem, lang: Lang3): {
  headline: string;
  why: string;
  step: string;
} {
  const t = tChat(lang);
  switch (item.domain) {
    case 'external_payment':
      return {
        headline: t('chat.nextBestAction.headline.extPayment', item.entityName || ''),
        why:      t('chat.nextBestAction.why.extPayment'),
        step:     t('chat.nextBestAction.step.extPayment'),
      };
    case 'repair':
      return {
        headline: t('chat.nextBestAction.headline.repair', item.entityName || ''),
        why:      item.reason,
        step:     t('chat.nextBestAction.step.repair', item.entityName || ''),
      };
    case 'layaway':
      return {
        headline: t('chat.nextBestAction.headline.layaway', item.entityName || ''),
        why:      item.reason,
        step:     t('chat.nextBestAction.step.layaway', item.entityName || ''),
      };
    case 'special_order':
      return {
        headline: t('chat.nextBestAction.headline.specialOrder', item.entityName || ''),
        why:      item.reason,
        step:     t('chat.nextBestAction.step.specialOrder', item.entityName || ''),
      };
    case 'customer_churn':
      return {
        headline: t('chat.nextBestAction.headline.churn', item.entityName || ''),
        why:      item.reason,
        step:     t('chat.nextBestAction.step.churn', item.entityName || ''),
      };
    case 'store_credit':
      return {
        headline: t('chat.nextBestAction.headline.storeCredit', item.entityName || ''),
        why:      item.reason,
        step:     t('chat.nextBestAction.step.storeCredit', item.entityName || ''),
      };
  }
  // exhaustiveness fallback — should be unreachable.
  const _exhaustive: never = item.domain;
  void _exhaustive;
  return { headline: item.entityName || '—', why: item.reason, step: item.recommendedAction };
}

const URGENCY_BADGE: Record<AttentionItem['urgency'], string> = {
  critical: '🚨',
  high:     '⚠️',
  medium:   '📌',
  low:      'ℹ️',
};

/**
 * R-INTELLIGENCE-RECOMMENDED-NEXT-BEST-ACTION
 *
 * Returns ONE top action. Continuity-aware:
 *   - establishesContext = first item's customer/repair so "open it" /
 *     "contact him" / "why" / "show another" route correctly through the
 *     existing FOLLOWUP_PHRASES + entity_operational_command pipeline.
 *
 * Safety:
 *   - Empty state when no candidate is urgent enough — no fabricated names
 *     or balances. Operator sees a calm "nothing urgent" message.
 */
export function handleRecommendedNextBestAction(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const items = computeAttentionItemsForToday(engine, lang);

  if (items.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.nextBestAction.header')}**\n\n${t('chat.nextBestAction.empty')}`,
    };
  }

  const top = items[0];
  const { headline, why, step } = renderTopAction(top, lang);
  const badge = URGENCY_BADGE[top.urgency] ?? '•';

  const text = [
    `**${t('chat.nextBestAction.header')}**`,
    '',
    `${badge} **${headline}**`,
    `   ${t('chat.nextBestAction.whyLabel')}: ${why}`,
    `   💡 ${t('chat.nextBestAction.stepLabel')}: ${step}`,
  ].join('\n');

  const actions = actionsForAttentionItem(top, lang).slice(0, 4);

  const ctxType: 'customer' | 'repair' =
    top.domain === 'repair' ? 'repair' : 'customer';
  const ctxValue =
    top.domain === 'repair' ? top.entityId
    : top.customerId || top.entityId;

  // R-INTELLIGENCE-OPERATOR-WORKFLOW-CHAINING: append next-step guidance.
  const ATTN_TO_WORKFLOW: Record<AttentionDomain, string> = {
    repair: 'repair_pickup',
    layaway: 'layaway_stale',
    special_order: 'special_order',
    external_payment: 'ext_payment',
    customer_churn: 'customer_churn',
    store_credit: 'store_credit_liability',
  };
  const workflowRecs = getWorkflowSteps({ priorityDomain: ATTN_TO_WORKFLOW[top.domain] }, t);
  const workflowText = renderWorkflowChainText(workflowRecs, t);
  const workflowActions = getWorkflowChatActions(workflowRecs, { type: ctxType, value: ctxValue });

  return {
    kind: 'answer',
    text: text + workflowText,
    ...(actions.length + workflowActions.length > 0
      ? { actions: [...actions, ...workflowActions].slice(0, 8) }
      : {}),
    establishesContext: { type: ctxType, value: ctxValue },
  };
}
