// ============================================================
// R-INTEL-V2-PHASE9-SALES-TREND-TIES — routing lock.
// Documented tie-loss class (Phase 7 report + shadow corpus):
// SALES_KEYWORDS' bare 'sales'/'ventas'/'revenue'/'ingresos'/'semana'
// ties 1-1 with a single anchored TREND_DIRECTION phrase, and
// sales_summary's earlier scores-array position wins the stable sort —
// stealing 'sales trend', 'revenue trend', 'tendencia de ventas',
// 'tendencia de ingresos' and 'cómo vamos esta semana' from
// trend_direction.
// Locks: (a) explicit trend/trajectory phrases always win in EN/ES (PT
// already had no SALES-token overlap and stays intact), (b) plain
// summary / today / forecast / top-seller asks are NOT pulled into
// trend_direction, (c) prior-phase corrections stay green. These
// assertions fail if the router ever falls back to raw stable-sort/
// array-position behavior for the documented phrases.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('explicit trend phrases always route to trend_direction', () => {
  it('English', () => {
    for (const q of [
      'sales trend',      // was sales_summary (documented tie loss)
      'sales trends',     // plural — carries the anchored phrase as substring
      'revenue trend',    // was sales_summary (same tie class)
      'trend report',     // no SALES token — already worked, locked
      'are we growing',   // growth variant — already worked, locked
      'are we declining', // decline variant — already worked, locked
    ]) {
      expect(id(q), q).toBe('trend_direction');
    }
  });

  it('Spanish (accented and unaccented)', () => {
    for (const q of [
      'tendencia de ventas',    // was sales_summary (documented tie loss)
      'tendencia de ingresos',  // was sales_summary (same tie class)
      'cómo vamos esta semana', // was sales_summary (bare 'semana' tie)
      'como vamos esta semana',
      'reporte de tendencia',   // no SALES token — already worked, locked
      'estamos creciendo',      // growth variant
      'estamos decayendo',      // decline variant
      'dime la tendencia de ventas',
    ]) {
      expect(id(q, 'es'), q).toBe('trend_direction');
    }
  });

  it('Portuguese (no SALES-token overlap — pre-existing behavior locked)', () => {
    for (const q of [
      'tendência de vendas',
      'tendencia de vendas',
      'estamos crescendo',   // growth variant
      'estamos declinando',  // decline variant
    ]) {
      expect(id(q, 'pt'), q).toBe('trend_direction');
    }
  });

  it('tie-break lock: the formerly stolen phrases specifically', () => {
    // Fails if routing ever returns to stable-sort position dependence.
    expect(id('sales trend')).toBe('trend_direction');            // was sales_summary
    expect(id('revenue trend')).toBe('trend_direction');          // was sales_summary
    expect(id('tendencia de ventas', 'es')).toBe('trend_direction'); // was sales_summary
    expect(id('tendencia de ingresos', 'es')).toBe('trend_direction'); // was sales_summary
  });
});

describe('collision protection — non-trend asks are NOT rerouted', () => {
  it('plain sales summary language stays put', () => {
    // No anchored trend phrase present → the override can never fire.
    expect(id('how are sales')).toBe('sales_summary');
    expect(id('resumen de ventas', 'es')).toBe('sales_summary');
    expect(id('total sales')).not.toBe('trend_direction');
    expect(id('how much did we sell')).not.toBe('trend_direction');
    expect(id('sales this week')).not.toBe('trend_direction');
    expect(id('quanto vendemos', 'pt')).not.toBe('trend_direction');
  });

  it('today asks stay on their existing intents', () => {
    expect(id('sales today')).not.toBe('trend_direction');
    expect(id("today's sales")).not.toBe('trend_direction');
    expect(id('ventas de hoy', 'es')).not.toBe('trend_direction');
    expect(id('vendas de hoje', 'pt')).not.toBe('trend_direction');
  });

  it('forecast asks stay on forecast_items (Phase 7 intact)', () => {
    expect(id('sales forecast')).toBe('forecast_items');
    expect(id('expected sales')).toBe('forecast_items');
    expect(id('pronóstico de ventas', 'es')).toBe('forecast_items');
    expect(id('previsão de vendas', 'pt')).toBe('forecast_items');
  });

  it('top-seller asks stay on top_items', () => {
    expect(id('best seller')).toBe('top_items');
    expect(id('más vendido', 'es')).toBe('top_items');
    expect(id('mais vendido', 'pt')).toBe('top_items');
  });

  it('Phase 6 PT coverage remains intact', () => {
    expect(id('reparos atrasados', 'pt')).toBe('repairs_overdue');
    expect(id('ajuda', 'pt')).toBe('help');
  });

  it('Phase 4 repairs-ready remains intact', () => {
    expect(id('repairs ready')).toBe('repairs_ready');
    expect(id('reparos prontos', 'pt')).toBe('repairs_ready');
  });
});
