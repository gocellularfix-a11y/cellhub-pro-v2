// ============================================================
// R-INTEL-V2-PHASE10-DATA-QUERY-THEFT — routing lock.
// DATA_QUERY_KEYWORDS carries wrapper tokens ('show me', 'cuánto',
// 'quanto') AND copies of domain phrases ('low stock', 'dead stock',
// 'estoque baixo', 'estoque parado'), stealing explicit domain asks two
// ways: 1-1 ties won on its earlier scores-array position, or outright
// wins where a domain bank lacked the phrase (PT inventory).
// Phase 10 correction: when data_query wins BUT the query contains an
// ANCHORED (multi-word) phrase from an established domain bank, the
// domain intent wins. Single-word bank tokens are never triggers.
// Locks: (a) shadow-proven thefts are corrected, (b) generic data asks
// stay data_query, (c) every neighboring domain distinction survives,
// (d) prior-phase corrections stay green.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('inventory thefts corrected', () => {
  it('plain domain phrases route to their inventory intents', () => {
    expect(id('low stock')).toBe('inventory_low');            // was data_query (tie)
    expect(id('dead stock')).toBe('inventory_dead');          // was data_query (tie)
    expect(id('estoque baixo', 'pt')).toBe('inventory_low');  // was data_query (outright — bank gap closed)
    expect(id('estoque parado', 'pt')).toBe('inventory_dead');// was data_query (outright — bank gap closed)
  });

  it('wrapper variants with an anchored inventory phrase', () => {
    expect(id('show me low stock')).toBe('inventory_low');
    expect(id('show me dead stock')).toBe('inventory_dead');
    expect(id('mostre estoque baixo', 'pt')).toBe('inventory_low');
  });

  it('inventory distinctions preserved (low vs dead vs restock)', () => {
    expect(id('stock bajo', 'es')).toBe('inventory_low');
    expect(id('stock muerto', 'es')).toBe('inventory_dead');
    expect(id('what should i restock')).toBe('restock_opportunity');
    expect(id('que debo reponer', 'es')).toBe('restock_opportunity');
  });
});

describe('forecast / trend / top-items wrapper thefts corrected', () => {
  it('show me expected sales → forecast_items (the documented Phase 7 leftover)', () => {
    expect(id('show me expected sales')).toBe('forecast_items'); // was data_query
  });

  it('wrapper + trend phrase → trend_direction', () => {
    expect(id('show me the sales trend')).toBe('trend_direction'); // was data_query
  });

  it('wrapper + top-seller phrase → top_items', () => {
    expect(id('show me best sellers')).toBe('top_items'); // was data_query
  });

  it('ES/PT wrapper forecast variants (no data_query wrapper token → already worked, locked)', () => {
    expect(id('muéstrame el pronóstico de ventas', 'es')).toBe('forecast_items');
    expect(id('mostre a previsão de vendas', 'pt')).toBe('forecast_items');
  });

  it('plain forecast phrases remain forecast_items (Phase 7 intact)', () => {
    expect(id('expected sales')).toBe('forecast_items');
    expect(id('sales forecast')).toBe('forecast_items');
    expect(id('pronóstico de ventas', 'es')).toBe('forecast_items');
    expect(id('previsão de vendas', 'pt')).toBe('forecast_items');
  });
});

describe('generic data queries are NOT rerouted', () => {
  it('wrapper-only and data-flavored asks stay data_query', () => {
    // No anchored domain phrase → the override never fires. These are
    // real phrases from DATA_QUERY_KEYWORDS' own banks.
    expect(id('show me the data')).toBe('data_query');
    expect(id('pending layaways')).toBe('data_query');
    expect(id('phone payments')).toBe('data_query');
    expect(id('how much did i spend')).toBe('data_query');
    expect(id('cuánto gasté', 'es')).toBe('data_query');
  });

  it('single-word domain tokens never trigger the override', () => {
    // 'falta' is a bare INVENTORY_LOW token — a time/data question that
    // happens to contain it must stay a data question, not become an
    // inventory report.
    expect(id('cuánto falta para cerrar', 'es')).toBe('data_query');
  });
});

describe('cross-intent regression — neighbors unchanged', () => {
  it('sales summary / today', () => {
    expect(id('how are sales')).toBe('sales_summary');
    expect(id('resumen de ventas', 'es')).toBe('sales_summary');
    expect(id('sales today')).toBe('today_summary');       // data_query family unchanged
    expect(id('show me sales today')).not.toBe('forecast_items');
    expect(id('ventas de hoy', 'es')).toBe('today_summary');
  });

  it('trend / forecast / top items (plain forms)', () => {
    expect(id('sales trend')).toBe('trend_direction');      // Phase 9 intact
    expect(id('tendencia de ventas', 'es')).toBe('trend_direction');
    expect(id('best seller')).toBe('top_items');
    expect(id('mais vendido', 'pt')).toBe('top_items');     // Phase 6 intact
  });

  it('prior-phase locks', () => {
    expect(id('repairs ready')).toBe('repairs_ready');       // Phase 4 (data_query ready-theft)
    expect(id('reparos prontos', 'pt')).toBe('repairs_ready');
    expect(id('reparos atrasados', 'pt')).toBe('repairs_overdue'); // Phase 6
    expect(id('ajuda', 'pt')).toBe('help');                  // Phase 6
    expect(id('who owes me money')).toBe('unpaid_balances'); // Phase 5 routing
  });
});
