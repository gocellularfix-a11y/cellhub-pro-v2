// CellHub Intelligence — Customer Business Scoring Engine
// Deterministic only. No AI, no randomness, no external deps, no financial math.

import type { Customer, Repair, Sale, Layaway, Unlock } from '@/store/types';
import type { CustomerBusinessProfile, CustomerTier } from './customerScoringTypes';
import {
  toMs,
  hasPremiumDevice,
  hasRepairWithoutRecentSale,
  isServiceOnlyCustomer,
  detectPatterns,
} from './customerOpportunitySignals';

export interface CustomerScoringContext {
  customer: Customer;
  /** Pre-filtered to this customer. */
  sales: Sale[];
  repairs: Repair[];
  layaways: Layaway[];
  unlocks: Unlock[];
}

const MS_PER_DAY = 86_400_000;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ── VIP Score (lifetime value, visit frequency, avg ticket, consistency) ───────

function computeVipScore(ctx: CustomerScoringContext): number {
  const validSales = ctx.sales.filter(
    (s) => s.status === 'completed' || (s.status as string | undefined) === undefined,
  );

  const totalSpent = validSales.reduce((sum, s) => sum + (s.total || 0), 0);
  const visitCount = validSales.length;
  const avgTicket = visitCount > 0 ? totalSpent / visitCount : 0;

  // Spend (max 40)
  let spendPts = 0;
  if (totalSpent >= 50_000) spendPts = 40;
  else if (totalSpent >= 25_000) spendPts = 32;
  else if (totalSpent >= 10_000) spendPts = 20;
  else if (totalSpent >= 5_000) spendPts = 12;
  else if (totalSpent > 0) spendPts = 5;

  // Visit count (max 30)
  let visitPts = 0;
  if (visitCount >= 15) visitPts = 30;
  else if (visitCount >= 10) visitPts = 24;
  else if (visitCount >= 5) visitPts = 18;
  else if (visitCount >= 3) visitPts = 12;
  else if (visitCount >= 1) visitPts = 5;

  // Average ticket (max 20)
  let avgPts = 0;
  if (avgTicket >= 10_000) avgPts = 20;
  else if (avgTicket >= 5_000) avgPts = 14;
  else if (avgTicket >= 2_000) avgPts = 8;
  else if (avgTicket > 0) avgPts = 3;

  // Consistency — distinct calendar months with a purchase (max 10)
  const months = new Set(
    validSales.map((s) => {
      const d = new Date(toMs(s.createdAt));
      return `${d.getFullYear()}-${d.getMonth()}`;
    }),
  );
  let consistencyPts = 0;
  if (months.size >= 3) consistencyPts = 10;
  else if (months.size === 2) consistencyPts = 6;
  else if (months.size === 1 && visitCount >= 3) consistencyPts = 3;

  return clamp(spendPts + visitPts + avgPts + consistencyPts);
}

// ── Churn Risk (inactivity, decline, previously-active ghost) ──────────────────

function computeChurnRisk(ctx: CustomerScoringContext): number {
  const now = Date.now();

  // Gather all interaction timestamps across all service types
  const timestamps: number[] = [
    ...ctx.sales.map((s) => toMs(s.createdAt)),
    ...ctx.repairs.map((r) => toMs(r.createdAt)),
    ...ctx.layaways.map((l) => toMs(l.createdAt)),
    ...ctx.unlocks.map((u) => toMs(u.createdAt)),
  ].filter((ms) => ms > 0);

  if (timestamps.length === 0) return clamp(65); // no history = high risk

  const lastMs = Math.max(...timestamps);
  const daysSinceLast = (now - lastMs) / MS_PER_DAY;

  // Inactivity (max 65)
  let inactivityPts = 0;
  if (daysSinceLast >= 365) inactivityPts = 60;
  else if (daysSinceLast >= 180) inactivityPts = 50;
  else if (daysSinceLast >= 90) inactivityPts = 35;
  else if (daysSinceLast >= 60) inactivityPts = 20;
  else if (daysSinceLast >= 30) inactivityPts = 10;

  // Previously-active-now-gone bonus (max 20)
  let ghostPts = 0;
  const totalTxns = timestamps.length;
  if (daysSinceLast >= 90) {
    if (totalTxns >= 3) ghostPts = 20;
    else if (totalTxns >= 1) ghostPts = 10;
  }

  // Decline: had activity in 90–180 day window but none in last 90 days (max 15)
  const cutoff90  = now - 90 * MS_PER_DAY;
  const cutoff180 = now - 180 * MS_PER_DAY;
  const inLast90    = timestamps.filter((ms) => ms >= cutoff90).length;
  const in90to180   = timestamps.filter((ms) => ms >= cutoff180 && ms < cutoff90).length;
  const declinePts  = (inLast90 === 0 && in90to180 >= 1) ? 15 : 0;

  return clamp(inactivityPts + ghostPts + declinePts);
}

// ── Upsell Opportunity (missed accessory moments, premium device, multi-line) ──

function computeUpsellOpportunity(ctx: CustomerScoringContext): number {
  // Repair without a retail sale in the same 90-day window (max 25)
  const repairNoSalePts = hasRepairWithoutRecentSale(ctx.repairs, ctx.sales, 90) ? 25
    : hasRepairWithoutRecentSale(ctx.repairs, ctx.sales, 180) ? 15
    : 0;

  // Service-only customer — has services but no retail (max 20)
  const serviceOnlyPts = isServiceOnlyCustomer(ctx.sales, ctx.repairs, ctx.unlocks, ctx.layaways) ? 20 : 0;

  // Premium device in repairs (max 20)
  const premiumPts = hasPremiumDevice(ctx.repairs) ? 20 : 0;

  // Multi-line potential (max 15)
  const phones = ctx.customer.phones ?? (ctx.customer.phone ? [ctx.customer.phone] : []);
  const multiLinePts = phones.length >= 2 ? 15 : ctx.customer.carrier2 ? 8 : 0;

  // Repeat service usage — came back more than once — more chances to upsell (max 20)
  const repeatServicePts = ctx.repairs.length >= 3 ? 20 : ctx.repairs.length >= 2 ? 12 : 0;

  return clamp(repairNoSalePts + serviceOnlyPts + premiumPts + multiLinePts + repeatServicePts);
}

// ── Collection Priority (outstanding balances across all service types) ─────────

function computeCollectionPriority(ctx: CustomerScoringContext): number {
  const ACTIVE_REPAIR_STATUSES = new Set(['received', 'diagnosing', 'waiting_parts', 'in_progress', 'ready']);
  const ACTIVE_UNLOCK_STATUSES = new Set(['pending', 'in_progress']);

  const repairBalance = ctx.repairs
    .filter((r) => ACTIVE_REPAIR_STATUSES.has(String(r.status)) && (r.balance ?? 0) > 0)
    .reduce((sum, r) => sum + (r.balance ?? 0), 0);

  const layawayBalance = ctx.layaways
    .filter((l) => l.status === 'active' && (l.balance ?? 0) > 0)
    .reduce((sum, l) => sum + (l.balance ?? 0), 0);

  const unlockBalance = ctx.unlocks
    .filter((u) => ACTIVE_UNLOCK_STATUSES.has(String(u.status)) && (u.balance ?? 0) > 0)
    .reduce((sum, u) => sum + (u.balance ?? 0), 0);

  const totalBalance = repairBalance + layawayBalance + unlockBalance;

  if (totalBalance === 0) return 0;

  // Balance magnitude (max 50)
  let balancePts = 0;
  if (totalBalance >= 20_000) balancePts = 50;
  else if (totalBalance >= 10_000) balancePts = 38;
  else if (totalBalance >= 5_000) balancePts = 25;
  else if (totalBalance >= 2_500) balancePts = 15;
  else if (totalBalance > 0) balancePts = 8;

  // Urgency — overdue layaway (max 25)
  const now = Date.now();
  const overdueLayaway = ctx.layaways.some((l) => {
    if (l.status !== 'active' || (l.balance ?? 0) === 0) return false;
    if (!l.dueDate) return false;
    return toMs(l.dueDate) < now;
  });
  const overduePts = overdueLayaway ? 25 : 0;

  // Multiple service types with balance (max 15)
  const openTypes = [repairBalance > 0, layawayBalance > 0, unlockBalance > 0].filter(Boolean).length;
  const multiTypePts = openTypes >= 2 ? 15 : 0;

  // Prior forfeited layaway — pattern of non-completion (max 10)
  const forfeitedLayaway = ctx.layaways.some((l) => l.status === 'forfeited' || l.status === 'cancelled');
  const forfeitPts = forfeitedLayaway ? 10 : 0;

  return clamp(balancePts + overduePts + multiTypePts + forfeitPts);
}

// ── Engagement Score (recent activity, service depth, profile completeness) ────

function computeEngagementScore(ctx: CustomerScoringContext): number {
  const now = Date.now();
  const cutoff30  = now - 30 * MS_PER_DAY;
  const cutoff90  = now - 90 * MS_PER_DAY;

  const allTxns = [
    ...ctx.sales.map((s) => toMs(s.createdAt)),
    ...ctx.repairs.map((r) => toMs(r.createdAt)),
    ...ctx.layaways.map((l) => toMs(l.createdAt)),
    ...ctx.unlocks.map((u) => toMs(u.createdAt)),
  ].filter((ms) => ms > 0);

  const inLast30 = allTxns.filter((ms) => ms >= cutoff30).length;
  const in30to90 = allTxns.filter((ms) => ms >= cutoff90 && ms < cutoff30).length;

  // Recent activity (max 30)
  let recentPts = 0;
  if (inLast30 >= 3) recentPts = 30;
  else if (inLast30 === 2) recentPts = 20;
  else if (inLast30 === 1) recentPts = 12;

  // 30-90 day window (max 25)
  let earlierPts = 0;
  if (in30to90 >= 3) earlierPts = 25;
  else if (in30to90 >= 2) earlierPts = 18;
  else if (in30to90 >= 1) earlierPts = 10;

  // Service depth (max 20)
  const serviceDepth =
    (ctx.repairs.length > 0 ? 8 : 0) +
    (ctx.unlocks.length > 0 ? 6 : 0) +
    (ctx.layaways.length > 0 ? 6 : 0);

  // Profile completeness (max 15)
  const c = ctx.customer;
  const phones = c.phones ?? (c.phone ? [c.phone] : []);
  const profilePts =
    (c.email ? 6 : 0) +
    (c.communicationConsent ? 4 : 0) +
    (c.notes ? 3 : 0) +
    (phones.length >= 2 ? 2 : 0);

  // Loyalty points (max 10)
  const lp = c.loyaltyPoints || 0;
  const loyaltyPts = lp >= 100 ? 10 : lp >= 50 ? 7 : lp >= 10 ? 4 : lp > 0 ? 2 : 0;

  return clamp(recentPts + earlierPts + serviceDepth + profilePts + loyaltyPts);
}

// ── Tier derivation ────────────────────────────────────────────────────────────

function deriveTier(
  vipScore: number,
  churnRisk: number,
  engagementScore: number,
): CustomerTier {
  if (vipScore >= 75 && churnRisk < 50) return 'VIP';
  if (vipScore >= 55 && churnRisk < 60) return 'Loyal';
  if (engagementScore >= 35 && churnRisk < 55) return 'Active';
  if (churnRisk >= 80) return 'Lost';
  if (churnRisk >= 55) return 'At Risk';
  return 'Casual';
}

// ── Recommended actions (deterministic, priority-ordered, max 4) ───────────────

function deriveRecommendedActions(
  vipScore: number,
  churnRisk: number,
  upsellOpportunity: number,
  collectionPriority: number,
  engagementScore: number,
  tier: CustomerTier,
  _repairs: Repair[],
): string[] {
  const actions: string[] = [];

  if (tier === 'VIP') actions.push('Offer loyalty reward');
  if (collectionPriority >= 60) actions.push('Collect outstanding balance');
  if (churnRisk >= 70 && tier !== 'VIP') actions.push('Follow up immediately');
  else if (churnRisk >= 50 && tier !== 'VIP') actions.push('Recover inactive customer');
  if (tier === 'Lost') actions.push('Offer welcome-back promotion');
  if (upsellOpportunity >= 65) actions.push('Offer accessory bundle');
  else if (upsellOpportunity >= 45) actions.push('Suggest protection plan');
  if ((tier === 'VIP' || tier === 'Loyal') && engagementScore >= 40) actions.push('Prioritize retention');
  if (collectionPriority >= 35 && collectionPriority < 60) actions.push('Ask about open balance');
  if (churnRisk >= 35 && _repairs.length > 0) actions.push('Prioritize repair communication');
  if (vipScore >= 60 && tier !== 'VIP') actions.push('Consider loyalty upgrade');

  // Dedup and cap
  return [...new Set(actions)].slice(0, 4);
}

// ── Last visit computation ─────────────────────────────────────────────────────

function computeLastVisitAt(ctx: CustomerScoringContext): Date | null {
  const timestamps = [
    ...ctx.sales.map((s) => toMs(s.createdAt)),
    ...ctx.repairs.map((r) => toMs(r.createdAt)),
    ...ctx.layaways.map((l) => toMs(l.createdAt)),
    ...ctx.unlocks.map((u) => toMs(u.createdAt)),
  ].filter((ms) => ms > 0);

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic CustomerBusinessProfile from pre-filtered arrays.
 * All input arrays must be already filtered to a single customer.
 * Pure function — safe to call inside useMemo.
 */
export function computeCustomerProfile(ctx: CustomerScoringContext): CustomerBusinessProfile {
  const vipScore           = computeVipScore(ctx);
  const churnRisk          = computeChurnRisk(ctx);
  const upsellOpportunity  = computeUpsellOpportunity(ctx);
  const collectionPriority = computeCollectionPriority(ctx);
  const engagementScore    = computeEngagementScore(ctx);
  const lastVisitAt        = computeLastVisitAt(ctx);
  const estimatedCustomerTier = deriveTier(vipScore, churnRisk, engagementScore);

  const recommendedActions = deriveRecommendedActions(
    vipScore, churnRisk, upsellOpportunity, collectionPriority,
    engagementScore, estimatedCustomerTier, ctx.repairs,
  );

  const detectedPatterns = detectPatterns(
    ctx.customer, ctx.sales, ctx.repairs, ctx.unlocks, ctx.layaways, lastVisitAt,
  );

  return {
    customerId:          ctx.customer.id,
    customerName:        ctx.customer.name || `${ctx.customer.firstName || ''} ${ctx.customer.lastName || ''}`.trim(),
    vipScore,
    churnRisk,
    upsellOpportunity,
    collectionPriority,
    engagementScore,
    lastVisitAt,
    estimatedCustomerTier,
    recommendedActions,
    detectedPatterns,
    computedAt: Date.now(),
  };
}
