// ============================================================
// R-INTELLIGENCE-OPERATIONAL-PHRASES-1 — operator-phrase routing.
// Locks: (a) common owner commands route to the intended EXISTING intent,
// (b) accounts-receivable phrases with no handler still fall back safely,
// (c) conversational filler stays blocked, (d) generic chatter does not
// false-positive into an operational intent.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent, correctOperatorTypos } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('operational phrase aliases → existing intents', () => {
  it('outreach/contact phrases route to who_to_contact', () => {
    expect(id('customers to call')).toBe('who_to_contact');
    expect(id('contact customer')).toBe('who_to_contact');
    expect(id('clientes para llamar', 'es')).toBe('who_to_contact');
    expect(id('contactar cliente', 'es')).toBe('who_to_contact');
  });

  it('appointment phrases route to data_query', () => {
    expect(id('show appointments')).toBe('data_query');
    expect(id("today's appointments")).toBe('data_query');
    expect(id('appointments today')).toBe('data_query');
    expect(id('citas de hoy', 'es')).toBe('data_query');
    expect(id('agendamentos de hoje', 'pt')).toBe('data_query');
  });

  it('open-entity commands route to entity_operational_command', () => {
    expect(id('open customer')).toBe('entity_operational_command');
    expect(id('open repair')).toBe('entity_operational_command');
    expect(id('abrir cliente', 'es')).toBe('entity_operational_command');
    expect(id('abrir reparación', 'es')).toBe('entity_operational_command');
  });
});

// R-INTELLIGENCE-UNPAID-BALANCES-V1 — the accounts-receivable handler now
// exists, so the phrases the prior round documented as "no handler" route to
// the new `unpaid_balances` intent. This is the deliberate redirect the old
// characterization test anticipated.
describe('accounts-receivable phrases route to unpaid_balances', () => {
  it('English AR phrases route to unpaid_balances', () => {
    for (const q of [
      'show unpaid', 'unpaid balances', 'who owes me money',
      'customers with balance', 'outstanding balances', 'who owes me',
    ]) {
      expect(id(q)).toBe('unpaid_balances');
    }
  });

  it('Spanish AR phrases route to unpaid_balances', () => {
    for (const q of [
      'quién me debe dinero', 'clientes con saldo', 'saldos pendientes', 'quien debe',
    ]) {
      expect(id(q, 'es')).toBe('unpaid_balances');
    }
  });

  it('Portuguese AR phrases route to unpaid_balances', () => {
    for (const q of ['contas em aberto', 'clientes com saldo', 'quem me deve']) {
      expect(id(q, 'pt')).toBe('unpaid_balances');
    }
  });

  it('beats the bare money/pending token catchers on raw score', () => {
    // Previously: 'who owes me money' → what_hurting_profit (bare 'money'),
    // 'pending payments' → repairs_overdue (bare 'pending'). Now redirected.
    expect(id('who owes me money')).toBe('unpaid_balances');
    expect(id('quién me debe dinero', 'es')).toBe('unpaid_balances');
    expect(id('pending payments')).toBe('unpaid_balances');
  });
});

describe('guards preserved', () => {
  it('conversational filler stays blocked', () => {
    for (const q of ['wow', 'interesting', 'thats crazy', 'tell me more', 'ok']) {
      expect(id(q)).toBe('fallback_question');
    }
  });

  it('generic chatter does not false-positive into an operational intent', () => {
    for (const q of ['i like this song', 'my cat is cute']) {
      expect(id(q)).toBe('fallback_question');
    }
  });
});

// R-INTELLIGENCE-ACTION-OPEN-ORDER-AND-TYPO-TOLERANCE-V1 — PART B
describe('operator-command typo tolerance', () => {
  it('a Spanish typo routes to the SAME intent as the clean command (not fallback)', () => {
    const clean = id('que hago ahora');
    expect(clean).not.toBe('fallback_question');
    expect(id('que hago ahorta')).toBe(clean);
    expect(id('que hago ahorta ?')).toBe(clean);
  });

  it('an English typo routes to the SAME intent as the clean command (not fallback)', () => {
    const clean = id('what should i do right now');
    expect(clean).not.toBe('fallback_question');
    expect(id('what shoud i do right now')).toBe(clean);
  });

  it('correctOperatorTypos rewrites only the controlled operator typos', () => {
    expect(correctOperatorTypos('que hago ahorta')).toBe('que hago ahora');
    expect(correctOperatorTypos('q hago ahora')).toBe('que hago ahora');
    expect(correctOperatorTypos('what shoud i do')).toBe('what should i do');
    expect(correctOperatorTypos('who shoud i contact today')).toBe('who should i contact today');
  });

  it('does NOT mutate phone / invoice / barcode / name-like strings', () => {
    for (const s of ['8051234567', 'inv-260601-1741-0838', 'daniel morales', 'ch-cust-00042', 'historial de juan']) {
      expect(correctOperatorTypos(s)).toBe(s);
    }
  });
});
