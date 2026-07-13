// ============================================================
// CellHub Intelligence — Shadow Routing Comparison
// R-INTEL-V2-PHASE3-INTENT-VOCABULARY-FOUNDATION
//
// Developer/diagnostics tooling ONLY. Compares the production router
// (classifyIntent) against the vocabulary engine (matchVocabulary) on
// a curated corpus and groups the outcomes. Nothing in the production
// Intelligence chat imports this module; it is callable only from
// tests or explicit developer diagnostics.
//
// Privacy: the production router is always invoked with an EMPTY
// customers array — no customer data enters or leaves this tooling,
// and nothing here logs automatically.
// ============================================================

import type { IntentId } from './intentRouter';
import { classifyIntent } from './intentRouter';
import { matchVocabulary } from './intentVocabularyMatcher';
import type { VocabularyMatchResult } from './intentVocabularyMatcher';

export type ShadowLang = 'en' | 'es' | 'pt';

export interface ShadowComparison {
  query: string;
  lang: ShadowLang;
  /** Production router result (classifyIntent with NO customer data). */
  routerIntent: IntentId;
  /** Vocabulary engine result; null = abstained (unknown). */
  vocabularyIntent: IntentId | null;
  /** Abstention maps to fallback_question for apples-to-apples comparison. */
  vocabularyEffective: IntentId;
  match: boolean;
  /** Human-readable diagnostic reasons (matched phrases, exclusions, abstention). */
  reasons: string[];
  /** Full vocabulary diagnostics for drill-down. */
  vocabularyDiagnostics: VocabularyMatchResult;
}

/**
 * Run one query through BOTH engines and explain the outcome.
 * Deterministic; safe to call from tests and dev consoles.
 */
export function compareWithProductionRouter(query: string, lang: ShadowLang = 'en'): ShadowComparison {
  const routerIntent = classifyIntent(query, [], lang).id; // [] — never pass customer data
  const vocab = matchVocabulary(query);
  const vocabularyIntent = vocab.bestMatch?.intent ?? null;
  const vocabularyEffective: IntentId = vocabularyIntent ?? 'fallback_question';

  const reasons: string[] = [];
  if (vocab.bestMatch) {
    if (vocab.bestMatch.matchedStrongPhrases.length > 0) {
      reasons.push(`vocabulary strong: ${vocab.bestMatch.matchedStrongPhrases.join(', ')}`);
    }
    if (vocab.bestMatch.matchedTokens.length > 0) {
      reasons.push(`vocabulary weak: ${vocab.bestMatch.matchedTokens.join(', ')}`);
    }
  } else {
    reasons.push('vocabulary abstained (no candidate met the routing bar)');
  }
  for (const c of vocab.candidates) {
    if (c.excludedBy.length > 0) {
      reasons.push(`vocabulary excluded ${c.intent} via: ${c.excludedBy.join(', ')}`);
    }
  }
  if (routerIntent !== vocabularyEffective) {
    reasons.push(`router chose ${routerIntent}; vocabulary chose ${vocabularyEffective}`);
  }

  return { query, lang, routerIntent, vocabularyIntent, vocabularyEffective, match: routerIntent === vocabularyEffective, reasons, vocabularyDiagnostics: vocab };
}

// ── Curated corpus ──────────────────────────────────────────
// Queries drawn from the router's own keyword banks, the locked routing
// tests, and the AR round's documented phrases. `expected` is only set
// where existing tests/docs establish the correct intent; entries
// without `expected` are genuinely ambiguous and are grouped as such.

export interface ShadowCorpusEntry {
  query: string;
  lang: ShadowLang;
  expected?: IntentId;
  note?: string;
}

export const SHADOW_CORPUS: readonly ShadowCorpusEntry[] = [
  // ── AR (locked by intentRouterAliases.test.ts + AR round docs) ──
  { query: 'who owes me money', lang: 'en', expected: 'unpaid_balances' },
  { query: 'unpaid balances', lang: 'en', expected: 'unpaid_balances' },
  { query: 'show unpaid', lang: 'en', expected: 'unpaid_balances' },
  { query: 'outstanding balances', lang: 'en', expected: 'unpaid_balances' },
  { query: 'customers with balance', lang: 'en', expected: 'unpaid_balances' },
  { query: 'pending payments', lang: 'en', expected: 'unpaid_balances' },
  { query: 'accounts receivable', lang: 'en', expected: 'unpaid_balances' },
  { query: 'quién me debe dinero', lang: 'es', expected: 'unpaid_balances' },
  { query: 'saldos pendientes', lang: 'es', expected: 'unpaid_balances' },
  { query: 'cuentas por cobrar', lang: 'es', expected: 'unpaid_balances' },
  { query: 'clientes con saldo', lang: 'es', expected: 'unpaid_balances' },
  { query: 'quem me deve', lang: 'pt', expected: 'unpaid_balances' },
  { query: 'contas a receber', lang: 'pt', expected: 'unpaid_balances' },
  { query: 'contas em aberto', lang: 'pt', expected: 'unpaid_balances' },
  // R-INTEL-V2-PHASE11: PT AR theft lock + an attention-feed collision guard.
  { query: 'pagamentos pendentes', lang: 'pt', expected: 'unpaid_balances', note: "former attention_feed score theft (bare 'pendente'+'pendentes' double-hit) — closed by R-INTEL-V2-PHASE11" },
  { query: 'pendentes', lang: 'pt', expected: 'attention_feed', note: 'collision guard: bare pending-work token must stay on the attention feed (Phase 11)' },

  // ── Customers ──
  { query: 'best customer', lang: 'en', expected: 'best_customer' },
  { query: 'mejor cliente', lang: 'es', expected: 'best_customer' },
  { query: 'melhor cliente', lang: 'pt', expected: 'best_customer' },
  { query: 'worst customer', lang: 'en', expected: 'least_profitable_customers' },
  { query: 'peor cliente', lang: 'es', expected: 'least_profitable_customers' },
  { query: 'pior cliente', lang: 'pt', expected: 'least_profitable_customers' },
  { query: 'recover customer', lang: 'en', expected: 'recover_customer' },
  { query: 'recuperar cliente', lang: 'es', expected: 'recover_customer' },
  { query: 'trazer de volta', lang: 'pt', expected: 'recover_customer' },
  { query: 'lost customers', lang: 'en', expected: 'customer_churn_root_cause', note: 'former recover_customer theft (singular-substring tie) — closed by R-INTEL-V2-PHASE12' },
  { query: 'why customers stopped coming', lang: 'en', expected: 'customer_churn_root_cause', note: "former customer_history theft (bare 'customer' tie) — closed by R-INTEL-V2-PHASE12" },
  { query: 'dejaron de venir', lang: 'es', expected: 'customer_churn_root_cause' },
  { query: 'pararam de vir', lang: 'pt', expected: 'customer_churn_root_cause' },
  { query: 'customers to call', lang: 'en', expected: 'who_to_contact' },
  { query: 'clientes para llamar', lang: 'es', expected: 'who_to_contact' },
  { query: 'contatar cliente', lang: 'pt', expected: 'who_to_contact', note: "former customer_history theft (bare 'cliente' tie) — closed by R-INTEL-V2-PHASE12" },
  // R-INTEL-V2-PHASE12: churn/recovery distinction locks.
  { query: 'clientes perdidos', lang: 'es', expected: 'customer_churn_root_cause', note: 'Phase 12 lock: plural diagnostic form (singular + action verbs stay on recover_customer)' },
  { query: 'recuperar clientes perdidos', lang: 'es', expected: 'recover_customer', note: 'Phase 12 collision guard: explicit action verb keeps the recovery workflow' },

  // ── Repairs ──
  { query: 'repairs ready', lang: 'en', note: 'repairs_ready vs data_query — both banks carry the phrase; no locked routing test exists' },
  { query: 'reparaciones listas', lang: 'es', note: 'same dual-membership as "repairs ready"' },
  { query: 'reparos prontos', lang: 'pt', note: 'same dual-membership as "repairs ready"' },
  { query: 'ready for pickup', lang: 'en', expected: 'repairs_ready' },
  { query: 'overdue repairs', lang: 'en', expected: 'repairs_overdue' },
  { query: 'reparaciones atrasadas', lang: 'es', expected: 'repairs_overdue' },
  { query: 'reparos atrasados', lang: 'pt', expected: 'repairs_overdue', note: 'former router PT gap (plural form) — closed by R-INTEL-V2-PHASE6' },

  // ── Inventory ──
  { query: 'low stock', lang: 'en', expected: 'inventory_low', note: 'former data_query theft (position tie) — closed by R-INTEL-V2-PHASE10' },
  { query: 'stock bajo', lang: 'es', expected: 'inventory_low' },
  { query: 'estoque baixo', lang: 'pt', expected: 'inventory_low', note: 'former data_query theft (bank gap) — closed by R-INTEL-V2-PHASE10' },
  { query: 'dead stock', lang: 'en', expected: 'inventory_dead', note: 'former data_query theft (position tie) — closed by R-INTEL-V2-PHASE10' },
  { query: 'stock muerto', lang: 'es', expected: 'inventory_dead' },
  { query: 'estoque parado', lang: 'pt', expected: 'inventory_dead', note: 'former data_query theft (bank gap) — closed by R-INTEL-V2-PHASE10' },
  // R-INTEL-V2-PHASE10: wrapper-theft locks + a generic-data collision guard.
  { query: 'show me expected sales', lang: 'en', expected: 'forecast_items', note: 'former data_query wrapper theft — closed by R-INTEL-V2-PHASE10' },
  { query: 'show me the sales trend', lang: 'en', expected: 'trend_direction', note: 'former data_query wrapper theft — closed by R-INTEL-V2-PHASE10' },
  { query: 'show me best sellers', lang: 'en', expected: 'top_items', note: 'former data_query wrapper theft — closed by R-INTEL-V2-PHASE10' },
  { query: 'show me the data', lang: 'en', expected: 'data_query', note: 'collision guard: wrapper with no domain phrase must stay data_query (Phase 10)' },
  { query: 'why is inventory dead', lang: 'en', expected: 'dead_stock_root_cause', note: 'root-cause intent not modeled in vocabulary V1 — expect abstention' },
  { query: 'what should i restock', lang: 'en', expected: 'restock_opportunity' },
  { query: 'que debo reponer', lang: 'es', expected: 'restock_opportunity' },
  { query: 'o que devo repor', lang: 'pt', expected: 'restock_opportunity' },
  { query: 'top seller', lang: 'en', expected: 'top_items' },
  { query: 'mas vendido', lang: 'es', expected: 'top_items' },
  { query: 'mais vendido', lang: 'pt', expected: 'top_items', note: 'former router PT gap (TOP_ITEMS) — closed by R-INTEL-V2-PHASE6' },

  // ── Sales / day state ──
  { query: 'sales today', lang: 'en', expected: 'today_sales', note: 'router design comment says today_sales must win; raw score may disagree' },
  { query: 'ventas de hoy', lang: 'es', expected: 'today_sales' },
  { query: 'vendas de hoje', lang: 'pt', expected: 'today_sales' },
  { query: 'how much did i sell today', lang: 'en', expected: 'today_sales' },
  { query: 'end of day', lang: 'en', expected: 'end_of_day_brief' },
  { query: 'fin del dia', lang: 'es', expected: 'end_of_day_brief' },
  { query: 'fim do dia', lang: 'pt', expected: 'end_of_day_brief' },
  { query: 'como me fue hoy', lang: 'es', expected: 'end_of_day_brief' },
  { query: 'cuánto vendí hoy', lang: 'es', note: 'documented dual-membership: TODAY_SALES vs END_OF_DAY banks both carry it' },
  { query: 'sales trend', lang: 'en', expected: 'trend_direction', note: 'former tie-loss to sales_summary — closed by R-INTEL-V2-PHASE9' },
  { query: 'tendencia de ventas', lang: 'es', expected: 'trend_direction', note: 'former tie-loss to sales_summary — closed by R-INTEL-V2-PHASE9' },
  { query: 'estamos crescendo', lang: 'pt', expected: 'trend_direction' },
  // R-INTEL-V2-PHASE9: trend tie-loss locks (revenue variant + PT form that
  // never overlapped SALES tokens — locked so it can never regress).
  { query: 'revenue trend', lang: 'en', expected: 'trend_direction', note: 'former tie-loss to sales_summary — closed by R-INTEL-V2-PHASE9' },
  { query: 'tendência de vendas', lang: 'pt', expected: 'trend_direction', note: 'Phase 9 regression lock (no SALES-token overlap in PT)' },
  { query: 'forecast', lang: 'en', expected: 'forecast_items' },
  { query: 'pronostico de ventas', lang: 'es', expected: 'forecast_items', note: 'former tie-loss to sales_summary — closed by R-INTEL-V2-PHASE7' },
  { query: 'previsão de vendas', lang: 'pt', expected: 'forecast_items', note: 'former router PT gap (FORECAST) — closed by R-INTEL-V2-PHASE6' },
  // R-INTEL-V2-PHASE7: forecast tie-loss locks + sales-summary collision guards.
  { query: 'expected sales', lang: 'en', expected: 'forecast_items', note: 'former tie-loss to sales_summary — closed by R-INTEL-V2-PHASE7' },
  { query: 'sales forecast', lang: 'en', expected: 'forecast_items', note: 'Phase 7 regression lock' },
  { query: 'proyección de ventas', lang: 'es', expected: 'forecast_items', note: 'Phase 7 regression lock (accented form)' },
  { query: 'how are sales', lang: 'en', expected: 'sales_summary', note: 'collision guard: plain summary ask must never reroute to forecast (Phase 7)' },
  { query: 'resumen de ventas', lang: 'es', expected: 'sales_summary', note: 'collision guard: plain summary ask must never reroute to forecast (Phase 7)' },

  // ── Marketing / help / diagnostics ──
  { query: 'marketing campaign', lang: 'en', expected: 'marketing_campaign' },
  { query: 'crear campaña', lang: 'es', expected: 'marketing_campaign' },
  { query: 'criar campanha', lang: 'pt', expected: 'marketing_campaign' },
  { query: 'help', lang: 'en', expected: 'help' },
  { query: 'ayuda', lang: 'es', expected: 'help' },
  { query: 'what can you do', lang: 'en', expected: 'help' },
  // R-INTEL-V2-PHASE6: PT help coverage + the embedded-help collision guard.
  // 'ajuda' routes to help ONLY standalone — inside an operational ask the
  // operational bank ties 1-1 and wins on scores-array position.
  { query: 'ajuda', lang: 'pt', expected: 'help', note: 'former router PT gap (HELP had no PT token) — closed by R-INTEL-V2-PHASE6' },
  { query: 'preciso de ajuda', lang: 'pt', expected: 'help' },
  { query: 'me ajuda a ver os reparos atrasados', lang: 'pt', expected: 'repairs_overdue', note: 'embedded help word must never steal an operational ask (Phase 6 lock)' },
  { query: 'produtos mais vendidos', lang: 'pt', expected: 'top_items', note: 'plural/natural variant of the Phase 6 top_items correction' },
  { query: 'what is wrong', lang: 'en', expected: 'what_hurting_profit' },
  { query: 'que esta mal', lang: 'es', expected: 'what_hurting_profit' },

  // ── Ambiguous / weak single tokens (no expected — genuinely unclear) ──
  { query: 'profit', lang: 'en', note: 'lone weak token: router routes on score 1; vocabulary abstains by design' },
  { query: 'margin', lang: 'en', note: 'lone weak token' },
  { query: 'money', lang: 'en', note: 'documented bare-token hazard in WHAT_HURTING_PROFIT_KEYWORDS' },
  { query: 'pendientes', lang: 'es', note: 'shared bare token: repairs vs attention_feed vs AR' },
  { query: 'best customer to contact', lang: 'en', note: 'documented collision: LIKELY_TO_BUY bank vs BEST_CUSTOMER bank' },

  // ── Should remain unknown ──
  { query: 'wow', lang: 'en', expected: 'fallback_question' },
  { query: 'tell me more', lang: 'en', expected: 'fallback_question' },
  { query: 'my cat is cute', lang: 'en', expected: 'fallback_question' },
  { query: 'i like this song', lang: 'en', expected: 'fallback_question' },
  { query: 'gracias', lang: 'es', expected: 'fallback_question' },
  { query: 'obrigado', lang: 'pt', expected: 'fallback_question' },
  { query: 'xyzzy plugh', lang: 'en', expected: 'fallback_question' },
];

// ── Grouped mismatch report ─────────────────────────────────

export type ShadowGroup =
  | 'exact_match'          // both engines produced the expected/same intent
  | 'vocabulary_improved'  // vocabulary hit the documented expectation, router did not
  | 'router_safer'         // router hit the expectation, vocabulary abstained (safe miss)
  | 'regression'           // router hit the expectation, vocabulary actively misrouted
  | 'ambiguous';           // no expectation and engines disagree, or both missed

export interface ShadowReportRow {
  entry: ShadowCorpusEntry;
  comparison: ShadowComparison;
  group: ShadowGroup;
}

export interface ShadowReport {
  rows: ShadowReportRow[];
  groups: Record<ShadowGroup, ShadowReportRow[]>;
  totals: Record<ShadowGroup, number> & { corpus: number };
}

export function classifyComparison(entry: ShadowCorpusEntry, cmp: ShadowComparison): ShadowGroup {
  const vocab = cmp.vocabularyEffective;
  const router = cmp.routerIntent;
  const { expected } = entry;

  if (expected === undefined) {
    return router === vocab ? 'exact_match' : 'ambiguous';
  }
  if (router === expected && vocab === expected) return 'exact_match';
  if (vocab === expected && router !== expected) return 'vocabulary_improved';
  if (router === expected && vocab === 'fallback_question') return 'router_safer';
  if (router === expected) return 'regression'; // vocabulary actively misrouted
  return 'ambiguous'; // both engines missed the expectation
}

/** Run the whole curated corpus through both engines and group the outcomes. */
export function generateShadowReport(corpus: readonly ShadowCorpusEntry[] = SHADOW_CORPUS): ShadowReport {
  const rows: ShadowReportRow[] = corpus.map((entry) => {
    const comparison = compareWithProductionRouter(entry.query, entry.lang);
    return { entry, comparison, group: classifyComparison(entry, comparison) };
  });

  const groups: Record<ShadowGroup, ShadowReportRow[]> = {
    exact_match: [], vocabulary_improved: [], router_safer: [], regression: [], ambiguous: [],
  };
  for (const row of rows) groups[row.group].push(row);

  return {
    rows,
    groups,
    totals: {
      corpus: rows.length,
      exact_match: groups.exact_match.length,
      vocabulary_improved: groups.vocabulary_improved.length,
      router_safer: groups.router_safer.length,
      regression: groups.regression.length,
      ambiguous: groups.ambiguous.length,
    },
  };
}
