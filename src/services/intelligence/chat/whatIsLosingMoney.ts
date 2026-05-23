// ============================================================
// CellHub Intelligence — What Is Losing Me Money
// R-INTELLIGENCE-WHAT-IS-LOSING-ME-MONEY
//
// Operational money-leak detection. NOT bookkeeping, NOT P&L — surfaces
// the top 1–3 OPERATIONAL leaks that are tying up cash or blocking
// revenue. Each leak is backed by real records; exposure $ is reported
// only when calculable.
//
// NO LLM, NO embeddings, NO randomness. Pure reads + integer math.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Sale, Repair, Layaway, InventoryItem, StoreCreditLedger } from '@/store/types';
import { getDueVerification } from '../paymentVerification/paymentVerificationService';
import { loadLocal } from '@/services/storage';
import { tChat, type Lang3, type ChatResponse, type ChatActionUI, COP } from './handlers';

// ── Public types ──────────────────────────────────────────

export type LossCategory =
  | 'dead_stock'
  | 'attachment_low'
  | 'repairs_stalled'
  | 'layaway_abandoned'
  | 'ext_payment_risk'
  | 'low_margin_items'
  | 'store_credit_liability';

export interface LossSignal {
  id: string;
  category: LossCategory;
  headline: string;          // pre-translated
  evidence: string;          // pre-translated, single line with numbers
  /**
   * Exposure in cents — set ONLY when the loss is dollar-quantifiable from
   * real records (e.g., sum of stuck balances). Undefined when the signal
   * is countable but not dollar-priced (e.g., attachment rate).
   */
  exposureCents?: number;
  recommendedAction: string; // pre-translated
  score: number;
  actions: ChatActionUI[];
}

// ── Tunable thresholds (all deterministic) ────────────────

const DEAD_STOCK_DAYS_NO_SALE      = 60;
const DEAD_STOCK_MIN_VALUE_CENTS   = 50_000;   // $500 tied up minimum to surface
const DEAD_STOCK_MIN_ITEM_COUNT    = 10;

const ATTACH_MIN_PHONE_SALES_TODAY = 3;
const ATTACH_RATIO_FLOOR           = 0.3;

const REPAIRS_STALE_DAYS           = 5;

const LAYAWAY_LOOKBACK_DAYS        = 14;
const LAYAWAY_MIN_COUNT            = 2;

const LOW_MARGIN_WINDOW_DAYS       = 30;
const LOW_MARGIN_RATIO_FLOOR       = 0.05;     // <5% margin per unit
const LOW_MARGIN_MIN_UNITS         = 3;        // need recurring sales

const STORE_CREDIT_LIABILITY_MIN_CENTS = 20_000; // $200 sitting
const STORE_CREDIT_LIABILITY_MIN_AGE_DAYS = 30;

const MIN_SCORE_THRESHOLD          = 30;
const MAX_LOSSES                   = 3;

// ── Helpers ───────────────────────────────────────────────

function tsOf(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'string') { const n = new Date(v).getTime(); return Number.isFinite(n) ? n : 0; }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && v !== null) {
    const obj = v as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') { try { return obj.toDate().getTime(); } catch { return 0; } }
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return 0;
}

function statusKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '_');
}

function isAccessory(category: unknown): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'accessory' || c === 'accessories';
}

function isPhone(category: unknown): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'phone' || c === 'phones';
}

function isLocalToday(ms: number, nowMs: number): boolean {
  if (!ms) return false;
  const a = new Date(ms);
  const b = new Date(nowMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Signal: dead stock value ──────────────────────────────

function collectDeadStock(inventory: InventoryItem[], sales: Sale[], t: ReturnType<typeof tChat>, nowMs: number): LossSignal | null {
  const cutoffMs = nowMs - DEAD_STOCK_DAYS_NO_SALE * 86400000;
  const soldRecently = new Set<string>();
  for (const s of (sales || [])) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (!ms || ms < cutoffMs) continue;
    for (const i of (s.items || [])) {
      const invId = (i as any).inventoryId as string | undefined;
      if (invId) soldRecently.add(invId);
    }
  }
  let valueCents = 0;
  let itemCount = 0;
  for (const inv of (inventory || [])) {
    if (!inv.id) continue;
    if ((inv.qty || 0) <= 0) continue;
    if (soldRecently.has(inv.id)) continue;
    itemCount++;
    valueCents += Math.max(0, (inv.qty || 0) * (inv.cost || 0));
  }
  if (valueCents < DEAD_STOCK_MIN_VALUE_CENTS && itemCount < DEAD_STOCK_MIN_ITEM_COUNT) return null;
  const score = Math.min(200, Math.floor(valueCents / 1000))   // $ exposure / 10 (cap 200)
              + Math.min(60, itemCount)                          // count weight
              + 40;                                              // urgency constant
  return {
    id: 'leak-dead-stock',
    category: 'dead_stock',
    headline: t('chat.whatIsLosing.headline.deadStock'),
    evidence: t('chat.whatIsLosing.evidence.deadStock', COP(valueCents), itemCount, DEAD_STOCK_DAYS_NO_SALE),
    exposureCents: valueCents,
    recommendedAction: t('chat.whatIsLosing.action.deadStock'),
    score,
    actions: [],
  };
}

// ── Signal: low accessory attachment today ────────────────

function collectAttachmentRate(sales: Sale[], t: ReturnType<typeof tChat>, nowMs: number): LossSignal | null {
  let phoneItems = 0;
  let accItems = 0;
  for (const s of (sales || [])) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (!isLocalToday(ms, nowMs)) continue;
    for (const i of (s.items || [])) {
      if (isPhone(i.category))      phoneItems += (i.qty || 1);
      if (isAccessory(i.category))  accItems   += (i.qty || 1);
    }
  }
  if (phoneItems < ATTACH_MIN_PHONE_SALES_TODAY) return null;
  const ratio = accItems / phoneItems;
  if (ratio >= ATTACH_RATIO_FLOOR) return null;
  const pct = Math.round(ratio * 100);
  // No dollar exposure — operational pattern only.
  const score = 30 + Math.round((ATTACH_RATIO_FLOOR - ratio) * 100);
  return {
    id: 'leak-attachment',
    category: 'attachment_low',
    headline: t('chat.whatIsLosing.headline.attachment'),
    evidence: t('chat.whatIsLosing.evidence.attachment', accItems, phoneItems, pct),
    recommendedAction: t('chat.whatIsLosing.action.attachment'),
    score,
    actions: [],
  };
}

// ── Signal: stalled repair pickups ────────────────────────

function collectRepairsStalled(repairs: Repair[], t: ReturnType<typeof tChat>, nowMs: number): LossSignal | null {
  let count = 0;
  let exposureCents = 0;
  for (const r of (repairs || [])) {
    const status = statusKey(r.status);
    if (status !== 'ready' && status !== 'completed' && status !== 'complete') continue;
    const readyAtMs = tsOf((r as any).completedAt) || tsOf(r.updatedAt) || tsOf(r.createdAt);
    if (!readyAtMs) continue;
    const days = Math.floor((nowMs - readyAtMs) / 86400000);
    if (days < REPAIRS_STALE_DAYS) continue;
    count++;
    exposureCents += Math.max(0, r.balance || 0);
  }
  if (count === 0) return null;
  const score = 50
    + Math.min(80, Math.floor(exposureCents / 1000))
    + Math.min(40, count * 10);
  return {
    id: 'leak-repairs-stalled',
    category: 'repairs_stalled',
    headline: t('chat.whatIsLosing.headline.repairsStalled'),
    evidence: t('chat.whatIsLosing.evidence.repairsStalled', count, COP(exposureCents)),
    exposureCents: exposureCents > 0 ? exposureCents : undefined,
    recommendedAction: t('chat.whatIsLosing.action.repairsStalled'),
    score,
    actions: [],
  };
}

// ── Signal: abandoned layaways (recent) ───────────────────

function collectLayawayAbandoned(layaways: Layaway[], t: ReturnType<typeof tChat>, nowMs: number): LossSignal | null {
  const cutoffMs = nowMs - LAYAWAY_LOOKBACK_DAYS * 86400000;
  let count = 0;
  let lockedDepositsCents = 0;
  for (const l of (layaways || [])) {
    const status = statusKey(l.status);
    if (status !== 'cancelled' && status !== 'forfeited') continue;
    const ms = tsOf((l as any).cancelledAt) || tsOf(l.updatedAt);
    if (!ms || ms < cutoffMs) continue;
    count++;
    // Forfeited deposits are kept revenue; abandoned (cancelled with refund)
    // are returned. We surface count + locked deposit total (forfeit money
    // that COULD have been a completed sale — operational red flag, not a
    // loss in the bookkeeping sense).
    if (status === 'forfeited') {
      lockedDepositsCents += Math.max(0, l.paidAmount || 0);
    }
  }
  if (count < LAYAWAY_MIN_COUNT) return null;
  const score = 35 + Math.min(40, count * 8) + Math.min(40, Math.floor(lockedDepositsCents / 1000));
  return {
    id: 'leak-layaway-abandoned',
    category: 'layaway_abandoned',
    headline: t('chat.whatIsLosing.headline.layawayAbandoned'),
    evidence: lockedDepositsCents > 0
      ? t('chat.whatIsLosing.evidence.layawayAbandonedWithDeposit', count, LAYAWAY_LOOKBACK_DAYS, COP(lockedDepositsCents))
      : t('chat.whatIsLosing.evidence.layawayAbandoned', count, LAYAWAY_LOOKBACK_DAYS),
    exposureCents: lockedDepositsCents > 0 ? lockedDepositsCents : undefined,
    recommendedAction: t('chat.whatIsLosing.action.layawayAbandoned'),
    score,
    actions: [],
  };
}

// ── Signal: external payment unresolved ───────────────────

function collectExternalPaymentRisk(t: ReturnType<typeof tChat>, nowMs: number): LossSignal | null {
  const due = getDueVerification(nowMs);
  if (!due) return null;
  const mins = Math.max(0, Math.floor((nowMs - due.remindAt) / 60000));
  const score = 60 + Math.min(60, Math.floor((due.amountCents || 0) / 1000)) + Math.min(40, Math.floor(mins / 5));
  return {
    id: `leak-ext-payment-${due.verificationId}`,
    category: 'ext_payment_risk',
    headline: t('chat.whatIsLosing.headline.extPayment'),
    evidence: t('chat.whatIsLosing.evidence.extPayment', due.carrier || '—', mins, COP(due.amountCents)),
    exposureCents: due.amountCents,
    recommendedAction: t('chat.whatIsLosing.action.extPayment'),
    score,
    actions: [],
  };
}

// ── Signal: low-margin items selling ──────────────────────

function collectLowMarginItems(inventory: InventoryItem[], sales: Sale[], t: ReturnType<typeof tChat>, nowMs: number): LossSignal | null {
  const cutoffMs = nowMs - LOW_MARGIN_WINDOW_DAYS * 86400000;
  const invById = new Map<string, InventoryItem>();
  for (const inv of (inventory || [])) if (inv.id) invById.set(inv.id, inv);

  type Agg = { name: string; units: number; revenueCents: number; costCents: number };
  const perItem = new Map<string, Agg>();
  for (const s of (sales || [])) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (!ms || ms < cutoffMs) continue;
    for (const i of (s.items || [])) {
      const invId = (i as any).inventoryId as string | undefined;
      if (!invId) continue;
      const inv = invById.get(invId);
      if (!inv) continue;
      const qty = Math.max(0, i.qty || 0);
      if (qty <= 0) continue;
      const unitPriceCents = i.price || 0;
      const unitCostCents  = inv.cost || 0;
      if (unitPriceCents <= 0) continue;
      const cur = perItem.get(invId) || { name: inv.name || invId, units: 0, revenueCents: 0, costCents: 0 };
      cur.units        += qty;
      cur.revenueCents += unitPriceCents * qty;
      cur.costCents    += unitCostCents * qty;
      perItem.set(invId, cur);
    }
  }
  let worstId: string | null = null;
  let worstRatio = Infinity;
  let worstAgg: Agg | null = null;
  for (const [id, agg] of perItem.entries()) {
    if (agg.units < LOW_MARGIN_MIN_UNITS) continue;
    if (agg.revenueCents <= 0) continue;
    const ratio = (agg.revenueCents - agg.costCents) / agg.revenueCents;
    if (ratio >= LOW_MARGIN_RATIO_FLOOR) continue;
    if (ratio < worstRatio) { worstRatio = ratio; worstId = id; worstAgg = agg; }
  }
  if (!worstAgg || !worstId) return null;
  const lostMarginCents = Math.max(0, Math.round(worstAgg.revenueCents * LOW_MARGIN_RATIO_FLOOR) - (worstAgg.revenueCents - worstAgg.costCents));
  const score = 35
    + Math.min(40, Math.round((LOW_MARGIN_RATIO_FLOOR - worstRatio) * 200))
    + Math.min(40, worstAgg.units * 4);
  return {
    id: `leak-margin-${worstId}`,
    category: 'low_margin_items',
    headline: t('chat.whatIsLosing.headline.lowMargin'),
    evidence: t('chat.whatIsLosing.evidence.lowMargin',
      worstAgg.name, worstAgg.units, Math.round(Math.max(0, worstRatio) * 100), LOW_MARGIN_WINDOW_DAYS),
    exposureCents: lostMarginCents > 0 ? lostMarginCents : undefined,
    recommendedAction: t('chat.whatIsLosing.action.lowMargin'),
    score,
    actions: [],
  };
}

// ── Signal: store credit liability sitting idle ───────────

function collectStoreCreditLiability(t: ReturnType<typeof tChat>, nowMs: number): LossSignal | null {
  let ledger: StoreCreditLedger[] = [];
  try { ledger = loadLocal<StoreCreditLedger[]>('store_credit_ledger', []) || []; }
  catch { ledger = []; }
  if (!Array.isArray(ledger) || ledger.length === 0) return null;
  let totalRemainingCents = 0;
  let count = 0;
  let oldestDays = 0;
  for (const c of ledger) {
    if (c.status !== 'active') continue;
    const rem = Math.max(0, c.remainingAmount || 0);
    if (rem <= 0) continue;
    const issuedAtMs = tsOf(c.issuedAt);
    if (!issuedAtMs) continue;
    const days = Math.floor((nowMs - issuedAtMs) / 86400000);
    if (days < STORE_CREDIT_LIABILITY_MIN_AGE_DAYS) continue;
    totalRemainingCents += rem;
    count++;
    if (days > oldestDays) oldestDays = days;
  }
  if (totalRemainingCents < STORE_CREDIT_LIABILITY_MIN_CENTS) return null;
  const score = 30 + Math.min(80, Math.floor(totalRemainingCents / 1000)) + Math.min(40, oldestDays);
  return {
    id: 'leak-store-credit',
    category: 'store_credit_liability',
    headline: t('chat.whatIsLosing.headline.storeCredit'),
    evidence: t('chat.whatIsLosing.evidence.storeCredit', COP(totalRemainingCents), count, oldestDays),
    exposureCents: totalRemainingCents,
    recommendedAction: t('chat.whatIsLosing.action.storeCredit'),
    score,
    actions: [],
  };
}

// ── Action builders ───────────────────────────────────────

function actionsFor(signal: LossSignal, t: ReturnType<typeof tChat>): ChatActionUI[] {
  const acts: ChatActionUI[] = [];
  const idBase = signal.id;
  switch (signal.category) {
    case 'dead_stock':
      acts.push({
        id: `${idBase}-inv`,
        label: t('chat.whatIsLosing.action.openDeadStock'),
        payload: { type: 'review', executable: true, executionTarget: 'open_inventory' },
      });
      break;
    case 'attachment_low':
      acts.push({
        id: `${idBase}-inv`,
        label: t('chat.whatIsLosing.action.openAccessories'),
        payload: { type: 'review', executable: true, executionTarget: 'open_inventory' },
      });
      break;
    case 'repairs_stalled':
      acts.push({
        id: `${idBase}-rep`,
        label: t('chat.whatIsLosing.action.openRepairs'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'layaway_abandoned':
      acts.push({
        id: `${idBase}-lay`,
        label: t('chat.whatIsLosing.action.openLayaways'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'ext_payment_risk':
      acts.push({
        id: `${idBase}-pos`,
        label: t('chat.whatIsLosing.action.openPos'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'low_margin_items':
      acts.push({
        id: `${idBase}-inv`,
        label: t('chat.whatIsLosing.action.openInventory'),
        payload: { type: 'review', executable: true, executionTarget: 'open_inventory' },
      });
      break;
    case 'store_credit_liability':
      acts.push({
        id: `${idBase}-credit`,
        label: t('chat.whatIsLosing.action.openCredits'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
        triggerQuery: 'who needs attention today',
      });
      break;
  }
  return acts;
}

// ── Public entry point ────────────────────────────────────

/**
 * R-INTELLIGENCE-WHAT-IS-LOSING-ME-MONEY
 *
 * Returns up to 3 deterministic operational money leaks, ranked by a
 * composite score blending dollar exposure, count, and urgency. Items
 * with no surface-able evidence are silently dropped. Empty state stays
 * honest when no signal is strong enough.
 */
export function handleWhatIsLosingMoney(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const nowMs = Date.now();

  const sales      = engine.getSales();
  const repairs    = engine.getRepairs();
  const layaways   = engine.getLayaways();
  const inventory  = engine.getInventory();

  const allSignals: LossSignal[] = [];
  const a = collectDeadStock(inventory, sales, t, nowMs);              if (a) allSignals.push(a);
  const b = collectAttachmentRate(sales, t, nowMs);                    if (b) allSignals.push(b);
  const c = collectRepairsStalled(repairs, t, nowMs);                  if (c) allSignals.push(c);
  const d = collectLayawayAbandoned(layaways, t, nowMs);               if (d) allSignals.push(d);
  const e = collectExternalPaymentRisk(t, nowMs);                       if (e) allSignals.push(e);
  const f = collectLowMarginItems(inventory, sales, t, nowMs);         if (f) allSignals.push(f);
  const g = collectStoreCreditLiability(t, nowMs);                     if (g) allSignals.push(g);

  const filtered = allSignals
    .filter((s) => s.score >= MIN_SCORE_THRESHOLD)
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_LOSSES);

  if (filtered.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.whatIsLosing.header')}**\n\n${t('chat.whatIsLosing.empty')}`,
    };
  }

  for (const s of filtered) s.actions = actionsFor(s, t);

  const lines: string[] = [`**${t('chat.whatIsLosing.header')}**`, ''];
  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i];
    lines.push(`${i + 1}. 💸 **${s.headline}**`);
    lines.push(`   📊 ${s.evidence}`);
    if (s.exposureCents !== undefined) {
      lines.push(`   💰 ${t('chat.whatIsLosing.exposureLabel', COP(s.exposureCents))}`);
    }
    lines.push(`   💡 ${s.recommendedAction}`);
  }

  const rawActions: ChatActionUI[] = [];
  for (const s of filtered) for (const a of s.actions) rawActions.push(a);

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(rawActions.length > 0 ? { actions: rawActions.slice(0, 6) } : {}),
  };
}
