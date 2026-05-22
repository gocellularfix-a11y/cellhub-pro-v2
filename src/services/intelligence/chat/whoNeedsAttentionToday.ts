// ============================================================
// CellHub Intelligence — Who Needs Attention Today
// R-INTELLIGENCE-WHO-NEEDS-ATTENTION-TODAY
//
// Deterministic operational decision engine. Aggregates priority signals
// from six existing domains (repair, layaway, external payment portal,
// customer churn, store credit liability, special order) and returns a
// max-5 ranked action list. NO LLM, NO embeddings, NO randomness — pure
// reads + integer math.
//
// Architecture is additive: this module owns the scoring/aggregation; the
// existing handlers.ts pipeline dispatches to handleWhoNeedsAttentionToday
// via a new intent. None of the existing intents/handlers are modified.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Repair, Layaway, SpecialOrder, StoreCreditLedger, Customer } from '@/store/types';
import { getDueVerification } from '../paymentVerification/paymentVerificationService';
import { loadLocal } from '@/services/storage';
import { tChat, type Lang3, type ChatResponse, type ChatActionUI, COP } from './handlers';

// ── Tunable thresholds (all deterministic) ────────────────

const REPAIR_MIN_DAYS_READY            = 3;
const REPAIR_URGENT_DAYS               = 7;
const REPAIR_CRITICAL_DAYS             = 14;

const LAYAWAY_STALE_DAYS               = 14;
const LAYAWAY_URGENT_DAYS              = 14;
const LAYAWAY_CRITICAL_DAYS            = 30;

const SO_STALE_DAYS                    = 7;
const SO_URGENT_DAYS                   = 14;

const CUSTOMER_INACTIVE_DAYS           = 60;
const CUSTOMER_CRITICAL_INACTIVE_DAYS  = 120;
const CUSTOMER_TOP_SCAN_COUNT          = 30;

const STORE_CREDIT_MIN_CENTS           = 5000;   // $50
const STORE_CREDIT_IDLE_DAYS           = 30;

const EXTERNAL_PAYMENT_HIGH_OVERDUE_MIN = 10;
const EXTERNAL_PAYMENT_CRITICAL_OVERDUE_MIN = 30;

const MAX_ITEMS                        = 5;

// ── Types ─────────────────────────────────────────────────

export type AttentionDomain =
  | 'repair'
  | 'layaway'
  | 'external_payment'
  | 'customer_churn'
  | 'store_credit'
  | 'special_order';

export type AttentionUrgency = 'critical' | 'high' | 'medium' | 'low';

export interface AttentionItem {
  id: string;
  domain: AttentionDomain;
  /** Domain-native entity id (repair.id / layaway.id / customer.id / cert.id / sale.id / so.id) */
  entityId: string;
  entityName: string;
  /** Pre-rendered short reason line (already translated). */
  reason: string;
  /** Pre-rendered recommended action line (already translated). */
  recommendedAction: string;
  urgency: AttentionUrgency;
  customerId?: string;
  customerPhone?: string;
  priorityScore: number;
}

// ── Helpers ───────────────────────────────────────────────

function tsOf(d: unknown): number {
  if (!d) return 0;
  if (typeof d === 'string') { const n = new Date(d).getTime(); return Number.isFinite(n) ? n : 0; }
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'object' && d !== null) {
    const obj = d as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') { try { return obj.toDate().getTime(); } catch { return 0; } }
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return 0;
}

function daysBetween(aMs: number, bMs: number): number {
  if (!aMs || !bMs) return 0;
  return Math.max(0, Math.floor((bMs - aMs) / 86400000));
}

function statusKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '_');
}

function urgencyFromDays(days: number, critical: number, high: number, medium: number): AttentionUrgency {
  if (days >= critical) return 'critical';
  if (days >= high) return 'high';
  if (days >= medium) return 'medium';
  return 'low';
}

// ── Signal collectors (deterministic, additive — never mutate) ──

function collectRepairs(engine: IntelligenceEngine, t: ReturnType<typeof tChat>, nowMs: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  const repairs: Repair[] = engine.getRepairs() || [];
  for (const r of repairs) {
    const status = statusKey(r.status);
    if (status !== 'ready' && status !== 'complete' && status !== 'completed') continue;
    const readyAtMs = tsOf((r as any).completedAt) || tsOf(r.updatedAt) || tsOf(r.createdAt);
    if (!readyAtMs) continue;
    const days = daysBetween(readyAtMs, nowMs);
    if (days < REPAIR_MIN_DAYS_READY) continue;
    const valueCents = r.estimatedCost || r.total || 0;
    const valueWeight    = Math.floor(valueCents / 100);
    const urgencyWeight  = days >= REPAIR_URGENT_DAYS ? 300 : 100;
    const inactivityWeight = days * 2;
    const overdueWeight  = days * 10;
    const revenueRiskWeight = Math.floor((r.balance || 0) / 100);
    const priorityScore =
      valueWeight + urgencyWeight + inactivityWeight + overdueWeight + revenueRiskWeight;
    const urgency = urgencyFromDays(days, REPAIR_CRITICAL_DAYS, REPAIR_URGENT_DAYS, REPAIR_MIN_DAYS_READY);
    out.push({
      id: `repair-${r.id}`,
      domain: 'repair',
      entityId: r.id,
      entityName: r.customerName || r.device || r.id.slice(-6),
      reason: t('chat.whoNeedsAttention.repair.reason', r.customerName || '—', days, COP(valueCents)),
      recommendedAction: t('chat.whoNeedsAttention.repair.action', r.customerName || ''),
      urgency,
      customerId: r.customerId,
      customerPhone: r.customerPhone,
      priorityScore,
    });
  }
  return out;
}

function collectLayaways(engine: IntelligenceEngine, t: ReturnType<typeof tChat>, nowMs: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  const layaways: Layaway[] = engine.getLayaways() || [];
  for (const l of layaways) {
    const status = statusKey(l.status);
    if (status === 'completed' || status === 'cancelled' || status === 'forfeited' || status === 'refunded') continue;
    const lastActivityMs = tsOf(l.updatedAt) || tsOf(l.createdAt);
    if (!lastActivityMs) continue;
    const days = daysBetween(lastActivityMs, nowMs);
    if (days < LAYAWAY_STALE_DAYS) continue;
    const balance = Math.max(0, l.balance || 0);
    if (balance <= 0) continue;
    const valueWeight    = Math.floor(balance / 100);
    const urgencyWeight  = days >= LAYAWAY_URGENT_DAYS ? 250 : 100;
    const inactivityWeight = days * 2;
    const overdueWeight  = Math.max(0, days - LAYAWAY_STALE_DAYS) * 5;
    const revenueRiskWeight = valueWeight;
    const priorityScore =
      valueWeight + urgencyWeight + inactivityWeight + overdueWeight + revenueRiskWeight;
    const urgency = urgencyFromDays(days, LAYAWAY_CRITICAL_DAYS, LAYAWAY_URGENT_DAYS, LAYAWAY_STALE_DAYS);
    out.push({
      id: `layaway-${l.id}`,
      domain: 'layaway',
      entityId: l.id,
      entityName: l.customerName || l.id.slice(-6),
      reason: t('chat.whoNeedsAttention.layaway.reason', l.customerName || '—', days, COP(balance)),
      recommendedAction: t('chat.whoNeedsAttention.layaway.action', l.customerName || ''),
      urgency,
      customerId: l.customerId,
      customerPhone: l.customerPhone,
      priorityScore,
    });
  }
  return out;
}

function collectSpecialOrders(engine: IntelligenceEngine, t: ReturnType<typeof tChat>, nowMs: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  const sos: SpecialOrder[] = engine.getSpecialOrders() || [];
  for (const o of sos) {
    const status = statusKey(o.status);
    if (status !== 'received' && status !== 'ready' && status !== 'ordered') continue;
    const lastActivityMs = tsOf(o.updatedAt) || tsOf(o.createdAt);
    if (!lastActivityMs) continue;
    const days = daysBetween(lastActivityMs, nowMs);
    if (days < SO_STALE_DAYS) continue;
    const balance = Math.max(0, o.balance || 0);
    const valueWeight    = Math.floor((o.price || balance) / 100);
    const urgencyWeight  = days >= SO_URGENT_DAYS ? 200 : 80;
    const inactivityWeight = days * 2;
    const overdueWeight  = Math.max(0, days - SO_STALE_DAYS) * 4;
    const revenueRiskWeight = Math.floor(balance / 100);
    const priorityScore =
      valueWeight + urgencyWeight + inactivityWeight + overdueWeight + revenueRiskWeight;
    const urgency = urgencyFromDays(days, SO_URGENT_DAYS * 2, SO_URGENT_DAYS, SO_STALE_DAYS);
    out.push({
      id: `special-${o.id}`,
      domain: 'special_order',
      entityId: o.id,
      entityName: o.customerName || o.itemDescription || o.id.slice(-6),
      reason: t('chat.whoNeedsAttention.specialOrder.reason', o.customerName || '—', days, o.itemDescription || ''),
      recommendedAction: t('chat.whoNeedsAttention.specialOrder.action', o.customerName || ''),
      urgency,
      customerId: o.customerId,
      customerPhone: o.customerPhone,
      priorityScore,
    });
  }
  return out;
}

function collectExternalPaymentReminder(t: ReturnType<typeof tChat>, nowMs: number): AttentionItem | null {
  const due = getDueVerification(nowMs);
  if (!due) return null;
  const minutesOverdue = Math.max(0, Math.floor((nowMs - due.remindAt) / 60000));
  const valueWeight    = Math.floor((due.amountCents || 0) / 100);
  const urgencyWeight  = minutesOverdue >= EXTERNAL_PAYMENT_HIGH_OVERDUE_MIN ? 400 : 200;
  const inactivityWeight = 0;
  const overdueWeight  = minutesOverdue;
  const revenueRiskWeight = valueWeight;
  const priorityScore =
    valueWeight + urgencyWeight + inactivityWeight + overdueWeight + revenueRiskWeight;
  const urgency: AttentionUrgency =
    minutesOverdue >= EXTERNAL_PAYMENT_CRITICAL_OVERDUE_MIN ? 'critical'
    : minutesOverdue >= EXTERNAL_PAYMENT_HIGH_OVERDUE_MIN ? 'high'
    : 'medium';
  return {
    id: `ext-pay-${due.verificationId}`,
    domain: 'external_payment',
    entityId: due.saleId,
    entityName: `${due.carrier || ''} · ${due.customerName || ''}`.trim(),
    reason: t('chat.whoNeedsAttention.extPayment.reason', due.carrier || '—', minutesOverdue, COP(due.amountCents)),
    recommendedAction: t('chat.whoNeedsAttention.extPayment.action', due.carrier || ''),
    urgency,
    priorityScore,
  };
}

function collectChurnRisk(engine: IntelligenceEngine, t: ReturnType<typeof tChat>, nowMs: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  const customers: Customer[] = engine.getCustomers() || [];
  if (customers.length === 0) return out;
  // Rank scored customers by valueScore descending (deterministic).
  let scores: Array<{ customerId: string; valueScore: number; tier: string }> = [];
  try {
    scores = engine.getCustomerScores()
      .map((s) => ({ customerId: s.customerId, valueScore: s.valueScore || 0, tier: s.tier }))
      .sort((a, b) => b.valueScore - a.valueScore);
  } catch { scores = []; }
  const top = scores.slice(0, CUSTOMER_TOP_SCAN_COUNT);
  for (const s of top) {
    const history = engine.getCustomerHistory(s.customerId);
    if (!history) continue;
    const lastVisit = history.lastVisit;
    if (!lastVisit) continue;
    const days = daysBetween(lastVisit.getTime(), nowMs);
    if (days < CUSTOMER_INACTIVE_DAYS) continue;
    // R-CUSTOMER-PROFIT-PARITY-V1: CustomerHistorySummary exposes grossRevenue
    // (cents), not totalSpent. Use grossRevenue as the value signal.
    const totalSpend = history.grossRevenue || 0;
    if (totalSpend <= 0) continue;
    const valueWeight    = Math.min(150, Math.floor(totalSpend / 1000));
    const urgencyWeight  = s.tier === 'platinum' || s.tier === 'gold' ? 200 : 50;
    const inactivityWeight = Math.min(250, days * 2);
    const overdueWeight  = 0;
    const revenueRiskWeight = Math.min(100, Math.floor(totalSpend / 2000));
    const priorityScore =
      valueWeight + urgencyWeight + inactivityWeight + overdueWeight + revenueRiskWeight;
    const urgency: AttentionUrgency =
      days >= CUSTOMER_CRITICAL_INACTIVE_DAYS ? 'critical'
      : days >= CUSTOMER_INACTIVE_DAYS + 30 ? 'high'
      : 'medium';
    out.push({
      id: `churn-${s.customerId}`,
      domain: 'customer_churn',
      entityId: s.customerId,
      entityName: history.customer.name,
      reason: t('chat.whoNeedsAttention.churn.reason', history.customer.name, days, COP(totalSpend)),
      recommendedAction: t('chat.whoNeedsAttention.churn.action', history.customer.name),
      urgency,
      customerId: s.customerId,
      customerPhone: history.customer.phone || '',
      priorityScore,
    });
  }
  return out;
}

function collectStoreCredit(t: ReturnType<typeof tChat>, nowMs: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  let ledger: StoreCreditLedger[] = [];
  try {
    ledger = loadLocal<StoreCreditLedger[]>('store_credit_ledger', []) || [];
  } catch { ledger = []; }
  if (!Array.isArray(ledger) || ledger.length === 0) return out;
  for (const c of ledger) {
    if (c.status !== 'active') continue;
    const remaining = Math.max(0, c.remainingAmount || 0);
    if (remaining < STORE_CREDIT_MIN_CENTS) continue;
    const lastActivityMs = c.redemptions && c.redemptions.length > 0
      ? c.redemptions.reduce((m, r) => Math.max(m, tsOf(r.redeemedAt)), 0)
      : tsOf(c.issuedAt);
    const days = daysBetween(lastActivityMs, nowMs);
    if (days < STORE_CREDIT_IDLE_DAYS) continue;
    const valueWeight    = Math.floor(remaining / 100);
    const urgencyWeight  = 60;
    const inactivityWeight = days * 2;
    const overdueWeight  = 0;
    const revenueRiskWeight = valueWeight;
    const priorityScore =
      valueWeight + urgencyWeight + inactivityWeight + overdueWeight + revenueRiskWeight;
    const urgency: AttentionUrgency = days >= 90 ? 'high' : 'medium';
    out.push({
      id: `cert-${c.id}`,
      domain: 'store_credit',
      entityId: c.id,
      entityName: c.customerName || c.certificateNumber,
      reason: t('chat.whoNeedsAttention.storeCredit.reason', c.customerName || '—', days, COP(remaining)),
      recommendedAction: t('chat.whoNeedsAttention.storeCredit.action', c.customerName || ''),
      urgency,
      customerId: c.customerId,
      customerPhone: c.customerPhone,
      priorityScore,
    });
  }
  return out;
}

// ── Action builder ────────────────────────────────────────

function actionsFor(item: AttentionItem, t: ReturnType<typeof tChat>): ChatActionUI[] {
  const acts: ChatActionUI[] = [];
  const idBase = item.id;
  switch (item.domain) {
    case 'repair':
      acts.push({
        id: `${idBase}-open`,
        label: t('chat.whoNeedsAttention.action.openRepair'),
        payload: { type: 'review', entityId: item.entityId, executable: true, executionTarget: 'open_repair' },
      });
      if (item.customerPhone) acts.push({
        id: `${idBase}-wa`,
        label: t('chat.whoNeedsAttention.action.whatsapp'),
        actionType: 'whatsapp',
        payload: { type: 'whatsapp', customerPhone: item.customerPhone, executable: true, executionTarget: 'whatsapp_url' },
      });
      break;
    case 'layaway':
      acts.push({
        id: `${idBase}-open`,
        label: t('chat.whoNeedsAttention.action.openLayaway'),
        payload: { type: 'review', entityId: item.entityId, executable: true, executionTarget: 'open_layaway' },
      });
      if (item.customerPhone) acts.push({
        id: `${idBase}-wa`,
        label: t('chat.whoNeedsAttention.action.whatsapp'),
        actionType: 'whatsapp',
        payload: { type: 'whatsapp', customerPhone: item.customerPhone, executable: true, executionTarget: 'whatsapp_url' },
      });
      break;
    case 'special_order':
      acts.push({
        id: `${idBase}-open`,
        label: t('chat.whoNeedsAttention.action.openSpecialOrder'),
        payload: { type: 'review', entityId: item.entityId, executable: true, executionTarget: 'open_special_order' },
      });
      if (item.customerPhone) acts.push({
        id: `${idBase}-wa`,
        label: t('chat.whoNeedsAttention.action.whatsapp'),
        actionType: 'whatsapp',
        payload: { type: 'whatsapp', customerPhone: item.customerPhone, executable: true, executionTarget: 'whatsapp_url' },
      });
      break;
    case 'external_payment':
      acts.push({
        id: `${idBase}-pos`,
        label: t('chat.whoNeedsAttention.action.openPos'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'customer_churn':
      acts.push({
        id: `${idBase}-open`,
        label: t('chat.whoNeedsAttention.action.openCustomer'),
        payload: { type: 'review', entityId: item.entityId, executable: !!item.entityId, executionTarget: 'open_customer' },
      });
      if (item.customerPhone) acts.push({
        id: `${idBase}-wa`,
        label: t('chat.whoNeedsAttention.action.whatsapp'),
        actionType: 'whatsapp',
        payload: { type: 'whatsapp', customerPhone: item.customerPhone, executable: true, executionTarget: 'whatsapp_url' },
      });
      break;
    case 'store_credit':
      if (item.customerId) acts.push({
        id: `${idBase}-open`,
        label: t('chat.whoNeedsAttention.action.openCustomer'),
        payload: { type: 'review', entityId: item.customerId, executable: true, executionTarget: 'open_customer' },
      });
      if (item.customerPhone) acts.push({
        id: `${idBase}-wa`,
        label: t('chat.whoNeedsAttention.action.whatsapp'),
        actionType: 'whatsapp',
        payload: { type: 'whatsapp', customerPhone: item.customerPhone, executable: true, executionTarget: 'whatsapp_url' },
      });
      break;
  }
  return acts;
}

// ── Public entry point ────────────────────────────────────

/**
 * R-INTELLIGENCE-WHO-NEEDS-ATTENTION-TODAY
 *
 * Deterministic priority list: top 5 operational items the operator should
 * touch today, drawn from real store data only. No hallucination — every
 * item references a real entity id and existing balances/dates.
 *
 * Priority formula (cents-based, integer-safe):
 *   priorityScore =
 *       valueWeight           (entity value in dollars)
 *     + urgencyWeight         (domain-specific constant by severity tier)
 *     + inactivityWeight      (days idle × 2)
 *     + overdueWeight         (days past threshold × domain multiplier)
 *     + revenueRiskWeight     (potential loss in dollars)
 *
 * Ties broken by domain priority order, then entityId lexical order.
 */
export function handleWhoNeedsAttentionToday(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const nowMs = Date.now();

  const allCandidates: AttentionItem[] = [
    ...collectRepairs(engine, t, nowMs),
    ...collectLayaways(engine, t, nowMs),
    ...collectSpecialOrders(engine, t, nowMs),
    ...collectChurnRisk(engine, t, nowMs),
    ...collectStoreCredit(t, nowMs),
  ];

  const ext = collectExternalPaymentReminder(t, nowMs);
  if (ext) allCandidates.push(ext);

  if (allCandidates.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.whoNeedsAttention.header')}**\n\n${t('chat.whoNeedsAttention.empty')}`,
    };
  }

  // Domain priority for deterministic tie-break: external payment first
  // (time-sensitive money out of the drawer), then repairs/layaways/SO
  // (customer-facing pickups), then churn, then store credit liability.
  const DOMAIN_RANK: Record<AttentionDomain, number> = {
    external_payment: 0,
    repair: 1,
    layaway: 2,
    special_order: 3,
    customer_churn: 4,
    store_credit: 5,
  };

  allCandidates.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (DOMAIN_RANK[a.domain] !== DOMAIN_RANK[b.domain]) return DOMAIN_RANK[a.domain] - DOMAIN_RANK[b.domain];
    return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
  });

  const items = allCandidates.slice(0, MAX_ITEMS);

  const BADGE: Record<AttentionUrgency, string> = {
    critical: '🚨',
    high:     '⚠️',
    medium:   '📌',
    low:      'ℹ️',
  };

  const lines: string[] = [`**${t('chat.whoNeedsAttention.header')}**`, ''];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    lines.push(`${i + 1}. ${BADGE[it.urgency]} ${it.reason}`);
    lines.push(`   💡 ${it.recommendedAction}`);
  }

  // Continuity: set context to the first item so "open it" / "contact him"
  // / "why is she high priority" route through the existing pronoun-rewrite
  // and context-aware follow-up handlers without extra wiring. We pick the
  // domain that fits best: customer for churn/store_credit, repair for
  // repair items, otherwise customer (the entityId is a customerId-shaped
  // id for non-customer domains, which the existing follow-up handler
  // already validates before re-using).
  const first = items[0];
  const ctxType: 'customer' | 'repair' =
    first.domain === 'repair' ? 'repair' : 'customer';
  const ctxValue =
    first.domain === 'repair' ? first.entityId
    : first.customerId || first.entityId;

  const rawActions: ChatActionUI[] = [];
  for (const it of items) {
    for (const a of actionsFor(it, t)) rawActions.push(a);
  }

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(rawActions.length > 0 ? { actions: rawActions.slice(0, 8) } : {}),
    establishesContext: { type: ctxType, value: ctxValue },
  };
}
