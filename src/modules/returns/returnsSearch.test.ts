// P0-RET-1 — behavioral tests for the canonical Returns Find-Sale engine.
// Pure (node env). Covers the confirmed owner failure (30 unrelated sales),
// IMEI/SKU lookup, mode isolation, no-match, and filter-before-limit.

import { describe, it, expect } from 'vitest';
import { searchReturnSales, MIN_ID_DIGITS, RETURN_SEARCH_LIMIT } from './returnsSearch';
import type { Sale, SaleItem } from '@/store/types';

let seq = 0;
const item = (over: Partial<SaleItem> = {}): SaleItem => ({
  id: `it-${seq++}`, name: 'Item', category: 'accessory' as SaleItem['category'],
  price: 1000, qty: 1, cbeEligible: false, taxable: true, ...over,
});
const sale = (over: Partial<Sale> = {}, dayOffset = 0): Sale => ({
  id: `sale-${seq++}`,
  invoiceNumber: over.invoiceNumber ?? `INV-${1000 + seq}`,
  items: over.items ?? [item()],
  // deterministic descending timeline: larger dayOffset = older
  createdAt: new Date(2026, 0, 1 + (100 - dayOffset)).toISOString() as unknown as Sale['createdAt'],
  total: 1000, subtotal: 1000, taxAmount: 0, paymentMethod: 'Cash', status: 'completed',
  ...over,
} as Sale);

const ids = (rs: Sale[]) => rs.map((r) => r.id);

describe('searchReturnSales — the "30 unrelated sales" bug (§12)', () => {
  it('a product-name query returns ONLY sales with that product, not recent sales', () => {
    const samsung = sale({ id: 'samsung', items: [item({ name: 'SAMSUNG GALAXY A15' })] });
    const airpods = sale({ id: 'airpods', items: [item({ name: 'Apple AirPods' })] });
    const noise = Array.from({ length: 40 }, (_, i) => sale({ id: `n${i}`, items: [item({ name: 'Random Case' })] }));
    const res = searchReturnSales([samsung, airpods, ...noise], { mode: 'any', query: 'SAMSUNG GALAXY A15' });
    expect(ids(res)).toEqual(['samsung']);
    expect(res).not.toContainEqual(expect.objectContaining({ id: 'airpods' }));
  });

  it('a query with NO digits does not match every sale via the invoice/phone digit fallback', () => {
    const airpods = sale({ id: 'airpods', items: [item({ name: 'Apple AirPods' })], customerPhone: '8055551212', invoiceNumber: 'INV-1015' });
    const other = sale({ id: 'other', items: [item({ name: 'Screen Protector' })], customerPhone: '8055559999', invoiceNumber: 'INV-2015' });
    // "AIRPODS" strips to "" digits — must NOT match `other` through invoice/phone.
    const res = searchReturnSales([airpods, other], { mode: 'any', query: 'AIRPODS' });
    expect(ids(res)).toEqual(['airpods']);
  });

  it('an incidental short number in a product name ("A15" → "15") does not match invoices/phones', () => {
    const s = sale({ id: 'phone', items: [item({ name: 'Galaxy A15' })], invoiceNumber: 'INV-1150', customerPhone: '4151550000' });
    const junk = sale({ id: 'junk', items: [item({ name: 'Cable' })], invoiceNumber: 'INV-2159', customerPhone: '2025551599' });
    const res = searchReturnSales([s, junk], { mode: 'any', query: 'Galaxy A15' });
    expect(ids(res)).toEqual(['phone']); // junk's invoice/phone contain "15" but must NOT match
  });

  it('a matching sale OLDER than the recent-limit window is still found (filter before limit)', () => {
    const target = sale({ id: 'old-samsung', items: [item({ name: 'SAMSUNG GALAXY A15' })] }, /*old*/ 90);
    const recent = Array.from({ length: 40 }, (_, i) => sale({ id: `r${i}`, items: [item({ name: 'Case' })] }, /*newer*/ i));
    const res = searchReturnSales([target, ...recent], { mode: 'item', query: 'samsung' });
    expect(ids(res)).toEqual(['old-samsung']);
  });

  it('a non-empty query with zero matches returns [] (never the recent 30)', () => {
    const noise = Array.from({ length: 40 }, (_, i) => sale({ id: `n${i}` }));
    expect(searchReturnSales(noise, { mode: 'any', query: 'NONEXISTENT-PRODUCT-XYZ' })).toEqual([]);
  });

  it('caps at RETURN_SEARCH_LIMIT after filtering', () => {
    const many = Array.from({ length: 50 }, (_, i) => sale({ id: `m${i}`, items: [item({ name: 'SAMSUNG GALAXY A15' })] }, i));
    const res = searchReturnSales(many, { mode: 'item', query: 'samsung' });
    expect(res.length).toBe(RETURN_SEARCH_LIMIT);
  });
});

describe('searchReturnSales — modes (§10)', () => {
  const samsung = sale({ id: 'samsung', customerName: 'Jorge Ochoa', customerPhone: '8055551212', invoiceNumber: 'INV-4242', items: [item({ name: 'SAMSUNG GALAXY A15', sku: 'SAM-A15' })] });
  const airpods = sale({ id: 'airpods', customerName: 'Maria Lopez', customerPhone: '3105550000', invoiceNumber: 'INV-9999', items: [item({ name: 'Apple AirPods', sku: 'APL-POD' })] });
  const all = [samsung, airpods];

  it('exact invoice → exact sale', () => {
    expect(ids(searchReturnSales(all, { mode: 'invoice', query: 'INV-4242' }))).toEqual(['samsung']);
  });
  it('unknown invoice → []', () => {
    expect(searchReturnSales(all, { mode: 'invoice', query: 'INV-0000' })).toEqual([]);
  });
  it('customer phone: formatted and unformatted match', () => {
    expect(ids(searchReturnSales(all, { mode: 'phone', query: '(805) 555-1212' }))).toEqual(['samsung']);
    expect(ids(searchReturnSales(all, { mode: 'phone', query: '8055551212' }))).toEqual(['samsung']);
  });
  it('customer name: partial, case-insensitive', () => {
    expect(ids(searchReturnSales(all, { mode: 'name', query: 'jorge' }))).toEqual(['samsung']);
  });
  it('mode isolation: item mode does NOT match a customer name', () => {
    expect(searchReturnSales(all, { mode: 'item', query: 'jorge' })).toEqual([]);
  });
  it('mode isolation: name mode does NOT match an item name', () => {
    expect(searchReturnSales(all, { mode: 'name', query: 'galaxy' })).toEqual([]);
  });
  it('mode isolation: invoice mode does NOT match a SKU', () => {
    expect(searchReturnSales(all, { mode: 'invoice', query: 'SAM-A15' })).toEqual([]);
  });
  it('any mode searches all supported fields', () => {
    expect(ids(searchReturnSales(all, { mode: 'any', query: 'jorge' }))).toEqual(['samsung']);
    expect(ids(searchReturnSales(all, { mode: 'any', query: 'airpods' }))).toEqual(['airpods']);
    expect(ids(searchReturnSales(all, { mode: 'any', query: 'INV-4242' }))).toEqual(['samsung']);
  });
});

describe('searchReturnSales — sold-item identifiers (§11)', () => {
  it('15-digit phone IMEI finds its sale (IMEI is persisted but was never searched)', () => {
    const phone = sale({ id: 'phone', items: [item({ name: 'Galaxy S24', category: 'phone' as SaleItem['category'], imei: '354879112345678' })] });
    const other = sale({ id: 'other', items: [item({ name: 'Case' })] });
    expect(ids(searchReturnSales([phone, other], { mode: 'item', query: '354879112345678' }))).toEqual(['phone']);
    expect(ids(searchReturnSales([phone, other], { mode: 'any', query: '354879112345678' }))).toEqual(['phone']);
  });
  it('IMEI with a leading zero is preserved (no numeric coercion)', () => {
    const phone = sale({ id: 'phone', items: [item({ imei: '012345678901234' })] });
    expect(ids(searchReturnSales([phone], { mode: 'item', query: '012345678901234' }))).toEqual(['phone']);
    // The numerically-equal but string-different value must NOT match.
    expect(searchReturnSales([phone], { mode: 'item', query: '12345678901234' })).toEqual([]);
  });
  it('accessory SKU (alphanumeric, hyphen) finds its sale', () => {
    const acc = sale({ id: 'acc', items: [item({ name: 'USB-C Cable', sku: 'CBL-USBC-01' })] });
    expect(ids(searchReturnSales([acc], { mode: 'item', query: 'cbl-usbc-01' }))).toEqual(['acc']);
  });
  it('duplicate SKU across multiple sales → all returned', () => {
    const a = sale({ id: 'a', items: [item({ sku: 'DUP-1' })] }, 1);
    const b = sale({ id: 'b', items: [item({ sku: 'DUP-1' })] }, 2);
    const res = searchReturnSales([a, b], { mode: 'item', query: 'DUP-1' });
    expect(ids(res).sort()).toEqual(['a', 'b']);
  });
  it('mixed sale (phone + accessory) matches by either identifier', () => {
    const mixed = sale({ id: 'mixed', items: [item({ name: 'Galaxy S24', imei: '111222333444555' }), item({ name: 'Case', sku: 'CASE-1' })] });
    expect(ids(searchReturnSales([mixed], { mode: 'item', query: '111222333444555' }))).toEqual(['mixed']);
    expect(ids(searchReturnSales([mixed], { mode: 'item', query: 'CASE-1' }))).toEqual(['mixed']);
  });
  it('missing optional identifiers do not crash', () => {
    const bare = sale({ id: 'bare', items: [item({ name: 'Thing', sku: undefined, imei: undefined })] });
    expect(() => searchReturnSales([bare], { mode: 'item', query: 'thing' })).not.toThrow();
    expect(ids(searchReturnSales([bare], { mode: 'item', query: 'thing' }))).toEqual(['bare']);
  });
});

describe('searchReturnSales — dates, voided, guards (§10/§15)', () => {
  it('date range filters by completed-sale timestamp (in-range kept, out-of-range excluded)', () => {
    const inRange = sale({ id: 'in', invoiceNumber: 'INV-A', items: [item({ name: 'X' })], createdAt: '2026-02-15T10:00:00.000Z' as unknown as Sale['createdAt'] });
    const outRange = sale({ id: 'out', invoiceNumber: 'INV-B', items: [item({ name: 'X' })], createdAt: '2026-03-15T10:00:00.000Z' as unknown as Sale['createdAt'] });
    const res = searchReturnSales([inRange, outRange], { mode: 'date', query: '', dateFrom: '2026-02-01', dateTo: '2026-02-28' });
    expect(ids(res)).toEqual(['in']);
  });
  it('voided sales are excluded', () => {
    const v = sale({ id: 'v', status: 'voided', items: [item({ name: 'SAMSUNG GALAXY A15' })] });
    expect(searchReturnSales([v], { mode: 'item', query: 'samsung' })).toEqual([]);
  });
  it('whitespace-only query behaves like empty (no query filter, date only)', () => {
    const s = sale({ id: 's' });
    // no date + blank query → returns everything (the caller guards the blank case)
    expect(ids(searchReturnSales([s], { mode: 'any', query: '   ' }))).toEqual(['s']);
  });
  it('MIN_ID_DIGITS is the identifier threshold', () => {
    expect(MIN_ID_DIGITS).toBe(4);
  });
});
