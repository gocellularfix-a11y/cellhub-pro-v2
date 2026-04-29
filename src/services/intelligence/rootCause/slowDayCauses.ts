// R-INTEL-PHASE2B-RC: slow day root cause detector
// Uses last 30 days of sales grouped by day of week.
// Compares slowest DOW vs best DOW to classify as traffic,
// ticket, or mixed problem. Returns null if insufficient data.
import type { Sale } from '@/store/types';
import type { SlowDayRootCauseReport, ActionItem } from '../types';
import { getDaysAgo } from '../utils/dateHelpers';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DowStats {
  revenue: number;
  txCount: number;
  occurrences: number;   // distinct calendar days with ≥1 sale for this DOW
}

const TRAFFIC_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.rootCause.action.slowDayPromo',     effort: 'medium', priority: 1, actionType: 'review' },
  { labelKey: 'chat.rootCause.action.contactOverdue',   effort: 'low',    priority: 2, actionType: 'whatsapp', messageTemplateKey: 'whatsapp.template.reconnect' },
  { labelKey: 'chat.rootCause.action.promoteTopSeller', effort: 'low',    priority: 3, actionType: 'review' },
];

const TICKET_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.rootCause.action.upsellPrompt',         effort: 'low',    priority: 1, actionType: 'review' },
  { labelKey: 'chat.rootCause.action.bundleAccessories',     effort: 'medium', priority: 2, actionType: 'bundle' },
  { labelKey: 'chat.rootCause.action.highMarginProducts',    effort: 'low',    priority: 3, actionType: 'review' },
];

const MIXED_ACTIONS: ActionItem[] = [
  { labelKey: 'chat.rootCause.action.slowDayPromo',   effort: 'medium', priority: 1, actionType: 'review' },
  { labelKey: 'chat.rootCause.action.upsellPrompt',   effort: 'low',    priority: 2, actionType: 'review' },
  { labelKey: 'chat.rootCause.action.contactOverdue', effort: 'low',    priority: 3, actionType: 'whatsapp', messageTemplateKey: 'whatsapp.template.reconnect' },
];

// Confidence reaches 1.0 when the slowest day has appeared ≥4 times.
const CONFIDENCE_WEEKS = 4;

export function diagnoseSlowDay(sales: Sale[]): SlowDayRootCauseReport | null {
  const since30 = getDaysAgo(30);
  const recent = sales.filter(
    s => s.status !== 'voided' && new Date(s.createdAt as string) >= since30,
  );

  if (recent.length < 5) return null;

  // Build per-DOW stats
  const byDow: Record<number, DowStats> = {};
  for (let d = 0; d < 7; d++) byDow[d] = { revenue: 0, txCount: 0, occurrences: 0 };

  const datesPerDow: Record<number, Set<string>> = {};
  for (let d = 0; d < 7; d++) datesPerDow[d] = new Set();

  for (const sale of recent) {
    const dt  = new Date(sale.createdAt as string);
    const dow = dt.getDay();
    byDow[dow].revenue  += sale.total || 0;
    byDow[dow].txCount  += 1;
    datesPerDow[dow].add(dt.toISOString().slice(0, 10));
  }

  for (let d = 0; d < 7; d++) byDow[d].occurrences = datesPerDow[d].size;

  // Only consider DOWs that actually appeared in the window
  const active = Object.entries(byDow)
    .filter(([, s]) => s.occurrences > 0)
    .map(([dow, s]) => {
      const occ = s.occurrences;
      const avgRev    = Math.round(s.revenue / occ);
      const avgTx     = s.txCount / occ;
      const avgTicket = s.txCount > 0 ? Math.round(s.revenue / s.txCount) : 0;
      return { dow: Number(dow), occ, avgRev, avgTx, avgTicket };
    });

  if (active.length < 2) return null;

  const slowest = active.reduce((a, b) => a.avgRev < b.avgRev ? a : b);
  const best    = active.reduce((a, b) => a.avgRev > b.avgRev ? a : b);

  if (slowest.dow === best.dow) return null;

  const txDiffPct = best.avgTx > 0
    ? Math.max(0, Math.round((1 - slowest.avgTx / best.avgTx) * 100))
    : 0;
  const ticketDiffPct = best.avgTicket > 0
    ? Math.max(0, Math.round((1 - slowest.avgTicket / best.avgTicket) * 100))
    : 0;

  // Thresholds: ≥20% tx gap = traffic problem; ≥15% ticket gap = ticket problem
  const txDown     = txDiffPct     >= 20;
  const ticketDown = ticketDiffPct >= 15;

  let diagnosis: 'traffic' | 'ticket' | 'mixed';
  let actions: ActionItem[];

  if (txDown && ticketDown) {
    diagnosis = 'mixed';
    actions = MIXED_ACTIONS;
  } else if (txDown) {
    diagnosis = 'traffic';
    actions = TRAFFIC_ACTIONS;
  } else {
    diagnosis = 'ticket';
    actions = TICKET_ACTIONS;
  }

  return {
    slowestDayName:         DAY_NAMES[slowest.dow],
    bestDayName:            DAY_NAMES[best.dow],
    slowestDayIndex:        slowest.dow,
    bestDayIndex:           best.dow,
    slowDayRevenueCents:    slowest.avgRev,
    bestDayRevenueCents:    best.avgRev,
    weeklyGapCents:         best.avgRev - slowest.avgRev,
    slowDayTxCount:         Math.round(slowest.avgTx),
    bestDayTxCount:         Math.round(best.avgTx),
    slowDayAvgTicketCents:  slowest.avgTicket,
    bestDayAvgTicketCents:  best.avgTicket,
    txDiffPct,
    ticketDiffPct,
    diagnosis,
    confidence: Math.min(1, slowest.occ / CONFIDENCE_WEEKS),
    actions,
  };
}
