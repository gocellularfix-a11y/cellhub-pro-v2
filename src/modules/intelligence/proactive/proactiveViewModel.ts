// ============================================================
// I6-C2 — proactive consumer VIEW-MODEL (pure, framework-free).
//
// All the derive-from-PresentedInsights logic the section and the bubble
// share, with ZERO React / store / DOM imports — so it is unit-testable in
// the node test env and can never accidentally re-order, re-group or re-word
// (it only reads the presenter's already-canonical models). Both consumers
// import from here; tests import from here.
// ============================================================

import type { InsightCard, InsightGroup, InsightPriority, PresentedInsights, PresenterLang } from '@/services/intelligence/presentation';
import { PUI, priorityTone, type ToneKey } from './proactiveStrings';

export const MAX_BUBBLE_GROUPS = 3;

// ── Business Manager section helpers ────────────────────────
/** Confidence is shown ONLY when it flags partial evidence (< 80%), so a
 *  fully-supported card stays visually quiet. Never a raw decimal. */
export function shouldShowConfidence(card: InsightCard): boolean {
  return card.confidencePct < 80;
}

/** Every owner-visible string on a card — used by tests to assert no internal
 *  terminology leaks into the UI. */
export function cardVisibleText(card: InsightCard): string[] {
  return [card.headline, card.summary, ...(card.recommendation ? [card.recommendation] : []), ...card.expandableDetails];
}

export function sectionHasContent(presented: PresentedInsights | null): boolean {
  return !!presented && presented.cards.length > 0;
}

// ── Recommendation Bubble helpers ───────────────────────────
/** Highest-priority visible insight drives the collapsed styling. */
export function bubbleHighestPriority(p: PresentedInsights): InsightPriority | null {
  return p.groups[0]?.priority ?? p.cards[0]?.priority ?? null;
}

/** The top one-to-three presented groups — a summary, never the full list. */
export function bubbleTopGroups(p: PresentedInsights, max = MAX_BUBBLE_GROUPS): InsightGroup[] {
  return p.groups.slice(0, max);
}

export interface BubbleCollapsedModel {
  label: string;
  count: number;
  tone: ToneKey;
  priority: InsightPriority | null;
}

/** Collapsed summary — count of actionable findings when present, otherwise a
 *  calm neutral line. Uses ONLY presenter data; never invents a status. */
export function bubbleCollapsedModel(p: PresentedInsights, lang: PresenterLang): BubbleCollapsedModel {
  const count = p.actionableCount;
  const priority = bubbleHighestPriority(p);
  const label = count > 0 ? PUI.needAttention(count, lang)
    : p.cards.length > 0 ? PUI.worthLook(lang)
      : PUI.noUrgent(lang);
  return { label, count, tone: priority ? priorityTone(priority) : 'neutral', priority };
}
