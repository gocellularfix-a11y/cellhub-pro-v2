import { describe, it, expect } from 'vitest';
import type { Sale, InventoryItem, Customer, Repair, StoreSettings } from '@/store/types';
import { resolvePosCheckout, classifyCheckoutAck, type PrimaryCheckoutState } from './posCheckoutForwarding';

function sale(over: Partial<Sale> = {}): Sale {
  return {
    id: 'sale-new', invoiceNumber: 'INV-1', items: [], subtotal: 0, subtotalAfterDiscount: 0,
    taxAmount: 0, salesTax: 0, total: 0, paymentMethod: 'Cash', status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
  } as unknown as Sale;
}
function item(over: Record<string, unknown> = {}): Sale['items'][number] {
  return { id: 'i1', name: 'X', sku: '', imei: '', category: 'accessory', price: 1000, cost: 0, qty: 1, taxable: false, ...over } as unknown as Sale['items'][number];
}
function state(over: Partial<PrimaryCheckoutState> = {}): PrimaryCheckoutState {
  return {
    sales: [], inventory: [], customers: [], repairs: [], specialOrders: [], unlocks: [],
    layaways: [], storeCreditLedger: [], customerReturns: [],
    settings: { taxRate: 0.0925, taxSettingsConfirmed: true } as unknown as StoreSettings,
    ...over,
  };
}
const tag = (s: Sale) => (s as unknown as Record<string, unknown>).lanOperationId;

describe('resolvePosCheckout (R-LAN-POS-CHECKOUT-FORWARDING)', () => {
  it('rejects a missing operationId', () => {
    const r = resolvePosCheckout(sale(), '', state());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('bad_operation');
  });

  it('rejects a malformed payload (no sale / no items)', () => {
    expect(resolvePosCheckout(null, 'op-1', state())).toMatchObject({ ok: false, error: 'bad_payload' });
    expect(resolvePosCheckout({ id: 'x' } as unknown as Sale, 'op-1', state())).toMatchObject({ ok: false, error: 'bad_payload' });
  });

  it('Primary success applies finalizeSaleCore result and tags the sale', () => {
    const inv = { id: 'inv-1', name: 'Case', category: 'accessory', qty: 5 } as unknown as InventoryItem;
    const r = resolvePosCheckout(
      sale({ items: [item({ inventoryId: 'inv-1', qty: 1 })], total: 1000 }),
      'op-1',
      state({ inventory: [inv] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.duplicate) return;
    expect(r.saleId).toBe('sale-new');
    expect(tag(r.taggedSale)).toBe('op-1');                        // idempotency tag set
    expect(r.result.inventory.find((i) => i.id === 'inv-1')!.qty).toBe(4); // decrement applied
    expect(r.result.nextSales.some((s) => s.id === 'sale-new')).toBe(true);
  });

  it('is idempotent — a sale already finalized for the operationId returns duplicate', () => {
    const prior = sale({ id: 'sale-prior' });
    (prior as unknown as Record<string, unknown>).lanOperationId = 'op-1';
    const r = resolvePosCheckout(sale({ id: 'sale-new' }), 'op-1', state({ sales: [prior] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicate).toBe(true);
    if (!r.duplicate) return;
    expect(r.saleId).toBe('sale-prior');
  });

  it('Primary rejection returns a reason and NO result (caller persists nothing)', () => {
    const rep = { id: 'r1', status: 'cancelled', balance: 1000 } as unknown as Repair;
    const r = resolvePosCheckout(sale({ items: [item({ repairId: 'r1' })] }), 'op-1', state({ repairs: [rep] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('repair_cancelled');
    expect((r as { result?: unknown }).result).toBeUndefined();
  });

  it('retry with the SAME sale.id and SAME operationId dedupes (no double commit)', () => {
    const committed = sale({ id: 'sale-X' });
    (committed as unknown as Record<string, unknown>).lanOperationId = 'op-A';
    const r = resolvePosCheckout(
      sale({ id: 'sale-X', items: [item({ inventoryId: 'inv-1', qty: 1 })] }),
      'op-A', // same operationId as the committed sale
      state({ sales: [committed], inventory: [{ id: 'inv-1', category: 'accessory', qty: 5 } as unknown as InventoryItem] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !r.duplicate) return;
    expect(r.saleId).toBe('sale-X');
    expect((r as { result?: unknown }).result).toBeUndefined();
  });

  it('dedupes by sale.id even when the operationId differs (no double charge / mutation)', () => {
    // The Primary already committed sale-X via the first forward (op-A). A
    // re-forward of the SAME built Sale arrives with a NEW operationId (op-B) —
    // sendPosCheckout mints a fresh operationId per call. Must still dedupe.
    const committed = sale({ id: 'sale-X' });
    (committed as unknown as Record<string, unknown>).lanOperationId = 'op-A';
    const inv = { id: 'inv-1', name: 'Case', category: 'accessory', qty: 5 } as unknown as InventoryItem;
    const r = resolvePosCheckout(
      sale({ id: 'sale-X', items: [item({ inventoryId: 'inv-1', qty: 1 })], total: 1000 }),
      'op-B', // DIFFERENT operationId than the committed sale
      state({ sales: [committed], inventory: [inv] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicate).toBe(true);
    if (!r.duplicate) return;
    expect(r.saleId).toBe('sale-X');
    // duplicate short-circuits → no result, so the caller applies NOTHING.
    expect((r as { result?: unknown }).result).toBeUndefined();
    expect(inv.qty).toBe(5); // inventory never decremented a second time
  });

  it('resolves the customer from the PRIMARY authoritative array (not the Secondary mirror)', () => {
    // Secondary-built sale references c1; the Primary holds c1 with $50 store credit.
    const primaryCust = { id: 'c1', name: 'Joe', storeCredit: 5000, loyaltyPoints: 0 } as unknown as Customer;
    const r = resolvePosCheckout(
      sale({ paymentMethod: 'Store Credit', total: 2000, customerId: 'c1' }),
      'op-1',
      state({ customers: [primaryCust] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.duplicate) return;
    expect(r.result.customerChanged).toBe(true);
    expect(r.result.workingCustomer!.storeCredit).toBe(3000); // deducted from PRIMARY balance
  });

  it('reflects stale inventory on the Primary (decrements against Primary stock)', () => {
    // Primary stock is already lower than the Secondary mirror believed.
    const inv = { id: 'inv-1', name: 'Case', category: 'accessory', qty: 1 } as unknown as InventoryItem;
    const r = resolvePosCheckout(
      sale({ items: [item({ inventoryId: 'inv-1', qty: 1 })] }),
      'op-1',
      state({ inventory: [inv] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.duplicate) return;
    expect(r.result.inventory.find((i) => i.id === 'inv-1')!.qty).toBe(0);
  });
});

describe('classifyCheckoutAck (R-LAN-POS-CHECKOUT-FORWARDING-FIX-2)', () => {
  it('ok ACK → committed', () => {
    expect(classifyCheckoutAck({ ok: true, saleId: 's1' })).toBe('committed');
  });

  it('definitive not-committed reasons → rejected (safe to abandon)', () => {
    for (const e of [
      'tax_setup_required', 'repair_cancelled', 'repair_completed', 'layaway_cancelled',
      'repair_overpayment', 'bad_payload', 'bad_operation', 'not_paired', 'not_electron',
      'not_primary', 'dispatch_unavailable',
    ]) {
      expect(classifyCheckoutAck({ ok: false, error: e })).toBe('rejected');
    }
  });

  it('ambiguous transport/dispatch failures → unknown (KEEP pending, retry same id)', () => {
    for (const e of ['unreachable', 'timeout', 'dispatch_failed', 'dispatch_exception', 'http_500', '']) {
      expect(classifyCheckoutAck({ ok: false, error: e })).toBe('unknown');
    }
    expect(classifyCheckoutAck({ ok: false })).toBe('unknown');
    expect(classifyCheckoutAck(null)).toBe('unknown');
    expect(classifyCheckoutAck(undefined)).toBe('unknown');
  });
});
