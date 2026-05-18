// R-OUTREACH-OUTCOME-FEEDBACK-V1
// Deterministic effectiveness metrics from recorded outcome events.
// Pure reads — no side effects, no mutation.

import { getRecentOutreachOutcomes } from './outreachOutcomeStore';
import type { OutreachGroup } from './outreachOutcomeTypes';
import { translations } from '@/i18n/translations';

export type Lang3 = 'en' | 'es' | 'pt';

function tl(lang: Lang3, key: string, ...args: any[]): string {
  const entry = (translations as Record<string, any>)[key];
  if (!entry) return key;
  const value = entry[lang] ?? entry.en;
  return typeof value === 'function' ? value(...args) : String(value);
}

export interface OutreachEffectivenessMetrics {
  totalSent: number;
  totalReplied: number;
  totalConverted: number;
  totalIgnored: number;
  responseRate: number;
  conversionRate: number;
  byGroup: Record<OutreachGroup, GroupEffectiveness>;
}

export interface GroupEffectiveness {
  group: OutreachGroup;
  sent: number;
  replied: number;
  converted: number;
  ignored: number;
  responseRate: number;
  conversionRate: number;
}

const CONVERSION_OUTCOMES = new Set([
  'payment_collected',
  'repair_picked_up',
  'sale_completed',
  'visited_store',
]);

const ALL_GROUPS: OutreachGroup[] = [
  'repair_ready',
  'payment_due',
  'vip_inactive',
  'high_value_inactive',
  'recent_interest',
  'missed_revenue',
];

export function getOutreachEffectiveness(days = 30): OutreachEffectivenessMetrics {
  const events = getRecentOutreachOutcomes(days);

  const byGroup: Record<OutreachGroup, GroupEffectiveness> = {} as Record<OutreachGroup, GroupEffectiveness>;
  for (const g of ALL_GROUPS) {
    byGroup[g] = { group: g, sent: 0, replied: 0, converted: 0, ignored: 0, responseRate: 0, conversionRate: 0 };
  }

  let totalSent = 0;
  let totalReplied = 0;
  let totalConverted = 0;
  let totalIgnored = 0;

  for (const e of events) {
    const g = e.outreachGroup as OutreachGroup;
    if (!byGroup[g]) continue;

    byGroup[g].sent++;
    totalSent++;

    if (e.outcome === 'sent') {
      // sent events counted above, no further bucket
    } else if (e.outcome === 'replied') {
      byGroup[g].replied++;
      totalReplied++;
    } else if (CONVERSION_OUTCOMES.has(e.outcome)) {
      byGroup[g].converted++;
      totalConverted++;
    } else if (e.outcome === 'ignored') {
      byGroup[g].ignored++;
      totalIgnored++;
    }
  }

  for (const g of ALL_GROUPS) {
    const gb = byGroup[g];
    gb.responseRate = gb.sent > 0 ? gb.replied / gb.sent : 0;
    gb.conversionRate = gb.sent > 0 ? gb.converted / gb.sent : 0;
  }

  return {
    totalSent,
    totalReplied,
    totalConverted,
    totalIgnored,
    responseRate: totalSent > 0 ? totalReplied / totalSent : 0,
    conversionRate: totalSent > 0 ? totalConverted / totalSent : 0,
    byGroup,
  };
}

export function getGroupEffectiveness(
  group: OutreachGroup,
  days = 30,
): GroupEffectiveness {
  return getOutreachEffectiveness(days).byGroup[group];
}

export function getOutreachPerformanceSummary(lang: Lang3 = 'en', days = 30): string {
  const m = getOutreachEffectiveness(days);

  if (m.totalSent === 0) {
    return tl(lang, 'chat.outreachPerf.noDataYet');
  }

  const lines: string[] = [];
  lines.push(tl(lang, 'chat.outreachPerf.header', days));
  lines.push(
    tl(lang, 'chat.outreachPerf.statsLine',
      m.totalSent,
      Math.round(m.responseRate * 100),
      Math.round(m.conversionRate * 100),
    ),
  );

  const activeGroups = ALL_GROUPS.filter((g) => m.byGroup[g].sent > 0);
  for (const g of activeGroups) {
    const gb = m.byGroup[g];
    lines.push(
      tl(lang, 'chat.outreachPerf.groupLine',
        tl(lang, `chat.outreachCampaign.group.${groupLabelSuffix(g)}`),
        gb.sent,
        Math.round(gb.conversionRate * 100),
      ),
    );
  }

  lines.push(tl(lang, 'chat.outreachPerf.summary', m.totalConverted, m.totalIgnored));
  return lines.join('\n');
}

function groupLabelSuffix(g: OutreachGroup): string {
  switch (g) {
    case 'repair_ready':        return 'repairReady';
    case 'payment_due':         return 'paymentDue';
    case 'vip_inactive':        return 'vipInactive';
    case 'high_value_inactive': return 'highValueInactive';
    case 'recent_interest':     return 'recentInterest';
    case 'missed_revenue':      return 'missedRevenue';
  }
}
