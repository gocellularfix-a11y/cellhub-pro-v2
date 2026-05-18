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

export function getSessionContext(): ChatSessionEntry | null {
  try {
    const now = Date.now();
    const entries = load();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (now - entries[i].timestamp < TTL_MS) return entries[i];
    }
    return null;
  } catch { return null; }
}

export function clearSessionContext(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
