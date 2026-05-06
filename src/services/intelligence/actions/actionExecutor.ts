// R-INTEL-PHASE3.2-EXEC: Action Executor — converts ActionPayload into safe
// execution instructions. No state mutation, no automatic sends, no POS changes.
// Callers receive a structured result and decide what to do with it.
import type { ActionPayload } from './actionEngine';
import type { Sale } from '@/store/types';

// R-INTELLIGENCE-ACTION-IMPACT-TRACKING-V1: lightweight execution log so we
// can later attribute revenue to actions the owner clicked. Logs live in
// localStorage; capped at MAX_LOG entries (FIFO) so unbounded execution
// history doesn't bloat storage. Logging is best-effort — incognito/quota
// failures silently skip; never block the execution path.
const EXECUTION_LOG_KEY = 'cellhub:intelligence:executionLog:v1';
const MAX_LOG = 500;

export interface ExecutionLogItem {
  id: string;
  actionType: string;
  customerId?: string;
  timestamp: number;
}

function readExecutionLog(): ExecutionLogItem[] {
  try {
    const raw = localStorage.getItem(EXECUTION_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function appendExecutionLog(payload: ActionPayload): void {
  try {
    const item: ExecutionLogItem = {
      id: `exec-${payload.type}-${payload.customerId || 'na'}-${Date.now()}`,
      actionType: payload.type,
      customerId: payload.customerId,
      timestamp: Date.now(),
    };
    const log = readExecutionLog();
    log.push(item);
    // FIFO cap — drop oldest entries if exceeding MAX_LOG.
    const trimmed = log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log;
    localStorage.setItem(EXECUTION_LOG_KEY, JSON.stringify(trimmed));
  } catch { /* incognito / quota — best-effort, never block */ }
}

// R-INTELLIGENCE-ACTION-IMPACT-TRACKING-V1: deterministic 72h-window
// attribution. Strict match: same customerId, sale timestamp strictly AFTER
// action timestamp AND within 72h. Counts only the FIRST matching sale per
// log entry (no double-counting). Voided/refunded sales excluded.
const HOURS_72_MS = 72 * 60 * 60 * 1000;

function tsOfSale(sale: Sale): number {
  const ca = (sale as { createdAt?: unknown }).createdAt;
  if (!ca) return 0;
  try {
    const d = typeof (ca as { toDate?: () => Date }).toDate === 'function'
      ? (ca as { toDate: () => Date }).toDate()
      : (ca as string | Date);
    const t = new Date(d as string | Date).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

export type ActionLearningRecommendation =
  | 'not_enough_data'
  | 'keep_contacting'
  | 'needs_more_actions'
  | 'working';

export interface ActionLearningResult {
  totalActions: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
  bestActionType?: string;
  recommendation: ActionLearningRecommendation;
}

// R-INTELLIGENCE-LEARNING-LOOP-V1: deterministic recommendation derived from
// existing execution log + sales attribution. Pure read — no mutation, no
// background work, no localStorage writes. Thresholds:
//   totalActions < 3        → not_enough_data
//   conversions === 0       → needs_more_actions
//   conversionRate ≥ 0.30   → working
//   else                    → keep_contacting
export function getActionLearning(sales: Sale[]): ActionLearningResult {
  const r = getActionImpact(sales);
  const conversionRate = r.totalActions > 0 ? r.conversions / r.totalActions : 0;
  let recommendation: ActionLearningRecommendation;
  if (r.totalActions < 3) {
    recommendation = 'not_enough_data';
  } else if (r.conversions === 0) {
    recommendation = 'needs_more_actions';
  } else if (conversionRate >= 0.3) {
    recommendation = 'working';
  } else {
    recommendation = 'keep_contacting';
  }
  return {
    totalActions: r.totalActions,
    conversions: r.conversions,
    revenue: r.revenue,
    conversionRate,
    recommendation,
  };
}

export function getActionImpact(sales: Sale[]): {
  totalActions: number;
  conversions: number;
  revenue: number;
} {
  const log = readExecutionLog();
  if (log.length === 0) {
    return { totalActions: 0, conversions: 0, revenue: 0 };
  }
  // Pre-bucket sales by customerId for O(L + S) match instead of O(L × S).
  const byCustomer = new Map<string, Sale[]>();
  for (const s of sales) {
    const cid = (s as { customerId?: string }).customerId;
    if (!cid) continue;
    const status = String((s as { status?: string }).status || '').toLowerCase();
    if (status === 'voided' || status === 'refunded') continue;
    const arr = byCustomer.get(cid) || [];
    arr.push(s);
    byCustomer.set(cid, arr);
  }

  let conversions = 0;
  let revenue = 0;
  for (const item of log) {
    if (!item.customerId) continue;
    const customerSales = byCustomer.get(item.customerId);
    if (!customerSales) continue;
    const after = item.timestamp;
    const before = item.timestamp + HOURS_72_MS;
    let earliestTs = Infinity;
    let earliestTotal = 0;
    for (const s of customerSales) {
      const ts = tsOfSale(s);
      if (!ts || ts <= after || ts > before) continue;
      if (ts < earliestTs) {
        earliestTs = ts;
        earliestTotal = (s as { total?: number }).total || 0;
      }
    }
    if (earliestTs !== Infinity) {
      conversions++;
      revenue += earliestTotal;
    }
  }
  return { totalActions: log.length, conversions, revenue };
}

export type ExecutionResult =
  | { ok: true;  type: 'whatsapp_url';    url: string }
  | { ok: true;  type: 'pos_discount';    sku: string }
  | { ok: true;  type: 'pos_bundle';      sku: string }
  | { ok: true;  type: 'review_panel' }
  | { ok: true;  type: 'reminder_queue';  customerId?: string; customerName?: string }
  | { ok: false; reason: 'not_executable' | 'missing_customer' | 'missing_sku' | 'missing_template' };

function buildMessage(messageKey: string, customerName?: string): string {
  switch (messageKey) {
    case 'whatsapp.template.reconnect':
      return `Hi ${customerName ?? 'there'}, we wanted to check in and see if you need anything from Go Cellular.`;
    case 'whatsapp.template.discount':
      return `Hi ${customerName ?? 'there'}, we have a special offer available for you at Go Cellular.`;
    default:
      return `Hi ${customerName ?? 'there'}, Go Cellular wanted to follow up with you.`;
  }
}

export function executeActionPayload(payload: ActionPayload): ExecutionResult {
  switch (payload.executionTarget) {
    case 'whatsapp_url': {
      if (!payload.messageKey) {
        return { ok: false, reason: 'missing_template' };
      }
      if (!payload.customerName && !payload.customerId) {
        return { ok: false, reason: 'missing_customer' };
      }
      const text = buildMessage(payload.messageKey, payload.customerName);
      if (!text || text.trim().length === 0) {
        return { ok: false, reason: 'missing_template' };
      }
      const encoded = encodeURIComponent(text);
      const url = `https://wa.me/?text=${encoded}`;
      appendExecutionLog(payload);
      return { ok: true, type: 'whatsapp_url', url };
    }

    case 'pos_discount': {
      if (!payload.sku) {
        return { ok: false, reason: 'missing_sku' };
      }
      appendExecutionLog(payload);
      return { ok: true, type: 'pos_discount', sku: payload.sku };
    }

    case 'pos_bundle': {
      if (!payload.sku) {
        return { ok: false, reason: 'missing_sku' };
      }
      appendExecutionLog(payload);
      return { ok: true, type: 'pos_bundle', sku: payload.sku };
    }

    case 'review_panel':
      appendExecutionLog(payload);
      return { ok: true, type: 'review_panel' };

    case 'reminder_queue': {
      if (!payload.customerId && !payload.customerName) {
        return { ok: false, reason: 'missing_customer' };
      }
      appendExecutionLog(payload);
      return {
        ok: true,
        type: 'reminder_queue',
        customerId: payload.customerId,
        customerName: payload.customerName,
      };
    }

    case 'none':
    default:
      return { ok: false, reason: 'not_executable' };
  }
}
