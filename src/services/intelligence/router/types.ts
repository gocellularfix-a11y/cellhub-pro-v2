// ============================================================
// CellHub Intelligence — Self-Managing Router V1 (SHADOW MODE)
// R-INTEL-ROUTER-V1
//
// Deterministic, side-effect-free classification of HOW Intelligence
// should operate for a given request — BEFORE any insight/brief/action
// is generated. V1 is shadow-only: the route is computed and observed
// (dev console / local ref) but does NOT change existing behavior.
//
// No I/O, no Date.now(), no randomness, no store reads. Same input →
// same route. Safe to call on the hot path (pure string work).
// ============================================================

/** Where the Intelligence request originates. */
export type RouteSource =
  | 'chat'
  | 'brief'
  | 'insight'
  | 'action'
  | 'operator'
  | 'system';

/** Coarse subject area the request is about. */
export type RouteIntent =
  | 'sales'
  | 'reports'
  | 'inventory'
  | 'customer'
  | 'marketing'
  | 'tax'
  | 'dev'
  | 'general';

/** How time-sensitive the request is. */
export type RouteUrgency = 'passive' | 'normal' | 'urgent';

/** How much data the request needs. Never defaults to fullScan. */
export type RouteDataNeed = 'none' | 'snapshot' | 'targeted' | 'fullScan';

/** Compute envelope. Default is always low. */
export type RouteComputeBudget = 'low' | 'medium' | 'high';

/** What the request is allowed to do once routed. */
export type RouteExecutionMode =
  | 'answerOnly'
  | 'suggestAction'
  | 'requireApproval'
  | 'triggerModule';

/** Operational memory access the request needs. */
export type RouteMemoryPolicy = 'none' | 'read' | 'write' | 'readWrite';

/** Hardware capability hint (for fullScan downgrade). */
export type HardwareTier = 'unknown' | 'slow' | 'normal' | 'fast';

/** Input to routeIntelligenceRequest(). All fields optional except source. */
export interface RouteIntelligenceInput {
  source: RouteSource;
  query?: string;
  intentId?: string;
  actionType?: string;
  isSecondary?: boolean;
  hardwareTier?: HardwareTier;
  devMode?: boolean;
  hasApproval?: boolean;
}

/** Deterministic route classification result. */
export interface IntelligenceRoute {
  intent: RouteIntent;
  urgency: RouteUrgency;
  dataNeed: RouteDataNeed;
  computeBudget: RouteComputeBudget;
  executionMode: RouteExecutionMode;
  memoryPolicy: RouteMemoryPolicy;
  safeToRunOnSecondary: boolean;
  /** Stable machine code, e.g. "chat.sales.answerOnly". */
  reasonCode: string;
  /** Human-readable reason — ONLY populated when devMode is true. */
  debugReason?: string;
  /** True when a fullScan was downgraded to targeted (slow/unknown hw). */
  downgradedFromFullScan?: boolean;
  /** Category that forced requireApproval (e.g. "print", "tax_action"). */
  requiresApprovalReason?: string;
}
