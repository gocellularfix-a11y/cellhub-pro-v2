// ============================================================
// R-INTELLIGENCE-OPERATOR-SESSIONS-V1
// Lightweight deterministic "active workflow session" tracking.
//
// This is NOT a second continuity system. It tracks ONLY which short-lived
// operational workflow the owner is currently working (derived from the
// executionTarget + entity of each executed action), so Intelligence can show a
// single subtle "continuing X workflow" hint. No actions, no ranking, no AI, no
// background jobs. Pure functions over a single in-memory session object owned
// by IntelligenceChat (max 1 active session for V1). Never stores profit/cost.
// ============================================================

import type { Repair, Customer, Layaway, Sale } from '@/store/types';

export type OperatorSessionType =
  | 'repair_collection'
  | 'layaway_collection'
  | 'vip_retention'
  | 'customer_reactivation'
  | 'inventory_push'
  | 'manager_queue'
  | 'generic_operator';

export interface OperatorSession {
  sessionId: string;
  type: OperatorSessionType;
  entityType?: string;
  entityId?: string;
  customerId?: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  lastExecutionTarget: string;
  stepCount: number;
  completed: boolean;
  hintShown: boolean;
}

export interface SessionEngine {
  getRepairs(): Repair[];
  getLayaways(): Layaway[];
  getCustomers(): Customer[];
  getSales(): Sale[];
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min of inactivity
const VIP_MIN_SPEND_CENTS = 15000;     // $150
const INACTIVE_DAYS = 30;
const TERMINAL_REPAIR = new Set(['picked_up', 'cancelled', 'closed', 'refunded']);
const TERMINAL_LAYAWAY = new Set(['completed', 'cancelled', 'forfeited']);

function tsOf(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  try {
    const x = v as { toDate?: () => Date };
    if (typeof x.toDate === 'function') return x.toDate().getTime();
    return new Date(v as string).getTime();
  } catch { return 0; }
}

function customerName(engine: SessionEngine, customerId?: string): string | undefined {
  if (!customerId) return undefined;
  return engine.getCustomers().find((c) => c.id === customerId)?.name;
}

function openBalanceRepair(engine: SessionEngine, customerId?: string): Repair | undefined {
  if (!customerId) return undefined;
  return engine.getRepairs().find((r) => {
    const st = String((r as any).status || '').toLowerCase();
    return r.customerId === customerId && !TERMINAL_REPAIR.has(st) && (r.balance ?? 0) > 0;
  });
}

function customerSpendAndIdle(engine: SessionEngine, customerId: string): { spend: number; days: number } {
  let spend = 0;
  let last = 0;
  for (const s of engine.getSales()) {
    if (s.customerId !== customerId) continue;
    const st = String((s as any).status || '').toLowerCase();
    if (st === 'voided' || st === 'refunded') continue;
    spend += (s as any).total ?? 0;
    const ts = tsOf((s as any).createdAt);
    if (ts > last) last = ts;
  }
  const days = last ? Math.floor((Date.now() - last) / 86_400_000) : 0;
  return { spend, days };
}

interface Classification {
  type: OperatorSessionType;
  entityType?: string;
  entityId?: string;
  customerId?: string;
  title: string;
}

// Deterministic executionTarget + entity → workflow classification.
function classify(
  executionTarget: string,
  payload: { entityId?: string; customerId?: string; customerName?: string; productId?: string; queueType?: string },
  engine: SessionEngine,
): Classification | null {
  const name = (cid?: string) => customerName(engine, cid) ?? payload.customerName;

  switch (executionTarget) {
    case 'open_repair': {
      const r = payload.entityId ? engine.getRepairs().find((x) => x.id === payload.entityId) : undefined;
      if (r && (r.balance ?? 0) > 0) {
        return { type: 'repair_collection', entityType: 'repair', entityId: r.id, customerId: r.customerId, title: name(r.customerId) ?? 'Repair' };
      }
      return { type: 'generic_operator', entityType: 'repair', entityId: payload.entityId, title: 'Repair' };
    }
    case 'open_layaway': {
      const l = payload.entityId ? engine.getLayaways().find((x) => x.id === payload.entityId) : undefined;
      if (l && (l.balance ?? 0) > 0) {
        const st = String((l as any).status || '').toLowerCase();
        if (!TERMINAL_LAYAWAY.has(st)) {
          return { type: 'layaway_collection', entityType: 'layaway', entityId: l.id, customerId: l.customerId, title: name(l.customerId) ?? 'Layaway' };
        }
      }
      return { type: 'generic_operator', entityType: 'layaway', entityId: payload.entityId, title: 'Layaway' };
    }
    case 'open_customer': {
      const cid = payload.entityId ?? payload.customerId;
      if (cid) {
        const { spend, days } = customerSpendAndIdle(engine, cid);
        if (spend >= VIP_MIN_SPEND_CENTS && days >= INACTIVE_DAYS) {
          return { type: 'vip_retention', entityType: 'customer', entityId: cid, customerId: cid, title: name(cid) ?? 'Customer' };
        }
        if (days >= INACTIVE_DAYS) {
          return { type: 'customer_reactivation', entityType: 'customer', entityId: cid, customerId: cid, title: name(cid) ?? 'Customer' };
        }
      }
      return { type: 'generic_operator', entityType: 'customer', entityId: cid, customerId: cid, title: name(cid) ?? 'Customer' };
    }
    case 'open_inventory':
    case 'pos_discount':
    case 'open_promote_panel': {
      const id = payload.entityId ?? payload.productId;
      return { type: 'inventory_push', entityType: 'inventory', entityId: id, title: 'Inventory' };
    }
    case 'queue_manager_review':
      return { type: 'manager_queue', title: 'Manager queue' };
    case 'whatsapp_url': {
      const cid = payload.customerId;
      const r = openBalanceRepair(engine, cid);
      if (r) return { type: 'repair_collection', entityType: 'repair', entityId: r.id, customerId: cid, title: name(cid) ?? 'Repair' };
      if (cid) return { type: 'customer_reactivation', entityType: 'customer', entityId: cid, customerId: cid, title: name(cid) ?? 'Customer' };
      return null;
    }
    case 'add_to_operator_queue': {
      const q = payload.queueType || '';
      const cid = payload.customerId ?? payload.entityId;
      if (q === 'repair_follow_up' || q === 'repair_escalate' || q === 'repair_waiting') {
        return { type: 'repair_collection', entityType: 'repair', entityId: payload.entityId, customerId: cid, title: name(cid) ?? 'Repair' };
      }
      if (q === 'vip_outreach') return { type: 'vip_retention', entityType: 'customer', entityId: cid, customerId: cid, title: name(cid) ?? 'Customer' };
      if (q === 'product_promotion') return { type: 'inventory_push', entityType: 'inventory', entityId: payload.entityId, title: 'Inventory' };
      return { type: 'customer_reactivation', entityType: 'customer', entityId: cid, customerId: cid, title: name(cid) ?? 'Customer' };
    }
    default:
      return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** True when the session is still within the inactivity window. */
export function getActiveOperatorSession(session: OperatorSession | null): OperatorSession | null {
  if (!session) return null;
  return Date.now() - session.updatedAt > SESSION_TTL_MS ? null : session;
}

/** Returns the session if active, else null (expired sessions are dropped). */
export function clearExpiredOperatorSession(session: OperatorSession | null): OperatorSession | null {
  return getActiveOperatorSession(session);
}

/**
 * Derive/advance the single active session from an executed action.
 *  - same workflow (same type + entityId) AND still active → update existing
 *    (stepCount + timestamps), preserving hintShown.
 *  - different workflow/entity → replace with a fresh session (hintShown=false).
 *  - action not mapped to a session → keep the existing active session unchanged.
 */
export function deriveOperatorSessionFromAction(
  executionTarget: string,
  payload: { entityId?: string; customerId?: string; customerName?: string; productId?: string; queueType?: string },
  engine: SessionEngine,
  existing: OperatorSession | null,
): OperatorSession | null {
  const active = getActiveOperatorSession(existing);
  const c = classify(executionTarget, payload, engine);
  if (!c) return active;

  const now = Date.now();
  if (active && active.type === c.type && active.entityId === c.entityId) {
    return updateOperatorSession(active, executionTarget);
  }
  return {
    sessionId: `os-${now}-${Math.abs((c.entityId ?? c.type).split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7))}`,
    type: c.type,
    entityType: c.entityType,
    entityId: c.entityId,
    customerId: c.customerId,
    title: c.title,
    startedAt: now,
    updatedAt: now,
    lastExecutionTarget: executionTarget,
    stepCount: 1,
    completed: false,
    hintShown: false,
  };
}

/** Advance an existing session for a continuing step (same workflow). */
export function updateOperatorSession(session: OperatorSession, executionTarget: string): OperatorSession {
  return {
    ...session,
    updatedAt: Date.now(),
    lastExecutionTarget: executionTarget,
    stepCount: session.stepCount + 1,
  };
}

/** Hint shows once per session, and never for the generic catch-all. */
export function shouldShowSessionHint(session: OperatorSession | null): boolean {
  return !!session && !session.hintShown && session.type !== 'generic_operator';
}

/** i18n key for the session's one-line awareness hint. */
export function sessionHintKey(type: OperatorSessionType): string {
  return `chat.session.hint.${type}`;
}
