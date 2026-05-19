// R-GOER-V1 — Global Operational Entity Resolution: matchers
// Deterministic helpers that extract entity references from queries and context.
// NO AI, NO fuzzy matching, NO embeddings — pattern matching + context lookup only.
// Returns null when ambiguous. Never guesses.

import type { OperationalContextSnapshot, OperationalSignalType, OperationalModule } from '../operationalContextTypes';
import type { ResolvedEntity } from './types';

// ── Internal context type guards ──────────────────────────────────────────────

/**
 * Lightweight session context from intentRouter.ts OperationalContext.
 * Mirrors that interface locally to avoid a cross-module import.
 */
interface SessionCtx {
  type: 'product' | 'customer' | 'deal' | 'category' | 'repair';
  value: string;
  timestamp: number;
}

function isSessionCtx(v: unknown): v is SessionCtx {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['type'] === 'string' &&
    typeof o['value'] === 'string' &&
    typeof o['timestamp'] === 'number'
  );
}

function isOceSnapshot(v: unknown): v is OperationalContextSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o['signals']) && typeof o['generatedAt'] === 'number';
}

// ── Phone normalization ────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '').slice(-10);
}

// ── Explicit matchers ─────────────────────────────────────────────────────────

/**
 * Extracts an explicit customer reference from a query via US phone number pattern.
 * Returns normalized 10-digit phone as customerId (a lookup hint, not the customer UUID).
 *
 * TODO: when IntelligenceEngine is injected, resolve phone → actual Customer.id.
 */
export function matchExplicitCustomer(
  query: string,
): (ResolvedEntity & { type: 'customer' }) | null {
  const patterns: RegExp[] = [
    /\b(\d{3})[.\s-](\d{3})[.\s-](\d{4})\b/,  // 805-555-1234
    /\(\d{3}\)\s*\d{3}[.\s-]\d{4}/,             // (805) 555-1234
    /\b\d{10}\b/,                                 // 8055551234
  ];
  for (const pat of patterns) {
    const m = query.match(pat);
    if (m) {
      const phone = normalizePhone(m[0]);
      if (phone.length === 10) {
        return { type: 'customer', customerId: phone, confidence: 0.9 };
      }
    }
  }
  return null;
}

/**
 * Extracts an explicit repair ticket reference from a query.
 * Matches: R-XXXX, repair #XXXX, ticket #XXXX (XXXX must contain at least one digit).
 *
 * TODO: when IntelligenceEngine is injected, resolve ticket pattern → actual Repair.id.
 */
export function matchExplicitRepair(
  query: string,
): (ResolvedEntity & { type: 'repair' }) | null {
  // R-XXXX format (most reliable — explicit ticket prefix)
  const rMatch = query.match(/\b(r-[a-z0-9]{4,10})\b/i);
  if (rMatch && rMatch[1]) {
    return { type: 'repair', repairId: rMatch[1].toUpperCase(), confidence: 0.95 };
  }
  // repair #XXXX (# required to avoid matching "repair phones", "repair job", etc.)
  const repMatch = query.match(/\brepair\s+#(\d[a-z0-9]{3,9})\b/i);
  if (repMatch && repMatch[1]) {
    return { type: 'repair', repairId: repMatch[1], confidence: 0.9 };
  }
  // ticket #XXXX or ticket XXXX (must start with digit)
  const tickMatch = query.match(/\bticket\s+#?(\d[a-z0-9]{3,9})\b/i);
  if (tickMatch && tickMatch[1]) {
    return { type: 'repair', repairId: tickMatch[1], confidence: 0.9 };
  }
  return null;
}

/**
 * Extracts an explicit layaway ticket reference from a query.
 * Matches: LAY-XXXX or layaway #XXXX.
 *
 * TODO: when IntelligenceEngine is injected, resolve ticket pattern → actual Layaway.id.
 */
export function matchExplicitLayaway(
  query: string,
): (ResolvedEntity & { type: 'layaway' }) | null {
  const layMatch = query.match(/\b(lay-[a-z0-9]{4,10})\b/i);
  if (layMatch && layMatch[1]) {
    return { type: 'layaway', layawayId: layMatch[1].toUpperCase(), confidence: 0.95 };
  }
  const numMatch = query.match(/\blayaway\s+#(\d[a-z0-9]{3,9})\b/i);
  if (numMatch && numMatch[1]) {
    return { type: 'layaway', layawayId: numMatch[1], confidence: 0.9 };
  }
  return null;
}

/**
 * Extracts an explicit inventory SKU from a query.
 * Matches: "sku: XXXX" or "sku XXXX".
 *
 * TODO: when IntelligenceEngine is injected, validate SKU exists in inventory.
 */
export function matchExplicitInventory(
  query: string,
): (ResolvedEntity & { type: 'inventory' }) | null {
  const m = query.match(/\bsku:?\s*([a-z0-9_-]{3,20})\b/i);
  if (m && m[1]) {
    return { type: 'inventory', sku: m[1].toUpperCase(), confidence: 0.9 };
  }
  return null;
}

// ── Follow-up / recent context matchers ───────────────────────────────────────

/**
 * Returns the customer entity currently active in the session context.
 * Confidence 0.8 — valid only while the context is fresh (caller responsibility).
 *
 * TODO: in handlers, validate customerId still exists before executing actions.
 * TODO: add staleness check: context.timestamp vs Date.now() threshold.
 */
export function matchRecentCustomer(
  context: unknown,
): (ResolvedEntity & { type: 'customer' }) | null {
  if (isSessionCtx(context) && context.type === 'customer' && context.value) {
    return { type: 'customer', customerId: context.value, confidence: 0.8 };
  }
  return null;
}

/**
 * Returns the repair entity currently active in the session context.
 * Confidence 0.8 — valid only while the context is fresh.
 *
 * TODO: in handlers, re-read repair from store to confirm status before acting.
 */
export function matchRecentRepair(
  context: unknown,
): (ResolvedEntity & { type: 'repair' }) | null {
  if (isSessionCtx(context) && context.type === 'repair' && context.value) {
    return { type: 'repair', repairId: context.value, confidence: 0.8 };
  }
  return null;
}

/**
 * Returns the inventory product currently active in the session context.
 * Confidence 0.8 — valid only while the context is fresh.
 *
 * TODO: in handlers, validate sku still exists in inventory before acting.
 */
export function matchRecentInventory(
  context: unknown,
): (ResolvedEntity & { type: 'inventory' }) | null {
  if (isSessionCtx(context) && context.type === 'product' && context.value) {
    return { type: 'inventory', sku: context.value, confidence: 0.8 };
  }
  return null;
}

// ── Keyword helpers ───────────────────────────────────────────────────────────

/** Word-boundary-safe check for single-word keywords (avoids substring false positives). */
function hasWord(q: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(q);
}

/** Phrase inclusion check for multi-word patterns. */
function hasPhrase(q: string, phrase: string): boolean {
  return q.includes(phrase);
}

// ── Keyword-based contextual resolution ──────────────────────────────────────

/**
 * Resolves contextual and pronoun entity references via deterministic keyword matching.
 *
 * Handles:
 *   - "that customer" / "him" / "her"   → recent customer from session context
 *   - "that repair" / "that ticket"     → recent repair from session context
 *   - "that phone"                       → repair if context=repair, inventory if context=product
 *   - "open it" / "it" / "this one"     → current context entity
 *   - "the last layaway" / "that layaway" → single layaway signal from OCE snapshot
 *   - "the unpaid one"                  → single payment_due signal from OCE snapshot
 *   - "the overdue repair"              → single overdue repair signal from OCE snapshot
 *   - "the last one" / "previous one"   → most recent entity from session context
 *
 * Returns null when:
 *   - Context is absent or does not match the implied entity type
 *   - Multiple candidates exist (ambiguous)
 *
 * TODO: when IntelligenceEngine is injected, validate resolved IDs are still live
 *       before returning (stale context guard).
 */
export function matchKeywordReference(
  query: string,
  context: unknown,
): ResolvedEntity | null {
  const q = query.toLowerCase().trim();
  const words = new Set(q.split(/\s+/));

  // ── Customer pronouns ────────────────────────────────────────────────────
  const isCustomerRef =
    hasPhrase(q, 'that customer') ||
    hasPhrase(q, 'the customer') ||
    hasPhrase(q, 'this customer') ||
    hasWord(q, 'him') ||
    hasWord(q, 'her');
  if (isCustomerRef) return matchRecentCustomer(context);

  // ── Repair follow-ups ────────────────────────────────────────────────────
  const isRepairRef =
    hasPhrase(q, 'that repair') ||
    hasPhrase(q, 'the repair') ||
    hasPhrase(q, 'this repair') ||
    hasPhrase(q, 'that ticket') ||
    hasPhrase(q, 'the ticket') ||
    hasPhrase(q, 'this ticket');
  if (isRepairRef) return matchRecentRepair(context);

  // ── "that phone" / "the phone" — repair OR inventory depending on context ─
  if (hasPhrase(q, 'that phone') || hasPhrase(q, 'the phone')) {
    const fromRepair = matchRecentRepair(context);
    if (fromRepair) return fromRepair;
    const fromInventory = matchRecentInventory(context);
    if (fromInventory) return fromInventory;
    return null; // ambiguous — no context to anchor to
  }

  // ── "open it" / bare "it" / "this one" ──────────────────────────────────
  // Short-circuit with length guard to avoid matching "it" in longer questions.
  const isItRef =
    q === 'it' ||
    q === 'open it' ||
    q === 'show it' ||
    q === 'this one' ||
    q === 'the one' ||
    (words.has('it') && q.length < 20);
  if (isItRef) {
    if (!isSessionCtx(context) || !context.value) return null;
    if (context.type === 'customer') return { type: 'customer', customerId: context.value, confidence: 0.75 };
    if (context.type === 'repair')   return { type: 'repair',   repairId:   context.value, confidence: 0.75 };
    if (context.type === 'product')  return { type: 'inventory', sku:       context.value, confidence: 0.75 };
    // 'deal' and 'category' do not map to a single resolvable entity type
    return null;
  }

  // ── Layaway follow-ups ───────────────────────────────────────────────────
  const isLayawayRef =
    hasPhrase(q, 'the last layaway') ||
    hasPhrase(q, 'that layaway') ||
    hasPhrase(q, 'the layaway') ||
    hasPhrase(q, 'this layaway');
  if (isLayawayRef) {
    if (isOceSnapshot(context)) {
      const sigs = context.signals.filter(
        s => s.sourceModule === ('layaways' as OperationalModule) && s.entityId && s.actionable,
      );
      // Ambiguous if multiple — never pick arbitrarily
      if (sigs.length === 1 && sigs[0].entityId) {
        return { type: 'layaway', layawayId: sigs[0].entityId, confidence: 0.7 };
      }
    }
    return null;
  }

  // ── "the unpaid one" ─────────────────────────────────────────────────────
  const isUnpaidRef =
    hasPhrase(q, 'the unpaid one') ||
    hasPhrase(q, 'unpaid one') ||
    (words.has('unpaid') && (words.has('one') || words.has('repair') || words.has('layaway')));
  if (isUnpaidRef) {
    if (isOceSnapshot(context)) {
      const unpaidSigs = context.signals.filter(
        s => s.type === ('payment_due' as OperationalSignalType) && s.entityId && s.actionable,
      );
      if (unpaidSigs.length === 1) {
        const sig = unpaidSigs[0];
        if (sig.entityId && sig.sourceModule === ('repairs' as OperationalModule)) {
          return { type: 'repair', repairId: sig.entityId, confidence: 0.7 };
        }
        if (sig.entityId && sig.sourceModule === ('layaways' as OperationalModule)) {
          return { type: 'layaway', layawayId: sig.entityId, confidence: 0.7 };
        }
      }
      // Multiple unpaid entities → ambiguous → null
    }
    return null;
  }

  // ── "the overdue repair" ─────────────────────────────────────────────────
  const isOverdueRef =
    hasPhrase(q, 'the overdue repair') ||
    hasPhrase(q, 'overdue repair') ||
    hasPhrase(q, 'the overdue one') ||
    hasPhrase(q, 'overdue ticket');
  if (isOverdueRef) {
    if (isOceSnapshot(context)) {
      const overdueSigs = context.signals.filter(
        s =>
          s.sourceModule === ('repairs' as OperationalModule) &&
          s.type === ('operational_warning' as OperationalSignalType) &&
          s.entityId &&
          s.actionable,
      );
      if (overdueSigs.length === 1 && overdueSigs[0].entityId) {
        return { type: 'repair', repairId: overdueSigs[0].entityId, confidence: 0.7 };
      }
      // Multiple overdue repairs → ambiguous → null
    }
    return null;
  }

  // ── "the last one" / "the recent one" ───────────────────────────────────
  const isLastRef =
    hasPhrase(q, 'the last one') ||
    hasPhrase(q, 'last one') ||
    hasPhrase(q, 'the recent one') ||
    hasPhrase(q, 'the previous one');
  if (isLastRef) {
    if (!isSessionCtx(context) || !context.value) return null;
    if (context.type === 'customer') return { type: 'customer', customerId: context.value, confidence: 0.7 };
    if (context.type === 'repair')   return { type: 'repair',   repairId:   context.value, confidence: 0.7 };
    if (context.type === 'product')  return { type: 'inventory', sku:       context.value, confidence: 0.7 };
    return null;
  }

  return null;
}

// ── Operational priority entity ───────────────────────────────────────────────

/**
 * Resolves the highest-priority actionable entity from OCE signals.
 * Used as last resort (priority 4) — requires an explicit entity type word in the query
 * AND exactly one candidate of that type in the signals (to prevent ambiguous resolution).
 *
 * Returns null when:
 *   - No OCE snapshot in context
 *   - Query has no entity type hint ("repair", "customer", etc.)
 *   - Multiple actionable candidates of the same type exist (ambiguous)
 *
 * TODO: when IntelligenceEngine is injected, cross-validate entityId is still live
 *       before returning (OCE snapshot may be stale by seconds).
 */
export function matchPriorityEntity(
  query: string,
  context: unknown,
): ResolvedEntity | null {
  if (!isOceSnapshot(context)) return null;
  const q = query.toLowerCase();

  const wantsRepair    = /\brepairs?\b|\btickets?\b/.test(q);
  const wantsCustomer  = /\bcustomers?\b|\bclients?\b/.test(q);
  const wantsLayaway   = /\blayaways?\b/.test(q);
  const wantsInventory = /\binventor(y|ies)\b|\bstock\b|\bproducts?\b/.test(q);

  if (!wantsRepair && !wantsCustomer && !wantsLayaway && !wantsInventory) return null;

  // Clone + sort descending by score to get highest-priority first
  const actionable = [...context.signals]
    .filter(s => s.actionable && (s.entityId || s.customerId))
    .sort((a, b) => b.score - a.score);

  if (wantsRepair) {
    const sigs = actionable.filter(
      s => s.sourceModule === ('repairs' as OperationalModule) && s.entityId,
    );
    if (sigs.length === 1 && sigs[0].entityId) {
      return { type: 'repair', repairId: sigs[0].entityId, confidence: 0.6 };
    }
  }
  if (wantsCustomer) {
    const sigs = actionable.filter(s => s.customerId);
    if (sigs.length === 1 && sigs[0].customerId) {
      return { type: 'customer', customerId: sigs[0].customerId, confidence: 0.6 };
    }
  }
  if (wantsLayaway) {
    const sigs = actionable.filter(
      s => s.sourceModule === ('layaways' as OperationalModule) && s.entityId,
    );
    if (sigs.length === 1 && sigs[0].entityId) {
      return { type: 'layaway', layawayId: sigs[0].entityId, confidence: 0.6 };
    }
  }
  if (wantsInventory) {
    const sigs = actionable.filter(
      s => s.sourceModule === ('inventory' as OperationalModule) && s.entityId,
    );
    if (sigs.length === 1 && sigs[0].entityId) {
      return { type: 'inventory', sku: sigs[0].entityId, confidence: 0.6 };
    }
  }

  return null; // multiple candidates → ambiguous
}
