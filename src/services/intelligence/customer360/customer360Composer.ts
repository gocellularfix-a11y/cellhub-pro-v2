// ============================================================
// CellHub Intelligence — Customer 360 Composer
// R-INTELLIGENCE-CUSTOMER-360
//
// READ-ONLY DETERMINISTIC AGGREGATION LAYER.
//
// This file does NOT score. It does NOT rank. It does NOT recommend.
// It is a pure composition layer that consolidates already-computed
// outputs from the existing Intelligence engines into one operational
// snapshot per customer.
//
// Engine-of-record map (per field):
//
//   profile            ← customerScoring/customerScoringEngine.ts
//                         (canonical per-customer scoring: vipScore,
//                         churnRisk, engagement, upsell, collection,
//                         tier, lastVisitAt, recommendedActions)
//
//   buyToday           ← opportunities/buyTodayRanking.ts
//                         (getCustomersMostLikelyToBuyToday — already
//                         computes per-customer opportunity, score,
//                         urgency, 6 opportunity types)
//
//   retention          ← chat/customerRetentionInsights.ts
//                         (computeRetentionInsight — already finds
//                         customers inactive ≥30d then returned)
//
//   attention          ← attention/entityPriorityEngine.ts
//                         (computeEntityAttentionPriorities — already
//                         scores per-entity attention; we filter to
//                         items that map to this customer via direct
//                         customer entity OR via repair/layaway
//                         entityId lookup)
//
//   openOperations     ← engine.getRepairs/getLayaways/getUnlocks/
//                         getSpecialOrders + workflowContinuityStore.
//                         getPendingWorkflows. Cents balance pulled
//                         from CustomerHistorySummary.linkedEntities.
//                         activeBalance (canonical aggregate).
//
//   timeline           ← IntelligenceEngine.getCustomerHistory
//                         (CustomerHistorySummary — already aggregates
//                         lastVisit / visitCount / grossRevenue with
//                         per-customer cache).
//
// What this file is NOT:
//   - NOT a new scorer
//   - NOT a new ranker
//   - NOT a new recommendation engine
//   - NOT a new threshold authority
//   - NOT a new memory/cache/persistence layer
//
// Same inputs → same snapshot. Every field is sourced from an existing
// canonical engine. When an engine doesn't surface a customer (the
// customer isn't in the BuyToday top-5, the retention window, the
// attention top-5, etc.), the corresponding snapshot field is left
// undefined — never fabricated.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type {
  Customer,
  Repair,
  Layaway,
  Unlock,
  SpecialOrder,
  Sale,
} from '@/store/types';
import type { CustomerHistorySummary } from '../types';

import {
  computeCustomerProfile,
  type CustomerScoringContext,
} from '../customerScoring/customerScoringEngine';
import type { CustomerBusinessProfile } from '../customerScoring/customerScoringTypes';

import {
  getCustomersMostLikelyToBuyToday,
  type BuyTodayCandidate,
  type Lang3 as BuyTodayLang3,
} from '../opportunities/buyTodayRanking';

import {
  computeRetentionInsight,
  type RetentionInsight,
  type ReturningCustomerSummary,
} from '../chat/customerRetentionInsights';

import {
  computeEntityAttentionPriorities,
} from '../attention/entityPriorityEngine';
import type {
  AttentionItem,
  AttentionUrgency,
  EntityAttentionResult,
} from '../attention/entityPriorityTypes';

import { getPendingWorkflows } from '../workflowContinuity/workflowContinuityStore';
import type { PendingWorkflow } from '../workflowContinuity/workflowContinuityTypes';

// ── Public types ──────────────────────────────────────────

export interface Customer360OpenOperations {
  openRepairIds: string[];
  activeLayawayIds: string[];
  pendingUnlockIds: string[];
  pendingSpecialOrderIds: string[];
  /** Aggregate outstanding balance across all service types — sourced from
   *  CustomerHistorySummary.linkedEntities.activeBalance (the canonical
   *  aggregate). Cents. */
  unpaidBalanceCents: number;
  /** Active workflow ids whose metadata.customerId matches this customer. */
  pendingWorkflowIds: string[];
}

export interface Customer360BuyToday {
  opportunityType: BuyTodayCandidate['opportunityType'];
  opportunityScore: number;
  urgency?: 'urgent' | 'active';
}

export interface Customer360Retention {
  returnedRecently: boolean;
  inactiveDaysBeforeReturn: number;
  recoveredRevenueCents: number;
}

export interface Customer360Attention {
  attentionLevel: AttentionUrgency;
  attentionReasons: string[];
}

export interface Customer360Timeline {
  lastVisitDate: Date | null;
  visitCount: number;
  totalSpentCents: number;
}

export interface Customer360Snapshot {
  customerId: string;
  customerName: string;

  /** Canonical per-customer profile from customerScoringEngine. */
  profile: CustomerBusinessProfile;

  /** Present only when the customer appears in buyTodayRanking output. */
  buyToday?: Customer360BuyToday;

  /** Present only when the customer appears in the active retention period. */
  retention?: Customer360Retention;

  /** Present only when attention engine surfaces at least one item that maps
   *  to this customer (direct or via owned repair/layaway). */
  attention?: Customer360Attention;

  /** Always present; counts may be zero. */
  openOperations: Customer360OpenOperations;

  /** Present only when engine.getCustomerHistory returned a summary. */
  timeline?: Customer360Timeline;

  /** Snapshot timestamp (ms epoch). */
  computedAt: number;
}

/**
 * Optional precomputed signals — callers that already ran any of these
 * engines hand them in to avoid duplicate scans. Mirrors the pattern
 * used by getActiveOperatorAlerts / focusToday integration.
 */
export interface Customer360Precomputed {
  buyTodayCandidates?: BuyTodayCandidate[];
  retentionInsight?: RetentionInsight;
  attentionResult?: EntityAttentionResult;
  customerHistory?: CustomerHistorySummary | null;
}

// ── Internal helpers ──────────────────────────────────────

const SEVERITY_RANK: Record<AttentionUrgency, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
};

function statusKey(s: unknown): string {
  return String(s || '').toLowerCase();
}

/** Repair is "open" when its status is not picked_up / cancelled. Mirrors
 *  the open-set used by buyTodayRanking and entityPriorityEngine. No new
 *  threshold — purely structural status filtering. */
function isOpenRepair(r: Repair): boolean {
  const s = statusKey(r.status);
  return s !== '' && s !== 'picked_up' && s !== 'cancelled' && s !== 'refunded';
}

function isOpenLayaway(l: Layaway): boolean {
  return statusKey(l.status) === 'active';
}

function isOpenUnlock(u: Unlock): boolean {
  const s = statusKey(u.status);
  return s !== '' && s !== 'completed' && s !== 'failed' && s !== 'cancelled';
}

function isOpenSpecialOrder(o: SpecialOrder): boolean {
  const s = statusKey(o.status);
  return s !== '' && s !== 'picked_up' && s !== 'cancelled';
}

/** Build a Map<entityId, customerId> for repairs + layaways + unlocks + SO
 *  so attention items keyed by entityType ('repair' / 'layaway' / etc.) can
 *  be rolled up under their owner customer. */
interface EntityCustomerIndex {
  repairCustomerByRepairId: Map<string, string>;
  layawayCustomerByLayawayId: Map<string, string>;
}

function buildEntityCustomerIndex(engine: IntelligenceEngine): EntityCustomerIndex {
  const repairCustomerByRepairId = new Map<string, string>();
  for (const r of engine.getRepairs() || []) {
    const cid = (r.customerId || '').trim();
    if (cid && r.id) repairCustomerByRepairId.set(r.id, cid);
  }
  const layawayCustomerByLayawayId = new Map<string, string>();
  for (const l of engine.getLayaways() || []) {
    const cid = (l.customerId || '').trim();
    if (cid && l.id) layawayCustomerByLayawayId.set(l.id, cid);
  }
  return { repairCustomerByRepairId, layawayCustomerByLayawayId };
}

/** True when this attention item belongs to the given customer — directly
 *  (entityType='customer') or transitively via owned repair/layaway. */
function attentionItemBelongsTo(
  item: AttentionItem,
  customerId: string,
  index: EntityCustomerIndex,
): boolean {
  if (item.entityType === 'customer') return item.entityId === customerId;
  if (item.entityType === 'repair')
    return index.repairCustomerByRepairId.get(item.entityId) === customerId;
  if (item.entityType === 'layaway')
    return index.layawayCustomerByLayawayId.get(item.entityId) === customerId;
  // 'deal' / 'approval' — no canonical mapping back to customer in current
  // entityPriorityEngine output. Left undefined rather than fabricated.
  return false;
}

function topAttentionUrgency(items: AttentionItem[]): AttentionUrgency {
  let best: AttentionUrgency = 'low';
  for (const it of items) {
    if (SEVERITY_RANK[it.urgency] < SEVERITY_RANK[best]) best = it.urgency;
  }
  return best;
}

function pendingWorkflowsForCustomer(customerId: string): PendingWorkflow[] {
  const all = getPendingWorkflows();
  const out: PendingWorkflow[] = [];
  for (const w of all) {
    const meta = w.metadata as { customerId?: unknown } | undefined;
    if (meta && typeof meta.customerId === 'string' && meta.customerId === customerId) {
      out.push(w);
    }
  }
  return out;
}

// ── Public entry point ────────────────────────────────────

/**
 * Compose a deterministic Customer 360 snapshot for one customer.
 *
 * Behavior:
 *   - Returns null when the customerId does not match any customer record.
 *   - profile is always present (the canonical scoring engine handles
 *     empty-history customers internally).
 *   - buyToday / retention / attention / timeline are present only when
 *     the underlying engine surfaces the customer. Never fabricated.
 *   - openOperations is always present; counts may be zero.
 *
 * @param engine     IntelligenceEngine instance.
 * @param customerId Customer to compose for.
 * @param lang       Language for buyTodayRanking's pre-rendered reason text.
 * @param nowMs      Override clock for tests. Defaults to Date.now().
 * @param pre        Optional precomputed signals to avoid duplicate scans.
 */
export function buildCustomer360Snapshot(
  engine: IntelligenceEngine,
  customerId: string,
  lang: BuyTodayLang3 = 'en',
  nowMs: number = Date.now(),
  pre: Customer360Precomputed = {},
): Customer360Snapshot | null {
  const customer: Customer | undefined = (engine.getCustomers() || []).find(
    (c) => c && c.id === customerId,
  );
  if (!customer) return null;

  // ── 1) Canonical profile (customerScoringEngine) ─────────
  // Pre-filter each domain array down to this customer, then call the
  // canonical scorer. No duplicate scoring — we are calling the existing
  // engine with its expected pre-filtered input contract.
  const salesForCustomer: Sale[]    = (engine.getSales() || []).filter((s) => s.customerId === customerId);
  const repairsForCustomer: Repair[] = (engine.getRepairs() || []).filter((r) => r.customerId === customerId);
  const layawaysForCustomer: Layaway[] = (engine.getLayaways() || []).filter((l) => l.customerId === customerId);
  const unlocksForCustomer: Unlock[]   = (engine.getUnlocks() || []).filter((u) => u.customerId === customerId);

  const scoringCtx: CustomerScoringContext = {
    customer,
    sales: salesForCustomer,
    repairs: repairsForCustomer,
    layaways: layawaysForCustomer,
    unlocks: unlocksForCustomer,
  };
  const profile: CustomerBusinessProfile = computeCustomerProfile(scoringCtx);

  // ── 2) BuyToday (opportunities/buyTodayRanking) ─────────
  // Only populated when this customer appears in the top-5 buy-today list.
  // No re-implementation — we read the existing ranking output.
  const buyTodayCandidates: BuyTodayCandidate[] =
    pre.buyTodayCandidates ?? getCustomersMostLikelyToBuyToday(engine, lang);
  const bt = buyTodayCandidates.find((c) => c.customerId === customerId);
  const buyToday: Customer360BuyToday | undefined = bt
    ? {
        opportunityType:  bt.opportunityType,
        opportunityScore: bt.score,
        ...(bt.urgencyLevel ? { urgency: bt.urgencyLevel } : {}),
      }
    : undefined;

  // ── 3) Retention (chat/customerRetentionInsights) ───────
  // Only populated when this customer appears in the current period's
  // returning-customer set. computeRetentionInsight already enforces
  // the inactive-≥30d + bought-in-period contract.
  const retentionInsight: RetentionInsight =
    pre.retentionInsight ?? computeRetentionInsight(engine, nowMs);
  const ret: ReturningCustomerSummary | undefined =
    retentionInsight.topReturns.find((r) => r.customerId === customerId);
  const retention: Customer360Retention | undefined = ret
    ? {
        returnedRecently:          true,
        inactiveDaysBeforeReturn:  ret.inactiveDays,
        recoveredRevenueCents:     ret.spentCentsInPeriod,
      }
    : undefined;

  // ── 4) Attention (attention/entityPriorityEngine) ───────
  // Filter the canonical attention items down to those belonging to this
  // customer (direct or via owned repair/layaway). When entityPriorityEngine
  // surfaces nothing for this customer, the field stays undefined.
  const attentionResult: EntityAttentionResult =
    pre.attentionResult ?? computeEntityAttentionPriorities(engine, lang, nowMs);
  const entityIndex = buildEntityCustomerIndex(engine);
  const ownedAttention = attentionResult.items.filter((it) =>
    attentionItemBelongsTo(it, customerId, entityIndex),
  );
  const attention: Customer360Attention | undefined = ownedAttention.length > 0
    ? {
        attentionLevel:  topAttentionUrgency(ownedAttention),
        attentionReasons: ownedAttention.map((it) => it.reason),
      }
    : undefined;

  // ── 5) Open Operations ──────────────────────────────────
  // Plain structural filters over engine accessors. No thresholds, no
  // scoring — just status-based open/closed classification. unpaidBalance
  // comes from CustomerHistorySummary.linkedEntities.activeBalance (the
  // canonical aggregate maintained by the engine).
  const customerHistory: CustomerHistorySummary | null =
    pre.customerHistory !== undefined
      ? pre.customerHistory
      : engine.getCustomerHistory(customerId);

  const openRepairIds        = repairsForCustomer.filter(isOpenRepair).map((r) => r.id);
  const activeLayawayIds     = layawaysForCustomer.filter(isOpenLayaway).map((l) => l.id);
  const pendingUnlockIds     = unlocksForCustomer.filter(isOpenUnlock).map((u) => u.id);
  const specialOrdersForCustomer: SpecialOrder[] = (engine.getSpecialOrders() || []).filter(
    (o) => o.customerId === customerId,
  );
  const pendingSpecialOrderIds = specialOrdersForCustomer.filter(isOpenSpecialOrder).map((o) => o.id);
  const pendingWorkflowIds   = pendingWorkflowsForCustomer(customerId).map((w) => w.id);
  const unpaidBalanceCents   = customerHistory?.linkedEntities?.activeBalance ?? 0;

  const openOperations: Customer360OpenOperations = {
    openRepairIds,
    activeLayawayIds,
    pendingUnlockIds,
    pendingSpecialOrderIds,
    unpaidBalanceCents,
    pendingWorkflowIds,
  };

  // ── 6) Timeline (engine.getCustomerHistory) ─────────────
  // Lightweight summary — the canonical CustomerHistorySummary already
  // owns lastVisit / visitCount / grossRevenue.
  const timeline: Customer360Timeline | undefined = customerHistory
    ? {
        lastVisitDate:    customerHistory.lastVisit,
        visitCount:       customerHistory.visitCount,
        totalSpentCents:  customerHistory.grossRevenue,
      }
    : undefined;

  return {
    customerId,
    customerName: profile.customerName,
    profile,
    ...(buyToday  ? { buyToday  } : {}),
    ...(retention ? { retention } : {}),
    ...(attention ? { attention } : {}),
    openOperations,
    ...(timeline  ? { timeline  } : {}),
    computedAt: nowMs,
  };
}
