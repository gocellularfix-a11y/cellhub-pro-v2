// ============================================================
// CellHub Intelligence — Natural Language Generator
// R-INTEL-NLG-F4
//
// Composes analyzer outputs into human-readable sentences. Template
// grammar only — NO LLM. Bilingual (en/es). Deterministic, so the
// same dashboard state always yields the same prose.
//
// Used by:
//   - IntelligenceDashboard summary section (headline bullets)
//   - R-INTEL-CHAT-F5 template responses for common queries
// ============================================================

import type { EngineResult } from './IntelligenceEngine';
import type { CustomerHistorySummary } from './types';

const COP = (cents: number): string =>
  `$${(cents / 100).toFixed(2)}`;

// ── Dashboard-level summary ─────────────────────────────────
export interface NlgSummary {
  headline: string;       // single-sentence tl;dr
  bullets: string[];      // 3–6 supporting lines
  tone: 'positive' | 'neutral' | 'warning' | 'critical';
}

export function summarizeDashboard(
  result: EngineResult,
  lang: 'en' | 'es' | 'pt' = 'en',
): NlgSummary {
  const es = lang === 'es';
  const pt = lang === 'pt';
  const { healthScore, kpiDashboard, insights } = result;
  const bullets: string[] = [];

  const revenueTrendArrow = kpiDashboard.revenue.trend === 'up' ? '📈'
    : kpiDashboard.revenue.trend === 'down' ? '📉' : '→';

  // ── Headline — built from health grade + revenue trend ──
  let tone: NlgSummary['tone'] = 'neutral';
  if (healthScore.grade === 'A') tone = 'positive';
  else if (healthScore.grade === 'D' || healthScore.grade === 'F') tone = 'critical';
  else if (insights.some(i => i.severity === 'critical')) tone = 'critical';
  else if (insights.some(i => i.severity === 'warning')) tone = 'warning';

  const headline = es
    ? `Salud ${healthScore.grade} (${healthScore.score}/100). Ingresos ${COP(kpiDashboard.revenue.current)} ${revenueTrendArrow} ${kpiDashboard.revenue.trendPercent > 0 ? '+' : ''}${kpiDashboard.revenue.trendPercent.toFixed(1)}% vs semana pasada.`
    : pt
    ? `Saúde ${healthScore.grade} (${healthScore.score}/100). Receita ${COP(kpiDashboard.revenue.current)} ${revenueTrendArrow} ${kpiDashboard.revenue.trendPercent > 0 ? '+' : ''}${kpiDashboard.revenue.trendPercent.toFixed(1)}% vs semana passada.`
    : `Health ${healthScore.grade} (${healthScore.score}/100). Revenue ${COP(kpiDashboard.revenue.current)} ${revenueTrendArrow} ${kpiDashboard.revenue.trendPercent > 0 ? '+' : ''}${kpiDashboard.revenue.trendPercent.toFixed(1)}% vs last week.`;

  // ── Revenue context bullet ──
  if (kpiDashboard.transactions.count > 0) {
    bullets.push(es
      ? `${kpiDashboard.transactions.count} transacciones, ticket promedio ${COP(kpiDashboard.transactions.avgSize)}.`
      : pt
      ? `${kpiDashboard.transactions.count} transações, ticket médio ${COP(kpiDashboard.transactions.avgSize)}.`
      : `${kpiDashboard.transactions.count} transactions, avg ticket ${COP(kpiDashboard.transactions.avgSize)}.`);
  }

  // ── Top seller bullet ──
  const topItem = kpiDashboard.topItems?.[0];
  if (topItem) {
    bullets.push(es
      ? `Top seller: ${topItem.name} (${topItem.quantity} uds, ${COP(topItem.revenue)}).`
      : pt
      ? `Mais vendido: ${topItem.name} (${topItem.quantity} un, ${COP(topItem.revenue)}).`
      : `Top seller: ${topItem.name} (${topItem.quantity} units, ${COP(topItem.revenue)}).`);
  }

  // ── Slowest day bullet ──
  const slowest = kpiDashboard.slowDays?.[0];
  if (slowest && slowest.revenue >= 0) {
    const DAY_ES: Record<string, string> = { Sunday: 'Domingo', Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves', Friday: 'Viernes', Saturday: 'Sábado' };
    const DAY_PT: Record<string, string> = { Sunday: 'Domingo', Monday: 'Segunda', Tuesday: 'Terça', Wednesday: 'Quarta', Thursday: 'Quinta', Friday: 'Sexta', Saturday: 'Sábado' };
    const dayName = es ? (DAY_ES[slowest.day] ?? slowest.day) : pt ? (DAY_PT[slowest.day] ?? slowest.day) : slowest.day;
    bullets.push(es
      ? `Día más lento: ${dayName} (${COP(slowest.revenue)}).`
      : pt
      ? `Dia mais lento: ${dayName} (${COP(slowest.revenue)}).`
      : `Slowest day: ${dayName} (${COP(slowest.revenue)}).`);
  }

  // ── Inventory bullets — dead/low stock + dying ──
  if (kpiDashboard.inventory.deadStockCount > 0) {
    bullets.push(es
      ? `⚠️ ${kpiDashboard.inventory.deadStockCount} artículos con stock muerto.`
      : pt
      ? `⚠️ ${kpiDashboard.inventory.deadStockCount} itens em estoque parado.`
      : `⚠️ ${kpiDashboard.inventory.deadStockCount} items in dead stock.`);
  }
  if (kpiDashboard.inventory.lowStockCount > 0) {
    bullets.push(es
      ? `${kpiDashboard.inventory.lowStockCount} artículos necesitan reorden.`
      : pt
      ? `${kpiDashboard.inventory.lowStockCount} itens precisam de reposição.`
      : `${kpiDashboard.inventory.lowStockCount} items need reorder.`);
  }

  // ── Repairs bullets ──
  if (kpiDashboard.repairs.overdue > 0) {
    bullets.push(es
      ? `🔧 ${kpiDashboard.repairs.overdue} reparaciones atrasadas.`
      : pt
      ? `🔧 ${kpiDashboard.repairs.overdue} reparos atrasados.`
      : `🔧 ${kpiDashboard.repairs.overdue} overdue repairs.`);
  }

  // ── Customer bullet ──
  if (kpiDashboard.customers.new > 0) {
    bullets.push(es
      ? `${kpiDashboard.customers.new} clientes nuevos este período.`
      : pt
      ? `${kpiDashboard.customers.new} novos clientes neste período.`
      : `${kpiDashboard.customers.new} new customers this period.`);
  }

  // ── Critical insight escalation ──
  const firstCritical = insights.find(i => i.severity === 'critical');
  if (firstCritical) {
    const msg = es ? firstCritical.descriptionEs : firstCritical.description;
    bullets.push(`🔴 ${msg}`);
  }

  // Cap at 6 bullets max (dashboard readability).
  return {
    headline,
    bullets: bullets.slice(0, 6),
    tone,
  };
}

// ── Customer history sentence ───────────────────────────────
// Used by the customer lookup card footer + chat "historial de X"
// intent response.
export function summarizeCustomerHistory(
  h: CustomerHistorySummary,
  lang: 'en' | 'es' | 'pt' = 'en',
): string {
  const es = lang === 'es';
  const pt = lang === 'pt';
  const name = h.customer.name;

  if (h.visitCount === 0) {
    return es
      ? `${name} está en tu lista de clientes pero no tiene ventas registradas todavía.`
      : pt
      ? `${name} está na sua lista de clientes mas ainda não tem vendas registradas.`
      : `${name} is in your customer list but has no recorded sales yet.`;
  }

  const cadence = h.avgDaysBetweenVisits !== null
    ? (es
      ? ` Viene aproximadamente cada ${h.avgDaysBetweenVisits} días.`
      : pt
      ? ` Visita aproximadamente a cada ${h.avgDaysBetweenVisits} dias.`
      : ` Visits roughly every ${h.avgDaysBetweenVisits} days.`)
    : '';

  const topItem = h.topItems[0];
  const topItemPart = topItem
    ? (es
      ? ` Lo que más compra: ${topItem.name} (${topItem.quantity} veces).`
      : pt
      ? ` O que mais compra: ${topItem.name} (${topItem.quantity}x).`
      : ` Buys most: ${topItem.name} (${topItem.quantity}x).`)
    : '';

  const balancePart = h.linkedEntities.activeBalance > 0
    ? (es
      ? ` 💰 Tiene un balance pendiente de ${COP(h.linkedEntities.activeBalance)}.`
      : pt
      ? ` 💰 Tem um saldo pendente de ${COP(h.linkedEntities.activeBalance)}.`
      : ` 💰 Has an outstanding balance of ${COP(h.linkedEntities.activeBalance)}.`)
    : '';

  const coverageWarn = h.costCoverage < 0.5
    ? (es
      ? ` (Profit aproximado — sólo ${Math.round(h.costCoverage * 100)}% de ventas con cost registrado.)`
      : pt
      ? ` (Lucro aproximado — apenas ${Math.round(h.costCoverage * 100)}% das vendas têm custo registrado.)`
      : ` (Approximate profit — only ${Math.round(h.costCoverage * 100)}% of sales have cost recorded.)`)
    : '';

  return es
    ? `${name} tiene ${h.visitCount} transacción${h.visitCount === 1 ? '' : 'es'} por un total de ${COP(h.netRevenue)}, generando ${COP(h.profit)} de profit (${h.margin.toFixed(1)}% margen). Ticket promedio ${COP(h.avgTicket)}.${cadence}${topItemPart}${balancePart}${coverageWarn}`
    : pt
    ? `${name} tem ${h.visitCount} transaç${h.visitCount === 1 ? 'ão' : 'ões'} totalizando ${COP(h.netRevenue)}, gerando ${COP(h.profit)} de lucro (${h.margin.toFixed(1)}% margem). Ticket médio ${COP(h.avgTicket)}.${cadence}${topItemPart}${balancePart}${coverageWarn}`
    : `${name} has ${h.visitCount} transaction${h.visitCount === 1 ? '' : 's'} totaling ${COP(h.netRevenue)}, generating ${COP(h.profit)} profit (${h.margin.toFixed(1)}% margin). Avg ticket ${COP(h.avgTicket)}.${cadence}${topItemPart}${balancePart}${coverageWarn}`;
}
