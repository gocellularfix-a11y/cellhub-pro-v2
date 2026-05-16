// R-INTELLIGENCE-ATTENTION-MODEL-V1
// Deterministic attention model — no ML, no AI APIs, no external analytics.
// Derives operator state from local behavioral signals and queue depth.

import type { AttentionState, AttentionSnapshot, AttentionDecision } from './types';
import { countSignals } from './store';
import { getQueue } from '../managerQueue/actions';

type Priority = 'critical' | 'high' | 'medium' | 'low';

// ── State computation ─────────────────────────────────────────────────────────

export function computeAttentionSnapshot(): AttentionSnapshot {
  const WIN_30 = 30 * 60 * 1000;
  const WIN_15 = 15 * 60 * 1000;
  const WIN_60 = 60 * 60 * 1000;

  const recentDismissals     = countSignals('bubble_dismissed',    WIN_30);
  const recentActions        = countSignals('suggestion_accepted', WIN_30);
  const recentCheckouts      = countSignals('checkout_burst',      WIN_15);
  const dismissals_60min     = countSignals('bubble_dismissed',    WIN_60);
  const dismissals_15min     = countSignals('bubble_dismissed',    WIN_15);

  const unresolvedCritical = getQueue().filter(
    i => i.status === 'pending' && i.severity === 'critical',
  ).length;

  // interruptionScore: 0 = fully interruptible, 1 = do not interrupt.
  const rawScore =
    recentDismissals   * 0.25 +
    recentCheckouts    * 0.15 +
    unresolvedCritical * 0.10 -
    recentActions      * 0.10;
  const interruptionScore = Math.max(0, Math.min(1, rawScore));

  let state: AttentionState;

  if (interruptionScore >= 0.7 || recentDismissals >= 3) {
    state = 'overloaded';
  } else if (recentCheckouts >= 2 || (recentDismissals >= 1 && interruptionScore >= 0.4)) {
    state = 'busy';
  } else if (dismissals_60min > 0 && dismissals_15min === 0 && recentDismissals === 0) {
    // Had dismissals in the past hour but none recently → cooling down
    state = 'recovering';
  } else if (interruptionScore < 0.15 && recentCheckouts === 0 && recentDismissals === 0) {
    state = 'idle';
  } else {
    state = 'focused';
  }

  return {
    state,
    calculatedAt:           Date.now(),
    recentDismissals,
    recentActions,
    recentCheckouts,
    unresolvedCriticalCount: unresolvedCritical,
    interruptionScore,
  };
}

// ── Interrupt gate ────────────────────────────────────────────────────────────

export function shouldInterruptOperator(
  snapshot: AttentionSnapshot,
  priority: Priority,
): AttentionDecision {
  switch (snapshot.state) {
    case 'overloaded':
      return {
        allowSuggestion:    priority === 'critical',
        reason:             'Operator overloaded — only critical alerts allowed',
        cooldownMultiplier: 2.5,
        maxPriorityAllowed: 'critical',
      };
    case 'busy':
      return {
        allowSuggestion:    priority === 'critical' || priority === 'high',
        reason:             'Operator busy — suppressing low-priority suggestions',
        cooldownMultiplier: 1.5,
        maxPriorityAllowed: 'high',
      };
    case 'recovering':
      return {
        allowSuggestion:    priority === 'critical' || priority === 'high',
        reason:             'Operator recovering — gradually restoring suggestions',
        cooldownMultiplier: 1.8,
        maxPriorityAllowed: 'high',
      };
    case 'focused':
      return {
        allowSuggestion:    priority !== 'low',
        reason:             'Operator focused — medium+ suggestions allowed',
        cooldownMultiplier: 1.2,
        maxPriorityAllowed: 'high',
      };
    case 'idle':
    default:
      return {
        allowSuggestion:    true,
        reason:             'Operator idle — all suggestions allowed',
        cooldownMultiplier: 0.8,
        maxPriorityAllowed: 'medium',
      };
  }
}

// ── Cooldown multiplier ───────────────────────────────────────────────────────

export function getCooldownMultiplier(state: AttentionState): number {
  const map: Record<AttentionState, number> = {
    busy:       1.5,
    overloaded: 2.5,
    focused:    1.2,
    recovering: 1.8,
    idle:       0.8,
  };
  return map[state] ?? 1.0;
}
