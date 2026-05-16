// ============================================================
// CellHub Intelligence — Operator Recommendation Engine
// R-INTELLIGENCE-DECISION-RECOMMENDATION-V1
//
// Converts strategic observations into concrete operational
// recommendations. Synthesizes: store state, focus mode,
// strategic insights, business memory, queue pressure.
//
// Rules: deterministic only, no AI prose, no automation.
// Confidence: low 50+, medium 60+, high 70+, critical 80+
// Max 3 recommendations, one per type (highest confidence).
// ============================================================

import { isDoneRepairStatus, normalizeRepairStatus } from '@/utils/repairStatus';
import type { StoreStateResult } from '../storeState/storeStateEngine';
import type { FocusModeResult } from '../focus/operatorFocusMode';
import type { StrategicInsight, StrategicCategory } from '../strategy/strategicOperator';
import type { BusinessMemoryInsight } from '../memory/businessMemory';

// ── Types ─────────────────────────────────────────────────

export type RecommendationType =
  | 'customer_actions'
  | 'sales_actions'
  | 'repair_actions'
  | 'collection_actions'
  | 'operational_actions';

export type RecommendationSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RecommendationAction =
  | 'open_missions'
  | 'open_queue'
  | 'open_repairs'
  | 'open_customers';

export interface OperatorRecommendation {
  type: RecommendationType;
  severity: RecommendationSeverity;
  confidence: number;
  title: string;
  recommendation: string;
  supportingReason: string;
  suggestedFocus?: string;
  relatedAction?: RecommendationAction;
}

export interface RecommendationResult {
  generatedAt: number;
  recommendations: OperatorRecommendation[];
}

// ── Loose input types ─────────────────────────────────────

interface RepairLike {
  status: unknown;
  balance?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface LayawayLike {
  status?: string;
  balance?: number;
}

interface MissionLike {
  type: string;
  urgencyLevel?: string;
}

interface ContinuityLike {
  type: string;
}

export interface RecommendationInput {
  storeState: StoreStateResult;
  focusMode: FocusModeResult;
  strategicInsights: StrategicInsight[];
  businessMemoryInsights: BusinessMemoryInsight[];
  continuityItems: ContinuityLike[];
  missions: MissionLike[];
  pendingQueueCount: number;
  outreachCandidateCount: number;
  repairs: RepairLike[];
  layaways: LayawayLike[];
  now?: number;
}

// ── Constants ──────────────────────────────────────────────

const MAX_RECOMMENDATIONS = 3;

const SEV_RANK: Record<RecommendationSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

// ── Helpers ────────────────────────────────────────────────

function toMs(val: unknown): number {
  if (!val) return 0;
  try {
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().getTime();
    }
    const t = new Date(val as string | Date).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

function severityFor(confidence: number): RecommendationSeverity {
  if (confidence >= 80) return 'critical';
  if (confidence >= 70) return 'high';
  if (confidence >= 60) return 'medium';
  return 'low';
}

function hasStrategicIn(insights: StrategicInsight[], category: StrategicCategory): boolean {
  return insights.some((i) => i.category === category);
}

function hasStrategicFocus(insights: StrategicInsight[], focus: string): boolean {
  return insights.some((i) => i.suggestedFocus === focus);
}

// ── Customer Actions builder ──────────────────────────────

function buildCustomerAction(
  storeState: StoreStateResult,
  businessMemoryInsights: BusinessMemoryInsight[],
  strategicInsights: StrategicInsight[],
  missions: MissionLike[],
  outreachCandidateCount: number,
): OperatorRecommendation | null {
  // Rush mode: operator focused on transactions — suppress outreach
  if (storeState.state === 'rush_mode') return null;

  const isSlowDay      = storeState.state === 'slow_day';
  const isOpWin        = storeState.state === 'opportunity_window';
  const hasVipMissions = missions.some((m) => m.type === 'vip_outreach');
  const hasRecoverMis  = missions.some((m) => m.type === 'recover_customer');
  const hasOutreachMem = businessMemoryInsights.some((i) => i.category === 'customer_outreach');
  const hasSalesIns    = hasStrategicIn(strategicInsights, 'sales_opportunity');
  const hasRetentionIns= hasStrategicIn(strategicInsights, 'customer_retention');
  const hasOutreach    = outreachCandidateCount >= 2;

  // Best case: slow day + candidates + memory confirms it
  if (isSlowDay && hasOutreach) {
    const memBoost     = hasOutreachMem ? 15 : 0;
    const missionBoost = (hasVipMissions || hasRecoverMis) ? 10 : 0;
    const confidence   = Math.min(88, 58 + memBoost + missionBoost);
    return {
      type: 'customer_actions',
      severity: severityFor(confidence),
      confidence,
      title: 'Contact customers during slow window',
      recommendation: 'Use current low-traffic period to follow up with inactive customers',
      supportingReason: `${outreachCandidateCount} outreach candidate${outreachCandidateCount !== 1 ? 's' : ''} available`,
      suggestedFocus: 'outreach_focus',
      relatedAction: 'open_customers',
    };
  }

  // Opportunity window: strong signal
  if (isOpWin && hasOutreach) {
    const insBoost  = hasSalesIns ? 12 : 0;
    const memBoost  = hasOutreachMem ? 10 : 0;
    const confidence = Math.min(86, 62 + insBoost + memBoost);
    return {
      type: 'customer_actions',
      severity: severityFor(confidence),
      confidence,
      title: 'VIP outreach window open now',
      recommendation: 'Store activity is low — ideal for VIP customer engagement',
      supportingReason: `${outreachCandidateCount} high-value candidate${outreachCandidateCount !== 1 ? 's' : ''} identified`,
      suggestedFocus: 'outreach_focus',
      relatedAction: 'open_customers',
    };
  }

  // Strategic insight + active missions
  if ((hasSalesIns || hasRetentionIns) && (hasVipMissions || hasRecoverMis) && hasOutreach) {
    const memBoost  = hasOutreachMem ? 12 : 0;
    const confidence = Math.min(82, 52 + memBoost);
    if (confidence >= 50) {
      return {
        type: 'customer_actions',
        severity: severityFor(confidence),
        confidence,
        title: 'Prioritize customer outreach today',
        recommendation: 'Conditions favor outreach — contact inactive customers while manageable',
        supportingReason: `${outreachCandidateCount} candidate${outreachCandidateCount !== 1 ? 's' : ''} ready for contact`,
        suggestedFocus: 'outreach_focus',
        relatedAction: 'open_customers',
      };
    }
  }

  return null;
}

// ── Sales Actions builder ─────────────────────────────────

function buildSalesAction(
  storeState: StoreStateResult,
  businessMemoryInsights: BusinessMemoryInsight[],
  strategicInsights: StrategicInsight[],
  missions: MissionLike[],
): OperatorRecommendation | null {
  if (storeState.state === 'rush_mode') return null;

  const isSlowDay      = storeState.state === 'slow_day';
  const isOpWin        = storeState.state === 'opportunity_window';
  const hasSalesIns    = hasStrategicIn(strategicInsights, 'sales_opportunity');
  const hasRhythmIns   = hasStrategicIn(strategicInsights, 'business_rhythm');
  const hasSlowMem     = businessMemoryInsights.some(
    (i) => i.category === 'sales_rhythm' && i.insight.toLowerCase().includes('slow'),
  );
  const promMissions   = missions.filter((m) => m.type === 'product_promotion');

  // Opportunity window with promotion missions ready
  if (isOpWin && promMissions.length >= 1) {
    const confidence = Math.min(84, 65 + (hasSalesIns ? 12 : 0));
    return {
      type: 'sales_actions',
      severity: severityFor(confidence),
      confidence,
      title: 'Leverage current outreach window',
      recommendation: 'Run product promotions or customer campaigns during low-traffic period',
      supportingReason: `${promMissions.length} promotion campaign${promMissions.length !== 1 ? 's' : ''} ready`,
      suggestedFocus: 'outreach_focus',
      relatedAction: 'open_missions',
    };
  }

  // Slow day + promotion missions + business rhythm insight
  if (isSlowDay && promMissions.length >= 1) {
    const memBoost  = hasSlowMem ? 14 : 0;
    const insBoost  = hasRhythmIns ? 10 : 0;
    const confidence = Math.min(80, 52 + memBoost + insBoost);
    if (confidence >= 50) {
      return {
        type: 'sales_actions',
        severity: severityFor(confidence),
        confidence,
        title: 'Promote products during slow period',
        recommendation: 'Use low-traffic window to run product promotions and accessory upsells',
        supportingReason: `${promMissions.length} campaign${promMissions.length !== 1 ? 's' : ''} ready · consistent slow rhythm detected`,
        suggestedFocus: 'outreach_focus',
        relatedAction: 'open_missions',
      };
    }
  }

  return null;
}

// ── Repair Actions builder ────────────────────────────────

function buildRepairAction(
  storeState: StoreStateResult,
  strategicInsights: StrategicInsight[],
  repairs: RepairLike[],
  now: number,
): OperatorRecommendation | null {
  const DAY            = 86_400_000;
  const isOverload     = storeState.state === 'repair_overload';
  const hasRepairIns   = hasStrategicFocus(strategicInsights, 'repair_management');
  const hasRepairRevIns= hasStrategicFocus(strategicInsights, 'repair_followup');

  const active  = repairs.filter((r) => !isDoneRepairStatus(r.status));
  const delayed5 = active.filter((r) => {
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 5 * DAY;
  });
  const readyOld = repairs.filter((r) => {
    if (normalizeRepairStatus(r.status) !== 'ready') return false;
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 2 * DAY;
  });

  // Repair overload state: high-priority action
  if (isOverload) {
    const confidence = Math.min(92, 70 + (hasRepairIns ? 14 : 0));
    return {
      type: 'repair_actions',
      severity: 'critical',
      confidence,
      title: 'Reduce repair backlog today',
      recommendation: 'Prioritize clearing delayed repair tickets before backlog grows further',
      supportingReason: `${delayed5.length} repair${delayed5.length !== 1 ? 's' : ''} overdue 5+ days`,
      suggestedFocus: 'repair_focus',
      relatedAction: 'open_repairs',
    };
  }

  // Ready repairs needing pickup contact
  if (readyOld.length >= 1) {
    const countScore = readyOld.length >= 4 ? 28 : readyOld.length >= 2 ? 18 : 10;
    const revBoost   = hasRepairRevIns ? 14 : 0;
    const confidence = Math.min(84, 46 + countScore + revBoost);
    if (confidence >= 50) {
      return {
        type: 'repair_actions',
        severity: severityFor(confidence),
        confidence,
        title: 'Contact ready-for-pickup customers',
        recommendation: `Notify ${readyOld.length} customer${readyOld.length !== 1 ? 's' : ''} that their repair is ready`,
        supportingReason: `${readyOld.length} repair${readyOld.length !== 1 ? 's' : ''} waiting 2+ days for pickup`,
        suggestedFocus: 'repair_focus',
        relatedAction: 'open_repairs',
      };
    }
  }

  // Delayed backlog growing
  if (delayed5.length >= 3 || hasRepairIns) {
    const countScore = delayed5.length >= 7 ? 28 : delayed5.length >= 5 ? 20 : delayed5.length >= 3 ? 12 : 0;
    const insBoost   = hasRepairIns ? 16 : 0;
    const confidence = Math.min(82, 38 + countScore + insBoost);
    if (confidence >= 50) {
      return {
        type: 'repair_actions',
        severity: severityFor(confidence),
        confidence,
        title: 'Prioritize delayed repairs',
        recommendation: 'Address aging repair tickets to prevent customer escalation',
        supportingReason: `${delayed5.length} repair${delayed5.length !== 1 ? 's' : ''} delayed 5+ days`,
        suggestedFocus: 'repair_focus',
        relatedAction: 'open_repairs',
      };
    }
  }

  return null;
}

// ── Collection Actions builder ────────────────────────────

function buildCollectionAction(
  businessMemoryInsights: BusinessMemoryInsight[],
  strategicInsights: StrategicInsight[],
  focusMode: FocusModeResult,
  repairs: RepairLike[],
  layaways: LayawayLike[],
  now: number,
): OperatorRecommendation | null {
  const unpaidDone    = repairs.filter((r) => isDoneRepairStatus(r.status) && (r.balance || 0) > 0);
  const unpaidLayaway = layaways.filter(
    (l) => !['completed', 'cancelled', 'forfeited'].includes(l.status ?? '') && (l.balance || 0) > 0,
  );
  const totalCents    =
    unpaidDone.reduce((s, r) => s + (r.balance || 0), 0) +
    unpaidLayaway.reduce((s, l) => s + (l.balance || 0), 0);
  const count = unpaidDone.length + unpaidLayaway.length;

  const hasCollIns    = hasStrategicFocus(strategicInsights, 'collections');
  const hasCollMem    = businessMemoryInsights.some((i) => i.category === 'collections');
  const isFocused     = focusMode.mode === 'collection_focus';

  if (totalCents < 10_000 && !hasCollIns) return null;

  // Early week boost — collections memory often shows Mon-Wed is strongest
  const dayOfWeek  = new Date(now).getDay();
  const isEarlyWk  = dayOfWeek >= 1 && dayOfWeek <= 3;

  const dollars = Math.round(totalCents / 100);
  const amtScore  = totalCents >= 100_000 ? 32 : totalCents >= 50_000 ? 22 : totalCents >= 10_000 ? 12 : 0;
  const memScore  = hasCollMem ? 14 : 0;
  const wkScore   = isEarlyWk && hasCollMem ? 10 : 0;
  const focScore  = isFocused ? 8 : 0;
  const insScore  = hasCollIns ? 14 : 0;
  const confidence = Math.min(90, 28 + amtScore + memScore + wkScore + focScore + insScore);

  if (confidence < 50) return null;

  const timing = isEarlyWk && hasCollMem
    ? 'Collection recovery is strongest early in the week'
    : `$${dollars} in outstanding balances`;

  return {
    type: 'collection_actions',
    severity: severityFor(confidence),
    confidence,
    title: 'Prioritize payment collection',
    recommendation: `Follow up on ${count} unpaid account${count !== 1 ? 's' : ''} — $${dollars} recoverable`,
    supportingReason: timing,
    suggestedFocus: 'collection_focus',
    relatedAction: 'open_customers',
  };
}

// ── Operational Actions builder ───────────────────────────

function buildOperationalAction(
  storeState: StoreStateResult,
  focusMode: FocusModeResult,
  strategicInsights: StrategicInsight[],
  continuityItems: ContinuityLike[],
  pendingQueueCount: number,
): OperatorRecommendation | null {
  const isRush       = storeState.state === 'rush_mode';
  const hasOpsIns    = hasStrategicIn(strategicInsights, 'operational_efficiency');
  const isExecFocus  = focusMode.mode === 'execution_focus';
  const interrupted  = continuityItems.filter((c) => c.type === 'interrupted_workflow').length;

  // Rush + task backlog: clear queue recommendation
  if (isRush && pendingQueueCount >= 3) {
    const confidence = Math.min(90, 66 + Math.min(pendingQueueCount * 3, 20));
    return {
      type: 'operational_actions',
      severity: 'critical',
      confidence,
      title: 'Focus on task execution during rush',
      recommendation: 'Prioritize completing pending tasks — defer non-urgent outreach until activity slows',
      supportingReason: `${pendingQueueCount} tasks pending during rush mode`,
      suggestedFocus: 'execution_focus',
      relatedAction: 'open_queue',
    };
  }

  // Interrupted workflows need resolution
  if (interrupted >= 1 && (interrupted >= 2 || hasOpsIns)) {
    const intScore  = interrupted >= 3 ? 28 : interrupted >= 2 ? 18 : 10;
    const insBoost  = hasOpsIns ? 18 : 0;
    const confidence = Math.min(86, 34 + intScore + insBoost);
    if (confidence >= 50) {
      return {
        type: 'operational_actions',
        severity: severityFor(confidence),
        confidence,
        title: 'Resolve interrupted workflows',
        recommendation: `Complete ${interrupted} interrupted workflow${interrupted !== 1 ? 's' : ''} before starting new tasks`,
        supportingReason: 'Unfinished workflows increase operational overhead',
        suggestedFocus: 'execution_focus',
        relatedAction: 'open_queue',
      };
    }
  }

  // Execution focus + high queue: clear backlog
  if (isExecFocus && pendingQueueCount >= 4) {
    const confidence = Math.min(80, 52 + Math.min(pendingQueueCount * 3, 24));
    if (confidence >= 50) {
      return {
        type: 'operational_actions',
        severity: severityFor(confidence),
        confidence,
        title: 'Clear task backlog this session',
        recommendation: 'Queue depth is elevated — focus on completing pending tasks before new ones enter',
        supportingReason: `${pendingQueueCount} tasks in queue`,
        suggestedFocus: 'execution_focus',
        relatedAction: 'open_queue',
      };
    }
  }

  return null;
}

// ── Main export ────────────────────────────────────────────

export function generateRecommendations(input: RecommendationInput): RecommendationResult {
  const now = input.now ?? Date.now();
  const {
    storeState, focusMode, strategicInsights, businessMemoryInsights,
    continuityItems, missions, pendingQueueCount, outreachCandidateCount,
    repairs, layaways,
  } = input;

  // Collect one candidate per type — each builder returns best-case or null
  const candidates: OperatorRecommendation[] = [];

  const custRec = buildCustomerAction(storeState, businessMemoryInsights, strategicInsights, missions, outreachCandidateCount);
  if (custRec) candidates.push(custRec);

  const salesRec = buildSalesAction(storeState, businessMemoryInsights, strategicInsights, missions);
  if (salesRec) candidates.push(salesRec);

  const repairRec = buildRepairAction(storeState, strategicInsights, repairs, now);
  if (repairRec) candidates.push(repairRec);

  const collRec = buildCollectionAction(businessMemoryInsights, strategicInsights, focusMode, repairs, layaways, now);
  if (collRec) candidates.push(collRec);

  const opsRec = buildOperationalAction(storeState, focusMode, strategicInsights, continuityItems, pendingQueueCount);
  if (opsRec) candidates.push(opsRec);

  // Sort: severity first, then confidence; take top MAX_RECOMMENDATIONS
  const recommendations = candidates
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.confidence - a.confidence)
    .slice(0, MAX_RECOMMENDATIONS);

  return { generatedAt: now, recommendations };
}
