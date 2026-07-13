// ============================================================
// R-INTEL-V2-PHASE15-OUTCOME-LEARNING
// Bounded, deterministic learning influence for customer-outreach
// prioritization. Activates the dormant loop between the outcomes the
// owner already records (outreachOutcomeStore, via the existing
// record_outreach_outcome action) and the existing contact-today ranking:
// customers who historically CONVERT after outreach get a small bounded
// boost; customers who consistently IGNORE it get a small bounded penalty.
//
// SAFETY CONTRACT:
//   - Deterministic: same (events, now) → same modifiers. No randomness,
//     no model, no network, no new dependency.
//   - Bounded: the multiplier is hard-clamped to
//     [OUTREACH_LEARNING_MIN_MULTIPLIER, OUTREACH_LEARNING_MAX_MULTIPLIER]
//     — learning can gently reorder, never dominate the base score.
//   - Neutral without evidence: fewer than
//     OUTREACH_LEARNING_MIN_OBSERVATIONS signal events (or a net-zero
//     signal) yields NO modifier — the ranking falls back to today's
//     behavior exactly.
//   - Explainable: every modifier carries counts + a reason code the UI
//     can surface ("responds to outreach" / "ignores outreach").
//   - Reversible: influence is applied as a multiplier on top of the
//     preserved base score; removing the modifier restores base ranking.
//   - Read-only: no accounting writes, no customer contact, no mutation
//     of the outcome store. Stale events (outside the lookback) and
//     duplicate event ids are excluded.
// ============================================================

import type { OutreachOutcomeEvent, OutreachOutcomeType } from './outreachOutcomeTypes';
import { getRecentOutreachOutcomes } from './outreachOutcomeStore';

/** Signal events required before learning may influence a customer. */
export const OUTREACH_LEARNING_MIN_OBSERVATIONS = 2;
/** Hard cap: at most +15% over the base score. */
export const OUTREACH_LEARNING_MAX_MULTIPLIER = 1.15;
/** Hard floor: at most −15% under the base score. */
export const OUTREACH_LEARNING_MIN_MULTIPLIER = 0.85;
/** Per-net-signal step (one net conversion = +5%, one net ignore = −5%). */
export const OUTREACH_LEARNING_STEP = 0.05;
/** Mirrors the outcome store's retention window. */
export const OUTREACH_LEARNING_LOOKBACK_DAYS = 90;

const DAY_MS = 86_400_000;

/** Outcomes that count as a positive conversion signal. */
const CONVERTED_OUTCOMES: ReadonlySet<OutreachOutcomeType> = new Set([
  'payment_collected', 'repair_picked_up', 'sale_completed', 'visited_store',
]);

export interface OutreachLearningModifier {
  customerId: string;
  /** Bounded multiplier applied to the base rank score. */
  multiplier: number;
  /** Signal events considered (converted + ignored, within lookback). */
  observationCount: number;
  convertedCount: number;
  ignoredCount: number;
  /** Explanation code for UI/diagnostics. */
  reason: 'responds_to_outreach' | 'ignores_outreach';
}

/**
 * Pure builder: aggregate recorded outreach outcomes into bounded
 * per-customer modifiers. 'sent'/'replied' events are neutral — only a
 * completed conversion or an explicit ignore moves the needle. Customers
 * below the observation minimum, or with a net-zero signal, get NO entry
 * (neutral fallback — ranking unchanged).
 */
export function buildOutreachLearningModifiers(
  events: readonly OutreachOutcomeEvent[],
  now: number,
): Map<string, OutreachLearningModifier> {
  const out = new Map<string, OutreachLearningModifier>();
  if (events.length === 0) return out;

  const cutoff = now - OUTREACH_LEARNING_LOOKBACK_DAYS * DAY_MS;
  const seenIds = new Set<string>();
  const byCustomer = new Map<string, { converted: number; ignored: number }>();

  for (const e of events) {
    if (!e || typeof e.timestamp !== 'number') continue;
    if (e.timestamp < cutoff || e.timestamp > now) continue; // stale/future excluded
    if (seenIds.has(e.id)) continue;                          // duplicates counted once
    seenIds.add(e.id);

    const isConverted = CONVERTED_OUTCOMES.has(e.outcome);
    const isIgnored = e.outcome === 'ignored';
    if (!isConverted && !isIgnored) continue; // 'sent'/'replied' are neutral

    const agg = byCustomer.get(e.customerId) ?? { converted: 0, ignored: 0 };
    if (isConverted) agg.converted += 1; else agg.ignored += 1;
    byCustomer.set(e.customerId, agg);
  }

  for (const [customerId, agg] of byCustomer) {
    const observationCount = agg.converted + agg.ignored;
    if (observationCount < OUTREACH_LEARNING_MIN_OBSERVATIONS) continue; // insufficient evidence
    const net = agg.converted - agg.ignored;
    if (net === 0) continue; // conflicting evidence → neutral

    const raw = 1 + net * OUTREACH_LEARNING_STEP;
    const multiplier = Math.min(
      OUTREACH_LEARNING_MAX_MULTIPLIER,
      Math.max(OUTREACH_LEARNING_MIN_MULTIPLIER, raw),
    );

    out.set(customerId, {
      customerId,
      multiplier,
      observationCount,
      convertedCount: agg.converted,
      ignoredCount: agg.ignored,
      reason: net > 0 ? 'responds_to_outreach' : 'ignores_outreach',
    });
  }

  return out;
}

/**
 * Store-backed convenience wrapper for production callers (mirrors the
 * getTopActionsToday learning-wire pattern: default built from the store,
 * injectable in tests). Never throws — an unavailable store yields an
 * empty map (neutral).
 */
export function getOutreachLearningModifiers(
  now: number = Date.now(),
): Map<string, OutreachLearningModifier> {
  try {
    return buildOutreachLearningModifiers(
      getRecentOutreachOutcomes(OUTREACH_LEARNING_LOOKBACK_DAYS),
      now,
    );
  } catch {
    return new Map();
  }
}
