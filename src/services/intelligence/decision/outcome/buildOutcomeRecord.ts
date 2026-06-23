// ============================================================
// R-INTELLIGENCE-F6A: deterministic Outcome Builder.
//
// Projects a QueueItem + a caller-supplied terminal status into an OutcomeRecord.
// Pure + deterministic: same inputs → byte-identical record. The builder ONLY
// validates the status and projects — there is NO automatic success logic, NO
// execution, NO persistence, NO Date.now(), NO randomness, NO mutation.
// ============================================================

import type { QueueItem } from '../queue/QueueItem';
import { type OutcomeRecord, type OutcomeStatus, OUTCOME_STATUSES } from './OutcomeRecord';

export interface BuildOutcomeOptions {
  reason?: string;
  notes?: string;
}

/**
 * Pure builder: (QueueItem, explicit status) → OutcomeRecord. Throws on an
 * invalid status (validation only — no side effects). Optional reason/notes are
 * included only when supplied, keeping the default output minimal & deterministic.
 */
export function buildOutcomeRecord(
  queueItem: QueueItem,
  outcomeStatus: OutcomeStatus,
  opts: BuildOutcomeOptions = {},
): OutcomeRecord {
  if (!OUTCOME_STATUSES.includes(outcomeStatus)) {
    throw new Error(`buildOutcomeRecord: invalid outcomeStatus "${String(outcomeStatus)}"`);
  }
  const record: OutcomeRecord = {
    id: `outcome:${queueItem.id}`,
    queueItemId: queueItem.id,
    preparedActionId: queueItem.preparedActionId,
    sourceTopActionId: queueItem.sourceTopActionId,
    outcomeStatus,
  };
  if (opts.reason !== undefined) record.reason = opts.reason;
  if (opts.notes !== undefined) record.notes = opts.notes;
  return record;
}
