// ============================================================
// P0-SC-1 — Store Credit Ledger unit tests
// Covers the pure ledger engine: issuance, partial/full redemption,
// over-redemption rejection, void freeze, fractional cents, sign
// conventions, and the Reports aggregate. Uses the owner's confirmed
// runtime numbers ($232.70 issued, $63.00 redeemed → $169.70).
// ============================================================
import { describe, it, expect } from 'vitest';
import type { StoreCreditLedger } from '@/store/types';
import {
  issueLedgerEntry,
  redeemLedgerEntry,
  voidLedgerEntry,
  findCertificate,
  summarizeLedger,
} from './ledger';

function issue(amountCents: number, over: Record<string, unknown> = {}): StoreCreditLedger {
  return issueLedgerEntry({
    certificateNumber: 'SC-00000001-TEST',
    amountCents,
    customerId: 'c1',
    customerName: 'Jorge O',
    employeeName: 'Emp',
    ...over,
  });
}

describe('issueLedgerEntry', () => {
  it('creates an active entry with full remaining balance', () => {
    const l = issue(23270);
    expect(l.issuedAmount).toBe(23270);
    expect(l.redeemedAmount).toBe(0);
    expect(l.remainingAmount).toBe(23270);
    expect(l.status).toBe('active');
    expect(l.redemptions).toEqual([]);
  });

  it('rejects zero / negative / non-finite amounts', () => {
    expect(() => issue(0)).toThrow();
    expect(() => issue(-100)).toThrow();
    expect(() => issue(NaN)).toThrow();
    expect(() => issue(Infinity)).toThrow();
  });
});

describe('redeemLedgerEntry — owner scenario ($232.70 − $63.00 = $169.70)', () => {
  it('partial redemption debits exactly the redeemed cents and stays active', () => {
    const l = issue(23270);
    const { ledger: after, redemption } = redeemLedgerEntry(l, {
      amountCents: 6300, saleId: 'sale-63', invoiceNumber: 'INV-63', employeeName: 'Emp',
    });
    expect(after.issuedAmount).toBe(23270);            // original NEVER overwritten
    expect(after.redeemedAmount).toBe(6300);
    expect(after.remainingAmount).toBe(16970);          // $169.70 exact
    expect(after.status).toBe('active');
    expect(after.redemptions).toHaveLength(1);
    expect(redemption.redeemedAmount).toBe(6300);       // negative direction encoded as debit row
    expect(redemption.remainingAfter).toBe(16970);
    expect(redemption.saleId).toBe('sale-63');
  });

  it('second partial redemption keeps exact cents math ($169.70 − $50.00 = $119.70)', () => {
    const first = redeemLedgerEntry(issue(23270), { amountCents: 6300, saleId: 's1', employeeName: 'E' }).ledger;
    const second = redeemLedgerEntry(first, { amountCents: 5000, saleId: 's2', employeeName: 'E' }).ledger;
    expect(second.redeemedAmount).toBe(11300);
    expect(second.remainingAmount).toBe(11970);         // $119.70 exact
    expect(second.redemptions).toHaveLength(2);
    expect(second.status).toBe('active');
  });

  it('full redemption zeroes the balance, flips status, and blocks further redemption', () => {
    const l = redeemLedgerEntry(issue(11970), { amountCents: 11970, saleId: 's3', employeeName: 'E' }).ledger;
    expect(l.remainingAmount).toBe(0);
    expect(l.status).toBe('redeemed');
    expect(() => redeemLedgerEntry(l, { amountCents: 1, saleId: 's4', employeeName: 'E' })).toThrow();
  });

  it('rejects over-redemption (never a negative balance)', () => {
    const l = issue(5000);
    expect(() => redeemLedgerEntry(l, { amountCents: 6300, saleId: 's1', employeeName: 'E' })).toThrow();
    expect(l.remainingAmount).toBe(5000); // input untouched on rejection
  });

  it('rejects zero / negative / non-finite redemption amounts', () => {
    const l = issue(1000);
    expect(() => redeemLedgerEntry(l, { amountCents: 0, employeeName: 'E' })).toThrow();
    expect(() => redeemLedgerEntry(l, { amountCents: -5, employeeName: 'E' })).toThrow();
    expect(() => redeemLedgerEntry(l, { amountCents: NaN, employeeName: 'E' })).toThrow();
  });

  it('fractional cents stay exact ($10.01 − $0.01 = $10.00)', () => {
    const l = redeemLedgerEntry(issue(1001), { amountCents: 1, saleId: 's1', employeeName: 'E' }).ledger;
    expect(l.remainingAmount).toBe(1000);
    expect(Object.is(l.remainingAmount, -0)).toBe(false); // no negative zero
  });
});

describe('voidLedgerEntry', () => {
  it('freezes the certificate: remaining → 0, redemptions preserved, redeem blocked', () => {
    const redeemed = redeemLedgerEntry(issue(23270), { amountCents: 6300, saleId: 's1', employeeName: 'E' }).ledger;
    const voided = voidLedgerEntry(redeemed, { employeeName: 'Mgr', reason: 'lost' });
    expect(voided.status).toBe('voided');
    expect(voided.remainingAmount).toBe(0);
    expect(voided.redemptions).toHaveLength(1); // audit history intact
    expect(() => redeemLedgerEntry(voided, { amountCents: 1, employeeName: 'E' })).toThrow();
    expect(() => voidLedgerEntry(voided, { employeeName: 'Mgr' })).toThrow(); // double-void
  });
});

describe('findCertificate + customer scope', () => {
  it('matches the certificate id case-insensitively; never matches another cert', () => {
    const a = issue(1000, { certificateNumber: 'SC-11111111-AAAA', customerId: 'cA' });
    const b = issue(2000, { certificateNumber: 'SC-22222222-BBBB', customerId: 'cB' });
    expect(findCertificate([a, b], 'sc-11111111-aaaa')!.id).toBe(a.id);
    expect(findCertificate([a, b], 'SC-33333333-XXXX')).toBeNull();
  });
});

describe('summarizeLedger (Reports aggregate)', () => {
  it('adds issuances, subtracts redemptions, and only counts active liability', () => {
    const active = redeemLedgerEntry(issue(23270), { amountCents: 6300, saleId: 's1', employeeName: 'E' }).ledger;
    const voided = voidLedgerEntry(issue(5000, { certificateNumber: 'SC-2' }), { employeeName: 'M' });
    const sum = summarizeLedger([active, voided]);
    expect(sum.issuedTotalCents).toBe(28270);
    expect(sum.redeemedTotalCents).toBe(6300);
    expect(sum.activeLiabilityCents).toBe(16970); // voided remaining excluded
    expect(sum.voidedCount).toBe(1);
    expect(sum.redemptionCount).toBe(1);
  });
});
