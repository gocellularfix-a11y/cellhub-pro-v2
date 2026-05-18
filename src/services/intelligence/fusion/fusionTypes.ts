// CellHub Intelligence — Signal Fusion Layer Types
// Pure TypeScript types — no React, no DOM, no I/O.
// R-FUSION-CHAT-INTEGRATION-V1
// R-FUSION-SUPPRESSION-AWARENESS-V1

export type FusedInsightSeverity = 'critical' | 'high' | 'medium' | 'low';

export type SuppressionPattern =
  | 'repeated_dismissal'
  | 'stale_workflow'
  | 'ignored_vip'
  | 'repeated_unresolved'
  | 'operator_overload_pattern';

// R-FUSION-ESCALATION-TIERS-V1
export type EscalationTier = 'watch' | 'warning' | 'urgent' | 'critical';

// R-FUSION-PRESSURE-ACCUMULATION-V1
export type PressureClusterType =
  | 'customer_decay'
  | 'workflow_instability'
  | 'operator_overload'
  | 'revenue_pressure'
  | 'recovery_pressure';

export type FusedInsightCategory =
  | 'operator_overload'
  | 'vip_risk'
  | 'recovery_opportunity'
  | 'conversion_opportunity'
  | 'workflow_interruption'
  | 'operational_risk';

// Subset of executable action types with established execution targets.
// resume_external_payment and open_deal_pipeline are intentionally excluded —
// their primary UI paths are owned by PaymentVerificationNudge and deal pipeline.
export type FusedInsightActionType =
  | 'open_repair'
  | 'open_customer'
  | 'send_whatsapp'
  | 'open_manager_queue';

export interface FusedInsight {
  id: string;
  severity: FusedInsightSeverity;
  category: FusedInsightCategory;
  // All three languages carried so the handler selects without extra I/O.
  title: string;
  titleEs: string;
  titlePt: string;
  summary: string;
  summaryEs: string;
  summaryPt: string;
  entityId?: string;
  entityType?: string;
  phone?: string;
  actionType?: FusedInsightActionType;
  actionTargetId?: string;
  actionTargetPhone?: string;
  // R-FUSION-SUPPRESSION-AWARENESS-V1
  suppressionPattern?: SuppressionPattern;
  repeatCount?: number;
  firstDetectedAt?: number;
  // R-FUSION-ESCALATION-TIERS-V1
  escalationTier?: EscalationTier;
  ageHours?: number;
  // R-FUSION-PRESSURE-ACCUMULATION-V1
  pressureCluster?: PressureClusterType;
  pressureScore?: number;
  // R-FUSION-REVENUE-PRESSURE-FIX-V1
  staleSinceMs?: number;
}

export interface FusedInsightsReport {
  generatedAt: number;
  insights: FusedInsight[];    // sorted critical → low, capped at MAX_INSIGHTS
  topInsight: FusedInsight | null;
  criticalCount: number;
  highCount: number;
}
