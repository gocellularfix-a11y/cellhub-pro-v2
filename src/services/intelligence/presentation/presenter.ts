// ============================================================
// I6-C1 — IntelligencePresenter (orchestration).
//
// THE single entry point. Every consumer — Business Manager 💼,
// Recommendation Bubble, Intelligence Chat, future notifications — calls
// presentProactiveInsights() and renders the result. No consumer re-orders,
// re-groups, re-words or re-interprets detector output; they all read the
// same PresentedInsights.
//
// Pipeline (deterministic, pure):
//   canonical result → cards (factory)
//                    → priority order
//                    → suppression (visible / audited)
//                    → grouping (coherent themes)
//                    → executive summary
//
// Adding a future detector requires ZERO changes here: a new detector flows
// through the factory (add its wording), the generic priority/grouping/
// suppression stages carry it, and only localization strings are new.
// ============================================================

import type { ProactiveInsightsResult } from '../proactiveInsights/types';
import type { PresentedInsights, PresenterLang } from './types';
import { buildInsightCard } from './cardFactory';
import { orderCards } from './priority';
import { applySuppression, groupCards } from './grouping';
import { buildExecutiveSummary } from './executiveSummary';

export function presentProactiveInsights(result: ProactiveInsightsResult, lang: PresenterLang): PresentedInsights {
  const cards = orderCards(result.insights.map((i) => buildInsightCard(i, lang)));
  const { visible, suppressed } = applySuppression(cards);
  const groups = groupCards(visible, lang);
  const executive = buildExecutiveSummary(groups, result.diagnostics, lang);

  return {
    referenceYMD: result.referenceYMD,
    lang,
    executive,
    cards: visible,
    groups,
    suppressed,
    actionableCount: executive.actionableCount,
  };
}
