// ============================================================
// CellHub Intelligence — Strategic Operator Intelligence
// R-INTELLIGENCE-STRATEGIC-OPERATOR-V1
//
// Deterministic strategic observation layer. Surfaces higher-level
// business tendencies based on operational data and accumulated patterns.
//
// Confidence thresholds: insight 55+, attention 65+, strategic 75+
// Max 3 insights, one per category (highest confidence wins).
// Rules: no ML, no AI prose, no predictions, no dashboards.
// ============================================================

import { isDoneRepairStatus } from '@/utils/repairStatus';
import { getTypeEffectiveness } from '../operatorQueue/outcomeLearning';
import type { TypeEffectiveness } from '../operatorQueue/outcomeLearning';
import type { StoreStateResult } from '../storeState/storeStateEngine';
import type { BusinessMemoryInsight } from '../memory/businessMemory';

// ── Types ─────────────────────────────────────────────────

export type StrategicCategory =
  | 'revenue_recovery'
  | 'sales_opportunity'
  | 'operational_efficiency'
  | 'customer_retention'
  | 'business_rhythm';

export type StrategicSeverity = 'insight' | 'attention' | 'strategic';

export interface StrategicInsight {
  category: StrategicCategory;
  severity: StrategicSeverity;
  confidence: number;        // 0–100
  title: string;
  summary: string;
  supportingSignal?: string;
  suggestedFocus?: string;
}

export interface StrategicOperatorResult {
  generatedAt: number;
  insights: StrategicInsight[];
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

export interface StrategicOperatorInput {
  storeState: StoreStateResult;
  businessMemoryInsights: BusinessMemoryInsight[];
  repairs: RepairLike[];
  layaways: LayawayLike[];
  missions: MissionLike[];
  continuityItems: ContinuityLike[];
  outreachCandidateCount: number;
  now?: number;
}

// ── Constants ──────────────────────────────────────────────

const MAX_INSIGHTS = 3;

const MIN_CONF: Record<StrategicSeverity, number> = {
  insight: 55,
  attention: 65,
  strategic: 75,
};

const SEV_RANK: Record<StrategicSeverity, number> = {
  strategic: 0, attention: 1, insight: 2,
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

function severityFor(conf: number): StrategicSeverity {
  if (conf >= MIN_CONF.strategic) return 'strategic';
  if (conf >= MIN_CONF.attention) return 'attention';
  return 'insight';
}

// ── Revenue Recovery builders ─────────────────────────────

function buildRepairRevenue(repairs: RepairLike[], now: number): StrategicInsight | null {
  const DAY = 86_400_000;

  // Uncollected balances on done repairs
  const unpaidDone = repairs.filter((r) => isDoneRepairStatus(r.status) && (r.balance || 0) > 0);
  const unpaidCents = unpaidDone.reduce((s, r) => s + (r.balance || 0), 0);

  // Active repairs aged 7+ days (strategic threshold; briefing fires at 5d)
  const active = repairs.filter((r) => !isDoneRepairStatus(r.status));
  const aged7  = active.filter((r) => {
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 7 * DAY;
  });
  const aged14 = aged7.filter((r) => {
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 14 * DAY;
  });

  // Surface only when signal is strong enough to merit a strategic insight
  if (unpaidCents < 20_000 && aged7.length < 5) return null;

  const unpaidScore = unpaidCents >= 100_000 ? 40 : unpaidCents >= 50_000 ? 30 : unpaidCents >= 20_000 ? 18 : 0;
  const agedScore   = aged7.length >= 10 ? 38 : aged7.length >= 7 ? 28 : aged7.length >= 5 ? 18 : 0;
  const confidence  = Math.min(92, 14 + unpaidScore + agedScore);

  if (confidence < MIN_CONF.insight) return null;

  const dollars = Math.round(unpaidCents / 100);
  const parts: string[] = [];
  if (unpaidCents >= 20_000) parts.push(`$${dollars} uncollected`);
  if (aged7.length >= 5)     parts.push(`${aged7.length} repairs aged 7+ days`);

  return {
    category: 'revenue_recovery',
    severity: severityFor(confidence),
    confidence,
    title: 'Repair revenue recovery opportunity',
    summary: parts.join(' — '),
    supportingSignal: aged14.length > 0 ? `${aged14.length} beyond 14 days` : `${unpaidDone.length} done repairs with balance`,
    suggestedFocus: 'repair_followup',
  };
}

function buildCollectionOpportunity(
  repairs: RepairLike[],
  layaways: LayawayLike[],
  businessMemoryInsights: BusinessMemoryInsight[],
): StrategicInsight | null {
  const unpaidLayaways = layaways.filter(
    (l) => !['completed', 'cancelled', 'forfeited'].includes(l.status ?? '') && (l.balance || 0) > 0,
  );
  const unpaidDoneRepairs = repairs.filter(
    (r) => isDoneRepairStatus(r.status) && (r.balance || 0) > 0,
  );
  const totalCents =
    unpaidLayaways.reduce((s, l) => s + (l.balance || 0), 0) +
    unpaidDoneRepairs.reduce((s, r) => s + (r.balance || 0), 0);

  const collMem = businessMemoryInsights.find((i) => i.category === 'collections');

  // Only compound when both amount is significant AND a memory pattern confirms it
  if (totalCents < 30_000 || !collMem) return null;

  const dollars = Math.round(totalCents / 100);
  const dollarScore = totalCents >= 100_000 ? 30 : totalCents >= 50_000 ? 22 : 12;
  const confidence  = Math.min(88, Math.round(collMem.confidence * 0.5 + dollarScore + 15));

  if (confidence < MIN_CONF.insight) return null;

  const count = unpaidLayaways.length + unpaidDoneRepairs.length;
  return {
    category: 'revenue_recovery',
    severity: severityFor(confidence),
    confidence,
    title: 'Payment recovery opportunity',
    summary: `$${dollars} in outstanding balances across ${count} account${count !== 1 ? 's' : ''}`,
    supportingSignal: collMem.insight,
    suggestedFocus: 'collections',
  };
}

// ── Sales Opportunity builders ────────────────────────────

function buildVipOutreachUnderutilized(
  missions: MissionLike[],
  outreachCandidateCount: number,
  storeState: StoreStateResult,
  vipEff: TypeEffectiveness,
): StrategicInsight | null {
  const vipMissions = missions.filter((m) => m.type === 'vip_outreach');
  const totalCandidates = Math.max(vipMissions.length, outreachCandidateCount);

  if (totalCandidates < 2) return null;

  const lowUtilization   = vipEff.sampleCount >= 5 && vipEff.completionRate < 0.4;
  const highCandidates   = totalCandidates >= 5;
  const isOpportunityWin = storeState.state === 'opportunity_window';

  if (!lowUtilization && !highCandidates && !isOpportunityWin) return null;

  const countScore = totalCandidates >= 7 ? 32 : totalCandidates >= 4 ? 20 : 12;
  const utilScore  = lowUtilization ? 28 : isOpportunityWin ? 22 : 8;
  const confidence = Math.min(88, 18 + countScore + utilScore);

  if (confidence < MIN_CONF.insight) return null;

  const candidateStr = outreachCandidateCount >= vipMissions.length
    ? `${outreachCandidateCount} VIP candidate${outreachCandidateCount !== 1 ? 's' : ''} available`
    : `${vipMissions.length} VIP mission${vipMissions.length !== 1 ? 's' : ''} pending`;

  return {
    category: 'sales_opportunity',
    severity: severityFor(confidence),
    confidence,
    title: 'VIP outreach opportunities underutilized',
    summary: candidateStr,
    supportingSignal: lowUtilization
      ? `${Math.round(vipEff.completionRate * 100)}% completion rate`
      : undefined,
    suggestedFocus: 'vip_outreach',
  };
}

// ── Operational Efficiency builders ──────────────────────

function buildWorkflowDisruption(
  continuityItems: ContinuityLike[],
  businessMemoryInsights: BusinessMemoryInsight[],
): StrategicInsight | null {
  const interrupted     = continuityItems.filter((c) => c.type === 'interrupted_workflow').length;
  const hasOpsMemory    = businessMemoryInsights.some((i) => i.category === 'operational');

  if (interrupted === 0 && !hasOpsMemory) return null;

  const intScore   = interrupted >= 3 ? 35 : interrupted >= 2 ? 25 : interrupted >= 1 ? 15 : 0;
  const memScore   = hasOpsMemory ? 20 : 0;
  const confidence = Math.min(86, 18 + intScore + memScore);

  if (confidence < MIN_CONF.insight) return null;

  const opsMem = businessMemoryInsights.find((i) => i.category === 'operational');
  const summary = interrupted > 0
    ? `${interrupted} workflow${interrupted !== 1 ? 's' : ''} interrupted without completion`
    : 'Pattern of operational interruptions detected';

  return {
    category: 'operational_efficiency',
    severity: severityFor(confidence),
    confidence,
    title: 'Interrupted workflows increasing',
    summary,
    supportingSignal: opsMem?.insight,
  };
}

function buildRepairQueuePressure(repairs: RepairLike[], now: number): StrategicInsight | null {
  const DAY = 86_400_000;
  const active = repairs.filter((r) => !isDoneRepairStatus(r.status));

  const aged7  = active.filter((r) => {
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 7 * DAY;
  });
  const aged14 = aged7.filter((r) => {
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 14 * DAY;
  });

  // Only strategic — briefing already covers 5-day delays
  if (aged7.length < 5) return null;

  const agedScore  = aged14.length >= 3 ? 40 : aged7.length >= 8 ? 35 : aged7.length >= 5 ? 20 : 0;
  const confidence = Math.min(90, 18 + agedScore);

  if (confidence < MIN_CONF.insight) return null;

  return {
    category: 'operational_efficiency',
    severity: severityFor(confidence),
    confidence,
    title: 'Repair queue pressure accumulating',
    summary: `${aged7.length} active repair${aged7.length !== 1 ? 's' : ''} aged 7+ days`,
    supportingSignal: aged14.length > 0 ? `${aged14.length} beyond 14 days` : undefined,
    suggestedFocus: 'repair_management',
  };
}

// ── Customer Retention builders ───────────────────────────

function buildCustomerRetention(
  missions: MissionLike[],
  businessMemoryInsights: BusinessMemoryInsight[],
  recoverEff: TypeEffectiveness,
): StrategicInsight | null {
  const recoverMissions = missions.filter((m) => m.type === 'recover_customer');
  const outreachMem     = businessMemoryInsights.find((i) => i.category === 'customer_outreach');

  // Positive: completion rate improving with sufficient sample
  if (recoverEff.sampleCount >= 8 && recoverEff.completionRate >= 0.6) {
    const confidence = Math.min(88, Math.round(recoverEff.completionRate * 100));
    if (confidence >= MIN_CONF.insight) {
      return {
        category: 'customer_retention',
        severity: severityFor(confidence),
        confidence,
        title: 'Customer recovery outreach gaining traction',
        summary: `${Math.round(recoverEff.completionRate * 100)}% completion rate on recovery outreach`,
        supportingSignal: `${recoverEff.sampleCount} outcomes tracked`,
      };
    }
  }

  // Risk: many candidates accumulating without engagement
  if (recoverMissions.length >= 5 && recoverEff.sampleCount >= 5 && recoverEff.completionRate < 0.35) {
    const confidence = Math.min(80, 30 + recoverMissions.length * 4);
    if (confidence >= MIN_CONF.insight) {
      return {
        category: 'customer_retention',
        severity: severityFor(confidence),
        confidence,
        title: 'Churn-risk customers accumulating',
        summary: `${recoverMissions.length} recovery candidate${recoverMissions.length !== 1 ? 's' : ''} without recent engagement`,
        supportingSignal: `${Math.round(recoverEff.completionRate * 100)}% completion rate`,
      };
    }
  }

  // Pattern-based: use business memory
  if (outreachMem && outreachMem.confidence >= MIN_CONF.insight) {
    return {
      category: 'customer_retention',
      severity: severityFor(outreachMem.confidence),
      confidence: outreachMem.confidence,
      title: 'Customer outreach pattern identified',
      summary: outreachMem.insight,
      supportingSignal: outreachMem.supportingSignal,
    };
  }

  return null;
}

// ── Business Rhythm builders ──────────────────────────────

function buildSlowPeriodOpportunity(
  storeState: StoreStateResult,
  businessMemoryInsights: BusinessMemoryInsight[],
): StrategicInsight | null {
  const slowMem = businessMemoryInsights.find(
    (i) => i.category === 'sales_rhythm' && i.insight.toLowerCase().includes('slow'),
  );
  const isCurrentlySlow = storeState.state === 'slow_day';

  if (!slowMem && !isCurrentlySlow) return null;

  const memConf    = slowMem?.confidence ?? 0;
  const liveBoost  = isCurrentlySlow ? 22 : 0;
  const confidence = Math.min(84, Math.max(memConf, liveBoost + (memConf > 0 ? memConf * 0.7 : 0)));

  if (confidence < MIN_CONF.insight) return null;

  return {
    category: 'business_rhythm',
    severity: severityFor(Math.round(confidence)),
    confidence: Math.round(confidence),
    title: 'Consistent slow periods identified',
    summary: slowMem?.insight ?? 'Slow sales rhythm detected',
    supportingSignal: slowMem?.supportingSignal ?? (isCurrentlySlow ? 'Currently in slow day mode' : undefined),
    suggestedFocus: 'customer_outreach',
  };
}

function buildRepairLoadRhythm(
  businessMemoryInsights: BusinessMemoryInsight[],
): StrategicInsight | null {
  const repairMem = businessMemoryInsights.find((i) => i.category === 'repairs');
  if (!repairMem || repairMem.confidence < MIN_CONF.insight) return null;

  return {
    category: 'business_rhythm',
    severity: severityFor(repairMem.confidence),
    confidence: repairMem.confidence,
    title: 'Repair workload pattern detected',
    summary: repairMem.insight,
    supportingSignal: repairMem.supportingSignal,
  };
}

// ── Main export ────────────────────────────────────────────

export function generateStrategicInsights(input: StrategicOperatorInput): StrategicOperatorResult {
  const now = input.now ?? Date.now();
  const {
    storeState, businessMemoryInsights, repairs, layaways,
    missions, continuityItems, outreachCandidateCount,
  } = input;

  // Pre-fetch effectiveness once — each call reads localStorage
  const recoverEff = getTypeEffectiveness('recover_customer');
  const vipEff     = getTypeEffectiveness('vip_outreach');

  const candidates: StrategicInsight[] = [];

  const repairRev = buildRepairRevenue(repairs, now);
  if (repairRev) candidates.push(repairRev);

  const collectionOpp = buildCollectionOpportunity(repairs, layaways, businessMemoryInsights);
  if (collectionOpp) candidates.push(collectionOpp);

  const vipOpp = buildVipOutreachUnderutilized(missions, outreachCandidateCount, storeState, vipEff);
  if (vipOpp) candidates.push(vipOpp);

  const workflow = buildWorkflowDisruption(continuityItems, businessMemoryInsights);
  if (workflow) candidates.push(workflow);

  const repairQueue = buildRepairQueuePressure(repairs, now);
  if (repairQueue) candidates.push(repairQueue);

  const retention = buildCustomerRetention(missions, businessMemoryInsights, recoverEff);
  if (retention) candidates.push(retention);

  const slowPeriod = buildSlowPeriodOpportunity(storeState, businessMemoryInsights);
  if (slowPeriod) candidates.push(slowPeriod);

  const repairRhythm = buildRepairLoadRhythm(businessMemoryInsights);
  if (repairRhythm) candidates.push(repairRhythm);

  // One insight per category — keep highest confidence per category
  const seenCategories = new Set<StrategicCategory>();
  const deduped = candidates
    .sort((a, b) => b.confidence - a.confidence)
    .filter((ins) => {
      if (seenCategories.has(ins.category)) return false;
      seenCategories.add(ins.category);
      return true;
    });

  // Final sort: severity first, then confidence; take top MAX_INSIGHTS
  const insights = deduped
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.confidence - a.confidence)
    .slice(0, MAX_INSIGHTS);

  return { generatedAt: now, insights };
}
