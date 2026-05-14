// CellHub Intelligence — Store Rhythm Types
// Pure TypeScript types — no React, no DOM, no I/O.

import type { Repair, Layaway, Sale } from '@/store/types';
import type { LiveAction } from '@/services/intelligence/liveContext/contextTypes';
import type { PendingWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';
import type { RevenueOpportunity } from '@/services/intelligence/revenueOpportunities/revenueOpportunityTypes';

// ── Store mode ─────────────────────────────────────────────────────────────────

export type StoreMode =
  | 'normal'
  | 'slow_day'
  | 'rush'
  | 'repair_overload'
  | 'collection_mode'
  | 'revenue_recovery'
  | 'low_activity'
  | 'opportunity_window';

export type RhythmConfidence = 'high' | 'medium' | 'low';

export type StoreRhythmSignalKind =
  | 'slow_day'
  | 'rush'
  | 'repair_overload'
  | 'collection_mode'
  | 'opportunity_window'
  | 'low_activity';

// ── Rhythm signal ──────────────────────────────────────────────────────────────

export interface RhythmSignal {
  id: string;
  kind: StoreRhythmSignalKind;
  title: string;
  detail?: string;
  confidence: RhythmConfidence;
  /** 1–10, higher = more urgent. */
  priority: number;
  computedAt: number;
}

// ── Engine input context ───────────────────────────────────────────────────────

export interface StoreRhythmContext {
  sales: Sale[];
  repairs: Repair[];
  layaways: Layaway[];
  /** LiveAction.timestamp is a plain number (ms). */
  recentActions: LiveAction[];
  pendingWorkflows: PendingWorkflow[];
  revenueOpportunities: RevenueOpportunity[];
  activeEmployeeId: string | null;
  /** Hour of day 0–23. Injected for testability; engine defaults to current hour. */
  currentHour?: number;
}

// ── Snapshot (output of the engine) ───────────────────────────────────────────

export interface StoreRhythmSnapshot {
  currentMode: StoreMode;
  /** 0–100: today's sales count mapped to an activity score. */
  salesPaceScore: number;
  /** 0–100: repair queue pressure (active + overdue + ready-for-pickup). */
  repairLoadScore: number;
  /** 0–100: open payment pressure (balances + pending workflows). */
  paymentFlowScore: number;
  /** 0–100: recent customer-facing action density (last 30 min). */
  customerActivityScore: number;
  /** 0–100: density of surfaced revenue opportunities. */
  opportunityPressureScore: number;
  /** 0–100: composite of repair load, payment flow, and workflow count. */
  operationalLoadScore: number;
  detectedRhythmSignals: RhythmSignal[];
  /** Recommended action IDs for the current mode (informational). */
  recommendedActions: string[];
  generatedAt: number;
}
