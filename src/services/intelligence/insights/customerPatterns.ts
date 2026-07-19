// ============================================================
// Business Analyst — customer patterns (I3-3 Part 7).
//
// Everything from the canonical customer profiles (Customer 360 money +
// visit metadata: transactionCount, avgDaysBetweenVisits, first/lastVisitAt).
// Deterministic thresholds, structured findings, no text.
// ============================================================

import type { StructuredQueryContext } from '../query/types';
import type { InsightFinding } from './types';

// ── exported deterministic thresholds ───────────────────────
export const FREQUENT_MIN_TX = 5;
export const FREQUENT_MAX_AVG_DAYS = 30;
export const INACTIVE_DAYS = 45;
export const LOST_DAYS = 90;
export const RETURNING_ABSENCE_DAYS = 60;
export const HIGH_VALUE_TOP_N = 3;
export const DECLINING_GAP_FACTOR = 2;

const DAY_MS = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS);
}

export function detectCustomerPatterns(ctx: StructuredQueryContext): InsightFinding[] {
  const findings: InsightFinding[] = [];
  const now = ctx.referenceDate;
  const profiles = ctx.getCustomerValueProfiles();
  const nameOf = new Map(ctx.customers.map((c) => [c.id, c.name] as const));
  const range = { startYMD: '1970-01-01', endYMD: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` };

  // High value: top N by canonical Total Collected.
  const byValue = [...profiles.entries()]
    .filter(([, p]) => p.totalCollectedCents > 0)
    .sort(([ia, a], [ib, b]) => b.totalCollectedCents - a.totalCollectedCents || ia.localeCompare(ib));
  byValue.slice(0, HIGH_VALUE_TOP_N).forEach(([id, p], i) => {
    findings.push({
      id: `customer_high_value:${id}`, kind: 'customer_high_value', severity: 'positive', confidence: 1,
      source: 'canonical_customer_money', relatedMetrics: ['total_collected'],
      dateRange: range, magnitude: p.totalCollectedCents,
      data: { customerId: id, name: nameOf.get(id) || id, rank: i + 1, totalCollectedCents: p.totalCollectedCents, transactionCount: p.transactionCount },
    });
  });

  for (const [id, p] of profiles) {
    if (p.transactionCount === 0 || !p.lastVisitAt) continue;
    const name = nameOf.get(id) || id;
    const daysSinceLast = daysBetween(now, p.lastVisitAt);
    const base = {
      source: 'canonical_customer_money' as const, dateRange: range,
      data: { customerId: id, name, daysSinceLastVisit: daysSinceLast, transactionCount: p.transactionCount, totalCollectedCents: p.totalCollectedCents },
    };

    // Frequent: many transactions, short cadence.
    if (p.transactionCount >= FREQUENT_MIN_TX
      && p.avgDaysBetweenVisits !== null && p.avgDaysBetweenVisits <= FREQUENT_MAX_AVG_DAYS) {
      findings.push({ ...base, id: `customer_frequent:${id}`, kind: 'customer_frequent', severity: 'positive', confidence: 1, relatedMetrics: ['transaction_count'], magnitude: p.transactionCount });
    }

    // Lost / inactive (mutually exclusive by threshold order).
    if (daysSinceLast >= LOST_DAYS) {
      findings.push({ ...base, id: `customer_lost:${id}`, kind: 'customer_lost', severity: 'warning', confidence: 1, relatedMetrics: ['total_collected'], magnitude: p.totalCollectedCents });
    } else if (daysSinceLast >= INACTIVE_DAYS) {
      findings.push({ ...base, id: `customer_inactive:${id}`, kind: 'customer_inactive', severity: 'information', confidence: 1, relatedMetrics: ['total_collected'], magnitude: p.totalCollectedCents });
    } else if (p.avgDaysBetweenVisits !== null && p.avgDaysBetweenVisits > 0
      && daysSinceLast > p.avgDaysBetweenVisits * DECLINING_GAP_FACTOR) {
      // Declining: still active, but the current gap is far beyond their cadence.
      findings.push({ ...base, id: `customer_declining:${id}`, kind: 'customer_declining', severity: 'opportunity', confidence: 0.8, relatedMetrics: ['transaction_count'], magnitude: daysSinceLast });
    }

    // Returning after a long absence: last visit is recent, and the gap
    // between their last two visits (exact attributed activity) was long.
    if (daysSinceLast <= 7 && p.visitCount >= 2 && p.firstVisitAt) {
      const priorTimes = (ctx.snapshot.sales || [])
        .filter((s) => (s.customerId && s.customerId === id) || (s.customerPhone && ctx.customers.find((c) => c.id === id)?.phone === s.customerPhone))
        .map((s) => new Date(s.createdAt as unknown as string).getTime())
        .filter((t) => !isNaN(t) && t < (p.lastVisitAt as Date).getTime())
        .sort((a, b) => b - a);
      if (priorTimes.length > 0) {
        const gapDays = daysBetween(p.lastVisitAt, new Date(priorTimes[0]));
        if (gapDays >= RETURNING_ABSENCE_DAYS) {
          findings.push({
            ...base, id: `customer_returning_after_absence:${id}`, kind: 'customer_returning_after_absence',
            severity: 'opportunity', confidence: 1, relatedMetrics: ['transaction_count'], magnitude: gapDays,
            data: { ...base.data, absenceDays: gapDays },
          });
        }
      }
    }
  }

  return findings;
}
