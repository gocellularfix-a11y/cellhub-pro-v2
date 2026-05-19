// INTELLIGENCE-OPERATOR-CONTINUITY-RUNTIME-V1
// Connects active workflow sessions to chat follow-up routing.
// Deterministic: no AI, no persistence, no auto-send, no auto-charge.

import type { WorkflowSession, WorkflowStepKind } from './types';
import { getActiveWorkflowSessions, advanceWorkflowSession, completeWorkflowSession, expireWorkflowSession } from './workflowSession';
import { getWorkflowDefinition } from './workflowRegistry';

export type FollowUpAction =
  | 'continue'
  | 'send_message'
  | 'open_entity'
  | 'complete'
  | 'cancel'
  | null;

export interface WorkflowFollowUpResult {
  action: FollowUpAction;
  confidence: number;
}

export interface WorkflowNextStep {
  session: WorkflowSession;
  currentStepKind: WorkflowStepKind;
  nextStepKind: WorkflowStepKind | null;
  labelEn: string;
  labelEs: string;
  suggestedAction: FollowUpAction;
}

// Re-export session mutators so handlers.ts has a single import path.
export { advanceWorkflowSession, completeWorkflowSession, expireWorkflowSession };

// ── getActiveWorkflowSession ──────────────────────────────────────────────────
// Returns latest non-expired, non-completed session. V1: single-session model.

export function getActiveWorkflowSession(): WorkflowSession | null {
  return getActiveWorkflowSessions()[0] ?? null;
}

// ── resolveWorkflowFollowUp ───────────────────────────────────────────────────
// Maps short follow-up phrases to safe follow-up actions.
// Word-boundary regex prevents partial matches in longer queries.

const FOLLOW_UP_PATTERNS: Array<[RegExp, FollowUpAction]> = [
  // complete / done — checked BEFORE cancel so "mark done" doesn't fall through
  [/\b(complete|done|mark complete|mark done|finished|all done|completo|listo|concluir|concluído|concluido)\b/i, 'complete'],
  // cancel / stop
  [/\b(cancel|stop|cancelar|parar)\b/i, 'cancel'],
  // send message — explicit send phrases only (never auto-send)
  [/\b(send it|send reminder|send message|mandalo|m[aá]ndalo|enviar recordatorio|enviar mensaje|enviar lembrete)\b/i, 'send_message'],
  // open entity — unambiguous "open it" forms only
  [/\b(open it|[aá]brelo|abrir|abrirlo)\b/i, 'open_entity'],
  // continue / next step
  [/\b(continue|next step|what now|continua|continuar|siguiente paso|que sigue|qu[eé] sigue|pr[oó]ximo passo|o que agora)\b/i, 'continue'],
];

export function resolveWorkflowFollowUp(query: string): WorkflowFollowUpResult {
  const q = query.toLowerCase().trim();
  for (const [re, action] of FOLLOW_UP_PATTERNS) {
    if (re.test(q)) return { action, confidence: 0.9 };
  }
  return { action: null, confidence: 0 };
}

// ── stepKindToSuggestedAction ─────────────────────────────────────────────────

function stepKindToSuggestedAction(kind: WorkflowStepKind): FollowUpAction {
  switch (kind) {
    case 'detect_entity':
    case 'navigate_to_entity': return 'open_entity';
    case 'send_message':       return 'send_message';
    case 'confirm_amount':
    case 'confirm_action':     return 'continue';
    case 'complete':           return 'complete';
  }
}

// ── getWorkflowNextStep ───────────────────────────────────────────────────────
// Returns deterministic next-step guidance. No side effects.

export function getWorkflowNextStep(session: WorkflowSession): WorkflowNextStep {
  const def = getWorkflowDefinition(session.type);
  const idx = session.currentStepIndex;
  const currentStepKind = (session.steps[idx] ?? 'complete') as WorkflowStepKind;
  const nextStepKind = (session.steps[idx + 1] ?? null) as WorkflowStepKind | null;
  const suggestedAction = session.completed ? 'complete' : stepKindToSuggestedAction(currentStepKind);

  const entityPart = session.entityName ? ` — ${session.entityName}` : '';
  const stepPart = `(${idx + 1}/${session.steps.length})`;
  const labelEn = `${def.labelEn}${entityPart} ${stepPart}: ${currentStepKind.replace(/_/g, ' ')}`;
  const labelEs = `${def.labelEs}${entityPart} ${stepPart}: ${currentStepKind.replace(/_/g, ' ')}`;

  return { session, currentStepKind, nextStepKind, labelEn, labelEs, suggestedAction };
}
