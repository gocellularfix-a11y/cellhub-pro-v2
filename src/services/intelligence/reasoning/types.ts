// R-INTELLIGENCE-CROSS-SYSTEM-REASONING-V1
// Cross-system operational reasoning types.
// Deterministic — no ML, no LLM calls.

export type OperationalCondition =
  | 'low_foot_traffic'
  | 'followup_breakdown'
  | 'inventory_pressure'
  | 'operator_overload'
  | 'revenue_focus_imbalance'
  | 'healthy_operation';

export interface ReasoningSignal {
  id: string;
  description: string;
  // 0..1 contribution; capped at 0.35 in confidence computation.
  value: number;
}

export interface OperationalReasoning {
  condition: OperationalCondition;
  // min(0.95, Σ min(signal.value, 0.35))
  confidence: number;
  signals: ReasoningSignal[];
  headline: string;
  recommendation: string;
}

export interface OperationalReasoningReport {
  topCondition: OperationalReasoning | null;
  allConditions: OperationalReasoning[];
  generatedAt: number;
}
