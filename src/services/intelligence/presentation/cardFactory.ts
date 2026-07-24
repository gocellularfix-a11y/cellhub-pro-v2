// ============================================================
// I6-C1 — InsightCardFactory.
//
// Projects ONE canonical ProactiveInsight into ONE ready-to-render
// InsightCard. All wording is localized here (headline / summary / details)
// and by the RecommendationComposer. Numbers come straight from the
// detector's evidence — nothing is recomputed, nothing is fabricated. The
// card answers the three convention questions in under ten seconds:
//   headline = What happened?   summary = Why care?   recommendation = Do what?
// ============================================================

import type {
  ProactiveInsight, SalesMomentumEvidence, GrossMarginPressureEvidence,
  CarrierConcentrationEvidence, EvidenceQualityEvidence, EvidenceQualityCause,
} from '../proactiveInsights/types';
import type { InsightActionHint, InsightCard, PresenterLang } from './types';
import { priorityOf } from './priority';
import { composeRecommendation } from './recommendation';
import {
  tri, formatMoney, formatSignedPct, formatSharePct, formatPoints, formatYMD, formatCount,
} from './strings';

// ── sales momentum ──────────────────────────────────────────
function salesCard(e: SalesMomentumEvidence, i: ProactiveInsight, lang: PresenterLang): Partial<InsightCard> {
  const pct = e.changePct ?? 0;
  const down = i.direction === 'negative';
  const headline = down
    ? tri(lang,
        `Sales dropped ${formatSignedPct(pct)} vs the previous week.`,
        `Las ventas bajaron ${formatSignedPct(pct)} frente a la semana anterior.`,
        `As vendas caíram ${formatSignedPct(pct)} em relação à semana anterior.`)
    : tri(lang,
        `Sales grew ${formatSignedPct(pct)} vs the previous week.`,
        `Las ventas subieron ${formatSignedPct(pct)} frente a la semana anterior.`,
        `As vendas subiram ${formatSignedPct(pct)} em relação à semana anterior.`);
  const summary = down
    ? (i.severity === 'critical'
        ? tri(lang, 'This is a sharp decline that can affect your income.', 'Es una caída fuerte que puede afectar tus ingresos.', 'É uma queda forte que pode afetar sua receita.')
        : tri(lang, 'Sales are down and worth a closer look.', 'Las ventas están bajando y vale la pena revisarlas.', 'As vendas estão caindo e vale a pena revisar.'))
    : tri(lang, 'Momentum is up compared with last week.', 'El impulso subió comparado con la semana pasada.', 'O ritmo subiu em comparação com a semana passada.');
  return {
    icon: down ? '📉' : '📈',
    headline,
    summary,
    expandableDetails: [
      tri(lang,
        `This week: ${formatMoney(e.currentCents)} (${e.currentTransactionCount} sales)`,
        `Esta semana: ${formatMoney(e.currentCents)} (${e.currentTransactionCount} ventas)`,
        `Esta semana: ${formatMoney(e.currentCents)} (${e.currentTransactionCount} vendas)`),
      tri(lang,
        `Previous week: ${formatMoney(e.baselineCents)} (${e.baselineTransactionCount} sales)`,
        `Semana anterior: ${formatMoney(e.baselineCents)} (${e.baselineTransactionCount} ventas)`,
        `Semana anterior: ${formatMoney(e.baselineCents)} (${e.baselineTransactionCount} vendas)`),
      tri(lang, `Change: ${formatSignedPct(pct)}`, `Cambio: ${formatSignedPct(pct)}`, `Variação: ${formatSignedPct(pct)}`),
    ],
    actions: [{ kind: down ? 'review_sales_activity' : 'reinforce_sales_driver', category: 'sales' }],
  };
}

// ── gross margin pressure ───────────────────────────────────
function marginCard(e: GrossMarginPressureEvidence, i: ProactiveInsight, lang: PresenterLang): Partial<InsightCard> {
  const pts = e.marginChangePoints ?? 0;
  const down = i.direction === 'negative';
  const headline = down
    ? tri(lang,
        `Profit margin fell ${formatPoints(pts, lang)} vs the previous week.`,
        `El margen de ganancia bajó ${formatPoints(pts, lang)} frente a la semana anterior.`,
        `A margem de lucro caiu ${formatPoints(pts, lang)} em relação à semana anterior.`)
    : tri(lang,
        `Profit margin improved ${formatPoints(pts, lang)} vs the previous week.`,
        `El margen de ganancia mejoró ${formatPoints(pts, lang)} frente a la semana anterior.`,
        `A margem de lucro melhorou ${formatPoints(pts, lang)} em relação à semana anterior.`);
  const summary = down
    ? (i.severity === 'critical'
        ? tri(lang, 'Your margin dropped sharply — you may be keeping less on each sale.', 'Tu margen cayó fuerte — puede que estés quedándote con menos en cada venta.', 'Sua margem caiu forte — você pode estar ficando com menos em cada venda.')
        : tri(lang, 'Margin is under pressure this week.', 'El margen está bajo presión esta semana.', 'A margem está sob pressão nesta semana.'))
    : tri(lang, 'You are keeping more on each sale than last week.', 'Te estás quedando con más en cada venta que la semana pasada.', 'Você está ficando com mais em cada venda do que na semana passada.');
  const details: string[] = [];
  if (e.currentMarginPct !== null) details.push(tri(lang, `This week margin: ${formatSharePct(e.currentMarginPct / 100)}`, `Margen esta semana: ${formatSharePct(e.currentMarginPct / 100)}`, `Margem esta semana: ${formatSharePct(e.currentMarginPct / 100)}`));
  if (e.baselineMarginPct !== null) details.push(tri(lang, `Previous week margin: ${formatSharePct(e.baselineMarginPct / 100)}`, `Margen semana anterior: ${formatSharePct(e.baselineMarginPct / 100)}`, `Margem semana anterior: ${formatSharePct(e.baselineMarginPct / 100)}`));
  details.push(tri(lang, `Change: ${pts > 0 ? '+' : pts < 0 ? '−' : ''}${formatPoints(pts, lang)}`, `Cambio: ${pts > 0 ? '+' : pts < 0 ? '−' : ''}${formatPoints(pts, lang)}`, `Variação: ${pts > 0 ? '+' : pts < 0 ? '−' : ''}${formatPoints(pts, lang)}`));
  return {
    icon: down ? '💸' : '📈',
    headline,
    summary,
    expandableDetails: details,
    actions: [{ kind: down ? 'review_pricing_and_costs' : 'reinforce_margin_driver', category: 'margin' }],
  };
}

// ── carrier concentration (neutral exposure) ────────────────
function carrierCard(e: CarrierConcentrationEvidence, i: ProactiveInsight, lang: PresenterLang): Partial<InsightCard> {
  const severe = i.severity === 'important';
  const headline = tri(lang,
    `Most carrier activity depends on ${e.topCarrier}.`,
    `La mayor parte de la actividad de compañías depende de ${e.topCarrier}.`,
    `A maior parte da atividade de operadoras depende de ${e.topCarrier}.`);
  const summary = severe
    ? tri(lang, 'A large share of carrier sales rely on one carrier — that is concentration risk.', 'Una gran parte de las ventas de compañías depende de una sola — eso es riesgo de concentración.', 'Uma grande parte das vendas de operadoras depende de uma só — isso é risco de concentração.')
    : tri(lang, 'Carrier activity leans heavily on one carrier.', 'La actividad de compañías se apoya mucho en una sola.', 'A atividade de operadoras se apoia muito em uma só.');
  const details = [
    tri(lang,
      `${e.topCarrier}: ${formatSharePct(e.concentration)} of carrier activity (${e.topCarrierTransactionCount} of ${e.totalEligibleTransactionCount})`,
      `${e.topCarrier}: ${formatSharePct(e.concentration)} de la actividad de compañías (${e.topCarrierTransactionCount} de ${e.totalEligibleTransactionCount})`,
      `${e.topCarrier}: ${formatSharePct(e.concentration)} da atividade de operadoras (${e.topCarrierTransactionCount} de ${e.totalEligibleTransactionCount})`),
  ];
  if (e.tiedWith.length > 0) {
    details.push(tri(lang,
      `Tied with: ${e.tiedWith.join(', ')}`,
      `Empatada con: ${e.tiedWith.join(', ')}`,
      `Empatada com: ${e.tiedWith.join(', ')}`));
  }
  if (e.excludedMixedSales > 0) {
    details.push(tri(lang,
      `Mixed-carrier sales excluded: ${e.excludedMixedSales}`,
      `Ventas de compañía mixta excluidas: ${e.excludedMixedSales}`,
      `Vendas de operadora mista excluídas: ${e.excludedMixedSales}`));
  }
  return {
    icon: '📡',
    headline,
    summary,
    expandableDetails: details,
    actions: [{ kind: 'compare_carrier_previous_period', category: 'carriers' }],
  };
}

// ── evidence quality (per root cause) ───────────────────────
const CAUSE_ICON: Record<EvidenceQualityCause, string> = {
  insufficient_cost_coverage: '🧾',
  excessive_unknown_classification: '🏷️',
  absent_activity: '🕳️',
  stale_activity: '⏳',
  insufficient_history: '🌱',
  missing_customer_attribution: '👤',
};

function evidenceQualityHeadSummary(e: EvidenceQualityEvidence, lang: PresenterLang): { headline: string; summary: string } {
  const cause = e.cause;
  switch (cause) {
    case 'insufficient_cost_coverage':
      return {
        headline: tri(lang, 'Some sales are missing product costs.', 'Algunas ventas no tienen el costo del producto.', 'Algumas vendas estão sem o custo do produto.'),
        summary: tri(lang, 'Profit and margin figures may be incomplete.', 'Las cifras de ganancia y margen pueden estar incompletas.', 'Os números de lucro e margem podem estar incompletos.'),
      };
    case 'excessive_unknown_classification': {
      // R-WORTH-A-LOOK-UX-V1: the detector supplies a measured SHARE of
      // carrier-activity sales without a resolvable carrier (never an exact
      // record count) — so the headline presents that real percentage, and
      // falls back to honest non-numeric wording when no ratio was measured.
      // No count is ever implied that the detector did not supply.
      const pct = e.measuredRatio !== null ? Math.round(e.measuredRatio * 100) : null;
      const headline = pct !== null
        ? tri(lang,
            `About ${pct}% of recent phone transactions are missing a carrier`,
            `Cerca del ${pct}% de las transacciones de telefonía recientes no tienen compañía asignada`,
            `Cerca de ${pct}% das transações recentes de telefonia estão sem operadora`)
        : tri(lang,
            'Some recent phone transactions are missing a carrier assignment.',
            'Algunas transacciones de telefonía recientes no tienen compañía asignada.',
            'Algumas transações recentes de telefonia estão sem operadora.');
      return {
        headline,
        summary: tri(lang,
          'These payments or activations were saved without AT&T, Verizon, T-Mobile, or another carrier. Your carrier reports may therefore show incomplete totals.',
          'Estos pagos o activaciones se guardaron sin indicar AT&T, Verizon, T-Mobile u otra compañía. Por eso, los reportes por compañía pueden mostrar totales incompletos.',
          'Esses pagamentos ou ativações foram salvos sem AT&T, Verizon, T-Mobile ou outra operadora. Por isso, os relatórios por operadora podem mostrar totais incompletos.'),
      };
    }
    case 'absent_activity':
      return {
        headline: tri(lang, 'No recorded sales in the recent period.', 'No hay ventas registradas en el período reciente.', 'Não há vendas registradas no período recente.'),
        summary: tri(lang, "There isn't enough activity to analyze.", 'No hay suficiente actividad para analizar.', 'Não há atividade suficiente para analisar.'),
      };
    case 'stale_activity':
      return {
        headline: tri(lang, 'No recent sales activity.', 'Sin actividad de ventas reciente.', 'Sem atividade de vendas recente.'),
        summary: tri(lang, 'The latest recorded sale is a few days old.', 'La venta registrada más reciente es de hace unos días.', 'A venda registrada mais recente é de alguns dias atrás.'),
      };
    case 'insufficient_history':
      return {
        headline: tri(lang, 'Not enough history yet for full comparisons.', 'Aún no hay suficiente historial para comparaciones completas.', 'Ainda não há histórico suficiente para comparações completas.'),
        summary: tri(lang, 'Week-over-week trends need more days of data.', 'Las tendencias semana a semana necesitan más días de datos.', 'As tendências semana a semana precisam de mais dias de dados.'),
      };
    case 'missing_customer_attribution':
      return {
        headline: tri(lang, "Many sales aren't linked to a customer.", 'Muchas ventas no están vinculadas a un cliente.', 'Muitas vendas não estão vinculadas a um cliente.'),
        summary: tri(lang, 'Customer insights may be limited.', 'Los análisis de clientes pueden ser limitados.', 'As análises de clientes podem ser limitadas.'),
      };
    default:
      return { headline: '', summary: '' };
  }
}

function evidenceQualityCard(e: EvidenceQualityEvidence, lang: PresenterLang): Partial<InsightCard> {
  const { headline, summary } = evidenceQualityHeadSummary(e, lang);
  const details: string[] = [];
  if (e.measuredRatio !== null && e.ratioThreshold !== null) {
    details.push(tri(lang,
      `Measured: ${formatSharePct(e.measuredRatio)} (threshold ${formatSharePct(e.ratioThreshold)})`,
      `Medido: ${formatSharePct(e.measuredRatio)} (umbral ${formatSharePct(e.ratioThreshold)})`,
      `Medido: ${formatSharePct(e.measuredRatio)} (limite ${formatSharePct(e.ratioThreshold)})`));
  }
  if (e.cause === 'stale_activity' && e.lastActivityYMD) {
    details.push(tri(lang,
      `Last recorded sale: ${formatYMD(e.lastActivityYMD, lang)}`,
      `Última venta registrada: ${formatYMD(e.lastActivityYMD, lang)}`,
      `Última venda registrada: ${formatYMD(e.lastActivityYMD, lang)}`));
  }
  return {
    icon: CAUSE_ICON[e.cause],
    headline,
    summary,
    expandableDetails: details,
    actions: [{ kind: 'improve_data_quality', category: 'data_quality' }],
    // R-WORTH-A-LOOK-UX-V1: the carrier-labeling gap gets a direct CTA. No
    // dedicated correction surface exists, so consumers route it to the
    // Business Manager evidence section (safe existing destination).
    ...(e.cause === 'excessive_unknown_classification'
      ? { ctaLabel: tri(lang, 'Review transactions', 'Revisar transacciones', 'Revisar transações') }
      : {}),
  };
}

/** THE factory: canonical insight → ready-to-render card. */
export function buildInsightCard(insight: ProactiveInsight, lang: PresenterLang): InsightCard {
  const e = insight.evidence;
  let parts: Partial<InsightCard>;
  switch (e.detectorId) {
    case 'sales_momentum': parts = salesCard(e, insight, lang); break;
    case 'gross_margin_pressure': parts = marginCard(e, insight, lang); break;
    case 'carrier_concentration': parts = carrierCard(e, insight, lang); break;
    case 'evidence_quality': parts = evidenceQualityCard(e, lang); break;
    default: parts = {};
  }
  void formatCount; // reserved for future count-based cards
  return {
    fingerprint: insight.fingerprint,
    detectorId: insight.detectorId,
    category: insight.category,
    severity: insight.severity,
    direction: insight.direction,
    priority: priorityOf(insight.severity, insight.direction),
    confidence: insight.confidence,
    confidencePct: Math.round(insight.confidence * 100),
    icon: parts.icon ?? 'ℹ️',
    headline: parts.headline ?? '',
    summary: parts.summary ?? '',
    recommendation: composeRecommendation(insight, lang),
    expandableDetails: parts.expandableDetails ?? [],
    actions: (parts.actions as InsightActionHint[] | undefined) ?? [],
    // R-WORTH-A-LOOK-UX-V1: optional direct CTA label (carrier-gap card).
    ...(parts.ctaLabel ? { ctaLabel: parts.ctaLabel } : {}),
  };
}
