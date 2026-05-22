// ============================================================
// CellHub Intelligence — Customer Timeline Engine
// R-INTELLIGENCE-CUSTOMER-TIMELINE-MEMORY
//
// Pure deterministic engine that reads ONLY real historical records and
// derives behavioral signals (cadence, tags, streaks) for a single
// customer. No randomness, no LLM, no embeddings — same input always
// yields the same output. Safe to call inside React render or chat
// handlers; caller-side memoization is recommended for hot paths.
//
// Architecture is strictly additive: this module exposes pure functions
// that the existing IntelligenceEngine / handlers / PhonePaymentModal
// can opt into. No existing handler, type, or engine method is modified.
// ============================================================

import type {
  Sale, Repair, Layaway, CustomerReturn, SpecialOrder, StoreCreditLedger,
} from '@/store/types';
import { normalizePhone } from '@/utils/normalize';
import { loadLocal } from '@/services/storage';

// ── Public types ──────────────────────────────────────────

export interface PhonePaymentCadence {
  paymentCount: number;
  lastPaymentDateMs: number | null;
  lastPaymentAmountCents: number | null;
  lastPaymentCarrier: string | null;
  averageDaysBetween: number | null;
  /** Days since the last payment (relative to `nowMs` provided at compute time). */
  daysSinceLast: number | null;
  /**
   * Signed delta vs. average cadence — positive = late, negative = early.
   * Null when fewer than 2 historical phone_payments exist (no cadence yet).
   */
  cadenceDeltaDays: number | null;
  /**
   * Consecutive on-time payments at the head of history. "On time" means the
   * gap was within +/- ON_TIME_TOLERANCE_DAYS of the running average.
   */
  onTimeStreak: number;
  mostCommonCarrier: string | null;
  /** Mode of the cents amounts across all phone_payment items. */
  mostCommonAmountCents: number | null;
  /** True iff we have at least 2 phone_payments AND last gap is late. */
  isLate: boolean;
  /** True iff there's exactly one phone_payment and it's older than 45 days. */
  skippedLikely: boolean;
}

export type CustomerTag =
  | 'reliable_payer'
  | 'late_payer'
  | 'vip'
  | 'inactive_vip'
  | 'repeat_repair_customer'
  | 'abandoned_layaway_risk'
  | 'frequent_upgrader'
  | 'unused_credit_holder';

export interface RepairProfile {
  totalRepairs: number;
  completedRepairs: number;
  cancelledRepairs: number;
  /** Distinct devices repaired (lowercased model strings). */
  uniqueDevices: number;
  /** Devices repaired at least twice. */
  repeatedDeviceCount: number;
  /** Most common issue keyword bucket: battery/screen/charging/water/other. */
  topIssueBucket: 'battery' | 'screen' | 'charging' | 'water' | 'other' | null;
  /** Sum of estimatedCost across all repairs in cents. */
  totalRepairValueCents: number;
}

export interface LayawayProfile {
  total: number;
  completed: number;
  cancelled: number;
  abandoned: number;        // status in {forfeited, cancelled} OR pending > 90d idle
  completionRate: number;   // 0..1
  activeBalanceCents: number;
}

export interface StoreCreditProfile {
  active: number;
  voided: number;
  redeemed: number;
  totalRemainingCents: number;
  oldestActiveAgeDays: number | null;
}

export interface CustomerTimeline {
  customerId: string;
  cadence: PhonePaymentCadence;
  repairProfile: RepairProfile;
  layawayProfile: LayawayProfile;
  storeCreditProfile: StoreCreditProfile;
  totalSpendCents: number;
  /** Most-recent activity timestamp across all domains. */
  lastActivityMs: number | null;
  /** Deterministic operational tags. */
  tags: CustomerTag[];
  /** Pre-built short context lines suitable for chat enrichment. */
  contextLines: string[];
}

// ── Tunable thresholds ────────────────────────────────────

const ON_TIME_TOLERANCE_DAYS  = 7;   // within ±7 days of average gap → on-time
const LATE_THRESHOLD_DAYS     = 7;
const SKIP_GAP_DAYS           = 45;
const REPEAT_REPAIR_MIN       = 2;
const REPEAT_DEVICE_MIN       = 2;
const VIP_SPEND_CENTS         = 100_000; // $1000 lifetime
const VIP_INACTIVE_DAYS       = 60;
const ABANDONED_RATIO_MIN     = 0.5;     // >= 50% abandoned of total layaways (min 2)
const FREQ_UPGRADE_REPAIR_MIN = 3;
const UNUSED_CREDIT_MIN_CENTS = 5_000;   // $50 sitting
const UNUSED_CREDIT_MIN_DAYS  = 30;

// ── Date helpers ──────────────────────────────────────────

function tsOf(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'string') { const n = new Date(v).getTime(); return Number.isFinite(n) ? n : 0; }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && v !== null) {
    const obj = v as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') { try { return obj.toDate().getTime(); } catch { return 0; } }
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return 0;
}

function daysBetween(aMs: number, bMs: number): number {
  if (!aMs || !bMs) return 0;
  return Math.max(0, Math.floor((bMs - aMs) / 86400000));
}

function statusKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '_');
}

// ── Internal mode helpers (deterministic) ─────────────────

function modeString(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > bestCount || (c === bestCount && best !== null && k < best)) {
      best = k; bestCount = c;
    }
  }
  return best;
}

function modeNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > bestCount || (c === bestCount && best !== null && k < best)) {
      best = k; bestCount = c;
    }
  }
  return best;
}

// ── Phone payment cadence ─────────────────────────────────

interface PhonePaymentRecord {
  saleId: string;
  ms: number;
  amountCents: number;
  carrier: string;
  phoneNorm: string;
}

function extractPhonePayments(sales: Sale[], customerId: string): PhonePaymentRecord[] {
  const out: PhonePaymentRecord[] = [];
  for (const s of sales || []) {
    if (s.customerId !== customerId) continue;
    if (s.status === 'voided' || s.status === 'refunded') continue;
    const ms = tsOf(s.createdAt);
    if (!ms) continue;
    for (const i of (s.items || [])) {
      if (i.category !== 'phone_payment') continue;
      const amt = Math.max(0, (i.price || 0) * (i.qty || 1));
      if (amt <= 0) continue;
      out.push({
        saleId: s.id,
        ms,
        amountCents: amt,
        carrier: String((i as any).carrier || '').trim(),
        phoneNorm: normalizePhone(i.phoneNumber || ''),
      });
    }
  }
  out.sort((a, b) => b.ms - a.ms);
  return out;
}

function computeCadence(records: PhonePaymentRecord[], nowMs: number): PhonePaymentCadence {
  if (records.length === 0) {
    return {
      paymentCount: 0,
      lastPaymentDateMs: null,
      lastPaymentAmountCents: null,
      lastPaymentCarrier: null,
      averageDaysBetween: null,
      daysSinceLast: null,
      cadenceDeltaDays: null,
      onTimeStreak: 0,
      mostCommonCarrier: null,
      mostCommonAmountCents: null,
      isLate: false,
      skippedLikely: false,
    };
  }
  const newest = records[0];
  const daysSinceLast = daysBetween(newest.ms, nowMs);

  // Gaps (in days) between consecutive payments — records are newest-first.
  const gapsDays: number[] = [];
  for (let i = 0; i < records.length - 1; i++) {
    gapsDays.push(Math.max(0, daysBetween(records[i + 1].ms, records[i].ms)));
  }
  const averageDaysBetween = gapsDays.length > 0
    ? Math.round(gapsDays.reduce((s, g) => s + g, 0) / gapsDays.length)
    : null;

  // Cadence delta vs average — uses days-since-last so if the customer is
  // late RIGHT NOW (no new payment), the signal still surfaces.
  const cadenceDeltaDays = averageDaysBetween !== null
    ? daysSinceLast - averageDaysBetween
    : null;
  const isLate = cadenceDeltaDays !== null && cadenceDeltaDays >= LATE_THRESHOLD_DAYS;

  // On-time streak — walk newest-first while each gap is within tolerance.
  let onTimeStreak = 0;
  if (averageDaysBetween !== null) {
    for (const g of gapsDays) {
      if (Math.abs(g - averageDaysBetween) <= ON_TIME_TOLERANCE_DAYS) {
        onTimeStreak++;
      } else {
        break;
      }
    }
  }

  const carriers = records.map((r) => r.carrier).filter((c) => c.length > 0);
  const amounts  = records.map((r) => r.amountCents);
  const mostCommonCarrier = modeString(carriers);
  const mostCommonAmountCents = modeNumber(amounts);

  const skippedLikely = records.length === 1 && daysSinceLast >= SKIP_GAP_DAYS;

  return {
    paymentCount: records.length,
    lastPaymentDateMs: newest.ms,
    lastPaymentAmountCents: newest.amountCents,
    lastPaymentCarrier: newest.carrier || null,
    averageDaysBetween,
    daysSinceLast,
    cadenceDeltaDays,
    onTimeStreak,
    mostCommonCarrier,
    mostCommonAmountCents,
    isLate,
    skippedLikely,
  };
}

// ── Repair profile ────────────────────────────────────────

const ISSUE_BUCKETS: Array<{ bucket: RepairProfile['topIssueBucket']; keywords: string[] }> = [
  { bucket: 'battery',  keywords: ['battery', 'bateria', 'batería', 'bateria', 'pila'] },
  { bucket: 'screen',   keywords: ['screen', 'pantalla', 'cracked', 'lcd', 'glass', 'cristal'] },
  { bucket: 'charging', keywords: ['charge', 'charging', 'puerto', 'carga', 'no carga', 'wont charge'] },
  { bucket: 'water',    keywords: ['water', 'agua', 'liquid', 'líquido', 'liquido', 'wet'] },
];

function bucketIssue(text: string): RepairProfile['topIssueBucket'] {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const b of ISSUE_BUCKETS) {
    if (b.keywords.some((k) => t.includes(k))) return b.bucket;
  }
  return 'other';
}

function computeRepairProfile(repairs: Repair[], customerId: string): RepairProfile {
  const out: RepairProfile = {
    totalRepairs: 0, completedRepairs: 0, cancelledRepairs: 0,
    uniqueDevices: 0, repeatedDeviceCount: 0, topIssueBucket: null,
    totalRepairValueCents: 0,
  };
  const deviceCounts = new Map<string, number>();
  const issueCounts = new Map<RepairProfile['topIssueBucket'], number>();
  for (const r of (repairs || [])) {
    if (r.customerId !== customerId) continue;
    out.totalRepairs++;
    out.totalRepairValueCents += Math.max(0, r.estimatedCost || 0);
    const s = statusKey(r.status);
    if (s === 'completed' || s === 'complete' || s === 'picked_up' || s === 'ready') out.completedRepairs++;
    if (s === 'cancelled') out.cancelledRepairs++;
    const dev = String(r.device || r.deviceModel || '').trim().toLowerCase();
    if (dev) deviceCounts.set(dev, (deviceCounts.get(dev) || 0) + 1);
    const bucket = bucketIssue(r.issue || '');
    issueCounts.set(bucket, (issueCounts.get(bucket) || 0) + 1);
  }
  out.uniqueDevices = deviceCounts.size;
  out.repeatedDeviceCount = [...deviceCounts.values()].filter((c) => c >= REPEAT_DEVICE_MIN).length;
  let bestBucket: RepairProfile['topIssueBucket'] = null;
  let bestCount = 0;
  for (const [b, c] of issueCounts.entries()) {
    if (c > bestCount) { bestCount = c; bestBucket = b; }
  }
  out.topIssueBucket = bestBucket;
  return out;
}

// ── Layaway profile ───────────────────────────────────────

function computeLayawayProfile(layaways: Layaway[], customerId: string, nowMs: number): LayawayProfile {
  const out: LayawayProfile = {
    total: 0, completed: 0, cancelled: 0, abandoned: 0,
    completionRate: 0, activeBalanceCents: 0,
  };
  for (const l of (layaways || [])) {
    if (l.customerId !== customerId) continue;
    out.total++;
    const s = statusKey(l.status);
    if (s === 'completed') out.completed++;
    if (s === 'cancelled') out.cancelled++;
    if (s === 'forfeited' || s === 'cancelled') out.abandoned++;
    if (s === 'active' || s === 'pending' || s === '') {
      const lastActivityMs = tsOf(l.updatedAt) || tsOf(l.createdAt);
      if (lastActivityMs && daysBetween(lastActivityMs, nowMs) > 90 && (l.balance || 0) > 0) {
        out.abandoned++;
      } else {
        out.activeBalanceCents += Math.max(0, l.balance || 0);
      }
    }
  }
  out.completionRate = out.total > 0 ? out.completed / out.total : 0;
  return out;
}

// ── Store credit profile ──────────────────────────────────

function computeStoreCreditProfile(ledger: StoreCreditLedger[], customerId: string, nowMs: number): StoreCreditProfile {
  const out: StoreCreditProfile = {
    active: 0, voided: 0, redeemed: 0, totalRemainingCents: 0, oldestActiveAgeDays: null,
  };
  for (const c of (ledger || [])) {
    if (c.customerId !== customerId) continue;
    if (c.status === 'active')   out.active++;
    if (c.status === 'voided')   out.voided++;
    if (c.status === 'redeemed') out.redeemed++;
    if (c.status === 'active') {
      out.totalRemainingCents += Math.max(0, c.remainingAmount || 0);
      const ageMs = tsOf(c.issuedAt);
      if (ageMs) {
        const d = daysBetween(ageMs, nowMs);
        if (out.oldestActiveAgeDays === null || d > out.oldestActiveAgeDays) {
          out.oldestActiveAgeDays = d;
        }
      }
    }
  }
  return out;
}

// ── Tag derivation (rule-based only) ──────────────────────

function deriveTags(args: {
  cadence: PhonePaymentCadence;
  repair: RepairProfile;
  layaway: LayawayProfile;
  storeCredit: StoreCreditProfile;
  totalSpendCents: number;
  daysSinceLastActivity: number | null;
}): CustomerTag[] {
  const out = new Set<CustomerTag>();
  const { cadence, repair, layaway, storeCredit, totalSpendCents, daysSinceLastActivity } = args;

  // Reliable payer: at least 3 payments, on-time streak >= 3, not currently late.
  if (cadence.paymentCount >= 3 && cadence.onTimeStreak >= 3 && !cadence.isLate) {
    out.add('reliable_payer');
  }
  // Late payer: currently late OR skipped likely.
  if (cadence.isLate || cadence.skippedLikely) {
    out.add('late_payer');
  }
  // VIP / inactive VIP — driven by lifetime spend.
  if (totalSpendCents >= VIP_SPEND_CENTS) {
    out.add('vip');
    if (daysSinceLastActivity !== null && daysSinceLastActivity >= VIP_INACTIVE_DAYS) {
      out.add('inactive_vip');
    }
  }
  // Repeat repair customer: 2+ repairs OR same device repaired 2+ times.
  if (repair.totalRepairs >= REPEAT_REPAIR_MIN || repair.repeatedDeviceCount >= 1) {
    out.add('repeat_repair_customer');
  }
  // Abandoned layaway risk: >= 2 layaways and abandoned share >= 50%.
  if (layaway.total >= 2 && (layaway.abandoned / layaway.total) >= ABANDONED_RATIO_MIN) {
    out.add('abandoned_layaway_risk');
  }
  // Frequent upgrader: 3+ completed repairs (proxy: customer keeps repairing devices).
  if (repair.completedRepairs >= FREQ_UPGRADE_REPAIR_MIN) {
    out.add('frequent_upgrader');
  }
  // Unused credit holder: any active cert >= $50 idle 30+ days.
  if (
    storeCredit.totalRemainingCents >= UNUSED_CREDIT_MIN_CENTS &&
    storeCredit.oldestActiveAgeDays !== null &&
    storeCredit.oldestActiveAgeDays >= UNUSED_CREDIT_MIN_DAYS
  ) {
    out.add('unused_credit_holder');
  }
  return [...out];
}

// ── Public entry point ────────────────────────────────────

export interface BuildTimelineInput {
  customerId: string;
  sales: Sale[];
  repairs: Repair[];
  layaways: Layaway[];
  customerReturns?: CustomerReturn[];
  specialOrders?: SpecialOrder[];
  /** Optional — when omitted, the engine falls back to localStorage. */
  storeCreditLedger?: StoreCreditLedger[];
  nowMs?: number;
}

/**
 * Build the full deterministic timeline for one customer. Pure function —
 * same inputs always produce the same output. Callers (engine, chat
 * handler, modal) memoize on the customerId + relevant array references.
 */
export function buildCustomerTimeline(input: BuildTimelineInput): CustomerTimeline {
  const nowMs = input.nowMs ?? Date.now();

  // Phone payment cadence
  const phonePayments = extractPhonePayments(input.sales, input.customerId);
  const cadence = computeCadence(phonePayments, nowMs);

  // Repair profile
  const repairProfile = computeRepairProfile(input.repairs, input.customerId);

  // Layaway profile
  const layawayProfile = computeLayawayProfile(input.layaways, input.customerId, nowMs);

  // Store credit profile — accepts injected ledger or falls back to local
  // storage (where AppState hydrates from) so callers without an explicit
  // ledger reference still get a real snapshot.
  let ledger: StoreCreditLedger[] = input.storeCreditLedger || [];
  if (!input.storeCreditLedger) {
    try { ledger = loadLocal<StoreCreditLedger[]>('store_credit_ledger', []) || []; }
    catch { ledger = []; }
  }
  const storeCreditProfile = computeStoreCreditProfile(ledger, input.customerId, nowMs);

  // Lifetime spend (excludes voided/refunded — same convention as Reports).
  let totalSpendCents = 0;
  for (const s of (input.sales || [])) {
    if (s.customerId !== input.customerId) continue;
    if (s.status === 'voided' || s.status === 'refunded') continue;
    totalSpendCents += Math.max(0, s.total || 0);
  }

  // Last activity across domains.
  let lastActivityMs: number | null = null;
  const bump = (ms: number) => { if (ms > 0 && (lastActivityMs === null || ms > lastActivityMs)) lastActivityMs = ms; };
  if (cadence.lastPaymentDateMs) bump(cadence.lastPaymentDateMs);
  for (const s of (input.sales || [])) {
    if (s.customerId !== input.customerId) continue;
    bump(tsOf(s.createdAt));
  }
  for (const r of (input.repairs || [])) {
    if (r.customerId !== input.customerId) continue;
    bump(tsOf(r.updatedAt) || tsOf(r.createdAt));
  }
  for (const l of (input.layaways || [])) {
    if (l.customerId !== input.customerId) continue;
    bump(tsOf(l.updatedAt) || tsOf(l.createdAt));
  }
  const daysSinceLastActivity = lastActivityMs !== null ? daysBetween(lastActivityMs, nowMs) : null;

  const tags = deriveTags({
    cadence,
    repair: repairProfile,
    layaway: layawayProfile,
    storeCredit: storeCreditProfile,
    totalSpendCents,
    daysSinceLastActivity,
  });

  // Compact context lines (display strings produced from translation keys).
  // Pure structural lines — i18n is applied by callers via formatContextLines.
  const contextLines: string[] = [];

  return {
    customerId: input.customerId,
    cadence,
    repairProfile,
    layawayProfile,
    storeCreditProfile,
    totalSpendCents,
    lastActivityMs,
    tags,
    contextLines,
  };
}

// ── Formatters for callers (i18n-aware) ───────────────────

export type Lang3 = 'en' | 'es' | 'pt';

/**
 * Translate a timeline into a short list of operator-facing context lines.
 * Caller passes a `t(key, ...args)` lookup. Order is deterministic (most
 * actionable first: cadence → streak → repair → layaway → credit → VIP).
 *
 * Examples (en):
 *   - "Usually pays every 30d"
 *   - "Last payment 32d ago — 2d overdue"
 *   - "On-time streak: 5 payments"
 *   - "3 completed repairs historically — repeat battery issue"
 *   - "Completes layaways consistently (4/5)"
 *   - "Unused store credit $120 — idle 82d"
 *   - "VIP — lifetime $1,840"
 */
export function formatTimelineContext(
  timeline: CustomerTimeline,
  t: (key: string, ...args: unknown[]) => string,
): string[] {
  const lines: string[] = [];
  const c = timeline.cadence;
  const fc = (cents: number) => '$' + (cents / 100).toFixed(2);

  if (c.averageDaysBetween !== null) {
    lines.push(t('customerTimeline.cadence.usuallyPays', c.averageDaysBetween));
  }
  if (c.lastPaymentDateMs !== null && c.daysSinceLast !== null) {
    if (c.isLate && c.cadenceDeltaDays !== null && c.cadenceDeltaDays > 0) {
      lines.push(t('customerTimeline.cadence.lastPaymentLate', c.daysSinceLast, c.cadenceDeltaDays));
    } else if (c.skippedLikely) {
      lines.push(t('customerTimeline.cadence.skipped', c.daysSinceLast));
    } else {
      lines.push(t('customerTimeline.cadence.lastPaymentDays', c.daysSinceLast));
    }
  }
  if (c.onTimeStreak >= 3) {
    lines.push(t('customerTimeline.cadence.onTimeStreak', c.onTimeStreak));
  }
  if (timeline.repairProfile.completedRepairs >= 1) {
    const issue = timeline.repairProfile.topIssueBucket;
    const issueKey = issue && issue !== 'other' ? `customerTimeline.repair.issue.${issue}` : null;
    if (issueKey && timeline.repairProfile.repeatedDeviceCount >= 1) {
      lines.push(t('customerTimeline.repair.withRepeatIssue',
        timeline.repairProfile.completedRepairs, t(issueKey)));
    } else {
      lines.push(t('customerTimeline.repair.completed', timeline.repairProfile.completedRepairs));
    }
  }
  if (timeline.layawayProfile.total >= 2) {
    if (timeline.tags.includes('abandoned_layaway_risk')) {
      lines.push(t('customerTimeline.layaway.abandonRisk',
        timeline.layawayProfile.abandoned, timeline.layawayProfile.total));
    } else if (timeline.layawayProfile.completionRate >= 0.75) {
      lines.push(t('customerTimeline.layaway.reliable',
        timeline.layawayProfile.completed, timeline.layawayProfile.total));
    }
  }
  if (timeline.tags.includes('unused_credit_holder')) {
    lines.push(t('customerTimeline.storeCredit.unused',
      fc(timeline.storeCreditProfile.totalRemainingCents),
      timeline.storeCreditProfile.oldestActiveAgeDays ?? 0));
  }
  if (timeline.tags.includes('vip')) {
    if (timeline.tags.includes('inactive_vip')) {
      lines.push(t('customerTimeline.vip.inactive',
        fc(timeline.totalSpendCents),
        // daysSinceLastActivity is recomputed here from lastActivityMs to keep
        // formatTimelineContext self-contained.
        timeline.lastActivityMs !== null
          ? Math.max(0, Math.floor((Date.now() - timeline.lastActivityMs) / 86400000))
          : 0));
    } else {
      lines.push(t('customerTimeline.vip.active', fc(timeline.totalSpendCents)));
    }
  }
  return lines;
}

/** Translate a tag enum into a short display label. Caller passes t(). */
export function formatTimelineTagLabel(
  tag: CustomerTag,
  t: (key: string, ...args: unknown[]) => string,
): string {
  return t(`customerTimeline.tag.${tag}`);
}
