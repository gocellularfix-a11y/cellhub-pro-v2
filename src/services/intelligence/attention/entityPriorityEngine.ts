// R-INTELLIGENCE-WHO-NEEDS-ATTENTION-RIGHT-NOW-V1
// Cross-module entity attention orchestrator.
//
// Signals → per-entity scoring → execution-history penalties →
// dedup (one item per entityId, keep highest score) → top 5.
//
// Ownership:
//   OWNS: entity collection, penalty application, dedup, top-N selection
//   MUST NOT: write execution history, trigger WhatsApp/open_repair/
//             open_customer actions directly, modify briefing/registry/
//             continuity systems, create new localStorage stores
//
// Canonical systems reused:
//   - ranking/closeTodayRanker: deal scoring (avoids reimplementing stage logic)
//   - execution/intelligenceExecutionHistory: recency penalties via
//     hasRecentIntelligenceExecution (read-only, 5s cache, safe in tight loops)
//   - managerQueue/actions: getQueue() for pending approval data
//   - automation/automationQueue: getDealPipeline() for active deals

import type { IntelligenceEngine } from '../IntelligenceEngine';
import { getDealPipeline } from '../automation/automationQueue';
import { getQueue } from '../managerQueue/actions';
import { scoreDealsForCloseToday } from '../ranking/closeTodayRanker';
import { hasRecentIntelligenceExecution } from '../execution/intelligenceExecutionHistory';
import {
  scoreRepairForAttention,
  scoreLayawayForAttention,
  scoreDealForAttention,
  scoreApprovalForAttention,
  scoreVipForAttention,
  type VipCandidate,
} from './entityPriorityScoring';
import type { AttentionItem, EntityAttentionResult } from './entityPriorityTypes';

const MAX_ITEMS = 5;
const MIN_SCORE = 10;  // items penalized below this are excluded

const MS_1H  =  1 * 60 * 60 * 1000;
const MS_4H  =  4 * 60 * 60 * 1000;
const MS_24H = 24 * 60 * 60 * 1000;

// ── Execution-history penalty ─────────────────────────────────
// Reduces urgencyScore when the operator has recently acted on this entity.
// Uses the canonical execution history store (read-only, 5-second cache).
// Returns the penalized score; caller discards items below MIN_SCORE.

function applyExecutionPenalty(item: AttentionItem): number {
  let score = item.urgencyScore;
  const { entityId, entityType } = item;

  if (hasRecentIntelligenceExecution(entityId, 'completed', MS_24H)) score -= 40;
  if (hasRecentIntelligenceExecution(entityId, 'dismissed',  MS_1H))  score -= 20;

  if (entityType === 'repair') {
    if (hasRecentIntelligenceExecution(entityId, 'open_repair', MS_4H)) score -= 15;
  } else if (entityType === 'customer') {
    if (hasRecentIntelligenceExecution(entityId, 'open_customer', MS_4H)) score -= 15;
    if (hasRecentIntelligenceExecution(entityId, 'whatsapp',     MS_24H)) score -= 25;
  } else if (entityType === 'layaway') {
    if (hasRecentIntelligenceExecution(entityId, 'open_layaway', MS_4H)) score -= 15;
  } else if (entityType === 'approval') {
    // Approved/rejected items should not be pending — exclude immediately if found.
    if (hasRecentIntelligenceExecution(entityId, 'queue_approved', MS_24H)) return -1;
    if (hasRecentIntelligenceExecution(entityId, 'queue_rejected', MS_24H)) return -1;
  }

  return score;
}

// ── Main export ───────────────────────────────────────────────

export function computeEntityAttentionPriorities(
  engine: IntelligenceEngine,
  lang: 'en' | 'es' | 'pt' = 'en',
  now: number = Date.now(),
): EntityAttentionResult {
  const candidates: AttentionItem[] = [];

  // ── Repairs ──────────────────────────────────────────────
  // Three signals per repair (stale pickup, delayed active, unpaid done).
  // scoreRepairForAttention returns the highest-priority signal per repair.
  for (const r of engine.getRepairs()) {
    const item = scoreRepairForAttention(r, lang, now);
    if (item) candidates.push(item);
  }

  // ── Layaways ─────────────────────────────────────────────
  for (const l of engine.getLayaways()) {
    const item = scoreLayawayForAttention(l, lang, now);
    if (item) candidates.push(item);
  }

  // ── Deals ────────────────────────────────────────────────
  // Reuse closeTodayRanker for scoring — avoids duplicating stage/buying-
  // language logic. Only hot deals (ranker score >= 50) produce items.
  const pipeline = getDealPipeline();
  const activeDeals = pipeline.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  for (const { deal, score } of scoreDealsForCloseToday(activeDeals)) {
    const item = scoreDealForAttention(score, deal, lang);
    if (item) candidates.push(item);
  }

  // ── Pending approvals ─────────────────────────────────────
  // Critical and high-severity items surface immediately.
  // Medium/low items only surface when stale > 24h.
  for (const q of getQueue()) {
    const item = scoreApprovalForAttention(q, lang, now);
    if (item) candidates.push(item);
  }

  // ── VIP inactive customers ────────────────────────────────
  // Only platinum/gold tier (legacy CustomerScorer tiers), inactive >= 30 days.
  // Per-customer history call: safe because platinum/gold pool is small in
  // practice and engine.getCustomerHistory() is memoized per refresh cycle.
  for (const cs of engine.getCustomerScores()) {
    if (cs.tier !== 'platinum' && cs.tier !== 'gold') continue;
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h?.lastVisit) continue;
    const daysSince = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86_400_000));
    const vip: VipCandidate = {
      customerId: cs.customerId,
      customerName: h.customer.name,
      tier: cs.tier,
      daysSinceLastVisit: daysSince,
      grossRevenueCents: h.grossRevenue,
    };
    const item = scoreVipForAttention(vip, lang);
    if (item) candidates.push(item);
  }

  // ── Penalty + dedup + sort ────────────────────────────────
  // 1. Apply execution-history penalties; drop items below MIN_SCORE.
  // 2. Dedup by entityId — one item per entity, keep highest score.
  // 3. Sort descending; take top MAX_ITEMS.

  const penalized = candidates
    .map((item) => {
      const penalizedScore = applyExecutionPenalty(item);
      return penalizedScore < MIN_SCORE ? null : { ...item, urgencyScore: penalizedScore };
    })
    .filter((item): item is AttentionItem => item !== null);

  const best = new Map<string, AttentionItem>();
  for (const item of penalized) {
    const existing = best.get(item.entityId);
    if (!existing || item.urgencyScore > existing.urgencyScore) {
      best.set(item.entityId, item);
    }
  }

  const items = Array.from(best.values())
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .slice(0, MAX_ITEMS);

  return { generatedAt: now, items, topItem: items[0] };
}
