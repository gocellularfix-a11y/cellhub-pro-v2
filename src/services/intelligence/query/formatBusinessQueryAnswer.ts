// ============================================================
// Structured Query Executor — answer formatting (I3-2).
//
// One formatter for EN/ES/PT. Business-readable: localized metric/date
// labels, existing money convention (formatCurrency), sensible percentage
// precision, clear negatives, no enum names, no IDs, no diagnostics.
// ============================================================

import { formatCurrency } from '@/utils/currency';
import type { BusinessLanguage, BusinessMetric } from '../language/types';
import type {
  StructuredBusinessQueryResult, StructuredScalarValue, ResolvedBusinessDateRange,
  StructuredUnsupportedReason,
} from './types';

type L3 = BusinessLanguage;

const METRIC_LABELS: Record<string, Record<L3, string>> = {
  gross_sales: { en: 'Gross sales', es: 'Ventas brutas', pt: 'Vendas brutas' },
  net_sales: { en: 'Net sales', es: 'Ventas netas', pt: 'Vendas líquidas' },
  returns: { en: 'Returns/refunds', es: 'Devoluciones', pt: 'Devoluções' },
  cost: { en: 'Cost', es: 'Costo', pt: 'Custo' },
  profit: { en: 'Profit', es: 'Ganancia', pt: 'Lucro' },
  margin: { en: 'Margin', es: 'Margen', pt: 'Margem' },
  gross_tax: { en: 'Tax collected', es: 'Impuesto recaudado', pt: 'Imposto arrecadado' },
  net_tax: { en: 'Net tax', es: 'Impuesto neto', pt: 'Imposto líquido' },
  cash: { en: 'Cash', es: 'Efectivo', pt: 'Dinheiro' },
  card: { en: 'Card', es: 'Tarjeta', pt: 'Cartão' },
  store_credit: { en: 'Store credit', es: 'Crédito de tienda', pt: 'Crédito da loja' },
  transaction_count: { en: 'Transactions', es: 'Transacciones', pt: 'Transações' },
  average_ticket: { en: 'Average ticket', es: 'Ticket promedio', pt: 'Ticket médio' },
  total_collected: { en: 'Total Collected', es: 'Total Cobrado', pt: 'Total Recebido' },
  commissionable_revenue: { en: 'Commissionable revenue', es: 'Ingreso comisionable', pt: 'Receita comissionável' },
  customer_profit: { en: 'Profit', es: 'Ganancia', pt: 'Lucro' },
  customer_margin: { en: 'Margin', es: 'Margen', pt: 'Margem' },
  interactions: { en: 'Interactions', es: 'Interacciones', pt: 'Interações' },
};

const RANGE_LABELS: Record<string, Record<L3, string>> = {
  today: { en: 'today', es: 'hoy', pt: 'hoje' },
  yesterday: { en: 'yesterday', es: 'ayer', pt: 'ontem' },
  this_week: { en: 'this week', es: 'esta semana', pt: 'nesta semana' },
  last_week: { en: 'last week', es: 'la semana pasada', pt: 'na semana passada' },
  this_month: { en: 'this month', es: 'este mes', pt: 'neste mês' },
  last_month: { en: 'last month', es: 'el mes pasado', pt: 'no mês passado' },
  all_time: { en: 'all time', es: 'histórico', pt: 'desde sempre' },
  last_30_days: { en: 'last 30 days', es: 'últimos 30 días', pt: 'últimos 30 dias' },
  previous_period: { en: 'previous period', es: 'período anterior', pt: 'período anterior' },
};

export function metricLabel(metric: BusinessMetric | string, lang: L3): string {
  return METRIC_LABELS[metric]?.[lang] ?? String(metric).replace(/_/g, ' ');
}

export function rangeLabel(range: ResolvedBusinessDateRange | undefined, lang: L3): string {
  if (!range) return '';
  if (range.labelKind === 'custom') return `${range.startYMD} → ${range.endYMD}`;
  return RANGE_LABELS[range.labelKind]?.[lang] ?? range.labelKind;
}

export function formatValue(v: StructuredScalarValue, lang: L3): string {
  if (v.kind === 'money_cents') return formatCurrency(v.amount);
  if (v.kind === 'percentage') {
    if (!v.meaningful) return lang === 'es' ? 'no significativo' : lang === 'pt' ? 'não significativo' : 'not meaningful';
    return `${v.amount.toFixed(1)}%`;
  }
  if (v.kind === 'count') return String(v.amount);
  return '';
}

const CUSTOMER_ROW_ORDER = ['total_collected', 'commissionable_revenue', 'customer_profit', 'customer_margin', 'transaction_count', 'average_ticket'];

/** Localized FINANCIAL-transaction word — never "visits"/"interactions". */
export function transactionsWord(n: number, lang: L3): string {
  if (lang === 'es') return n === 1 ? 'transacción' : 'transacciones';
  if (lang === 'pt') return n === 1 ? 'transação' : 'transações';
  return n === 1 ? 'transaction' : 'transactions';
}

/** TERMINAL localized answers for TYPED recognized-but-blocked reasons. A
 *  confidently recognized financial question never falls back to a legacy
 *  financial handler — it gets one of these customer-safe explanations. */
export function formatTerminalReason(reason: StructuredUnsupportedReason, lang: L3): string {
  const M: Record<StructuredUnsupportedReason, Record<L3, string>> = {
    unsupported_metric_dimension: {
      en: "I can't calculate that breakdown exactly from the available transaction attribution, so I won't estimate it.",
      es: 'No puedo calcular ese desglose con exactitud usando la atribución disponible, por lo que no voy a estimarlo.',
      pt: 'Não consigo calcular esse detalhamento com exatidão usando a atribuição disponível, então não vou estimá-lo.',
    },
    mixed_carrier_attribution: {
      en: "One or more transactions in this period include more than one carrier (or extra unattributed items), so an exact per-carrier total isn't available — I won't estimate it.",
      es: 'Una o más transacciones de este período incluyen más de una compañía (o artículos sin atribución), así que no hay un total exacto por compañía — no voy a estimarlo.',
      pt: 'Uma ou mais transações deste período incluem mais de uma operadora (ou itens sem atribuição), então não há um total exato por operadora — não vou estimá-lo.',
    },
    employee_attribution_incomplete: {
      en: "This period includes completed services that aren't attributed to an employee, so an exact per-employee total isn't available — I won't estimate it.",
      es: 'Este período incluye servicios completados sin empleado asignado, así que no hay un total exacto por empleado — no voy a estimarlo.',
      pt: 'Este período inclui serviços concluídos sem funcionário atribuído, então não há um total exato por funcionário — não vou estimá-lo.',
    },
    store_comparison_unavailable: {
      en: "Only the current store's data is available here, so per-store comparisons aren't available.",
      es: 'Aquí solo están los datos de la tienda actual, así que las comparaciones por tienda no están disponibles.',
      pt: 'Apenas os dados da loja atual estão disponíveis aqui, então comparações por loja não estão disponíveis.',
    },
    return_count_unavailable: {
      en: 'I can report the exact refunded amount, but not a count of returns.',
      es: 'Puedo reportar el monto exacto devuelto, pero no un conteo de devoluciones.',
      pt: 'Posso informar o valor exato devolvido, mas não uma contagem de devoluções.',
    },
    invalid_date_range: {
      en: "That date range isn't valid, so I didn't run the query.",
      es: 'Ese rango de fechas no es válido, así que no ejecuté la consulta.',
      pt: 'Esse intervalo de datas não é válido, então não executei a consulta.',
    },
    missing_comparison_operand: {
      en: "I couldn't identify both sides of that comparison, so I didn't run it.",
      es: 'No pude identificar ambos lados de esa comparación, así que no la ejecuté.',
      pt: 'Não consegui identificar os dois lados dessa comparação, então não a executei.',
    },
    incompatible_dimensions: {
      en: "Those two things aren't directly comparable (different dimensions), so I didn't run the comparison.",
      es: 'Esas dos cosas no son comparables directamente (dimensiones distintas), así que no ejecuté la comparación.',
      pt: 'Essas duas coisas não são comparáveis diretamente (dimensões diferentes), então não executei a comparação.',
    },
  };
  return M[reason][lang];
}

export function formatBusinessQueryAnswer(result: StructuredBusinessQueryResult, lang: L3): string {
  const p = result.parsed;
  const dateLbl = rangeLabel(result.resolvedRange, lang);
  const withDate = (s: string) => (dateLbl ? `${s} (${dateLbl})` : s);

  if (result.status === 'no_data') {
    const base = lang === 'es' ? 'No se encontró actividad para este período.'
      : lang === 'pt' ? 'Nenhuma atividade encontrada para este período.'
      : 'No matching activity was found for this period.';
    return withDate(base);
  }
  if (result.status === 'not_found') {
    return lang === 'es' ? 'No se encontró el registro solicitado.'
      : lang === 'pt' ? 'O registro solicitado não foi encontrado.'
      : 'The requested record was not found.';
  }
  if (result.status === 'ambiguous' && result.diagnostics?.candidates?.length) {
    const head = lang === 'es' ? 'Hay varias coincidencias, ¿a cuál te refieres?'
      : lang === 'pt' ? 'Há várias correspondências, a qual você se refere?'
      : 'Multiple matches found — which one do you mean?';
    return `${head}\n${result.diagnostics.candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
  }
  if ((result.status === 'unsupported' || result.status === 'ambiguous') && result.unsupportedReason) {
    return formatTerminalReason(result.unsupportedReason, lang);
  }
  if (result.status !== 'answered') return '';

  // find_customer — canonical customer summary card.
  if (p.intent === 'find_customer' && result.rows) {
    const name = result.diagnostics?.candidates?.[0] || '';
    const lines = [`👤 ${name}`];
    for (const key of CUSTOMER_ROW_ORDER) {
      const row = result.rows.find((r) => r.label === key);
      if (!row) continue;
      if (row.value.kind === 'percentage' && !row.value.meaningful) continue;
      lines.push(`• ${metricLabel(key, lang)}: ${formatValue(row.value, lang)}`);
    }
    return lines.join('\n');
  }

  // Comparison answers.
  if (result.comparisonResult) {
    const c = result.comparisonResult;
    const leftLbl = METRIC_LABELS[c.leftLabel]?.[lang] ?? RANGE_LABELS[c.leftLabel]?.[lang] ?? c.leftLabel;
    const rightLbl = METRIC_LABELS[c.rightLabel]?.[lang] ?? RANGE_LABELS[c.rightLabel]?.[lang] ?? c.rightLabel;
    const metricLbl = p.metric && p.comparison !== 'between_metrics' ? `${metricLabel(p.metric, lang)} — ` : '';
    const lines = [
      withDate(`${metricLbl}${leftLbl}: ${formatValue(c.left, lang)} · ${rightLbl}: ${formatValue(c.right, lang)}`),
    ];
    const deltaVal: StructuredScalarValue = { kind: c.left.kind, amount: c.deltaAmount, meaningful: true };
    const deltaWord = lang === 'es' ? 'Diferencia' : lang === 'pt' ? 'Diferença' : 'Difference';
    if (c.percentagePointDelta !== undefined) {
      const pts = lang === 'es' ? 'puntos' : lang === 'pt' ? 'pontos' : 'points';
      lines.push(`${deltaWord}: ${c.percentagePointDelta.toFixed(1)} ${pts}`);
    } else {
      let d = `${deltaWord}: ${formatValue(deltaVal, lang)}`;
      if (c.percentChange !== undefined) d += ` (${c.percentChange > 0 ? '+' : ''}${c.percentChange.toFixed(1)}%)`;
      lines.push(d);
    }
    if (p.comparison === 'increase' || p.comparison === 'decrease') {
      const grew = c.deltaAmount > 0;
      const equal = c.deltaAmount === 0;
      const verdict = equal
        ? (lang === 'es' ? 'Sin cambio.' : lang === 'pt' ? 'Sem mudança.' : 'No change.')
        : grew
          ? (lang === 'es' ? 'Sí, subió.' : lang === 'pt' ? 'Sim, aumentou.' : 'Yes, it increased.')
          : (lang === 'es' ? 'No, bajó.' : lang === 'pt' ? 'Não, diminuiu.' : 'No, it decreased.');
      lines.push(verdict);
    }
    return lines.join('\n');
  }

  // Ranking / summary rows.
  if ((p.intent === 'rank_dimension' || p.intent === 'summarize_dimension') && result.rows) {
    const metricLbl = metricLabel(p.metric ?? 'gross_sales', lang);
    const header = withDate(`${metricLbl}`);
    const lines = [header];
    result.rows.forEach((r, i) => {
      // Customer rows carry the canonical FINANCIAL transaction count —
      // rendered as localized "transactions", never "visits"/"interactions".
      const tx = typeof r.txCount === 'number' ? ` · ${r.txCount} ${transactionsWord(r.txCount, lang)}` : '';
      lines.push(`${i + 1}. ${r.label} — ${formatValue(r.value, lang)}${tx}`);
    });
    return lines.join('\n');
  }

  // Single metric.
  if (result.value) {
    const lbl = metricLabel(p.metric ?? 'gross_sales', lang);
    const scope = result.rows?.[0]?.label ? ` — ${result.rows[0].label}` : '';
    return withDate(`${lbl}${scope}: ${formatValue(result.value, lang)}`);
  }
  return '';
}
