// INTELLIGENCE-UNIVERSAL-ENTITY-ACCESS-V1
// Universal operational search — deterministic scoring, no AI/fuzzy/embeddings.
// Searches ALL modules and returns scored ResolvedEntity[].

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { ResolvedEntity } from './types';
import {
  resolveCustomer,
  resolveRepair,
  resolveUnlock,
  resolveSpecialOrder,
  resolveLayaway,
  resolveSale,
  resolveInventoryProduct,
  resolveEmployee,
} from './entityResolvers';

function normQ(q: string): string {
  return q.toLowerCase().trim()
    .normalize('NFD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function scoreToken(token: string, q: string, exactBonus: number, startsBonus: number): number {
  if (token === q) return exactBonus;
  if (token.startsWith(q)) return startsBonus;
  if (token.includes(q)) return startsBonus * 0.6;
  return 0;
}

function scoreEntity(entity: ResolvedEntity, q: string): number {
  if (q.length === 0) return 0;
  let best = 0;

  for (const token of entity.searchableText) {
    // Invoice / ticket number boost
    const isIdLike = entity.kind === 'sale' || entity.kind === 'invoice' || entity.kind === 'phone_payment';
    const bonus = isIdLike ? 1.2 : 1.0;

    const s = scoreToken(token, q, 1.0 * bonus, 0.75 * bonus);
    if (s > best) best = s;
  }

  // Customer name gets an extra boost for title-level match
  if (entity.kind === 'customer') {
    const normTitle = normQ(entity.title);
    if (normTitle === q) best = Math.max(best, 1.5);
    else if (normTitle.startsWith(q)) best = Math.max(best, 1.1);
  }

  // Phone number exact match boost
  const cleanQ = q.replace(/\D/g, '');
  if (cleanQ.length >= 7) {
    for (const token of entity.searchableText) {
      const cleanToken = token.replace(/\D/g, '');
      if (cleanToken === cleanQ) best = Math.max(best, 1.3);
      if (cleanToken.endsWith(cleanQ)) best = Math.max(best, 1.0);
    }
  }

  return best;
}

const MIN_SCORE = 0.4;
const MAX_RESULTS = 20;

/**
 * Search all operational modules deterministically.
 * Returns results sorted by descending score, capped at MAX_RESULTS.
 */
export function searchOperationalEntities(
  rawQuery: string,
  engine: IntelligenceEngine,
): ResolvedEntity[] {
  const q = normQ(rawQuery);
  if (q.length < 2) return [];

  const candidates: ResolvedEntity[] = [];

  for (const c of engine.getCustomers()) candidates.push(resolveCustomer(c));
  for (const r of engine.getRepairs()) candidates.push(resolveRepair(r));
  for (const u of engine.getUnlocks()) candidates.push(resolveUnlock(u));
  for (const so of engine.getSpecialOrders()) candidates.push(resolveSpecialOrder(so));
  for (const l of engine.getLayaways()) candidates.push(resolveLayaway(l));
  for (const s of engine.getSales()) candidates.push(resolveSale(s));
  for (const p of engine.getInventory()) candidates.push(resolveInventoryProduct(p));
  for (const e of engine.getEmployees()) candidates.push(resolveEmployee(e));

  const scored: Array<{ entity: ResolvedEntity; score: number }> = [];
  for (const entity of candidates) {
    const score = scoreEntity(entity, q);
    if (score >= MIN_SCORE) scored.push({ entity, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_RESULTS).map(s => s.entity);
}
