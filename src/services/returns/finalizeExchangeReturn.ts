// R-RETURNS-PHASE-2B — pure exchange-return finalization.
//
// For an exchange return, the Returns modal builds a `PendingExchangeReturn`
// draft and attaches it to a negative `exchange_credit` cart line, but DEFERS
// the three dangerous mutations until the replacement (exchange) sale actually
// completes:
//   1. original sale: returnedQty / fullyReturned / hasReturn
//   2. inventory restock of the returned items
//   3. persist the CustomerReturn (stamped with the exchange-sale link)
//
// This function applies those mutations PURELY (no React / no persistence side
// effects) so POSModule.handleCompleteSale can replay them deterministically
// and the logic stays unit-testable. The caller is responsible for committing
// state (setSales/setInventory/setCustomerReturns) and persistence
// (persist.sale / batchSave / persist.customerReturn) using the returned ids.
//
// Idempotency: a draft whose CustomerReturn id already exists in `returns` is
// skipped, so a retried / double-submitted checkout never double-increments
// returnedQty, double-restocks inventory, or duplicates the return record.

import type { Sale, InventoryItem, CustomerReturn, PendingExchangeReturn } from '@/store/types';

export interface ExchangeFinalizationInput {
  drafts: PendingExchangeReturn[];
  sales: Sale[];
  inventory: InventoryItem[];
  returns: CustomerReturn[];
  exchangeSaleId: string;
  exchangeInvoiceNumber: string;
}

export interface ExchangeFinalizationResult {
  sales: Sale[];
  inventory: InventoryItem[];
  returns: CustomerReturn[];
  salesChanged: boolean;
  inventoryChanged: boolean;
  returnsChanged: boolean;
  /** ids of original sales mutated — caller persists each. */
  updatedSaleIds: string[];
  /** ids of inventory items restocked — caller batch-saves each. */
  updatedInventoryIds: string[];
  /** newly-persisted CustomerReturn records — caller persists each. */
  persistedReturns: CustomerReturn[];
}

export function finalizeExchangeReturn(input: ExchangeFinalizationInput): ExchangeFinalizationResult {
  const { drafts, exchangeSaleId, exchangeInvoiceNumber } = input;

  let sales = input.sales;
  let inventory = input.inventory;
  let returns = input.returns;

  const updatedSaleIds: string[] = [];
  const updatedInventoryIds = new Set<string>();
  const persistedReturns: CustomerReturn[] = [];

  for (const draft of drafts) {
    // Idempotency guard — never double-finalize the same return.
    if (returns.some((r) => r.id === draft.draftId)) continue;

    // 1. Original sale: returnedQty / fullyReturned / hasReturn.
    const origIdx = sales.findIndex((s) => s.id === draft.originalSaleId);
    if (origIdx >= 0) {
      const orig = sales[origIdx];
      const mut = new Map(draft.itemMutations.map((m) => [m.saleItemId, m.qty]));
      const updatedItems = orig.items.map((item) => {
        const q = mut.get(item.id);
        if (!q) return item;
        const returnedQty = (item.returnedQty || 0) + q;
        return { ...item, returnedQty, fullyReturned: returnedQty >= item.qty };
      });
      const updatedOrig: Sale = {
        ...orig,
        items: updatedItems,
        hasReturn: true,
        lastReturnAt: draft.createdAt,
      };
      sales = sales.map((s, i) => (i === origIdx ? updatedOrig : s));
      if (!updatedSaleIds.includes(updatedOrig.id)) updatedSaleIds.push(updatedOrig.id);
    }

    // 2. Restock original item inventory (precomputed in the draft).
    if (draft.inventoryRestock.length > 0) {
      const restockMap = new Map<string, number>();
      for (const r of draft.inventoryRestock) {
        restockMap.set(r.inventoryId, (restockMap.get(r.inventoryId) || 0) + r.qty);
      }
      inventory = inventory.map((inv) => {
        const add = restockMap.get(inv.id);
        return add ? { ...inv, qty: inv.qty + add } : inv;
      });
      for (const invId of restockMap.keys()) {
        if (inventory.some((i) => i.id === invId)) updatedInventoryIds.add(invId);
      }
    }

    // 3. Persist CustomerReturn (stamped with the exchange-sale link).
    const rec: CustomerReturn = {
      ...draft.returnRecord,
      exchangeSaleId,
      exchangeInvoiceNumber,
    };
    returns = [rec, ...returns];
    persistedReturns.push(rec);
  }

  return {
    sales,
    inventory,
    returns,
    salesChanged: updatedSaleIds.length > 0,
    inventoryChanged: updatedInventoryIds.size > 0,
    returnsChanged: persistedReturns.length > 0,
    updatedSaleIds,
    updatedInventoryIds: Array.from(updatedInventoryIds),
    persistedReturns,
  };
}
