// ============================================================
// CellHub Intelligence — Weekly Operator Review
// R-INTELLIGENCE-WEEKLY-REVIEW-V1
//
// Deterministic weekly operational reflection. Compares this
// week (last 7d) vs prev week (7–14d) using accumulated
// businessMemory events. Falls back to current health scores
// when event history is sparse.
//
// Rules: no ML, no AI prose, no predictions, max 5 items.
// Confidence threshold: 60. Items sorted: attention → positive → neutral.
// ============================================================

import { getTypeEffectiveness } from '../operatorQueue/outcomeLearning';
import { readBusinessMemoryStore } from '../memory/businessMemory';
import type { StoreStateEvent, TaskOutcomeEvent } from '../memory/businessMemory';
import type { OperationalHealthResult, HealthDimensionKey } from '../health/operationalHealth';
import type { BusinessMemoryInsight } from '../memory/businessMemory';
import type { StrategicInsight } from '../strategy/strategicOperator';
import type { OperatorRecommendation } from '../recommendations/operatorRecommendations';

// ── Types ─────────────────────────────────────────────────

export type ReviewCategory =
  | 'execution_review'
  | 'customer_review'
  | 'repair_review'
  | 'collection_review'
  | 'rhythm_review';

export type ReviewSeverity = 'positive' | 'neutral' | 'attention';

export type WeekStatus = 'difficult' | 'mixed' | 'stable' | 'strong';

export interface WeeklyReviewItem {
  category: ReviewCategory;
  severity: ReviewSeverity;
  confidence: number;
  summary: string;
  supportingSignal?: string;
}

export interface WeeklyReviewResult {
  generatedAt: number;
  overallWeekStatus: WeekStatus;
  strongestArea?: HealthDimensionKey;
  weakestArea?: HealthDimensionKey;
  reviewItems: WeeklyReviewItem[];
  nextWeekFocus?: string;
}

export interface WeeklyReviewInput {
  operationalHealth: OperationalHealthResult;
  businessMemoryInsights: BusinessMemoryInsight[];
  strategicInsights: StrategicInsight[];
  recommendations: OperatorRecommendation[];
  continuityItemCount: number;
  pendingQueueCount: number;
  outreachCandidateCount: number;
  now?: number;
}

// ── Constants ──────────────────────────────────────────────

const DAY = 86_400_000;
const MIN_CONFIDENCE = 60;
const MAX_ITEMS = 5;

const SEV_RANK: Record<ReviewSeverity, number> = {
  attention: 0, positive: 1, neutral: 2,
};

// ── Helpers ────────────────────────────────────────────────

function thisWeekEvents<T extends { ts: number }>(events: T[], now: number): T[] {
  return events.filter((e) => e.ts >= now - 7 * DAY);
}

function prevWeekEvents<T extends { ts: number }>(events: T[], now: number): T[] {
  return events.filter((e) => e.ts >= now - 14 * DAY && e.ts < now - 7 * DAY);
}

function weekStatus(score: number): WeekStatus {
  if (score >= 78) return 'strong';
  if (score >= 65) return 'stable';
  if (score >= 50) return 'mixed';
  return 'difficult';
}

// ── Weekly cache ───────────────────────────────────────────
// Caches the result for 1 hour so repeated renders on the same session
// don't recompute. Busted when refreshKey changes (caller controls that
// by passing now as a different value, or simply not using the cache).

const CACHE_KEY = 'cellhub:intelligence:weeklyReviewCache:v1';
const CACHE_TTL = 3600_000; // 1 hour

interface CacheEntry { result: WeeklyReviewResult; cachedAt: number; }

function readCache(now: number): WeeklyReviewResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (now - entry.cachedAt > CACHE_TTL) return null;
    return entry.result;
  } catch { return null; }
}

function writeCache(result: WeeklyReviewResult, now: number): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ result, cachedAt: now }));
  } catch {}
}

// ── Category builders ──────────────────────────────────────

function buildExecutionReview(
  taskEvents: TaskOutcomeEvent[],
  executionScore: number,
  continuityItemCount: number,
  pendingQueueCount: number,
  now: number,
): WeeklyReviewItem | null {
  const tw = thisWeekEvents(taskEvents, now);
  const pw = prevWeekEvents(taskEvents, now);

  const twCompleted = tw.filter((e) => e.status === 'completed').length;
  const twTotal     = tw.length;
  const pwCompleted = pw.filter((e) => e.status === 'completed').length;
  const pwTotal     = pw.length;

  const twRate = twTotal >= 3 ? twCompleted / twTotal : null;
  const pwRate = pwTotal >= 3 ? pwCompleted / pwTotal : null;

  // Week-over-week comparison when data is available
  if (twRate !== null && pwRate !== null) {
    const delta = twRate - pwRate;
    const confidence = Math.min(90, 60 + twTotal * 2);

    if (delta >= 0.12) {
      return {
        category: 'execution_review', severity: 'positive', confidence,
        summary: 'Task completion rate improved this week',
        supportingSignal: `${Math.round(twRate * 100)}% vs ${Math.round(pwRate * 100)}% prior week`,
      };
    }
    if (delta <= -0.12) {
      return {
        category: 'execution_review', severity: 'attention', confidence,
        summary: 'Task completion rate declined this week',
        supportingSignal: `${Math.round(twRate * 100)}% vs ${Math.round(pwRate * 100)}% prior week`,
      };
    }
    if (twTotal >= 5) {
      return {
        category: 'execution_review', severity: 'neutral', confidence: 62,
        summary: 'Task completion rate stable this week',
        supportingSignal: `${Math.round(twRate * 100)}% across ${twTotal} tasks`,
      };
    }
  }

  // Fall back to health score + live signals
  if (executionScore < 55 || continuityItemCount >= 2 || pendingQueueCount >= 6) {
    return {
      category: 'execution_review', severity: 'attention', confidence: 65,
      summary: 'Execution quality under pressure this week',
      supportingSignal: continuityItemCount >= 2 ? `${continuityItemCount} interrupted workflows` : `${pendingQueueCount} tasks pending`,
    };
  }
  if (executionScore >= 82) {
    return {
      category: 'execution_review', severity: 'positive', confidence: 62,
      summary: 'Execution workflow running smoothly this week',
      supportingSignal: 'Low queue depth and interruptions',
    };
  }

  return null;
}

function buildCustomerReview(
  taskEvents: TaskOutcomeEvent[],
  customerScore: number,
  outreachCandidateCount: number,
  now: number,
): WeeklyReviewItem | null {
  const outreachTypes = new Set(['recover_customer', 'vip_outreach']);
  const tw = thisWeekEvents(taskEvents, now).filter((e) => outreachTypes.has(e.type));
  const pw = prevWeekEvents(taskEvents, now).filter((e) => outreachTypes.has(e.type));

  const twCompleted = tw.filter((e) => e.status === 'completed').length;
  const pwCompleted = pw.filter((e) => e.status === 'completed').length;

  // Compare outreach volume (more completions this week = improving engagement)
  if (tw.length >= 3 && pw.length >= 3) {
    const twRate = twCompleted / tw.length;
    const pwRate = pwCompleted / pw.length;
    const delta  = twRate - pwRate;
    const confidence = Math.min(88, 60 + tw.length * 3);

    if (delta >= 0.15) {
      return {
        category: 'customer_review', severity: 'positive', confidence,
        summary: 'Customer outreach completion improving this week',
        supportingSignal: `${Math.round(twRate * 100)}% completion vs ${Math.round(pwRate * 100)}% prior week`,
      };
    }
    if (delta <= -0.15) {
      return {
        category: 'customer_review', severity: 'attention', confidence,
        summary: 'Customer outreach completion declined this week',
        supportingSignal: `${Math.round(twRate * 100)}% completion vs ${Math.round(pwRate * 100)}% prior week`,
      };
    }
  }

  // Outcome learning — all-time effectiveness
  const recoverEff = getTypeEffectiveness('recover_customer');
  const vipEff     = getTypeEffectiveness('vip_outreach');
  const lowOutreach = recoverEff.completionRate < 0.35 && recoverEff.sampleCount >= 5;
  const highCandidates = outreachCandidateCount >= 7;

  if (highCandidates && lowOutreach) {
    return {
      category: 'customer_review', severity: 'attention', confidence: 68,
      summary: 'High-value customers accumulating without outreach',
      supportingSignal: `${outreachCandidateCount} candidates · ${Math.round(recoverEff.completionRate * 100)}% completion rate`,
    };
  }
  if (customerScore >= 82 && (recoverEff.sampleCount >= 8 || vipEff.sampleCount >= 8)) {
    return {
      category: 'customer_review', severity: 'positive', confidence: 64,
      summary: 'Customer engagement performing well this week',
      supportingSignal: 'Consistent outreach completion rate',
    };
  }
  if (customerScore < 55) {
    return {
      category: 'customer_review', severity: 'attention', confidence: 64,
      summary: 'Customer outreach activity below expected this week',
      supportingSignal: outreachCandidateCount > 0 ? `${outreachCandidateCount} candidates waiting` : undefined,
    };
  }

  return null;
}

function buildRepairReview(
  stateEvents: StoreStateEvent[],
  repairScore: number,
  now: number,
): WeeklyReviewItem | null {
  const tw = thisWeekEvents(stateEvents, now).filter((e) => e.state === 'repair_overload');
  const pw = prevWeekEvents(stateEvents, now).filter((e) => e.state === 'repair_overload');

  if (tw.length >= 2 || pw.length >= 2) {
    const confidence = Math.min(88, 60 + Math.max(tw.length, pw.length) * 6);

    if (tw.length < pw.length && pw.length >= 2) {
      return {
        category: 'repair_review', severity: 'positive', confidence,
        summary: 'Repair backlog pressure reduced this week',
        supportingSignal: `${pw.length} overload period${pw.length !== 1 ? 's' : ''} → ${tw.length} this week`,
      };
    }
    if (tw.length > pw.length && tw.length >= 2) {
      return {
        category: 'repair_review', severity: 'attention', confidence,
        summary: 'Repair backlog pressure increased this week',
        supportingSignal: `${tw.length} overload period${tw.length !== 1 ? 's' : ''} detected`,
      };
    }
    if (tw.length >= 3) {
      return {
        category: 'repair_review', severity: 'neutral', confidence: 64,
        summary: 'Consistent repair workload this week',
        supportingSignal: `${tw.length} overload periods`,
      };
    }
  }

  // Health score fallback
  if (repairScore < 50) {
    return {
      category: 'repair_review', severity: 'attention', confidence: 66,
      summary: 'Repair follow-ups remain delayed this week',
    };
  }
  if (repairScore >= 85) {
    return {
      category: 'repair_review', severity: 'positive', confidence: 63,
      summary: 'Repair workflow healthy this week',
      supportingSignal: 'Low backlog and minimal pickup delays',
    };
  }

  return null;
}

function buildCollectionReview(
  stateEvents: StoreStateEvent[],
  collectionScore: number,
  now: number,
): WeeklyReviewItem | null {
  const tw = thisWeekEvents(stateEvents, now).filter((e) => e.state === 'collection_mode');
  const pw = prevWeekEvents(stateEvents, now).filter((e) => e.state === 'collection_mode');

  if (tw.length >= 2 || pw.length >= 2) {
    const confidence = Math.min(86, 60 + Math.max(tw.length, pw.length) * 5);

    if (tw.length < pw.length && pw.length >= 2) {
      return {
        category: 'collection_review', severity: 'positive', confidence,
        summary: 'Collection recovery activity improved this week',
        supportingSignal: `Collection pressure reduced from prior week`,
      };
    }
    if (tw.length > pw.length || tw.length >= 3) {
      return {
        category: 'collection_review', severity: 'attention', confidence,
        summary: 'Outstanding balance pressure elevated this week',
        supportingSignal: `${tw.length} high-collection period${tw.length !== 1 ? 's' : ''} this week`,
      };
    }
  }

  // Health score fallback — only surface meaningful observations
  if (collectionScore < 52) {
    return {
      category: 'collection_review', severity: 'attention', confidence: 65,
      summary: 'Layaway and repair balance recovery needs attention',
    };
  }
  if (collectionScore >= 86) {
    return {
      category: 'collection_review', severity: 'positive', confidence: 63,
      summary: 'Collection recovery activity strong this week',
      supportingSignal: 'Low outstanding balance pressure',
    };
  }

  return null;
}

function buildRhythmReview(
  stateEvents: StoreStateEvent[],
  stabilityScore: number,
  businessMemoryInsights: BusinessMemoryInsight[],
  now: number,
): WeeklyReviewItem | null {
  const twRush = thisWeekEvents(stateEvents, now).filter((e) => e.state === 'rush_mode').length;
  const pwRush = prevWeekEvents(stateEvents, now).filter((e) => e.state === 'rush_mode').length;
  const twSlow = thisWeekEvents(stateEvents, now).filter((e) => e.state === 'slow_day').length;
  const pwSlow = prevWeekEvents(stateEvents, now).filter((e) => e.state === 'slow_day').length;

  // Rush patterns
  if (twRush >= 3) {
    const confidence = Math.min(86, 62 + twRush * 4);
    const dayBucket = stateEvents
      .filter((e) => e.state === 'rush_mode' && e.ts >= now - 7 * DAY);
    const dayCounts = new Array<number>(7).fill(0);
    dayBucket.forEach((e) => dayCounts[e.dayOfWeek]++);
    const peakDay = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayCounts.indexOf(Math.max(...dayCounts))];

    if (twRush > pwRush + 1) {
      return {
        category: 'rhythm_review', severity: 'attention', confidence,
        summary: 'Rush periods increased this week',
        supportingSignal: `${twRush} rush periods · peak activity ${peakDay}`,
      };
    }
    return {
      category: 'rhythm_review', severity: 'neutral', confidence: 65,
      summary: 'Rush periods concentrated this week',
      supportingSignal: `${twRush} rush period${twRush !== 1 ? 's' : ''} · peak ${peakDay}`,
    };
  }

  // Slow patterns
  if (twSlow >= 3) {
    const confidence = Math.min(84, 60 + twSlow * 4);
    if (twSlow > pwSlow) {
      return {
        category: 'rhythm_review', severity: 'attention', confidence,
        summary: 'Slow periods increased this week',
        supportingSignal: `${twSlow} slow period${twSlow !== 1 ? 's' : ''} detected`,
      };
    }
  }

  // Business memory rhythm insight
  const rhythmMem = businessMemoryInsights.find((i) => i.category === 'sales_rhythm');
  if (rhythmMem && rhythmMem.confidence >= 65) {
    return {
      category: 'rhythm_review', severity: 'neutral', confidence: rhythmMem.confidence,
      summary: rhythmMem.insight,
      supportingSignal: rhythmMem.supportingSignal,
    };
  }

  // Stability score fallback
  if (stabilityScore < 55) {
    return {
      category: 'rhythm_review', severity: 'attention', confidence: 63,
      summary: 'Operational stability under pressure this week',
    };
  }
  if (stabilityScore >= 84) {
    return {
      category: 'rhythm_review', severity: 'positive', confidence: 62,
      summary: 'Operational stability solid this week',
    };
  }

  return null;
}

// ── Main export ────────────────────────────────────────────

const NEXT_WEEK_FOCUS: Record<HealthDimensionKey, string> = {
  execution_health:      'Reduce interrupted workflows and clear task queue',
  customer_health:       'Prioritize outreach to inactive high-value customers',
  repair_health:         'Clear delayed repair backlog and contact ready-for-pickup customers',
  collection_health:     'Focus on payment recovery and overdue account follow-up',
  operational_stability: 'Monitor store state pressure and stabilize workflow patterns',
};

export function generateWeeklyReview(
  input: WeeklyReviewInput,
  forceRefresh = false,
): WeeklyReviewResult {
  const now = input.now ?? Date.now();

  // Return cached result when fresh (avoids recompute on every render)
  if (!forceRefresh) {
    const cached = readCache(now);
    if (cached) return cached;
  }

  const {
    operationalHealth, businessMemoryInsights,
    continuityItemCount, pendingQueueCount, outreachCandidateCount,
  } = input;

  // Read raw event store for week-over-week analysis
  const { storeStateEvents, taskOutcomeEvents } = readBusinessMemoryStore();

  // Pull health scores by dimension key
  function dimScore(key: HealthDimensionKey): number {
    return operationalHealth.dimensions.find((d) => d.dimension === key)?.score ?? 70;
  }

  const candidates: WeeklyReviewItem[] = [];

  const exec = buildExecutionReview(taskOutcomeEvents, dimScore('execution_health'), continuityItemCount, pendingQueueCount, now);
  if (exec) candidates.push(exec);

  const cust = buildCustomerReview(taskOutcomeEvents, dimScore('customer_health'), outreachCandidateCount, now);
  if (cust) candidates.push(cust);

  const rep = buildRepairReview(storeStateEvents, dimScore('repair_health'), now);
  if (rep) candidates.push(rep);

  const coll = buildCollectionReview(storeStateEvents, dimScore('collection_health'), now);
  if (coll) candidates.push(coll);

  const rhythm = buildRhythmReview(storeStateEvents, dimScore('operational_stability'), businessMemoryInsights, now);
  if (rhythm) candidates.push(rhythm);

  // Filter by min confidence, sort: attention first → positive → neutral
  const reviewItems = candidates
    .filter((i) => i.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.confidence - a.confidence)
    .slice(0, MAX_ITEMS);

  const overallWeekStatus = weekStatus(operationalHealth.overallScore);
  const { strongestArea, weakestArea } = operationalHealth;
  const nextWeekFocus = weakestArea ? NEXT_WEEK_FOCUS[weakestArea] : undefined;

  const result: WeeklyReviewResult = {
    generatedAt: now,
    overallWeekStatus,
    strongestArea,
    weakestArea,
    reviewItems,
    nextWeekFocus,
  };

  writeCache(result, now);
  return result;
}
