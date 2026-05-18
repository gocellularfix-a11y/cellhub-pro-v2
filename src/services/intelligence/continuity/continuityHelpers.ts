// CellHub Intelligence — Canonical Continuity Helpers
// Pure deterministic functions. No I/O, no side effects, no localStorage.
// All impure reads happen in continuitySnapshot.ts.

import type {
  ContinuityContext,
  ContinuitySnapshot,
  RecentEntityReference,
  IntelligenceContextInput,
  LiveSessionInput,
  ChatSessionInput,
} from './continuityTypes';

// TTL constants mirror the owning files — kept here for reference only.
// Do NOT change these independently; update the owner file first.
const INTELLIGENCE_CTX_TTL_MS = 30_000;      // intelligenceContext.ts CTX_TTL_MS
const CHAT_SESSION_TTL_MS = 30 * 60_000;     // sessionContext.ts TTL_MS

/**
 * Resolves the canonical "active context" from the three ownership tiers.
 *
 * Resolution order (ownership rules from continuityTypes.ts):
 *   1. intelligenceCtx (freshness < 30s) — most intentional, module-scoped
 *   2. chatSession (< 30m) — conversational fallback for chat-intent context
 *   3. liveSession — background fallback, no TTL, session-scoped
 *
 * Pure — takes plain data, does no I/O.
 */
export function resolveActiveContext(
  intelligenceCtx: IntelligenceContextInput | null,
  liveSession: LiveSessionInput | null,
  chatSession: ChatSessionInput | null,
  now: number = Date.now(),
): ContinuityContext {
  const entityFreshnessMs = intelligenceCtx
    ? Math.max(0, now - intelligenceCtx.updatedAt)
    : Infinity;
  const chatContextFreshnessMs = chatSession
    ? Math.max(0, now - chatSession.timestamp)
    : Infinity;

  const ctxFresh = entityFreshnessMs < INTELLIGENCE_CTX_TTL_MS;
  const chatValid = chatContextFreshnessMs < CHAT_SESSION_TTL_MS;

  // Resolve active entity from intelligenceCtx only when fresh.
  // Priority within intelligenceCtx: repair > customer > layaway > inventory.
  let activeEntityType: ContinuityContext['activeEntityType'];
  let activeEntityId: string | undefined;

  if (ctxFresh && intelligenceCtx) {
    if (intelligenceCtx.activeRepairId) {
      activeEntityType = 'repair';
      activeEntityId = intelligenceCtx.activeRepairId;
    } else if (intelligenceCtx.activeCustomerId) {
      activeEntityType = 'customer';
      activeEntityId = intelligenceCtx.activeCustomerId;
    } else if (intelligenceCtx.activeLayawayId) {
      activeEntityType = 'layaway';
      activeEntityId = intelligenceCtx.activeLayawayId;
    } else if (intelligenceCtx.activeInventoryItemId) {
      activeEntityType = 'inventory';
      activeEntityId = intelligenceCtx.activeInventoryItemId;
    }
  }

  return {
    activeEntityType,
    activeEntityId,
    activeModule: intelligenceCtx?.activeModule,
    entityFreshnessMs,
    sessionCustomerId: liveSession?.lastCustomerId ?? undefined,
    sessionRepairId: liveSession?.lastRepairId ?? undefined,
    sessionCustomerName: liveSession?.lastCustomerName ?? undefined,
    lastIntent: chatValid ? chatSession?.lastIntent : undefined,
    lastChatCustomerId: chatValid ? chatSession?.lastCustomerId : undefined,
    lastChatRepairId: chatValid ? chatSession?.lastRepairId : undefined,
    chatContextFreshnessMs,
    resolvedAt: now,
  };
}

/**
 * Returns true when a recent entity reference is younger than maxAgeMs.
 * Pure — no I/O.
 */
export function validateContinuityEntity(
  ref: RecentEntityReference,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  return now - ref.lastSeenAt < maxAgeMs;
}

/**
 * Prunes expired entries from a snapshot:
 * - recentEntities: removes entries older than maxEntityAgeMs (default 30m)
 * - activeWorkflows: removes workflows past their expiresAt (if set)
 *
 * Returns a new snapshot — does not mutate input.
 */
export function pruneExpiredContext(
  snapshot: ContinuitySnapshot,
  maxEntityAgeMs: number = 30 * 60_000,
  now: number = Date.now(),
): ContinuitySnapshot {
  const recentEntities = snapshot.recentEntities.filter(
    (ref) => validateContinuityEntity(ref, maxEntityAgeMs, now),
  );
  const activeWorkflows = snapshot.activeWorkflows.filter(
    (wf) => wf.expiresAt === undefined || wf.expiresAt > now,
  );
  return { ...snapshot, recentEntities, activeWorkflows };
}

/**
 * Merges two continuity snapshots into one:
 * - context: picks the one with lower entityFreshnessMs (more recent entity)
 * - activeWorkflows: union deduped by id (a wins on conflict)
 * - recentEntities: union deduped by entityType+entityId (keeps most recent lastSeenAt)
 * - snapshotAt: max of both
 *
 * Returns a new snapshot — does not mutate inputs.
 */
export function mergeContinuitySnapshots(
  a: ContinuitySnapshot,
  b: ContinuitySnapshot,
): ContinuitySnapshot {
  const context =
    a.context.entityFreshnessMs <= b.context.entityFreshnessMs
      ? a.context
      : b.context;

  const wfById = new Set(a.activeWorkflows.map((w) => w.id));
  const activeWorkflows = [
    ...a.activeWorkflows,
    ...b.activeWorkflows.filter((w) => !wfById.has(w.id)),
  ];

  const entityMap = new Map<string, RecentEntityReference>();
  for (const ref of [...a.recentEntities, ...b.recentEntities]) {
    const key = `${ref.entityType}:${ref.entityId}`;
    const existing = entityMap.get(key);
    if (!existing || ref.lastSeenAt > existing.lastSeenAt) {
      entityMap.set(key, ref);
    }
  }

  return {
    context,
    activeWorkflows,
    recentEntities: Array.from(entityMap.values()),
    snapshotAt: Math.max(a.snapshotAt, b.snapshotAt),
  };
}
