// ============================================================
// R-INTELLIGENCE-STABILIZE-1 T5 — routing stability characterization.
// Locks: (a) conversational filler never triggers an operational intent,
// (b) the filler guard matches whole phrases only (never substrings),
// (c) explicit operational phrases are NOT swallowed by the guard.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent, isConversationalFiller } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];

describe('routing stability guard (T3)', () => {
  it('conversational filler downgrades to the safe fallback, never an action', () => {
    const filler = ['wow', 'interesting', 'thats crazy', "that's crazy", 'tell me more', 'nice', 'cool', 'ok'];
    for (const f of filler) {
      const m = classifyIntent(f, NO_CUSTOMERS, 'en');
      expect(m.id).toBe('fallback_question');
      expect(m.confidence).toBe(0);
    }
  });

  it('the filler guard matches exact normalized phrases only — not substrings', () => {
    expect(isConversationalFiller('interesting')).toBe(true);
    // "interesting customers" must NOT be treated as filler — it can route normally.
    expect(isConversationalFiller('interesting customers')).toBe(false);
    expect(isConversationalFiller('wow that customer spent a lot')).toBe(false);
  });

  it('verified explicit operational phrases still resolve (not blocked)', () => {
    // Only assert on phrases confirmed present in the keyword banks so the test
    // characterizes real router behavior rather than an assumption.
    const bestCustomer = classifyIntent('best customer', NO_CUSTOMERS, 'en');
    expect(bestCustomer.id).not.toBe('fallback_question');
    expect(bestCustomer.confidence).toBeGreaterThan(0);

    const openRepair = classifyIntent('open repair', NO_CUSTOMERS, 'en');
    expect(openRepair.id).not.toBe('fallback_question');
    expect(openRepair.confidence).toBeGreaterThan(0);
  });

  it('the filler guard does not classify operational phrases as filler', () => {
    for (const q of ['open repair', 'contact customer', 'show unpaid', 'best customer']) {
      expect(isConversationalFiller(q)).toBe(false);
    }
  });
});
