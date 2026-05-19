// R-ACTION-REGISTRY-V1 — Global Operational Action Registry.
// Single source of truth for which actions are available per entity kind.
// Returns descriptors only — execution is handled by the existing
// actions/actionExecutor.ts + execution/executionResolver.ts systems.

import type {
  OperationalActionKey,
  OperationalEntityKind,
  OperationalActionDescriptor,
} from './types';

// ── Registry definition ───────────────────────────────────────────────────────

const REGISTRY: Readonly<Record<OperationalEntityKind, readonly OperationalActionDescriptor[]>> = {
  customer: [
    { key: 'open',            entityKind: 'customer', labelKey: 'chat.actions.openCustomer',     executionTarget: 'open_customer',           safeReadOnly: true },
    { key: 'whatsapp',        entityKind: 'customer', labelKey: 'chat.actions.whatsappCustomer', executionTarget: 'whatsapp_url' },
    { key: 'loyalty_reward',  entityKind: 'customer', labelKey: 'chat.actions.loyaltyReward',    executionTarget: 'customer_loyalty_reward',  requiresApproval: true },
    { key: 'collect_payment', entityKind: 'customer', labelKey: 'chat.actions.collectPayment',   executionTarget: 'collect_payment',          requiresApproval: true },
  ],
  repair: [
    { key: 'open',             entityKind: 'repair', labelKey: 'chat.actions.openRepair',       executionTarget: 'open_repair',      safeReadOnly: true },
    { key: 'notify_customer',  entityKind: 'repair', labelKey: 'chat.actions.notifyCustomer',   executionTarget: 'notify_customer' },
    { key: 'mark_ready',       entityKind: 'repair', labelKey: 'chat.actions.markRepairReady',  executionTarget: 'mark_repair_ready', requiresApproval: true },
    { key: 'escalate_delayed', entityKind: 'repair', labelKey: 'chat.actions.escalateRepair',   executionTarget: 'escalate_repair' },
  ],
  inventory: [
    { key: 'open',     entityKind: 'inventory', labelKey: 'chat.actions.openInventory',  executionTarget: 'open_inventory',   safeReadOnly: true },
    { key: 'promote',  entityKind: 'inventory', labelKey: 'chat.actions.promoteProduct', executionTarget: 'promote_product' },
    { key: 'discount', entityKind: 'inventory', labelKey: 'chat.actions.discountProduct',executionTarget: 'discount_product', requiresApproval: true },
    { key: 'reorder',  entityKind: 'inventory', labelKey: 'chat.actions.reorderProduct', executionTarget: 'reorder_product' },
  ],
  layaway: [
    { key: 'open',             entityKind: 'layaway', labelKey: 'chat.actions.openLayaway',    executionTarget: 'open_layaway',            safeReadOnly: true },
    { key: 'collect_payment',  entityKind: 'layaway', labelKey: 'chat.actions.collectPayment', executionTarget: 'collect_layaway_payment', requiresApproval: true },
    { key: 'notify_customer',  entityKind: 'layaway', labelKey: 'chat.actions.notifyCustomer', executionTarget: 'notify_customer' },
  ],
  sale: [
    { key: 'open',         entityKind: 'sale', labelKey: 'chat.actions.openSale',    executionTarget: 'open_sale',    safeReadOnly: true },
    { key: 'view_receipt', entityKind: 'sale', labelKey: 'chat.actions.viewReceipt', executionTarget: 'view_receipt', safeReadOnly: true },
  ],
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns all action descriptors registered for an entity kind. */
export function getActionsForEntityKind(
  kind: OperationalEntityKind,
): OperationalActionDescriptor[] {
  return [...(REGISTRY[kind] ?? [])];
}

/**
 * Returns the descriptor for a specific (kind, key) pair, or null if not registered.
 * Use the returned `labelKey` with `tChat(lang)(descriptor.labelKey)` for localized labels.
 */
export function getActionDescriptor(
  kind: OperationalEntityKind,
  key: OperationalActionKey,
): OperationalActionDescriptor | null {
  return REGISTRY[kind]?.find(d => d.key === key) ?? null;
}

/** Returns true if the given action key is registered for the entity kind. */
export function isActionAllowedForEntityKind(
  kind: OperationalEntityKind,
  key: OperationalActionKey,
): boolean {
  return REGISTRY[kind]?.some(d => d.key === key) ?? false;
}
