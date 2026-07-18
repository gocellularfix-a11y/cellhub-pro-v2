// ============================================================
// CELLHUB-INTELLIGENCE-I2B-2.1 / I3-2 — chat top-customers terminology.
//
// Since I3-2 the "top/best customers" data-query routes through the canonical
// structured executor (intentional supersession — customer ranking by Total
// Collected). The contract this suite protects is unchanged:
//   • the ranking metric is EXPLICIT (Total Collected / Total Cobrado /
//     Total Recebido);
//   • canonical values (Jenny = Customer 360 numbers);
//   • the answer never labels anything "visits"/"visitas"/"interactions".
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { handleIntent } from './handlers';
import { clearAnalyticalContext } from '../query/analyticalContext';
import type { Customer, Sale, SaleItem } from '@/store/types';

const SETTINGS = { carrierCommissions: { 'AT&T': 0.10 }, defaultCommissionRate: 0.07 };
const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;

let seq = 0;
function jennyPayment(daysAgo: number): Sale {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  d.setHours(10, 0, 0, 0);
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, status: 'completed', paymentMethod: 'cash',
    customerId: 'cust-jenny', customerPhone: '8054523932',
    createdAt: d.toISOString(),
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

beforeEach(() => clearAnalyticalContext());

describe('top-customers terminology (canonical structured answer)', () => {
  it('EN: metric explicit ("Total Collected"), canonical value, never "visits"', () => {
    const res = handleIntent({ id: 'data_query', confidence: 1, query: 'top customers' } as never, engineWithJenny(), 'en');
    expect(res.kind).toBe('answer');
    const text = (res as { text: string }).text;
    expect(text).toContain('Total Collected');
    expect(text).toContain('JENNY MIRANDA');
    expect(text).toContain('$206.97');            // 3 × $68.99 canonical Total Collected
    expect(text.toLowerCase()).not.toContain('visits');
    expect(text.toLowerCase()).not.toContain('interactions');
  });

  it('ES: "Total Cobrado", never "visitas"', () => {
    const res = handleIntent({ id: 'data_query', confidence: 1, query: 'mejores clientes' } as never, engineWithJenny(), 'es');
    const text = (res as { text: string }).text;
    expect(text).toContain('Total Cobrado');
    expect(text).toContain('JENNY MIRANDA');
    expect(text.toLowerCase()).not.toContain('visitas');
  });

  it('PT: "Total Recebido", never "visitas"', () => {
    const res = handleIntent({ id: 'data_query', confidence: 1, query: 'melhores clientes' } as never, engineWithJenny(), 'pt');
    const text = (res as { text: string }).text;
    expect(text).toContain('Total Recebido');
    expect(text).toContain('JENNY MIRANDA');
    expect(text.toLowerCase()).not.toContain('visitas');
  });
});
