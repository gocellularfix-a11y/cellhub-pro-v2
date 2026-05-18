import type { DealPipelineItem } from '../automation/automationQueue';

export interface ScoredDeal {
  deal: DealPipelineItem;
  score: number;
}

const STAGE_BASE: Record<string, number> = {
  pending_pickup:   100,
  pending_approval:  85,
  negotiating:       70,
  interested:        55,
  customer_replied:  45,
  proposal_sent:     25,
};

// Buying-language signals — EN/ES/PT.
const BUYING_PATTERN = /\b(take it|i'?ll take it|lo quiero|quiero|me interesa|how much|lowest|today|ahorita|voy|pickup|pick it up|hoy)\b/i;

const HOUR_24 = 24 * 60 * 60 * 1000;
const HOUR_72 = 72 * 60 * 60 * 1000;
const DAY_7   =  7 * 24 * 60 * 60 * 1000;

// Scores each deal by stage + recency + buying-language signals.
// Returns sorted descending by score (caller slices to desired count).
export function scoreDealsForCloseToday(deals: DealPipelineItem[]): ScoredDeal[] {
  const now = Date.now();
  const scored = deals.map((d) => {
    let score = STAGE_BASE[d.stage] || 0;
    if (d.customerPhone && d.customerPhone.trim()) score += 15;
    if (d.lastReplyText && d.lastReplyText.trim()) score += 15;
    if (d.lastReplyText && BUYING_PATTERN.test(d.lastReplyText)) score += 20;
    if ((now - d.updatedAt) < HOUR_24) score += 20;
    if ((now - d.createdAt) < HOUR_72) score += 10;
    if ((now - d.createdAt) > DAY_7 && !d.lastReplyText) score -= 30;
    return { deal: d, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function dealCloseLikelihood(score: number): 'high' | 'medium' | 'low' {
  return score >= 90 ? 'high' : score >= 60 ? 'medium' : 'low';
}
