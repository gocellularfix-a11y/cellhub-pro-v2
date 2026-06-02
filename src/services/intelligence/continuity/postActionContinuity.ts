// ============================================================
// R-INTELLIGENCE-OPERATOR-CONTINUITY-V2
// Deterministic post-action continuity resolver.
//
// After an Intelligence action executes (open_repair, whatsapp_url, …) this maps
// the executionTarget + the action's entity to AT MOST 3 next-step suggestions,
// reusing the SAME ChatActionUI shape + existing executionTargets. Pure, no AI,
// no embeddings, no state, no side effects — it only READS engine arrays and
// returns a suggestion object (the caller pushes it + owns cooldown/loop guards).
//
// Rules honored:
//  - only suggestions whose entity actually exists (no fake/dead actions)
//  - only EXISTING executable targets (no invented "snooze"/"view similar")
//  - max 3 actions; never exposes profit/cost/margin
// ============================================================

import type { Repair, Customer, InventoryItem, Layaway, Sale } from '@/store/types';
import type { ChatActionUI } from '../chat/handlers';

export interface ContinuityEngine {
  getRepairs(): Repair[];
  getCustomers(): Customer[];
  getInventory(): InventoryItem[];
  getLayaways(): Layaway[];
  getSales(): Sale[];
}

type T = (key: string, ...args: any[]) => string;

export interface ContinuitySuggestion {
  text: string;
  actions: ChatActionUI[];
}

const TERMINAL_REPAIR = new Set(['picked_up', 'cancelled', 'closed', 'refunded']);
const DAY_MS = 86_400_000;

function tsOf(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  try {
    const v = value as { toDate?: () => Date };
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    return new Date(value as string).getTime();
  } catch { return 0; }
}

function contactOf(engine: ContinuityEngine, customerId?: string): { id?: string; name?: string; phone: string } {
  if (!customerId) return { phone: '' };
  const c = engine.getCustomers().find((x) => x.id === customerId);
  return { id: customerId, name: c?.name, phone: ((c as any)?.phone ?? '') as string };
}

// Newest open repair (balance > 0) for a customer — used to chain "Open Repair"
// after a contact action.
function openBalanceRepair(engine: ContinuityEngine, customerId?: string): Repair | undefined {
  if (!customerId) return undefined;
  return engine.getRepairs().find((r) => {
    const status = String((r as any).status || '').toLowerCase();
    return r.customerId === customerId && !TERMINAL_REPAIR.has(status) && (r.balance ?? 0) > 0;
  });
}

function daysInactive(engine: ContinuityEngine, customerId?: string): number {
  if (!customerId) return 0;
  let last = 0;
  for (const s of engine.getSales()) {
    if (s.customerId !== customerId) continue;
    const st = String((s as any).status || '').toLowerCase();
    if (st === 'voided' || st === 'refunded') continue;
    const ts = tsOf((s as any).createdAt);
    if (ts > last) last = ts;
  }
  if (!last) return 0;
  return Math.floor((Date.now() - last) / DAY_MS);
}

// ── Action builders (reuse existing executionTargets only) ───────────────────

function waBtn(t: T, c: { id?: string; name?: string; phone: string }): ChatActionUI | null {
  if (!c.phone || !c.name) return null;
  return {
    id: `wa-${c.id ?? c.phone}`,
    label: t('chat.continuity.reconnect', c.name),
    actionType: 'whatsapp',
    payload: {
      type: 'whatsapp', messageKey: 'whatsapp.template.reconnect',
      customerId: c.id, customerName: c.name, customerPhone: c.phone,
      executable: true, executionTarget: 'whatsapp_url',
    },
  };
}

function openRepairBtn(t: T, repairId: string): ChatActionUI {
  return {
    id: `or-${repairId}`, label: t('chat.followup.openRepairLabel'), actionType: 'review',
    payload: { type: 'review', entityId: repairId, executable: true, executionTarget: 'open_repair' },
  };
}

function openCustomerBtn(t: T, customerId: string, name?: string): ChatActionUI {
  return {
    id: `oc-${customerId}`, label: t('chat.continuity.viewHistory'), actionType: 'review',
    payload: { type: 'review', entityId: customerId, customerId, customerName: name, executable: true, executionTarget: 'open_customer' },
  };
}

function followUpBtn(t: T, queueType: string, entityId: string | undefined, name: string | undefined): ChatActionUI {
  return {
    id: `fu-${queueType}-${entityId ?? name ?? 'x'}`,
    label: t(queueType === 'repair_followup' ? 'chat.continuity.markFollowUp' : 'chat.continuity.addReminder'),
    actionType: 'review',
    payload: {
      type: 'reminder', queueType, customerName: name, entityId,
      queueSummary: name, executable: true, executionTarget: 'add_to_operator_queue',
    },
  };
}

// ── Resolver ─────────────────────────────────────────────────────────────────

export function resolvePostActionContinuity(
  executionTarget: string,
  payload: { entityId?: string; customerId?: string; customerName?: string; customerPhone?: string; productId?: string; sku?: string },
  engine: ContinuityEngine,
  t: T,
): ContinuitySuggestion | null {
  const push = (text: string, actions: (ChatActionUI | null)[]): ContinuitySuggestion | null => {
    const real = actions.filter((a): a is ChatActionUI => a !== null).slice(0, 3);
    return real.length > 0 ? { text, actions: real } : null;
  };

  switch (executionTarget) {
    case 'open_repair': {
      const repair = payload.entityId ? engine.getRepairs().find((r) => r.id === payload.entityId) : undefined;
      const c = contactOf(engine, repair?.customerId);
      const pending = (repair?.balance ?? 0) > 0;
      return push(t(pending ? 'chat.continuity.repairPending' : 'chat.continuity.repairOpen'), [
        followUpBtn(t, 'repair_followup', payload.entityId, c.name ?? payload.customerName),
        waBtn(t, c.name ? c : { id: payload.customerId, name: payload.customerName, phone: payload.customerPhone ?? '' }),
        repair?.customerId ? openCustomerBtn(t, repair.customerId, c.name) : null,
      ]);
    }

    case 'open_customer': {
      const cid = payload.entityId ?? payload.customerId;
      const c = contactOf(engine, cid);
      const days = daysInactive(engine, cid);
      const text = days >= 30
        ? t('chat.continuity.customerInactive', String(days))
        : t('chat.continuity.customerOpen');
      return push(text, [
        waBtn(t, c.name ? c : { id: cid, name: payload.customerName, phone: payload.customerPhone ?? '' }),
        followUpBtn(t, 'recover_customer', cid, c.name ?? payload.customerName),
      ]);
    }

    case 'open_inventory': {
      const id = payload.entityId ?? payload.productId;
      const item = id ? engine.getInventory().find((i) => i.id === id) : undefined;
      if (!item) return null;
      const discountBtn: ChatActionUI | null = item.sku
        ? { id: `dc-${item.id}`, label: t('chat.continuity.discountItem'), actionType: 'discount',
            payload: { type: 'discount', sku: item.sku, productId: item.id, productName: item.name, executable: true, executionTarget: 'pos_discount' } }
        : null;
      const promoteBtn: ChatActionUI = {
        id: `pp-${item.id}`, label: t('chat.continuity.promoteItem'), actionType: 'review',
        payload: { type: 'promote_product', productId: item.id, productName: item.name, executable: true, executionTarget: 'open_promote_panel' },
      };
      return push(t('chat.continuity.itemLowMovement'), [discountBtn, promoteBtn]);
    }

    case 'open_layaway': {
      const c = contactOf(engine, payload.customerId);
      return push(t('chat.continuity.layawayPending'), [
        waBtn(t, c.name ? c : { id: payload.customerId, name: payload.customerName, phone: payload.customerPhone ?? '' }),
        followUpBtn(t, 'recover_customer', payload.customerId, c.name ?? payload.customerName),
      ]);
    }

    case 'whatsapp_url': {
      // After contacting a customer: chain to the unpaid repair (if any),
      // a reminder, and their history.
      const cid = payload.customerId;
      const repair = openBalanceRepair(engine, cid);
      const c = contactOf(engine, cid);
      const text = repair ? t('chat.continuity.repairPending') : t('chat.continuity.afterContact');
      return push(text, [
        repair ? openRepairBtn(t, repair.id) : null,
        followUpBtn(t, 'recover_customer', cid, c.name ?? payload.customerName),
        cid ? openCustomerBtn(t, cid, c.name ?? payload.customerName) : null,
      ]);
    }

    // No useful deterministic continuity for these — return nothing (avoid loops/spam).
    default:
      return null;
  }
}
