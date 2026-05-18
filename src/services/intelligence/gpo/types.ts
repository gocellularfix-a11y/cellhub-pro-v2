// R-GPO-V1 — Global Priority Orchestrator types.
// Deterministic aggregation of OCE signals into cross-module priorities.
// No AI, no embeddings, no probabilistic scoring.

import type { OperationalSignal } from '../oce/operationalContextTypes';
import type { ActionPayload } from '../actions/actionEngine';

export type OperationalPriorityCategory =
  | 'pickup_opportunity'
  | 'payment_collection'
  | 'customer_outreach'
  | 'inventory_attention'
  | 'business_risk'
  | 'system_attention';

export interface AggregatedPriority {
  id: string;
  category: OperationalPriorityCategory;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  summary: string;
  signalCount: number;
  sourceSignals: OperationalSignal[];
  actionable: boolean;
  topActions?: ActionPayload[];
  score: number;
}
