// CellHub Intelligence — Employee Ops Types
// Pure TypeScript types — no React, no DOM, no I/O.
// Operational assistance only — not surveillance, not punishment.

import type { Repair, Layaway, Sale, Customer, InventoryItem } from '@/store/types';
import type { LiveAction } from '@/services/intelligence/liveContext/contextTypes';
import type { PendingWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';
import type { RevenueOpportunity } from '@/services/intelligence/revenueOpportunities/revenueOpportunityTypes';
import type { StoreRhythmSnapshot } from '@/services/intelligence/storeRhythm/storeRhythmTypes';
import type { OperationalReasoningConclusion } from '@/services/intelligence/reasoning/reasoningTypes';
import type { BusinessStrategyFocus } from '@/services/intelligence/businessStrategy/businessStrategyTypes';

// ── Operational signal ────────────────────────────────────────────────────────

export type OperationalSignalKind =
  | 'discount_anomaly'
  | 'workflow_abandonment'
  | 'repair_bottleneck'
  | 'inventory_opportunity'
  | 'retention_positive'
  | 'revenue_leak'
  | 'upsell_opportunity'
  | 'operational_gap';

export interface OperationalSignal {
  id: string;
  kind: OperationalSignalKind;
  /** Short human-readable title shown in the bubble suggestion. */
  title: string;
  detail?: string;
  /** 1–10, higher = surfaces first. */
  priority: number;
  severity: 'info' | 'warning' | 'positive';
  /** Suggestion kind for rendering (maps to ContextSuggestionKind). */
  suggestionKind: 'upsell' | 'follow_up' | 'collect' | 'retention' | 'operational';
  /** Optional registry action ID for one-tap execution. */
  actionId?: string;
  computedAt: number;
}

// ── Employee operational profile ──────────────────────────────────────────────

export interface EmployeeOperationalProfile {
  employeeId: string;
  employeeName: string;
  /** Session action volume, normalized 0–100. */
  shiftActivityScore: number;
  /** Discount attempt frequency 0–100 (higher = more frequent). */
  discountFrequencyScore: number;
  /** Approval request frequency 0–100. */
  approvalRequestScore: number;
  /** Repeat-customer rate in recent sales 0–100. */
  customerRetentionScore: number;
  /** Accessory attach rate on attributed sales 0–100. */
  upsellActivityScore: number;
  /** Workflow completion ratio 0–100. */
  workflowCompletionScore: number;
  /** Composite operational risk 0–100 (lower = lower risk). */
  operationalRiskScore: number;
  detectedPatterns: string[];
  suggestedActions: string[];
  computedAt: number;
}

// ── Health context (input to the engine) ─────────────────────────────────────

export interface OperationalHealthContext {
  repairs: Repair[];
  layaways: Layaway[];
  sales: Sale[];
  customers: Customer[];
  inventory: InventoryItem[];
  pendingWorkflows: PendingWorkflow[];
  recentActions: LiveAction[];
  activeEmployeeId: string | null;
  activeEmployeeName: string | null;
  /** Count of currently active pending workflows (from workflowContinuityStore). */
  pendingWorkflowCount: number;
}

// ── Health snapshot (output of the engine) ───────────────────────────────────

export interface OperationalHealthSnapshot {
  signals: OperationalSignal[];
  revenueOpportunities: RevenueOpportunity[];
  storeRhythm: StoreRhythmSnapshot;
  conclusions: OperationalReasoningConclusion[];
  strategy: BusinessStrategyFocus;
  activeWorkflowCount: number;
  overdueRepairCount: number;
  readyForPickupCount: number;
  overdueLayawayCount: number;
  computedAt: number;
}
