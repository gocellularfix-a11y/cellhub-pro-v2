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
import type { ActionType } from '../types';
import type { ActionPayload } from '../actions/actionEngine';
import { buildActionPayload } from '../actions/actionEngine';
import { summarizeCustomerHistory } from '../nlg';
import { translations } from '@/i18n/translations';

const COP = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  whatsapp: 'WhatsApp',
  discount: 'Discount',
  bundle:   'Bundle',
  review:   'Review',
  reminder: 'Reminder',
};

// Standalone translation lookup — mirrors useTranslation() logic without
// requiring React context. Used by pure-TS chat handlers.
type Lang3 = 'en' | 'es' | 'pt';
function tChat(lang: Lang3) {
  return (key: string, ...args: any[]): string => {
    const entry = translations[key];
    if (!entry) return key;
    const value = entry[lang] ?? entry.en;
    return typeof value === 'function' ? value(...args) : value;
  };
}

export interface ChatActionUI {
  id: string;
  label: string;
  actionType?: ActionType;
  payload: ActionPayload;
}

export interface ChatResponse {
  text: string;
  kind: 'answer' | 'disambiguation' | 'error' | 'help';
  actions?: ChatActionUI[];
}

export function handleIntent(
  match: IntentMatch,
  engine: IntelligenceEngine,
  lang: Lang3,
): ChatResponse {
  const es = lang === 'es';

  switch (match.id) {
    case 'customer_history':
      return handleCustomerHistory(match, engine, es);

    case 'sales_summary':
      return handleSalesSummary(engine, es);

    case 'inventory_low':
      return handleInventoryLow(engine, lang);

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

    case 'who_to_contact':
      return handleWhoToContact(engine, lang);

    case 'what_hurting_profit':
      return handleWhatHurtingProfit(engine, lang);

    case 'product_opportunities':
      return handleProductOpportunities(engine, lang);

    case 'root_cause':
      return handleRootCause(engine, lang);

    case 'slow_day_root_cause':
      return handleSlowDayRootCause(engine, lang);

    case 'dead_stock_root_cause':
      return handleDeadStockRootCause(engine, lang);

    case 'customer_churn_root_cause':
      return handleChurnRootCause(engine, lang);

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

// ── Inventory low-stock / reorder recommendations ───────────
// R-INTEL-2-REORDER: upgraded from binary alert to full recommendation
// list with suggested qty, priority, and lost-revenue risk.
function handleInventoryLow(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const recs = engine.getReorderRecommendations();

  if (recs.length === 0) {
    return { kind: 'answer', text: t('chat.reorder.empty') };
  }

  const PRIORITY_LABEL: Record<string, string> = {
    CRITICAL: t('chat.reorder.priorityCritical'),
    HIGH:     t('chat.reorder.priorityHigh'),
    MEDIUM:   t('chat.reorder.priorityMedium'),
    LOW:      t('chat.reorder.priorityLow'),
  };

  const lines = recs.slice(0, 8).map(r => {
    const daysRounded = Math.round(r.daysLeft);
    const days = r.daysLeft < 1 ? t('chat.reorder.daysLessThanOne') : t('chat.reorder.days', daysRounded);
    const risk = r.lostRevenueRiskCents > 0
      ? ` ⚠️ ${COP(r.lostRevenueRiskCents)} ${t('chat.reorder.risk')}`
      : '';
    return `${PRIORITY_LABEL[r.priority]} • ${r.name} — ${t('chat.reorder.orderVerb')} ${r.suggestedOrderQty} ${t('chat.reorder.units')} (${days}${risk})`;
  });

  return { kind: 'answer', text: `${t('chat.reorder.header', recs.length)}\n${lines.join('\n')}` };
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

// ── What is hurting profit (R-INTEL-2-MISSED) ───────────────
const DAY_NAMES_LOCALIZED: Record<Lang3, Record<string, string>> = {
  en: {},
  es: { Sunday: 'Domingo', Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves', Friday: 'Viernes', Saturday: 'Sábado' },
  pt: { Sunday: 'Domingo', Monday: 'Segunda', Tuesday: 'Terça', Wednesday: 'Quarta', Thursday: 'Quinta', Friday: 'Sexta', Saturday: 'Sábado' },
};

// R-INTEL-PHASE2B-FIX: numeric-indexed DOW names (0=Sunday…6=Saturday).
// Used by handleSlowDayRootCause so localization is not dependent on
// string-matching the English day name from the report.
const DAY_NAMES_BY_INDEX: Record<Lang3, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  es: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  pt: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
};

function handleWhatHurtingProfit(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getMissedRevenue();

  const losses: Array<{ label: string; cents: number; note: string }> = [];

  if (report.deadStockLockedCents > 0) {
    losses.push({
      label: t('chat.missed.deadStock.label'),
      cents: report.deadStockLockedCents,
      note: t('chat.missed.deadStock.note', COP(report.opportunityCostCents)),
    });
  }

  if (report.slowDayLossCents > 0) {
    const localDay = DAY_NAMES_LOCALIZED[lang][report.slowestDayName] ?? report.slowestDayName;
    losses.push({
      label: t('chat.missed.slowDay.label', localDay),
      cents: report.slowDayLossCents,
      note: t('chat.missed.slowDay.note'),
    });
  }

  if (report.slowHourLossCents > 0) {
    losses.push({
      label: t('chat.missed.offPeak.label'),
      cents: report.slowHourLossCents,
      note: t('chat.missed.offPeak.note'),
    });
  }

  if (losses.length === 0) {
    return { kind: 'answer', text: t('chat.missed.empty') };
  }

  losses.sort((a, b) => b.cents - a.cents);

  const lines = losses.map((l, i) =>
    `${i + 1}. ${l.label}: ${COP(l.cents)}\n   ${l.note}`,
  );

  return { kind: 'answer', text: `${t('chat.missed.header')}\n\n${lines.join('\n\n')}` };
}

// ── Who to contact (R-INTEL-2-CONTACT) ─────────────────────
function handleWhoToContact(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const predictions = engine.getNextVisitPredictions(10);

  if (predictions.length === 0) {
    return { kind: 'answer', text: t('chat.contact.empty') };
  }

  const lines = predictions.map(p => {
    const phone = p.phone ? ` · ${p.phone}` : '';
    const overdue = p.overdueByDays === 1
      ? t('chat.contact.daySingular')
      : t('chat.contact.dayPlural', p.overdueByDays);
    const msg = t('chat.contact.message', p.name.split(' ')[0], p.overdueByDays);
    return `• ${p.name}${phone} — ${t('chat.contact.overdue')} ${overdue}\n  ${msg}`;
  });

  return { kind: 'answer', text: `${t('chat.contact.header', predictions.length)}\n\n${lines.join('\n\n')}` };
}

// ── Product opportunities (R-INTEL-2-PRODUCT) ───────────────
function handleProductOpportunities(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const opps = engine.getProductOpportunities();

  if (opps.length === 0) {
    return { kind: 'answer', text: t('chat.product.empty') };
  }

  const TYPE_LABEL: Record<string, string> = {
    HIGH_MARGIN: t('chat.product.type.highMargin'),
    LOW_MARGIN:  t('chat.product.type.lowMargin'),
    DEAD_STOCK:  t('chat.product.type.deadStock'),
    HIGH_RETURN: t('chat.product.type.highReturn'),
  };

  const ACTION_LABEL: Record<string, string> = {
    PROMOTE:  t('chat.product.action.promote'),
    DISCOUNT: t('chat.product.action.discount'),
    BUNDLE:   t('chat.product.action.bundle'),
    REVIEW:   t('chat.product.action.review'),
  };

  const lines = opps.slice(0, 8).map(o => {
    const margin = o.marginPct > 0 ? ` · ${o.marginPct.toFixed(1)}% ${t('chat.product.margin')}` : '';
    const impact = o.impactCents > 0 ? ` · ${COP(o.impactCents)} ${t('chat.product.impact')}` : '';
    return `• ${o.name} [${TYPE_LABEL[o.type]}] → ${ACTION_LABEL[o.action]}${margin}${impact}`;
  });

  return { kind: 'answer', text: `${t('chat.product.header', opps.length)}\n${lines.join('\n')}` };
}

// ── Dead stock root cause (R-INTEL-PHASE2C-RC) ─────────────
function handleDeadStockRootCause(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const reports = engine.getDeadStockRootCause();

  if (reports.length === 0) {
    return { kind: 'answer', text: t('chat.deadStock.empty') };
  }

  const DIAG_KEY: Record<string, string> = {
    no_demand:      'chat.deadStock.diagNoDemand',
    low_visibility: 'chat.deadStock.diagLowVisibility',
    pricing_issue:  'chat.deadStock.diagPricing',
    mixed:          'chat.deadStock.diagMixed',
  };

  const top = reports.slice(0, 5);
  const header = t('chat.deadStock.header', top.length);

  const sections = top.map((r, i) => {
    const lines: string[] = [];
    lines.push(`${i + 1}. ${r.name}`);
    lines.push(t(DIAG_KEY[r.diagnosis]));
    lines.push(t('chat.deadStock.evidence.days', r.daysWithoutSale));
    lines.push(t('chat.deadStock.evidence.velocity', Number(r.avgWeeklySales.toFixed(1))));
    lines.push(t('chat.deadStock.evidence.stock', r.stockUnits));
    lines.push(t('chat.rootCause.confidence', Math.round(r.confidence * 100)));
    lines.push(t('chat.rootCause.actionsHeader'));
    r.actions.forEach((a, ai) => lines.push(`  ${ai + 1}. ${t(a.labelKey)}${a.actionType ? ` → [${ACTION_TYPE_LABEL[a.actionType] ?? a.actionType}]` : ''}`));
    return lines.join('\n');
  });

  const actionUI: ChatActionUI[] = top.flatMap((r, ri) =>
    r.actions.map((a, ai) => ({
      id: `dead-${ri}-${ai}-${a.labelKey}`,
      label: `${r.name}: ${t(a.labelKey)}`,
      actionType: a.actionType,
      payload: buildActionPayload(
        { ...a, sku: a.sku ?? r.sku },
        { sku: r.sku },
      ),
    }))
  ).slice(0, 10);

  return { kind: 'answer', text: `${header}\n\n${sections.join('\n\n')}`, actions: actionUI };
}

// ── Slow day root cause (R-INTEL-PHASE2B-RC) ───────────────
function handleSlowDayRootCause(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getSlowDayRootCause();

  if (!report) {
    return { kind: 'answer', text: t('chat.slowRoot.notEnoughData') };
  }

  const localDay  = DAY_NAMES_BY_INDEX[lang][report.slowestDayIndex] ?? report.slowestDayName;
  const localBest = DAY_NAMES_BY_INDEX[lang][report.bestDayIndex]    ?? report.bestDayName;

  const DIAG_KEY: Record<string, string> = {
    traffic: 'chat.slowRoot.diagTraffic',
    ticket:  'chat.slowRoot.diagTicket',
    mixed:   'chat.slowRoot.diagMixed',
  };

  const lines: string[] = [];
  lines.push(t('chat.slowRoot.header', localDay));
  lines.push('');
  lines.push(t(DIAG_KEY[report.diagnosis], localDay));
  lines.push('');
  lines.push(t('chat.slowRoot.evidence.revGap',
    COP(report.weeklyGapCents), COP(report.slowDayRevenueCents), localBest, COP(report.bestDayRevenueCents)));

  if (report.txDiffPct >= 5) {
    lines.push(t('chat.slowRoot.evidence.txDiff',
      report.txDiffPct, report.slowDayTxCount, report.bestDayTxCount));
  } else {
    lines.push(t('chat.slowRoot.evidence.txSimilar', report.slowDayTxCount));
  }

  if (report.ticketDiffPct >= 5) {
    lines.push(t('chat.slowRoot.evidence.ticketDiff',
      report.ticketDiffPct,
      COP(report.slowDayAvgTicketCents), COP(report.bestDayAvgTicketCents)));
  } else {
    lines.push(t('chat.slowRoot.evidence.ticketSimilar', COP(report.slowDayAvgTicketCents)));
  }

  lines.push('');
  lines.push(t('chat.rootCause.confidence', Math.round(report.confidence * 100)));
  lines.push('');
  lines.push(t('chat.rootCause.actionsHeader'));
  report.actions.forEach((a, i) => {
    lines.push(`${i + 1}. ${t(a.labelKey)}${a.actionType ? ` → [${ACTION_TYPE_LABEL[a.actionType] ?? a.actionType}]` : ''}`);
  });

  const actionUI: ChatActionUI[] = report.actions.map((a, i) => ({
    id: `slow-${i}-${a.labelKey}`,
    label: t(a.labelKey),
    actionType: a.actionType,
    payload: buildActionPayload(a, {}),
  }));

  return { kind: 'answer', text: lines.join('\n'), actions: actionUI };
}

// ── Revenue decline root cause (R-INTEL-PHASE2-RC) ─────────
function handleRootCause(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const report = engine.getRevenueRootCause();

  if (!report) {
    return { kind: 'answer', text: t('chat.rootCause.notDown') };
  }

  const DIAG_KEY: Record<string, string> = {
    traffic: 'chat.rootCause.diagTraffic',
    ticket:  'chat.rootCause.diagTicket',
    both:    'chat.rootCause.diagBoth',
  };

  const lines: string[] = [];
  lines.push(t('chat.rootCause.header'));
  lines.push('');
  lines.push(t(DIAG_KEY[report.diagnosis]));
  lines.push('');
  lines.push(t('chat.rootCause.evidence.revDrop',
    COP(report.revDropCents), COP(report.revCurrentCents), COP(report.revPreviousCents)));

  if (report.txDropPct >= 5) {
    lines.push(t('chat.rootCause.evidence.txDrop',
      report.txDropPct, report.txCurrent, report.txPrevious));
  } else {
    lines.push(t('chat.rootCause.evidence.txStable', report.txCurrent));
  }

  if (report.ticketDropPct >= 5) {
    lines.push(t('chat.rootCause.evidence.ticketDrop',
      report.ticketDropPct,
      COP(report.avgTicketCurrentCents), COP(report.avgTicketPreviousCents)));
  } else {
    lines.push(t('chat.rootCause.evidence.ticketStable', COP(report.avgTicketCurrentCents)));
  }

  lines.push('');
  lines.push(t('chat.rootCause.confidence', Math.round(report.confidence * 100)));
  lines.push('');
  lines.push(t('chat.rootCause.actionsHeader'));
  report.actions.forEach((a, i) => {
    lines.push(`${i + 1}. ${t(a.labelKey)}${a.actionType ? ` → [${ACTION_TYPE_LABEL[a.actionType] ?? a.actionType}]` : ''}`);
  });

  const actionUI: ChatActionUI[] = report.actions.map((a, i) => ({
    id: `revenue-${i}-${a.labelKey}`,
    label: t(a.labelKey),
    actionType: a.actionType,
    payload: buildActionPayload(a, {}),
  }));

  return { kind: 'answer', text: lines.join('\n'), actions: actionUI };
}

// ── Customer churn root cause (R-INTEL-PHASE2D-RC) ──────────
function handleChurnRootCause(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const reports = engine.getChurnRootCause().slice(0, 5);

  if (reports.length === 0) {
    return { kind: 'answer', text: t('chat.churn.noChurn') };
  }

  const DIAG_KEY: Record<string, string> = {
    lost_habit:        'chat.churn.diagLostHabit',
    price_sensitivity: 'chat.churn.diagPrice',
    one_time:          'chat.churn.diagOneTime',
    mixed:             'chat.churn.diagMixed',
  };

  const lines: string[] = [];
  lines.push(t('chat.churn.header'));

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    lines.push('');
    lines.push(`${i + 1}. ${r.name}`);
    lines.push(t(DIAG_KEY[r.diagnosis]));
    lines.push(t('chat.churn.evidence.lastVisit', r.lastVisitDaysAgo));
    lines.push(t('chat.churn.evidence.gap', r.avgVisitGapDays));
    lines.push(t('chat.churn.evidence.visits', r.totalVisits));
    lines.push(t('chat.rootCause.confidence', Math.round(r.confidence * 100)));
    lines.push(t('chat.rootCause.actionsHeader'));
    r.actions.forEach((a, ai) => {
      lines.push(`${ai + 1}. ${t(a.labelKey)}${a.actionType ? ` → [${ACTION_TYPE_LABEL[a.actionType] ?? a.actionType}]` : ''}`);
    });
  }

  const actionUI: ChatActionUI[] = reports.flatMap((r, ri) =>
    r.actions.map((a, ai) => ({
      id: `churn-${ri}-${ai}-${a.labelKey}`,
      label: `${r.name}: ${t(a.labelKey)}`,
      actionType: a.actionType,
      payload: buildActionPayload(
        { ...a, customerId: a.customerId ?? r.customerId },
        { customerName: r.name },
      ),
    }))
  ).slice(0, 10);

  return { kind: 'answer', text: lines.join('\n'), actions: actionUI };
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
      '• "a quién llamar" — clientes con visita esperada atrasada',
      '• "por qué bajaron las ventas" — diagnóstico de caída de ingresos',
      '• "por qué el domingo está lento" — diagnóstico de día lento',
      '• "por qué no se vende X" — causa raíz de stock muerto',
      '• "por qué no regresan clientes" — diagnóstico de clientes perdidos',
      '• "qué está afectando mi ganancia" — ingreso perdido por área',
      '• "oportunidades de producto" — promover, descontar o revisar por margen',
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
      '• "who should I contact" — customers with overdue expected visit',
      '• "why are sales down" — revenue decline diagnosis',
      '• "why is Sunday slow" — slow day diagnosis',
      '• "dead stock reason" — dead stock root cause diagnosis',
      '• "why customers stopped coming" — churn root cause diagnosis',
      '• "what is hurting my profit" — missed revenue by area',
      '• "product opportunities" — items to promote, discount, or review by margin',
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
