// R-INTEL-PHASE3.2-EXEC: Action Executor — converts ActionPayload into safe
// execution instructions. No state mutation, no automatic sends, no POS changes.
// Callers receive a structured result and decide what to do with it.
import type { ActionPayload } from './actionEngine';

export type ExecutionResult =
  | { ok: true;  type: 'whatsapp_url';    url: string }
  | { ok: true;  type: 'pos_discount';    sku: string }
  | { ok: true;  type: 'pos_bundle';      sku: string }
  | { ok: true;  type: 'review_panel' }
  | { ok: true;  type: 'reminder_queue';  customerId?: string; customerName?: string }
  | { ok: false; reason: 'not_executable' | 'missing_customer' | 'missing_sku' | 'missing_template' };

function buildMessage(messageKey: string, customerName?: string): string {
  switch (messageKey) {
    case 'whatsapp.template.reconnect':
      return `Hi ${customerName ?? 'there'}, we wanted to check in and see if you need anything from Go Cellular.`;
    case 'whatsapp.template.discount':
      return `Hi ${customerName ?? 'there'}, we have a special offer available for you at Go Cellular.`;
    default:
      return `Hi ${customerName ?? 'there'}, Go Cellular wanted to follow up with you.`;
  }
}

export function executeActionPayload(payload: ActionPayload): ExecutionResult {
  switch (payload.executionTarget) {
    case 'whatsapp_url': {
      if (!payload.messageKey) {
        return { ok: false, reason: 'missing_template' };
      }
      if (!payload.customerName && !payload.customerId) {
        return { ok: false, reason: 'missing_customer' };
      }
      const text = buildMessage(payload.messageKey, payload.customerName);
      const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
      return { ok: true, type: 'whatsapp_url', url };
    }

    case 'pos_discount': {
      if (!payload.sku) {
        return { ok: false, reason: 'missing_sku' };
      }
      return { ok: true, type: 'pos_discount', sku: payload.sku };
    }

    case 'pos_bundle': {
      if (!payload.sku) {
        return { ok: false, reason: 'missing_sku' };
      }
      return { ok: true, type: 'pos_bundle', sku: payload.sku };
    }

    case 'review_panel':
      return { ok: true, type: 'review_panel' };

    case 'reminder_queue': {
      if (!payload.customerId && !payload.customerName) {
        return { ok: false, reason: 'missing_customer' };
      }
      return {
        ok: true,
        type: 'reminder_queue',
        customerId: payload.customerId,
        customerName: payload.customerName,
      };
    }

    case 'none':
    default:
      return { ok: false, reason: 'not_executable' };
  }
}
