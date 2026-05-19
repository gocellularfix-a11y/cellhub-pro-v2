// R-ACTION-REGISTRY-V1 — public surface for the operational action registry.
export type {
  OperationalActionKey,
  OperationalEntityKind,
  OperationalActionDescriptor,
} from './types';
export {
  getActionsForEntityKind,
  getActionDescriptor,
  isActionAllowedForEntityKind,
} from './operationalActionRegistry';
