// ============================================================
// R-INTEL-V2-PHASE3-INTENT-VOCABULARY-FOUNDATION — shadow comparison.
// Locks: (a) the comparison function agrees with the production router
// on the locked AR phrases, (b) the curated corpus produces ZERO
// regressions (vocabulary actively misrouting where the router is
// right), (c) grouping arithmetic is sound, (d) the report is
// available for explicit developer diagnostics (env-gated print).
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  compareWithProductionRouter,
  generateShadowReport,
  SHADOW_CORPUS,
} from './intentVocabularyShadow';

describe('compareWithProductionRouter', () => {
  it('agrees with the router on the locked AR phrases (all 3 languages)', () => {
    const locked: Array<[string, 'en' | 'es' | 'pt']> = [
      ['who owes me money', 'en'],
      ['unpaid balances', 'en'],
      ['quién me debe dinero', 'es'],
      ['saldos pendientes', 'es'],
      ['quem me deve', 'pt'],
      ['contas a receber', 'pt'],
    ];
    for (const [q, lang] of locked) {
      const c = compareWithProductionRouter(q, lang);
      expect(c.routerIntent, q).toBe('unpaid_balances');
      expect(c.vocabularyIntent, q).toBe('unpaid_balances');
      expect(c.match, q).toBe(true);
    }
  });

  it('returns structured diagnostics, not just an intent', () => {
    const c = compareWithProductionRouter('who owes me money', 'en');
    expect(c.reasons.length).toBeGreaterThan(0);
    expect(c.vocabularyDiagnostics.normalizedQuery).toBe('who owes me money');
    expect(c.vocabularyDiagnostics.candidates.length).toBeGreaterThan(0);
  });

  it('explains disagreements in the reasons', () => {
    // 'mais vendido' (Phase 6) and 'estoque baixo' (Phase 10) no longer
    // disagree. 'vendas de hoje' remains a stable documented disagreement:
    // the router routes it to today_summary, the vocabulary to today_sales
    // — the known cross-language dispute, deliberately out of scope.
    const c = compareWithProductionRouter('vendas de hoje', 'pt');
    expect(c.match).toBe(false);
    expect(c.reasons.join(' ')).toContain('router chose');
  });
});

describe('shadow corpus report', () => {
  const report = generateShadowReport();

  it('covers the whole corpus and the groups sum to the total', () => {
    expect(report.totals.corpus).toBe(SHADOW_CORPUS.length);
    const sum =
      report.totals.exact_match +
      report.totals.vocabulary_improved +
      report.totals.router_safer +
      report.totals.regression +
      report.totals.ambiguous;
    expect(sum).toBe(report.totals.corpus);
  });

  it('ZERO regressions: the vocabulary never actively misroutes where the router is right', () => {
    const details = report.groups.regression.map(
      (r) => `"${r.entry.query}" expected=${r.entry.expected} router=${r.comparison.routerIntent} vocab=${r.comparison.vocabularyEffective}`,
    );
    expect(details, details.join('\n')).toEqual([]);
  });

  it('the six required AR examples are exact matches', () => {
    const required = [
      'who owes me money', 'unpaid balances', 'quién me debe dinero',
      'saldos pendientes', 'quem me deve', 'contas a receber',
    ];
    for (const q of required) {
      const row = report.rows.find((r) => r.entry.query === q);
      expect(row, q).toBeDefined();
      expect(row?.group, q).toBe('exact_match');
    }
  });

  it('unknown/filler queries are exact matches (both engines abstain)', () => {
    for (const q of ['wow', 'my cat is cute', 'xyzzy plugh', 'gracias', 'obrigado']) {
      const row = report.rows.find((r) => r.entry.query === q);
      expect(row?.group, q).toBe('exact_match');
    }
  });

  it('the Phase 3 PT gaps are now exact matches (closed by R-INTEL-V2-PHASE6)', () => {
    // These three surfaced as vocabulary_improved while the router lacked PT
    // coverage. Phase 6 added the phrases to the production banks, so both
    // engines now agree with the documented expectation — strictly safer.
    for (const q of ['mais vendido', 'previsão de vendas', 'reparos atrasados', 'ajuda', 'preciso de ajuda', 'produtos mais vendidos']) {
      const row = report.rows.find((r) => r.entry.query === q);
      expect(row?.group, q).toBe('exact_match');
    }
  });

  it('the Phase 7/9 tie-loss rows are now exact matches (thief-intent overrides)', () => {
    // These surfaced as vocabulary_improved while sales_summary stole the
    // 1-1 position tie. The forecast (Phase 7) and trend (Phase 9)
    // overrides closed the class — both engines now agree. Strictly safer.
    for (const q of ['expected sales', 'sales forecast', 'pronostico de ventas', 'proyección de ventas', 'sales trend', 'tendencia de ventas', 'revenue trend', 'tendência de vendas']) {
      const row = report.rows.find((r) => r.entry.query === q);
      expect(row?.group, q).toBe('exact_match');
    }
  });

  it('the Phase 10 data_query thefts are now exact matches', () => {
    // data_query stole these via position ties, PT bank gaps, or wrapper
    // tokens. The Phase 10 anchored-domain-phrase override closed the class.
    for (const q of ['low stock', 'dead stock', 'estoque baixo', 'estoque parado', 'show me expected sales', 'show me the sales trend', 'show me best sellers']) {
      const row = report.rows.find((r) => r.entry.query === q);
      expect(row?.group, q).toBe('exact_match');
    }
  });

  it('lone weak tokens land in router_safer or ambiguous — never a silent vocabulary guess', () => {
    for (const q of ['profit', 'margin', 'money']) {
      const row = report.rows.find((r) => r.entry.query === q);
      expect(row?.comparison.vocabularyIntent, q).toBeNull();
      expect(['router_safer', 'ambiguous']).toContain(row?.group);
    }
  });

  // Explicit developer diagnostics: VOCAB_SHADOW_REPORT=1 npx vitest run intentVocabularyShadow
  it('prints the full grouped report when explicitly requested', () => {
    if (typeof process !== 'undefined' && process.env && process.env.VOCAB_SHADOW_REPORT) {
      const compact = (Object.keys(report.groups) as Array<keyof typeof report.groups>).map((g) => ({
        group: g,
        rows: report.groups[g].map((r) => ({
          query: r.entry.query,
          lang: r.entry.lang,
          expected: r.entry.expected ?? null,
          router: r.comparison.routerIntent,
          vocabulary: r.comparison.vocabularyEffective,
          note: r.entry.note ?? null,
        })),
      }));
      // eslint-disable-next-line no-console
      console.log('[VOCAB_SHADOW_REPORT]', JSON.stringify({ totals: report.totals, groups: compact }, null, 2));
    }
    expect(true).toBe(true);
  });
});
