// R-INTEL-PHASE3-ACTION: Action Layer — maps ActionItem → structured payload.
// Pure function, no side effects, no UI. Callers decide how to execute.
import type { ActionItem } from '../types';

export interface ActionPayload {
  type: 'whatsapp' | 'discount' | 'bundle' | 'review' | 'reminder';
  messageKey?: string;
  customerName?: string;
  sku?: string;
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
      };
    case 'discount':
      return {
        type: 'discount',
        sku: action.sku ?? context.sku,
      };
    case 'bundle':
      return {
        type: 'bundle',
        sku: action.sku ?? context.sku,
      };
    case 'review':
      return { type: 'review' };
    case 'reminder':
      return { type: 'reminder' };
    default:
      return { type: 'review' };
  }
}
