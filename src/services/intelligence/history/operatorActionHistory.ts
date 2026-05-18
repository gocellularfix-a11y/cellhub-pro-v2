// R-INTELLIGENCE-OPERATOR-ACTION-HISTORY-V1
// Deterministic localStorage log of operator actions executed from Intelligence.
//
// Rules:
// - Pure — no AI, no embeddings, no LLM memory
// - localStorage only, safe JSON parse, no throw
// - Max 250 entries, newest first, prune entries older than 30 days
// - 5-second in-memory cache avoids redundant localStorage reads when
//   buyTodayRanking applies penalties across many candidates in one pass

export type OperatorActionType =
  | 'whatsapp'
  | 'open_customer'
  | 'open_repair'
  | 'dismissed'
  | 'completed'
  | 'ignored';

export interface OperatorActionHistoryEntry {
  id: string;
  actionType: OperatorActionType;
  entityType?: 'customer' | 'repair' | 'product';
  entityId?: string;
  entityName?: string;
  sourceIntent?: string;
  timestamp: number;
}

const STORAGE_KEY = 'cellhub.intelligence.operatorActionHistory.v1';
const MAX_ENTRIES = 250;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const CACHE_TTL_MS = 5_000;                     // 5 seconds

let _cache: OperatorActionHistoryEntry[] | null = null;
let _cacheTime = 0;

function load(): OperatorActionHistoryEntry[] {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { _cache = []; _cacheTime = now; return _cache; }
    const parsed = JSON.parse(raw);
    _cache = Array.isArray(parsed) ? (parsed as OperatorActionHistoryEntry[]) : [];
  } catch {
    _cache = [];
  }
  _cacheTime = now;
  return _cache;
}

function save(entries: OperatorActionHistoryEntry[]): void {
  _cache = entries;
  _cacheTime = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* quota exceeded — silent */ }
}

export function pruneOperatorActionHistory(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  const pruned = load().filter((e) => e.timestamp >= cutoff).slice(0, MAX_ENTRIES);
  save(pruned);
}

export function recordOperatorAction(
  entry: Omit<OperatorActionHistoryEntry, 'id'> & { id?: string },
): void {
  const now = Date.now();
  const id = entry.id || `oah-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const cutoff = now - MAX_AGE_MS;
  const existing = load().filter((e) => e.timestamp >= cutoff);
  save([{ ...entry, id, timestamp: entry.timestamp ?? now }, ...existing].slice(0, MAX_ENTRIES));
}

export function getOperatorActionHistory(): OperatorActionHistoryEntry[] {
  return load();
}

export function getRecentOperatorActions(
  entityId: string,
  withinMs: number,
): OperatorActionHistoryEntry[] {
  if (!entityId) return [];
  const cutoff = Date.now() - withinMs;
  return load().filter((e) => e.entityId === entityId && e.timestamp >= cutoff);
}

export function hasRecentOperatorAction(
  entityId: string,
  actionType: OperatorActionType,
  withinMs: number,
): boolean {
  if (!entityId) return false;
  const cutoff = Date.now() - withinMs;
  return load().some(
    (e) => e.entityId === entityId && e.actionType === actionType && e.timestamp >= cutoff,
  );
}
