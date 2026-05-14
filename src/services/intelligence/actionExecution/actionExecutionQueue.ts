// CellHub Intelligence — Bubble Action Execution Queue
// Lightweight localStorage log for bubble-level navigation/workflow executions.
// Distinct from the outreach queue (intelligence/actions.ts) which tracks WhatsApp sends.
// Best-effort: quota failures are swallowed — never blocks execution paths.

const EXEC_LOG_KEY = 'cellhub:intelligence:bubbleExecLog:v1';
const MAX_ENTRIES = 200;

export interface BubbleExecLogItem {
  id: string;
  actionId: string;
  suggestionId?: string;
  customerId?: string | null;
  executedAt: number;
}

function readLog(): BubbleExecLogItem[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(EXEC_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BubbleExecLogItem[]) : [];
  } catch {
    return [];
  }
}

function writeLog(items: BubbleExecLogItem[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(EXEC_LOG_KEY, JSON.stringify(items));
  } catch { /* quota or serialization failure — non-fatal */ }
}

/** Append one execution log entry. Caps log at MAX_ENTRIES (FIFO). */
export function logBubbleAction(
  actionId: string,
  customerId?: string | null,
  suggestionId?: string,
): void {
  const log = readLog();
  log.push({
    id: `${actionId}-${Date.now()}`,
    actionId,
    suggestionId,
    customerId,
    executedAt: Date.now(),
  });
  const trimmed = log.length > MAX_ENTRIES ? log.slice(log.length - MAX_ENTRIES) : log;
  writeLog(trimmed);
}

/** Most-recent N entries in descending time order. */
export function getRecentBubbleActions(limit = 20): BubbleExecLogItem[] {
  return readLog().slice(-limit).reverse();
}

/** Count executions of a specific actionId in the last N milliseconds. */
export function countRecentActionById(actionId: string, windowMs = 86_400_000): number {
  const cutoff = Date.now() - windowMs;
  return readLog().filter((e) => e.actionId === actionId && e.executedAt >= cutoff).length;
}
