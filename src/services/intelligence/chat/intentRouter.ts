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
  | 'action_impact'
  | 'action_learning'
  | 'propose_deal'
  | 'deal_performance'
  | 'proactive_opportunities'
  | 'conversation_runner'
  | 'daily_operator_brief'
  | 'today_money_map'
  | 'operator_mode'
  | 'proposal_followup'
  | 'deal_pipeline'
  | 'mark_deal_stage'
  | 'close_today'
  | 'daily_revenue_missions'
  | 'today_sales'
  | 'today_summary'
  | 'multi_phone_customers'
  | 'customer_history'
  | 'sales_summary'
  | 'inventory_low'
  | 'inventory_dead'
  | 'inventory_dying'
  | 'top_items'
  | 'repairs_overdue'
  | 'repairs_ready'
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
  // R-INTELLIGENCE-TREND-DIRECTION-V1: is the store improving/declining/stable?
  | 'trend_direction'
  // R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1: ranked operator action list
  | 'proactive_operations'
  // R-INTELLIGENCE-AUTOMATED-EXECUTION-V1: execution-ready message queue
  | 'execution_queue'
  // R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1: pre-shift operational briefing
  | 'morning_digest'
  // R-INTEL-FALLBACK-OPEN-QUESTIONS: deterministic open-ended fallback
  // for queries that don't trigger any keyword bank. Builds an answer
  // from existing engine data (no external AI). 'unknown' kept in the
  // union as a defensive default in the handler switch.
  // R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1: cross-module actionable opportunity intents
  | 'what_to_do_today'
  | 'where_losing_money'
  | 'what_needs_attention'
  // R-INTELLIGENCE-CONTEXT-AWARE-V1: active-entity context query
  | 'active_context_query'
  // R-INTELLIGENCE-MANAGER-QUEUE-V1
  | 'manager_queue'
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

// R-INTELLIGENCE-ACTION-IMPACT-TRACKING-V1: anchored phrasing for action
// outcome query — "action impact" / "resultado de acciones" / "impacto ações".
const ACTION_IMPACT_KEYWORDS = [
  // EN
  'action impact', 'how much did actions generate', 'actions generated',
  'action results', 'action conversion',
  // ES
  'resultado de acciones', 'resultado acciones', 'impacto acciones',
  'cuanto generaron las acciones', 'cuánto generaron las acciones',
  // PT
  'resultado ações', 'resultado de ações', 'impacto ações',
  'quanto as ações geraram',
];

// R-INTELLIGENCE-PENDING-DEAL-V1: anchored phrasing for owner-mediated deal
// drafting. Trigger phrase is followed by customer name + product + price
// in the user's free-form query — handler does the parsing.
const PROPOSE_DEAL_KEYWORDS = [
  // EN
  'propose deal', 'make offer', 'send offer', 'offer deal',
  // ES
  'hacer oferta', 'proponer oferta', 'mandar oferta', 'ofertar',
  // PT
  'fazer oferta', 'propor oferta', 'enviar oferta',
];

// R-INTELLIGENCE-PROACTIVE-OPPORTUNITIES-V1: broad "what should I focus on"
// trigger. Composes 1-3 ranked operator opportunities from existing engine
// helpers (dead stock, stale repairs, outreach, product push, pending
// deals). Listed BEFORE product_opportunities in the scores array so a
// generic "opportunities" query routes to the multi-source briefing.
// R-INTELLIGENCE-CONVERSATION-RUNNER-V1: paste-customer-reply trigger.
// Catches both explicit "owner is reporting a customer reply" prefixes
// ("he said", "customer said", "respondió") AND common pasted reply
// phrases ("how much", "lowest", "interested"). The handler runs a
// deterministic regex classifier — no AI, no agents.
const CONVERSATION_RUNNER_KEYWORDS = [
  // Explicit reporting prefixes — EN
  'he said', 'she said', 'they said', 'customer said', 'they replied',
  'they asked', 'they want', 'reply was', 'their reply',
  // ES
  'respondió', 'respondio', 'contestó', 'contesto', 'me dijo',
  'el cliente dijo', 'la cliente dijo', 'ella dijo', 'él dijo', 'el dijo',
  'el cliente respondió', 'la cliente respondió',
  // PT
  'ele respondeu', 'ela respondeu', 'cliente respondeu', 'eles responderam',
  'me disse', 'o cliente disse', 'a cliente disse',
  // Common pasted-reply cues — EN
  'how much', "what's the lowest", 'whats the lowest', 'can you do better',
  'too expensive', 'too pricey', 'too much', 'maybe later',
  'send pics', 'send photos', 'where are you located',
  'can you hold it', 'hold it for me', "i'll take it", 'ill take it',
  // ES
  'cuánto cuesta', 'cuanto cuesta', 'qué precio', 'que precio',
  'lo más bajo', 'lo mas bajo', 'precio más bajo', 'precio mas bajo',
  'muy caro', 'demasiado caro', 'tal vez después', 'tal vez despues',
  'mándame fotos', 'mandame fotos', 'envíame fotos', 'enviame fotos',
  'dónde están', 'donde estan', 'me lo llevo', 'lo quiero',
  'guárdamelo', 'guardamelo', 'resérvalo', 'reservalo',
  // PT
  'quanto custa', 'qual o preço', 'qual o preco',
  'mais barato', 'pode fazer melhor',
  'muito caro', 'caro demais', 'talvez depois',
  'manda fotos', 'envie fotos',
  'onde fica', 'onde estão', 'onde estao',
  'vou levar', 'eu levo', 'guarda pra mim', 'reserva pra mim',
];

const PROACTIVE_OPPORTUNITIES_KEYWORDS = [
  // EN
  'opportunity', 'opportunities',
  'what opportunities', 'what opportunities do i have',
  'how can i make more money', 'make more money',
  'what should i push',
  'what can i recover',
  'what can improve', 'what can i improve',
  // ES
  'oportunidad', 'oportunidades',
  'qué oportunidades', 'que oportunidades',
  'cómo gano más', 'como gano más', 'cómo gano mas', 'como gano mas',
  'cómo gano más dinero', 'como gano mas dinero',
  'qué puedo recuperar', 'que puedo recuperar',
  'qué debería empujar', 'que deberia empujar',
  'qué puedo mejorar', 'que puedo mejorar',
  // PT
  'oportunidade', 'oportunidades',
  'como ganhar mais', 'como ganhar mais dinheiro',
  'o que posso recuperar',
  'o que devo promover',
  'o que posso melhorar',
];

// R-INTELLIGENCE-DEAL-PERFORMANCE-INSIGHTS-V1: anchored phrasing for "which
// deals are working". Reads getDealOutcomeLog() and returns deterministic
// aggregated metrics — no charts, no dashboard, no autonomous learning.
const DEAL_PERFORMANCE_KEYWORDS = [
  // EN
  'which deals work', 'deal performance', 'offer performance',
  'which offers work', 'are deals working',
  // ES
  'qué ofertas funcionan', 'que ofertas funcionan',
  'cuales ofertas funcionan', 'cuáles ofertas funcionan',
  'rendimiento de ofertas', 'resultados de ofertas',
  'funcionan las ofertas',
  // PT
  'quais ofertas funcionam', 'desempenho das ofertas',
  'resultado das ofertas', 'as ofertas funcionam',
];

// R-INTELLIGENCE-LEARNING-LOOP-V1: anchored phrasing for "what's working"
// recommendation. Distinct from action_impact (which returns raw totals)
// — this returns a deterministic recommendation bucket.
const ACTION_LEARNING_KEYWORDS = [
  // EN
  'what is working', 'what works', 'which actions work',
  'action learning', 'what actions convert', 'what strategy works',
  // ES
  'que esta funcionando', 'qué está funcionando',
  'que acciones funcionan', 'qué acciones funcionan',
  'que acciones convierten', 'qué acciones convierten',
  // PT
  'o que está funcionando', 'o que esta funcionando',
  'quais ações funcionam', 'quais ações convertem',
];

// R-INTELLIGENCE-TODAY-SALES-DATA-INTENT: anchored "sales today" phrasing
// — must score BEFORE data_query (which has overlapping 'sales today'/'ventas
// de hoy'/'vendas de hoje' keywords) so the dedicated today-only handler
// wins over the generic data summary. Phrases are deliberately anchored
// ("sales" + "today" / "vendí hoy" / "vendi hoje") to avoid swallowing
// plain "today" / "hoy" / "hoje" which still falls to today_summary.
const TODAY_SALES_KEYWORDS = [
  // EN
  'today sales', 'todays sales', "today's sales", 'sales today',
  'revenue today', 'today revenue', 'how much did i sell today',
  // ES
  'ventas hoy', 'ventas de hoy', 'cuanto vendi hoy', 'cuánto vendí hoy',
  'cuanto vendí hoy', 'ingresos hoy', 'ingresos de hoy',
  // PT
  'vendas hoje', 'vendas de hoje', 'quanto vendi hoje', 'receita hoje',
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

// R-INTELLIGENCE-PROPOSAL-FOLLOWUP-INBOX-V1: single intent for both
// listing open follow-ups AND recording manually pasted replies.
// Handler branches internally on parseable reply pattern. Scored
// ABOVE conversation_runner so reply-tracking phrases route here
// first; conversation_runner stays the fallback for plain pasted
// replies without follow-up linking.
const PROPOSAL_FOLLOWUP_KEYWORDS = [
  // EN — list queries
  'follow ups', 'follow-ups', 'followups',
  'proposal follow ups', 'proposal followups',
  'who needs follow up', 'who needs followup',
  'waiting for replies',
  // EN — manual reply phrases
  'customer replied', 'he replied', 'she replied', 'they replied',
  'replied:', 'reply:',
  // ES — list queries
  'seguimientos',
  'seguimiento de propuestas',
  'quién necesita seguimiento', 'quien necesita seguimiento',
  'esperando respuestas',
  // ES — manual reply phrases
  'cliente respondió', 'cliente respondio',
  'me contestó', 'me contesto',
  'respondió:', 'respondio:', 'contestó:', 'contesto:',
  // PT — list queries
  'acompanhamentos',
  'acompanhamento de propostas',
  'quem precisa de acompanhamento',
  'esperando respostas',
  // PT — manual reply phrases
  'cliente respondeu', 'me respondeu',
  'respondeu:',
];

// R-INTELLIGENCE-DAILY-REVENUE-MISSIONS-V1: deterministic top-N money-
// making tasks composed from existing pipeline + follow-up + engine
// signals. Read-only — no mutation, no autonomous actions.
const DAILY_REVENUE_MISSIONS_KEYWORDS = [
  // EN
  'daily missions', 'revenue missions',
  'what should i do today', 'what should i focus on today',
  "today's priorities", 'todays priorities',
  'money tasks today',
  // ES
  'misiones diarias', 'misiones de ingresos',
  'qué debo hacer hoy', 'que debo hacer hoy',
  'prioridades de hoy',
  'tareas de dinero hoy',
  // PT
  'missões diárias', 'missoes diarias',
  'missões de receita', 'missoes de receita',
  'o que devo fazer hoje',
  'prioridades de hoje',
  'tarefas de dinheiro hoje',
];

// R-INTELLIGENCE-CLOSE-TODAY-V1: deterministic ranking of active deals
// most likely to close today. Read-only intelligence; no pipeline
// mutation, no autonomous actions.
const CLOSE_TODAY_KEYWORDS = [
  // EN
  'close today', 'what can close today', 'deals to close today',
  'who can buy today', 'money to close today',
  // ES
  'cerrar hoy',
  'qué puedo cerrar hoy', 'que puedo cerrar hoy',
  'tratos para cerrar hoy',
  'quién puede comprar hoy', 'quien puede comprar hoy',
  'dinero para cerrar hoy',
  // PT
  'fechar hoje',
  'o que posso fechar hoje',
  'negócios para fechar hoje', 'negocios para fechar hoje',
  'quem pode comprar hoje',
  'dinheiro para fechar hoje',
];

// R-INTELLIGENCE-DEAL-PIPELINE-V1: list active sales-pipeline opportunities.
const DEAL_PIPELINE_KEYWORDS = [
  // EN
  'active deals', 'deal pipeline', 'open deals', 'pending deals',
  'what deals can close', 'sales pipeline',
  // ES
  'tratos activos', 'pipeline de ventas',
  'ventas pendientes', 'tratos pendientes',
  'qué tratos puedo cerrar', 'que tratos puedo cerrar',
  // PT
  'negócios ativos', 'negocios ativos',
  'pipeline de vendas',
  'vendas pendentes', 'negócios pendentes', 'negocios pendentes',
  'quais negócios posso fechar', 'quais negocios posso fechar',
];

// R-INTELLIGENCE-DEAL-PIPELINE-V1: manual stage-marking commands.
// Anchored phrases — the handler parses customer name + target stage
// from the raw query.
const MARK_DEAL_STAGE_KEYWORDS = [
  // EN
  'deal won', 'deal lost', 'deal pending pickup', 'deal pending',
  'mark deal', 'mark sale',
  // ES
  'trato ganado', 'trato perdido', 'trato cerrado',
  'venta cerrada', 'venta perdida',
  'marcar trato',
  // PT
  'negócio ganho', 'negocio ganho',
  'negócio perdido', 'negocio perdido',
  'venda fechada', 'venda perdida',
  'marcar negócio', 'marcar negocio',
];

// R-INTELLIGENCE-OPERATOR-MODE-V1: combined operational plan trigger.
// Composes 5 distinct intelligence sources into one prioritized briefing
// (fastest revenue, best contact, top deal, top product, operational risk).
const OPERATOR_MODE_KEYWORDS = [
  // EN
  'operator mode', 'help me close sales today',
  'what should i focus on right now', 'run the store',
  'help me operate today',
  // ES
  'modo operador',
  'ayúdame a cerrar ventas hoy', 'ayudame a cerrar ventas hoy',
  'qué debo enfocarme ahorita', 'que debo enfocarme ahorita',
  'ayúdame a operar hoy', 'ayudame a operar hoy',
  // PT
  'modo operador',
  'me ajude a fechar vendas hoje',
  'no que devo focar agora',
  'me ajude a operar hoje',
];

// R-INTELLIGENCE-TODAY-MONEY-MAP-V1: tactical "where can revenue move
// fastest TODAY" trigger. Reuses opportunity engine helpers but ranks
// by speed-to-close, not theoretical impact.
const TODAY_MONEY_MAP_KEYWORDS = [
  // EN
  'money map', 'where is money stuck',
  'where can i make money today', 'where can revenue move today',
  'what can close today',
  // ES
  'mapa de dinero',
  'dónde está atorado el dinero', 'donde esta atorado el dinero',
  'dónde puedo hacer dinero hoy', 'donde puedo hacer dinero hoy',
  'qué puede cerrar hoy', 'que puede cerrar hoy',
  // PT
  'mapa de dinheiro',
  'onde o dinheiro está parado', 'onde o dinheiro esta parado',
  'onde posso ganhar dinheiro hoje',
  'o que pode fechar hoje',
];

// R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-V1: action-first daily focus list.
// Listed BEFORE daily_brief in the scores array so anchored phrases route
// to the new operator-style briefing. Wider phrasing coverage than the
// existing daily_brief bank.
const DAILY_OPERATOR_BRIEF_KEYWORDS = [
  // EN
  'daily brief', 'today brief', 'operator brief',
  'what should i do today', 'what matters today',
  // ES
  'resumen diario', 'resumen de hoy',
  'qué hago hoy', 'que hago hoy',
  'qué importa hoy', 'que importa hoy',
  // PT
  'resumo diário', 'resumo diario', 'resumo de hoje',
  'o que faço hoje', 'o que faco hoje', 'o que importa hoje',
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

// R-INTELLIGENCE-REFRESH-FREEZE-QUEUE-CLEANUP-REPAIR-INTENT-FIX:
// dedicated "ready for pickup" intent. Anchored multi-word phrases so
// "repairs ready" wins over the generic repairs_overdue intent (which
// only knows about overdue repairs, not ready-for-pickup).
const REPAIRS_READY_KEYWORDS = [
  // EN
  'repairs ready', 'ready repairs',
  'repairs for pickup', 'ready for pickup',
  // ES
  'reparaciones listas',
  'reparaciones para recoger',
  'listas para recoger',
  // PT
  'reparos prontos',
  'reparos para retirada',
];

const HEALTH_KEYWORDS = [
  'cómo está', 'como esta', 'how is', 'estado de la tienda',
  'health', 'salud', 'store health', 'resumen', 'summary',
];

// R-INTEL-FORECAST-KEYWORDS-V1: bank widened to catch verb forms,
// plurals, and English variants. scoreKeywords does substring match,
// so each token covers its own conjugations:
//   - 'pronostic' matches: pronostico, pronosticada, pronosticadas,
//     pronosticado, pronosticados, pronosticar, pronostican, …
//   - 'pronóstic' covers the accented form (pronóstico, pronósticos)
//   - 'proyecta' matches: proyecta, proyectada, proyectadas, proyectado,
//     proyectados, proyectar, proyectan, proyectaba, …
//   - 'ventas futuras' / 'venta futura' catch the noun-phrase form
//   - English forecast/predict/projection/projected + "expected sales"
// Avoids 'proyec' alone (would hit 'proyecto' = "project", unrelated).
const FORECAST_KEYWORDS = [
  'proyeccion', 'proyección', 'proyecciones',
  'proyecta', 'proyectada', 'proyectadas', 'proyectado', 'proyectados',
  'pronostic', 'pronóstic',
  'ventas futuras', 'venta futura',
  'predice', 'predicción', 'prediccion',
  'forecast', 'predict', 'projection', 'projected',
  'expected sales',
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
  // R-DATA-EMPLOYEE-ACCESS-V1: employee performance triggers
  'top employee', 'best employee', 'sales per employee', 'employee performance',
  'mejor empleado', 'ventas por empleado', 'desempeño de empleados',
  'melhor funcionário', 'melhor funcionario', 'vendas por funcionário', 'desempenho dos funcionários',
  // R-DATA-APPOINTMENT-ACCESS-V1: appointment triggers
  'appointments', 'appointment today', 'upcoming appointments',
  'citas', 'citas hoy', 'citas mañana',
  'agendamentos', 'agendamentos hoje',
  // R-DATA-LIABILITY-V1: store credit + loyalty triggers
  'store credit', 'loyalty points', 'liability',
  'crédito', 'credito', 'crédito tienda', 'credito tienda', 'puntos',
  'pontos',
];

// R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1: "what should I do now" — surfaces the
// highest-ROI operational actions ranked by recovery potential and confidence.
// Anchored multi-word phrases to avoid collision with single-word intents.
const PROACTIVE_OPERATIONS_KEYWORDS = [
  // EN
  'what should i do now', 'best next action', 'top priorities', 'best opportunity',
  'proactive report', 'operational guidance', 'highest roi', 'what matters most',
  'what to prioritize', 'who should i contact', 'next steps for the store',
  // ES
  'qué debo hacer ahora', 'que debo hacer ahora', 'mejor siguiente acción',
  'mejor siguiente accion', 'prioridades principales', 'mejor oportunidad',
  'guía operacional', 'guia operacional', 'mayor retorno',
  'qué importa más', 'que importa mas', 'a quién debo contactar',
  'a quien debo contactar', 'próximos pasos', 'proximos pasos',
  // PT
  'o que devo fazer agora', 'melhor próxima ação', 'melhor proxima acao',
  'principais prioridades', 'melhor oportunidade', 'relatório proativo',
  'relatorio proativo', 'maior retorno', 'o que é mais importante',
  'próximos passos', 'proximos passos',
];

// R-INTELLIGENCE-AUTOMATED-EXECUTION-V1: "prepare outreach" / "who should I message" —
// builds execution-ready draft messages without auto-sending.
const EXECUTION_QUEUE_KEYWORDS = [
  // EN
  'prepare followups', 'prepare messages', 'build outreach queue', 'who should i message',
  'draft messages', 'execution queue', 'message queue', 'outreach queue',
  'prepare outreach', 'ready to send', 'who to message', 'message drafts',
  'contact list', 'send reminders', 'follow up queue', 'execution report',
  // ES
  'preparar mensajes', 'construir cola de contacto', 'a quién debo enviar mensajes',
  'a quien debo enviar mensajes', 'mensajes listos', 'cola de mensajes',
  'preparar seguimientos', 'cola de ejecución', 'cola de ejecucion',
  'mensajes para enviar', 'lista de contactos', 'enviar recordatorios',
  // PT
  'preparar mensagens', 'fila de execução', 'fila de execucao', 'quem devo mensagem',
  'mensagens prontas', 'fila de contatos', 'enviar lembretes', 'preparar follow-up',
];

// R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1: pre-shift operational briefing.
// Anchored on morning/start-of-day phrases to avoid collisions with proactive_operations.
const MORNING_DIGEST_KEYWORDS = [
  // EN
  'morning digest', 'morning briefing', 'store briefing', 'start of day',
  'what should i focus on this morning', 'daily digest', 'morning report',
  'morning summary', 'start of shift', 'beginning of day', 'open store',
  'what happened overnight', 'pre-shift', 'before i start',
  // ES
  'resumen matutino', 'resumen de la mañana', 'briefing matutino',
  'inicio del día', 'inicio de turno', 'resumen diario',
  'qué debo atender esta mañana', 'que debo atender esta mañana',
  'resumen de hoy', 'antes de empezar', 'al abrir la tienda',
  // PT
  'resumo matinal', 'briefing matinal', 'início do dia',
  'resumo diário', 'o que focar hoje', 'resumo da manhã',
];

// R-INTELLIGENCE-TREND-DIRECTION-V1: is the store improving, declining, or stable?
const TREND_DIRECTION_KEYWORDS = [
  // EN
  'sales trend', 'trend report', 'is business improving', 'is business slowing',
  'is business slowing down', 'how are we trending', 'trending up', 'trending down',
  'are we growing', 'are we declining', 'business trend', 'revenue trend',
  // ES
  'tendencia de ventas', 'reporte de tendencia', 'el negocio está mejorando',
  'el negocio esta mejorando', 'estamos mejorando', 'estamos creciendo',
  'estamos decayendo', 'cómo vamos esta semana', 'como vamos esta semana',
  'tendencia del negocio', 'tendencia de ingresos',
  // PT
  'tendência de vendas', 'tendencia de vendas', 'relatorio de tendencia',
  'o negócio está melhorando', 'o negocio esta melhorando',
  'estamos crescendo', 'estamos declinando',
  'como estamos tendendo', 'tendência do negócio', 'tendencia do negocio',
];

const HELP_KEYWORDS = [
  'ayuda', 'help', 'que puedes', 'qué puedes', 'what can you',
  'comandos', 'commands',
];

// Strip punctuation + lowercase for matching.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

// R-INTELLIGENCE-FOLLOWUP-CONTEXT-V1: short follow-up phrases that re-use
// the last intent's context instead of running classifyIntent. Match on
// exact normalized phrase (set lookup) — pure O(1), no scan, no engine call.
const FOLLOWUP_PHRASES = new Set([
  // EN
  'why', 'why is that', 'explain', 'explain that', 'explain it',
  'what should i do', 'what now', 'show me more',
  // ES
  'por que', 'por qué', 'porque',
  'explica', 'explicame', 'explícame',
  'que hago', 'qué hago', 'ahora que', 'y ahora',
  // PT (note: 'por que' shared with ES; added unique forms)
  'por quê', 'o que faço', 'o que faco', 'e agora',
]);

export function isFollowUpQuery(query: string): boolean {
  return FOLLOWUP_PHRASES.has(normalize(query));
}

// R-INTELLIGENCE-CONTEXT-MEMORY-V1 ──────────────────────────────
// Lightweight session-only operational context. Pure type + a
// deterministic rewrite helper — NO AI, NO embeddings, NO learning,
// NO persistence, NO background work. The chat module owns ONE active
// context (max depth 1) in a ref, populated whenever a context-
// establishing handler runs. This helper rewrites vague follow-ups
// like "promote it" or "what about accessories" into fully-specified
// queries so the existing intent classifier can route them normally.
//
// Type union supports product / customer / deal / category / repair
// per spec. V1 rewrite rules only target product context (most useful
// follow-up surface); other types are harmless no-ops here.

export interface OperationalContext {
  type: 'product' | 'customer' | 'deal' | 'category' | 'repair';
  value: string;
  timestamp: number;
}

const CONTEXT_FOLLOWUP_RULES: Array<{
  test: (normalized: string) => boolean;
  applies: (ctx: OperationalContext) => boolean;
  template: (ctx: OperationalContext) => string;
}> = [
  // Accessories follow-up — products only.
  // EN/ES/PT in one rule for compactness.
  {
    test: (q) =>
      /^(what about|and) (accessor|case|charger)/i.test(q) ||
      /^(qu[eé] tal|y los?) (accesorio|case|cargador)/i.test(q) ||
      /^(que tal|e os) (acess[oó]rio|case|carregador)/i.test(q),
    applies: (c) => c.type === 'product',
    template: (c) => `promote accessories for ${c.value}`,
  },
  // Re-promote / "show me more" / "who else" — products only.
  {
    test: (q) =>
      /^(promote it|push it|sell it|show another|anything else|who else|send to more|anyone else|more customers)\b/i.test(q) ||
      /^(prom[oó]cionalo|prom[oó]vela|v[eé]ndelo|qui[eé]n m[aá]s|m[aá]ndale a m[aá]s|otro|algo m[aá]s|m[aá]s clientes)\b/i.test(q) ||
      /^(promova|venda|quem mais|envie para mais|outro|algo mais|mais clientes)\b/i.test(q),
    applies: (c) => c.type === 'product',
    template: (c) => `promote ${c.value}`,
  },
  // Discount follow-up — products only.
  {
    test: (q) =>
      /^(discount it|put a discount|lower the price)\b/i.test(q) ||
      /^(descu[eé]ntalo|baja el precio|hazle un descuento)\b/i.test(q) ||
      /^(d[eê] desconto|baixe o pre[cç]o)\b/i.test(q),
    applies: (c) => c.type === 'product',
    template: (c) => `discount ${c.value}`,
  },
];

/**
 * Deterministic follow-up enrichment. Returns a rewritten query string
 * when the raw query matches a known operational follow-up pattern AND
 * the active context applies; returns null otherwise.
 *
 * Pure — no I/O, no clock reads, no state mutation. O(1) over a small
 * fixed rule list.
 */
export function enrichFollowUpQuery(
  rawQuery: string,
  context: OperationalContext | null,
): string | null {
  if (!context) return null;
  const q = normalize(rawQuery);
  if (!q) return null;
  for (const rule of CONTEXT_FOLLOWUP_RULES) {
    if (rule.test(q) && rule.applies(context)) {
      return rule.template(context);
    }
  }
  return null;
}

// R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1: cross-module opportunity keyword banks

// R-INTELLIGENCE-CONTEXT-AWARE-V1: "what about this / info on this" — queries
// that explicitly reference the active entity the operator is looking at.
// Scored high (90+) so it wins over global opportunity intents when the user
// is clearly asking about the currently open repair/customer/layaway/item.
const ACTIVE_CONTEXT_KEYWORDS = [
  // EN
  'what about this', 'anything on this', 'tell me about this',
  'info on this', 'info on current', 'current item', 'current repair',
  'this repair', 'this customer', 'this layaway', 'this item',
  'what can i do with this', 'help me with this',
  // ES
  'qué pasa con esto', 'que pasa con esto', 'algo sobre esto',
  'qué hay de esto', 'que hay de esto', 'este cliente',
  'esta reparación', 'esta reparacion', 'este layaway', 'este artículo',
  'este articulo', 'cuéntame de esto', 'cuentame de esto',
  'qué hago con esto', 'que hago con esto',
];

const WHAT_TO_DO_TODAY_KEYWORDS = [
  // EN
  'what should i do today', 'what do i do today', 'what to do today',
  'priority actions', 'priority actions today', 'what are my priorities',
  'my priorities today', 'action plan today', 'what actions today',
  // ES
  'qué hago hoy', 'que hago hoy', 'qué debo hacer hoy', 'que debo hacer hoy',
  'acciones prioritarias', 'acciones de hoy', 'plan de acción hoy',
  'plan de accion hoy', 'mis prioridades', 'prioridades de hoy',
  // PT
  'o que fazer hoje', 'o que devo fazer hoje', 'ações prioritárias',
  'acoes prioritarias', 'minhas prioridades hoje',
];

const WHERE_LOSING_MONEY_KEYWORDS = [
  // EN
  'where am i losing money', 'where losing money', 'money leaks',
  'revenue leaks', 'losing revenue', 'losing money',
  'where do i lose money', 'revenue loss',
  // ES
  'dónde estoy perdiendo dinero', 'donde estoy perdiendo dinero',
  'dónde pierdo dinero', 'donde pierdo dinero',
  'perdiendo dinero', 'pérdida de ingresos', 'perdida de ingresos',
  'fugas de dinero', 'fugas de ingresos',
  // PT
  'onde estou perdendo dinheiro', 'onde perco dinheiro',
  'perdendo dinheiro', 'perda de receita', 'vazamentos de receita',
];

// R-INTELLIGENCE-MANAGER-QUEUE-V1: anchored phrases for the manager review inbox.
// Multi-word triggers — no collision with single-word intents.
const MANAGER_QUEUE_KEYWORDS = [
  // EN
  'manager queue', 'manager review', 'review queue', 'pending reviews',
  'review inbox', 'manager inbox', 'items for review', 'needs manager',
  'queue review', 'manager approval', 'pending approvals',
  // ES
  'cola del gerente', 'revisión del gerente', 'bandeja del gerente',
  'cola de revisión', 'revisiones pendientes', 'aprobaciones pendientes',
  'cola gerente', 'gerente cola', 'inbox gerente',
  // PT
  'fila do gerente', 'revisão do gerente', 'caixa do gerente',
  'fila de revisão', 'revisões pendentes', 'aprovações pendentes',
];

const WHAT_NEEDS_ATTENTION_KEYWORDS = [
  // EN
  'what needs attention', 'needs attention', 'what needs my attention',
  'what is urgent', 'urgent items', 'urgent actions',
  'what should i prioritize', 'priority list',
  // ES
  'qué necesita atención', 'que necesita atencion', 'qué está urgente',
  'que esta urgente', 'qué debo priorizar', 'que debo priorizar',
  'lista de prioridades', 'qué es urgente', 'que es urgente',
  'qué hay pendiente urgente', 'que hay pendiente urgente',
  // PT
  'o que precisa de atenção', 'o que precisa de atencao', 'o que é urgente',
  'prioridades urgentes',
];

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
    // R-INTELLIGENCE-TODAY-SALES-DATA-INTENT: dedicated today-only sales
    // handler — must score BEFORE data_query and today_summary because both
    // banks contain "sales today" / "ventas de hoy" / "vendas de hoje".
    // Anchored phrasing only — plain "today" / "hoy" still routes to
    // today_summary (which has the broader generic-day greeting keywords).
    { id: 'today_sales', score: scoreKeywords(query, TODAY_SALES_KEYWORDS) },
    // R-INTELLIGENCE-ACTION-IMPACT-TRACKING-V1: action conversion summary.
    { id: 'action_impact', score: scoreKeywords(query, ACTION_IMPACT_KEYWORDS) },
    // R-INTELLIGENCE-LEARNING-LOOP-V1: deterministic "what's working" classifier.
    { id: 'action_learning', score: scoreKeywords(query, ACTION_LEARNING_KEYWORDS) },
    // R-INTELLIGENCE-PENDING-DEAL-V1: owner-mediated offer drafting.
    { id: 'propose_deal', score: scoreKeywords(query, PROPOSE_DEAL_KEYWORDS) },
    // R-INTELLIGENCE-DEAL-PERFORMANCE-INSIGHTS-V1: deal outcome aggregation.
    { id: 'deal_performance', score: scoreKeywords(query, DEAL_PERFORMANCE_KEYWORDS) },
    // R-INTELLIGENCE-CONVERSATION-RUNNER-V1: paste-customer-reply runner.
    // Listed ABOVE customer_history so phrases like "he said the lowest"
    // route to the conversational classifier, not the name-lookup path.
    // R-INTELLIGENCE-PROPOSAL-FOLLOWUP-INBOX-V1: single intent for both
    // listing open follow-ups AND recording manually pasted replies.
    // Listed ABOVE conversation_runner so reply phrases route here first.
    { id: 'proposal_followup', score: scoreKeywords(query, PROPOSAL_FOLLOWUP_KEYWORDS) },
    // R-INTELLIGENCE-DEAL-PIPELINE-V1: list active sales pipeline + manual
    // stage marking. Anchored multi-word phrases — no overlap with
    // proposal_followup or conversation_runner.
    { id: 'deal_pipeline',    score: scoreKeywords(query, DEAL_PIPELINE_KEYWORDS) },
    { id: 'mark_deal_stage',  score: scoreKeywords(query, MARK_DEAL_STAGE_KEYWORDS) },
    // R-INTELLIGENCE-CLOSE-TODAY-V1: deterministic close-likelihood ranker.
    // All multi-word triggers — no collision with deal_pipeline.
    { id: 'close_today',      score: scoreKeywords(query, CLOSE_TODAY_KEYWORDS) },
    { id: 'conversation_runner', score: scoreKeywords(query, CONVERSATION_RUNNER_KEYWORDS) },
    // R-INTEL-CELLHUB-DATA-ACCESS-LAYER: universal data query — runs AFTER
    // the high-priority specific intents above and BEFORE customer_history
    // and sales_summary so operational metrics ("low stock", "ready repairs",
    // "phone payments today", etc.) don't get swallowed by name lookup or
    // the generic 30-day sales summary.
    { id: 'data_query', score: scoreKeywords(query, DATA_QUERY_KEYWORDS) },
    { id: 'customer_history', score: scoreKeywords(query, CUSTOMER_KEYWORDS) },
    // R-INTELLIGENCE-DAILY-REVENUE-MISSIONS-V1: top-N money-making tasks
    // for today. Listed ABOVE daily_operator_brief + daily_brief so the
    // overlapping anchored phrase "what should I do today" routes to the
    // action-first revenue mission list.
    { id: 'daily_revenue_missions', score: scoreKeywords(query, DAILY_REVENUE_MISSIONS_KEYWORDS) },
    // R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-V1: listed ABOVE daily_brief so
    // overlapping anchored phrases route to the action-first briefing.
    { id: 'daily_operator_brief', score: scoreKeywords(query, DAILY_OPERATOR_BRIEF_KEYWORDS) },
    // R-INTELLIGENCE-TODAY-MONEY-MAP-V1: tactical money-map briefing.
    // Anchored multi-word phrases — no overlap with daily_brief/today_summary.
    { id: 'today_money_map', score: scoreKeywords(query, TODAY_MONEY_MAP_KEYWORDS) },
    // R-INTELLIGENCE-OPERATOR-MODE-V1: coordinated operational plan.
    // All multi-word triggers — no collision with single-word intents.
    { id: 'operator_mode', score: scoreKeywords(query, OPERATOR_MODE_KEYWORDS) },
    // R-DAILY-BRIEF-HANDLER-V1: scored ABOVE today_summary so anchored phrases
    // ("daily brief", "resumen diario", "o que fazer hoje") route to the
    // multi-signal composer. Plain "today"/"hoy"/"hoje" still falls to
    // today_summary because DAILY_BRIEF_KEYWORDS only contains anchored phrases.
    // R-INTELLIGENCE-CONTEXT-AWARE-V1: explicit context queries win over global opps.
    { id: 'active_context_query', score: scoreKeywords(query, ACTIVE_CONTEXT_KEYWORDS) },
    // R-INTELLIGENCE-MODULE-WIDE-ACTIONS-V1: listed BEFORE daily_brief so
    // cross-module action queries win over the reporting brief.
    { id: 'what_to_do_today', score: scoreKeywords(query, WHAT_TO_DO_TODAY_KEYWORDS) },
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
    // R-INTELLIGENCE-REFRESH-FREEZE-QUEUE-CLEANUP-REPAIR-INTENT-FIX:
    // listed ABOVE repairs_overdue so anchored "ready" phrases win.
    { id: 'repairs_ready',   score: scoreKeywords(query, REPAIRS_READY_KEYWORDS) },
    { id: 'repairs_overdue', score: scoreKeywords(query, REPAIRS_KEYWORDS) },
    { id: 'what_needs_attention', score: scoreKeywords(query, WHAT_NEEDS_ATTENTION_KEYWORDS) },
    // R-INTELLIGENCE-MANAGER-QUEUE-V1: anchored multi-word phrases — no collision.
    { id: 'manager_queue', score: scoreKeywords(query, MANAGER_QUEUE_KEYWORDS) },
    { id: 'health_check', score: scoreKeywords(query, HEALTH_KEYWORDS) },
    { id: 'forecast_items', score: scoreKeywords(query, FORECAST_KEYWORDS) },
    { id: 'anomaly_days', score: scoreKeywords(query, ANOMALY_KEYWORDS) },
    { id: 'who_to_contact', score: scoreKeywords(query, WHO_TO_CONTACT_KEYWORDS) },
    { id: 'what_hurting_profit', score: scoreKeywords(query, WHAT_HURTING_PROFIT_KEYWORDS) },
    { id: 'where_losing_money', score: scoreKeywords(query, WHERE_LOSING_MONEY_KEYWORDS) },
    // R-INTELLIGENCE-PROACTIVE-OPPORTUNITIES-V1: list ABOVE product_opportunities
    // so a bare "opportunities" query routes to the multi-source operator
    // briefing. product_opportunities (product-only ranked list) still wins
    // for product-anchored phrases like "what to promote" / "high margin".
    { id: 'proactive_opportunities', score: scoreKeywords(query, PROACTIVE_OPPORTUNITIES_KEYWORDS) },
    { id: 'product_opportunities', score: scoreKeywords(query, PRODUCT_OPPORTUNITY_KEYWORDS) },
    // R-INTELLIGENCE-PROACTIVE-OPERATIONS-V1: listed BEFORE trend_direction so
    // "what should I do now" routes to the action list, not the trend report.
    { id: 'proactive_operations', score: scoreKeywords(query, PROACTIVE_OPERATIONS_KEYWORDS) },
    // R-INTELLIGENCE-AUTOMATED-EXECUTION-V1: listed after proactive_operations;
    // "prepare messages" / "build outreach queue" are more specific phrases.
    { id: 'execution_queue', score: scoreKeywords(query, EXECUTION_QUEUE_KEYWORDS) },
    // R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1: listed before proactive_operations
    // in scoring so "morning briefing" routes here instead of the action list.
    { id: 'morning_digest', score: scoreKeywords(query, MORNING_DIGEST_KEYWORDS) },
    // R-INTELLIGENCE-TREND-DIRECTION-V1: listed BEFORE root_cause so "sales
    // trend" / "tendencia de ventas" routes to the direction report, not the
    // revenue-decline root cause (which overlaps on 'sales decline').
    { id: 'trend_direction', score: scoreKeywords(query, TREND_DIRECTION_KEYWORDS) },
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

  // R-INTELLIGENCE-PENDING-DEAL-V1: pass raw query so the handler can parse
  // customer + product + price (deterministic substring + digit scan).
  if (winner.id === 'propose_deal') {
    result.query = rawQuery;
  }

  // R-INTELLIGENCE-CONVERSATION-RUNNER-V1: pass raw query so the
  // deterministic reply-classifier in handlers.ts can scan it.
  if (winner.id === 'conversation_runner') {
    result.query = rawQuery;
  }

  // R-INTELLIGENCE-PROPOSAL-FOLLOWUP-INBOX-V1: pass raw query so the
  // single proposal_followup handler can branch — list mode vs.
  // record-reply mode (parses "{name} replied: {text}" patterns).
  if (winner.id === 'proposal_followup') {
    result.query = rawQuery;
  }

  // R-INTELLIGENCE-DEAL-PIPELINE-V1: pass raw query so the manual
  // stage-marker handler can parse "mark Juan deal won" / "Juan trato
  // ganado" patterns. List handler doesn't need it but it's cheap.
  if (winner.id === 'mark_deal_stage' || winner.id === 'deal_pipeline') {
    result.query = rawQuery;
  }

  // For customer_history intent, resolve the name.
  if (winner.id === 'customer_history') {
    const allBanks = [
      BEST_CUSTOMER_KEYWORDS, LEAST_PROFITABLE_KEYWORDS, MULTI_PHONE_CUSTOMERS_KEYWORDS, CUSTOMER_KEYWORDS, DAILY_BRIEF_KEYWORDS, DAILY_OPERATOR_BRIEF_KEYWORDS, DAILY_REVENUE_MISSIONS_KEYWORDS, TODAY_MONEY_MAP_KEYWORDS, OPERATOR_MODE_KEYWORDS, PROPOSAL_FOLLOWUP_KEYWORDS, DEAL_PIPELINE_KEYWORDS, MARK_DEAL_STAGE_KEYWORDS, CLOSE_TODAY_KEYWORDS, ACTION_IMPACT_KEYWORDS, ACTION_LEARNING_KEYWORDS, PROPOSE_DEAL_KEYWORDS, DEAL_PERFORMANCE_KEYWORDS, PROACTIVE_OPPORTUNITIES_KEYWORDS, CONVERSATION_RUNNER_KEYWORDS, TODAY_SALES_KEYWORDS, TODAY_SUMMARY_KEYWORDS, SALES_KEYWORDS, INVENTORY_LOW_KEYWORDS,
      INVENTORY_DEAD_KEYWORDS, INVENTORY_DYING_KEYWORDS, TOP_ITEMS_KEYWORDS,
      REPAIRS_KEYWORDS, REPAIRS_READY_KEYWORDS, HEALTH_KEYWORDS, FORECAST_KEYWORDS,
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
      BEST_CUSTOMER_KEYWORDS, LEAST_PROFITABLE_KEYWORDS, MULTI_PHONE_CUSTOMERS_KEYWORDS, CUSTOMER_KEYWORDS, DAILY_BRIEF_KEYWORDS, DAILY_OPERATOR_BRIEF_KEYWORDS, DAILY_REVENUE_MISSIONS_KEYWORDS, TODAY_MONEY_MAP_KEYWORDS, OPERATOR_MODE_KEYWORDS, PROPOSAL_FOLLOWUP_KEYWORDS, DEAL_PIPELINE_KEYWORDS, MARK_DEAL_STAGE_KEYWORDS, CLOSE_TODAY_KEYWORDS, ACTION_IMPACT_KEYWORDS, ACTION_LEARNING_KEYWORDS, PROPOSE_DEAL_KEYWORDS, DEAL_PERFORMANCE_KEYWORDS, PROACTIVE_OPPORTUNITIES_KEYWORDS, CONVERSATION_RUNNER_KEYWORDS, TODAY_SALES_KEYWORDS, TODAY_SUMMARY_KEYWORDS, SALES_KEYWORDS, INVENTORY_LOW_KEYWORDS,
      INVENTORY_DEAD_KEYWORDS, INVENTORY_DYING_KEYWORDS, TOP_ITEMS_KEYWORDS,
      REPAIRS_KEYWORDS, REPAIRS_READY_KEYWORDS, HEALTH_KEYWORDS, FORECAST_KEYWORDS,
      ANOMALY_KEYWORDS, WHO_TO_CONTACT_KEYWORDS, WHO_TO_CONTACT_TODAY_KEYWORDS, MARKETING_KEYWORDS, PRODUCT_PUSH_KEYWORDS, WHAT_HURTING_PROFIT_KEYWORDS,
      PRODUCT_OPPORTUNITY_KEYWORDS, ROOT_CAUSE_KEYWORDS, SLOW_DAY_ROOT_CAUSE_KEYWORDS,
      DEAD_STOCK_ROOT_CAUSE_KEYWORDS, CUSTOMER_CHURN_KEYWORDS, DATA_QUERY_KEYWORDS, HELP_KEYWORDS,
    ];
    const productFragment = extractName(query, allBanks);
    if (productFragment) result.extractedProduct = productFragment;
  }

  return result;
}
