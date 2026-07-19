// ============================================================
// Business Manager — smart follow-ups (I4 Part 9).
//
// Deterministic RULE ENGINE (no LLM): exact manager questions →
//   focus      → the full business brief
//   problem    → the highest-priority issue (+ its action)
//   opportunity→ the top opportunity (+ its action)
// Unmatched text returns null so ALL existing chat behavior continues.
// ============================================================

import type { BusinessLanguage } from '../language/types';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import { formatFinding } from '../insights/formatFindings';
import { buildBusinessBrief } from './businessBriefBuilder';
import { formatBusinessBrief, formatAction } from './formatManager';

type L3 = BusinessLanguage;

const FOCUS_RE = /^[¿¡]?\s*(what should i focus on( today)?|what should i do today|en (que|qué) me enfoco( hoy)?|(que|qué) debo hacer hoy|em que devo focar( hoje)?|o que devo fazer hoje)\s*\??$/i;
const PROBLEM_RE = /^[¿¡]?\s*(what('| i)?s my biggest problem|what is my biggest problem|cu(a|á)l es mi mayor problema|qual (e|é) (o )?meu maior problema)\s*\??$/i;
const OPPORTUNITY_RE = /^[¿¡]?\s*(what opportunity am i missing|(que|qué) oportunidad (me )?estoy perdiendo|(que|qual) oportunidade estou perdendo)\s*\??$/i;

export interface ManagerChatResponse { kind: 'answer'; text: string }

export function tryHandleManagerQuestion(
  engine: IntelligenceEngine,
  rawQuery: string,
  lang: L3,
  referenceDate?: Date,
): ManagerChatResponse | null {
  try {
    const q = (rawQuery || '').trim();
    if (!q) return null;
    const wantsFocus = FOCUS_RE.test(q);
    const wantsProblem = PROBLEM_RE.test(q);
    const wantsOpportunity = OPPORTUNITY_RE.test(q);
    if (!wantsFocus && !wantsProblem && !wantsOpportunity) return null;

    const insights = engine.getBusinessInsights(referenceDate, 'last_30_days');
    const brief = buildBusinessBrief(insights);
    const byId = new Map(insights.findings.map((f) => [f.id, f] as const));

    if (wantsFocus) {
      return { kind: 'answer', text: formatBusinessBrief(brief, lang, byId) };
    }

    if (wantsProblem) {
      const issue = [...brief.criticalAlerts, ...brief.warnings][0];
      if (!issue) {
        return {
          kind: 'answer',
          text: lang === 'es' ? 'No hay problemas críticos detectados ahora mismo.'
            : lang === 'pt' ? 'Nenhum problema crítico detectado no momento.'
            : 'No critical problems detected right now.',
        };
      }
      const action = brief.recommendedActions.find((a) => a.relatedFindingId === issue.id);
      const lines = [formatFinding(issue, lang)];
      if (action) lines.push(`→ ${formatAction(action, lang)}`);
      return { kind: 'answer', text: lines.join('\n') };
    }

    // wantsOpportunity
    const opportunity = brief.opportunities[0];
    if (!opportunity) {
      return {
        kind: 'answer',
        text: lang === 'es' ? 'No hay oportunidades destacadas en este período.'
          : lang === 'pt' ? 'Nenhuma oportunidade destacada neste período.'
          : 'No standout opportunities in this period.',
      };
    }
    const action = brief.recommendedActions.find((a) => a.relatedFindingId === opportunity.id);
    const lines = [formatFinding(opportunity, lang)];
    if (action) lines.push(`→ ${formatAction(action, lang)}`);
    return { kind: 'answer', text: lines.join('\n') };
  } catch (err) {
    // Never crash chat — fall back to existing behavior.
    // eslint-disable-next-line no-console
    console.warn('[intelligence] manager question failed, falling back:', err);
    return null;
  }
}
