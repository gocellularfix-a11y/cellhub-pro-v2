// R-CROSS-MODULE-CUSTOMER-OPERATOR-PROFILE-V1
// Unified operational customer profile: aggregates repair, unlock, special order,
// layaway, and sales signals into a single ranked opportunity list.
// Replaces the narrow detectCustomerContext (repairs + layaways only) with
// full cross-module coverage so Intelligence always gives the operator the
// complete picture when a customer is active.

import type { Customer, Repair, Layaway, Unlock, SpecialOrder, Sale } from '@/store/types';
import type { ModuleOpportunity, ExecutableOpportunityAction } from '../moduleWideOpportunities/moduleWideOpportunityTypes';

// ── Status helpers ────────────────────────────────────────────────────────────

const REPAIR_TERMINAL = new Set([
  'cancelled', 'picked_up', 'pickedup', 'refunded', 'delivered', 'closed', 'void',
]);
const REPAIR_READY = new Set([
  'ready', 'ready_for_pickup', 'readyforpickup', 'completed', 'done',
]);
const UNLOCK_TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const SO_TERMINAL = new Set(['picked_up', 'cancelled', 'refunded']);

function toMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') { const n = new Date(ts).getTime(); return Number.isFinite(n) ? n : 0; }
  if (typeof ts === 'object') {
    const obj = ts as Record<string, unknown>;
    if (typeof obj['toDate'] === 'function') { try { return (obj['toDate'] as () => Date)().getTime(); } catch { return 0; } }
    if (typeof obj['seconds'] === 'number') return (obj['seconds'] as number) * 1000;
  }
  return 0;
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function normalizeStatus(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[\s-]+/g, '_');
}

// ── Entry point ───────────────────────────────────────────────────────────────

export interface CustomerProfileParams {
  customerId: string;
  customers: Customer[];
  repairs: Repair[];
  unlocks: Unlock[];
  specialOrders: SpecialOrder[];
  layaways: Layaway[];
  sales: Sale[];
  now: number;
}

export function buildCustomerCrossModuleProfile(params: CustomerProfileParams): ModuleOpportunity[] {
  const { customerId, customers, repairs, unlocks, specialOrders, layaways, sales, now } = params;

  const c = customers.find((x) => x.id === customerId);
  if (!c) return [];

  const result: ModuleOpportunity[] = [];
  const customerRepairs = repairs.filter((r) => r.customerId === customerId);
  const customerUnlocks = unlocks.filter((u) => u.customerId === customerId);
  const customerSOs = specialOrders.filter((o) => o.customerId === customerId);
  const customerLayaways = layaways.filter((l) => l.customerId === customerId);

  // ── 1. Ready repairs — pickup urgency ─────────────────────────────────────
  const readyRepairs = customerRepairs.filter((r) => REPAIR_READY.has(normalizeStatus(r.status)));
  if (readyRepairs.length > 0) {
    // Surface the most overdue ready repair
    let mostOverdue = readyRepairs[0];
    let mostDays = 0;
    for (const r of readyRepairs) {
      const refTs = (r as unknown as Record<string, unknown>)['completedAt'] ?? r.updatedAt;
      const d = refTs ? Math.floor((now - toMs(refTs)) / 86_400_000) : 0;
      if (d > mostDays) { mostDays = d; mostOverdue = r; }
    }
    const acts: ExecutableOpportunityAction[] = [];
    if (c.phone) {
      acts.push({
        actionType: 'whatsapp_followup', labelKey: 'oppo.action.whatsapp',
        customerId: c.id, customerPhone: c.phone, customerName: c.name,
        customMessage: `Hi ${c.name}, your device is ready for pickup at Go Cellular!`,
      });
    }
    acts.push({ actionType: 'open_repair', labelKey: 'oppo.action.openRepair', entityId: mostOverdue.id, entityName: c.name });
    result.push({
      id: `ctx-cust-repair-ready-${c.id}`,
      module: 'customers',
      severity: mostDays >= 5 ? 'critical' : 'high',
      titleKey: 'oppo.customer.repair_ready.title',
      summaryKey: 'ctx.customer.repair_ready',
      evidence: [c.name, String(mostDays), String(readyRepairs.length)],
      recommendedAction: 'notify_customer_pickup',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    });
  }

  // ── 2. Special order arrived ──────────────────────────────────────────────
  const arrivedSOs = customerSOs.filter((o) => {
    const s = normalizeStatus(o.status);
    return s === 'received' || s === 'ready';
  });
  if (arrivedSOs.length > 0) {
    const so = arrivedSOs[0];
    const acts: ExecutableOpportunityAction[] = [];
    if (c.phone) {
      acts.push({
        actionType: 'whatsapp_followup', labelKey: 'oppo.action.whatsapp',
        customerId: c.id, customerPhone: c.phone, customerName: c.name,
        customMessage: `Hi ${c.name}, your special order has arrived at Go Cellular!`,
      });
    }
    acts.push({ actionType: 'open_special_order', labelKey: 'oppo.action.openSpecialOrder', entityId: so.id, entityName: c.name });
    result.push({
      id: `ctx-cust-so-arrived-${c.id}`,
      module: 'customers',
      severity: 'high',
      titleKey: 'oppo.customer.so_arrived.title',
      summaryKey: 'ctx.customer.so_arrived',
      evidence: [c.name, so.itemDescription || 'item'],
      recommendedAction: 'notify_customer_so_arrival',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    });
  }

  // ── 3. Unlock code ready ──────────────────────────────────────────────────
  const codeReadyUnlocks = customerUnlocks.filter((u) => {
    if (UNLOCK_TERMINAL.has(normalizeStatus(u.status))) return false;
    return !!u.unlockCode;
  });
  if (codeReadyUnlocks.length > 0) {
    const u = codeReadyUnlocks[0];
    const acts: ExecutableOpportunityAction[] = [];
    if (c.phone) {
      acts.push({
        actionType: 'whatsapp_followup', labelKey: 'oppo.action.whatsapp',
        customerId: c.id, customerPhone: c.phone, customerName: c.name,
        customMessage: `Hi ${c.name}, your phone unlock is ready at Go Cellular!`,
      });
    }
    acts.push({ actionType: 'open_unlock', labelKey: 'oppo.action.openUnlock', entityId: u.id, entityName: c.name });
    result.push({
      id: `ctx-cust-unlock-ready-${c.id}`,
      module: 'customers',
      severity: 'high',
      titleKey: 'oppo.customer.unlock_ready.title',
      summaryKey: 'ctx.customer.unlock_ready',
      evidence: [c.name, u.device || 'device'],
      recommendedAction: 'deliver_unlock_code',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    });
  }

  // ── 4. Cross-module outstanding balance ───────────────────────────────────
  let totalBalance = 0;
  for (const r of customerRepairs) {
    if (REPAIR_TERMINAL.has(normalizeStatus(r.status))) continue;
    totalBalance += r.balance || 0;
  }
  for (const l of customerLayaways) {
    const st = normalizeStatus(l.status);
    if (st === 'completed' || st === 'cancelled') continue;
    totalBalance += l.balance || 0;
  }
  for (const u of customerUnlocks) {
    if (UNLOCK_TERMINAL.has(normalizeStatus(u.status))) continue;
    totalBalance += u.balance || 0;
  }
  for (const o of customerSOs) {
    if (SO_TERMINAL.has(normalizeStatus(o.status))) continue;
    totalBalance += o.balance || 0;
  }
  if (totalBalance >= 500) {
    result.push({
      id: `ctx-cust-balance-${c.id}`,
      module: 'customers',
      severity: totalBalance >= 5_000 ? 'high' : 'medium',
      titleKey: 'oppo.customer.unpaid.title',
      summaryKey: 'ctx.customer.balance',
      evidence: [c.name, fmtCents(totalBalance)],
      recommendedAction: 'collect_balance',
      confidence: 'high',
      actions: [{ actionType: 'callback_reminder', labelKey: 'oppo.action.reminder', customerId: c.id, customerName: c.name }],
      createdAt: now,
    });
  }

  // ── 5. Unlock supplier delay ──────────────────────────────────────────────
  const waitingUnlocks = customerUnlocks.filter((u) => {
    if (UNLOCK_TERMINAL.has(normalizeStatus(u.status))) return false;
    if (u.unlockCode) return false;
    return Math.floor((now - toMs(u.createdAt)) / 86_400_000) >= 3;
  });
  if (waitingUnlocks.length > 0) {
    const u = waitingUnlocks[0];
    const days = Math.floor((now - toMs(u.createdAt)) / 86_400_000);
    result.push({
      id: `ctx-cust-unlock-waiting-${c.id}`,
      module: 'customers',
      severity: days >= 7 ? 'high' : 'medium',
      titleKey: 'oppo.customer.unlock_waiting.title',
      summaryKey: 'ctx.customer.unlock_waiting',
      evidence: [c.name, String(days)],
      recommendedAction: 'follow_up_supplier',
      confidence: 'high',
      actions: [{ actionType: 'open_unlock', labelKey: 'oppo.action.openUnlock', entityId: u.id, entityName: c.name }],
      createdAt: now,
    });
  }

  // ── 6. VIP + inactive outreach ────────────────────────────────────────────
  let totalRev = 0;
  let lastVisitMs = 0;
  for (const s of sales) {
    if (s.customerId !== customerId) continue;
    if (String(s.status || '').toLowerCase() === 'voided') continue;
    totalRev += s.total || 0;
    const ms = toMs(s.createdAt);
    if (ms > lastVisitMs) lastVisitMs = ms;
  }
  const daysSinceVisit = lastVisitMs ? Math.floor((now - lastVisitMs) / 86_400_000) : 999;
  if (totalRev >= 15_000 && daysSinceVisit >= 20) {
    const acts: ExecutableOpportunityAction[] = [];
    if (c.phone) {
      acts.push({
        actionType: 'whatsapp_followup', labelKey: 'oppo.action.whatsapp',
        customerId: c.id, customerPhone: c.phone, customerName: c.name,
      });
    }
    acts.push({ actionType: 'open_customer', labelKey: 'oppo.action.openCustomer', entityId: c.id, entityName: c.name });
    result.push({
      id: `ctx-cust-inactive-${c.id}`,
      module: 'customers',
      severity: totalRev >= 50_000 ? 'high' : 'medium',
      titleKey: 'oppo.customer.vip.title',
      summaryKey: 'ctx.customer.inactive',
      evidence: [c.name, String(daysSinceVisit)],
      recommendedAction: 'contact_customer',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    });
  }

  // ── 7. Repeat repair pattern ──────────────────────────────────────────────
  const MS_180D = 180 * 86_400_000;
  const recentRepairs = customerRepairs.filter((r) => (now - toMs(r.createdAt)) <= MS_180D);
  if (customerRepairs.length >= 3 && recentRepairs.length >= 2) {
    result.push({
      id: `ctx-cust-repeat-repair-${c.id}`,
      module: 'customers',
      severity: 'medium',
      titleKey: 'oppo.customer.repeat_repair.title',
      summaryKey: 'ctx.customer.repeat_repair',
      evidence: [c.name, String(customerRepairs.length), String(recentRepairs.length)],
      recommendedAction: 'discuss_protection_plan',
      confidence: 'medium',
      actions: [{ actionType: 'open_customer', labelKey: 'oppo.action.openCustomer', entityId: c.id, entityName: c.name }],
      createdAt: now,
    });
  }

  return result;
}
