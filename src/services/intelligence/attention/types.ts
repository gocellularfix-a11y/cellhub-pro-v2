// R-INTELLIGENCE-ATTENTION-MODEL-V1

export type AttentionState =
  | 'focused'
  | 'busy'
  | 'overloaded'
  | 'idle'
  | 'recovering';

export interface AttentionSnapshot {
  state: AttentionState;
  calculatedAt: number;
  recentDismissals: number;
  recentActions: number;
  recentCheckouts: number;
  unresolvedCriticalCount: number;
  interruptionScore: number; // 0–1
}

export interface AttentionDecision {
  allowSuggestion: boolean;
  reason: string;
  cooldownMultiplier: number;
  maxPriorityAllowed: 'critical' | 'high' | 'medium' | 'low';
}
