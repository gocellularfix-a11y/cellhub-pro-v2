// R-GOER-V3 — Session-only active entity memory.
// Lightweight module-level ref tracking the most recently resolved entities
// so follow-up commands ("open it", "contact him") can resolve without the
// caller re-stating the entity.
//
// Session-only continuity memory — NOT long-term AI memory, NOT persistent.
// Cleared on page reload. No localStorage, no async, no side effects outside
// this module.

import type { ResolvedEntity } from './types';

export type ActiveEntityMemory = {
  customer?: string;
  repair?: string;
  inventory?: string;
  layaway?: string;
  sale?: string;
  updatedAt: number;
};

let _memory: ActiveEntityMemory = { updatedAt: 0 };

export function getActiveEntityMemory(): ActiveEntityMemory {
  return { ..._memory };
}

export function setActiveEntityMemory(patch: Partial<ActiveEntityMemory>): void {
  _memory = { ..._memory, ...patch, updatedAt: Date.now() };
}

export function clearActiveEntityMemory(): void {
  _memory = { updatedAt: 0 };
}

/** Stamps the resolved entity into the appropriate memory slot. */
export function rememberResolvedEntity(entity: ResolvedEntity): void {
  switch (entity.type) {
    case 'customer':  setActiveEntityMemory({ customer:  entity.customerId }); break;
    case 'repair':    setActiveEntityMemory({ repair:    entity.repairId   }); break;
    case 'layaway':   setActiveEntityMemory({ layaway:   entity.layawayId  }); break;
    case 'inventory': setActiveEntityMemory({ inventory: entity.sku        }); break;
    case 'sale':      setActiveEntityMemory({ sale:      entity.saleId     }); break;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function hasWord(q: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(q);
}

/**
 * Resolves a follow-up reference against the active entity memory.
 *
 * Returns null when:
 *   - Memory is empty (no entity has been resolved this session)
 *   - Query does not contain a recognizable follow-up pattern
 *   - The implied entity type has no entry in memory
 *
 * Confidence 0.65–0.7 (lower than session context because memory spans
 * multiple intent turns and may reference a different entity than intended).
 */
export function matchActiveMemory(query: string): ResolvedEntity | null {
  if (_memory.updatedAt === 0) return null;
  const q = query.toLowerCase().trim();

  // ── Customer pronouns / references ───────────────────────────────────────
  const isCustomerRef =
    q.includes('that customer') || q.includes('the customer') || q.includes('this customer') ||
    hasWord(q, 'him') || hasWord(q, 'her');
  if (isCustomerRef && _memory.customer) {
    return { type: 'customer', customerId: _memory.customer, confidence: 0.7 };
  }

  // ── Repair / ticket references ────────────────────────────────────────────
  const isRepairRef =
    q.includes('that repair') || q.includes('the repair') || q.includes('this repair') ||
    q.includes('that ticket') || q.includes('the ticket') || q.includes('this ticket');
  if (isRepairRef && _memory.repair) {
    return { type: 'repair', repairId: _memory.repair, confidence: 0.7 };
  }

  // ── Layaway references ────────────────────────────────────────────────────
  const isLayawayRef =
    q.includes('that layaway') || q.includes('the layaway') || q.includes('this layaway');
  if (isLayawayRef && _memory.layaway) {
    return { type: 'layaway', layawayId: _memory.layaway, confidence: 0.7 };
  }

  // ── Product / inventory references ───────────────────────────────────────
  const isInventoryRef =
    q.includes('that product') || q.includes('the product') || q.includes('this product') ||
    q.includes('that phone')   || q.includes('that item');
  if (isInventoryRef && _memory.inventory) {
    return { type: 'inventory', sku: _memory.inventory, confidence: 0.7 };
  }

  // ── Generic "it / open it / show it / open this" ──────────────────────────
  // Mirrors the isItRef logic in entityMatchers.ts.
  // Resolution order: repair → customer → layaway → inventory
  // (repair has highest operational urgency in a cell shop context).
  const isItRef =
    q === 'it'        ||
    q === 'open it'   ||
    q === 'show it'   ||
    q === 'open this' ||
    q === 'show this' ||
    q === 'this one'  ||
    q === 'the one'   ||
    (hasWord(q, 'it') && q.length < 20);
  if (isItRef) {
    if (_memory.repair)    return { type: 'repair',    repairId:   _memory.repair,    confidence: 0.65 };
    if (_memory.customer)  return { type: 'customer',  customerId: _memory.customer,  confidence: 0.65 };
    if (_memory.layaway)   return { type: 'layaway',   layawayId:  _memory.layaway,   confidence: 0.65 };
    if (_memory.inventory) return { type: 'inventory', sku:        _memory.inventory, confidence: 0.65 };
  }

  return null;
}
