// ============================================================
// CellHub Intelligence — Operational Health Engine
// R-INTELLIGENCE-OPERATIONAL-HEALTH-V1
//
// Deterministic operational condition scoring. Measures
// execution quality and business pressure across 5 dimensions.
//
// Scores are grounded in real operational data only — no fake
// precision, no AI wellness, no gamification.
//
// Score bands: 0–39 critical | 40–59 weak | 60–79 stable | 80–100 strong
// Rules: no ML, no predictions, no new event system.
// ============================================================

import { isDoneRepairStatus, normalizeRepairStatus } from '@/utils/repairStatus';
import { getTypeEffectiveness } from '../operatorQueue/outcomeLearning';
import type { StoreStateResult } from '../storeState/storeStateEngine';
import type { BusinessMemoryInsight } from '../memory/businessMemory';
import type { StrategicInsight } from '../strategy/strategicOperator';
import type { OperatorRecommendation } from '../recommendations/operatorRecommendations';

// ── Types ─────────────────────────────────────────────────

export type HealthDimensionKey =
  | 'execution_health'
  | 'customer_health'
  | 'repair_health'
  | 'collection_health'
  | 'operational_stability';

export type HealthStatus = 'critical' | 'weak' | 'stable' | 'strong';

export interface HealthDimension {
  dimension: HealthDimensionKey;
  score: number;        // 0–100
  status: HealthStatus;
  reason: string;
}

export interface OperationalHealthResult {
  overallScore: number;
  overallStatus: HealthStatus;
  dimensions: HealthDimension[];
  strongestArea?: HealthDimensionKey;
  weakestArea?: HealthDimensionKey;
  summary: string;
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

interface ManagerQueueLike {
  status: string;
  createdAt: number;
}

interface ContinuityLike {
  type: string;
}

interface MissionLike {
  type: string;
}

export interface HealthInput {
  storeState: StoreStateResult;
  businessMemoryInsights: BusinessMemoryInsight[];
  strategicInsights: StrategicInsight[];
  recommendations: OperatorRecommendation[];
  repairs: RepairLike[];
  layaways: LayawayLike[];
  managerQueueItems: ManagerQueueLike[];
  continuityItems: ContinuityLike[];
  missions: MissionLike[];
  pendingQueueCount: number;
  outreachCandidateCount: number;
  now?: number;
}

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

function statusFor(score: number): HealthStatus {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'stable';
  if (score >= 40) return 'weak';
  return 'critical';
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// ── Dimension scorers ──────────────────────────────────────

// Execution Health — measures workflow completion and queue pressure.
function scoreExecution(
  continuityItems: ContinuityLike[],
  pendingQueueCount: number,
  managerQueueItems: ManagerQueueLike[],
  now: number,
): HealthDimension {
  const interrupted    = continuityItems.filter((c) => c.type === 'interrupted_workflow').length;
  const staleApprovals = managerQueueItems.filter(
    (i) => i.status === 'pending' && now - i.createdAt >= 24 * 3600_000,
  ).length;

  // Start at 100, subtract pressure signals
  let score = 100;

  // Interrupted workflows — each one drains execution health
  if (interrupted >= 3)      score -= 35;
  else if (interrupted === 2) score -= 22;
  else if (interrupted === 1) score -= 12;

  // Pending queue depth
  if (pendingQueueCount >= 8)      score -= 30;
  else if (pendingQueueCount >= 5) score -= 18;
  else if (pendingQueueCount >= 3) score -= 10;

  // Stale manager approvals
  if (staleApprovals >= 3)       score -= 20;
  else if (staleApprovals >= 1)  score -= 10;

  score = clamp(score);

  const reasons: string[] = [];
  if (interrupted > 0)      reasons.push(`${interrupted} interrupted workflow${interrupted !== 1 ? 's' : ''}`);
  if (pendingQueueCount > 0) reasons.push(`${pendingQueueCount} pending tasks`);
  if (staleApprovals > 0)   reasons.push(`${staleApprovals} stale approval${staleApprovals !== 1 ? 's' : ''}`);
  const reason = reasons.length > 0 ? reasons.join(' · ') : 'Execution flowing normally';

  return { dimension: 'execution_health', score, status: statusFor(score), reason };
}

// Customer Health — measures outreach performance and churn-risk management.
function scoreCustomer(
  missions: MissionLike[],
  outreachCandidateCount: number,
  businessMemoryInsights: BusinessMemoryInsight[],
): HealthDimension {
  const recoverEff = getTypeEffectiveness('recover_customer');
  const vipEff     = getTypeEffectiveness('vip_outreach');

  // Base: healthy outreach performance
  let score = 70;

  // Positive: good outcome rates boost score
  if (recoverEff.sampleCount >= 5) {
    score += recoverEff.completionRate >= 0.6 ? 15 : recoverEff.completionRate >= 0.4 ? 5 : -10;
  }
  if (vipEff.sampleCount >= 5) {
    score += vipEff.completionRate >= 0.6 ? 10 : vipEff.completionRate >= 0.4 ? 3 : -8;
  }

  // Accumulating uncontacted candidates = mild pressure
  const totalCandidates = Math.max(
    missions.filter((m) => m.type === 'recover_customer' || m.type === 'vip_outreach').length,
    outreachCandidateCount,
  );
  if (totalCandidates >= 10)     score -= 18;
  else if (totalCandidates >= 5) score -= 8;

  // Business memory outreach insight boosts health (pattern identified = system working)
  if (businessMemoryInsights.some((i) => i.category === 'customer_outreach')) score += 8;

  score = clamp(score);

  let reason: string;
  if (score >= 80)       reason = 'Customer outreach performing well';
  else if (score >= 60)  reason = totalCandidates >= 5 ? `${totalCandidates} outreach candidates pending` : 'Outreach activity normal';
  else if (score >= 40)  reason = 'Low outreach completion rate detected';
  else                   reason = 'Customer engagement significantly below expected';

  return { dimension: 'customer_health', score, status: statusFor(score), reason };
}

// Repair Health — measures repair backlog and pickup rate.
function scoreRepairs(repairs: RepairLike[], now: number): HealthDimension {
  const DAY   = 86_400_000;
  const active = repairs.filter((r) => !isDoneRepairStatus(r.status));

  const delayed5  = active.filter((r) => {
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 5 * DAY;
  });
  const delayed10 = delayed5.filter((r) => {
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 10 * DAY;
  });
  const readyOld  = repairs.filter((r) => {
    if (normalizeRepairStatus(r.status) !== 'ready') return false;
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 2 * DAY;
  });

  let score = 100;

  if (delayed10.length >= 5)      score -= 40;
  else if (delayed10.length >= 2) score -= 25;
  else if (delayed10.length >= 1) score -= 15;

  if (delayed5.length >= 8)      score -= 30;
  else if (delayed5.length >= 5) score -= 18;
  else if (delayed5.length >= 3) score -= 10;

  if (readyOld.length >= 4)      score -= 20;
  else if (readyOld.length >= 2) score -= 12;
  else if (readyOld.length >= 1) score -= 6;

  score = clamp(score);

  const reasons: string[] = [];
  if (delayed5.length > 0)  reasons.push(`${delayed5.length} delayed 5+ days`);
  if (readyOld.length > 0)  reasons.push(`${readyOld.length} awaiting pickup`);
  const reason = reasons.length > 0
    ? 'Repair backlog pressure: ' + reasons.join(', ')
    : 'Repair workflow healthy';

  return { dimension: 'repair_health', score, status: statusFor(score), reason };
}

// Collection Health — measures unpaid balance recovery.
function scoreCollections(repairs: RepairLike[], layaways: LayawayLike[]): HealthDimension {
  const unpaidDone    = repairs.filter((r) => isDoneRepairStatus(r.status) && (r.balance || 0) > 0);
  const unpaidLayaway = layaways.filter(
    (l) => !['completed', 'cancelled', 'forfeited'].includes(l.status ?? '') && (l.balance || 0) > 0,
  );
  const totalCents =
    unpaidDone.reduce((s, r) => s + (r.balance || 0), 0) +
    unpaidLayaway.reduce((s, l) => s + (l.balance || 0), 0);
  const count = unpaidDone.length + unpaidLayaway.length;

  let score = 100;

  // Outstanding balance is the primary pressure signal
  if (totalCents >= 200_000)      score -= 45; // $2000+
  else if (totalCents >= 100_000) score -= 32; // $1000+
  else if (totalCents >= 50_000)  score -= 20; // $500+
  else if (totalCents >= 20_000)  score -= 10; // $200+

  // Count of open accounts (each is a recovery task)
  if (count >= 10)      score -= 20;
  else if (count >= 5)  score -= 12;
  else if (count >= 2)  score -= 6;

  score = clamp(score);

  const dollars = Math.round(totalCents / 100);
  const reason = count > 0
    ? `$${dollars} outstanding across ${count} account${count !== 1 ? 's' : ''}`
    : 'No outstanding balances';

  return { dimension: 'collection_health', score, status: statusFor(score), reason };
}

// Operational Stability — measures store-level pressure and mode coherence.
function scoreStability(
  storeState: StoreStateResult,
  businessMemoryInsights: BusinessMemoryInsight[],
  strategicInsights: StrategicInsight[],
): HealthDimension {
  let score = 85; // default stable

  // Acute state pressure
  if (storeState.state === 'rush_mode')       score -= 15;
  if (storeState.state === 'repair_overload') score -= 20;
  if (storeState.state === 'collection_mode') score -= 12;
  if (storeState.state === 'slow_day')        score -= 10;

  // Strategic insight pressure — each active strategic concern lowers stability
  const criticalInsights = strategicInsights.filter((i) => i.severity === 'strategic').length;
  const attentionInsights = strategicInsights.filter((i) => i.severity === 'attention').length;
  score -= criticalInsights * 10;
  score -= attentionInsights * 5;

  // Business memory patterns add mild stability (signals the system is learning)
  const richMemory = businessMemoryInsights.length >= 2;
  if (richMemory) score += 5;

  score = clamp(score);

  let reason: string;
  if (storeState.state === 'rush_mode')       reason = 'Rush mode active — elevated transaction pressure';
  else if (storeState.state === 'repair_overload') reason = 'Repair overload affecting stability';
  else if (storeState.state === 'slow_day')   reason = 'Below-pace sales rhythm detected';
  else if (score >= 80)                       reason = 'Operations running smoothly';
  else if (criticalInsights > 0)              reason = `${criticalInsights} strategic concern${criticalInsights !== 1 ? 's' : ''} requiring attention`;
  else                                        reason = 'Mild operational pressure detected';

  return { dimension: 'operational_stability', score, status: statusFor(score), reason };
}

// ── Main export ────────────────────────────────────────────

const DIMENSION_LABEL: Record<HealthDimensionKey, string> = {
  execution_health:      'Execution',
  customer_health:       'Customer Outreach',
  repair_health:         'Repair Backlog',
  collection_health:     'Collections',
  operational_stability: 'Operational Stability',
};

// Dimension weights for overall score (sum = 1.0)
const WEIGHTS: Record<HealthDimensionKey, number> = {
  execution_health:      0.25,
  customer_health:       0.20,
  repair_health:         0.25,
  collection_health:     0.15,
  operational_stability: 0.15,
};

export function generateOperationalHealth(input: HealthInput): OperationalHealthResult {
  const now = input.now ?? Date.now();
  const {
    storeState, businessMemoryInsights, strategicInsights, recommendations: _rec,
    repairs, layaways, managerQueueItems, continuityItems, missions,
    pendingQueueCount, outreachCandidateCount,
  } = input;
  void _rec; // reserved for future recommendation-driven health adjustments

  const dims: HealthDimension[] = [
    scoreExecution(continuityItems, pendingQueueCount, managerQueueItems, now),
    scoreCustomer(missions, outreachCandidateCount, businessMemoryInsights),
    scoreRepairs(repairs, now),
    scoreCollections(repairs, layaways),
    scoreStability(storeState, businessMemoryInsights, strategicInsights),
  ];

  // Weighted overall score
  const overallScore = clamp(
    dims.reduce((sum, d) => sum + d.score * WEIGHTS[d.dimension], 0),
  );
  const overallStatus = statusFor(overallScore);

  // Strongest and weakest
  const sorted = [...dims].sort((a, b) => b.score - a.score);
  const strongestArea = sorted[0].score >= 70 ? sorted[0].dimension : undefined;
  const weakestArea   = sorted[sorted.length - 1].score < 70 ? sorted[sorted.length - 1].dimension : undefined;

  // Summary sentence
  const statusWord =
    overallStatus === 'strong'   ? 'Strong'
    : overallStatus === 'stable' ? 'Stable'
    : overallStatus === 'weak'   ? 'Under Pressure'
    : 'Critical';

  const weakLabel = weakestArea ? DIMENSION_LABEL[weakestArea] : null;
  const strongLabel = strongestArea ? DIMENSION_LABEL[strongestArea] : null;

  let summary = `Operations ${statusWord} (${overallScore})`;
  if (weakLabel && overallStatus !== 'strong') summary += ` — ${weakLabel} needs attention`;
  else if (strongLabel && overallStatus === 'strong') summary += ` — ${strongLabel} performing well`;

  return { overallScore, overallStatus, dimensions: dims, strongestArea, weakestArea, summary };
}

export { DIMENSION_LABEL };
