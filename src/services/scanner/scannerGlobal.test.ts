// ============================================================
// GSCAN-1 — global scan pipeline tests (resolver + architecture guards).
//
// Node-env coverage in the repo convention: pure resolver behavior plus
// source-level architecture assertions that lock the single-listener rule
// (screens never mount their own scanner) and the centralized security
// exemption. Per-screen React mounting is not executable in the node test
// env — the tab-independence is proven structurally: the ONE listener
// lives on `window` in AppShell, which renders every operational tab.
// ============================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveInventoryCandidatesByExactCode,
  resolveInventoryByExactCode,
  addInventoryItemToCart,
} from './globalScanResolver';
import type { CartItem, InventoryItem } from '@/store/types';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(DIR, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const inv = (over: Partial<InventoryItem>): InventoryItem => ({
  id: `item-${Math.random().toString(36).slice(2, 8)}`,
  sku: 'SKU-X',
  name: 'Item',
  category: 'accessory' as InventoryItem['category'],
  cost: 500, price: 1999, qty: 3,
  cbeEligible: false, taxable: true, createdAt: '2026-01-01',
  ...over,
});

// ══ Structured inventory resolution ═════════════════════════
describe('GSCAN-1 — structured inventory resolution', () => {
  const CATALOG = [
    inv({ id: 'i-upc', barcode: '001234567890', sku: 'CASE-1', name: 'Case' }),
    inv({ id: 'i-sku', sku: 'CHG-20W', name: 'Charger' }),
    inv({ id: 'i-imei', sku: 'PHN-1', imei: '354442067957713', name: 'Phone A', qty: 1 }),
  ];
  it('lookup by exact barcode (leading zeros intact)', () => {
    const r = resolveInventoryCandidatesByExactCode('001234567890', CATALOG);
    expect(r).toEqual({ kind: 'match', item: CATALOG[0] });
  });
  it('lookup by exact SKU (case-insensitive)', () => {
    const r = resolveInventoryCandidatesByExactCode('chg-20w', CATALOG);
    expect(r.kind).toBe('match');
    expect((r as { item: InventoryItem }).item.id).toBe('i-sku');
  });
  it('lookup by exact IMEI (serialized identifier)', () => {
    const r = resolveInventoryCandidatesByExactCode('354442067957713', CATALOG);
    expect(r.kind).toBe('match');
    expect((r as { item: InventoryItem }).item.id).toBe('i-imei');
  });
  it('unknown code → none (nothing created, nothing guessed)', () => {
    expect(resolveInventoryCandidatesByExactCode('999999999999', CATALOG)).toEqual({ kind: 'none' });
    expect(resolveInventoryCandidatesByExactCode('', CATALOG)).toEqual({ kind: 'none' });
  });
  it('DISTINCT records sharing an identifier → explicit ambiguity, never a silent pick', () => {
    const dupes = [
      inv({ id: 'a1', barcode: '111222333444', name: 'Case Red' }),
      inv({ id: 'a2', barcode: '111222333444', name: 'Case Blue' }),
    ];
    const r = resolveInventoryCandidatesByExactCode('111222333444', dupes);
    expect(r.kind).toBe('ambiguous');
    expect((r as { candidates: InventoryItem[] }).candidates.map((c) => c.id)).toEqual(['a1', 'a2']);
  });
  it('tier priority: a barcode match wins before any SKU match is considered', () => {
    const tiered = [
      inv({ id: 'by-sku', sku: 'SHARED-1' }),
      inv({ id: 'by-barcode', barcode: 'SHARED-1', sku: 'OTHER' }),
    ];
    const r = resolveInventoryCandidatesByExactCode('SHARED-1', tiered);
    expect(r.kind).toBe('match');
    expect((r as { item: InventoryItem }).item.id).toBe('by-barcode');
  });
  it('legacy resolveInventoryByExactCode keeps identical first-match semantics', () => {
    const dupes = [inv({ id: 'a1', barcode: 'D1' }), inv({ id: 'a2', barcode: 'D1' })];
    expect(resolveInventoryByExactCode('D1', dupes)!.id).toBe('a1');
    expect(resolveInventoryByExactCode('missing', dupes)).toBeNull();
  });
});

// ══ Serialized / stock cart guards (canonical add path) ═════
describe('GSCAN-1 — serialized and stock guards on the canonical add', () => {
  it('a sold-out serialized item (qty 0) never adds', () => {
    const phone = inv({ id: 'p1', imei: '354442067957713', qty: 0 });
    expect(addInventoryItemToCart([], phone)).toEqual({ ok: false, reason: 'out_of_stock' });
  });
  it('the same serialized unit cannot be added twice to one cart', () => {
    const phone = inv({ id: 'p1', imei: '354442067957713', qty: 1 });
    const first = addInventoryItemToCart([], phone);
    expect(first.ok).toBe(true);
    const second = addInventoryItemToCart((first as { cart: CartItem[] }).cart, phone);
    expect(second).toEqual({ ok: false, reason: 'not_enough_stock' });
  });
  it('another serial of the same model is never auto-selected (exact IMEI only)', () => {
    const units = [
      inv({ id: 'u1', sku: 'MODEL-X', imei: '111111111111111', qty: 1 }),
      inv({ id: 'u2', sku: 'MODEL-X', imei: '222222222222222', qty: 1 }),
    ];
    const r = resolveInventoryCandidatesByExactCode('111111111111111', units);
    expect(r.kind).toBe('match');
    expect((r as { item: InventoryItem }).item.id).toBe('u1');   // never u2
  });
});

// ══ Architecture guards (single listener, central security) ═
describe('GSCAN-1 — single-listener architecture', () => {
  it('exactly ONE useBarcodeScanner mount, in AppShell', () => {
    const appShell = read('components/layout/AppShell.tsx');
    expect(appShell.match(/useBarcodeScanner\(\{/g)?.length).toBe(1);
    // No operational module mounts its own scanner pipeline.
    for (const mod of ['pos/POSModule.tsx', 'customers/CustomerModule.tsx', 'repairs/RepairModule.tsx', 'inventory/InventoryModule.tsx', 'reports/ReportsModule.tsx']) {
      const src = read(`modules/${mod}`);
      expect(src.includes('useBarcodeScanner'), mod).toBe(false);
    }
  });
  it('the hook registers exactly one window keydown listener with cleanup', () => {
    const hook = read('hooks/useBarcodeScanner.ts');
    expect(hook.match(/window\.addEventListener\('keydown'/g)?.length).toBe(1);
    expect(hook.match(/window\.removeEventListener\('keydown'/g)?.length).toBe(1);
    expect(hook.includes("addEventListener('keypress'")).toBe(false);   // never double-processed
  });
  it('timing thresholds come from the pure module (no magic numbers in the hook)', () => {
    const hook = read('hooks/useBarcodeScanner.ts');
    expect(hook.includes('createScannerSequenceTracker')).toBe(true);
    expect(hook.includes('SCANNER_AUTOFLUSH_MS')).toBe(true);
    expect(hook.includes('SCANNER_MIN_LENGTH')).toBe(true);
    expect(hook.includes('SCANNER_MAX_INTERKEY_MS')).toBe(true);
  });
  it('the security exemption is centralized (password inputs + data-scanner-exempt)', () => {
    const hook = read('hooks/useBarcodeScanner.ts');
    expect(hook.includes('isScanExemptTarget')).toBe(true);
    expect(hook.includes("type === 'password'")).toBe(true);
    expect(hook.includes('data-scanner-exempt')).toBe(true);
    // Both flush paths consult the guard.
    expect(hook.match(/isScanExemptTarget\(/g)!.length).toBeGreaterThanOrEqual(3);
    // The PIN gates are protected by input type, verified here:
    expect(read('components/shared/AdminPinGate.tsx').includes('type="password"')).toBe(true);
    expect(read('components/shared/ApprovalPinModal.tsx').includes('type="password"')).toBe(true);
  });
  it('P0-INV-1: the guard is exposed as a pure predicate (node-testable)', () => {
    const hook = read('hooks/useBarcodeScanner.ts');
    // The DOM adapter delegates to the pure, exported decision.
    expect(hook.includes('export function isScanExemptElement')).toBe(true);
    expect(hook.includes('isScanExemptElement(')).toBe(true);
  });
  it('P0-INV-1: the Inventory New Item / Edit modal CLAIMS scan ownership via data-scanner-exempt', () => {
    const inv = read('modules/inventory/InventoryModule.tsx');
    // The form modal marks its content data-scanner-exempt so the global scanner
    // skips routing while it is open — the scan lands in the SKU/IMEI field
    // instead of firing a global inventory lookup + "No match found" toast.
    expect(inv.includes('data-scanner-exempt')).toBe(true);
    // The ownership claim lives inside the InventoryFormModal render (the modal),
    // not on the page grid — so it is scoped to the modal's DOM lifetime.
    const modalStart = inv.indexOf('function InventoryFormModal');
    expect(modalStart).toBeGreaterThan(-1);
    expect(inv.indexOf('data-scanner-exempt', modalStart)).toBeGreaterThan(modalStart);
  });
  it('AppShell scan flow uses the canonical shared services only (no duplicated inventory logic)', () => {
    const appShell = read('components/layout/AppShell.tsx');
    expect(appShell.includes('resolveInventoryCandidatesByExactCode')).toBe(true);
    expect(appShell.includes('resolveDocumentByTicket')).toBe(true);
    expect(appShell.includes('addInventoryItemToCart')).toBe(true);
    expect(appShell.includes('commitCart')).toBe(true);
  });
});
