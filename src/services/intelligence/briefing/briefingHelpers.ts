// CellHub Intelligence — Canonical Briefing Helpers
// Pure deterministic functions. No I/O, no side effects, no localStorage.
// Adapters for existing systems live in their own source files to avoid
// circular imports (e.g. dailyBriefing.ts adapts its own BriefingItem).

import type {
  BriefItem,
  BriefPriority,
  BriefSeverity,
  BriefSource,
  BriefItemCategory,
} from './briefingTypes';

// ── Severity → priority ───────────────────────────────────────────────────────

const SEVERITY_PRIORITY_MAP: Record<BriefSeverity, number> = {
  critical: 90,
  high:     70,
  medium:   50,
  low:      30,
  info:     10,
};

/** Maps a BriefSeverity to the canonical 0–100 priority scale. */
export function severityToPriority(severity: BriefSeverity): number {
  return SEVERITY_PRIORITY_MAP[severity] ?? 10;
}

/**
 * Maps a numeric priority (0–100) back to the closest BriefSeverity bucket.
 * Useful when adapting systems that use numeric scoring (e.g. revenueEngine).
 */
export function priorityToSeverity(priority: number): BriefSeverity {
  if (priority >= 80) return 'critical';
  if (priority >= 60) return 'high';
  if (priority >= 40) return 'medium';
  if (priority >= 20) return 'low';
  return 'info';
}

// ── ID normalization ──────────────────────────────────────────────────────────

/**
 * Produces a stable, deterministic BriefItem ID.
 * Format: `brief:{source}:{category}:{entityId|global}`
 */
export function normalizeBriefItemId(
  source: BriefSource,
  category: BriefItemCategory,
  entityId?: string,
): string {
  return `brief:${source}:${category}:${entityId ?? 'global'}`;
}

// ── Item construction ─────────────────────────────────────────────────────────

/**
 * Fills in default values for a partially-specified BriefItem.
 * title, source, and category are required; everything else has defaults.
 */
export function normalizeBriefItem(
  partial: Omit<BriefItem, 'id' | 'priority' | 'severity' | 'detectedAt'> & {
    severity?: BriefSeverity;
    priority?: number;
    id?: string;
    detectedAt?: number;
  },
): BriefItem {
  const severity = partial.severity ?? 'info';
  const priority = partial.priority ?? severityToPriority(severity);
  const id = partial.id ?? normalizeBriefItemId(partial.source, partial.category, partial.entityId);
  return {
    ...partial,
    id,
    severity,
    priority,
    detectedAt: partial.detectedAt ?? Date.now(),
  };
}

// ── Deduplication ─────────────────────────────────────────────────────────────

// Dedup key: same category + entityId = same real-world signal regardless of source.
// Global items (no entityId) dedup by category alone.
function dedupeKey(item: BriefItem): string {
  return `${item.category}:${item.entityId ?? 'global'}`;
}

/**
 * Removes duplicate BriefItems by semantic identity (category + entityId).
 * When duplicates exist, keeps the entry with the highest priority.
 * Input order does not affect which duplicate wins — priority does.
 */
export function dedupeBriefItems(items: BriefItem[]): BriefItem[] {
  const best = new Map<string, BriefItem>();
  for (const item of items) {
    const key = dedupeKey(item);
    const existing = best.get(key);
    if (!existing || item.priority > existing.priority) {
      best.set(key, item);
    }
  }
  return Array.from(best.values());
}

// ── Sorting ───────────────────────────────────────────────────────────────────

/**
 * Sorts BriefItems by priority descending, then detectedAt descending.
 * Returns a new array — does not mutate input.
 */
export function sortBriefItems(items: BriefItem[]): BriefItem[] {
  return items.slice().sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.detectedAt - a.detectedAt;
  });
}

// ── Limiting ──────────────────────────────────────────────────────────────────

/**
 * Returns the top N items. Combine with sortBriefItems first:
 *   limitBriefItems(sortBriefItems(items), 5)
 */
export function limitBriefItems(items: BriefItem[], n: number): BriefItem[] {
  return items.slice(0, n);
}

// ── Grouping ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: BriefSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * Groups BriefItems into BriefPriority tiers by severity.
 * Returns tiers in descending severity order (critical first), empty tiers omitted.
 */
export function groupByPriority(items: BriefItem[]): BriefPriority[] {
  const byTier = new Map<BriefSeverity, BriefItem[]>();
  for (const item of items) {
    const arr = byTier.get(item.severity);
    if (arr) arr.push(item);
    else byTier.set(item.severity, [item]);
  }
  const result: BriefPriority[] = [];
  for (const sev of SEVERITY_ORDER) {
    const tier = byTier.get(sev);
    if (tier && tier.length > 0) {
      result.push({
        severity: sev,
        priority: severityToPriority(sev),
        items: sortBriefItems(tier),
      });
    }
  }
  return result;
}
