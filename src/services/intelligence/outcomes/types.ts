// R-INTELLIGENCE-OUTCOME-TRACKING-V1
// Operational outcome types — no imports from store or React.

export type OutcomeStatus =
  | 'pending'
  | 'successful'
  | 'failed'
  | 'unknown';

export type OutcomeCategory =
  | 'repair_pickup'
  | 'collection_recovered'
  | 'vip_returned'
  | 'inventory_recovered'
  | 'approval_completed';

export interface OperationalOutcome {
  id: string;

  workflowId: string;
  queueItemId?: string;

  category: OutcomeCategory;

  status: OutcomeStatus;

  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;

  fingerprint?: string;

  entityType?: string;
  entityId?: string;

  expectedSignal: string;
  actualSignal?: string;

  revenueImpactCents?: number;
}
