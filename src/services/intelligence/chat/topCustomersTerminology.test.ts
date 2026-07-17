// ============================================================
// CELLHUB-INTELLIGENCE-I2B-2.1 — chat top-customers terminology.
//
// The "top/best customers" data-query answer must:
//   • rank by canonical Total Collected (revenueCents), with the metric
//     made EXPLICIT in the header ("by Total Collected");
//   • label the per-customer count as TRANSACTIONS (financial transactions),
//     never "visits" / "visitas" / "interactions".
// ============================================================

import { describe, it, expect } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { handleIntent } from './handlers';
import type { Customer, Sale, SaleItem } from '@/store/types';

const SETTINGS = { carrierCommissions: { 'AT&T': 0.10 }, defaultCommissionRate: 0.07 };
const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;

let seq = 0;
function jennyPayment(month: number): Sale {
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, status: 'completed', paymentMethod: 'cash',
    customerId: 'cust-jenny', customerPhone: '8054523932',
    createdAt: `2026-${String(month).padStart(2, '0')}-05T10:00:00`,
    subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899,
    items: [{ id: `it-${seq}`, name: 'AT&T - 8054523932', category: 'phone_payment', price: 6500, qty: 1, carrier: 'AT&T' } as unknown as SaleItem],
  } as unknown as Sale;
}

function engineWithJenny(): IntelligenceEngine {
  return new IntelligenceEngine(
    [1, 2, 3].map(jennyPayment) as unknown as Sale[], [JENNY], [], [],
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { customerReturns: [], settings: SETTINGS } as never,
  );
}

describe('I2B-2.1 top-customers terminology', () => {
  it('21/22 (EN): header says "by Total Collected", count labeled "transactions", never "visits"', () => {
    const res = handleIntent({ id: 'data_query', confidence: 1, query: 'top customers' } as never, engineWithJenny(), 'en');
    expect(res.kind).toBe('answer');
    const text = (res as { text: string }).text;
    expect(text).toContain('by Total Collected');
    expect(text).toMatch(/\btransactions?\b/);
    expect(text.toLowerCase()).not.toContain('visits');
    expect(text.toLowerCase()).not.toContain('interactions');
    // JENNY: 3 payments → 3 transactions, $206.97 collected.
    expect(text).toContain('JENNY MIRANDA');
    expect(text).toMatch(/3 transactions/);
  });

  it('ES: "por Total Cobrado" + "transacciones", never "visitas"', () => {
    const res = handleIntent({ id: 'data_query', confidence: 1, query: 'mejores clientes' } as never, engineWithJenny(), 'es');
    const text = (res as { text: string }).text;
    expect(text).toContain('por Total Cobrado');
    expect(text).toMatch(/transacci[oó]n(es)?/);
    expect(text.toLowerCase()).not.toContain('visitas');
  });

  it('PT: "por Total Recebido" + "transações", never "visitas"', () => {
    const res = handleIntent({ id: 'data_query', confidence: 1, query: 'melhores clientes' } as never, engineWithJenny(), 'pt');
    const text = (res as { text: string }).text;
    expect(text).toContain('por Total Recebido');
    expect(text).toMatch(/transa[çc][ãõ]/); // transação / transações
    expect(text.toLowerCase()).not.toContain('visitas');
  });
});
