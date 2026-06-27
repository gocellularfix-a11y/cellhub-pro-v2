// R-INTEL-RISK-TO-QUEUE: producer that enrolls already-computed Intelligence
// risks into the existing Manager Queue.
//
// This module creates NO new intelligence signals and executes NO actions. It
// consumes the engine's already-computed proactive report (the single source
// that already aggregates collection / repair_followup / vip_retention /
// inventory / approval / revenue risks) and turns the manager-worthy ones into
// ManagerQueueItems via the existing addManagerQueueItem() API — reusing its
// fingerprint dedup, severity escalation, and localStorage persistence. There
// is exactly ONE queue; this does not create a second one.
//
// Deterministic + fail-safe: never throws into the caller/UI. On any error it
// returns the partial summary accumulated so far.

import type { ProactiveAction } from '@/services/intelligence/proactive/types';
import type { QueueEntityType, QueueItemSeverity } from './types';
import { getQueue, buildFingerprint, addManagerQueueItem } from './actions';
// R-INTELLIGENCE-ENTITY-VALIDATION-TIER3: live re-validation at enrollment time.
import {
  validateResolvedEntity,
  type EntityValidationStore,
} from '@/services/intelligence/oce/entityResolution/validateResolvedEntity';
import type { ResolvedEntity } from '@/services/intelligence/oce/entityResolution/types';

export interface RiskEnrollmentSummary {
  /** Candidates evaluated this run (manager-worthy, after the per-run cap). */
  considered: number;
  /** New queue items created. */
  enrolled: number;
  /** Skipped — an equivalent item is already pending (no escalation flood). */
  skippedDuplicate: number;
  /** Skipped — an equivalent item is already terminal (resolved/dismissed/approved). */
  skippedResolved: number;
  /** Skipped — malformed action (no usable title) or persistence failure. */
  skippedInvalid: number;
  /**
   * R-INTELLIGENCE-ENTITY-VALIDATION-TIER3: skipped — the entity went stale
   * (cancelled/refunded/refund_pending/picked_up repair, deleted customer or
   * inventory, or a record that no longer exists) between scan and enrollment.
   * Only ever non-zero when a validation store is supplied via opts.store.
   */
  skippedStale: number;
}

// R-INTELLIGENCE-ENTITY-VALIDATION-TIER3: map a queue entity reference to the
// resolution-oriented ResolvedEntity the canonical validator understands. Only
// customer/repair/layaway/inventory have a validator path; sale carries no
// executable action and unlock/special_order have no resolver — those return
// null and pass through enrollment unchanged (Tier3 only DROPS known-stale).
function toResolvedEntity(entityType: QueueEntityType, entityId: string): ResolvedEntity | null {
  switch (entityType) {
    case 'customer':  return { type: 'customer',  customerId: entityId, confidence: 1 };
    case 'repair':    return { type: 'repair',    repairId: entityId,   confidence: 1 };
    case 'layaway':   return { type: 'layaway',   layawayId: entityId,  confidence: 1 };
    case 'inventory': return { type: 'inventory', sku: entityId,        confidence: 1 };
    default:          return null; // sale | unlock | special_order
  }
}

// Per-run flood guard: enroll at most this many risks per data update. The
// proactive report is already priority-ranked, so the most important risks win
// the cap. Lower-priority risks surface on a later run as the queue drains.
const DEFAULT_CAP = 8;

// Only critical/high proactive actions are manager-worthy. Medium stays in the
// operator's proactive feed — escalating every medium item would flood the
// manager queue.
const ENROLLABLE_PRIORITY: ReadonlySet<string> = new Set(['critical', 'high']);

const PRIORITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1 };

// Mirrors QueueEntityType — proactive actions carry a free-form entityType
// string, so we accept only the values the queue model understands.
const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'repair', 'customer', 'layaway', 'inventory', 'sale', 'unlock', 'special_order',
]);

function coerceSeverity(p: ProactiveAction['priority']): QueueItemSeverity {
  return p === 'critical' || p === 'high' || p === 'medium' ? p : 'medium';
}

function coerceEntityType(s: string | undefined): QueueEntityType | undefined {
  return s && VALID_ENTITY_TYPES.has(s) ? (s as QueueEntityType) : undefined;
}

/**
 * Enroll manager-worthy proactive risks into the Manager Queue.
 *
 * @param actions  engine.getProactiveReport().actions (already localized + ranked)
 * @param opts.cap optional per-run enrollment cap (default 8)
 *
 * No user-facing strings are generated here — title/description/recommendedAction
 * are passed through from the proactive action, which the engine already builds
 * in the active language (EN/ES/PT). All values are read-only; nothing executes.
 */
export function enrollIntelligenceRisksToManagerQueue(
  actions: ProactiveAction[] | null | undefined,
  opts: { cap?: number; store?: EntityValidationStore } = {},
): RiskEnrollmentSummary {
  const summary: RiskEnrollmentSummary = {
    considered: 0,
    enrolled: 0,
    skippedDuplicate: 0,
    skippedResolved: 0,
    skippedInvalid: 0,
    skippedStale: 0,
  };

  try {
    if (!Array.isArray(actions) || actions.length === 0) return summary;

    const cap =
      typeof opts.cap === 'number' && Number.isFinite(opts.cap) && opts.cap > 0
        ? Math.floor(opts.cap)
        : DEFAULT_CAP;

    // Manager-worthy candidates only, deterministically ranked (priority, then
    // impact), then capped. .slice() before sort to avoid mutating the input.
    const candidates = actions
      .filter((a) => !!a && typeof a === 'object' && ENROLLABLE_PRIORITY.has(String(a.priority)))
      .slice()
      .sort((a, b) => {
        const pr = (PRIORITY_RANK[String(b.priority)] ?? 0) - (PRIORITY_RANK[String(a.priority)] ?? 0);
        if (pr !== 0) return pr;
        return (b.estimatedImpactCents ?? 0) - (a.estimatedImpactCents ?? 0);
      })
      .slice(0, cap);

    // Snapshot the queue once; classify existing fingerprints by lifecycle.
    // pending → would be a duplicate; terminal → was already handled/auto-resolved.
    const pendingFps = new Set<string>();
    const terminalFps = new Set<string>();
    for (const it of getQueue()) {
      const fp = it.fingerprint;
      if (!fp) continue;
      if (it.status === 'pending') pendingFps.add(fp);
      else terminalFps.add(fp); // approved | dismissed | resolved
    }

    for (const action of candidates) {
      summary.considered++;

      const title = typeof action.title === 'string' ? action.title.trim() : '';
      if (!title) {
        summary.skippedInvalid++;
        continue;
      }

      const entityType = coerceEntityType(action.entityType);
      const entityId =
        typeof action.entityId === 'string' && action.entityId.trim()
          ? action.entityId.trim()
          : undefined;

      // R-INTELLIGENCE-ENTITY-VALIDATION-TIER3: revalidate the entity against
      // LIVE store state immediately before enrollment. A risk scanned earlier
      // may now point to a cancelled/refunded/picked_up repair, a deleted
      // customer/inventory record, or an entity that no longer exists. Drop it —
      // never persist a queue item for a stale entity. Runs only when a store is
      // supplied and the type has a validator path (sale/unlock/special_order
      // pass through). Fail-open: a validator error must never block a real
      // enrollment, preserving the pre-Tier3 behavior on the safe side.
      if (opts.store && entityType && entityId) {
        const resolved = toResolvedEntity(entityType, entityId);
        if (resolved) {
          let stale = false;
          try {
            stale = !validateResolvedEntity(resolved, opts.store).ok;
          } catch {
            stale = false;
          }
          if (stale) {
            summary.skippedStale++;
            continue;
          }
        }
      }

      // Same args order as addManagerQueueItem's internal fingerprint so our
      // pre-check matches what the persisted item will carry.
      const fingerprint = buildFingerprint('review', entityType, entityId, title);

      if (pendingFps.has(fingerprint)) {
        summary.skippedDuplicate++;
        continue;
      }
      if (terminalFps.has(fingerprint)) {
        // Respects auto-resolution AND manager dismissal — do not re-surface.
        summary.skippedResolved++;
        continue;
      }

      const description =
        typeof action.reason === 'string' && action.reason.trim() ? action.reason.trim() : title;
      const recommendedAction =
        typeof action.recommendedAction === 'string' && action.recommendedAction.trim()
          ? action.recommendedAction.trim()
          : undefined;

      try {
        addManagerQueueItem({
          severity: coerceSeverity(action.priority),
          category: 'review',
          title,
          description,
          entityType,
          entityId,
          recommendedAction,
        });
        // Guard against enrolling the same fingerprint twice in one run.
        pendingFps.add(fingerprint);
        summary.enrolled++;
      } catch {
        summary.skippedInvalid++;
      }
    }
  } catch {
    // best-effort — never throw into render; return the partial summary.
  }

  return summary;
}
