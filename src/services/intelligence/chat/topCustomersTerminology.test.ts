// ============================================================
// I2B-2.1 / I3-2 — chat top-customers TRANSACTION contract.
//
// The "top/best customers" answer (canonical structured executor) must:
//   • rank by canonical Total Collected (metric explicit in the header);
//   • show the CANONICAL financial transaction count per row, worded
//     transactions / transacciones / transações — NEVER visits/interactions;
//   • use canonical Jenny values (Customer 360 parity).
// Deterministic: FIXED fixture dates + injected reference date (no Date.now,
// no timezone/midnight dependence in value assertions).
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { handleIntent } from './handlers';
import { tryHandleStructuredBusinessQuery } from '../query/tryHandleStructuredBusinessQuery';
import { clearAnalyticalContext } from '../query/analyticalContext';
import type { Customer, Sale, SaleItem } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);   // fixed reference: 2026-07-15 local
const SETTINGS = { carrierCommissions: { 'AT&T': 0.10 }, defaultCommissionRate: 0.07 };
const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;

let seq = 0;
function jennyPayment(day: string): Sale {
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, status: 'completed', paymentMethod: 'cash',
    customerId: 'cust-jenny', customerPhone: '8054523932',
    createdAt: `${day}T10:00:00`,
    subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899,
    items: [{ id: `it-${seq}`, name: 'AT&T - 8054523932', category: 'phone_payment', price: 6500, qty: 1, carrier: 'AT&T' } as unknown as SaleItem],
  } as unknown as Sale;
}

function engineWithJenny(): IntelligenceEngine {
  return new IntelligenceEngine(
    ['2026-07-03', '2026-07-06', '2026-07-09'].map(jennyPayment) as unknown as Sale[], [JENNY], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { customerReturns: [], settings: SETTINGS } as never,
  );
}

const ask = (q: string, lang: 'en' | 'es' | 'pt') =>
  tryHandleStructuredBusinessQuery(engineWithJenny(), q, lang, REF);

beforeEach(() => clearAnalyticalContext());

describe('top-customers transaction contract (canonical, deterministic dates)', () => {
  it('EN: Total Collected + canonical amount + "3 transactions", never visits', () => {
    const text = ask('top customers', 'en')!.text;
    expect(text).toContain('Total Collected');
    expect(text).toContain('JENNY MIRANDA');
    expect(text).toContain('$206.97');            // 3 × $68.99 canonical Total Collected
    expect(text).toContain('3 transactions');      // canonical financial tx count
    expect(text.toLowerCase()).not.toContain('visits');
    expect(text.toLowerCase()).not.toContain('interactions');
  });

  it('ES: "Total Cobrado" + "3 transacciones", never visitas', () => {
    // Metric-explicit required-matrix phrasing (#30); bare "mejores clientes"
    // stays on the legacy answer, whose I2B-2.1 wording carries the same terms.
    const text = ask('Mejores clientes por Total Cobrado.', 'es')!.text;
    expect(text).toContain('Total Cobrado');
    expect(text).toContain('JENNY MIRANDA');
    expect(text).toContain('$206.97');
    expect(text).toContain('3 transacciones');
    expect(text.toLowerCase()).not.toContain('visitas');
    expect(text.toLowerCase()).not.toContain('interacciones');
  });

  it('PT: "Total Recebido" + "3 transações", never visitas', () => {
    const text = ask('Melhores clientes por Total Recebido.', 'pt')!.text;
    expect(text).toContain('Total Recebido');
    expect(text).toContain('JENNY MIRANDA');
    expect(text).toContain('$206.97');
    expect(text).toContain('3 transações');
    expect(text.toLowerCase()).not.toContain('visitas');
    expect(text.toLowerCase()).not.toContain('interações');
  });

  it('live routing: handleIntent(data_query) reaches the canonical answer (all-time = clock-safe)', () => {
    const res = handleIntent({ id: 'data_query', confidence: 1, query: 'top customers all time' } as never, engineWithJenny(), 'en');
    expect(res.kind).toBe('answer');
    const text = (res as { text: string }).text;
    expect(text).toContain('Total Collected');
    expect(text).toContain('JENNY MIRANDA');
    expect(text).toContain('transactions');
    expect(text.toLowerCase()).not.toContain('visits');
  });
});
