// R-INTEL-PHASE2-RC: revenue decline root cause detector
// Compares last 7 days vs prior 7 days and classifies the decline
// as a traffic problem, ticket problem, or both.
// Returns null when revenue is not down or prior-period data is absent.
import type { Sale } from '@/store/types';
import type { RootCauseReport, ActionItem, RevenueDiagnosis } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';

function revenueSum(sales: Sale[]): number {
  return sales
    .filter(s => s.status !== 'voided')
    .reduce((sum, s) => sum + (s.total || 0), 0);
}

function txCount(sales: Sale[]): number {
  return sales.filter(s => s.status !== 'voided').length;
}

function sliceWindow(sales: Sale[], from: Date, to: Date): Sale[] {
  return sales.filter(s => {
    const t = new Date(s.createdAt as string).getTime();
    return t >= from.getTime() && t < to.getTime();
  });
}

const TRAFFIC_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.rootCause.action.contactOverdue',   effort: 'low',    priority: 1 },
  { labelKey: 'chat.rootCause.action.slowDayPromo',     effort: 'medium', priority: 2 },
  { labelKey: 'chat.rootCause.action.promoteTopSeller', effort: 'low',    priority: 3 },
];

const TICKET_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.rootCause.action.upsellPrompt',         effort: 'low',    priority: 1 },
  { labelKey: 'chat.rootCause.action.highMarginProducts',    effort: 'low',    priority: 2 },
  { labelKey: 'chat.rootCause.action.bundleAccessories',     effort: 'medium', priority: 3 },
];

const BOTH_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.rootCause.action.contactOverdue', effort: 'low',    priority: 1 },
  { labelKey: 'chat.rootCause.action.upsellPrompt',   effort: 'low',    priority: 2 },
  { labelKey: 'chat.rootCause.action.slowDayPromo',   effort: 'medium', priority: 3 },
];

// Confidence reaches 1.0 at 20 total transactions across both windows.
const CONFIDENCE_SAMPLE = 20;

export function diagnoseRevenueDecline(sales: Sale[]): RootCauseReport | null {
  const now = new Date();
  const d7  = getDaysAgo(7);
  const d14 = getDaysAgo(14);

  const curr = sliceWindow(sales, d7, now);
  const prev = sliceWindow(sales, d14, d7);

  const revCurrent  = revenueSum(curr);
  const revPrevious = revenueSum(prev);
  const txCurrent   = txCount(curr);
  const txPrevious  = txCount(prev);

  // Revenue not down or no prior-period data
  if (revPrevious === 0 || revCurrent >= revPrevious) return null;

  const avgTicketCurrent  = txCurrent  > 0 ? Math.round(revCurrent  / txCurrent)  : 0;
  const avgTicketPrevious = txPrevious > 0 ? Math.round(revPrevious / txPrevious) : 0;

  const txDropPct = txPrevious > 0
    ? Math.max(0, Math.round((1 - txCurrent / txPrevious) * 100))
    : 0;
  const ticketDropPct = avgTicketPrevious > 0
    ? Math.max(0, Math.round((1 - avgTicketCurrent / avgTicketPrevious) * 100))
    : 0;

  // ≥15% traffic drop = traffic problem; ≥10% ticket drop = ticket problem
  const txDown     = txDropPct     >= 15;
  const ticketDown = ticketDropPct >= 10;

  let diagnosis: RevenueDiagnosis;
  let actions: ActionItem[];

  if (txDown && ticketDown) {
    diagnosis = 'both';
    actions = BOTH_ACTIONS;
  } else if (txDown) {
    diagnosis = 'traffic';
    actions = TRAFFIC_ACTIONS;
  } else {
    diagnosis = 'ticket';
    actions = TICKET_ACTIONS;
  }

  return {
    triggerKind: 'revenue_decline',
    diagnosis,
    revCurrentCents:        revCurrent,
    revPreviousCents:       revPrevious,
    txCurrent,
    txPrevious,
    avgTicketCurrentCents:  avgTicketCurrent,
    avgTicketPreviousCents: avgTicketPrevious,
    revDropCents:           revPrevious - revCurrent,
    txDropPct,
    ticketDropPct,
    confidence: Math.min(1, (txCurrent + txPrevious) / CONFIDENCE_SAMPLE),
    actions,
  };
}
