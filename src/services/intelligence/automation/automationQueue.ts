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
  | 'manual_review'
  // R-INTELLIGENCE-PENDING-DEAL-V1: owner-mediated deal draft. Approval opens
  // WhatsApp with the deal's offer text; outcome marked manually by owner.
  | 'pending_deal';

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

// R-INTELLIGENCE-DEAL-OUTCOME-TRACKING-V1 ─────────────────────
// Owner-recorded outcome for a pending_deal after WhatsApp outreach.
// Pure read/write helpers around localStorage — no UI, no engine wiring,
// no automatic learning. Mirrors the executionLog pattern in
// actionExecutor.ts (FIFO cap, best-effort writes, never blocks).

export type DealOutcome = 'won' | 'lost' | 'no_response';

export interface DealOutcomeLogEntry {
  id: string;
  dealId: string;
  customerId?: string;
  inventoryId?: string;
  category?: string;
  proposedPriceCents: number;
  originalPriceCents: number;
  outcome: DealOutcome;
  timestamp: number;
}

const DEAL_OUTCOME_LOG_KEY = 'cellhub:intelligence:dealOutcomeLog:v1';
const MAX_DEAL_OUTCOME_LOG = 500;

export function getDealOutcomeLog(): DealOutcomeLogEntry[] {
  try {
    const raw = localStorage.getItem(DEAL_OUTCOME_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addDealOutcomeLog(entry: DealOutcomeLogEntry): void {
  try {
    const log = getDealOutcomeLog();
    log.push(entry);
    // FIFO cap — drop oldest entries if exceeding MAX. Same shape as
    // executionLog so unbounded outcome history doesn't bloat storage.
    const trimmed = log.length > MAX_DEAL_OUTCOME_LOG
      ? log.slice(log.length - MAX_DEAL_OUTCOME_LOG)
      : log;
    localStorage.setItem(DEAL_OUTCOME_LOG_KEY, JSON.stringify(trimmed));
  } catch {
    /* incognito / quota — best-effort, never block */
  }
}
