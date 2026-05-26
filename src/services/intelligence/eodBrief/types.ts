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
 *   placeholder — shape is populated but the values are stubs (all
 *                 zeros). Downstream UI MUST NOT render the numbers
 *                 as financial truth when this tag is present.
 */
export type EODBriefConfidence = 'high' | 'medium' | 'low' | 'placeholder';

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
  grossProfitCents: number;
  profitMarginPct: number;       // 0–100
  saleCount: number;
  returnCount: number;
  returnedAmountCents: number;
  tenderBreakdown: EODMoneyTenderBreakdown;
  feesAndTaxes: EODMoneyFeesAndTaxes;
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
