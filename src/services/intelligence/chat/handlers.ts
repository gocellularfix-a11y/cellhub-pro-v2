// ============================================================
// CellHub Intelligence — Chat Intent Handlers
// R-INTEL-CHAT-F5
//
// Per-intent response builders. Each handler receives an engine +
// match + lang and returns a markdown-ish string for display.
// Reuses summarizeDashboard / summarizeCustomerHistory from nlg.ts
// so chat responses have the same prose style as the dashboard card.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { IntentMatch } from './intentRouter';
import { summarizeCustomerHistory } from '../nlg';

const COP = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export interface ChatResponse {
  text: string;
  kind: 'answer' | 'disambiguation' | 'error' | 'help';
}

export function handleIntent(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: 'en' | 'es',
): ChatResponse {
  const es = lang === 'es';

  switch (match.id) {
    case 'customer_history':
      return handleCustomerHistory(match, engine, es);

    case 'sales_summary':
      return handleSalesSummary(engine, es);

    case 'inventory_low':
      return handleInventoryLow(engine, es);

    case 'inventory_dead':
      return handleInventoryDead(engine, es);

    case 'inventory_dying':
      return handleInventoryDying(engine, es);

    case 'top_items':
      return handleTopItems(engine, es);

    case 'repairs_overdue':
      return handleRepairsOverdue(engine, es);

    case 'health_check':
      return handleHealthCheck(engine, es);

    case 'forecast_items':
      return handleForecastItems(engine, es);

    case 'anomaly_days':
      return handleAnomalyDays(engine, es);

    case 'help':
      return handleHelp(es);

    case 'unknown':
    default:
      return handleUnknown(es);
  }
}

// ── Customer history ────────────────────────────────────────
function handleCustomerHistory(
  match: IntentMatch,
  engine: IntelligenceEngine,
  es: boolean,
): ChatResponse {
  if (match.candidateCustomers && match.candidateCustomers.length > 1) {
    const list = match.candidateCustomers.map((c) => `• ${c.name}${c.phone ? ` (${c.phone})` : ''}`).join('\n');
    return {
      kind: 'disambiguation',
      text: es
        ? `Encontré varios clientes con "${match.extractedName}". ¿Cuál?\n${list}`
        : `I found multiple customers matching "${match.extractedName}". Which one?\n${list}`,
    };
  }

  if (!match.matchedCustomer) {
    return {
      kind: 'error',
      text: es
        ? `No encontré un cliente con ese nombre${match.extractedName ? ` ("${match.extractedName}")` : ''}. Verifica ortografía o usa el teléfono/número de cliente.`
        : `I couldn't find a customer with that name${match.extractedName ? ` ("${match.extractedName}")` : ''}. Check spelling or try phone / customer number.`,
    };
  }

  const history = engine.getCustomerHistory(match.matchedCustomer.id);
  if (!history) {
    return {
      kind: 'error',
      text: es ? 'Error obteniendo historial.' : 'Error fetching history.',
    };
  }

  return {
    kind: 'answer',
    text: summarizeCustomerHistory(history, es ? 'es' : 'en'),
  };
}

// ── Sales summary ───────────────────────────────────────────
function handleSalesSummary(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const kpi = result.kpiDashboard;
  const trendArrow = kpi.revenue.trend === 'up' ? '📈'
    : kpi.revenue.trend === 'down' ? '📉' : '→';
  const topItem = kpi.topItems?.[0];

  const lines: string[] = [];
  lines.push(es
    ? `Ingresos últimos 30 días: ${COP(kpi.revenue.current)} ${trendArrow} ${kpi.revenue.trendPercent >= 0 ? '+' : ''}${kpi.revenue.trendPercent.toFixed(1)}% vs semana pasada.`
    : `Last 30 days revenue: ${COP(kpi.revenue.current)} ${trendArrow} ${kpi.revenue.trendPercent >= 0 ? '+' : ''}${kpi.revenue.trendPercent.toFixed(1)}% vs last week.`);
  lines.push(es
    ? `${kpi.transactions.count} transacciones, ticket promedio ${COP(kpi.transactions.avgSize)}.`
    : `${kpi.transactions.count} transactions, avg ticket ${COP(kpi.transactions.avgSize)}.`);
  if (topItem) {
    lines.push(es
      ? `Top seller: ${topItem.name} (${topItem.quantity} uds, ${COP(topItem.revenue)}).`
      : `Top seller: ${topItem.name} (${topItem.quantity} units, ${COP(topItem.revenue)}).`);
  }
  return { kind: 'answer', text: lines.join('\n') };
}

// ── Inventory low-stock ─────────────────────────────────────
function handleInventoryLow(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const count = result.kpiDashboard.inventory.lowStockCount;
  const insights = result.insights.filter((i) => i.id === 'inventory-reorder');
  const reorder = insights[0];

  if (count === 0) {
    return {
      kind: 'answer',
      text: es ? 'Nada en alerta de reorden. Stock saludable.' : 'Nothing on reorder alert. Stock looks healthy.',
    };
  }

  const data = reorder?.data as { items?: Array<{ name: string; daysLeft: number }> } | undefined;
  const items = data?.items || [];
  const list = items.map(i => `• ${i.name} (${i.daysLeft} ${es ? 'días' : 'days'})`).join('\n');
  return {
    kind: 'answer',
    text: es
      ? `${count} artículos necesitan reorden:\n${list}`
      : `${count} items need reorder:\n${list}`,
  };
}

// ── Inventory dead-stock ────────────────────────────────────
function handleInventoryDead(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const count = result.kpiDashboard.inventory.deadStockCount;
  const insights = result.insights.filter((i) => i.id === 'inventory-dead-stock');
  const dead = insights[0];

  if (count === 0) {
    return {
      kind: 'answer',
      text: es ? 'No hay stock muerto. Todo tu inventario se está moviendo.' : 'No dead stock. All inventory is moving.',
    };
  }

  const data = dead?.data as { items?: Array<{ name: string; qty: number }> } | undefined;
  const items = data?.items?.slice(0, 5) || [];
  const list = items.map(i => `• ${i.name} (${i.qty} uds)`).join('\n');
  return {
    kind: 'answer',
    text: es
      ? `${count} artículos con stock muerto (sin ventas en 60+ días):\n${list}\n\nConsidera precios de liquidación.`
      : `${count} items in dead stock (no sales 60+ days):\n${list}\n\nConsider clearance pricing.`,
  };
}

// ── Inventory dying (velocity-based F2) ─────────────────────
function handleInventoryDying(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const dying = result.insights.find((i) => i.id === 'inventory-dying-stock');

  if (!dying) {
    return {
      kind: 'answer',
      text: es ? 'No hay artículos perdiendo velocidad significativa.' : 'No items losing significant momentum.',
    };
  }

  const data = dying.data as {
    items?: Array<{ name: string; velocity: number; salesLastWindow: number }>
  } | undefined;
  const items = data?.items?.slice(0, 5) || [];
  const list = items
    .map((i) => `• ${i.name} (velocity ${(i.velocity * 100).toFixed(0)}%, ${i.salesLastWindow} uds últimos 90d)`)
    .join('\n');

  return {
    kind: 'answer',
    text: es
      ? `Artículos perdiendo velocidad:\n${list}\n\nActúa antes de que caigan muertos.`
      : `Items losing momentum:\n${list}\n\nAct before they go fully dead.`,
  };
}

// ── Top items ───────────────────────────────────────────────
function handleTopItems(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const top = result.kpiDashboard.topItems || [];
  if (top.length === 0) {
    return { kind: 'answer', text: es ? 'Sin datos de ventas todavía.' : 'No sales data yet.' };
  }
  const list = top
    .slice(0, 5)
    .map((t, idx) => `${idx + 1}. ${t.name} — ${t.quantity} uds, ${COP(t.revenue)}`)
    .join('\n');
  return {
    kind: 'answer',
    text: es ? `Tus top 5 artículos (últimos 30 días):\n${list}` : `Your top 5 items (last 30 days):\n${list}`,
  };
}

// ── Repairs overdue ─────────────────────────────────────────
function handleRepairsOverdue(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const overdue = result.kpiDashboard.repairs.overdue;
  const pending = result.kpiDashboard.repairs.pending;
  if (overdue === 0) {
    return {
      kind: 'answer',
      text: es
        ? `Sin reparaciones atrasadas. ${pending} completadas recientemente.`
        : `No overdue repairs. ${pending} completed recently.`,
    };
  }
  return {
    kind: 'answer',
    text: es
      ? `🔧 ${overdue} reparaciones atrasadas (>7 días sin completar). Ve al módulo Repairs para revisarlas.`
      : `🔧 ${overdue} overdue repairs (>7 days without completion). Check the Repairs module to follow up.`,
  };
}

// ── Health check ────────────────────────────────────────────
function handleHealthCheck(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const h = result.healthScore;
  const factors = h.factors.length > 0
    ? `\n\n${es ? 'Factores' : 'Factors'}: ${h.factors.join(', ')}.`
    : '';
  return {
    kind: 'answer',
    text: es
      ? `Salud de la tienda: ${h.grade} (${h.score}/100).${factors}`
      : `Store health: ${h.grade} (${h.score}/100).${factors}`,
  };
}

// ── Forecast items ──────────────────────────────────────────
function handleForecastItems(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const forecasts = result.insights.filter((i) => i.id.startsWith('sales-forecast-'));
  if (forecasts.length === 0) {
    return {
      kind: 'answer',
      text: es
        ? 'Sin señales de proyección confiables (necesita >=14 días de ventas por SKU).'
        : 'No reliable forecast signals (need >=14 days of sales per SKU).',
    };
  }
  const lines = forecasts.slice(0, 5).map((f) => `• ${es ? f.descriptionEs : f.description}`).join('\n');
  return {
    kind: 'answer',
    text: es ? `Proyecciones activas:\n${lines}` : `Active forecasts:\n${lines}`,
  };
}

// ── Anomaly days ────────────────────────────────────────────
function handleAnomalyDays(engine: IntelligenceEngine, es: boolean): ChatResponse {
  const result = engine.refresh();
  const anomalies = result.insights.filter((i) => i.id.startsWith('financial-anomaly-'));
  if (anomalies.length === 0) {
    return {
      kind: 'answer',
      text: es
        ? 'Sin anomalías en los últimos 30 días. Ingresos dentro del rango normal.'
        : 'No anomalies in the last 30 days. Revenue within normal range.',
    };
  }
  const lines = anomalies.slice(0, 5).map((a) => `• ${es ? a.descriptionEs : a.description}`).join('\n');
  return {
    kind: 'answer',
    text: es ? `Días fuera de lo normal:\n${lines}` : `Unusual days:\n${lines}`,
  };
}

// ── Help ────────────────────────────────────────────────────
function handleHelp(es: boolean): ChatResponse {
  const items = es
    ? [
      '• "historial de <nombre>" — historial completo de un cliente',
      '• "cómo van las ventas" — resumen de ventas',
      '• "qué me falta" — stock bajo / reorden',
      '• "qué no se vende" — dead stock',
      '• "qué está perdiendo velocidad" — dying stock',
      '• "qué vendo más" — top items',
      '• "reparaciones atrasadas" — overdue repairs',
      '• "cómo está la tienda" — health score',
      '• "proyecciones" — forecast por SKU',
      '• "días raros" / "anomalías" — cash-flow anomalies',
    ]
    : [
      '• "history of <name>" — full customer history',
      '• "how are sales" — sales summary',
      '• "what do I need" — low stock / reorder',
      '• "what is not selling" — dead stock',
      '• "what is losing momentum" — dying stock',
      '• "top items" — best sellers',
      '• "overdue repairs" — overdue repairs',
      '• "store health" — health score',
      '• "forecasts" — per-SKU demand projection',
      '• "anomalies" — unusual revenue days',
    ];
  return {
    kind: 'help',
    text: (es ? 'Puedo responder:\n' : 'I can answer:\n') + items.join('\n'),
  };
}

// ── Unknown fallback ────────────────────────────────────────
function handleUnknown(es: boolean): ChatResponse {
  return {
    kind: 'help',
    text: es
      ? 'No entendí tu pregunta. Escribe "ayuda" para ver lo que puedo responder.'
      : 'I didn\'t understand. Type "help" to see what I can answer.',
  };
}
