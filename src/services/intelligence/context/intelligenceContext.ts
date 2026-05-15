// R-INTELLIGENCE-CONTEXT-AWARE-V1
// Lightweight singleton context bus. Modules call setIntelligenceContext() when
// they open/select an entity; Intelligence handlers call getIntelligenceContext()
// to inject contextual recommendations before global operator opportunities.
// No React, no store — pure in-memory, TTL-gated.

export interface IntelligenceContext {
  activeModule?: string;
  activeRepairId?: string;
  activeCustomerId?: string;
  activeLayawayId?: string;
  activeInventoryItemId?: string;
  updatedAt: number;
}

// Context expires after 30s of inactivity — prevents stale entity context
// from bleeding into unrelated Intelligence queries.
const CTX_TTL_MS = 30_000;

let _ctx: IntelligenceContext = { updatedAt: 0 };

export function setIntelligenceContext(
  patch: Partial<Omit<IntelligenceContext, 'updatedAt'>>,
): void {
  _ctx = { ..._ctx, ...patch, updatedAt: Date.now() };
}

export function getIntelligenceContext(): IntelligenceContext | null {
  if (!_ctx.updatedAt || Date.now() - _ctx.updatedAt > CTX_TTL_MS) return null;
  return { ..._ctx };
}

export function clearIntelligenceContext(): void {
  _ctx = { updatedAt: 0 };
}
