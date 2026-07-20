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
import { HEALTH_REFUSAL_KINDS, classifyHealthEvidence } from './healthEngine';
import type { InsightFinding } from '../insights/types';

/** I4.1.2 — general applicability classifier (kept for consumers/tests).
 *  A finding is applicable managerial evidence only when it is EVALUATIVE:
 *  a supported (non-refusal) risk, an actual opportunity, or explicit
 *  section-level positive/negative evidence. */
export function isApplicableManagerEvidence(f: InsightFinding): boolean {
  const cls = classifyHealthEvidence(f);
  if (cls === 'refusal') return false;
  if (cls === 'negative' || cls === 'supportive') return true;
  // Neutral class: only an explicit OPPORTUNITY is still actionable evidence.
  return f.severity === 'opportunity';
}

export function hasApplicableManagerEvidence(findings: InsightFinding[]): boolean {
  return findings.some(isApplicableManagerEvidence);
}

// ── I4.1.3 — INTENT-SPECIFIC evidence contracts (pure) ──────
// Applicability differs per intent: one opportunity is actionable for a
// focus/opportunity answer but is NOT sufficient performance evidence for a
// complete Business Brief with a score.

/** True when a finding is explicit business-PERFORMANCE evidence: a
 *  supported non-refusal risk (negative class) or section-level positive
 *  evidence (supportive class). Opportunities/rankings/patterns/shares/
 *  neutrals/refusals never qualify. */
export function isPerformanceEvidence(f: InsightFinding): boolean {
  const cls = classifyHealthEvidence(f);
  return cls === 'negative' || cls === 'supportive';
}

/** Brief/score: requires supported performance evidence. */
export function hasBriefPerformanceEvidence(findings: InsightFinding[]): boolean {
  return findings.some(isPerformanceEvidence);
}

/** True for an actual supported opportunity FINDING (severity opportunity,
 *  never a refusal). */
export function isSupportedOpportunity(f: InsightFinding): boolean {
  return f.severity === 'opportunity' && classifyHealthEvidence(f) !== 'refusal';
}

export function hasOpportunityEvidence(findings: InsightFinding[]): boolean {
  return findings.some(isSupportedOpportunity);
}

/** Problem: an actual supported non-refusal business risk. */
export function hasProblemEvidence(findings: InsightFinding[]): boolean {
  return findings.some((f) =>
    (f.severity === 'critical' || f.severity === 'warning') && classifyHealthEvidence(f) !== 'refusal');
}

/** Focus: a risk, an opportunity, or performance evidence — any real
 *  non-refusal priority item. */
export function hasFocusEvidence(findings: InsightFinding[]): boolean {
  return hasProblemEvidence(findings) || hasOpportunityEvidence(findings) || hasBriefPerformanceEvidence(findings);
}

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

    // I4.1.3: evidence applicability is INTENT-SPECIFIC — no single global
    // boolean. One opportunity can power a focus answer without ever
    // rendering a Business Brief or a performance score.
    const briefEvidence = hasBriefPerformanceEvidence(insights.findings);
    const opportunityEvidence = hasOpportunityEvidence(insights.findings);
    const problemEvidence = hasProblemEvidence(insights.findings);

    if (intent === 'brief') {
      // A normal brief (with /100 score) requires PERFORMANCE evidence —
      // opportunity-only/neutral/refusal input gets the terminal no-data.
      if (!briefEvidence) return terminalNoData(lang);
      return { kind: 'answer', text: formatBusinessBrief(brief, lang, byId) };
    }

    if (intent === 'focus') {
      if (briefEvidence) {
        return { kind: 'answer', text: formatBusinessBrief(brief, lang, byId) };
      }
      if (opportunityEvidence) {
        // Opportunity-only: a focused answer — never a full brief/score.
        const opportunity = brief.opportunities.find((f) => !isRefusal(f.id))!;
        const action = brief.recommendedActions.find((a) => a.relatedFindingId === opportunity.id);
        const lines = [
          lang === 'es' ? 'El mejor enfoque para hoy es esta oportunidad:'
            : lang === 'pt' ? 'O melhor foco para hoje é esta oportunidade:'
            : "Today's best focus is this opportunity:",
          formatFinding(opportunity, lang),
        ];
        if (action) lines.push(`→ ${formatAction(action, lang)}`);
        return { kind: 'answer', text: lines.join('\n') };
      }
      return terminalNoData(lang);
    }

    if (intent === 'health') {
      // All-unavailable output stays honest: when NO section is evaluable,
      // clearly state the information is insufficient — never imply a
      // completed health evaluation.
      const anyEvaluable = brief.health.some((h) => h.evaluable);
      const lines = [
        lang === 'es' ? '🩺 Salud del negocio' : lang === 'pt' ? '🩺 Saúde do negócio' : '🩺 Business health',
        ...(anyEvaluable ? [] : [terminalNoData(lang).text]),
        ...brief.health.map((h) => `• ${formatHealthSection(h, lang)}`),
      ];
      return { kind: 'answer', text: lines.join('\n') };
    }

    if (intent === 'problem') {
      // I4.1.3: gated on ACTUAL supported risk — never on broad
      // performance/opportunity evidence.
      if (!problemEvidence) {
        if (opportunityEvidence || briefEvidence) {
          // Evidence exists but does not establish a problem — never claim
          // "no problems" beyond what the evidence supports.
          return {
            kind: 'answer',
            text: lang === 'es' ? 'No tengo suficiente evidencia confiable para identificar un problema del negocio.'
              : lang === 'pt' ? 'Não tenho evidência confiável suficiente para identificar um problema do negócio.'
              : 'I do not have enough supported evidence to identify a business problem.',
          };
        }
        return terminalNoData(lang);   // only neutral/refusal evidence
      }
      // BUSINESS issues only — refusal findings are data-quality limits.
      const issue = [...brief.criticalAlerts, ...brief.warnings].find((f) => !isRefusal(f.id));
      if (!issue) {
        return {
          kind: 'answer',
          text: lang === 'es' ? 'No tengo suficiente evidencia confiable para identificar un problema del negocio.'
            : lang === 'pt' ? 'Não tenho evidência confiável suficiente para identificar um problema do negócio.'
            : 'I do not have enough supported evidence to identify a business problem.',
        };
      }
      const action = brief.recommendedActions.find((a) => a.relatedFindingId === issue.id);
      const lines = [formatFinding(issue, lang)];
      if (action) lines.push(`→ ${formatAction(action, lang)}`);
      return { kind: 'answer', text: lines.join('\n') };
    }

    // intent === 'opportunity' — requires an ACTUAL supported opportunity
    // finding (risks/up-trends/rankings/neutrals never satisfy it).
    if (!opportunityEvidence) {
      if (briefEvidence || problemEvidence) {
        // I4.1.4: evidence exists elsewhere, but the ABSENCE of a supported
        // opportunity finding is never proof that no opportunity exists —
        // state insufficient supported evidence, not confirmed absence.
        return {
          kind: 'answer',
          text: lang === 'es' ? 'No tengo suficiente evidencia confiable para identificar una oportunidad destacada en este período.'
            : lang === 'pt' ? 'Não tenho evidência confiável suficiente para identificar uma oportunidade de destaque neste período.'
            : 'I do not have enough supported evidence to identify a standout opportunity in this period.',
        };
      }
      return terminalNoData(lang);   // nothing applicable at all
    }
    const opportunity = brief.opportunities.find((f) => !isRefusal(f.id))!;
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
