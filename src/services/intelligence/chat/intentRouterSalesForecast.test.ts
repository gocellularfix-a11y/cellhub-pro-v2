// ============================================================
// R-INTEL-V2-PHASE7-SALES-FORECAST-TIES — routing lock.
// Documented tie-loss class (Phase 6 report + shadow corpus):
// SALES_KEYWORDS' bare 'sales'/'ventas' ties 1-1 with a single forecast
// token, and sales_summary's earlier scores-array position wins the
// stable sort — stealing 'expected sales', 'sales forecast',
// 'pronostico/pronóstico de ventas', 'proyeccion/proyección de ventas',
// and 'ventas futuras' from forecast_items.
// Locks: (a) explicit forecast phrases always win in EN/ES (and PT stays
// intact), (b) plain summary / today / trend / top-seller asks are NOT
// pulled into forecast, (c) prior-phase corrections stay green.
// These assertions fail if the router ever falls back to raw
// stable-sort/array-position behavior for the documented phrases.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('explicit forecast phrases always route to forecast_items', () => {
  it('English', () => {
    for (const q of [
      'expected sales',          // was sales_summary (documented tie loss)
      'sales forecast',          // was sales_summary
      'forecast sales',          // was sales_summary
      'projected sales',         // was sales_summary
      'sales projection',        // was sales_summary
      'what is the sales forecast',
      'forecast',                // bare token — already worked, locked
    ]) {
      expect(id(q), q).toBe('forecast_items');
    }
    // NOT locked: 'show me expected sales' → data_query ('show me' lives in
    // the DATA_QUERY grab-bag, which outscores rather than ties). data_query
    // theft is a separate documented class, explicitly out of this round's
    // scope — existing behavior preserved.
  });

  it('Spanish (accented and unaccented)', () => {
    for (const q of [
      'pronostico de ventas',    // was sales_summary (documented tie loss)
      'pronóstico de ventas',    // was sales_summary
      'proyeccion de ventas',    // was sales_summary
      'proyección de ventas',    // was sales_summary
      'ventas futuras',          // was sales_summary (same 1-1 tie class)
      'ventas proyectadas',      // already worked (2 bank hits), locked
      'dame el pronóstico de ventas',
      'muéstrame la proyección de ventas',
      'proyeccion',              // bare token — already worked, locked
      'pronostico',
    ]) {
      expect(id(q, 'es'), q).toBe('forecast_items');
    }
  });

  it('Portuguese (Phase 6 coverage intact)', () => {
    for (const q of ['previsão de vendas', 'previsao de vendas', 'previsão']) {
      expect(id(q, 'pt'), q).toBe('forecast_items');
    }
  });
});

describe('collision protection — non-forecast sales asks are NOT rerouted', () => {
  it('plain sales summary language stays put', () => {
    // No forecast token present → the override can never fire.
    expect(id('how are sales')).toBe('sales_summary');
    expect(id('resumen de ventas', 'es')).toBe('sales_summary');
    expect(id('total sales')).not.toBe('forecast_items');
    expect(id('how much did we sell')).not.toBe('forecast_items');
    expect(id('cuánto vendimos', 'es')).not.toBe('forecast_items');
    expect(id('ventas de esta semana', 'es')).not.toBe('forecast_items');
  });

  it('today asks stay on their existing intents', () => {
    expect(id('sales today')).not.toBe('forecast_items');
    expect(id("today's sales")).not.toBe('forecast_items');
    expect(id('ventas de hoy', 'es')).not.toBe('forecast_items');
    expect(id('vendas de hoje', 'pt')).not.toBe('forecast_items');
    expect(id('how much did i sell today')).toBe('today_sales'); // unchanged
  });

  it('trend asks stay on their existing intents', () => {
    expect(id('sales trend')).not.toBe('forecast_items');
    expect(id('tendencia de ventas', 'es')).not.toBe('forecast_items');
    expect(id('tendência de vendas', 'pt')).not.toBe('forecast_items');
  });

  it('top-seller asks stay on top_items', () => {
    expect(id('best seller')).toBe('top_items');
    expect(id('más vendido', 'es')).toBe('top_items');
    expect(id('mais vendido', 'pt')).toBe('top_items');
  });

  it('generic future language without a forecast bank token stays out of forecast', () => {
    // 'next week' / 'mañana' carry no FORECAST_KEYWORDS token — the override
    // requires an explicit forecast word, not generic future wording.
    expect(id('what should i do next week')).not.toBe('forecast_items');
    expect(id('que hago mañana', 'es')).not.toBe('forecast_items');
  });
});

describe('prior-phase corrections remain intact alongside the new override', () => {
  it('Phase 4 — repairs ready', () => {
    expect(id('repairs ready')).toBe('repairs_ready');
    expect(id('reparaciones listas', 'es')).toBe('repairs_ready');
    expect(id('reparos prontos', 'pt')).toBe('repairs_ready');
  });

  it('Phase 6 — PT coverage', () => {
    expect(id('reparos atrasados', 'pt')).toBe('repairs_overdue');
    expect(id('ajuda', 'pt')).toBe('help');
    expect(id('me ajuda a ver os reparos atrasados', 'pt')).toBe('repairs_overdue');
  });

  it('Phase 5 — AR routing', () => {
    expect(id('who owes me money')).toBe('unpaid_balances');
    expect(id('saldos pendientes', 'es')).toBe('unpaid_balances');
    expect(id('contas a receber', 'pt')).toBe('unpaid_balances');
  });
});
