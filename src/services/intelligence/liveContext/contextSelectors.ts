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

// ── Recent-activity memory helpers ───────────────────────

/** Returns unique customer IDs seen in recent actions, most-recent first. */
export function getRecentCustomers(ctx: LiveContext, maxResults = 5): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const a of ctx.recentActions) {
    const id = a.metadata?.customerId;
    if (typeof id === 'string' && !seen.has(id)) {
      seen.add(id);
      result.push(id);
      if (result.length >= maxResults) break;
    }
  }
  return result;
}

/** Returns unique repair IDs seen in recent actions, most-recent first. */
export function getRecentRepairs(ctx: LiveContext, maxResults = 5): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const a of ctx.recentActions) {
    if (a.type !== 'repair_opened' && a.type !== 'repair_completed') continue;
    const id = a.metadata?.repairId;
    if (typeof id === 'string' && !seen.has(id)) {
      seen.add(id);
      result.push(id);
      if (result.length >= maxResults) break;
    }
  }
  return result;
}

/** Returns recent search query strings, most-recent first. */
export function getRecentSearches(ctx: LiveContext, maxResults = 5): string[] {
  const result: string[] = [];
  for (const a of ctx.recentActions) {
    if (a.type !== 'customer_searched') continue;
    const q = a.metadata?.query;
    if (typeof q === 'string' && q.length > 0) {
      result.push(q);
      if (result.length >= maxResults) break;
    }
  }
  return result;
}

/** Returns unique SKUs opened from inventory, most-recent first. */
export function getRecentInventoryLookups(ctx: LiveContext, maxResults = 5): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const a of ctx.recentActions) {
    if (a.type !== 'inventory_lookup') continue;
    const sku = a.metadata?.sku;
    if (typeof sku === 'string' && !seen.has(sku)) {
      seen.add(sku);
      result.push(sku);
      if (result.length >= maxResults) break;
    }
  }
  return result;
}

/**
 * Count occurrences of a customer in recent actions within a time window.
 * Used for "same customer viewed repeatedly" pattern detection.
 */
export function countCustomerFrequency(
  ctx: LiveContext,
  customerId: string,
  withinMs = 600_000,
): number {
  const cutoff = Date.now() - withinMs;
  return ctx.recentActions.filter(
    (a) => a.timestamp >= cutoff && a.metadata?.customerId === customerId,
  ).length;
}

/** Count occurrences of an action type within a time window. */
export function countActionTypeFrequency(
  ctx: LiveContext,
  type: string,
  withinMs = 600_000,
): number {
  const cutoff = Date.now() - withinMs;
  return ctx.recentActions.filter(
    (a) => a.type === type && a.timestamp >= cutoff,
  ).length;
}

/** Count how many times a repair was opened within a time window. */
export function countRepairFrequency(
  ctx: LiveContext,
  repairId: string,
  withinMs = 900_000,
): number {
  const cutoff = Date.now() - withinMs;
  return ctx.recentActions.filter(
    (a) => a.type === 'repair_opened' && a.metadata?.repairId === repairId && a.timestamp >= cutoff,
  ).length;
}
