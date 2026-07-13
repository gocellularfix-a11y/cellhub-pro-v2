import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { CustomerScore } from '../scoring/CustomerScorer';
// R-INTEL-V2-PHASE15-OUTCOME-LEARNING: bounded advisory influence built from
// the outreach outcomes the owner already records. Neutral (empty map) when
// there is insufficient evidence — ranking then matches pre-Phase-15 output.
import {
  getOutreachLearningModifiers,
  type OutreachLearningModifier,
} from '../outreach/outreachLearningInfluence';

export interface ContactTodayCandidate {
  customerId: string;
  name: string;
  phone: string;
  grossRevenue: number;
  visitCount: number;
  daysSinceLastVisit: number;
  repairCount: number;
  rankScore: number;
  /** R-INTEL-V2-PHASE15: deterministic base score (pre-learning), preserved. */
  baseScore: number;
  /** R-INTEL-V2-PHASE15: present only when learning influenced this row. */
  learning?: {
    multiplier: number;
    reason: OutreachLearningModifier['reason'];
    observationCount: number;
  };
}

export interface ContactTodayRanking {
  top: ContactTodayCandidate[];
  highSpenderThreshold: number;
}

// Ranks customers for same-day outreach.
// Base formula: grossRevenue/100 + daysSinceLastVisit*2 + visitCount*10.
// R-INTEL-V2-PHASE15: rankScore = baseScore × bounded learning multiplier
// ([0.85, 1.15], neutral 1 without sufficient recorded-outcome evidence).
// Prefers inactive 14+ day pool; falls back to full pool if <3 qualify.
// highSpenderThreshold = 75th percentile of grossRevenue across the full
// candidate set (not just the pool — keeps the threshold stable).
// learningModifiers is injectable for tests; production callers get the
// store-backed default (same pattern as getTopActionsToday's learning wire).
export function rankContactTodayCandidates(
  scores: CustomerScore[],
  engine: IntelligenceEngine,
  learningModifiers: Map<string, OutreachLearningModifier> = getOutreachLearningModifiers(),
): ContactTodayRanking {
  const consentById = new Map(
    engine.getCustomers().map((c) => [c.id, c.communicationConsent]),
  );
  const now = Date.now();
  const candidates: ContactTodayCandidate[] = [];

  for (const cs of scores) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h) continue;
    const phone = h.customer.phone || '';
    if (!phone) continue;
    if (consentById.get(cs.customerId) === false) continue;
    if (h.visitCount < 1) continue;
    if (!h.lastVisit) continue;
    const daysSinceLastVisit = Math.max(
      0,
      Math.floor((now - h.lastVisit.getTime()) / 86400000),
    );
    const baseScore = (h.grossRevenue / 100) + daysSinceLastVisit * 2 + h.visitCount * 10;
    // R-INTEL-V2-PHASE15: bounded advisory influence — base preserved, the
    // multiplier can gently reorder but never dominate (hard-capped ±15%).
    const mod = learningModifiers.get(cs.customerId);
    const rankScore = mod ? baseScore * mod.multiplier : baseScore;
    candidates.push({
      customerId: cs.customerId,
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit,
      repairCount: h.linkedEntities?.repairCount || 0,
      rankScore,
      baseScore,
      ...(mod
        ? {
            learning: {
              multiplier: mod.multiplier,
              reason: mod.reason,
              observationCount: mod.observationCount,
            },
          }
        : {}),
    });
  }

  const inactivePool = candidates.filter((c) => c.daysSinceLastVisit >= 14);
  const pool = inactivePool.length >= 3 ? inactivePool : candidates;

  const sortedSpend = candidates.map((c) => c.grossRevenue).sort((a, b) => a - b);
  const q3Index = Math.max(0, Math.floor(sortedSpend.length * 0.75));
  const highSpenderThreshold = sortedSpend[q3Index] || 0;

  const top = pool.slice().sort((a, b) => b.rankScore - a.rankScore).slice(0, 3);

  return { top, highSpenderThreshold };
}
