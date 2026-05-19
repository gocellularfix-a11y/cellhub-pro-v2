// R-ACTION-REGISTRY-V1 — Global Operational Action Registry types.
// Descriptor-only: no execution logic, no side effects.

export type OperationalActionKey =
  | 'open'
  | 'whatsapp'
  | 'loyalty_reward'
  | 'collect_payment'
  | 'notify_customer'
  | 'mark_ready'
  | 'escalate_delayed'
  | 'promote'
  | 'discount'
  | 'reorder'
  | 'view_receipt';

export type OperationalEntityKind =
  | 'customer'
  | 'repair'
  | 'inventory'
  | 'layaway'
  | 'sale';

export type OperationalActionDescriptor = {
  key: OperationalActionKey;
  entityKind: OperationalEntityKind;
  /** tChat translation key for the action button label. */
  labelKey: string;
  /** Maps to existing ActionPayload['executionTarget'] where supported. */
  executionTarget: string;
  /** When true, the UI must require PIN/admin confirmation before executing. */
  requiresApproval?: boolean;
  /** When true, the action is read-only (no mutations, safe to execute without confirmation). */
  safeReadOnly?: boolean;
};
