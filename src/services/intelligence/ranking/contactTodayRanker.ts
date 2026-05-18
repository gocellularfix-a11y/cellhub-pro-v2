import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { CustomerScore } from '../scoring/CustomerScorer';

export interface ContactTodayCandidate {
  customerId: string;
  name: string;
  phone: string;
  grossRevenue: number;
  visitCount: number;
  daysSinceLastVisit: number;
  repairCount: number;
  rankScore: number;
}

export interface ContactTodayRanking {
  top: ContactTodayCandidate[];
  highSpenderThreshold: number;
}

// Ranks customers for same-day outreach.
// Formula: grossRevenue/100 + daysSinceLastVisit*2 + visitCount*10.
// Prefers inactive 14+ day pool; falls back to full pool if <3 qualify.
// highSpenderThreshold = 75th percentile of grossRevenue across the full
// candidate set (not just the pool — keeps the threshold stable).
export function rankContactTodayCandidates(
  scores: CustomerScore[],
  engine: IntelligenceEngine,
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
    const rankScore = (h.grossRevenue / 100) + daysSinceLastVisit * 2 + h.visitCount * 10;
    candidates.push({
      customerId: cs.customerId,
      name: h.customer.name,
      phone,
      grossRevenue: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit,
      repairCount: h.linkedEntities?.repairCount || 0,
      rankScore,
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
