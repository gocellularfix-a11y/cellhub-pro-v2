// ============================================================
// P0-SC-2 — Void & Reverse store-credit restoration tests
// Engine-level coverage of the 13 mandated behaviors. The ReportsModule
// wiring applies this engine all-or-nothing BEFORE persisting the void.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Sale, StoreCreditLedger } from '@/store/types';
import { reverseStoreCreditForSale } from './reverse';
import { reconcileStoreCreditLedger } from './reconcile';

function cert(over: Partial<StoreCreditLedger> = {}): StoreCreditLedger {
  return {
    id: 'ledger-1', certificateNumber: 'SC-1', customerId: 'c1', customerName: 'Jorge O',
    issuedAmount: 23270, redeemedAmount: 0, remainingAmount: 23270, status: 'active',
    issuedAt: '2026-07-01T00:00:00.000Z', issuedByEmployeeName: 'Emp', redemptions: [],
    ...over,
  } as StoreCreditLedger;
}

/** Certificate that was debited $21.85 by sale-x (the redemption to reverse). */
function debitedCert(over: Partial<StoreCreditLedger> = {}): StoreCreditLedger {
  return cert({
    redeemedAmount: 2185, remainingAmount: 21085,
    redemptions: [{ id: 'rd1', redeemedAt: '2026-07-22T10:00:00.000Z', redeemedAmount: 2185, remainingAfter: 21085, saleId: 'sale-x', invoiceNumber: 'INV-X', employeeName: 'E' }],
    ...over,
  });
}

function voidedSale(over: Partial<Sale> = {}): Sale {
  return {
    id: 'sale-x', invoiceNumber: 'INV-X', status: 'completed', createdAt: '2026-07-22T10:00:00.000Z',
    paymentMethod: 'Cash', total: 0, subtotal: 0, taxAmount: 0, salesTax: 0,
    items: [{
      id: 'l1', name: 'Store Credit (SC-1)', category: 'exchange_credit', price: -2185, qty: 1,
      taxable: false, cbeEligible: false, storeCreditLedgerId: 'ledger-1', storeCreditCertNumber: 'SC-1',
    }],
    ...over,
  } as unknown as Sale;
}

const opts = { employeeName: 'Mgr', reversalReference: 'void:test', currentStoreId: undefined };

describe('reverseStoreCreditForSale (P0-SC-2)', () => {
  it('1. restores a single certificate redemption exactly once, appending a reversal movement', () => {
    const r = reverseStoreCreditForSale(voidedSale(), [debitedCert()], opts);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.restored).toEqual([{ ledgerId: 'ledger-1', certificateNumber: 'SC-1', restoredCents: 2185 }]);
    const entry = r.ledger.find((l) => l.id === 'ledger-1')!;
    expect(entry.redeemedAmount).toBe(0);
    expect(entry.remainingAmount).toBe(23270);
    // Original redemption history preserved; reversal appended.
    expect(entry.redemptions).toHaveLength(1);
    expect(entry.redemptions[0].redeemedAmount).toBe(2185);
    expect(entry.reversals).toHaveLength(1);
    expect(entry.reversals![0]).toMatchObject({
      restoredAmount: 2185, originalSaleId: 'sale-x', originalInvoiceNumber: 'INV-X',
      reversalReference: 'void:test', employeeName: 'Mgr',
    });
    expect(r.ops).toHaveLength(1);
  });

  it('2. duplicate Void & Reverse is a no-op (idempotency key = originalSaleId)', () => {
    const first = reverseStoreCreditForSale(voidedSale(), [debitedCert()], opts);
    const again = reverseStoreCreditForSale(voidedSale(), first.ledger, opts);
    expect(again.ok).toBe(true);
    expect(again.changed).toBe(false);
    expect(again.restored).toHaveLength(0);
    expect(again.alreadyReversed).toEqual(['ledger-1']);
    const entry = again.ledger.find((l) => l.id === 'ledger-1')!;
    expect(entry.remainingAmount).toBe(23270);      // not restored twice
    expect(entry.reversals).toHaveLength(1);
  });

  it('3. restart/reconciliation never re-debits a voided sale nor repeats the restoration', () => {
    const reversed = reverseStoreCreditForSale(voidedSale(), [debitedCert()], opts);
    // The sale is now status 'voided' in the store — reconciliation skips it
    // entirely (voided sales are excluded), and the preserved redemption row
    // would satisfy its idempotency check anyway.
    const rec = reconcileStoreCreditLedger(
      [voidedSale({ status: 'voided' as Sale['status'] })],
      reversed.ledger,
    );
    expect(rec.changed).toBe(false);
    expect(rec.ledger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(23270);
    // And a replayed reversal is still a no-op (test 2 semantics after restart).
    const replay = reverseStoreCreditForSale(voidedSale(), reversed.ledger, opts);
    expect(replay.changed).toBe(false);
  });

  it('4/5. mixed cash/card + certificate: restores ONLY the certificate portion (from the redemption row)', () => {
    // $100 sale = $21.85 certificate + $78.15 cash — the ledger redemption
    // (not the sale total) drives the restoration.
    const s = voidedSale({
      total: 7815, paymentMethod: 'Cash',
      items: [
        { id: 'p', name: 'Phone case', category: 'accessory', price: 10000, qty: 1, taxable: false, cbeEligible: false },
        ...voidedSale().items,
      ],
    } as Partial<Sale>);
    const r = reverseStoreCreditForSale(s, [debitedCert()], opts);
    expect(r.ok).toBe(true);
    expect(r.restored[0].restoredCents).toBe(2185);   // NOT 10000, NOT 7815
    const card = reverseStoreCreditForSale(voidedSale({ paymentMethod: 'Card', total: 7815 } as Partial<Sale>), [debitedCert()], opts);
    expect(card.restored[0].restoredCents).toBe(2185);
  });

  it('6. multiple certificates in one sale are restored independently by ledger identity', () => {
    const certA = debitedCert();
    const certB = cert({
      id: 'ledger-2', certificateNumber: 'SC-2', issuedAmount: 5000,
      redeemedAmount: 1500, remainingAmount: 3500,
      redemptions: [{ id: 'rd2', redeemedAt: 'x', redeemedAmount: 1500, remainingAfter: 3500, saleId: 'sale-x', employeeName: 'E' }],
    });
    const r = reverseStoreCreditForSale(voidedSale(), [certA, certB], opts);
    expect(r.ok).toBe(true);
    expect(r.restored).toHaveLength(2);
    expect(r.ledger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(23270);
    expect(r.ledger.find((l) => l.id === 'ledger-2')!.remainingAmount).toBe(5000);
  });

  it('7. a fully depleted certificate becomes ACTIVE again after restoration', () => {
    const depleted = cert({
      redeemedAmount: 23270, remainingAmount: 0, status: 'redeemed',
      redemptions: [
        { id: 'rd0', redeemedAt: 'x', redeemedAmount: 21085, remainingAfter: 2185, saleId: 'sale-other', employeeName: 'E' },
        { id: 'rd1', redeemedAt: 'y', redeemedAmount: 2185, remainingAfter: 0, saleId: 'sale-x', employeeName: 'E' },
      ],
    });
    const r = reverseStoreCreditForSale(voidedSale(), [depleted], opts);
    expect(r.ok).toBe(true);
    const entry = r.ledger.find((l) => l.id === 'ledger-1')!;
    expect(entry.remainingAmount).toBe(2185);
    expect(entry.status).toBe('active');              // redeemable again
    expect(entry.redemptions).toHaveLength(2);        // history intact
  });

  it('8. a restored balance can never exceed the issued amount (corrupt data fails closed)', () => {
    const corrupt = debitedCert({ redeemedAmount: 1000 }); // redemption row says 2185 but total says 1000
    const r = reverseStoreCreditForSale(voidedSale(), [corrupt], opts);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatchObject({ cause: 'exceeds_issued', ledgerId: 'ledger-1' });
    expect(r.ledger.find((l) => l.id === 'ledger-1')!.redeemedAmount).toBe(1000); // untouched
  });

  it('9. a wrong-store certificate is never altered (fail closed under scoped view)', () => {
    const foreign = debitedCert({ storeId: 'store-B' });
    const r = reverseStoreCreditForSale(voidedSale(), [foreign], { ...opts, currentStoreId: 'store-A' });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatchObject({ cause: 'wrong_store' });
    expect(foreign.remainingAmount).toBe(21085);      // untouched
    // Same-store and legacy-unscoped certs pass.
    expect(reverseStoreCreditForSale(voidedSale(), [debitedCert({ storeId: 'store-A' })], { ...opts, currentStoreId: 'store-A' }).ok).toBe(true);
    expect(reverseStoreCreditForSale(voidedSale(), [debitedCert()], { ...opts, currentStoreId: 'store-A' }).ok).toBe(true);
  });

  it('11. missing ledger identity fails closed with diagnostics (no guessing, nothing mutated)', () => {
    // The sale claims certificate ledger-1 but the ledger does not contain it.
    const r = reverseStoreCreditForSale(voidedSale(), [], opts);
    expect(r.ok).toBe(false);
    expect(r.changed).toBe(false);
    expect(r.failures[0]).toMatchObject({ cause: 'entry_not_found', ledgerId: 'ledger-1', saleId: 'sale-x' });
    expect(r.ops).toHaveLength(0);
  });

  it('a voided certificate is frozen — restoration fails closed for manager review', () => {
    const frozen = debitedCert({ status: 'voided', remainingAmount: 0 });
    const r = reverseStoreCreditForSale(voidedSale(), [frozen], opts);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatchObject({ cause: 'voided_certificate' });
  });

  it('a DOA-era sale (cert line but debit never landed) restores nothing and does NOT block the void', () => {
    // Entry exists but holds no redemption for this sale — provably never debited.
    const neverDebited = cert();
    const r = reverseStoreCreditForSale(voidedSale(), [neverDebited], opts);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.nothingToRestore).toEqual(['ledger-1']);
    expect(r.ledger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(23270);
  });

  it('12. a sale with no store-credit involvement is untouched (unrelated voids unchanged)', () => {
    const plain = voidedSale({
      items: [{ id: 'p', name: 'Case', category: 'accessory', price: 1000, qty: 1, taxable: false, cbeEligible: false }],
    } as Partial<Sale>);
    const r = reverseStoreCreditForSale(plain, [debitedCert({ redemptions: [] , redeemedAmount: 0, remainingAmount: 23270 })], opts);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.restored).toHaveLength(0);
    expect(r.ops).toHaveLength(0);
  });

  it('all-or-nothing: one failing certificate aborts every restoration in the sale', () => {
    const good = debitedCert();
    const frozen = cert({
      id: 'ledger-2', certificateNumber: 'SC-2', status: 'voided', remainingAmount: 0,
      redeemedAmount: 1500,
      redemptions: [{ id: 'rd2', redeemedAt: 'x', redeemedAmount: 1500, remainingAfter: 0, saleId: 'sale-x', employeeName: 'E' }],
    });
    const r = reverseStoreCreditForSale(voidedSale(), [good, frozen], opts);
    expect(r.ok).toBe(false);
    expect(r.restored).toHaveLength(0);
    expect(r.ledger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(21085); // good cert untouched too
  });
});
