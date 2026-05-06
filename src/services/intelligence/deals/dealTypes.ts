// R-INTELLIGENCE-PENDING-DEAL-V1: owner-mediated deal type. Held inside the
// existing AutomationQueueItem.payload slot — no new persistence path, no
// new collection. Pure data shape, no methods.

export type DealGuardResult = 'ok' | 'below_cost' | 'no_inventory_match';

export interface PendingDeal {
  customerId: string;
  customerName: string;
  customerPhone?: string;

  inventoryId: string;
  productName: string;
  sku?: string;

  originalPriceCents: number;
  proposedPriceCents: number;
  qty: number;

  reason: string;
  offerText: string;

  guardResult: DealGuardResult;
  costCentsAtDraft?: number;

  createdAt: string;
}
