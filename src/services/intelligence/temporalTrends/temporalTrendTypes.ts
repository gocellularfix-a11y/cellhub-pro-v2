// CellHub Intelligence — Temporal Trend Types
// Pure TypeScript types — no React, no DOM, no I/O.

import type { Sale } from '@/store/types';
import type { LiveAction } from '@/services/intelligence/liveContext/contextTypes';
import type { PendingWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';
import type { RevenueOpportunity } from '@/services/intelligence/revenueOpportunities/revenueOpportunityTypes';

// ── Trend modes ────────────────────────────────────────────────────────────────

export type TrendMode =
  | 'stable'
  | 'improving'
  | 'worsening'
  | 'accelerating'
  | 'slowing'
  | 'recovering'
  | 'risk_increasing'
  | 'opportunity_increasing';

export type TrendConfidence = 'high' | 'medium' | 'low';

export type TrendDirection = 'up' | 'down' | 'flat';

export type TemporalTrendSignalKind =
  | 'sales_momentum'
  | 'repair_momentum'
  | 'collection_momentum'
  | 'customer_activity_momentum'
  | 'opportunity_momentum'
  | 'workflow_momentum';

// ── Trend signal ───────────────────────────────────────────────────────────────

export interface TemporalTrendSignal {
  id: string;
  kind: TemporalTrendSignalKind;
  direction: TrendDirection;
  title: string;
  detail?: string;
  confidence: TrendConfidence;
  /** 1–10, higher = surfaces first. */
  priority: number;
  computedAt: number;
}

// ── Engine input context ───────────────────────────────────────────────────────

export interface TemporalTrendContext {
  /** Needed for time-windowed sale count comparison. */
  sales: Sale[];
  /** LiveAction.timestamp is a plain number (ms epoch). */
  recentActions: LiveAction[];
  pendingWorkflows: PendingWorkflow[];
  revenueOpportunities: RevenueOpportunity[];
}

// ── Snapshot (output of the engine) ───────────────────────────────────────────

export interface TemporalTrendSnapshot {
  trendMode: TrendMode;
  /** 0–100: 50 = stable, >60 = improving, <40 = declining. */
  salesMomentumScore: number;
  repairMomentumScore: number;
  collectionMomentumScore: number;
  workflowMomentumScore: number;
  customerActivityMomentumScore: number;
  revenueOpportunityMomentumScore: number;
  detectedTrendSignals: TemporalTrendSignal[];
  /** Action IDs appropriate for the current trend mode. */
  recommendedActions: string[];
  generatedAt: number;
}
