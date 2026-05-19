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

// ── INTELLIGENCE-OPERATOR-ATTENTION-SYSTEM-V1 ─────────────────────────────────
// Mission + workflow attention feed — surfaces unresolved, stale, escalating items.
// Read-only: never mutates missions, workflows, or any external state.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { OperatorAttentionItem, AttentionType } from './types';
import {
  scoreAttentionAge,
  scoreAttentionSeverity,
  scoreAttentionEscalation,
  combineAttentionScore,
  escalationFromAge,
} from './attentionScoring';
import { getActiveWorkflowSessions } from '../workflows/workflowSession';
import { getWorkflowDefinition } from '../workflows/workflowRegistry';
import { getOperatorMissions } from '../missions/missionEngine';
import type { ExecutionPayload } from '../execution/types';

const MAX_FEED_ITEMS = 8;

// ── Shared timestamp parser ───────────────────────────────────────────────────

function toMs(val: unknown): number {
  if (!val) return 0;
  try {
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().getTime();
    }
    const t = new Date(val as string | Date).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

// ── Builder: unfinished workflow sessions ─────────────────────────────────────

export function buildWorkflowAttention(): OperatorAttentionItem[] {
  const now = Date.now();
  return getActiveWorkflowSessions().map(s => {
    const def = getWorkflowDefinition(s.type);
    const ageMs = now - s.createdAt;
    const staleMinutes = Math.floor(ageMs / 60_000);
    const escalationLevel = escalationFromAge(ageMs);

    const age = scoreAttentionAge(ageMs);
    const severity = combineAttentionScore(age, 50, scoreAttentionEscalation(escalationLevel));

    const ep: ExecutionPayload | undefined = s.entityId
      ? { action: 'open_repair', entityId: s.entityId, customerName: s.entityName }
      : undefined;

    return {
      id: `attn:wf:${s.id}`,
      type: 'unfinished_workflow' as AttentionType,
      title: def.labelEn + (s.entityName ? ` — ${s.entityName}` : ''),
      reason: `Workflow session active for ${staleMinutes}m without completion.`,
      severity,
      createdAt: s.createdAt,
      staleMinutes,
      entityKind: s.entityKind,
      entityId: s.entityId,
      workflowId: s.id,
      escalationLevel,
      executionPayload: ep,
    } satisfies OperatorAttentionItem;
  });
}

// ── Builder: stale high-priority missions ─────────────────────────────────────

export function buildMissionAttention(engine: IntelligenceEngine): OperatorAttentionItem[] {
  const now = Date.now();
  const missions = getOperatorMissions(engine, 10);

  return missions
    .filter(m => m.priority >= 55)
    .map(m => {
      // Missions are freshly computed — treat as "just detected"
      const escalationLevel: 0 | 1 | 2 | 3 = 0;
      const age = scoreAttentionAge(0);
      const severity = combineAttentionScore(
        age,
        scoreAttentionSeverity(m.priority),
        scoreAttentionEscalation(escalationLevel),
      );

      const typeMap: Record<string, AttentionType> = {
        collect_payment:   'missed_collection',
        repair_followup:   'overdue_followup',
        approval_needed:   'approval_waiting',
        slow_day_recovery: 'slow_day_alert',
      };
      const attentionType: AttentionType = typeMap[m.type] ?? 'stale_mission';

      return {
        id: `attn:mission:${m.id}`,
        type: attentionType,
        title: m.title,
        reason: m.reason,
        severity,
        createdAt: now,
        staleMinutes: 0,
        entityKind: m.entityKind,
        entityId: m.entityId,
        missionId: m.id,
        escalationLevel,
        executionPayload: m.executionPayload,
      } satisfies OperatorAttentionItem;
    });
}

// ── Builder: overdue collections (balance > 0, repair/layaway) ────────────────

const TERMINAL_REPAIR   = new Set(['picked_up', 'cancelled', 'closed', 'refunded']);
const TERMINAL_LAYAWAY  = new Set(['completed', 'cancelled', 'forfeited']);
const COLLECTION_AGE_MS = 3 * 24 * 3_600_000; // surface after 3 days unpaid

export function buildCollectionAttention(engine: IntelligenceEngine): OperatorAttentionItem[] {
  const now = Date.now();
  const items: OperatorAttentionItem[] = [];
  const customerMap = new Map(engine.getCustomers().map(c => [c.id, c]));

  for (const repair of engine.getRepairs()) {
    const status = String((repair as any).status || '').toLowerCase();
    if (TERMINAL_REPAIR.has(status)) continue;
    const balance = repair.balance ?? 0;
    if (balance <= 0) continue;
    const ageMs = now - (toMs(repair.createdAt) || now);
    if (ageMs < COLLECTION_AGE_MS) continue;

    const staleMinutes = Math.floor(ageMs / 60_000);
    const escalationLevel = escalationFromAge(ageMs);
    const age = scoreAttentionAge(ageMs);
    const baseSeverity = Math.min(40 + Math.floor(balance / 1000) * 5, 85);
    const severity = combineAttentionScore(age, scoreAttentionSeverity(baseSeverity), scoreAttentionEscalation(escalationLevel));

    const ep: ExecutionPayload = { action: 'open_repair', entityId: repair.id, customerName: repair.customerName, customerPhone: repair.customerPhone };
    items.push({
      id: `attn:col:repair:${repair.id}`,
      type: 'missed_collection',
      title: `${repair.customerName} — $${(balance / 100).toFixed(2)} outstanding`,
      reason: 'Repair balance has not been collected.',
      severity,
      createdAt: toMs(repair.createdAt) || now,
      staleMinutes,
      entityKind: 'repair',
      entityId: repair.id,
      escalationLevel,
      executionPayload: ep,
    });
  }

  for (const layaway of engine.getLayaways()) {
    const status = String((layaway as any).status || '').toLowerCase();
    if (TERMINAL_LAYAWAY.has(status)) continue;
    const balance = layaway.balance ?? 0;
    if (balance <= 0) continue;
    const ageMs = now - (toMs(layaway.createdAt) || now);
    if (ageMs < COLLECTION_AGE_MS) continue;

    const customer = layaway.customerId ? customerMap.get(layaway.customerId) : undefined;
    const phone = layaway.customerPhone || customer?.phone;
    const staleMinutes = Math.floor(ageMs / 60_000);
    const escalationLevel = escalationFromAge(ageMs);
    const age = scoreAttentionAge(ageMs);
    const baseSeverity = Math.min(35 + Math.floor(balance / 1000) * 5, 80);
    const severity = combineAttentionScore(age, scoreAttentionSeverity(baseSeverity), scoreAttentionEscalation(escalationLevel));

    const ep: ExecutionPayload = { action: 'open_layaway', entityId: layaway.id, customerName: layaway.customerName, customerPhone: phone };
    items.push({
      id: `attn:col:layaway:${layaway.id}`,
      type: 'missed_collection',
      title: `${layaway.customerName} — $${(balance / 100).toFixed(2)} layaway balance`,
      reason: 'Layaway balance has not been collected.',
      severity,
      createdAt: toMs(layaway.createdAt) || now,
      staleMinutes,
      entityKind: 'layaway',
      entityId: layaway.id,
      escalationLevel,
      executionPayload: ep,
    });
  }

  return items.sort((a, b) => b.severity - a.severity).slice(0, 3);
}

// ── Builder: slow day alert ───────────────────────────────────────────────────

export function buildSlowDayAttention(engine: IntelligenceEngine): OperatorAttentionItem[] {
  const today = engine.getTodayMetrics();
  if (today.transactions > 0) return [];

  const hour = new Date().getHours();
  if (hour < 8 || hour >= 20) return [];

  const dayProgress = Math.max(0, (hour - 8) / 12);
  const ageMs = dayProgress * 12 * 3_600_000;
  const staleMinutes = Math.floor(ageMs / 60_000);
  const escalationLevel = escalationFromAge(ageMs);
  const age = scoreAttentionAge(ageMs);
  const baseSeverity = Math.round(30 + dayProgress * 50);
  const severity = combineAttentionScore(age, scoreAttentionSeverity(baseSeverity), scoreAttentionEscalation(escalationLevel));

  return [{
    id: 'attn:slow-day',
    type: 'slow_day_alert',
    title: 'No sales yet today',
    reason: 'Zero transactions recorded during business hours.',
    severity,
    createdAt: Date.now() - ageMs,
    staleMinutes,
    escalationLevel,
  }];
}

// ── Dedup helper ──────────────────────────────────────────────────────────────

function dedupKey(item: OperatorAttentionItem): string {
  if (item.workflowId)                 return `wf:${item.workflowId}`;
  if (item.entityId && item.entityKind) return `${item.type}:${item.entityKind}:${item.entityId}`;
  return `${item.type}:${item.id}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Aggregate all attention builders, dedupe by entity/workflow/type, sort by
 * severity descending. Pure read — no side effects, no auto-execution.
 */
export function getAttentionFeed(
  engine: IntelligenceEngine,
  limit = MAX_FEED_ITEMS,
): OperatorAttentionItem[] {
  const all: OperatorAttentionItem[] = [
    ...buildWorkflowAttention(),
    ...buildMissionAttention(engine),
    ...buildCollectionAttention(engine),
    ...buildSlowDayAttention(engine),
  ];

  const best = new Map<string, OperatorAttentionItem>();
  for (const item of all) {
    const key = dedupKey(item);
    const existing = best.get(key);
    if (!existing || item.severity > existing.severity) {
      best.set(key, item);
    }
  }

  return Array.from(best.values())
    .sort((a, b) => b.severity - a.severity)
    .slice(0, limit);
}
