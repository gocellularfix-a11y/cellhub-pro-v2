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
  | 'what_hurting_profit'
  | 'product_opportunities'
  | 'root_cause'
  | 'slow_day_root_cause'
  | 'dead_stock_root_cause'
  | 'customer_churn_root_cause'
  | 'help'
  | 'unknown';

export interface IntentMatch {
  id: IntentId;
  confidence: number;              // 0..1 (keyword count / total)
  extractedName?: string;          // resolved customer name fragment
  matchedCustomer?: Customer;      // fuzzy-matched customer if applicable
  candidateCustomers?: Customer[]; // when >1 match → disambiguate
}

// ── Keyword banks ───────────────────────────────────────────

const CUSTOMER_KEYWORDS = [
  'historial', 'history', 'cliente', 'customer',
  'gastado', 'spent', 'ganado con', 'earned from',
  'cuanto', 'cuánto', 'how much',
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
    { id: 'customer_history', score: scoreKeywords(query, CUSTOMER_KEYWORDS) },
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
    return { id: 'unknown', confidence: 0 };
  }

  const confidence = Math.min(1, winner.score / 2);
  const result: IntentMatch = { id: winner.id, confidence };

  // For customer_history intent, resolve the name.
  if (winner.id === 'customer_history') {
    const allBanks = [
      CUSTOMER_KEYWORDS, SALES_KEYWORDS, INVENTORY_LOW_KEYWORDS,
      INVENTORY_DEAD_KEYWORDS, INVENTORY_DYING_KEYWORDS, TOP_ITEMS_KEYWORDS,
      REPAIRS_KEYWORDS, HEALTH_KEYWORDS, FORECAST_KEYWORDS,
      ANOMALY_KEYWORDS, WHO_TO_CONTACT_KEYWORDS, WHAT_HURTING_PROFIT_KEYWORDS,
      PRODUCT_OPPORTUNITY_KEYWORDS, ROOT_CAUSE_KEYWORDS, SLOW_DAY_ROOT_CAUSE_KEYWORDS,
      DEAD_STOCK_ROOT_CAUSE_KEYWORDS, CUSTOMER_CHURN_KEYWORDS, HELP_KEYWORDS,
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

  return result;
}
