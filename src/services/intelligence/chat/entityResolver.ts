// R-ENTITY-FIRST-INTELLIGENCE-ROUTING-V1
// Deterministic operational-entity resolver. No LLM, no fuzzy embeddings —
// pure string matching. Called by handleIntent before falling through to the
// analytics fallback so that typing a customer name / ticket ID resolves to
// an actionable entity summary instead of a generic analytics answer.
import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Customer, Repair, Unlock, SpecialOrder, Layaway, InventoryItem } from '@/store/types';

export type OperationalEntityMatch =
  | { kind: 'customer';           customer: Customer;   confidence: number }
  | { kind: 'repair';             repair: Repair;       customer: Customer | null; confidence: number }
  | { kind: 'unlock';             unlock: Unlock;       confidence: number }
  | { kind: 'special_order';      order: SpecialOrder;  confidence: number }
  | { kind: 'layaway';            layaway: Layaway;     confidence: number }
  | { kind: 'product';            product: InventoryItem; confidence: number }
  | { kind: 'ambiguous_customer'; matches: Customer[];  query: string; confidence: number };

function normStr(s: string): string {
  return (s || '').toLowerCase().trim()
    // eslint-disable-next-line no-misleading-character-class
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function scoreCustomerName(normName: string, normQuery: string): number {
  if (!normName || !normQuery) return 0;
  if (normName === normQuery) return 1.0;
  if (normName.includes(normQuery) && normQuery.length >= 4) return 0.9;
  if (normQuery.includes(normName) && normName.length >= 4) return 0.85;
  return 0;
}

const MIN_CONFIDENCE = 0.8;

// Repair ticket IDs are 6-12 uppercase alphanumeric characters.
function looksLikeTicketId(raw: string): boolean {
  return /^[A-Z0-9]{6,12}$/i.test(raw.trim());
}

export function resolveOperationalEntity(
  rawQuery: string,
  engine: IntelligenceEngine,
): OperationalEntityMatch | null {
  // Direct ID lookup: "cust:<id>" bypasses all fuzzy matching.
  // Used by disambiguation action buttons to resolve unambiguously.
  if (rawQuery.startsWith('cust:')) {
    const id = rawQuery.slice(5);
    const customer = engine.getCustomers().find(c => c.id === id);
    if (customer) return { kind: 'customer', customer, confidence: 1.0 };
  }

  const q = normStr(rawQuery);
  if (q.length < 4) return null;

  const customers  = engine.getCustomers();
  const repairs    = engine.getRepairs();

  // ── 1. Ticket ID exact match ─────────────────────────────────────────────
  if (looksLikeTicketId(rawQuery.trim())) {
    const qUpper = rawQuery.trim().toUpperCase();
    const byTicket = repairs.find(r => {
      const tn      = String((r as any).ticketNumber || '').toUpperCase();
      const idSuffix = r.id.slice(-8).toUpperCase();
      return tn === qUpper || idSuffix === qUpper;
    });
    if (byTicket) {
      const customer = customers.find(c => c.id === byTicket.customerId) ?? null;
      return { kind: 'repair', repair: byTicket, customer, confidence: 1.0 };
    }
  }

  // ── 2. Customer name match ───────────────────────────────────────────────
  const scored: Array<{ customer: Customer; score: number }> = [];
  for (const c of customers) {
    const displayName = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim();
    const score = scoreCustomerName(normStr(displayName), q);
    if (score >= MIN_CONFIDENCE) scored.push({ customer: c, score });
  }

  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score);
    // Single best match or perfect exact score → return directly.
    if (scored.length === 1 || scored[0].score === 1.0) {
      return { kind: 'customer', customer: scored[0].customer, confidence: scored[0].score };
    }
    return {
      kind: 'ambiguous_customer',
      matches: scored.slice(0, 5).map(s => s.customer),
      query: rawQuery,
      confidence: scored[0].score,
    };
  }

  // ── 3. Product SKU / barcode exact, then name contains ──────────────────
  const inventory = engine.getInventory();
  const bySku = inventory.find(p => normStr(p.sku) === q);
  if (bySku) return { kind: 'product', product: bySku, confidence: 1.0 };

  const byBarcode = inventory.find(p => !!p.barcode && normStr(p.barcode) === q);
  if (byBarcode) return { kind: 'product', product: byBarcode, confidence: 1.0 };

  const byName = inventory.filter(p => normStr(p.name).includes(q));
  if (byName.length === 1) return { kind: 'product', product: byName[0], confidence: 0.85 };
  if (byName.length > 1) {
    byName.sort((a, b) => a.name.length - b.name.length);
    return { kind: 'product', product: byName[0], confidence: 0.82 };
  }

  return null;
}
