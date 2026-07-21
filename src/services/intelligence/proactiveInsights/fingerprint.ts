// ============================================================
// I6-0A — deterministic insight fingerprints.
//
// Derived EXCLUSIVELY from: detector ID, store ID, category, the resolved
// ranges, the primary dimension and the direction. NEVER from timestamps,
// translated text, formatted money, random UUIDs or incidental object
// order — two runs over the same snapshot with the same referenceDate are
// semantically equivalent by construction.
//
// NOTE (I6-0A): supersedes the I6-0 two-part id `kind:start:end`. Explicit
// break reason: the original id lacked store/category/dimension/direction;
// no consumer nor persisted fingerprint existed at the time of the change.
// Mapping: sales_material_change → sales_momentum (same detector logic).
// ============================================================

import type { ProactiveDetectorId, ProactiveInsightCategory, ProactiveInsightDirection } from './types';

export interface FingerprintInput {
  detectorId: ProactiveDetectorId;
  storeId: string | null;
  category: ProactiveInsightCategory;
  /** Ordered resolved ranges, each as `start..end` YMD. */
  ranges: Array<{ startYMD: string; endYMD: string }>;
  /** Primary dimension of the finding (metric, carrier, cause…). */
  dimension: string;
  direction: ProactiveInsightDirection;
}

export function buildFingerprint(input: FingerprintInput): string {
  const store = input.storeId && input.storeId.trim() ? input.storeId.trim() : 'single_store';
  const ranges = input.ranges.map((r) => `${r.startYMD}..${r.endYMD}`).join('|');
  return [input.detectorId, store, input.category, ranges, input.dimension, input.direction].join(':');
}
