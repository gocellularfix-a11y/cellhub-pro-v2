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

// R-INTELLIGENCE-AMBIENT-AWARENESS-V1: clear entity IDs (modal close / tab
// switch) while preserving activeModule + bumping updatedAt so the TTL
// resets. Prevents stale entity context bleeding into unrelated queries.
export function clearEntityContext(): void {
  _ctx = {
    activeModule: _ctx.activeModule,
    updatedAt: Date.now(),
  };
}

// One-shot signal: Inventory Promote button sets a pending product so that
// IntelligenceModule can auto-select it in the Promote panel on mount.
// Consumed once — reset to null after read to prevent stale re-trigger.
let _pendingPromoteProduct: { id: string; name: string } | null = null;

export function setPendingPromoteProduct(id: string, name: string): void {
  _pendingPromoteProduct = { id, name };
}

export function consumePendingPromoteProduct(): { id: string; name: string } | null {
  const p = _pendingPromoteProduct;
  _pendingPromoteProduct = null;
  return p;
}

// General-purpose one-shot Intelligence action signal. Any module can set a
// prefilled chat query; IntelligenceModule fires it on mount and clears it.
let _pendingIntelligenceAction: { query: string } | null = null;

export function setPendingIntelligenceAction(query: string): void {
  _pendingIntelligenceAction = { query };
}

export function consumePendingIntelligenceAction(): { query: string } | null {
  const p = _pendingIntelligenceAction;
  _pendingIntelligenceAction = null;
  return p;
}
