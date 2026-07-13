// ============================================================
// R-INTEL-V2-PHASE11-PT-AR-ROUTING — routing lock.
// 'pagamentos pendentes' has lived in UNPAID_BALANCES_KEYWORDS since the
// AR round, but ATTENTION_FEED_KEYWORDS carries BOTH bare 'pendente' and
// 'pendentes' — the query hits both (singular is a substring of the
// plural) and attention_feed won 2-1 on raw score. Phase 11 correction:
// when attention_feed wins but the query carries an ANCHORED (multi-word)
// unpaid-balances phrase, the AR intent wins.
// Locks: (a) the stolen PT phrase + representative EN/ES/PT AR routing,
// (b) generic pending-work language stays on the attention feed, (c) bare
// 'pendentes'/'pagamentos' never become broad AR triggers, (d) prior
// router phases stay green.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'pt') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('Portuguese AR routing corrected', () => {
  it('pagamentos pendentes → unpaid_balances (was attention_feed, 2-1 score theft)', () => {
    // Fails if the bare 'pendente'+'pendentes' double-hit ever outscores
    // the anchored AR phrase again.
    expect(id('pagamentos pendentes')).toBe('unpaid_balances');
  });

  it('already working AR phrases remain correct in all three languages', () => {
    expect(id('contas a receber')).toBe('unpaid_balances');       // PT — already worked
    expect(id('quem me deve')).toBe('unpaid_balances');           // PT — already worked
    expect(id('unpaid balances', 'en')).toBe('unpaid_balances');  // EN
    expect(id('who owes me money', 'en')).toBe('unpaid_balances');
    expect(id('cuentas por cobrar', 'es')).toBe('unpaid_balances'); // ES
    expect(id('pagos pendientes', 'es')).toBe('unpaid_balances');  // ES — 1-1 tie already won on position
  });
});

describe('collision protection — generic pending work stays on the attention feed', () => {
  it('bare tokens never become AR triggers', () => {
    expect(id('pendentes')).toBe('attention_feed');       // bare pending-work token
    expect(id('pagamentos')).not.toBe('unpaid_balances'); // bare payments token
  });

  it('non-AR pending phrases keep their pre-existing routing', () => {
    // No anchored unpaid-balances phrase → the override can never fire.
    // These route to attention_feed today via the bare 'pendente(s)' tokens
    // — pre-existing behavior, locked unchanged.
    expect(id('reparos pendentes')).toBe('attention_feed');
    expect(id('pedidos pendentes')).toBe('attention_feed');
    expect(id('tarefas pendentes')).toBe('attention_feed');
  });

  it('generic attention asks remain attention_feed', () => {
    expect(id('o que precisa de atenção')).toBe('attention_feed');
    expect(id('what needs attention', 'en')).toBe('attention_feed');
  });
});

describe('prior router phases remain intact', () => {
  it('Phase 4 — repairs ready', () => {
    expect(id('repairs ready', 'en')).toBe('repairs_ready');
    expect(id('reparos prontos')).toBe('repairs_ready');
  });

  it('Phase 6 — PT coverage', () => {
    expect(id('reparos atrasados')).toBe('repairs_overdue');
    expect(id('ajuda')).toBe('help');
    expect(id('mais vendido')).toBe('top_items');
  });

  it('Phase 7 — forecast ties', () => {
    expect(id('expected sales', 'en')).toBe('forecast_items');
    expect(id('previsão de vendas')).toBe('forecast_items');
  });

  it('Phase 9 — trend ties', () => {
    expect(id('sales trend', 'en')).toBe('trend_direction');
    expect(id('tendência de vendas')).toBe('trend_direction');
  });

  it('Phase 10 — data_query thefts', () => {
    expect(id('low stock', 'en')).toBe('inventory_low');
    expect(id('estoque parado')).toBe('inventory_dead');
    expect(id('show me the data', 'en')).toBe('data_query');
  });
});
