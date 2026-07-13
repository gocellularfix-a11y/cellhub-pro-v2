// ============================================================
// R-INTEL-V2-PHASE4-REPAIRS-READY-ROUTER-CORRECTION — routing lock.
// Phase 3 shadow diagnostics found the repairs_ready intent losing its
// own exact phrases: 'repairs ready'/'reparos prontos' to data_query
// (position tie-break) and 'reparaciones listas' to repairs_overdue
// (raw-score loss to bare 'reparaciones'/'reparacion' substrings).
// Locks: (a) exact ready phrases always win in EN/ES/PT, (b) overdue
// routing is preserved, (c) representative customer / inventory / AR /
// sales routing is byte-for-byte unchanged (characterization).
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('exact ready phrases always route to repairs_ready', () => {
  it('English', () => {
    // 'completed repairs' / 'repairs completed' deliberately NOT locked here:
    // "completed" is not always pickup-ready (awaiting QC / payment / customer
    // notification) — this round locks explicit pickup-ready language only.
    for (const q of ['repairs ready', 'ready repairs', 'repairs for pickup', 'ready for pickup']) {
      expect(id(q), q).toBe('repairs_ready');
    }
  });

  it('Spanish', () => {
    for (const q of ['reparaciones listas', 'reparación lista', 'reparacion lista', 'listas para recoger']) {
      expect(id(q, 'es'), q).toBe('repairs_ready');
    }
  });

  it('Portuguese', () => {
    for (const q of ['reparos prontos', 'reparo pronto', 'pronto para retirada']) {
      expect(id(q, 'pt'), q).toBe('repairs_ready');
    }
  });

  it('the three Phase 3 theft cases specifically are corrected', () => {
    expect(id('repairs ready')).toBe('repairs_ready');            // was data_query
    expect(id('reparaciones listas', 'es')).toBe('repairs_ready'); // was repairs_overdue
    expect(id('reparos prontos', 'pt')).toBe('repairs_ready');     // was data_query
  });
});

describe('overdue routing preserved (negative cases)', () => {
  it('overdue phrases still route to repairs_overdue', () => {
    expect(id('overdue repairs')).toBe('repairs_overdue');
    expect(id('late repairs')).toBe('repairs_overdue');
    expect(id('reparaciones atrasadas', 'es')).toBe('repairs_overdue');
  });

  it('no overdue query is rerouted to repairs_ready', () => {
    for (const [q, lang] of [
      ['overdue repairs', 'en'], ['reparaciones atrasadas', 'es'], ['reparos atrasados', 'pt'],
    ] as const) {
      expect(id(q, lang), q).not.toBe('repairs_ready');
    }
  });

  it('PT "reparos atrasados" now routes to repairs_overdue (Phase 6 closed the documented PT gap)', () => {
    // Phase 4 locked the then-current fallback because closing the gap was
    // out of that round's scope. R-INTEL-V2-PHASE6-PT-COVERAGE added the
    // anchored plural phrase to REPAIRS_KEYWORDS — the shadow-documented
    // expectation (repairs_overdue) is now production behavior.
    expect(id('reparos atrasados', 'pt')).toBe('repairs_overdue');
  });
});

describe('regression locks — unrelated routing byte-for-byte unchanged', () => {
  it('customer search', () => {
    expect(id('historial de juan', 'es')).toBe('customer_history');
    expect(id('customer history')).toBe('customer_history');
  });

  it('inventory (current behavior locked, incl. the documented data_query overlap)', () => {
    expect(id('low stock')).toBe('data_query');       // Phase 3 finding: data_query wins today — unchanged
    expect(id('stock bajo', 'es')).toBe('inventory_low');
    expect(id('dead stock')).toBe('data_query');      // same documented overlap — unchanged
    expect(id('stock muerto', 'es')).toBe('inventory_dead');
  });

  it('AR unpaid balances', () => {
    expect(id('who owes me money')).toBe('unpaid_balances');
    expect(id('saldos pendientes', 'es')).toBe('unpaid_balances');
    expect(id('contas a receber', 'pt')).toBe('unpaid_balances');
    expect(id('pending payments')).toBe('unpaid_balances');
  });

  it('sales today (current behavior locked, incl. the documented today_summary precedence)', () => {
    expect(id('sales today')).toBe('today_summary');  // Phase 3 finding: today_summary wins today — unchanged
    expect(id('how much did i sell today')).toBe('today_sales');
    expect(id('ventas de hoy', 'es')).toBe('today_summary');
  });

  it('generic data_query analytics untouched by the override', () => {
    expect(id('pending layaways')).toBe('data_query');
    expect(id('phone payments')).toBe('data_query');
  });

  it('"reparaciones están listas" (repairs ARE ready) is also corrected', () => {
    // Pre-existing: routed to repairs_overdue (bare 'reparaciones'/'reparacion'
    // outscored the DATA_QUERY phrase) — the same ready→overdue theft class.
    expect(id('reparaciones están listas', 'es')).toBe('repairs_ready');
    expect(id('reparaciones estan listas', 'es')).toBe('repairs_ready');
  });
});
