// CellHub Intelligence — Revenue Opportunity Types
// Pure TypeScript types — no React, no DOM, no I/O.
// Conservative, transparent estimates only. Never invent numbers.

import type { Repair, Layaway, Sale, Customer, InventoryItem } from '@/store/types';
import type { PendingWorkflow } from '@/services/intelligence/workflowContinuity/workflowContinuityTypes';

// ── Opportunity model ─────────────────────────────────────────────────────────

export type RevenueOpportunityType =
  | 'missed_accessory_attach'
  | 'unpaid_balance_recovery'
  | 'delayed_repair_recovery'
  | 'inactive_customer_recovery'
  | 'dead_stock_push'
  | 'low_stock_reorder'
  | 'abandoned_workflow_recovery'
  | 'vip_retention'
  | 'high_value_followup';

export type RevenueConfidence = 'high' | 'medium' | 'low';

export interface RevenueOpportunity {
  id: string;
  type: RevenueOpportunityType;
  title: string;
  detail?: string;
  /** 0–100 composite score from revenueImpactScoring. Higher = surfaces first. */
  priority: number;
  confidence: RevenueConfidence;
  /**
   * Conservative recoverable amount in cents.
   * 0 means unknown — never invented. Use actual known balances where available.
   */
  estimatedImpactCents: number;
  /** 0–10 intrinsic urgency set by detector (age/overdue days). */
  urgency: number;
  /** Module to navigate to for action. */
  relatedModule: string;
  relatedCustomerId?: string | null;
  /** Repair/layaway/inventory entity id. */
  relatedEntityId?: string | null;
  relatedSku?: string | null;
  detectedAt: number;
  recommendedActions: string[];
  evidence: string[];
  /** Maps directly to ContextSuggestion['kind'] for rendering — set by detector. */
  suggestionKind: 'upsell' | 'follow_up' | 'collect' | 'retention' | 'operational';
}

// ── Engine input context ──────────────────────────────────────────────────────

export interface RevenueOpportunityContext {
  repairs: Repair[];
  layaways: Layaway[];
  sales: Sale[];
  customers: Customer[];
  inventory: InventoryItem[];
  pendingWorkflows: PendingWorkflow[];
}
