// R-INTELLIGENCE-PENDING-DEAL-V1: deterministic deal builder.
// Pure function — reads engine state, runs cost-floor guard, produces a
// PendingDeal record. NO mutation, NO cart write, NO inventory write,
// NO sale creation.
import type { IntelligenceEngine } from '@/services/intelligence';
import type { PendingDeal, DealGuardResult } from './dealTypes';

export interface BuildPendingDealInput {
  customerId: string;
  inventoryId: string;
  proposedPriceCents: number;
  qty?: number;       // defaults to 1
  reason?: string;    // optional owner note
}

/**
 * Build a PendingDeal from explicit ids + proposed price.
 *
 * Guard rules (V1, deterministic):
 *  - if customer or inventory item not found → guardResult = 'no_inventory_match'
 *    (groups the two missing-data cases since neither produces a usable deal)
 *  - else if proposedPriceCents < item.cost → guardResult = 'below_cost'
 *  - else → 'ok'
 *
 * The function ALWAYS returns a PendingDeal; callers must check `guardResult`
 * before queuing or executing.
 */
export function buildPendingDeal(
  input: BuildPendingDealInput,
  engine: IntelligenceEngine,
): PendingDeal {
  const customer = engine.getCustomers().find((c) => c.id === input.customerId);
  const item = engine.getInventory().find((i) => i.id === input.inventoryId);

  let guardResult: DealGuardResult = 'ok';
  if (!customer || !item) {
    guardResult = 'no_inventory_match';
  } else if (input.proposedPriceCents < (item.cost || 0)) {
    guardResult = 'below_cost';
  }

  const customerName = customer?.name || '';
  const productName = item?.name || '';
  const proposedDollars = (input.proposedPriceCents / 100).toFixed(2);
  // Offer text is plain English — owner can edit in WhatsApp before sending.
  // No localization at draft time because the recipient is the customer (Jorge's
  // shop is en-US first); message-template-language work is a future round.
  const firstName = customerName.split(' ')[0] || customerName || 'there';
  const offerText = `Hi ${firstName}, we can offer ${productName} today for $${proposedDollars}. Reply YES to lock it in.`;

  return {
    customerId: input.customerId,
    customerName,
    customerPhone: customer?.phone,

    inventoryId: input.inventoryId,
    productName,
    sku: item?.sku,

    originalPriceCents: item?.price || 0,
    proposedPriceCents: input.proposedPriceCents,
    qty: input.qty ?? 1,

    reason: input.reason ?? '',
    offerText,

    guardResult,
    costCentsAtDraft: item?.cost,

    createdAt: new Date().toISOString(),
  };
}
