// INTELLIGENCE-OPERATOR-ATTENTION-SYSTEM-V1
// Lightweight in-memory attention item tracker with TTL.
// No persistence — session-scoped only. No side effects.

import type { OperatorAttentionItem } from './types';

const DEFAULT_TTL_MS = 8 * 3_600_000; // 8 hours

interface TrackedItem {
  item: OperatorAttentionItem;
  expiresAt: number;
}

const store = new Map<string, TrackedItem>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register an attention item. Idempotent: if the same id already exists,
 * updates only when the incoming severity is equal or higher (escalation),
 * preserving the original createdAt.
 */
export function registerAttentionItem(
  item: OperatorAttentionItem,
  ttlMs = DEFAULT_TTL_MS,
): void {
  purgeExpiredAttention();
  const existing = store.get(item.id);
  if (existing) {
    if (item.severity >= existing.item.severity) {
      store.set(item.id, {
        item: { ...item, createdAt: existing.item.createdAt },
        expiresAt: existing.expiresAt,
      });
    }
    return;
  }
  store.set(item.id, { item, expiresAt: Date.now() + ttlMs });
}

/** Mark an attention item as resolved and remove it from tracking. */
export function resolveAttentionItem(id: string): void {
  store.delete(id);
}

/**
 * Returns all active (non-expired) attention items sorted by severity desc.
 * Triggers a lazy purge of expired entries.
 */
export function getAttentionItems(): OperatorAttentionItem[] {
  purgeExpiredAttention();
  return Array.from(store.values())
    .map(t => t.item)
    .sort((a, b) => b.severity - a.severity);
}

/** Remove all expired entries. Called lazily before any read or write. */
export function purgeExpiredAttention(): void {
  const now = Date.now();
  for (const [id, tracked] of store) {
    if (now > tracked.expiresAt) store.delete(id);
  }
}
