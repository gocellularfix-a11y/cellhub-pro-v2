// ============================================================
// CellHub Pro — Operator Customer Snapshot
// CUSTOMER-SNAPSHOT-AMBIENT-INTELLIGENCE-V1
//
// Pure, deterministic composer for the floating operator bubble's
// "Customer Snapshot" HUD section. NO scoring of its own:
//   - tier / churn / collection / upsell ← CustomerBusinessProfile
//     (customerScoringEngine — already memoized in the bubble)
//   - raw aggregates (lifetime, repair count, open balance) are single
//     O(n) passes over the arrays already in the bubble's scope,
//     computed ONLY when the contextual customer changes (caller memoizes).
//
// Output is i18n-key based (operator.snapshot.*) — the component
// translates; values are language-neutral strings ($, counts, years).
// Rows the data can't back are simply omitted (never fabricated).
// ============================================================

import type { Customer, Sale, Repair, Layaway, Unlock } from '@/store/types';
import type { CustomerBusinessProfile } from '../intelligence/customerScoring/customerScoringTypes';
// R-CUSTOMER-LINE-PAYMENTS-V1: per-line-aware monthly total (legacy fallback once).
import { getMonthlyTotalCents } from '../customers/linePayments';

export type SnapshotTone = 'neutral' | 'good' | 'warn' | 'bad';

export interface SnapshotRow {
  id: string;
  /** operator.snapshot.* label key */
  labelKey: string;
  /** Language-neutral display value ("$4,280", "7", "2021", "12d"). */
  value?: string;
  /** i18n key for translated values (risk levels). Wins over `value`. */
  valueKey?: string;
  tone: SnapshotTone;
}

export interface SnapshotSignal {
  id: string;
  /** operator.snapshot.sig.* label key */
  labelKey: string;
  // CUSTOMER-SNAPSHOT-OPERATOR-SIGNALS-V1: spec tone set ('danger'/'neutral'
  // added, 'bad' renamed 'danger') + 'vip' kept for the distinct violet chip.
  tone: 'vip' | 'good' | 'warn' | 'danger' | 'info' | 'neutral';
  /** Context-resolved render order — lower renders first. */
  priority: number;
}

export interface CustomerSnapshot {
  rows: SnapshotRow[];
  signals: SnapshotSignal[];
}

const MAX_ROWS = 6;
const MAX_SIGNALS = 4;

// CUSTOMER-SNAPSHOT-OPERATOR-SIGNALS-V1 — deterministic signal thresholds.
// Raw-aggregate based (work even when the scoring profile is unavailable);
// kept as named constants so the auditor can tune them in one place.
const SIG_VIP_LIFETIME_CENTS        = 250_000; // $2,500 lifetime → VIP
const SIG_HIGH_VALUE_LIFETIME_CENTS = 100_000; // $1,000 lifetime → HIGH VALUE
const SIG_LOYAL_AGE_DAYS            = 365;     // customer on file ≥ 1 year
const SIG_LOYAL_ACTIVITY_COUNT      = 6;       // repairs + sales combined
const SIG_PAYMENT_RISK_STALE_DAYS   = 14;      // owes money + this stale
const SIG_HIGH_BALANCE_CENTS        = 10_000;  // $100 open balance
const SIG_FREQUENT_REPAIRS_COUNT    = 5;
const SIG_RECOVERY_DAYS             = 60;      // inactive this long

// CUSTOMER-LAST-VISIT-CURRENT-SESSION-WINDOW-V1 (day-boundary follow-up):
// "last visit" must be a PREVIOUS CALENDAR DAY. Any same-day activity —
// the deposit Sale just processed, a repair created this afternoon, a
// morning purchase — is part of TODAY and must never render as "0d ago".
// The first 60-minute window still produced 0d for any activity earlier
// the same day; a local-midnight boundary kills 0d permanently.
// Shared with the operator hint pipeline (operatorActivityHints).
export function lastVisitCutoffMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole calendar days between two timestamps (local midnights). ≥ 1 when
 *  `earlierMs` is before today's cutoff. */
export function calendarDaysBetween(earlierMs: number, nowMs: number): number {
  const a = new Date(earlierMs); a.setHours(0, 0, 0, 0);
  const b = new Date(nowMs);     b.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/** Entity states whose balance is no longer collectible/open. */
const TERMINAL_STATUS = new Set([
  'cancelled', 'canceled', 'refunded', 'refund_pending',
  'picked_up', 'picked up', 'completed', 'forfeited', 'delivered', 'done',
]);

function statusKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '_');
}

function tsOf(d: unknown): number | null {
  if (!d) return null;
  try {
    if (typeof d === 'object' && d !== null && typeof (d as { toDate?: () => Date }).toDate === 'function') {
      return (d as { toDate: () => Date }).toDate().getTime();
    }
    const t = new Date(d as string | Date).getTime();
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

const wholeDollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
const dollars = (cents: number) =>
  cents % 100 === 0 ? wholeDollars(cents) : `$${(cents / 100).toFixed(2)}`;

export interface ComposeSnapshotArgs {
  customer: Customer;
  /** OperatorActiveContext.contextType (or 'customer' fallback) — drives row order (PART E). */
  contextType: string;
  profile: CustomerBusinessProfile | null;
  sales: Sale[];
  repairs: Repair[];
  layaways: Layaway[];
  unlocks: Unlock[];
  /** LABEL-STUDIO-EDITOR-CONTROLS-PLUS-CUSTOMER-LAST-VISIT-FIX-V1: ids of the
   *  CURRENTLY OPENED entities (active repair/layaway/unlock/special order
   *  from intelligenceContext). Excluded from the last-visit computation so
   *  "Last visit" means the previous REAL activity, not the record the
   *  operator just opened (the misleading "0d" bug). */
  excludeEntityIds?: ReadonlySet<string>;
  nowMs?: number;
}

export function composeCustomerSnapshot(args: ComposeSnapshotArgs): CustomerSnapshot {
  const { customer, contextType, profile, sales, repairs, layaways, unlocks } = args;
  const now = args.nowMs ?? Date.now();
  const cid = customer.id;
  const exclude = args.excludeEntityIds;

  // ── Single-pass aggregates (no nested scans) ──────────────
  // LABEL-STUDIO-EDITOR-CONTROLS-PLUS-CUSTOMER-LAST-VISIT-FIX-V1: last-visit
  // is now derived here (max createdAt across the customer's activity,
  // EXCLUDING the currently-opened entity ids) instead of profile.lastVisitAt
  // (which includes the just-opened record → misleading "0d"). Timestamps are
  // collected inside the SAME loops — zero extra passes.
  let prevVisitMs: number | null = null;
  // CUSTOMER-LAST-VISIT-CURRENT-SESSION-WINDOW-V1: activity from TODAY
  // (incl. the just-created deposit Sale) = the current visit/day.
  let hasCurrentVisitActivity = false;
  const visitCutoff = lastVisitCutoffMs(now);
  const trackVisit = (entityId: string | undefined, created: unknown) => {
    if (entityId && exclude?.has(entityId)) return;
    const ts = tsOf(created);
    if (!ts) return;
    if (ts >= visitCutoff) { hasCurrentVisitActivity = true; return; }
    if (prevVisitMs === null || ts > prevVisitMs) prevVisitMs = ts;
  };

  let lifetimeCents = 0;
  let salesCount = 0;
  for (const s of sales) {
    if ((s as { customerId?: string }).customerId !== cid) continue;
    const st = statusKey((s as { status?: string }).status);
    if (st === 'voided' || st === 'refunded') continue;
    lifetimeCents += (s as { total?: number }).total || 0;
    salesCount++;
    trackVisit((s as { id?: string }).id, (s as { createdAt?: unknown }).createdAt);
  }

  let repairCount = 0;
  let openBalanceCents = 0;
  for (const r of repairs) {
    if (r.customerId !== cid) continue;
    repairCount++;
    if (!TERMINAL_STATUS.has(statusKey(r.status))) {
      openBalanceCents += Math.max(0, r.balance || 0);
    }
    trackVisit(r.id, r.createdAt);
  }
  for (const l of layaways) {
    if (l.customerId !== cid) continue;
    if (!TERMINAL_STATUS.has(statusKey(l.status))) {
      openBalanceCents += Math.max(0, l.balance || 0);
    }
    trackVisit(l.id, l.createdAt);
  }
  for (const u of unlocks) {
    if ((u as { customerId?: string }).customerId !== cid) continue;
    if (!TERMINAL_STATUS.has(statusKey((u as { status?: string }).status))) {
      openBalanceCents += Math.max(0, (u as { balance?: number }).balance || 0);
    }
    trackVisit((u as { id?: string }).id, (u as { createdAt?: unknown }).createdAt);
  }

  // ── Candidate rows (omitted when the data can't back them) ──
  const rows = new Map<string, SnapshotRow>();

  const sinceMs = tsOf(customer.createdAt);
  if (sinceMs) {
    rows.set('since', { id: 'since', labelKey: 'operator.snapshot.since', value: String(new Date(sinceMs).getFullYear()), tone: 'neutral' });
  }

  const carrier = (customer.carrier || '').trim();
  if (carrier) {
    rows.set('carrier', { id: 'carrier', labelKey: 'operator.snapshot.carrier', value: carrier, tone: 'neutral' });
  }

  // R-CUSTOMER-LINE-PAYMENTS-V1: exact sum of per-line amounts; legacy
  // customer-level value counted once as fallback — never both.
  const billCents = getMonthlyTotalCents(customer);
  if (billCents != null && billCents > 0) {
    rows.set('bill', { id: 'bill', labelKey: 'operator.snapshot.bill', value: `$${Math.round(billCents / 100)}`, tone: 'neutral' });
  }

  if (lifetimeCents > 0) {
    rows.set('lifetime', { id: 'lifetime', labelKey: 'operator.snapshot.lifetime', value: wholeDollars(lifetimeCents), tone: 'good' });
  }

  if (repairCount > 0) {
    rows.set('repairs', { id: 'repairs', labelKey: 'operator.snapshot.repairs', value: String(repairCount), tone: 'neutral' });
  }

  // Last visit = most recent activity from a PREVIOUS calendar day —
  // calendar-day distance, so yesterday evening reads "1d", never "0d".
  // (prevVisitDays also feeds the signal rules below.)
  const prevVisitDays = prevVisitMs !== null ? calendarDaysBetween(prevVisitMs, now) : null;
  if (prevVisitDays !== null) {
    rows.set('lastVisit', {
      id: 'lastVisit',
      labelKey: 'operator.snapshot.lastVisit',
      value: `${prevVisitDays}d`,
      tone: prevVisitDays >= 60 ? 'warn' : 'neutral',
    });
  } else if (hasCurrentVisitActivity || (exclude && exclude.size > 0)) {
    // The only known activity IS the current visit / currently-opened record.
    rows.set('lastVisit', {
      id: 'lastVisit',
      labelKey: 'operator.snapshot.lastVisit',
      valueKey: 'operator.snapshot.firstVisit',
      tone: 'neutral',
    });
  }
  // No activity at all → row omitted (no misleading data).

  if (openBalanceCents > 0) {
    rows.set('openBalance', { id: 'openBalance', labelKey: 'operator.snapshot.openBalance', value: dollars(openBalanceCents), tone: 'warn' });
  }

  if (profile) {
    const risk = profile.churnRisk;
    rows.set('risk', {
      id: 'risk',
      labelKey: 'operator.snapshot.risk',
      valueKey: risk < 35 ? 'operator.snapshot.risk.low' : risk < 65 ? 'operator.snapshot.risk.med' : 'operator.snapshot.risk.high',
      tone: risk < 35 ? 'good' : risk < 65 ? 'warn' : 'bad',
    });
  }

  // ── Context-aware ordering (PART E) — no unrelated noise ──
  // repair  → repair/balance history first (carrier/bill omitted)
  // layaway → money behavior first (carrier/bill omitted)
  // customer/activation/sale/payment → account-centric order
  const ORDER: Record<string, string[]> = {
    repair:        ['repairs', 'openBalance', 'lastVisit', 'lifetime', 'since', 'risk'],
    layaway:       ['openBalance', 'lifetime', 'lastVisit', 'repairs', 'since', 'risk'],
    default:       ['since', 'carrier', 'bill', 'lifetime', 'lastVisit', 'repairs', 'openBalance', 'risk'],
  };
  const order = ORDER[contextType] ?? ORDER.default;
  const orderedRows: SnapshotRow[] = [];
  for (const key of order) {
    const row = rows.get(key);
    if (row) orderedRows.push(row);
    if (orderedRows.length >= MAX_ROWS) break;
  }

  // ── Deterministic operator signals — CUSTOMER-SNAPSHOT-OPERATOR-SIGNALS-V1 ──
  // Raw-aggregate rules FIRST (they work even when the scoring profile is
  // null — e.g. context-only customer resolution); profile scores act as
  // additional OR-triggers, never the sole gate. No LLM, no randomness.
  const fired = new Map<string, SnapshotSignal['tone']>();

  // 1. VIP / HIGH VALUE — mutually exclusive, VIP wins.
  if (lifetimeCents >= SIG_VIP_LIFETIME_CENTS || profile?.estimatedCustomerTier === 'VIP') {
    fired.set('vip', 'vip');
  } else if (lifetimeCents >= SIG_HIGH_VALUE_LIFETIME_CENTS || (profile?.vipScore ?? 0) >= 70) {
    fired.set('highValue', 'info');
  }

  // 2. LOYAL — on file ≥ 1 year, or sustained activity volume.
  const ageDays = sinceMs ? Math.floor((now - sinceMs) / 86400000) : null;
  if ((ageDays !== null && ageDays >= SIG_LOYAL_AGE_DAYS && salesCount + repairCount > 0)
    || salesCount + repairCount >= SIG_LOYAL_ACTIVITY_COUNT
    || profile?.estimatedCustomerTier === 'Loyal') {
    fired.set('loyal', 'good');
  }

  // 3. PAYMENT RISK — owes money AND has gone stale (or scorer flags collection).
  const paymentRisk =
    (openBalanceCents > 0 && prevVisitDays !== null && prevVisitDays >= SIG_PAYMENT_RISK_STALE_DAYS)
    || (openBalanceCents > 0 && (profile?.collectionPriority ?? 0) >= 60);
  if (paymentRisk) fired.set('paymentRisk', 'danger');

  // 4. HIGH BALANCE — magnitude regardless of staleness.
  if (openBalanceCents >= SIG_HIGH_BALANCE_CENTS) fired.set('highBalance', 'warn');

  // 5. FREQUENT REPAIRS.
  if (repairCount >= SIG_FREQUENT_REPAIRS_COUNT) fired.set('frequentRepairs', 'info');

  // 6. RECOVERY — long inactive with real history, not blocked by payment risk.
  if (!paymentRisk && lifetimeCents > 0 && prevVisitDays !== null && prevVisitDays >= SIG_RECOVERY_DAYS) {
    fired.set('recovery', 'warn');
  }

  // 7. UPSELL — clean account with history, in a sell-adjacent context.
  const upsellContext = contextType === 'repair' || contextType === 'phone_payment' || contextType === 'sale';
  if (lifetimeCents > 0 && openBalanceCents === 0
    && (upsellContext || (profile?.upsellOpportunity ?? 0) >= 60)) {
    fired.set('upsell', 'good');
  }

  // ── Context-aware priority (PART C) — lower index renders first ──
  const SIGNAL_ORDER: Record<string, string[]> = {
    repair:        ['frequentRepairs', 'paymentRisk', 'upsell', 'vip', 'highBalance', 'loyal', 'highValue', 'recovery'],
    layaway:       ['highBalance', 'paymentRisk', 'recovery', 'vip', 'loyal', 'highValue', 'frequentRepairs', 'upsell'],
    phone_payment: ['upsell', 'loyal', 'vip', 'paymentRisk', 'highBalance', 'highValue', 'recovery', 'frequentRepairs'],
    sale:          ['upsell', 'loyal', 'vip', 'paymentRisk', 'highBalance', 'highValue', 'recovery', 'frequentRepairs'],
    default:       ['vip', 'loyal', 'highValue', 'recovery', 'paymentRisk', 'highBalance', 'frequentRepairs', 'upsell'],
  };
  const signalOrder = SIGNAL_ORDER[contextType] ?? SIGNAL_ORDER.default;

  const signals: SnapshotSignal[] = [];
  for (const [id, tone] of fired) {
    const idx = signalOrder.indexOf(id);
    signals.push({
      id,
      labelKey: `operator.snapshot.sig.${id}`,
      tone,
      priority: idx === -1 ? signalOrder.length : idx,
    });
  }
  signals.sort((a, b) => a.priority - b.priority);

  return { rows: orderedRows, signals: signals.slice(0, MAX_SIGNALS) };
}
