// R-OUTREACH-OUTCOME-FEEDBACK-V1
// Outcome types for deterministic outreach feedback loop.
// Pure types — no logic, no side effects.

export type OutreachOutcomeType =
  | 'sent'
  | 'replied'
  | 'visited_store'
  | 'payment_collected'
  | 'repair_picked_up'
  | 'sale_completed'
  | 'ignored';

export type OutreachGroup =
  | 'repair_ready'
  | 'payment_due'
  | 'vip_inactive'
  | 'high_value_inactive'
  | 'recent_interest'
  | 'missed_revenue';

export interface OutreachOutcomeEvent {
  id: string;
  customerId: string;
  outreachGroup: OutreachGroup;
  outcome: OutreachOutcomeType;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
