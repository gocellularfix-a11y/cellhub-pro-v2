import { describe, it, expect } from 'vitest';
import type { Sale, InventoryItem, Customer, Repair, SpecialOrder, Layaway, StoreSettings, StoreCreditLedger } from '@/store/types';
import { finalizeSaleCore, type FinalizeSaleCoreInput } from './finalizeSaleCore';

function sale(over: Partial<Sale> = {}): Sale {
  return {
    id: 'sale-1',
    invoiceNumber: 'INV-1',
    items: [],
    subtotal: 0,
    subtotalAfterDiscount: 0,
    taxAmount: 0,
    salesTax: 0,
    total: 0,
    paymentMethod: 'Cash',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as unknown as Sale;
}

function item(over: Record<string, unknown> = {}): Sale['items'][number] {
  return {
    id: 'i1', name: 'X', sku: '', imei: '', category: 'accessory',
    price: 1000, cost: 0, qty: 1, taxable: false,
    ...over,
  } as unknown as Sale['items'][number];
}

function input(over: Partial<FinalizeSaleCoreInput> = {}): FinalizeSaleCoreInput {
  return {
    sale: sale(),
    sales: [], inventory: [], customers: [], repairs: [], specialOrders: [],
    unlocks: [], layaways: [], storeCreditLedger: [], customerReturns: [],
    settings: { taxRate: 0.0925, taxSettingsConfirmed: true } as unknown as StoreSettings,
    selectedCustomer: null, currentEmployee: null,
    ...over,
  };
}

describe('finalizeSaleCore (R-FINALIZE-SALE-CORE-EXTRACT-SCOPED)', () => {
  it('plain inventory sale → appends sale and decrements inventory', () => {
    const inv = { id: 'inv-1', name: 'Case', category: 'accessory', qty: 5 } as unknown as InventoryItem;
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ inventoryId: 'inv-1', qty: 2 })], total: 2000 }),
      inventory: [inv],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.saleId).toBe('sale-1');
    expect(r.nextSales).toHaveLength(1);
    expect(r.inventoryOps).toHaveLength(1);
    expect(r.inventory.find((i) => i.id === 'inv-1')!.qty).toBe(3);
  });

  it('service inventory item does NOT decrement', () => {
    const inv = { id: 'inv-2', name: 'Labor', category: 'service', qty: 0 } as unknown as InventoryItem;
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ inventoryId: 'inv-2', category: 'service', qty: 1 })] }),
      inventory: [inv],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inventoryOps).toHaveLength(0);
  });

  it('store-credit payment deducts the customer balance', () => {
    const cust = { id: 'c1', name: 'Joe', storeCredit: 5000, loyaltyPoints: 0 } as unknown as Customer;
    const r = finalizeSaleCore(input({
      sale: sale({ paymentMethod: 'Store Credit', total: 2000, customerId: 'c1' }),
      selectedCustomer: cust,
      customers: [cust],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.customerChanged).toBe(true);
    expect(r.workingCustomer!.storeCredit).toBe(3000);
  });

  it('repair payment updates deposit / balance / status', () => {
    const rep = { id: 'r1', status: 'received', depositAmount: 0, balance: 1000 } as unknown as Repair;
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ repairId: 'r1', category: 'service', price: 1000, taxable: false })], subtotal: 1000, subtotalAfterDiscount: 1000 }),
      repairs: [rep],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repairOps).toHaveLength(1);
    const ur = r.repairs.find((x) => x.id === 'r1')!;
    expect(ur.depositAmount).toBe(1000);
    expect(ur.balance).toBe(0);
    expect(ur.status).toBe('picked_up');
  });

  it('special order payment updates deposit / balance / status', () => {
    const so = { id: 'so1', status: 'ordered', depositAmount: 0, balance: 1500, payments: [] } as unknown as SpecialOrder;
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ specialOrderId: 'so1', category: 'service', price: 1500, taxable: false })], subtotal: 1500, subtotalAfterDiscount: 1500 }),
      specialOrders: [so],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.specialOrderOps).toHaveLength(1);
    const us = r.specialOrders.find((x) => x.id === 'so1')!;
    expect(us.depositAmount).toBe(1500);
    expect(us.balance).toBe(0);
    expect(us.status).toBe('picked_up');
  });

  it('layaway payment updates paid / balance / status', () => {
    const lay = { id: 'l1', status: 'active', totalPrice: 2000, paidAmount: 0, payments: [] } as unknown as Layaway;
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ layawayId: 'l1', category: 'service', price: 2000, taxable: false })], subtotal: 2000, subtotalAfterDiscount: 2000 }),
      layaways: [lay],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layawayOps).toHaveLength(1);
    const ul = r.layaways.find((x) => x.id === 'l1')!;
    expect(ul.paidAmount).toBe(2000);
    expect(ul.balance).toBe(0);
    expect(ul.status).toBe('completed');
  });

  it('rejects a cancelled repair (pre-flight)', () => {
    const rep = { id: 'r1', status: 'cancelled', balance: 1000 } as unknown as Repair;
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ repairId: 'r1' })] }),
      repairs: [rep],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('repair_cancelled');
  });

  it('rejects a forfeited layaway (pre-flight)', () => {
    const lay = { id: 'l1', status: 'forfeited', totalPrice: 2000 } as unknown as Layaway;
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ layawayId: 'l1' })] }),
      layaways: [lay],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('layaway_cancelled');
  });

  it('rejects repair overpayment (pre-flight)', () => {
    const rep = { id: 'r1', status: 'received', balance: 500 } as unknown as Repair;
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ repairId: 'r1', category: 'service', price: 1000, taxable: false })], subtotal: 1000, subtotalAfterDiscount: 1000 }),
      repairs: [rep],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('repair_overpayment');
  });

  it('blocks a taxable sale when tax setup is not confirmed', () => {
    const r = finalizeSaleCore(input({
      sale: sale({ taxAmount: 500, total: 6000 }),
      settings: { taxRate: 0.0925, taxSettingsConfirmed: false } as unknown as StoreSettings,
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('tax_setup_required');
  });

  it('flags external phone-payment verification as a side effect', () => {
    const r = finalizeSaleCore(input({
      sale: sale({ items: [item({ category: 'phone_payment', carrier: 'Verizon', phoneNumber: '8055551234', price: 5000 })], total: 5000 }),
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sideEffects.phonePaymentVerify).not.toBeNull();
    expect(r.sideEffects.phonePaymentVerify!.carrier).toBe('Verizon');
    expect(r.sideEffects.phonePaymentVerify!.amountCents).toBe(5000);
  });

  it('does not mutate the input arrays', () => {
    const inv = { id: 'inv-1', name: 'Case', category: 'accessory', qty: 5 } as unknown as InventoryItem;
    const inventory = [inv];
    finalizeSaleCore(input({
      sale: sale({ items: [item({ inventoryId: 'inv-1', qty: 2 })] }),
      inventory,
    }));
    expect(inventory[0].qty).toBe(5); // original untouched
  });
});

// ── P0-SC-1: store-credit redemption at the commit boundary ──
function ledgerEntry(over: Partial<StoreCreditLedger> = {}): StoreCreditLedger {
  return {
    id: 'ledger-1',
    certificateNumber: 'SC-12345678-ABCD',
    customerId: 'c1',
    customerName: 'Jorge O',
    issuedAmount: 23270,
    redeemedAmount: 0,
    remainingAmount: 23270,
    status: 'active',
    issuedAt: '2026-07-01T00:00:00.000Z',
    issuedByEmployeeName: 'Emp',
    redemptions: [],
    ...over,
  } as StoreCreditLedger;
}

/** Negative Apply-Store-Credit sale line carrying the ledger identity. */
function creditLine(cents: number, over: Record<string, unknown> = {}): Sale['items'][number] {
  return item({
    id: `sc-${cents}`, category: 'exchange_credit', price: -cents, qty: 1, taxable: false,
    storeCreditLedgerId: 'ledger-1', storeCreditCertNumber: 'SC-12345678-ABCD',
    ...over,
  });
}

describe('finalizeSaleCore — certificate store-credit redemption (P0-SC-1)', () => {
  it('OWNER SCENARIO: $232.70 cert, $63.00 redeemed → exactly one debit, $169.70 remaining; second sale → $119.70', () => {
    // Sale 1: $63 phone payment fully offset by $63 store credit.
    // customerId matches the certificate owner (P0-SC-1.1 ownership rule).
    const s1 = sale({
      id: 'sale-63',
      customerId: 'c1',
      items: [
        item({ id: 'pp', category: 'phone_payment', carrier: 'H2O', price: 6300 }),
        creditLine(6300),
      ],
      total: 0,
    });
    const r1 = finalizeSaleCore(input({ sale: s1, storeCreditLedger: [ledgerEntry()] }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.ledgerOps).toHaveLength(1);
    const after1 = r1.storeCreditLedger.find((l) => l.id === 'ledger-1')!;
    expect(after1.redemptions).toHaveLength(1);          // exactly one redemption entry
    expect(after1.redemptions[0].saleId).toBe('sale-63'); // associated with the committed sale
    expect(after1.redeemedAmount).toBe(6300);
    expect(after1.remainingAmount).toBe(16970);           // $169.70 — NOT $232.70
    expect(after1.issuedAmount).toBe(23270);              // original issuance never overwritten
    expect(after1.status).toBe('active');

    // Sale 2 against the UPDATED ledger (next checkout reads the new balance).
    const s2 = sale({ id: 'sale-50', customerId: 'c1', items: [creditLine(5000, { id: 'sc-2' })], total: 0 });
    const r2 = finalizeSaleCore(input({ sale: s2, storeCreditLedger: r1.storeCreditLedger }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const after2 = r2.storeCreditLedger.find((l) => l.id === 'ledger-1')!;
    expect(after2.remainingAmount).toBe(11970);           // $119.70
    expect(after2.redemptions).toHaveLength(2);
  });

  it('mixed tender: $100 sale = $63 store credit + $37 cash → ledger debit is EXACTLY $63', () => {
    const s = sale({
      id: 'sale-mixed',
      customerId: 'c1',
      items: [item({ id: 'prod', price: 10000 }), creditLine(6300)],
      subtotal: 10000, subtotalAfterDiscount: 10000, total: 3700,
      paymentMethod: 'Cash',
    });
    const r = finalizeSaleCore(input({ sale: s, storeCreditLedger: [ledgerEntry()] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.storeCreditLedger.find((l) => l.id === 'ledger-1')!;
    expect(after.redeemedAmount).toBe(6300);              // not total, not balance, not cash portion
    expect(after.remainingAmount).toBe(16970);
  });

  it('is idempotent: re-processing a sale already debited on the cert is a no-op (retry / duplicate ACK)', () => {
    const first = finalizeSaleCore(input({
      sale: sale({ id: 'sale-63', customerId: 'c1', items: [creditLine(6300)], total: 0 }),
      storeCreditLedger: [ledgerEntry()],
    }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Same sale.id re-finalized against the updated ledger → no second debit.
    const again = finalizeSaleCore(input({
      sale: sale({ id: 'sale-63', customerId: 'c1', items: [creditLine(6300)], total: 0 }),
      storeCreditLedger: first.storeCreditLedger,
    }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.ledgerOps).toHaveLength(0);
    const after = again.storeCreditLedger.find((l) => l.id === 'ledger-1')!;
    expect(after.remainingAmount).toBe(16970);            // still one debit only
    expect(after.redemptions).toHaveLength(1);
  });

  it('two DIFFERENT sales on the same cert → two legitimate debits', () => {
    const r1 = finalizeSaleCore(input({
      sale: sale({ id: 'sale-A', customerId: 'c1', items: [creditLine(1000)], total: 0 }),
      storeCreditLedger: [ledgerEntry()],
    }));
    if (!r1.ok) throw new Error('unexpected');
    const r2 = finalizeSaleCore(input({
      sale: sale({ id: 'sale-B', customerId: 'c1', items: [creditLine(2000)], total: 0 }),
      storeCreditLedger: r1.storeCreditLedger,
    }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const after = r2.storeCreditLedger.find((l) => l.id === 'ledger-1')!;
    expect(after.redemptions).toHaveLength(2);
    expect(after.remainingAmount).toBe(23270 - 3000);
  });

  it('rejects over-redemption BEFORE committing (no sale, no debit)', () => {
    const r = finalizeSaleCore(input({
      sale: sale({ id: 'sale-over', customerId: 'c1', items: [creditLine(6300)], total: 0 }),
      storeCreditLedger: [ledgerEntry({ redeemedAmount: 18270, remainingAmount: 5000 })],
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('store_credit_invalid');
    expect(r.details).toMatchObject({ cause: 'over_redemption', requestedCents: 6300, remainingCents: 5000 });
  });

  it('rejects a voided certificate and a missing ledger entry', () => {
    const voided = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(100)], total: 0 }),
      storeCreditLedger: [ledgerEntry({ status: 'voided', remainingAmount: 0 })],
    }));
    expect(voided).toMatchObject({ ok: false, reason: 'store_credit_invalid' });

    const missing = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(100)], total: 0 }),
      storeCreditLedger: [],   // cert does not exist on the authoritative machine
    }));
    expect(missing).toMatchObject({ ok: false, reason: 'store_credit_invalid' });
  });

  it('zero-amount credit lines and lines without a ledger id are ignored', () => {
    const r = finalizeSaleCore(input({
      sale: sale({
        items: [
          creditLine(0),                                            // zero → ignored
          item({ id: 'plain-ex', category: 'exchange_credit', price: -500 }), // no ledger id → legacy exchange line
        ],
        total: 0,
      }),
      storeCreditLedger: [ledgerEntry()],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ledgerOps).toHaveLength(0);
    expect(r.storeCreditLedger.find((l) => l.id === 'ledger-1')!.remainingAmount).toBe(23270);
  });

  it('aggregates multiple lines for the same cert into ONE redemption', () => {
    const r = finalizeSaleCore(input({
      sale: sale({ id: 'sale-multi', customerId: 'c1', items: [creditLine(1000, { id: 'a' }), creditLine(2000, { id: 'b' })], total: 0 }),
      storeCreditLedger: [ledgerEntry()],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.storeCreditLedger.find((l) => l.id === 'ledger-1')!;
    expect(after.redemptions).toHaveLength(1);
    expect(after.redeemedAmount).toBe(3000);
  });
});

describe('finalizeSaleCore — certificate ownership, store scope, line hygiene (P0-SC-1.1)', () => {
  it("rejects customer A's owned certificate on customer B's sale (and on a walk-in sale)", () => {
    const certOfA = ledgerEntry({ customerId: 'cA' });
    const wrongCustomer = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'cB', items: [creditLine(1000)], total: 0 }),
      storeCreditLedger: [certOfA],
    }));
    expect(wrongCustomer).toMatchObject({ ok: false, reason: 'store_credit_invalid' });
    if (!wrongCustomer.ok) expect(wrongCustomer.details).toMatchObject({ cause: 'wrong_customer' });

    const walkIn = finalizeSaleCore(input({
      sale: sale({ id: 's', items: [creditLine(1000)], total: 0 }), // no customerId
      storeCreditLedger: [certOfA],
    }));
    expect(walkIn).toMatchObject({ ok: false, reason: 'store_credit_invalid' });
    // No debit happened on rejection.
    expect(certOfA.redemptions).toHaveLength(0);
    expect(certOfA.remainingAmount).toBe(23270);
  });

  it('an UNOWNED certificate (manual-entry recipient) stays a bearer instrument', () => {
    const bearer = ledgerEntry({ customerId: undefined });
    const r = finalizeSaleCore(input({
      sale: sale({ id: 's', items: [creditLine(1000)], total: 0 }), // walk-in
      storeCreditLedger: [bearer],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.storeCreditLedger[0].remainingAmount).toBe(22270);
  });

  it('store scope: canonical belongsToStore rule at the commit boundary', () => {
    // Scoped view active + cert stamped for another store → reject.
    const otherStore = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(1000)], total: 0 }),
      storeCreditLedger: [ledgerEntry({ storeId: 'store-B' })],
      currentStoreId: 'store-A',
    }));
    expect(otherStore).toMatchObject({ ok: false, reason: 'store_credit_invalid' });
    if (!otherStore.ok) expect(otherStore.details).toMatchObject({ cause: 'wrong_store' });

    // Same store → ok.
    const sameStore = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(1000)], total: 0 }),
      storeCreditLedger: [ledgerEntry({ storeId: 'store-A' })],
      currentStoreId: 'store-A',
    }));
    expect(sameStore.ok).toBe(true);

    // Legacy unstamped cert is redeemable in any store (BUG-1 rule).
    const legacy = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(1000)], total: 0 }),
      storeCreditLedger: [ledgerEntry({ storeId: undefined })],
      currentStoreId: 'store-A',
    }));
    expect(legacy.ok).toBe(true);

    // Single-store mode (no currentStoreId) → no scoping.
    const singleStore = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(1000)], total: 0 }),
      storeCreditLedger: [ledgerEntry({ storeId: 'store-B' })],
    }));
    expect(singleStore.ok).toBe(true);
  });

  it('rejects a POSITIVE-priced or foreign-category line carrying a ledger id (bad_line)', () => {
    const positive = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(1000, { price: 6300 })], total: 6300 }),
      storeCreditLedger: [ledgerEntry()],
    }));
    expect(positive).toMatchObject({ ok: false, reason: 'store_credit_invalid' });
    if (!positive.ok) expect(positive.details).toMatchObject({ cause: 'bad_line' });

    const foreignCategory = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(1000, { category: 'accessory' })], total: 0 }),
      storeCreditLedger: [ledgerEntry()],
    }));
    expect(foreignCategory).toMatchObject({ ok: false, reason: 'store_credit_invalid' });
  });

  it('an explicit qty of 0 contributes NOTHING (qty ?? 1, not qty || 1)', () => {
    const r = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [creditLine(6300, { qty: 0 })], total: 0 }),
      storeCreditLedger: [ledgerEntry()],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ledgerOps).toHaveLength(0);
    expect(r.storeCreditLedger[0].remainingAmount).toBe(23270);
  });

  it('a rejected checkout leaves the input ledger completely untouched', () => {
    const entry = ledgerEntry();
    const rep = { id: 'r1', status: 'cancelled', balance: 1000 } as unknown as Repair;
    const r = finalizeSaleCore(input({
      sale: sale({ id: 's', customerId: 'c1', items: [item({ repairId: 'r1' }), creditLine(6300)], total: 0 }),
      storeCreditLedger: [entry],
      repairs: [rep],
    }));
    expect(r.ok).toBe(false);           // repair_cancelled pre-flight fires
    expect(entry.redemptions).toHaveLength(0);
    expect(entry.remainingAmount).toBe(23270);
    expect(entry.redeemedAmount).toBe(0);
  });
});

describe('finalizeSaleCore — legacy tender idempotency (P0-SC-1.1)', () => {
  it('a fresh legacy debit stamps the redemption marker (saleId + amount)', () => {
    const cust = { id: 'c1', name: 'Joe', storeCredit: 23270, loyaltyPoints: 0 } as unknown as Customer;
    const r = finalizeSaleCore(input({
      sale: sale({ id: 'sale-63', paymentMethod: 'Store Credit', total: 6300, customerId: 'c1' }),
      selectedCustomer: cust, customers: [cust],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workingCustomer!.storeCredit).toBe(16970);
    const marks = r.workingCustomer!.storeCreditRedemptions || [];
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ saleId: 'sale-63', amountCents: 6300 });
  });

  it('re-processing the SAME legacy sale is a financial no-op (retry / duplicate committed)', () => {
    const cust = { id: 'c1', name: 'Joe', storeCredit: 23270, loyaltyPoints: 0 } as unknown as Customer;
    const first = finalizeSaleCore(input({
      sale: sale({ id: 'sale-63', paymentMethod: 'Store Credit', total: 6300, customerId: 'c1' }),
      selectedCustomer: cust, customers: [cust],
    }));
    if (!first.ok) throw new Error('unexpected');
    const debited = first.workingCustomer!;      // storeCredit 16970 + marker

    const again = finalizeSaleCore(input({
      sale: sale({ id: 'sale-63', paymentMethod: 'Store Credit', total: 6300, customerId: 'c1' }),
      selectedCustomer: debited, customers: [debited],
    }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    // No second debit, no second marker, no customer churn from §3.
    const c = again.customers.find((x) => x.id === 'c1')!;
    expect(c.storeCredit).toBe(16970);
    expect((c.storeCreditRedemptions || [])).toHaveLength(1);
  });

  it('a duplicate whose balance is now BELOW the total still passes (its debit already happened)', () => {
    // After the original $63 debit the balance dropped to $10; a duplicate
    // re-process of the same sale must not be rejected as insufficient.
    const cust = {
      id: 'c1', name: 'Joe', storeCredit: 1000, loyaltyPoints: 0,
      storeCreditRedemptions: [{ saleId: 'sale-63', amountCents: 6300, redeemedAt: '2026-07-23T00:00:00.000Z' }],
    } as unknown as Customer;
    const r = finalizeSaleCore(input({
      sale: sale({ id: 'sale-63', paymentMethod: 'Store Credit', total: 6300, customerId: 'c1' }),
      selectedCustomer: cust, customers: [cust],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.customers.find((x) => x.id === 'c1')!.storeCredit).toBe(1000); // untouched
  });

  it('two DIFFERENT legacy sales debit twice (legitimate)', () => {
    const cust = { id: 'c1', name: 'Joe', storeCredit: 23270, loyaltyPoints: 0 } as unknown as Customer;
    const r1 = finalizeSaleCore(input({
      sale: sale({ id: 'sale-A', paymentMethod: 'Store Credit', total: 6300, customerId: 'c1' }),
      selectedCustomer: cust, customers: [cust],
    }));
    if (!r1.ok) throw new Error('unexpected');
    const afterA = r1.workingCustomer!;
    const r2 = finalizeSaleCore(input({
      sale: sale({ id: 'sale-B', paymentMethod: 'Store Credit', total: 5000, customerId: 'c1' }),
      selectedCustomer: afterA, customers: [afterA],
    }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const c = r2.customers.find((x) => x.id === 'c1')!;
    expect(c.storeCredit).toBe(11970);
    expect((c.storeCreditRedemptions || [])).toHaveLength(2);
  });
});

describe('finalizeSaleCore — legacy Store Credit tender validation (P0-SC-1)', () => {
  it('sufficient balance still debits (pre-existing behavior preserved)', () => {
    const cust = { id: 'c1', name: 'Joe', storeCredit: 23270, loyaltyPoints: 0 } as unknown as Customer;
    const r = finalizeSaleCore(input({
      sale: sale({ paymentMethod: 'Store Credit', total: 6300, customerId: 'c1' }),
      selectedCustomer: cust, customers: [cust],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workingCustomer!.storeCredit).toBe(16970);   // $232.70 − $63.00 = $169.70
  });

  it('rejects when the authoritative balance does not cover the total (stale mirror protection)', () => {
    const cust = { id: 'c1', name: 'Joe', storeCredit: 5000, loyaltyPoints: 0 } as unknown as Customer;
    const r = finalizeSaleCore(input({
      sale: sale({ paymentMethod: 'Store Credit', total: 6300, customerId: 'c1' }),
      selectedCustomer: cust, customers: [cust],
    }));
    expect(r).toMatchObject({ ok: false, reason: 'store_credit_insufficient' });
  });

  it('rejects a Store Credit sale with no resolvable customer (nothing to debit)', () => {
    const r = finalizeSaleCore(input({
      sale: sale({ paymentMethod: 'Store Credit', total: 6300 }),
      selectedCustomer: null,
    }));
    expect(r).toMatchObject({ ok: false, reason: 'store_credit_insufficient' });
  });

  it('allows a zero-total Store Credit sale (fully offset by credit lines — nothing owed)', () => {
    const cust = { id: 'c1', name: 'Joe', storeCredit: 0, loyaltyPoints: 0 } as unknown as Customer;
    const r = finalizeSaleCore(input({
      sale: sale({ paymentMethod: 'Store Credit', total: 0, customerId: 'c1' }),
      selectedCustomer: cust, customers: [cust],
    }));
    expect(r.ok).toBe(true);
  });

  it("customer B's selection never touches customer A's balance (scope)", () => {
    const a = { id: 'cA', name: 'A', storeCredit: 10000, loyaltyPoints: 0 } as unknown as Customer;
    const b = { id: 'cB', name: 'B', storeCredit: 7000, loyaltyPoints: 0 } as unknown as Customer;
    const r = finalizeSaleCore(input({
      sale: sale({ paymentMethod: 'Store Credit', total: 5000, customerId: 'cB' }),
      selectedCustomer: b, customers: [a, b],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.customers.find((c) => c.id === 'cA')!.storeCredit).toBe(10000); // untouched
    expect(r.customers.find((c) => c.id === 'cB')!.storeCredit).toBe(2000);
  });
});

describe('finalizeSaleCore — repair deposit traceability (R-REPAIR-DEPOSIT-TRACE-V1)', () => {
  it('captures depositMeta once on the first (deposit) payment; no trace on that line', () => {
    const rep = { id: 'r1', status: 'received', depositAmount: 0, balance: 12000, total: 12000, ticketNumber: 'R-1042' } as unknown as Repair;
    const s = sale({
      id: 'sale-dep', invoiceNumber: 'INV-8841', paymentMethod: 'Cash',
      items: [item({ repairId: 'r1', category: 'service', price: 4000, taxable: false })],
      subtotal: 4000, subtotalAfterDiscount: 4000,
    });
    const r = finalizeSaleCore(input({ sale: s, repairs: [rep] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ur = r.repairs.find((x) => x.id === 'r1')! as Repair;
    expect(ur.depositAmount).toBe(4000);
    expect(ur.depositMeta).toBeDefined();
    expect(ur.depositMeta!.amountCents).toBe(4000);
    expect(ur.depositMeta!.saleId).toBe('sale-dep');
    expect(ur.depositMeta!.invoiceNumber).toBe('INV-8841');
    expect(ur.depositMeta!.paymentMethod).toBe('Cash');
    // previouslyPaid === 0 → nothing to trace on the deposit line itself.
    expect(s.items[0].repairDepositTrace).toBeUndefined();
  });

  it('stamps repairDepositTrace on the balance payment and preserves depositMeta (idempotent)', () => {
    const rep = {
      id: 'r1', status: 'received', depositAmount: 4000, balance: 8000, total: 12000, ticketNumber: 'R-1042',
      depositMeta: { amountCents: 4000, dateIso: '2026-06-28T00:00:00.000Z', saleId: 'sale-dep', invoiceNumber: 'INV-8841', paymentMethod: 'Cash' },
    } as unknown as Repair;
    const s = sale({
      id: 'sale-bal', invoiceNumber: 'INV-8899', paymentMethod: 'Card',
      items: [item({ repairId: 'r1', category: 'service', price: 8000, taxable: false })],
      subtotal: 8000, subtotalAfterDiscount: 8000,
    });
    const r = finalizeSaleCore(input({ sale: s, repairs: [rep] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ur = r.repairs.find((x) => x.id === 'r1')! as Repair;
    expect(ur.depositAmount).toBe(12000);
    expect(ur.balance).toBe(0);
    expect(ur.status).toBe('picked_up');
    // depositMeta must NOT be overwritten by the balance payment.
    expect(ur.depositMeta!.amountCents).toBe(4000);
    expect(ur.depositMeta!.invoiceNumber).toBe('INV-8841');
    const trace = s.items[0].repairDepositTrace!;
    expect(trace).toBeDefined();
    expect(trace.ticketNumber).toBe('R-1042');
    expect(trace.originalDepositCents).toBe(4000);
    expect(trace.depositInvoice).toBe('INV-8841');
    expect(trace.depositMethod).toBe('Cash');
    expect(trace.totalRepairCents).toBe(12000);
    expect(trace.previouslyPaidCents).toBe(4000);
    expect(trace.paidTodayCents).toBe(8000);
    expect(trace.balanceRemainingCents).toBe(0);
  });

  it('one-shot full payment stamps no trace (nothing to trace)', () => {
    const rep = { id: 'r1', status: 'received', depositAmount: 0, balance: 12000, total: 12000 } as unknown as Repair;
    const s = sale({
      items: [item({ repairId: 'r1', category: 'service', price: 12000, taxable: false })],
      subtotal: 12000, subtotalAfterDiscount: 12000,
    });
    const r = finalizeSaleCore(input({ sale: s, repairs: [rep] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s.items[0].repairDepositTrace).toBeUndefined();
  });

  it('historical repair (no depositMeta) → trace omits source fields but keeps real summary numbers', () => {
    const rep = { id: 'r1', status: 'received', depositAmount: 4000, balance: 8000, total: 12000, ticketNumber: 'R-1000' } as unknown as Repair;
    const s = sale({
      items: [item({ repairId: 'r1', category: 'service', price: 8000, taxable: false })],
      subtotal: 8000, subtotalAfterDiscount: 8000,
    });
    const r = finalizeSaleCore(input({ sale: s, repairs: [rep] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const trace = s.items[0].repairDepositTrace!;
    expect(trace).toBeDefined();
    expect(trace.originalDepositCents).toBeUndefined();
    expect(trace.depositInvoice).toBeUndefined();
    expect(trace.depositSaleId).toBeUndefined();
    expect(trace.depositMethod).toBeUndefined();
    expect(trace.previouslyPaidCents).toBe(4000);
    expect(trace.paidTodayCents).toBe(8000);
    expect(trace.balanceRemainingCents).toBe(0);
    // No depositMeta is fabricated for a historical repair (depositAmount != 0).
    expect((r.repairs.find((x) => x.id === 'r1')! as Repair).depositMeta).toBeUndefined();
  });
});
