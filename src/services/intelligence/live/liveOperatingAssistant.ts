// R-INTELLIGENCE-LIVE-OPERATING-ASSISTANT-V1
// Evaluates real-time operational windows and returns the highest-priority
// suggestion the operator should act on right now.
// Structural interface — no direct IntelligenceEngine import, no circular dep.

import type { LiveAssistTrigger, LiveAssistSuggestion, LiveAssistContext } from './types';
import { getQueue } from '../managerQueue/actions';
import { getStaleWorkflows } from '../workflows/store';
import type { ExecutionReport } from '../execution/types';
import type { TrendDirectionReport } from '../types';
import type { ProactiveOperationsReport } from '../proactive/types';

export interface LiveAssistEvalContext {
  getExecutionReport(): ExecutionReport;
  getTrendDirectionReport(): TrendDirectionReport;
  getProactiveReport(): ProactiveOperationsReport;
}

// ── Cooldown management ───────────────────────────────────────────────────────

const STORAGE_KEY = 'cellhub:liveAssistCooldowns:v1';
const COOLDOWN_ID_MS      = 30 * 60 * 1000;  // 30 min per suggestion id
const COOLDOWN_TRIGGER_MS = 10 * 60 * 1000;  // 10 min per trigger type

interface CooldownStore {
  byId:      Record<string, number>;
  byTrigger: Record<string, number>;
}

function readCooldowns(): CooldownStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { byId: {}, byTrigger: {} };
    const parsed = JSON.parse(raw) as Partial<CooldownStore>;
    return {
      byId:      (parsed.byId      && typeof parsed.byId      === 'object') ? parsed.byId      : {},
      byTrigger: (parsed.byTrigger && typeof parsed.byTrigger === 'object') ? parsed.byTrigger : {},
    };
  } catch {
    return { byId: {}, byTrigger: {} };
  }
}

// Called by FloatingOperatorBubble on action or dismiss.
export function writeCooldown(id: string, trigger: LiveAssistTrigger): void {
  try {
    const store = readCooldowns();
    const now = Date.now();
    store.byId[id] = now;
    store.byTrigger[trigger] = now;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* localStorage unavailable */ }
}

function isOnCooldown(
  id: string,
  trigger: LiveAssistTrigger,
  priority: 'critical' | 'high' | 'medium',
): boolean {
  const store = readCooldowns();
  const now = Date.now();

  if (now - (store.byId[id] ?? 0) < COOLDOWN_ID_MS) return true;

  // Critical bypasses trigger cooldown — always surfaces.
  if (priority === 'critical') return false;

  return now - (store.byTrigger[trigger] ?? 0) < COOLDOWN_TRIGGER_MS;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Trigger evaluators (evaluated in priority order) ──────────────────────────

type Lang = 'en' | 'es' | 'pt';

function evalCriticalQueue(lang: Lang): LiveAssistSuggestion | null {
  const critical = getQueue().filter(i => i.status === 'pending' && i.severity === 'critical');
  if (critical.length === 0) return null;

  const first = critical[0];
  const id = `critical-queue-${first.id}`;
  if (isOnCooldown(id, 'critical_queue', 'critical')) return null;

  const es = lang !== 'en';
  const n = critical.length;
  return {
    id,
    trigger: 'critical_queue',
    priority: 'critical',
    headline: es
      ? `⚠️ ${n} elemento${n === 1 ? '' : 's'} crítico${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'}`
      : `⚠️ ${n} critical item${n === 1 ? '' : 's'} pending approval`,
    subline: first.title,
    action: { type: 'open_manager_queue' },
    createdAt: Date.now(),
  };
}

function evalStalledWorkflow(lang: Lang): LiveAssistSuggestion | null {
  const stale = getStaleWorkflows(72 * 60 * 60 * 1000);
  if (stale.length === 0) return null;

  const first = stale[0];
  const id = `stalled-workflow-${first.id}`;
  if (isOnCooldown(id, 'stalled_workflow', 'high')) return null;

  const es = lang !== 'en';
  const n = stale.length;
  return {
    id,
    trigger: 'stalled_workflow',
    priority: 'high',
    headline: es
      ? `⚙️ ${n} flujo${n === 1 ? '' : 's'} estancado${n === 1 ? '' : 's'} hace 3+ días`
      : `⚙️ ${n} workflow${n === 1 ? '' : 's'} stalled for 3+ days`,
    subline: first.title,
    action: { type: 'open_intelligence' },
    createdAt: Date.now(),
  };
}

function evalExecutionReady(ctx: LiveAssistEvalContext, lang: Lang): LiveAssistSuggestion | null {
  const exec = ctx.getExecutionReport();
  if (!exec.topExecution) return null;

  const top = exec.topExecution;
  const id = `execution-ready-${top.id}`;
  if (isOnCooldown(id, 'execution_ready', top.priority)) return null;

  const es = lang !== 'en';
  const name = top.customerName ?? (es ? 'cliente' : 'customer');
  return {
    id,
    trigger: 'execution_ready',
    priority: top.priority,
    headline: es
      ? `💬 Mensaje listo para ${name}`
      : `💬 Draft ready for ${name}`,
    subline: top.reason,
    action: { type: 'open_execution_queue' },
    createdAt: Date.now(),
  };
}

function evalTrendWarning(ctx: LiveAssistEvalContext, lang: Lang): LiveAssistSuggestion | null {
  const trend = ctx.getTrendDirectionReport();
  const bad = (trend.signals ?? []).filter(
    s => s.direction === 'declining' || s.direction === 'worsening',
  );
  if (bad.length === 0) return null;

  const worst = bad[0];
  const id = `trend-warning-${worst.id}`;
  if (isOnCooldown(id, 'trend_warning', 'medium')) return null;

  const es = lang !== 'en';
  return {
    id,
    trigger: 'trend_warning',
    priority: 'medium',
    headline: es ? '📊 Tendencia a la baja detectada' : '📊 Declining trend detected',
    subline: worst.title,
    action: { type: 'open_intelligence' },
    createdAt: Date.now(),
  };
}

function evalIdleWindow(context: LiveAssistContext, lang: Lang): LiveAssistSuggestion | null {
  const IDLE_THRESHOLD = 5 * 60 * 1000; // 5 min
  if (context.idleMs < IDLE_THRESHOLD) return null;

  const id = `idle-window-${todayKey()}`;
  if (isOnCooldown(id, 'idle_window', 'medium')) return null;

  const es = lang !== 'en';
  return {
    id,
    trigger: 'idle_window',
    priority: 'medium',
    headline: es ? '💡 ¿Cuál es tu próxima acción?' : "💡 What's your next move?",
    action: { type: 'open_morning_digest' },
    createdAt: Date.now(),
  };
}

function evalMorningOpen(context: LiveAssistContext, lang: Lang): LiveAssistSuggestion | null {
  if (!context.isFirstOpenToday) return null;

  const hour = new Date().getHours();
  if (hour >= 11) return null; // Only before late morning

  const id = `morning-open-${todayKey()}`;
  if (isOnCooldown(id, 'morning_open', 'medium')) return null;

  const es = lang !== 'en';
  return {
    id,
    trigger: 'morning_open',
    priority: 'medium',
    headline: es ? '🌅 Resumen matutino disponible' : '🌅 Morning digest ready',
    subline: es
      ? 'Ve qué acciones tomar antes del rush'
      : 'See what to tackle before the rush',
    action: { type: 'open_morning_digest' },
    createdAt: Date.now(),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateLiveAssistSuggestion(
  ctx: LiveAssistEvalContext,
  context: LiveAssistContext,
  lang: Lang,
): LiveAssistSuggestion | null {
  if (context.modalOpen) return null;

  return (
    evalCriticalQueue(lang)          ??
    evalStalledWorkflow(lang)        ??
    evalExecutionReady(ctx, lang)    ??
    evalTrendWarning(ctx, lang)      ??
    evalIdleWindow(context, lang)    ??
    evalMorningOpen(context, lang)   ??
    null
  );
}
