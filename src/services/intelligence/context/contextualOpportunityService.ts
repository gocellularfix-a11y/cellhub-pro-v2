// R-INTELLIGENCE-CONTEXT-AWARE-V1
// Deterministic contextual detectors. Each detector examines a SPECIFIC entity
// (the one currently open in a module) and returns ModuleOpportunity[] using the
// same shape as the global MWO detectors so the adapter + dedup layer reuse
// unchanged. Lower severity thresholds than global MWO — when you're already
// looking at an entity, even a medium signal is immediately actionable.

import type { Repair, Layaway, Customer, Sale, InventoryItem, Unlock, SpecialOrder } from '@/store/types';
import type { ModuleOpportunity, ExecutableOpportunityAction } from '../moduleWideOpportunities/moduleWideOpportunityTypes';
import type { IntelligenceContext } from './intelligenceContext';
import type { IntelligenceEngine } from '../IntelligenceEngine';

// ── Date helpers (mirrors moduleWideOpportunityDetectors) ─────────────────────

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

function daysSince(ts: unknown, now: number): number {
  const ms = toMs(ts);
  if (!ms) return 9999;
  return Math.floor((now - ms) / 86_400_000);
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const REPAIR_TERMINAL = new Set([
  'cancelled', 'picked_up', 'pickedup', 'refunded', 'delivered', 'closed', 'void',
]);
const REPAIR_READY = new Set([
  'ready', 'ready_for_pickup', 'readyforpickup', 'completed', 'done',
]);

// ── 1. Repair context ────────────────────────────────────────────────────────

function detectRepairContext(repairId: string, repairs: Repair[], now: number): ModuleOpportunity[] {
  const r = repairs.find((x) => x.id === repairId);
  if (!r) return [];
  const s = String(r.status || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (REPAIR_TERMINAL.has(s)) return [];

  if (REPAIR_READY.has(s)) {
    const refMs = toMs((r as unknown as Record<string, unknown>)['completedAt'] ?? r.updatedAt);
    const days = refMs ? Math.floor((now - refMs) / 86_400_000) : 0;
    const acts: ExecutableOpportunityAction[] = [];
    if (r.customerPhone) {
      acts.push({
        actionType: 'whatsapp_followup',
        labelKey: 'oppo.action.whatsapp',
        customerId: r.customerId ?? '',
        customerPhone: r.customerPhone,
        customerName: r.customerName,
        customMessage: `Hi ${r.customerName}, your device is ready for pickup at Go Cellular!`,
      });
    }
    acts.push({ actionType: 'open_repair', labelKey: 'oppo.action.openRepair', entityId: r.id, entityName: r.customerName });
    return [{
      id: `ctx-repair-ready-${r.id}`,
      module: 'repairs',
      severity: days >= 5 ? 'critical' : 'high',
      titleKey: 'oppo.repair.ready.title',
      summaryKey: 'ctx.repair.ready',
      evidence: [r.customerName, String(days)],
      recommendedAction: 'notify_customer_pickup',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    }];
  }

  // In-progress: flag if open for 3+ days (lower threshold than global 5-day)
  const days = daysSince(r.createdAt, now);
  if (days >= 3) {
    return [{
      id: `ctx-repair-overdue-${r.id}`,
      module: 'repairs',
      severity: days >= 10 ? 'critical' : days >= 5 ? 'high' : 'medium',
      titleKey: 'oppo.repair.overdue.title',
      summaryKey: 'ctx.repair.overdue',
      evidence: [r.customerName, String(days)],
      recommendedAction: 'update_repair_status',
      confidence: 'high',
      actions: [{ actionType: 'open_repair', labelKey: 'oppo.action.openRepair', entityId: r.id, entityName: r.customerName }],
      createdAt: now,
    }];
  }
  return [];
}

// ── 2. Customer context ──────────────────────────────────────────────────────

function detectCustomerContext(
  customerId: string,
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  now: number,
): ModuleOpportunity[] {
  const c = customers.find((x) => x.id === customerId);
  if (!c) return [];

  const result: ModuleOpportunity[] = [];

  // Revenue + last-visit from sales
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

  // VIP + inactive (lower threshold: $150 and 20+ days)
  if (totalRev >= 15_000 && daysSinceVisit >= 20) {
    const acts: ExecutableOpportunityAction[] = [];
    if (c.phone) acts.push({ actionType: 'whatsapp_followup', labelKey: 'oppo.action.whatsapp', customerId: c.id, customerPhone: c.phone, customerName: c.name });
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

  // Outstanding balance across repairs + layaways
  let balance = 0;
  for (const r of repairs) {
    if (r.customerId !== customerId) continue;
    if (REPAIR_TERMINAL.has(String(r.status || '').toLowerCase().replace(/[\s-]+/g, '_'))) continue;
    balance += r.balance || 0;
  }
  for (const l of layaways) {
    if (l.customerId !== customerId) continue;
    const st = String(l.status || '').toLowerCase();
    if (st === 'completed' || st === 'cancelled') continue;
    balance += l.balance || 0;
  }
  if (balance >= 500) {
    result.push({
      id: `ctx-cust-balance-${c.id}`,
      module: 'customers',
      severity: balance >= 5_000 ? 'high' : 'medium',
      titleKey: 'oppo.customer.unpaid.title',
      summaryKey: 'ctx.customer.balance',
      evidence: [c.name, fmtCents(balance)],
      recommendedAction: 'collect_balance',
      confidence: 'high',
      actions: [{ actionType: 'callback_reminder', labelKey: 'oppo.action.reminder', customerId: c.id, customerName: c.name }],
      createdAt: now,
    });
  }

  return result;
}

// ── 3. Layaway context ───────────────────────────────────────────────────────

function detectLayawayContext(layawayId: string, layaways: Layaway[], now: number): ModuleOpportunity[] {
  const l = layaways.find((x) => x.id === layawayId);
  if (!l) return [];
  const st = String(l.status || '').toLowerCase();
  if (st === 'completed' || st === 'cancelled') return [];
  if (!l.balance || l.balance <= 0) return [];

  const acts: ExecutableOpportunityAction[] = [];
  if (l.customerPhone) acts.push({ actionType: 'whatsapp_followup', labelKey: 'oppo.action.whatsapp', customerId: l.customerId ?? '', customerPhone: l.customerPhone, customerName: l.customerName });
  acts.push({ actionType: 'open_layaway', labelKey: 'oppo.action.openLayaway', entityId: l.id, entityName: l.customerName });

  // Overdue
  if (l.dueDate) {
    const dueMs = toMs(l.dueDate);
    if (dueMs && dueMs < now) {
      return [{
        id: `ctx-lay-over-${l.id}`,
        module: 'layaways',
        severity: now - dueMs > 30 * 86_400_000 ? 'critical' : 'high',
        titleKey: 'oppo.layaway.overdue.title',
        summaryKey: 'ctx.layaway.overdue',
        evidence: [l.customerName, fmtCents(l.balance)],
        recommendedAction: 'contact_layaway_overdue',
        confidence: 'high',
        actions: acts,
        createdAt: now,
      }];
    }
  }

  // Near completion (< 20% left, at least $10 remaining)
  if (l.totalPrice > 0 && l.balance < l.totalPrice * 0.2 && l.balance >= 1_000) {
    return [{
      id: `ctx-lay-near-${l.id}`,
      module: 'layaways',
      severity: 'medium',
      titleKey: 'oppo.layaway.near.title',
      summaryKey: 'ctx.layaway.near',
      evidence: [l.customerName, fmtCents(l.balance)],
      recommendedAction: 'encourage_final_payment',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    }];
  }

  return [];
}

// ── 4. Inventory context ─────────────────────────────────────────────────────

function detectInventoryContext(itemId: string, inventory: InventoryItem[], sales: Sale[], now: number): ModuleOpportunity[] {
  const item = inventory.find((x) => x.id === itemId);
  if (!item || item.qty <= 0) return [];

  const SIXTY_MS = 60 * 86_400_000;
  const THIRTY_MS = 30 * 86_400_000;

  let lastSaleMs = 0;
  let count30 = 0;
  for (const s of sales) {
    const st = String(s.status || '').toLowerCase();
    if (st === 'voided' || st === 'refunded') continue;
    for (const si of s.items) {
      if (si.inventoryId !== item.id && (!item.sku || si.sku !== item.sku)) continue;
      const ms = toMs(s.createdAt);
      if (ms > lastSaleMs) lastSaleMs = ms;
      if (now - ms <= THIRTY_MS) count30++;
    }
  }

  const acts: ExecutableOpportunityAction[] = [
    { actionType: 'open_inventory', labelKey: 'oppo.action.openInventory', entityId: item.id, entityName: item.name },
  ];

  const minQty = item.minQty ?? 1;
  if (item.qty <= minQty && count30 >= 1) {
    return [{
      id: `ctx-inv-low-${item.id}`,
      module: 'inventory',
      severity: count30 >= 3 ? 'high' : 'medium',
      titleKey: 'oppo.inventory.lowstock.title',
      summaryKey: 'ctx.inventory.low',
      evidence: [item.name, String(item.qty)],
      recommendedAction: 'reorder',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    }];
  }

  const age = now - toMs(item.createdAt);
  const daysSinceSale = lastSaleMs ? Math.floor((now - lastSaleMs) / 86_400_000) : 9999;
  if (item.qty >= 2 && age >= SIXTY_MS && daysSinceSale > 45) {
    return [{
      id: `ctx-inv-dead-${item.id}`,
      module: 'inventory',
      severity: daysSinceSale > 90 ? 'high' : 'medium',
      titleKey: 'oppo.inventory.deadstock.title',
      summaryKey: 'ctx.inventory.dead',
      evidence: [item.name, String(daysSinceSale >= 9000 ? 45 : daysSinceSale)],
      recommendedAction: 'discount_or_bundle',
      confidence: 'medium',
      actions: acts,
      createdAt: now,
    }];
  }

  return [];
}

// ── 5. Unlock context ────────────────────────────────────────────────────────

const UNLOCK_TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function detectUnlockContext(unlockId: string, unlocks: Unlock[], now: number): ModuleOpportunity[] {
  const u = unlocks.find((x) => x.id === unlockId);
  if (!u) return [];
  const s = String(u.status || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (UNLOCK_TERMINAL.has(s)) return [];

  const result: ModuleOpportunity[] = [];

  // Code received — ready to deliver to customer
  if (u.unlockCode) {
    const acts: ExecutableOpportunityAction[] = [];
    if (u.customerPhone) {
      acts.push({
        actionType: 'whatsapp_followup',
        labelKey: 'oppo.action.whatsapp',
        customerId: u.customerId ?? '',
        customerPhone: u.customerPhone,
        customerName: u.customerName,
        customMessage: `Hi ${u.customerName}, your phone unlock is ready at Go Cellular!`,
      });
    }
    acts.push({ actionType: 'open_unlock', labelKey: 'oppo.action.openUnlock', entityId: u.id, entityName: u.customerName });
    result.push({
      id: `ctx-unlock-ready-${u.id}`,
      module: 'unlocks',
      severity: 'high',
      titleKey: 'oppo.unlock.ready.title',
      summaryKey: 'ctx.unlock.ready',
      evidence: [u.customerName, u.device],
      recommendedAction: 'deliver_unlock_code',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    });
    return result;
  }

  // Waiting on supplier — flag at 3+ days without code
  const days = daysSince(u.createdAt, now);
  if (days >= 3) {
    result.push({
      id: `ctx-unlock-waiting-${u.id}`,
      module: 'unlocks',
      severity: days >= 7 ? 'high' : 'medium',
      titleKey: 'oppo.unlock.waiting.title',
      summaryKey: 'ctx.unlock.waiting',
      evidence: [u.customerName, String(days)],
      recommendedAction: 'follow_up_supplier',
      confidence: 'high',
      actions: [{ actionType: 'open_unlock', labelKey: 'oppo.action.openUnlock', entityId: u.id, entityName: u.customerName }],
      createdAt: now,
    });
  }

  // Unpaid balance
  if (u.balance >= 500) {
    result.push({
      id: `ctx-unlock-balance-${u.id}`,
      module: 'unlocks',
      severity: u.balance >= 5_000 ? 'high' : 'medium',
      titleKey: 'oppo.unlock.balance.title',
      summaryKey: 'ctx.unlock.balance',
      evidence: [u.customerName, fmtCents(u.balance)],
      recommendedAction: 'collect_balance',
      confidence: 'high',
      actions: [{ actionType: 'open_unlock', labelKey: 'oppo.action.openUnlock', entityId: u.id, entityName: u.customerName }],
      createdAt: now,
    });
  }

  return result;
}

// ── 6. Special Order context ─────────────────────────────────────────────────

const SO_TERMINAL = new Set(['picked_up', 'cancelled', 'refunded']);

function detectSpecialOrderContext(orderId: string, specialOrders: SpecialOrder[], now: number): ModuleOpportunity[] {
  const o = specialOrders.find((x) => x.id === orderId);
  if (!o) return [];
  const s = String(o.status || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (SO_TERMINAL.has(s)) return [];

  const result: ModuleOpportunity[] = [];

  // Item arrived / ready — notify customer
  if (s === 'received' || s === 'ready') {
    const acts: ExecutableOpportunityAction[] = [];
    if (o.customerPhone) {
      acts.push({
        actionType: 'whatsapp_followup',
        labelKey: 'oppo.action.whatsapp',
        customerId: o.customerId ?? '',
        customerPhone: o.customerPhone,
        customerName: o.customerName,
        customMessage: `Hi ${o.customerName}, your special order has arrived at Go Cellular!`,
      });
    }
    acts.push({ actionType: 'open_special_order', labelKey: 'oppo.action.openSpecialOrder', entityId: o.id, entityName: o.customerName });
    result.push({
      id: `ctx-so-arrived-${o.id}`,
      module: 'special_orders',
      severity: 'high',
      titleKey: 'oppo.so.arrived.title',
      summaryKey: 'ctx.specialorder.arrived',
      evidence: [o.customerName, o.itemDescription],
      recommendedAction: 'notify_customer_arrival',
      confidence: 'high',
      actions: acts,
      createdAt: now,
    });
    return result;
  }

  // Still waiting — flag at 5+ days (or past estimated arrival)
  const days = daysSince(o.createdAt, now);
  if ((s === 'ordered' || s === 'in_transit') && days >= 5) {
    let severity: 'critical' | 'high' | 'medium' | 'low' = days >= 14 ? 'high' : 'medium';
    if (o.estimatedArrival) {
      const estMs = toMs(o.estimatedArrival);
      if (estMs && estMs < now) severity = 'high';
    }
    result.push({
      id: `ctx-so-ordered-${o.id}`,
      module: 'special_orders',
      severity,
      titleKey: 'oppo.so.ordered.title',
      summaryKey: 'ctx.specialorder.ordered',
      evidence: [o.customerName, String(days)],
      recommendedAction: 'follow_up_supplier',
      confidence: 'high',
      actions: [{ actionType: 'open_special_order', labelKey: 'oppo.action.openSpecialOrder', entityId: o.id, entityName: o.customerName }],
      createdAt: now,
    });
  }

  // Unpaid balance
  if (o.balance >= 500) {
    result.push({
      id: `ctx-so-balance-${o.id}`,
      module: 'special_orders',
      severity: o.balance >= 5_000 ? 'high' : 'medium',
      titleKey: 'oppo.so.balance.title',
      summaryKey: 'ctx.specialorder.balance',
      evidence: [o.customerName, fmtCents(o.balance)],
      recommendedAction: 'collect_balance',
      confidence: 'high',
      actions: [{ actionType: 'open_special_order', labelKey: 'oppo.action.openSpecialOrder', entityId: o.id, entityName: o.customerName }],
      createdAt: now,
    });
  }

  return result;
}

// ── Public entry point ───────────────────────────────────────────────────────

export function computeContextualOpportunities(
  ctx: IntelligenceContext,
  engine: IntelligenceEngine,
): ModuleOpportunity[] {
  const now = Date.now();
  const result: ModuleOpportunity[] = [];

  const run = (fn: () => ModuleOpportunity[]) => { try { result.push(...fn()); } catch { /* detector failure is non-blocking */ } };

  if (ctx.activeRepairId) {
    run(() => detectRepairContext(ctx.activeRepairId!, engine.getRepairs(), now));
  }
  if (ctx.activeCustomerId) {
    run(() => detectCustomerContext(ctx.activeCustomerId!, engine.getCustomers(), engine.getSales(), engine.getRepairs(), engine.getLayaways(), now));
  }
  if (ctx.activeLayawayId) {
    run(() => detectLayawayContext(ctx.activeLayawayId!, engine.getLayaways(), now));
  }
  if (ctx.activeInventoryItemId) {
    run(() => detectInventoryContext(ctx.activeInventoryItemId!, engine.getInventory(), engine.getSales(), now));
  }
  if (ctx.activeUnlockId) {
    run(() => detectUnlockContext(ctx.activeUnlockId!, engine.getUnlocks(), now));
  }
  if (ctx.activeSpecialOrderId) {
    run(() => detectSpecialOrderContext(ctx.activeSpecialOrderId!, engine.getSpecialOrders(), now));
  }

  return result;
}
