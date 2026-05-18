// R-OPERATOR-DAILY-BRIEF-V2
// Aggregates existing intelligence systems into one prioritized operator briefing.
// Reuses existing systems — no logic duplication. Pure reads, no side effects.

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { ActionPayload } from '../actions/actionEngine';
import { getCustomersMostLikelyToBuyToday } from '../opportunities/buyTodayRanking';
import type { Lang3 } from '../opportunities/buyTodayRanking';
import { generateOutreachCampaign } from '../outreach/generateOutreachCampaign';
import { getOutreachEffectiveness } from '../outreach/outreachEffectiveness';
import type { OutreachGroup } from '../outreach/outreachOutcomeTypes';
import { translations } from '@/i18n/translations';
// R-OCE-V1: risk/warning sections now sourced from the Operational Context Engine
import { buildOperationalContext } from '../oce/buildOperationalContext';
import { getSignalsByType } from '../oce/operationalContextQueries';
import { PRIORITY, URGENCY } from './priorityEngine';
import type { PriorityUrgency } from './priorityEngine';

export type BriefV2Section =
  | 'critical_actions'
  | 'revenue_opportunities'
  | 'customer_outreach'
  | 'risk_detection'
  | 'operational_warnings'
  | 'momentum_signals';

export interface BriefV2Item {
  id: string;
  section: BriefV2Section;
  text: string;
  urgency: PriorityUrgency;
  priority: number;
  action?: ActionPayload;
}

export interface DailyBriefV2Result {
  generatedAt: number;
  sections: Partial<Record<BriefV2Section, BriefV2Item[]>>;
  topActions: ActionPayload[];
}

const MAX_PER_SECTION = 3;
const MAX_ACTIONS = 5;

function tl(lang: Lang3, key: string, ...args: any[]): string {
  const entry = (translations as Record<string, any>)[key];
  if (!entry) return key;
  const v = entry[lang] ?? entry.en;
  return typeof v === 'function' ? v(...args) : String(v);
}

function groupLabel(lang: Lang3, group: OutreachGroup): string {
  const suffix =
    group === 'repair_ready'        ? 'repairReady'
    : group === 'payment_due'       ? 'paymentDue'
    : group === 'vip_inactive'      ? 'vipInactive'
    : group === 'high_value_inactive' ? 'highValueInactive'
    : group === 'recent_interest'   ? 'recentInterest'
    : 'missedRevenue';
  return tl(lang, `chat.outreachCampaign.group.${suffix}`);
}

export function generateDailyBriefV2(
  engine: IntelligenceEngine,
  lang: Lang3 = 'en',
): DailyBriefV2Result {
  const now = Date.now();
  const allItems: BriefV2Item[] = [];

  // ── 1. Today metrics — no sales = critical ────────────────────────────────
  try {
    const m = engine.getTodayMetrics();
    if (m && m.transactions === 0) {
      allItems.push({
        id: 'no-sales-today',
        section: 'critical_actions',
        text: tl(lang, 'chat.briefV2.item.noSalesToday'),
        urgency: URGENCY.NO_SALES_TODAY,
        priority: PRIORITY.NO_SALES_TODAY,
      });
    }
  } catch { /* skip — engine may not have today metrics */ }

  // ── 2. Buy-today candidates ───────────────────────────────────────────────
  const candidates = getCustomersMostLikelyToBuyToday(engine, lang);

  const repairReady  = candidates.filter((c) => c.opportunityType === 'repair_ready');
  const paymentDue   = candidates.filter((c) => c.opportunityType === 'payment_due');
  const revenueCands = candidates.filter(
    (c) => c.opportunityType !== 'repair_ready' && c.opportunityType !== 'payment_due',
  );

  if (repairReady.length > 0) {
    const top = repairReady[0];
    allItems.push({
      id: 'repair-ready',
      section: 'critical_actions',
      text: tl(lang, 'chat.briefV2.item.repairsReady', repairReady.length),
      urgency: URGENCY.REPAIR_READY_TODAY,
      priority: PRIORITY.REPAIR_READY_TODAY,
      ...(top.repairId ? {
        action: {
          type: 'review',
          entityId: top.repairId,
          executable: true,
          executionTarget: 'open_repair',
        } as ActionPayload,
      } : {}),
    });
  }

  if (paymentDue.length > 0) {
    const top = paymentDue[0];
    allItems.push({
      id: 'payment-due',
      section: 'critical_actions',
      text: tl(lang, 'chat.briefV2.item.paymentsOverdue', paymentDue.length),
      urgency: URGENCY.PAYMENT_OVERDUE,
      priority: PRIORITY.PAYMENT_OVERDUE,
      action: {
        type: 'review',
        entityId: top.customerId,
        customerId: top.customerId,
        customerName: top.customerName,
        executable: true,
        executionTarget: 'open_customer',
      } as ActionPayload,
    });
  }

  for (const c of revenueCands.slice(0, 2)) {
    const isVip = c.opportunityType === 'vip_outreach';
    const isHighValue = c.opportunityType === 'inactive_high_value';
    const priorityVal = isVip
      ? PRIORITY.VIP_INACTIVE
      : isHighValue
        ? PRIORITY.HIGH_VALUE_INACTIVE
        : c.opportunityType === 'recent_interest'
          ? PRIORITY.RECENT_INTEREST
          : PRIORITY.MISSED_REVENUE;
    const urgency: PriorityUrgency = isVip || isHighValue ? 'high' : 'medium';
    allItems.push({
      id: `revenue-${c.customerId}`,
      section: 'revenue_opportunities',
      text: tl(lang, 'chat.briefV2.item.contactCandidate', c.customerName),
      urgency,
      priority: priorityVal,
      action: {
        type: 'review',
        entityId: c.customerId,
        customerId: c.customerId,
        customerName: c.customerName,
        customerPhone: c.phone,
        executable: true,
        executionTarget: 'open_customer',
      } as ActionPayload,
    });
  }

  // ── 3. Outreach campaign contacts ─────────────────────────────────────────
  const campaign = generateOutreachCampaign(engine, lang);
  const totalOutreach = campaign.groups.reduce((s, g) => s + g.entries.length, 0);
  if (totalOutreach > 0) {
    allItems.push({
      id: 'outreach-contacts',
      section: 'customer_outreach',
      text: tl(lang, 'chat.briefV2.item.outreachContacts', totalOutreach),
      urgency: 'medium',
      priority: PRIORITY.OUTREACH_CONTACTS,
    });
  }

  // ── 4. Outreach effectiveness → momentum / risk signals ───────────────────
  const eff = getOutreachEffectiveness(30);
  if (eff.totalSent > 0) {
    const convPct = Math.round(eff.conversionRate * 100);
    const respPct = Math.round(eff.responseRate * 100);

    if (convPct >= 20) {
      allItems.push({
        id: 'outreach-momentum-good',
        section: 'momentum_signals',
        text: tl(lang, 'chat.briefV2.item.outreachConvertingWell', convPct),
        urgency: 'medium',
        priority: PRIORITY.OUTREACH_MOMENTUM,
      });
    } else if (eff.responseRate < 0.1) {
      allItems.push({
        id: 'outreach-response-low',
        section: 'risk_detection',
        text: tl(lang, 'chat.briefV2.item.outreachResponseLow', respPct),
        urgency: 'medium',
        priority: PRIORITY.OUTREACH_MOMENTUM,
      });
    }

    const groups = Object.values(eff.byGroup).filter((g) => g.sent > 0);
    if (groups.length >= 2) {
      const best  = groups.reduce((a, b) => b.conversionRate > a.conversionRate ? b : a);
      const worst = groups.reduce((a, b) => b.conversionRate < a.conversionRate ? b : a);
      if (best.conversionRate > 0.15) {
        allItems.push({
          id: `outreach-group-best`,
          section: 'momentum_signals',
          text: tl(lang, 'chat.briefV2.item.outreachGroupHigh',
            groupLabel(lang, best.group as OutreachGroup)),
          urgency: 'medium',
          priority: PRIORITY.OUTREACH_MOMENTUM + 1,
        });
      }
      if (worst !== best && worst.conversionRate === 0 && worst.sent >= 3) {
        allItems.push({
          id: `outreach-group-worst`,
          section: 'risk_detection',
          text: tl(lang, 'chat.briefV2.item.outreachGroupLow',
            groupLabel(lang, worst.group as OutreachGroup)),
          urgency: 'medium',
          priority: PRIORITY.OUTREACH_MOMENTUM + 2,
        });
      }
    }
  }

  // ── 5-7. OCE-driven: operational warnings + risk signals ─────────────────
  // Migration step 1: these sections now read from the Operational Context Engine
  // instead of calling engine methods directly. Output is identical.
  const oce = buildOperationalContext(engine);

  const staleSignals = getSignalsByType(oce, 'operational_warning');
  for (const sig of staleSignals.slice(0, 1)) {
    const n = (sig.metadata?.staleCount as number | undefined) ?? 1;
    allItems.push({
      id: 'stale-repairs',
      section: 'operational_warnings',
      text: tl(lang, 'chat.briefV2.item.staleRepairs', n),
      urgency: URGENCY.STALE_REPAIRS,
      priority: PRIORITY.STALE_REPAIRS,
    });
  }

  if (getSignalsByType(oce, 'slow_day').length > 0) {
    allItems.push({
      id: 'slow-day-risk',
      section: 'risk_detection',
      text: tl(lang, 'chat.briefV2.item.slowDay'),
      urgency: 'medium',
      priority: PRIORITY.SLOW_DAY_RISK,
    });
  }

  const deadSignals = getSignalsByType(oce, 'dead_stock');
  if (deadSignals.length > 0) {
    const count = (deadSignals[0].metadata?.count as number | undefined) ?? 0;
    if (count > 3) {
      allItems.push({
        id: 'dead-stock',
        section: 'risk_detection',
        text: tl(lang, 'chat.briefV2.item.deadStock', count),
        urgency: 'medium',
        priority: PRIORITY.DEAD_STOCK_RISK,
      });
    }
  }

  // ── Bucket into sections (sorted by priority, max MAX_PER_SECTION each) ───
  allItems.sort((a, b) => a.priority - b.priority);
  const sections: Partial<Record<BriefV2Section, BriefV2Item[]>> = {};
  const counts: Partial<Record<BriefV2Section, number>> = {};
  for (const item of allItems) {
    const c = counts[item.section] ?? 0;
    if (c >= MAX_PER_SECTION) continue;
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section]!.push(item);
    counts[item.section] = c + 1;
  }

  // ── Top actions (max MAX_ACTIONS) ─────────────────────────────────────────
  const topActions: ActionPayload[] = [];

  // WA for top eligible outreach candidate first
  const topOutreach = campaign.groups[0]?.entries[0];
  if (topOutreach && !topOutreach.recentlyContacted && topOutreach.phone) {
    const consent = engine.getCustomers().find((c) => c.id === topOutreach.customerId);
    if (consent?.communicationConsent !== false) {
      topActions.push({
        type: 'whatsapp',
        customMessage: topOutreach.waMessage,
        customerId: topOutreach.customerId,
        customerName: topOutreach.customerName,
        customerPhone: topOutreach.phone,
        executable: true,
        executionTarget: 'whatsapp_url',
      });
    }
  }

  // Then items with actions, priority-sorted
  for (const item of allItems) {
    if (!item.action) continue;
    if (topActions.length >= MAX_ACTIONS) break;
    // Avoid duplicate WA for the same customer we already added
    if (
      item.action.executionTarget === 'whatsapp_url' &&
      item.action.customerId === topOutreach?.customerId
    ) continue;
    topActions.push(item.action);
  }

  return { generatedAt: now, sections, topActions };
}
