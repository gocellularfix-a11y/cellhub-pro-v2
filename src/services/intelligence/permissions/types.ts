// R-PERMISSION-GATE-V1 — Operational action permission gate types.
// Descriptor-only: no UI, no execution, no side effects.

import type {
  OperationalActionDescriptor,
  OperationalEntityKind,
  OperationalActionKey,
} from '../actions/types';

export type OperatorRole =
  | 'owner'
  | 'manager'
  | 'technician'
  | 'cashier'
  | 'unknown';

export type PermissionDecision =
  | {
      status: 'allowed';
      reason: 'safe_read_only' | 'role_allowed';
    }
  | {
      status: 'requires_approval';
      reason: 'descriptor_requires_approval' | 'role_requires_approval';
    }
  | {
      status: 'blocked';
      reason: 'unknown_role' | 'unsupported_action';
    };

export type PermissionGateInput = {
  role?: OperatorRole;
  descriptor: OperationalActionDescriptor | null;
  entityKind: OperationalEntityKind;
  actionKey: OperationalActionKey;
};
