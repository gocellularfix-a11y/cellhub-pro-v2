// ============================================================
// CellHub Pro — Store Credit void-reversal engine (P0-SC-2)
//
// When a committed sale that redeemed Store Credit certificates is processed
// through Void & Reverse Payment (ReportsModule.handleVoidSale), the exact
// redeemed amounts must be restored to their original certificates.
//
// Source of truth: the LEDGER, not the sale lines. A certificate that holds a
// redemption row with redemptions[].saleId === sale.id was really debited by
// that sale — that persisted identity (amount + certificate) drives the
// restoration. Sale lines are only used as a fail-closed cross-check: a line
// claiming a certificate (storeCreditLedgerId) whose ledger entry does not
// exist means the ledger identity is unrecoverable → the whole reversal fails
// closed and the caller must NOT void the sale.
//
// Movements are APPEND-ONLY: the original redemption is never edited or
// deleted; a reversal row is appended and the redeemed/remaining totals are
// recomputed deterministically. reversals[].originalSaleId is the idempotency
// key — duplicate execution (double-click, restart, replay) is a no-op.
//
// ALL-OR-NOTHING: any failure returns ok:false with ZERO mutations so the
// caller can abort the void and preserve every existing financial state.
//
// Pure: no React, no persist, no I/O. Caller applies `ledger` + `ops`.
// ============================================================

import type { Sale, StoreCreditLedger, StoreCreditReversal } from '@/store/types';
import { generateId } from '@/utils/dates';
import { belongsToStore } from '@/store/storeScope';

export interface ReverseFailure {
  ledgerId?: string;
  cause: 'entry_not_found' | 'wrong_store' | 'voided_certificate' | 'exceeds_issued';
  saleId: string;
  details?: Record<string, unknown>;
}

export interface ReverseRestored {
  ledgerId: string;
  certificateNumber: string;
  restoredCents: number;
}

export interface ReverseResult {
  /** false = fail closed: NOTHING changed; caller must abort the void. */
  ok: boolean;
  /** true when at least one certificate was restored (ok && restored.length > 0). */
  changed: boolean;
  ledger: StoreCreditLedger[];
  ops: Array<{ collection: 'storeCreditLedger'; id: string; data: Record<string, unknown> }>;
  restored: ReverseRestored[];
  /** Certificates already reversed for this sale (idempotent no-ops). */
  alreadyReversed: string[];
  /** Cert lines whose entry exists but holds NO redemption for this sale —
   *  the debit never happened (pre-P0-SC-1 sales), so nothing is restored.
   *  Informational; does not block the void. */
  nothingToRestore: string[];
  failures: ReverseFailure[];
}

export interface ReverseInput {
  employeeId?: string;
  employeeName: string;
  /** Void reason / reference stamped on the reversal movement. */
  reversalReference?: string;
  /** ISO; defaults to now. */
  reversedAt?: string;
  /** Active store scope of the committing machine (''/'default'/undefined = unscoped). */
  currentStoreId?: string | null;
}

/**
 * Compute the certificate restorations for voiding `sale`. Pure.
 */
export function reverseStoreCreditForSale(
  sale: Sale,
  ledger: StoreCreditLedger[] | null | undefined,
  input: ReverseInput,
): ReverseResult {
  const baseLedger = Array.isArray(ledger) ? ledger : [];
  const result: ReverseResult = {
    ok: true, changed: false, ledger: baseLedger, ops: [],
    restored: [], alreadyReversed: [], nothingToRestore: [], failures: [],
  };
  if (!sale || !Array.isArray(sale.items)) return result;

  // ── Fail-closed cross-check: every sale line that claims a certificate must
  // resolve to an existing ledger entry. A missing entry = unrecoverable
  // identity → abort (never guess, never credit an arbitrary certificate).
  const claimedIds = new Set<string>();
  for (const it of sale.items) {
    const lid = (it as unknown as { storeCreditLedgerId?: string }).storeCreditLedgerId;
    if (lid) claimedIds.add(lid);
  }
  for (const lid of claimedIds) {
    if (!baseLedger.some((l) => l.id === lid)) {
      result.failures.push({ ledgerId: lid, cause: 'entry_not_found', saleId: sale.id });
    }
  }

  // ── Authoritative reversal set: entries whose redemptions reference this sale.
  const affected = baseLedger.filter((l) => (l.redemptions || []).some((r) => r.saleId === sale.id));

  // Cert lines that resolved to an entry but were never debited (DOA-era):
  // provably nothing to restore — informational only.
  for (const lid of claimedIds) {
    const entry = baseLedger.find((l) => l.id === lid);
    if (entry && !affected.some((a) => a.id === lid)) result.nothingToRestore.push(lid);
  }

  const reversedAt = input.reversedAt || new Date().toISOString();
  const ledgerCopy = [...baseLedger];
  const scoped = !!input.currentStoreId && input.currentStoreId !== 'default';

  for (const entry of affected) {
    // Idempotency: one reversal per (certificate, originalSaleId).
    if ((entry.reversals || []).some((r) => r.originalSaleId === sale.id)) {
      result.alreadyReversed.push(entry.id);
      continue;
    }
    // Store scope: a certificate outside the committing machine's scope is
    // never altered (canonical belongsToStore; legacy no-storeId passes).
    if (scoped && !belongsToStore(entry.storeId, input.currentStoreId as string)) {
      result.failures.push({ ledgerId: entry.id, cause: 'wrong_store', saleId: sale.id, details: { entryStoreId: entry.storeId } });
      continue;
    }
    // A voided certificate is FROZEN by the existing void policy — restoring
    // value into it would silently strand money. Manager review required.
    if (entry.status === 'voided') {
      result.failures.push({ ledgerId: entry.id, cause: 'voided_certificate', saleId: sale.id });
      continue;
    }

    const restoreCents = (entry.redemptions || [])
      .filter((r) => r.saleId === sale.id)
      .reduce((s, r) => s + (r.redeemedAmount || 0), 0);
    if (restoreCents <= 0) { result.nothingToRestore.push(entry.id); continue; }

    const newRedeemed = (entry.redeemedAmount || 0) - restoreCents;
    if (newRedeemed < 0) {
      // Data corruption: restoring more than was ever redeemed would exceed
      // the issued amount. Never fabricate — fail closed.
      result.failures.push({
        ledgerId: entry.id, cause: 'exceeds_issued', saleId: sale.id,
        details: { restoreCents, redeemedCents: entry.redeemedAmount || 0, issuedCents: entry.issuedAmount || 0 },
      });
      continue;
    }
    const newRemaining = Math.min(entry.issuedAmount || 0, Math.max(0, (entry.issuedAmount || 0) - newRedeemed));

    const reversal: StoreCreditReversal = {
      id: generateId(),
      reversedAt,
      restoredAmount: restoreCents,
      originalSaleId: sale.id,
      originalInvoiceNumber: sale.invoiceNumber,
      reversalReference: input.reversalReference,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
    };

    const updated: StoreCreditLedger = {
      ...entry,
      redeemedAmount: newRedeemed,
      remainingAmount: newRemaining,
      // A fully-redeemed certificate becomes active again once value returns.
      status: entry.status === 'redeemed' && newRemaining > 0 ? 'active' : entry.status,
      reversals: [...(entry.reversals || []), reversal],
    };
    const idx = ledgerCopy.findIndex((l) => l.id === entry.id);
    ledgerCopy[idx] = updated;
    result.restored.push({ ledgerId: entry.id, certificateNumber: entry.certificateNumber, restoredCents: restoreCents });
  }

  if (result.failures.length > 0) {
    // FAIL CLOSED — discard every computed restoration; caller aborts the void.
    return {
      ok: false, changed: false, ledger: baseLedger, ops: [],
      restored: [], alreadyReversed: result.alreadyReversed,
      nothingToRestore: result.nothingToRestore, failures: result.failures,
    };
  }

  if (result.restored.length > 0) {
    result.changed = true;
    result.ledger = ledgerCopy;
    result.ops = result.restored.map(({ ledgerId }) => {
      const entry = ledgerCopy.find((l) => l.id === ledgerId)!;
      return { collection: 'storeCreditLedger' as const, id: ledgerId, data: entry as unknown as Record<string, unknown> };
    });
  }
  return result;
}
