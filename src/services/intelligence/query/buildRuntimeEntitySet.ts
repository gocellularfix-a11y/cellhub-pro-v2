// ============================================================
// Structured Query Executor — runtime entity set (I3-2).
//
// Builds the parser's RuntimeEntitySet from REAL current application data
// (the engine's store-scoped context) — nothing hardcoded: no store names,
// no employees, no providers, no customers. Configured runtime entities take
// precedence over the parser's static carrier aliases by design (the parser
// checks runtime sets first). Canonical IDs and display names are preserved.
// ============================================================

import type { RuntimeEntitySet, RuntimeEntity } from '../language/types';
import type { StructuredQueryContext } from './types';

/** Configured payment portals (settings.paymentPortals) — provider names. */
function providerEntities(ctx: StructuredQueryContext): RuntimeEntity[] {
  const portals = (ctx.snapshot.settings as { paymentPortals?: Array<{ id?: string; name?: string } | string> }).paymentPortals;
  if (!Array.isArray(portals)) return [];
  const out: RuntimeEntity[] = [];
  for (const p of portals) {
    if (typeof p === 'string') { if (p.trim()) out.push({ name: p.trim() }); continue; }
    if (p && typeof p.name === 'string' && p.name.trim()) out.push({ id: p.id, name: p.name.trim() });
  }
  return out;
}

/** Configured carriers (carrierCommissions keys) — canonical display names. */
function carrierEntities(ctx: StructuredQueryContext): RuntimeEntity[] {
  const cc = (ctx.snapshot.settings as { carrierCommissions?: Record<string, number> }).carrierCommissions;
  if (!cc) return [];
  return Object.keys(cc).filter((k) => k.trim()).map((name) => ({ name }));
}

export function buildRuntimeEntitySet(ctx: StructuredQueryContext): RuntimeEntitySet {
  return {
    carriers: carrierEntities(ctx),
    paymentProviders: providerEntities(ctx),
    employees: ctx.employees.filter((e) => e.name && e.name.trim()).map((e) => ({ id: e.id, name: e.name })),
    // Customers are matched by full-name phrase presence; the set can be large
    // but matching is a linear phrase scan (deterministic, no fuzzy).
    customers: ctx.customers.filter((c) => c.name && c.name.trim()).map((c) => ({ id: c.id, name: c.name })),
    stores: [],   // cross-store queries are out of scope (snapshot is current-store)
  };
}
