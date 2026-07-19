// ============================================================
// Business Analyst — findings presenter (I3-3).
//
// The ONLY place findings become text. Localized EN/ES/PT, deterministic,
// no developer terminology. Used by future surfaces + tests.
// ============================================================

import { formatCurrency } from '@/utils/currency';
import type { BusinessLanguage } from '../language/types';
import type { InsightFinding } from './types';

type L3 = BusinessLanguage;

const POPULATION_LABELS: Record<string, Record<L3, string>> = {
  repairs: { en: 'Repairs', es: 'Reparaciones', pt: 'Reparos' },
  unlocks: { en: 'Unlocks', es: 'Liberaciones', pt: 'Desbloqueios' },
  phone_payments: { en: 'Phone payments', es: 'Pagos de teléfono', pt: 'Pagamentos de telefone' },
  activations: { en: 'Activations', es: 'Activaciones', pt: 'Ativações' },
};

const METRIC_WORDS: Record<string, Record<L3, string>> = {
  gross_sales: { en: 'Gross sales', es: 'Ventas brutas', pt: 'Vendas brutas' },
  profit: { en: 'Profit', es: 'Ganancia', pt: 'Lucro' },
  margin: { en: 'Margin', es: 'Margen', pt: 'Margem' },
};

export function formatFinding(f: InsightFinding, lang: L3): string {
  const d = f.data;
  const $ = (v: unknown) => formatCurrency(Number(v) || 0);
  switch (f.kind) {
    case 'metric_trend': {
      const word = METRIC_WORDS[String(d.metric)]?.[lang] ?? String(d.metric);
      const dir = d.direction === 'up'
        ? (lang === 'es' ? 'subió' : lang === 'pt' ? 'subiu' : 'went up')
        : d.direction === 'down'
          ? (lang === 'es' ? 'bajó' : lang === 'pt' ? 'caiu' : 'went down')
          : (lang === 'es' ? 'sin cambio' : lang === 'pt' ? 'sem mudança' : 'unchanged');
      const pct = d.percentChange !== null && d.percentChange !== undefined ? ` ${Math.abs(Number(d.percentChange)).toFixed(1)}%` : '';
      return `${word} ${dir}${pct}.`;
    }
    case 'sales_below_rolling_average':
      return lang === 'es' ? `Ventas muy por debajo del promedio reciente: ${$(d.currentCents)} vs promedio ${$(d.rollingAverageCents)}.`
        : lang === 'pt' ? `Vendas bem abaixo da média recente: ${$(d.currentCents)} vs média ${$(d.rollingAverageCents)}.`
        : `Sales far below the recent average: ${$(d.currentCents)} vs average ${$(d.rollingAverageCents)}.`;
    case 'margin_drop':
      return lang === 'es' ? `El margen cayó ${Math.abs(Number(d.dropPp)).toFixed(1)} puntos vs el período anterior.`
        : lang === 'pt' ? `A margem caiu ${Math.abs(Number(d.dropPp)).toFixed(1)} pontos vs o período anterior.`
        : `Margin dropped ${Math.abs(Number(d.dropPp)).toFixed(1)} points vs the previous period.`;
    case 'carrier_disappeared':
      return lang === 'es' ? `${d.carrier} no registró actividad en este período (antes: ${$(d.previousCents)}).`
        : lang === 'pt' ? `${d.carrier} não registrou atividade neste período (antes: ${$(d.previousCents)}).`
        : `${d.carrier} had no activity this period (previously: ${$(d.previousCents)}).`;
    case 'employee_unusually_low':
      return lang === 'es' ? `${d.employee} vendió mucho menos que el período anterior (${$(d.currentCents)} vs ${$(d.previousCents)}).`
        : lang === 'pt' ? `${d.employee} vendeu bem menos que o período anterior (${$(d.currentCents)} vs ${$(d.previousCents)}).`
        : `${d.employee} sold much less than the previous period (${$(d.currentCents)} vs ${$(d.previousCents)}).`;
    case 'product_stopped_selling':
      return lang === 'es' ? `"${d.product}" dejó de venderse (antes: ${$(d.previousCents)}).`
        : lang === 'pt' ? `"${d.product}" parou de vender (antes: ${$(d.previousCents)}).`
        : `"${d.product}" stopped selling (previously: ${$(d.previousCents)}).`;
    case 'large_refund_period':
      return lang === 'es' ? `Período con devoluciones altas: ${$(d.refundedCents)} sobre ${$(d.grossCents)} de ventas.`
        : lang === 'pt' ? `Período com devoluções altas: ${$(d.refundedCents)} sobre ${$(d.grossCents)} de vendas.`
        : `High refunds this period: ${$(d.refundedCents)} against ${$(d.grossCents)} in sales.`;
    case 'customer_high_value':
      return lang === 'es' ? `Cliente de alto valor: ${d.name} (${$(d.totalCollectedCents)}).`
        : lang === 'pt' ? `Cliente de alto valor: ${d.name} (${$(d.totalCollectedCents)}).`
        : `High-value customer: ${d.name} (${$(d.totalCollectedCents)}).`;
    case 'customer_frequent':
      return lang === 'es' ? `Cliente frecuente: ${d.name}.` : lang === 'pt' ? `Cliente frequente: ${d.name}.` : `Frequent customer: ${d.name}.`;
    case 'customer_returning_after_absence':
      return lang === 'es' ? `${d.name} volvió después de ${d.absenceDays} días.`
        : lang === 'pt' ? `${d.name} voltou depois de ${d.absenceDays} dias.`
        : `${d.name} returned after ${d.absenceDays} days.`;
    case 'customer_declining':
      return lang === 'es' ? `${d.name} está espaciando sus visitas (${d.daysSinceLastVisit} días sin venir).`
        : lang === 'pt' ? `${d.name} está espaçando as visitas (${d.daysSinceLastVisit} dias sem vir).`
        : `${d.name} is coming in less often (${d.daysSinceLastVisit} days since last visit).`;
    case 'customer_inactive':
      return lang === 'es' ? `${d.name} lleva ${d.daysSinceLastVisit} días sin venir.`
        : lang === 'pt' ? `${d.name} está há ${d.daysSinceLastVisit} dias sem vir.`
        : `${d.name} has not been in for ${d.daysSinceLastVisit} days.`;
    case 'customer_lost':
      return lang === 'es' ? `Cliente perdido: ${d.name} (${d.daysSinceLastVisit} días sin venir).`
        : lang === 'pt' ? `Cliente perdido: ${d.name} (${d.daysSinceLastVisit} dias sem vir).`
        : `Lost customer: ${d.name} (${d.daysSinceLastVisit} days since last visit).`;
    case 'employee_best_revenue':
      return lang === 'es' ? `Mejor en ventas: ${d.employee} (${$(d.value)}).` : lang === 'pt' ? `Melhor em vendas: ${d.employee} (${$(d.value)}).` : `Top revenue: ${d.employee} (${$(d.value)}).`;
    case 'employee_best_profit':
      return lang === 'es' ? `Mejor en ganancia: ${d.employee} (${$(d.value)}).` : lang === 'pt' ? `Melhor em lucro: ${d.employee} (${$(d.value)}).` : `Top profit: ${d.employee} (${$(d.value)}).`;
    case 'employee_best_margin':
      return lang === 'es' ? `Mejor margen: ${d.employee} (${Number(d.value).toFixed(1)}%).` : lang === 'pt' ? `Melhor margem: ${d.employee} (${Number(d.value).toFixed(1)}%).` : `Best margin: ${d.employee} (${Number(d.value).toFixed(1)}%).`;
    case 'employee_most_repairs':
      return lang === 'es' ? `Más reparaciones: ${d.employee} (${d.value}).` : lang === 'pt' ? `Mais reparos: ${d.employee} (${d.value}).` : `Most repairs: ${d.employee} (${d.value}).`;
    case 'employee_most_unlocks':
      return lang === 'es' ? `Más liberaciones: ${d.employee} (${d.value}).` : lang === 'pt' ? `Mais desbloqueios: ${d.employee} (${d.value}).` : `Most unlocks: ${d.employee} (${d.value}).`;
    case 'employee_highest_avg_ticket':
      return lang === 'es' ? `Ticket promedio más alto: ${d.employee} (${$(d.value)}).` : lang === 'pt' ? `Maior ticket médio: ${d.employee} (${$(d.value)}).` : `Highest average ticket: ${d.employee} (${$(d.value)}).`;
    case 'employee_attribution_incomplete':
      return lang === 'es' ? 'Hay servicios completados sin empleado asignado — el desglose por empleado no está disponible.'
        : lang === 'pt' ? 'Há serviços concluídos sem funcionário atribuído — o detalhamento por funcionário não está disponível.'
        : 'Some completed services have no employee attribution — per-employee breakdown is unavailable.';
    case 'carrier_fastest_growing':
      return lang === 'es' ? `${d.carrier} es la compañía que más crece (+${$(d.value)}).` : lang === 'pt' ? `${d.carrier} é a operadora que mais cresce (+${$(d.value)}).` : `${d.carrier} is the fastest-growing carrier (+${$(d.value)}).`;
    case 'carrier_declining':
      return lang === 'es' ? `${d.carrier} está cayendo (−${$(Math.abs(Number(d.value)))}).` : lang === 'pt' ? `${d.carrier} está caindo (−${$(Math.abs(Number(d.value)))}).` : `${d.carrier} is declining (−${$(Math.abs(Number(d.value)))}).`;
    case 'carrier_highest_profit':
      return lang === 'es' ? `Mayor ganancia por compañía: ${d.carrier} (${$(d.value)}).` : lang === 'pt' ? `Maior lucro por operadora: ${d.carrier} (${$(d.value)}).` : `Highest carrier profit: ${d.carrier} (${$(d.value)}).`;
    case 'carrier_highest_revenue':
      return lang === 'es' ? `Mayor venta por compañía: ${d.carrier} (${$(d.value)}).` : lang === 'pt' ? `Maior venda por operadora: ${d.carrier} (${$(d.value)}).` : `Highest carrier revenue: ${d.carrier} (${$(d.value)}).`;
    case 'carrier_highest_transactions':
      return lang === 'es' ? `Más transacciones por compañía: ${d.carrier} (${d.value}).` : lang === 'pt' ? `Mais transações por operadora: ${d.carrier} (${d.value}).` : `Most carrier transactions: ${d.carrier} (${d.value}).`;
    case 'carrier_attribution_mixed':
      return lang === 'es' ? 'Hay ventas con más de una compañía — el análisis exacto por compañía no está disponible.'
        : lang === 'pt' ? 'Há vendas com mais de uma operadora — a análise exata por operadora não está disponível.'
        : 'Some sales include more than one carrier — exact per-carrier analysis is unavailable.';
    case 'service_growth': {
      const pop = POPULATION_LABELS[String(d.population)]?.[lang] ?? String(d.population);
      return lang === 'es' ? `${pop} creció ${Math.abs(Number(d.changePct)).toFixed(1)}%.` : lang === 'pt' ? `${pop} cresceu ${Math.abs(Number(d.changePct)).toFixed(1)}%.` : `${pop} grew ${Math.abs(Number(d.changePct)).toFixed(1)}%.`;
    }
    case 'service_decline': {
      const pop = POPULATION_LABELS[String(d.population)]?.[lang] ?? String(d.population);
      return lang === 'es' ? `${pop} cayó ${Math.abs(Number(d.changePct)).toFixed(1)}%.` : lang === 'pt' ? `${pop} caiu ${Math.abs(Number(d.changePct)).toFixed(1)}%.` : `${pop} declined ${Math.abs(Number(d.changePct)).toFixed(1)}%.`;
    }
    case 'service_share': {
      const pop = POPULATION_LABELS[String(d.population)]?.[lang] ?? String(d.population);
      return lang === 'es' ? `${pop}: ${Number(d.revenueSharePct).toFixed(1)}% de las ventas.` : lang === 'pt' ? `${pop}: ${Number(d.revenueSharePct).toFixed(1)}% das vendas.` : `${pop}: ${Number(d.revenueSharePct).toFixed(1)}% of sales.`;
    }
    default:
      return '';
  }
}

export function formatFindings(findings: InsightFinding[], lang: L3): string[] {
  return findings.map((f) => formatFinding(f, lang)).filter((t) => t.length > 0);
}
