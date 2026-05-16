// R-INTELLIGENCE-MORNING-OPERATOR-DIGEST-V1
// Morning operator digest engine.
// Aggregates from existing systems only — no duplicate scanning.
// Deterministic, no AI, no ML, no fake forecasting.

import type { ProactiveOperationsReport, ProactiveAction } from '../proactive/types';
import type { ExecutionReport } from '../execution/types';
import type { TrendDirectionReport } from '../types';
import type { MorningDigest, MorningDigestSection } from './types';
import { getStaleWorkflows } from '../workflows/store';
import { getQueue } from '../managerQueue/actions';

// ── Structural context interface ───────────────────────────────────────────────
// Satisfied by IntelligenceEngine structurally — no direct import, no circular dep.
export interface DigestEvalContext {
  getProactiveReport(): ProactiveOperationsReport;
  getExecutionReport(): ExecutionReport;
  getTrendDirectionReport(): TrendDirectionReport;
}

type Lang = 'en' | 'es' | 'pt';
type TimeOfDay = 'morning' | 'afternoon' | 'evening';

// ── Utilities ─────────────────────────────────────────────────────────────────

function fc(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function getTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ── Section builders ──────────────────────────────────────────────────────────
// Each builder returns null when there is nothing to report for that category.

function buildRecoverableSection(
  actions: ProactiveAction[],
  lang: Lang,
): MorningDigestSection | null {
  const money = actions.filter(
    a => a.category === 'collection' || a.category === 'repair_followup',
  );
  if (money.length === 0) return null;

  const es = lang !== 'en';
  const totalCents = money.reduce((s, a) => s + (a.estimatedImpactCents ?? 0), 0);
  const lines: string[] = [];

  if (totalCents > 0) {
    lines.push(
      es
        ? `${fc(totalCents)} posiblemente recuperable hoy.`
        : `${fc(totalCents)} likely recoverable today.`,
    );
  }
  for (const a of money.slice(0, 3)) {
    const amt = a.estimatedImpactCents ? ` — ${fc(a.estimatedImpactCents)}` : '';
    lines.push(`${a.title}${amt}`);
  }

  return {
    title: es ? '💰 Dinero recuperable' : '💰 Recoverable money',
    priority: money.some(a => a.priority === 'critical') ? 'critical' : 'high',
    lines,
  };
}

function buildRepairsSection(
  actions: ProactiveAction[],
  lang: Lang,
): MorningDigestSection | null {
  const repairs = actions.filter(a => a.category === 'repair_followup');
  if (repairs.length === 0) return null;

  const es = lang !== 'en';
  const n = repairs.length;
  const s = n !== 1;
  const lines: string[] = [
    es
      ? `${n} reparación${s ? 'es' : ''} esperando seguimiento.`
      : `${n} repair${s ? 's' : ''} waiting for follow-up.`,
    ...repairs.slice(0, 2).map(a => a.title),
  ];

  return {
    title: es ? '🔧 Reparaciones pendientes' : '🔧 Overdue repairs',
    priority: repairs.some(a => a.priority === 'critical') ? 'critical' : 'high',
    lines,
  };
}

function buildWorkflowSection(lang: Lang): MorningDigestSection | null {
  const stale = getStaleWorkflows(72 * 60 * 60 * 1000);
  if (stale.length === 0) return null;

  const es = lang !== 'en';
  const n = stale.length;
  const s = n !== 1;
  const lines: string[] = [
    es
      ? `${n} flujo${s ? 's' : ''} estancado${s ? 's' : ''} por más de 3 días.`
      : `${n} workflow${s ? 's' : ''} stalled for more than 3 days.`,
    ...stale.slice(0, 2).map(wf => {
      const hoursStale = Math.floor((Date.now() - wf.updatedAt) / 3600000);
      return `${wf.title} — ${hoursStale}h`;
    }),
  ];

  return {
    title: es ? '⚙️ Flujos estancados' : '⚙️ Stalled workflows',
    priority: n > 2 ? 'high' : 'medium',
    lines,
  };
}

function buildVipSection(
  actions: ProactiveAction[],
  lang: Lang,
): MorningDigestSection | null {
  const vip = actions.filter(a => a.category === 'vip_retention');
  if (vip.length === 0) return null;

  const es = lang !== 'en';
  return {
    title: es ? '⭐ Clientes VIP en riesgo' : '⭐ VIP retention risks',
    priority: 'medium',
    lines: vip.slice(0, 2).map(a => a.title),
  };
}

function buildApprovalsSection(lang: Lang): MorningDigestSection | null {
  const pending = getQueue().filter(i => i.status === 'pending');
  if (pending.length === 0) return null;

  const es = lang !== 'en';
  const n = pending.length;
  const s = n !== 1;
  const highCount = pending.filter(
    i => i.severity === 'critical' || i.severity === 'high',
  ).length;

  const lines: string[] = [
    es
      ? `${n} elemento${s ? 's' : ''} pendiente${s ? 's' : ''} de aprobación.`
      : `${n} item${s ? 's' : ''} pending manager approval.`,
  ];
  if (highCount > 0) {
    lines.push(
      es ? `${highCount} de alta prioridad.` : `${highCount} high priority.`,
    );
  }

  return {
    title: es ? '✅ Aprobaciones pendientes' : '✅ Approval backlog',
    priority: highCount > 0 ? 'high' : 'medium',
    lines,
  };
}

function buildInventorySection(
  actions: ProactiveAction[],
  lang: Lang,
): MorningDigestSection | null {
  const inv = actions.filter(a => a.category === 'inventory');
  if (inv.length === 0) return null;

  const es = lang !== 'en';
  return {
    title: es ? '📦 Inventario crítico' : '📦 Inventory risks',
    priority: inv.some(a => a.priority === 'critical') ? 'critical' : 'medium',
    lines: inv.slice(0, 2).map(a => a.title),
  };
}

function buildTrendSection(
  trend: TrendDirectionReport,
  lang: Lang,
): MorningDigestSection | null {
  const bad = (trend.signals ?? []).filter(
    s => s.direction === 'declining' || s.direction === 'worsening',
  );
  if (bad.length === 0) return null;

  const es = lang !== 'en';
  return {
    title: es ? '📊 Tendencias a la baja' : '📊 Declining trends',
    priority: bad.some(s => s.severity === 'critical' || s.severity === 'high') ? 'high' : 'medium',
    lines: bad.slice(0, 2).map(s => s.title),
  };
}

// ── Recommended focus (time-of-day aware) ─────────────────────────────────────

function buildRecommendedFocus(
  proactive: ProactiveOperationsReport,
  exec: ExecutionReport,
  tod: TimeOfDay,
  lang: Lang,
): string | undefined {
  const es = lang !== 'en';

  if (tod === 'morning') {
    if (proactive.actions.some(a => a.category === 'repair_followup')) {
      return es
        ? 'Atender seguimientos de reparación antes del mediodía.'
        : 'Handle repair follow-ups before noon.';
    }
    if (proactive.actions.some(a => a.category === 'collection')) {
      return es
        ? 'Priorizar cobros pendientes en las primeras horas.'
        : 'Prioritize collections in the first hours.';
    }
  }

  if (tod === 'afternoon') {
    const queue = getQueue().filter(i => i.status === 'pending');
    if (queue.length > 0) {
      return es
        ? 'Resolver aprobaciones pendientes antes del cierre.'
        : 'Clear pending approvals before closing.';
    }
    if (proactive.actions.some(a => a.category === 'inventory')) {
      return es
        ? 'Revisar y ordenar inventario con stock bajo.'
        : 'Review and order low-stock inventory.';
    }
  }

  if (tod === 'evening') {
    if (getStaleWorkflows(72 * 60 * 60 * 1000).length > 0) {
      return es
        ? 'Revisar flujos estancados y dejar notas para mañana.'
        : 'Review stalled workflows and leave notes for tomorrow.';
    }
    if (proactive.actions.some(a => a.category === 'vip_retention')) {
      return es
        ? 'Preparar mensajes de seguimiento para clientes VIP inactivos.'
        : 'Prepare follow-up messages for inactive VIP customers.';
    }
  }

  // Fallback: best prepared execution draft
  if (exec.topExecution) {
    const name = exec.topExecution.customerName ?? (es ? 'cliente' : 'customer');
    return es
      ? `Enviar mensaje preparado a ${name}.`
      : `Send prepared message to ${name}.`;
  }

  // Fallback: top proactive recommended action
  return proactive.topAction?.recommendedAction;
}

// ── Section ordering by time of day ──────────────────────────────────────────

function assembleSections(
  proactive: ProactiveOperationsReport,
  exec: ExecutionReport,
  trend: TrendDirectionReport,
  tod: TimeOfDay,
  lang: Lang,
): MorningDigestSection[] {
  const actions = proactive.actions;

  const recoverable = buildRecoverableSection(actions, lang);
  const repairs     = buildRepairsSection(actions, lang);
  const workflows   = buildWorkflowSection(lang);
  const vip         = buildVipSection(actions, lang);
  const approvals   = buildApprovalsSection(lang);
  const inventory   = buildInventorySection(actions, lang);
  const trends      = buildTrendSection(trend, lang);

  // Best execution draft as a section (optional — only if high/critical priority)
  const topExec = exec.topExecution;
  const es = lang !== 'en';
  const execSection: MorningDigestSection | null =
    topExec && (topExec.priority === 'critical' || topExec.priority === 'high')
      ? {
          title: es ? '💬 Mensaje prioritario listo' : '💬 Top prepared message',
          priority: topExec.priority,
          lines: [topExec.draftMessage.length > 110
            ? topExec.draftMessage.slice(0, 110) + '…'
            : topExec.draftMessage],
        }
      : null;

  // Order sections by time of day
  let ordered: (MorningDigestSection | null)[];
  if (tod === 'morning') {
    ordered = [recoverable, repairs, workflows, vip, approvals, inventory, trends, execSection];
  } else if (tod === 'afternoon') {
    ordered = [approvals, inventory, recoverable, repairs, vip, workflows, trends, execSection];
  } else {
    // evening
    ordered = [workflows, vip, approvals, inventory, trends, recoverable, repairs, execSection];
  }

  return ordered
    .filter((s): s is MorningDigestSection => s !== null)
    .slice(0, 6);
}

// ── Summary ───────────────────────────────────────────────────────────────────

function buildSummary(
  recoverableCents: number,
  sections: MorningDigestSection[],
  lang: Lang,
): string {
  const es = lang !== 'en';

  if (sections.length === 0) {
    return es
      ? 'Sin problemas críticos detectados. Buen día para avanzar.'
      : 'No critical issues detected. Good day to get ahead.';
  }

  const parts: string[] = [];

  if (recoverableCents > 0) {
    parts.push(
      es
        ? `${fc(recoverableCents)} posiblemente recuperable`
        : `${fc(recoverableCents)} likely recoverable`,
    );
  }

  const criticalCount = sections.filter(s => s.priority === 'critical').length;
  const highCount     = sections.filter(s => s.priority === 'high').length;

  if (criticalCount > 0) {
    const n = criticalCount;
    parts.push(
      es
        ? `${n} situación${n !== 1 ? 'es' : ''} crítica${n !== 1 ? 's' : ''}`
        : `${n} critical item${n !== 1 ? 's' : ''}`,
    );
  } else if (highCount > 0) {
    const n = highCount;
    parts.push(
      es
        ? `${n} punto${n !== 1 ? 's' : ''} de atención`
        : `${n} item${n !== 1 ? 's' : ''} needing attention`,
    );
  }

  return parts.length > 0 ? parts.join('. ') + '.' : sections[0].lines[0] ?? '';
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateMorningDigest(
  ctx: DigestEvalContext,
  lang: Lang,
): MorningDigest {
  const now = Date.now();
  const tod = getTimeOfDay();

  const proactive = ctx.getProactiveReport();
  const exec      = ctx.getExecutionReport();
  const trend     = ctx.getTrendDirectionReport();

  const sections = assembleSections(proactive, exec, trend, tod, lang);

  const recoverableCents = proactive.actions
    .filter(a => a.category === 'collection' || a.category === 'repair_followup')
    .reduce((s, a) => s + (a.estimatedImpactCents ?? 0), 0);

  const topSection = sections[0];

  return {
    generatedAt: now,
    summary: buildSummary(recoverableCents, sections, lang),
    sections,
    topPriority: topSection?.lines[0],
    recommendedFocus: buildRecommendedFocus(proactive, exec, tod, lang),
    estimatedRecoverableCents: recoverableCents > 0 ? recoverableCents : undefined,
  };
}
