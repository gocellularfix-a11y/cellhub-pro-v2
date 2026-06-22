// ============================================================
// R-INTELLIGENCE-DECISION-LAYER-F0: canonical IntelligenceDecision contract.
//
// A normalized, deterministic wrapper over the existing Intelligence signal
// generators (LossSignal, DropSignal, AttentionItem, RestockRecommendation,
// DiagnosisCause, ProactiveAction). It is PURELY ADDITIVE — the generators are
// untouched, and nothing in the live app consumes this layer yet.
//
// The top-level fields are the common projection used for ranking/display; the
// `source` discriminated union carries the ORIGINAL signal verbatim so no
// generator-specific field is ever lost (see adapters + IntelligenceDecision.test).
//
// Determinism contract: building a decision from a signal performs only pure
// field mapping + table lookups. No Date.now(), no randomness, no I/O.
// ============================================================

import type { LossSignal } from '@/services/intelligence/chat/whatIsLosingMoney';
import type { DropSignal } from '@/services/intelligence/chat/whyDidSalesDrop';
import type { AttentionItem } from '@/services/intelligence/chat/whoNeedsAttentionToday';
import type { RestockRecommendation } from '@/services/intelligence/chat/restockOpportunity';
import type { DiagnosisCause } from '@/services/intelligence/chat/whyIsTodaySlow';
import type { ProactiveAction } from '@/services/intelligence/proactive/types';
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';

/** Unified business domain a decision belongs to. */
export type DecisionDomain =
  | 'inventory'
  | 'customer'
  | 'repair'
  | 'cash'
  | 'marketing'
  | 'tax'
  | 'ops';

/** Normalized urgency scale (superset-compatible with severity/priority/urgency). */
export type DecisionUrgency = 'critical' | 'high' | 'medium' | 'low';

/**
 * How `confidence` was obtained:
 *  - 'explicit'      → the source signal carried a confidence value (categorical or unit)
 *  - 'from-score'    → derived from the signal's numeric score (signal had no confidence)
 *  - 'from-priority' → derived from a categorical priority (reserved; not used in F1)
 */
export type ConfidenceBasis = 'explicit' | 'from-score' | 'from-priority';

export type DecisionSourceKind =
  | 'loss'
  | 'drop'
  | 'attention'
  | 'restock'
  | 'diagnosis'
  | 'proactive';

/**
 * Original signal, carried verbatim. Guarantees zero information loss: any
 * consumer needing a generator-specific field (e.g. RestockRecommendation
 * daysOfCover, ProactiveAction workflowId) reads it from `source.signal`.
 */
export type DecisionSource =
  | { kind: 'loss'; signal: LossSignal }
  | { kind: 'drop'; signal: DropSignal }
  | { kind: 'attention'; signal: AttentionItem }
  | { kind: 'restock'; signal: RestockRecommendation }
  | { kind: 'diagnosis'; signal: DiagnosisCause }
  | { kind: 'proactive'; signal: ProactiveAction };

/** Normalized pointer to the concrete entity a decision is about (if any). */
export interface DecisionEntityRef {
  /** Native entity kind from the source (e.g. 'product' | 'customer' | 'repair' | 'layaway'). */
  type: string;
  id?: string;
  name?: string;
  phone?: string;
  customerId?: string;
}

/** What to do, plus any pre-built executable UI actions carried by the signal. */
export interface DecisionActionPlan {
  /** Human-readable, already-translated step(s) — from the signal's recommendedAction. */
  steps: string[];
  /** Executable UI actions (may be empty when the signal only carries text). */
  actions: ChatActionUI[];
  /** Continuity workflow id, when the source carries one (ProactiveAction). */
  workflowId?: string;
}

/**
 * Canonical normalized decision. Built by the per-signal adapters in
 * ./adapters and dispatched by ./normalizeDecision.
 */
export interface IntelligenceDecision {
  /** Namespaced + deterministic: `${source.kind}:${signal.id}`. */
  id: string;
  domain: DecisionDomain;
  /** What was observed (source evidence/reason). */
  observation: string;
  /** Why it matters (source headline/title). */
  reasoning: string;
  /** What to do (source recommendedAction — present on every signal type). */
  decision: string;
  /** 0..100. */
  confidence: number;
  confidenceBasis: ConfidenceBasis;
  /** 0..100. */
  score: number;
  /** Dollar impact in cents when the source quantifies one. */
  impactCents?: number;
  urgency: DecisionUrgency;
  entityRef?: DecisionEntityRef;
  actionPlan: DecisionActionPlan;
  /** True when the decision surfaces owner-only margin/cost figures (redaction hint; tuned in a later phase). */
  financialSensitive: boolean;
  /** True when no side-effecting action would run; safe to auto-surface on a secondary terminal. */
  safeToRunOnSecondary: boolean;
  source: DecisionSource;
}
