// ============================================================
// I6-C1 — InsightGrouping + suppression.
//
// Two noise-control concerns, both deterministic:
//
//  • GROUPING — when several findings say nearly the same thing, collapse
//    them into ONE coherent theme instead of repeating near-duplicate
//    warnings (sales decline + margin decline → "profitability pressure";
//    several data-quality gaps → "data gaps"). Singletons stay singletons.
//
//  • SUPPRESSION — never let low-value informational cards crowd out what
//    matters. When any actionable (critical/important) card exists, at most
//    ONE info card stays in the top-level view; otherwise at most three.
//    Suppressed cards are RETAINED in an audit list, never silently lost.
//
// Both run over cards the priority engine already ordered — no reordering
// beyond re-sorting groups by their strongest member.
// ============================================================

import type { InsightCard, InsightGroup, PresenterLang } from './types';
import { compareCards, priorityRank } from './priority';
import { tri } from './strings';

const INFO_LIMIT_WITH_ACTIONABLE = 1;
const INFO_LIMIT_WITHOUT_ACTIONABLE = 3;

/** Split ordered cards into the top-level view and the suppressed audit list.
 *  Input order is preserved; only info-tier overflow is moved to suppressed. */
export function applySuppression(orderedCards: InsightCard[]): { visible: InsightCard[]; suppressed: InsightCard[] } {
  const hasActionable = orderedCards.some((c) => c.priority === 'critical' || c.priority === 'important');
  const infoLimit = hasActionable ? INFO_LIMIT_WITH_ACTIONABLE : INFO_LIMIT_WITHOUT_ACTIONABLE;
  const visible: InsightCard[] = [];
  const suppressed: InsightCard[] = [];
  let infoShown = 0;
  for (const card of orderedCards) {
    if (card.priority === 'info') {
      if (infoShown < infoLimit) { visible.push(card); infoShown += 1; }
      else suppressed.push(card);
    } else {
      visible.push(card);
    }
  }
  return { visible, suppressed };
}

function themeGroup(
  groupKey: string, members: InsightCard[], icon: string,
  headline: string, summary: string, recommendation: string | null,
  ctaLabel?: string,
): InsightGroup {
  const priority = members.reduce<InsightCard['priority']>(
    (best, c) => (priorityRank(c.priority) < priorityRank(best) ? c.priority : best),
    members[0].priority,
  );
  return { groupKey, priority, icon, headline, summary, recommendation, members: [...members].sort(compareCards), ...(ctaLabel ? { ctaLabel } : {}) };
}

function singleton(card: InsightCard): InsightGroup {
  return {
    groupKey: card.fingerprint,
    priority: card.priority,
    icon: card.icon,
    headline: card.headline,
    summary: card.summary,
    recommendation: card.recommendation,
    members: [card],
    // R-WORTH-A-LOOK-UX-V1: a card-level CTA survives as the group CTA.
    ...(card.ctaLabel ? { ctaLabel: card.ctaLabel } : {}),
  };
}

/** Collapse related cards into coherent themes. Deterministic membership;
 *  every input card ends up in exactly one group. */
export function groupCards(cards: InsightCard[], lang: PresenterLang): InsightGroup[] {
  const salesNeg = cards.find((c) => c.detectorId === 'sales_momentum' && c.direction === 'negative');
  const marginNeg = cards.find((c) => c.detectorId === 'gross_margin_pressure' && c.direction === 'negative');
  const salesPos = cards.find((c) => c.detectorId === 'sales_momentum' && c.direction === 'positive');
  const marginPos = cards.find((c) => c.detectorId === 'gross_margin_pressure' && c.direction === 'positive');
  const dataQuality = cards.filter((c) => c.detectorId === 'evidence_quality');

  const used = new Set<string>();
  const groups: InsightGroup[] = [];

  if (salesNeg && marginNeg) {
    used.add(salesNeg.fingerprint); used.add(marginNeg.fingerprint);
    groups.push(themeGroup('profitability_pressure', [salesNeg, marginNeg], '📉',
      tri(lang, 'Sales and profit margin are both down.', 'Las ventas y el margen de ganancia están bajando.', 'As vendas e a margem de lucro estão caindo.'),
      tri(lang, 'Your revenue and what you keep per sale both slipped this week.', 'Tanto tus ingresos como lo que te queda por venta bajaron esta semana.', 'Tanto a sua receita quanto o que você guarda por venda caíram esta semana.'),
      tri(lang, 'Start with recent sales, then review pricing and costs.', 'Empieza con las ventas recientes y luego revisa precios y costos.', 'Comece pelas vendas recentes e depois revise preços e custos.')));
  } else if (salesPos && marginPos) {
    used.add(salesPos.fingerprint); used.add(marginPos.fingerprint);
    // R-WORTH-A-LOOK-UX-V1: evidence-honest positive summary. The exact
    // measured deltas live on the two member cards rendered with the group
    // (this layer only sees presentation cards); contributor/category
    // evidence does NOT exist in these detectors, so it is never invented —
    // the mandated fallback points the owner at the category breakdown.
    groups.push(themeGroup('business_improving', [salesPos, marginPos], '📈',
      tri(lang, 'Sales and profit margin improved', 'Las ventas y el margen de ganancia mejoraron', 'As vendas e a margem de lucro melhoraram'),
      tri(lang,
        'Sales and profit margin improved compared with the previous completed period.',
        'Las ventas y el margen de ganancia mejoraron comparados con el período completo anterior.',
        'As vendas e a margem de lucro melhoraram em comparação com o período completo anterior.'),
      tri(lang,
        'Review the category breakdown to see where the improvement came from.',
        'Revisa el desglose por categoría para ver de dónde vino la mejora.',
        'Revise a divisão por categoria para ver de onde veio a melhora.'),
      tri(lang, 'View performance', 'Ver desempeño', 'Ver desempenho')));
  }

  if (dataQuality.length >= 2 && dataQuality.every((c) => !used.has(c.fingerprint))) {
    dataQuality.forEach((c) => used.add(c.fingerprint));
    groups.push(themeGroup('data_quality', dataQuality, '🧩',
      tri(lang, 'A few data gaps are limiting your insights.', 'Algunos huecos en los datos están limitando tus análisis.', 'Algumas lacunas nos dados estão limitando suas análises.'),
      tri(lang, 'Filling these in will make your reports more accurate.', 'Completarlos hará que tus reportes sean más exactos.', 'Preenchê-las deixará seus relatórios mais exatos.'),
      tri(lang, 'Review the data quality items below.', 'Revisa los puntos de calidad de datos de abajo.', 'Revise os itens de qualidade de dados abaixo.')));
  }

  // Everything not folded into a theme becomes its own group, in input order.
  for (const card of cards) {
    if (!used.has(card.fingerprint)) { groups.push(singleton(card)); used.add(card.fingerprint); }
  }

  // Groups render strongest-theme first; ties broken by the strongest member.
  return groups.sort((a, b) =>
    priorityRank(a.priority) - priorityRank(b.priority)
    || compareCards(a.members[0], b.members[0]));
}
