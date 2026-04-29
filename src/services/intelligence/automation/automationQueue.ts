// R-INTEL-PHASE4.0-QUEUE: Automation Queue Foundation
// Pure data layer — no storage, no execution, no side effects.
// Callers own persistence and execution decisions.

import type { ActionPayload } from '../actions/actionEngine';

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

export interface AutomationExecutionLog {
  executedAt: string;
  result: 'success' | 'failed';
  resultType?: string;
  reason?: string;
}

export type AutomationOutcome =
  | 'unknown'
  | 'customer_responded'
  | 'sale_created'
  | 'no_response'
  | 'not_relevant';

export interface AutomationOutcomeLog {
  recordedAt: string;
  outcome: AutomationOutcome;
  note?: string;
}

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

  payload?: {
    actionPayload?: ActionPayload;
    [key: string]: unknown;
  };

  executionLog?: AutomationExecutionLog[];
  outcomeLog?: AutomationOutcomeLog[];
}

export function createAutomationItem(input: {
  kind: AutomationKind;
  label: string;
  customerId?: string;
  customerName?: string;
  sku?: string;
  payload?: { actionPayload?: ActionPayload; [key: string]: unknown };
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

export function addAutomationExecutionLog(
  item: AutomationQueueItem,
  log: AutomationExecutionLog,
): AutomationQueueItem {
  return { ...item, executionLog: [...(item.executionLog ?? []), log] };
}

export function markAutomationExecuted(
  item: AutomationQueueItem,
  resultType: string,
): AutomationQueueItem {
  return completeAutomationItem(
    addAutomationExecutionLog(item, {
      executedAt: new Date().toISOString(),
      result: 'success',
      resultType,
    }),
  );
}

export function markAutomationFailed(
  item: AutomationQueueItem,
  reason: string,
): AutomationQueueItem {
  return failAutomationItem(
    addAutomationExecutionLog(item, {
      executedAt: new Date().toISOString(),
      result: 'failed',
      reason,
    }),
  );
}

export function addAutomationOutcome(
  item: AutomationQueueItem,
  outcome: AutomationOutcome,
  note?: string,
): AutomationQueueItem {
  return {
    ...item,
    outcomeLog: [
      ...(item.outcomeLog ?? []),
      { recordedAt: new Date().toISOString(), outcome, note },
    ],
  };
}
