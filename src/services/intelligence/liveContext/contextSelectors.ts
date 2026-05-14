// ============================================================
// CellHub Pro — Live Context Selectors (R-INTELLIGENCE-LIVE-CONTEXT-V1)
// Pure functions over LiveContext — no side effects, no I/O.
// ============================================================

import type { LiveContext, LiveAction } from './contextTypes';

/** Returns the most recent action matching `type`, or null. */
export function getRecentActionOfType(ctx: LiveContext, type: string): LiveAction | null {
  return ctx.recentActions.find((a) => a.type === type) ?? null;
}

/** Returns true when any action in `module` fired within `withinMs` (default 5 min). */
export function hasActionInModule(
  ctx: LiveContext,
  module: string,
  withinMs = 300_000,
): boolean {
  const cutoff = Date.now() - withinMs;
  return ctx.recentActions.some((a) => a.module === module && a.timestamp >= cutoff);
}

/** Returns elapsed ms since the session started. */
export function getSessionDurationMs(ctx: LiveContext): number {
  return Date.now() - ctx.session.sessionStartAt;
}

/** Returns the types of the `n` most recent actions (most-recent first). */
export function getRecentActionTypes(ctx: LiveContext, n = 5): string[] {
  return ctx.recentActions.slice(0, n).map((a) => a.type);
}

/**
 * Returns the most recent action if it fired within `ms` milliseconds, else null.
 * Used for "just now" recency checks.
 */
export function lastActionWithinMs(ctx: LiveContext, ms: number): LiveAction | null {
  const cutoff = Date.now() - ms;
  const first = ctx.recentActions[0];
  return first && first.timestamp >= cutoff ? first : null;
}

/** Returns true when the session has seen at least one customer interaction. */
export function hasCustomerInSession(ctx: LiveContext): boolean {
  return ctx.session.lastCustomerId !== null || ctx.activeCustomer !== null;
}
