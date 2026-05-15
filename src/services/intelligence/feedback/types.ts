// R-INTELLIGENCE-FEEDBACK-LOOP-V1
// Deterministic operator feedback event types.
// No ML, no AI, no embeddings — pure operator signal + deterministic score.

export type IntelligenceFeedbackType =
  | 'useful'       // operator marked as valuable (+3)
  | 'not_useful'   // operator marked as noise (-3)
  | 'snoozed'      // operator deferred for later (-2)
  | 'resolved'     // operator acted and closed the issue (+2)
  | 'ignored';     // item was visible but no action taken (-1)

export interface IntelligenceFeedbackEvent {
  id: string;
  queueItemId: string;
  fingerprint?: string;   // dedup key — used for per-pattern score aggregation
  type: IntelligenceFeedbackType;
  createdAt: number;
}
