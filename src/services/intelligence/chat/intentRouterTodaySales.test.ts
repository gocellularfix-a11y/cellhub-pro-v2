// ============================================================
// R-INTEL-V2-PHASE13-TODAY-SALES-ROUTING — routing lock.
// 'sales today' / 'ventas de hoy' / 'vendas de hoje' live in BOTH the
// today_sales and today_summary banks, but TODAY_SUMMARY_KEYWORDS also
// carries bare 'today'/'hoy'/'hoje' — so the day-state intent won 2-1 on
// raw score for every explicit sales-of-today ask (today_sales is already
// earlier in the scores array and wins plain ties). Phase 13 correction:
// when today_summary wins but the query carries an anchored (multi-word)
// TODAY_SALES phrase, the sales-of-record intent wins.
// Product distinction locked: "how much did we sell today" → today_sales;
// "how are we doing today" → today_summary; "end of day report" →
// end_of_day_brief; "how are sales" → sales_summary.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('explicit sales-of-today asks route to today_sales', () => {
  it('English', () => {
    for (const q of [
      'sales today',              // was today_summary (bare 'today' score theft)
      'today sales',              // same dual-membership class
      "today's sales",
      'revenue today',
      'how much did i sell today', // already worked (position tie) — locked
      'sales report',              // report-shaped ask stays on sales-of-record
    ]) {
      expect(id(q), q).toBe('today_sales');
    }
  });

  it('Spanish', () => {
    for (const q of ['ventas de hoy', 'ventas hoy', 'cuánto vendí hoy', 'ingresos de hoy', 'reporte de hoy']) {
      expect(id(q, 'es'), q).toBe('today_sales');
    }
  });

  it('Portuguese', () => {
    for (const q of ['vendas de hoje', 'vendas hoje', 'quanto vendi hoje', 'receita hoje']) {
      expect(id(q, 'pt'), q).toBe('today_sales');
    }
  });
});

describe('day-state, EOD, and general-sales distinctions preserved', () => {
  it('pure day-state asks stay on today_summary', () => {
    // No anchored TODAY_SALES phrase → the override can never fire.
    expect(id('how are we doing today')).toBe('today_summary');
    expect(id('how is today going')).toBe('today_summary');
    expect(id('como estamos hoy', 'es')).toBe('today_summary');
    expect(id('qué tal hoy', 'es')).toBe('today_summary');
    expect(id('como estamos hoje', 'pt')).toBe('today_summary');
    expect(id('today')).toBe('today_summary'); // bare token — unchanged
  });

  it('end-of-day asks stay on the EOD brief', () => {
    expect(id('end of day')).toBe('end_of_day_brief');
    expect(id('how did we do today')).toBe('end_of_day_brief');
    expect(id('como me fue hoy', 'es')).toBe('end_of_day_brief');
    expect(id('fim do dia', 'pt')).toBe('end_of_day_brief');
  });

  it('general sales asks stay on sales_summary', () => {
    expect(id('how are sales')).toBe('sales_summary');
    expect(id('resumen de ventas', 'es')).toBe('sales_summary');
  });

  it('daily brief composer stays put (current v3 operator brief)', () => {
    expect(id('daily brief')).toBe('daily_operator_brief_v3');
    expect(id('resumen diario', 'es')).toBe('daily_operator_brief_v3');
  });
});

describe('prior router phases remain intact', () => {
  it('forecast / trend / top items', () => {
    expect(id('expected sales')).toBe('forecast_items');       // Phase 7
    expect(id('sales forecast')).toBe('forecast_items');
    expect(id('sales trend')).toBe('trend_direction');          // Phase 9
    expect(id('tendencia de ventas', 'es')).toBe('trend_direction');
    expect(id('mais vendido', 'pt')).toBe('top_items');          // Phase 6
  });

  it('data query / inventory / repairs / AR', () => {
    expect(id('show me the data')).toBe('data_query');           // Phase 10 guard
    expect(id('low stock')).toBe('inventory_low');               // Phase 10
    expect(id('repairs ready')).toBe('repairs_ready');           // Phase 4
    expect(id('pagamentos pendentes', 'pt')).toBe('unpaid_balances'); // Phase 11
    expect(id('lost customers')).toBe('customer_churn_root_cause');   // Phase 12
  });
});
