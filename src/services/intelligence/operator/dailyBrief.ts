// R-INTELLIGENCE-DAILY-OPERATOR-BRIEF-V1
// Pure aggregator — composes existing engine signals + manager queue + feedback
// scoring into a single structured DailyOperatorBrief. No formatting, no I18n,
// no side effects beyond localStorage reads (manager queue + feedback store).
// Callers: handleDailyOperatorBrief in chat/handlers.ts.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { DailyOperatorBrief, DailyBriefPriority, DailyBriefSection } from '../types';
import { readQueue } from '../managerQueue/store';
import { getPendingItems, getQueueSummary } from '../managerQueue/selectors';
import { getFeedbackEvents } from '../feedback/store';
import { buildScoreMap } from '../feedback/scoring';

const PICKUP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

function parseTimestamp(value: unknown): number {
  if (!value) return 0;
  try {
    const d = typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : (value as string | Date);
    const ms = new Date(d as string | Date).getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch { return 0; }
}

export function generateDailyOperatorBrief(engine: IntelligenceEngine): DailyOperatorBrief {
  const now = Date.now();
  const priorities: DailyBriefPriority[] = [];
  const sections: DailyBriefSection[] = [];
  let recoverableRevenue = 0;
  let overdueRepairs = 0;
  let lowStockItems = 0;
  let inactiveVIPCustomers = 0;

  // ── Manager queue (highest authority — critical items surface first) ──────
  const feedbackEvents = getFeedbackEvents();
  const scoreMap = buildScoreMap(feedbackEvents);
  const queueItems = readQueue();
  const pendingItems = getPendingItems(queueItems, scoreMap);
  const queueSummary = getQueueSummary(queueItems, scoreMap);

  for (const item of pendingItems.filter(i => i.severity === 'critical').slice(0, 2)) {
    priorities.push({
      severity: 'critical',
      title: item.title,
      reason: item.description,
      recommendedAction: item.recommendedAction,
    });
  }
  for (const item of pendingItems.filter(i => i.severity === 'high').slice(0, 1)) {
    priorities.push({
      severity: 'high',
      title: item.title,
      reason: item.description,
      recommendedAction: item.recommendedAction,
    });
  }
  if (pendingItems.length > 0) {
    sections.push({
      title: 'Manager Review Queue',
      items: pendingItems.slice(0, 3).map(i => `[${i.severity.toUpperCase()}] ${i.title}`),
    });
  }

  // ── No sales today — always wins the top slot if true ────────────────────
  try {
    const m = engine.getTodayMetrics();
    if (m && m.transactions === 0) {
      priorities.unshift({
        severity: 'critical',
        title: 'No sales recorded today',
        reason: 'Zero transactions so far today.',
        recommendedAction: 'Ping recent customers, run a flash promo, or open with a demo.',
      });
    }
  } catch { /* skip */ }

  // ── Stale ready-repairs (> 3 days waiting for pickup) ────────────────────
  try {
    const repairs = engine.getRepairs();
    let staleCount = 0;
    let recoverable = 0;
    for (const r of repairs) {
      const status = String((r as { status?: string }).status || '').toLowerCase();
      if (status !== 'ready') continue;
      const ts = parseTimestamp((r as { completedAt?: unknown }).completedAt);
      if (ts === 0 || (now - ts) <= PICKUP_THRESHOLD_MS) continue;
      staleCount++;
      recoverable += (r as { balance?: number }).balance || 0;
    }
    if (staleCount > 0) {
      overdueRepairs = staleCount;
      recoverableRevenue += recoverable;
      priorities.push({
        severity: recoverable >= 10000 ? 'high' : 'medium',
        title: `${staleCount} repair${staleCount !== 1 ? 's' : ''} waiting pickup > 3 days`,
        reason: `$${(recoverable / 100).toFixed(2)} recoverable — not yet collected.`,
        recommendedAction: 'Call customers to schedule pickup.',
      });
    }
  } catch { /* skip */ }

  // ── Reorder recommendations ───────────────────────────────────────────────
  try {
    const reorders = engine.getReorderRecommendations();
    lowStockItems = reorders.length;
    const urgent = reorders.filter(r => r.priority === 'CRITICAL' || r.priority === 'HIGH');
    if (urgent.length > 0) {
      const top = urgent[0];
      priorities.push({
        severity: top.priority === 'CRITICAL' ? 'critical' : 'high',
        title: `Low stock: ${top.name}`,
        reason: `${top.daysLeft} day${top.daysLeft !== 1 ? 's' : ''} of inventory left at current velocity.`,
        recommendedAction: `Order ${top.suggestedOrderQty} units now.`,
      });
    }
    if (reorders.length > 0) {
      sections.push({
        title: 'Reorder Now',
        items: reorders.slice(0, 3).map(r =>
          `${r.name} — ${r.daysLeft}d of stock, order ${r.suggestedOrderQty}`),
      });
    }
  } catch { /* skip */ }

  // ── Dead stock locked ─────────────────────────────────────────────────────
  try {
    const missed = engine.getMissedRevenue();
    const dead = missed?.deadStockLockedCents ?? 0;
    if (dead >= 10000) {
      recoverableRevenue += dead;
      priorities.push({
        severity: 'medium',
        title: 'Dead stock capital locked',
        reason: `$${(dead / 100).toFixed(2)} tied up in unsold inventory.`,
        recommendedAction: 'Discount, bundle, or return slow-moving items.',
      });
    }
  } catch { /* skip */ }

  // ── Customer outreach queue ───────────────────────────────────────────────
  try {
    const outreach = engine.buildOutreachQueueItems();
    if (outreach.length >= 2) {
      priorities.push({
        severity: 'medium',
        title: `${outreach.length} customers due for outreach`,
        reason: 'High-value customers not seen in a while — contact window is open.',
        recommendedAction: 'Send WhatsApp messages to top-priority customers.',
      });
    }
    if (outreach.length > 0) {
      sections.push({
        title: 'Contact Today',
        items: outreach.slice(0, 3).map(o => o.reason || 'Customer outreach'),
      });
    }
  } catch { /* skip */ }

  // ── Product opportunities ─────────────────────────────────────────────────
  try {
    const opps = engine.getProductOpportunities(3);
    if (opps.length > 0) {
      sections.push({
        title: 'Product Opportunities',
        items: opps.map(o => `${o.name} — ${o.action} (${o.priority})`),
      });
    }
  } catch { /* skip */ }

  // ── Inactive VIP customers (platinum/gold with low risk score) ────────────
  try {
    const scores = engine.getCustomerScores();
    inactiveVIPCustomers = scores.filter(
      s => (s.tier === 'platinum' || s.tier === 'gold') && s.riskScore < 40,
    ).length;
  } catch { /* skip */ }

  // ── Sort: critical → high → medium ───────────────────────────────────────
  const SEV: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  priorities.sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3));

  const topPriority = priorities[0];

  // ── Summary line (English — diagnostic quality) ───────────────────────────
  const parts: string[] = [];
  if (queueSummary.critical > 0) parts.push(`${queueSummary.critical} critical queue item${queueSummary.critical !== 1 ? 's' : ''}`);
  if (overdueRepairs > 0) parts.push(`${overdueRepairs} stale repair${overdueRepairs !== 1 ? 's' : ''}`);
  if (lowStockItems > 0) parts.push(`${lowStockItems} low-stock alert${lowStockItems !== 1 ? 's' : ''}`);
  const summary = parts.length > 0 ? parts.join(', ') : 'Store looks stable today.';

  return {
    generatedAt: now,
    summary,
    topPriority,
    priorities: priorities.slice(0, 5),
    sections,
    recommendedNextAction: topPriority?.recommendedAction,
    metrics: {
      pendingQueueItems: queueSummary.totalPending,
      criticalQueueItems: queueSummary.critical,
      recoverableRevenue,
      overdueRepairs,
      inactiveVIPCustomers,
      lowStockItems,
    },
  };
}
