// ============================================================
// R-INTEL-V2-PHASE12-CUSTOMER-RECOVERY-ROUTING — routing lock.
// The churn/outreach cluster had two documented thieves (shadow corpus):
//   - recover_customer stole 'lost customers' (its singular 'lost customer'
//     is a substring of the plural; earlier array position wins the tie);
//   - customer_history stole 'why customers stopped coming' and
//     'contatar cliente' (bare 'customer'/'cliente' 1-1 ties; earlier
//     position wins).
// Phase 12 corrections: (A) anchored churn phrases win over both thieves
// UNLESS an explicit recovery-action verb is present (mirrors the
// vocabulary registry's exclusions); (B) explicit contact COMMANDS (the
// who_to_contact rows of OPERATIONAL_ALIASES) win over the name-lookup.
// The four product meanings stay distinct: history / churn diagnosis /
// recovery workflow / contact command.
// ============================================================

import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter';
import type { Customer } from '@/store/types';

const NO_CUSTOMERS: Customer[] = [];
const id = (q: string, lang: 'en' | 'es' | 'pt' = 'en') => classifyIntent(q, NO_CUSTOMERS, lang).id;

describe('churn diagnosis routing corrected', () => {
  it('English', () => {
    expect(id('lost customers')).toBe('customer_churn_root_cause');            // was recover_customer
    expect(id('why customers stopped coming')).toBe('customer_churn_root_cause'); // was customer_history
    expect(id('customers not returning')).toBe('customer_churn_root_cause');
  });

  it('Spanish', () => {
    expect(id('clientes perdidos', 'es')).toBe('customer_churn_root_cause');  // was customer_history (bare 'cliente' tie)
    expect(id('dejaron de venir', 'es')).toBe('customer_churn_root_cause');
  });

  it('Portuguese', () => {
    expect(id('pararam de vir', 'pt')).toBe('customer_churn_root_cause');
    expect(id('por que clientes não voltam', 'pt')).toBe('customer_churn_root_cause');
  });
});

describe('recovery ACTION language keeps the recovery workflow (vocabulary exclusions)', () => {
  it('explicit action verbs are never rerouted to the diagnosis', () => {
    expect(id('recover customer')).toBe('recover_customer');
    expect(id('recuperar cliente', 'es')).toBe('recover_customer');
    expect(id('recuperar clientes perdidos', 'es')).toBe('recover_customer'); // churn phrase + action verb → action wins
    expect(id('win back lost customers')).toBe('recover_customer');          // same rule in EN
    expect(id('trazer de volta', 'pt')).toBe('recover_customer');
  });
});

describe('explicit contact commands route to who_to_contact', () => {
  it('the stolen PT command and its EN/ES siblings', () => {
    expect(id('contatar cliente', 'pt')).toBe('who_to_contact'); // was customer_history
    expect(id('contact customer')).toBe('who_to_contact');
    expect(id('who to contact')).toBe('who_to_contact');
    expect(id('clientes para llamar', 'es')).toBe('who_to_contact');
    expect(id('clientes para chamar', 'pt')).toBe('who_to_contact');
  });
});

describe('collision protection — neighboring intents unchanged', () => {
  it('customer history (name lookup) stays put', () => {
    expect(id('customer history')).toBe('customer_history');
    expect(id('historial de juan', 'es')).toBe('customer_history');
  });

  it('best customer report stays put', () => {
    expect(id('best customer')).toBe('best_customer');
    expect(id('mejor cliente', 'es')).toBe('best_customer');
  });

  it('AR reminders and unpaid balances stay put (Phases 5/11)', () => {
    expect(id('who owes me money')).toBe('unpaid_balances');
    expect(id('pagamentos pendentes', 'pt')).toBe('unpaid_balances');
  });

  it('repair follow-up command stays on its operator intent', () => {
    expect(id('follow up repair')).toBe('repair_follow_up');
    expect(id('acompanhar reparo', 'pt')).toBe('repair_follow_up');
  });

  it('marketing outreach stays put', () => {
    expect(id('marketing campaign')).toBe('marketing_campaign');
    expect(id('criar campanha', 'pt')).toBe('marketing_campaign');
  });

  it('prior router phases intact', () => {
    expect(id('repairs ready')).toBe('repairs_ready');               // Phase 4
    expect(id('reparos atrasados', 'pt')).toBe('repairs_overdue');   // Phase 6
    expect(id('expected sales')).toBe('forecast_items');             // Phase 7
    expect(id('sales trend')).toBe('trend_direction');               // Phase 9
    expect(id('low stock')).toBe('inventory_low');                   // Phase 10
  });
});
