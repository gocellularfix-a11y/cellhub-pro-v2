// ============================================================
// Structured Query Executor — analytical follow-up context (I3-2).
//
// Minimal analytical context for direct follow-ups ("What about last
// month?", "¿Y la ganancia?"). Mirrors the existing sessionContext TTL
// semantics (isSessionEntryExpired) — NOT a new long-term memory. Only a
// SUCCESSFUL structured answer stores context; unknown queries and failed
// executions never mutate it. Explicit new input always overrides.
// ============================================================

import { isSessionEntryExpired } from '../chat/sessionContext';
import type { ParsedBusinessQuery, BusinessMetric, BusinessDimension, ParsedDateRange, RecognizedEntity } from '../language/types';

export interface AnalyticalContext {
  metric?: BusinessMetric;
  dimension?: BusinessDimension;
  entity?: RecognizedEntity;
  dateRange?: ParsedDateRange;
  timestamp: number;
}

let lastContext: AnalyticalContext | null = null;

export function setAnalyticalContext(parsed: ParsedBusinessQuery, now: number = Date.now()): void {
  lastContext = {
    metric: parsed.metric,
    dimension: parsed.dimension,
    entity: parsed.entity,
    dateRange: parsed.dateRange,
    timestamp: now,
  };
}

export function getAnalyticalContext(now: number = Date.now()): AnalyticalContext | null {
  if (!lastContext) return null;
  if (isSessionEntryExpired(lastContext.timestamp, now)) { lastContext = null; return null; }
  return lastContext;
}

export function clearAnalyticalContext(): void { lastContext = null; }

/** Merge a partial follow-up with the stored context. Only fields genuinely
 *  OMITTED from the new parse are filled; explicit new input always wins.
 *  Returns null when the parse is not a mergeable follow-up (it already has
 *  metric+intent, or it carries no analytical signal at all). */
export function mergeFollowUp(parsed: ParsedBusinessQuery, now: number = Date.now()): ParsedBusinessQuery | null {
  const context = getAnalyticalContext(now);
  if (!context) return null;

  const hasSignal = !!parsed.metric || !!parsed.dateRange || !!parsed.entity || !!parsed.dimension;
  if (!hasSignal) return null;                       // unrelated chatter — never merge
  if (parsed.intent !== 'unknown' && parsed.metric && parsed.dateRange) return null; // complete question — no merge needed

  const merged: ParsedBusinessQuery = {
    ...parsed,
    intent: parsed.intent === 'unknown' ? 'get_metric' : parsed.intent,
    metric: parsed.metric ?? context.metric,
    dimension: parsed.dimension ?? context.dimension,
    entity: parsed.entity ?? context.entity,
    dateRange: parsed.dateRange ?? context.dateRange,
    assumptions: [...parsed.assumptions, 'Merged with the previous question context.'],
  };
  if (!merged.metric) return null;                   // still nothing executable
  // Confidence floor for a coherent follow-up merge.
  merged.confidence = Math.max(parsed.confidence, 0.6);
  return merged;
}
