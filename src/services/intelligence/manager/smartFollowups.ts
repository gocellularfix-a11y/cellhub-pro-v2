// ============================================================
// Business Manager — smart follow-ups (I4 Part 9, I4.1 terminality).
//
// Deterministic RULE ENGINE (no LLM): exact manager questions →
//   focus / brief → the full business brief
//   problem      → the highest-priority BUSINESS issue (+ its action)
//   opportunity  → the top opportunity (+ its action)
//   health       → the health sections summary
// I4.1 TERMINALITY: once an intent is RECOGNIZED it OWNS the request —
// no-data returns an honest localized terminal answer, and an internal
// manager-engine failure returns a localized terminal unavailable response.
// A recognized intent NEVER returns null and never reaches legacy routing.
// Unrecognized text returns null so all existing chat behavior continues.
// ============================================================

import type { BusinessLanguage } from '../language/types';
import type { IntelligenceEngine } from '../IntelligenceEngine';
import { formatFinding } from '../insights/formatFindings';
import { buildBusinessBrief } from './businessBriefBuilder';
import { formatBusinessBrief, formatAction, formatHealthSection } from './formatManager';
import { HEALTH_REFUSAL_KINDS } from './healthEngine';

type L3 = BusinessLanguage;

const FOCUS_RE = /^[¿¡]?\s*(what should i focus on( today)?|what should i do today|en (que|qué) me enfoco( hoy)?|(que|qué) debo hacer hoy|em que devo focar( hoje)?|o que devo fazer hoje)\s*\??$/i;
const PROBLEM_RE = /^[¿¡]?\s*(what('| i)?s my biggest problem|what is my biggest problem|cu(a|á)l es mi mayor problema|qual (e|é) (o )?meu maior problema)\s*\??$/i;
const OPPORTUNITY_RE = /^[¿¡]?\s*(what opportunity am i missing|(que|qué) oportunidad (me )?estoy perdiendo|(que|qual) oportunidade estou perdendo)\s*\??$/i;
const BRIEF_RE = /^[¿¡]?\s*((show( me)? the )?business brief|daily brief|resumen del negocio|resumo do neg(o|ó)cio)\s*\??$/i;
const HEALTH_RE = /^[¿¡]?\s*(business health|how (is|'s) my business( doing)?|salud del negocio|c(o|ó)mo va (el|mi) negocio|sa(u|ú)de do neg(o|ó)cio|como vai (o|meu) neg(o|ó)cio)\s*\??$/i;

export type ManagerIntent = 'focus' | 'problem' | 'opportunity' | 'brief' | 'health';

/** Pure recognition — exact patterns only (anti-hijack by design). */
export function recognizeManagerIntent(rawQuery: string): ManagerIntent | null {
  const q = (rawQuery || '').trim();
  if (!q) return null;
  if (FOCUS_RE.test(q)) return 'focus';
  if (PROBLEM_RE.test(q)) return 'problem';
  if (OPPORTUNITY_RE.test(q)) return 'opportunity';
  if (BRIEF_RE.test(q)) return 'brief';
  if (HEALTH_RE.test(q)) return 'health';
  return null;
}

export interface ManagerChatResponse { kind: 'answer'; text: string }

function terminalUnavailable(lang: L3): ManagerChatResponse {
  return {
    kind: 'answer',
    text: lang === 'es' ? 'El asistente de negocio no está disponible en este momento. Inténtalo de nuevo.'
      : lang === 'pt' ? 'O assistente de negócios não está disponível no momento. Tente novamente.'
      : "The business manager isn't available right now. Please try again.",
  };
}

/** I4.1.1: honest terminal answer when there is NO business data to analyze —
 *  a recognized intent never shows a normal-looking brief/score over nothing. */
function terminalNoData(lang: L3): ManagerChatResponse {
  return {
    kind: 'answer',
    text: lang === 'es' ? 'Todavía no hay suficiente información del negocio para responder eso.'
      : lang === 'pt' ? 'Ainda não há informações suficientes do negócio para responder isso.'
      : 'There is not enough business information to answer that yet.',
  };
}

export function tryHandleManagerQuestion(
  engine: IntelligenceEngine,
  rawQuery: string,
  lang: L3,
  referenceDate?: Date,
): ManagerChatResponse | null {
  // Recognition happens OUTSIDE the error boundary: a recognized intent owns
  // the request and can never fall through to legacy routing.
  const intent = recognizeManagerIntent(rawQuery);
  if (!intent) return null;

  try {
    const insights = engine.getBusinessInsights(referenceDate, 'last_30_days');
    const brief = buildBusinessBrief(insights);
    const byId = new Map(insights.findings.map((f) => [f.id, f] as const));
    const isRefusal = (id: string) => {
      const f = byId.get(id);
      return !!f && (HEALTH_REFUSAL_KINDS as readonly string[]).includes(f.kind);
    };

    // I4.1.1: with ZERO findings there is nothing to manage — recognized
    // intents answer an honest terminal no-data response (never a
    // normal-looking brief/score, never null, never legacy routing).
    const noData = insights.findings.length === 0;

    if (intent === 'focus' || intent === 'brief') {
      if (noData) return terminalNoData(lang);
      return { kind: 'answer', text: formatBusinessBrief(brief, lang, byId) };
    }

    if (intent === 'health') {
      // All-unavailable output stays useful, but it must clearly state the
      // information is insufficient — never imply a completed evaluation.
      const lines = [
        lang === 'es' ? '🩺 Salud del negocio' : lang === 'pt' ? '🩺 Saúde do negócio' : '🩺 Business health',
        ...(noData ? [terminalNoData(lang).text] : []),
        ...brief.health.map((h) => `• ${formatHealthSection(h, lang)}`),
      ];
      return { kind: 'answer', text: lines.join('\n') };
    }

    if (intent === 'problem') {
      if (noData) return terminalNoData(lang);
      // BUSINESS issues only — refusal findings are data-quality limits.
      const issue = [...brief.criticalAlerts, ...brief.warnings].find((f) => !isRefusal(f.id));
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

    // intent === 'opportunity'
    if (noData) return terminalNoData(lang);
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
    // I4.1 TERMINALITY: recognized intent + internal failure → localized
    // terminal response. NEVER null, NEVER legacy routing.
    // eslint-disable-next-line no-console
    console.warn('[intelligence] manager engine failed for recognized intent:', err);
    return terminalUnavailable(lang);
  }
}
