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
import { setAnalyticalContext, mergeFollowUp } from './analyticalContext';
import { buildRuntimeEntitySet } from './buildRuntimeEntitySet';

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

    // Follow-up merge for partial questions ("what about last month?").
    if (parsed.intent === 'unknown' || (!parsed.metric && parsed.intent === 'get_metric') || (parsed.metric && !parsed.dateRange && parsed.intent === 'get_metric')) {
      const merged = mergeFollowUp(parsed);
      if (merged) parsed = merged;
    }

    if (parsed.intent === 'unknown') return null;
    if (parsed.confidence < STRUCTURED_QUERY_MIN_CONFIDENCE) return null;

    // ── Structured blocking guards (fields, not message matching) ──
    // These are RECOGNIZED business questions that cannot execute exactly —
    // they get a TERMINAL localized response, never a legacy financial answer.
    const terminal = (reason: import('./types').StructuredUnsupportedReason): StructuredChatResponse =>
      ({ kind: 'answer', text: formatTerminalReason(reason, lang) });

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
      return text ? { kind: 'answer', text } : null;
    }
    if (result.status === 'no_data' || result.status === 'not_found'
        || (result.status === 'ambiguous' && parsed.intent === 'find_customer' && result.diagnostics?.candidates?.length)) {
      // Honest non-answer for a trustworthy interpretation. Failed execution
      // never replaces the last valid analytical context.
      const text = formatBusinessQueryAnswer(result, lang);
      return text ? { kind: 'answer', text } : null;
    }
    // RECOGNIZED-but-blocked (typed reason) → TERMINAL localized response.
    // A confidently recognized financial question must never fall through to
    // a legacy financial handler.
    if ((result.status === 'unsupported' || result.status === 'ambiguous') && result.unsupportedReason) {
      return terminal(result.unsupportedReason);
    }
    return null;   // genuinely unrecognized / internal error → legacy fallback
  } catch (err) {
    // Never crash chat; log through the existing console convention and fall back.
    // eslint-disable-next-line no-console
    console.warn('[intelligence] structured query failed, falling back:', err);
    return null;
  }
}
