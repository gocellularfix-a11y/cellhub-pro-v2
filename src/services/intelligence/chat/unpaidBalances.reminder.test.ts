// ============================================================
// R-INTEL-V2-PHASE1 — AR collections "send reminder" behavior.
// Drives handleUnpaidBalances against a minimal engine stub and asserts the
// new reminder actions (WhatsApp reminder + Copy reminder), the deterministic
// EN/ES/PT reminder text, cents formatting, and that zero/terminal balances
// are still excluded. Also confirms unpaid_balances still routes correctly.
// ============================================================

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { handleUnpaidBalances, buildReminderMessage } from './unpaidBalances';
import { classifyIntent } from './intentRouter';
import { recordArReminder } from '../ar/arReminderStore';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer } from '@/store/types';

function makeEngine(over: Partial<Record<'repairs' | 'layaways' | 'specialOrders' | 'unlocks', any[]>>): IntelligenceEngine {
  return {
    getRepairs: () => over.repairs ?? [],
    getLayaways: () => over.layaways ?? [],
    getSpecialOrders: () => over.specialOrders ?? [],
    getUnlocks: () => over.unlocks ?? [],
  } as unknown as IntelligenceEngine;
}

const NO_CUSTOMERS: Customer[] = [];

// One repair, $45.00 owed (4500 cents), active status, has a phone.
const oneRepair = () =>
  makeEngine({
    repairs: [{
      id: 'r1', customerName: 'Ana Lopez', customerPhone: '8050001111',
      device: 'iPhone 12', balance: 4500, status: 'ready', createdAt: '2026-01-01',
    }],
  });

describe('handleUnpaidBalances — reminder actions', () => {
  it('adds both a WhatsApp reminder and a Copy reminder action per row', () => {
    const res = handleUnpaidBalances(oneRepair(), 'en');
    const targets = (res.actions ?? []).map((a) => (a.payload as any).executionTarget);
    expect(targets).toContain('open_repair');
    expect(targets).toContain('whatsapp_url');
    expect(targets).toContain('copy_to_clipboard');
  });

  it('WhatsApp reminder carries the deterministic message as customMessage', () => {
    const res = handleUnpaidBalances(oneRepair(), 'en');
    const wa = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'whatsapp_url');
    const msg = (wa!.payload as any).customMessage as string;
    expect(msg).toBeTruthy();
    expect(msg).toContain('Ana');           // greeting uses first name
    expect(msg).toContain('$45.00');        // integer cents → formatted
    expect(msg).toContain('repair');        // source type
  });

  it('reminder actions carry AR tracking metadata with integer-cents balance', () => {
    const res = handleUnpaidBalances(oneRepair(), 'en');
    for (const target of ['whatsapp_url', 'copy_to_clipboard']) {
      const act = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === target);
      const ar = (act!.payload as any).arReminder;
      expect(ar).toBeTruthy();
      expect(ar.entityType).toBe('repair');
      expect(ar.entityId).toBe('r1');
      expect(ar.balanceCents).toBe(4500);              // amount owed, as-is
      expect(Number.isInteger(ar.balanceCents)).toBe(true);
      expect(ar.language).toBe('en');
    }
  });

  it('Copy reminder carries the same message and needs no phone', () => {
    // Row with NO phone still gets a copy action (but no whatsapp action).
    const engine = makeEngine({
      unlocks: [{ id: 'u1', customerName: 'Beto', balance: 3000, status: 'pending', createdAt: '2026-01-01' }],
    });
    const res = handleUnpaidBalances(engine, 'en');
    const targets = (res.actions ?? []).map((a) => (a.payload as any).executionTarget);
    expect(targets).toContain('copy_to_clipboard');
    expect(targets).not.toContain('whatsapp_url'); // no phone → no WhatsApp
    const copy = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'copy_to_clipboard');
    expect((copy!.payload as any).customMessage).toContain('$30.00');
  });

  it('formats cents correctly for non-round amounts', () => {
    const engine = makeEngine({
      repairs: [{ id: 'r9', customerName: 'Cy', customerPhone: '8050009999', balance: 12399, status: 'ready', createdAt: '2026-01-01' }],
    });
    const res = handleUnpaidBalances(engine, 'en');
    const copy = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'copy_to_clipboard');
    expect((copy!.payload as any).customMessage).toContain('$123.99');
  });

  it('produces Spanish and Portuguese reminder text', () => {
    const es = (handleUnpaidBalances(oneRepair(), 'es').actions ?? [])
      .find((a) => (a.payload as any).executionTarget === 'copy_to_clipboard');
    expect((es!.payload as any).customMessage).toContain('saldo de');
    expect((es!.payload as any).customMessage).toContain('reparación');

    const pt = (handleUnpaidBalances(oneRepair(), 'pt').actions ?? [])
      .find((a) => (a.payload as any).executionTarget === 'copy_to_clipboard');
    expect((pt!.payload as any).customMessage).toContain('saldo de');
    expect((pt!.payload as any).customMessage).toContain('reparo');
  });

  it('still excludes zero-balance and terminal-status records (no actions)', () => {
    const engine = makeEngine({
      repairs: [
        { id: 'r1', customerName: 'Paid', balance: 0, status: 'completed', createdAt: '2026-01-01' },
        { id: 'r2', customerName: 'Void', balance: 5000, status: 'refunded', createdAt: '2026-01-01' },
      ],
    });
    const res = handleUnpaidBalances(engine, 'en');
    expect(res.text).toContain('No outstanding balances');
    expect(res.actions).toBeUndefined();
  });
});

describe('handleUnpaidBalances — collect payment handoff (Phase 2)', () => {
  // openTarget per entity type — the safe existing handoff Collect reuses.
  const cases: Array<[string, any, string]> = [
    ['repair',        { repairs:       [{ id: 'r1', customerName: 'Ana',  customerPhone: '8050001111', balance: 4500, status: 'ready',    createdAt: '2026-01-01' }] }, 'open_repair'],
    ['layaway',       { layaways:      [{ id: 'l1', customerName: 'Beto', customerPhone: '8050002222', balance: 9000, status: 'active',   createdAt: '2026-01-01' }] }, 'open_layaway'],
    ['unlock',        { unlocks:       [{ id: 'u1', customerName: 'Dani', customerPhone: '8050004444', balance: 1500, status: 'pending',  createdAt: '2026-01-01' }] }, 'open_unlock'],
    ['special_order', { specialOrders: [{ id: 'o1', customerName: 'Caro', balance: 5000, status: 'received', createdAt: '2026-01-01' }] }, 'open_special_order'],
  ];

  it.each(cases)('adds a Collect payment action for %s that reuses the open handoff', (_type, data, expectedTarget) => {
    const res = handleUnpaidBalances(makeEngine(data), 'en');
    const collect = (res.actions ?? []).find((a) => a.id.endsWith('-collect'));
    expect(collect).toBeTruthy();
    // Handoff only: navigates via the existing open_<entity> target, carrying id.
    expect((collect!.payload as any).executionTarget).toBe(expectedTarget);
    expect((collect!.payload as any).entityId).toBeTruthy();
    // It must NOT be a payment/transaction target — Intelligence never collects.
    expect((collect!.payload as any).executionTarget).not.toMatch(/pos|payment|charge|pay/i);
  });

  it('keeps the existing reminder actions alongside Collect payment', () => {
    const res = handleUnpaidBalances(oneRepair(), 'en');
    const ids = (res.actions ?? []).map((a) => a.id);
    // Collect payment (replaces the former neutral Open) + both reminders.
    expect(ids.some((i) => i.endsWith('-collect'))).toBe(true);
    expect(ids.some((i) => i.endsWith('-wa'))).toBe(true);
    expect(ids.some((i) => i.endsWith('-copy'))).toBe(true);
    // The former standalone "-open" action is now folded into Collect.
    expect(ids.some((i) => i.endsWith('-open'))).toBe(false);
  });

  it('adds no Collect action when there is nothing to collect (zero/terminal excluded)', () => {
    const engine = makeEngine({
      repairs: [{ id: 'r1', customerName: 'Paid', balance: 0, status: 'completed', createdAt: '2026-01-01' }],
    });
    const res = handleUnpaidBalances(engine, 'en');
    expect(res.actions).toBeUndefined();
  });
});

describe('unpaid_balances routing still resolves', () => {
  it('routes AR phrases to unpaid_balances (EN/ES/PT)', () => {
    expect(classifyIntent('who owes me money', NO_CUSTOMERS, 'en').id).toBe('unpaid_balances');
    expect(classifyIntent('saldos pendientes', NO_CUSTOMERS, 'es').id).toBe('unpaid_balances');
    expect(classifyIntent('contas a receber', NO_CUSTOMERS, 'pt').id).toBe('unpaid_balances');
  });
});

// ============================================================
// R-INTEL-V2-PHASE5 — attempt-aware reminder tone + follow-up section.
// ============================================================

// Structural stub matching the internal UnpaidRecord shape.
const recStub = () => ({
  id: 'r1',
  entityType: 'repair' as const,
  customerName: 'Ana Lopez',
  sourceLabelKey: 'chat.unpaidBalances.source.repair',
  balanceCents: 18000,
  lastActivityAt: null,
  openTarget: 'open_repair' as const,
});

describe('buildReminderMessage — attempt tones (Phase 5)', () => {
  it('attempt 1 (default) keeps the Phase 1 friendly text byte-identical', () => {
    const implicit = buildReminderMessage(recStub() as any, 'en');
    const explicit = buildReminderMessage(recStub() as any, 'en', 1);
    expect(implicit).toBe(explicit);
    expect(implicit).toContain('friendly reminder');
    expect(implicit).toContain('$180.00');
  });

  it('attempt 2 uses the firmer follow-up template (EN/ES/PT) with cents formatting', () => {
    const en = buildReminderMessage(recStub() as any, 'en', 2);
    expect(en).toContain('follow-up regarding');
    expect(en).toContain('$180.00');
    expect(en).toContain('repair');
    expect(en).not.toContain('friendly reminder');
    // Professional, not aggressive: no invented deadlines/fees/threats.
    expect(en).not.toMatch(/deadline|late fee|legal|collection agency/i);

    const es = buildReminderMessage(recStub() as any, 'es', 2);
    expect(es).toContain('seguimiento sobre el saldo pendiente');
    expect(es).toContain('$180.00');
    expect(es).toContain('reparación');

    const pt = buildReminderMessage(recStub() as any, 'pt', 2);
    expect(pt).toContain('acompanhamento sobre o saldo pendente');
    expect(pt).toContain('$180.00');
    expect(pt).toContain('reparo');
  });

  it('attempts beyond 2 keep using the firmer template deterministically', () => {
    expect(buildReminderMessage(recStub() as any, 'en', 3)).toBe(buildReminderMessage(recStub() as any, 'en', 2));
  });

  it('firmer template output stays BMP-safe (survives shell.openExternal)', () => {
    for (const lang of ['en', 'es', 'pt'] as const) {
      const msg = buildReminderMessage(recStub() as any, lang, 2);
      expect([...msg].every((c) => (c.codePointAt(0) ?? 0) <= 0xffff), lang).toBe(true);
    }
  });
});

describe('handleUnpaidBalances — follow-up section (Phase 5)', () => {
  const DAY_MS = 86_400_000;

  class MockLocalStorage {
    private store = new Map<string, string>();
    getItem(k: string): string | null { return this.store.has(k) ? (this.store.get(k) as string) : null; }
    setItem(k: string, v: string): void { this.store.set(k, String(v)); }
    removeItem(k: string): void { this.store.delete(k); }
    clear(): void { this.store.clear(); }
    key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
    get length(): number { return this.store.size; }
  }

  beforeEach(() => {
    (globalThis as any).localStorage = new MockLocalStorage();
  });
  afterAll(() => {
    delete (globalThis as any).localStorage;
  });

  const seedReminder = (ageDays: number, balanceCents: number) =>
    recordArReminder({
      type: 'ar_reminder_whatsapp_opened', channel: 'whatsapp',
      customerName: 'Ana Lopez', phone: '8050001111',
      entityType: 'repair', entityId: 'r1', balanceCents,
      language: 'en', messagePreview: 'preview',
      timestamp: Date.now() - ageDays * DAY_MS,
      source: 'unpaid_balances',
    });

  it('renders the follow-up section when a stale (8-day) reminder exists', () => {
    seedReminder(8, 4500);
    const res = handleUnpaidBalances(oneRepair(), 'en');
    expect(res.text).toContain('🔁 Follow up again');
    expect(res.text).toContain('reminded 8 days ago');
    expect(res.text).toContain('Ana Lopez — Repair: $45.00');
    // The stale row's reminder actions switch to the firmer attempt-2 tone.
    const wa = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'whatsapp_url');
    expect((wa!.payload as any).customMessage).toContain('follow-up regarding');
    // Same execution targets and ids as before — no new write path, no new targets.
    const targets = (res.actions ?? []).map((a) => (a.payload as any).executionTarget);
    expect(new Set(targets)).toEqual(new Set(['open_repair', 'whatsapp_url', 'copy_to_clipboard']));
    expect((res.actions ?? []).map((a) => a.id)).toEqual([
      'unpaid-repair-r1-collect', 'unpaid-repair-r1-wa', 'unpaid-repair-r1-copy',
    ]);
  });

  it('adds the partial note when the reminder snapshot is higher than the current balance', () => {
    seedReminder(9, 9000); // snapshot $90.00 > current $45.00
    const res = handleUnpaidBalances(oneRepair(), 'en');
    expect(res.text).toContain('balance decreased since last reminder');
  });

  it('does NOT render the section for a fresh (2-day) reminder', () => {
    seedReminder(2, 4500);
    const res = handleUnpaidBalances(oneRepair(), 'en');
    expect(res.text).not.toContain('Follow up again');
    // The light last-reminder note still shows, and the tone stays friendly.
    expect(res.text).toContain('Last reminder: 2 days ago');
    const wa = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'whatsapp_url');
    expect((wa!.payload as any).customMessage).toContain('friendly reminder');
  });

  it('output is unchanged when the reminder store is empty', () => {
    const res = handleUnpaidBalances(oneRepair(), 'en');
    expect(res.text).not.toContain('Follow up again');
    expect(res.text).not.toContain('reminded');
    const wa = (res.actions ?? []).find((a) => (a.payload as any).executionTarget === 'whatsapp_url');
    expect((wa!.payload as any).customMessage).toContain('friendly reminder');
    expect((res.actions ?? []).map((a) => a.id)).toEqual([
      'unpaid-repair-r1-collect', 'unpaid-repair-r1-wa', 'unpaid-repair-r1-copy',
    ]);
  });

  it('renders in Spanish and Portuguese', () => {
    seedReminder(10, 4500);
    const es = handleUnpaidBalances(oneRepair(), 'es');
    expect(es.text).toContain('🔁 Vuelve a dar seguimiento');
    expect(es.text).toContain('recordado hace 10 días');
    const pt = handleUnpaidBalances(oneRepair(), 'pt');
    expect(pt.text).toContain('🔁 Acompanhe novamente');
    expect(pt.text).toContain('lembrete há 10 dias');
  });
});
