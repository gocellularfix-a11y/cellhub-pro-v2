// R-INTELLIGENCE-MANAGER-QUEUE-V1 + R-INTELLIGENCE-QUEUE-DEDUP-NAVIGATION-V1
// R-INTELLIGENCE-AUTO-RESOLUTION-V1
// ManagerQueueItem type definitions — no imports from store or React.

export type QueueItemStatus   = 'pending' | 'approved' | 'dismissed' | 'resolved';

// R-INTELLIGENCE-AUTO-RESOLUTION-V1: result from evaluateQueueAutoResolution.
// resolvedAt is epoch ms set by the rule at the moment of evaluation.
export interface ResolutionResult {
  queueItemId: string;
  resolved: boolean;
  reason?: string;
  resolvedAt?: number;
}
export type QueueItemSeverity = 'low' | 'medium' | 'high' | 'critical';
export type QueueItemCategory = 'refund' | 'discount' | 'override' | 'writeoff' | 'review' | 'general';
export type QueueEntityType   = 'repair' | 'customer' | 'layaway' | 'inventory' | 'sale';

export interface ManagerQueueItem {
  id: string;
  status: QueueItemStatus;
  severity: QueueItemSeverity;
  category: QueueItemCategory;
  title: string;
  description: string;
  entityType?: QueueEntityType;
  entityId?: string;
  recommendedAction?: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  notes?: string;
  // R-INTELLIGENCE-QUEUE-DEDUP-NAVIGATION-V1: dedup + occurrence tracking
  fingerprint?: string;        // deterministic dedup key — optional for V1 compat
  occurrenceCount?: number;    // defaults to 1 when absent (V1 migration)
  firstSeenAt?: number;        // set on first create; falls back to createdAt
  lastSeenAt?: number;         // updated on each dedup merge; falls back to updatedAt
  // R-INTELLIGENCE-FEEDBACK-LOOP-V1: snooze
  snoozedUntil?: number;       // epoch ms — item hidden from pending view until this time
  // R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1: optional link to an OperationalWorkflow.
  // When set, approving the item advances the workflow step; auto-resolving
  // the item auto-completes the workflow.
  workflowId?: string;
}
