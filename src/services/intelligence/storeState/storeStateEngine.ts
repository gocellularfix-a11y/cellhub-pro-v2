// ============================================================
// CellHub Intelligence — Dynamic Store State Engine
// R-INTELLIGENCE-STORE-STATE-V1
//
// Deterministic, local, lightweight. No AI, no randomness,
// no backend. Reads raw operational data and classifies the
// current store condition so missions/priorities can adapt.
//
// Priority order (first match wins):
//   rush_mode > repair_overload > collection_mode >
//   slow_day > opportunity_window > normal
// ============================================================

import { isDoneRepairStatus } from '@/utils/repairStatus';

// ── Types ─────────────────────────────────────────────────

export type StoreStateType =
  | 'normal'
  | 'slow_day'
  | 'rush_mode'
  | 'repair_overload'
  | 'collection_mode'
  | 'opportunity_window';

export type RecommendedFocus =
  | 'balanced'
  | 'customer_outreach'
  | 'fast_operational'
  | 'repair_management'
  | 'payment_recovery'
  | 'vip_outreach';

export interface StoreStateResult {
  state: StoreStateType;
  confidence: number;     // 0–100
  reason: string;
  detectedAt: number;     // epoch ms
  recommendedFocus: RecommendedFocus;
}

// ── Mission boost table ───────────────────────────────────
// Applied AFTER base priority scoring — capped at ±15.

export type MissionBoostMap = Partial<Record<
  'recover_customer' | 'vip_outreach' | 'repair_follow_up' | 'repair_escalate',
  number
>>;

const BOOST_TABLE: Record<StoreStateType, MissionBoostMap> = {
  normal:            {},
  slow_day:          { recover_customer: +10, vip_outreach: +10, repair_follow_up: -5, repair_escalate: -5 },
  rush_mode:         { repair_escalate: +5,   recover_customer: -10, vip_outreach: -10, repair_follow_up: -5 },
  repair_overload:   { repair_follow_up: +15, repair_escalate: +15,  recover_customer: -10, vip_outreach: -5 },
  collection_mode:   { recover_customer: +15, vip_outreach: +5,      repair_follow_up: -5  },
  opportunity_window:{ vip_outreach: +15,     recover_customer: +5 },
};

export function getMissionBoost(state: StoreStateType, type: keyof MissionBoostMap): number {
  return BOOST_TABLE[state][type] ?? 0;
}

// ── Input shape ───────────────────────────────────────────
// Loose types — only the fields we actually read.

interface SaleLike {
  status?: string;
  createdAt?: unknown;
  total?: number;
  items?: Array<{ category?: string }>;
}

interface RepairLike {
  status: unknown;
  createdAt?: unknown;
  balance?: number;
  estimatedCost?: number;
}

interface LayawayLike {
  status?: string;
  balance?: number;
}

export interface StoreStateInput {
  sales: SaleLike[];
  repairs: RepairLike[];
  layaways?: LayawayLike[];
  customerCount?: number;   // just a count — no PII needed here
  outreachCandidateCount?: number;
  now?: number;
}

// ── Helpers ───────────────────────────────────────────────

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

function daysSince(createdAt: unknown, now: number): number {
  const ms = toMs(createdAt);
  if (!ms) return 0;
  return Math.max(0, Math.floor((now - ms) / 86_400_000));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Detection sub-functions ───────────────────────────────

function detectRushMode(sales: SaleLike[], now: number): StoreStateResult | null {
  const H1 = 3_600_000;
  const H05 = 1_800_000;

  const last1h = sales.filter(
    (s) => s.status !== 'voided' && toMs(s.createdAt) >= now - H1,
  ).length;
  const last30m = sales.filter(
    (s) => s.status !== 'voided' && toMs(s.createdAt) >= now - H05,
  ).length;

  if (last1h >= 5) {
    return {
      state: 'rush_mode',
      confidence: clamp(55 + last1h * 5, 60, 95),
      reason: `${last1h} sales in the last hour — high transaction burst`,
      detectedAt: now,
      recommendedFocus: 'fast_operational',
    };
  }
  if (last30m >= 3) {
    return {
      state: 'rush_mode',
      confidence: clamp(45 + last30m * 8, 60, 90),
      reason: `${last30m} sales in the last 30 minutes — elevated activity`,
      detectedAt: now,
      recommendedFocus: 'fast_operational',
    };
  }
  return null;
}

function detectRepairOverload(repairs: RepairLike[], now: number): StoreStateResult | null {
  const active = repairs.filter((r) => !isDoneRepairStatus(r.status));
  const overdue = active.filter((r) => daysSince(r.createdAt, now) >= 5);

  if (overdue.length >= 5) {
    return {
      state: 'repair_overload',
      confidence: clamp(50 + overdue.length * 5, 60, 95),
      reason: `${overdue.length} active repairs waiting 5+ days`,
      detectedAt: now,
      recommendedFocus: 'repair_management',
    };
  }

  // Softer signal: 3+ repairs at 7+ days average
  const veryOld = active.filter((r) => daysSince(r.createdAt, now) >= 7);
  if (veryOld.length >= 3) {
    return {
      state: 'repair_overload',
      confidence: clamp(50 + veryOld.length * 6, 55, 90),
      reason: `${veryOld.length} active repairs waiting 7+ days`,
      detectedAt: now,
      recommendedFocus: 'repair_management',
    };
  }
  return null;
}

function detectCollectionMode(
  repairs: RepairLike[],
  layaways: LayawayLike[],
  now: number,
): StoreStateResult | null {
  // Done repairs with unpaid balance
  const unpaidRepairs = repairs.filter(
    (r) => isDoneRepairStatus(r.status) && (r.balance || 0) > 0,
  );
  const unpaidLayaways = layaways.filter(
    (l) => l.status !== 'completed' && l.status !== 'cancelled' && l.status !== 'forfeited' && (l.balance || 0) > 0,
  );
  const totalOutstandingCents =
    unpaidRepairs.reduce((s, r) => s + (r.balance || 0), 0) +
    unpaidLayaways.reduce((s, l) => s + (l.balance || 0), 0);

  const totalCount = unpaidRepairs.length + unpaidLayaways.length;

  if (totalCount >= 3 || totalOutstandingCents >= 20_000) {
    const dollars = (totalOutstandingCents / 100).toFixed(0);
    return {
      state: 'collection_mode',
      confidence: clamp(50 + Math.min(totalCount * 5, 20) + Math.min(Math.floor(totalOutstandingCents / 5000), 15), 55, 90),
      reason: `${totalCount} outstanding balance(s) totaling $${dollars}`,
      detectedAt: now,
      recommendedFocus: 'payment_recovery',
    };
  }
  return null;
}

function detectSlowDay(sales: SaleLike[], now: number): StoreStateResult | null {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const hour = new Date(now).getHours();
  if (hour < 11) return null;   // too early to judge the day

  const todayCount = sales.filter(
    (s) => s.status !== 'voided' && toMs(s.createdAt) >= todayStartMs,
  ).length;

  const H3 = 3 * 3_600_000;
  const last3hCount = sales.filter(
    (s) => s.status !== 'voided' && toMs(s.createdAt) >= now - H3,
  ).length;

  if (todayCount === 0 && hour >= 12) {
    return {
      state: 'slow_day',
      confidence: 88,
      reason: 'No sales recorded today past midday',
      detectedAt: now,
      recommendedFocus: 'customer_outreach',
    };
  }
  if (todayCount < 3 && hour >= 11) {
    return {
      state: 'slow_day',
      confidence: clamp(60 + (3 - todayCount) * 8, 60, 82),
      reason: `Only ${todayCount} sale${todayCount === 1 ? '' : 's'} today — below expected pace`,
      detectedAt: now,
      recommendedFocus: 'customer_outreach',
    };
  }
  if (last3hCount === 0 && hour >= 13) {
    return {
      state: 'slow_day',
      confidence: 72,
      reason: 'No sales in the last 3 hours — slow period',
      detectedAt: now,
      recommendedFocus: 'customer_outreach',
    };
  }
  return null;
}

function detectOpportunityWindow(
  outreachCandidateCount: number,
  now: number,
): StoreStateResult | null {
  if (outreachCandidateCount >= 5) {
    return {
      state: 'opportunity_window',
      confidence: clamp(65 + outreachCandidateCount * 2, 65, 85),
      reason: `${outreachCandidateCount} high-value customers available for outreach`,
      detectedAt: now,
      recommendedFocus: 'vip_outreach',
    };
  }
  return null;
}

// ── Main export ───────────────────────────────────────────

export function detectStoreState(input: StoreStateInput): StoreStateResult {
  const now = input.now ?? Date.now();
  const { sales, repairs, layaways = [], outreachCandidateCount = 0 } = input;

  const normal: StoreStateResult = {
    state: 'normal',
    confidence: 100,
    reason: 'Balanced operational conditions',
    detectedAt: now,
    recommendedFocus: 'balanced',
  };

  return (
    detectRushMode(sales, now)
    ?? detectRepairOverload(repairs, now)
    ?? detectCollectionMode(repairs, layaways, now)
    ?? detectSlowDay(sales, now)
    ?? detectOpportunityWindow(outreachCandidateCount, now)
    ?? normal
  );
}
