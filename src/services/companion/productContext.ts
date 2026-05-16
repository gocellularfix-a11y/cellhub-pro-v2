// Companion — Build a safe product/discount context from inventory.
//
// Read-only: the function takes the live inventory array (caller passes
// useApp().state.inventory) and returns a typed ProductCostContext or
// undefined if no match is found. NEVER mutates inventory.
//
// Money is cents end-to-end. Tax is not part of margin math here.

import type { InventoryItem } from '@/store/types';
import type { ProductCostContext } from '@/types/companion';

export interface ProductContextLookup {
  /** SKU, barcode, IMEI, item id, or name to match against. */
  query: string;
  inventory: InventoryItem[];
  /** Requested discount in cents (one of these two is enough). */
  requestedDiscountCents?: number;
  /** Requested discount as a percent (0-100). */
  requestedDiscountPercent?: number;
}

function findItem(query: string, inventory: InventoryItem[]): InventoryItem | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  // Exact SKU / barcode / imei / id first.
  for (const it of inventory) {
    if (it.sku?.toLowerCase() === q) return it;
    if (it.barcode?.toLowerCase() === q) return it;
    if (it.imei?.toLowerCase() === q) return it;
    if (it.id?.toLowerCase() === q) return it;
  }
  // Loose name match as a fallback.
  for (const it of inventory) {
    if (it.name?.toLowerCase() === q) return it;
  }
  for (const it of inventory) {
    if (it.name?.toLowerCase().includes(q)) return it;
  }
  return undefined;
}

/**
 * Returns a `ProductCostContext` if the query matches an inventory item.
 * If no match: returns undefined so the approval is sent WITHOUT context
 * (mobile renders "Cost not available").
 */
export function deriveProductContext(input: ProductContextLookup): ProductCostContext | undefined {
  const item = findItem(input.query, input.inventory);
  if (!item) return undefined;
  return {
    name: item.name,
    sku: item.sku,
    retailCents: item.price,
    costCents: typeof item.cost === 'number' ? item.cost : undefined,
    requestedDiscountCents: input.requestedDiscountCents,
    requestedDiscountPercent: input.requestedDiscountPercent,
  };
}
