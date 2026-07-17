// ============================================================
// CellHub Intelligence — Data Access Layer
// R-INTEL-CELLHUB-DATA-ACCESS-LAYER
//
// Pure functions that take the raw business arrays and return
// structured summaries for the chat handler. Deterministic — no
// caching, no async, no external API. Money in integer cents.
// Date helpers handle Firestore Timestamp / ISO string / Date.
// ============================================================

import type {
  Sale, Customer, InventoryItem, Repair, Unlock, Layaway, SpecialOrder, CustomerReturn, Expense, Appointment,
} from '@/store/types';
// CELLHUB-INTELLIGENCE-I2A: financial calculations are owned by
// computeReportMoneyStats — the adapter wires data and maps fields only.
// The sales/employee/phone-payment money summaries below consume it; their
// previous parallel reductions were removed.
import {
  computeCanonicalMoneyForRange,
  localDayRangeForIntelRange,
} from '@/services/intelligence/adapters/reportMoneyAdapter';
import type { CanonicalMoneySnapshot } from '@/services/intelligence/adapters/reportMoneyAdapter';

export type DateRange = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days';

export interface DateBounds { start: number; end: number; }

const DAY_MS = 86_400_000;

// ── Date helpers ────────────────────────────────────────────

export function getDateBounds(range: DateRange): DateBounds {
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  switch (range) {
    case 'today':
      return { start: todayMs, end: todayMs + DAY_MS };
    case 'yesterday':
      return { start: todayMs - DAY_MS, end: todayMs };
    case 'this_week': {
      // Sunday-anchored week (matches US locale convention for the shop).
      const dow = now.getDay();
      const start = todayMs - dow * DAY_MS;
      return { start, end: todayMs + DAY_MS };
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { start, end: todayMs + DAY_MS };
    }
    case 'last_30_days':
    default:
      return { start: todayMs - 30 * DAY_MS, end: todayMs + DAY_MS };
  }
}

function timestampOf(value: unknown): number {
  if (!value) return 0;
  try {
    const d = typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : (value as string | Date | number);
    const t = new Date(d as string | number | Date).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

function isCountableSale(s: Sale): boolean {
  const status = String((s as { status?: string }).status || '').toLowerCase();
  return status !== 'voided' && status !== 'refunded';
}

// ── Sales ───────────────────────────────────────────────────

export interface SalesSummary {
  range: DateRange;
  count: number;
  revenueCents: number;
  avgTicketCents: number;
  topSeller: { name: string; revenueCents: number } | null;
  // CELLHUB-INTELLIGENCE-I2A additive canonical fields:
  grossSalesCents: number;
  netSalesCents: number;
  returnsCents: number;
  netTaxCents: number;
  profitMarginMeaningful: boolean;
  profitAdjustmentEstimated: boolean;
}

// CELLHUB-INTELLIGENCE-I2A: canonical mapping —
//   count        → txCount (gross activity)
//   revenueCents → netSalesCents (the honest "sales in range" number;
//                  previous parallel reduce over countable totals removed)
//   avgTicket    → display ratio netSales/txCount (presentation only)
//   topSeller    → topItems[0] when positive (old contract preserved)
export function getSalesSummary(snapshot: CanonicalMoneySnapshot, range: DateRange): SalesSummary {
  const stats = computeCanonicalMoneyForRange(snapshot, localDayRangeForIntelRange(range));
  const count = stats.txCount;
  const revenueCents = stats.netSalesCents;
  const avgTicketCents = count > 0 ? Math.round(revenueCents / count) : 0;
  const top = stats.topItems[0];
  const topSeller = top && top.revenueCents > 0
    ? { name: top.name, revenueCents: top.revenueCents }
    : null;
  return {
    range, count, revenueCents, avgTicketCents, topSeller,
    grossSalesCents: stats.grossSalesCents,
    netSalesCents: stats.netSalesCents,
    returnsCents: stats.returnAndRefundAdjustmentsCents,
    netTaxCents: stats.netTaxCents,
    profitMarginMeaningful: stats.profitMarginMeaningful,
    profitAdjustmentEstimated: stats.profitAdjustmentEstimated,
  };
}

export function getTodaySummary(snapshot: CanonicalMoneySnapshot): SalesSummary {
  return getSalesSummary(snapshot, 'today');
}

// ── Inventory ───────────────────────────────────────────────

export interface InventorySummary {
  totalItems: number;
  totalValueCents: number;       // sum(price * qty)
  totalCostCents: number;        // sum(cost * qty)
  lowStockCount: number;
}

export function getInventorySummary(inventory: InventoryItem[], lowStockThreshold: number = 5): InventorySummary {
  const totalItems = inventory.length;
  const totalValueCents = inventory.reduce((s, i) => s + ((i as { price?: number }).price || 0) * ((i as { qty?: number }).qty || 0), 0);
  const totalCostCents = inventory.reduce((s, i) => s + ((i as { cost?: number }).cost || 0) * ((i as { qty?: number }).qty || 0), 0);
  const lowStockCount = inventory.filter((i) => {
    const q = (i as { qty?: number }).qty || 0;
    return q > 0 && q <= lowStockThreshold;
  }).length;
  return { totalItems, totalValueCents, totalCostCents, lowStockCount };
}

export function getLowStockItems(inventory: InventoryItem[], threshold: number = 5, limit: number = 10): InventoryItem[] {
  return inventory
    .filter((i) => {
      const q = (i as { qty?: number }).qty || 0;
      return q > 0 && q <= threshold;
    })
    .slice()
    .sort((a, b) => ((a as { qty?: number }).qty || 0) - ((b as { qty?: number }).qty || 0))
    .slice(0, limit);
}

export function getDeadStockItems(inventory: InventoryItem[], sales: Sale[], daysSinceLastSale: number = 60, limit: number = 10): InventoryItem[] {
  const cutoff = Date.now() - daysSinceLastSale * DAY_MS;
  const recent = new Set<string>();
  for (const s of sales) {
    const t = timestampOf((s as { createdAt?: unknown }).createdAt);
    if (t < cutoff) continue;
    for (const item of (s.items || [])) {
      const name = String((item as { name?: string }).name || '').trim().toLowerCase();
      if (name) recent.add(name);
    }
  }
  return inventory
    .filter((i) => {
      const q = (i as { qty?: number }).qty || 0;
      const name = String((i as { name?: string }).name || '').trim().toLowerCase();
      return q > 0 && name.length > 0 && !recent.has(name);
    })
    .slice()
    .sort((a, b) => ((b as { qty?: number }).qty || 0) - ((a as { qty?: number }).qty || 0))
    .slice(0, limit);
}

// ── Customers ───────────────────────────────────────────────

export interface CustomerSummary {
  total: number;
  active30d: number;
  inactive30d: number;
}

export function getCustomerSummary(customers: Customer[], sales: Sale[]): CustomerSummary {
  const lastVisit = new Map<string, number>();
  for (const s of sales) {
    const id = (s as { customerId?: string }).customerId;
    if (!id) continue;
    const t = timestampOf((s as { createdAt?: unknown }).createdAt);
    const cur = lastVisit.get(id) || 0;
    if (t > cur) lastVisit.set(id, t);
  }
  const cutoff = Date.now() - 30 * DAY_MS;
  let active30d = 0, inactive30d = 0;
  for (const c of customers) {
    const lv = lastVisit.get(c.id);
    if (lv === undefined) continue;
    if (lv >= cutoff) active30d++;
    else inactive30d++;
  }
  return { total: customers.length, active30d, inactive30d };
}

export interface TopCustomer {
  customerId: string;
  name: string;
  phone?: string;
  revenueCents: number;
  visitCount: number;
}

export function getTopCustomers(customers: Customer[], sales: Sale[], limit: number = 5): TopCustomer[] {
  const totals = new Map<string, TopCustomer>();
  for (const s of sales) {
    const id = (s as { customerId?: string }).customerId;
    if (!id || !isCountableSale(s)) continue;
    const cur = totals.get(id) || {
      customerId: id,
      name: String((s as { customerName?: string }).customerName || ''),
      phone: undefined,
      revenueCents: 0,
      visitCount: 0,
    };
    cur.revenueCents += (s as { total?: number }).total || 0;
    cur.visitCount += 1;
    totals.set(id, cur);
  }
  for (const c of customers) {
    const cur = totals.get(c.id);
    if (cur) {
      cur.name = c.name || cur.name;
      cur.phone = c.phone;
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, limit);
}

export interface InactiveCustomer {
  customerId: string;
  name: string;
  phone?: string;
  lastVisit: number;
  daysSinceLastVisit: number;
}

export function getInactiveCustomers(customers: Customer[], sales: Sale[], daysThreshold: number = 30, limit: number = 10): InactiveCustomer[] {
  const lastVisit = new Map<string, number>();
  for (const s of sales) {
    const id = (s as { customerId?: string }).customerId;
    if (!id || !isCountableSale(s)) continue;
    const t = timestampOf((s as { createdAt?: unknown }).createdAt);
    if (t > (lastVisit.get(id) || 0)) lastVisit.set(id, t);
  }
  const now = Date.now();
  const cutoff = now - daysThreshold * DAY_MS;
  const out: InactiveCustomer[] = [];
  for (const c of customers) {
    const lv = lastVisit.get(c.id);
    if (lv === undefined) continue;            // no purchase ever — not "inactive" in the actionable sense
    if (lv >= cutoff) continue;                // still active
    out.push({
      customerId: c.id,
      name: c.name,
      phone: c.phone,
      lastVisit: lv,
      daysSinceLastVisit: Math.floor((now - lv) / DAY_MS),
    });
  }
  return out
    .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit)
    .slice(0, limit);
}

// ── Repairs ─────────────────────────────────────────────────

export interface RepairSummary {
  active: number;
  ready: number;
  overdue: number;       // ready for >3 days OR explicit 'overdue' status
  pickedUp: number;
}

export function getRepairSummary(repairs: Repair[]): RepairSummary {
  let active = 0, ready = 0, overdue = 0, pickedUp = 0;
  const overdueCutoff = Date.now() - 3 * DAY_MS;
  for (const r of repairs) {
    const status = String(r.status || '').toLowerCase();
    if (status === 'ready') {
      ready++;
      const completedTs = timestampOf((r as { completedAt?: unknown }).completedAt);
      if (completedTs > 0 && completedTs < overdueCutoff) overdue++;
    } else if (status === 'picked_up' || status === 'pickedup' || status === 'completed' || status === 'complete') {
      pickedUp++;
    } else if (status && status !== 'cancelled' && status !== 'refunded' && status !== 'refund_pending') {
      active++;
    }
  }
  return { active, ready, overdue, pickedUp };
}

export function getReadyRepairs(repairs: Repair[], limit: number = 10): Repair[] {
  return repairs
    .filter((r) => String(r.status || '').toLowerCase() === 'ready')
    .slice(0, limit);
}

// ── Unlocks ─────────────────────────────────────────────────

export interface UnlockSummary {
  active: number;
  completed: number;
}

export function getUnlockSummary(unlocks: Unlock[]): UnlockSummary {
  let active = 0, completed = 0;
  for (const u of unlocks) {
    const status = String(u.status || '').toLowerCase();
    if (status === 'completed' || status === 'complete') completed++;
    else if (status && status !== 'cancelled' && status !== 'refunded') active++;
  }
  return { active, completed };
}

// ── Layaways ────────────────────────────────────────────────

export interface LayawaySummary {
  active: number;
  completed: number;
  pending: number;       // active w/ outstanding balance
}

export function getLayawaySummary(layaways: Layaway[]): LayawaySummary {
  let active = 0, completed = 0, pending = 0;
  for (const l of layaways) {
    const status = String((l as { status?: string }).status || '').toLowerCase();
    const balance = (l as { balance?: number }).balance || 0;
    if (status === 'completed' || status === 'complete' || status === 'picked_up' || status === 'pickedup') {
      completed++;
    } else if (status === 'cancelled' || status === 'refunded') {
      // skip
    } else {
      active++;
      if (balance > 0) pending++;
    }
  }
  return { active, completed, pending };
}

export function getPendingLayaways(layaways: Layaway[], limit: number = 10): Layaway[] {
  return layaways
    .filter((l) => {
      const status = String((l as { status?: string }).status || '').toLowerCase();
      const balance = (l as { balance?: number }).balance || 0;
      const terminal = status === 'completed' || status === 'complete' || status === 'picked_up'
        || status === 'pickedup' || status === 'cancelled' || status === 'refunded';
      return !terminal && balance > 0;
    })
    .slice()
    .sort((a, b) => ((b as { balance?: number }).balance || 0) - ((a as { balance?: number }).balance || 0))
    .slice(0, limit);
}

// ── Phone payments ──────────────────────────────────────────

export interface PhonePaymentSummary {
  range: DateRange;
  count: number;
  revenueCents: number;
}

// CELLHUB-INTELLIGENCE-I2A: canonical provider buckets replace the local
// item loop. Classification upgrade (same one Reports shipped in
// R-2.1.4-REPORTS-ACTIVATION-CLASSIFICATION): genuine ACTIVATION lines no
// longer count as bill payments — they live in activationsByCarrier.
export function getPhonePaymentSummary(snapshot: CanonicalMoneySnapshot, range: DateRange): PhonePaymentSummary {
  const stats = computeCanonicalMoneyForRange(snapshot, localDayRangeForIntelRange(range));
  let count = 0, revenueCents = 0;
  for (const bucket of Object.values(stats.phonePaymentsByProvider)) {
    count += bucket.count;
    revenueCents += bucket.totalCents;
  }
  return { range, count, revenueCents };
}

// ── Special orders ──────────────────────────────────────────

export interface SpecialOrderSummary {
  active: number;
  ready: number;
  pickedUp: number;
}

export function getSpecialOrderSummary(specialOrders: SpecialOrder[]): SpecialOrderSummary {
  let active = 0, ready = 0, pickedUp = 0;
  for (const o of specialOrders) {
    const status = String((o as { status?: string }).status || '').toLowerCase();
    if (status === 'ready' || status === 'arrived') ready++;
    else if (status === 'picked_up' || status === 'pickedup' || status === 'completed' || status === 'complete') pickedUp++;
    else if (status && status !== 'cancelled' && status !== 'refunded') active++;
  }
  return { active, ready, pickedUp };
}

// ── Returns ─────────────────────────────────────────────────

export interface ReturnSummary {
  range: DateRange;
  count: number;
  totalRefundedCents: number;
}

export function getReturnSummary(returns: CustomerReturn[], range: DateRange): ReturnSummary {
  const { start, end } = getDateBounds(range);
  let count = 0, totalRefundedCents = 0;
  for (const r of returns) {
    const t = timestampOf((r as { createdAt?: unknown }).createdAt);
    if (t < start || t >= end) continue;
    count++;
    // CustomerReturn.total is dollars per legacy schema; multiply by 100.
    const total = (r as { total?: number; refundAmount?: number; amount?: number }).total
      ?? (r as { refundAmount?: number }).refundAmount
      ?? (r as { amount?: number }).amount
      ?? 0;
    totalRefundedCents += Math.round(Number(total) * 100);
  }
  return { range, count, totalRefundedCents };
}

// ── Expenses (R-DATA-EXPENSE-ACCESS-V1) ────────────────────
// Read-only summary. Filters by Expense.date (ISO "YYYY-MM-DD" string).
// Money already in cents per Expense type. Does NOT compute net profit —
// callers should not pair this with sales-profit math without explicit
// formula spec.
export interface ExpenseSummary {
  range: DateRange;
  count: number;
  totalCents: number;
  byCategory: Record<string, number>; // category → cents
}

export function getExpenseSummary(expenses: Expense[], range: DateRange): ExpenseSummary {
  const { start, end } = getDateBounds(range);
  let count = 0, totalCents = 0;
  const byCategory: Record<string, number> = {};
  for (const e of expenses) {
    const t = timestampOf(e.date);
    if (t < start || t >= end) continue;
    count++;
    const amount = e.amount || 0;
    totalCents += amount;
    const cat = String(e.category || 'other');
    byCategory[cat] = (byCategory[cat] || 0) + amount;
  }
  return { range, count, totalCents, byCategory };
}

// ── Employee performance (R-DATA-EMPLOYEE-ACCESS-V1 → I2A) ───────
// IS Reports' employee table: the canonical topEmployees (gross activity,
// 'Unknown' fallback, revenue-desc). Money in cents. NO commission math,
// NO profit math — caller's spec.
export interface EmployeePerformanceRow {
  name: string;
  transactions: number;
  revenueCents: number;
}

// CELLHUB-INTELLIGENCE-I2A: canonical topEmployees IS this contract
// ({name, transactions, revenueCents}, revenue-desc, 'Unknown' fallback
// label injected by the adapter). Local reduce removed.
export function getEmployeePerformance(snapshot: CanonicalMoneySnapshot, range: DateRange): EmployeePerformanceRow[] {
  const stats = computeCanonicalMoneyForRange(snapshot, localDayRangeForIntelRange(range));
  return stats.topEmployees.map((e) => ({
    name: e.name, transactions: e.transactions, revenueCents: e.revenueCents,
  }));
}

// ── Liability — store credit + loyalty (R-DATA-LIABILITY-V1) ──
// Read-only summary. Mirrors CustomerModule.tsx:476 (total store credit) +
// :479 (customers-with-credit count). Points stay UNITLESS — no dollar
// conversion (no documented redemption rate exists in the codebase).
// Negative balances defensively clamped via Math.max(0, ...).
export interface LiabilityTopRow {
  name: string;
  cents?: number;   // store credit branch
  points?: number;  // loyalty branch
}

export interface LiabilitySummary {
  storeCredit: {
    totalCents: number;
    customerCount: number;
    top: LiabilityTopRow[];
  };
  loyalty: {
    totalPoints: number;
    customerCount: number;
    top: LiabilityTopRow[];
  };
}

export function getLiabilitySummary(customers: Customer[]): LiabilitySummary {
  let totalCents = 0;
  let totalPoints = 0;
  let creditCount = 0;
  let pointsCount = 0;
  const creditCandidates: Array<{ name: string; cents: number }> = [];
  const pointsCandidates: Array<{ name: string; points: number }> = [];

  for (const c of customers) {
    const cents = Math.max(0, c.storeCredit || 0);
    const points = Math.max(0, c.loyaltyPoints || 0);
    if (cents > 0) {
      totalCents += cents;
      creditCount++;
      creditCandidates.push({ name: c.name || 'Unknown', cents });
    }
    if (points > 0) {
      totalPoints += points;
      pointsCount++;
      pointsCandidates.push({ name: c.name || 'Unknown', points });
    }
  }

  const topCredit = creditCandidates
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 3)
    .map((r) => ({ name: r.name, cents: r.cents }));
  const topPoints = pointsCandidates
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((r) => ({ name: r.name, points: r.points }));

  return {
    storeCredit: { totalCents, customerCount: creditCount, top: topCredit },
    loyalty:     { totalPoints, customerCount: pointsCount, top: topPoints },
  };
}

// ── Appointments (R-DATA-APPOINTMENT-ACCESS-V1) ────────────
// Mirrors AppointmentsModule.tsx:96-106 exactly for "today" (midnight-anchored
// comparison + status === 'scheduled' filter). Tomorrow uses the same midnight
// pattern. Upcoming-7d covers scheduled appointments from now through +7 days.
// noShows counts status === 'no_show' regardless of date (caller-provided range
// not applied — no-show is a manual marker; range filter would mostly hide
// genuine no-shows). Read-only.
export interface AppointmentSummary {
  total: number;
  today: number;
  tomorrow: number;
  upcoming7d: number;
  noShows: number;
}

export function getAppointmentSummary(appointments: Appointment[]): AppointmentSummary {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayTs = startOfToday.getTime();
  const tomorrowTs = todayTs + DAY_MS;
  const sevenDaysOutTs = todayTs + 7 * DAY_MS;
  const nowTs = Date.now();

  let today = 0, tomorrow = 0, upcoming7d = 0, noShows = 0;
  for (const a of appointments) {
    const status = String(a.status || '').toLowerCase();
    if (status === 'no_show') noShows++;

    const dropOff = new Date(a.estimatedDropOff);
    if (!Number.isFinite(dropOff.getTime())) continue;
    const dayMidnight = new Date(dropOff);
    dayMidnight.setHours(0, 0, 0, 0);
    const dropOffMidnight = dayMidnight.getTime();

    if (status === 'scheduled') {
      if (dropOffMidnight === todayTs) today++;
      else if (dropOffMidnight === tomorrowTs) tomorrow++;
      // Upcoming-7d: any scheduled drop-off from now through 7 days out
      // (raw timestamp comparison, not midnight-bucketed).
      if (dropOff.getTime() >= nowTs && dropOff.getTime() < sevenDaysOutTs) upcoming7d++;
    }
  }
  return { total: appointments.length, today, tomorrow, upcoming7d, noShows };
}
