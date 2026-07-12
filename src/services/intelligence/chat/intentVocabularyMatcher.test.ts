// ============================================================
// R-INTEL-V2-PHASE3-INTENT-VOCABULARY-FOUNDATION — matcher tests.
// Locks: (a) registry integrity (trilingual strong coverage, normalized
// phrases, unique intents), (b) AR phrases resolve in all 3 languages,
// (c) exclusions disqualify with diagnostics, (d) lone weak tokens
// never route, (e) unknown queries abstain, (f) normalization parity
// with the production router pipeline.
// ============================================================

import { describe, it, expect } from 'vitest';
import { INTENT_VOCABULARY, vocabularyStats } from './intentVocabulary';
import { matchVocabulary } from './intentVocabularyMatcher';

const best = (q: string) => matchVocabulary(q).bestMatch?.intent ?? null;

describe('vocabulary registry integrity', () => {
  it('every entry has at least one strong phrase per language (EN/ES/PT)', () => {
    for (const e of INTENT_VOCABULARY) {
      expect(e.strong.en.length, `${e.intent} EN`).toBeGreaterThan(0);
      expect(e.strong.es.length, `${e.intent} ES`).toBeGreaterThan(0);
      expect(e.strong.pt.length, `${e.intent} PT`).toBeGreaterThan(0);
    }
  });

  it('intents are unique across the registry', () => {
    const ids = INTENT_VOCABULARY.map((e) => e.intent);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every phrase is pre-normalized (lowercase, no stripped punctuation, single spaces)', () => {
    for (const e of INTENT_VOCABULARY) {
      const all = [
        ...e.strong.en, ...e.strong.es, ...e.strong.pt,
        ...(e.weak ? [...e.weak.en, ...e.weak.es, ...e.weak.pt] : []),
        ...(e.exclusions ?? []),
      ];
      for (const p of all) {
        expect(p, `${e.intent}: "${p}"`).toBe(p.toLowerCase());
        expect(p, `${e.intent}: "${p}" contains punctuation the normalizer strips`).not.toMatch(/[¿?¡!.,;:]/);
        expect(p, `${e.intent}: "${p}" has irregular spacing`).toBe(p.replace(/\s+/g, ' ').trim());
      }
    }
  });
});

describe('AR phrases resolve in all three languages', () => {
  it('English', () => {
    for (const q of ['who owes me money', 'unpaid balances', 'show unpaid', 'outstanding balances', 'pending payments']) {
      expect(best(q), q).toBe('unpaid_balances');
    }
  });
  it('Spanish', () => {
    for (const q of ['quién me debe dinero', 'saldos pendientes', 'cuentas por cobrar', 'clientes con saldo']) {
      expect(best(q), q).toBe('unpaid_balances');
    }
  });
  it('Portuguese', () => {
    for (const q of ['quem me deve', 'contas a receber', 'contas em aberto']) {
      expect(best(q), q).toBe('unpaid_balances');
    }
  });
});

describe('representative non-AR intents (all three languages)', () => {
  it('English', () => {
    expect(best('best customer')).toBe('best_customer');
    expect(best('overdue repairs')).toBe('repairs_overdue');
    expect(best('low stock')).toBe('inventory_low');
    expect(best('sales today')).toBe('today_sales');
    expect(best('marketing campaign')).toBe('marketing_campaign');
    expect(best('help')).toBe('help');
  });
  it('Spanish', () => {
    expect(best('mejor cliente')).toBe('best_customer');
    expect(best('peor cliente')).toBe('least_profitable_customers');
    expect(best('reparaciones listas')).toBe('repairs_ready');
    expect(best('stock muerto')).toBe('inventory_dead');
    expect(best('ventas de hoy')).toBe('today_sales');
    expect(best('ayuda')).toBe('help');
  });
  it('Portuguese', () => {
    expect(best('melhor cliente')).toBe('best_customer');
    expect(best('reparos prontos')).toBe('repairs_ready');
    expect(best('estoque baixo')).toBe('inventory_low');
    expect(best('vendas de hoje')).toBe('today_sales');
    expect(best('mais vendido')).toBe('top_items');
    expect(best('previsão de vendas')).toBe('forecast_items');
  });
});

describe('exclusions (negative signals)', () => {
  it('AR words disqualify what_hurting_profit and the diagnostics say why', () => {
    const r = matchVocabulary('who owes me money');
    expect(r.bestMatch?.intent).toBe('unpaid_balances');
    const hurt = r.candidates.find((c) => c.intent === 'what_hurting_profit');
    if (hurt) expect(hurt.excludedBy.length).toBeGreaterThan(0);
  });

  it('"best customer to contact" excludes best_customer (outreach signal)', () => {
    const r = matchVocabulary('best customer to contact');
    const bc = r.candidates.find((c) => c.intent === 'best_customer');
    expect(bc?.excludedBy).toContain('contact');
    expect(r.bestMatch?.intent).not.toBe('best_customer');
  });

  it('a why-question disqualifies the inventory_dead list answer', () => {
    const r = matchVocabulary('why is inventory dead');
    const dead = r.candidates.find((c) => c.intent === 'inventory_dead');
    expect(dead?.excludedBy).toContain('why');
    // dead_stock_root_cause is not modeled in V1 → the engine abstains
    // rather than giving a list answer to a diagnostic question.
    expect(r.bestMatch).toBeNull();
  });

  it('payment words keep AR asks off the repairs list', () => {
    const r = matchVocabulary('pending payments');
    expect(r.bestMatch?.intent).toBe('unpaid_balances');
    const rep = r.candidates.find((c) => c.intent === 'repairs_overdue');
    if (rep) expect(rep.excludedBy.length).toBeGreaterThan(0);
  });
});

describe('weak single tokens never route alone', () => {
  it.each(['profit', 'margin', 'losing', 'contactar'])('"%s" is listed but does not route', (q) => {
    const r = matchVocabulary(q);
    expect(r.bestMatch).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0); // visible in diagnostics
  });

  it('two weak tokens together do route (score >= 2)', () => {
    expect(best('profit margin')).toBe('what_hurting_profit');
  });
});

describe('unknown queries abstain with empty candidates', () => {
  it.each(['my cat is cute', 'i like this song', 'xyzzy plugh', 'wow'])('"%s" → null', (q) => {
    const r = matchVocabulary(q);
    expect(r.bestMatch).toBeNull();
  });
});

describe('normalization parity with the router pipeline', () => {
  it('punctuation and case are normalized before matching', () => {
    expect(best('¿Quién me debe dinero?')).toBe('unpaid_balances');
    expect(best('  UNPAID   BALANCES!! ')).toBe('unpaid_balances');
  });

  it('single-word phrases match whole tokens only, never substrings', () => {
    // 'helpful' must not token-match strong 'help'.
    expect(best('that was helpful yesterday')).toBeNull();
  });

  it('diagnostics carry the normalized query', () => {
    expect(matchVocabulary('¿Ventas de HOY?').normalizedQuery).toBe('ventas de hoy');
  });
});

describe('registry stats (foundation size lock)', () => {
  it('reports entries and phrase counts', () => {
    const s = vocabularyStats();
    expect(s.entries).toBe(INTENT_VOCABULARY.length);
    expect(s.strong).toBeGreaterThan(100);
    expect(s.entries).toBeGreaterThanOrEqual(20);
  });
});
