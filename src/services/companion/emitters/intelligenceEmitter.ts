// ============================================================
// CellHub Pro — Companion Intelligence Emitter
// (R-COMPANION-INTELLIGENCE-EMITTERS-V1)
//
// Thin wrapper that translates intelligence-engine "new alert"
// moments into typed CompanionEvent emissions. AlertEngine.evaluate()
// is the canonical producer today — it returns ONLY new alerts on
// each cycle (cooldown is applied internally via the lastFired Map),
// so emit cadence naturally matches "real" signals without flooding.
//
// Cero networking. Cero PII. Payloads carry alert ids, type metadata,
// severity/priority, optional entity refs. Never customer names,
// phone numbers, transaction data, payment data, or cart snapshots.
// ============================================================

import { emit } from '../companionEventBus';
import type { CompanionIntelligenceAlertPayload } from '../companionTypes';

const DEFAULT_SOURCE = 'intelligence';

type Severity = NonNullable<CompanionIntelligenceAlertPayload['severity']>;

export interface IntelligenceAlertEmitInput {
  alertId: string;
  severity?: Severity;
  /** Specific rule key — e.g. AlertEngine config id. */
  kind?: string;
  /** Higher-level grouping — matches AlertCategory. */
  insightType?: string;
  /** Defaults to `severity` when omitted. */
  priority?: Severity;
  /** Defaults to 'intelligence'. */
  source?: string;
  /** Optional entity context — only opaque IDs; cero PII. */
  relatedEntityType?: string;
  relatedEntityId?: string;
}

/**
 * Emit an INTELLIGENCE_ALERT_CREATED event. Producers call this
 * AFTER their own state has been committed (e.g. AlertEngine has
 * already updated lastFired) so emit timing reflects engine truth.
 */
export function emitIntelligenceAlertCreated(input: IntelligenceAlertEmitInput): void {
  emit({
    type: 'INTELLIGENCE_ALERT_CREATED',
    category: 'intelligence_alerts',
    payload: buildPayload(input),
    createdAt: Date.now(),
  });
}

// ── Internal ─────────────────────────────────────────────

function buildPayload(input: IntelligenceAlertEmitInput): CompanionIntelligenceAlertPayload {
  const out: CompanionIntelligenceAlertPayload = {
    alertId: input.alertId,
    source: input.source ?? DEFAULT_SOURCE,
  };
  if (input.severity)          out.severity = input.severity;
  if (input.kind)              out.kind = input.kind;
  if (input.insightType)       out.insightType = input.insightType;
  // Priority defaults to severity if caller didn't specify — the most
  // common case where UX prominence matches log severity.
  if (input.priority)          out.priority = input.priority;
  else if (input.severity)     out.priority = input.severity;
  if (input.relatedEntityType) out.relatedEntityType = input.relatedEntityType;
  if (input.relatedEntityId)   out.relatedEntityId = input.relatedEntityId;
  return out;
}
