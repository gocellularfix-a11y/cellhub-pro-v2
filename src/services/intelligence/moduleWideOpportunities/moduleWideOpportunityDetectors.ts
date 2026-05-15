// R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1
// Deterministic detectors for actionable opportunities across all modules.
// Rules: no financial mutations, no invented numbers, silent failures only.

import type { Repair, Layaway, Customer, Sale, InventoryItem } from '@/store/types';
import type { ModuleOpportunity, ExecutableOpportunityAction } from './moduleWideOpportunityTypes';

// ── Date helpers ──────────────────────────────────────────────────────────────

function toMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') {
    const n = new Date(ts).getTime();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof ts === 'object') {
    const obj = ts as Record<string, unknown>;
    if (typeof obj['toDate'] === 'function') {
      try { return (obj['toDate'] as () => Date)().getTime(); } catch { return 0; }
    }
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

// ── Repair status helpers ─────────────────────────────────────────────────────

const REPAIR_TERMINAL = new Set([
  'cancelled', 'picked_up', 'pickedup', 'refunded', 'delivered', 'closed', 'void',
]);

const REPAIR_READY = new Set([
  'ready', 'ready_for_pickup', 'readyforpickup', 'completed', 'done',
]);

function repairStatusNorm(r: Repair): string {
  return String(r.status || '').toLowerCase().replace(/[\s-]+/g, '_');
}

// ── 1. Repairs ────────────────────────────────────────────────────────────────

export function detectRepairOpportunities(repairs: Repair[], now: number): ModuleOpportunity[] {
  const result: ModuleOpportunity[] = [];
  const OVERDUE_DAYS = 5;
  const READY_STALE_DAYS = 2;
  let overdueCount = 0;
  let readyCount = 0;

  for (const r of repairs) {
    const s = repairStatusNorm(r);
    if (REPAIR_TERMINAL.has(s)) continue;

    if (REPAIR_READY.has(s)) {
      const refMs = toMs((r as unknown as Record<string, unknown>)['completedAt'] ?? r.updatedAt);
      const days = refMs ? Math.floor((now - refMs) / 86_400_000) : 0;
      if (days >= READY_STALE_DAYS && readyCount < 3) {
        readyCount++;
        const readyActions: ExecutableOpportunityAction[] = [];
        if (r.customerPhone) {
          readyActions.push({
            actionType: 'whatsapp_followup',
            labelKey: 'oppo.action.whatsapp',
            customerId: r.customerId ?? '',
            customerPhone: r.customerPhone,
            customerName: r.customerName,
            customMessage: `Hi ${r.customerName}, your device is ready for pickup at Go Cellular!`,
          });
        }
        readyActions.push({
          actionType: 'open_repair',
          labelKey: 'oppo.action.openRepair',
          entityId: r.id,
          entityName: r.customerName,
        });
        result.push({
          id: `mwo-repair-ready-${r.id}`,
          module: 'repairs',
          severity: days >= 5 ? 'high' : 'medium',
          titleKey: 'oppo.repair.ready.title',
          summaryKey: 'oppo.repair.ready',
          evidence: [r.customerName, String(days)],
          recommendedAction: 'notify_customer_pickup',
          confidence: 'high',
          executableAction: r.customerPhone
            ? { type: 'whatsapp', payload: { customerId: r.customerId ?? '', phone: r.customerPhone, name: r.customerName } }
            : undefined,
          actions: readyActions,
          createdAt: now,
        });
      }
    } else {
      const days = daysSince(r.createdAt, now);
      if (days >= OVERDUE_DAYS && overdueCount < 3) {
        overdueCount++;
        result.push({
          id: `mwo-repair-overdue-${r.id}`,
          module: 'repairs',
          severity: days >= 10 ? 'critical' : 'high',
          titleKey: 'oppo.repair.overdue.title',
          summaryKey: 'oppo.repair.overdue',
          evidence: [r.customerName, String(days)],
          recommendedAction: 'update_repair_status',
          confidence: 'high',
          actions: [{
            actionType: 'open_repair',
            labelKey: 'oppo.action.openRepair',
            entityId: r.id,
            entityName: r.customerName,
          }],
          createdAt: now,
        });
      }
    }
  }

  return result;
}

// ── 2. Inventory ──────────────────────────────────────────────────────────────

type SaleEntry = { lastMs: number; count30: number };

function mergeSaleEntry(prev: SaleEntry | undefined, saleMs: number, now: number): SaleEntry {
  const THIRTY_DAYS_MS = 30 * 86_400_000;
  return {
    lastMs: Math.max(prev?.lastMs ?? 0, saleMs),
    count30: (prev?.count30 ?? 0) + (now - saleMs <= THIRTY_DAYS_MS ? 1 : 0),
  };
}

export function detectInventoryOpportunities(
  inventory: InventoryItem[],
  sales: Sale[],
  now: number,
): ModuleOpportunity[] {
  const result: ModuleOpportunity[] = [];
  const SIXTY_DAYS_MS = 60 * 86_400_000;

  const byId = new Map<string, SaleEntry>();
  const bySku = new Map<string, SaleEntry>();

  for (const sale of sales) {
    const saleMs = toMs(sale.createdAt);
    const st = String(sale.status || '').toLowerCase();
    if (st === 'voided' || st === 'refunded') continue;

    for (const item of sale.items) {
      if (item.inventoryId) byId.set(item.inventoryId, mergeSaleEntry(byId.get(item.inventoryId), saleMs, now));
      if (item.sku) bySku.set(item.sku, mergeSaleEntry(bySku.get(item.sku), saleMs, now));
    }
  }

  let lowCount = 0;
  let deadCount = 0;

  for (const item of inventory) {
    if (item.qty <= 0) continue;

    const entry = byId.get(item.id) ?? (item.sku ? bySku.get(item.sku) : undefined);
    const lastMs = entry?.lastMs ?? 0;
    const count30 = entry?.count30 ?? 0;
    const daysSinceSale = lastMs ? Math.floor((now - lastMs) / 86_400_000) : 9999;

    const minQty = item.minQty ?? 1;
    if (item.qty <= minQty && count30 >= 2 && lowCount < 3) {
      lowCount++;
      result.push({
        id: `mwo-inv-low-${item.id}`,
        module: 'inventory',
        severity: count30 >= 5 ? 'high' : 'medium',
        titleKey: 'oppo.inventory.lowstock.title',
        summaryKey: 'oppo.inventory.lowstock',
        evidence: [item.name, String(item.qty)],
        recommendedAction: 'reorder',
        confidence: 'high',
        actions: [{ actionType: 'open_inventory', labelKey: 'oppo.action.openInventory', entityId: item.id, entityName: item.name }],
        createdAt: now,
      });
    }

    const itemAge = now - toMs(item.createdAt);
    if (item.qty >= 2 && itemAge >= SIXTY_DAYS_MS && daysSinceSale > 60 && deadCount < 3) {
      deadCount++;
      result.push({
        id: `mwo-inv-dead-${item.id}`,
        module: 'inventory',
        severity: daysSinceSale > 120 ? 'high' : 'medium',
        titleKey: 'oppo.inventory.deadstock.title',
        summaryKey: 'oppo.inventory.deadstock',
        evidence: [item.name, String(daysSinceSale >= 9000 ? 60 : daysSinceSale)],
        recommendedAction: 'discount_or_bundle',
        confidence: daysSinceSale > 90 ? 'high' : 'medium',
        actions: [{ actionType: 'open_inventory', labelKey: 'oppo.action.openInventory', entityId: item.id, entityName: item.name }],
        createdAt: now,
      });
    }
  }

  return result;
}

// ── 3. Customers ──────────────────────────────────────────────────────────────

export function detectCustomerOpportunities(
  customers: Customer[],
  sales: Sale[],
  repairs: Repair[],
  layaways: Layaway[],
  now: number,
): ModuleOpportunity[] {
  const result: ModuleOpportunity[] = [];

  const VIP_THRESHOLD_CENTS = 30_000; // $300
  const INACTIVE_DAYS = 30;

  // Build per-customer revenue and last-visit maps from sales
  const revMap = new Map<string, number>();
  const lastVisit = new Map<string, number>();

  for (const sale of sales) {
    if (!sale.customerId) continue;
    const st = String(sale.status || '').toLowerCase();
    if (st === 'voided') continue;
    const saleMs = toMs(sale.createdAt);
    revMap.set(sale.customerId, (revMap.get(sale.customerId) ?? 0) + (sale.total || 0));
    const prev = lastVisit.get(sale.customerId) ?? 0;
    if (saleMs > prev) lastVisit.set(sale.customerId, saleMs);
  }

  // VIP inactive
  let vipCount = 0;
  for (const c of customers) {
    if (vipCount >= 3) break;
    const rev = revMap.get(c.id) ?? 0;
    if (rev < VIP_THRESHOLD_CENTS) continue;
    const lastMs = lastVisit.get(c.id) ?? 0;
    const days = lastMs ? Math.floor((now - lastMs) / 86_400_000) : 9999;
    if (days < INACTIVE_DAYS) continue;
    vipCount++;
    const vipActions: ExecutableOpportunityAction[] = [];
    if (c.phone) {
      vipActions.push({
        actionType: 'whatsapp_followup',
        labelKey: 'oppo.action.whatsapp',
        customerId: c.id,
        customerPhone: c.phone,
        customerName: c.name,
      });
    }
    vipActions.push({ actionType: 'open_customer', labelKey: 'oppo.action.openCustomer', entityId: c.id, entityName: c.name });
    result.push({
      id: `mwo-cust-vip-${c.id}`,
      module: 'customers',
      severity: rev >= 100_000 ? 'high' : 'medium',
      titleKey: 'oppo.customer.vip.title',
      summaryKey: 'oppo.customer.vip',
      evidence: [c.name, String(days)],
      recommendedAction: 'contact_vip',
      confidence: 'high',
      executableAction: c.phone
        ? { type: 'whatsapp', payload: { customerId: c.id, phone: c.phone, name: c.name } }
        : undefined,
      actions: vipActions,
      createdAt: now,
    });
  }

  // Unpaid balances aggregated by customer key
  const unpaid = new Map<string, { name: string; phone: string; balance: number }>();

  for (const r of repairs) {
    if (!r.balance || r.balance <= 0) continue;
    if (REPAIR_TERMINAL.has(repairStatusNorm(r))) continue;
    const key = r.customerId ?? `r-${r.id}`;
    const e = unpaid.get(key);
    if (e) { e.balance += r.balance; }
    else { unpaid.set(key, { name: r.customerName, phone: r.customerPhone, balance: r.balance }); }
  }

  for (const l of layaways) {
    if (!l.balance || l.balance <= 0) continue;
    const st = String(l.status || '').toLowerCase();
    if (st === 'completed' || st === 'cancelled') continue;
    const key = l.customerId ?? `l-${l.id}`;
    const e = unpaid.get(key);
    if (e) { e.balance += l.balance; }
    else { unpaid.set(key, { name: l.customerName, phone: l.customerPhone, balance: l.balance }); }
  }

  let unpaidCount = 0;
  for (const [, info] of unpaid) {
    if (unpaidCount >= 3) break;
    if (info.balance < 500) continue; // skip amounts < $5
    unpaidCount++;
    const unpaidActions: ExecutableOpportunityAction[] = [];
    if (info.phone) {
      unpaidActions.push({
        actionType: 'whatsapp_followup',
        labelKey: 'oppo.action.whatsapp',
        customerPhone: info.phone,
        customerName: info.name,
      });
    }
    unpaidActions.push({ actionType: 'callback_reminder', labelKey: 'oppo.action.reminder', customerName: info.name });
    result.push({
      id: `mwo-cust-unpaid-${unpaidCount}`,
      module: 'customers',
      severity: info.balance >= 5_000 ? 'high' : 'medium',
      titleKey: 'oppo.customer.unpaid.title',
      summaryKey: 'oppo.customer.unpaid',
      evidence: [info.name, fmtCents(info.balance)],
      recommendedAction: 'collect_balance',
      confidence: 'high',
      executableAction: info.phone
        ? { type: 'whatsapp', payload: { phone: info.phone, name: info.name } }
        : undefined,
      actions: unpaidActions,
      createdAt: now,
    });
  }

  return result;
}

// ── 4. Layaways ───────────────────────────────────────────────────────────────

export function detectLayawayOpportunities(layaways: Layaway[], now: number): ModuleOpportunity[] {
  const result: ModuleOpportunity[] = [];
  const THIRTY_DAYS_MS = 30 * 86_400_000;
  let overdueCount = 0;
  let nearCount = 0;
  let abandonedCount = 0;

  for (const l of layaways) {
    const st = String(l.status || '').toLowerCase();
    if (st === 'completed' || st === 'cancelled') continue;
    if (!l.balance || l.balance <= 0) continue;

    // Overdue payment
    if (l.dueDate && overdueCount < 3) {
      const dueMs = toMs(l.dueDate);
      if (dueMs && dueMs < now) {
        overdueCount++;
        const overActs: ExecutableOpportunityAction[] = [];
        if (l.customerPhone) {
          overActs.push({
            actionType: 'whatsapp_followup',
            labelKey: 'oppo.action.whatsapp',
            customerId: l.customerId ?? '',
            customerPhone: l.customerPhone,
            customerName: l.customerName,
          });
        }
        overActs.push({ actionType: 'open_layaway', labelKey: 'oppo.action.openLayaway', entityId: l.id, entityName: l.customerName });
        result.push({
          id: `mwo-lay-over-${l.id}`,
          module: 'layaways',
          severity: now - dueMs > THIRTY_DAYS_MS ? 'critical' : 'high',
          titleKey: 'oppo.layaway.overdue.title',
          summaryKey: 'oppo.layaway.overdue',
          evidence: [l.customerName, fmtCents(l.balance)],
          recommendedAction: 'contact_layaway_overdue',
          confidence: 'high',
          executableAction: l.customerPhone
            ? { type: 'whatsapp', payload: { customerId: l.customerId ?? '', phone: l.customerPhone, name: l.customerName } }
            : undefined,
          actions: overActs,
          createdAt: now,
        });
        continue;
      }
    }

    // Near completion: balance < 20% of total, at least $10 remaining
    if (l.totalPrice > 0 && l.balance < l.totalPrice * 0.2 && l.balance >= 1_000 && nearCount < 3) {
      nearCount++;
      const nearActs: ExecutableOpportunityAction[] = [];
      if (l.customerPhone) {
        nearActs.push({
          actionType: 'whatsapp_followup',
          labelKey: 'oppo.action.whatsapp',
          customerId: l.customerId ?? '',
          customerPhone: l.customerPhone,
          customerName: l.customerName,
        });
      }
      nearActs.push({ actionType: 'open_layaway', labelKey: 'oppo.action.openLayaway', entityId: l.id, entityName: l.customerName });
      result.push({
        id: `mwo-lay-near-${l.id}`,
        module: 'layaways',
        severity: 'medium',
        titleKey: 'oppo.layaway.near.title',
        summaryKey: 'oppo.layaway.near',
        evidence: [l.customerName, fmtCents(l.balance)],
        recommendedAction: 'encourage_final_payment',
        confidence: 'high',
        executableAction: l.customerPhone
          ? { type: 'whatsapp', payload: { customerId: l.customerId ?? '', phone: l.customerPhone, name: l.customerName } }
          : undefined,
        actions: nearActs,
        createdAt: now,
      });
      continue;
    }

    // Abandoned: active, age > 30 days, no payment in 30+ days
    const ageDays = daysSince(l.createdAt, now);
    if (ageDays < 30 || abandonedCount >= 3) continue;

    let lastActivityMs = toMs(l.updatedAt ?? l.createdAt);
    if (l.payments && l.payments.length > 0) {
      for (const p of l.payments) {
        const rec = p as unknown as Record<string, unknown>;
        const pMs = toMs(rec['date'] ?? rec['createdAt'] ?? rec['paidAt'] ?? rec['paymentDate']);
        if (pMs > lastActivityMs) lastActivityMs = pMs;
      }
    }

    const daysSinceActivity = lastActivityMs ? Math.floor((now - lastActivityMs) / 86_400_000) : ageDays;
    if (daysSinceActivity < 30) continue;

    abandonedCount++;
    const abandActs: ExecutableOpportunityAction[] = [];
    if (l.customerPhone) {
      abandActs.push({
        actionType: 'whatsapp_followup',
        labelKey: 'oppo.action.whatsapp',
        customerId: l.customerId ?? '',
        customerPhone: l.customerPhone,
        customerName: l.customerName,
      });
    }
    abandActs.push({ actionType: 'open_layaway', labelKey: 'oppo.action.openLayaway', entityId: l.id, entityName: l.customerName });
    result.push({
      id: `mwo-lay-aband-${l.id}`,
      module: 'layaways',
      severity: daysSinceActivity >= 60 ? 'high' : 'medium',
      titleKey: 'oppo.layaway.abandoned.title',
      summaryKey: 'oppo.layaway.abandoned',
      evidence: [l.customerName, String(daysSinceActivity)],
      recommendedAction: 'follow_up_or_cancel_layaway',
      confidence: 'medium',
      executableAction: l.customerPhone
        ? { type: 'whatsapp', payload: { customerId: l.customerId ?? '', phone: l.customerPhone, name: l.customerName } }
        : undefined,
      actions: abandActs,
      createdAt: now,
    });
  }

  return result;
}

// ── 5. Approvals / Discounts ──────────────────────────────────────────────────

export function detectDiscountOpportunities(sales: Sale[], now: number): ModuleOpportunity[] {
  const result: ModuleOpportunity[] = [];

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  type DiscountEntry = { discount: number; pct: number };
  const todayDiscounts: DiscountEntry[] = [];
  const byEmployee = new Map<string, number>();

  for (const sale of sales) {
    const saleMs = toMs(sale.createdAt);
    if (saleMs < todayMs) continue;
    const st = String(sale.status || '').toLowerCase();
    if (st === 'voided') continue;

    const discount = (sale.subtotal || 0) - (sale.subtotalAfterDiscount ?? sale.subtotal ?? 0);
    if (discount <= 0) continue;

    const pct = sale.subtotal > 0 ? (discount / sale.subtotal) * 100 : 0;
    if (pct < 5) continue; // ignore rounding noise

    todayDiscounts.push({ discount, pct });

    const emp = sale.employeeName ?? '';
    if (emp) byEmployee.set(emp, (byEmployee.get(emp) ?? 0) + 1);
  }

  if (todayDiscounts.length >= 3) {
    const avgPct = todayDiscounts.reduce((s, d) => s + d.pct, 0) / todayDiscounts.length;
    result.push({
      id: `mwo-disc-excess-${now}`,
      module: 'approvals',
      severity: todayDiscounts.length >= 6 || avgPct >= 20 ? 'high' : 'medium',
      titleKey: 'oppo.discount.excessive.title',
      summaryKey: 'oppo.discount.excessive',
      evidence: [String(todayDiscounts.length), avgPct.toFixed(1)],
      recommendedAction: 'review_discounts',
      confidence: 'high',
      actions: [{ actionType: 'queue_manager_review', labelKey: 'oppo.action.review' }],
      createdAt: now,
    });
  }

  for (const [emp, count] of byEmployee) {
    if (count >= 3) {
      result.push({
        id: `mwo-disc-emp-${emp.replace(/\W+/g, '-')}-${now}`,
        module: 'approvals',
        severity: count >= 5 ? 'high' : 'medium',
        titleKey: 'oppo.discount.employee.title',
        summaryKey: 'oppo.discount.employee',
        evidence: [emp, String(count)],
        recommendedAction: 'review_employee_discounts',
        confidence: 'high',
        actions: [{ actionType: 'queue_manager_review', labelKey: 'oppo.action.review' }],
        createdAt: now,
      });
    }
  }

  return result;
}
