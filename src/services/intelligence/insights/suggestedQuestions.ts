// ============================================================
// Business Analyst — suggested follow-up questions (I3-3 Part 11).
//
// A deterministic RULE ENGINE: finding kind + data → ready-to-send localized
// question strings the structured executor can already answer. No language
// model — fixed templates, capped and deduped deterministically.
// ============================================================

import type { BusinessLanguage } from '../language/types';
import type { InsightFinding, SuggestedQuestion } from './types';

export const MAX_SUGGESTIONS = 3;

type L3 = BusinessLanguage;

function questionsFor(f: InsightFinding, lang: L3): string[] {
  const d = f.data;
  switch (f.kind) {
    case 'metric_trend': {
      if (d.metric === 'profit' || d.metric === 'gross_sales') {
        return lang === 'es' ? ['Compara este mes con el mes pasado.', 'Ventas por categoría este mes.']
          : lang === 'pt' ? ['Compare este mês com o mês passado.', 'Vendas por categoria neste mês.']
          : ['Compare this month versus last month.', 'Sales by category this month.'];
      }
      return [];
    }
    case 'carrier_fastest_growing':
    case 'carrier_highest_profit':
    case 'carrier_highest_revenue': {
      const carrier = String(d.carrier || '');
      if (!carrier) return [];
      return lang === 'es' ? [`¿Cuánto vendió ${carrier} este mes?`]
        : lang === 'pt' ? [`Quanto vendeu ${carrier} neste mês?`]
        : [`How much did ${carrier} sell this month?`];
    }
    case 'carrier_declining':
    case 'carrier_disappeared': {
      const carrier = String(d.carrier || '');
      if (!carrier) return [];
      return lang === 'es' ? [`¿Qué cambió en ${carrier}?`]
        : lang === 'pt' ? [`O que mudou em ${carrier}?`]
        : [`What changed in ${carrier}?`];
    }
    case 'employee_best_profit':
    case 'employee_best_revenue': {
      return lang === 'es' ? ['¿Qué empleado generó más ganancia?']
        : lang === 'pt' ? ['Qual funcionário gerou mais lucro?']
        : ['Which employee generated the highest profit?'];
    }
    case 'customer_high_value':
    case 'customer_lost':
    case 'customer_declining': {
      const name = String(d.name || '');
      if (!name) return [];
      return lang === 'es' ? [`Busca al cliente ${name}.`]
        : lang === 'pt' ? [`Encontre o cliente ${name}.`]
        : [`Find customer ${name}.`];
    }
    case 'service_decline':
    case 'service_growth': {
      return lang === 'es' ? ['Ventas por categoría este mes.']
        : lang === 'pt' ? ['Vendas por categoria neste mês.']
        : ['Sales by category this month.'];
    }
    case 'large_refund_period': {
      return lang === 'es' ? ['¿Cuánto se devolvió este mes?']
        : lang === 'pt' ? ['Quanto foi devolvido neste mês?']
        : ['How much was refunded this month?'];
    }
    default:
      return [];
  }
}

/** First-match-wins over the (already priority-sorted) findings; dedup by
 *  text; capped at MAX_SUGGESTIONS. Fully deterministic. */
export function suggestQuestions(findings: InsightFinding[], lang: L3): SuggestedQuestion[] {
  const out: SuggestedQuestion[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    for (const text of questionsFor(f, lang)) {
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ text, sourceFindingId: f.id });
      if (out.length >= MAX_SUGGESTIONS) return out;
    }
  }
  return out;
}
