// R-INTELLIGENCE-SESSION-CONTEXT-V1
// Lightweight conversational memory for Intelligence chat.
// localStorage, deterministic only, no AI, no embeddings.
// Max 10 entries, 30-minute TTL. Resets on corrupt data.

const STORAGE_KEY = 'cellhub:intelligence:sessionCtx:v1';
const MAX_ENTRIES = 10;
const TTL_MS = 30 * 60 * 1000;

export interface ChatSessionEntry {
  lastIntent: string;
  lastCustomerId?: string;
  lastCustomerName?: string;
  lastRepairId?: string;
  lastSuggestedProducts?: string[];
  lastRecommendationType?: string;
  lastActionContext?: string;
  timestamp: number;
}

function load(): ChatSessionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatSessionEntry[]) : [];
  } catch { return []; }
}

function save(entries: ChatSessionEntry[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota/incognito */ }
}

export function pushSessionContext(entry: Omit<ChatSessionEntry, 'timestamp'>): void {
  const now = Date.now();
  const fresh = load().filter((e) => now - e.timestamp < TTL_MS);
  save([...fresh, { ...entry, timestamp: now }].slice(-MAX_ENTRIES));
}

// R-INTELLIGENCE-STABILIZE-1 T1: pure TTL predicate, exported for tests and
// for the follow-up TTL guard in handlers.ts to share one definition.
export function isSessionEntryExpired(timestamp: number, now: number = Date.now()): boolean {
  return now - timestamp >= TTL_MS;
}

export function getSessionContext(): ChatSessionEntry | null {
  try {
    const now = Date.now();
    const entries = load();
    if (entries.length === 0) return null;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!isSessionEntryExpired(entries[i].timestamp, now)) return entries[i];
    }
    // R-INTELLIGENCE-STABILIZE-1 T1: every stored entry is past TTL. Actively
    // purge the stale blob (it was lingering in localStorage and could be
    // re-read after a clock change) instead of silently returning null, and
    // emit the spec'd diagnostics so stale-context downgrades are traceable.
    console.warn('[IntelligenceContext] expired');
    clearSessionContext();
    console.warn('[IntelligenceContext] cleared stale context');
    return null;
  } catch { return null; }
}

export function clearSessionContext(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
