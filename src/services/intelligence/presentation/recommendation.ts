// ============================================================
// I6-C1 — RecommendationComposer.
//
// Turns a structured finding into ONE owner-facing next step. Every
// recommendation is directly supported by the detector's evidence — never a
// hallucinated action, never advice the data does not justify. When the
// evidence supports no specific action (e.g. a from-zero positive with no
// clear driver) the composer returns null and the card simply shows no
// recommendation. Wording lives ONLY here + strings.ts.
// ============================================================

import type { ProactiveInsight, EvidenceQualityCause } from '../proactiveInsights/types';
import type { PresenterLang } from './types';
import { tri } from './strings';

/** Data-quality recommendations, one per structural root cause. */
const CAUSE_RECOMMENDATION: Record<EvidenceQualityCause, (lang: PresenterLang) => string> = {
  insufficient_cost_coverage: (l) => tri(l,
    'Add product costs so profit and margin are accurate.',
    'Agrega el costo de los productos para que la ganancia y el margen sean exactos.',
    'Adicione o custo dos produtos para que o lucro e a margem fiquem exatos.'),
  excessive_unknown_classification: (l) => tri(l,
    'Label the carrier on phone payments and activations so carrier reports stay complete.',
    'Etiqueta la compañía en los pagos de teléfono y activaciones para que los reportes de compañías estén completos.',
    'Rotule a operadora nos pagamentos de telefone e ativações para que os relatórios de operadoras fiquem completos.'),
  absent_activity: (l) => tri(l,
    'Record sales in this period to enable analysis.',
    'Registra ventas en este período para poder analizarlo.',
    'Registre vendas neste período para permitir a análise.'),
  stale_activity: (l) => tri(l,
    'Check whether recent sales are being recorded.',
    'Verifica si las ventas recientes se están registrando.',
    'Verifique se as vendas recentes estão sendo registradas.'),
  insufficient_history: (l) => tri(l,
    'Keep recording sales — week-over-week comparisons improve as history builds.',
    'Sigue registrando ventas — las comparaciones semana a semana mejoran conforme se acumula historial.',
    'Continue registrando vendas — as comparações semana a semana melhoram conforme o histórico cresce.'),
  missing_customer_attribution: (l) => tri(l,
    'Attach a customer to sales when possible so customer insights are complete.',
    'Asocia un cliente a las ventas cuando sea posible para que los análisis de clientes estén completos.',
    'Associe um cliente às vendas quando possível para que as análises de clientes fiquem completas.'),
};

/** The single recommendation for an insight, or null when none is supported. */
export function composeRecommendation(insight: ProactiveInsight, lang: PresenterLang): string | null {
  switch (insight.detectorId) {
    case 'sales_momentum':
      return insight.direction === 'negative'
        ? tri(lang,
            'Review recent sales activity first.',
            'Revisa primero la actividad de ventas reciente.',
            'Revise primeiro a atividade de vendas recente.')
        : tri(lang,
            'See what is driving the increase and keep it going.',
            'Identifica qué está impulsando el aumento y mantenlo.',
            'Identifique o que está impulsionando o aumento e mantenha.');

    case 'gross_margin_pressure':
      return insight.direction === 'negative'
        ? tri(lang,
            'Review pricing and product costs.',
            'Revisa los precios y los costos de los productos.',
            'Revise os preços e os custos dos produtos.')
        : tri(lang,
            'Note what improved and keep applying it.',
            'Anota qué mejoró y sigue aplicándolo.',
            'Anote o que melhorou e continue aplicando.');

    case 'carrier_concentration':
      return tri(lang,
        'Consider reviewing whether other carrier sales are declining.',
        'Considera revisar si las ventas de otras compañías están bajando.',
        'Considere revisar se as vendas de outras operadoras estão caindo.');

    case 'evidence_quality':
      return CAUSE_RECOMMENDATION[insight.evidence.detectorId === 'evidence_quality' ? insight.evidence.cause : 'insufficient_history'](lang);

    default:
      return null;
  }
}
