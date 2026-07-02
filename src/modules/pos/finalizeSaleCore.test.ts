import { describe, it, expect } from 'vitest';
import type { Sale, InventoryItem, Customer, Repair, SpecialOrder, Layaway, StoreSettings } from '@/store/types';
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
