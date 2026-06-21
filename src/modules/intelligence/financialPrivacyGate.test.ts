// ============================================================
// R-FINANCIAL-PRIVACY-V5 (audit Priority B)
//
// Locks the chat profit-intent gate after Tier 1 + Tier 2:
//   - product_opportunities : FULL BLOCK for employees (Tier 1) — its whole
//                             reply is margin/profit framing.
//   - restock_opportunity   : PARTIAL REDACTION (Tier 2) — employees keep the
//                             operational restock list; only the per-item
//                             margin line is omitted inside the handler.
//
// The dispatch gate lives inline in IntelligenceChat.tsx (fireQuery + onSubmit):
//   if (!canSeeOwnerFinancials && PROFIT_SENSITIVE_INTENTS.has(match.id)) { redact }
// The set is not exported, so the gate is asserted in three layers:
//   1. SOURCE   — both declarations gate product_opportunities (+ the original
//                 four) and NO LONGER gate restock_opportunity.
//   2. DECISION — canViewOwnerFinancials() returns the right boolean.
//   3. COMPOSED — source-derived set + real helper = exact runtime predicate.
// Plus a Tier-2 behavioral layer that drives the real restock handler and
// asserts the margin line is present for owner and absent for employee.
//
// NOTE: intent ROUTING (which phrases reach these ids) is intentionally NOT
// asserted here — classifyIntent carries session/operational context and is
// covered by intentRouter*.test.ts. This suite locks the gate, not the router.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canViewOwnerFinancials, resolveOwnerFinancialAccess } from '@/utils/financialPrivacy';
import { handleRestockOpportunity } from '@/services/intelligence/chat/restockOpportunity';

// Intent fully blocked for employees (Tier 1).
const FULL_BLOCK_INTENTS = ['product_opportunities'] as const;
// The four originally gated intents — must stay fully gated.
const ORIGINAL_GATED = [
  'best_customer', 'least_profitable_customers',
  'what_hurting_profit', 'what_is_losing_money',
] as const;

// Privacy ON: owner-financials hidden from non-owners.
const PRIVACY_ON = { hideOwnerFinancialsFromEmployees: true } as const;
// Privacy OFF (explicit) and the implicit default (key absent).
const PRIVACY_OFF = { hideOwnerFinancialsFromEmployees: false } as const;
const PRIVACY_DEFAULT = {} as const;
// Policy C (C3) manager opt-in states (privacy ON).
const PRIVACY_ON_MGR_ON = { hideOwnerFinancialsFromEmployees: true, managersCanViewFinancials: true } as const;
const PRIVACY_ON_MGR_OFF = { hideOwnerFinancialsFromEmployees: true, managersCanViewFinancials: false } as const;

// Mirror of the runtime gate predicate in IntelligenceChat.tsx.
function gateRedacts(intentId: string, canSeeOwnerFinancials: boolean, gated: ReadonlySet<string>) {
  return !canSeeOwnerFinancials && gated.has(intentId);
}

// Owner-only financial terms that must never reach a redacted employee reply.
const FINANCIAL_TERMS = /margin|margen|margem|profit|ganancia|lucro|\bcost\b|costo|custo|cogs/i;

// Parse the real PROFIT_SENSITIVE_INTENTS declarations out of the production
// component so the assertions track the shipped code, not a copy.
const SRC = readFileSync(
  join(process.cwd(), 'src/modules/intelligence/IntelligenceChat.tsx'),
  'utf8',
);
const SET_BLOCKS = SRC.match(/PROFIT_SENSITIVE_INTENTS[\s\S]*?new Set\(\[([\s\S]*?)\]\)/g) ?? [];

// Minimal mock engine that yields exactly one high-priority restock rec with a
// real margin: out of stock (qty 0) + one recent sale + price > cost. Scores
// well above MIN_SCORE_THRESHOLD and renders the margin label for owners.
function makeRestockEngine() {
  const item: any = {
    id: 'inv-screen-1', name: 'Test Screen', sku: 'SCRN-1',
    category: 'parts', qty: 0, minQty: 2, price: 10000, cost: 4000, // $100 price / $40 cost → $60 margin (60%)
  };
  const sale: any = {
    id: 'sale-1', status: 'completed',
    createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago (within 7d/14d windows)
    items: [{ inventoryId: 'inv-screen-1', qty: 1 }],
  };
  return { getInventory: () => [item], getSales: () => [sale] } as any;
}

describe('Financial privacy gate — Tier 1 + Tier 2', () => {
  // ── Layer 1: source-level regression guard (both dispatch sites) ────────
  describe('source guard: full-block set is product_opportunities only', () => {
    it('has exactly two PROFIT_SENSITIVE_INTENTS declarations (fireQuery + onSubmit)', () => {
      expect(SET_BLOCKS.length).toBe(2);
    });

    it('every declaration full-blocks product_opportunities + the original four', () => {
      expect(SET_BLOCKS.length).toBeGreaterThan(0);
      for (const block of SET_BLOCKS) {
        for (const id of [...FULL_BLOCK_INTENTS, ...ORIGINAL_GATED]) {
          expect(block).toContain(`'${id}'`);
        }
      }
    });

    it('no declaration full-blocks restock_opportunity (Tier 2 partial redaction)', () => {
      for (const block of SET_BLOCKS) {
        expect(block).not.toContain("'restock_opportunity'");
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

  // ── Layer 3: composed dispatch gate (source-derived set + real helper) ──
  describe('composed dispatch gate', () => {
    const idsInSource = (SET_BLOCKS[0] ?? '').match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
    const GATED = new Set(idsInSource);

    it('product_opportunities is in the source-derived gated set; restock_opportunity is not', () => {
      expect(GATED.has('product_opportunities')).toBe(true);
      expect(GATED.has('restock_opportunity')).toBe(false);
    });

    it('employee + privacy ON → product_opportunities fully blocked', () => {
      expect(gateRedacts('product_opportunities', canViewOwnerFinancials(PRIVACY_ON, false), GATED)).toBe(true);
    });

    it('employee + privacy ON → restock_opportunity NOT full-blocked (handler still runs)', () => {
      expect(gateRedacts('restock_opportunity', canViewOwnerFinancials(PRIVACY_ON, false), GATED)).toBe(false);
    });

    it('owner/admin + privacy ON → product_opportunities runs normally', () => {
      expect(gateRedacts('product_opportunities', canViewOwnerFinancials(PRIVACY_ON, true), GATED)).toBe(false);
    });

    it('privacy OFF / default / null → nothing is full-blocked', () => {
      for (const canSee of [
        canViewOwnerFinancials(PRIVACY_OFF, false),
        canViewOwnerFinancials(PRIVACY_DEFAULT, false),
        canViewOwnerFinancials(null, false),
      ]) {
        expect(gateRedacts('product_opportunities', canSee, GATED)).toBe(false);
        expect(gateRedacts('restock_opportunity', canSee, GATED)).toBe(false);
      }
    });
  });

  // ── Layer 4: Tier-2 partial redaction — real handler behavior ───────────
  describe('restock_opportunity partial redaction (real handler)', () => {
    it('employee (canSee=false): operational guidance kept, NO margin/cost/profit', () => {
      const res = handleRestockOpportunity(makeRestockEngine(), 'en', false);
      // operational content preserved
      expect(res.text).toContain('Test Screen');
      expect(res.text).toContain('Out of stock'); // operational reason
      // financial content fully omitted (no terms, no dollar figures, no fake zeros)
      expect(res.text).not.toMatch(FINANCIAL_TERMS);
      expect(res.text).not.toContain('$');
      expect(res.text).not.toContain('60%');
    });

    it('owner/admin (canSee=true): original financial detail still shown', () => {
      const res = handleRestockOpportunity(makeRestockEngine(), 'en', true);
      expect(res.text).toContain('Test Screen');
      expect(res.text).toMatch(/margin/i);
      expect(res.text).toContain('$60.00'); // COP(6000) margin dollars
      expect(res.text).toContain('60%');    // margin percent
    });

    it('default param (no flag) preserves legacy owner behavior', () => {
      const res = handleRestockOpportunity(makeRestockEngine(), 'en');
      expect(res.text).toMatch(/margin/i);
      expect(res.text).toContain('$60.00');
    });
  });
});

// ============================================================
// Policy C C3 — IntelligenceChat dispatch gate now derives canSee from the
// role-aware resolveOwnerFinancialAccess() helper (not isAdminMode||owner).
// ============================================================
describe('Policy C C3 — IntelligenceChat uses resolveOwnerFinancialAccess', () => {
  // Source guard: the chat gate value must come from the Policy C helper, and
  // the old low-level canViewOwnerFinancials must no longer be used there.
  it('IntelligenceChat computes canSee via resolveOwnerFinancialAccess (old helper removed)', () => {
    expect(SRC).toContain('resolveOwnerFinancialAccess({');
    expect(SRC).not.toContain('canViewOwnerFinancials');
  });

  // Source-derived gated set + helper-derived canSee = exact runtime predicate.
  const GATED = new Set((SET_BLOCKS[0] ?? '').match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? []);
  const canSee = (settings: any, role: string | null, isAdminMode = false) =>
    resolveOwnerFinancialAccess({ settings, currentEmployee: role == null ? null : { role }, isAdminMode });

  it('owner + privacy ON → financial intents visible (product_opportunities NOT blocked)', () => {
    expect(gateRedacts('product_opportunities', canSee(PRIVACY_ON, 'owner'), GATED)).toBe(false);
  });

  it('employee + privacy ON → product_opportunities blocked', () => {
    expect(gateRedacts('product_opportunities', canSee(PRIVACY_ON, 'technician'), GATED)).toBe(true);
  });

  it('manager + privacy ON + managersCanViewFinancials false/missing → product_opportunities blocked', () => {
    expect(gateRedacts('product_opportunities', canSee(PRIVACY_ON, 'manager'), GATED)).toBe(true);
    expect(gateRedacts('product_opportunities', canSee(PRIVACY_ON_MGR_OFF, 'manager'), GATED)).toBe(true);
  });

  it('manager + privacy ON + managersCanViewFinancials true → product_opportunities allowed', () => {
    expect(gateRedacts('product_opportunities', canSee(PRIVACY_ON_MGR_ON, 'manager'), GATED)).toBe(false);
  });

  it('isAdminMode true alone does NOT grant manager visibility when setting is off', () => {
    expect(gateRedacts('product_opportunities', canSee(PRIVACY_ON, 'manager', true), GATED)).toBe(true);
  });

  it('privacy OFF → legacy visible for everyone', () => {
    expect(gateRedacts('product_opportunities', canSee(PRIVACY_OFF, 'technician'), GATED)).toBe(false);
    expect(gateRedacts('product_opportunities', canSee(PRIVACY_OFF, 'manager'), GATED)).toBe(false);
  });

  // restock_opportunity partial redaction follows the SAME canSee value.
  it('manager + privacy ON + setting OFF → restock runs but margin redacted', () => {
    const cs = canSee(PRIVACY_ON_MGR_OFF, 'manager');
    expect(cs).toBe(false);
    const res = handleRestockOpportunity(makeRestockEngine(), 'en', cs);
    expect(res.text).toContain('Test Screen');
    expect(res.text).not.toMatch(FINANCIAL_TERMS);
    expect(res.text).not.toContain('$');
  });

  it('manager + privacy ON + setting ON → restock margin visible', () => {
    const cs = canSee(PRIVACY_ON_MGR_ON, 'manager');
    expect(cs).toBe(true);
    const res = handleRestockOpportunity(makeRestockEngine(), 'en', cs);
    expect(res.text).toMatch(/margin/i);
    expect(res.text).toContain('$60.00');
  });
});
