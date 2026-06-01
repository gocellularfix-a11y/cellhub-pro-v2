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
  // R-OPERATOR-DAILY-BRIEF-V2: unified aggregated operational briefing
  | 'operator_daily_brief_v2'
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
  | 'likely_to_buy_today'
  // R-INTELLIGENCE-BUY-TODAY-RANKING-V1: multi-signal ranked buyer list
  | 'who_is_most_likely_to_buy_today'
  | 'marketing_campaign'
  | 'product_push'
  | 'what_hurting_profit'
  | 'product_opportunities'
  | 'push_right_now'
  | 'root_cause'
  | 'slow_day_root_cause'
  | 'slow_day_diagnostic'
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
  // R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1: cross-system operational condition inference
  | 'operational_reasoning'
  // R-INTELLIGENCE-DECISION-RECOMMENDATION-V1: strategic decision recommendation
  | 'decision_recommendation'
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
  // R-OCE-V1: operational context engine debug/status intent
  | 'operational_context_status'
  // R-GPO-V1: global priority orchestrator — top priorities right now
  | 'global_priority_status'
  // R-SMART-OUTREACH-CAMPAIGN-V1: grouped deterministic outreach campaign
  | 'smart_outreach_campaign'
  // R-OUTREACH-OUTCOME-FEEDBACK-V1: outreach effectiveness/performance report
  | 'outreach_performance'
  // R-INTELLIGENCE-EXECUTION-OUTPUTS-V1: operator outreach + repair intents
  | 'recover_customer'
  | 'vip_outreach'
  | 'repair_follow_up'
  | 'repair_escalate'
  // R-FUSION-CHAT-INTEGRATION-V1: cross-system operational flow awareness
  | 'fusion_insights'
  // INTELLIGENCE-ENTITY-INTEGRATION-V1: explicit operational command routing
  | 'entity_operational_command'
  // INTELLIGENCE-OPERATOR-CONTINUITY-RUNTIME-V1: active workflow follow-up
  | 'workflow_continuity'
  // INTELLIGENCE-ATTENTION-FEED-INTEGRATION-V1: unresolved mission/workflow pressure feed
  | 'attention_feed'
  // R-INTELLIGENCE-WHO-NEEDS-ATTENTION-TODAY: cross-domain operator decision engine
  | 'who_needs_attention_today'
  // R-INTELLIGENCE-RECOMMENDED-NEXT-BEST-ACTION: single top-priority action
  | 'recommended_next_best_action'
  // R-INTELLIGENCE-WHY-IS-TODAY-SLOW: deterministic operational diagnosis
  | 'why_is_today_slow'
  // R-INTELLIGENCE-LOW-STOCK-OPPORTUNITY-ENGINE: deterministic restock list
  | 'restock_opportunity'
  // R-INTELLIGENCE-WHAT-IS-LOSING-ME-MONEY: operational money-leak detector
  | 'what_is_losing_money'
  // R-INTELLIGENCE-WHY-DID-SALES-DROP: period-over-period drop diagnosis
  | 'why_did_sales_drop'
  // R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY: cross-engine prioritization
  | 'focus_today'
  // R-INTELLIGENCE-OPERATOR-DAILY-BRIEF: compressed store-state briefing
  | 'daily_operator_brief_v3'
  // R-EOD-BRIEF F2: end-of-day operator digest (open items + money placeholder)
  | 'end_of_day_brief'
  // R-INTELLIGENCE-CUSTOMER-RETENTION-INSIGHTS: returning-customer retrospective
  | 'customer_retention_insights'
  // R-INTELLIGENCE-CUSTOMER-360-CHAT-INTENT: per-customer 360° snapshot
  | 'customer_360'
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
  // R-INTELLIGENCE-STABILIZATION-V1 TASK 4 — Report Consistency Guard.
  // Report-shaped queries must route to the sales-of-record handler
  // so they never fall to the strict fallback guard. Added EN/ES/PT
  // variants for "today's report", "daily report", "sales report".
  'today report', 'todays report', "today's report",
  'daily report', 'report today', 'sales report', 'sales report today',
  // ES
  'ventas hoy', 'ventas de hoy', 'cuanto vendi hoy', 'cuánto vendí hoy',
  'cuanto vendí hoy', 'ingresos hoy', 'ingresos de hoy',
  // R-INTELLIGENCE-STABILIZATION-V1 TASK 4:
  'reporte de hoy', 'reporte hoy', 'reporte diario', 'reporte de ventas',
  'reporte de ventas de hoy', 'informe de ventas', 'informe de hoy',
  // PT
  'vendas hoje', 'vendas de hoje', 'quanto vendi hoje', 'receita hoje',
  // R-INTELLIGENCE-STABILIZATION-V1 TASK 4:
  'relatório de hoje', 'relatorio de hoje', 'relatório diário', 'relatorio diario',
  'relatório de vendas', 'relatorio de vendas',
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
  'what should i focus on today',
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

// R-OPERATOR-DAILY-BRIEF-V2: unified aggregated operational briefing.
// Listed BEFORE daily_operator_brief in the scores array so these phrases
// route to v2. Includes phrases from the v1 bank that v2 supersedes.
const OPERATOR_DAILY_BRIEF_V2_KEYWORDS = [
  // EN
  'daily brief', 'operator brief', 'store status',
  'how is the business today', "today's priorities",
  'operator daily brief', 'business status',
  // ES
  'resumen del día', 'resumen del dia', 'resumen operativo',
  'estado de la tienda', 'cómo va el negocio hoy', 'como va el negocio hoy',
  'prioridades de hoy',
  // PT
  'resumo do dia', 'status da loja', 'como está o negócio hoje',
  'como esta o negocio hoje', 'prioridades de hoje',
];

// R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-V1: action-first daily focus list.
// Listed BEFORE daily_brief in the scores array so anchored phrases route
// to the new operator-style briefing. Wider phrasing coverage than the
// existing daily_brief bank.
const DAILY_OPERATOR_BRIEF_KEYWORDS = [
  // EN
  'daily brief', 'today brief', 'operator brief',
  'what should i do today', 'what matters today',
  'what should i focus on', 'what should i focus on today',
  // ES
  'resumen diario', 'resumen de hoy', 'resumen del día', 'resumen del dia',
  'qué hago hoy', 'que hago hoy',
  'qué importa hoy', 'que importa hoy',
  'qué necesito hacer hoy', 'que necesito hacer hoy',
  // PT
  'resumo diário', 'resumo diario', 'resumo de hoje',
  'o que faço hoje', 'o que faco hoje', 'o que importa hoje',
];

const SALES_KEYWORDS = [
  'ventas', 'sales', 'ingresos', 'revenue',
  'hoy', 'today', 'semana', 'week', 'mes', 'month',
  'van las ventas', 'how are sales',
];

// R-INTELLIGENCE-LOW-STOCK-OPPORTUNITY-ENGINE: deterministic restock list.
// Listed BEFORE inventory_low so action-anchored "restock / ordenar /
// reponer / repor" phrases route to the opportunity engine. Plain
// "low stock" / "stock bajo" / "estoque baixo" still goes to inventory_low
// (this bank excludes those tokens by design).
const RESTOCK_OPPORTUNITY_KEYWORDS = [
  // EN
  'what should i restock', 'what am i running out of',
  'low stock opportunities', 'what inventory should i buy',
  'what should i order', 'what to restock', 'restock opportunities',
  'restock recommendations',
  // ES
  'qué debo ordenar', 'que debo ordenar',
  'qué inventario compro', 'que inventario compro',
  'qué se está acabando', 'que se esta acabando',
  'qué debo reponer', 'que debo reponer',
  'qué tengo que reordenar', 'que tengo que reordenar',
  'recomendaciones de reorden',
  // PT
  'o que devo repor', 'o que reponho',
  'o que devo encomendar', 'o que devo pedir',
  'recomendações de reposição', 'recomendacoes de reposicao',
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

// R-INTELLIGENCE-BUY-TODAY-RANKING-V1: multi-signal buyer ranking.
// Phrases unique to this intent — no overlap with who_to_contact_today or
// likely_to_buy_today. Listed BEFORE likely_to_buy_today so position breaks
// any tie on shared substrings.
const WHO_IS_MOST_LIKELY_TO_BUY_TODAY_KEYWORDS = [
  // EN
  'who should i sell to', 'best customers to contact',
  'who can generate revenue today', 'generate revenue today',
  'customers likely to buy today', 'revenue opportunity customers',
  // ES
  'quién debo venderle hoy', 'quien debo venderle hoy',
  'a quien le vendo hoy', 'candidatos de venta hoy',
  'clientes con más probabilidad de comprar', 'clientes con mas probabilidad de comprar',
  // PT
  'quem vai comprar hoje', 'clientes com chance de comprar',
  'oportunidade de venda hoje', 'melhores clientes para vender hoje',
];

// R-OCE-V1: operational context engine debug status.
const OPERATIONAL_CONTEXT_STATUS_KEYWORDS = [
  // EN
  'operational context status', 'intelligence access status',
  'what can intelligence see', 'oce status', 'context engine status',
  // ES
  'estado del contexto operacional', 'qué puede ver intelligence',
  'que puede ver intelligence', 'estado del motor de contexto',
  // PT
  'status do contexto operacional', 'o que intelligence pode ver',
];

// R-GPO-V1 / R-GLOBAL-OPERATOR-CONSOLE-V1: what matters most right now
const GLOBAL_PRIORITY_STATUS_KEYWORDS = [
  // EN
  'top priorities', 'what matters most', 'operational priorities',
  'global priorities', 'what needs attention right now', 'priority status',
  'most important right now', 'what should i focus on', 'priorities right now',
  'urgent actions', 'operator brief', 'store priorities', 'priority list',
  'what to focus on', 'what should i do right now', 'most urgent',
  'critical actions', 'top action', 'most pressing',
  // ES
  'prioridades operativas', 'prioridades principales', 'qué importa más',
  'que importa mas', 'prioridades ahora', 'en qué enfocarse',
  'qué debo atender', 'que debo atender',
  'acciones urgentes', 'resumen operativo', 'qué hacer ahora',
  'lista de prioridades', 'lo más urgente', 'acción más importante',
  // PT
  'prioridades operacionais', 'o que importa mais', 'prioridades agora',
  'ações urgentes', 'resumo operacional', 'o que fazer agora',
  'lista de prioridades', 'mais urgente',
];

// R-SMART-OUTREACH-CAMPAIGN-V1: grouped operational outreach campaign.
// Listed AFTER who_to_contact_today + who_is_most_likely_to_buy_today and BEFORE
// likely_to_buy_today + marketing_campaign in the scores array.
// Anchored multi-word phrases avoid single-word hijack of marketing_campaign
// ("campaña") and likely_to_buy_today ("who should i message").
// "who should i message right now" beats likely_to_buy's "who should i message"
// via position tie-break when smart_outreach is listed first.
const SMART_OUTREACH_CAMPAIGN_KEYWORDS = [
  // EN
  'generate outreach', 'outreach campaign', 'build outreach queue',
  'fill outreach queue', 'generate customer outreach',
  'who should i message right now',
  // ES
  'generar outreach', 'generar campaña de outreach', 'generar campana de outreach',
  'a quién le escribo', 'a quien le escribo',
  'a quién contacto ahorita', 'a quien contacto ahorita',
  'generar cola de outreach', 'generar contactos hoy',
  // PT
  'gerar outreach', 'quem devo chamar',
  'quem devo contactar agora', 'gerar campanha de outreach',
];

// R-OUTREACH-OUTCOME-FEEDBACK-V1: outreach effectiveness/performance report.
// Listed AFTER smart_outreach_campaign so "outreach campaign" still routes there;
// "outreach performance", "outreach results", "how are my outreach doing" land here.
const OUTREACH_PERFORMANCE_KEYWORDS = [
  // EN
  'outreach performance', 'outreach results', 'outreach stats', 'outreach effectiveness',
  'how is my outreach', 'how are my outreach', 'outreach report',
  'did my outreach work', 'outreach conversion', 'outreach response rate',
  // ES
  'rendimiento de outreach', 'resultados de outreach', 'estadísticas de outreach',
  'estadisticas de outreach', 'cómo va mi outreach', 'como va mi outreach',
  'qué tan efectivo es mi outreach', 'que tan efectivo es mi outreach',
  'cuántos respondieron', 'cuantos respondieron', 'tasa de respuesta outreach',
  // PT
  'desempenho de outreach', 'resultados de outreach', 'estatísticas de outreach',
  'como está meu outreach', 'taxa de conversão outreach',
];

// R-INTELLIGENCE-LIKELY-TO-BUY-TODAY-V1: ranked buyer likelihood aggregator.
// Uses repair-ready signal (highest confidence), outreach queue, and overdue
// visit predictions. Distinct from who_to_contact_today (generic outreach list)
// — focuses on immediate conversion signals, not broad reachability.
// Listed AFTER who_to_contact_today (which anchors on "contact today/hoy") so
// specific daily contact phrases stay there; "most likely to buy", "ready to
// buy", "who should I message" route here.
const LIKELY_TO_BUY_TODAY_KEYWORDS = [
  // EN
  'who is most likely to buy', 'who is ready to buy',
  'who should i message', 'who can make me money today',
  'most likely to buy today', 'best customer to contact',
  'who will buy today', 'ready to buy today',
  // ES
  'qué cliente debo contactar', 'que cliente debo contactar',
  'quién es más probable que compre', 'quien es mas probable que compre',
  'quién está listo para comprar', 'quien esta listo para comprar',
  'qué cliente me puede comprar hoy', 'que cliente me puede comprar hoy',
  // PT
  'quem devo contactar hoje', 'quem está pronto para comprar',
  'quem pode comprar hoje', 'melhor cliente para contatar',
];

const WHO_TO_CONTACT_KEYWORDS = [
  'llamar', 'contactar', 'contact', 'reach out', 'follow up',
  'quién llamar', 'quien llamar', 'who should', 'a quién', 'a quien',
  'clientes que', 'customers to', 'follow-up', 'no han venido', 'not visited',
  // R-INTELLIGENCE-OPERATIONAL-PHRASES-1: explicit owner-command aliases for
  // the existing generic outreach/contact intent (no new handler/output).
  'customers to call', 'contact customer', 'who to contact', 'who to call',
  'clientes para llamar', 'clientes para contactar', 'contactar cliente',
  'clientes para chamar', 'contatar cliente',
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

// R-INTELLIGENCE-PUSH-RIGHT-NOW-V1: single-best-opportunity aggregator.
// Listed BEFORE product_opportunities so urgency phrases ("right now", "today",
// "make me money") route to the tighter recommendation, while analytical
// queries ("opportunity", "bundle", "upsell") still reach product_opportunities.
const PUSH_RIGHT_NOW_KEYWORDS = [
  // EN
  'what should i push right now', 'what should i push today',
  'what product should i promote', 'what should i sell today',
  'what can make me money right now', 'best product to push',
  'top product to sell', 'what to sell today',
  // ES
  'qué debo promover', 'que debo promover',
  'qué producto debo impulsar', 'que producto debo impulsar',
  'qué vendo hoy', 'que vendo hoy',
  'qué debo vender hoy', 'que debo vender hoy',
  // PT
  'o que devo promover hoje', 'o que devo vender hoje',
  'melhor produto para promover', 'o que vende agora',
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

// R-INTELLIGENCE-WHY-DID-SALES-DROP: period-over-period operational drop
// diagnosis. Listed in the scores array BEFORE root_cause so anchored
// "why DID sales drop" / "what changed this week" / "why are profits down"
// phrases route to the comparative engine. Existing root_cause /
// slow_day_root_cause / why_is_today_slow banks keep their phrasings.
// R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY: cross-engine prioritization.
// Listed in the scores array BEFORE who_needs_attention_today / recommended_
// next_best_action / what_to_do_today / daily_revenue_missions so anchored
// "focus today" / "prioridades de hoy" / "en qué debo enfocarme" phrases
// route to the cross-engine aggregator instead of the single-engine handlers.
// R-INTELLIGENCE-OPERATOR-DAILY-BRIEF: compressed store-state briefing.
// Listed in the scores array BEFORE focus_today / operator_daily_brief_v2 /
// daily_operator_brief / daily_brief / operator_mode / daily_revenue_missions
// so the anchored "daily brief" / "brief me" / "store status" / "qué está
// pasando hoy" phrases route to the new compressed brief. Existing
// long-form briefing handlers keep their own keyword phrases.
// R-INTELLIGENCE-CUSTOMER-360-CHAT-INTENT: deterministic per-customer
// snapshot composer surface. Triggers explicit profile/360 phrasings only;
// every keyword is an anchored multi-word phrase that does NOT substring-
// overlap with BEST_CUSTOMER_KEYWORDS ('best customer' / 'top customer'),
// RECOVER_CUSTOMER_KEYWORDS ('recover customer' / 'lost customer'), or
// CUSTOMER_RETENTION_INSIGHTS_KEYWORDS (return-verb phrases). 'tell me
// about' is broad-by-design — when the noun after it is a product or
// inventory item, other banks (product_push, product_opportunities)
// outscore this one. Bare 'cliente' / 'customer' tokens are not in this
// bank, so the generic customer_history fallback is preserved.
const CUSTOMER_360_KEYWORDS = [
  // EN — explicit 360/profile phrasings
  'customer 360', 'customer profile', 'show customer profile', 'show customer 360',
  'tell me about', 'what do we know about', 'profile of',
  // ES
  'perfil del cliente', 'perfil de cliente', 'dime sobre',
  'qué sabemos de', 'que sabemos de', 'qué sabemos del cliente', 'que sabemos del cliente',
  // PT
  'perfil do cliente', 'o que sabemos sobre', 'o que sabemos do cliente',
  'me fale sobre', 'me fale do cliente',
];

// R-INTELLIGENCE-CUSTOMER-RETENTION-INSIGHTS: deterministic returning-
// customer retrospective. Multi-word anchored phrases — none collide
// with bare 'cliente' / 'customer' (CUSTOMER_KEYWORDS bank) because every
// trigger here pairs the noun with a return verb (regresaron / came back /
// returned / volveram / recovered / recuperados / recorrentes). Listed
// BEFORE customer_history + recover_customer in the scores array.
const CUSTOMER_RETENTION_INSIGHTS_KEYWORDS = [
  // EN
  'returning customers',
  'who came back',
  'who returned',
  'recovered customers',
  'repeat customers this month',
  'which customers returned',
  'which customers came back',
  'customers that returned',
  // ES
  'que clientes regresaron',
  'qué clientes regresaron',
  'clientes que regresaron',
  'clientes recuperados',
  'clientes que volvieron',
  'quienes regresaron',
  'quiénes regresaron',
  'que clientes volvieron',
  // PT
  'clientes que voltaram',
  'clientes recuperados',
  'quem voltou',
  'clientes recorrentes',
  'que clientes voltaram',
];

// R-EOD-BRIEF F2: end-of-day digest. Listed in scores array BEFORE
// daily_operator_brief_v3 / OPERATOR_DAILY_BRIEF_V2 / daily_brief so
// EOD-anchored phrases ("end of day", "fin del día", "fim do dia",
// "how was today", "como fue mi día") route to the closing digest
// instead of the in-progress operator brief. Phrases that overlap
// with v3 ('resumen del día', 'resumo do dia') route to EOD via
// position tie-break — intent is end-of-shift recap, not mid-shift
// status. Plain "today" / "hoy" / "hoje" remain on today_summary.
const END_OF_DAY_BRIEF_KEYWORDS = [
  // ────────── EN: direct ──────────
  'end of day', 'end-of-day', 'eod', 'eod brief', 'end of day brief',
  'closing brief', 'closing summary', 'closing report', 'closing time',
  'day recap', 'day summary', 'today recap', 'today summary',
  'daily wrap up', 'daily wrap-up', 'wrap up', 'wrap-up', 'wrap up today',

  // ────────── EN: casual ──────────
  'how was today', 'how was my day', 'how did today go',
  'how did we do today', 'how did i do today', 'how am i doing today',
  'summary please', 'recap today', 'recap please',
  'close out the day', 'close the day', 'close day',
  'end the day', 'ending the day',

  // ────────── ES: directo ──────────
  'final del día', 'final del dia', 'final de hoy',
  'fin del día', 'fin del dia', 'fin de hoy',
  'cierre del día', 'cierre del dia', 'cierre de hoy', 'cierre',
  'resumen del día', 'resumen del dia', 'resumen de hoy',
  'resumen final', 'recap del día', 'recap del dia',

  // ────────── ES: casual mexicano ──────────
  // R-EOD-BRIEF F2.1 collision review:
  //   - 'qué tal hoy' / 'que tal hoy' dropped (would steal from today_summary;
  //     phrase is ambiguous AM vs PM — preserved on today_summary).
  //   - bare 'a cerrar' dropped (substring of OPERATOR_MODE_KEYWORDS
  //     'ayúdame a cerrar ventas hoy' — would steal operator_mode via
  //     position tie-break). Specific variants 'vamos a cerrar' / 'pa
  //     cerrar' / 'ya pa cerrar' / 'vamos cerrando' / 'ya cerramos'
  //     retained — none substring-match other banks.
  'como me fue hoy', 'cómo me fue hoy', 'como me fue', 'cómo me fue',
  'como estuvo el día', 'cómo estuvo el día',
  'como estuvo hoy', 'cómo estuvo hoy',
  'qué tal el día', 'que tal el día', 'que tal el dia',
  'cómo nos fue hoy', 'como nos fue hoy', 'cómo nos fue', 'como nos fue',
  'cómo va el día', 'como va el día', 'como va el dia',
  'como vamos hoy', 'cómo vamos hoy',
  'ya pa cerrar', 'ya pa cerrar caja', 'pa cerrar',
  'vamos a cerrar', 'vamos cerrando', 'ya cerramos',
  'vamos a ver el día', 'a ver el día', 'a ver cómo me fue',
  'qué hicimos hoy', 'que hicimos hoy',
  'qué se hizo hoy', 'que se hizo hoy',
  'cuánto hicimos hoy', 'cuanto hicimos hoy',
  'cuánto vendí hoy', 'cuanto vendi hoy',

  // ────────── Spanglish ──────────
  'recap compa', 'end of day compa', 'como va el day',
  'closing the day', 'como cerramos hoy', 'ya casi cerramos',

  // ────────── PT ──────────
  'fim do dia', 'final do dia',
  'fechamento do dia', 'fechamento',
  'resumo do dia', 'resumo de hoje', 'recap do dia',
  'como foi meu dia', 'como foi o meu dia',
  'como foi o dia', 'como foi hoje',
];

const DAILY_OPERATOR_BRIEF_V3_KEYWORDS = [
  // EN
  'daily brief', 'brief me', 'store status', 'operator brief',
  'how are we today', 'how are we doing today',
  'morning brief', 'morning briefing',
  // R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-TRIGGER-EXPANSION-V1
  'what is the status today',
  // ES
  'resumen de hoy', 'resumen diario',
  'qué está pasando hoy', 'que esta pasando hoy',
  'estado de la tienda', 'cómo va la tienda', 'como va la tienda',
  'cómo estamos hoy', 'como estamos hoy',
  // R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-TRIGGER-EXPANSION-V1
  'reporte operativo', 'cómo vamos hoy', 'como vamos hoy',
  // PT
  'resumo de hoje', 'resumo do dia',
  'o que está acontecendo hoje', 'o que esta acontecendo hoje',
  'status da loja', 'como está a loja', 'como esta a loja',
  // R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-TRIGGER-EXPANSION-V1
  'briefing operacional', 'como estamos hoje', 'estado da loja',
];

const FOCUS_TODAY_KEYWORDS = [
  // EN — explicit focus + today
  'what should i focus on today', 'what should i focus on',
  'today priorities', 'where should i focus',
  'what matters most right now', 'what needs attention today',
  'focus today', 'today focus', 'my priorities today',
  'what should i prioritize today',
  // ES
  'prioridades de hoy',
  'en qué debo enfocarme', 'en que debo enfocarme',
  'en qué enfocarse hoy', 'en que enfocarse hoy',
  'qué necesita atención hoy', 'que necesita atencion hoy',
  'qué priorizar hoy', 'que priorizar hoy',
  'mi enfoque de hoy',
  // PT
  'prioridades de hoje',
  'em que devo focar hoje',
  'no que devo focar hoje',
  'meu foco de hoje',
  'o que precisa de atenção hoje', 'o que precisa de atencao hoje',
];

const WHY_DID_SALES_DROP_KEYWORDS = [
  // EN — anchored on past-tense drop / less / lower / worse / changed
  'why did sales drop', 'why are we making less money',
  'why is revenue lower', 'what changed this week',
  'why are profits down', 'why are sales worse today',
  'why are sales down', 'why is revenue down',
  'why is profit down', 'why are profits lower',
  'sales dropped', 'revenue dropped', 'profits dropped',
  'what changed this month', 'what changed today',
  // ES
  'por qué bajaron las ventas', 'por que bajaron las ventas',
  'por qué estoy ganando menos', 'por que estoy ganando menos',
  'por qué cayeron las ventas', 'por que cayeron las ventas',
  'por qué hay menos ventas', 'por que hay menos ventas',
  'qué cambió esta semana', 'que cambio esta semana',
  'qué cambió este mes', 'que cambio este mes',
  'por qué hay menos dinero', 'por que hay menos dinero',
  'por qué las ganancias bajaron', 'por que las ganancias bajaron',
  // PT
  'por que as vendas caíram', 'por que as vendas cairam',
  'por que estou ganhando menos', 'por que o lucro caiu',
  'o que mudou esta semana', 'o que mudou este mês', 'o que mudou este mes',
  'por que tem menos vendas', 'por que tem menos dinheiro',
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

// R-INTELLIGENCE-SLOW-DAY-DIAGNOSTIC-V1: real-time "why is today slow" diagnosis.
// Distinct from slow_day_root_cause (which answers why a specific weekday is
// historically weak). Listed AFTER slow_day_root_cause so "slow day reason"
// still routes to the historical root-cause handler.
// R-INTELLIGENCE-WHY-IS-TODAY-SLOW: deterministic operational diagnosis.
// Listed in the scores array BEFORE slow_day_diagnostic so the richer
// diagnosis handler wins for shared phrases. Extra Mexican-Spanish + PT
// variants the existing bank doesn't catch.
const WHY_IS_TODAY_SLOW_KEYWORDS = [
  // EN
  'why is today slow', 'why are sales slow', 'why is business slow',
  'slow day', 'business is slow', 'why slow today', 'sales are slow today',
  'what is happening today',
  'why is it dead today', 'why is traffic dead',
  // ES — Mexican variants explicitly listed
  'por qué está lento hoy', 'por que esta lento hoy',
  'por qué no hay ventas', 'por que no hay ventas',
  'día lento', 'dia lento',
  'porque esta lento', 'porque está lento',
  'por que esta flojo', 'porque esta flojo',
  'porque no se vende', 'por que no se vende',
  'por que no entra gente', 'porque no entra gente',
  'por que esta muerto', 'porque esta muerto',
  'por que no vendo', 'porque no vendo',
  'porque no hay clientes', 'por que no hay clientes',
  // PT
  'negócio lento', 'negocio lento',
  'por que está fraco', 'por que esta fraco',
  'por que não vende', 'por que nao vende',
];

const SLOW_DAY_DIAGNOSTIC_KEYWORDS = [
  // EN
  'why is today slow', 'why are sales slow', 'why am i slow today',
  'slow day', 'why is business slow', 'business is slow',
  'why slow today', 'sales are slow today',
  // ES
  'por qué está lento hoy', 'por que esta lento hoy',
  'por qué no vendo hoy', 'por que no vendo hoy',
  'día lento', 'dia lento',
  'por qué estoy lento hoy', 'por que estoy lento hoy',
  // PT
  'vendas lentas', 'por que estou lento hoje',
  'por que as vendas estão lentas', 'negócio lento', 'negocio lento',
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
  // R-INTELLIGENCE-OPERATIONAL-PHRASES-1: explicit appointment owner-command
  // aliases (already covered by the substrings above; added for clarity).
  'show appointments', "today's appointments", 'todays appointments',
  'appointments today', 'citas de hoy', 'agendamentos de hoje',
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

// R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1: what is really happening across the business?
// Anchored on "what's really going on" / "operational situation" phrases to avoid
// collision with single-domain intents (proactive_operations, trend_direction).
const OPERATIONAL_REASONING_KEYWORDS = [
  // EN
  'what is really going on', "what's really going on", 'what is happening in the store',
  'operational situation', 'cross-system analysis', 'cross system analysis',
  'what is the store condition', 'current business condition', 'business situation',
  'why is this happening', 'what is causing this', 'root operational issue',
  'what is wrong with the store', "what's wrong with the store", 'store diagnosis',
  'big picture', 'overall situation', 'overall business health', 'store intelligence',
  'what does the data say', 'what are the signals', 'correlate signals',
  'systemic issue', 'what pattern', 'what patterns do you see',
  // ES
  'qué está pasando realmente', 'que esta pasando realmente',
  'qué está pasando en la tienda', 'que esta pasando en la tienda',
  'situación operativa', 'situacion operativa',
  'cuál es el problema real', 'cual es el problema real',
  'qué señales hay', 'que señales hay', 'análisis cruzado', 'analisis cruzado',
  'diagnóstico de la tienda', 'diagnostico de la tienda',
  'qué está fallando', 'que esta fallando', 'panorama general',
  'qué dicen los datos', 'que dicen los datos',
  // PT
  'o que está realmente acontecendo', 'situação operacional', 'situacao operacional',
  'qual é o problema real', 'diagnóstico da loja', 'diagnostico da loja',
  'que padrões você vê', 'visão geral', 'o que os dados dizem',
];

// R-INTELLIGENCE-DECISION-RECOMMENDATION-V1: what is the best move right now?
// Anchored on "best move" / "what should I do" / "decision" phrases — more
// action-oriented than operational_reasoning ("what's going on") and more
// strategic than proactive_operations ("what to prioritize").
const DECISION_RECOMMENDATION_KEYWORDS = [
  // EN
  'best move', 'best move right now', 'what is the best move',
  'what should i do', 'what should we do', 'what should i focus on next',
  'what decision should i make', 'strategic recommendation',
  'best business decision', 'best decision', 'what do you recommend',
  'what is your recommendation', 'give me a recommendation',
  'what should i do next', 'what action should i take', 'top recommendation',
  'recommend an action', 'what is the smartest move', 'smartest move',
  'highest impact action', 'what will make the most impact',
  // ES
  'mejor movimiento', 'cuál es el mejor movimiento', 'cual es el mejor movimiento',
  'qué debo hacer', 'que debo hacer', 'qué me recomiendas', 'que me recomiendas',
  'recomendación estratégica', 'recomendacion estrategica',
  'mejor decisión', 'mejor decision', 'cuál es la mejor decisión',
  'cual es la mejor decision', 'qué acción tomar', 'que accion tomar',
  'en qué enfocarse', 'en que enfocarse', 'acción de mayor impacto',
  // PT
  'melhor movimento', 'qual é o melhor movimento', 'qual a melhor decisão',
  'o que devo fazer', 'recomendação estratégica', 'recomendacao estrategica',
  'melhor ação', 'qual ação tomar', 'maior impacto',
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

// R-INTELLIGENCE-EXECUTION-OUTPUTS-V1: operator outreach + repair intents.
const RECOVER_CUSTOMER_KEYWORDS = [
  // EN
  'recover customer', 'win back', 'lost customer', 'inactive customer', 'help recover',
  're-engage', 'bring back customer', 'lapsed customer', 'hasn\'t visited',
  // ES
  'recuperar cliente', 'cliente perdido', 'cliente inactivo', 'reconectar cliente',
  'traer de vuelta', 'cliente ausente',
  // PT
  'recuperar cliente', 'cliente inativo', 'trazer de volta',
];

const VIP_OUTREACH_KEYWORDS = [
  // EN
  'vip outreach', 'vip strategy', 'vip customer', 'loyalty outreach', 'vip message',
  'create vip', 'vip appreciation', 'outreach vip', 'best customer outreach',
  // ES
  'alcance vip', 'estrategia vip', 'cliente vip', 'fidelización', 'mensaje vip',
  'crear estrategia vip',
  // PT
  'alcance vip', 'estratégia vip', 'cliente vip', 'fidelização',
];

const REPAIR_FOLLOW_UP_KEYWORDS = [
  // EN
  'follow up repair', 'follow up delayed', 'delayed repair', 'repair follow up',
  'repair followup', 'repair update message', 'follow up for repair', 'check in repair',
  // ES
  'seguimiento reparación', 'seguimiento de reparación', 'reparación retrasada',
  'actualización reparación', 'avisar reparación', 'dar seguimiento reparación',
  // PT
  'acompanhar reparo', 'reparo atrasado', 'seguimento reparo',
];

const REPAIR_ESCALATE_KEYWORDS = [
  // EN
  'escalate repair', 'overdue repair', 'repair overdue', 'escalate overdue',
  'repair escalation', 'urgent repair escalation',
  // ES
  'escalar reparación', 'reparación vencida', 'escalar reparación vencida',
  'escalación reparación',
  // PT
  'escalar reparo', 'reparo vencido', 'escalar reparo atrasado',
];

// INTELLIGENCE-ENTITY-INTEGRATION-V1
// INTELLIGENCE-OPERATOR-CONTINUITY-RUNTIME-V1
// Short follow-up phrases only. Single bare words kept minimal to avoid
// collision with analytics keyword banks. Ties broken in the handler by
// resolveWorkflowFollowUp word-boundary check.
const WORKFLOW_CONTINUITY_KEYWORDS = [
  // EN — multi-word phrases (unambiguous)
  'next step', 'what now', 'send it', 'send reminder', 'open it',
  'mark complete', 'mark done',
  // "continue" alone is low-collision in analytics context
  'continue',
  // ES
  'siguiente paso', 'que sigue', 'qué sigue',
  'enviar recordatorio', 'ábrelo', 'abrelo', 'marcar completo',
  'continua', 'continuar', 'siguiente', 'listo',
  // PT
  'próximo passo', 'o que agora', 'enviar lembrete', 'concluir',
];

// INTELLIGENCE-ATTENTION-FEED-INTEGRATION-V1: unresolved mission/workflow attention feed.
// Includes overlapping phrases from WHAT_NEEDS_ATTENTION_KEYWORDS intentionally —
// attention_feed is listed BEFORE what_needs_attention in the scores array, so it
// wins tie-breaks and supersedes the old handler for shared phrases.
const ATTENTION_FEED_KEYWORDS = [
  // EN — distinctive
  'attention', 'unfinished work', 'unresolved work', 'attention feed',
  'show attention feed', 'show attention',
  // EN — shared with what_needs_attention (wins via list-order tie-break)
  'what needs attention', 'what needs my attention', 'what is urgent',
  'urgent', 'prioritize', 'what am i missing',
  // ES
  'que necesita atencion', 'qué necesita atención', 'urgente',
  'pendientes', 'trabajo pendiente', 'que me falta', 'qué me falta',
  'pendiente urgente',
  // PT
  'atenção', 'urgente', 'pendente', 'trabalho pendente',
  'pendentes', 'o que falta',
];

// Anchored 2-word command phrases only — no single words that would conflict
// with analytics intents. Placement before customer_history guarantees win
// on "show customer" / "open customer" tie-breaks.
const ENTITY_COMMAND_KEYWORDS = [
  // EN — open / show / find
  'open repair', 'open ticket', 'open customer', 'open invoice',
  'open layaway', 'open unlock', 'open order',
  'show repair', 'show customer', 'show ticket', 'show layaway',
  'show unlock', 'show order', 'show invoice',
  'find repair', 'find customer', 'find ticket', 'find invoice',
  'call customer',
  'collect payment', 'collect balance',
  'mark ready',
  // ES
  'abrir reparación', 'abrir ticket', 'abrir cliente',
  'ver ticket', 'ver reparación', 'ver cliente', 'ver factura', 'ver layaway',
  'buscar cliente', 'buscar ticket',
  'cobrar a', 'marcar listo',
  // PT
  'abrir reparo', 'ver reparo', 'ver fatura',
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
  // R-INTELLIGENCE-SESSION-CONTEXT-V1: pronoun contact references
  'contact him', 'contact her', 'contact them', 'call him', 'call her', 'message him', 'message her',
  'contactalo', 'contactala', 'contactalos', 'llamalo', 'llamala',
  'contata ele', 'contata ela',
  // open/show entity references
  'open it', 'open that', 'show it',
  'ábrelo', 'abrelo',
  'abra isso', 'mostre isso',
  // list extension
  'show more', 'give me more', 'more results', 'see more',
  'ver más', 'dame más', 'muéstrame más', 'muestrame mas',
  'ver mais', 'mostrar mais', 'me dê mais',
  // R-INTELLIGENCE-OPERATOR-WORKFLOW-CHAINING: workflow chaining phrases
  'do the next one', 'what after that', 'continue workflow', 'next step',
  'haz el siguiente', 'qué sigue después', 'que sigue despues',
  'continuar flujo', 'siguiente paso',
  'faça o próximo', 'faca o proximo', 'o que vem depois', 'continuar fluxo',
  'próximo passo', 'proximo passo',
]);

export function isFollowUpQuery(query: string): boolean {
  return FOLLOWUP_PHRASES.has(normalize(query));
}

// R-INTELLIGENCE-STABILIZE-1 T3: pure conversational filler that must NEVER
// trigger an operational intent. Matched on EXACT normalized phrase (full
// string), never substring — so "interesting" is blocked but "interesting
// customers" still routes normally. This is the surgical guard against
// conversational chatter hijacking routing via a coincidental keyword
// substring; it deliberately does NOT raise the numeric score threshold
// (which would regress the many legitimate single-keyword operational intents).
const CONVERSATIONAL_FILLER = new Set([
  // EN
  'wow', 'interesting', 'thats crazy', "that's crazy", 'tell me more',
  'nice', 'cool', 'ok', 'okay', 'k', 'thanks', 'thank you', 'lol', 'haha',
  'hmm', 'i see', 'got it', 'great', 'awesome', 'sure', 'yeah', 'yep',
  'no way', 'really', 'makes sense', 'understood', 'right',
  // ES
  'guau', 'que loco', 'qué loco', 'interesante', 'cuentame mas', 'cuéntame más',
  'gracias', 'genial', 'ya veo', 'entendido', 'claro', 'en serio',
  // PT
  'nossa', 'que loucura', 'interessante', 'me conta mais', 'obrigado', 'entendi',
]);

export function isConversationalFiller(query: string): boolean {
  return CONVERSATIONAL_FILLER.has(normalize(query));
}

// R-INTELLIGENCE-OPERATIONAL-PHRASES-1: operator phrases mapped to the closest
// EXISTING intent. The phrases are ALSO present in the corresponding keyword
// banks above — that is what actually routes them. This table only documents
// the mapping and powers the alias-match debug log in classifyIntent. It adds
// NO handlers and NO outputs.
const OPERATIONAL_ALIASES: ReadonlyArray<{ phrase: string; intent: IntentId }> = [
  // outreach / contact
  { phrase: 'customers to call',   intent: 'who_to_contact' },
  { phrase: 'contact customer',    intent: 'who_to_contact' },
  { phrase: 'clientes para llamar', intent: 'who_to_contact' },
  { phrase: 'contactar cliente',   intent: 'who_to_contact' },
  // appointments (data_query)
  { phrase: 'show appointments',   intent: 'data_query' },
  { phrase: "today's appointments", intent: 'data_query' },
  { phrase: 'todays appointments', intent: 'data_query' },
  { phrase: 'citas de hoy',        intent: 'data_query' },
  { phrase: 'agendamentos de hoje', intent: 'data_query' },
  // entity open commands
  { phrase: 'open customer',       intent: 'entity_operational_command' },
  { phrase: 'open repair',         intent: 'entity_operational_command' },
  { phrase: 'abrir cliente',       intent: 'entity_operational_command' },
  { phrase: 'abrir reparación',    intent: 'entity_operational_command' },
];

// R-INTELLIGENCE-OPERATIONAL-PHRASES-1 — UNRESOLVED owner phrases:
// There is NO existing intent or handler that lists unpaid balances /
// accounts-receivable across repairs / layaways / orders. These phrases were
// therefore NOT aliased to any existing intent (aliasing them to data_query or
// who_to_contact would invent an output the engine does not produce):
//   "show unpaid" / "unpaid" / "payments due"
//     → correctly fall through to `fallback_question` (no keyword match).
//   "who owes me money" / "quién me debe dinero"
//     → PRE-EXISTING: route to `what_hurting_profit` via the bare 'money' /
//       'dinero' tokens in WHAT_HURTING_PROFIT_KEYWORDS.
//   "pending payments"
//     → PRE-EXISTING: routes to `repairs_overdue` via the bare 'pending' token
//       in REPAIRS_KEYWORDS.
//   This round does NOT change the two pre-existing cases (narrowing those bare
//   tokens would regress legitimate profit-leak / overdue-repair routing — out
//   of scope for an additive keyword round).
// TODO(intent): introduce a dedicated `unpaid_balances` intent + handler once an
// accounts-receivable / outstanding-balance view exists; at that point also
// narrow the bare 'money'/'dinero' tokens so the two phrases above route to it.

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
  // EN — explicit entity references
  'what about this', 'anything on this', 'tell me about this',
  'info on this', 'info on current', 'current item', 'current repair',
  'this repair', 'this customer', 'this layaway', 'this item',
  'what can i do with this', 'help me with this',
  // EN — lightweight contextual prompts
  'what should i do here', 'anything important', 'what should i know',
  'recommendation', 'advise me', 'next step', "what's next", 'status check',
  'what do i do', 'what now', 'help me here', 'any action needed',
  // ES — referencias explícitas
  'qué pasa con esto', 'que pasa con esto', 'algo sobre esto',
  'qué hay de esto', 'que hay de esto', 'este cliente',
  'esta reparación', 'esta reparacion', 'este layaway', 'este artículo',
  'este articulo', 'cuéntame de esto', 'cuentame de esto',
  'qué hago con esto', 'que hago con esto',
  // ES — prompts contextuales ligeros
  'qué hago aquí', 'que hago aqui', 'algo importante', 'qué debo saber',
  'que debo saber', 'recomendación', 'recomendacion', 'siguiente paso',
  'qué sigue', 'que sigue', 'aconséjame', 'aconsejame', 'qué procede', 'que procede',
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

// R-INTELLIGENCE-WHAT-IS-LOSING-ME-MONEY: deterministic operational
// money-leak detection. Listed in the scores array BEFORE the legacy
// where_losing_money bank so anchored "what is losing me money / qué me
// está haciendo perder / onde estou perdendo" phrases route to the new
// engine. Generic "losing money" (single token, no anchor) still falls
// to the existing handler.
const WHAT_IS_LOSING_MONEY_KEYWORDS = [
  // EN
  'what is losing me money', 'what is costing me money',
  'money leak', 'losing profit',
  'what is hurting profits', 'what is hurting profit',
  'where are losses coming from', 'where am i losing money',
  'where do i lose money',
  // ES
  'qué me está haciendo perder dinero', 'que me esta haciendo perder dinero',
  'dónde pierdo dinero', 'donde pierdo dinero',
  'qué está afectando ganancias', 'que esta afectando ganancias',
  'fuga de dinero', 'fugas de dinero',
  'por qué gano menos', 'por que gano menos',
  // PT
  'onde estou perdendo dinheiro',
  'o que está me fazendo perder dinheiro', 'o que esta me fazendo perder dinheiro',
  'o que está prejudicando o lucro', 'o que esta prejudicando o lucro',
  'vazamento de dinheiro',
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

// R-INTELLIGENCE-WHO-NEEDS-ATTENTION-TODAY: cross-domain operator decision engine.
// Listed in the scores array BEFORE attention_feed / what_needs_attention /
// proactive_operations / customer_history so the new operator command wins
// the listed trigger phrases. Keep phrases ANCHORED ("today / hoy / hoje" or
// "pendientes / pending / follow up") so generic "needs attention" still
// falls to attention_feed when no time-anchored intent is in play.
// R-INTELLIGENCE-RECOMMENDED-NEXT-BEST-ACTION: single top action command.
// Keep phrases SHORT and ACTION-ANCHORED ("next", "siguiente", "próxima")
// so generic "what should I do" phrasings stay with their existing intents
// (decision_recommendation / proactive_operations). Listed in the scores
// array BEFORE who_needs_attention_today so the "next" anchor wins on the
// shared "what should I do" tail; without "next" / "siguiente" / "próxima"
// the existing intents continue to handle the query.
const RECOMMENDED_NEXT_BEST_ACTION_KEYWORDS = [
  // EN
  'next best action', 'what is the next move', 'what is my next move',
  'what should i do next', 'what should i handle now',
  'what now', 'next move', 'next action',
  // ES
  'siguiente acción', 'siguiente accion',
  'cuál es el siguiente paso', 'cual es el siguiente paso',
  'qué sigue', 'que sigue',
  'qué hago ahora', 'que hago ahora',
  'próxima acción', 'proxima accion',
  'mejor siguiente acción', 'mejor siguiente accion',
  // PT
  'próxima ação', 'proxima acao',
  'qual o próximo passo', 'qual o proximo passo',
  'o que faço agora', 'o que faco agora',
  'melhor próxima ação', 'melhor proxima acao',
];

const WHO_NEEDS_ATTENTION_TODAY_KEYWORDS = [
  // EN — primary triggers
  'who needs attention today', 'who needs my attention today',
  'who needs follow up', 'who needs followup', 'who needs help',
  'what should i handle today', 'who is pending', 'who should i call',
  'who should i contact today',
  // EN — secondary triggers (action-first phrasings)
  'who needs attention',
  // ES
  'a quien debo contactar', 'a quién debo contactar',
  'clientes pendientes', 'clientes por atender',
  'a quién debo atender', 'a quien debo atender',
  'a quién llamar hoy', 'a quien llamar hoy',
  'qué clientes están pendientes', 'que clientes estan pendientes',
  // PT
  'quem precisa atenção hoje', 'quem precisa de atenção hoje',
  'quem precisa de acompanhamento', 'clientes pendentes',
  'quem devo contatar hoje', 'quem devo atender hoje',
];

const WHAT_NEEDS_ATTENTION_KEYWORDS = [
  // EN
  'what needs attention', 'needs attention', 'what needs my attention',
  'what is urgent', 'urgent items', 'urgent actions',
  'what should i prioritize', 'priority list',
  // R-INTELLIGENCE-WHO-NEEDS-ATTENTION-RIGHT-NOW-V1
  'who needs attention', 'who needs my attention', 'who needs attention right now',
  'what needs attention right now',
  // ES
  'qué necesita atención', 'que necesita atencion', 'qué está urgente',
  'que esta urgente', 'qué debo priorizar', 'que debo priorizar',
  'lista de prioridades', 'qué es urgente', 'que es urgente',
  'qué hay pendiente urgente', 'que hay pendiente urgente',
  // R-INTELLIGENCE-WHO-NEEDS-ATTENTION-RIGHT-NOW-V1
  'qué debo revisar ahora', 'que debo revisar ahora',
  'qué necesito revisar ahora', 'que necesito revisar ahora',
  // PT
  'o que precisa de atenção', 'o que precisa de atencao', 'o que é urgente',
  'prioridades urgentes',
  // R-INTELLIGENCE-WHO-NEEDS-ATTENTION-RIGHT-NOW-V1
  'quem precisa de atenção agora', 'o que devo revisar agora',
];

// R-FUSION-CHAT-INTEGRATION-V1: cross-system operational awareness.
// Anchored on "missing / risks / focus" — no overlap with what_needs_attention
// ("urgent / prioritize"), what_to_do_today ("plan / do today"), or
// proactive_operations ("what should i do now"). Zero keyword collision by design.
const FUSION_INSIGHTS_KEYWORDS = [
  // EN
  'what am i missing', 'am i missing anything', 'biggest risks', 'biggest risk',
  'operational risks', 'operational risk', 'what should i focus on',
  'what requires attention', 'missed something',
  // ES
  'que me estoy perdiendo', 'mayores riesgos', 'mayor riesgo',
  'riesgos operacionales', 'que debo atender', 'que requiere atencion',
  'en que enfocarme', 'en que me debo enfocar',
  // PT
  'maiores riscos', 'maior risco', 'riscos operacionais',
  'no que devo focar', 'o que requer atenção', 'o que requer atencao',
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

  // R-INTELLIGENCE-STABILIZE-1 T3: hard-block pure conversational filler BEFORE
  // any keyword scoring, so chatter like "wow" / "interesting" / "tell me more"
  // can never coincidentally score an operational intent. Downgrades safely to
  // the deterministic fallback handler (same path as a zero-score query).
  if (isConversationalFiller(query)) {
    console.debug(`[IntelligenceRouter] conversational filler blocked → fallback_question: "${query}"`);
    return { id: 'fallback_question', confidence: 0, query: rawQuery };
  }

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
    // R-INTELLIGENCE-BUY-TODAY-RANKING-V1: multi-signal buyer ranking.
    // Listed BEFORE likely_to_buy_today so unique "sell to / generate revenue"
    // phrases route here. Tie-break ensures no hijack of existing outreach phrases.
    { id: 'who_is_most_likely_to_buy_today', score: scoreKeywords(query, WHO_IS_MOST_LIKELY_TO_BUY_TODAY_KEYWORDS) },
    // R-SMART-OUTREACH-CAMPAIGN-V1: listed AFTER who_to_contact_today and
    // who_is_most_likely_to_buy_today so "hoy/today" anchored phrases stay in
    // their handlers. Listed BEFORE likely_to_buy_today so "who should i message
    // right now" wins the position tie-break over likely_to_buy's shorter
    // "who should i message" substring.
    // R-OCE-V1: debug intent — anchored multi-word phrases only to avoid noise.
    { id: 'operational_context_status', score: scoreKeywords(query, OPERATIONAL_CONTEXT_STATUS_KEYWORDS) },
    // R-GPO-V1: listed after operational_context_status so "oce status" stays there.
    { id: 'global_priority_status', score: scoreKeywords(query, GLOBAL_PRIORITY_STATUS_KEYWORDS) },
    { id: 'smart_outreach_campaign', score: scoreKeywords(query, SMART_OUTREACH_CAMPAIGN_KEYWORDS) },
    // R-OUTREACH-OUTCOME-FEEDBACK-V1: listed after smart_outreach_campaign so
    // "outreach campaign" stays there; listed before marketing_campaign.
    { id: 'outreach_performance', score: scoreKeywords(query, OUTREACH_PERFORMANCE_KEYWORDS) },
    // R-INTELLIGENCE-LIKELY-TO-BUY-TODAY-V1: listed AFTER who_to_contact_today
    // so "contact today/hoy" phrases stay in the existing handler; "most likely
    // to buy", "ready to buy", "who should I message" route here.
    { id: 'likely_to_buy_today', score: scoreKeywords(query, LIKELY_TO_BUY_TODAY_KEYWORDS) },
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
    // R-INTELLIGENCE-EXECUTION-OUTPUTS-V1: listed BEFORE customer_history so
    // "recover customer Juan" routes to the specific outreach intent, not name lookup.
    { id: 'recover_customer', score: scoreKeywords(query, RECOVER_CUSTOMER_KEYWORDS) },
    { id: 'vip_outreach',     score: scoreKeywords(query, VIP_OUTREACH_KEYWORDS) },
    { id: 'repair_follow_up', score: scoreKeywords(query, REPAIR_FOLLOW_UP_KEYWORDS) },
    { id: 'repair_escalate',  score: scoreKeywords(query, REPAIR_ESCALATE_KEYWORDS) },
    // INTELLIGENCE-OPERATOR-CONTINUITY-RUNTIME-V1: short follow-up phrases.
    // Listed BEFORE entity_operational_command but AFTER repair_escalate so
    // "follow up repair" / "open repair X" stay in their handlers (they score
    // higher on those specific banks). Bare "continue" wins when analytics
    // banks score 0.
    { id: 'workflow_continuity', score: scoreKeywords(query, WORKFLOW_CONTINUITY_KEYWORDS) },
    // R-EOD-BRIEF F2: end-of-day digest. Listed BEFORE daily_operator_brief_v3
    // (and all legacy daily-brief variants) so EOD-anchored phrases beat the
    // in-progress brief on shared substrings ("resumen del día", "resumo do
    // dia") via position tie-break. Truly unique EOD anchors ("end of day",
    // "fin del día", "fim do dia", "how was today") win on raw score.
    { id: 'end_of_day_brief', score: scoreKeywords(query, END_OF_DAY_BRIEF_KEYWORDS) },
    // R-INTELLIGENCE-OPERATOR-DAILY-BRIEF: compressed store-state briefing.
    // Listed BEFORE focus_today + all legacy daily-brief variants so anchored
    // "daily brief / brief me / store status / resumen de hoy / how are we
    // today" route to the new compact format. Plain "today" / "hoy" still
    // falls to today_summary downstream (no overlap — this bank requires
    // anchored multi-word phrases).
    { id: 'daily_operator_brief_v3', score: scoreKeywords(query, DAILY_OPERATOR_BRIEF_V3_KEYWORDS) },
    // R-INTELLIGENCE-WHAT-SHOULD-I-FOCUS-ON-TODAY: listed BEFORE recommended_
    // next_best_action / who_needs_attention_today so the cross-engine
    // aggregator wins "focus today" / "prioridades de hoy" anchored phrases.
    // Single-engine handlers still win their narrower phrases (e.g., "next
    // best action", "who needs attention today" — both retain their banks
    // and remain above attention_feed / customer_history).
    { id: 'focus_today', score: scoreKeywords(query, FOCUS_TODAY_KEYWORDS) },
    // R-INTELLIGENCE-RECOMMENDED-NEXT-BEST-ACTION: single top-priority action.
    // Listed BEFORE who_needs_attention_today / attention_feed / proactive_
    // operations / decision_recommendation so anchored "next move / siguiente
    // acción / próxima ação" phrases route to the one-action card. Generic
    // "what should I do" still falls to decision_recommendation/proactive
    // because this bank requires the action-anchor ("next" / "siguiente" /
    // "próxima") in addition to the verb.
    { id: 'recommended_next_best_action', score: scoreKeywords(query, RECOMMENDED_NEXT_BEST_ACTION_KEYWORDS) },
    // R-INTELLIGENCE-WHO-NEEDS-ATTENTION-TODAY: cross-domain operator decision
    // engine. Listed BEFORE attention_feed / what_needs_attention / proactive_
    // operations / customer_history so the listed trigger phrases (anchored on
    // today / pendientes / hoje / follow up) route to the new handler. Generic
    // "needs attention" without a time/queue anchor still falls through to
    // attention_feed below (its keyword bank has 'attention' as a bare token
    // which scores 1 on most queries — the new bank uses only multi-word
    // anchored phrases, so attention_feed still wins generic queries).
    { id: 'who_needs_attention_today', score: scoreKeywords(query, WHO_NEEDS_ATTENTION_TODAY_KEYWORDS) },
    // INTELLIGENCE-ATTENTION-FEED-INTEGRATION-V1: listed BEFORE what_needs_attention
    // so attention_feed supersedes the old handler on shared phrases ("urgent",
    // "what needs attention"). Also listed BEFORE daily_operator_brief.
    { id: 'attention_feed', score: scoreKeywords(query, ATTENTION_FEED_KEYWORDS) },
    // INTELLIGENCE-ENTITY-INTEGRATION-V1: explicit command routing runs BEFORE
    // customer_history so "show customer X" / "open repair Y" routes here.
    // Listed AFTER repair_follow_up so "follow up repair" stays in its handler.
    { id: 'entity_operational_command', score: scoreKeywords(query, ENTITY_COMMAND_KEYWORDS) },
    // R-INTELLIGENCE-CUSTOMER-RETENTION-INSIGHTS: retrospective "which
    // customers came back" view. Listed BEFORE customer_history (CUSTOMER_
    // KEYWORDS bank's bare 'cliente'/'customer' tokens would otherwise win)
    // and BEFORE recover_customer (the proactive variant). All triggers are
    // multi-word anchored phrases pairing the noun with a return verb.
    { id: 'customer_retention_insights', score: scoreKeywords(query, CUSTOMER_RETENTION_INSIGHTS_KEYWORDS) },
    // R-INTELLIGENCE-CUSTOMER-360-CHAT-INTENT: per-customer snapshot. Listed
    // AFTER best_customer (line near top) and AFTER recover_customer (their
    // own anchored phrases win), and BEFORE customer_history so explicit
    // "tell me about <name>" / "perfil del cliente <name>" route here while
    // bare "<name> history" / "historial de <name>" still hit customer_history.
    { id: 'customer_360', score: scoreKeywords(query, CUSTOMER_360_KEYWORDS) },
    { id: 'customer_history', score: scoreKeywords(query, CUSTOMER_KEYWORDS) },
    // R-INTELLIGENCE-DAILY-REVENUE-MISSIONS-V1: top-N money-making tasks
    // for today. Listed ABOVE daily_operator_brief + daily_brief so the
    // overlapping anchored phrase "what should I do today" routes to the
    // action-first revenue mission list.
    { id: 'daily_revenue_missions', score: scoreKeywords(query, DAILY_REVENUE_MISSIONS_KEYWORDS) },
    // R-OPERATOR-DAILY-BRIEF-V2: listed BEFORE daily_operator_brief so v2
    // wins on tie-break for shared phrases like "daily brief"/"operator brief".
    { id: 'operator_daily_brief_v2', score: scoreKeywords(query, OPERATOR_DAILY_BRIEF_V2_KEYWORDS) },
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
    // R-INTELLIGENCE-LOW-STOCK-OPPORTUNITY-ENGINE: listed BEFORE inventory_low
    // so "restock / ordenar / reponer / repor" action phrases route to the
    // opportunity engine. Plain "low stock" / "stock bajo" still falls to
    // inventory_low because this bank excludes those tokens.
    { id: 'restock_opportunity', score: scoreKeywords(query, RESTOCK_OPPORTUNITY_KEYWORDS) },
    { id: 'inventory_low', score: scoreKeywords(query, INVENTORY_LOW_KEYWORDS) },
    { id: 'inventory_dead', score: scoreKeywords(query, INVENTORY_DEAD_KEYWORDS) },
    { id: 'inventory_dying', score: scoreKeywords(query, INVENTORY_DYING_KEYWORDS) },
    { id: 'top_items', score: scoreKeywords(query, TOP_ITEMS_KEYWORDS) },
    // R-INTELLIGENCE-REFRESH-FREEZE-QUEUE-CLEANUP-REPAIR-INTENT-FIX:
    // listed ABOVE repairs_overdue so anchored "ready" phrases win.
    { id: 'repairs_ready',   score: scoreKeywords(query, REPAIRS_READY_KEYWORDS) },
    { id: 'repairs_overdue', score: scoreKeywords(query, REPAIRS_KEYWORDS) },
    // R-FUSION-CHAT-INTEGRATION-V1: listed BEFORE what_needs_attention so
    // "missing / risks / focus" phrases route to the fusion handler.
    // No keyword overlap — no hijack risk on attention/priority phrases.
    { id: 'fusion_insights', score: scoreKeywords(query, FUSION_INSIGHTS_KEYWORDS) },
    { id: 'what_needs_attention', score: scoreKeywords(query, WHAT_NEEDS_ATTENTION_KEYWORDS) },
    // R-INTELLIGENCE-MANAGER-QUEUE-V1: anchored multi-word phrases — no collision.
    { id: 'manager_queue', score: scoreKeywords(query, MANAGER_QUEUE_KEYWORDS) },
    { id: 'health_check', score: scoreKeywords(query, HEALTH_KEYWORDS) },
    { id: 'forecast_items', score: scoreKeywords(query, FORECAST_KEYWORDS) },
    { id: 'anomaly_days', score: scoreKeywords(query, ANOMALY_KEYWORDS) },
    { id: 'who_to_contact', score: scoreKeywords(query, WHO_TO_CONTACT_KEYWORDS) },
    { id: 'what_hurting_profit', score: scoreKeywords(query, WHAT_HURTING_PROFIT_KEYWORDS) },
    // R-INTELLIGENCE-WHAT-IS-LOSING-ME-MONEY: listed BEFORE where_losing_money
    // so anchored "what is losing me money / qué me está haciendo perder /
    // onde estou perdendo" phrases route to the deterministic leak detector.
    // The legacy where_losing_money handler stays as fallback for shorter
    // phrasings.
    { id: 'what_is_losing_money', score: scoreKeywords(query, WHAT_IS_LOSING_MONEY_KEYWORDS) },
    { id: 'where_losing_money', score: scoreKeywords(query, WHERE_LOSING_MONEY_KEYWORDS) },
    // R-INTELLIGENCE-PUSH-RIGHT-NOW-V1: listed BEFORE proactive_opportunities so
    // urgency phrases ("right now", "today", "what should i push right now") win
    // the tie-break over the generic "what should i push" substring in proactive.
    // Bare "what should i push" still routes to proactive (scores 0 here; 1 there).
    { id: 'push_right_now', score: scoreKeywords(query, PUSH_RIGHT_NOW_KEYWORDS) },
    // R-INTELLIGENCE-PROACTIVE-OPPORTUNITIES-V1: list ABOVE product_opportunities
    // so a bare "opportunities" query routes to the multi-source operator
    // briefing. product_opportunities (product-only ranked list) still wins
    // for product-anchored phrases like "what to promote" / "high margin".
    { id: 'proactive_opportunities', score: scoreKeywords(query, PROACTIVE_OPPORTUNITIES_KEYWORDS) },
    { id: 'product_opportunities', score: scoreKeywords(query, PRODUCT_OPPORTUNITY_KEYWORDS) },
    // R-INTELLIGENCE-DECISION-RECOMMENDATION-V1: listed BEFORE operational_reasoning
    // so "best move" / "what should I do" phrases route to the decision layer
    // rather than the condition-detection layer.
    { id: 'decision_recommendation', score: scoreKeywords(query, DECISION_RECOMMENDATION_KEYWORDS) },
    // R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1: listed BEFORE proactive_operations
    // so "what's really going on" / "store diagnosis" routes to cross-system
    // reasoning rather than the single-domain action list.
    { id: 'operational_reasoning', score: scoreKeywords(query, OPERATIONAL_REASONING_KEYWORDS) },
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
    // R-INTELLIGENCE-WHY-DID-SALES-DROP: listed BEFORE root_cause so anchored
    // "why DID sales drop" / "what changed this week" / "why are profits down"
    // phrases route to the comparative engine. root_cause still owns the
    // weekday / generic-decline phrasings.
    { id: 'why_did_sales_drop', score: scoreKeywords(query, WHY_DID_SALES_DROP_KEYWORDS) },
    { id: 'root_cause', score: scoreKeywords(query, ROOT_CAUSE_KEYWORDS) },
    { id: 'slow_day_root_cause', score: scoreKeywords(query, SLOW_DAY_ROOT_CAUSE_KEYWORDS) },
    // R-INTELLIGENCE-WHY-IS-TODAY-SLOW: listed BEFORE slow_day_diagnostic so
    // the deterministic diagnosis engine wins shared "why slow today" phrases.
    // slow_day_diagnostic keeps the legacy weekday explanation path for any
    // phrasing not in the new bank.
    { id: 'why_is_today_slow', score: scoreKeywords(query, WHY_IS_TODAY_SLOW_KEYWORDS) },
    { id: 'slow_day_diagnostic', score: scoreKeywords(query, SLOW_DAY_DIAGNOSTIC_KEYWORDS) },
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
    // R-INTELLIGENCE-STABILIZE-1 T4: no bank matched — visible downgrade reason.
    console.debug('[IntelligenceRouter] no keyword match → fallback_question (confidence downgraded to 0)');
    return { id: 'fallback_question', confidence: 0, query: rawQuery };
  }

  // INTELLIGENCE-ROUTING-TIEBREAK-FIX-V1: "what should i do [now]" and peer
  // action phrases appear in DECISION_RECOMMENDATION_KEYWORDS as substrings,
  // causing decision_recommendation to win via list-order over
  // proactive_operations. Force the correct intent when one of these canonical
  // action phrases is present and proactive_operations scored > 0.
  const PROACTIVE_TIEBREAK_PHRASES = [
    'what should i do', 'what should we do', 'what should i focus on',
    'que hago', 'qué hago', 'que debo hacer', 'qué debo hacer',
  ];
  if (
    winner.id === 'decision_recommendation' &&
    PROACTIVE_TIEBREAK_PHRASES.some(p => query.includes(p)) &&
    (scores.find(s => s.id === 'proactive_operations')?.score ?? 0) > 0
  ) {
    winner.id = 'proactive_operations';
  }

  const confidence = Math.min(1, winner.score / 2);
  const result: IntentMatch = { id: winner.id, confidence };

  // R-INTELLIGENCE-STABILIZE-1 T4: surface the selected intent + confidence so
  // weak (score 1 → 0.5) matches are visible in the console when debugging
  // erratic routing. Lightweight console only — no telemetry, no analytics.
  console.debug(`[IntelligenceRouter] intent=${winner.id} score=${winner.score} confidence=${confidence.toFixed(2)}`);

  // R-INTELLIGENCE-OPERATIONAL-PHRASES-1: when an operator phrase alias drove
  // the (existing) winning intent, surface it for routing diagnostics.
  for (const a of OPERATIONAL_ALIASES) {
    if (winner.id === a.intent && query.includes(a.phrase)) {
      console.debug(`[IntelligenceRouter] alias matched phrase=${a.phrase} intent=${winner.id}`);
      break;
    }
  }

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

  // INTELLIGENCE-ENTITY-INTEGRATION-V1: pass raw query so the handler can
  // run resolveEntityIntent on the full original string.
  if (winner.id === 'entity_operational_command') {
    result.query = rawQuery;
  }

  // INTELLIGENCE-OPERATOR-CONTINUITY-RUNTIME-V1: pass raw query for follow-up classification.
  if (winner.id === 'workflow_continuity') {
    result.query = rawQuery;
  }

  // INTELLIGENCE-ATTENTION-FEED-INTEGRATION-V1: pass raw query for context.
  if (winner.id === 'attention_feed') {
    result.query = rawQuery;
  }

  // For customer_history intent, resolve the name.
  // R-INTELLIGENCE-CUSTOMER-360-CHAT-INTENT: customer_360 reuses the exact
  // same name-extraction + fuzzy-match path. No new resolver — same
  // extractedName / matchedCustomer / candidateCustomers fields on IntentMatch.
  if (winner.id === 'customer_history' || winner.id === 'customer_360') {
    const allBanks = [
      BEST_CUSTOMER_KEYWORDS, LEAST_PROFITABLE_KEYWORDS, MULTI_PHONE_CUSTOMERS_KEYWORDS, CUSTOMER_KEYWORDS, DAILY_BRIEF_KEYWORDS, DAILY_OPERATOR_BRIEF_KEYWORDS, DAILY_REVENUE_MISSIONS_KEYWORDS, TODAY_MONEY_MAP_KEYWORDS, OPERATOR_MODE_KEYWORDS, PROPOSAL_FOLLOWUP_KEYWORDS, DEAL_PIPELINE_KEYWORDS, MARK_DEAL_STAGE_KEYWORDS, CLOSE_TODAY_KEYWORDS, ACTION_IMPACT_KEYWORDS, ACTION_LEARNING_KEYWORDS, PROPOSE_DEAL_KEYWORDS, DEAL_PERFORMANCE_KEYWORDS, PROACTIVE_OPPORTUNITIES_KEYWORDS, CONVERSATION_RUNNER_KEYWORDS, TODAY_SALES_KEYWORDS, TODAY_SUMMARY_KEYWORDS, SALES_KEYWORDS, INVENTORY_LOW_KEYWORDS,
      INVENTORY_DEAD_KEYWORDS, INVENTORY_DYING_KEYWORDS, TOP_ITEMS_KEYWORDS,
      REPAIRS_KEYWORDS, REPAIRS_READY_KEYWORDS, HEALTH_KEYWORDS, FORECAST_KEYWORDS,
      ANOMALY_KEYWORDS, WHO_TO_CONTACT_KEYWORDS, WHO_TO_CONTACT_TODAY_KEYWORDS, MARKETING_KEYWORDS, PRODUCT_PUSH_KEYWORDS, WHAT_HURTING_PROFIT_KEYWORDS,
      PRODUCT_OPPORTUNITY_KEYWORDS, ROOT_CAUSE_KEYWORDS, SLOW_DAY_ROOT_CAUSE_KEYWORDS,
      DEAD_STOCK_ROOT_CAUSE_KEYWORDS, CUSTOMER_CHURN_KEYWORDS, DATA_QUERY_KEYWORDS, HELP_KEYWORDS,
      RECOVER_CUSTOMER_KEYWORDS, VIP_OUTREACH_KEYWORDS, REPAIR_FOLLOW_UP_KEYWORDS, REPAIR_ESCALATE_KEYWORDS,
      // R-INTELLIGENCE-CUSTOMER-360-CHAT-INTENT: include the new bank's
      // tokens as stop-words so "tell me about", "perfil del cliente", etc.
      // are stripped from the extracted name fragment.
      CUSTOMER_360_KEYWORDS,
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
      RECOVER_CUSTOMER_KEYWORDS, VIP_OUTREACH_KEYWORDS, REPAIR_FOLLOW_UP_KEYWORDS, REPAIR_ESCALATE_KEYWORDS,
    ];
    const productFragment = extractName(query, allBanks);
    if (productFragment) result.extractedProduct = productFragment;
  }

  // R-INTELLIGENCE-EXECUTION-OUTPUTS-V1: extract name for outreach + repair intents.
  // Customer intents also do fuzzy customer lookup; repair intents use extractedName
  // to search repairs in the handler.
  if (
    winner.id === 'recover_customer' ||
    winner.id === 'vip_outreach' ||
    winner.id === 'repair_follow_up' ||
    winner.id === 'repair_escalate'
  ) {
    const allBanks = [
      BEST_CUSTOMER_KEYWORDS, LEAST_PROFITABLE_KEYWORDS, MULTI_PHONE_CUSTOMERS_KEYWORDS, CUSTOMER_KEYWORDS, DAILY_BRIEF_KEYWORDS, DAILY_OPERATOR_BRIEF_KEYWORDS, DAILY_REVENUE_MISSIONS_KEYWORDS, TODAY_MONEY_MAP_KEYWORDS, OPERATOR_MODE_KEYWORDS, PROPOSAL_FOLLOWUP_KEYWORDS, DEAL_PIPELINE_KEYWORDS, MARK_DEAL_STAGE_KEYWORDS, CLOSE_TODAY_KEYWORDS, ACTION_IMPACT_KEYWORDS, ACTION_LEARNING_KEYWORDS, PROPOSE_DEAL_KEYWORDS, DEAL_PERFORMANCE_KEYWORDS, PROACTIVE_OPPORTUNITIES_KEYWORDS, CONVERSATION_RUNNER_KEYWORDS, TODAY_SALES_KEYWORDS, TODAY_SUMMARY_KEYWORDS, SALES_KEYWORDS, INVENTORY_LOW_KEYWORDS,
      INVENTORY_DEAD_KEYWORDS, INVENTORY_DYING_KEYWORDS, TOP_ITEMS_KEYWORDS,
      REPAIRS_KEYWORDS, REPAIRS_READY_KEYWORDS, HEALTH_KEYWORDS, FORECAST_KEYWORDS,
      ANOMALY_KEYWORDS, WHO_TO_CONTACT_KEYWORDS, WHO_TO_CONTACT_TODAY_KEYWORDS, MARKETING_KEYWORDS, PRODUCT_PUSH_KEYWORDS, WHAT_HURTING_PROFIT_KEYWORDS,
      PRODUCT_OPPORTUNITY_KEYWORDS, ROOT_CAUSE_KEYWORDS, SLOW_DAY_ROOT_CAUSE_KEYWORDS,
      DEAD_STOCK_ROOT_CAUSE_KEYWORDS, CUSTOMER_CHURN_KEYWORDS, DATA_QUERY_KEYWORDS, HELP_KEYWORDS,
      RECOVER_CUSTOMER_KEYWORDS, VIP_OUTREACH_KEYWORDS, REPAIR_FOLLOW_UP_KEYWORDS, REPAIR_ESCALATE_KEYWORDS,
    ];
    const nameFragment = extractName(query, allBanks);
    if (nameFragment) {
      result.extractedName = nameFragment;
      if (winner.id === 'recover_customer' || winner.id === 'vip_outreach') {
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
  }

  return result;
}
