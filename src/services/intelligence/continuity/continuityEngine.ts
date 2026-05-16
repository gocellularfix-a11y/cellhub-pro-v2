// ============================================================
// CellHub Intelligence — Operational Continuity Engine
// R-INTELLIGENCE-CONTINUITY-V1
//
// Deterministic, local, silent. Tracks operational flows that
// were started but not fully completed. Surfaces resume-oriented
// reminders only — no automation, no auto-completion.
//
// Types:
//   repair_followup_pending  — ready repair, customer not notified
//   approval_pending         — manager queue item stale >24h
//   outreach_pending         — operator task sitting untouched >48h
//   interrupted_workflow     — workflow opened but not finished
//
// external_payment_pending is handled by PaymentVerificationNudge
// and is intentionally NOT duplicated here.
// ============================================================

import { normalizeRepairStatus } from '@/utils/repairStatus';
import type { OperatorQueueItem } from '../operatorQueue/operatorQueue';
import type { ManagerQueueItem } from '../managerQueue/types';

// ── Types ─────────────────────────────────────────────────

export type ContinuityType =
  | 'repair_followup_pending'
  | 'approval_pending'
  | 'outreach_pending'
  | 'interrupted_workflow';

export type ContinuityStatus = 'pending' | 'resumed' | 'dismissed' | 'completed';

export interface ContinuityItem {
  id: string;
  type: ContinuityType;
  createdAt: number;          // epoch ms — when the underlying issue started
  remindAt: number;           // epoch ms — when to surface (≤ now = show it)
  status: ContinuityStatus;
  title: string;
  summary: string;
  relatedEntityId?: string;
  customerName?: string;
  phone?: string;
  suggestedAction?: string;   // button label
  navigateTo?: string;        // tab name for cellhub:navigate-tab event
  openEventType?: string;     // custom event name (cellhub:open-*)
  openEventDetail?: Record<string, string>;
}

// ── Loose input types (avoid tight coupling to store types) ─

interface RepairLike {
  id: string;
  status: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  customerName: string;
  customerPhone?: string;
  device?: string;
  estimatedCost?: number;
}

export interface ContinuityInput {
  repairs: RepairLike[];
  managerQueueItems: ManagerQueueItem[];
  operatorQueueItems: OperatorQueueItem[];
  dismissedIds: Record<string, number>;
  now?: number;
}

// ── Storage keys ──────────────────────────────────────────

const DISMISSED_KEY  = 'cellhub:intelligence:continuityDismissed:v1';
const WORKFLOW_KEY   = 'cellhub:intelligence:workflowTracking:v1';

const DISMISS_TTL    = 4 * 3600_000;    // 4h — standard dismiss cooldown
const RESUME_TTL     = 1 * 3600_000;    // 1h — shorter after Resume action
const CLEAN_TTL      = 48 * 3600_000;   // 48h — auto-purge stale entries

// ── Dismissed item persistence ────────────────────────────

export function readDismissedContinuity(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch { return {}; }
}

function writeDismissedContinuity(all: Record<string, number>): void {
  const now = Date.now();
  const cleaned: Record<string, number> = {};
  for (const [k, ts] of Object.entries(all)) {
    if (now - ts < CLEAN_TTL) cleaned[k] = ts;
  }
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(cleaned)); } catch { /* quota */ }
}

export function dismissContinuityItem(id: string): void {
  const all = readDismissedContinuity();
  all[id] = Date.now();
  writeDismissedContinuity(all);
}

// Resume marks with a short 1h cooldown — item can resurface sooner.
export function resumeContinuityItem(id: string): void {
  const all = readDismissedContinuity();
  all[id] = Date.now() - (DISMISS_TTL - RESUME_TTL);   // expires in 1h from now
  writeDismissedContinuity(all);
}

// ── Workflow tracking (interrupted_workflow) ──────────────

interface WorkflowEntry {
  startedAt: number;
  title: string;
  summary: string;
  navigateTo: string;
}

function readWorkflowTracking(): Record<string, WorkflowEntry> {
  try {
    const raw = localStorage.getItem(WORKFLOW_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WorkflowEntry>) : {};
  } catch { return {}; }
}

export function trackWorkflowStart(id: string, entry: Omit<WorkflowEntry, 'startedAt'>): void {
  const all = readWorkflowTracking();
  all[id] = { ...entry, startedAt: Date.now() };
  try { localStorage.setItem(WORKFLOW_KEY, JSON.stringify(all)); } catch { /* quota */ }
}

export function clearWorkflowTrack(id: string): void {
  const all = readWorkflowTracking();
  if (!(id in all)) return;
  delete all[id];
  try { localStorage.setItem(WORKFLOW_KEY, JSON.stringify(all)); } catch { /* quota */ }
}

const INTERRUPT_THRESHOLD_MS = 15 * 60_000;  // 15 min without completion = interrupted
const WORKFLOW_MAX_AGE_MS    = 24 * 3600_000; // purge stale tracking after 24h

function getInterruptedWorkflows(now: number): Array<{ id: string } & WorkflowEntry> {
  const all = readWorkflowTracking();
  const result: Array<{ id: string } & WorkflowEntry> = [];
  for (const [id, entry] of Object.entries(all)) {
    const age = now - entry.startedAt;
    if (age >= INTERRUPT_THRESHOLD_MS && age < WORKFLOW_MAX_AGE_MS) {
      result.push({ id, ...entry });
    } else if (age >= WORKFLOW_MAX_AGE_MS) {
      // Auto-purge very stale tracking entries
      clearWorkflowTrack(id);
    }
  }
  return result.sort((a, b) => a.startedAt - b.startedAt); // oldest first
}

// ── Timestamp helper ──────────────────────────────────────

function toMs(val: unknown): number {
  if (!val) return 0;
  try {
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().getTime();
    }
    const t = new Date(val as string | Date).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

// ── Candidate builders ────────────────────────────────────

const READY_THRESHOLD_MS     = 2 * 86_400_000;  // 2 days in 'ready' → notify
const RECENT_FOLLOWUP_MS     = 7 * 86_400_000;  // 7 days — recent follow-up window
const APPROVAL_THRESHOLD_MS  = 24 * 3600_000;   // 24h without action → surface
const OUTREACH_THRESHOLD_MS  = 48 * 3600_000;   // 48h in queue untouched → surface

function buildRepairFollowup(
  repairs: RepairLike[],
  operatorQueueItems: OperatorQueueItem[],
  isDismissed: (id: string) => boolean,
  now: number,
): ContinuityItem | null {
  let best: { item: ContinuityItem; age: number } | null = null;

  for (const r of repairs) {
    if (normalizeRepairStatus(r.status) !== 'ready') continue;

    const id = `repair_followup:${r.id}`;
    if (isDismissed(id)) continue;

    // Use updatedAt as proxy for when it became 'ready'; fall back to createdAt.
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    const age = now - ts;
    if (age < READY_THRESHOLD_MS) continue;

    // Skip if operator queue shows a recent completed follow-up for this repair.
    const recentFollowup = operatorQueueItems.some(
      (i) =>
        i.type === 'repair_follow_up' &&
        i.relatedEntityId === r.id &&
        i.status === 'completed' &&
        (i.completedAt ?? 0) > now - RECENT_FOLLOWUP_MS,
    );
    if (recentFollowup) continue;

    const days = Math.floor(age / 86_400_000);
    if (!best || age > best.age) {
      best = {
        age,
        item: {
          id,
          type: 'repair_followup_pending',
          createdAt: ts || now,
          remindAt: ts + READY_THRESHOLD_MS,
          status: 'pending',
          title: `Contact: ${r.customerName}`,
          summary: `Repair ready ${days}d — customer not yet notified`,
          relatedEntityId: r.id,
          customerName: r.customerName,
          phone: r.customerPhone || undefined,
          suggestedAction: 'Open Repair',
          openEventType: 'cellhub:open-repair',
          openEventDetail: { repairId: r.id },
        },
      };
    }
  }
  return best?.item ?? null;
}

function buildApprovalPending(
  managerQueueItems: ManagerQueueItem[],
  isDismissed: (id: string) => boolean,
  now: number,
): ContinuityItem | null {
  const stale = managerQueueItems
    .filter(
      (i) =>
        i.status === 'pending' &&
        now - i.createdAt >= APPROVAL_THRESHOLD_MS,
    )
    .sort((a, b) => a.createdAt - b.createdAt); // oldest first

  for (const i of stale) {
    const id = `approval_pending:${i.id}`;
    if (isDismissed(id)) continue;
    const hours = Math.floor((now - i.createdAt) / 3600_000);
    return {
      id,
      type: 'approval_pending',
      createdAt: i.createdAt,
      remindAt: i.createdAt + APPROVAL_THRESHOLD_MS,
      status: 'pending',
      title: i.title,
      summary: `Awaiting review for ${hours}h`,
      relatedEntityId: i.entityId,
      suggestedAction: 'Review',
      openEventType: 'cellhub:open-manager-review',
      openEventDetail: {},
    };
  }
  return null;
}

const OUTREACH_TYPES = new Set<string>(['recover_customer', 'vip_outreach']);

function buildOutreachPending(
  operatorQueueItems: OperatorQueueItem[],
  isDismissed: (id: string) => boolean,
  now: number,
): ContinuityItem | null {
  const stale = operatorQueueItems
    .filter(
      (i) =>
        i.status === 'pending' &&
        OUTREACH_TYPES.has(i.type) &&
        now - i.createdAt >= OUTREACH_THRESHOLD_MS,
    )
    .sort((a, b) => a.createdAt - b.createdAt); // oldest first

  for (const i of stale) {
    const id = `outreach_pending:${i.id}`;
    if (isDismissed(id)) continue;
    const days = Math.floor((now - i.createdAt) / 86_400_000);
    return {
      id,
      type: 'outreach_pending',
      createdAt: i.createdAt,
      remindAt: i.createdAt + OUTREACH_THRESHOLD_MS,
      status: 'pending',
      title: `Follow up: ${i.customerName}`,
      summary: `Queue task pending ${days}d — no action taken`,
      relatedEntityId: i.relatedEntityId,
      customerName: i.customerName,
      phone: i.phone || undefined,
      suggestedAction: i.phone ? 'Message' : 'View',
      // If phone: resume = open WhatsApp (handled in component)
      // If no phone: navigate to customer
      openEventType: i.relatedEntityId ? 'cellhub:open-customer' : undefined,
      openEventDetail: i.relatedEntityId ? { customerId: i.relatedEntityId } : undefined,
    };
  }
  return null;
}

function buildInterruptedWorkflows(
  isDismissed: (id: string) => boolean,
  now: number,
): ContinuityItem[] {
  return getInterruptedWorkflows(now)
    .filter((w) => !isDismissed(`interrupted:${w.id}`))
    .map((w) => ({
      id: `interrupted:${w.id}`,
      type: 'interrupted_workflow' as ContinuityType,
      createdAt: w.startedAt,
      remindAt: w.startedAt + INTERRUPT_THRESHOLD_MS,
      status: 'pending' as ContinuityStatus,
      title: w.title,
      summary: w.summary,
      suggestedAction: 'Go to POS',
      navigateTo: w.navigateTo,
    }));
}

// ── Main export ───────────────────────────────────────────

const MAX_ITEMS = 3;

export function generateContinuityItems(input: ContinuityInput): ContinuityItem[] {
  const now = input.now ?? Date.now();
  const { repairs, managerQueueItems, operatorQueueItems, dismissedIds } = input;

  const isDismissed = (id: string): boolean => {
    const ts = dismissedIds[id];
    return ts !== undefined && now - ts < DISMISS_TTL;
  };

  const candidates: ContinuityItem[] = [];

  const repairFollowup = buildRepairFollowup(repairs, operatorQueueItems, isDismissed, now);
  if (repairFollowup) candidates.push(repairFollowup);

  const approvalPending = buildApprovalPending(managerQueueItems, isDismissed, now);
  if (approvalPending) candidates.push(approvalPending);

  const outreachPending = buildOutreachPending(operatorQueueItems, isDismissed, now);
  if (outreachPending) candidates.push(outreachPending);

  const interrupted = buildInterruptedWorkflows(isDismissed, now);
  candidates.push(...interrupted);

  // Sort by age (oldest = most overdue = highest priority), then cap.
  return candidates
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, MAX_ITEMS);
}
