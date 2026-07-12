// ============================================================
// CellHub Intelligence — Vocabulary Matcher (shadow engine)
// R-INTEL-V2-PHASE3-INTENT-VOCABULARY-FOUNDATION
//
// Deterministic matcher over the intent vocabulary registry. Pure
// function: same query → same result, no clock, no randomness, no
// I/O, no LLM, no store access, no persistence, no business math.
//
// STATUS: DIAGNOSTICS ONLY — not wired into production routing.
// classifyIntent() in intentRouter.ts remains the only production
// path. This engine exists so routing quality can be measured
// side-by-side (see intentVocabularyShadow.ts) before any migration.
//
// Matching rules (deliberate improvements over raw substring scoring,
// each documented so a future migration round can reason about them):
//   1. Normalization mirrors the router: lowercase, strip ¿?¡!.,;:,
//     collapse spaces — then the router's own exported
//     correctOperatorTypos() runs so both engines see the same query.
//   2. Multi-word phrases match as substrings (anchored phrases are
//     safe); SINGLE-word phrases/tokens match whole tokens only —
//     this removes the router's bare-substring false-positive class
//     (e.g. 'hoy' inside another word).
//   3. strong hit = +2, weak hit = +1. A candidate only becomes
//     bestMatch with at least one strong hit or score >= 2 — a lone
//     weak token NEVER routes (the router routes on any score >= 1).
//   4. An exclusion hit disqualifies the entry from bestMatch but the
//     candidate stays in the diagnostics with excludedBy populated.
//   5. Ties break by registry order (earlier = more specific), the
//     same philosophy as the router's scores-array ordering.
//   6. No match → bestMatch null ("unknown"): the caller decides the
//     fallback, mirroring the router's fallback_question downgrade.
// ============================================================

import type { IntentId } from './intentRouter';
import { correctOperatorTypos } from './intentRouter';
import { INTENT_VOCABULARY } from './intentVocabulary';
import type { IntentVocabularyEntry } from './intentVocabulary';

export interface VocabularyCandidate {
  intent: IntentId;
  score: number;
  matchedStrongPhrases: string[];
  matchedTokens: string[];
  excludedBy: string[];
}

export interface VocabularyMatchResult {
  normalizedQuery: string;
  /** Every entry that matched or was excluded — sorted best-first. */
  candidates: VocabularyCandidate[];
  /** Highest-scoring non-excluded candidate meeting the routing bar, or null (= unknown). */
  bestMatch: VocabularyCandidate | null;
}

// Mirrors the router's private normalize() exactly (documented copy —
// the router file is intentionally not modified to export it in this
// diagnostics-only round). Parity is locked by test.
function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Single word → whole-token match; multi-word → substring match.
function phraseMatches(normalized: string, tokens: readonly string[], phrase: string): boolean {
  return phrase.includes(' ') ? normalized.includes(phrase) : tokens.includes(phrase);
}

function evaluateEntry(
  entry: IntentVocabularyEntry,
  normalized: string,
  tokens: readonly string[],
): VocabularyCandidate {
  const matchedStrongPhrases: string[] = [];
  const matchedTokens: string[] = [];
  const excludedBy: string[] = [];

  for (const signal of entry.exclusions ?? []) {
    if (phraseMatches(normalized, tokens, signal)) excludedBy.push(signal);
  }

  const langs = ['en', 'es', 'pt'] as const;
  for (const lang of langs) {
    for (const phrase of entry.strong[lang]) {
      if (phraseMatches(normalized, tokens, phrase)) matchedStrongPhrases.push(phrase);
    }
    if (entry.weak) {
      for (const token of entry.weak[lang]) {
        if (phraseMatches(normalized, tokens, token)) matchedTokens.push(token);
      }
    }
  }

  return {
    intent: entry.intent,
    score: matchedStrongPhrases.length * 2 + matchedTokens.length,
    matchedStrongPhrases,
    matchedTokens,
    excludedBy,
  };
}

/**
 * Deterministic vocabulary match. Diagnostics-first: returns every
 * scored/excluded candidate, not just a winner. bestMatch is null when
 * nothing meets the routing bar — the vocabulary engine prefers
 * abstaining over guessing (the safe failure changes nothing).
 */
export function matchVocabulary(rawQuery: string): VocabularyMatchResult {
  const normalized = correctOperatorTypos(normalizeQuery(rawQuery));
  const tokens = normalized.length > 0 ? normalized.split(' ') : [];

  const candidates: VocabularyCandidate[] = [];
  for (const entry of INTENT_VOCABULARY) {
    const c = evaluateEntry(entry, normalized, tokens);
    if (c.score > 0 || c.excludedBy.length > 0) candidates.push(c);
  }

  // Stable sort: score desc; registry order (insertion order) breaks ties.
  candidates.sort((a, b) => b.score - a.score);

  const bestMatch =
    candidates.find(
      (c) => c.excludedBy.length === 0 && (c.matchedStrongPhrases.length > 0 || c.score >= 2),
    ) ?? null;

  return { normalizedQuery: normalized, candidates, bestMatch };
}
