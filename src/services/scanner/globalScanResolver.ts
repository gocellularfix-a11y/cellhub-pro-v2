// ============================================================
// CellHub Pro — Global Scan Resolver (R-GLOBAL-SCAN-ANYWHERE-V1)
//
// Shared scanner→cart building blocks used by BOTH the POS module and the
// global AppShell scanner, so there is exactly ONE definition of:
//   • how much stock an inventory item has        (getInventoryStock)
//   • how an InventoryItem becomes a CartItem     (buildCartItemFromInventory)
//   • how a scanned code resolves to a ticket     (resolveDocumentByTicket)
//   • how a scanned code resolves to inventory    (resolveInventoryByExactCode)
//   • how a resolved item lands in the cart       (addInventoryItemToCart)
//
// Priority contract (enforced by AppShell's handleInventoryScan):
//   1. Document/action barcodes (CHP|, CH:, INV-, credential shapes) never
//      reach this service — useBarcodeScanner routes them upstream to the
//      BarcodeActionModal / customer-lookup paths.
//   2. Ticket barcodes (repair / unlock / layaway / special order — printed
//      as ticketNumber or the id.slice(-8) fallback) resolve here FIRST and
//      open the entity. They are NEVER added to the cart.
//   3. Inventory EXACT identifier match (barcode / SKU / IMEI) → cart add.
//      Exact only — a global scan must not fuzzy-add what a search would.
//   4. No match → caller shows a safe toast. Nothing is created or mutated.
//
// Pure functions only: no state, no persist, no tax math. The taxable flag
// is copied from the inventory item exactly like POS addToCart always did;
// POS-only custom-category taxMode overrides stay in POSModule.
// ============================================================

import { generateId } from '@/utils/dates';
import type { CartItem, InventoryItem } from '@/store/types';

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase();

// ── Ticket / document resolution ──────────────────────────

export type ScannedDocumentKind = 'repair' | 'unlock' | 'layaway' | 'special_order';

export interface ScannedDocumentMatch {
  kind: ScannedDocumentKind;
  id: string;
}

interface TicketEntity {
  id: string;
}

// Printed ticket barcodes are `entity.ticketNumber` when present, else the
// `id.slice(-8).toUpperCase()` fallback (RepairModule/UnlockModule/
// LayawayModule/SpecialOrdersModule all render one of these two).
function ticketMatches(code: string, entity: TicketEntity): boolean {
  const c = norm(code);
  if (!c) return false;
  const tn = norm((entity as unknown as { ticketNumber?: string }).ticketNumber);
  if (tn && tn === c) return true;
  const idTail = norm(String(entity.id || '').slice(-8));
  return idTail.length === 8 && idTail === c;
}

export function resolveDocumentByTicket(
  code: string,
  docs: {
    repairs: TicketEntity[];
    unlocks: TicketEntity[];
    layaways: TicketEntity[];
    specialOrders: TicketEntity[];
  },
): ScannedDocumentMatch | null {
  const r = docs.repairs.find((e) => ticketMatches(code, e));
  if (r) return { kind: 'repair', id: r.id };
  const u = docs.unlocks.find((e) => ticketMatches(code, e));
  if (u) return { kind: 'unlock', id: u.id };
  const l = docs.layaways.find((e) => ticketMatches(code, e));
  if (l) return { kind: 'layaway', id: l.id };
  const s = docs.specialOrders.find((e) => ticketMatches(code, e));
  if (s) return { kind: 'special_order', id: s.id };
  return null;
}

// ── Inventory resolution ──────────────────────────────────

// GSCAN-1: structured resolution. Lookup order barcode → SKU → IMEI (the
// identifiers CellHub inventory actually carries — IMEI is the serialized
// identifier; there is no separate serialNumber field in InventoryItem).
// EXACT match only, never fuzzy. When several DISTINCT records share the
// winning identifier the result is an explicit ambiguity — the caller uses
// the existing selection mechanism (POS search) instead of silently adding
// the first record. Inventory arriving here is already store-scoped by
// AppProvider's belongs() filter, so cross-store items can never resolve.
export type InventoryScanResolution =
  | { kind: 'match'; item: InventoryItem }
  | { kind: 'ambiguous'; candidates: InventoryItem[] }
  | { kind: 'none' };

export function resolveInventoryCandidatesByExactCode(
  code: string,
  inventory: InventoryItem[],
): InventoryScanResolution {
  const c = norm(code);
  if (!c) return { kind: 'none' };
  const eq = (field: string | undefined) => !!field && norm(field) === c;
  const tiers: Array<(i: InventoryItem) => boolean> = [
    (i) => eq(i.barcode),
    (i) => eq(i.sku),
    (i) => eq(i.imei),
  ];
  for (const match of tiers) {
    const found = inventory.filter(match);
    if (found.length === 1) return { kind: 'match', item: found[0] };
    if (found.length > 1) return { kind: 'ambiguous', candidates: found.slice(0, 5) };
  }
  return { kind: 'none' };
}

/** Legacy single-item resolution — first candidate of the structured
 *  resolver (identical order semantics to the original implementation).
 *  Kept for existing consumers/tests; the global scan path uses the
 *  structured resolver so ambiguity is never silently collapsed. */
export function resolveInventoryByExactCode(
  code: string,
  inventory: InventoryItem[],
): InventoryItem | null {
  const res = resolveInventoryCandidatesByExactCode(code, inventory);
  if (res.kind === 'match') return res.item;
  if (res.kind === 'ambiguous') return res.candidates[0];
  return null;
}

// ── Stock + cart building (extracted from POSModule) ──────

export function getInventoryStock(item: InventoryItem): number {
  // For services, stock is unlimited
  if (item.category === 'service') return 999;
  return item.qty || (item as unknown as { quantity?: number }).quantity || 0;
}

export function buildCartItemFromInventory(item: InventoryItem): CartItem {
  // Use the inventory item's taxable flag as the authoritative source.
  // phone_payment / top_up / quick_charge always bypass sales tax —
  // they generate utility tax or follow a separate fee structure.
  // 'service' is intentionally excluded from the override so taxable
  // repair/installation items are charged correctly.
  const taxable = item.taxable
    && !['phone_payment', 'top_up', 'quick_charge'].includes(item.category);

  return {
    id: generateId(),
    inventoryId: item.id,
    name: item.name,
    sku: item.sku,
    imei: item.imei,
    category: item.category,
    price: item.price,
    originalPrice: item.price,
    cost: item.cost,
    qty: 1,
    taxable,
    cbeEligible: item.cbeEligible,
    screenFeeEligible: item.screenFeeEligible,
    notes: '',
  };
}

export type AddInventoryToCartResult =
  | { ok: true; cart: CartItem[] }
  | { ok: false; reason: 'out_of_stock' | 'not_enough_stock' };

export function addInventoryItemToCart(
  cart: CartItem[],
  item: InventoryItem,
): AddInventoryToCartResult {
  const stock = getInventoryStock(item);
  if (stock <= 0) return { ok: false, reason: 'out_of_stock' };

  const existing = cart.find((c) => c.inventoryId === item.id);
  if (existing) {
    if (existing.qty >= stock) return { ok: false, reason: 'not_enough_stock' };
    return {
      ok: true,
      cart: cart.map((c) => (c.inventoryId === item.id ? { ...c, qty: c.qty + 1 } : c)),
    };
  }
  return { ok: true, cart: [...cart, buildCartItemFromInventory(item)] };
}
