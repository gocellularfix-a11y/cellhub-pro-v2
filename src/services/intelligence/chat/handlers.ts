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
import type { ActionType, ActionQueueItem } from '../types';
import type { ActionPayload } from '../actions/actionEngine';
import { buildActionPayload } from '../actions/actionEngine';
import { summarizeCustomerHistory } from '../nlg';
import { translations } from '@/i18n/translations';
// R-INTEL-AUTO-ACTION-QUEUE-ARCH-FIX: queue creation moved here from
// engine.refresh() — only handleWhoToContactToday triggers the queue.
import { enqueueOutreachActions } from '../actions';
// R-INTEL-CELLHUB-DATA-ACCESS-LAYER: universal data_query intent reads
// engine arrays via read-only getters and routes through the data
// access layer for deterministic operational answers.
import {
  getSalesSummary, getInventorySummary, getLowStockItems, getDeadStockItems,
  getCustomerSummary, getTopCustomers, getInactiveCustomers,
  getRepairSummary, getReadyRepairs,
  getUnlockSummary, getLayawaySummary, getPendingLayaways,
  getPhonePaymentSummary, getSpecialOrderSummary, getReturnSummary,
  getExpenseSummary,
  type DateRange,
} from '../dataAccess/cellhubDataAccess';

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
    case 'best_customer':
      return handleBestCustomer(engine, lang);

    case 'least_profitable_customers':
      return handleLeastProfitable(engine, lang);

    case 'multi_phone_customers':
      return handleMultiPhoneCustomers(engine, lang);

    case 'customer_history':
      return handleCustomerHistory(match, engine, es);

    case 'daily_brief':
      return handleDailyBrief(engine, lang);

    case 'today_summary':
      return handleTodaySummary(engine, lang);

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

    case 'who_to_contact_today':
      return handleWhoToContactToday(engine, lang);

    case 'marketing_campaign':
      return handleMarketingCampaign(engine, lang);

    case 'product_push':
      return handleProductPush(match, engine, lang);

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

    case 'data_query':
      return handleDataQuery(match, engine, lang);

    case 'fallback_question':
      return handleFallbackQuestion(match, engine, lang);

    case 'unknown':
    default:
      return handleUnknown(es);
  }
}

// ── Best customer ───────────────────────────────────────────
function handleBestCustomer(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const result = engine.refresh();
  const scores = result.customerScores;

  if (scores.length === 0) {
    return { kind: 'answer', text: t('chat.bestCustomer.empty') };
  }

  const top = scores.slice().sort((a, b) => b.score - a.score)[0];
  const history = engine.getCustomerHistory(top.customerId);

  if (!history) {
    return { kind: 'answer', text: t('chat.bestCustomer.empty') };
  }

  const lastDays = history.lastVisit
    ? Math.floor((Date.now() - history.lastVisit.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const summary = t('chat.bestCustomer.summary',
    history.customer.name,
    COP(history.grossRevenue),
    history.visitCount,
    lastDays,
  );

  return {
    kind: 'answer',
    text: `${t('chat.bestCustomer.header')}\n\n${summary}\n\n${t('chat.bestCustomer.recommendation')}`,
  };
}

// ── Least profitable customers (R-INTENT-LEAST-PROFITABLE) ──
// Bottom-3 ranked by profit ASC. Eligibility filters protect against
// shaming low-data customers: visitCount ≥ 2, grossRevenue ≥ $50,
// costCoverage ≥ 0.5. Approximate-tag shown when costCoverage < 0.7.
// Refund-rate note when refund/gross > 20%. Read-only — no queue writes.
function handleLeastProfitable(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const customers = engine.getCustomers();

  const results = [];
  for (const c of customers) {
    const h = engine.getCustomerHistory(c.id);
    if (!h) continue;
    if (h.visitCount < 2) continue;
    if (h.grossRevenue < 5000) continue;
    if (h.costCoverage < 0.5) continue;
    results.push(h);
  }

  if (results.length === 0) {
    return { kind: 'answer', text: t('chat.leastProfitable.empty') };
  }

  results.sort((a, b) => a.profit - b.profit);
  const top = results.slice(0, 3);

  const lines: string[] = [];
  lines.push(t('chat.leastProfitable.header'));

  for (const h of top) {
    lines.push(t('chat.leastProfitable.row',
      h.customer.name,
      COP(h.profit),
      h.visitCount,
      COP(h.avgTicket),
    ));
    if (h.costCoverage < 0.7) {
      lines.push(t('chat.leastProfitable.approximate'));
    }
    const ratio = h.grossRevenue > 0 ? h.totalRefunded / h.grossRevenue : 0;
    if (ratio > 0.2) {
      lines.push(t('chat.leastProfitable.refundWarning', Math.round(ratio * 100)));
    }
  }

  lines.push(t('chat.leastProfitable.recommendation'));

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Multi-phone customers (R-INTEL-MULTI-PHONE-CUSTOMERS) ──
// Deterministic exact count of customers carrying more than one phone
// number. Pure pass-through to engine.countMultiPhoneCustomers() — no
// queue, no campaigns, no fallback, no approximations. Inline EN/ES/PT
// strings (spec did not list translations.ts; this is a single-line
// answer with simple plural/singular grammar).
function handleMultiPhoneCustomers(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const count = engine.countMultiPhoneCustomers();

  type Lines = { count: (n: number) => string; none: string };
  const tables: Record<Lang3, Lines> = {
    en: {
      count: (n) => `${n} customer${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} more than one phone number.`,
      none: 'No customers have multiple phone numbers.',
    },
    es: {
      count: (n) => `${n} cliente${n === 1 ? '' : 's'} ${n === 1 ? 'tiene' : 'tienen'} más de un número de teléfono.`,
      none: 'Ningún cliente tiene múltiples números de teléfono.',
    },
    pt: {
      count: (n) => `${n} cliente${n === 1 ? '' : 's'} ${n === 1 ? 'tem' : 'têm'} mais de um número de telefone.`,
      none: 'Nenhum cliente tem múltiplos números de telefone.',
    },
  };
  const lines = tables[lang] ?? tables.en;
  const text = count === 0 ? lines.none : lines.count(count);

  return { kind: 'answer', text };
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

// ── Today summary (R-INTELLIGENCE-CHAT-TODAY-UX-TWEAK) ─────
// Module-level timestamp for the "no major change since last check"
// compact follow-up. Within a single chat session, repeated today queries
// inside the follow-up window get the compact variant. Resets on process
// restart — acceptable for a UX nicety.
let lastTodaySummaryAt = 0;
const TODAY_SUMMARY_FOLLOWUP_WINDOW_MS = 30_000;

function handleTodaySummary(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const m = engine.getTodayMetrics();
  const now = Date.now();
  const isFollowup = (now - lastTodaySummaryAt) < TODAY_SUMMARY_FOLLOWUP_WINDOW_MS;
  lastTodaySummaryAt = now;

  // Empty path — no sales today yet.
  if (m.transactions === 0) {
    return { kind: 'answer', text: t('chat.today.empty') };
  }

  // Compact follow-up — same intent within the window.
  if (isFollowup) {
    return {
      kind: 'answer',
      text: t(
        'chat.today.followup',
        COP(m.revenueCents),
        m.transactions,
        COP(m.avgTicketCents),
      ),
    };
  }

  // Full card.
  const lines: string[] = [];
  lines.push(t('chat.today.header'));
  lines.push('');
  lines.push(`• ${t('chat.today.revenueLabel')}: ${COP(m.revenueCents)}`);
  lines.push(`• ${t('chat.today.transactionsLabel')}: ${m.transactions}`);
  lines.push(`• ${t('chat.today.avgTicketLabel')}: ${COP(m.avgTicketCents)}`);
  if (m.topSeller) {
    lines.push(`• ${t('chat.today.topSellerLabel')}: ${m.topSeller.name}`);
  }
  // Action recommendation — varies on whether we have a topSeller.
  const actionText = m.topSeller
    ? t('chat.today.actionWithTopSeller', m.topSeller.name)
    : t('chat.today.actionGeneric');
  lines.push('');
  lines.push(`💡 ${t('chat.today.actionLabel')}: ${actionText}`);

  return { kind: 'answer', text: lines.join('\n') };
}

// ── Daily Brief (R-DAILY-BRIEF-HANDLER-V1) ──────────────────
// Composes existing engine signals into one action-first answer. Pure read —
// no queue writes, no side effects. Customer name is resolved via
// engine.getCustomerHistory(customerId) because ActionQueueItem has no name
// field (deliberate — queue is keyed on customerId + phone for dedup).
function handleDailyBrief(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const b = engine.getDailyBrief();

  const lines: string[] = [];
  lines.push(t('chat.dailyBrief.header'));
  lines.push(t('chat.dailyBrief.today', COP(b.today.revenueCents), b.today.transactions));

  if (b.outreach.length > 0) {
    const top = b.outreach[0];
    const h = top.customerId ? engine.getCustomerHistory(top.customerId) : null;
    const name = h?.customer.name || top.phone || '';
    if (name) lines.push(t('chat.dailyBrief.outreach', name));
  }

  if (b.reorder.length > 0) {
    lines.push(t('chat.dailyBrief.reorder', b.reorder[0].name));
  }

  if (b.missed.slowDayLossCents > 0) {
    lines.push(t('chat.dailyBrief.slowDay'));
  }

  if (b.missed.deadStockLockedCents > 0) {
    lines.push(t('chat.dailyBrief.deadStock'));
  }

  return { kind: 'answer', text: lines.join('\n') };
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

// ── Who to contact today (R-INTEL-WHO-TO-CONTACT-TODAY) ────
// Deterministic top-3 outreach list ranked by:
//   score = grossRevenueDollars + daysSinceLastVisit*2 + visitCount*10
// Eligibility: customer has phone, ≥1 prior visit, valid lastVisit. Prefers
// customers inactive ≥14 days; falls back to all qualifying customers when
// fewer than 3 satisfy that filter. Reason + action are picked from a
// deterministic decision tree (no randomness, no API calls).
function handleWhoToContactToday(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const scores = engine.getCustomerScores();
  if (scores.length === 0) {
    return { kind: 'answer', text: t('chat.whoToContact.empty') };
  }
  // R-INTENT-CONTACT-TODAY-CONSENT-GUARD: consent lookup. CustomerHistorySummary
  // exposes a narrow customer projection without consent, so read it from the
  // engine's full customers array. Undefined = allowed (legacy records).
  const consentById = new Map(engine.getCustomers().map((c) => [c.id, c.communicationConsent]));

  type Candidate = {
    name: string;
    phone: string;
    grossRevenue: number;
    visitCount: number;
    daysSinceLastVisit: number;
    repairCount: number;
    rankScore: number;
  };

  const now = Date.now();
  const candidates: Candidate[] = [];
  for (const cs of scores) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h) continue;
    const phone = h.customer.phone || '';
    if (!phone) continue;                     // require contact channel
    // R-INTENT-CONTACT-TODAY-CONSENT-GUARD: skip customers who explicitly
    // opted out of communications. Undefined treated as allowed (legacy
    // records pre-dating the consent field).
    if (consentById.get(cs.customerId) === false) continue;
    if (h.visitCount < 1) continue;           // require prior purchase
    if (!h.lastVisit) continue;               // require valid last-visit date
    const daysSinceLastVisit = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
    const rankScore = (h.grossRevenue / 100) + daysSinceLastVisit * 2 + h.visitCount * 10;
    candidates.push({
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit,
      repairCount: h.linkedEntities?.repairCount || 0,
      rankScore,
    });
  }

  if (candidates.length === 0) {
    return { kind: 'answer', text: t('chat.whoToContact.empty') };
  }

  // Prefer inactive 14+ days; fall back to full pool if <3 qualify.
  const inactivePool = candidates.filter((c) => c.daysSinceLastVisit >= 14);
  const pool = inactivePool.length >= 3 ? inactivePool : candidates;

  // High-spender threshold = 75th percentile of grossRevenue across the full
  // candidate set (not just the chosen pool — keeps the threshold stable).
  const sortedSpend = candidates.map((c) => c.grossRevenue).sort((a, b) => a - b);
  const q3Index = Math.max(0, Math.floor(sortedSpend.length * 0.75));
  const highSpenderThreshold = sortedSpend[q3Index] || 0;

  const top = pool.slice().sort((a, b) => b.rankScore - a.rankScore).slice(0, 3);

  // R-INTEL-AUTO-ACTION-QUEUE-ARCH-FIX: persist queue items at handler-level
  // so only this intent (who_to_contact_today) creates queue entries. Engine
  // method is the canonical source — same scoring/eligibility/decision-tree;
  // we just route the result to the persisted queue here. 24h dedup in
  // actions.ts keeps repeat invocations idempotent. No auto-send.
  try {
    enqueueOutreachActions(engine.buildOutreachQueueItems());
  } catch {
    // Queue persistence is best-effort; never block chat response on it.
  }

  const lines = top.map((c) => {
    const inactive = c.daysSinceLastVisit >= 14;
    const recent = !inactive;
    const highSpender = c.grossRevenue >= highSpenderThreshold && c.grossRevenue > 0;

    // Reason: describes the WHY (3 buckets per spec).
    let reason: string;
    if (recent) {
      reason = t('chat.whoToContact.reasonRecentBuyer', c.name, c.daysSinceLastVisit);
    } else if (highSpender) {
      reason = t('chat.whoToContact.reasonHighValueInactive', c.name, c.daysSinceLastVisit, COP(c.grossRevenue));
    } else {
      reason = t('chat.whoToContact.reasonFrequentInactive', c.name, c.visitCount, c.daysSinceLastVisit);
    }

    // Action: 4 buckets per spec, repair-customer takes priority.
    let action: string;
    if (c.repairCount > 0) {
      action = t('chat.whoToContact.actionFollowUp');
    } else if (recent) {
      action = t('chat.whoToContact.actionAccessory');
    } else if (highSpender) {
      action = t('chat.whoToContact.actionComeback');
    } else {
      action = t('chat.whoToContact.actionRefill');
    }

    return `• ${c.name} · ${c.phone} · ${COP(c.grossRevenue)} total\n  ${reason}\n  ${action}`;
  });

  return {
    kind: 'answer',
    text: `${t('chat.whoToContact.header')}\n\n${lines.join('\n\n')}`,
  };
}

// ── Marketing engine V1 (R-INTEL-MARKETING-ENGINE-V1) ──────
// Deterministic 3-campaign output: Comeback (inactive 14+ days, high spend
// or frequent), Accessory Upsell (recent buyers OR repair pickups), Dead
// Stock Push (general — uses ProductOpportunity DEAD_STOCK signals). For
// each customer-targeted campaign, persists up to 5 draft items to the
// outreach queue with status='pending_approval'. Owner approves before
// any send (not implemented in V1 — queue is owner-facing only). All
// strings via tChat; no API calls; no randomness.
function handleMarketingCampaign(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);

  type Cand = {
    customerId: string;
    name: string;
    phone: string;
    grossRevenue: number;
    visitCount: number;
    daysSinceLastVisit: number;
    repairCount: number;
  };

  const now = Date.now();
  const scores = engine.getCustomerScores();
  const candidates: Cand[] = [];
  for (const cs of scores) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h) continue;
    const phone = h.customer.phone || '';
    if (!phone) continue;
    if (h.visitCount < 1) continue;
    if (!h.lastVisit) continue;
    const days = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
    candidates.push({
      customerId: cs.customerId,
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit: days,
      repairCount: h.linkedEntities?.repairCount || 0,
    });
  }

  // High-spender threshold = 75th percentile across all candidates.
  const sortedSpend = candidates.map((c) => c.grossRevenue).sort((a, b) => a - b);
  const q3Index = Math.max(0, Math.floor(sortedSpend.length * 0.75));
  const highSpenderThreshold = sortedSpend[q3Index] || 0;

  // Campaign 1 — Comeback: inactive 14+ days AND (high spend OR frequent).
  const comebackTargets = candidates.filter(
    (c) => c.daysSinceLastVisit >= 14
      && ((c.grossRevenue >= highSpenderThreshold && c.grossRevenue > 0) || c.visitCount >= 5),
  );

  // Campaign 2 — Accessory Upsell: recent visit (<14d) OR has any repair.
  const accessoryTargets = candidates.filter(
    (c) => c.daysSinceLastVisit < 14 || c.repairCount > 0,
  );

  // Campaign 3 — Dead Stock Push: not customer-keyed, general campaign idea
  // backed by current dead-stock SKUs (top 3 by name for the message hint).
  const deadStock = engine.getProductOpportunities().filter((p) => p.type === 'DEAD_STOCK');
  const deadStockSample = deadStock.slice(0, 3).map((p) => p.name).join(', ');

  type CampaignDef = {
    nameKey: string;
    priority: 'high' | 'medium' | 'low';
    priorityKey: string;
    priorityWeight: number;
    targetLabel: string;
    why: string;
    messageTemplate: string;     // for chat display, contains {customer} placeholder
    queueTargets: Cand[];
    enabled: boolean;
  };

  const campaigns: CampaignDef[] = [];

  if (comebackTargets.length > 0) {
    const top = comebackTargets.slice().sort((a, b) => b.grossRevenue - a.grossRevenue).slice(0, 5);
    campaigns.push({
      nameKey: 'chat.marketing.campaignComeback.name',
      priority: 'high',
      priorityKey: 'chat.marketing.priorityHigh',
      priorityWeight: 2000,
      targetLabel: t('chat.marketing.campaignComeback.target', comebackTargets.length),
      why: t('chat.marketing.campaignComeback.why', comebackTargets.length),
      messageTemplate: t('chat.marketing.campaignComeback.message', '{customer}'),
      queueTargets: top,
      enabled: true,
    });
  }

  if (accessoryTargets.length > 0) {
    const top = accessoryTargets.slice().sort((a, b) => b.grossRevenue - a.grossRevenue).slice(0, 5);
    campaigns.push({
      nameKey: 'chat.marketing.campaignAccessory.name',
      priority: 'medium',
      priorityKey: 'chat.marketing.priorityMedium',
      priorityWeight: 1000,
      targetLabel: t('chat.marketing.campaignAccessory.target', accessoryTargets.length),
      why: t('chat.marketing.campaignAccessory.why', accessoryTargets.length),
      messageTemplate: t('chat.marketing.campaignAccessory.message', '{customer}'),
      queueTargets: top,
      enabled: true,
    });
  }

  if (deadStock.length > 0) {
    // R-INTEL-MARKETING-ENGINE-FIX: dead-stock still needs outreach targets.
    // Rank from full eligible candidate pool by grossRevenue desc (top
    // spenders most likely to respond to a clearance push). Top 5.
    const top = candidates.slice().sort((a, b) => b.grossRevenue - a.grossRevenue).slice(0, 5);
    campaigns.push({
      nameKey: 'chat.marketing.campaignDeadStock.name',
      priority: 'low',
      priorityKey: 'chat.marketing.priorityLow',
      priorityWeight: 500,
      targetLabel: t('chat.marketing.campaignDeadStock.target', deadStock.length, deadStockSample),
      why: t('chat.marketing.campaignDeadStock.why', deadStockSample),
      messageTemplate: t('chat.marketing.campaignDeadStock.message', deadStockSample),
      queueTargets: top,
      enabled: true,
    });
  }

  if (campaigns.length === 0) {
    return { kind: 'answer', text: t('chat.marketing.empty') };
  }

  // Persist draft queue items (pending_approval) for customer-targeted
  // campaigns. Existing 24h dedup in actions.ts skips overlap with prior
  // who_to_contact_today entries. Best-effort — never block chat response.
  const queueItems: ActionQueueItem[] = [];
  for (const camp of campaigns) {
    for (const c of camp.queueTargets) {
      const firstName = c.name.split(' ')[0] || c.name;
      const messageKey = camp.priority === 'high'
        ? 'chat.marketing.campaignComeback.message'
        : camp.priority === 'medium'
          ? 'chat.marketing.campaignAccessory.message'
          : 'chat.marketing.campaignDeadStock.message';
      queueItems.push({
        id: `mkt-${camp.priority}-${c.customerId}-${now}`,
        // R-INTEL-MARKETING-ENGINE-FIX: distinct type from who_to_contact_today's
        // 'whatsapp' so the 24h dedup in actions.ts does NOT collide — same
        // customer can hold both an outreach item and a marketing draft.
        type: 'marketing_whatsapp',
        customerId: c.customerId,
        phone: c.phone,
        message: t(messageKey, firstName),
        priority: camp.priorityWeight,
        reason: camp.why,
        createdAt: now,
        status: 'pending_approval',
      });
    }
  }
  if (queueItems.length > 0) {
    try {
      enqueueOutreachActions(queueItems);
    } catch {
      // Queue persistence is best-effort.
    }
  }

  // Format chat response.
  const targetWord = t('chat.marketing.targetLabel');
  const whyWord = t('chat.marketing.whyLabel');
  const messageWord = t('chat.marketing.messageLabel');
  const lines = campaigns.map((camp) => {
    const priorityText = t(camp.priorityKey);
    return `📣 ${t(camp.nameKey)} [${priorityText}]\n  ${targetWord}: ${camp.targetLabel}\n  ${whyWord}: ${camp.why}\n  ${messageWord}: 💬 "${camp.messageTemplate}"`;
  });

  return {
    kind: 'answer',
    text: `${t('chat.marketing.header')}\n\n${lines.join('\n\n')}`,
  };
}

// ── Product push (R-INTEL-PRODUCT-PUSH-ENGINE) ─────────────
// Owner says "promote this product X" → router extracts X into
// match.extractedProduct → this handler ranks customers by spend +
// recency boost (≤30 days) + visit frequency, picks top 5, drafts a
// per-customer WhatsApp message and persists pending_approval queue
// items. Existing 24h dedup in actions.ts on (customerId, type=
// 'whatsapp') prevents over-queueing same customer in same 24h window.
function handleProductPush(match: IntentMatch, engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  // R-INTEL-INVENTORY-PROMOTE-BUTTON: thin adapter — delegates to
  // runProductPush so non-chat callers (e.g. InventoryModule's Promote
  // button) can invoke the same ranking + queue logic without going
  // through the chat router.
  return runProductPush(engine, lang, (match.extractedProduct || '').trim());
}

// R-INTEL-INVENTORY-PROMOTE-BUTTON: exported single-source helper. Same
// scoring/eligibility/decision-tree as the chat handler — 1 implementation,
// 2 callsites (chat handler + InventoryModule Promote button).
export function runProductPush(engine: IntelligenceEngine, lang: Lang3, rawProductName: string): ChatResponse {
  const t = tChat(lang);
  const productName = (rawProductName || '').trim();
  if (!productName) {
    return { kind: 'answer', text: t('chat.productPush.noProduct') };
  }

  type Cand = {
    customerId: string;
    name: string;
    phone: string;
    grossRevenue: number;
    visitCount: number;
    daysSinceLastVisit: number;
    rankScore: number;
  };

  const now = Date.now();
  const scores = engine.getCustomerScores();
  const candidates: Cand[] = [];
  for (const cs of scores) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h) continue;
    const phone = h.customer.phone || '';
    if (!phone) continue;                           // require contact channel
    if (h.visitCount < 1) continue;                 // require prior purchase
    if (!h.lastVisit) continue;
    const days = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
    // Recency boost favors customers active within last 30 days.
    const recencyBoost = days <= 30 ? (30 - days) * 5 : 0;
    const rankScore = (h.grossRevenue / 100) + recencyBoost + h.visitCount * 10;
    candidates.push({
      customerId: cs.customerId,
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit: days,
      rankScore,
    });
  }

  if (candidates.length === 0) {
    return { kind: 'answer', text: t('chat.productPush.empty', productName) };
  }

  const top = candidates.slice().sort((a, b) => b.rankScore - a.rankScore).slice(0, 5);

  // R-INTEL-PRODUCT-PUSH-DEDUP-FIX: distinct type from who_to_contact_today's
  // 'whatsapp' and marketing's 'marketing_whatsapp' so the 24h dedup in
  // actions.ts (keyed on customerId+type) does NOT collide. High-intent
  // single-product campaigns must always enqueue regardless of prior
  // outreach activity for the same customer.
  const queueItems: ActionQueueItem[] = top.map((c) => {
    const firstName = c.name.split(' ')[0] || c.name;
    return {
      id: `pp-${c.customerId}-${now}`,
      type: 'product_push_whatsapp',
      customerId: c.customerId,
      phone: c.phone,
      message: t('chat.productPush.message', firstName, productName),
      priority: 3000,                                // higher than marketing's max (2000)
      reason: t('chat.productPush.reason', productName),
      createdAt: now,
      status: 'pending_approval',
    };
  });
  try {
    enqueueOutreachActions(queueItems);
  } catch {
    // Queue persistence is best-effort.
  }

  // Format chat response.
  const lines = top.map((c) => `• ${c.name} · ${c.phone} · ${COP(c.grossRevenue)} total`);
  const previewMessage = t('chat.productPush.message', '{customer}', productName);
  return {
    kind: 'answer',
    text: `${t('chat.productPush.header', productName, top.length)}\n\n${lines.join('\n')}\n\n${t('chat.productPush.messagePreviewLabel')}: 💬 "${previewMessage}"`,
  };
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
      '• "mi mejor cliente" — cliente top por valor',
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
      '• "best customer" — top customer by value',
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

// ── Universal data query handler (R-INTEL-CELLHUB-DATA-ACCESS-LAYER) ─
// Inspects the raw query, picks the right data access function, returns a
// concise operator-format answer (header + key numbers + optional list +
// action). Topic detection is regex-based and deterministic. Range
// detection (today/yesterday/this_week/this_month/last_30_days) is
// inferred from the query — defaults to last_30_days.
function detectDataQueryRange(q: string): DateRange {
  if (/today|hoy|hoje/.test(q)) return 'today';
  if (/yesterday|ayer|ontem/.test(q)) return 'yesterday';
  if (/this week|esta semana/.test(q)) return 'this_week';
  if (/this month|este mes|este mês/.test(q)) return 'this_month';
  return 'last_30_days';
}

function rangeLabel(range: DateRange, lang: Lang3): string {
  const labels: Record<DateRange, Record<Lang3, string>> = {
    today: { en: 'today', es: 'hoy', pt: 'hoje' },
    yesterday: { en: 'yesterday', es: 'ayer', pt: 'ontem' },
    this_week: { en: 'this week', es: 'esta semana', pt: 'esta semana' },
    this_month: { en: 'this month', es: 'este mes', pt: 'este mês' },
    last_30_days: { en: 'last 30 days', es: 'últimos 30 días', pt: 'últimos 30 dias' },
  };
  return labels[range][lang] ?? labels[range].en;
}

function handleDataQuery(match: IntentMatch, engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const q = (match.query || '').toLowerCase();
  const range = detectDataQueryRange(q);
  const actionLbl = t('chat.dataQuery.action');

  // ── Expenses (R-DATA-EXPENSE-ACCESS-V1) ─────────────────
  // Read-only summary. Does NOT compute net profit — sales-side profit
  // formula is unresolved (see audit). Test BEFORE other branches so the
  // word "spend" / "gasto" / "despesa" doesn't collide with sales regex.
  if (/expense|spend|gasto|despesa/.test(q)) {
    const sum = getExpenseSummary(engine.getExpenses(), range);
    if (sum.count === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
    const lines = [
      t('chat.dataQuery.expensesHeader'),
      '',
      `• ${t('chat.dataQuery.expensesTotal', COP(sum.totalCents))}`,
      `• ${t('chat.dataQuery.expensesCount', sum.count)}`,
    ];
    const topCat = Object.entries(sum.byCategory).sort((a, b) => b[1] - a[1])[0];
    if (topCat && topCat[1] > 0) {
      lines.push(`• ${t('chat.dataQuery.expensesTopCategory', topCat[0], COP(topCat[1]))}`);
    }
    return { kind: 'answer', text: lines.join('\n') };
  }

  // ── Repairs ────────────────────────────────────────────
  if (/repair|repara|reparo/.test(q)) {
    if (/ready|listas|listos|prontos/.test(q)) {
      const list = getReadyRepairs(engine.getRepairs(), 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.repairsHeader')} — ${t('chat.dataQuery.readyItems')}: ${list.length}`, ''];
      list.forEach((r, i) => {
        const name = (r as { customerName?: string }).customerName || (r as { customer?: string }).customer || '—';
        const dev = (r as { itemDescription?: string; deviceModel?: string }).itemDescription || (r as { deviceModel?: string }).deviceModel || '';
        const total = (r as { total?: number; estimatedCost?: number }).total || (r as { estimatedCost?: number }).estimatedCost || 0;
        lines.push(`${i + 1}. ${name}${dev ? ` — ${dev}` : ''}${total ? ` — ${COP(total)}` : ''}`);
      });
      lines.push('');
      lines.push(`💡 ${actionLbl}: ${lang === 'es' ? 'manda WhatsApp a estos clientes para que pasen hoy' : lang === 'pt' ? 'envie WhatsApp para esses clientes virem hoje' : 'WhatsApp these customers to pick up today'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    const sum = getRepairSummary(engine.getRepairs());
    const lines = [
      t('chat.dataQuery.repairsHeader'),
      '',
      `• ${t('chat.dataQuery.readyItems')}: ${sum.ready}${sum.overdue > 0 ? ` (${sum.overdue} overdue)` : ''}`,
      `• ${lang === 'es' ? 'Activas' : lang === 'pt' ? 'Ativas' : 'Active'}: ${sum.active}`,
      `• ${lang === 'es' ? 'Recogidas' : lang === 'pt' ? 'Retiradas' : 'Picked up'}: ${sum.pickedUp}`,
    ];
    if (sum.ready > 0) {
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'contacta a los clientes con reparación lista' : lang === 'pt' ? 'contate clientes com reparo pronto' : 'contact customers with ready repairs'}`);
    }
    return { kind: 'answer', text: lines.join('\n') };
  }

  // ── Layaways ───────────────────────────────────────────
  if (/layaway|apartado|reserva/.test(q)) {
    if (/pend|partial|pendientes|pendentes/.test(q)) {
      const list = getPendingLayaways(engine.getLayaways(), 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.layawaysHeader')} — ${t('chat.dataQuery.pendingItems')}: ${list.length}`, ''];
      list.forEach((l, i) => {
        const name = (l as { customerName?: string }).customerName || '—';
        const desc = (l as { itemDescription?: string }).itemDescription || '';
        const balance = (l as { balance?: number }).balance || 0;
        lines.push(`${i + 1}. ${name}${desc ? ` — ${desc}` : ''} — ${COP(balance)} ${lang === 'es' ? 'pendiente' : lang === 'pt' ? 'pendente' : 'due'}`);
      });
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'contacta para cobrar el saldo pendiente' : lang === 'pt' ? 'contate para receber o saldo pendente' : 'reach out to collect the outstanding balance'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    const sum = getLayawaySummary(engine.getLayaways());
    return {
      kind: 'answer',
      text: [
        t('chat.dataQuery.layawaysHeader'),
        '',
        `• ${lang === 'es' ? 'Activos' : lang === 'pt' ? 'Ativos' : 'Active'}: ${sum.active}`,
        `• ${t('chat.dataQuery.pendingItems')}: ${sum.pending}`,
        `• ${lang === 'es' ? 'Completados' : lang === 'pt' ? 'Concluídos' : 'Completed'}: ${sum.completed}`,
      ].join('\n'),
    };
  }

  // ── Inventory: low / dead / general ────────────────────
  if (/inventor|stock|product|invent[áa]rio|estoque|produto/.test(q)) {
    if (/low|baj|baixo|short|escaso/.test(q)) {
      const list = getLowStockItems(engine.getInventory(), 5, 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.inventoryHeader')} — ${lang === 'es' ? 'bajo inventario' : lang === 'pt' ? 'estoque baixo' : 'low stock'}: ${list.length}`, ''];
      list.slice(0, 5).forEach((it, i) => {
        const name = (it as { name?: string }).name || '—';
        const qty = (it as { qty?: number }).qty || 0;
        lines.push(`${i + 1}. ${name} — ${qty}`);
      });
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'repón primero los que más se venden' : lang === 'pt' ? 'reabasteça primeiro os que mais vendem' : 'restock the fast movers first'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    if (/dead|muerto|parado|sin venta/.test(q)) {
      const list = getDeadStockItems(engine.getInventory(), engine.getSales(), 60, 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.inventoryHeader')} — ${lang === 'es' ? 'sin movimiento (60d)' : lang === 'pt' ? 'sem movimento (60d)' : 'dead stock (60d)'}: ${list.length}`, ''];
      list.slice(0, 5).forEach((it, i) => {
        const name = (it as { name?: string }).name || '—';
        const qty = (it as { qty?: number }).qty || 0;
        lines.push(`${i + 1}. ${name} — ${qty}`);
      });
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'descuenta o promociona estos productos' : lang === 'pt' ? 'desconto ou promova esses produtos' : 'discount or promote these items'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    const sum = getInventorySummary(engine.getInventory(), 5);
    return {
      kind: 'answer',
      text: [
        t('chat.dataQuery.inventoryHeader'),
        '',
        `• ${lang === 'es' ? 'Total de productos' : lang === 'pt' ? 'Total de itens' : 'Total items'}: ${sum.totalItems}`,
        `• ${lang === 'es' ? 'Valor en venta' : lang === 'pt' ? 'Valor em venda' : 'Retail value'}: ${COP(sum.totalValueCents)}`,
        `• ${lang === 'es' ? 'Costo total' : lang === 'pt' ? 'Custo total' : 'Cost basis'}: ${COP(sum.totalCostCents)}`,
        `• ${lang === 'es' ? 'Bajo inventario' : lang === 'pt' ? 'Estoque baixo' : 'Low stock'}: ${sum.lowStockCount}`,
      ].join('\n'),
    };
  }

  // ── Customers: top / inactive / general ────────────────
  if (/customer|cliente/.test(q)) {
    if (/top|mejor|melhor|best/.test(q)) {
      const list = getTopCustomers(engine.getCustomers(), engine.getSales(), 5);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.customersHeader')} — top ${list.length}`, ''];
      list.forEach((c, i) => {
        lines.push(`${i + 1}. ${c.name || '—'} — ${COP(c.revenueCents)} (${c.visitCount} ${lang === 'es' ? 'visitas' : lang === 'pt' ? 'visitas' : 'visits'})`);
      });
      return { kind: 'answer', text: lines.join('\n') };
    }
    if (/inactive|inactivo|inativo/.test(q)) {
      const list = getInactiveCustomers(engine.getCustomers(), engine.getSales(), 30, 10);
      if (list.length === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
      const lines = [`${t('chat.dataQuery.customersHeader')} — ${lang === 'es' ? 'inactivos 30d+' : lang === 'pt' ? 'inativos 30d+' : 'inactive 30d+'}: ${list.length}`, ''];
      list.slice(0, 5).forEach((c, i) => {
        lines.push(`${i + 1}. ${c.name} — ${c.daysSinceLastVisit}d`);
      });
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'envía oferta de regreso' : lang === 'pt' ? 'envie oferta de retorno' : 'send a comeback offer'}`);
      return { kind: 'answer', text: lines.join('\n') };
    }
    const sum = getCustomerSummary(engine.getCustomers(), engine.getSales());
    return {
      kind: 'answer',
      text: [
        t('chat.dataQuery.customersHeader'),
        '',
        `• Total: ${sum.total}`,
        `• ${lang === 'es' ? 'Activos (30d)' : lang === 'pt' ? 'Ativos (30d)' : 'Active (30d)'}: ${sum.active30d}`,
        `• ${lang === 'es' ? 'Inactivos (30d+)' : lang === 'pt' ? 'Inativos (30d+)' : 'Inactive (30d+)'}: ${sum.inactive30d}`,
      ].join('\n'),
    };
  }

  // ── Unlocks ────────────────────────────────────────────
  if (/unlock|desbloque/.test(q)) {
    const sum = getUnlockSummary(engine.getUnlocks());
    return {
      kind: 'answer',
      text: [
        t('chat.dataQuery.unlocksHeader'),
        '',
        `• ${lang === 'es' ? 'Activos' : lang === 'pt' ? 'Ativos' : 'Active'}: ${sum.active}`,
        `• ${lang === 'es' ? 'Completados' : lang === 'pt' ? 'Concluídos' : 'Completed'}: ${sum.completed}`,
      ].join('\n'),
    };
  }

  // ── Phone payments ─────────────────────────────────────
  if (/phone payment|pagos? de tel|pagamento.*tel|recharge|recarga/.test(q)) {
    const sum = getPhonePaymentSummary(engine.getSales(), range);
    if (sum.count === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
    return {
      kind: 'answer',
      text: [
        `${t('chat.dataQuery.phonePaymentsHeader')} — ${rangeLabel(range, lang)}`,
        '',
        `• ${lang === 'es' ? 'Cantidad' : lang === 'pt' ? 'Quantidade' : 'Count'}: ${sum.count}`,
        `• ${lang === 'es' ? 'Volumen' : lang === 'pt' ? 'Volume' : 'Volume'}: ${COP(sum.revenueCents)}`,
      ].join('\n'),
    };
  }

  // ── Special orders ─────────────────────────────────────
  if (/special order|pedido especial|encargo|encomenda/.test(q)) {
    const sum = getSpecialOrderSummary(engine.getSpecialOrders());
    return {
      kind: 'answer',
      text: [
        '📦 ' + (lang === 'es' ? 'Pedidos especiales' : lang === 'pt' ? 'Pedidos especiais' : 'Special orders'),
        '',
        `• ${lang === 'es' ? 'Activos' : lang === 'pt' ? 'Ativos' : 'Active'}: ${sum.active}`,
        `• ${t('chat.dataQuery.readyItems')}: ${sum.ready}`,
        `• ${lang === 'es' ? 'Recogidos' : lang === 'pt' ? 'Retirados' : 'Picked up'}: ${sum.pickedUp}`,
      ].join('\n'),
    };
  }

  // ── Returns ────────────────────────────────────────────
  if (/return|devolu|reembols/.test(q)) {
    const sum = getReturnSummary(engine.getReturns(), range);
    return {
      kind: 'answer',
      text: [
        '↩️ ' + (lang === 'es' ? 'Devoluciones' : lang === 'pt' ? 'Devoluções' : 'Returns') + ` — ${rangeLabel(range, lang)}`,
        '',
        `• ${lang === 'es' ? 'Cantidad' : lang === 'pt' ? 'Quantidade' : 'Count'}: ${sum.count}`,
        `• ${lang === 'es' ? 'Total reembolsado' : lang === 'pt' ? 'Total reembolsado' : 'Total refunded'}: ${COP(sum.totalRefundedCents)}`,
      ].join('\n'),
    };
  }

  // ── Sales (default for "how much / cuánto / quanto / vendi") ───
  if (/sale|venta|sold|vendi|how much|cuanto|cuánto|quanto|profit|ganancia|lucro/.test(q)) {
    const sum = getSalesSummary(engine.getSales(), range);
    if (sum.count === 0) return { kind: 'answer', text: t('chat.dataQuery.noData') };
    const lines = [
      `${t('chat.dataQuery.salesHeader')} — ${rangeLabel(range, lang)}`,
      '',
      `• ${lang === 'es' ? 'Ventas' : lang === 'pt' ? 'Vendas' : 'Revenue'}: ${COP(sum.revenueCents)}`,
      `• ${lang === 'es' ? 'Transacciones' : lang === 'pt' ? 'Transações' : 'Transactions'}: ${sum.count}`,
      `• ${lang === 'es' ? 'Ticket promedio' : lang === 'pt' ? 'Ticket médio' : 'Avg ticket'}: ${COP(sum.avgTicketCents)}`,
    ];
    if (sum.topSeller) {
      lines.push(`• ${lang === 'es' ? 'Más vendido' : lang === 'pt' ? 'Mais vendido' : 'Top seller'}: ${sum.topSeller.name}`);
    }
    if (range === 'today') {
      lines.push('', `💡 ${actionLbl}: ${lang === 'es' ? 'revisa pagos pendientes para cerrar más antes de terminar el día' : lang === 'pt' ? 'cobre pagamentos pendentes para fechar mais antes do fim do dia' : 'collect pending payments to close more before end of day'}`);
    }
    return { kind: 'answer', text: lines.join('\n') };
  }

  // No topic match — defer to fallback message.
  return { kind: 'answer', text: t('chat.dataQuery.noData') };
}

// ── Fallback open-question handler ──────────────────────────
// R-INTEL-FALLBACK-OPEN-QUESTIONS: deterministic answer for queries that
// don't trigger any keyword bank. R-INTEL-FALLBACK-QUESTION-AWARE: response
// adapts to topic keywords detected in the raw query (day/product/customer/
// why/time) so different questions produce different answers instead of
// always returning the full dashboard. Uses only existing engine data
// (KPI, root-cause reports, opportunities, scores) — never invents numbers,
// never mutates queue, never executes actions. engine.refresh() hits the
// 60s cache, so cost is near-zero on hot path.
function handleFallbackQuestion(match: IntentMatch, engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  void lang;
  // EN-only inline strings — fallback is meta-content (data summary +
  // routing hints to specific intents); spec did not list translations.ts.
  const rawQuery = (match.query || '').toLowerCase();

  // ── Topic detection ────────────────────────────────────────
  // Cheap substring/regex checks. EN + ES + PT keyword variants where
  // overlap with existing keyword banks is minimal (otherwise the query
  // would have hit a deterministic intent and never landed here).
  const WEEKDAYS = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo',
    'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta',
  ];
  let weekdayHit: string | null = null;
  for (const d of WEEKDAYS) {
    if (rawQuery.includes(d)) { weekdayHit = d; break; }
  }
  const hasDay = weekdayHit !== null || /\bday\b|\bd[íi]a\b|\bdia\b/.test(rawQuery);
  const hasProduct = /\bproduct\b|\bsku\b|\bitem\b|\bproducto\b|\bproduto\b/.test(rawQuery);
  const hasCustomer = /\bcustomer\b|\bbuyer\b|\bcliente\b/.test(rawQuery);
  const hasWhy = /\bwhy\b|\bpor\s*qu[ée]\b|\bporque\b|\bcausa\b|\breason\b/.test(rawQuery);
  const timeWindow: 'today' | 'week' | 'month' | null = (() => {
    if (rawQuery.includes('today') || rawQuery.includes('hoy') || rawQuery.includes('hoje')) return 'today';
    if (rawQuery.includes('week') || rawQuery.includes('semana')) return 'week';
    if (rawQuery.includes('month') || rawQuery.includes('mes') || rawQuery.includes('mês')) return 'month';
    return null;
  })();

  const insights: string[] = [];
  const actions: string[] = [];

  // ── Day / weekday / traffic pattern ──────────────────────
  if (hasDay) {
    const slow = engine.getSlowDayRootCause();
    if (slow) {
      insights.push(`📅 Slowest day is ${slow.slowestDayName} (${COP(slow.slowDayRevenueCents)} avg); best day is ${slow.bestDayName} (${COP(slow.bestDayRevenueCents)} avg).`);
      if (slow.weeklyGapCents > 0) {
        insights.push(`📉 Weekly gap between best and slowest day: ${COP(slow.weeklyGapCents)}.`);
      }
      actions.push(`Run "why is ${slow.slowestDayName.toLowerCase()} slow" for the full slow-day diagnosis`);
    }
  }

  // ── Product focus ────────────────────────────────────────
  if (hasProduct) {
    const opps = engine.getProductOpportunities();
    if (opps.length > 0) {
      const top = opps[0];
      const oppType = top.type.toLowerCase().replace(/_/g, ' ');
      insights.push(`📦 Top product signal: ${top.action.toLowerCase()} "${top.name}" — ${oppType}, impact ~${COP(top.impactCents)}.`);
      if (opps.length > 1) {
        insights.push(`📦 ${opps.length - 1} more product opportunit${opps.length - 1 === 1 ? 'y' : 'ies'} surfaced.`);
      }
      actions.push(`Run "promote this product ${top.name}" to draft outreach to top buyers`);
    }
  }

  // ── Customer focus ───────────────────────────────────────
  if (hasCustomer) {
    const scores = engine.getCustomerScores();
    if (scores.length > 0) {
      const sorted = scores.slice().sort((a, b) => b.score - a.score);
      const top = sorted[0];
      insights.push(`👤 ${scores.length} customer${scores.length === 1 ? '' : 's'} scored — top tier is "${top.tier}" (score ${Math.round(top.score)}).`);
      const atRisk = sorted.filter((s) => s.tier === 'bronze' || s.riskScore > 50);
      if (atRisk.length > 0) {
        insights.push(`⚠️ ${atRisk.length} customer${atRisk.length === 1 ? '' : 's'} flagged as at-risk by score.`);
      }
      actions.push(`Run "who should I contact today" for the ranked top-3 outreach list`);
    }
  }

  // ── Why / root cause ─────────────────────────────────────
  if (hasWhy) {
    const revRC = engine.getRevenueRootCause();
    if (revRC && revRC.revDropCents > 0) {
      insights.push(`📉 Revenue diagnosis: ${revRC.diagnosis} — drop of ${COP(revRC.revDropCents)} (${revRC.txDropPct}% tx drop, ${revRC.ticketDropPct}% ticket drop).`);
      actions.push(`Run "why are sales down" for the full breakdown`);
    } else {
      const missed = engine.getMissedRevenue();
      if (missed) {
        const losses = [missed.deadStockLockedCents ?? 0, missed.slowDayLossCents ?? 0, missed.slowHourLossCents ?? 0];
        const biggest = Math.max(...losses);
        if (biggest > 0) {
          insights.push(`🔍 Largest missed-revenue signal is ${COP(biggest)}.`);
          actions.push(`Run "what is hurting my profit" for the breakdown`);
        }
      }
    }
  }

  // ── Time window only (no other topic) ────────────────────
  // If the query is purely time-scoped (e.g. "anything for today")
  // and no other category fired, surface the today/week KPI snapshot.
  if (timeWindow && insights.length === 0) {
    const kpi = engine.refresh().kpiDashboard;
    if (kpi) {
      const rev = kpi.revenue?.current ?? 0;
      const tx = kpi.transactions?.count ?? 0;
      if (rev > 0 || tx > 0) {
        insights.push(`📊 ${kpi.period}: ${COP(rev)} revenue across ${tx} transaction${tx === 1 ? '' : 's'}.`);
      }
    }
  }

  // ── Generic mini-summary fallback ────────────────────────
  // Only when NOTHING topic-specific fired. Trimmed to the most actionable
  // signals (reorder + missed-revenue) — no full dashboard dump.
  if (insights.length === 0) {
    const reorderRecs = engine.getReorderRecommendations();
    if (reorderRecs.length > 0) {
      const top = reorderRecs[0];
      const days = Number.isFinite(top.daysLeft) ? Math.round(top.daysLeft) : 0;
      insights.push(`📦 Most urgent reorder: "${top.name}" (${top.priority}, ~${days} day(s) of stock left).`);
      actions.push(`Run "what should I reorder" for the full list`);
    }
    const missed = engine.getMissedRevenue();
    if (missed) {
      const losses = [missed.deadStockLockedCents ?? 0, missed.slowDayLossCents ?? 0, missed.slowHourLossCents ?? 0];
      const biggest = Math.max(...losses);
      if (biggest > 0) {
        insights.push(`💸 Largest missed-revenue signal is ${COP(biggest)}.`);
        actions.push(`Run "what is hurting my profit" for the breakdown`);
      }
    }
  }

  // ── Compose response ─────────────────────────────────────
  const finalInsights = insights.slice(0, 3);
  const finalActions = actions.slice(0, 3);

  if (finalInsights.length === 0 && finalActions.length === 0) {
    return {
      kind: 'answer',
      text: 'Not enough data yet to answer specifically. Try a deterministic intent like "who should I contact today", "what is hurting my profit", "marketing", or "what should I reorder".',
    };
  }

  const lines: string[] = [];
  lines.push('Based on your question and store data:');
  lines.push('');
  if (finalInsights.length > 0) {
    lines.push('📊 What I see:');
    finalInsights.forEach((i) => lines.push(`  ${i}`));
  }
  if (finalActions.length > 0) {
    if (finalInsights.length > 0) lines.push('');
    lines.push('💡 Suggested next steps:');
    finalActions.forEach((a, idx) => lines.push(`  ${idx + 1}. ${a}`));
  }

  return { kind: 'answer', text: lines.join('\n') };
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
