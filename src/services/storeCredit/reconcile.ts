// ============================================================
// CellHub Pro — Store Credit ledger reconciliation (P0-SC-1.1)
//
// Deterministic recovery for the one failure window the checkout cannot
// close on its own: a sale was persisted but the matching certificate debit
// never landed (crash / storage-quota failure between persist.sale and
// batchSave(ledgerOps)). Committed sales are the journal: every canonical
// Apply-Store-Credit line (category 'exchange_credit', negative price,
// storeCreditLedgerId) MUST have a ledger redemption keyed by that sale.id.
//
// Pure: no React, no persist, no I/O. The caller (AppShell, on startup,
// never on a read-only LAN Secondary) applies `ledger` + `ops` and logs
// `repaired`/`conflicts` (ids + cents only — no PII).
//
// Idempotent by construction: redemptions[].saleId is the marker, so a
// second pass over already-repaired data changes nothing.
//
// NEVER fabricates money: a missed debit that no longer fits (cert voided /
// insufficient remaining because later sales consumed it) is reported as a
// conflict for the owner/auditor — it is not clamped or partially applied.
// ============================================================

import type { Sale, StoreCreditLedger } from '@/store/types';
import { redeemLedgerEntry } from './ledger';

export interface ReconcileRepair {
  saleId: string;
  invoiceNumber?: string;
  ledgerId: string;
  amountCents: number;
}

export interface ReconcileConflict {
  saleId: string;
  ledgerId: string;
  amountCents: number;
  cause: 'not_found' | 'apply_rejected';
}

export interface ReconcileOp {
  collection: 'storeCreditLedger';
  id: string;
  data: Record<string, unknown>;
}

export interface LedgerReconcileResult {
  changed: boolean;
  ledger: StoreCreditLedger[];
  ops: ReconcileOp[];
  repaired: ReconcileRepair[];
  conflicts: ReconcileConflict[];
}

/**
 * Re-derive missing certificate debits from committed sales. Sales are
 * processed in createdAt order (deterministic); 'voided' sales are excluded
 * (refund/audit records, never a committed checkout).
 */
export function reconcileStoreCreditLedger(
  sales: Sale[] | null | undefined,
  ledger: StoreCreditLedger[] | null | undefined,
): LedgerReconcileResult {
  const baseLedger = Array.isArray(ledger) ? ledger : [];
  const empty: LedgerReconcileResult = { changed: false, ledger: baseLedger, ops: [], repaired: [], conflicts: [] };
  if (!Array.isArray(sales) || sales.length === 0 || baseLedger.length === 0) return empty;

  const ledgerCopy = [...baseLedger];
  const repaired: ReconcileRepair[] = [];
  const conflicts: ReconcileConflict[] = [];
  const changedIds = new Set<string>();

  const ordered = sales
    .filter((s) => s && String(s.status || '') !== 'voided' && Array.isArray(s.items))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  for (const s of ordered) {
    // Aggregate this sale's certificate deltas — SAME line rules as the
    // finalizeSaleCore pre-flight (canonical modal lines only; qty ?? 1 so an
    // explicit 0 contributes nothing; malformed lines are never debited here).
    const deltas = new Map<string, number>();
    for (const it of s.items) {
      const lid = (it as unknown as { storeCreditLedgerId?: string }).storeCreditLedgerId;
      if (!lid) continue;
      if (String(it.category || '') !== 'exchange_credit') continue;
      const price = it.price || 0;
      if (price > 0) continue;
      const absCents = Math.abs(price * (it.qty ?? 1));
      if (absCents <= 0) continue;
      deltas.set(lid, (deltas.get(lid) || 0) + absCents);
    }

    for (const [lid, cents] of deltas) {
      const idx = ledgerCopy.findIndex((l) => l.id === lid);
      if (idx < 0) {
        conflicts.push({ saleId: s.id, ledgerId: lid, amountCents: cents, cause: 'not_found' });
        continue;
      }
      if ((ledgerCopy[idx].redemptions || []).some((r) => r.saleId === s.id)) continue; // already debited
      try {
        const { ledger: next } = redeemLedgerEntry(ledgerCopy[idx], {
          amountCents: cents,
          saleId: s.id,
          invoiceNumber: s.invoiceNumber,
          employeeId: s.employeeId,
          employeeName: s.employeeName || 'reconciliation',
        });
        ledgerCopy[idx] = next;
        changedIds.add(lid);
        repaired.push({ saleId: s.id, invoiceNumber: s.invoiceNumber, ledgerId: lid, amountCents: cents });
      } catch {
        // Voided / depleted / over-remaining — unrecoverable without policy.
        // Surface, never clamp.
        conflicts.push({ saleId: s.id, ledgerId: lid, amountCents: cents, cause: 'apply_rejected' });
      }
    }
  }

  if (changedIds.size === 0) {
    return { changed: false, ledger: baseLedger, ops: [], repaired: [], conflicts };
  }
  // One op per changed entry, built from the FINAL version (an entry repaired
  // for several sales persists once with all redemptions).
  const ops: ReconcileOp[] = [...changedIds].map((id) => {
    const entry = ledgerCopy.find((l) => l.id === id)!;
    return { collection: 'storeCreditLedger', id, data: entry as unknown as Record<string, unknown> };
  });
  return { changed: true, ledger: ledgerCopy, ops, repaired, conflicts };
}
