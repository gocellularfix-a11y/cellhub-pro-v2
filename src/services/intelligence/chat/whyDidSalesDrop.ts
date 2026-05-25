// ============================================================
// CellHub Intelligence — Why Did Sales Drop
// R-INTELLIGENCE-WHY-DID-SALES-DROP
//
// Deterministic comparative diagnosis. Compares the CURRENT 7-day window
// against the prior 7-day BASELINE window and surfaces the top 1–3
// operational reasons revenue is down. Every cause is backed by a real
// metric delta — no fabricated causality, no LLM, no embeddings.
//
// Architecture is strictly additive: reads from engine getters only;
// never mutates state, never modifies tax/payment math.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Sale, Repair, InventoryItem } from '@/store/types';
import { tChat, type Lang3, type ChatResponse, type ChatActionUI, COP } from './handlers';
import {
  getWorkflowSteps,
  renderWorkflowChainText,
  getWorkflowChatActions,
} from '../workflows/workflowRecommendations';

// ── Public types ──────────────────────────────────────────

export type DropSignalCategory =
  | 'overall_revenue'
  | 'category_drop'
  | 'customer_disappearance'
  | 'accessory_attach_drop'
  | 'activation_decline'
  | 'repair_decline'
  | 'employee_decline'
  | 'product_movement_decline';

export type DropSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: optional entity link.
 * Populated ONLY for signals that point to a single concrete entity
 * (e.g., top-revenue absent customer, worst missing-mover inventory item).
 * Aggregate signals (overall_revenue, category, attachment, etc.) leave
 * this undefined so follow-ups never open a fabricated entity.
 */
export interface DropEntityRef {
  type: 'product' | 'customer';
  value: string;
}

export interface DropSignal {
  id: string;
  category: DropSignalCategory;
  headline: string;
  evidence: string;
  recommendedAction: string;
  estimatedImpactCents?: number;
  dropPct?: number;
  severity: DropSeverity;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  actions: ChatActionUI[];
  /** R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY */
  entityRef?: DropEntityRef;
}

// ── Tunable constants (deterministic) ─────────────────────

const COMPARISON_DAYS                = 7;
const MIN_BASELINE_REVENUE_CENTS     = 5_000;   // $50 baseline floor to compare against
const DROP_PCT_THRESHOLD             = 15;
const HIGH_DROP_PCT_THRESHOLD        = 40;
const CRITICAL_DROP_PCT_THRESHOLD    = 70;
const ATTACH_DROP_RATIO_TRIGGER      = 0.8;     // current attach < 80% of baseline → flag
const ATTACH_MIN_PHONE_SALES         = 3;       // need ≥3 phone sales in each period
const CUSTOMER_DISAPPEARANCE_TOP_N   = 10;
const CUSTOMER_DISAPPEARANCE_MIN     = 2;
const PRODUCT_MIN_BASELINE_UNITS     = 3;
const PRODUCT_MAX_SHOWN              = 3;
const MAX_REASONS                    = 3;
const MIN_SCORE_THRESHOLD            = 25;

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

function isAccessory(category: unknown): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'accessory' || c === 'accessories';
}

function isPhone(category: unknown): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'phone' || c === 'phones';
}

function categoryBucketName(item: { category?: unknown; phoneNumber?: string; repairId?: string; specialOrderId?: string; unlockId?: string; layawayId?: string }): string {
  const c = String(item.category || '').toLowerCase();
  if (c === 'phone_payment') return 'Phone Payments';
  if (c === 'topup' || c === 'top_up' || c === 'top-up') return 'Top-Ups';
  if (item.repairId || c === 'repair') return 'Repairs';
  if (item.unlockId || c === 'unlock') return 'Unlocks';
  if (item.specialOrderId || c === 'special_order') return 'Special Orders';
  if (item.layawayId) return 'Layaway';
  if (c === 'activation') return 'Activations';
  if (c === 'sim') return 'SIM Cards';
  if (isAccessory(c)) return 'Accessories';
  if (isPhone(c)) return 'Phones';
  return 'Products';
}

// ── Period aggregation ────────────────────────────────────

interface PeriodMetrics {
  startMs: number;
  endMs: number;
  totalRevenueCents: number;
  transactionCount: number;
  revenueByCustomer: Map<string, number>;
  revenueByCategory: Map<string, number>;
  countByCategory: Map<string, number>;
  revenueByEmployee: Map<string, number>;
  countByEmployee: Map<string, number>;
  phoneItems: number;
  accessoryItems: number;
  unitsByInventoryId: Map<string, number>;
  phonePaymentItems: number;
  repairCheckIns: number;
  repairPickups: number;
}

function emptyPeriod(startMs: number, endMs: number): PeriodMetrics {
  return {
    startMs, endMs,
    totalRevenueCents: 0,
    transactionCount: 0,
    revenueByCustomer:  new Map<string, number>(),
    revenueByCategory:  new Map<string, number>(),
    countByCategory:    new Map<string, number>(),
    revenueByEmployee:  new Map<string, number>(),
    countByEmployee:    new Map<string, number>(),
    phoneItems: 0,
    accessoryItems: 0,
    unitsByInventoryId: new Map<string, number>(),
    phonePaymentItems: 0,
    repairCheckIns: 0,
    repairPickups: 0,
  };
}

/**
 * Single-pass aggregation. Walks `sales` once; for each in-range sale,
 * route it to the appropriate period bucket. Walks `repairs` once for
 * intake/pickup counts. Memoization is the caller's responsibility — the
 * function is pure with respect to its inputs.
 */
function aggregatePeriods(
  sales: Sale[],
  repairs: Repair[],
  currentRange: { startMs: number; endMs: number },
  baselineRange: { startMs: number; endMs: number },
): { current: PeriodMetrics; baseline: PeriodMetrics } {
  const current  = emptyPeriod(currentRange.startMs, currentRange.endMs);
  const baseline = emptyPeriod(baselineRange.startMs, baselineRange.endMs);

  for (const s of sales || []) {
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (!ms) continue;
    let bucket: PeriodMetrics | null = null;
    if (ms >= currentRange.startMs && ms <= currentRange.endMs) bucket = current;
    else if (ms >= baselineRange.startMs && ms <= baselineRange.endMs) bucket = baseline;
    if (!bucket) continue;

    const total = s.total || 0;
    bucket.totalRevenueCents += total;
    bucket.transactionCount++;
    if (s.customerId) {
      bucket.revenueByCustomer.set(s.customerId, (bucket.revenueByCustomer.get(s.customerId) || 0) + total);
    }
    const emp = s.employeeName || '';
    if (emp) {
      bucket.revenueByEmployee.set(emp, (bucket.revenueByEmployee.get(emp) || 0) + total);
      bucket.countByEmployee.set(emp, (bucket.countByEmployee.get(emp) || 0) + 1);
    }
    for (const it of (s.items || [])) {
      const qty = it.qty || 1;
      const lineCents = (it.price || 0) * qty;
      const bucketName = categoryBucketName(it as any);
      bucket.revenueByCategory.set(bucketName, (bucket.revenueByCategory.get(bucketName) || 0) + lineCents);
      bucket.countByCategory.set(bucketName, (bucket.countByCategory.get(bucketName) || 0) + qty);
      if (isPhone(it.category)) bucket.phoneItems += qty;
      if (isAccessory(it.category)) bucket.accessoryItems += qty;
      if (String(it.category || '').toLowerCase() === 'phone_payment') bucket.phonePaymentItems += qty;
      const invId = (it as any).inventoryId as string | undefined;
      if (invId) bucket.unitsByInventoryId.set(invId, (bucket.unitsByInventoryId.get(invId) || 0) + qty);
    }
  }

  for (const r of repairs || []) {
    const createdMs = tsOf(r.createdAt);
    if (createdMs >= currentRange.startMs && createdMs <= currentRange.endMs) current.repairCheckIns++;
    else if (createdMs >= baselineRange.startMs && createdMs <= baselineRange.endMs) baseline.repairCheckIns++;
    // Pickup detection — completedAt OR status transitions to picked_up/completed.
    const completedMs = tsOf((r as any).completedAt) || tsOf(r.updatedAt);
    const status = String(r.status || '').toLowerCase();
    if ((status === 'picked_up' || status === 'completed' || status === 'complete') && completedMs > 0) {
      if (completedMs >= currentRange.startMs && completedMs <= currentRange.endMs) current.repairPickups++;
      else if (completedMs >= baselineRange.startMs && completedMs <= baselineRange.endMs) baseline.repairPickups++;
    }
  }

  return { current, baseline };
}

// ── Signal helpers ────────────────────────────────────────

function pctDrop(currentCents: number, baselineCents: number): number {
  if (baselineCents <= 0) return 0;
  return Math.max(0, Math.round(((baselineCents - currentCents) / baselineCents) * 100));
}

function severityFromDropPct(dropPct: number): DropSeverity {
  if (dropPct >= CRITICAL_DROP_PCT_THRESHOLD) return 'critical';
  if (dropPct >= HIGH_DROP_PCT_THRESHOLD)     return 'high';
  if (dropPct >= DROP_PCT_THRESHOLD)          return 'medium';
  return 'low';
}

// ── Signal collectors ────────────────────────────────────

function collectOverallRevenue(current: PeriodMetrics, baseline: PeriodMetrics, t: ReturnType<typeof tChat>): DropSignal | null {
  if (baseline.totalRevenueCents < MIN_BASELINE_REVENUE_CENTS) return null;
  const drop = pctDrop(current.totalRevenueCents, baseline.totalRevenueCents);
  if (drop < DROP_PCT_THRESHOLD) return null;
  const impact = Math.max(0, baseline.totalRevenueCents - current.totalRevenueCents);
  return {
    id: 'drop-overall',
    category: 'overall_revenue',
    headline: t('chat.whyDidSalesDrop.headline.overall'),
    evidence: t('chat.whyDidSalesDrop.evidence.overall',
      COP(current.totalRevenueCents), COP(baseline.totalRevenueCents), drop),
    recommendedAction: t('chat.whyDidSalesDrop.action.overall'),
    estimatedImpactCents: impact,
    dropPct: drop,
    severity: severityFromDropPct(drop),
    confidence: 'high',
    score: drop + Math.min(80, Math.floor(impact / 1000)) + 30,
    actions: [],
  };
}

function collectCategoryDrops(current: PeriodMetrics, baseline: PeriodMetrics, t: ReturnType<typeof tChat>): DropSignal | null {
  let worst: { name: string; drop: number; impact: number } | null = null;
  for (const [name, baseRev] of baseline.revenueByCategory.entries()) {
    if (baseRev < MIN_BASELINE_REVENUE_CENTS) continue;
    const curRev = current.revenueByCategory.get(name) || 0;
    const drop = pctDrop(curRev, baseRev);
    if (drop < DROP_PCT_THRESHOLD) continue;
    const impact = Math.max(0, baseRev - curRev);
    if (!worst || impact > worst.impact) {
      worst = { name, drop, impact };
    }
  }
  if (!worst) return null;
  return {
    id: `drop-category-${worst.name.replace(/\s+/g, '_').toLowerCase()}`,
    category: 'category_drop',
    headline: t('chat.whyDidSalesDrop.headline.category', worst.name),
    evidence: t('chat.whyDidSalesDrop.evidence.category', worst.name, worst.drop),
    recommendedAction: t('chat.whyDidSalesDrop.action.category', worst.name),
    estimatedImpactCents: worst.impact,
    severity: severityFromDropPct(worst.drop),
    confidence: 'high',
    score: worst.drop + Math.min(80, Math.floor(worst.impact / 1000)) + 20,
    actions: [],
  };
}

function collectCustomerDisappearance(current: PeriodMetrics, baseline: PeriodMetrics, t: ReturnType<typeof tChat>): DropSignal | null {
  // Top customers from baseline, sorted by revenue.
  const top = [...baseline.revenueByCustomer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CUSTOMER_DISAPPEARANCE_TOP_N);
  if (top.length === 0) return null;
  let missingCount = 0;
  let missingRevenue = 0;
  // R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: track the highest-revenue
  // absentee so the handler can stamp them as the active context. The list
  // is already sorted by revenue desc, so the first missing entry wins.
  let topMissingCustomerId: string | undefined;
  for (const [custId, rev] of top) {
    if (!current.revenueByCustomer.has(custId)) {
      missingCount++;
      missingRevenue += rev;
      if (topMissingCustomerId === undefined) topMissingCustomerId = custId;
    }
  }
  if (missingCount < CUSTOMER_DISAPPEARANCE_MIN) return null;
  return {
    id: 'drop-customer-disappearance',
    category: 'customer_disappearance',
    headline: t('chat.whyDidSalesDrop.headline.customers'),
    evidence: t('chat.whyDidSalesDrop.evidence.customers', missingCount, top.length),
    recommendedAction: t('chat.whyDidSalesDrop.action.customers'),
    estimatedImpactCents: missingRevenue,
    severity: missingCount >= 5 ? 'high' : 'medium',
    confidence: missingCount >= 3 ? 'high' : 'medium',
    score: 40 + missingCount * 8 + Math.min(60, Math.floor(missingRevenue / 1000)),
    actions: [],
    ...(topMissingCustomerId ? { entityRef: { type: 'customer' as const, value: topMissingCustomerId } } : {}),
  };
}

function collectAttachmentDrop(current: PeriodMetrics, baseline: PeriodMetrics, t: ReturnType<typeof tChat>): DropSignal | null {
  if (current.phoneItems < ATTACH_MIN_PHONE_SALES) return null;
  if (baseline.phoneItems < ATTACH_MIN_PHONE_SALES) return null;
  const curRate  = current.accessoryItems  / current.phoneItems;
  const baseRate = baseline.accessoryItems / baseline.phoneItems;
  if (baseRate <= 0) return null;
  if (curRate >= baseRate * ATTACH_DROP_RATIO_TRIGGER) return null;
  const curPct  = Math.round(curRate * 100);
  const basePct = Math.round(baseRate * 100);
  const drop = Math.max(0, basePct - curPct);
  // Estimated impact: phoneItems × baseRate × accessory avg revenue.
  // Use current period's avg accessory line revenue as a conservative proxy.
  const accRevenue = current.revenueByCategory.get('Accessories') || 0;
  const accUnits   = current.accessoryItems;
  const avgAccCents = accUnits > 0 ? Math.round(accRevenue / accUnits) : 0;
  const missedUnits = Math.max(0, Math.round(current.phoneItems * (baseRate - curRate)));
  const estimatedImpactCents = avgAccCents > 0 ? avgAccCents * missedUnits : undefined;
  return {
    id: 'drop-attachment',
    category: 'accessory_attach_drop',
    headline: t('chat.whyDidSalesDrop.headline.attachment'),
    evidence: t('chat.whyDidSalesDrop.evidence.attachment', basePct, curPct),
    recommendedAction: t('chat.whyDidSalesDrop.action.attachment'),
    estimatedImpactCents,
    severity: drop >= 30 ? 'high' : 'medium',
    confidence: 'high',
    score: 35 + drop + (estimatedImpactCents ? Math.min(40, Math.floor(estimatedImpactCents / 1000)) : 0),
    actions: [],
  };
}

function collectActivationDecline(current: PeriodMetrics, baseline: PeriodMetrics, t: ReturnType<typeof tChat>): DropSignal | null {
  const baseCount = baseline.phonePaymentItems;
  const curCount  = current.phonePaymentItems;
  if (baseCount < 5) return null;
  const drop = pctDrop(curCount, baseCount);
  if (drop < DROP_PCT_THRESHOLD) return null;
  const baseRev = baseline.revenueByCategory.get('Phone Payments') || 0;
  const curRev  = current.revenueByCategory.get('Phone Payments') || 0;
  const impact = Math.max(0, baseRev - curRev);
  return {
    id: 'drop-activations',
    category: 'activation_decline',
    headline: t('chat.whyDidSalesDrop.headline.activations'),
    evidence: t('chat.whyDidSalesDrop.evidence.activations', curCount, baseCount, drop),
    recommendedAction: t('chat.whyDidSalesDrop.action.activations'),
    estimatedImpactCents: impact > 0 ? impact : undefined,
    severity: severityFromDropPct(drop),
    confidence: 'high',
    score: drop + 20 + Math.min(60, Math.floor(impact / 1000)),
    actions: [],
  };
}

function collectRepairDecline(current: PeriodMetrics, baseline: PeriodMetrics, t: ReturnType<typeof tChat>): DropSignal | null {
  if (baseline.repairCheckIns < 3) return null;
  const drop = pctDrop(current.repairCheckIns, baseline.repairCheckIns);
  if (drop < DROP_PCT_THRESHOLD) return null;
  return {
    id: 'drop-repairs',
    category: 'repair_decline',
    headline: t('chat.whyDidSalesDrop.headline.repairs'),
    evidence: t('chat.whyDidSalesDrop.evidence.repairs', current.repairCheckIns, baseline.repairCheckIns, drop),
    recommendedAction: t('chat.whyDidSalesDrop.action.repairs'),
    severity: severityFromDropPct(drop),
    confidence: 'medium',
    score: drop + 15,
    actions: [],
  };
}

function collectEmployeeDecline(current: PeriodMetrics, baseline: PeriodMetrics, t: ReturnType<typeof tChat>): DropSignal | null {
  let worst: { name: string; drop: number; impact: number } | null = null;
  for (const [name, baseRev] of baseline.revenueByEmployee.entries()) {
    if (baseRev < MIN_BASELINE_REVENUE_CENTS * 2) continue; // need a real revenue base
    const curRev = current.revenueByEmployee.get(name) || 0;
    const drop = pctDrop(curRev, baseRev);
    if (drop < DROP_PCT_THRESHOLD + 10) continue; // employee drop needs larger threshold
    const impact = Math.max(0, baseRev - curRev);
    if (!worst || impact > worst.impact) worst = { name, drop, impact };
  }
  if (!worst) return null;
  return {
    id: `drop-employee-${worst.name.replace(/\s+/g, '_').toLowerCase()}`,
    category: 'employee_decline',
    headline: t('chat.whyDidSalesDrop.headline.employee', worst.name),
    evidence: t('chat.whyDidSalesDrop.evidence.employee', worst.name, worst.drop),
    recommendedAction: t('chat.whyDidSalesDrop.action.employee'),
    estimatedImpactCents: worst.impact,
    severity: severityFromDropPct(worst.drop),
    confidence: 'medium',
    score: 25 + worst.drop + Math.min(40, Math.floor(worst.impact / 1000)),
    actions: [],
  };
}

function collectProductMovementDecline(current: PeriodMetrics, baseline: PeriodMetrics, inventory: InventoryItem[], t: ReturnType<typeof tChat>): DropSignal | null {
  type Cand = { id: string; name: string; baseUnits: number; basePriceCents: number };
  const candidates: Cand[] = [];
  const invById = new Map(inventory.map((i) => [i.id, i]));
  for (const [invId, units] of baseline.unitsByInventoryId.entries()) {
    if (units < PRODUCT_MIN_BASELINE_UNITS) continue;
    const curUnits = current.unitsByInventoryId.get(invId) || 0;
    if (curUnits > 0) continue;
    const inv = invById.get(invId);
    if (!inv) continue;
    candidates.push({
      id: invId,
      name: inv.name || invId.slice(-6),
      baseUnits: units,
      basePriceCents: inv.price || 0,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.baseUnits * b.basePriceCents) - (a.baseUnits * a.basePriceCents));
  const shown = candidates.slice(0, PRODUCT_MAX_SHOWN);
  const totalLostUnits = shown.reduce((s, c) => s + c.baseUnits, 0);
  const estImpact = shown.reduce((s, c) => s + c.baseUnits * c.basePriceCents, 0);
  const names = shown.map((c) => c.name).join(', ');
  return {
    id: 'drop-product-movement',
    category: 'product_movement_decline',
    headline: t('chat.whyDidSalesDrop.headline.product'),
    evidence: t('chat.whyDidSalesDrop.evidence.product', shown.length, names, totalLostUnits),
    recommendedAction: t('chat.whyDidSalesDrop.action.product'),
    estimatedImpactCents: estImpact > 0 ? estImpact : undefined,
    severity: shown.length >= 3 ? 'high' : 'medium',
    confidence: 'medium',
    score: 30 + Math.min(50, totalLostUnits * 3) + Math.min(40, Math.floor(estImpact / 1000)),
    actions: [],
    // R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: shown[] is sorted by
    // baseline impact desc; the top item is the highest-stake missing mover.
    entityRef: { type: 'product', value: shown[0].id },
  };
}

// ── Action builder ────────────────────────────────────────

function actionsFor(signal: DropSignal, t: ReturnType<typeof tChat>): ChatActionUI[] {
  const acts: ChatActionUI[] = [];
  const idBase = signal.id;
  switch (signal.category) {
    case 'overall_revenue':
      acts.push({
        id: `${idBase}-reports`,
        label: t('chat.whyDidSalesDrop.action.openReports'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'category_drop':
      acts.push({
        id: `${idBase}-reports`,
        label: t('chat.whyDidSalesDrop.action.openReports'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'customer_disappearance':
      acts.push({
        id: `${idBase}-customers`,
        label: t('chat.whyDidSalesDrop.action.openCustomers'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      acts.push({
        id: `${idBase}-outreach`,
        label: t('chat.whyDidSalesDrop.action.runOutreach'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
        triggerQuery: 'who needs attention today',
      });
      break;
    case 'accessory_attach_drop':
      acts.push({
        id: `${idBase}-accessories`,
        label: t('chat.whyDidSalesDrop.action.openAccessories'),
        payload: { type: 'review', executable: true, executionTarget: 'open_inventory' },
      });
      break;
    case 'activation_decline':
      acts.push({
        id: `${idBase}-pos`,
        label: t('chat.whyDidSalesDrop.action.openPos'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'repair_decline':
      acts.push({
        id: `${idBase}-repairs`,
        label: t('chat.whyDidSalesDrop.action.openRepairs'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'employee_decline':
      acts.push({
        id: `${idBase}-employees`,
        label: t('chat.whyDidSalesDrop.action.openEmployees'),
        payload: { type: 'review', executable: true, executionTarget: 'queue_manager_review' },
      });
      break;
    case 'product_movement_decline':
      acts.push({
        id: `${idBase}-inventory`,
        label: t('chat.whyDidSalesDrop.action.openInventory'),
        payload: { type: 'review', executable: true, executionTarget: 'open_inventory' },
      });
      break;
  }
  return acts;
}

const SEVERITY_BADGE: Record<DropSeverity, string> = {
  critical: '🚨',
  high:     '⚠️',
  medium:   '📉',
  low:      'ℹ️',
};

// ── Public entry point ────────────────────────────────────

/**
 * R-INTELLIGENCE-WHY-DID-SALES-DROP
 *
 * Top 1–3 deterministic reasons revenue is down compared to the previous
 * comparable window. Default window: last 7 days vs prior 7 days. Every
 * signal is backed by a real metric delta; signals with weak evidence or
 * insufficient baseline data are silently dropped. Empty result returns
 * the honest "no clear operational reason" message.
 */
/**
 * R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY: structured-signal export so the
 * focus-today aggregator can consume the same drop-detection pipeline.
 * Returns the filtered + sorted signals; empty array on no-baseline or
 * not-down conditions (the caller decides what to render).
 */
export function computeDropSignals(engine: IntelligenceEngine, lang: Lang3): DropSignal[] {
  const t = tChat(lang);
  const nowMs = Date.now();
  const oneDayMs = 86400000;
  const currentRange  = { startMs: nowMs - COMPARISON_DAYS * oneDayMs, endMs: nowMs };
  const baselineRange = {
    startMs: nowMs - (COMPARISON_DAYS * 2) * oneDayMs,
    endMs:   nowMs - COMPARISON_DAYS * oneDayMs,
  };

  const sales      = engine.getSales();
  const repairs    = engine.getRepairs();
  const inventory  = engine.getInventory();

  const { current, baseline } = aggregatePeriods(sales, repairs, currentRange, baselineRange);

  if (baseline.totalRevenueCents < MIN_BASELINE_REVENUE_CENTS && baseline.transactionCount < 3) return [];
  const overallDrop = pctDrop(current.totalRevenueCents, baseline.totalRevenueCents);
  if (overallDrop < DROP_PCT_THRESHOLD) return [];

  const allSignals: DropSignal[] = [];
  const a = collectOverallRevenue(current, baseline, t);             if (a) allSignals.push(a);
  const b = collectCategoryDrops(current, baseline, t);              if (b) allSignals.push(b);
  const c = collectCustomerDisappearance(current, baseline, t);      if (c) allSignals.push(c);
  const d = collectAttachmentDrop(current, baseline, t);             if (d) allSignals.push(d);
  const e = collectActivationDecline(current, baseline, t);          if (e) allSignals.push(e);
  const f = collectRepairDecline(current, baseline, t);              if (f) allSignals.push(f);
  const g = collectEmployeeDecline(current, baseline, t);            if (g) allSignals.push(g);
  const h = collectProductMovementDecline(current, baseline, inventory, t); if (h) allSignals.push(h);

  return allSignals
    .filter((s) => s.score >= MIN_SCORE_THRESHOLD)
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_REASONS);
}

export function handleWhyDidSalesDrop(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);
  const nowMs = Date.now();
  const oneDayMs = 86400000;
  const currentRange  = { startMs: nowMs - COMPARISON_DAYS * oneDayMs, endMs: nowMs };
  const baselineRange = {
    startMs: nowMs - (COMPARISON_DAYS * 2) * oneDayMs,
    endMs:   nowMs - COMPARISON_DAYS * oneDayMs,
  };

  const sales      = engine.getSales();
  const repairs    = engine.getRepairs();

  const { current, baseline } = aggregatePeriods(sales, repairs, currentRange, baselineRange);

  if (baseline.totalRevenueCents < MIN_BASELINE_REVENUE_CENTS && baseline.transactionCount < 3) {
    return {
      kind: 'answer',
      text: `**${t('chat.whyDidSalesDrop.header')}**\n\n${t('chat.whyDidSalesDrop.noBaseline')}`,
    };
  }

  const overallDrop = pctDrop(current.totalRevenueCents, baseline.totalRevenueCents);
  if (overallDrop < DROP_PCT_THRESHOLD) {
    return {
      kind: 'answer',
      text: `**${t('chat.whyDidSalesDrop.header')}**\n\n${t('chat.whyDidSalesDrop.notDown',
        COP(current.totalRevenueCents), COP(baseline.totalRevenueCents))}`,
    };
  }

  const filtered = computeDropSignals(engine, lang);

  if (filtered.length === 0) {
    return {
      kind: 'answer',
      text: `**${t('chat.whyDidSalesDrop.header')}**\n\n${t('chat.whyDidSalesDrop.lowConfidence')}`,
    };
  }

  for (const s of filtered) s.actions = actionsFor(s, t);

  const lines: string[] = [
    `**${t('chat.whyDidSalesDrop.header')}**`,
    '',
    `📊 ${t('chat.whyDidSalesDrop.comparisonLine',
      COP(current.totalRevenueCents),
      COP(baseline.totalRevenueCents),
      overallDrop)}`,
    '',
  ];
  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i];
    lines.push(`${i + 1}. ${SEVERITY_BADGE[s.severity]} **${s.headline}**`);
    lines.push(`   📊 ${s.evidence}`);
    if (s.estimatedImpactCents !== undefined && s.estimatedImpactCents > 0) {
      lines.push(`   💰 ${t('chat.whyDidSalesDrop.impactLabel', COP(s.estimatedImpactCents))}`);
    }
    lines.push(`   💡 ${s.recommendedAction}`);
  }

  const rawActions: ChatActionUI[] = [];
  for (const s of filtered) for (const a of s.actions) rawActions.push(a);

  // R-INTELLIGENCE-AGGREGATOR-CONTEXT-CONTINUITY: top signal's entity link
  // (when present) becomes the active operational context. Only the
  // customer-disappearance and product-movement-decline collectors populate
  // entityRef — aggregate signals (overall, category, attachment, etc.)
  // leave it undefined and the handler returns no establishesContext.
  const topEntityRef = filtered[0]?.entityRef;

  // R-INTELLIGENCE-OPERATOR-WORKFLOW-CHAINING: append next-step guidance.
  // Map DropSignalCategory → workflow domain key.
  const DROP_TO_WORKFLOW: Record<DropSignalCategory, string> = {
    overall_revenue:          'period_drop_overall',
    category_drop:            'period_drop_category',
    customer_disappearance:   'period_drop_customer',
    accessory_attach_drop:    'accessory_attach',
    activation_decline:       'activation_flow',
    repair_decline:           'repair_intake',
    employee_decline:         'period_drop_employee',
    product_movement_decline: 'period_drop_product',
  };
  const workflowKey = filtered[0] ? DROP_TO_WORKFLOW[filtered[0].category] : undefined;
  // R-INTELLIGENCE-WORKFLOW-CHAIN-DEDUPE-AND-FATIGUE-GUARD: session-scoped
  // dedupe so back-to-back drop queries don't surface identical step lists.
  const dropEntityKey = topEntityRef
    ? `${topEntityRef.type}:${topEntityRef.value}`
    : undefined;
  const workflowRecs = getWorkflowSteps(
    { priorityDomain: workflowKey },
    t,
    { suppressRecentlyShown: true, entityKey: dropEntityKey },
  );
  const workflowText = renderWorkflowChainText(workflowRecs, t);
  const workflowActions = getWorkflowChatActions(workflowRecs, topEntityRef);

  return {
    kind: 'answer',
    text: lines.join('\n') + workflowText,
    ...(rawActions.length + workflowActions.length > 0
      ? { actions: [...rawActions, ...workflowActions].slice(0, 8) }
      : {}),
    ...(topEntityRef ? { establishesContext: { type: topEntityRef.type, value: topEntityRef.value } } : {}),
  };
}
