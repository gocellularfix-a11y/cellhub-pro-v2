// R-INTELLIGENCE-REMOVE-DUPLICATE-CUSTOMER-SCORER-V1
// Deterministic tier equivalence map between the two customer scoring systems.
//
// CustomerScorer.ts (legacy): platinum | gold | silver | bronze | standard
//   Score = loyaltyScore*0.30 + engagementScore*0.30 + valueScore*0.25 + riskScore*0.15
//   Tiers:  platinum ≥80, gold ≥60, silver ≥40, bronze ≥20, standard <20
//
// customerScoringEngine.ts (canonical): VIP | Loyal | Active | Casual | At Risk | Lost
//   Tiers derived from: vipScore, churnRisk, engagementScore (see deriveTier())
//   VIP:     vipScore ≥75 && churnRisk <50
//   Loyal:   vipScore ≥55 && churnRisk <60
//   Active:  engagementScore ≥35 && churnRisk <55
//   Lost:    churnRisk ≥80
//   At Risk: churnRisk ≥55
//   Casual:  (default)
//
// Intent equivalence (approximate — scoring formulas differ):
//   platinum  ≈ VIP       (highest value, lowest churn risk)
//   gold      ≈ Loyal     (good value, low-moderate churn risk)
//   silver    ≈ Active    (engaged, moderate value)
//   bronze    ≈ Casual    (low engagement, low value)
//   standard  ≈ Casual    (minimal transaction history)
//   (none)    ≈ At Risk   (churnRisk 55–79; legacy covers via riskScore >50 check)
//   (none)    ≈ Lost      (churnRisk ≥80; legacy covers via riskScore >50 check)
//
// Usage:
//   Any code checking legacy tiers (platinum/gold/bronze) should use the
//   equivalents from OLD_TO_CANONICAL_TIER when migrating to canonical profiles.
//   Any code using canonical tiers should not re-implement legacy tier logic.
//
// Do NOT add new scoring logic here. This file is mapping documentation only.

import type { CustomerTier } from '../customerScoring/customerScoringTypes';

export type LegacyTier = 'platinum' | 'gold' | 'silver' | 'bronze' | 'standard';

// Legacy → canonical approximate mapping.
export const OLD_TO_CANONICAL_TIER: Record<LegacyTier, CustomerTier | CustomerTier[]> = {
  platinum: 'VIP',
  gold:     'Loyal',
  silver:   'Active',
  bronze:   ['Casual', 'At Risk'],
  standard: 'Casual',
};

// Canonical → legacy approximate mapping (many-to-one in some cases).
export const CANONICAL_TO_OLD_TIER: Record<CustomerTier, LegacyTier> = {
  VIP:      'platinum',
  Loyal:    'gold',
  Active:   'silver',
  Casual:   'standard',
  'At Risk': 'bronze',
  Lost:     'bronze',
};

// Returns true when a canonical tier maps to the legacy VIP band (platinum|gold).
// Replaces the pattern: cs.tier === 'platinum' || cs.tier === 'gold'
// Migrate callers of getCustomerScores() to use this when switching to canonical profiles.
export function isLegacyVipTier(tier: LegacyTier): boolean {
  return tier === 'platinum' || tier === 'gold';
}

// Returns true when a canonical tier is in the VIP band.
// Use this when callers have migrated to CustomerBusinessProfile.
export function isCanonicalVipTier(tier: CustomerTier): boolean {
  return tier === 'VIP' || tier === 'Loyal';
}

// Returns true when a legacy score indicates churn risk.
// Replaces the pattern: s.riskScore > 50 || s.tier === 'bronze'
export function isLegacyAtRisk(riskScore: number, tier: LegacyTier): boolean {
  return riskScore > 50 || tier === 'bronze';
}
