// ============================================================
// PAYMENT DATE FINDER — F1: pure deterministic matching engine
// ============================================================
//
// Finds customers to contact before a vacation / holiday / closure by
// looking at WHEN they historically paid. CellHub has NO stored payment
// "due date" on the Customer model (verified against src/store/types.ts),
// so every due date this engine produces is ESTIMATED from payment history
// and is flagged `isEstimated: true`. The ONLY real, non-estimated due date
// available is Layaway.dueDate — those surface as status 'due_in_range'
// with isEstimated=false.
//
// This module is PURE: no localStorage, no persistence, no DOM, no message
// generation, no side effects. It takes data + options in and returns rows
// out. Message templating, UI, campaign persistence, and export are later
// phases (F2–F5). Callers pass `referenceDate` ("now") so the whole thing
// is deterministic and unit-testable.
//
// Payment signal (per auditor decision): a "payment" is a completed Sale
// containing at least one line item in the phone-payment / top-up
// categories. Those are the recurring, monthly-ish transactions that bring
// a customer back — clean signal for cycle estimation. One-off product
// sales are intentionally ignored.
// ============================================================

import type { Customer, Sale, Layaway } from '@/store/types';
import { normalizePhone } from '@/utils/normalize';
import { toDate } from '@/utils/dates';

// ── Tuning constants (all overridable via options) ─────────────────────────
const DEFAULT_PAYMENT_CATEGORIES = ['phone_payment', 'top_up'];
const CYCLE_DEFAULT_DAYS = 30;   // fallback billing cycle when we can't infer one
const CYCLE_MIN_DAYS = 20;       // clamp inferred cycle so noise can't produce absurd cadences
const CYCLE_MAX_DAYS = 45;
const INACTIVE_THRESHOLD_DAYS = 90; // no payment in this window ⇒ "inactive"
const HIGH_VALUE_MIN_CENTS = 10000; // avg payment ≥ $100 ⇒ high-value flag
const PROJECTION_GUARD = 400;       // hard cap on cycle-roll iterations (safety)

// ── Public types ───────────────────────────────────────────────────────────

export type PaymentFinderStatus =
  | 'due_in_range'      // real due date (from a layaway) lands in the selected range
  | 'estimated_due'     // estimated next payment lands in the selected range
  | 'historical_match'  // paid during the equivalent window in a prior month
  | 'already_paid';     // already paid inside the selected range (only if opted-in)

export interface PaymentFinderOptions {
  /** Selected range start (inclusive, day granularity). */
  startDate: Date;
  /** Selected range end (inclusive, day granularity). */
  endDate: Date;
  /** "Now". Defaults to new Date() — pass explicitly in tests for determinism. */
  referenceDate?: Date;
  /** How many prior months to scan for historical matches (0, 1, or 2). */
  compareMonths?: 0 | 1 | 2;
  /** Include estimated_due + historical_match rows. Default true. */
  includeEstimatedDueDates?: boolean;
  /** Include customers who already paid inside the range. Default false. */
  includeAlreadyPaid?: boolean;
  /** Include customers with no payment in the inactivity window. Default false. */
  includeInactive?: boolean;
  /** Which sale-item categories count as a "payment". Default phone_payment + top_up. */
  paymentCategories?: string[];
  /** Days without a payment before a customer is considered inactive. Default 90. */
  inactiveThresholdDays?: number;
  /** Avg payment ≥ this (cents) flags a high-value customer. Default 10000. */
  highValueMinCents?: number;
  /** Fallback cycle length when it can't be inferred. Default 30. */
  cycleDefaultDays?: number;
}

export interface PaymentFinderRow {
  customerId: string;
  customerName: string;
  phone: string;
  carrier: string;
  lineCount: number;
  isMultiLine: boolean;
  /** ISO date of the most recent qualifying payment, or null if none. */
  lastPaymentDate: string | null;
  lastPaymentAmountCents: number | null;
  averagePaymentAmountCents: number | null;
  paymentCount: number;
  /** ISO date of the next estimated payment (always estimated), or null. */
  estimatedNextDueDate: string | null;
  /** ISO date used for sorting: real due if available, else estimated/mapped. */
  effectiveDueDate: string | null;
  /** True whenever effectiveDueDate is estimated (false only for layaway due). */
  isEstimated: boolean;
  status: PaymentFinderStatus;
  isHighValue: boolean;
  /** For historical_match: which prior month (1 or 2) produced the match. */
  matchedHistoricalOffsetMonths?: number;
  /** For due_in_range: the layaway that supplied the real due date. */
  layawayId?: string;
}

export interface PaymentFinderResult {
  rows: PaymentFinderRow[];
  generatedAt: string;   // ISO of referenceDate
  rangeStart: string;    // ISO (midnight) of startDate
  rangeEnd: string;      // ISO (midnight) of endDate
  counts: {
    total: number;
    dueInRange: number;
    estimatedDue: number;
    historicalMatch: number;
    alreadyPaid: number;
  };
}

// ── Internal date helpers (pure, day-granularity) ──────────────────────────

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + days);
  return r;
}

/** Calendar-month shift. Negative months go back. Day-of-month preserved (JS normalizes overflow). */
function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}

function inRangeInclusive(day: Date, start: Date, end: Date): boolean {
  const t = day.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function isValidDate(d: Date): boolean {
  return !isNaN(d.getTime());
}

/** Normalize a category string for tolerant comparison: 'top_up'/'topup'/'top-up' → 'topup'. */
function normalizeCat(cat: string): string {
  return String(cat || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Median inter-payment gap (days), clamped. Falls back to `def` with < 2 dates. */
function estimateCycleDays(sortedDates: Date[], def: number): number {
  if (sortedDates.length < 2) return def;
  const gaps: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const g = Math.round((sortedDates[i].getTime() - sortedDates[i - 1].getTime()) / 86_400_000);
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return def;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const med = gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
  return Math.min(CYCLE_MAX_DAYS, Math.max(CYCLE_MIN_DAYS, med));
}

/** First cycle-projected due on/after `from`. */
function projectNextDue(lastPayment: Date, cycleDays: number, from: Date): Date {
  let cand = addDays(atMidnight(lastPayment), cycleDays);
  let guard = 0;
  while (cand.getTime() < from.getTime() && guard < PROJECTION_GUARD) {
    cand = addDays(cand, cycleDays);
    guard++;
  }
  return cand;
}

/** The projected due that lands inside [start, end], or null if none does. */
function estimatedDueInRange(lastPayment: Date, cycleDays: number, start: Date, end: Date): Date | null {
  const cand = projectNextDue(lastPayment, cycleDays, start);
  return cand.getTime() <= end.getTime() ? cand : null;
}

// ── Internal aggregation shapes ────────────────────────────────────────────

interface PaymentEvent { date: Date; amountCents: number; }

// ── Core engine ────────────────────────────────────────────────────────────

export function findPaymentDates(
  input: { customers: Customer[]; sales: Sale[]; layaways?: Layaway[] },
  options: PaymentFinderOptions,
): PaymentFinderResult {
  const customers = input.customers || [];
  const sales = input.sales || [];
  const layaways = input.layaways || [];

  const referenceDate = atMidnight(options.referenceDate ?? new Date());
  const start = atMidnight(options.startDate);
  const end = atMidnight(options.endDate);
  const compareMonths = options.compareMonths ?? 0;
  const includeEstimated = options.includeEstimatedDueDates ?? true;
  const includeAlreadyPaid = options.includeAlreadyPaid ?? false;
  const includeInactive = options.includeInactive ?? false;
  const inactiveThresholdDays = options.inactiveThresholdDays ?? INACTIVE_THRESHOLD_DAYS;
  const highValueMinCents = options.highValueMinCents ?? HIGH_VALUE_MIN_CENTS;
  const cycleDefaultDays = options.cycleDefaultDays ?? CYCLE_DEFAULT_DAYS;

  const paymentCatSet = new Set(
    (options.paymentCategories ?? DEFAULT_PAYMENT_CATEGORIES).map(normalizeCat),
  );

  // ── Pass 1: bucket payment events ONCE (AlertEngine pattern — never filter
  // sales inside the per-customer loop). Each sale lands in exactly one bucket:
  // by customerId when present, else by normalized customerPhone. This keeps
  // the two buckets disjoint so no sale is double-counted.
  const eventsById = new Map<string, PaymentEvent[]>();
  const eventsByPhone = new Map<string, PaymentEvent[]>();

  for (const sale of sales) {
    if (!sale || sale.status !== 'completed') continue;
    const items = sale.items || [];
    let amountCents = 0;
    for (const it of items) {
      if (!it) continue;
      if (paymentCatSet.has(normalizeCat(it.category))) {
        amountCents += (it.price || 0) * (it.qty || 0);
      }
    }
    if (amountCents <= 0) continue; // not a payment sale

    const d = toDate(sale.createdAt);
    if (!isValidDate(d)) continue;
    const ev: PaymentEvent = { date: atMidnight(d), amountCents };

    if (sale.customerId) {
      const arr = eventsById.get(sale.customerId);
      if (arr) arr.push(ev); else eventsById.set(sale.customerId, [ev]);
    } else {
      const p = normalizePhone(sale.customerPhone || '');
      if (!p) continue;
      const arr = eventsByPhone.get(p);
      if (arr) arr.push(ev); else eventsByPhone.set(p, [ev]);
    }
  }

  // ── Pass 2: bucket the earliest upcoming real due date from layaways.
  // Keyed by customerId and by normalized phone. Terminal statuses excluded.
  const dueById = new Map<string, { date: Date; layawayId: string }>();
  const dueByPhone = new Map<string, { date: Date; layawayId: string }>();

  const considerLayawayDue = (
    map: Map<string, { date: Date; layawayId: string }>,
    key: string,
    date: Date,
    layawayId: string,
  ) => {
    const prev = map.get(key);
    if (!prev || date.getTime() < prev.date.getTime()) map.set(key, { date, layawayId });
  };

  for (const lay of layaways) {
    if (!lay || !lay.dueDate) continue;
    const status = String(lay.status || '').toLowerCase();
    if (status === 'completed' || status === 'cancelled' || status === 'forfeited') continue;
    const d = toDate(lay.dueDate);
    if (!isValidDate(d)) continue;
    const day = atMidnight(d);
    if (lay.customerId) considerLayawayDue(dueById, lay.customerId, day, lay.id);
    const p = normalizePhone(lay.customerPhone || '');
    if (p) considerLayawayDue(dueByPhone, p, day, lay.id);
  }

  // ── Pass 3: one row per matching customer.
  const rows: PaymentFinderRow[] = [];

  for (const c of customers) {
    if (!c) continue;

    // Gather this customer's payment events from the disjoint buckets:
    // id-bucket + phone-bucket(s) for every phone on the record.
    const events: PaymentEvent[] = [];
    const byId = eventsById.get(c.id);
    if (byId) events.push(...byId);

    const phones = collectPhones(c);
    for (const p of phones) {
      const byPhone = eventsByPhone.get(p);
      if (byPhone) events.push(...byPhone);
    }

    // Real layaway due (id first, then any phone).
    let realDue: { date: Date; layawayId: string } | undefined = dueById.get(c.id);
    if (!realDue) {
      for (const p of phones) {
        const d = dueByPhone.get(p);
        if (d && (!realDue || d.date.getTime() < realDue.date.getTime())) realDue = d;
      }
    }

    if (events.length === 0 && !realDue) continue; // nothing to reason about

    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    const paymentDates = events.map((e) => e.date);
    const paymentCount = events.length;
    const lastEvent = events[paymentCount - 1];
    const lastPaymentDate = lastEvent ? lastEvent.date : null;
    const lastPaymentAmountCents = lastEvent ? lastEvent.amountCents : null;
    const averagePaymentAmountCents = paymentCount
      ? Math.round(events.reduce((s, e) => s + e.amountCents, 0) / paymentCount)
      : null;

    const cycleDays = estimateCycleDays(paymentDates, cycleDefaultDays);
    const estimatedNextDue = lastPaymentDate
      ? projectNextDue(lastPaymentDate, cycleDays, referenceDate)
      : null;

    const isInactive =
      !lastPaymentDate ||
      (referenceDate.getTime() - lastPaymentDate.getTime()) / 86_400_000 > inactiveThresholdDays;

    // ── Classify (single primary status, priority order). ──
    let status: PaymentFinderStatus | null = null;
    let effectiveDueDate: Date | null = null;
    let isEstimated = true;
    let matchedHistoricalOffsetMonths: number | undefined;
    let layawayId: string | undefined;

    // Already paid inside the range suppresses everything else: someone who
    // just paid should never be nagged. Included only when opted-in.
    const paidInRange = paymentDates.some((d) => inRangeInclusive(d, start, end));

    if (paidInRange) {
      if (!includeAlreadyPaid) continue;
      status = 'already_paid';
      const inRangeDates = paymentDates.filter((d) => inRangeInclusive(d, start, end));
      effectiveDueDate = inRangeDates[inRangeDates.length - 1] ?? null;
      isEstimated = false; // it actually happened
    } else if (realDue && inRangeInclusive(realDue.date, start, end)) {
      status = 'due_in_range';
      effectiveDueDate = realDue.date;
      isEstimated = false;
      layawayId = realDue.layawayId;
    } else if (includeEstimated && lastPaymentDate) {
      const estDue = estimatedDueInRange(lastPaymentDate, cycleDays, start, end);
      if (estDue) {
        status = 'estimated_due';
        effectiveDueDate = estDue;
        isEstimated = true;
      } else {
        const hist = findHistoricalMatch(paymentDates, start, end, compareMonths);
        if (hist) {
          status = 'historical_match';
          matchedHistoricalOffsetMonths = hist.offsetMonths;
          // Map the matched prior-month date forward into the selected range.
          effectiveDueDate = addMonths(hist.matchedDate, hist.offsetMonths);
          isEstimated = true;
        }
      }
    }

    if (!status) continue;

    // Inactive filter — a hard real due date (layaway) always survives.
    if (isInactive && !includeInactive && status !== 'due_in_range' && status !== 'already_paid') {
      continue;
    }

    const lineCount = phones.length;
    rows.push({
      customerId: c.id,
      customerName: displayName(c),
      phone: c.phone || phones[0] || '',
      carrier: c.carrier || c.carriers?.[0] || '',
      lineCount,
      isMultiLine: lineCount > 1,
      lastPaymentDate: lastPaymentDate ? lastPaymentDate.toISOString() : null,
      lastPaymentAmountCents,
      averagePaymentAmountCents,
      paymentCount,
      estimatedNextDueDate: estimatedNextDue ? estimatedNextDue.toISOString() : null,
      effectiveDueDate: effectiveDueDate ? effectiveDueDate.toISOString() : null,
      isEstimated,
      status,
      isHighValue: (averagePaymentAmountCents ?? 0) >= highValueMinCents,
      matchedHistoricalOffsetMonths,
      layawayId,
    });
  }

  // ── Sort (spec priority, minus "not contacted" which is a runtime/campaign
  // concern layered on top in later phases): due date soonest → higher avg
  // payment → multiple lines → high value → name.
  rows.sort((a, b) => {
    const ad = a.effectiveDueDate ? Date.parse(a.effectiveDueDate) : Number.POSITIVE_INFINITY;
    const bd = b.effectiveDueDate ? Date.parse(b.effectiveDueDate) : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    const aa = a.averagePaymentAmountCents ?? 0;
    const ba = b.averagePaymentAmountCents ?? 0;
    if (aa !== ba) return ba - aa;
    if (a.isMultiLine !== b.isMultiLine) return a.isMultiLine ? -1 : 1;
    if (a.isHighValue !== b.isHighValue) return a.isHighValue ? -1 : 1;
    return a.customerName.localeCompare(b.customerName);
  });

  const counts = {
    total: rows.length,
    dueInRange: rows.filter((r) => r.status === 'due_in_range').length,
    estimatedDue: rows.filter((r) => r.status === 'estimated_due').length,
    historicalMatch: rows.filter((r) => r.status === 'historical_match').length,
    alreadyPaid: rows.filter((r) => r.status === 'already_paid').length,
  };

  return {
    rows,
    generatedAt: referenceDate.toISOString(),
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    counts,
  };
}

// ── Small pure helpers (exported for reuse/testing) ────────────────────────

/** All normalized phones on a customer (primary + phones[]), de-duped. */
export function collectPhones(c: Customer): string[] {
  const out = new Set<string>();
  const primary = normalizePhone(c.phone || '');
  if (primary) out.add(primary);
  for (const p of c.phones || []) {
    const n = normalizePhone(p || '');
    if (n) out.add(n);
  }
  return [...out];
}

function displayName(c: Customer): string {
  const full = `${c.firstName || ''} ${c.lastName || ''}`.trim();
  return full || c.name || c.phone || 'Unknown';
}

/**
 * Scan prior months (1..compareMonths) for a payment in the equivalent
 * window. Returns the closest month (smallest offset) that matches.
 */
export function findHistoricalMatch(
  paymentDates: Date[],
  start: Date,
  end: Date,
  compareMonths: number,
): { offsetMonths: number; matchedDate: Date } | null {
  for (let m = 1; m <= compareMonths; m++) {
    const shiftedStart = addMonths(start, -m);
    const shiftedEnd = addMonths(end, -m);
    for (const d of paymentDates) {
      if (inRangeInclusive(d, shiftedStart, shiftedEnd)) {
        return { offsetMonths: m, matchedDate: d };
      }
    }
  }
  return null;
}
