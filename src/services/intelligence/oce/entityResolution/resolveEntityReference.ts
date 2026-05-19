// R-GOER-V1 — Global Operational Entity Resolution: main resolver
// Single deterministic entry point for resolving entity references.
// Returns null when ambiguous. Never guesses.

import type { ResolvedEntity, ResolveEntityInput } from './types';
import {
  matchExplicitCustomer,
  matchExplicitRepair,
  matchExplicitLayaway,
  matchExplicitInventory,
  matchKeywordReference,
  matchPriorityEntity,
} from './entityMatchers';

/**
 * Returns true if the query contains a word that signals a contextual entity reference
 * (pronoun, article, recency marker). Used to gate follow-up resolution and avoid
 * running keyword matching for clearly non-contextual general questions.
 */
function hasFollowUpSignal(q: string): boolean {
  // Multi-word phrases are checked with includes; single words with set lookup
  // to avoid matching substrings (e.g. "it" inside "invite").
  const words = new Set(q.split(/\s+/));
  const singleWords = ['that', 'the', 'it', 'him', 'her', 'this', 'they', 'them'];
  const phraseWords = ['last', 'recent', 'previous', 'same', 'overdue', 'unpaid'];
  return (
    singleWords.some(w => words.has(w)) ||
    phraseWords.some(w => q.includes(w))
  );
}

/**
 * Deterministically resolves an entity reference from a query + operational context.
 *
 * Priority order:
 *
 *   1. EXPLICIT ENTITY MENTION
 *      Pattern-extracted phone number, ticket number (R-XXXX, LAY-XXXX), or SKU.
 *      Highest confidence (0.9–0.95). Caller must look up extracted identifier in store.
 *
 *   2+3. RECENT CONTEXT + ACTIVE FOLLOW-UP ENTITY
 *      Keyword-driven pronoun/phrase resolution against session context or OCE signals.
 *      Handles: "that customer", "him", "her", "that repair", "that phone",
 *               "the unpaid one", "the overdue repair", "the last one",
 *               "open it", "this one", layaway/repair follow-ups.
 *      Only attempted when hasFollowUpSignal() is true (guards against false triggers).
 *      Confidence 0.7–0.8.
 *
 *   4. OPERATIONAL PRIORITY ENTITY
 *      Highest-score actionable OCE signal matching an entity type word in the query.
 *      Only fires when query contains an explicit entity type hint ("repair", "customer", etc.)
 *      AND exactly one candidate of that type exists (avoids ambiguous selection).
 *      Confidence 0.6.
 *
 *   5. NULL — ambiguous, no context, or no match. NEVER guesses.
 *
 * ── Safety contract ──────────────────────────────────────────────────────────
 * This resolver is safe for executable actions because:
 *   - It never auto-resolves when multiple candidates exist.
 *   - It never infers entity type from AI/embeddings.
 *   - Callers must validate returned IDs against live store before acting.
 *
 * ── Integration TODOs ─────────────────────────────────────────────────────────
 * TODO: plumb into handlers.ts — 'entity_operational_command' intent should call
 *       resolveEntityReference({query, operationalContext}) before dispatching action.
 *
 * TODO: plumb into intentRouter.ts — enrichFollowUpQuery() currently rewrites query
 *       strings; replace with typed entity resolution via this function so handlers
 *       receive a ResolvedEntity instead of a rewritten string.
 *
 * TODO: when IntelligenceEngine access is ready, pass engine.getRepairs() /
 *       getCustomers() etc. to explicit matchers for live ID validation (confirm
 *       phone number maps to a real customer, ticket number maps to a real repair).
 *
 * TODO: extend explicit matchers with invoice number patterns (INV-XXXX) for sales
 *       once 'sale' type is needed in downstream handlers.
 */
export function resolveEntityReference(
  input: ResolveEntityInput,
): ResolvedEntity | null {
  const { query, operationalContext } = input;
  const q = query.toLowerCase().trim();
  if (!q) return null;

  // ── 1. Explicit entity mention ────────────────────────────────────────────
  const customer = matchExplicitCustomer(q);
  if (customer) return customer;

  const repair = matchExplicitRepair(q);
  if (repair) return repair;

  const layaway = matchExplicitLayaway(q);
  if (layaway) return layaway;

  const inventory = matchExplicitInventory(q);
  if (inventory) return inventory;

  // ── 2+3. Recent context + active follow-up entity ─────────────────────────
  if (hasFollowUpSignal(q)) {
    const keyword = matchKeywordReference(q, operationalContext);
    if (keyword) return keyword;
  }

  // ── 4. Operational priority entity ───────────────────────────────────────
  const priority = matchPriorityEntity(q, operationalContext);
  if (priority) return priority;

  // ── 5. Ambiguous or no match ─────────────────────────────────────────────
  return null;
}
