export type OutcomeSourceType = 'suggestion' | 'action' | 'chain' | 'workflow' | 'strategy';

export type OutcomeResult = 'completed' | 'skipped' | 'dismissed' | 'recovered' | 'unresolved';

export interface IntelligenceOutcome {
  id: string;
  sourceType: OutcomeSourceType;
  sourceId: string;
  outcome: OutcomeResult;
  createdAt: number;
  completedAt?: number;
  relatedCustomerId?: string;
  relatedWorkflowId?: string;
  relatedModule?: string;
  estimatedImpactCents?: number;
  actualImpactCents?: number;
  /** Lightweight tag bag — no full objects, no PII beyond IDs. */
  metadata?: Record<string, string>;
}

export interface OutcomeStats {
  completedCount: number;
  skippedCount: number;
  dismissedCount: number;
  recoveredCount: number;
  unresolvedCount: number;
  /** (completed + recovered) / total, 0 when no data. */
  completionRate: number;
  recoveredImpactCents: number;
  /** Top 5 source IDs by completed count in the last 7 days. */
  topCompletedSourceIds: string[];
  /** Strategy suggestion IDs to dampen (priority-1) — sources skipped ≥3× in 24h. */
  recentlyIgnoredSourceIds: string[];
  /** Strategy suggestion IDs to suppress — corresponding chains completed in last 2h. */
  recentlyCompletedSourceIds: string[];
}
