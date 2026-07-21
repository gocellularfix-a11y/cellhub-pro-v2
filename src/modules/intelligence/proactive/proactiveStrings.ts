// ============================================================
// I6-C2 — proactive consumer UI labels + tone mapping.
//
// CHROME LABELS ONLY (section title, expand/collapse, open manager, dismiss,
// collapsed bubble summary). Every INSIGHT sentence — headline, summary,
// recommendation, executive line — is already owned by the I6-C1 presenter
// and is NEVER re-worded here. Same tri() convention as the approved manager
// surface; ES uses tuteo, never voseo. Tones reuse the manager palette so the
// proactive section feels native.
// ============================================================

import type { InsightPriority, PresenterLang } from '@/services/intelligence/presentation';
import { tri } from '@/services/intelligence/presentation';
import { TONE_COLORS } from '../manager/surfaceStyles';

export type ToneKey = 'positive' | 'warning' | 'critical' | 'neutral';

/** Visual priority → manager tone bucket. Positive is success-green; watch/
 *  important are amber; critical is red; info is neutral slate (never green,
 *  never red). */
export function priorityTone(priority: InsightPriority): ToneKey {
  switch (priority) {
    case 'critical': return 'critical';
    case 'important': return 'warning';
    case 'watch': return 'warning';
    case 'positive': return 'positive';
    case 'info':
    default: return 'neutral';
  }
}

export function toneColorsFor(priority: InsightPriority): { fg: string; bg: string; border: string } {
  return TONE_COLORS[priorityTone(priority)];
}

export const PUI = {
  sectionTitle: (l: PresenterLang) => tri(l, "Today's Intelligence", 'Inteligencia de hoy', 'Inteligência de hoje'),
  live: (l: PresenterLang) => tri(l, 'Live', 'En vivo', 'Ao vivo'),
  showDetails: (l: PresenterLang) => tri(l, 'Show details', 'Ver detalles', 'Ver detalhes'),
  hideDetails: (l: PresenterLang) => tri(l, 'Hide details', 'Ocultar detalles', 'Ocultar detalhes'),
  openManager: (l: PresenterLang) => tri(l, 'Open Business Manager', 'Abrir Gerente del Negocio', 'Abrir Gerente do Negócio'),
  dismiss: (l: PresenterLang) => tri(l, 'Dismiss', 'Descartar', 'Dispensar'),
  expand: (l: PresenterLang) => tri(l, 'Expand', 'Expandir', 'Expandir'),
  collapse: (l: PresenterLang) => tri(l, 'Collapse', 'Contraer', 'Recolher'),
  intelligence: (l: PresenterLang) => tri(l, 'Intelligence', 'Inteligencia', 'Inteligência'),
  recommendation: (l: PresenterLang) => tri(l, 'Recommended', 'Recomendado', 'Recomendado'),
  moreItems: (n: number, l: PresenterLang) =>
    tri(l,
      `+${n} more lower-priority ${n === 1 ? 'item' : 'items'}`,
      `+${n} ${n === 1 ? 'punto' : 'puntos'} de menor prioridad`,
      `+${n} ${n === 1 ? 'item' : 'itens'} de menor prioridade`),
  evidenceConfidence: (pct: number, l: PresenterLang) =>
    tri(l, `Evidence ${pct}%`, `Evidencia ${pct}%`, `Evidência ${pct}%`),
  // Collapsed bubble summary lines.
  needAttention: (n: number, l: PresenterLang) =>
    tri(l,
      `${n} ${n === 1 ? 'thing needs' : 'things need'} attention`,
      `${n} ${n === 1 ? 'cosa necesita' : 'cosas necesitan'} atención`,
      `${n} ${n === 1 ? 'coisa precisa' : 'coisas precisam'} de atenção`),
  worthLook: (l: PresenterLang) => tri(l, 'Worth a look', 'Vale la pena revisar', 'Vale a pena revisar'),
  noUrgent: (l: PresenterLang) => tri(l, 'No urgent items', 'Sin temas urgentes', 'Sem itens urgentes'),
} as const;
