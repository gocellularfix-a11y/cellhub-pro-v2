// ============================================================
// Structured Query Executor — live-chat gate (I3-2).
//
// The single integration point handlers.ts calls: parse → (follow-up merge)
// → validate → execute → format. Returns a ChatResponse ONLY for a
// trustworthy supported interpretation (answered / no_data / not_found /
// customer ambiguity); everything else returns null so the EXISTING legacy
// chat behavior continues unchanged. Errors at the executor boundary are
// caught — production chat never crashes because a structured query failed.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import { parseBusinessQuery } from '../language';
import type { BusinessLanguage } from '../language/types';
import { executeBusinessQuery, STRUCTURED_QUERY_MIN_CONFIDENCE } from './executeBusinessQuery';
import { formatBusinessQueryAnswer, formatTerminalReason } from './formatBusinessQueryAnswer';
import { setAnalyticalContext, mergeFollowUp, getAnalyticalContext } from './analyticalContext';
import { buildRuntimeEntitySet } from './buildRuntimeEntitySet';
// I3-3: analyst explanation layer (trend + exact contributors on answers).
import { buildAnswerExplanation } from '../insights/explanationLayer';

// I3-3 Part 13: "What changed?" — a follow-up that re-runs the last metric as
// a previous-period comparison. Deterministic patterns, EN/ES/PT.
const WHAT_CHANGED_RE = /^[¿¡]?\s*(what changed|what happened|que cambio|qué cambió|que paso|qué pasó|o que mudou|o que aconteceu)\s*\??$/i;

/** Minimal ChatResponse shape (kept structural to avoid an import cycle with
 *  handlers.ts — same fields the chat renders). */
export interface StructuredChatResponse {
  kind: 'answer';
  text: string;
}

export function tryHandleStructuredBusinessQuery(
  engine: IntelligenceEngine,
  rawQuery: string,
  lang: BusinessLanguage,
  referenceDate?: Date,
): StructuredChatResponse | null {
  try {
    if (!rawQuery || !rawQuery.trim()) return null;
    const ctx = engine.getStructuredQueryContext(referenceDate);
    const entities = buildRuntimeEntitySet(ctx);
    let parsed = parseBusinessQuery(rawQuery, { language: lang, referenceDate: ctx.referenceDate, entities });

    // I3-3: "What changed?" — rebuild the last metric as a previous-period
    // comparison from the analytical context (no reparse of the old question).
    if (WHAT_CHANGED_RE.test(rawQuery.trim())) {
      const context = getAnalyticalContext();
      if (context?.metric) {
        parsed = {
          ...parsed,
          intent: 'compare_metric',
          comparison: 'versus_previous_period',
          metric: context.metric,
          dimension: context.dimension,
          entity: undefined,             // whole-store comparison
          dateRange: context.dateRange,
          confidence: 0.7,
          assumptions: [...parsed.assumptions, 'Re-ran the previous metric versus its prior period.'],
        };
      }
    }

    // Follow-up merge for partial questions ("what about last month?").
    if (parsed.intent === 'unknown' || (!parsed.metric && parsed.intent === 'get_metric') || (parsed.metric && !parsed.dateRange && parsed.intent === 'get_metric')) {
      const merged = mergeFollowUp(parsed);
      if (merged) parsed = merged;
    }

    if (parsed.intent === 'unknown') return null;
    if (parsed.confidence < STRUCTURED_QUERY_MIN_CONFIDENCE) return null;

    // ── RECOGNITION ESTABLISHED (CHAT-R1.1) ────────────────────
    // From this point the structured layer OWNS the request: every outcome
    // below — answer, honest no-data, typed terminal, or internal failure —
    // is final. Nothing recognized ever falls through to a legacy handler
    // that could answer with a different period or meaning.
    const terminal = (reason: import('./types').StructuredUnsupportedReason): StructuredChatResponse =>
      ({ kind: 'answer', text: formatTerminalReason(reason, lang) });
    try {

    // ── Structured blocking guards (fields, not message matching) ──
    // These are RECOGNIZED business questions that cannot execute exactly —
    // they get a TERMINAL localized response, never a legacy financial answer.

    // 1. A comparison connector with NO resolved operands ("sales A vs B vs C")
    //    — never degrade a comparison into an unrelated single-metric answer.
    if (/\b(vs|versus|contra)\b/.test(parsed.normalizedText)
        && !parsed.comparisonOperands
        && parsed.comparison === undefined) {
      return terminal('missing_comparison_operand');
    }
    // 2. A month-name custom-date ATTEMPT the parser rejected (e.g. Feb 30) —
    //    never silently execute the default range for an invalid date.
    if (parsed.dateRange?.kind !== 'custom'
        && /\b(to|through|until|al|a|hasta|ate)\b/.test(parsed.normalizedText)
        && /(january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janeiro|fevereiro|marco|maio|junho|julho|setembro|outubro|novembro|dezembro)\s+\d{1,2}|\d{1,2}\s+de\s+/.test(parsed.normalizedText)) {
      return terminal('invalid_date_range');
    }
    // 3. Provider/carrier conflict: a payment_provider dimension with a CARRIER
    //    entity is genuinely ambiguous — never guess.
    if (parsed.dimension === 'payment_provider' && parsed.entity?.type === 'carrier') {
      return terminal('incompatible_dimensions');
    }
    // 4. "How many returns" — the canonical service exposes the refunded
    //    AMOUNT exactly, not a return count. Typed terminal, never a guess.
    if (parsed.metric === 'returns'
        && /\b(how many|cuantas|cuantos|quantas|quantos)\b/.test(parsed.normalizedText)) {
      return terminal('return_count_unavailable');
    }

    const result = executeBusinessQuery(parsed, ctx);

    // Trustworthy outcomes take over the answer.
    if (result.status === 'answered') {
      setAnalyticalContext(parsed);
      const text = formatBusinessQueryAnswer(result, lang);
      // CHAT-R1.1: an executed answer with an empty presentation is an
      // internal failure of a RECOGNIZED query — terminal, never legacy.
      if (!text) return terminal('structured_engine_unavailable');
      // I3-3 explanation layer: trend + exact contributors, only when
      // mathematically available (whole-store single metrics).
      const explanation = buildAnswerExplanation(result, ctx, lang);
      return { kind: 'answer', text: explanation.length > 0 ? `${text}\n${explanation.join('\n')}` : text };
    }
    if (result.status === 'no_data' || result.status === 'not_found'
        || (result.status === 'ambiguous' && parsed.intent === 'find_customer' && result.diagnostics?.candidates?.length)) {
      // Honest non-answer for a trustworthy interpretation. Failed execution
      // never replaces the last valid analytical context. CHAT-R1.1: an empty
      // no-data presentation stays terminal — a recognized query never falls
      // through to a legacy handler with a different period/meaning.
      const text = formatBusinessQueryAnswer(result, lang);
      return text ? { kind: 'answer', text } : terminal('structured_engine_unavailable');
    }
    // RECOGNIZED-but-blocked (typed reason) → TERMINAL localized response.
    // A confidently recognized financial question must never fall through to
    // a legacy financial handler.
    if ((result.status === 'unsupported' || result.status === 'ambiguous') && result.unsupportedReason) {
      return terminal(result.unsupportedReason);
    }
    // CHAT-R1.2: NO post-recognition null escape. A reason-less outcome after
    // recognition (an 'error' status, or an ambiguous result without
    // candidates) is an internal condition of a RECOGNIZED query — terminal
    // honest unavailability, never a legacy handler with another period.
    return terminal('structured_engine_unavailable');

    } catch (err) {
      // CHAT-R1.1 TERMINALITY: recognized query + internal failure → honest
      // localized terminal response. NEVER null, NEVER a legacy answer with a
      // different period. (Mirrors the I4.1 manager terminality contract.)
      // eslint-disable-next-line no-console
      console.warn('[intelligence] structured query failed AFTER recognition — terminal:', err);
      return terminal('structured_engine_unavailable');
    }
  } catch (err) {
    // Pre-recognition failure (context/entities/parse): nothing was
    // recognized yet, so the legacy path legitimately keeps ownership.
    // eslint-disable-next-line no-console
    console.warn('[intelligence] structured query failed, falling back:', err);
    return null;
  }
}
