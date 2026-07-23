// ============================================================
// Business Manager surface (I5) — localized UI strings.
//
// EN/ES/PT typed records, same Record<L3, string> convention the approved
// manager presenter (formatManager.ts) uses. UI chrome labels ONLY — every
// finding/action/health/brief sentence comes from the approved I4 presenters.
// No internal terminology (refusal / attribution / canonical / cents / enum
// keys) may appear in any value here.
// ============================================================

import type { BusinessLanguage } from '@/services/intelligence/language/types';

export type ManagerLang = BusinessLanguage;

type S = Record<ManagerLang, string>;

export const MANAGER_STRINGS = {
  title: { en: 'Business Manager', es: 'Gerente del Negocio', pt: 'Gerente do Negócio' },
  // R-ORBITAL-CORE-IDENTITY-V1: brand eyebrow for the Intelligence lockup.
  brand: { en: 'CellHub Intelligence', es: 'Inteligencia de CellHub', pt: 'Inteligência CellHub' },
  readOnly: { en: 'Read-only', es: 'Solo lectura', pt: 'Somente leitura' },
  analyzedPeriod: { en: 'Analyzed period', es: 'Período analizado', pt: 'Período analisado' },
  generatedAt: { en: 'Generated', es: 'Generado', pt: 'Gerado' },
  refresh: { en: 'Refresh', es: 'Actualizar', pt: 'Atualizar' },

  performanceScore: { en: 'Performance score', es: 'Puntuación de desempeño', pt: 'Pontuação de desempenho' },
  evidenceConfidence: { en: 'Evidence confidence', es: 'Confianza de la evidencia', pt: 'Confiança das evidências' },
  confidenceHint: {
    en: 'How complete the available business evidence is.',
    es: 'Qué tan completa es la evidencia disponible del negocio.',
    pt: 'Quão completa é a evidência disponível do negócio.',
  },
  performanceUnavailable: {
    en: 'Not enough supported evidence to evaluate performance for this period.',
    es: 'No hay suficiente evidencia confiable para evaluar el desempeño en este período.',
    pt: 'Não há evidência confiável suficiente para avaliar o desempenho neste período.',
  },

  todaysFocus: { en: "Today's Focus", es: 'Enfoque de hoy', pt: 'Foco de hoje' },
  focusWhyCritical: {
    en: 'This requires immediate attention.',
    es: 'Esto requiere atención inmediata.',
    pt: 'Isto requer atenção imediata.',
  },
  focusWhyWarning: {
    en: 'This supported risk can affect results.',
    es: 'Este riesgo respaldado puede afectar los resultados.',
    pt: 'Este risco respaldado pode afetar os resultados.',
  },
  focusWhyOpportunity: {
    en: 'A supported opportunity worth considering.',
    es: 'Una oportunidad respaldada que vale la pena considerar.',
    pt: 'Uma oportunidade respaldada que vale a pena considerar.',
  },
  focusWhyAction: {
    en: 'Proposed next step from the analyzed evidence.',
    es: 'Siguiente paso propuesto según la evidencia analizada.',
    pt: 'Próximo passo proposto com base na evidência analisada.',
  },
  focusEmpty: {
    en: 'There is not enough supported evidence to select a focus for today.',
    es: 'No hay suficiente evidencia confiable para seleccionar un enfoque para hoy.',
    pt: 'Não há evidência confiável suficiente para selecionar um foco para hoje.',
  },
  proposedActionLabel: { en: 'Proposed action', es: 'Acción propuesta', pt: 'Ação proposta' },

  criticalAlerts: { en: 'Critical Alerts', es: 'Alertas Críticas', pt: 'Alertas Críticos' },
  risksAndWarnings: { en: 'Risks & Warnings', es: 'Riesgos y Advertencias', pt: 'Riscos e Avisos' },
  alertsEmpty: {
    en: 'No supported alerts in the analyzed evidence for this period.',
    es: 'Sin alertas respaldadas en la evidencia analizada de este período.',
    pt: 'Sem alertas respaldados na evidência analisada deste período.',
  },

  opportunities: { en: 'Opportunities', es: 'Oportunidades', pt: 'Oportunidades' },
  // MUST match the approved I4.1.4 manager wording: insufficient supported
  // evidence — never a claim that no opportunities exist.
  opportunitiesInsufficient: {
    en: 'I do not have enough supported evidence to identify a standout opportunity in this period.',
    es: 'No tengo suficiente evidencia confiable para identificar una oportunidad destacada en este período.',
    pt: 'Não tenho evidência confiável suficiente para identificar uma oportunidade de destaque neste período.',
  },

  proposedActions: { en: 'Proposed Actions', es: 'Acciones Propuestas', pt: 'Ações Propostas' },
  actionsEmpty: {
    en: 'No proposed actions from the analyzed evidence for this period.',
    es: 'Sin acciones propuestas según la evidencia analizada de este período.',
    pt: 'Sem ações propostas com base na evidência analisada deste período.',
  },
  statusProposed: { en: 'Proposed', es: 'Propuesta', pt: 'Proposta' },
  priorityCritical: { en: 'Critical', es: 'Crítica', pt: 'Crítica' },
  priorityHigh: { en: 'High', es: 'Alta', pt: 'Alta' },
  priorityMedium: { en: 'Medium', es: 'Media', pt: 'Média' },
  priorityLow: { en: 'Low', es: 'Baja', pt: 'Baixa' },

  businessHealth: { en: 'Business Health', es: 'Salud del Negocio', pt: 'Saúde do Negócio' },

  dataNotices: { en: 'Data-Confidence Notices', es: 'Avisos de Confianza de Datos', pt: 'Avisos de Confiança dos Dados' },
  dataNoticesExplain: {
    en: 'These areas could not be evaluated with enough evidence.',
    es: 'Estas áreas no pudieron evaluarse con suficiente evidencia.',
    pt: 'Estas áreas não puderam ser avaliadas com evidência suficiente.',
  },

  executiveSummary: { en: 'Executive Summary', es: 'Resumen Ejecutivo', pt: 'Resumo Executivo' },
  fullBrief: { en: 'Full Business Brief', es: 'Resumen Completo del Negocio', pt: 'Resumo Completo do Negócio' },
  showBrief: { en: 'Show full brief', es: 'Ver resumen completo', pt: 'Ver resumo completo' },
  hideBrief: { en: 'Hide full brief', es: 'Ocultar resumen completo', pt: 'Ocultar resumo completo' },

  suggestedQuestions: { en: 'You can ask the Intelligence chat', es: 'Puedes preguntar al chat de Inteligencia', pt: 'Você pode perguntar ao chat de Inteligência' },

  // Part 5 honest no-data wording (approved meaning).
  noData: {
    en: 'There is not enough business information to evaluate this yet.',
    es: 'Todavía no hay suficiente información del negocio para evaluar esto.',
    pt: 'Ainda não há informações suficientes do negócio para avaliar isto.',
  },
  managerError: {
    en: "The business manager isn't available right now. Please try again.",
    es: 'El asistente de negocio no está disponible en este momento. Inténtalo de nuevo.',
    pt: 'O assistente de negócios não está disponível no momento. Tente novamente.',
  },

  rangeToday: { en: 'Today', es: 'Hoy', pt: 'Hoje' },
  rangeYesterday: { en: 'Yesterday', es: 'Ayer', pt: 'Ontem' },
  rangeThisWeek: { en: 'This week', es: 'Esta semana', pt: 'Esta semana' },
  rangeThisMonth: { en: 'This month', es: 'Este mes', pt: 'Este mês' },
  rangeLast30: { en: 'Last 30 days', es: 'Últimos 30 días', pt: 'Últimos 30 dias' },
} satisfies Record<string, S>;

export type ManagerStringKey = keyof typeof MANAGER_STRINGS;

/** Localized UI label lookup (pure). */
export function ms(key: ManagerStringKey, lang: ManagerLang): string {
  return MANAGER_STRINGS[key][lang];
}
