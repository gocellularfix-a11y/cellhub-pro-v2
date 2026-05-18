// CellHub Intelligence — Canonical Continuity Types
//
// ─── OWNERSHIP RULES ──────────────────────────────────────────────────────────
//
//  CONCEPT                 OWNER FILE                  TTL       SCOPE
//  ─────────────────────── ─────────────────────────── ───────── ─────────────
//  Active entity           intelligenceContext.ts       30s       module-scoped
//    (repair/customer/                                            (in-memory)
//     inventory/layaway)
//
//  Session entity refs     liveContextStore.ts          session   session-scoped
//    (lastCustomerId,                                             (localStorage)
//     lastRepairId)
//
//  Chat conversation       sessionContext.ts            30m       chat-scoped
//    (lastIntent, chat                                            (localStorage)
//     customer/repair)
//
//  Pending workflows       workflowContinuityStore.ts   30m def   workflow-scoped
//    (external payments)                                          (localStorage)
//
//  Interrupted workflows   continuityEngine.ts          24h       reminder-scoped
//  + dismissed items                                              (localStorage)
//
//  Follow-up items         continuityEngine.ts          4h/1h     reminder-scoped
//    (repair ready, etc.)                                         (localStorage)
//
//  Action execution log    intelligenceExecutionHistory.ts  30d   global
//    (canonical write)                                            (localStorage)
//
//  Operator action log     operatorActionHistory.ts     delegate  wrapper only
//    (compat wrapper)        → executionHistory                   (no own store)
//
//  Live session context    liveContextStore.ts          session   session-scoped
//    (cart, employee,                                             (localStorage)
//     active module)
//
//  Computed suggestions    contextSuggestions.ts        computed  on-demand
//    (max 6 surfaced)                                             (no store)
//
// ─── CONFLICT RESOLUTION ──────────────────────────────────────────────────────
//
//  When multiple systems have different views of "active entity":
//    1. intelligenceContext (fresh < 30s) wins — most intentional, module-scoped
//    2. sessionContext.lastCustomerId (< 30m) — chat conversational fallback
//    3. liveContext.session.lastCustomerId — background session fallback
//
//  DO NOT merge these owners. They have different TTLs and serve different
//  consumers. resolveActiveContext() in continuityHelpers.ts applies this order.
//
// ─── OVERLAPS IDENTIFIED ──────────────────────────────────────────────────────
//
//  1. lastCustomerId tracked in BOTH sessionContext AND liveContext.session
//     → Different TTLs (30m vs. session), different consumers (chat vs. live UI)
//     → Intentional: DO NOT merge. resolveActiveContext() picks the right one.
//
//  2. continuityEngine.workflowTracking vs. workflowContinuityStore
//     → Different domains: continuityEngine tracks interrupted workflows for
//       reminder UI; workflowContinuityStore tracks active external payment
//       workflows for bubble resume cards. Both are needed.
//
//  3. operatorActionHistory vs. intelligenceExecutionHistory
//     → Already resolved: operatorActionHistory delegates to executionHistory.
//       Not a duplication — it's a backward-compat wrapper by design.
//
//  4. deal pipeline vs. proposal followup (in automationQueue.ts)
//     → Both track manual deal management. Potential future consolidation.
//       Out of scope for this round.

// ── Narrow input views (structurally compatible with their source types) ───────
// These allow continuityHelpers.ts to be pure (no I/O imports).

export interface IntelligenceContextInput {
  activeModule?: string;
  activeRepairId?: string;
  activeCustomerId?: string;
  activeLayawayId?: string;
  activeInventoryItemId?: string;
  updatedAt: number;
}

export interface LiveSessionInput {
  lastCustomerId: string | null;
  lastRepairId: string | null;
  lastSearchedPhone: string | null;
  lastCustomerName?: string | null;
}

export interface ChatSessionInput {
  lastIntent: string;
  lastCustomerId?: string;
  lastRepairId?: string;
  timestamp: number;
}

// ── Entity / source enums ─────────────────────────────────────────────────────

export type ContinuityEntityType = 'customer' | 'repair' | 'inventory' | 'layaway';

export type ContinuitySource =
  | 'intelligence_context'
  | 'live_context'
  | 'session_context'
  | 'workflow_continuity'
  | 'continuity_engine';

// ── Core canonical types ──────────────────────────────────────────────────────

/**
 * Unified view of "what is active right now."
 * Produced by resolveActiveContext() — never stored directly.
 */
export interface ContinuityContext {
  /** Winning entity from intelligenceContext (fresh < 30s). */
  activeEntityType?: ContinuityEntityType;
  activeEntityId?: string;
  activeModule?: string;
  /** ms since intelligenceContext was last written. Infinity when stale/missing. */
  entityFreshnessMs: number;
  /** Fallback customer from live session (session-scoped, no TTL). */
  sessionCustomerId?: string | null;
  sessionRepairId?: string | null;
  sessionCustomerName?: string | null;
  /** Last chat intent from sessionContext (30m TTL). Undefined when stale. */
  lastIntent?: string;
  lastChatCustomerId?: string;
  lastChatRepairId?: string;
  /** ms since chatSession entry was written. Infinity when missing/stale. */
  chatContextFreshnessMs: number;
  resolvedAt: number;
}

/** Canonical reference to a pending or interrupted workflow. */
export interface ActiveWorkflow {
  id: string;
  type: string;
  /** resumable = can re-enter; pending = waiting to start; interrupted = timed out but recoverable */
  status: 'pending' | 'interrupted' | 'resumable';
  startedAt: number;
  expiresAt?: number;
  title: string;
  summary?: string;
  navigateTo?: string;
  source: ContinuitySource;
}

/** Canonical reference to a recently-accessed entity. */
export interface RecentEntityReference {
  entityType: ContinuityEntityType;
  entityId: string;
  entityName?: string;
  lastSeenAt: number;
  source: ContinuitySource;
}

/**
 * Full snapshot of continuity state across all systems.
 * Diagnostic use only — execution decisions must use the individual owners.
 * Built by buildContinuitySnapshot() in continuitySnapshot.ts.
 */
export interface ContinuitySnapshot {
  context: ContinuityContext;
  activeWorkflows: ActiveWorkflow[];
  recentEntities: RecentEntityReference[];
  snapshotAt: number;
}
