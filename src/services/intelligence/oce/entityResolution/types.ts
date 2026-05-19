// R-GOER-V1 — Global Operational Entity Resolution
// Lightweight discriminated union for resolved entity references.
// Intentionally decoupled from entityAccess/types.ts ResolvedEntity
// (which is display-oriented). This is resolution-oriented: what entity
// does a query or context point to, and how confident are we?

export type ResolvedEntity =
  | { type: 'customer';  customerId: string; confidence: number }
  | { type: 'repair';    repairId: string;   confidence: number }
  | { type: 'sale';      saleId: string;     confidence: number }
  | { type: 'layaway';   layawayId: string;  confidence: number }
  | { type: 'inventory'; sku: string;        confidence: number };

export type ResolveEntityInput = {
  /** Raw query string (any casing — resolver lowercases internally). */
  query: string;
  /**
   * Operational context blob — may be either:
   *   - OperationalContext (intentRouter session entity: {type, value, timestamp})
   *   - OperationalContextSnapshot (OCE signals snapshot: {signals[], generatedAt})
   * Typed as unknown because callers come from multiple modules with different
   * context shapes. Type guards narrow internally.
   */
  operationalContext?: unknown;
};
