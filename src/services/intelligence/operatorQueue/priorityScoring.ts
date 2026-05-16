// ============================================================
// CellHub Intelligence — Operator Queue Priority Scoring
// R-INTELLIGENCE-PRIORITY-ENGINE-V1
//
// Deterministic business-priority scoring for queue items.
// No ML, no randomness, no backend calls.
// Score stamped at item-creation time inside the chat handlers.
// ============================================================

import type { UrgencyLevel } from './operatorQueue';

export interface PriorityMeta {
  priorityScore: number;
  urgencyLevel: UrgencyLevel;
  impactReason: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function urgencyFromScore(score: number): UrgencyLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

// ── Recover Customer ─────────────────────────────────────────
// Factors: days inactive (up to 40), lifetime spend (up to 40),
//          visit frequency (up to 20).
export function scoreRecoverCustomer(params: {
  daysInactive: number;
  grossRevenueCents: number;
  visitCount: number;
}): PriorityMeta {
  const { daysInactive, grossRevenueCents, visitCount } = params;
  const daysScore  = clamp(daysInactive * 0.4, 0, 40);
  const spendScore = clamp(grossRevenueCents / 2500, 0, 40); // $1000 → 40pts
  const visitScore = clamp(visitCount * 2, 0, 20);
  const priorityScore = Math.min(100, Math.round(daysScore + spendScore + visitScore));
  return {
    priorityScore,
    urgencyLevel: urgencyFromScore(priorityScore),
    impactReason: `Inactive ${daysInactive}d · ${fmt(grossRevenueCents)} spend`,
  };
}

// ── VIP Outreach ─────────────────────────────────────────────
// Factors: lifetime spend (up to 50), visit count (up to 30),
//          recency bonus (20/10/0 based on last-visit window).
export function scoreVipOutreach(params: {
  grossRevenueCents: number;
  visitCount: number;
  daysSinceLastVisit: number;
}): PriorityMeta {
  const { grossRevenueCents, visitCount, daysSinceLastVisit } = params;
  const spendScore   = clamp(grossRevenueCents / 2000, 0, 50); // $1000 → 50pts
  const visitScore   = clamp(visitCount * 3, 0, 30);
  const recencyScore = daysSinceLastVisit <= 30 ? 20 : daysSinceLastVisit <= 60 ? 10 : 0;
  const priorityScore = Math.min(100, Math.round(spendScore + visitScore + recencyScore));
  return {
    priorityScore,
    urgencyLevel: urgencyFromScore(priorityScore),
    impactReason: `VIP · ${visitCount} visits · ${fmt(grossRevenueCents)}`,
  };
}

// ── Repair Follow-Up ─────────────────────────────────────────
// Factors: days waiting (up to 60), repair value (up to 40).
export function scoreRepairFollowUp(params: {
  daysInRepair: number;
  repairValueCents: number;
}): PriorityMeta {
  const { daysInRepair, repairValueCents } = params;
  const daysScore  = clamp(daysInRepair * 4, 0, 60);   // 15d → 60pts
  const valueScore = clamp(repairValueCents / 375, 0, 40); // $150 → 40pts
  const priorityScore = Math.min(100, Math.round(daysScore + valueScore));
  return {
    priorityScore,
    urgencyLevel: urgencyFromScore(priorityScore),
    impactReason: `Waiting ${daysInRepair}d · ${fmt(repairValueCents)} repair`,
  };
}

// ── Repair Escalate ──────────────────────────────────────────
// Same factors as follow-up but steeper day-weight + 10pt base
// urgency premium since escalations are always more pressing.
export function scoreRepairEscalate(params: {
  daysInRepair: number;
  repairValueCents: number;
}): PriorityMeta {
  const { daysInRepair, repairValueCents } = params;
  const daysScore  = clamp(daysInRepair * 5, 0, 60);   // 12d → 60pts
  const valueScore = clamp(repairValueCents / 500, 0, 30); // $150 → 30pts
  const priorityScore = Math.min(100, Math.round(daysScore + valueScore + 10));
  return {
    priorityScore,
    urgencyLevel: urgencyFromScore(priorityScore),
    impactReason: `Overdue ${daysInRepair}d · ${fmt(repairValueCents)} repair`,
  };
}
