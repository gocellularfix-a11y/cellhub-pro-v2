// ============================================================
// CellHub Intelligence — Unpaid Balances / Accounts Receivable
// R-INTELLIGENCE-UNPAID-BALANCES-V1
//
// Deterministic accounts-receivable view. Aggregates outstanding
// balances (money still owed) across the four deposit-bearing domains
// — repairs, layaways, special orders, unlocks — and returns a concise
// list sorted by highest balance first, with executable buttons to open
// the real entity or WhatsApp the customer.
//
// NO LLM, NO embeddings, NO randomness. Pure reads + integer (cents) math.
// No financial logic changes: balances are read as-is from the store,
// never recalculated. Tax math is untouched.
//
// Additive: this module owns the aggregation; handlers.ts only dispatches
// to handleUnpaidBalances via the new `unpaid_balances` intent. No existing
// intent/handler/engine method is modified.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Repair, Layaway, SpecialOrder, Unlock } from '@/store/types';
import { tChat, COP, type Lang3, type ChatResponse, type ChatActionUI } from './handlers';
// R-INTEL-V2-PHASE1: reuse the canonical BMP sanitizer so the reminder text
// survives Electron's shell.openExternal on Windows (same as Payment Date
// Finder's outreach builder).
import { sanitizeToBMP } from '@/services/whatsapp';

// ── Config ────────────────────────────────────────────────

const MAX_RESULTS = 8;       // operational list stays scannable (spec: 5–10)
const MAX_ACTIONS = 10;      // mirror the who-needs-attention action cap

// Statuses that mean the balance is no longer collectible (do not show).
const TERMINAL_STATUSES = new Set([
  'cancelled', 'canceled', 'refunded', 'forfeited', 'voided',
]);

type UnpaidEntityType = 'repair' | 'layaway' | 'special_order' | 'unlock';

interface UnpaidRecord {
  id: string;
  entityType: UnpaidEntityType;
  customerId?: string;
  customerName: string;
  phone?: string;
  /** i18n key for the human-readable source label (repair / layaway / …). */
  sourceLabelKey: string;
  balanceCents: number;
  lastActivityAt: number | null;
  /** executionTarget used by the "open entity" button. */
  openTarget: 'open_repair' | 'open_layaway' | 'open_special_order' | 'open_unlock';
}

// ── Helpers (mirror whoNeedsAttentionToday for consistency) ──

function tsOf(d: unknown): number | null {
  if (!d) return null;
  if (typeof d === 'string') { const n = new Date(d).getTime(); return Number.isFinite(n) ? n : null; }
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'object' && d !== null) {
    const obj = d as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') { try { return obj.toDate().getTime(); } catch { return null; } }
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return null;
}

function statusKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '_');
}

function isCollectible(status: unknown, balanceCents: number): boolean {
  if (!Number.isFinite(balanceCents) || balanceCents <= 0) return false;
  return !TERMINAL_STATUSES.has(statusKey(status));
}

// ── Collectors ────────────────────────────────────────────

function collect(engine: IntelligenceEngine): UnpaidRecord[] {
  const out: UnpaidRecord[] = [];

  const repairs: Repair[] = engine.getRepairs() || [];
  for (const r of repairs) {
    const balance = Math.max(0, r.balance || 0);
    if (!isCollectible(r.status, balance)) continue;
    out.push({
      id: r.id,
      entityType: 'repair',
      customerId: r.customerId,
      customerName: r.customerName || r.device || r.id.slice(-6),
      phone: r.customerPhone,
      sourceLabelKey: 'chat.unpaidBalances.source.repair',
      balanceCents: balance,
      lastActivityAt: tsOf(r.updatedAt) || tsOf(r.createdAt),
      openTarget: 'open_repair',
    });
  }

  const layaways: Layaway[] = engine.getLayaways() || [];
  for (const l of layaways) {
    const balance = Math.max(0, l.balance || 0);
    if (!isCollectible(l.status, balance)) continue;
    out.push({
      id: l.id,
      entityType: 'layaway',
      customerId: l.customerId,
      customerName: l.customerName || l.id.slice(-6),
      phone: l.customerPhone,
      sourceLabelKey: 'chat.unpaidBalances.source.layaway',
      balanceCents: balance,
      lastActivityAt: tsOf(l.updatedAt) || tsOf(l.createdAt),
      openTarget: 'open_layaway',
    });
  }

  const sos: SpecialOrder[] = engine.getSpecialOrders() || [];
  for (const o of sos) {
    const balance = Math.max(0, o.balance || 0);
    if (!isCollectible(o.status, balance)) continue;
    out.push({
      id: o.id,
      entityType: 'special_order',
      customerId: o.customerId,
      customerName: o.customerName || o.itemDescription || o.id.slice(-6),
      phone: o.customerPhone,
      sourceLabelKey: 'chat.unpaidBalances.source.specialOrder',
      balanceCents: balance,
      lastActivityAt: tsOf(o.updatedAt) || tsOf(o.createdAt),
      openTarget: 'open_special_order',
    });
  }

  const unlocks: Unlock[] = engine.getUnlocks() || [];
  for (const u of unlocks) {
    const balance = Math.max(0, u.balance || 0);
    if (!isCollectible(u.status, balance)) continue;
    out.push({
      id: u.id,
      entityType: 'unlock',
      customerId: u.customerId,
      customerName: u.customerName || u.device || u.id.slice(-6),
      phone: u.customerPhone,
      sourceLabelKey: 'chat.unpaidBalances.source.unlock',
      balanceCents: balance,
      lastActivityAt: tsOf(u.updatedAt) || tsOf(u.createdAt),
      openTarget: 'open_unlock',
    });
  }

  return out;
}

// ── Reminder message builder ──────────────────────────────
// R-INTEL-V2-PHASE1. Mirrors the Payment Date Finder outreach pattern
// (per-language fragments, first-name greeting, sanitizeToBMP) but is the
// accounts-receivable variant: it states the amount OWED + source and asks
// the customer to come pay. Deterministic (same inputs → same text), NO LLM.
// Money is integer cents in → formatted once via COP; the stored balance is
// read as-is and NEVER recalculated. Store name is not available on this
// chat path, so the message is store-agnostic (see round report).

const REMINDER_SOURCE_NOUN: Record<UnpaidEntityType, Record<Lang3, string>> = {
  repair:        { en: 'repair',        es: 'reparación',      pt: 'reparo' },
  layaway:       { en: 'layaway',       es: 'apartado',        pt: 'layaway' },
  special_order: { en: 'special order', es: 'pedido especial', pt: 'pedido especial' },
  unlock:        { en: 'unlock',        es: 'desbloqueo',      pt: 'desbloqueio' },
};

// Single friendly tone (Phase 1). Spanish uses tuteo (no voseo).
const REMINDER_TEMPLATE: Record<Lang3, (name: string, amount: string, source: string) => string> = {
  en: (name, amount, source) =>
    `${name ? `Hi ${name}!` : 'Hi!'}\n\n` +
    `This is a friendly reminder that you have a balance of ${amount} on your ${source}. ` +
    `Whenever you're ready, stop by and we'll be happy to help you take care of it.\n\n` +
    `Thank you!`,
  es: (name, amount, source) =>
    `${name ? `¡Hola ${name}!` : '¡Hola!'}\n\n` +
    `Este es un recordatorio amable de que tienes un saldo de ${amount} en tu ${source}. ` +
    `Cuando gustes, pásate y con gusto te ayudamos a liquidarlo.\n\n` +
    `¡Gracias!`,
  pt: (name, amount, source) =>
    `${name ? `Oi ${name}!` : 'Oi!'}\n\n` +
    `Este é um lembrete amigável de que você tem um saldo de ${amount} no seu ${source}. ` +
    `Quando puder, passe aqui e teremos prazer em ajudá-lo a quitar.\n\n` +
    `Obrigado!`,
};

/**
 * Build a ready-to-edit reminder message for one unpaid record. Pure and
 * deterministic. The greeting uses the first name token; a device/id fallback
 * "name" (no real name on the record) degrades to a generic greeting rather
 * than addressing the customer by an id fragment.
 */
export function buildReminderMessage(rec: UnpaidRecord, lang: Lang3): string {
  const l: Lang3 = lang === 'es' || lang === 'pt' ? lang : 'en';
  const firstToken = String(rec.customerName || '').trim().split(/\s+/)[0] || '';
  // Suppress an id-fragment fallback (e.g. the last-6 of an entity id) so the
  // greeting never reads "Hi a1b2c3!". Real names pass through untouched.
  const name = firstToken && !/^[0-9a-f]{6}$/i.test(firstToken) ? firstToken : '';
  const amount = COP(rec.balanceCents);                    // integer cents → "$45.00"
  const source = REMINDER_SOURCE_NOUN[rec.entityType][l];
  return sanitizeToBMP(REMINDER_TEMPLATE[l](name, amount, source)).trim();
}

// ── Action builder ────────────────────────────────────────

function actionsFor(rec: UnpaidRecord, t: ReturnType<typeof tChat>, lang: Lang3): ChatActionUI[] {
  const acts: ChatActionUI[] = [];
  const base = `unpaid-${rec.entityType}-${rec.id}`;
  const reminder = buildReminderMessage(rec, lang);
  // Open the real entity by id (never a blank/new modal — guarded downstream
  // by executeActionPayload, which no-ops on a missing entityId).
  acts.push({
    id: `${base}-open`,
    label: t(`chat.unpaidBalances.action.open.${rec.entityType}`),
    payload: { type: 'review', entityId: rec.id, executable: true, executionTarget: rec.openTarget },
  });
  if (rec.phone) {
    // WhatsApp reminder: opens WhatsApp with the deterministic AR reminder as
    // the prefilled text (customMessage). Reuses the existing whatsapp_url
    // modal + Phase 0 popup-block guard — a blocked open records nothing.
    acts.push({
      id: `${base}-wa`,
      label: t('chat.unpaidBalances.action.whatsapp'),
      actionType: 'whatsapp',
      payload: { type: 'whatsapp', customerPhone: rec.phone, customMessage: reminder, executable: true, executionTarget: 'whatsapp_url' },
    });
  }
  // Copy reminder: clipboard only — no phone required, no side effects, no
  // outreach recorded. Always offered so rows without a phone still get a
  // usable reminder.
  acts.push({
    id: `${base}-copy`,
    label: t('chat.unpaidBalances.action.copyReminder'),
    payload: { type: 'reminder', customMessage: reminder, executable: true, executionTarget: 'copy_to_clipboard' },
  });
  return acts;
}

// ── Public entry point ────────────────────────────────────

/**
 * R-INTELLIGENCE-UNPAID-BALANCES-V1
 *
 * Deterministic accounts-receivable list. Every row references a real entity
 * id and its stored balance — no fabrication, no recalculation. Sorted by
 * highest balance first; ties broken by oldest activity (most overdue) then
 * entity id for stable ordering. Same inputs → same output.
 */
export function handleUnpaidBalances(engine: IntelligenceEngine, lang: Lang3): ChatResponse {
  const t = tChat(lang);

  const all = collect(engine);

  // Dedupe defensively by (entityType:id). Distinct records for the same
  // customer survive — they are genuinely different unpaid records.
  const seen = new Set<string>();
  const records = all.filter((r) => {
    const k = `${r.entityType}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (records.length === 0) {
    return {
      kind: 'answer',
      text: `${t('chat.unpaidBalances.header')}\n\n${t('chat.unpaidBalances.empty')}`,
    };
  }

  records.sort((a, b) => {
    if (b.balanceCents !== a.balanceCents) return b.balanceCents - a.balanceCents;
    const at = a.lastActivityAt ?? Number.MAX_SAFE_INTEGER;
    const bt = b.lastActivityAt ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt; // older (smaller ts) = more overdue, ranks first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Total across ALL collectible records (not just the shown top-N).
  const totalCents = records.reduce((s, r) => s + r.balanceCents, 0);
  const shown = records.slice(0, MAX_RESULTS);

  const lines: string[] = [
    t('chat.unpaidBalances.header'),
    '',
    t('chat.unpaidBalances.total', records.length, COP(totalCents)),
    '',
  ];
  for (let i = 0; i < shown.length; i++) {
    const r = shown[i];
    lines.push(
      `${i + 1}. ${r.customerName} — ${t(r.sourceLabelKey)}: ${COP(r.balanceCents)}`,
    );
  }
  lines.push('');
  lines.push(`💡 ${t('chat.unpaidBalances.nextAction')}`);

  const rawActions: ChatActionUI[] = [];
  for (const r of shown) {
    for (const a of actionsFor(r, t, lang)) rawActions.push(a);
  }

  // Continuity: anchor on the top (highest-balance) record's customer so
  // "contact him" / "open it" follow-ups resolve through the existing
  // context-aware pipeline. Repairs anchor on the repair id (the follow-up
  // handler validates the ref before reuse).
  const top = shown[0];
  const ctxType: 'customer' | 'repair' = top.entityType === 'repair' ? 'repair' : 'customer';
  const ctxValue = top.entityType === 'repair' ? top.id : (top.customerId || '');

  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(rawActions.length > 0 ? { actions: rawActions.slice(0, MAX_ACTIONS) } : {}),
    ...(ctxValue ? { establishesContext: { type: ctxType, value: ctxValue } } : {}),
  };
}
