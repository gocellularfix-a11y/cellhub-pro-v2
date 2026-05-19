// R-GPO-V1 — Global Priority Orchestrator aggregator.
// Input:  OperationalContextSnapshot (from OCE)
// Output: AggregatedPriority[] sorted by score descending
// Pure function — no I/O, no side effects, no randomness.

import type { OperationalContextSnapshot, OperationalSignal, OperationalSeverity } from '../oce/operationalContextTypes';
import type { ActionPayload } from '../actions/actionEngine';
import type { AggregatedPriority, OperationalPriorityCategory } from './types';
import { groupSignalsByCategory } from './groupSignals';
import { scorePriority, sortPriorities } from './scorePriorities';

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEV_ORDER: Record<OperationalSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

function highestSeverity(signals: OperationalSignal[]): 'critical' | 'high' | 'medium' {
  let best: OperationalSeverity = 'medium';
  for (const s of signals) {
    if ((SEV_ORDER[s.severity] ?? 99) < (SEV_ORDER[best] ?? 99)) best = s.severity;
  }
  if (best === 'critical') return 'critical';
  if (best === 'high') return 'high';
  return 'medium';
}

// ── Title builders (English — callers format with their own i18n if needed) ──

// Per-category signal caps applied before priority assembly.
// Signals are pre-sorted by severity→score, so slicing keeps the most critical.
// business_risk has no natural aggregate — without a cap "43 risks" renders as noise.
const CATEGORY_SIGNAL_CAP: Partial<Record<OperationalPriorityCategory, number>> = {
  business_risk: 10,
};

function buildTitle(category: OperationalPriorityCategory, signals: OperationalSignal[]): string {
  const n = signals.length;
  switch (category) {
    case 'pickup_opportunity': {
      const total = signals.reduce(
        (s, sig) => s + ((sig.metadata?.count as number | undefined) ?? 1), 0,
      );
      return `${total} item${total !== 1 ? 's' : ''} ready for pickup`;
    }
    case 'payment_collection': {
      const totalCents = signals.reduce(
        (s, sig) => s + ((sig.metadata?.totalCents as number | undefined) ?? 0), 0,
      );
      const amt = totalCents > 0 ? ` ($${(totalCents / 100).toFixed(0)})` : '';
      return `${n} balance${n !== 1 ? 's' : ''} due${amt}`;
    }
    case 'customer_outreach':
      return `${n} outreach opportunit${n === 1 ? 'y' : 'ies'}`;
    case 'inventory_attention': {
      const total = signals.reduce(
        (s, sig) => s + ((sig.metadata?.count as number | undefined) ?? 1), 0,
      );
      return `${total} inventory item${total !== 1 ? 's' : ''} need attention`;
    }
    case 'business_risk':
      if (n === 1) return signals[0].title;
      return `${signals[0].title} (+${n - 1} more)`;
    case 'system_attention':
      return `${n} item${n !== 1 ? 's' : ''} need attention`;
  }
}

function buildSummary(signals: OperationalSignal[]): string {
  return signals.slice(0, 2).map((s) => s.title).join(' · ');
}

// ── Action builder ────────────────────────────────────────────────────────────

function signalToAction(signal: OperationalSignal): ActionPayload | null {
  if (!signal.actionable || !signal.actionTarget) return null;
  const target = signal.actionTarget as ActionPayload['executionTarget'];
  return {
    type: 'review',
    executable: true,
    executionTarget: target,
    entityId: signal.entityId,
    customerId: signal.customerId,
  } as ActionPayload;
}

function buildGroupActions(signals: OperationalSignal[]): ActionPayload[] {
  const seen = new Set<string>();
  const result: ActionPayload[] = [];
  for (const sig of signals) {
    if (result.length >= 2) break;
    const action = signalToAction(sig);
    if (!action) continue;
    const key = `${action.executionTarget}:${action.entityId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result;
}

// ── Main aggregator ───────────────────────────────────────────────────────────

export function buildGlobalPriorities(
  snapshot: OperationalContextSnapshot,
): AggregatedPriority[] {
  const groups = groupSignalsByCategory(snapshot.signals);
  const priorities: AggregatedPriority[] = [];

  for (const [category, rawSignals] of groups) {
    if (rawSignals.length === 0) continue;

    const cap = CATEGORY_SIGNAL_CAP[category];
    const signals = cap && rawSignals.length > cap ? rawSignals.slice(0, cap) : rawSignals;

    const severity  = highestSeverity(signals);
    const title     = buildTitle(category, signals);
    const summary   = buildSummary(signals);
    const actionable = signals.some((s) => s.actionable);
    const topActions = buildGroupActions(signals);

    const priority: AggregatedPriority = {
      id: `gpo:${category}`,
      category,
      severity,
      title,
      summary,
      signalCount: signals.length,
      sourceSignals: signals,
      actionable,
      topActions,
      score: 0,
    };
    priority.score = scorePriority(priority);
    priorities.push(priority);
  }

  return sortPriorities(priorities);
}
