// R-INTEL-PHASE3-ACTION: Action Layer — maps ActionItem → structured payload.
// Pure function, no side effects, no UI. Callers decide how to execute.
import type { ActionItem } from '../types';

export interface ActionPayload {
  type: 'whatsapp' | 'discount' | 'bundle' | 'review' | 'reminder';
  messageKey?: string;
  customerName?: string;
  customerId?: string;
  sku?: string;
  executable: boolean;
  executionTarget:
    | 'whatsapp_url'
    | 'pos_discount'
    | 'pos_bundle'
    | 'review_panel'
    | 'reminder_queue'
    | 'none';
}

export interface ActionContext {
  customerName?: string;
  sku?: string;
}

export function buildActionPayload(
  action: ActionItem,
  context: ActionContext,
): ActionPayload {
  switch (action.actionType) {
    case 'whatsapp':
      return {
        type: 'whatsapp',
        messageKey: action.messageTemplateKey,
        customerName: context.customerName,
        customerId: action.customerId,
        executable: Boolean(action.messageTemplateKey && (action.customerId || context.customerName)),
        executionTarget: 'whatsapp_url',
      };
    case 'discount':
      return {
        type: 'discount',
        sku: action.sku ?? context.sku,
        executable: Boolean(action.sku ?? context.sku),
        executionTarget: 'pos_discount',
      };
    case 'bundle':
      return {
        type: 'bundle',
        sku: action.sku ?? context.sku,
        executable: Boolean(action.sku ?? context.sku),
        executionTarget: 'pos_bundle',
      };
    case 'review':
      return {
        type: 'review',
        executable: true,
        executionTarget: 'review_panel',
      };
    case 'reminder':
      return {
        type: 'reminder',
        customerId: action.customerId,
        customerName: context.customerName,
        executable: Boolean(action.customerId || context.customerName),
        executionTarget: 'reminder_queue',
      };
    default:
      return {
        type: 'review',
        executable: false,
        executionTarget: 'none',
      };
  }
}

export function isExecutableAction(action: ActionItem): boolean {
  return Boolean(action.actionType);
}

export function getExecutionLabel(action: ActionItem): string {
  return action.actionType ?? 'review';
}
