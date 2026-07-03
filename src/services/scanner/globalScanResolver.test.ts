// ============================================================
// R-GLOBAL-SCAN-ANYWHERE-V1 — global scan resolver tests
// Pure-function coverage: ticket/document resolution priority,
// exact inventory matching (no fuzzy adds), POS-identical cart
// construction, and stock-guarded cart adds.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  resolveDocumentByTicket,
  resolveInventoryByExactCode,
  buildCartItemFromInventory,
  addInventoryItemToCart,
  getInventoryStock,
} from './globalScanResolver';
import type { CartItem, InventoryItem } from '@/store/types';

const inv = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'item-1',
  sku: 'SKU-1',
  name: 'Test Item',
  category: 'accessory' as InventoryItem['category'],
  cost: 500,
  price: 1999,
  qty: 3,
  cbeEligible: false,
  taxable: true,
  createdAt: '2026-01-01',
  ...over,
});

const DOCS = {
  repairs: [{ id: 'rep-abcdef12', ticketNumber: 'RPR-260701-1234' } as { id: string }],
  unlocks: [{ id: 'unl-11112222', ticketNumber: 'UNL-260701-9999' } as { id: string }],
  layaways: [{ id: 'lay-33334444' } as { id: string }],
  specialOrders: [{ id: 'so-55556666' } as { id: string }],
};

describe('resolveDocumentByTicket', () => {
  it('matches a repair by ticketNumber (case-insensitive)', () => {
    expect(resolveDocumentByTicket('rpr-260701-1234', DOCS)).toEqual({ kind: 'repair', id: 'rep-abcdef12' });
  });

  it('matches by the printed id.slice(-8) fallback', () => {
    expect(resolveDocumentByTicket('33334444', DOCS)).toEqual({ kind: 'layaway', id: 'lay-33334444' });
    expect(resolveDocumentByTicket('55556666', DOCS)).toEqual({ kind: 'special_order', id: 'so-55556666' });
  });

  it('matches unlock tickets', () => {
    expect(resolveDocumentByTicket('UNL-260701-9999', DOCS)).toEqual({ kind: 'unlock', id: 'unl-11112222' });
  });

  it('returns null when nothing matches', () => {
    expect(resolveDocumentByTicket('NOPE-000', DOCS)).toBeNull();
    expect(resolveDocumentByTicket('', DOCS)).toBeNull();
  });

  it('does not partial-match id tails shorter than 8 chars', () => {
    expect(resolveDocumentByTicket('3444', DOCS)).toBeNull();
  });
});

describe('resolveInventoryByExactCode', () => {
  const inventory = [
    inv({ id: 'a', sku: 'CASE-IP15', barcode: '012345678905' }),
    inv({ id: 'b', sku: 'PHN-S24', imei: '356789012345678', category: 'phone' as InventoryItem['category'] }),
  ];

  it('matches barcode, sku, and imei exactly (case-insensitive)', () => {
    expect(resolveInventoryByExactCode('012345678905', inventory)?.id).toBe('a');
    expect(resolveInventoryByExactCode('case-ip15', inventory)?.id).toBe('a');
    expect(resolveInventoryByExactCode('356789012345678', inventory)?.id).toBe('b');
  });

  it('prefers barcode over sku when both could match', () => {
    const clash = [
      inv({ id: 'skuHit', sku: 'X1000' }),
      inv({ id: 'barcodeHit', sku: 'OTHER', barcode: 'X1000' }),
    ];
    expect(resolveInventoryByExactCode('X1000', clash)?.id).toBe('barcodeHit');
  });

  it('never fuzzy/partial matches', () => {
    expect(resolveInventoryByExactCode('CASE', inventory)).toBeNull();
    expect(resolveInventoryByExactCode('01234567890', inventory)).toBeNull();
  });
});

describe('buildCartItemFromInventory', () => {
  it('copies fields and keeps the taxable flag for regular categories', () => {
    const item = inv({ imei: '351111111111111' });
    const line = buildCartItemFromInventory(item);
    expect(line.inventoryId).toBe('item-1');
    expect(line.name).toBe('Test Item');
    expect(line.sku).toBe('SKU-1');
    expect(line.imei).toBe('351111111111111');
    expect(line.price).toBe(1999);
    expect(line.originalPrice).toBe(1999);
    expect(line.cost).toBe(500);
    expect(line.qty).toBe(1);
    expect(line.taxable).toBe(true);
  });

  it('forces taxable=false for phone_payment / top_up / quick_charge', () => {
    for (const category of ['phone_payment', 'top_up', 'quick_charge']) {
      const line = buildCartItemFromInventory(inv({ taxable: true, category: category as InventoryItem['category'] }));
      expect(line.taxable).toBe(false);
    }
  });

  it('keeps service items taxable when flagged (excluded from the override)', () => {
    const line = buildCartItemFromInventory(inv({ taxable: true, category: 'service' as InventoryItem['category'] }));
    expect(line.taxable).toBe(true);
  });
});

describe('addInventoryItemToCart', () => {
  it('appends a new line for an item not in the cart', () => {
    const res = addInventoryItemToCart([], inv({}));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.cart).toHaveLength(1);
      expect(res.cart[0].qty).toBe(1);
    }
  });

  it('increments qty for an item already in the cart', () => {
    const item = inv({});
    const first = addInventoryItemToCart([], item);
    if (!first.ok) throw new Error('unexpected');
    const second = addInventoryItemToCart(first.cart, item);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.cart).toHaveLength(1);
      expect(second.cart[0].qty).toBe(2);
    }
  });

  it('blocks out-of-stock items', () => {
    const res = addInventoryItemToCart([], inv({ qty: 0 }));
    expect(res).toEqual({ ok: false, reason: 'out_of_stock' });
  });

  it('caps qty at available stock', () => {
    const item = inv({ qty: 1 });
    const first = addInventoryItemToCart([], item);
    if (!first.ok) throw new Error('unexpected');
    const second = addInventoryItemToCart(first.cart, item);
    expect(second).toEqual({ ok: false, reason: 'not_enough_stock' });
  });

  it('treats services as unlimited stock', () => {
    const svc = inv({ category: 'service' as InventoryItem['category'], qty: 0 });
    expect(getInventoryStock(svc)).toBe(999);
    const existing: CartItem[] = [];
    const res = addInventoryItemToCart(existing, svc);
    expect(res.ok).toBe(true);
  });

  it('never mutates the input cart', () => {
    const item = inv({});
    const original: CartItem[] = [];
    addInventoryItemToCart(original, item);
    expect(original).toHaveLength(0);
  });
});
