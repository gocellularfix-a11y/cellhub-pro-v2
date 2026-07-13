// ============================================================
// R-INTEL-V2-PHASE14-NL-COVERAGE — routing lock.
// Closes the natural-language variants documented as UNSUPPORTED in the
// Phase 7/9/10 reports, each with an anchored multi-word phrase in the
// existing banks (never a bare token):
//   trend:     'trend in sales', 'are sales growing/declining',
//              'sales going up/down', 'tendencias de ventas',
//              'ventas están creciendo/bajando',
//              'vendas estão crescendo/caindo'
//   forecast:  'sales forecast' (anchored → wrapper form now caught by the
//              Phase 10 data_query override)
//   inventory: 'inventario bajo' (same bank-gap class as 'estoque baixo')
// Every phrase has a close collision case proving nothing else was stolen.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('natural trend variants route to trend_direction', () => {
  it('English', () => {
    for (const q of [
      'trend in sales', 'are sales growing', 'are sales declining',
      'sales going up or down', 'is the trend in sales positive',
    ]) {
      expect(id(q), q).toBe('trend_direction');
    }
  });

  it('Spanish', () => {
    for (const q of [
      'tendencias de ventas', 'las ventas están creciendo', 'las ventas estan creciendo',
      'las ventas están bajando',
    ]) {
      expect(id(q, 'es'), q).toBe('trend_direction');
    }
  });

  it('Portuguese', () => {
    for (const q of ['as vendas estão crescendo', 'as vendas estão caindo']) {
      expect(id(q, 'pt'), q).toBe('trend_direction');
    }
  });
});

describe('forecast wrapper variant', () => {
  it('show me the sales forecast → forecast_items (anchored phrase + Phase 10 override)', () => {
    expect(id('show me the sales forecast')).toBe('forecast_items'); // was data_query
    expect(id('sales forecast')).toBe('forecast_items');
  });
});

describe('Spanish low-inventory variants route to inventory_low', () => {
  it('plain and wrapper forms', () => {
    expect(id('inventario bajo', 'es')).toBe('inventory_low');           // was data_query (bank gap)
    expect(id('muéstrame inventario bajo', 'es')).toBe('inventory_low'); // wrapper form
  });
});

describe('collision protection — close phrases keep their intents', () => {
  it('summary/today/top/forecast neighbors unchanged', () => {
    expect(id('how are sales')).toBe('sales_summary');            // no trend phrase
    expect(id('sales this week')).not.toBe('trend_direction');
    expect(id('sales today')).toBe('today_sales');                // Phase 13
    expect(id('ventas de hoy', 'es')).toBe('today_sales');
    expect(id('best seller')).toBe('top_items');
    expect(id('expected sales')).toBe('forecast_items');          // Phase 7
    expect(id('tendencia de ventas', 'es')).toBe('trend_direction'); // Phase 9 (singular)
  });

  it('generic data/wrapper asks stay on data_query', () => {
    expect(id('show me the data')).toBe('data_query');
    expect(id('pending layaways')).toBe('data_query');
    expect(id('bajo inventario', 'es')).toBe('data_query'); // pre-existing dq phrase — deliberately untouched
  });

  it('growth wording about the BUSINESS keeps the existing trend routing', () => {
    expect(id('are we growing')).toBe('trend_direction');
    expect(id('estamos creciendo', 'es')).toBe('trend_direction');
    expect(id('estamos crescendo', 'pt')).toBe('trend_direction');
  });

  it('prior phases intact', () => {
    expect(id('repairs ready')).toBe('repairs_ready');                 // Phase 4
    expect(id('mais vendido', 'pt')).toBe('top_items');                // Phase 6
    expect(id('low stock')).toBe('inventory_low');                     // Phase 10
    expect(id('pagamentos pendentes', 'pt')).toBe('unpaid_balances');  // Phase 11
    expect(id('lost customers')).toBe('customer_churn_root_cause');    // Phase 12
    expect(id('vendas de hoje', 'pt')).toBe('today_sales');            // Phase 13
  });
});
