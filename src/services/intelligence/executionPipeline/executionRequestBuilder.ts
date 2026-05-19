// R-EXECUTION-PIPELINE-V1 — Execution request builder.
// Converts a GOER ResolvedEntity + action descriptor + permission decision
// into a typed ExecutionRequest. Pure function — no side effects, no I/O.

import type { ResolvedEntity } from '../oce/entityResolution/types';
import type { OperationalActionDescriptor } from '../actions/types';
import type { PermissionDecision } from '../permissions/types';
import type { ExecutionRequest, ExecutionRequestStatus } from './types';

// ── Entity ID extraction ──────────────────────────────────────────────────────

function extractEntityId(entity: ResolvedEntity): string {
  switch (entity.type) {
    case 'customer':  return entity.customerId;
    case 'repair':    return entity.repairId;
    case 'inventory': return entity.sku;
    case 'layaway':   return entity.layawayId;
    case 'sale':      return entity.saleId;
  }
}

// ── Status mapping ────────────────────────────────────────────────────────────

function permissionToStatus(decision: PermissionDecision): ExecutionRequestStatus {
  switch (decision.status) {
    case 'allowed':           return 'ready';
    case 'requires_approval': return 'requires_approval';
    case 'blocked':           return 'blocked';
  }
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Builds an ExecutionRequest from a resolved entity, action descriptor, and
 * permission decision.
 *
 * Returns null when action is null (unknown action — caller should not
 * surface a button for it).
 *
 * The returned payload matches the existing operator_action ActionPayload
 * shape so it can be passed directly to ChatActionUI.payload (with a cast
 * to ActionPayload since executionTarget is string here vs. the union type
 * in ActionPayload).
 */
export function buildExecutionRequest(params: {
  entity: ResolvedEntity;
  action: OperationalActionDescriptor | null;
  permission: PermissionDecision;
}): ExecutionRequest | null {
  const { entity, action, permission } = params;

  if (!action) return null;

  const entityId = extractEntityId(entity);
  const status   = permissionToStatus(permission);

  return {
    id:              `exec-${entity.type}-${entityId}-${action.key}`,
    entity,
    action,
    permission,
    status,
    executionTarget: action.executionTarget,
    payload: {
      type:            'operator_action',
      entityId,
      executable:      permission.status === 'allowed',
      executionTarget: action.executionTarget,
    },
    createdAt: Date.now(),
  };
}
