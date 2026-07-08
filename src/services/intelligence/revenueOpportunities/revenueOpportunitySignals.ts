// CellHub Intelligence — Revenue Opportunity Signal Detectors
// Each detector returns RevenueOpportunity[]. Conservative estimates only.
// Pure functions — safe inside useMemo. Cap at 3 results per detector.

import type { Repair, Layaway, Sale, Customer, InventoryItem } from '@/store/types';
import type { PendingWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';
import type { RevenueOpportunity, RevenueConfidence } from './revenueOpportunityTypes';
import { computeRevenuePriorityScore } from './revenueImpactScoring';
import { toMs } from '@/services/intelligence/customerScoring/customerOpportunitySignals';

const NOW = () => Date.now();
const DAY_MS = 86_400_000;
const REPAIR_DELAY_DAYS = 7;
const INACTIVITY_DAYS = 90;
const VIP_INACTIVITY_DAYS = 30;
const DEAD_STOCK_DAYS = 90;
const VIP_LIFETIME_CENTS = 50_000; // $500

const TERMINAL_STATUSES = new Set(['picked_up', 'cancelled', 'refunded', 'refund_pending']);
const READY_STATUSES    = new Set(['completed', 'ready', 'ready_for_pickup']);

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(String(status || '').toLowerCase().trim());
}

// ── 1. Unpaid balance recovery ────────────────────────────────────────────────

/** Repairs and layaways with known outstanding balances. HIGH confidence. */
export function detectUnpaidBalances(
  repairs: Repair[],
  layaways: Layaway[],
): RevenueOpportunity[] {
  const now = NOW();
  const results: RevenueOpportunity[] = [];

  // Aggregate all unpaid repair balances
  const unpaidRepairs = repairs
    .filter((r) => typeof r.balance === 'number' && r.balance > 0 && !isTerminal(r.status))
    .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

  if (unpaidRepairs.length > 0) {
    const totalCents = unpaidRepairs.reduce((sum, r) => sum + (r.balance ?? 0), 0);
    const oldest = unpaidRepairs[unpaidRepairs.length - 1];
    const ageDays = oldest ? Math.floor((now - toMs(oldest.createdAt)) / DAY_MS) : 0;
    const urgency = Math.min(10, Math.round(ageDays / 7));
    const top = unpaidRepairs[0];
    results.push({
      id: `unpaid_repair_${top.id}`,
      type: 'unpaid_balance_recovery',
      title: unpaidRepairs.length === 1
        ? 'Recover outstanding repair balance'
        : `Recover repair balances (${unpaidRepairs.length} tickets)`,
      detail: `$${Math.round(totalCents / 100)} total across ${unpaidRepairs.length} repair${unpaidRepairs.length > 1 ? 's' : ''}`,
      priority: computeRevenuePriorityScore(totalCents, 'high', urgency, true),
      confidence: 'high',
      estimatedImpactCents: totalCents,
      urgency,
      relatedModule: 'repairs',
      relatedCustomerId: top.customerId ?? null,
      relatedEntityId: top.id,
      detectedAt: now,
      recommendedActions: ['act_open_repairs'],
      evidence: [`${unpaidRepairs.length} repair${unpaidRepairs.length > 1 ? 's' : ''} with unpaid balance`],
      suggestionKind: 'collect',
    });
  }

  // Aggregate all overdue layaway balances
  const unpaidLayaways = layaways
    .filter((l) => {
      const s = String(l.status || '').toLowerCase();
      return s !== 'completed' && s !== 'cancelled' && (l.balance ?? 0) > 0;
    })
    .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

  if (unpaidLayaways.length > 0) {
    const totalCents = unpaidLayaways.reduce((sum, l) => sum + (l.balance ?? 0), 0);
    const now2 = NOW();
    const overdueCount = unpaidLayaways.filter((l) => {
      if (!l.dueDate) return false;
      return toMs(l.dueDate) < now2;
    }).length;
    const urgency = overdueCount > 0 ? Math.min(10, 5 + overdueCount) : 3;
    const top = unpaidLayaways[0];
    results.push({
      id: `unpaid_layaway_${top.id}`,
      type: 'unpaid_balance_recovery',
      title: unpaidLayaways.length === 1
        ? 'Recover outstanding layaway balance'
        : `Recover layaway balances (${unpaidLayaways.length} accounts)`,
      detail: overdueCount > 0
        ? `$${Math.round(totalCents / 100)} total · ${overdueCount} overdue`
        : `$${Math.round(totalCents / 100)} total outstanding`,
      priority: computeRevenuePriorityScore(totalCents, 'high', urgency, true),
      confidence: 'high',
      estimatedImpactCents: totalCents,
      urgency,
      relatedModule: 'layaways',
      relatedCustomerId: top.customerId ?? null,
      relatedEntityId: top.id,
      detectedAt: now,
      recommendedActions: ['act_open_layaways'],
      evidence: [`${unpaidLayaways.length} layaway${unpaidLayaways.length > 1 ? 's' : ''} with open balance`],
      suggestionKind: 'collect',
    });
  }

  return results;
}

// ── 2. Abandoned workflow recovery ────────────────────────────────────────────

/** Pending external payment workflows with known amounts. HIGH confidence. */
export function detectAbandonedWorkflows(workflows: PendingWorkflow[]): RevenueOpportunity[] {
  const now = NOW();
  return workflows
    .filter((w) => w.type === 'external_payment' && w.status === 'pending')
    .map((w) => {
      const meta = w.metadata as Record<string, unknown>;
      const amountCents = typeof meta.amountCents === 'number' ? meta.amountCents : 0;
      const phone = String(meta.phone ?? '');
      const carrier = String(meta.carrier ?? '');
      const msLeft = w.expiresAt - now;
      const urgency = msLeft < 5 * 60_000 ? 9 : msLeft < 15 * 60_000 ? 7 : 5;
      return {
        id: `workflow_${w.id}`,
        type: 'abandoned_workflow_recovery' as const,
        title: amountCents > 0
          ? `Unfinished ${carrier || 'carrier'} payment may recover $${Math.round(amountCents / 100)}`
          : `Unfinished ${carrier || 'carrier'} payment workflow`,
        detail: phone ? `Line ${phone}` : undefined,
        priority: computeRevenuePriorityScore(amountCents, 'high', urgency, true),
        confidence: 'high' as const,
        estimatedImpactCents: amountCents,
        urgency,
        relatedModule: 'phone-payments',
        relatedEntityId: w.id,
        detectedAt: now,
        recommendedActions: ['act_resume_external_payment'],
        evidence: [`Payment workflow started but not completed`],
        suggestionKind: 'operational' as const,
      };
    })
    .slice(0, 3);
}

// ── 3. Delayed repair recovery ────────────────────────────────────────────────

/** Active repairs older than threshold — customer follow-up opportunity. */
export function detectDelayedRepairs(repairs: Repair[]): RevenueOpportunity[] {
  const now = NOW();
  const cutoff = now - REPAIR_DELAY_DAYS * DAY_MS;

  return repairs
    .filter((r) => {
      const s = String(r.status || '').toLowerCase().trim();
      if (TERMINAL_STATUSES.has(s) || READY_STATUSES.has(s)) return false;
      const ts = toMs(r.createdAt);
      return ts > 0 && ts < cutoff;
    })
    .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)) // oldest first
    .slice(0, 3)
    .map((r) => {
      const ageDays = Math.floor((now - toMs(r.createdAt)) / DAY_MS);
      const urgency = Math.min(10, Math.round(ageDays / 5));
      const balanceCents = typeof r.balance === 'number' ? r.balance : 0;
      const impactCents = balanceCents > 0 ? balanceCents : 0;
      const confidence = balanceCents > 0 ? 'medium' : 'low';
      return {
        id: `delayed_repair_${r.id}`,
        type: 'delayed_repair_recovery' as const,
        title: `Follow up on delayed repair · ${r.device || 'device'}`,
        detail: `${ageDays} days in progress`,
        priority: computeRevenuePriorityScore(impactCents, confidence as RevenueConfidence, urgency, true),
        confidence: confidence as RevenueConfidence,
        estimatedImpactCents: impactCents,
        urgency,
        relatedModule: 'repairs',
        relatedCustomerId: r.customerId ?? null,
        relatedEntityId: r.id,
        detectedAt: now,
        recommendedActions: ['act_open_repairs'],
        evidence: [`Repair open for ${ageDays} days`],
        suggestionKind: 'follow_up' as const,
      };
    });
}

// ── 4. Inactive customer recovery ─────────────────────────────────────────────

/**
 * Customers with 3+ past sales but no visit in 90+ days.
 * Impact = average of their last 3 sale totals (MEDIUM confidence).
 * Index-first: one O(S) pass builds the customer map.
 */
export function detectInactiveCustomers(
  customers: Customer[],
  sales: Sale[],
): RevenueOpportunity[] {
  const now = NOW();
  const cutoff = now - INACTIVITY_DAYS * DAY_MS;

  // Build index: customerId → sorted sale records (most-recent first)
  const saleMap = new Map<string, Sale[]>();
  for (const sale of sales) {
    if (!sale.customerId) continue;
    const s = String(sale.status || '').toLowerCase();
    // Canonical SaleStatus is 'voided' (store/types.ts). Keep legacy 'void'
    // for backward compatibility with any old records.
    if (s === 'void' || s === 'voided' || s === 'refunded') continue;
    const arr = saleMap.get(sale.customerId) ?? [];
    arr.push(sale);
    saleMap.set(sale.customerId, arr);
  }

  const candidates: { customer: Customer; lastSaleMs: number; avgTicket: number }[] = [];

  for (const [custId, custSales] of saleMap) {
    if (custSales.length < 3) continue;
    custSales.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    const lastSaleMs = toMs(custSales[0].createdAt);
    if (lastSaleMs >= cutoff) continue; // still active
    const customer = customers.find((c) => c && c.id === custId);
    if (!customer) continue;
    const last3Total = custSales.slice(0, 3).reduce((s, sale) => s + (sale.total ?? 0), 0);
    const avgTicket = Math.round(last3Total / 3);
    if (avgTicket <= 0) continue;
    candidates.push({ customer, lastSaleMs, avgTicket });
  }

  // Sort by avg ticket descending — highest value first
  candidates.sort((a, b) => b.avgTicket - a.avgTicket);

  return candidates.slice(0, 3).map(({ customer, lastSaleMs, avgTicket }) => {
    const daysSince = Math.floor((now - lastSaleMs) / DAY_MS);
    const urgency = Math.min(10, Math.round(daysSince / 18)); // 180d → urgency 10
    const name = customer.name || `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim();
    return {
      id: `inactive_${customer.id}`,
      type: 'inactive_customer_recovery' as const,
      title: `Recover inactive customer${name ? ` · ${name}` : ''}`,
      detail: `Last visit ${daysSince} days ago · avg $${Math.round(avgTicket / 100)} per visit`,
      priority: computeRevenuePriorityScore(avgTicket, 'medium', urgency, true),
      confidence: 'medium' as const,
      estimatedImpactCents: avgTicket,
      urgency,
      relatedModule: 'customers',
      relatedCustomerId: customer.id,
      detectedAt: now,
      recommendedActions: ['act_open_customer', 'act_whatsapp_follow_up'],
      evidence: [`${daysSince} days since last visit`, `3+ prior purchases`],
      suggestionKind: 'retention' as const,
    };
  });
}

// ── 5. VIP retention ──────────────────────────────────────────────────────────

/**
 * High-value customers (lifetime spend ≥ $500 + 5+ purchases) not seen in 30 days.
 * Impact = their average ticket (MEDIUM confidence).
 */
export function detectVipRetention(
  customers: Customer[],
  sales: Sale[],
): RevenueOpportunity[] {
  const now = NOW();
  const recentCutoff = now - VIP_INACTIVITY_DAYS * DAY_MS;
  const scoringWindow = now - 365 * DAY_MS; // 12 months

  const saleMap = new Map<string, Sale[]>();
  for (const sale of sales) {
    if (!sale.customerId) continue;
    const s = String(sale.status || '').toLowerCase();
    // Canonical SaleStatus is 'voided' (store/types.ts). Keep legacy 'void'
    // for backward compatibility with any old records.
    if (s === 'void' || s === 'voided' || s === 'refunded') continue;
    const arr = saleMap.get(sale.customerId) ?? [];
    arr.push(sale);
    saleMap.set(sale.customerId, arr);
  }

  const results: { customer: Customer; avgTicket: number; lastMs: number }[] = [];

  for (const [custId, custSales] of saleMap) {
    custSales.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    const lastMs = toMs(custSales[0].createdAt);
    if (lastMs >= recentCutoff) continue; // seen recently — no VIP risk

    // Lifetime spend check (12-month window)
    const windowSales = custSales.filter((s) => toMs(s.createdAt) >= scoringWindow);
    if (windowSales.length < 5) continue;
    const lifetimeCents = windowSales.reduce((s, sale) => s + (sale.total ?? 0), 0);
    if (lifetimeCents < VIP_LIFETIME_CENTS) continue;

    const customer = customers.find((c) => c && c.id === custId);
    if (!customer) continue;
    const avgTicket = Math.round(lifetimeCents / windowSales.length);
    results.push({ customer, avgTicket, lastMs });
  }

  results.sort((a, b) => b.avgTicket - a.avgTicket);

  return results.slice(0, 2).map(({ customer, avgTicket, lastMs }) => {
    const daysSince = Math.floor((now - lastMs) / DAY_MS);
    const name = customer.name || `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim();
    return {
      id: `vip_retention_${customer.id}`,
      type: 'vip_retention' as const,
      title: `Protect VIP relationship${name ? ` · ${name}` : ''}`,
      detail: `Not seen in ${daysSince} days`,
      priority: computeRevenuePriorityScore(avgTicket, 'medium', 7, true),
      confidence: 'medium' as const,
      estimatedImpactCents: avgTicket,
      urgency: 7,
      relatedModule: 'customers',
      relatedCustomerId: customer.id,
      detectedAt: now,
      recommendedActions: ['act_open_customer', 'act_whatsapp_follow_up'],
      evidence: [`VIP customer inactive ${daysSince} days`],
      suggestionKind: 'retention' as const,
    };
  });
}

// ── 6. Dead stock push ────────────────────────────────────────────────────────

/** Items with qty ≥ 2, added 90+ days ago — slow-moving inventory. LOW confidence. */
export function detectDeadStock(inventory: InventoryItem[]): RevenueOpportunity[] {
  const now = NOW();
  const cutoff = now - DEAD_STOCK_DAYS * DAY_MS;

  return inventory
    .filter((item) => {
      const qty = item.qty ?? 0;
      if (qty < 2 || (item.price ?? 0) <= 0) return false;
      const ts = toMs(item.createdAt);
      return ts > 0 && ts < cutoff;
    })
    .sort((a, b) => (b.price * (b.qty ?? 0)) - (a.price * (a.qty ?? 0)))
    .slice(0, 3)
    .map((item) => ({
      id: `dead_stock_${item.id}`,
      type: 'dead_stock_push' as const,
      title: `Push slow-moving stock · ${item.name}`,
      detail: `${item.qty ?? 0} units · $${Math.round(item.price / 100)} each`,
      priority: computeRevenuePriorityScore(item.price, 'low', 4, true),
      confidence: 'low' as const,
      estimatedImpactCents: item.price, // conservative: just 1 unit
      urgency: 4,
      relatedModule: 'inventory',
      relatedEntityId: item.id,
      relatedSku: item.sku ?? null,
      detectedAt: now,
      recommendedActions: ['act_open_pos'],
      evidence: [`${item.qty ?? 0} units in stock 90+ days`],
      suggestionKind: 'upsell' as const,
    }));
}

// ── 7. Low stock reorder ──────────────────────────────────────────────────────

/** Items at or below their min-qty threshold. LOW confidence (prevention, not recovery). */
export function detectLowStock(inventory: InventoryItem[]): RevenueOpportunity[] {
  const now = NOW();

  return inventory
    .filter((item) => {
      const qty = item.qty ?? 0;
      const threshold = item.minQty ?? 1;
      return qty <= threshold;
    })
    .sort((a, b) => (a.qty ?? 0) - (b.qty ?? 0))
    .slice(0, 3)
    .map((item) => {
      const qty = item.qty ?? 0;
      const urgency = qty === 0 ? 9 : 5;
      return {
        id: `low_stock_${item.id}`,
        type: 'low_stock_reorder' as const,
        title: qty === 0
          ? `Out of stock — reorder ${item.name}`
          : `Low stock · ${item.name} (${qty} left)`,
        priority: computeRevenuePriorityScore(0, 'low', urgency, false),
        confidence: 'low' as const,
        estimatedImpactCents: 0, // prevention, not recovery
        urgency,
        relatedModule: 'inventory',
        relatedEntityId: item.id,
        relatedSku: item.sku ?? null,
        detectedAt: now,
        recommendedActions: [],
        evidence: [`${qty} units remaining`],
        suggestionKind: 'operational' as const,
      };
    });
}

// ── 8. Missed accessory attach ────────────────────────────────────────────────

/** Recent sales with phone payments or repair items but no accessories. LOW confidence. */
export function detectMissedAccessoryAttach(sales: Sale[]): RevenueOpportunity[] {
  const now = NOW();
  const recentCutoff = now - 2 * 60 * 60_000; // last 2 hours

  const missed = sales
    .filter((sale) => {
      const ts = toMs(sale.createdAt);
      if (ts < recentCutoff) return false;
      const items = sale.items ?? [];
      const hasService = items.some((i) => {
        const cat = (i as any).category;
        return cat === 'phone_payment' || cat === 'repair' || cat === 'unlock';
      });
      const hasAccessory = items.some((i) => (i as any).category === 'accessory');
      return hasService && !hasAccessory;
    });

  if (missed.length < 2) return []; // noise threshold

  return [{
    id: 'missed_accessory_attach',
    type: 'missed_accessory_attach' as const,
    title: 'Accessory attach opportunity detected',
    detail: 'Recent service sales without accessory add-on',
    priority: computeRevenuePriorityScore(0, 'low', 3, true),
    confidence: 'low' as const,
    estimatedImpactCents: 0, // unknown what they'd buy
    urgency: 3,
    relatedModule: 'pos',
    detectedAt: now,
    recommendedActions: ['act_open_pos'],
    evidence: [`${missed.length} recent service sales without accessories`],
    suggestionKind: 'upsell' as const,
  }];
}
