// R-PERMISSION-GATE-V1 — public surface for the operational permission gate.
export type {
  OperatorRole,
  PermissionDecision,
  PermissionGateInput,
} from './types';
export {
  evaluateActionPermission,
  canExecuteAction,
  requiresActionApproval,
} from './actionPermissionGate';
