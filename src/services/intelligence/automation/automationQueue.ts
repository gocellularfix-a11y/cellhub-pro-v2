// R-INTEL-PHASE4.0-QUEUE: Automation Queue Foundation
// Pure data layer — no storage, no execution, no side effects.
// Callers own persistence and execution decisions.

export type AutomationStatus =
  | 'pending'
  | 'approved'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type AutomationKind =
  | 'whatsapp_reconnect'
  | 'discount_review'
  | 'bundle_review'
  | 'reminder_followup'
  | 'manual_review';

export interface AutomationQueueItem {
  id: string;
  kind: AutomationKind;
  status: AutomationStatus;

  label: string;
  source: 'intelligence';

  customerId?: string;
  customerName?: string;
  sku?: string;

  createdAt: string;
  approvedAt?: string;
  completedAt?: string;

  payload?: Record<string, unknown>;
}

export function createAutomationItem(input: {
  kind: AutomationKind;
  label: string;
  customerId?: string;
  customerName?: string;
  sku?: string;
  payload?: Record<string, unknown>;
}): AutomationQueueItem {
  return {
    id: `auto-${input.kind}-${Date.now()}`,
    kind: input.kind,
    status: 'pending',
    label: input.label,
    source: 'intelligence',
    customerId: input.customerId,
    customerName: input.customerName,
    sku: input.sku,
    createdAt: new Date().toISOString(),
    payload: input.payload,
  };
}

export function approveAutomationItem(item: AutomationQueueItem): AutomationQueueItem {
  return { ...item, status: 'approved', approvedAt: new Date().toISOString() };
}

export function completeAutomationItem(item: AutomationQueueItem): AutomationQueueItem {
  return { ...item, status: 'completed', completedAt: new Date().toISOString() };
}

export function cancelAutomationItem(item: AutomationQueueItem): AutomationQueueItem {
  return { ...item, status: 'cancelled' };
}

export function failAutomationItem(item: AutomationQueueItem): AutomationQueueItem {
  return { ...item, status: 'failed' };
}
