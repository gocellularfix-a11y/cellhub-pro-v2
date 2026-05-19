// R-INTELLIGENCE-AUTOMATED-EXECUTION-V1
// Execution preparation types — no AI, no auto-send, no external calls.
// V1 prepares execution-ready actions only. Operator triggers all sends.

export type ExecutionCategory =
  | 'repair_followup'   // Follow up on overdue repair
  | 'collection'        // Collect outstanding balance
  | 'vip_recovery'      // Re-engage inactive VIP customer
  | 'approval_review'   // Pending manager queue items
  | 'inventory_order';  // Low-stock reorder prep

export interface PreparedExecution {
  id: string;

  category: ExecutionCategory;

  priority: 'critical' | 'high' | 'medium';

  // Who this is for
  entityType?: string;
  entityId?: string;
  customerName?: string;
  customerPhone?: string;

  // Pre-built message ready to send (operator must manually trigger)
  draftMessage: string;

  // Why this was prepared
  reason: string;

  // Estimated revenue impact in cents
  estimatedImpactCents?: number;

  confidence: number; // 0–1

  createdAt: number;
}

export interface ExecutionReport {
  generatedAt: number;
  summary: string;
  executions: PreparedExecution[];
  topExecution?: PreparedExecution;
  totalEstimatedImpactCents: number;
}

// ── INTELLIGENCE-OPERATIONAL-EXECUTION-REGISTRY-V1 ──────────────────────────
// Canonical types for the centralized operational execution layer.

/** Canonical set of operational actions Intelligence can execute. */
export type OperationalExecutionAction =
  | 'open_repair'
  | 'open_customer'
  | 'open_layaway'
  | 'open_unlock'
  | 'open_special_order'
  | 'open_inventory'
  | 'whatsapp_url'
  | 'promote_product'
  | 'collect_payment'    // future: POS collect-balance flow
  | 'mark_ready';        // future: repair mark-ready shortcut

/** Normalized payload for executeOperationalAction. */
export interface ExecutionPayload {
  action: OperationalExecutionAction;
  entityId?: string;
  customerName?: string;
  customerPhone?: string;
  productId?: string;
  productName?: string;
}

/** Result returned by executeOperationalAction. */
export interface OperationalExecutionResult {
  ok: boolean;
  action: OperationalExecutionAction;
  reason?: string;
}
