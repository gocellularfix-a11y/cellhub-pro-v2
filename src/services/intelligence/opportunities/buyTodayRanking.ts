// R-INTELLIGENCE-BUY-TODAY-RANKING-V1
// Multi-signal buyer ranking: repair-ready + outstanding balance + VIP tier
// + inactive-high-value + outreach queue + recent activity.
//
// Rules:
// - Deterministic only — same data → same ranking, no randomness
// - No AI / no embeddings / no LLM memory
// - Reuses engine signals (customerScores, repairs, buildOutreachQueueItems)
// - Max 5 results, deduped by customerId, scores merged per customer
// - Does NOT import from chat/handlers.ts (avoids circular dep)

import type { IntelligenceEngine } from '../IntelligenceEngine';
import { translations } from '@/i18n/translations';

export type Lang3 = 'en' | 'es' | 'pt';

export interface BuyTodayCandidate {
  customerId: string;
  customerName: string;
  phone: string;
  score: number;
  reasons: string[];
  opportunityType:
    | 'repair_ready'
    | 'payment_due'
    | 'vip_outreach'
    | 'inactive_high_value'
    | 'missed_revenue'
    | 'recent_interest';
  repairId?: string;
}

const MAX_RESULTS = 5;
const INACTIVE_THRESHOLD_DAYS = 30;
const RECENT_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 86_400_000;

// Priority order for opportunityType — lower index wins when merging signals.
const TYPE_PRIORITY: BuyTodayCandidate['opportunityType'][] = [
  'repair_ready', 'payment_due', 'inactive_high_value', 'vip_outreach', 'missed_revenue', 'recent_interest',
];

// Inline translation helper (mirrors tChat in handlers.ts — no circular dep).
function tl(lang: Lang3, key: string, ...args: any[]): string {
  const entry = translations[key];
  if (!entry) return key;
  const value = entry[lang] ?? entry.en;
  return typeof value === 'function' ? value(...args) : String(value);
}

type AccEntry = {
  customerName: string;
  phone: string;
  score: number;
  reasonSet: Set<string>;
  opportunityType: BuyTodayCandidate['opportunityType'];
  repairId?: string;
};

function mergeSignal(
  acc: Map<string, AccEntry>,
  customerId: string,
  name: string,
  phone: string,
  points: number,
  reason: string,
  type: BuyTodayCandidate['opportunityType'],
  repairId?: string,
): void {
  const existing = acc.get(customerId);
  if (existing) {
    existing.score += points;
    existing.reasonSet.add(reason);
    if (repairId && !existing.repairId) existing.repairId = repairId;
    // upgrade type if new one has higher priority
    if (TYPE_PRIORITY.indexOf(type) < TYPE_PRIORITY.indexOf(existing.opportunityType)) {
      existing.opportunityType = type;
    }
  } else {
    acc.set(customerId, {
      customerName: name,
      phone,
      score: points,
      reasonSet: new Set([reason]),
      opportunityType: type,
      ...(repairId ? { repairId } : {}),
    });
  }
}

export function getCustomersMostLikelyToBuyToday(
  engine: IntelligenceEngine,
  lang: Lang3 = 'en',
): BuyTodayCandidate[] {
  const acc = new Map<string, AccEntry>();
  const now = Date.now();

  // O(1) customer lookup by id.
  const customerMap = new Map(engine.getCustomers().map((c) => [c.id, c]));

  // ── Signal 1: repair_ready (+45) ─────────────────────────────────────────
  // Device is done — customer must come in. Highest-confidence signal.
  try {
    for (const r of engine.getRepairs()) {
      const status = String(r.status || '').toLowerCase();
      if (status !== 'ready' && status !== 'completed' && status !== 'done') continue;
      const cid = (r.customerId || '').trim();
      if (!cid || !customerMap.has(cid)) continue;
      const c = customerMap.get(cid)!;
      mergeSignal(
        acc, cid, c.name, c.phone || '', 45,
        tl(lang, 'chat.buyToday.reason.repairReady'),
        'repair_ready', r.id,
      );
    }
  } catch { /* skip on engine data gap */ }

  // Pre-fetch scored customers (engine.refresh() is cached — O(1) after first call).
  const scores = engine.getCustomerScores();

  // ── Compute high-value threshold (75th pct gross revenue) ────────────────
  // Mirrors buildOutreachQueueItems logic. Used by inactive_high_value signal.
  let highValueThreshold = 0;
  if (scores.length > 0) {
    const revs: number[] = [];
    for (const cs of scores) {
      const h = engine.getCustomerHistory(cs.customerId);
      if (h) revs.push(h.grossRevenue);
    }
    revs.sort((a, b) => a - b);
    const q3 = Math.max(0, Math.floor(revs.length * 0.75));
    highValueThreshold = revs[q3] ?? 0;
  }

  // ── Signals 2–4 + 6: iterate scored customers ─────────────────────────────
  // getCustomerHistory is cached after first call per customer — O(1) per hit.
  for (const cs of scores) {
    const cid = cs.customerId;
    const c = customerMap.get(cid);
    if (!c) continue;
    const h = engine.getCustomerHistory(cid);

    // Signal 2 — payment_due (+35): outstanding balance on any service.
    if (h && (h.linkedEntities?.activeBalance ?? 0) > 0) {
      mergeSignal(
        acc, cid, c.name, c.phone || '', 35,
        tl(lang, 'chat.buyToday.reason.balanceDue'),
        'payment_due',
      );
    }

    // Signal 3 — vip_outreach (+25): platinum or gold tier.
    if (cs.tier === 'platinum' || cs.tier === 'gold') {
      mergeSignal(
        acc, cid, c.name, c.phone || '', 25,
        tl(lang, 'chat.buyToday.reason.vipCustomer'),
        'vip_outreach',
      );
    }

    // Signal 4 — inactive_high_value (+30): high-spend, not visited recently.
    if (h && h.lastVisit && h.grossRevenue >= highValueThreshold && highValueThreshold > 0) {
      const daysSince = Math.floor((now - h.lastVisit.getTime()) / MS_PER_DAY);
      if (daysSince >= INACTIVE_THRESHOLD_DAYS) {
        mergeSignal(
          acc, cid, c.name, c.phone || '', 30,
          tl(lang, 'chat.buyToday.reason.inactiveHighValue', daysSince),
          'inactive_high_value',
        );
      }
    }

    // Signal 6 — recent_interest (+10): visited within last 7 days.
    if (h && h.lastVisit) {
      const daysSince = Math.floor((now - h.lastVisit.getTime()) / MS_PER_DAY);
      if (daysSince >= 0 && daysSince <= RECENT_THRESHOLD_DAYS) {
        mergeSignal(
          acc, cid, c.name, c.phone || '', 10,
          tl(lang, 'chat.buyToday.reason.recentActivity', daysSince),
          'recent_interest',
        );
      }
    }
  }

  // ── Signal 5 — missed_revenue (+20): in consent-filtered outreach queue ───
  try {
    for (const item of engine.buildOutreachQueueItems()) {
      const cid = (item.customerId ?? '').trim();
      if (!cid || !customerMap.has(cid)) continue;
      const c = customerMap.get(cid)!;
      mergeSignal(
        acc, cid, c.name, item.phone || c.phone || '', 20,
        tl(lang, 'chat.buyToday.reason.outreach'),
        'missed_revenue',
      );
    }
  } catch { /* skip */ }

  // ── Build final result ────────────────────────────────────────────────────
  return Array.from(acc.entries())
    .map(([customerId, e]): BuyTodayCandidate => ({
      customerId,
      customerName: e.customerName,
      phone: e.phone,
      score: e.score,
      reasons: Array.from(e.reasonSet),
      opportunityType: e.opportunityType,
      ...(e.repairId ? { repairId: e.repairId } : {}),
    }))
    .filter((c) => !!c.customerId && !!c.customerName)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}
