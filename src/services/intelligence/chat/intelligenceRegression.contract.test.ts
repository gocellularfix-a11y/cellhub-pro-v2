// ============================================================
// R-INTELLIGENCE-REGRESSION-GUARD-V1 — intent contract + smoke tests.
//
// Locks the CURRENT, working routing of core operator prompts so future
// intent/keyword/typo changes can't silently regress them. Every expected
// value below was captured EMPIRICALLY from the live classifyIntent /
// isFollowUpQuery pipeline (not assumed) — if one of these flips, a real
// behavior changed and the diff must justify it.
//
// Pure routing layer: no engine, no store writes, no money/tax involved.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  classifyIntent,
  isFollowUpQuery,
  isConversationalFiller,
  correctOperatorTypos,
} from './intentRouter';
import type { Customer } from '@/store/types';

// A populated store so "name-like" phrases have a real customer to (not) hijack.
const CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Daniel Morales', phone: '8051234567' } as Customer,
];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') =>
  classifyIntent(q, CUSTOMERS, lang).id;

// Business-analytics / action intents a stray name or typo must NEVER hijack.
const BUSINESS_INTENTS = [
  'proactive_operations', 'recommended_next_best_action', 'daily_operator_brief',
  'sales_summary', 'today_summary', 'best_customer', 'what_hurting_profit',
  'who_to_contact', 'inventory_low', 'repairs_overdue',
];

// ── TASK 3 — intent contract (locks real, working routing) ──
describe('R-REGRESSION: intent contract (empirically captured)', () => {
  const CONTRACT: Array<[string, 'en' | 'es' | 'pt', string]> = [
    // R-INTELLIGENCE-PHRASE-CONSOLIDATION-V1: explicit, stable semantic split —
    //   now / right now / ahora / "what should I do"  → recommended_next_best_action
    //   today / status today                          → daily_operator_brief
    //   priorities / biggest problem                  → proactive_operations
    ['what should i do now',       'en', 'recommended_next_best_action'],
    ['what should i do right now', 'en', 'recommended_next_best_action'],
    ['que hago ahora',             'es', 'recommended_next_best_action'],
    ['qué hago ahora',             'es', 'recommended_next_best_action'],
    // R-INTELLIGENCE-RUNTIME-POLISH-V1: MX-colloquial "ahorita" + typo "ahorta"
    // normalize to "ahora" → same immediate-action handler.
    ['que hago ahorita',           'es', 'recommended_next_best_action'],
    ['que hago ahorta',            'es', 'recommended_next_best_action'],
    // CHAT-R1.4: exact I4 manager phrase — manager-owned via data_query (was daily_operator_brief).
    ['what should i do today',     'en', 'data_query'],
    ['what are my priorities',     'en', 'proactive_operations'],
    // CHAT-R1.4: exact I4 manager phrase — manager-owned via data_query (was proactive_operations).
    ['what is my biggest problem', 'en', 'data_query'],
    // best customer
    ['mi mejor cliente',           'es', 'best_customer'],
    ['my best customer',           'en', 'best_customer'],
    // explicit open-entity command
    ['open order',                 'en', 'entity_operational_command'],
  ];

  for (const [q, lang, expected] of CONTRACT) {
    it(`"${q}" [${lang}] => ${expected}`, () => {
      expect(id(q, lang)).toBe(expected);
    });
  }
});

// ── TASK 1 #1-3 — core prompts resolve to a real handler (never fallback) ──
describe('R-REGRESSION: core prompts never collapse to fallback', () => {
  it('"what should I do now" resolves to an operational handler', () => {
    expect(id('what should i do now')).not.toBe('fallback_question');
  });
  it('"que hago ahora" resolves to an operational handler', () => {
    expect(id('que hago ahora', 'es')).not.toBe('fallback_question');
  });
  it('"open order" resolves to the entity command handler', () => {
    expect(id('open order')).toBe('entity_operational_command');
  });
});

// ── TASK 1 #4-6 — follow-up phrases are recognized as follow-ups ──
// "contact him" / "why" / "show more" / "open it" must be detected by the
// follow-up layer (re-using prior context) rather than mis-routing as a fresh
// business query. classifyIntent is NOT the right gate for these — the chat
// shell checks isFollowUpQuery first.
describe('R-REGRESSION: follow-up phrases are detected by the follow-up gate', () => {
  for (const q of ['contact him', 'why', 'show more', 'open it', 'what should i do', 'que hago']) {
    it(`"${q}" is a follow-up phrase`, () => {
      expect(isFollowUpQuery(q)).toBe(true);
    });
  }
  it('a real business query is NOT treated as a follow-up', () => {
    expect(isFollowUpQuery('what should i do now')).toBe(false);
    expect(isFollowUpQuery('mi mejor cliente')).toBe(false);
  });
});

// ── TASK 1 #7 — typo tolerance is SAFE (controlled dictionary only) ──
describe('R-REGRESSION: typos never mis-route to a wrong business intent', () => {
  // Uncontrolled typos are intentionally NOT auto-corrected (the dictionary is
  // tight to avoid mangling names/phones/invoices). They land on the safe
  // fallback handler — NOT on a wrong operational intent.
  for (const q of ['opne order', 'custmer', 'repiar']) {
    it(`"${q}" falls back safely (no business-intent hijack)`, () => {
      const got = id(q);
      expect(got).toBe('fallback_question');
      expect(BUSINESS_INTENTS).not.toContain(got);
    });
  }

  // The CONTROLLED operator typos that ARE in the dictionary still route to the
  // same intent as the clean command (locks the tolerance that already works).
  it('controlled typo "que hago ahorta" routes like the clean command', () => {
    expect(correctOperatorTypos('que hago ahorta')).toBe('que hago ahora');
    expect(id('que hago ahorta', 'es')).toBe(id('que hago ahora', 'es'));
  });
  // R-INTELLIGENCE-RUNTIME-POLISH-V1: ahorita / q hago / ke hago normalization.
  it('"ahorita" / "q hago" / "ke hago" normalize to the canonical command', () => {
    expect(correctOperatorTypos('que hago ahorita')).toBe('que hago ahora');
    expect(correctOperatorTypos('q hago ahora')).toBe('que hago ahora');
    expect(correctOperatorTypos('ke hago ahora')).toBe('que hago ahora');
    expect(id('que hago ahorita', 'es')).toBe(id('que hago ahora', 'es'));
  });
  it('controlled typo "what shoud i do right now" is not fallback', () => {
    expect(id('what shoud i do right now')).not.toBe('fallback_question');
  });
});

// ── TASK 1 #8 — a bare customer name must not hijack a business intent ──
describe('R-REGRESSION: name-like phrase does not hijack business intents', () => {
  it('"daniel morales" does not route to a business-analytics intent', () => {
    const got = id('daniel morales');
    expect(BUSINESS_INTENTS).not.toContain(got);
    // Current safe behavior: a bare name with no command verb falls back.
    expect(got).toBe('fallback_question');
  });
});

// ── guards preserved (conversational filler still blocked) ──
describe('R-REGRESSION: conversational filler stays blocked', () => {
  for (const q of ['wow', 'ok', 'tell me more', 'interesting']) {
    it(`"${q}" is conversational filler`, () => {
      expect(isConversationalFiller(q)).toBe(true);
    });
  }
});
