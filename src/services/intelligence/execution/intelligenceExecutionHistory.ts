// R-INTELLIGENCE-UNIFY-EXECUTION-LOGS-V1
// Single canonical log for all executed Intelligence actions.
//
// Replaces the three disconnected logs:
//   - operatorActionHistory.ts  (suppression)
//   - actionExecutionQueue.ts   (bubble tracking)
//   - actionExecutor.ts         (revenue attribution — old log preserved for getActionImpact)
//
// Rules:
// - Pure — no AI, no embeddings, no mutations beyond localStorage
// - Safe JSON parse, corrupt storage returns [], never throws
// - Max 500 entries, newest first, 30-day TTL
// - 5-second in-memory cache — safe to call in tight scoring loops

export type IntelligenceExecutionType =
  | 'whatsapp'
  | 'open_customer'
  | 'open_repair'
  | 'open_product'
  | 'open_layaway'
  | 'open_unlock'
  | 'open_special_order'
  | 'queue_approved'
  | 'queue_rejected'
  | 'dismissed'
  | 'completed'
  | 'ignored'
  | 'bubble_navigation';

export interface IntelligenceExecutionHistoryEntry {
  id: string;
  type: IntelligenceExecutionType;
  entityType?: 'customer' | 'repair' | 'product' | 'layaway' | 'unlock' | 'special_order' | 'queue_item' | 'workflow';
  entityId?: string;
  entityName?: string;
  sourceIntent?: string;
  sourceModule?: string;
  payloadSummary?: string;
  timestamp: number;
}

const STORAGE_KEY = 'cellhub.intelligence.executionHistory.v1';
const MAX_ENTRIES = 500;
const MAX_AGE_MS  = 30 * 24 * 60 * 60 * 1000;  // 30 days
const CACHE_TTL_MS = 5_000;                      // 5 seconds

let _cache: IntelligenceExecutionHistoryEntry[] | null = null;
let _cacheTime = 0;

function load(): IntelligenceExecutionHistoryEntry[] {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { _cache = []; _cacheTime = now; return _cache; }
    const parsed = JSON.parse(raw);
    _cache = Array.isArray(parsed) ? (parsed as IntelligenceExecutionHistoryEntry[]) : [];
  } catch {
    _cache = [];
  }
  _cacheTime = now;
  return _cache;
}

function save(entries: IntelligenceExecutionHistoryEntry[]): void {
  _cache = entries;
  _cacheTime = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* quota exceeded — silent */ }
}

export function pruneIntelligenceExecutionHistory(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  save(load().filter((e) => e.timestamp >= cutoff).slice(0, MAX_ENTRIES));
}

export function recordIntelligenceExecution(
  entry: Omit<IntelligenceExecutionHistoryEntry, 'id'> & { id?: string },
): void {
  const now = Date.now();
  const id = entry.id
    || `ieh-${entry.type}-${entry.entityId ?? 'na'}-${now}`;
  const cutoff = now - MAX_AGE_MS;
  const existing = load().filter((e) => e.timestamp >= cutoff);
  save([{ ...entry, id, timestamp: entry.timestamp ?? now }, ...existing].slice(0, MAX_ENTRIES));
}

export function getIntelligenceExecutionHistory(): IntelligenceExecutionHistoryEntry[] {
  return load();
}

export function getRecentIntelligenceExecutions(
  entityId: string,
  withinMs: number,
): IntelligenceExecutionHistoryEntry[] {
  if (!entityId) return [];
  const cutoff = Date.now() - withinMs;
  return load().filter((e) => e.entityId === entityId && e.timestamp >= cutoff);
}

export function hasRecentIntelligenceExecution(
  entityId: string,
  type: IntelligenceExecutionType,
  withinMs: number,
): boolean {
  if (!entityId) return false;
  const cutoff = Date.now() - withinMs;
  return load().some(
    (e) => e.entityId === entityId && e.type === type && e.timestamp >= cutoff,
  );
}
