// R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1
// Deterministic proactive operations engine.
// Generates a ranked set of operator actions from live entity state.
// No AI, no ML, no hallucinations — pure state-based priority scoring.

import type { Sale, Repair, Customer, InventoryItem, Layaway } from '@/store/types';
import type { ReorderRecommendation } from '../types';
import type { ProactiveAction, ProactiveOperationsReport, ProactiveCategory } from './types';
import type { OutcomeCategory } from '../outcomes/types';
import type { WorkflowCategory } from '../workflows/types';
import { getActiveWorkflows, getStaleWorkflows } from '../workflows/store';
import { getQueue } from '../managerQueue/actions';
import { getCategorySuccessRate } from '../outcomes/outcomeEngine';

// ── Structural context interface ───────────────────────────────────────────────
// Satisfied by IntelligenceEngine without a direct import (avoids circular dep).
export interface ProactiveEvalContext {
  getSales(): Sale[];
  getRepairs(): Repair[];
  getCustomers(): Customer[];
  getInventory(): InventoryItem[];
  getLayaways(): Layaway[];
  getReorderRecommendations(): ReorderRecommendation[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REPAIR_AGE_THRESHOLD_MS = 7  * 24 * 60 * 60 * 1000; // 7 days
const VIP_INACTIVITY_MS       = 30 * 24 * 60 * 60 * 1000; // 30 days
const VIP_MIN_SPEND_CENTS     = 15000;                     // $150 minimum total spend
const WORKFLOW_STALE_MS       = 72 * 60 * 60 * 1000;       // 72 hours

const TERMINAL_REPAIR  = new Set(['picked_up', 'cancelled', 'closed', 'refunded']);
const TERMINAL_LAYAWAY = new Set(['completed', 'cancelled', 'forfeited']);

// ── Utilities ─────────────────────────────────────────────────────────────────

function parseTs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  try {
    if (typeof (value as { toDate?: unknown }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate().getTime();
    }
    return new Date(value as string).getTime();
  } catch { return 0; }
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function priorityFromCents(cents: number): ProactiveAction['priority'] {
  if (cents >= 15000) return 'critical'; // $150+
  if (cents >= 5000)  return 'high';     // $50+
  return 'medium';
}

function rankScore(a: ProactiveAction): number {
  const TIER: Record<string, number> = { critical: 3000, high: 2000, medium: 1000 };
  return (TIER[a.priority] ?? 0)
    + (a.estimatedImpactCents ?? 0) / 10
    + a.confidence * 500;
}

// ── Confidence ────────────────────────────────────────────────────────────────

const PROACTIVE_TO_OUTCOME: Partial<Record<ProactiveCategory, OutcomeCategory>> = {
  collection:      'collection_recovered',
  repair_followup: 'repair_pickup',
  vip_retention:   'vip_returned',
  inventory:       'inventory_recovered',
  approval:        'approval_completed',
};

function confFor(category: ProactiveCategory): number {
  const oc = PROACTIVE_TO_OUTCOME[category];
  if (!oc) return 0.5;
  return getCategorySuccessRate(oc);
}

// ── WorkflowCategory → ProactiveCategory ─────────────────────────────────────

const WORKFLOW_TO_PROACTIVE: Record<WorkflowCategory, ProactiveCategory> = {
  repair_followup:  'repair_followup',
  collection:       'collection',
  vip_retention:    'vip_retention',
  inventory_action: 'inventory',
  approval_review:  'approval',
};

// ── Action generators ─────────────────────────────────────────────────────────

type Lang = 'en' | 'es' | 'pt';

// Priority 1: Recoverable balances (repairs + layaways with money outstanding)
function buildCollectionActions(ctx: ProactiveEvalContext, lang: Lang, now: number): ProactiveAction[] {
  const actions: ProactiveAction[] = [];
  const es = lang !== 'en';
  const conf = confFor('collection');
  const customerMap = new Map(ctx.getCustomers().map(c => [c.id, c]));

  for (const repair of ctx.getRepairs()) {
    const status = String((repair as any).status || '').toLowerCase();
    if (TERMINAL_REPAIR.has(status)) continue;
    const balance = repair.balance ?? 0;
    if (balance <= 0) continue;
    const customer = repair.customerId ? customerMap.get(repair.customerId) : undefined;
    const name = customer?.name ?? (es ? 'Cliente' : 'Customer');
    const bal = dollars(balance);
    actions.push({
      id: `col-r-${repair.id}`,
      category: 'collection',
      priority: priorityFromCents(balance),
      title: es ? `${name} — ${bal} pendiente` : `${name} — ${bal} outstanding`,
      reason: es ? 'Saldo de reparación sin cobrar.' : 'Repair balance has not been paid.',
      recommendedAction: es
        ? `Llamar a ${name} para cobrar el saldo de ${bal}.`
        : `Call ${name} to collect the ${bal} repair balance.`,
      estimatedImpactCents: balance,
      entityType: 'repair',
      entityId: repair.id,
      confidence: conf,
      createdAt: now,
    });
  }

  for (const layaway of ctx.getLayaways()) {
    const status = String((layaway as any).status || '').toLowerCase();
    if (TERMINAL_LAYAWAY.has(status)) continue;
    const balance = layaway.balance ?? 0;
    if (balance <= 0) continue;
    const customer = layaway.customerId ? customerMap.get(layaway.customerId) : undefined;
    const name = customer?.name ?? (es ? 'Cliente' : 'Customer');
    const bal = dollars(balance);
    actions.push({
      id: `col-l-${layaway.id}`,
      category: 'collection',
      priority: priorityFromCents(balance),
      title: es ? `${name} — ${bal} apartado pendiente` : `${name} — ${bal} layaway balance`,
      reason: es ? 'Apartado con saldo pendiente.' : 'Layaway balance has not been paid.',
      recommendedAction: es
        ? `Contactar a ${name} sobre el apartado (${bal}).`
        : `Contact ${name} about the layaway balance (${bal}).`,
      estimatedImpactCents: balance,
      entityType: 'layaway',
      entityId: layaway.id,
      confidence: conf,
      createdAt: now,
    });
  }

  return actions
    .sort((a, b) => (b.estimatedImpactCents ?? 0) - (a.estimatedImpactCents ?? 0))
    .slice(0, 3);
}

// Priority 2: Overdue repair follow-ups (balance=0, repair is still open and old)
function buildRepairFollowupActions(ctx: ProactiveEvalContext, lang: Lang, now: number): ProactiveAction[] {
  const actions: ProactiveAction[] = [];
  const es = lang !== 'en';
  const conf = confFor('repair_followup');
  const customerMap = new Map(ctx.getCustomers().map(c => [c.id, c]));
  const cutoff = now - REPAIR_AGE_THRESHOLD_MS;

  for (const repair of ctx.getRepairs()) {
    const status = String((repair as any).status || '').toLowerCase();
    if (TERMINAL_REPAIR.has(status)) continue;
    const balance = repair.balance ?? 0;
    if (balance > 0) continue; // handled by collection
    const repairTs = parseTs((repair as any).createdAt);
    if (!repairTs || repairTs >= cutoff) continue; // too recent
    const agedays = Math.floor((now - repairTs) / 86400000);
    const customer = repair.customerId ? customerMap.get(repair.customerId) : undefined;
    const name = customer?.name ?? (es ? 'Cliente' : 'Customer');
    actions.push({
      id: `rf-${repair.id}`,
      category: 'repair_followup',
      priority: agedays > 14 ? 'critical' : 'high',
      title: es
        ? `Seguimiento — ${name} (${agedays} días)`
        : `Follow-up — ${name} (${agedays} days)`,
      reason: es
        ? `Reparación activa hace ${agedays} días sin movimiento.`
        : `Repair has been open for ${agedays} days with no update.`,
      recommendedAction: es
        ? `Contactar a ${name} para actualizar el estado de la reparación.`
        : `Contact ${name} to update them on the repair status.`,
      entityType: 'repair',
      entityId: repair.id,
      confidence: conf,
      createdAt: now,
    });
  }

  // Sort by age descending (oldest first)
  return actions
    .sort((a, b) => (b.priority === 'critical' ? 1 : 0) - (a.priority === 'critical' ? 1 : 0))
    .slice(0, 2);
}

// Priority 3: VIP customers inactive for 30+ days
function buildVipRetentionActions(ctx: ProactiveEvalContext, lang: Lang, now: number): ProactiveAction[] {
  const es = lang !== 'en';
  const conf = confFor('vip_retention');
  const cutoff = now - VIP_INACTIVITY_MS;

  const customerRevenue = new Map<string, number>();
  const customerLastVisit = new Map<string, number>();
  for (const sale of ctx.getSales()) {
    const cid = sale.customerId;
    if (!cid) continue;
    const status = String((sale as any).status || '').toLowerCase();
    if (status === 'voided' || status === 'refunded') continue;
    const ts = parseTs((sale as any).createdAt);
    if (!ts) continue;
    if (ts > (customerLastVisit.get(cid) ?? 0)) customerLastVisit.set(cid, ts);
    customerRevenue.set(cid, (customerRevenue.get(cid) ?? 0) + ((sale as any).total ?? 0));
  }

  type Candidate = { cid: string; name: string; revenue: number; daysSince: number };
  const candidates: Candidate[] = [];
  for (const customer of ctx.getCustomers()) {
    const revenue = customerRevenue.get(customer.id) ?? 0;
    if (revenue < VIP_MIN_SPEND_CENTS) continue;
    const lastVisit = customerLastVisit.get(customer.id) ?? 0;
    if (!lastVisit || lastVisit >= cutoff) continue;
    const daysSince = Math.floor((now - lastVisit) / 86400000);
    candidates.push({ cid: customer.id, name: customer.name, revenue, daysSince });
  }

  candidates.sort((a, b) => b.revenue - a.revenue);

  return candidates.slice(0, 2).map(c => ({
    id: `vip-${c.cid}`,
    category: 'vip_retention' as ProactiveCategory,
    priority: (c.daysSince > 60 ? 'high' : 'medium') as ProactiveAction['priority'],
    title: es
      ? `${c.name} inactivo — ${c.daysSince} días sin visitar`
      : `${c.name} inactive — ${c.daysSince} days since last visit`,
    reason: es
      ? `Cliente de alto valor (${dollars(c.revenue)} total) sin visitar desde hace ${c.daysSince} días.`
      : `High-value customer (${dollars(c.revenue)} total) hasn't visited in ${c.daysSince} days.`,
    recommendedAction: es
      ? `Contactar a ${c.name} con una oferta personalizada.`
      : `Reach out to ${c.name} with a personalized offer.`,
    estimatedImpactCents: Math.round(c.revenue * 0.15),
    entityType: 'customer',
    entityId: c.cid,
    confidence: conf,
    createdAt: now,
  }));
}

// Priority 4: Stalled workflows (active, not updated in 72h)
function buildWorkflowEscalationActions(lang: Lang, now: number): ProactiveAction[] {
  const es = lang !== 'en';
  const stale = getStaleWorkflows(WORKFLOW_STALE_MS);

  return stale.slice(0, 2).map(wf => {
    const hoursStale = Math.floor((now - wf.updatedAt) / 3600000);
    const cat = WORKFLOW_TO_PROACTIVE[wf.category] ?? 'approval';
    return {
      id: `wf-${wf.id}`,
      category: cat,
      priority: (wf.status === 'waiting' || hoursStale > 120 ? 'high' : 'medium') as ProactiveAction['priority'],
      title: es ? `Flujo estancado — ${wf.title}` : `Stalled workflow — ${wf.title}`,
      reason: es
        ? `Sin avance en ${hoursStale} horas.`
        : `No progress for ${hoursStale} hours.`,
      recommendedAction: wf.nextSuggestedAction
        ?? (es ? 'Revisar el flujo y tomar acción.' : 'Review the workflow and take action.'),
      workflowId: wf.id,
      entityType: wf.entityType,
      entityId: wf.entityId,
      confidence: 0.65,
      createdAt: now,
    };
  });
}

// Priority 5: Pending manager queue approvals
function buildApprovalBacklogActions(lang: Lang, now: number): ProactiveAction[] {
  const es = lang !== 'en';
  const pending = getQueue().filter(i => i.status === 'pending');
  if (pending.length === 0) return [];

  const highCount = pending.filter(i => i.severity === 'critical' || i.severity === 'high').length;
  const count = pending.length;
  const s = (n: number) => n !== 1;

  return [{
    id: 'approval-backlog',
    category: 'approval',
    priority: highCount > 0 ? 'high' : 'medium',
    title: es
      ? `${count} elemento${s(count) ? 's' : ''} pendiente${s(count) ? 's' : ''} de revisión`
      : `${count} item${s(count) ? 's' : ''} pending manager review`,
    reason: es
      ? highCount > 0
        ? `${highCount} de alta prioridad esperando en la cola.`
        : `La cola del gerente tiene ${count} elemento${s(count) ? 's' : ''}.`
      : highCount > 0
        ? `${highCount} high-priority item${s(highCount) ? 's' : ''} in the queue.`
        : `Manager queue has ${count} item${s(count) ? 's' : ''} waiting.`,
    recommendedAction: es
      ? 'Abrir la cola del gerente y resolver los elementos pendientes.'
      : 'Open the manager queue and resolve pending items.',
    confidence: 0.95,
    createdAt: now,
  }];
}

// Priority 6: Inventory reorder risk
function buildInventoryRiskActions(ctx: ProactiveEvalContext, lang: Lang, now: number): ProactiveAction[] {
  const es = lang !== 'en';
  const conf = confFor('inventory');
  const urgent = ctx.getReorderRecommendations().filter(
    r => r.priority === 'CRITICAL' || r.priority === 'HIGH',
  );

  return urgent.slice(0, 2).map(rec => ({
    id: `inv-${rec.inventoryId}`,
    category: 'inventory' as ProactiveCategory,
    priority: (rec.priority === 'CRITICAL' ? 'critical' : 'high') as ProactiveAction['priority'],
    title: es
      ? `Stock bajo — ${rec.name} (${rec.currentQty} restante${rec.currentQty !== 1 ? 's' : ''})`
      : `Low stock — ${rec.name} (${rec.currentQty} remaining)`,
    reason: es
      ? `${rec.daysLeft < 1 ? 'Menos de 1' : rec.daysLeft} día${rec.daysLeft !== 1 ? 's' : ''} de stock al ritmo actual.`
      : `${rec.daysLeft < 1 ? 'Less than 1' : rec.daysLeft} day${rec.daysLeft !== 1 ? 's' : ''} of stock at current pace.`,
    recommendedAction: es
      ? `Reordenar ${rec.suggestedOrderQty} unidades de ${rec.name}.`
      : `Reorder ${rec.suggestedOrderQty} units of ${rec.name}.`,
    estimatedImpactCents: rec.lostRevenueRiskCents,
    entityType: 'inventory',
    entityId: rec.inventoryId,
    confidence: conf,
    createdAt: now,
  }));
}

// ── Summary ───────────────────────────────────────────────────────────────────

function buildSummary(actions: ProactiveAction[], lang: Lang): string {
  if (actions.length === 0) {
    return lang === 'es'
      ? 'No hay acciones operativas urgentes ahora mismo.'
      : 'No urgent operational actions at this time.';
  }
  const es = lang !== 'en';
  const total = actions.length;
  const impact = actions.reduce((s, a) => s + (a.estimatedImpactCents ?? 0), 0);
  const s = (n: number) => n !== 1;
  if (impact > 0) {
    return es
      ? `${total} acción${s(total) ? 'es' : ''} prioritaria${s(total) ? 's' : ''} — ${dollars(impact)} potencialmente recuperable.`
      : `${total} priority action${s(total) ? 's' : ''} — ${dollars(impact)} potentially recoverable.`;
  }
  return es
    ? `${total} acción${s(total) ? 'es' : ''} operativa${s(total) ? 's' : ''} identificada${s(total) ? 's' : ''}.`
    : `${total} operational action${s(total) ? 's' : ''} identified.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateProactiveOperationsReport(
  ctx: ProactiveEvalContext,
  lang: Lang,
): ProactiveOperationsReport {
  const now = Date.now();

  const candidates: ProactiveAction[] = [
    ...buildCollectionActions(ctx, lang, now),
    ...buildRepairFollowupActions(ctx, lang, now),
    ...buildVipRetentionActions(ctx, lang, now),
    ...buildWorkflowEscalationActions(lang, now),
    ...buildApprovalBacklogActions(lang, now),
    ...buildInventoryRiskActions(ctx, lang, now),
  ];

  const actions = candidates
    .sort((a, b) => rankScore(b) - rankScore(a))
    .slice(0, 8);

  return {
    generatedAt: now,
    summary: buildSummary(actions, lang),
    actions,
    topAction: actions[0],
  };
}
