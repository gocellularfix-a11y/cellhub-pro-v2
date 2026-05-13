// ============================================================
// CellHub Pro — Companion Live Alert Producer
// (R-COMPANION-INTELLIGENCE-LIVE-ALERTS-V1)
//
// Deterministic, no-AI alert generator for the Companion feed.
// Runs from CompanionCenter on a timer, reads live store data,
// emits INTELLIGENCE_ALERT_CREATED events to the companion bus.
//
// Rules are simple threshold checks on real store data — no ML,
// no external calls, no hallucinations. Each rule has a 30-min
// cooldown enforced via a module-level Map so the same condition
// does not spam the mobile feed on every timer tick.
//
// Callers: CompanionCenter.tsx (5-min interval, bridge-gated).
// ============================================================

import type { Sale, Repair, InventoryItem } from '@/store/types';

// ── Types ────────────────────────────────────────────────

export interface CompanionLiveAlert {
  configId: string;
  severity: 'critical' | 'warning' | 'info';
  insightType: string;
  title: string;
  body: string;
}

// ── Module-level cooldown tracker ─────────────────────────
// Prevents re-firing the same alert within COOLDOWN_MS.
// Cleared on full page reload (in-memory only — by design).

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const lastFiredAt = new Map<string, number>();

function isCoolingDown(configId: string): boolean {
  const last = lastFiredAt.get(configId);
  return !!last && (Date.now() - last) < COOLDOWN_MS;
}

function markFired(configId: string): void {
  lastFiredAt.set(configId, Date.now());
}

// ── Date helpers ─────────────────────────────────────────

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function tsOf(dateStr: unknown): number {
  if (!dateStr) return 0;
  try { return new Date(dateStr as string).getTime(); } catch { return 0; }
}

// ── Pure rule evaluators ──────────────────────────────────

function ruleSlowDay(sales: Sale[]): CompanionLiveAlert | null {
  const hour = new Date().getHours();
  if (hour < 14) return null; // only fire after 2 pm
  const today = todayStart();
  const todayCount = sales.filter(
    (s) => s.status === 'completed' && tsOf(s.createdAt) >= today,
  ).length;
  if (todayCount >= 3) return null;
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return {
    configId: 'companion-slow-day',
    severity: 'warning',
    insightType: 'sales',
    title: `Slow ${dayName}`,
    body: todayCount === 0
      ? `No sales completed so far today — consider a quick promo or reaching out to regulars.`
      : `Only ${todayCount} sale${todayCount === 1 ? '' : 's'} today after 2 pm — pace is behind.`,
  };
}

function rulePendingApprovals(pendingCount: number): CompanionLiveAlert | null {
  if (pendingCount < 1) return null;
  return {
    configId: 'companion-pending-approvals',
    severity: pendingCount >= 3 ? 'critical' : 'warning',
    insightType: 'operations',
    title: `${pendingCount} Approval${pendingCount === 1 ? '' : 's'} Waiting`,
    body: `${pendingCount} pending approval${pendingCount === 1 ? ' needs' : 's need'} a response from a manager.`,
  };
}

function ruleRepairsReadyPickup(repairs: Repair[]): CompanionLiveAlert | null {
  const ready = repairs.filter((r) => {
    const s = String(r.status || '').toLowerCase().replace(/\s+/g, '_');
    return s === 'repair_complete' || s === 'ready_for_pickup' || s === 'ready';
  });
  if (ready.length === 0) return null;
  return {
    configId: 'companion-repairs-ready',
    severity: 'info',
    insightType: 'repairs',
    title: `${ready.length} Repair${ready.length === 1 ? '' : 's'} Ready for Pickup`,
    body: `${ready.length} completed repair${ready.length === 1 ? ' is' : 's are'} waiting — customers can be notified.`,
  };
}

function ruleOverdueRepairs(repairs: Repair[]): CompanionLiveAlert | null {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const overdue = repairs.filter((r) => {
    const s = String(r.status || '').toLowerCase().replace(/\s+/g, '_');
    if (s === 'picked_up' || s === 'cancelled' || s === 'refunded') return false;
    return tsOf(r.createdAt) < cutoff && tsOf(r.createdAt) > 0;
  });
  if (overdue.length === 0) return null;
  return {
    configId: 'companion-overdue-repairs',
    severity: overdue.length >= 3 ? 'critical' : 'warning',
    insightType: 'repairs',
    title: `${overdue.length} Overdue Repair${overdue.length === 1 ? '' : 's'}`,
    body: `${overdue.length} repair ticket${overdue.length === 1 ? ' has' : 's have'} been open for 7+ days without pickup.`,
  };
}

function ruleDeadStock(inventory: InventoryItem[]): CompanionLiveAlert | null {
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const dead = inventory.filter((i) => {
    if ((i.qty || 0) <= 0) return false;
    return tsOf(i.createdAt) < cutoff && tsOf(i.createdAt) > 0;
  });
  if (dead.length < 3) return null;
  return {
    configId: 'companion-dead-stock',
    severity: 'warning',
    insightType: 'inventory',
    title: `${dead.length} Dead Stock Items`,
    body: `${dead.length} items in inventory haven't moved in 60+ days — consider markdowns or reallocation.`,
  };
}

function ruleHighRefunds(sales: Sale[]): CompanionLiveAlert | null {
  const today = todayStart();
  const refunds = sales.filter((s) => {
    if (tsOf(s.createdAt) < today) return false;
    const status = String(s.status || '').toLowerCase();
    const total = s.total || 0;
    return status === 'refunded' || status === 'refund_pending' || total < 0;
  });
  if (refunds.length < 2) return null;
  return {
    configId: 'companion-high-refunds',
    severity: refunds.length >= 4 ? 'critical' : 'warning',
    insightType: 'finance',
    title: `${refunds.length} Refunds Today`,
    body: `${refunds.length} refunds processed today — higher than normal. Review if a product or employee needs attention.`,
  };
}

function ruleNoSalesNoon(sales: Sale[]): CompanionLiveAlert | null {
  const hour = new Date().getHours();
  if (hour < 12) return null;
  const today = todayStart();
  const hasAny = sales.some(
    (s) => s.status === 'completed' && tsOf(s.createdAt) >= today,
  );
  if (hasAny) return null;
  return {
    configId: 'companion-no-sales-noon',
    severity: 'critical',
    insightType: 'sales',
    title: 'No Sales Yet Today',
    body: `It's past noon and no completed sales. Check if the POS is active and staff is engaging customers.`,
  };
}

// ── Public API ────────────────────────────────────────────

export interface CompanionAlertProducerArgs {
  sales: Sale[];
  repairs: Repair[];
  inventory: InventoryItem[];
  pendingApprovalCount: number;
}

/**
 * Evaluate all live alert rules against current store data.
 * Returns only alerts whose cooldown has elapsed — calling this
 * every 5 minutes is safe. Each returned alert should be emitted
 * to the companion event bus by the caller.
 */
export function generateCompanionAlerts(
  args: CompanionAlertProducerArgs,
): CompanionLiveAlert[] {
  const { sales, repairs, inventory, pendingApprovalCount } = args;

  const candidates: Array<CompanionLiveAlert | null> = [
    ruleNoSalesNoon(sales),
    ruleSlowDay(sales),
    rulePendingApprovals(pendingApprovalCount),
    ruleRepairsReadyPickup(repairs),
    ruleOverdueRepairs(repairs),
    ruleDeadStock(inventory),
    ruleHighRefunds(sales),
  ];

  const result: CompanionLiveAlert[] = [];
  for (const alert of candidates) {
    if (!alert) continue;
    if (isCoolingDown(alert.configId)) continue;
    markFired(alert.configId);
    result.push(alert);
  }
  return result;
}

/** Dev-only: reset all cooldowns so the next evaluate fires fresh. */
export function resetCompanionAlertCooldowns(): void {
  lastFiredAt.clear();
}
