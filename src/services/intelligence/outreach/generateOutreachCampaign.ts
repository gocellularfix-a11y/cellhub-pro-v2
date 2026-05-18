// R-SMART-OUTREACH-CAMPAIGN-V1
// Deterministic outreach campaign engine.
//
// Rules:
//   - Deterministic only — same data → same campaign, no randomness
//   - No AI / no LLM / no embeddings
//   - Dedupes by customerId — each customer in at most one group (best signal wins)
//   - Excludes customers without phone (no actionable channel)
//   - 24h cooldown via intelligenceExecutionHistory — score reduced on recently-WA'd customers
//   - Source candidates come from buyTodayRanking (MAX_RESULTS = 5)
//   - Does NOT import from chat/handlers.ts (avoids circular dep)

import type { IntelligenceEngine } from '../IntelligenceEngine';
import { getCustomersMostLikelyToBuyToday } from '../opportunities/buyTodayRanking';
import type { Lang3 } from '../opportunities/buyTodayRanking';
import { hasRecentIntelligenceExecution } from '../execution/intelligenceExecutionHistory';
import { translations } from '@/i18n/translations';
import type { OutreachGroup } from './outreachOutcomeTypes';
export type { OutreachGroup };

export interface OutreachCampaignEntry {
  customerId: string;
  customerName: string;
  phone: string;
  score: number;
  reasons: string[];
  urgencyLevel?: 'urgent' | 'active';
  repairId?: string;
  waMessage: string;
  recentlyContacted: boolean;
}

export interface OutreachCampaignGroup {
  group: OutreachGroup;
  groupLabelKey: string;
  priority: number;
  entries: OutreachCampaignEntry[];
}

export interface OutreachCampaignResult {
  generatedAt: number;
  totalCandidates: number;
  groups: OutreachCampaignGroup[];
}

export type { Lang3 };

const OUTREACH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const GROUP_PRIORITY: Record<OutreachGroup, number> = {
  repair_ready:        1,
  payment_due:         2,
  vip_inactive:        3,
  high_value_inactive: 4,
  recent_interest:     5,
  missed_revenue:      6,
};

const GROUP_LABEL_KEY: Record<OutreachGroup, string> = {
  repair_ready:        'chat.outreachCampaign.group.repairReady',
  payment_due:         'chat.outreachCampaign.group.paymentDue',
  vip_inactive:        'chat.outreachCampaign.group.vipInactive',
  high_value_inactive: 'chat.outreachCampaign.group.highValueInactive',
  recent_interest:     'chat.outreachCampaign.group.recentInterest',
  missed_revenue:      'chat.outreachCampaign.group.missedRevenue',
};

const MSG_KEY: Record<OutreachGroup, string> = {
  repair_ready:        'chat.outreachCampaign.msg.repairReady',
  payment_due:         'chat.outreachCampaign.msg.paymentDue',
  vip_inactive:        'chat.outreachCampaign.msg.vipInactive',
  high_value_inactive: 'chat.outreachCampaign.msg.highValueInactive',
  recent_interest:     'chat.outreachCampaign.msg.recentInterest',
  missed_revenue:      'chat.outreachCampaign.msg.missedRevenue',
};

// Inline translation helper — mirrors tChat in handlers.ts to avoid circular dep.
function tl(lang: Lang3, key: string, ...args: any[]): string {
  const entry = translations[key];
  if (!entry) return key;
  const value = entry[lang] ?? entry.en;
  return typeof value === 'function' ? value(...args) : String(value);
}

function mapToGroup(opportunityType: string): OutreachGroup {
  switch (opportunityType) {
    case 'repair_ready':        return 'repair_ready';
    case 'payment_due':         return 'payment_due';
    case 'vip_outreach':        return 'vip_inactive';
    case 'inactive_high_value': return 'high_value_inactive';
    case 'recent_interest':     return 'recent_interest';
    default:                    return 'missed_revenue';
  }
}

export function generateOutreachCampaign(
  engine: IntelligenceEngine,
  lang: Lang3 = 'en',
): OutreachCampaignResult {
  const now = Date.now();
  const candidates = getCustomersMostLikelyToBuyToday(engine, lang);

  const groupMap = new Map<OutreachGroup, OutreachCampaignEntry[]>();
  const seenCustomers = new Set<string>();

  for (const c of candidates) {
    if (seenCustomers.has(c.customerId)) continue;
    if (!c.phone) continue;

    seenCustomers.add(c.customerId);

    const group = mapToGroup(c.opportunityType);
    const firstName = c.customerName.split(' ')[0] || c.customerName;
    const recentlyContacted = hasRecentIntelligenceExecution(
      c.customerId, 'whatsapp', OUTREACH_COOLDOWN_MS,
    );

    const entry: OutreachCampaignEntry = {
      customerId: c.customerId,
      customerName: c.customerName,
      phone: c.phone,
      score: recentlyContacted ? Math.floor(c.score * 0.3) : c.score,
      reasons: c.reasons,
      ...(c.urgencyLevel ? { urgencyLevel: c.urgencyLevel } : {}),
      ...(c.repairId ? { repairId: c.repairId } : {}),
      waMessage: tl(lang, MSG_KEY[group], firstName),
      recentlyContacted,
    };

    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(entry);
  }

  const groups: OutreachCampaignGroup[] = Array.from(groupMap.entries())
    .map(([group, entries]) => ({
      group,
      groupLabelKey: GROUP_LABEL_KEY[group],
      priority: GROUP_PRIORITY[group],
      entries: entries.sort((a, b) => b.score - a.score),
    }))
    .sort((a, b) => a.priority - b.priority);

  return { generatedAt: now, totalCandidates: seenCustomers.size, groups };
}
