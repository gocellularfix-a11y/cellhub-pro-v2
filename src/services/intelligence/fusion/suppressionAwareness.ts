// CellHub Intelligence — Suppression Awareness
// Detects recurring operational neglect patterns from canonical system outputs.
// R-FUSION-SUPPRESSION-AWARENESS-V1
//
// READ-ONLY, PURE, DETERMINISTIC. No persistence, no new storage.
// Sources (all read-only, no new localStorage keys):
//   1. getIntelligenceExecutionHistory() — dismissal / ignore patterns
//   2. ResumableWorkflow[]               — passed from fusionEngine (no double-call)
//   3. readQueue()                       — unresolved manager queue growth
//   4. computeAttentionSnapshot()        — operator overload state

import { getIntelligenceExecutionHistory } from '../execution/intelligenceExecutionHistory';
import { readQueue } from '../managerQueue/store';
import { computeAttentionSnapshot } from '../attention/attentionEngine';
import type { FusedInsight } from './fusionTypes';
import type { ResumableWorkflow } from '../workflows/workflowContinuationTypes';

// ── Thresholds ─────────────────────────────────────────────────────────────────

const DISMISSAL_WINDOW_MS          = 48 * 3600_000; // 48h lookback for dismissal patterns
const MIN_VIP_DISMISSALS           = 2;             // 2+ dismissals on same customer = VIP neglect
const MIN_REPAIR_DISMISSALS        = 3;             // 3+ dismissals on same repair = escalation
const WORKFLOW_ESCALATION_STALE_MS = 6 * 3600_000;  // 6h+ stale + dismissals = degradation
const OVERLOAD_DISMISSAL_THRESHOLD = 5;             // 5+ recent dismissals in overloaded state
const OVERLOAD_QUEUE_THRESHOLD     = 3;             // 3+ unresolved critical/high items

// ── Rule 1: Repeated VIP neglect ──────────────────────────────────────────────
// Customer dismissed 2+ times within 48h AND present in manager queue pending/high+.

function detectVipNeglect(now: number): FusedInsight[] {
  const cutoff  = now - DISMISSAL_WINDOW_MS;
  const history = getIntelligenceExecutionHistory();
  const queue   = readQueue();

  const pendingHighIds = new Set<string>();
  for (const item of queue) {
    if (item.status !== 'pending') continue;
    if (item.severity !== 'critical' && item.severity !== 'high') continue;
    if (item.entityId) pendingHighIds.add(item.entityId);
  }

  const byCustomer = new Map<string, typeof history>();
  for (const e of history) {
    if (e.timestamp < cutoff) continue;
    if (e.entityType !== 'customer') continue;
    if (e.type !== 'dismissed' && e.type !== 'ignored') continue;
    if (!e.entityId) continue;
    const g = byCustomer.get(e.entityId) ?? [];
    g.push(e);
    byCustomer.set(e.entityId, g);
  }

  const result: FusedInsight[] = [];
  for (const [entityId, entries] of byCustomer) {
    if (entries.length < MIN_VIP_DISMISSALS) continue;
    if (!pendingHighIds.has(entityId)) continue;

    const sorted = entries.slice().sort((a, b) => a.timestamp - b.timestamp);
    const name   = sorted[0].entityName;
    const label  = name ? ` — ${name}` : '';

    result.push({
      id: `supp:vip-neglect:${entityId}`,
      severity: 'critical',
      category: 'vip_risk',
      title:     `VIP follow-up ignored${label}`,
      titleEs:   `Seguimiento VIP ignorado${label}`,
      titlePt:   `Acompanhamento VIP ignorado${label}`,
      summary:   `High-value customer dismissed ${entries.length}× without resolution.`,
      summaryEs: `Cliente de alto valor ignorado ${entries.length}× sin resolución.`,
      summaryPt: `Cliente de alto valor ignorado ${entries.length}× sem resolução.`,
      entityId,
      entityType:      'customer',
      actionType:      'open_customer',
      actionTargetId:  entityId,
      suppressionPattern: 'ignored_vip',
      repeatCount:     entries.length,
      firstDetectedAt: sorted[0].timestamp,
    });
  }
  return result;
}

// ── Rule 2: Workflow repeatedly resumed but abandoned ─────────────────────────
// Same entity dismissed 2+ times while its workflow has been stale for 6h+.

function detectWorkflowDegradation(
  existingWorkflows: ResumableWorkflow[],
  now: number,
): FusedInsight[] {
  const cutoff  = now - DISMISSAL_WINDOW_MS;
  const history = getIntelligenceExecutionHistory();
  const result: FusedInsight[] = [];

  for (const wf of existingWorkflows) {
    if (wf.staleSinceMs < WORKFLOW_ESCALATION_STALE_MS) continue;
    if (!wf.entityId) continue;

    const dismissals = history.filter(
      (e) =>
        e.entityId === wf.entityId &&
        e.timestamp >= cutoff &&
        (e.type === 'dismissed' || e.type === 'ignored'),
    );
    if (dismissals.length < 2) continue;

    const hrs        = Math.floor(wf.staleSinceMs / 3600_000);
    const actionType = wf.entityType === 'repair' ? 'open_repair' as const : 'open_customer' as const;

    result.push({
      id: `supp:wf-degrade:${wf.id}`,
      severity: 'high',
      category: 'workflow_interruption',
      title:     `Workflow repeatedly ignored: ${wf.title}`,
      titleEs:   `Workflow repetidamente ignorado: ${wf.titleEs}`,
      titlePt:   `Workflow repetidamente ignorado: ${wf.title}`,
      summary:   `Interrupted ${dismissals.length}× without resolution in ${hrs}h.`,
      summaryEs: `Interrumpido ${dismissals.length}× sin resolución en ${hrs}h.`,
      summaryPt: `Interrompido ${dismissals.length}× sem resolução em ${hrs}h.`,
      entityId:        wf.entityId,
      entityType:      wf.entityType,
      actionType,
      actionTargetId:  wf.entityId,
      suppressionPattern: 'stale_workflow',
      repeatCount:     dismissals.length,
      firstDetectedAt: Math.min(...dismissals.map((d) => d.timestamp)),
    });
  }
  return result;
}

// ── Rule 3: Repeated stale repair neglect ────────────────────────────────────
// Same repair dismissed 3+ times in 48h with no completion or WhatsApp follow-up.

function detectRepeatedRepairNeglect(now: number): FusedInsight[] {
  const cutoff  = now - DISMISSAL_WINDOW_MS;
  const history = getIntelligenceExecutionHistory();

  const byRepair = new Map<string, typeof history>();
  for (const e of history) {
    if (e.timestamp < cutoff) continue;
    if (e.entityType !== 'repair') continue;
    if (e.type !== 'dismissed' && e.type !== 'ignored') continue;
    if (!e.entityId) continue;
    const g = byRepair.get(e.entityId) ?? [];
    g.push(e);
    byRepair.set(e.entityId, g);
  }

  const result: FusedInsight[] = [];
  for (const [entityId, entries] of byRepair) {
    if (entries.length < MIN_REPAIR_DISMISSALS) continue;

    const lastDismissal = Math.max(...entries.map((e) => e.timestamp));
    const resolved = history.some(
      (e) =>
        e.entityId === entityId &&
        (e.type === 'completed' || e.type === 'whatsapp') &&
        e.timestamp > lastDismissal,
    );
    if (resolved) continue;

    const sorted = entries.slice().sort((a, b) => a.timestamp - b.timestamp);
    const name   = sorted[0].entityName;
    const label  = name ? ` — ${name}` : '';

    result.push({
      id: `supp:repair-neglect:${entityId}`,
      severity: 'high',
      category: 'operational_risk',
      title:     `Pending repair continues unresolved${label}`,
      titleEs:   `Reparación pendiente sin resolver${label}`,
      titlePt:   `Reparo pendente não resolvido${label}`,
      summary:   `Repair dismissed ${entries.length}× — customer has not been contacted.`,
      summaryEs: `Reparación ignorada ${entries.length}× — cliente sin contactar.`,
      summaryPt: `Reparo ignorado ${entries.length}× — cliente não foi contactado.`,
      entityId,
      entityType:      'repair',
      actionType:      'open_repair',
      actionTargetId:  entityId,
      suppressionPattern: 'repeated_unresolved',
      repeatCount:     entries.length,
      firstDetectedAt: sorted[0].timestamp,
    });
  }
  return result;
}

// ── Rule 4: Operator overload suppression ─────────────────────────────────────
// Operator overloaded + 5+ recent dismissals + 3+ unresolved critical/high queue items.

function detectOverloadSuppression(now: number): FusedInsight[] {
  const snap = computeAttentionSnapshot();
  if (snap.state !== 'overloaded') return [];
  if (snap.recentDismissals < OVERLOAD_DISMISSAL_THRESHOLD) return [];

  const pendingCount = readQueue().filter(
    (item) =>
      item.status === 'pending' &&
      !(item.snoozedUntil && now < item.snoozedUntil) &&
      (item.severity === 'critical' || item.severity === 'high'),
  ).length;
  if (pendingCount < OVERLOAD_QUEUE_THRESHOLD) return [];

  return [{
    id: 'supp:overload-suppression',
    severity: 'critical',
    category: 'operator_overload',
    title:     'Operational backlog growing — items being suppressed',
    titleEs:   'Backlog operacional creciendo — ítems suprimidos',
    titlePt:   'Backlog operacional crescendo — itens suprimidos',
    summary:   `${pendingCount} high-priority items pending while operator is overloaded — follow-up at risk.`,
    summaryEs: `${pendingCount} ítems de alta prioridad pendientes mientras el operador está saturado.`,
    summaryPt: `${pendingCount} itens de alta prioridade pendentes enquanto o operador está sobrecarregado.`,
    suppressionPattern: 'operator_overload_pattern',
    repeatCount:     snap.recentDismissals,
  }];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Detect recurring operational neglect patterns from canonical system outputs.
 * @param existingWorkflows  - Pre-fetched from detectResumableWorkflows (no double-call).
 * Pure read — no writes, no side effects, no new storage keys.
 */
export function detectSuppressionAwareness(
  existingWorkflows: ResumableWorkflow[],
  now?: number,
): FusedInsight[] {
  const _now = now ?? Date.now();
  return [
    ...detectOverloadSuppression(_now),     // overload first — signals system-wide suppression
    ...detectVipNeglect(_now),
    ...detectRepeatedRepairNeglect(_now),
    ...detectWorkflowDegradation(existingWorkflows, _now),
  ];
}
