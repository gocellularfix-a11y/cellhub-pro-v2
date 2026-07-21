// ============================================================
// I6-0A — proactive insight engine (read-only, on-demand).
//
// Runs the registered detectors in DETERMINISTIC registry order over ONE
// canonical, store-scoped StructuredQueryContext (the same context the
// I3-2 executor uses), wrapped with the shared pre-resolved windows.
//
// Guarantees:
//   • per-detector failure ISOLATION — a throwing detector becomes a
//     detector_error diagnostic; NO fake insight is ever fabricated;
//   • finite-number guard — any detector emitting NaN/Infinity/undefined
//     in public fields is demoted to detector_error (fail safe);
//   • dedup by fingerprint (first registry occurrence wins);
//   • stable ordering: severity rank → category → fingerprint;
//   • result cap (MAX_INSIGHTS_PER_RUN) applied AFTER the stable sort;
//   • injected referenceDate only — no real-clock dependence inside.
//
// No persistence, no notifications, no timers, no background work — future
// presenter/Business Manager/alert rounds consume this.
// ============================================================

import type { StructuredQueryContext } from '../query/types';
import type {
  ProactiveInsight, ProactiveInsightContext, ProactiveInsightDetector,
  ProactiveInsightDiagnostic, ProactiveInsightSeverity, ProactiveInsightsResult,
} from './types';
import { resolveAnalysisWindows, resolveCarrierWindow } from './analysisWindow';
import { MAX_INSIGHTS_PER_RUN } from './thresholds';
import { salesMomentumDetector } from './detectors/salesMomentumDetector';
import { grossMarginPressureDetector } from './detectors/grossMarginPressureDetector';
import { carrierConcentrationDetector } from './detectors/carrierConcentrationDetector';
import { evidenceQualityDetector } from './detectors/evidenceQualityDetector';

/** Detector registry — DETERMINISTIC execution order. Extend here. */
export const PROACTIVE_DETECTORS: readonly ProactiveInsightDetector[] = [
  salesMomentumDetector,
  grossMarginPressureDetector,
  carrierConcentrationDetector,
  evidenceQualityDetector,
] as const;

const SEVERITY_ORDER: Record<ProactiveInsightSeverity, number> = {
  critical: 0, important: 1, watch: 2, info: 3,
};

/** Deep scan for non-finite numbers / undefined in public fields. */
export function hasNonFinitePublicValue(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNonFinitePublicValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.values(value as Record<string, unknown>).some(hasNonFinitePublicValue);
  }
  return false;
}

export function buildProactiveContext(query: StructuredQueryContext): ProactiveInsightContext {
  const windows7 = resolveAnalysisWindows(query.referenceDate);
  return {
    query,
    windows7,
    window30: resolveCarrierWindow(query.referenceDate),
    referenceYMD: windows7.referenceYMD,
    storeId: query.storeId ?? null,
  };
}

/** `detectors` is injectable for TESTS ONLY (failure isolation / dedup /
 *  cap locks); production always runs the fixed registry order. */
export function runProactiveInsightDetectors(
  query: StructuredQueryContext,
  detectors: readonly ProactiveInsightDetector[] = PROACTIVE_DETECTORS,
): ProactiveInsightsResult {
  const context = buildProactiveContext(query);

  const insights: ProactiveInsight[] = [];
  const diagnostics: ProactiveInsightDiagnostic[] = [];
  for (const detector of detectors) {
    try {
      const run = detector.run(context);
      // Fail safe: a detector emitting non-finite/undefined public numbers
      // is demoted to detector_error — nothing partial leaks out.
      if (hasNonFinitePublicValue(run.insights) || hasNonFinitePublicValue(run.diagnostic)) {
        diagnostics.push({
          detectorId: detector.id, status: 'detector_error',
          reasons: ['non_finite_public_number'], evidence: null, confidence: 0, emittedCount: 0,
        });
        continue;
      }
      insights.push(...run.insights);
      diagnostics.push(run.diagnostic);
    } catch {
      diagnostics.push({
        detectorId: detector.id, status: 'detector_error',
        reasons: ['detector_exception'], evidence: null, confidence: 0, emittedCount: 0,
      });
    }
  }

  // Dedup by fingerprint (first registry occurrence wins), stable order,
  // then the hard cap.
  const seen = new Set<string>();
  const deduped = insights.filter((i) => (seen.has(i.fingerprint) ? false : (seen.add(i.fingerprint), true)));
  deduped.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || a.category.localeCompare(b.category)
    || a.fingerprint.localeCompare(b.fingerprint));

  return {
    referenceYMD: context.referenceYMD,
    insights: deduped.slice(0, MAX_INSIGHTS_PER_RUN),
    diagnostics,
  };
}
