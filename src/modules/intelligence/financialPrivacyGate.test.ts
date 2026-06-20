// ============================================================
// R-FINANCIAL-PRIVACY-V5 (audit Priority B, Tier 1)
//
// Locks the chat profit-intent gate for the two leaks confirmed by the
// role-aware financial-visibility audit:
//   - restock_opportunity   (emits per-item margin $ + margin %)
//   - product_opportunities (emits HIGH/LOW margin + profit upside)
//
// The gate lives inline in IntelligenceChat.tsx (fireQuery + onSubmit) as
//   if (!canSeeOwnerFinancials && PROFIT_SENSITIVE_INTENTS.has(match.id)) { redact }
// The set is not exported, so this suite proves the gate in three layers:
//   1. SOURCE   — both intent ids are present in BOTH PROFIT_SENSITIVE_INTENTS
//                 declarations in the production file (regression guard that
//                 fails if either dispatch site loses the ids).
//   2. DECISION — canViewOwnerFinancials() returns the right boolean for
//                 employee / owner / privacy-off / settings-null (real helper).
//   3. COMPOSED — source-derived gated set + real helper = exact runtime
//                 predicate: employee blocked, owner allowed, off/null preserved.
//
// NOTE: intent ROUTING (which phrases reach these ids) is intentionally NOT
// asserted here — classifyIntent carries session/operational context and is
// covered by intentRouter*.test.ts. This suite locks the gate, not the router.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canViewOwnerFinancials } from '@/utils/financialPrivacy';

// The two leaks gated by this round.
const TIER1_GATED = ['restock_opportunity', 'product_opportunities'] as const;
// The four originally gated intents — must stay gated.
const ORIGINAL_GATED = [
  'best_customer', 'least_profitable_customers',
  'what_hurting_profit', 'what_is_losing_money',
] as const;

// Privacy ON: owner-financials hidden from non-owners.
const PRIVACY_ON = { hideOwnerFinancialsFromEmployees: true } as const;
// Privacy OFF (explicit) and the implicit default (key absent).
const PRIVACY_OFF = { hideOwnerFinancialsFromEmployees: false } as const;
const PRIVACY_DEFAULT = {} as const;

// Mirror of the runtime gate predicate in IntelligenceChat.tsx.
function gateRedacts(intentId: string, canSeeOwnerFinancials: boolean, gated: ReadonlySet<string>) {
  return !canSeeOwnerFinancials && gated.has(intentId);
}

// Parse the real PROFIT_SENSITIVE_INTENTS declarations out of the production
// component so the assertions track the shipped code, not a copy.
const SRC = readFileSync(
  join(process.cwd(), 'src/modules/intelligence/IntelligenceChat.tsx'),
  'utf8',
);
const SET_BLOCKS = SRC.match(/PROFIT_SENSITIVE_INTENTS[\s\S]*?new Set\(\[([\s\S]*?)\]\)/g) ?? [];

describe('Financial privacy gate — Tier 1 (restock + product opportunities)', () => {
  // ── Layer 1: source-level regression guard (both dispatch sites) ────────
  describe('source guard: both intent ids gated in both dispatch sites', () => {
    it('has exactly two PROFIT_SENSITIVE_INTENTS declarations (fireQuery + onSubmit)', () => {
      expect(SET_BLOCKS.length).toBe(2);
    });

    it('every declaration gates the two Tier-1 intents (and keeps the original four)', () => {
      expect(SET_BLOCKS.length).toBeGreaterThan(0);
      for (const block of SET_BLOCKS) {
        for (const id of [...TIER1_GATED, ...ORIGINAL_GATED]) {
          expect(block).toContain(`'${id}'`);
        }
      }
    });
  });

  // ── Layer 2: the privacy decision (real helper) ─────────────────────────
  describe('decision: canViewOwnerFinancials honors role + flag', () => {
    it('employee + privacy ON cannot see owner financials', () => {
      expect(canViewOwnerFinancials(PRIVACY_ON, false)).toBe(false);
    });
    it('owner/admin + privacy ON can still see owner financials', () => {
      expect(canViewOwnerFinancials(PRIVACY_ON, true)).toBe(true);
    });
    it('privacy OFF (and default) preserves existing behavior — visible to all', () => {
      expect(canViewOwnerFinancials(PRIVACY_OFF, false)).toBe(true);
      expect(canViewOwnerFinancials(PRIVACY_DEFAULT, false)).toBe(true);
    });
    it('null/undefined settings (boot) defaults to visible (backward compat)', () => {
      expect(canViewOwnerFinancials(null, false)).toBe(true);
      expect(canViewOwnerFinancials(undefined, false)).toBe(true);
    });
  });

  // ── Layer 3: composed gate — exact runtime behavior, end to end ─────────
  describe('composed gate (source-derived set + real helper)', () => {
    // Build the gated set from the FIRST production declaration, so the
    // composed predicate runs against the shipped intent ids.
    const idsInSource = (SET_BLOCKS[0] ?? '').match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
    const GATED = new Set(idsInSource);

    it('the two Tier-1 intents are present in the source-derived gated set', () => {
      for (const id of TIER1_GATED) expect(GATED.has(id)).toBe(true);
    });

    it('employee + privacy ON → both Tier-1 intents are redacted', () => {
      const canSee = canViewOwnerFinancials(PRIVACY_ON, false);
      for (const id of TIER1_GATED) expect(gateRedacts(id, canSee, GATED)).toBe(true);
    });

    it('owner/admin + privacy ON → both Tier-1 intents run normally (not redacted)', () => {
      const canSee = canViewOwnerFinancials(PRIVACY_ON, true);
      for (const id of TIER1_GATED) expect(gateRedacts(id, canSee, GATED)).toBe(false);
    });

    it('privacy OFF / default / null → both intents run normally for everyone', () => {
      for (const canSee of [
        canViewOwnerFinancials(PRIVACY_OFF, false),
        canViewOwnerFinancials(PRIVACY_DEFAULT, false),
        canViewOwnerFinancials(null, false),
      ]) {
        for (const id of TIER1_GATED) expect(gateRedacts(id, canSee, GATED)).toBe(false);
      }
    });

    it('an ungated operational intent is never redacted (gate is scoped)', () => {
      const canSee = canViewOwnerFinancials(PRIVACY_ON, false); // employee, privacy ON
      expect(gateRedacts('repairs_ready', canSee, GATED)).toBe(false);
    });
  });
});
