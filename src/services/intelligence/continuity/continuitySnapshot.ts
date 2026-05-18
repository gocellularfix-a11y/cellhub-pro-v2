// CellHub Intelligence — Continuity Snapshot Builder
//
// The ONLY file in continuity/ that performs I/O (localStorage reads via
// existing store functions). Pure helpers live in continuityHelpers.ts.
//
// R-INTELLIGENCE-MERGE-CONTINUITY-SYSTEMS-V1: low-risk wiring that aggregates
// the three active-entity ownership tiers + pending workflow state into a
// single ContinuitySnapshot. Additive — none of the individual stores change.
//
// Usage:
//   const snapshot = buildContinuitySnapshot();
//   const pruned   = pruneExpiredContext(snapshot);
//
// Who should call this:
//   - Diagnostic/debug panels that need a cross-system view
//   - Future continuity consolidation work (Phase 2+)
//
// Who should NOT call this for execution decisions:
//   - Handlers/rankers that need entity context → use getIntelligenceContext()
//   - Chat intent routing → use getSessionContext()
//   - Bubble resume cards → use getPendingResumeContexts()
//   All execution paths must use the individual store owners (TTLs matter).

import { getIntelligenceContext } from '../context/intelligenceContext';
import { getContext as getLiveContext } from '../liveContext/liveContextStore';
import { getSessionContext } from '../chat/sessionContext';
import { getPendingWorkflows } from '../workflowContinuity/workflowContinuityStore';
import { resolveActiveContext } from './continuityHelpers';
import type {
  ContinuitySnapshot,
  ActiveWorkflow,
  RecentEntityReference,
} from './continuityTypes';

export function buildContinuitySnapshot(now: number = Date.now()): ContinuitySnapshot {
  // Each source is read independently — one failing does not block others.
  let intelligenceCtx: ReturnType<typeof getIntelligenceContext> = null;
  let liveCtx: ReturnType<typeof getLiveContext> | null = null;
  let chatSession: ReturnType<typeof getSessionContext> = null;

  try { intelligenceCtx = getIntelligenceContext(); } catch { /* stale or unavailable */ }
  try { liveCtx = getLiveContext(); } catch { /* unavailable */ }
  try { chatSession = getSessionContext(); } catch { /* stale or unavailable */ }

  // Resolve canonical context using the three-tier priority order.
  const context = resolveActiveContext(
    intelligenceCtx,
    liveCtx
      ? {
          lastCustomerId: liveCtx.session.lastCustomerId,
          lastRepairId: liveCtx.session.lastRepairId,
          lastSearchedPhone: liveCtx.session.lastSearchedPhone,
          lastCustomerName: liveCtx.activeCustomer?.name ?? null,
        }
      : null,
    chatSession
      ? {
          lastIntent: chatSession.lastIntent,
          lastCustomerId: chatSession.lastCustomerId,
          lastRepairId: chatSession.lastRepairId,
          timestamp: chatSession.timestamp,
        }
      : null,
    now,
  );

  // Active workflows from workflowContinuityStore (external payment workflows).
  const activeWorkflows: ActiveWorkflow[] = [];
  try {
    const pending = getPendingWorkflows();
    for (const wf of pending) {
      activeWorkflows.push({
        id: wf.id,
        type: wf.type,
        // getPendingWorkflows() already filters expired — all returned are resumable.
        status: 'resumable',
        startedAt: wf.startedAt,
        expiresAt: wf.expiresAt,
        title: wf.type,
        source: 'workflow_continuity',
      });
    }
  } catch { /* non-critical */ }

  // Recent entity references from live context session pointers.
  const recentEntities: RecentEntityReference[] = [];
  try {
    if (liveCtx) {
      const sessionUpdatedAt = liveCtx.updatedAt;
      if (liveCtx.session.lastCustomerId) {
        recentEntities.push({
          entityType: 'customer',
          entityId: liveCtx.session.lastCustomerId,
          entityName: liveCtx.activeCustomer?.name,
          lastSeenAt: sessionUpdatedAt,
          source: 'live_context',
        });
      }
      if (liveCtx.session.lastRepairId) {
        recentEntities.push({
          entityType: 'repair',
          entityId: liveCtx.session.lastRepairId,
          lastSeenAt: sessionUpdatedAt,
          source: 'live_context',
        });
      }
    }
    // Add the currently active entity from intelligenceContext (if fresh).
    if (context.activeEntityId && context.activeEntityType && isFinite(context.entityFreshnessMs)) {
      recentEntities.push({
        entityType: context.activeEntityType,
        entityId: context.activeEntityId,
        lastSeenAt: context.resolvedAt - context.entityFreshnessMs,
        source: 'intelligence_context',
      });
    }
  } catch { /* non-critical */ }

  return {
    context,
    activeWorkflows,
    recentEntities,
    snapshotAt: now,
  };
}
