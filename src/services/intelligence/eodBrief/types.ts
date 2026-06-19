// ============================================================
// CellHub Intelligence — End-of-Day Brief Types
// R-EOD-BRIEF F1
//
// Shape contract for the EOD brief composer. UI / chat layers
// integrate against this surface. Money math is intentionally
// gated behind `confidence: 'placeholder'` in Phase 1 — see
// R-REPORTS-MONEY-EXTRACT for the canonical extraction that will
// promote the money section to 'high' confidence in a later round.
// ============================================================

import type { Lang3 } from '../chat/handlers';

/**
 * Confidence tag attached to each section of the brief.
 *
 *   high        — deterministic, fully sourced from canonical helpers.
 *   medium      — derived with documented approximation.
 *   low         — section was scanned but underlying data is sparse
 *                 (e.g. empty day → zero sales).
 *   partial     — core values are REAL and deterministic, but one or
 *                 more sub-breakdowns are not yet computed and are
 *                 flagged unavailable (see *Available booleans). Used by
 *                 the EOD money section after R-EOD-MONEY-WIRE: gross /
 *                 net / profit / margin / returns are real; tender +
 *                 fees/taxes remain pending (Priority A2).
 *   placeholder — shape is populated but the values are stubs (all
 *                 zeros). Downstream UI MUST NOT render the numbers
 *                 as financial truth when this tag is present.
 */
export type EODBriefConfidence = 'high' | 'medium' | 'low' | 'partial' | 'placeholder';

// ── Money section ────────────────────────────────────────

export interface EODMoneyTenderBreakdown {
  cashCents: number;
  cardCents: number;
  storeCreditCents: number;
  externalCents: number;
  otherCents: number;
}

export interface EODMoneyFeesAndTaxes {
  salesTaxCents: number;
  utilityTaxCents: number;
  caMobilityFeeCents: number;
  cbeFeeCents: number;
  screenFeeCents: number;
  totalCents: number;
}

export interface EODMoneySection {
  grossRevenueCents: number;
  netRevenueCents: number;       // revenue − returns
  grossProfitCents: number;      // 0 when profitVisible === false (redacted)
  profitMarginPct: number;       // 0–100; 0 when profitVisible === false
  // R-EOD-MONEY-WIRE: financial-privacy gate. When false (non-owner viewer
  // with hideOwnerFinancialsFromEmployees ON), grossProfitCents +
  // profitMarginPct are zeroed and downstream UI MUST NOT render profit/
  // margin lines. Revenue + saleCount stay visible (sales totals are
  // employee-allowed per the financial-privacy spec).
  profitVisible: boolean;
  saleCount: number;
  returnCount: number;
  returnedAmountCents: number;
  // R-EOD-MONEY-WIRE: tender + fees/taxes are NOT yet computed (Priority A2).
  // The zero objects below preserve shape stability for downstream consumers,
  // but *Available === false marks them as PENDING, not real. UI MUST NOT
  // render these as financial truth while their Available flag is false.
  tenderBreakdown: EODMoneyTenderBreakdown;
  tenderBreakdownAvailable: boolean;
  feesAndTaxes: EODMoneyFeesAndTaxes;
  feesAndTaxesAvailable: boolean;
  confidence: EODBriefConfidence;
}

// ── Open items section ───────────────────────────────────

export interface EODOpenRepair {
  id: string;
  device: string;
  customerName: string;
  daysOpen: number;
}

export interface EODOpenLayaway {
  id: string;
  customerName: string;
  balanceCents: number;
  daysUntilDue: number;
}

export interface EODOpenExternalPayment {
  id: string;
  customerName: string;
  amountCents: number;
  daysSinceCreated: number;
  // R-EOD-BRIEF F2: surfaced from PaymentVerification.carrier for the
  // chat formatter. Optional — pre-F2 records (none in production today
  // since composer is unwired) may omit it.
  carrier?: string;
}

export interface EODOpenStoreCredit {
  certId: string;
  customerName: string;
  balanceCents: number;
  daysUntilExpiry: number;
}

export interface EODOpenItemsSection {
  repairsPendingTomorrow: EODOpenRepair[];
  layawaysDueThisWeek: EODOpenLayaway[];
  externalPaymentsPending: EODOpenExternalPayment[];
  storeCreditExpiringSoon: EODOpenStoreCredit[];
  confidence: EODBriefConfidence;
}

// ── Top-level result ─────────────────────────────────────

export interface EODBriefResult {
  generatedAtMs: number;
  dayStartMs: number;
  dayEndMs: number;
  money: EODMoneySection;
  openItems: EODOpenItemsSection;
  lang: Lang3;
}
