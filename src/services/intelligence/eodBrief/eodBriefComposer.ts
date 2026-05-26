// ============================================================
// CellHub Intelligence — End-of-Day Brief Composer
// R-EOD-BRIEF F1 (Phase 1: open items + money placeholder)
//
// Deterministic compressed end-of-day digest. Composes structured
// data only — no formatted strings, no LLM, no inference. Same
// inputs → same output. UI / chat layers add language strings on top.
//
// Phase 1 scope (this file):
//   - money: SHAPE complete, ALL VALUES = 0, confidence='placeholder'.
//     Money math will be extracted from ReportsModule in a separate
//     round (R-REPORTS-MONEY-EXTRACT) and dropped in additively here.
//   - openItems: fully functional.
//       repairsPendingTomorrow: active repairs, sorted by daysOpen desc, cap 5
//       layawaysDueThisWeek:    active layaways with dueDate in [0..7] days, cap 5
//       externalPaymentsPending: max 1 item via getDueVerification()
//       storeCreditExpiringSoon: certs with expiresAt in (0..30] days, cap 5
//
// Why placeholder money instead of partial math:
//   Inline-replicating ReportsModule's profit pipeline (310+ lines,
//   8 item-kind cost rules, pseudo-item proportional cost, vendor return
//   COGS reduction, returns profit adjustment) inside this composer would
//   guarantee silent drift on every future Reports change. Schema-first
//   keeps the contract stable for downstream UI; the extraction round
//   replaces the placeholder additively without changing this file's
//   surface or the result shape.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Lang3 } from '../chat/handlers';
import type { Repair, Layaway, StoreCreditLedger } from '@/store/types';
import { parseTimestampSafe, startOfDayMs } from '../utils/timestamps';
import { isDoneRepairStatus } from '@/utils/repairStatus';
import { getDueVerification } from '../paymentVerification/paymentVerificationService';
import { calculateLayawayTotals } from '@/services/layaway/payments';
import type {
  EODBriefResult,
  EODMoneySection,
  EODOpenItemsSection,
  EODOpenRepair,
  EODOpenLayaway,
  EODOpenExternalPayment,
  EODOpenStoreCredit,
} from './types';

const MS_PER_DAY = 86_400_000;

const REPAIRS_CAP            = 5;
const LAYAWAYS_CAP           = 5;
const STORE_CREDIT_CAP       = 5;
const LAYAWAY_DUE_WINDOW_DAYS    = 7;
const STORE_CREDIT_EXPIRY_DAYS   = 30;

// ── Money placeholder ────────────────────────────────────

/**
 * R-EOD-BRIEF F2.3 — Today-anchored sale count delegates to the engine's
 * canonical helper. Previously countTodaySales kept its own filter
 * (parseTimestampSafe + startOfDayMs + isCountableSale), which mirrored
 * ReportsModule semantically but lived as a parallel implementation. That
 * created a divergence surface: 'final del día' could disagree with
 * 'ventas de hoy' (which already reads engine.getTodayMetrics) on edge-
 * shape timestamps or future fixes to one filter that miss the other.
 *
 * Now both intents share one filter. Order matters: eliminate divergence
 * first, then centralize architecture later via the operational snapshot.
 */
function countTodaySales(engine: IntelligenceEngine): number {
  return engine.getTodayMetrics().transactions;
}

function placeholderMoneySection(saleCount: number): EODMoneySection {
  return {
    grossRevenueCents: 0,
    netRevenueCents: 0,
    grossProfitCents: 0,
    profitMarginPct: 0,
    saleCount,
    returnCount: 0,
    returnedAmountCents: 0,
    tenderBreakdown: {
      cashCents: 0,
      cardCents: 0,
      storeCreditCents: 0,
      externalCents: 0,
      otherCents: 0,
    },
    feesAndTaxes: {
      salesTaxCents: 0,
      utilityTaxCents: 0,
      caMobilityFeeCents: 0,
      cbeFeeCents: 0,
      screenFeeCents: 0,
      totalCents: 0,
    },
    confidence: 'placeholder',
  };
}

// ── Open items ───────────────────────────────────────────

function buildRepairsPendingTomorrow(
  engine: IntelligenceEngine,
  nowMs: number,
): EODOpenRepair[] {
  const repairs: Repair[] = engine.getRepairs() || [];
  const active = repairs.filter((r) => !isDoneRepairStatus(r.status));
  const enriched: Array<EODOpenRepair & { _sortKey: number }> = [];
  for (const r of active) {
    const createdMs = parseTimestampSafe(r.createdAt);
    // Repairs without a parseable createdAt still surface as 0-day so the
    // operator sees them — better than silently dropping a real ticket.
    const daysOpen = createdMs === null
      ? 0
      : Math.max(0, Math.floor((nowMs - createdMs) / MS_PER_DAY));
    enriched.push({
      id: r.id,
      device: r.device || '',
      customerName: r.customerName || '',
      daysOpen,
      _sortKey: daysOpen,
    });
  }
  enriched.sort((a, b) => b._sortKey - a._sortKey);
  return enriched.slice(0, REPAIRS_CAP).map(({ _sortKey: _s, ...rest }) => {
    void _s;
    return rest;
  });
}

function buildLayawaysDueThisWeek(
  engine: IntelligenceEngine,
  nowMs: number,
): EODOpenLayaway[] {
  const layaways: Layaway[] = engine.getLayaways() || [];
  const dayStart = startOfDayMs(nowMs);
  const enriched: Array<EODOpenLayaway & { _sortKey: number }> = [];
  for (const l of layaways) {
    if (String(l.status || '').toLowerCase() !== 'active') continue;
    if (!l.dueDate) continue;
    const dueMs = parseTimestampSafe(l.dueDate);
    if (dueMs === null) continue;
    const daysUntilDue = Math.floor((dueMs - dayStart) / MS_PER_DAY);
    // Window: today through one week out. Past-due is a separate concept
    // (future round) — exclude here to keep "due THIS week" semantics tight.
    if (daysUntilDue < 0 || daysUntilDue > LAYAWAY_DUE_WINDOW_DAYS) continue;
    const totals = calculateLayawayTotals(l);
    enriched.push({
      id: l.id,
      customerName: l.customerName || '',
      balanceCents: totals.remainingBalanceCents,
      daysUntilDue,
      _sortKey: daysUntilDue,
    });
  }
  enriched.sort((a, b) => a._sortKey - b._sortKey);
  return enriched.slice(0, LAYAWAYS_CAP).map(({ _sortKey: _s, ...rest }) => {
    void _s;
    return rest;
  });
}

function buildExternalPaymentsPending(nowMs: number): EODOpenExternalPayment[] {
  // getDueVerification returns at most ONE pending verification (the
  // most-overdue, today-only). Phase 1 surfaces what the existing helper
  // exposes — broader scanning of the pending queue is a Phase 2 concern.
  const due = getDueVerification(nowMs);
  if (!due) return [];
  const daysSinceCreated = Math.max(0, Math.floor((nowMs - due.createdAt) / MS_PER_DAY));
  return [
    {
      id: due.verificationId,
      customerName: due.customerName || '',
      amountCents: due.amountCents,
      daysSinceCreated,
      carrier: due.carrier || '',
    },
  ];
}

function buildStoreCreditExpiringSoon(
  engine: IntelligenceEngine,
  nowMs: number,
): EODOpenStoreCredit[] {
  const ledger: StoreCreditLedger[] = engine.getStoreCreditLedger() || [];
  const enriched: Array<EODOpenStoreCredit & { _sortKey: number }> = [];
  for (const c of ledger) {
    if (c.status !== 'active') continue;
    if (!c.expiresAt) continue;
    const expiresMs = parseTimestampSafe(c.expiresAt);
    if (expiresMs === null) continue;
    const daysUntilExpiry = Math.floor((expiresMs - nowMs) / MS_PER_DAY);
    if (daysUntilExpiry <= 0 || daysUntilExpiry > STORE_CREDIT_EXPIRY_DAYS) continue;
    enriched.push({
      certId: c.id,
      customerName: c.customerName || '',
      balanceCents: c.remainingAmount || 0,
      daysUntilExpiry,
      _sortKey: daysUntilExpiry,
    });
  }
  enriched.sort((a, b) => a._sortKey - b._sortKey);
  return enriched.slice(0, STORE_CREDIT_CAP).map(({ _sortKey: _s, ...rest }) => {
    void _s;
    return rest;
  });
}

function buildOpenItemsSection(
  engine: IntelligenceEngine,
  nowMs: number,
): EODOpenItemsSection {
  return {
    repairsPendingTomorrow:    buildRepairsPendingTomorrow(engine, nowMs),
    layawaysDueThisWeek:       buildLayawaysDueThisWeek(engine, nowMs),
    externalPaymentsPending:   buildExternalPaymentsPending(nowMs),
    storeCreditExpiringSoon:   buildStoreCreditExpiringSoon(engine, nowMs),
    // Open-items math is deterministic — every count is a literal filter
    // over canonical collections. No estimation, no scaling, no fallback math.
    confidence: 'high',
  };
}

// ── Public entry point ───────────────────────────────────

export function composeEODBrief(
  engine: IntelligenceEngine,
  lang: Lang3,
  nowMs?: number,
): EODBriefResult {
  const now = nowMs ?? Date.now();
  const dayStartMs = startOfDayMs(now);
  const dayEndMs   = now;
  const saleCount  = countTodaySales(engine);

  return {
    generatedAtMs: now,
    dayStartMs,
    dayEndMs,
    money: placeholderMoneySection(saleCount),
    openItems: buildOpenItemsSection(engine, now),
    lang,
  };
}
