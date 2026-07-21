// ============================================================
// I6-0A — Detector 3: carrier concentration (30 full local days).
//
// The eligible population is REAL carrier activity with STRUCTURAL
// evidence (I6-0B hardening): the shared strict resolver
// resolveStructuredCarrier (query/scopeBusinessQueryData.ts) — canonical
// carrier-activity classification (phone payment / top-up / activation by
// classifyItem/isActivationSaleItem) PLUS an explicit carrier FIELD whose
// entire value is a known carrier. Item names, descriptions, SKUs,
// customer names, phone numbers, brands, products ("Ultra Case"), repairs,
// unlocks and services can never classify — free text alone is never
// carrier evidence. Legacy name-only phone payments are conservatively
// OUTSIDE this population (chat/insights keep the legacy itemCarrier
// fallback — behavior there is unchanged).
// Exact-or-exclude: only PURE single-carrier sales are eligible;
// carrier-impure sales are EXCLUDED and counted in evidence.
//
// Counts are canonical: each carrier's activity = txCount of the canonical
// projection over its scoped sales (snapshotWithSales drops standalone
// repairs/unlocks, keeping the population pure). No new money math.
//
// Concentration is EXPOSURE, direction 'neutral' — it is only called
// watch/important through the explicit named share thresholds.
// Ties are deterministic: count desc, then carrier name asc; tied carriers
// are reported in evidence, never silently dropped.
// ============================================================

import {
  countCarrierImpureSales, discoverCarriers, resolveStructuredCarrier, scopeSalesByCarrier, snapshotWithSales,
} from '../../query/scopeBusinessQueryData';
import type {
  CarrierConcentrationEvidence, CarrierShareRow, DetectorRunResult, DiagnosticReason,
  ProactiveInsightContext, ProactiveInsightDetector, ProactiveInsightSeverity,
} from '../types';
import {
  CARRIER_HIGH_CONCENTRATION_SHARE, CARRIER_MIN_ELIGIBLE_TRANSACTIONS,
  CARRIER_SEVERE_CONCENTRATION_SHARE, CARRIER_WINDOW_DAYS,
} from '../thresholds';
import { CONFIDENCE_BANDS } from '../confidence';
import type { ConfidenceEvaluation } from '../types';
import { buildFingerprint } from '../fingerprint';
import { salesInRange } from '../evidenceMeasures';

const APPLIED = {
  carrierHighConcentrationShare: CARRIER_HIGH_CONCENTRATION_SHARE,
  carrierSevereConcentrationShare: CARRIER_SEVERE_CONCENTRATION_SHARE,
  carrierMinEligibleTransactions: CARRIER_MIN_ELIGIBLE_TRANSACTIONS,
  carrierWindowDays: CARRIER_WINDOW_DAYS,
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Single-window sample band (complete 30-day window). */
function windowConfidence(totalEligible: number): ConfidenceEvaluation {
  if (totalEligible < CARRIER_MIN_ELIGIBLE_TRANSACTIONS) {
    return { value: CONFIDENCE_BANDS.insufficient, reasons: ['complete_periods', 'insufficient_sample'] };
  }
  if (totalEligible >= 30) return { value: CONFIDENCE_BANDS.strongSample, reasons: ['complete_periods', 'strong_sample'] };
  return { value: CONFIDENCE_BANDS.moderateSample, reasons: ['complete_periods', 'moderate_sample'] };
}

function run(context: ProactiveInsightContext): DetectorRunResult {
  const window = context.window30;
  const windowSales = salesInRange(context.query.snapshot.sales || [], window.range);

  // Canonical eligible activity per carrier: pure single-carrier sales →
  // canonical projection → txCount (voided/refund policy stays canonical).
  const rows: CarrierShareRow[] = [];
  for (const carrier of discoverCarriers(windowSales, resolveStructuredCarrier)) {
    const scoped = snapshotWithSales(context.query.snapshot, scopeSalesByCarrier(windowSales, carrier, resolveStructuredCarrier).sales);
    const txCount = context.query.computeForScopedSnapshot(scoped, window.range).txCount;
    if (txCount > 0) rows.push({ carrier, transactionCount: txCount });
  }
  rows.sort((a, b) => b.transactionCount - a.transactionCount || a.carrier.localeCompare(b.carrier));
  const excludedMixedSales = countCarrierImpureSales(windowSales, resolveStructuredCarrier);

  const noActivity = rows.length === 0;
  const totalEligible = rows.reduce((sum, r) => sum + r.transactionCount, 0);
  const top = rows[0] ?? { carrier: '', transactionCount: 0 };
  const evidence: CarrierConcentrationEvidence = {
    detectorId: 'carrier_concentration',
    metric: 'transaction_count',
    sourceKind: 'canonical_report_money',
    window,
    topCarrier: top.carrier,
    tiedWith: rows.slice(1).filter((r) => r.transactionCount === top.transactionCount).map((r) => r.carrier),
    topCarrierTransactionCount: top.transactionCount,
    totalEligibleTransactionCount: totalEligible,
    concentration: totalEligible > 0 ? round3(top.transactionCount / totalEligible) : 0,
    perCarrier: rows,
    excludedMixedSales,
  };
  const confidence = windowConfidence(totalEligible);
  const diagnostic = (status: 'emitted' | 'below_threshold' | 'insufficient_evidence', reasons: DiagnosticReason[], emittedCount: number) =>
    ({ detectorId: 'carrier_concentration' as const, status, reasons, evidence, confidence: confidence.value, emittedCount });

  if (noActivity) {
    return { insights: [], diagnostic: diagnostic('insufficient_evidence', ['no_eligible_carrier_activity'], 0) };
  }
  if (totalEligible < CARRIER_MIN_ELIGIBLE_TRANSACTIONS) {
    return { insights: [], diagnostic: diagnostic('insufficient_evidence', ['insufficient_sample'], 0) };
  }
  if (evidence.concentration < CARRIER_HIGH_CONCENTRATION_SHARE) {
    return { insights: [], diagnostic: diagnostic('below_threshold', ['concentration_below_threshold'], 0) };
  }

  // Severity rule (explicit shares, exposure only — never "dangerous"
  // without the named rule): ≥ severe share → important; ≥ high → watch.
  const severity: ProactiveInsightSeverity =
    evidence.concentration >= CARRIER_SEVERE_CONCENTRATION_SHARE ? 'important' : 'watch';

  return {
    insights: [{
      fingerprint: buildFingerprint({
        detectorId: 'carrier_concentration', storeId: context.storeId, category: 'carriers',
        ranges: [window], dimension: top.carrier.toLowerCase(), direction: 'neutral',
      }),
      detectorId: 'carrier_concentration',
      category: 'carriers',
      severity,
      direction: 'neutral',
      confidence: confidence.value,
      confidenceReasons: confidence.reasons,
      evidence,
      thresholds: APPLIED,
    }],
    diagnostic: diagnostic('emitted', [], 1),
  };
}

export const carrierConcentrationDetector: ProactiveInsightDetector = {
  id: 'carrier_concentration',
  category: 'carriers',
  run,
};
