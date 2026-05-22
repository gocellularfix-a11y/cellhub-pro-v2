// ============================================================
// CellHub Pro — Store Credit Ledger (R-STORE-CREDIT-REDEMPTION-SYSTEM)
// Pure logic. No React, no DOM, no I/O. Callers persist + setState.
//
// Invariants (enforced by the guards in this file):
//   - issuedAmount is immutable post-creation.
//   - redeemedAmount === sum(redemptions[].redeemedAmount).
//   - remainingAmount === max(0, issuedAmount - redeemedAmount).
//   - status === 'voided'  → ledger is FROZEN. No further redemption.
//   - status === 'redeemed' → remainingAmount === 0. Further redemption is rejected.
//   - status === 'active'  → remaining > 0. May accept partial redemptions.
//   - Redemptions never produce a negative balance (over-redemption is rejected).
// ============================================================

import type { StoreCreditLedger, StoreCreditRedemption } from '@/store/types';
import { generateId } from '@/utils/dates';

// ── ID helpers ────────────────────────────────────────────

/**
 * Mint a new certificate number. Format: `SC-{ts8}-{rand4}` — same shape used
 * by ReturnsModule before the dedicated ledger existed. Kept stable so prior
 * cert IDs remain valid as ledger identifiers.
 */
export function mintCertificateNumber(): string {
  const ts8 = Date.now().toString().slice(-8);
  const rand4 = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SC-${ts8}-${rand4}`;
}

// ── Issuance ──────────────────────────────────────────────

export interface IssueLedgerInput {
  certificateNumber: string;
  amountCents: number;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  employeeId?: string;
  employeeName: string;
  sourceReturnId?: string;
  sourceReturnNumber?: string;
  notes?: string;
  /** ISO; defaults to now. */
  issuedAt?: string;
}

/**
 * Build a fresh ledger entry. Pure: caller persists.
 * Throws on non-positive / non-finite amount.
 */
export function issueLedgerEntry(input: IssueLedgerInput): StoreCreditLedger {
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('issueLedgerEntry: amountCents must be a positive integer');
  }
  const issuedAt = input.issuedAt || new Date().toISOString();
  return {
    id: generateId(),
    certificateNumber: input.certificateNumber,
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    issuedAmount: amount,
    redeemedAmount: 0,
    remainingAmount: amount,
    status: 'active',
    issuedAt,
    issuedByEmployeeId: input.employeeId,
    issuedByEmployeeName: input.employeeName,
    sourceReturnId: input.sourceReturnId,
    sourceReturnNumber: input.sourceReturnNumber,
    redemptions: [],
    notes: input.notes,
  };
}

// ── Lookup ────────────────────────────────────────────────

/**
 * Find the ledger entry for a certificate number. Case-insensitive on the
 * certificate id only (employees occasionally type lower-case). Returns null
 * when nothing matches.
 */
export function findCertificate(
  ledger: StoreCreditLedger[] | null | undefined,
  certificateNumber: string,
): StoreCreditLedger | null {
  if (!Array.isArray(ledger) || !certificateNumber) return null;
  const q = certificateNumber.trim().toUpperCase();
  if (!q) return null;
  return ledger.find((l) => (l.certificateNumber || '').toUpperCase() === q) || null;
}

/**
 * All ledger entries linked to a given customer id. Used by the customer
 * profile cert-history view.
 */
export function ledgerEntriesForCustomer(
  ledger: StoreCreditLedger[] | null | undefined,
  customerId: string,
): StoreCreditLedger[] {
  if (!Array.isArray(ledger) || !customerId) return [];
  return ledger.filter((l) => l.customerId === customerId);
}

// ── Redemption ────────────────────────────────────────────

export interface RedeemLedgerInput {
  amountCents: number;
  saleId?: string;
  invoiceNumber?: string;
  employeeId?: string;
  employeeName: string;
  /** ISO; defaults to now. */
  redeemedAt?: string;
}

export interface RedeemResult {
  ledger: StoreCreditLedger;        // updated ledger entry (caller persists)
  redemption: StoreCreditRedemption; // new redemption row that was appended
}

/**
 * Apply a partial or full redemption to an active ledger entry. Rejects:
 *   - non-finite / non-positive amount
 *   - status !== 'active' (voided / expired / fully redeemed)
 *   - amount > remainingAmount (over-redemption)
 *
 * Returns the updated ledger + the appended redemption. Caller persists.
 */
export function redeemLedgerEntry(
  ledger: StoreCreditLedger,
  input: RedeemLedgerInput,
): RedeemResult {
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('redeemLedgerEntry: amountCents must be a positive integer');
  }
  if (ledger.status !== 'active') {
    throw new Error(`redeemLedgerEntry: ledger status is "${ledger.status}" — only active certificates can be redeemed`);
  }
  const remaining = Math.max(0, ledger.remainingAmount || 0);
  if (amount > remaining) {
    throw new Error(`redeemLedgerEntry: amount ${amount} exceeds remaining balance ${remaining}`);
  }

  const redemption: StoreCreditRedemption = {
    id: generateId(),
    redeemedAt: input.redeemedAt || new Date().toISOString(),
    redeemedAmount: amount,
    remainingAfter: remaining - amount,
    saleId: input.saleId,
    invoiceNumber: input.invoiceNumber,
    employeeId: input.employeeId,
    employeeName: input.employeeName,
  };

  const newRedeemed = (ledger.redeemedAmount || 0) + amount;
  const newRemaining = Math.max(0, (ledger.issuedAmount || 0) - newRedeemed);

  const updated: StoreCreditLedger = {
    ...ledger,
    redeemedAmount: newRedeemed,
    remainingAmount: newRemaining,
    status: newRemaining === 0 ? 'redeemed' : 'active',
    redemptions: [...(ledger.redemptions || []), redemption],
  };

  return { ledger: updated, redemption };
}

// ── Void ──────────────────────────────────────────────────

export interface VoidLedgerInput {
  employeeId?: string;
  employeeName: string;
  reason?: string;
  /** ISO; defaults to now. */
  voidedAt?: string;
}

/**
 * Void a ledger entry. Sets status='voided', preserves redemptions.
 * Rejects double-void. A voided cert with prior redemptions stays viewable
 * in reports — the remaining balance is just no longer redeemable.
 *
 * NOTE: voiding does NOT roll back prior sales that already redeemed credit.
 * Those sales remain valid — the void is forward-looking only.
 */
export function voidLedgerEntry(
  ledger: StoreCreditLedger,
  input: VoidLedgerInput,
): StoreCreditLedger {
  if (ledger.status === 'voided') {
    throw new Error('voidLedgerEntry: certificate is already voided');
  }
  const voidedAt = input.voidedAt || new Date().toISOString();
  return {
    ...ledger,
    status: 'voided',
    remainingAmount: 0,
    voidedAt,
    voidedByEmployeeId: input.employeeId,
    voidedByEmployeeName: input.employeeName,
    voidReason: input.reason,
  };
}

// ── Aggregates (Reports / dashboards) ─────────────────────

export interface LedgerSummary {
  issuedCount: number;
  issuedTotalCents: number;
  redeemedTotalCents: number;
  activeLiabilityCents: number;     // sum(remainingAmount where status === 'active')
  voidedCount: number;
  voidedRemainingCents: number;     // remaining at time of void, captured BEFORE clearing
  redemptionCount: number;
}

/**
 * Compact aggregate view of the entire ledger. Used by Reports.
 * Pure reduce — safe to call inside render / useMemo.
 */
export function summarizeLedger(
  ledger: StoreCreditLedger[] | null | undefined,
): LedgerSummary {
  const empty: LedgerSummary = {
    issuedCount: 0,
    issuedTotalCents: 0,
    redeemedTotalCents: 0,
    activeLiabilityCents: 0,
    voidedCount: 0,
    voidedRemainingCents: 0,
    redemptionCount: 0,
  };
  if (!Array.isArray(ledger) || ledger.length === 0) return empty;
  return ledger.reduce((acc, l) => {
    acc.issuedCount++;
    acc.issuedTotalCents += l.issuedAmount || 0;
    acc.redeemedTotalCents += l.redeemedAmount || 0;
    acc.redemptionCount += (l.redemptions || []).length;
    if (l.status === 'active') acc.activeLiabilityCents += l.remainingAmount || 0;
    if (l.status === 'voided') acc.voidedCount++;
    return acc;
  }, { ...empty });
}
