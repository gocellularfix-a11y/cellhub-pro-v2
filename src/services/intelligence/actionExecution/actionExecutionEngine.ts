// CellHub Intelligence — Action Execution Engine
// Pairs each ContextSuggestion with its applicable executable actions.
// Pure function — safe to call inside useMemo.

import type { ContextSuggestion } from '@/services/intelligence/liveContext/contextTypes';
import type { ActionExecutionContext, OperatorExecutableAction } from './actionExecutionTypes';
import { getActionsForSuggestion } from './actionExecutionRegistry';

export interface SuggestionWithActions {
  suggestion: ContextSuggestion;
  actions: OperatorExecutableAction[];
}

/**
 * Pair each suggestion with its canExecute-filtered action set.
 * Safe to call every render via useMemo — no side effects.
 */
export function resolveSuggestionActions(
  suggestions: ContextSuggestion[],
  ctx: ActionExecutionContext,
  maxActionsPerSuggestion = 2,
): SuggestionWithActions[] {
  return suggestions.map((s) => ({
    suggestion: s,
    actions: getActionsForSuggestion(s.id, ctx, maxActionsPerSuggestion),
  }));
}

/**
 * Flat list of all unique executable actions across all suggestions.
 * Useful for quick-action panels that want a consolidated action bar.
 */
export function resolveAllActions(
  suggestions: ContextSuggestion[],
  ctx: ActionExecutionContext,
): OperatorExecutableAction[] {
  const seen = new Set<string>();
  const out: OperatorExecutableAction[] = [];
  for (const s of suggestions) {
    for (const a of getActionsForSuggestion(s.id, ctx)) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        out.push(a);
      }
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}
