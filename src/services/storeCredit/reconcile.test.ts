// ============================================================
// P0-SC-1.1 — Ledger reconciliation tests (audit BLOCKER 5)
//
// The recovery path for "sale committed but the certificate debit never
// persisted": committed sales are the journal, redemptions[].saleId is the
// idempotency key. Must repair exactly the missing debits, be idempotent,
// and NEVER fabricate money on conflicts.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Sale, StoreCreditLedger } from '@/store/types';
import { reconcileStoreCreditLedger } from './reconcile';

function cert(over: Partial<StoreCreditLedger> = {}): StoreCreditLedger {
  return {
    id: 'ledger-1', certificateNumber: 'SC-1', customerId: 'c1', customerName: 'Jorge O',
    issuedAmount: 23270, redeemedAmount: 0, remainingAmount: 23270, status: 'active',
    issuedAt: '2026-07-01T00:00:00.000Z', issuedByEmployeeName: 'Emp', redemptions: [],
    ...over,
  } as StoreCreditLedger;
}

function creditSale(id: string, cents: number, over: Partial<Sale> = {}): Sale {
  return {
    id, invoiceNumber: `INV-${id}`, status: 'completed', createdAt: `2026-07-2${id.length % 10}T00:00:00.000Z`,
    paymentMethod: 'Cash', total: 0, subtotal: 0, taxAmount: 0, salesTax: 0,
    items: [{
      id: `l-${id}`, name: 'Store Credit (SC-1)', category: 'exchange_credit',
      price: -cents, qty: 1, taxable: false, cbeEligible: false,
      storeCreditLedgerId: 'ledger-1', storeCreditCertNumber: 'SC-1',
    }],
    ...over,
  } as unknown as Sale;
}

describe('reconcileStoreCreditLedger', () => {
  it('repairs a committed sale whose debit never persisted (the BLOCKER 5 window)', () => {
    const sales = [creditSale('s63', 6300, { createdAt: '2026-07-20T10:00:00.000Z' })];
    const res = reconcileStoreCreditLedger(sales, [cert()]);   // ledger has NO redemption for s63
    expect(res.changed).toBe(true);
    expect(res.repaired).toHaveLength(1);
    expect(res.repaired[0]).toMatchObject({ saleId: 's63', ledgerId: 'ledger-1', amountCents: 6300 });
    const entry = res.ledger.find((l) => l.id === 'ledger-1')!;
    expect(entry.remainingAmount).toBe(16970);
    expect(entry.redemptions[0].saleId).toBe('s63');
    expect(res.ops).toHaveLength(1);                            // exactly one persist op
    expect(res.conflicts).toHaveLength(0);
  });

  it('is idempotent — a second pass over repaired data changes nothing', () => {
    const sales = [creditSale('s63', 6300)];
    const first = reconcileStoreCreditLedger(sales, [cert()]);
    const second = reconcileStoreCreditLedger(sales, first.ledger);
    expect(second.changed).toBe(false);
    expect(second.ops).toHaveLength(0);
    expect(second.ledger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(16970);
  });

  it('already-consistent data is untouched (normal startup)', () => {
    const consistent = cert({
      redeemedAmount: 6300, remainingAmount: 16970,
      redemptions: [{ id: 'r1', redeemedAt: 'x', redeemedAmount: 6300, remainingAfter: 16970, saleId: 's63', employeeName: 'E' }],
    });
    const res = reconcileStoreCreditLedger([creditSale('s63', 6300)], [consistent]);
    expect(res.changed).toBe(false);
    expect(res.ops).toHaveLength(0);
  });

  it('NEVER fabricates money: a missed debit that no longer fits is a conflict, not a clamp', () => {
    const depleted = cert({ redeemedAmount: 20000, remainingAmount: 3270 });
    const res = reconcileStoreCreditLedger([creditSale('s63', 6300)], [depleted]);
    expect(res.changed).toBe(false);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ saleId: 's63', cause: 'apply_rejected', amountCents: 6300 });
    expect(res.ledger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(3270); // untouched
  });

  it('a voided certificate with a missed debit is a conflict (frozen by void policy)', () => {
    const voided = cert({ status: 'voided', remainingAmount: 0 });
    const res = reconcileStoreCreditLedger([creditSale('s63', 6300)], [voided]);
    expect(res.changed).toBe(false);
    expect(res.conflicts[0]).toMatchObject({ cause: 'apply_rejected' });
  });

  it('an unknown ledger id is reported as not_found', () => {
    const res = reconcileStoreCreditLedger([creditSale('s63', 6300)], [cert({ id: 'other-ledger' })]);
    expect(res.changed).toBe(false);
    expect(res.conflicts[0]).toMatchObject({ cause: 'not_found', ledgerId: 'ledger-1' });
  });

  it('voided sales and non-certificate sales are ignored', () => {
    const sales = [
      creditSale('sv', 6300, { status: 'voided' as Sale['status'] }),           // refund/audit record
      { id: 'plain', invoiceNumber: 'INV-p', status: 'completed', createdAt: '2026-07-21T00:00:00.000Z', paymentMethod: 'Cash', total: 1000, items: [{ id: 'i', name: 'X', category: 'accessory', price: 1000, qty: 1, taxable: false, cbeEligible: false }] } as unknown as Sale,
    ];
    const res = reconcileStoreCreditLedger(sales, [cert()]);
    expect(res.changed).toBe(false);
    expect(res.ledger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(23270);
  });

  it('applies multiple missed sales chronologically and persists ONE final op per entry', () => {
    const sales = [
      creditSale('s2', 5000, { createdAt: '2026-07-21T10:00:00.000Z' }),
      creditSale('s1', 6300, { createdAt: '2026-07-20T10:00:00.000Z' }),  // out of order on purpose
    ];
    const res = reconcileStoreCreditLedger(sales, [cert()]);
    expect(res.changed).toBe(true);
    expect(res.repaired.map((r) => r.saleId)).toEqual(['s1', 's2']);       // createdAt order
    const entry = res.ledger.find((l) => l.id === 'ledger-1')!;
    expect(entry.remainingAmount).toBe(11970);
    expect(entry.redemptions).toHaveLength(2);
    expect(res.ops).toHaveLength(1);                                       // one op, final version
  });

  it('qty 0 lines and positive-priced lines never debit from reconciliation', () => {
    const weird = creditSale('sw', 6300);
    (weird.items[0] as unknown as { qty: number }).qty = 0;
    const positive = creditSale('sp', 6300);
    (positive.items[0] as unknown as { price: number }).price = 6300;
    const res = reconcileStoreCreditLedger([weird, positive], [cert()]);
    expect(res.changed).toBe(false);
    expect(res.ledger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(23270);
  });
});
