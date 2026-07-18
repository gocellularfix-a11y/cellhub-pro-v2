// ============================================================
// I3-2 PRODUCTION TRUTH — the EXACT 58-query matrix, literally.
//
// Every required string is executed VERBATIM through the live gate
// (tryHandleStructuredBusinessQuery — the same entry handlers.ts calls) with
// a fixed reference date and asserted into its category:
//   structured  — canonical answer text (no dev terminology)
//   terminal    — localized exactness/safety explanation (never legacy)
//   fallback    — null (legacy/operational routing keeps ownership)
//   not_found   — localized not-found answer
//   ambiguous   — candidate list
// Rows 53-58 are descriptions in the spec; the literal queries embodying them
// are noted inline. Financial correctness is covered by structuredQuery.test
// (canonical parity); this suite locks ROUTE + LANGUAGE + SAFETY per string.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligenceEngine } from '../IntelligenceEngine';
import { tryHandleStructuredBusinessQuery } from './tryHandleStructuredBusinessQuery';
import { clearAnalyticalContext } from './analyticalContext';
import type { Customer, Sale, SaleItem, Repair, Unlock } from '@/store/types';

const REF = new Date(2026, 6, 15, 12, 0, 0);
const portal = (id: string, name: string) => ({ id, name, label: name, emoji: '', color: '', matchCarriers: [], matchUrlSnippets: [] });
const SETTINGS = {
  carrierCommissions: { 'AT&T': 0.10, 'Verizon': 0.07 },
  defaultCommissionRate: 0.07,
  paymentPortals: [portal('ePay', 'ePay'), portal('VidaPay', 'VidaPay')],
};
const JENNY: Customer = { id: 'cust-jenny', name: 'JENNY MIRANDA', phone: '8054523932' } as unknown as Customer;
const CARLOS: Customer = { id: 'cust-carlos', name: 'CARLOS PEREZ', phone: '8051112222' } as unknown as Customer;

let seq = 0;
function item(over: Partial<SaleItem> & { portal?: string }): SaleItem {
  return { id: `it-${++seq}`, name: 'Item', category: 'accessory' as SaleItem['category'], price: 0, qty: 1, cbeEligible: false, taxable: true, ...over } as SaleItem;
}
function sale(over: Partial<Sale>): Sale {
  const total = over.total ?? 0;
  return {
    id: `s-${++seq}`, invoiceNumber: `INV-${seq}`, items: [], subtotal: over.subtotal ?? total,
    taxAmount: 0, cbeTotal: 0, total, paymentMethod: 'cash' as Sale['paymentMethod'],
    status: 'completed' as Sale['status'], createdAt: '2026-07-05T10:00:00', employeeName: 'Ana', ...over,
  } as Sale;
}

// POS-only world (no unattributed standalones → employee queries are exact).
function buildWorld() {
  const sales: Sale[] = [
    sale({ createdAt: '2026-07-03T10:00:00', customerId: 'cust-jenny', customerPhone: '8054523932', employeeName: 'Ana', items: [item({ name: 'AT&T - 8054523932', category: 'phone_payment' as SaleItem['category'], price: 6500, qty: 1, carrier: 'AT&T', portal: 'ePay' })], subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899 }),
    sale({ createdAt: '2026-07-06T10:00:00', customerId: 'cust-jenny', customerPhone: '8054523932', employeeName: 'Ana', items: [item({ name: 'AT&T - 8054523932', category: 'phone_payment' as SaleItem['category'], price: 6500, qty: 1, carrier: 'AT&T', portal: 'ePay' })], subtotal: 6500, utilityTax: 358, mobileSurcharge: 41, total: 6899 }),
    sale({ createdAt: '2026-07-04T11:00:00', customerId: 'cust-carlos', customerPhone: '8051112222', employeeName: 'Luis', items: [item({ name: 'Verizon - 8051112222', category: 'phone_payment' as SaleItem['category'], price: 6000, qty: 1, carrier: 'Verizon', portal: 'VidaPay' })], subtotal: 6000, total: 6000 }),
    sale({ createdAt: '2026-07-15T09:00:00', employeeName: 'Ana', items: [item({ name: 'Case', price: 2500, qty: 1, cost: 1000 })], subtotal: 2500, total: 2500 }),
    sale({ createdAt: '2026-07-14T09:00:00', paymentMethod: 'card' as Sale['paymentMethod'], employeeName: 'Luis', items: [item({ name: 'Charger', price: 8000, qty: 1, cost: 3000 })], subtotal: 8000, total: 8000 }),
    sale({ createdAt: '2026-06-10T09:00:00', employeeName: 'Ana', items: [item({ name: 'JuneCase', price: 4000, qty: 1, cost: 1500 })], subtotal: 4000, total: 4000 }),
    sale({ createdAt: '2025-07-05T09:00:00', items: [item({ name: 'OldSale', price: 3000, qty: 1, cost: 1200 })], subtotal: 3000, total: 3000 }),
  ];
  return { sales, repairs: [] as Repair[], unlocks: [] as Unlock[] };
}

function buildEngine(extraCustomers: Customer[] = []): IntelligenceEngine {
  const world = buildWorld();
  return new IntelligenceEngine(
    world.sales as unknown as Sale[], [JENNY, CARLOS, ...extraCustomers], [], world.repairs as never,
    { lang: 'en', enableAlerts: false, enableScoring: false, cacheTimeoutMinutes: 15 },
    { unlocks: world.unlocks, customerReturns: [], vendorReturns: [], settings: SETTINGS, employees: [{ id: 'emp-ana', name: 'Ana' }, { id: 'emp-luis', name: 'Luis' }] } as never,
  );
}

type Category = 'structured' | 'terminal' | 'fallback' | 'not_found' | 'ambiguous';
interface Row { n: number; q: string; lang: 'en' | 'es' | 'pt'; cat: Category; expect?: RegExp }

const ROWS: Row[] = [
  // ── English (1-20) ──
  { n: 1, q: 'What were gross sales today?', lang: 'en', cat: 'structured', expect: /Gross sales.*today/ },
  { n: 2, q: 'What were net sales yesterday?', lang: 'en', cat: 'structured', expect: /Net sales.*yesterday/ },
  { n: 3, q: 'What was our profit this month?', lang: 'en', cat: 'structured', expect: /Profit.*this month/ },
  { n: 4, q: 'What was our margin this month?', lang: 'en', cat: 'structured', expect: /Margin.*this month/ },
  { n: 5, q: 'How much did we collect in cash today?', lang: 'en', cat: 'structured', expect: /Cash.*today/ },
  { n: 6, q: 'How much was paid by card today?', lang: 'en', cat: 'structured', expect: /Card.*today/ },
  { n: 7, q: 'What was the average ticket this week?', lang: 'en', cat: 'structured', expect: /Average ticket.*this week/ },
  { n: 8, q: 'How many transactions today?', lang: 'en', cat: 'structured', expect: /Transactions.*today/ },
  { n: 9, q: 'Show cash versus card this month.', lang: 'en', cat: 'structured', expect: /Cash.*Card|cash.*card/ },
  { n: 10, q: 'Compare gross sales versus net sales this month.', lang: 'en', cat: 'structured', expect: /Gross sales.*Net sales/ },
  { n: 11, q: 'Compare AT&T profit versus Verizon profit this month.', lang: 'en', cat: 'structured', expect: /AT&T.*Verizon/ },
  { n: 12, q: 'Compare ePay versus VidaPay this month.', lang: 'en', cat: 'structured', expect: /ePay.*VidaPay/ },
  { n: 13, q: 'Compare this month versus last month net sales.', lang: 'en', cat: 'structured', expect: /this month.*last month/ },
  { n: 14, q: 'Did profit increase this month?', lang: 'en', cat: 'structured', expect: /increased|decreased|No change/ },
  { n: 15, q: 'Which carrier sold the most this month?', lang: 'en', cat: 'structured', expect: /AT&T/ },
  { n: 16, q: 'Which employee generated the highest profit?', lang: 'en', cat: 'structured', expect: /Ana|Luis/ },
  { n: 17, q: 'Sales by category this month.', lang: 'en', cat: 'structured', expect: /1\. / },
  { n: 18, q: 'Top customers by Total Collected.', lang: 'en', cat: 'structured', expect: /Total Collected[\s\S]*JENNY MIRANDA[\s\S]*transactions/ },
  { n: 19, q: 'Find customer Jenny Miranda.', lang: 'en', cat: 'structured', expect: /JENNY MIRANDA[\s\S]*Total Collected/ },
  { n: 20, q: 'Profit July 1, 2025 to July 15, 2025.', lang: 'en', cat: 'structured', expect: /Profit.*2025-07-01.*2025-07-15/ },
  // ── Spanish (21-32) ──
  { n: 21, q: '¿Cuáles fueron las ventas brutas hoy?', lang: 'es', cat: 'structured', expect: /Ventas brutas.*hoy/ },
  { n: 22, q: '¿Cuál fue la ganancia este mes?', lang: 'es', cat: 'structured', expect: /Ganancia.*este mes/ },
  { n: 23, q: '¿Cuánto cobramos en efectivo ayer?', lang: 'es', cat: 'structured', expect: /Efectivo.*ayer/ },
  { n: 24, q: 'Compara efectivo contra tarjeta este mes.', lang: 'es', cat: 'structured', expect: /Efectivo.*Tarjeta/ },
  { n: 25, q: 'Compara la ganancia de AT&T contra Verizon este mes.', lang: 'es', cat: 'structured', expect: /AT&T.*Verizon/ },
  { n: 26, q: 'Compara este mes con el mes pasado las ventas netas.', lang: 'es', cat: 'structured', expect: /este mes.*mes pasado/ },
  { n: 27, q: '¿Qué compañía vendió más este mes?', lang: 'es', cat: 'structured', expect: /AT&T/ },
  { n: 28, q: '¿Qué empleado generó más ganancia?', lang: 'es', cat: 'structured', expect: /Ana|Luis/ },
  { n: 29, q: 'Ventas por proveedor de pagos este mes.', lang: 'es', cat: 'structured', expect: /ePay|VidaPay/ },
  { n: 30, q: 'Mejores clientes por Total Cobrado.', lang: 'es', cat: 'structured', expect: /Total Cobrado[\s\S]*transacciones/ },
  { n: 31, q: 'Busca al cliente Jenny Miranda.', lang: 'es', cat: 'structured', expect: /JENNY MIRANDA/ },
  { n: 32, q: 'Ganancia del 1 al 15 de julio de 2025.', lang: 'es', cat: 'structured', expect: /Ganancia.*2025-07-01/ },
  // ── Portuguese (33-44) ──
  { n: 33, q: 'Quais foram as vendas brutas hoje?', lang: 'pt', cat: 'structured', expect: /Vendas brutas.*hoje/ },
  { n: 34, q: 'Qual foi o lucro deste mês?', lang: 'pt', cat: 'structured', expect: /Lucro.*neste mês/ },
  { n: 35, q: 'Quanto recebemos em dinheiro ontem?', lang: 'pt', cat: 'structured', expect: /Dinheiro.*ontem/ },
  { n: 36, q: 'Compare dinheiro versus cartão neste mês.', lang: 'pt', cat: 'structured', expect: /Dinheiro.*Cartão/ },
  { n: 37, q: 'Compare o lucro da AT&T versus Verizon neste mês.', lang: 'pt', cat: 'structured', expect: /AT&T.*Verizon/ },
  { n: 38, q: 'Compare este mês com o mês passado.', lang: 'pt', cat: 'structured', expect: /neste mês.*no mês passado/ },
  { n: 39, q: 'Qual operadora vendeu mais neste mês?', lang: 'pt', cat: 'structured', expect: /AT&T/ },
  { n: 40, q: 'Qual funcionário gerou mais lucro?', lang: 'pt', cat: 'structured', expect: /Ana|Luis/ },
  { n: 41, q: 'Vendas por provedor de pagamento neste mês.', lang: 'pt', cat: 'structured', expect: /ePay|VidaPay/ },
  { n: 42, q: 'Melhores clientes por Total Recebido.', lang: 'pt', cat: 'structured', expect: /Total Recebido[\s\S]*transações/ },
  { n: 43, q: 'Encontre a cliente Jenny Miranda.', lang: 'pt', cat: 'structured', expect: /JENNY MIRANDA/ },
  { n: 44, q: 'Lucro de 1 a 15 de julho de 2025.', lang: 'pt', cat: 'structured', expect: /Lucro.*2025-07-01/ },
  // ── Safety / fallback (45-58) ──
  { n: 45, q: 'Paint the store.', lang: 'en', cat: 'fallback' },
  { n: 46, q: 'Tell me a joke.', lang: 'en', cat: 'fallback' },
  { n: 47, q: '¿Cómo está el clima?', lang: 'es', cat: 'fallback' },
  { n: 48, q: 'Play some music.', lang: 'en', cat: 'fallback' },
  { n: 49, q: 'Open Repairs.', lang: 'en', cat: 'fallback' },        // operational routing owns it
  { n: 50, q: 'Create a new repair.', lang: 'en', cat: 'fallback' },
  { n: 51, q: 'Add an appointment.', lang: 'en', cat: 'fallback' },
  { n: 52, q: 'Delete inventory.', lang: 'en', cat: 'fallback' },
  // 53: "Provider sales, with both a carrier name and ambiguous provider" →
  { n: 53, q: 'which provider sold the most AT&T', lang: 'en', cat: 'terminal', expect: /aren't directly comparable|didn't run/ },
  // 54: "A vs B vs C" over a recognized metric →
  { n: 54, q: 'sales A versus B versus C', lang: 'en', cat: 'terminal', expect: /both sides of that comparison/ },
  // 55: invalid custom date →
  { n: 55, q: 'sales february 1 to february 30, 2025', lang: 'en', cat: 'terminal', expect: /isn't valid/ },
  // 56: unknown customer →
  { n: 56, q: 'Find customer Zzyzx Nobody.', lang: 'en', cat: 'not_found', expect: /not found/i },
  // 57: duplicate customer-name match → (needs a twin — separate engine below)
  // 58: unsupported financial grouping with no exact canonical source →
  { n: 58, q: 'Compare repairs with unlocks this month.', lang: 'en', cat: 'terminal', expect: /can't calculate that breakdown/ },
];

beforeEach(() => clearAnalyticalContext());

describe('I3-2 — exact 58-query matrix (literal strings)', () => {
  const engine = buildEngine();
  ROWS.forEach((row) => {
    it(`#${row.n} [${row.cat}] ${row.q}`, () => {
      const r = tryHandleStructuredBusinessQuery(engine, row.q, row.lang, REF);
      if (row.cat === 'fallback') {
        expect(r).toBeNull();
        return;
      }
      expect(r, `expected an answer for: ${row.q}`).not.toBeNull();
      const text = r!.text;
      if (row.expect) expect(text).toMatch(row.expect);
      // No developer terminology ever reaches the user.
      expect(text).not.toMatch(/unsupported_|_attribution|canonical_|undefined|NaN/);
    });
  });

  it('#57 duplicate customer-name match → ambiguity with candidates', () => {
    const twin: Customer = { id: 'cust-jenny2', name: 'JENNY MIRANDA LOPEZ', phone: '8059998888' } as unknown as Customer;
    const engine2 = buildEngine([twin]);
    const r = tryHandleStructuredBusinessQuery(engine2, 'Find customer Jenny Miranda.', 'en', REF);
    expect(r?.text).toMatch(/which one do you mean/i);
    expect(r?.text).toContain('JENNY MIRANDA');
    expect(r?.text).toContain('JENNY MIRANDA LOPEZ');
  });

  it('all 58 numbered rows are represented literally', () => {
    const present = new Set(ROWS.map((r) => r.n));
    present.add(57);   // covered by the dedicated duplicate-match test above
    for (let n = 1; n <= 58; n++) expect(present.has(n), `row #${n} missing`).toBe(true);
  });
});
