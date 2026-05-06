// R-INTEL-PHASE4.0-QUEUE: Automation Queue Foundation
// Pure data layer — no storage, no execution, no side effects.
// Callers own persistence and execution decisions.

import type { ActionPayload } from '../actions/actionEngine';

export type AutomationStatus =
  | 'pending'
  | 'approved'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type AutomationKind =
  | 'whatsapp_reconnect'
  | 'discount_review'
  | 'bundle_review'
  | 'reminder_followup'
  | 'manual_review'
  // R-INTELLIGENCE-PENDING-DEAL-V1: owner-mediated deal draft. Approval opens
  // WhatsApp with the deal's offer text; outcome marked manually by owner.
  | 'pending_deal';

export interface AutomationExecutionLog {
  executedAt: string;
  result: 'success' | 'failed';
  resultType?: string;
  reason?: string;
}

export type AutomationOutcome =
  | 'unknown'
  | 'customer_responded'
  | 'sale_created'
  | 'no_response'
  | 'not_relevant';

export interface AutomationOutcomeLog {
  recordedAt: string;
  outcome: AutomationOutcome;
  note?: string;
}

export interface AutomationQueueItem {
  id: string;
  kind: AutomationKind;
  status: AutomationStatus;

  label: string;
  source: 'intelligence';

  customerId?: string;
  customerName?: string;
  sku?: string;

  createdAt: string;
  approvedAt?: string;
  completedAt?: string;

  payload?: {
    actionPayload?: ActionPayload;
    [key: string]: unknown;
  };

  executionLog?: AutomationExecutionLog[];
  outcomeLog?: AutomationOutcomeLog[];
}

export function createAutomationItem(input: {
  kind: AutomationKind;
  label: string;
  customerId?: string;
  customerName?: string;
  sku?: string;
  payload?: { actionPayload?: ActionPayload; [key: string]: unknown };
}): AutomationQueueItem {
  return {
    id: `auto-${input.kind}-${Date.now()}`,
    kind: input.kind,
    status: 'pending',
    label: input.label,
    source: 'intelligence',
    customerId: input.customerId,
    customerName: input.customerName,
    sku: input.sku,
    createdAt: new Date().toISOString(),
    payload: input.payload,
  };
}

export function approveAutomationItem(item: AutomationQueueItem): AutomationQueueItem {
  return { ...item, status: 'approved', approvedAt: new Date().toISOString() };
}

export function completeAutomationItem(item: AutomationQueueItem): AutomationQueueItem {
  return { ...item, status: 'completed', completedAt: new Date().toISOString() };
}

export function cancelAutomationItem(item: AutomationQueueItem): AutomationQueueItem {
  return { ...item, status: 'cancelled' };
}

export function failAutomationItem(item: AutomationQueueItem): AutomationQueueItem {
  return { ...item, status: 'failed' };
}

export function addAutomationExecutionLog(
  item: AutomationQueueItem,
  log: AutomationExecutionLog,
): AutomationQueueItem {
  return { ...item, executionLog: [...(item.executionLog ?? []), log] };
}

export function markAutomationExecuted(
  item: AutomationQueueItem,
  resultType: string,
): AutomationQueueItem {
  return completeAutomationItem(
    addAutomationExecutionLog(item, {
      executedAt: new Date().toISOString(),
      result: 'success',
      resultType,
    }),
  );
}

export function markAutomationFailed(
  item: AutomationQueueItem,
  reason: string,
): AutomationQueueItem {
  return failAutomationItem(
    addAutomationExecutionLog(item, {
      executedAt: new Date().toISOString(),
      result: 'failed',
      reason,
    }),
  );
}

export function addAutomationOutcome(
  item: AutomationQueueItem,
  outcome: AutomationOutcome,
  note?: string,
): AutomationQueueItem {
  return {
    ...item,
    outcomeLog: [
      ...(item.outcomeLog ?? []),
      { recordedAt: new Date().toISOString(), outcome, note },
    ],
  };
}

// R-INTELLIGENCE-DEAL-OUTCOME-TRACKING-V1 ─────────────────────
// Owner-recorded outcome for a pending_deal after WhatsApp outreach.
// Pure read/write helpers around localStorage — no UI, no engine wiring,
// no automatic learning. Mirrors the executionLog pattern in
// actionExecutor.ts (FIFO cap, best-effort writes, never blocks).

export type DealOutcome = 'won' | 'lost' | 'no_response';

export interface DealOutcomeLogEntry {
  id: string;
  dealId: string;
  customerId?: string;
  inventoryId?: string;
  category?: string;
  proposedPriceCents: number;
  originalPriceCents: number;
  outcome: DealOutcome;
  timestamp: number;
}

const DEAL_OUTCOME_LOG_KEY = 'cellhub:intelligence:dealOutcomeLog:v1';
const MAX_DEAL_OUTCOME_LOG = 500;

export function getDealOutcomeLog(): DealOutcomeLogEntry[] {
  try {
    const raw = localStorage.getItem(DEAL_OUTCOME_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// R-INTELLIGENCE-PROPOSAL-FOLLOWUP-INBOX-V1 ────────────────────
// Tracks proposals/promotions sent via manual WhatsApp so the owner
// can manage follow-ups even though there's no WhatsApp API. Pure
// localStorage write/read; no scraping, no auto-send, no inbound
// listener. Status is owner-recorded.

export type ProposalFollowupStatus =
  | 'sent'
  | 'replied'
  | 'interested'
  | 'won'
  | 'lost'
  | 'no_response';

export interface ProposalFollowup {
  id: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  productName?: string;
  proposedPriceCents?: number;
  sourceActionId?: string;
  status: ProposalFollowupStatus;
  sentAt: number;
  lastReplyText?: string;
  lastReplyAt?: number;
}

const PROPOSAL_FOLLOWUP_KEY = 'cellhub:intelligence:proposalFollowups:v1';
const MAX_PROPOSAL_FOLLOWUPS = 300;

export function getProposalFollowups(): ProposalFollowup[] {
  try {
    const raw = localStorage.getItem(PROPOSAL_FOLLOWUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addProposalFollowup(entry: ProposalFollowup): void {
  try {
    const list = getProposalFollowups();
    list.push(entry);
    const trimmed = list.length > MAX_PROPOSAL_FOLLOWUPS
      ? list.slice(list.length - MAX_PROPOSAL_FOLLOWUPS)
      : list;
    localStorage.setItem(PROPOSAL_FOLLOWUP_KEY, JSON.stringify(trimmed));
  } catch {
    /* incognito / quota — best-effort, never block */
  }
}

export function updateProposalFollowup(
  id: string,
  patch: Partial<ProposalFollowup>,
): void {
  try {
    const list = getProposalFollowups();
    const idx = list.findIndex((f) => f.id === id);
    if (idx === -1) return;
    list[idx] = { ...list[idx], ...patch };
    localStorage.setItem(PROPOSAL_FOLLOWUP_KEY, JSON.stringify(list));
  } catch {
    /* skip */
  }
}

// Find the most recent OPEN follow-up that matches by customer name
// or phone. Open = status not in (won, lost, no_response). Phone is
// the strongest signal; name fallback uses substring + first-name
// match. Pure read; no mutation.
export function findOpenFollowupByCustomerOrProduct(
  customerName?: string,
  customerPhone?: string,
): ProposalFollowup | null {
  const list = getProposalFollowups();
  const open = list.filter(
    (f) => f.status !== 'won' && f.status !== 'lost' && f.status !== 'no_response',
  );
  if (open.length === 0) return null;

  const normalizePhone = (p: string) => (p || '').replace(/\D/g, '');
  const targetPhone = normalizePhone(customerPhone || '');
  const targetName = (customerName || '').toLowerCase().trim();

  let best: ProposalFollowup | null = null;
  let bestScore = 0;
  for (const f of open) {
    let score = 0;
    if (targetPhone && f.customerPhone) {
      const fp = normalizePhone(f.customerPhone);
      if (fp === targetPhone) score = 100;
      else if (fp && (fp.endsWith(targetPhone) || targetPhone.endsWith(fp))) score = 50;
    }
    if (targetName && f.customerName) {
      const fn = f.customerName.toLowerCase().trim();
      if (fn === targetName) score = Math.max(score, 80);
      else {
        const firstWord = fn.split(' ')[0];
        if (firstWord && (firstWord === targetName || targetName.startsWith(firstWord))) {
          score = Math.max(score, 60);
        } else if (fn.includes(targetName) || targetName.includes(fn)) {
          score = Math.max(score, 40);
        }
      }
    }
    if (score > bestScore || (score > 0 && score === bestScore && f.sentAt > (best?.sentAt || 0))) {
      best = f;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export function addDealOutcomeLog(entry: DealOutcomeLogEntry): void {
  try {
    const log = getDealOutcomeLog();
    log.push(entry);
    // FIFO cap — drop oldest entries if exceeding MAX. Same shape as
    // executionLog so unbounded outcome history doesn't bloat storage.
    const trimmed = log.length > MAX_DEAL_OUTCOME_LOG
      ? log.slice(log.length - MAX_DEAL_OUTCOME_LOG)
      : log;
    localStorage.setItem(DEAL_OUTCOME_LOG_KEY, JSON.stringify(trimmed));
  } catch {
    /* incognito / quota — best-effort, never block */
  }
}

// R-INTELLIGENCE-DEAL-PERFORMANCE-INSIGHTS-V1 ─────────────────
// Deterministic aggregation over the dealOutcomeLog. Pure read — no
// mutation, no side effects, no UI. Called on demand by the chat handler
// (no background work). Discount range bins follow the spec exactly:
// 0-10, 11-20, 21-30, 31+.

export interface DealPerformanceResult {
  totalDeals: number;
  won: number;
  lost: number;
  noResponse: number;
  winRate: number;            // 0..1
  avgDiscountPercent: number; // 0..100 (integer)
  bestCategory?: { category: string; wins: number };
  bestDiscountRange?: { range: '0-10' | '11-20' | '21-30' | '31+'; winRate: number; sample: number };
}

export function getDealPerformance(): DealPerformanceResult {
  // Defensive read-side cap: the writer already FIFO-trims at 500, but a
  // future migration or direct localStorage import could bypass that cap.
  // Always analyze only the most recent MAX_DEAL_OUTCOME_LOG entries so
  // this stays O(500) even if the underlying array grew.
  const raw = getDealOutcomeLog();
  const log = raw.length > MAX_DEAL_OUTCOME_LOG
    ? raw.slice(raw.length - MAX_DEAL_OUTCOME_LOG)
    : raw;
  const totalDeals = log.length;

  let won = 0, lost = 0, noResponse = 0;
  let totalDiscountPct = 0;

  const catWins = new Map<string, number>();
  type RangeId = '0-10' | '11-20' | '21-30' | '31+';
  const rangeStats: Record<RangeId, { won: number; total: number }> = {
    '0-10':  { won: 0, total: 0 },
    '11-20': { won: 0, total: 0 },
    '21-30': { won: 0, total: 0 },
    '31+':   { won: 0, total: 0 },
  };
  const bucketFor = (pct: number): RangeId => {
    if (pct <= 10) return '0-10';
    if (pct <= 20) return '11-20';
    if (pct <= 30) return '21-30';
    return '31+';
  };

  for (const entry of log) {
    if (entry.outcome === 'won') won++;
    else if (entry.outcome === 'lost') lost++;
    else if (entry.outcome === 'no_response') noResponse++;

    const discountPct = entry.originalPriceCents > 0
      ? Math.round(((entry.originalPriceCents - entry.proposedPriceCents) / entry.originalPriceCents) * 100)
      : 0;
    totalDiscountPct += discountPct;

    if (entry.outcome === 'won' && entry.category) {
      catWins.set(entry.category, (catWins.get(entry.category) || 0) + 1);
    }

    const bucket = bucketFor(discountPct);
    rangeStats[bucket].total++;
    if (entry.outcome === 'won') rangeStats[bucket].won++;
  }

  const winRate = totalDeals > 0 ? won / totalDeals : 0;
  const avgDiscountPercent = totalDeals > 0 ? Math.round(totalDiscountPct / totalDeals) : 0;

  // Best category by absolute wins. Tie-break: first-seen (Map iteration order).
  let bestCategory: { category: string; wins: number } | undefined;
  for (const [cat, wins] of catWins) {
    if (!bestCategory || wins > bestCategory.wins) bestCategory = { category: cat, wins };
  }

  // Best discount range by win rate. Require sample >= 2 to avoid 1-deal noise.
  let bestDiscountRange: DealPerformanceResult['bestDiscountRange'];
  for (const id of Object.keys(rangeStats) as RangeId[]) {
    const s = rangeStats[id];
    if (s.total < 2) continue;
    const rate = s.won / s.total;
    if (!bestDiscountRange || rate > bestDiscountRange.winRate) {
      bestDiscountRange = { range: id, winRate: rate, sample: s.total };
    }
  }

  return { totalDeals, won, lost, noResponse, winRate, avgDiscountPercent, bestCategory, bestDiscountRange };
}
