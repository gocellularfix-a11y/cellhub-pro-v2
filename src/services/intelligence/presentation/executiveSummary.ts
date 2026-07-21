// ============================================================
// I6-C1 — ExecutiveSummary.
//
// ONE canonical, owner-facing summary for the whole run — the line Chat
// answers "How is my business?" with and the Bubble leads with. Faithful by
// construction: every clause comes from an EMITTED insight (a group
// headline). It never fabricates a positive ("margin is healthy") — the
// proactive layer only fires on material change, so silence about an area is
// reported as silence, never as "all good". When nothing emits, honesty is
// split by the diagnostics: not-enough-evidence vs no-material-change.
// ============================================================

import type { ProactiveInsightDiagnostic } from '../proactiveInsights/types';
import type { ExecutivePresentation, InsightGroup, PresenterLang } from './types';
import { priorityRank } from './priority';
import { tri } from './strings';

const MAX_SUMMARY_LINES = 4;

export function buildExecutiveSummary(
  groups: InsightGroup[],
  diagnostics: ProactiveInsightDiagnostic[],
  lang: PresenterLang,
): ExecutivePresentation {
  const actionableCount = groups.reduce(
    (sum, g) => sum + g.members.filter((c) => c.priority === 'critical' || c.priority === 'important').length,
    0,
  );

  const lines = [...groups]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, MAX_SUMMARY_LINES)
    .map((g) => g.headline);

  let headline: string;
  if (actionableCount > 0) {
    headline = tri(lang,
      `Today I found ${actionableCount} important ${actionableCount === 1 ? 'thing' : 'things'}.`,
      `Hoy encontré ${actionableCount} ${actionableCount === 1 ? 'cosa importante' : 'cosas importantes'}.`,
      `Hoje encontrei ${actionableCount} ${actionableCount === 1 ? 'coisa importante' : 'coisas importantes'}.`);
  } else if (groups.length > 0) {
    headline = tri(lang,
      'Here is what is worth noting today.',
      'Esto es lo que vale la pena notar hoy.',
      'Isto é o que vale a pena notar hoje.');
  } else {
    // Nothing emitted — honest reason from the diagnostics. If NO detector
    // even reached a threshold comparison (all thin/errored), it is a
    // coverage gap, not a clean bill of health.
    const anyThresholdReached = diagnostics.some((d) => d.status === 'emitted' || d.status === 'below_threshold');
    headline = anyThresholdReached
      ? tri(lang,
          'No material changes in the recent period.',
          'Sin cambios importantes en el período reciente.',
          'Sem mudanças importantes no período recente.')
      : tri(lang,
          "There isn't enough complete evidence to highlight changes yet.",
          'Aún no hay suficiente evidencia completa para destacar cambios.',
          'Ainda não há evidência completa suficiente para destacar mudanças.');
  }

  return { headline, lines, actionableCount };
}
