// ============================================================
// CellHub Intelligence — Multilingual Intent Vocabulary Registry
// R-INTEL-V2-PHASE3-INTENT-VOCABULARY-FOUNDATION
//
// A FORMAL, typed vocabulary for intent routing: per-intent EN/ES/PT
// phrase sets with explicit strength tiers and negative signals.
//
// STATUS: FOUNDATION + DIAGNOSTICS ONLY. Nothing in production imports
// this module. The production router (intentRouter.ts classifyIntent)
// is untouched; this registry powers the shadow matcher
// (intentVocabularyMatcher.ts) and the comparison tooling
// (intentVocabularyShadow.ts) so routing quality can be measured
// BEFORE any production migration is considered.
//
// Design rules (extracted from the router's own hard-won comments):
//   - strong = anchored phrases (usually multi-word) that unambiguously
//     identify the intent. A single-word phrase is only "strong" when
//     the token is domain-unambiguous (e.g. 'unpaid', 'forecast').
//   - weak = supporting single tokens that suggest but don't decide
//     (e.g. 'profit', 'margin'). A weak hit alone never routes.
//   - exclusions = negative signals: when present in the query the
//     entry is disqualified (recorded, not silently dropped). This is
//     the formal replacement for the router's "bare token hazard"
//     workarounds (e.g. bare 'money' catching "who owes me money").
//   - Registry ORDER is precedence: earlier = more specific, mirroring
//     the router's scores-array tie-break philosophy.
//   - Phrases must already be normalized: lowercase, no ¿?¡!.,;:
//     punctuation, single spaces. The matcher validates none of the
//     normalization characters appear here.
//
// V1 scope: 20 representative intents across AR, customers, repairs,
// inventory, sales, diagnostics, marketing, and help. Deliberately
// EXCLUDED from this foundation (see the handoff doc §2 anti-patterns):
//   - the ~12-intent "what should I do now" cluster (proactive_operations,
//     recommended_next_best_action, focus_today, decision_recommendation,
//     the daily-brief family, …) — highest routing-instability surface;
//     needs its own dedicated consolidation round with the phrase
//     contract made explicit first.
//   - entity/name-extraction intents (customer_history, customer_360,
//     product_push, propose_deal, entity_operational_command,
//     conversation_runner, proposal_followup, mark_deal_stage) — they
//     require the entity-resolution pass the vocabulary layer does not
//     model in V1.
//   - data_query (grab-bag metrics bank) and the context/continuity
//     intents (workflow_continuity, active_context_query) — context-
//     dependent, not vocabulary-decidable.
// ============================================================

import type { IntentId } from './intentRouter';

export interface MultilingualPhrases {
  en: readonly string[];
  es: readonly string[];
  pt: readonly string[];
}

export interface IntentVocabularyEntry {
  /** Production intent identifier — typed against the router's union. */
  intent: IntentId;
  /** Anchored high-signal phrases. One strong hit is enough to route. */
  strong: MultilingualPhrases;
  /** Supporting low-signal tokens. Never route on a lone weak hit. */
  weak?: MultilingualPhrases;
  /**
   * Negative signals (any language, matched with the same rules): when
   * one is present in the query this entry is disqualified and the
   * matcher records WHICH signal fired (diagnostics, not silence).
   */
  exclusions?: readonly string[];
  /** Why ambiguous phrases live (or don't live) here. */
  notes?: string;
}

export const INTENT_VOCABULARY: readonly IntentVocabularyEntry[] = [
  // ── Accounts receivable — highest precedence (anchored money-owed asks) ──
  {
    intent: 'unpaid_balances',
    strong: {
      en: [
        'unpaid balance', 'unpaid balances', 'show unpaid', 'unpaid',
        'who owes me', 'owes me money', 'owes money', 'money owed',
        'who owes me money', 'customers with balance', 'customers with a balance',
        'outstanding balance', 'outstanding balances', 'balance due', 'balances due',
        'payments due', 'pending payment', 'pending payments', 'accounts receivable',
      ],
      es: [
        'quien me debe', 'quién me debe', 'me debe dinero', 'debe dinero',
        'quien debe', 'quién debe', 'cuanto me deben', 'cuánto me deben',
        'saldo pendiente', 'saldos pendientes', 'clientes con saldo',
        'saldo por cobrar', 'por cobrar', 'cuentas por cobrar', 'pagos pendientes',
      ],
      pt: [
        'em aberto', 'contas em aberto', 'clientes com saldo',
        'quem me deve', 'quem deve', 'a receber', 'contas a receber',
        'saldo devedor', 'pagamentos pendentes',
      ],
    },
    weak: { en: ['owes', 'owed'], es: [], pt: [] },
    notes:
      'Mirrors UNPAID_BALANCES_KEYWORDS (R-INTELLIGENCE-UNPAID-BALANCES-V1). ' +
      "Listed first so anchored AR phrases can never be stolen by the bare 'money'/" +
      "'dinero'/'pending' tokens that live in what_hurting_profit / repairs banks.",
  },

  // ── Customers ────────────────────────────────────────────
  {
    intent: 'least_profitable_customers',
    strong: {
      en: ['worst customer', 'least profitable customer', 'least profitable customers', 'unprofitable customers'],
      es: ['peor cliente', 'cliente menos rentable', 'clientes menos rentables', 'cliente que me cuesta'],
      pt: ['pior cliente', 'cliente menos lucrativo', 'clientes não lucrativos', 'quem me dá prejuízo'],
    },
    notes: 'Before best_customer so "worst/peor/pior cliente" can never fall into the best-customer entry.',
  },
  {
    intent: 'best_customer',
    strong: {
      en: ['best customer', 'top customer', 'my best customer', 'highest value customer'],
      es: ['mejor cliente', 'mi mejor cliente', 'cliente más valioso', 'cliente que más compra'],
      pt: ['melhor cliente', 'meu melhor cliente', 'cliente mais valioso', 'cliente que mais compra'],
    },
    exclusions: ['contact', 'contactar', 'contatar', 'outreach', 'to call', 'llamar', 'ligar'],
    notes:
      'Exclusions formalize a documented collision: "best customer to contact" belongs to the ' +
      'outreach cluster (likely_to_buy_today bank), not the best-customer report. The router ' +
      'currently resolves this only via score/position; here the negative signal is explicit.',
  },
  {
    intent: 'recover_customer',
    strong: {
      en: ['recover customer', 'win back', 'bring back customer', 'lapsed customer', 're-engage', 'inactive customer'],
      es: ['recuperar cliente', 'cliente perdido', 'cliente inactivo', 'reconectar cliente', 'traer de vuelta', 'cliente ausente'],
      pt: ['recuperar cliente', 'cliente inativo', 'trazer de volta'],
    },
    notes: 'Action-anchored (recover/win back). The retrospective "who stopped coming" ask is churn root-cause below.',
  },
  {
    intent: 'customer_churn_root_cause',
    strong: {
      en: ['why customers stopped coming', 'lost customers', 'customers not returning', 'not coming back', 'stopped visiting', 'churn reason'],
      es: ['por qué no regresan clientes', 'clientes perdidos', 'clientes no vuelven', 'no regresan', 'dejaron de venir'],
      pt: ['por que clientes não voltam', 'clientes perdidos', 'não voltam', 'pararam de vir', 'churn clientes'],
    },
    exclusions: ['recover', 'recuperar', 'win back', 'trazer de volta'],
    notes:
      'ES/PT "clientes perdidos" is shared vocabulary with recover_customer (singular "cliente ' +
      'perdido"). recover_customer is listed earlier, so action verbs win; the exclusion keeps ' +
      '"recuperar clientes perdidos" out of the diagnostic entry.',
  },
  {
    intent: 'who_to_contact',
    strong: {
      en: ['who should i contact', 'customers to call', 'who to contact', 'who to call', 'contact customer', 'reach out'],
      es: ['clientes para llamar', 'clientes para contactar', 'contactar cliente', 'a quién llamar', 'a quien llamar', 'quién llamar', 'quien llamar'],
      pt: ['clientes para chamar', 'contatar cliente', 'quem devo contatar'],
    },
    weak: { en: ['contact', 'follow up'], es: ['contactar', 'llamar'], pt: ['contatar'] },
    notes:
      'Generic outreach list only. The today-anchored variants (who_to_contact_today, ' +
      'likely_to_buy_today, who_is_most_likely_to_buy_today, smart_outreach_campaign) are ' +
      'deliberately NOT modeled in V1 — that cluster needs its own consolidation round.',
  },

  // ── Repairs ──────────────────────────────────────────────
  {
    intent: 'repairs_ready',
    strong: {
      en: ['repairs ready', 'ready repairs', 'repairs for pickup', 'ready for pickup'],
      es: ['reparaciones listas', 'reparaciones para recoger', 'listas para recoger'],
      pt: ['reparos prontos', 'reparos para retirada'],
    },
    notes: 'Before repairs_overdue so "ready" phrases never degrade to the overdue list.',
  },
  {
    intent: 'repairs_overdue',
    strong: {
      en: ['overdue repairs', 'repairs overdue', 'late repairs'],
      es: ['reparaciones atrasadas', 'reparación atrasada', 'reparacion atrasada'],
      pt: ['reparos atrasados', 'reparo atrasado'],
    },
    weak: {
      en: ['repairs', 'overdue'],
      es: ['reparaciones', 'atrasadas'],
      pt: ['reparos'],
    },
    exclusions: ['ready', 'listas', 'prontos', 'payment', 'payments', 'pago', 'pagos', 'pagamento', 'pagamentos'],
    notes:
      "Formalizes two documented bare-token hazards from REPAIRS_KEYWORDS: bare 'pending' " +
      '(caught "pending payments") is NOT carried over, and payment-words are explicit ' +
      'negative signals so AR asks can never land on the repairs list.',
  },

  // ── Inventory ────────────────────────────────────────────
  {
    intent: 'restock_opportunity',
    strong: {
      en: ['what should i restock', 'what to restock', 'what should i order', 'what am i running out of', 'restock recommendations', 'restock opportunities', 'what inventory should i buy'],
      es: ['qué debo ordenar', 'que debo ordenar', 'qué debo reponer', 'que debo reponer', 'qué se está acabando', 'que se esta acabando', 'recomendaciones de reorden'],
      pt: ['o que devo repor', 'o que reponho', 'o que devo encomendar', 'o que devo pedir', 'recomendações de reposição', 'recomendacoes de reposicao'],
    },
    notes: 'Action-anchored restock asks. Plain "low stock" stays on inventory_low (below), mirroring the router.',
  },
  {
    intent: 'inventory_low',
    strong: {
      en: ['low stock', 'running out'],
      es: ['stock bajo', 'inventario bajo', 'por acabar'],
      pt: ['estoque baixo'],
    },
    weak: { en: ['reorder'], es: ['falta', 'faltan', 'reorden'], pt: [] },
  },
  {
    intent: 'inventory_dead',
    strong: {
      en: ['dead stock', 'not selling'],
      es: ['stock muerto', 'no se vende', 'no vende', 'sin vender'],
      pt: ['estoque parado', 'produto parado'],
    },
    exclusions: ['why', 'por qué', 'por que', 'porque'],
    notes:
      'The "why"-questions belong to dead_stock_root_cause (not modeled in V1), so a why-signal ' +
      'disqualifies this entry instead of giving a shallow list answer to a diagnostic question.',
  },
  {
    intent: 'top_items',
    strong: {
      en: ['top seller', 'best seller', 'top items'],
      es: ['más vendido', 'mas vendido', 'qué vendo más', 'que vendo mas', 'qué es lo que más vendo', 'que es lo que mas vendo'],
      pt: ['mais vendido', 'o que vendo mais'],
    },
    notes:
      'PT coverage gap fix: TOP_ITEMS_KEYWORDS has no Portuguese phrases, so "mais vendido" ' +
      'currently falls to fallback_question. Added here as a documented vocabulary improvement. ' +
      "ES phrases are anchored with 'más/mas' — the router's bare 'qué vendo' was NOT carried " +
      "over because it substring-collides with push_right_now phrases ('qué vendo hoy').",
  },

  // ── Sales / day state ────────────────────────────────────
  {
    intent: 'today_sales',
    strong: {
      en: ['today sales', 'todays sales', "today's sales", 'sales today', 'revenue today', 'how much did i sell today', 'sales report'],
      es: ['ventas hoy', 'ventas de hoy', 'cuanto vendi hoy', 'cuánto vendí hoy', 'ingresos de hoy', 'reporte de ventas'],
      pt: ['vendas hoje', 'vendas de hoje', 'quanto vendi hoje', 'receita hoje'],
    },
    notes:
      "ES 'cuánto vendí hoy' is also in END_OF_DAY_BRIEF_KEYWORDS — a real dual-membership " +
      'phrase in the router today. Kept here on the sales-of-record intent; the shadow report ' +
      'surfaces the disagreement instead of hiding it.',
  },
  {
    intent: 'end_of_day_brief',
    strong: {
      en: ['end of day', 'end-of-day', 'closing summary', 'closing report', 'how was today', 'how did we do today', 'day recap', 'wrap up'],
      es: ['fin del día', 'fin del dia', 'final del día', 'final del dia', 'cierre del día', 'cierre del dia', 'como me fue hoy', 'cómo me fue hoy', 'como estuvo el día', 'cómo estuvo el día'],
      pt: ['fim do dia', 'final do dia', 'fechamento do dia', 'como foi o dia', 'como foi hoje', 'como foi meu dia'],
    },
  },
  {
    intent: 'trend_direction',
    strong: {
      en: ['sales trend', 'trend report', 'is business improving', 'is business slowing', 'trending up', 'trending down', 'are we growing', 'are we declining', 'revenue trend'],
      es: ['tendencia de ventas', 'reporte de tendencia', 'el negocio está mejorando', 'el negocio esta mejorando', 'estamos mejorando', 'estamos creciendo', 'estamos decayendo', 'tendencia del negocio'],
      pt: ['tendência de vendas', 'tendencia de vendas', 'o negócio está melhorando', 'o negocio esta melhorando', 'estamos crescendo', 'estamos declinando', 'tendência do negócio', 'tendencia do negocio'],
    },
  },
  {
    intent: 'forecast_items',
    strong: {
      en: ['forecast', 'expected sales'],
      es: ['ventas futuras', 'venta futura', 'proyeccion', 'proyección', 'pronostico', 'pronóstico', 'prediccion', 'predicción'],
      pt: ['previsão de vendas', 'previsao de vendas', 'previsão', 'previsao'],
    },
    weak: { en: ['predict', 'projection', 'projected'], es: ['proyecta'], pt: [] },
    notes:
      'PT coverage gap fix: FORECAST_KEYWORDS has no Portuguese phrases ("previsão" currently ' +
      'falls back). Single-word strong tokens are domain-unambiguous in a retail chat context. ' +
      "The router's 'pronostic' substring stem was NOT carried over — it can never match under " +
      'whole-token matching; the strong pronostico/pronóstico forms cover it.',
  },

  // ── Marketing ────────────────────────────────────────────
  {
    intent: 'marketing_campaign',
    strong: {
      en: ['marketing campaign', 'create campaign', 'campaign ideas', 'campaign idea', 'promote products', 'marketing ideas'],
      es: ['crear campaña', 'crear campana', 'promocionar productos', 'campaña', 'campañas'],
      pt: ['criar campanha', 'promover produtos', 'campanha', 'campanhas', 'ideias de campanha'],
    },
    weak: { en: ['marketing'], es: ['mercadeo'], pt: [] },
  },

  // ── Diagnostics ──────────────────────────────────────────
  {
    intent: 'what_hurting_profit',
    strong: {
      en: ['what is wrong', "what's wrong", 'hurting profit', 'hurting profits'],
      es: ['qué está mal', 'que esta mal', 'qué me está costando', 'que me esta costando'],
      pt: ['o que está errado', 'o que esta errado'],
    },
    weak: {
      en: ['profit', 'margin', 'losing', 'hurting'],
      es: ['ganancia', 'margen', 'perdiendo', 'afectando', 'problema'],
      pt: ['lucro', 'margem'],
    },
    exclusions: ['owes', 'owed', 'debe', 'deben', 'deve', 'unpaid', 'saldo', 'balance'],
    notes:
      "Formalizes THE documented bare-token hazard: WHAT_HURTING_PROFIT_KEYWORDS carries bare " +
      "'money'/'dinero', which historically stole \"who owes me money\". Those bare tokens are " +
      'NOT carried over, and AR words are explicit negative signals.',
  },
  {
    intent: 'anomaly_days',
    strong: {
      en: ['unusual day', 'anomaly'],
      es: ['dia raro', 'día raro', 'anomalia', 'anomalía'],
      pt: ['dia estranho', 'anomalia'],
    },
    weak: { en: ['unusual'], es: ['inusual'], pt: [] },
    notes: 'PT "dia estranho" added (bank has no PT phrase; "anomalia" is shared ES/PT spelling).',
  },

  // ── Help — last (generic) ────────────────────────────────
  {
    intent: 'help',
    strong: {
      en: ['help', 'what can you do', 'what can you', 'commands'],
      es: ['ayuda', 'qué puedes', 'que puedes', 'comandos'],
      pt: ['ajuda', 'o que você pode fazer', 'comandos'],
    },
    notes: 'PT "ajuda" added (HELP_KEYWORDS has no PT token). Kept last: pure meta-intent.',
  },
];

/** Total phrase count across strong + weak + exclusions (registry stats). */
export function vocabularyStats(): { entries: number; strong: number; weak: number; exclusions: number } {
  let strong = 0, weak = 0, exclusions = 0;
  for (const e of INTENT_VOCABULARY) {
    strong += e.strong.en.length + e.strong.es.length + e.strong.pt.length;
    if (e.weak) weak += e.weak.en.length + e.weak.es.length + e.weak.pt.length;
    if (e.exclusions) exclusions += e.exclusions.length;
  }
  return { entries: INTENT_VOCABULARY.length, strong, weak, exclusions };
}
