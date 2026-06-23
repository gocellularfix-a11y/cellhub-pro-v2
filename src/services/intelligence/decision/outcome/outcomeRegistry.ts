// ============================================================
// R-INTELLIGENCE-F6B: Outcome Registry — read-only collection layer.
//
// Answers "where do outcomes live before Learning exists?" — a pure projection
// container over OutcomeRecord[]. It is read-only infrastructure: NO persistence,
// NO storage engine, NO IndexedDB/localStorage/filesystem, NO timestamps, NO
// execution metadata, NO learning, NO sorting, NO Date.now(), NO randomness, NO
// mutation.
//
// F6A remains the SINGLE SOURCE OF TRUTH for OutcomeRecord / OutcomeSummary /
// OutcomeHealth. summarizeOutcomeRegistry REUSES F6A's summarizeOutcomes — the
// counting logic is never duplicated here.
// ============================================================

import type { OutcomeRecord, OutcomeStatus } from './OutcomeRecord';
import { summarizeOutcomes, type OutcomeSummary } from './summarizeOutcomes';

/** A read-only projection container for outcome records. */
export interface OutcomeRegistry {
  /** Records in caller-supplied order (never sorted/reordered). */
  records: OutcomeRecord[];
  /** Count of records (== records.length). */
  totalRecords: number;
  /** Id of the last record in input order, when present. */
  latestRecordId?: string;
}

/**
 * Pure builder: OutcomeRecord[] → OutcomeRegistry. Preserves input order, takes
 * a defensive shallow copy (so the registry can't be mutated through the caller's
 * array), and never mutates the input. Deterministic.
 */
export function createOutcomeRegistry(records: OutcomeRecord[]): OutcomeRegistry {
  const copy = records.slice();
  const registry: OutcomeRegistry = {
    records: copy,
    totalRecords: copy.length,
  };
  if (copy.length > 0) registry.latestRecordId = copy[copy.length - 1].id;
  return registry;
}

/** Internal: read-only filter by status (pure, returns a new array). */
function byStatus(registry: OutcomeRegistry, status: OutcomeStatus): OutcomeRecord[] {
  return registry.records.filter((r) => r.outcomeStatus === status);
}

export function getCompletedOutcomes(registry: OutcomeRegistry): OutcomeRecord[] {
  return byStatus(registry, 'COMPLETED');
}

export function getFailedOutcomes(registry: OutcomeRegistry): OutcomeRecord[] {
  return byStatus(registry, 'FAILED');
}

export function getCancelledOutcomes(registry: OutcomeRegistry): OutcomeRecord[] {
  return byStatus(registry, 'CANCELLED');
}

export function getIgnoredOutcomes(registry: OutcomeRegistry): OutcomeRecord[] {
  return byStatus(registry, 'IGNORED');
}

/**
 * Pure metrics over the registry — delegates to F6A's summarizeOutcomes so the
 * counting / completionRate / health logic lives in exactly one place.
 */
export function summarizeOutcomeRegistry(registry: OutcomeRegistry): OutcomeSummary {
  return summarizeOutcomes(registry.records);
}

/** Deterministic: does the registry hold any outcomes? */
export function registryHasOutcomes(registry: OutcomeRegistry): boolean {
  return registry.records.length > 0;
}
