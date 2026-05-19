// INTELLIGENCE-OPERATIONAL-EXECUTION-REGISTRY-V1
// Centralized registry of operational execution actions.
// Delegates to existing executeActionPayload — no new event dispatch logic.
// NO UI logic. NO React imports. Pure operational execution mapping.

import type { OperationalExecutionAction, ExecutionPayload, OperationalExecutionResult } from './types';
import { executeActionPayload } from '../actions/actionExecutor';
import { toActionPayload } from './executionResolver';

export interface ExecutionHandlerDescriptor {
  action: OperationalExecutionAction;
  requiresEntityId: boolean;
  requiresPhone: boolean;
  requiresProductId: boolean;
  targetModule: string;
  labelEn: string;
  labelEs: string;
}

export const EXECUTION_REGISTRY: ExecutionHandlerDescriptor[] = [
  {
    action: 'open_repair',
    requiresEntityId: true, requiresPhone: false, requiresProductId: false,
    targetModule: 'repairs',
    labelEn: 'Open Ticket', labelEs: 'Ver Ticket',
  },
  {
    action: 'open_customer',
    requiresEntityId: true, requiresPhone: false, requiresProductId: false,
    targetModule: 'customers',
    labelEn: 'View Customer', labelEs: 'Ver Cliente',
  },
  {
    action: 'open_layaway',
    requiresEntityId: true, requiresPhone: false, requiresProductId: false,
    targetModule: 'layaways',
    labelEn: 'View Layaway', labelEs: 'Ver Layaway',
  },
  {
    action: 'open_unlock',
    requiresEntityId: true, requiresPhone: false, requiresProductId: false,
    targetModule: 'unlocks',
    labelEn: 'View Unlock', labelEs: 'Ver Unlock',
  },
  {
    action: 'open_special_order',
    requiresEntityId: true, requiresPhone: false, requiresProductId: false,
    targetModule: 'special_orders',
    labelEn: 'View Order', labelEs: 'Ver Orden',
  },
  {
    action: 'open_inventory',
    requiresEntityId: true, requiresPhone: false, requiresProductId: false,
    targetModule: 'inventory',
    labelEn: 'View in Inventory', labelEs: 'Ver en Inventario',
  },
  {
    action: 'whatsapp_url',
    requiresEntityId: false, requiresPhone: true, requiresProductId: false,
    targetModule: 'whatsapp',
    labelEn: 'WhatsApp', labelEs: 'WhatsApp',
  },
  {
    action: 'promote_product',
    requiresEntityId: false, requiresPhone: false, requiresProductId: true,
    targetModule: 'promote',
    labelEn: 'Promote', labelEs: 'Promover',
  },
  {
    action: 'collect_payment',
    requiresEntityId: true, requiresPhone: false, requiresProductId: false,
    targetModule: 'pos',
    labelEn: 'Collect Payment', labelEs: 'Cobrar',
  },
  {
    action: 'mark_ready',
    requiresEntityId: true, requiresPhone: false, requiresProductId: false,
    targetModule: 'repairs',
    labelEn: 'Mark Ready', labelEs: 'Marcar Listo',
  },
];

export function getExecutionDescriptor(
  action: OperationalExecutionAction,
): ExecutionHandlerDescriptor | undefined {
  return EXECUTION_REGISTRY.find(d => d.action === action);
}

/**
 * Execute an operational action through the centralized registry.
 * Validates required fields, then delegates to executeActionPayload.
 * Returns a normalized OperationalExecutionResult.
 */
export function executeOperationalAction(
  payload: ExecutionPayload,
): OperationalExecutionResult {
  const descriptor = getExecutionDescriptor(payload.action);
  if (!descriptor) {
    return { ok: false, action: payload.action, reason: 'unknown_action' };
  }

  if (descriptor.requiresEntityId && !payload.entityId) {
    return { ok: false, action: payload.action, reason: 'entityId_required' };
  }
  if (descriptor.requiresPhone && !payload.customerPhone) {
    return { ok: false, action: payload.action, reason: 'customerPhone_required' };
  }
  if (descriptor.requiresProductId && !payload.productId) {
    return { ok: false, action: payload.action, reason: 'productId_required' };
  }

  const actionPayload = toActionPayload(payload);
  const result = executeActionPayload(actionPayload);

  return {
    ok: result.ok,
    action: payload.action,
    reason: result.ok ? undefined : result.reason,
  };
}
