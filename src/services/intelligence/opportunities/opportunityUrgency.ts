// R-INTELLIGENCE-OPPORTUNITY-URGENCY-ENGINE-V1
// Deterministic urgency modifiers layered on top of buyTodayRanking base scores.
//
// Rules:
// - Pure — no I/O, no AI, no embeddings, no side effects
// - Does NOT import from buyTodayRanking.ts — uses inline duck type to avoid circular dep
// - Clamps adjustedScore to >= 0 (never negative)
// - Urgency reasons are prepended; base reasons stay unchanged (merging is caller's job)

import type { IntelligenceEngine } from '../IntelligenceEngine';
import { translations } from '@/i18n/translations';
import { hasRecentOperatorAction } from '../history/operatorActionHistory';

export type Lang3 = 'en' | 'es' | 'pt';

export interface OpportunityUrgencyResult {
  adjustedScore: number;
  urgencyReasons: string[];
  urgencyLevel?: 'urgent' | 'active';
}

// Minimal duck type — avoids importing BuyTodayCandidate (circular dep).
interface UrgencyCandidate {
  customerId: string;
  opportunityType: string;
  repairId?: string;
  score: number;
}

const MS_PER_DAY = 86_400_000;
const MS_24H = 86_400_000;
const MS_6H  = 21_600_000;

function tsToMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'object' && val !== null && 'toDate' in val) {
    try { return (val as { toDate(): Date }).toDate().getTime(); } catch { return 0; }
  }
  const n = Number(val);
  if (!isNaN(n) && n > 1_000_000_000_000) return n;
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function tl(lang: Lang3, key: string, ...args: any[]): string {
  const entry = (translations as Record<string, any>)[key];
  if (!entry) return key;
  const value = entry[lang] ?? entry.en;
  return typeof value === 'function' ? value(...args) : String(value);
}

export function applyOpportunityUrgency(
  candidate: UrgencyCandidate,
  engine: IntelligenceEngine,
  lang: Lang3 = 'en',
): OpportunityUrgencyResult {
  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  let delta = 0;
  const urgencyReasons: string[] = [];
  let urgencyLevel: 'urgent' | 'active' | undefined;

  const h = engine.getCustomerHistory(candidate.customerId);

  // Modifier 1: Same-day repair ready (+20) — device completed today.
  if (candidate.repairId) {
    const repair = engine.getRepairs().find((r) => r.id === candidate.repairId);
    if (repair) {
      const completedMs = tsToMs(repair.completedAt) || tsToMs(repair.updatedAt);
      if (completedMs >= todayMs) {
        delta += 20;
        urgencyReasons.push(tl(lang, 'chat.buyToday.reason.repairToday'));
        urgencyLevel = 'urgent';
      }
    }
  }

  // Modifier 2: Very recent activity (0-2 days) (+15) — customer was just here.
  if (h?.lastVisit) {
    const daysSince = Math.floor((now - h.lastVisit.getTime()) / MS_PER_DAY);
    if (daysSince >= 0 && daysSince <= 2) {
      delta += 15;
      urgencyReasons.push(tl(lang, 'chat.buyToday.reason.recentlyActive'));
      if (!urgencyLevel) urgencyLevel = 'active';
    }
  }

  // Modifier 3: Outreach stale escalation (+10) — in outreach queue, follow-up due.
  if (candidate.opportunityType === 'missed_revenue') {
    delta += 10;
    urgencyReasons.push(tl(lang, 'chat.buyToday.reason.followUpOverdue'));
  }

  // Modifier 4: Payment overdue (+15) — has balance AND hasn't visited in > 7 days.
  if (h && (h.linkedEntities?.activeBalance ?? 0) > 0 && h.lastVisit) {
    const daysSince = Math.floor((now - h.lastVisit.getTime()) / MS_PER_DAY);
    if (daysSince > 7) {
      delta += 15;
      urgencyReasons.push(tl(lang, 'chat.buyToday.reason.paymentOverdue'));
      urgencyLevel = 'urgent';
    }
  }

  // Modifier 5: Stale decay (>45 days) (-15) — opportunity cooling, never below zero.
  if (h?.lastVisit) {
    const daysSince = Math.floor((now - h.lastVisit.getTime()) / MS_PER_DAY);
    if (daysSince > 45) {
      delta -= 15;
      urgencyReasons.push(tl(lang, 'chat.buyToday.reason.opportunityCooling'));
    }
  }

  // ── Operator action penalties ─────────────────────────────────────────────
  // Reduce ranking when operator has already acted on this customer recently
  // so the engine does not keep recommending the same person blindly.

  // Penalty 1: WhatsApp sent within 24h (-35).
  if (hasRecentOperatorAction(candidate.customerId, 'whatsapp', MS_24H)) {
    delta -= 35;
    urgencyReasons.push(tl(lang, 'chat.buyToday.reason.alreadyContacted'));
  }

  // Penalty 2: Customer record opened within 6h (-10).
  if (hasRecentOperatorAction(candidate.customerId, 'open_customer', MS_6H)) {
    delta -= 10;
    urgencyReasons.push(tl(lang, 'chat.buyToday.reason.recentlyReviewed'));
  }

  // Penalty 3: Marked completed within 24h (-50).
  if (hasRecentOperatorAction(candidate.customerId, 'completed', MS_24H)) {
    delta -= 50;
    urgencyReasons.push(tl(lang, 'chat.buyToday.reason.alreadyHandled'));
  }

  return {
    adjustedScore: Math.max(0, candidate.score + delta),
    urgencyReasons,
    ...(urgencyLevel ? { urgencyLevel } : {}),
  };
}
