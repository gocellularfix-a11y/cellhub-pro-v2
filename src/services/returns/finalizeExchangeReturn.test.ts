import { describe, it, expect } from 'vitest';
import { finalizeExchangeReturn } from './finalizeExchangeReturn';
import type { Sale, InventoryItem, CustomerReturn, PendingExchangeReturn } from '@/store/types';

// ── Minimal fixtures ──────────────────────────────────────────
function makeSale(over: Partial<Sale> = {}): Sale {
  return {
    id: 'SALE-ORIG',
    invoiceNumber: 'INV-001',
    items: [
      { id: 'LINE-A', name: 'Case', category: 'accessory', price: 1000, qty: 2, cbeEligible: false, taxable: true },
      { id: 'LINE-B', name: 'Cable', category: 'accessory', price: 500, qty: 1, cbeEligible: false, taxable: true },
    ],
    subtotal: 2500,
    taxAmount: 0,
    cbeTotal: 0,
    total: 2500,
    paymentMethod: 'Cash',
    status: 'completed',
    createdAt: '2026-06-20T00:00:00.000Z',
    ...over,
  };
}

function makeInv(id: string, qty: number): InventoryItem {
  return {
    id, sku: `SKU-${id}`, name: id, category: 'accessory',
    cost: 200, price: 1000, qty, cbeEligible: false, taxable: true,
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

function makeReturnRecord(id: string): CustomerReturn {
  return {
    id,
    returnNumber: 'RTN-123-AAAA',
    originalInvoice: 'INV-001',
    originalSaleId: 'SALE-ORIG',
    customerName: 'Jane',
    customerPhone: '555',
    employeeName: 'Bob',
    createdAt: '2026-06-22T00:00:00.000Z',
    reason: 'changed_mind',
    resolution: 'exchange',
    notes: '',
    items: [],
    subtotalCents: 1000,
    taxCents: 0,
    totalCents: 1000,
  };
}

function makeDraft(over: Partial<PendingExchangeReturn> = {}): PendingExchangeReturn {
  const returnRecord = (over.returnRecord as CustomerReturn) || makeReturnRecord('RET-1');
  return {
    draftId: returnRecord.id,
    resolution: 'exchange',
    source: 'returns-modal',
    createdAt: '2026-06-22T00:00:00.000Z',
    originalSaleId: 'SALE-ORIG',
    originalReceiptNumber: 'INV-001',
    recipientName: 'Jane',
    reason: 'changed_mind',
    returnSubtotalCents: 1000,
    returnTaxCents: 0,
    returnTotalCents: 1000,
    itemMutations: [{ saleItemId: 'LINE-A', qty: 1 }],
    inventoryRestock: [{ inventoryId: 'INV-A', qty: 1 }],
    returnItems: [],
    returnNumber: returnRecord.returnNumber,
    returnRecord,
    ...over,
  };
}

describe('finalizeExchangeReturn', () => {
  it('finalizes a single exchange draft exactly once', () => {
    const sales = [makeSale()];
    const inventory = [makeInv('INV-A', 3)];
    const returns: CustomerReturn[] = [];

    const res = finalizeExchangeReturn({
      drafts: [makeDraft()],
      sales, inventory, returns,
      exchangeSaleId: 'SALE-EXCHANGE',
      exchangeInvoiceNumber: 'INV-002',
    });

    // 1. original sale line returnedQty incremented (1 of 2 → not fully returned)
    const origLineA = res.sales.find((s) => s.id === 'SALE-ORIG')!.items.find((i) => i.id === 'LINE-A')!;
    expect(origLineA.returnedQty).toBe(1);
    expect(origLineA.fullyReturned).toBe(false);
    expect(res.sales.find((s) => s.id === 'SALE-ORIG')!.hasReturn).toBe(true);
    expect(res.salesChanged).toBe(true);
    expect(res.updatedSaleIds).toEqual(['SALE-ORIG']);

    // 2. inventory restocked (+1)
    expect(res.inventory.find((i) => i.id === 'INV-A')!.qty).toBe(4);
    expect(res.inventoryChanged).toBe(true);
    expect(res.updatedInventoryIds).toEqual(['INV-A']);

    // 3. return persisted + stamped with the exchange-sale link
    expect(res.returns).toHaveLength(1);
    expect(res.returns[0].id).toBe('RET-1');
    expect(res.returns[0].exchangeSaleId).toBe('SALE-EXCHANGE');
    expect(res.returns[0].exchangeInvoiceNumber).toBe('INV-002');
    expect(res.persistedReturns).toHaveLength(1);
  });

  it('marks fullyReturned when the whole line qty is returned', () => {
    const res = finalizeExchangeReturn({
      drafts: [makeDraft({ itemMutations: [{ saleItemId: 'LINE-A', qty: 2 }] })],
      sales: [makeSale()],
      inventory: [makeInv('INV-A', 3)],
      returns: [],
      exchangeSaleId: 'SALE-EXCHANGE',
      exchangeInvoiceNumber: 'INV-002',
    });
    const line = res.sales[0].items.find((i) => i.id === 'LINE-A')!;
    expect(line.returnedQty).toBe(2);
    expect(line.fullyReturned).toBe(true);
  });

  it('is idempotent — a draft whose return already exists is a no-op', () => {
    const existing = makeReturnRecord('RET-1');
    const inventory = [makeInv('INV-A', 3)];
    const res = finalizeExchangeReturn({
      drafts: [makeDraft()],
      sales: [makeSale()],
      inventory,
      returns: [existing], // already finalized
      exchangeSaleId: 'SALE-EXCHANGE',
      exchangeInvoiceNumber: 'INV-002',
    });
    // nothing changes: no double-increment, no double-restock, no duplicate record
    expect(res.salesChanged).toBe(false);
    expect(res.inventoryChanged).toBe(false);
    expect(res.returnsChanged).toBe(false);
    expect(res.inventory.find((i) => i.id === 'INV-A')!.qty).toBe(3);
    expect(res.returns).toHaveLength(1);
    expect(res.sales[0].items.find((i) => i.id === 'LINE-A')!.returnedQty).toBeUndefined();
  });

  it('does not double-apply when called twice with its own output (retry safety)', () => {
    const first = finalizeExchangeReturn({
      drafts: [makeDraft()],
      sales: [makeSale()],
      inventory: [makeInv('INV-A', 3)],
      returns: [],
      exchangeSaleId: 'SALE-EXCHANGE',
      exchangeInvoiceNumber: 'INV-002',
    });
    const second = finalizeExchangeReturn({
      drafts: [makeDraft()],
      sales: first.sales,
      inventory: first.inventory,
      returns: first.returns,
      exchangeSaleId: 'SALE-EXCHANGE-RETRY',
      exchangeInvoiceNumber: 'INV-003',
    });
    expect(second.salesChanged).toBe(false);
    expect(second.inventoryChanged).toBe(false);
    expect(second.returnsChanged).toBe(false);
    expect(second.inventory.find((i) => i.id === 'INV-A')!.qty).toBe(4); // still +1, not +2
    expect(second.returns).toHaveLength(1);
  });

  it('still restocks and persists the return when the original sale is absent', () => {
    const res = finalizeExchangeReturn({
      drafts: [makeDraft()],
      sales: [], // original sale not loaded
      inventory: [makeInv('INV-A', 3)],
      returns: [],
      exchangeSaleId: 'SALE-EXCHANGE',
      exchangeInvoiceNumber: 'INV-002',
    });
    expect(res.salesChanged).toBe(false);
    expect(res.inventoryChanged).toBe(true);
    expect(res.inventory.find((i) => i.id === 'INV-A')!.qty).toBe(4);
    expect(res.returnsChanged).toBe(true);
    expect(res.returns).toHaveLength(1);
  });
});
