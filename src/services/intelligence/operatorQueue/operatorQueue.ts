// ============================================================
// CellHub Intelligence — Operator Task Queue
// R-INTELLIGENCE-OPERATOR-QUEUE-V1
//
// Lightweight local queue for actionable operator tasks
// (customer outreach, repair follow-ups). Operator chooses
// what enters the queue via "Add to Queue" action cards.
// No auto-population, no cloud sync, no background workers.
// ============================================================

const OPERATOR_QUEUE_KEY  = 'cellhub:intelligence:operatorTaskQueue:v1';
const OUTCOME_LOG_KEY     = 'cellhub:intelligence:operatorTaskOutcomes:v1';
const MAX_ITEMS           = 200;
const MAX_TERMINAL_ITEMS  = 50;   // completed + dismissed kept for reference
const MAX_OUTCOMES        = 500;

export type OperatorTaskType =
  | 'recover_customer'
  | 'vip_outreach'
  | 'product_promotion'
  | 'repair_follow_up'
  | 'repair_escalate'
  | 'repair_waiting';

export interface OperatorQueueItem {
  id: string;
  createdAt: number;          // epoch ms
  type: OperatorTaskType;
  customerName: string;
  phone: string;              // empty string = no phone (WhatsApp button hidden)
  relatedEntityId?: string;   // customerId or repairId for "View" navigation
  summary: string;            // short plain-text header shown in card
  suggestedMessage: string;   // WA draft text
  status: 'pending' | 'completed' | 'dismissed';
  completedAt?: number;
  dismissedAt?: number;
}

export interface OperatorTaskOutcome {
  id: string;
  completedAt: number;
  type: OperatorTaskType;
  entityId?: string;
}

export function readOperatorQueue(): OperatorQueueItem[] {
  try {
    const raw = localStorage.getItem(OPERATOR_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeOperatorQueue(items: OperatorQueueItem[]): void {
  const pending  = items.filter((i) => i.status === 'pending');
  const terminal = items
    .filter((i) => i.status !== 'pending')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_TERMINAL_ITEMS);
  try {
    localStorage.setItem(OPERATOR_QUEUE_KEY, JSON.stringify([...pending, ...terminal]));
  } catch { /* storage quota — best-effort */ }
}

export function addOperatorQueueItem(
  input: Omit<OperatorQueueItem, 'id' | 'createdAt' | 'status'>,
): OperatorQueueItem {
  const now  = Date.now();
  const item: OperatorQueueItem = {
    ...input,
    id: `otq-${now}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    status: 'pending',
  };
  const queue = readOperatorQueue();
  queue.unshift(item);
  if (queue.length > MAX_ITEMS) queue.splice(MAX_ITEMS);
  writeOperatorQueue(queue);
  return item;
}

export function completeOperatorQueueItem(id: string): void {
  const queue = readOperatorQueue();
  const idx   = queue.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const item        = queue[idx];
  const completedAt = Date.now();
  queue[idx]        = { ...item, status: 'completed', completedAt };
  writeOperatorQueue(queue);
  appendOutcome({ id, completedAt, type: item.type, entityId: item.relatedEntityId });
}

export function dismissOperatorQueueItem(id: string): void {
  const queue = readOperatorQueue();
  const idx   = queue.findIndex((i) => i.id === id);
  if (idx < 0) return;
  queue[idx] = { ...queue[idx], status: 'dismissed', dismissedAt: Date.now() };
  writeOperatorQueue(queue);
}

function appendOutcome(outcome: OperatorTaskOutcome): void {
  try {
    const raw = localStorage.getItem(OUTCOME_LOG_KEY);
    const log: OperatorTaskOutcome[] = raw ? JSON.parse(raw) : [];
    log.push(outcome);
    const trimmed = log.length > MAX_OUTCOMES ? log.slice(log.length - MAX_OUTCOMES) : log;
    localStorage.setItem(OUTCOME_LOG_KEY, JSON.stringify(trimmed));
  } catch { /* quota */ }
}
