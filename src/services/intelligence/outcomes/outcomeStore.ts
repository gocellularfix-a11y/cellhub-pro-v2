import type { IntelligenceOutcome, OutcomeResult } from './outcomeTypes';

function generateOutcomeId(): string {
  return `oc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const OUTCOMES_KEY = 'cellhub:intelligence:outcomes:v1';
const MAX_RECORDS   = 300;
const PRUNE_AGE_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days

function load(): IntelligenceOutcome[] {
  try {
    const raw = localStorage.getItem(OUTCOMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IntelligenceOutcome[]) : [];
  } catch {
    return [];
  }
}

function save(records: IntelligenceOutcome[]): void {
  try { localStorage.setItem(OUTCOMES_KEY, JSON.stringify(records)); } catch { /* silent */ }
}

function pruneAndCap(records: IntelligenceOutcome[]): IntelligenceOutcome[] {
  const cutoff = Date.now() - PRUNE_AGE_MS;
  const fresh = records.filter((r) => r.createdAt > cutoff);
  if (fresh.length <= MAX_RECORDS) return fresh;
  return fresh.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RECORDS);
}

// ── Write helpers ─────────────────────────────────────────────────────────────

export function recordOutcome(data: Omit<IntelligenceOutcome, 'id' | 'createdAt'>): string {
  const now = Date.now();
  const id = generateOutcomeId();
  const record: IntelligenceOutcome = {
    ...data,
    id,
    createdAt: now,
    completedAt: (data.outcome === 'completed' || data.outcome === 'recovered')
      ? (data.completedAt ?? now)
      : data.completedAt,
  };
  save(pruneAndCap([...load(), record]));
  return id;
}

export function updateOutcome(id: string, updates: Partial<IntelligenceOutcome>): void {
  save(load().map((r) => (r.id === id ? { ...r, ...updates } : r)));
}

export function markOutcomeCompleted(id: string): void {
  updateOutcome(id, { outcome: 'completed' as OutcomeResult, completedAt: Date.now() });
}

export function markOutcomeSkipped(id: string): void {
  updateOutcome(id, { outcome: 'skipped' as OutcomeResult });
}

export function markOutcomeDismissed(id: string): void {
  updateOutcome(id, { outcome: 'dismissed' as OutcomeResult });
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export function getRecentOutcomes(maxAgeMs = PRUNE_AGE_MS): IntelligenceOutcome[] {
  const cutoff = Date.now() - maxAgeMs;
  return load().filter((r) => r.createdAt > cutoff);
}

export function getOutcomesBySource(sourceId: string): IntelligenceOutcome[] {
  return load().filter((r) => r.sourceId === sourceId);
}
