// ============================================================
// CellHub Intelligence — Chat Intent Router
// R-INTEL-CHAT-F5
//
// Keyword-based intent classifier. No LLM — pattern matching + entity
// extraction. Covers ~80% of common shop questions deterministically.
// Unknown queries fall back to a help message listing supported intents.
//
// Philosophy:
//   - Cheap to run, works offline, no API cost
//   - Predictable: same question → same answer
//   - Extensible: add new intents by appending to INTENTS array
//   - Bilingual (EN + ES) via shared keyword arrays
// ============================================================

import type { Customer } from '@/store/types';
import { matchesSearch } from '@/utils/fuzzyMatch';

export interface IntentContext {
  query: string;           // raw user input
  queryLower: string;      // lowercased for matching
  lang: 'en' | 'es' | 'pt';
  customers: Customer[];   // for name resolution
}

export type IntentId =
  | 'best_customer'
  | 'least_profitable_customers'
  | 'daily_brief'
  | 'today_summary'
  | 'multi_phone_customers'
  | 'customer_history'
  | 'sales_summary'
  | 'inventory_low'
  | 'inventory_dead'
  | 'inventory_dying'
  | 'top_items'
  | 'repairs_overdue'
  | 'health_check'
  | 'forecast_items'
  | 'anomaly_days'
  | 'who_to_contact'
  | 'who_to_contact_today'
  | 'marketing_campaign'
  | 'product_push'
  | 'what_hurting_profit'
  | 'product_opportunities'
  | 'root_cause'
  | 'slow_day_root_cause'
  | 'dead_stock_root_cause'
  | 'customer_churn_root_cause'
  | 'help'
  | 'data_query'
  // R-INTEL-FALLBACK-OPEN-QUESTIONS: deterministic open-ended fallback
  // for queries that don't trigger any keyword bank. Builds an answer
  // from existing engine data (no external AI). 'unknown' kept in the
  // union as a defensive default in the handler switch.
  | 'fallback_question'
  | 'unknown';

export interface IntentMatch {
  id: IntentId;
  confidence: number;              // 0..1 (keyword count / total)
  extractedName?: string;          // resolved customer name fragment
  matchedCustomer?: Customer;      // fuzzy-matched customer if applicable
  candidateCustomers?: Customer[]; // when >1 match → disambiguate
  // R-INTEL-PRODUCT-PUSH-ENGINE: extracted product fragment from queries
  // like "promote this product Galaxy S24" or "vender este producto iPhone".
  extractedProduct?: string;
  // R-INTEL-FALLBACK-QUESTION-AWARE: raw query passed through to the
  // fallback handler so it can detect topic keywords (day/product/customer/
  // why/time) and tailor the response. Populated only for fallback_question.
  query?: string;
}

// ── Keyword banks ───────────────────────────────────────────

const BEST_CUSTOMER_KEYWORDS = [
  // EN
  'best customer', 'top customer', 'my best customer', 'highest value customer',
  // ES
  'mi mejor cliente', 'mejor cliente', 'cliente más valioso', 'cliente que más compra',
  // PT
  'melhor cliente', 'meu melhor cliente', 'cliente mais valioso', 'cliente que mais compra',
];

// R-INTENT-LEAST-PROFITABLE: actionable bottom-3 ranked by profit ASC.
// Routes "worst customer" / "peor cliente" / "pior cliente" verbiage to a
// non-judgmental margin-review answer. Listed BEFORE customer_history so a
// query like "peor cliente" doesn't get treated as a name lookup.
const LEAST_PROFITABLE_KEYWORDS = [
  // EN
  'worst customer', 'least profitable customer', 'least profitable customers',
  'unprofitable customers', 'who is losing me money',
  // ES
  'peor cliente', 'cliente menos rentable', 'clientes menos rentables',
  'cliente que me cuesta',
  // PT
  'pior cliente', 'cliente menos lucrativo', 'clientes não lucrativos',
  'quem me dá prejuízo',
];

const CUSTOMER_KEYWORDS = [
  'historial', 'history', 'cliente', 'customer',
  'gastado', 'spent', 'ganado con', 'earned from',
  'cuanto', 'cuánto', 'how much',
];

// R-INTEL-MULTI-PHONE-CUSTOMERS: deterministic count intent. Listed BEFORE
// customer_history in the scores array so phrases like "customers with
// multiple phone numbers" don't get swallowed by the generic name lookup.
// Multi-phrase keyword bank ensures plenty of overlap on natural variants.
const MULTI_PHONE_CUSTOMERS_KEYWORDS = [
  // EN
  'customers with multiple phone',
  'customers with more than one number',
  'customers with more than 1 phone',
  'customers with more than 1 number',
  'customers with multiple numbers',
  'customers with multiple phones',
  'how many customers have more than one number',
  'how many customers have multiple phones',
  'how many customers have more than 1 phone',
  'multiple phone numbers',
  'more than one phone',
  'more than 1 phone',
  'more than one number',
  'more than 1 number',
  // ES
  'clientes con más de un número',
  'clientes con mas de un numero',
  'cuantos clientes tienen más de un número',
  'cuántos clientes tienen más de un número',
  'cuantos clientes tienen mas de un numero',
  'clientes con múltiples teléfonos',
  'clientes con multiples telefonos',
  'más de un número',
  'mas de un numero',
  'múltiples teléfonos',
  'multiples telefonos',
  // PT
  'clientes com mais de um número',
  'clientes com mais de um numero',
  'quantos clientes têm mais de um telefone',
  'quantos clientes tem mais de um telefone',
  'mais de um telefone',
  'mais de um número',
  'mais de um numero',
  'múltiplos telefones',
  'multiplos telefones',
];

// R-INTELLIGENCE-CHAT-TODAY-UX-TWEAK: today-anchored business questions.
// Listed BEFORE sales_summary in the scores array so phrases like "hoy" /
// "como estamos hoy" / "today" / "today sales" route here (today-only
// metrics) instead of the generic last-30-days summary. SALES_KEYWORDS
// still includes 'hoy'/'today' for tie-handling on ambiguous queries —
// list-order tie-break preserves TODAY priority.
const TODAY_SUMMARY_KEYWORDS = [
  // EN
  'how are we today', 'how are we doing today', 'today sales', 'sales today',
  'how is today', 'how is today going', 'today',
  // ES
  'hoy', 'cómo estamos hoy', 'como estamos hoy',
  'cómo va hoy', 'como va hoy', 'ventas de hoy', 'qué tal hoy', 'que tal hoy',
  // PT
  'hoje', 'como estamos hoje', 'vendas de hoje',
  'como vai hoje', 'como está hoje', 'como esta hoje',
];

// R-DAILY-BRIEF-HANDLER-V1: composer intent — anchored phrases route here
// before plain "today" / "hoy" so the multi-signal brief wins over the
// single-KPI today_summary when the cashier explicitly asks for a brief.
const DAILY_BRIEF_KEYWORDS = [
  // EN
  'daily brief', 'morning briefing', 'what should i do today',
  // ES
  'resumen diario', 'qué hago hoy', 'que hago hoy',
  // PT
  'resumo diário', 'resumo diario', 'o que fazer hoje',
];

const SALES_KEYWORDS = [
  'ventas', 'sales', 'ingresos', 'revenue',
  'hoy', 'today', 'semana', 'week', 'mes', 'month',
  'van las ventas', 'how are sales',
];

const INVENTORY_LOW_KEYWORDS = [
  'falta', 'faltan', 'low stock', 'stock bajo',
  'reorden', 'reorder', 'running out', 'por acabar',
];

const INVENTORY_DEAD_KEYWORDS = [
  'no se vende', 'no vende', 'dead stock', 'stock muerto',
  'muerto', 'sin vender',
];

const INVENTORY_DYING_KEYWORDS = [
  'perdiendo', 'losing momentum', 'dying',
  'bajando', 'velocidad',
];

const TOP_ITEMS_KEYWORDS = [
  'vendo mas', 'vendo más', 'top seller', 'best seller',
  'más vendido', 'mas vendido', 'qué vendo', 'que vendo',
  'top items',
];

const REPAIRS_KEYWORDS = [
  'reparaciones', 'repairs', 'atrasadas', 'overdue',
  'pendientes', 'pending', 'reparacion', 'reparación',
];

const HEALTH_KEYWORDS = [
  'cómo está', 'como esta', 'how is', 'estado de la tienda',
  'health', 'salud', 'store health', 'resumen', 'summary',
];

const FORECAST_KEYWORDS = [
  'proyeccion', 'proyección', 'forecast', 'pronostico',
  'pronóstico', 'predice', 'predict',
];

const ANOMALY_KEYWORDS = [
  'anomalia', 'anomalía', 'anomaly', 'dia raro', 'día raro',
  'unusual', 'inusual',
];

const WHAT_HURTING_PROFIT_KEYWORDS = [
  'profit', 'ganancia', 'margen', 'margin', 'perdiendo', 'losing',
  'qué está mal', 'que esta mal', 'what is wrong', "what's wrong",
  'hurting', 'afectando', 'daña', 'problema', 'dinero', 'money',
  'qué me está costando', 'que me esta costando',
];

const WHO_TO_CONTACT_KEYWORDS = [
  'llamar', 'contactar', 'contact', 'reach out', 'follow up',
  'quién llamar', 'quien llamar', 'who should', 'a quién', 'a quien',
  'clientes que', 'customers to', 'follow-up', 'no han venido', 'not visited',
];

// R-INTEL-WHO-TO-CONTACT-TODAY: more-specific intent than WHO_TO_CONTACT.
// Triggered when the question explicitly anchors on "today/hoy/hoje" — used
// to surface a deterministic top-3 ranked outreach list (handler scores by
// spend + recency + frequency, see handleWhoToContactToday). Listed BEFORE
// customer_history in the scores array to win ties against the generic
// customer-name detection.
const WHO_TO_CONTACT_TODAY_KEYWORDS = [
  // EN
  'who should i contact today', 'who should i call today', 'who can i sell to today',
  'customers to contact', 'who to contact today', 'who to call today',
  'contact today', 'call today',
  // ES
  'a quien contacto hoy', 'a quién contacto hoy', 'a quien le escribo hoy', 'a quién le escribo hoy',
  'clientes para contactar hoy', 'quien me puede comprar hoy', 'quién me puede comprar hoy',
  'a quien llamo hoy', 'a quién llamo hoy', 'contactar hoy',
  // PT
  'quem devo contatar hoje', 'clientes para contatar hoje', 'para quem vender hoje',
  'quem contatar hoje', 'quem ligar hoje', 'contatar hoje',
];

// R-INTEL-PRODUCT-PUSH-ENGINE: single-product outreach intent. Triggered
// by phrases like "promote this product X". Singular product wording (vs
// MARKETING_KEYWORDS which uses plural "products/productos") so the two
// intents disambiguate naturally on count of keyword hits. Listed BEFORE
// marketing_campaign and product_opportunities in the scores array so a
// query containing both "promote" and a product name routes here.
const PRODUCT_PUSH_KEYWORDS = [
  // EN
  'promote this product', 'push this product', 'sell this product',
  'i want to move this item', 'move this item', 'push product',
  'promote item', 'sell item',
  // ES
  'quiero vender este producto', 'empujar producto', 'sacar este producto',
  'promocionar producto', 'vender producto', 'mover este producto',
  // PT
  'promover produto', 'vender este produto', 'empurrar produto',
  'mover produto', 'vender produto',
];

// R-INTEL-MARKETING-ENGINE-V1: marketing-campaign intent. Listed BEFORE
// product_opportunities in the scores array so phrases like "promote products"
// route to the marketing engine (deterministic 3-campaign output) rather than
// to the product-opportunity drilldown. Single-word "marketing/mercadeo/
// campanha" triggers the intent on its own.
const MARKETING_KEYWORDS = [
  // EN
  'marketing', 'create campaign', 'campaign ideas', 'campaign idea',
  'who should i market to', 'who to market to', 'promote products',
  'marketing campaign', 'marketing ideas',
  // ES
  'mercadeo', 'campaña', 'crear campaña', 'crear campana',
  'a quien le hago marketing', 'a quién le hago marketing',
  'promocionar productos', 'campañas',
  // PT
  'campanha', 'criar campanha', 'promover produtos',
  'campanhas', 'ideias de campanha',
];

const PRODUCT_OPPORTUNITY_KEYWORDS = [
  'opportunity', 'oportunidad', 'opportunities', 'oportunidades',
  'promote', 'promover', 'promotion', 'promocion', 'promoción',
  'bundle', 'upsell', 'cross-sell',
  'what to promote', 'qué promover', 'que promover',
  'what to discount', 'qué descontar', 'que descontar',
  'high margin', 'alto margen',
  'what products', 'qué productos', 'que productos',
  'product opportunity', 'oportunidad de producto',
];

const ROOT_CAUSE_KEYWORDS = [
  // EN
  'why revenue', 'why are sales', 'why sales down', 'why is revenue',
  'what happened to sales', 'root cause', 'revenue decline', 'sales decline',
  // ES
  'por qué bajaron', 'porque bajaron', 'qué pasó con ventas', 'qué pasó con las ventas',
  'causa raíz', 'causa raiz', 'por qué cayeron', 'bajaron las ventas', 'cayeron las ventas',
  // PT
  'por que as vendas', 'o que aconteceu com', 'queda nas vendas', 'causa raiz das vendas',
];

const SLOW_DAY_ROOT_CAUSE_KEYWORDS = [
  // EN
  'why is sunday', 'why is monday', 'why is tuesday', 'why is wednesday',
  'why is thursday', 'why is friday', 'why is saturday',
  'why slowest day', 'slow day reason', 'slow day why', 'why my slowest',
  // ES
  'por qué domingo', 'por qué lunes', 'por qué martes', 'por qué miércoles',
  'por qué jueves', 'por qué viernes', 'por qué sábado',
  'por qué mi día lento', 'causa del día lento', 'día lento por qué',
  // PT
  'por que domingo', 'por que segunda', 'por que terça', 'por que quarta',
  'por que quinta', 'por que sexta', 'por que sábado',
  'dia mais fraco', 'por que meu dia fraco',
];

const DEAD_STOCK_ROOT_CAUSE_KEYWORDS = [
  // EN
  'why not selling', 'not selling reason', 'dead stock reason', 'dead stock cause',
  'dead stock diagnosis', 'item not moving', 'inventory diagnosis', 'why is inventory dead',
  // ES
  'por qué no se vende', 'inventario muerto por qué', 'causa del muerto',
  'inventario estancado', 'artículo estancado', 'diagnóstico de inventario',
  // PT
  'por que não vende', 'estoque parado', 'produto parado', 'diagnóstico de estoque',
];

const CUSTOMER_CHURN_KEYWORDS = [
  // EN
  'why customers stopped coming', 'lost customers', 'churn reason',
  'customers not returning', 'not coming back', 'stopped visiting',
  // ES
  'por qué no regresan clientes', 'clientes perdidos', 'clientes no vuelven',
  'no regresan', 'dejaron de venir',
  // PT
  'por que clientes não voltam', 'clientes perdidos', 'churn clientes',
  'não voltam', 'pararam de vir',
];

// R-INTEL-CELLHUB-DATA-ACCESS-LAYER: universal "show me data" intent.
// Catches operational metrics queries that don't fit the other intents:
// "how many", "show me", "qué reparaciones están listas", "phone payments
// today", "low stock", "top customers", etc. Listed AFTER the high-priority
// intents (today_summary, product_push, who_to_contact_today, etc.) but
// BEFORE customer_history / sales_summary / fallback_question so generic
// data questions don't get swallowed by the name-lookup or last-30-days
// summary path.
const DATA_QUERY_KEYWORDS = [
  // EN
  'show me', 'how much', 'how many', 'what did we sell',
  'sales today', 'sales yesterday', 'sales this week', 'sales this month',
  'profit today', 'profit yesterday',
  'repairs ready', 'ready repairs', 'pending layaways',
  'low stock', 'dead stock', 'top customers', 'best customers',
  'phone payments', 'unlocks today',
  'inactive customers',
  // ES
  'cuánto', 'cuanto', 'cuántos', 'cuantos',
  'qué vendimos', 'que vendimos',
  'ventas de hoy', 'ventas de ayer', 'ventas esta semana', 'ventas este mes',
  'ganancia de hoy',
  'reparaciones listas', 'reparaciones están listas', 'reparaciones estan listas',
  'layaways pendientes', 'apartados pendientes',
  'bajo inventario', 'productos bajos', 'inventario bajo',
  'productos muertos', 'stock muerto',
  'mejores clientes',
  'pagos de teléfono', 'pagos de telefono',
  'clientes inactivos',
  // R-DATA-EXPENSE-ACCESS-V1: expense triggers (EN already covered by 'how much')
  'expenses', 'spend', 'how much did i spend',
  // ES
  'gastos', 'cuanto gaste', 'cuánto gasté', 'cuanto gasté',
  // PT
  'quanto', 'quantos',
  'vendas de hoje', 'vendas de ontem', 'vendas desta semana',
  'reparos prontos', 'estoque baixo', 'estoque parado',
  'melhores clientes', 'clientes inativos',
  'pagamentos de telefone',
  // R-DATA-EXPENSE-ACCESS-V1: PT expense triggers
  'despesas', 'quanto gastei',
];

const HELP_KEYWORDS = [
  'ayuda', 'help', 'que puedes', 'qué puedes', 'what can you',
  'comandos', 'commands',
];

// Strip punctuation + lowercase for matching.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Count how many keywords from a bank appear in the query.
function scoreKeywords(query: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    if (query.includes(kw)) hits += 1;
  }
  return hits;
}

// Extract a name fragment from queries like "historial de juan", "cuanto ha
// gastado pedro", "juan history". Returns the longest non-keyword fragment
// in the query, or null.
function extractName(query: string, allKeywords: string[][]): string | null {
  // Flatten all keyword banks into a stop list.
  const stop = new Set(['de', 'del', 'the', 'of', 'from', 'para', 'for', 'con', 'with', 'a', 'en', 'in']);
  for (const bank of allKeywords) {
    for (const kw of bank) {
      for (const word of kw.split(' ')) {
        stop.add(word);
      }
    }
  }

  const tokens = query.split(/\s+/).filter(t => t.length > 0);
  // Candidate = longest contiguous run of non-stop tokens.
  let best = '';
  let current = '';
  for (const tok of tokens) {
    if (stop.has(tok)) {
      if (current.length > best.length) best = current;
      current = '';
    } else {
      current = current ? `${current} ${tok}` : tok;
    }
  }
  if (current.length > best.length) best = current;
  return best.trim().length >= 2 ? best.trim() : null;
}

// ── Main entry ──────────────────────────────────────────────

export function classifyIntent(
  rawQuery: string,
  customers: Customer[],
  lang: 'en' | 'es' | 'pt' = 'en',
): IntentMatch {
  const query = normalize(rawQuery);
  const ctx: IntentContext = { query: rawQuery, queryLower: query, lang, customers };
  void ctx;

  // Score each intent bank.
  const scores: Array<{ id: IntentId; score: number }> = [
    { id: 'best_customer',    score: scoreKeywords(query, BEST_CUSTOMER_KEYWORDS) },
    // R-INTENT-LEAST-PROFITABLE: scored before customer_history so phrases
    // like "peor cliente" route to the margin-review handler, not name lookup.
    { id: 'least_profitable_customers', score: scoreKeywords(query, LEAST_PROFITABLE_KEYWORDS) },
    // R-INTEL-MULTI-PHONE-CUSTOMERS: must run BEFORE customer_history so
    // phrases like "customers with multiple phone numbers" don't fall
    // through to the generic name-lookup path (which would extract a
    // garbage name fragment and miss the count). List order also breaks
    // score ties.
    { id: 'multi_phone_customers', score: scoreKeywords(query, MULTI_PHONE_CUSTOMERS_KEYWORDS) },
    // R-INTEL-WHO-TO-CONTACT-TODAY: must run BEFORE customer_history so the
    // generic customer-name detection doesn't swallow "a quien contacto hoy"
    // into a (failed) name lookup. List order also breaks score ties.
    { id: 'who_to_contact_today', score: scoreKeywords(query, WHO_TO_CONTACT_TODAY_KEYWORDS) },
    // R-INTEL-PRODUCT-PUSH-ENGINE: must run BEFORE marketing_campaign and
    // product_opportunities so phrases like "promote this product Galaxy"
    // route here (singular product). marketing_campaign keeps the plural
    // "promote products" / "promocionar productos" path. List order also
    // breaks score ties.
    { id: 'product_push', score: scoreKeywords(query, PRODUCT_PUSH_KEYWORDS) },
    // R-INTEL-MARKETING-ENGINE-V1: also before customer_history (broad
    // single-word "marketing/mercadeo" triggers) and before product_opportunities
    // (keyword overlap on "promote/promover" — we want marketing engine on phrases
    // like "promote products"; product_opportunities still wins on "what to promote").
    { id: 'marketing_campaign', score: scoreKeywords(query, MARKETING_KEYWORDS) },
    // R-INTEL-CELLHUB-DATA-ACCESS-LAYER: universal data query — runs AFTER
    // the high-priority specific intents above and BEFORE customer_history
    // and sales_summary so operational metrics ("low stock", "ready repairs",
    // "phone payments today", etc.) don't get swallowed by name lookup or
    // the generic 30-day sales summary.
    { id: 'data_query', score: scoreKeywords(query, DATA_QUERY_KEYWORDS) },
    { id: 'customer_history', score: scoreKeywords(query, CUSTOMER_KEYWORDS) },
    // R-DAILY-BRIEF-HANDLER-V1: scored ABOVE today_summary so anchored phrases
    // ("daily brief", "resumen diario", "o que fazer hoje") route to the
    // multi-signal composer. Plain "today"/"hoy"/"hoje" still falls to
    // today_summary because DAILY_BRIEF_KEYWORDS only contains anchored phrases.
    { id: 'daily_brief',   score: scoreKeywords(query, DAILY_BRIEF_KEYWORDS) },
    // R-INTELLIGENCE-CHAT-TODAY-UX-TWEAK: must run BEFORE sales_summary so
    // queries like "hoy" / "como estamos hoy" route to today-only metrics.
    // Both banks include 'hoy'/'today' — list-order tie-break wins for TODAY.
    { id: 'today_summary', score: scoreKeywords(query, TODAY_SUMMARY_KEYWORDS) },
    { id: 'sales_summary', score: scoreKeywords(query, SALES_KEYWORDS) },
    { id: 'inventory_low', score: scoreKeywords(query, INVENTORY_LOW_KEYWORDS) },
    { id: 'inventory_dead', score: scoreKeywords(query, INVENTORY_DEAD_KEYWORDS) },
    { id: 'inventory_dying', score: scoreKeywords(query, INVENTORY_DYING_KEYWORDS) },
    { id: 'top_items', score: scoreKeywords(query, TOP_ITEMS_KEYWORDS) },
    { id: 'repairs_overdue', score: scoreKeywords(query, REPAIRS_KEYWORDS) },
    { id: 'health_check', score: scoreKeywords(query, HEALTH_KEYWORDS) },
    { id: 'forecast_items', score: scoreKeywords(query, FORECAST_KEYWORDS) },
    { id: 'anomaly_days', score: scoreKeywords(query, ANOMALY_KEYWORDS) },
    { id: 'who_to_contact', score: scoreKeywords(query, WHO_TO_CONTACT_KEYWORDS) },
    { id: 'what_hurting_profit', score: scoreKeywords(query, WHAT_HURTING_PROFIT_KEYWORDS) },
    { id: 'product_opportunities', score: scoreKeywords(query, PRODUCT_OPPORTUNITY_KEYWORDS) },
    { id: 'root_cause', score: scoreKeywords(query, ROOT_CAUSE_KEYWORDS) },
    { id: 'slow_day_root_cause', score: scoreKeywords(query, SLOW_DAY_ROOT_CAUSE_KEYWORDS) },
    { id: 'dead_stock_root_cause', score: scoreKeywords(query, DEAD_STOCK_ROOT_CAUSE_KEYWORDS) },
    { id: 'customer_churn_root_cause', score: scoreKeywords(query, CUSTOMER_CHURN_KEYWORDS) },
    { id: 'help', score: scoreKeywords(query, HELP_KEYWORDS) },
  ];

  // Highest score wins. Ties broken by list order (earlier = more specific).
  scores.sort((a, b) => b.score - a.score);
  const winner = scores[0];

  if (winner.score === 0) {
    // R-INTEL-FALLBACK-OPEN-QUESTIONS: when no keyword bank matches,
    // route to the deterministic fallback handler instead of the
    // legacy 'unknown' help message. Known intents still win above
    // (we only land here when every bank scored zero), so deterministic
    // priority is preserved.
    // R-INTEL-FALLBACK-QUESTION-AWARE: pass through the raw query so the
    // handler can detect topic keywords and tailor the response.
    return { id: 'fallback_question', confidence: 0, query: rawQuery };
  }

  const confidence = Math.min(1, winner.score / 2);
  const result: IntentMatch = { id: winner.id, confidence };

  // For customer_history intent, resolve the name.
  if (winner.id === 'customer_history') {
    const allBanks = [
      BEST_CUSTOMER_KEYWORDS, LEAST_PROFITABLE_KEYWORDS, MULTI_PHONE_CUSTOMERS_KEYWORDS, CUSTOMER_KEYWORDS, DAILY_BRIEF_KEYWORDS, TODAY_SUMMARY_KEYWORDS, SALES_KEYWORDS, INVENTORY_LOW_KEYWORDS,
      INVENTORY_DEAD_KEYWORDS, INVENTORY_DYING_KEYWORDS, TOP_ITEMS_KEYWORDS,
      REPAIRS_KEYWORDS, HEALTH_KEYWORDS, FORECAST_KEYWORDS,
      ANOMALY_KEYWORDS, WHO_TO_CONTACT_KEYWORDS, WHO_TO_CONTACT_TODAY_KEYWORDS, MARKETING_KEYWORDS, PRODUCT_PUSH_KEYWORDS, WHAT_HURTING_PROFIT_KEYWORDS,
      PRODUCT_OPPORTUNITY_KEYWORDS, ROOT_CAUSE_KEYWORDS, SLOW_DAY_ROOT_CAUSE_KEYWORDS,
      DEAD_STOCK_ROOT_CAUSE_KEYWORDS, CUSTOMER_CHURN_KEYWORDS, DATA_QUERY_KEYWORDS, HELP_KEYWORDS,
    ];
    const nameFragment = extractName(query, allBanks);
    if (nameFragment) {
      result.extractedName = nameFragment;
      const matches = customers
        .filter((c) => matchesSearch(nameFragment, c.name, c.phone, (c as { customerNumber?: string }).customerNumber))
        .slice(0, 5);
      if (matches.length === 1) {
        result.matchedCustomer = matches[0];
      } else if (matches.length > 1) {
        result.candidateCustomers = matches;
      }
    }
  }

  // R-INTEL-PRODUCT-PUSH-ENGINE: extract the product fragment from queries
  // like "promote this product Galaxy S24" so the handler can both build a
  // targeted message ("we just got Galaxy S24") and label the queue reason.
  // Reuses extractName: flattens every keyword bank into stop words and
  // returns the longest non-stop fragment — that's the product name.
  if (winner.id === 'product_push') {
    const allBanks = [
      BEST_CUSTOMER_KEYWORDS, LEAST_PROFITABLE_KEYWORDS, MULTI_PHONE_CUSTOMERS_KEYWORDS, CUSTOMER_KEYWORDS, DAILY_BRIEF_KEYWORDS, TODAY_SUMMARY_KEYWORDS, SALES_KEYWORDS, INVENTORY_LOW_KEYWORDS,
      INVENTORY_DEAD_KEYWORDS, INVENTORY_DYING_KEYWORDS, TOP_ITEMS_KEYWORDS,
      REPAIRS_KEYWORDS, HEALTH_KEYWORDS, FORECAST_KEYWORDS,
      ANOMALY_KEYWORDS, WHO_TO_CONTACT_KEYWORDS, WHO_TO_CONTACT_TODAY_KEYWORDS, MARKETING_KEYWORDS, PRODUCT_PUSH_KEYWORDS, WHAT_HURTING_PROFIT_KEYWORDS,
      PRODUCT_OPPORTUNITY_KEYWORDS, ROOT_CAUSE_KEYWORDS, SLOW_DAY_ROOT_CAUSE_KEYWORDS,
      DEAD_STOCK_ROOT_CAUSE_KEYWORDS, CUSTOMER_CHURN_KEYWORDS, DATA_QUERY_KEYWORDS, HELP_KEYWORDS,
    ];
    const productFragment = extractName(query, allBanks);
    if (productFragment) result.extractedProduct = productFragment;
  }

  return result;
}
