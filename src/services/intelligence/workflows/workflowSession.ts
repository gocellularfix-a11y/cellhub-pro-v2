// INTELLIGENCE-OPERATIONAL-WORKFLOW-SESSIONS-V1
// In-memory chat-driven workflow session manager.
// Sessions are short-lived (TTL from registry) and never persisted to localStorage.
// All exports are *Session-suffixed to avoid collision with flowEngine / store.

import type { WorkflowSession, OperationalWorkflowType } from './types';
import { getWorkflowDefinition } from './workflowRegistry';
import { generateId } from '@/utils/dates';

const sessions = new Map<string, WorkflowSession>();

export interface CreateSessionOpts {
  entityKind?: string;
  entityId?: string;
  entityName?: string;
  entityPhone?: string;
  amountCents?: number;
}

export function createWorkflowSession(
  type: OperationalWorkflowType,
  opts?: CreateSessionOpts,
): WorkflowSession {
  purgeExpiredSessions();
  const def = getWorkflowDefinition(type);
  const now = Date.now();
  const session: WorkflowSession = {
    id: generateId(),
    type,
    currentStepIndex: 0,
    steps: def.steps,
    entityKind:   opts?.entityKind,
    entityId:     opts?.entityId,
    entityName:   opts?.entityName,
    entityPhone:  opts?.entityPhone,
    amountCents:  opts?.amountCents,
    createdAt: now,
    expiresAt: now + def.ttlMs,
    completed: false,
  };
  sessions.set(session.id, session);
  return session;
}

export function getWorkflowSession(id: string): WorkflowSession | null {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(id);
    return null;
  }
  return s;
}

export function advanceWorkflowSession(id: string): WorkflowSession | null {
  const s = getWorkflowSession(id);
  if (!s || s.completed) return null;
  const next = s.currentStepIndex + 1;
  const updated: WorkflowSession = {
    ...s,
    currentStepIndex: next,
    completed: next >= s.steps.length,
  };
  sessions.set(id, updated);
  return updated;
}

export function completeWorkflowSession(id: string): WorkflowSession | null {
  const s = getWorkflowSession(id);
  if (!s) return null;
  const updated: WorkflowSession = {
    ...s,
    currentStepIndex: s.steps.length - 1,
    completed: true,
  };
  sessions.set(id, updated);
  return updated;
}

export function expireWorkflowSession(id: string): void {
  sessions.delete(id);
}

export function purgeExpiredSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(id);
  }
}
