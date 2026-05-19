// R-EXECUTION-PIPELINE-V1 — Execution Request types.
// Bridges GOER ResolvedEntity + action descriptor + permission decision
// into a single object ready for dispatch, approval queuing, or audit.

import type { ResolvedEntity } from '../oce/entityResolution/types';
import type { OperationalActionDescriptor } from '../actions/types';
import type { PermissionDecision } from '../permissions/types';

export type ExecutionRequestStatus =
  | 'ready'
  | 'requires_approval'
  | 'blocked';

export type ExecutionRequest = {
  /** Deterministic ID: exec-{entity.type}-{entityId}-{action.key} */
  id: string;
  entity: ResolvedEntity;
  action: OperationalActionDescriptor;
  permission: PermissionDecision;
  status: ExecutionRequestStatus;
  executionTarget: string;
  payload: {
    type: 'operator_action';
    entityId: string;
    executable: boolean;
    executionTarget: string;
  };
  createdAt: number;
};
