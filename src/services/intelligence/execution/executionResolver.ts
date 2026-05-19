// INTELLIGENCE-OPERATIONAL-EXECUTION-REGISTRY-V1
// Compatibility layer between old ActionPayload (executionTarget-based) and the
// new normalized ExecutionPayload. Also converts ResolvedEntity → ExecutionPayload
// so entity command builders have no raw executionTarget string assumptions.

import type { OperationalExecutionAction, ExecutionPayload } from './types';
import type { ActionPayload } from '../actions/actionEngine';
import type { ResolvedEntity, EntityAction } from '../entityAccess/types';

// ── Old → New ─────────────────────────────────────────────────────────────────

const TARGET_TO_ACTION: Partial<Record<ActionPayload['executionTarget'], OperationalExecutionAction>> = {
  'open_repair':        'open_repair',
  'open_customer':      'open_customer',
  'open_layaway':       'open_layaway',
  'open_unlock':        'open_unlock',
  'open_special_order': 'open_special_order',
  'open_inventory':     'open_inventory',
  'whatsapp_url':       'whatsapp_url',
  'open_promote_panel': 'promote_product',
};

/**
 * Convert an existing ActionPayload to a normalized ExecutionPayload.
 * Returns null for targets with no operational equivalent (pos_discount,
 * review_panel, none, etc.) — callers skip those gracefully.
 */
export function resolveExecutionPayload(chatPayload: ActionPayload): ExecutionPayload | null {
  const action = TARGET_TO_ACTION[chatPayload.executionTarget];
  if (!action) return null;
  return {
    action,
    entityId:      chatPayload.entityId,
    customerName:  chatPayload.customerName,
    customerPhone: chatPayload.customerPhone,
    productId:     chatPayload.productId,
    productName:   chatPayload.productName,
  };
}

// ── New → Old ─────────────────────────────────────────────────────────────────

/**
 * Convert a normalized ExecutionPayload to an ActionPayload for compatibility
 * with existing ChatActionUI consumers. Uses only existing executionTarget values.
 */
export function toActionPayload(ep: ExecutionPayload): ActionPayload {
  switch (ep.action) {
    case 'whatsapp_url':
      return {
        type: 'whatsapp',
        executable: !!(ep.customerPhone?.replace(/\D/g, '').length),
        executionTarget: 'whatsapp_url',
        customerPhone: ep.customerPhone,
        customerName:  ep.customerName,
      };

    case 'promote_product':
      return {
        type: 'operator_action',
        executable: !!(ep.productId),
        executionTarget: 'open_promote_panel',
        productId:   ep.productId,
        productName: ep.productName,
      };

    case 'collect_payment':
    case 'mark_ready':
      // v1 stub: navigate to entity so operator can act from there.
      // Future: dedicated POS collect-balance / repair-status shortcuts.
      return {
        type: 'operator_action',
        executable: !!(ep.entityId),
        executionTarget: ep.entityId ? 'open_repair' : 'none',
        entityId:     ep.entityId,
        customerName: ep.customerName,
      };

    default:
      // All remaining open_* actions map 1:1 to their executionTarget equivalent.
      return {
        type: 'operator_action',
        executable: !!(ep.entityId),
        executionTarget: ep.action as ActionPayload['executionTarget'],
        entityId:     ep.entityId,
        customerName: ep.customerName,
        productId:    ep.productId,
        productName:  ep.productName,
      };
  }
}

// ── Entity → ExecutionPayload ─────────────────────────────────────────────────

/**
 * Convert a ResolvedEntity (+ optional verb intent) to an ExecutionPayload.
 * Used by entity command builders so they have no raw executionTarget strings.
 */
export function entityKindToExecutionPayload(
  entity: ResolvedEntity,
  overrideAction?: EntityAction,
): ExecutionPayload | null {
  // Verb overrides take precedence over the default kind mapping.
  if (overrideAction === 'whatsapp' || overrideAction === 'call') {
    const raw = entity.raw as Record<string, unknown>;
    const phone = String(
      (raw.customerPhone ?? raw.phone ?? (raw.phones as string[] | undefined)?.[0] ?? ''),
    );
    if (!phone.replace(/\D/g, '').length) return null;
    return { action: 'whatsapp_url', customerPhone: phone, customerName: entity.title };
  }

  if (overrideAction === 'promote' && entity.kind === 'inventory_product') {
    return { action: 'promote_product', productId: entity.id, productName: entity.title };
  }

  if (overrideAction === 'collect_payment') {
    return { action: 'collect_payment', entityId: entity.id, customerName: entity.title };
  }

  if (overrideAction === 'mark_ready') {
    return { action: 'mark_ready', entityId: entity.id, customerName: entity.title };
  }

  // Default: kind → canonical open action.
  switch (entity.kind) {
    case 'repair':            return { action: 'open_repair',        entityId: entity.id, customerName: entity.title };
    case 'customer':          return { action: 'open_customer',      entityId: entity.id, customerName: entity.title };
    case 'layaway':           return { action: 'open_layaway',       entityId: entity.id };
    case 'unlock':            return { action: 'open_unlock',        entityId: entity.id };
    case 'special_order':     return { action: 'open_special_order', entityId: entity.id };
    case 'inventory_product': return { action: 'open_inventory',     entityId: entity.id, productName: entity.title };
    default:                  return null; // sale, invoice, phone_payment, employee — no nav target
  }
}
