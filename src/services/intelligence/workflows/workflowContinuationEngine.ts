// CellHub Intelligence — Workflow Continuation Engine
// Detects interrupted operational flows and surfaces resumable workflows.
// R-INTELLIGENCE-WORKFLOW-CONTINUATION-V1
//
// READ-ONLY aggregator — creates NO new localStorage keys.
// Reads exclusively from existing canonical systems:
//
//   1. workflowContinuityStore  → external payment flows not yet completed
//   2. intelligenceExecutionHistory → operator open-loops without follow-up
//   3. automationQueue.getDealPipeline → stalled deal pipeline stages
//   4. automationQueue.getProposalFollowups → proposal replies not followed up
//   5. workflows/store.getStaleWorkflows → structured workflows gone quiet
//
// External payment detection is additive to PaymentVerificationNudge, which
// owns the primary UI path. This engine surfaces them for intelligence/chat.
// Approval-review workflows are excluded — continuityEngine owns that signal.

import { getPendingWorkflows } from '../workflowContinuity/workflowContinuityStore';
import { getIntelligenceExecutionHistory } from '../execution/intelligenceExecutionHistory';
import { getDealPipeline, getProposalFollowups } from '../automation/automationQueue';
import { getStaleWorkflows } from './store';
import { scoreWorkflow } from './workflowContinuationScoring';
import type {
  ResumableWorkflow,
  WorkflowContinuationReport,
  WorkflowContinuationReason,
  WorkflowEntityType,
  ResumableWorkflowAction,
  WorkflowActionType,
} from './workflowContinuationTypes';

// ── Thresholds ────────────────────────────────────────────────────────────────

const LOOP_WINDOW_MS               = 2 * 3600_000; // 2h window for open-loop detection
const LOOP_MIN_OPENS               = 3;            // 3+ opens without action = loop
const DEAL_REPLY_STALE_MS          = 2 * 3600_000; // 2h: customer replied, no follow-up
const DEAL_NEGOTIATION_STALE_MS    = 4 * 3600_000; // 4h: negotiating stage gone quiet
const PROPOSAL_REPLY_STALE_MS      = 2 * 3600_000; // 2h: proposal reply not answered
const OPERATIONAL_STALE_MS         = 4 * 3600_000; // 4h: structured workflow not advancing
const MAX_WORKFLOWS                = 5;            // cap on surfaced workflows

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId(...parts: string[]): string {
  return `wcont:${parts.join(':')}`;
}

function buildAction(
  type: WorkflowActionType,
  label: string,
  labelEs: string,
  opts?: { targetId?: string; targetPhone?: string; targetModule?: string },
): ResumableWorkflowAction {
  return { type, label, labelEs, ...opts };
}

// ── Detector 1: external payment workflows ────────────────────────────────────
// Source: workflowContinuityStore.getPendingWorkflows()

function detectExternalPayments(now: number): ResumableWorkflow[] {
  return getPendingWorkflows()
    .filter((w) => w.type === 'external_payment')
    .map((w) => {
      const meta = w.metadata as Record<string, unknown>;
      const phone = typeof meta.phone === 'string' ? meta.phone : undefined;
      const carrier = typeof meta.carrier === 'string' ? meta.carrier : '';
      const staleSinceMs = now - w.startedAt;
      const { score, urgency } = scoreWorkflow('external_payment_pending', staleSinceMs);
      return {
        id: makeId('ext-pay', w.id),
        reason: 'external_payment_pending' as WorkflowContinuationReason,
        urgency,
        score,
        title: carrier ? `Resume ${carrier} payment` : 'Resume payment',
        titleEs: carrier ? `Retomar pago ${carrier}` : 'Retomar pago',
        description: phone
          ? `Payment flow interrupted for ${phone}`
          : 'Payment flow not completed',
        descriptionEs: phone
          ? `Flujo de pago interrumpido para ${phone}`
          : 'Flujo de pago no completado',
        entityType: 'external_payment' as WorkflowEntityType,
        entityId: w.id,
        entityName: phone ?? carrier,
        resumeAction: buildAction('resume_external_payment', 'Resume Payment', 'Retomar Pago', {
          targetId: w.id,
          targetPhone: phone,
          targetModule: 'phone-payments',
        }),
        detectedAt: now,
        staleSinceMs,
        sourceSystem: 'workflowContinuityStore' as const,
      };
    });
}

// ── Detector 2: operator open loops ──────────────────────────────────────────
// Source: intelligenceExecutionHistory
// Flags when the same repair or customer was opened 3+ times in 2h without
// a whatsapp or completed action recorded for that entity afterward.

function detectOperatorLoops(now: number): ResumableWorkflow[] {
  const history = getIntelligenceExecutionHistory();
  const cutoff = now - LOOP_WINDOW_MS;
  const recent = history.filter((e) => e.timestamp >= cutoff);

  const groups = new Map<string, typeof recent>();
  for (const e of recent) {
    if (e.type !== 'open_repair' && e.type !== 'open_customer') continue;
    if (!e.entityId) continue;
    const key = `${e.type}:${e.entityId}`;
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }

  const result: ResumableWorkflow[] = [];

  for (const [key, opens] of groups) {
    if (opens.length < LOOP_MIN_OPENS) continue;

    const entityId = opens[0].entityId!;
    const entityName = opens[0].entityName;
    const lastOpen = Math.max(...opens.map((e) => e.timestamp));
    const firstOpen = Math.min(...opens.map((e) => e.timestamp));
    const isRepair = key.startsWith('open_repair:');

    // Resolved if whatsapp or completed was recorded for this entity after the last open.
    const resolved = history.some(
      (e) =>
        e.entityId === entityId &&
        (e.type === 'whatsapp' || e.type === 'completed') &&
        e.timestamp > lastOpen,
    );
    if (resolved) continue;

    const staleSinceMs = now - firstOpen;
    const reason: WorkflowContinuationReason = isRepair
      ? 'repair_loop_unresolved'
      : 'customer_loop_unresolved';
    const { score, urgency } = scoreWorkflow(reason, staleSinceMs);
    const label = entityName ?? (isRepair ? 'Repair' : 'Customer');

    result.push({
      id: makeId(isRepair ? 'repair-loop' : 'customer-loop', entityId),
      reason,
      urgency,
      score,
      title: `Unresolved: ${label}`,
      titleEs: `Sin resolver: ${label}`,
      description: `Opened ${opens.length}× without follow-up`,
      descriptionEs: `Abierto ${opens.length}× sin acción de seguimiento`,
      entityType: (isRepair ? 'repair' : 'customer') as WorkflowEntityType,
      entityId,
      entityName,
      resumeAction: buildAction(
        isRepair ? 'open_repair' : 'open_customer',
        isRepair ? 'Open Repair' : 'Open Customer',
        isRepair ? 'Abrir Reparación' : 'Abrir Cliente',
        { targetId: entityId },
      ),
      detectedAt: now,
      staleSinceMs,
      sourceSystem: 'executionHistory',
    });
  }

  return result;
}

// ── Detector 3: stalled deal pipeline ─────────────────────────────────────────
// Source: automationQueue.getDealPipeline()
// Flags deals where customer replied or negotiation stalled.

const REPLY_STAGES = new Set(['customer_replied', 'interested']);

function detectStalledDeals(now: number): ResumableWorkflow[] {
  const result: ResumableWorkflow[] = [];

  for (const deal of getDealPipeline()) {
    const isReply = REPLY_STAGES.has(deal.stage);
    const isNegotiating = deal.stage === 'negotiating';
    if (!isReply && !isNegotiating) continue;

    const thresholdMs = isNegotiating ? DEAL_NEGOTIATION_STALE_MS : DEAL_REPLY_STALE_MS;
    const staleSinceMs = now - deal.updatedAt;
    if (staleSinceMs < thresholdMs) continue;

    const reason: WorkflowContinuationReason = isNegotiating
      ? 'deal_negotiation_stalled'
      : 'deal_reply_stalled';
    const { score, urgency } = scoreWorkflow(reason, staleSinceMs);
    const label = deal.customerName ?? 'Customer';
    const hrs = Math.floor(staleSinceMs / 3600_000);
    const stageEn = isNegotiating ? 'Negotiating' : 'Customer replied';
    const stageEs = isNegotiating ? 'Negociando' : 'Cliente respondió';

    result.push({
      id: makeId('deal', deal.id),
      reason,
      urgency,
      score,
      title: `Deal stalled: ${label}`,
      titleEs: `Deal estancado: ${label}`,
      description: `${stageEn} — no update in ${hrs}h`,
      descriptionEs: `${stageEs} — sin actualización hace ${hrs}h`,
      entityType: 'deal',
      entityId: deal.id,
      entityName: deal.customerName,
      resumeAction: buildAction(
        deal.customerPhone ? 'send_whatsapp' : 'open_deal_pipeline',
        deal.customerPhone ? 'Send WhatsApp' : 'Open Pipeline',
        deal.customerPhone ? 'Enviar WhatsApp' : 'Abrir Pipeline',
        { targetId: deal.id, targetPhone: deal.customerPhone, targetModule: 'deals' },
      ),
      detectedAt: now,
      staleSinceMs,
      sourceSystem: 'dealPipeline',
    });
  }

  return result;
}

// ── Detector 4: stalled proposal followups ────────────────────────────────────
// Source: automationQueue.getProposalFollowups()
// Flags manual proposals that received a reply but haven't been followed up.

const STALLED_PROPOSAL_STATUSES = new Set(['replied', 'interested']);

function detectStalledProposals(now: number): ResumableWorkflow[] {
  const result: ResumableWorkflow[] = [];

  for (const p of getProposalFollowups()) {
    if (!STALLED_PROPOSAL_STATUSES.has(p.status)) continue;

    const replyAt = p.lastReplyAt ?? p.sentAt;
    const staleSinceMs = now - replyAt;
    if (staleSinceMs < PROPOSAL_REPLY_STALE_MS) continue;

    const { score, urgency } = scoreWorkflow('proposal_reply_stalled', staleSinceMs);
    const label = p.customerName ?? 'Customer';
    const hrs = Math.floor(staleSinceMs / 3600_000);

    result.push({
      id: makeId('proposal', p.id),
      reason: 'proposal_reply_stalled',
      urgency,
      score,
      title: `Proposal follow-up: ${label}`,
      titleEs: `Seguimiento propuesta: ${label}`,
      description: `Reply received ${hrs}h ago — no follow-up yet`,
      descriptionEs: `Respuesta recibida hace ${hrs}h — sin seguimiento`,
      entityType: 'proposal',
      entityId: p.id,
      entityName: p.customerName,
      resumeAction: buildAction(
        p.customerPhone ? 'send_whatsapp' : 'open_deal_pipeline',
        p.customerPhone ? 'Reply on WhatsApp' : 'View Proposal',
        p.customerPhone ? 'Responder en WhatsApp' : 'Ver Propuesta',
        { targetId: p.id, targetPhone: p.customerPhone, targetModule: 'proposals' },
      ),
      detectedAt: now,
      staleSinceMs,
      sourceSystem: 'proposalFollowups',
    });
  }

  return result;
}

// ── Detector 5: stale operational workflows ───────────────────────────────────
// Source: workflows/store.getStaleWorkflows()
// Flags structured multi-step workflows that haven't advanced in 4h+.
// Skips approval_review — continuityEngine already surfaces approval_pending.

function detectStalledOperationalWorkflows(now: number): ResumableWorkflow[] {
  const result: ResumableWorkflow[] = [];

  for (const wf of getStaleWorkflows(OPERATIONAL_STALE_MS)) {
    if (wf.category === 'approval_review') continue;

    const staleSinceMs = now - wf.updatedAt;
    const { score, urgency } = scoreWorkflow('operational_workflow_stalled', staleSinceMs);

    const isRepairEntity = wf.entityType === 'repair';
    const actionType: WorkflowActionType = isRepairEntity ? 'open_repair' : 'open_customer';

    result.push({
      id: makeId('opwf', wf.id),
      reason: 'operational_workflow_stalled',
      urgency,
      score,
      title: wf.title,
      titleEs: wf.title,
      description: wf.nextSuggestedAction ?? wf.description,
      descriptionEs: wf.nextSuggestedAction ?? wf.description,
      entityType: (isRepairEntity ? 'repair' : 'customer') as WorkflowEntityType,
      entityId: wf.entityId,
      resumeAction: buildAction(
        actionType,
        isRepairEntity ? 'Open Repair' : 'Open Customer',
        isRepairEntity ? 'Abrir Reparación' : 'Abrir Cliente',
        { targetId: wf.entityId },
      ),
      detectedAt: now,
      staleSinceMs,
      sourceSystem: 'operationalWorkflows',
    });
  }

  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Aggregate all resumable workflow signals from existing canonical sources.
 * Returns a scored, capped report ready for intelligence/chat consumption.
 * Pure read — no side effects, no new storage.
 */
export function detectResumableWorkflows(now?: number): WorkflowContinuationReport {
  const _now = now ?? Date.now();

  const all: ResumableWorkflow[] = [
    ...detectExternalPayments(_now),
    ...detectOperatorLoops(_now),
    ...detectStalledDeals(_now),
    ...detectStalledProposals(_now),
    ...detectStalledOperationalWorkflows(_now),
  ];

  const workflows = all.sort((a, b) => b.score - a.score).slice(0, MAX_WORKFLOWS);

  return {
    generatedAt: _now,
    workflows,
    topWorkflow: workflows[0] ?? null,
    totalDetected: all.length,
  };
}
