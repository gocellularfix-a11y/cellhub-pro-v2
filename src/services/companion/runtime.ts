// ============================================================
// Companion — Background polling runtime.
//
// Mounted globally by AppShell via CompanionRuntimeMount, this
// keeps polling the bridge regardless of which sidebar tab the
// operator is on. Without it, MessagesPanel / ApprovalsPanel /
// ApprovalThread only detect new activity while they're mounted —
// so leaving Companion silenced all notifications.
//
// Notification routing:
//   - Always: fire global toast (visible from any tab).
//   - When activeTab !== 'companion': also push to the badge +
//     ephemeral bubble hint (out-of-context surfaces).
//   - When activeTab === 'companion': skip badge/bubble — the
//     operator is already looking at the data.
//
// Self-contained: no imports from src/services/companion / legacy.
// Polling cadence is intentionally slightly slower than the in-page
// 3s polls (5s here) so server load doesn't double when both fire.
// ============================================================

import type { ApprovalRequest, CompanionDesktopSession } from '@/types/companion';
import { CompanionApiError } from './apiClient';
import { loadDesktopSession } from './identityStore';
import { listApprovals, listApprovalMessages } from './approvalsService';
import { listMessages } from './messagesService';
import {
  notifyApprovalAccepted,
  notifyApprovalDenied,
  notifyGeneralMessage,
  notifyApprovalMessage,
} from './bubbleNotify';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;

export interface RuntimeBindings {
  /** Returns the current sidebar active tab id (read fresh on each poll). */
  getActiveTab: () => string;
  /** Stable global toast trigger. */
  toast: ToastFn;
}

const POLL_INTERVAL_MS = 5000;
const THREAD_RECENT_HOURS = 1;
const MAX_THREADS_WATCHED = 20;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let bindings: RuntimeBindings | null = null;

// Per-session state — keyed implicitly by trackedToken so a re-pair
// with a different store cannot reuse the prior seen-id sets.
let trackedToken: string | null = null;
let seedDone = false;
// Set to true on 401 — clears when a new posToken appears (re-pair).
let authFailed = false;
const seenApprovalStatuses = new Map<string, ApprovalRequest['status']>();
const seenApprovalMessageIds = new Set<string>();
const seenGeneralMessageIds = new Set<string>();

function resetSessionState(): void {
  seedDone = false;
  authFailed = false;
  seenApprovalStatuses.clear();
  seenApprovalMessageIds.clear();
  seenGeneralMessageIds.clear();
}

export function startCompanionRuntime(b: RuntimeBindings): void {
  bindings = b;
  if (intervalHandle) return;
  intervalHandle = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
  void poll();
}

export function stopCompanionRuntime(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  bindings = null;
  trackedToken = null;
  resetSessionState();
}

async function poll(): Promise<void> {
  const local = bindings;
  if (!local) return;
  const session = loadDesktopSession();
  if (!session) {
    if (trackedToken !== null) {
      trackedToken = null;
      resetSessionState();
    }
    return;
  }
  // New session — reset seen-id sets and re-seed silently next pass.
  if (session.posToken !== trackedToken) {
    trackedToken = session.posToken;
    resetSessionState();
  }

  // Auth failure from a previous cycle — skip until re-pair provides a new token.
  if (authFailed) return;

  const isOnTab = local.getActiveTab() === 'companion';
  const seedingNow = !seedDone;

  try {
    await pollApprovalsAndStatuses(session, isOnTab, seedingNow, local.toast);
    await pollApprovalThreads(session, isOnTab, seedingNow, local.toast);
    await pollGeneralMessages(session, isOnTab, seedingNow, local.toast);
    seedDone = true;
  } catch (err) {
    if (err instanceof CompanionApiError && err.httpStatus === 401) {
      authFailed = true;
      console.warn('[CompanionRuntime] 401 — pausing poll until session is re-paired');
      return;
    }
    /* transient — try again next interval */
  }
}

async function pollApprovalsAndStatuses(
  session: CompanionDesktopSession,
  isOnTab: boolean,
  seedingNow: boolean,
  toast: ToastFn,
): Promise<void> {
  const approvals = await listApprovals(session);
  if (seedingNow) {
    for (const a of approvals) seenApprovalStatuses.set(a.id, a.status);
    return;
  }
  for (const a of approvals) {
    const prev = seenApprovalStatuses.get(a.id);
    if (prev === 'pending' && (a.status === 'approved' || a.status === 'denied')) {
      const label = a.affectedItem ?? a.reason.slice(0, 40);
      const who = a.respondedBy ?? 'manager';
      const note = a.managerNote ? ` — "${a.managerNote}"` : '';
      const verbToast = a.status === 'approved' ? '✅ Approved' : '❌ Denied';
      toast(`${verbToast} by ${who}${note}`, a.status === 'approved' ? 'success' : 'warning');
      if (!isOnTab) {
        if (a.status === 'approved') notifyApprovalAccepted(label);
        else notifyApprovalDenied(label);
      }
    }
    seenApprovalStatuses.set(a.id, a.status);
  }
}

async function pollApprovalThreads(
  session: CompanionDesktopSession,
  isOnTab: boolean,
  seedingNow: boolean,
  toast: ToastFn,
): Promise<void> {
  // Re-fetch the list locally (cheap — same Map.get on the bridge).
  let approvals: ApprovalRequest[] = [];
  try { approvals = await listApprovals(session); } catch { return; }
  const recentMs = Date.now() - THREAD_RECENT_HOURS * 3600 * 1000;
  const threadsToWatch = approvals
    .filter(a =>
      a.status === 'pending' ||
      (a.respondedAt ? new Date(a.respondedAt).getTime() > recentMs : false)
    )
    .slice(0, MAX_THREADS_WATCHED);

  for (const a of threadsToWatch) {
    let msgs;
    try { msgs = await listApprovalMessages(session, a.id); } catch { continue; }
    for (const m of msgs) {
      if (seenApprovalMessageIds.has(m.id)) continue;
      seenApprovalMessageIds.add(m.id);
      if (seedingNow || m.fromRole !== 'manager') continue;
      const who = m.fromName ?? 'Manager';
      const preview = m.body.length > 80 ? `${m.body.slice(0, 77)}…` : m.body;
      toast(`💬 Approval: ${who}: ${preview}`, 'info');
      if (!isOnTab) notifyApprovalMessage(who);
    }
  }
}

async function pollGeneralMessages(
  session: CompanionDesktopSession,
  isOnTab: boolean,
  seedingNow: boolean,
  toast: ToastFn,
): Promise<void> {
  let msgs;
  try { msgs = await listMessages(session); } catch { return; }
  for (const m of msgs) {
    if (seenGeneralMessageIds.has(m.id)) continue;
    seenGeneralMessageIds.add(m.id);
    if (seedingNow || m.fromRole !== 'manager') continue;
    const who = m.fromName ?? 'Manager';
    const preview = m.body.length > 80 ? `${m.body.slice(0, 77)}…` : m.body;
    toast(`💬 ${who}: ${preview}`, 'info');
    if (!isOnTab) notifyGeneralMessage(who);
  }
}
