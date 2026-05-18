// CellHub Intelligence — Signal Fusion Engine
// READ-ONLY aggregator — maps existing canonical signals to FusedInsight format.
// R-FUSION-CHAT-INTEGRATION-V1
//
// Sources (all read-only, no new localStorage keys):
//   1. workflows/workflowContinuationEngine.detectResumableWorkflows()
//   2. attention/attentionEngine.computeAttentionSnapshot()
//   3. managerQueue/store.readQueue()
//
// Responsibilities: aggregate, severity-sort, cap, deduplicate.
// Formatting and action attachment are owned by the chat handler.

import { detectResumableWorkflows } from '../workflows/workflowContinuationEngine';
import { computeAttentionSnapshot } from '../attention/attentionEngine';
import { readQueue } from '../managerQueue/store';
import { detectSuppressionAwareness } from './suppressionAwareness';
import type {
  FusedInsight,
  FusedInsightSeverity,
  FusedInsightCategory,
  FusedInsightActionType,
  FusedInsightsReport,
} from './fusionTypes';
import type {
  WorkflowContinuationReason,
  WorkflowContinuationReport,
} from '../workflows/workflowContinuationTypes';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_INSIGHTS = 5;
const MANAGER_STALE_MS = 2 * 3600_000; // 2h pending without resolution = surface

// ── Severity ordering ─────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<FusedInsightSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

// ── Reason → Category (workflow continuation source) ──────────────────────────

const REASON_CATEGORY: Record<WorkflowContinuationReason, FusedInsightCategory> = {
  external_payment_pending:     'operational_risk',
  repair_loop_unresolved:       'workflow_interruption',
  customer_loop_unresolved:     'workflow_interruption',
  deal_reply_stalled:           'conversion_opportunity',
  deal_negotiation_stalled:     'conversion_opportunity',
  proposal_reply_stalled:       'recovery_opportunity',
  operational_workflow_stalled: 'workflow_interruption',
};

// ── WorkflowActionType → FusedInsightActionType ───────────────────────────────
// resume_external_payment excluded (PaymentVerificationNudge owns that UI path).
// open_deal_pipeline falls back to open_customer as a safe navigation target.

function mapActionType(wfType?: string): FusedInsightActionType | undefined {
  switch (wfType) {
    case 'open_repair':        return 'open_repair';
    case 'open_customer':      return 'open_customer';
    case 'send_whatsapp':      return 'send_whatsapp';
    case 'open_deal_pipeline': return 'open_customer';
    default:                   return undefined;
  }
}

// ── Severity pass-through ─────────────────────────────────────────────────────
// WorkflowUrgency and FusedInsightSeverity share the same string literal values.

function toSeverity(urgency: string): FusedInsightSeverity {
  const map: Record<string, FusedInsightSeverity> = {
    critical: 'critical', high: 'high', medium: 'medium', low: 'low',
  };
  return map[urgency] ?? 'low';
}

// ── Source 1: Resumable workflow signals ──────────────────────────────────────

function insightsFromWorkflows(report: WorkflowContinuationReport): FusedInsight[] {
  return report.workflows.map((wf) => {
    const category = REASON_CATEGORY[wf.reason] ?? 'operational_risk';
    const rawAction = mapActionType(wf.resumeAction?.type);
    const hasPhone = !!wf.resumeAction?.targetPhone;
    // send_whatsapp only valid when phone is known; fall back to open_customer.
    const actionType: FusedInsightActionType | undefined =
      rawAction === 'send_whatsapp' && !hasPhone ? 'open_customer' : rawAction;

    return {
      id: `wf:${wf.id}`,
      severity: toSeverity(wf.urgency),
      category,
      title: wf.title,
      titleEs: wf.titleEs,
      titlePt: wf.title, // EN fallback — workflowContinuationEngine is EN/ES only
      summary: wf.description,
      summaryEs: wf.descriptionEs,
      summaryPt: wf.description,
      entityId: wf.entityId,
      entityType: wf.entityType,
      phone: wf.resumeAction?.targetPhone,
      actionType,
      actionTargetId: wf.resumeAction?.targetId,
      actionTargetPhone: wf.resumeAction?.targetPhone,
    };
  });
}

// ── Source 2: Operator attention state ───────────────────────────────────────
// Surfaces only true overload — busy/recovering are expected transient states.

function insightsFromAttention(): FusedInsight[] {
  const snap = computeAttentionSnapshot();
  if (snap.state !== 'overloaded') return [];
  return [{
    id: 'attn:overloaded',
    severity: 'critical',
    category: 'operator_overload',
    title: 'Operator is overloaded',
    titleEs: 'Operador saturado',
    titlePt: 'Operador sobrecarregado',
    summary: 'High interruption activity detected — incoming suggestions are being filtered.',
    summaryEs: 'Alta actividad detectada — sugerencias entrantes están siendo filtradas.',
    summaryPt: 'Alta atividade detectada — sugestões estão sendo filtradas.',
  }];
}

// ── Source 3: Critical / high manager queue items ─────────────────────────────
// Only surfaces items that are pending, not snoozed, and stale > 2h.
// Capped at 2 items to avoid dominating the fusion report.

function insightsFromManagerQueue(now: number): FusedInsight[] {
  const result: FusedInsight[] = [];
  for (const item of readQueue()) {
    if (item.status !== 'pending') continue;
    if (item.snoozedUntil && now < item.snoozedUntil) continue;
    if (item.severity !== 'critical' && item.severity !== 'high') continue;
    if (now - item.createdAt < MANAGER_STALE_MS) continue;

    const category: FusedInsightCategory =
      item.category === 'refund' || item.category === 'discount'
        ? 'vip_risk'
        : 'operational_risk';

    result.push({
      id: `mq:${item.id}`,
      severity: item.severity,
      category,
      title: item.title,
      titleEs: item.title,
      titlePt: item.title,
      summary: item.description,
      summaryEs: item.description,
      summaryPt: item.description,
      entityId: item.entityId,
      entityType: item.entityType,
      actionType: 'open_manager_queue',
    });

    if (result.length >= 2) break;
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Aggregate cross-system operational signals into a severity-ranked report.
 * Pure read — no writes, no side effects, no new storage keys.
 */
export function generateFusedInsights(now?: number): FusedInsightsReport {
  const _now = now ?? Date.now();

  // Fetch once — shared between insightsFromWorkflows and detectSuppressionAwareness.
  const workflowReport = detectResumableWorkflows(_now);

  const all: FusedInsight[] = [
    ...insightsFromAttention(),
    ...insightsFromManagerQueue(_now),
    ...insightsFromWorkflows(workflowReport),
    ...detectSuppressionAwareness(workflowReport.workflows, _now),
  ];

  // Deduplicate by id, sort by severity descending, cap.
  const seen = new Set<string>();
  const deduped: FusedInsight[] = [];
  for (const insight of all) {
    if (seen.has(insight.id)) continue;
    seen.add(insight.id);
    deduped.push(insight);
  }

  const sorted = deduped.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
  const insights = sorted.slice(0, MAX_INSIGHTS);

  return {
    generatedAt: _now,
    insights,
    topInsight: insights[0] ?? null,
    criticalCount: insights.filter((i) => i.severity === 'critical').length,
    highCount: insights.filter((i) => i.severity === 'high').length,
  };
}
