import type { ActionChain, ActionChainStep, ActionChainType, ActiveChainState } from './actionChainTypes';

const CHAIN_STATE_KEY = 'cellhub:activeChain:v1';
const CHAIN_TTL_MS = 4 * 60 * 60 * 1000; // 4h

// ── localStorage helpers ──────────────────────────────────────────────────────

export function loadActiveChainState(): ActiveChainState | null {
  try {
    const raw = localStorage.getItem(CHAIN_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveChainState;
    if (!parsed.chainType || !parsed.expiresAt) return null;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(CHAIN_STATE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveChainState(state: ActiveChainState): void {
  try {
    localStorage.setItem(CHAIN_STATE_KEY, JSON.stringify(state));
  } catch { /* storage unavailable — silent */ }
}

export function clearActiveChainState(): void {
  try { localStorage.removeItem(CHAIN_STATE_KEY); } catch { /* silent */ }
}

/**
 * Mark a chain step as completed or skipped and persist the updated state.
 * Called by bubble action button and skip button handlers.
 */
export function advanceChainStep(
  chainType: ActionChainType,
  stepId: string,
  action: 'complete' | 'skip',
): void {
  const now = Date.now();
  const existing = loadActiveChainState();
  const base: ActiveChainState = (existing?.chainType === chainType && existing.expiresAt > now)
    ? existing
    : { chainType, completedStepIds: [], skippedStepIds: [], startedAt: now, expiresAt: now + CHAIN_TTL_MS };

  const updated: ActiveChainState = {
    ...base,
    completedStepIds: action === 'complete'
      ? [...base.completedStepIds.filter((id) => id !== stepId), stepId]
      : base.completedStepIds,
    skippedStepIds: action === 'skip'
      ? [...base.skippedStepIds.filter((id) => id !== stepId), stepId]
      : base.skippedStepIds,
  };
  saveActiveChainState(updated);
}

// ── Chain state application ───────────────────────────────────────────────────

/**
 * Apply persisted step state to a freshly computed chain.
 * Returns the chain with statuses applied and currentStepIndex advanced to the first pending step.
 */
export function applyChainState(chain: ActionChain, state: ActiveChainState | null): ActionChain {
  if (!state || state.chainType !== chain.type || state.expiresAt < Date.now()) {
    return chain;
  }
  const steps: ActionChainStep[] = chain.steps.map((step) => ({
    ...step,
    status: state.completedStepIds.includes(step.id) ? 'completed' as const
          : state.skippedStepIds.includes(step.id)   ? 'skipped'   as const
          : step.status,
  }));
  const firstPending = steps.findIndex((s) => s.status === 'pending');
  return { ...chain, steps, currentStepIndex: firstPending === -1 ? steps.length : firstPending };
}

// ── Step selectors ────────────────────────────────────────────────────────────

export function getCurrentStep(chain: ActionChain): ActionChainStep | null {
  return chain.steps[chain.currentStepIndex] ?? null;
}

export function getChainProgress(chain: ActionChain): { completed: number; total: number } {
  const completed = chain.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  return { completed, total: chain.steps.length };
}

export function isChainComplete(chain: ActionChain): boolean {
  return chain.currentStepIndex >= chain.steps.length;
}

// ── Suppression map ───────────────────────────────────────────────────────────
// Suggestion IDs suppressed in contextSuggestions when a given chain is active.
// Chains subsume the lower-level signals that triggered them.

export const CHAIN_SUPPRESSIONS: Record<ActionChainType, string[]> = {
  workflow_stabilization:  ['op_unfinished_workflows', 'reasoning_workflow_stability_risk', 'strategy_workflow_stabilization_focus'],
  collection_recovery:     ['scoring_collection_high', 'scoring_collection_medium', 'op_overdue_layaways', 'rhythm_collection_mode', 'strategy_collection_focus', 'reasoning_collection_escalation'],
  repair_cleanup:          ['op_repair_delays', 'op_repairs_ready', 'rhythm_repair_overload', 'trend_risk_increasing', 'strategy_repair_cleanup_focus', 'reasoning_operational_overload'],
  vip_customer_recovery:   ['scoring_vip_retention', 'scoring_churn_high', 'scoring_churn_medium', 'retention_inactive', 'strategy_customer_retention_focus', 'strategy_recovery_focus', 'reasoning_critical_customer_recovery'],
  upsell_momentum:         ['upsell_opportunity', 'upsell_accessories_phonepay', 'op_accessory_attach_opportunity', 'strategy_upsell_focus', 'reasoning_upsell_momentum'],
};
