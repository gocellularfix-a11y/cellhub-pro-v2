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
      lines.push(`${i + 1}. ${r.label} — ${formatValue(r.value, lang)}`);
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
