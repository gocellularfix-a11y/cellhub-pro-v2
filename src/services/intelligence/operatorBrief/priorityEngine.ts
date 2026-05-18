// R-OPERATOR-DAILY-BRIEF-V2
// Cross-system priority scoring constants.
// Normalizes importance across different intelligence systems deterministically.
// Lower priority number = higher importance.
// No probabilistic scoring, no AI, no randomness.

export type PriorityUrgency = 'critical' | 'high' | 'medium';

export interface PriorityScore {
  priority: number;
  urgency: PriorityUrgency;
  reason: string;
}

// Deterministic priority constants — cross-system ordering.
export const PRIORITY = {
  NO_SALES_TODAY:       1,
  REPAIR_READY_TODAY:   2,
  PAYMENT_OVERDUE:      3,
  STALE_REPAIRS:        4,
  VIP_INACTIVE:         5,
  PAYMENT_DUE:          6,
  HIGH_VALUE_INACTIVE:  7,
  OUTREACH_CONTACTS:    8,
  RECENT_INTEREST:      9,
  DEAD_STOCK_RISK:     10,
  SLOW_DAY_RISK:       11,
  MISSED_REVENUE:      12,
  OUTREACH_MOMENTUM:   13,
} as const;

export const URGENCY: Record<keyof typeof PRIORITY, PriorityUrgency> = {
  NO_SALES_TODAY:       'critical',
  REPAIR_READY_TODAY:   'critical',
  PAYMENT_OVERDUE:      'critical',
  STALE_REPAIRS:        'high',
  VIP_INACTIVE:         'high',
  PAYMENT_DUE:          'high',
  HIGH_VALUE_INACTIVE:  'high',
  OUTREACH_CONTACTS:    'medium',
  RECENT_INTEREST:      'medium',
  DEAD_STOCK_RISK:      'medium',
  SLOW_DAY_RISK:        'medium',
  MISSED_REVENUE:       'medium',
  OUTREACH_MOMENTUM:    'medium',
};
