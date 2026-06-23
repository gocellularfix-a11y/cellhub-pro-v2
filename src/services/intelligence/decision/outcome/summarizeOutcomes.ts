// ============================================================
// R-INTELLIGENCE-F6A: Outcome Summary — pure read-only projection.
//
// Aggregates OutcomeRecord[] into deterministic counts + a completion rate +
// health band. It RECORDS performance, it does not LEARN from it: NO scoring
// feedback, NO ranking changes, NO adaptive behavior, NO Date.now(), NO
// randomness, NO mutation. Single fused pass over the records.
// ============================================================

import type { OutcomeRecord } from './OutcomeRecord';

/** Deterministic outcome health band derived purely from completion rate. */
export type OutcomeHealth = 'GOOD' | 'MIXED' | 'POOR';

export interface OutcomeSummary {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  ignored: number;
  /** completed / total, or 0 when total is 0 (divide-by-zero guard). */
  completionRate: number;
  health: OutcomeHealth;
}

/**
 * Health bands (pure):
 *   GOOD  → completionRate >= 0.80
 *   MIXED → completionRate >= 0.50
 *   POOR  → otherwise (includes an empty set, where rate is 0)
 */
export function deriveOutcomeHealth(completionRate: number): OutcomeHealth {
  if (completionRate >= 0.8) return 'GOOD';
  if (completionRate >= 0.5) return 'MIXED';
  return 'POOR';
}

/** Pure: summarize outcomes. Same input → same output. Never mutates `records`. */
export function summarizeOutcomes(records: OutcomeRecord[]): OutcomeSummary {
  let completed = 0, failed = 0, cancelled = 0, ignored = 0;

  for (const r of records) {
    switch (r.outcomeStatus) {
      case 'COMPLETED': completed += 1; break;
      case 'FAILED': failed += 1; break;
      case 'CANCELLED': cancelled += 1; break;
      case 'IGNORED': ignored += 1; break;
    }
  }

  const total = records.length;
  const completionRate = total === 0 ? 0 : completed / total;

  return {
    total,
    completed,
    failed,
    cancelled,
    ignored,
    completionRate,
    health: deriveOutcomeHealth(completionRate),
  };
}
