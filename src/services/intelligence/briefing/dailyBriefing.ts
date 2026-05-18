// ============================================================
// CellHub Intelligence — Daily Operations Briefing
// R-INTELLIGENCE-DAILY-BRIEFING-V1
//
// Deterministic, compact, operational. Summarizes the most
// important business conditions at the start of a session.
// Max 5 items, prioritized by severity.
//
// Tone: purely factual — no conversational AI prose.
// Good: "3 repairs delayed over 5 days"
// Bad:  "Hey! Looks like things are a bit slow today 😊"
//
// Data sources: all existing systems — no new analytics.
// ============================================================

import { isDoneRepairStatus, normalizeRepairStatus } from '@/utils/repairStatus';
import type { StoreStateResult } from '../storeState/storeStateEngine';
import type { ProactiveMission } from '../proactive/proactiveMissions';
import type { ContinuityItem } from '../continuity/continuityEngine';
import type { OperatorQueueItem } from '../operatorQueue/operatorQueue';
import type { ManagerQueueItem } from '../managerQueue/types';
// R-INTELLIGENCE-MERGE-BRIEFING-SYSTEMS-V1: canonical envelope
import type { IntelligenceBrief, BriefItem, BriefSeverity } from './briefingTypes';
import { sortBriefItems, severityToPriority } from './briefingHelpers';

// ── Types ─────────────────────────────────────────────────

export type BriefingSeverity = 'info' | 'attention' | 'urgent';

export type BriefingCategory =
  | 'sales_rhythm'
  | 'repairs'
  | 'customer_opportunities'
  | 'collections'
  | 'operational_continuity';

export interface BriefingItem {
  id: string;
  category: BriefingCategory;
  severity: BriefingSeverity;
  summary: string;
  supportingMetric?: string;
  suggestedAction?: string;
}

export interface DailyBriefingResult {
  generatedAt: number;
  tone: 'operational';
  items: BriefingItem[];
  topPriority?: BriefingItem;
  recommendedFocus?: string;
}

// ── Loose input types ─────────────────────────────────────

interface RepairLike {
  id: string;
  status: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  balance?: number;
}

interface LayawayLike {
  status?: string;
  balance?: number;
}

interface SaleLike {
  status?: string;
  createdAt?: unknown;
  total?: number;
}

export interface BriefingInput {
  storeState: StoreStateResult;
  repairs: RepairLike[];
  layaways: LayawayLike[];
  sales: SaleLike[];
  missions: ProactiveMission[];
  continuityItems: ContinuityItem[];
  pendingQueueTasks: OperatorQueueItem[];
  managerQueueItems: ManagerQueueItem[];
  lang: 'en' | 'es' | 'pt';
  now?: number;
}

// ── Helpers ───────────────────────────────────────────────

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

const SEV_RANK: Record<BriefingSeverity, number> = { urgent: 0, attention: 1, info: 2 };

// ── Category builders ─────────────────────────────────────

function buildSalesRhythm(
  storeState: StoreStateResult,
  sales: SaleLike[],
  lang: 'en' | 'es' | 'pt',
  now: number,
): BriefingItem | null {
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const hour = new Date(now).getHours();

  const todayCount = sales.filter(
    (s) => s.status !== 'voided' && toMs(s.createdAt) >= todayMs,
  ).length;

  if (storeState.state === 'rush_mode') {
    const lastHour = sales.filter(
      (s) => s.status !== 'voided' && toMs(s.createdAt) >= now - 3_600_000,
    ).length;
    const summary =
      lang === 'es' ? `Actividad elevada — ${lastHour} transacciones en la última hora`
      : lang === 'pt' ? `Atividade elevada — ${lastHour} transações na última hora`
      : `Elevated activity — ${lastHour} transactions in the last hour`;
    return { id: 'sales:rush', category: 'sales_rhythm', severity: 'attention', summary, supportingMetric: `${lastHour}` };
  }

  if (storeState.state === 'slow_day') {
    if (todayCount === 0 && hour >= 12) {
      const summary =
        lang === 'es' ? 'Sin ventas registradas hoy pasado el mediodía'
        : lang === 'pt' ? 'Sem vendas registradas hoje após o meio-dia'
        : 'No sales recorded today past midday';
      return { id: 'sales:zero', category: 'sales_rhythm', severity: 'urgent', summary };
    }
    const summary =
      lang === 'es' ? `${todayCount} venta${todayCount !== 1 ? 's' : ''} hoy — ritmo por debajo de lo esperado`
      : lang === 'pt' ? `${todayCount} venda${todayCount !== 1 ? 's' : ''} hoje — ritmo abaixo do esperado`
      : `${todayCount} sale${todayCount !== 1 ? 's' : ''} today — below expected pace`;
    return { id: 'sales:slow', category: 'sales_rhythm', severity: 'attention', summary, supportingMetric: `${todayCount}` };
  }

  return null;
}

function buildRepairItems(
  repairs: RepairLike[],
  lang: 'en' | 'es' | 'pt',
  now: number,
): BriefingItem[] {
  const items: BriefingItem[] = [];
  const DAY = 86_400_000;

  const active = repairs.filter((r) => !isDoneRepairStatus(r.status));
  const delayed = active.filter((r) => {
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 5 * DAY;
  });

  if (delayed.length > 0) {
    const N = delayed.length;
    const sev: BriefingSeverity = N >= 5 ? 'urgent' : 'attention';
    const summary =
      lang === 'es'
        ? N === 1
          ? '1 reparación activa con más de 5 días de retraso'
          : `${N} reparaciones activas con más de 5 días de retraso`
        : lang === 'pt'
        ? `${N} reparo${N !== 1 ? 's' : ''} ativo${N !== 1 ? 's' : ''} com mais de 5 dias de atraso`
        : `${N} active repair${N !== 1 ? 's' : ''} delayed over 5 days`;
    items.push({ id: 'repair:delayed', category: 'repairs', severity: sev, summary, supportingMetric: `${N}` });
  }

  const readyOld = repairs.filter((r) => {
    if (normalizeRepairStatus(r.status) !== 'ready') return false;
    const ts = toMs(r.updatedAt) || toMs(r.createdAt);
    return ts > 0 && now - ts >= 2 * DAY;
  });

  if (readyOld.length > 0) {
    const N = readyOld.length;
    const summary =
      lang === 'es'
        ? N === 1
          ? '1 reparación lista — cliente sin avisar'
          : `${N} reparaciones listas — clientes sin avisar`
        : lang === 'pt'
        ? `${N} reparo${N !== 1 ? 's' : ''} pronto${N !== 1 ? 's' : ''} — cliente${N !== 1 ? 's' : ''} não notificado${N !== 1 ? 's' : ''}`
        : `${N} repair${N !== 1 ? 's' : ''} ready — customer${N !== 1 ? 's' : ''} not yet notified`;
    items.push({ id: 'repair:ready', category: 'repairs', severity: 'attention', summary, supportingMetric: `${N}` });
  }

  return items;
}

function buildCollections(
  repairs: RepairLike[],
  layaways: LayawayLike[],
  lang: 'en' | 'es' | 'pt',
): BriefingItem | null {
  const unpaidRepairs = repairs.filter(
    (r) => isDoneRepairStatus(r.status) && (r.balance || 0) > 0,
  );
  const unpaidLayaways = layaways.filter(
    (l) => !['completed', 'cancelled', 'forfeited'].includes(l.status ?? '') && (l.balance || 0) > 0,
  );
  const totalCents =
    unpaidRepairs.reduce((s, r) => s + (r.balance || 0), 0) +
    unpaidLayaways.reduce((s, l) => s + (l.balance || 0), 0);

  if (totalCents <= 0) return null;

  const count = unpaidRepairs.length + unpaidLayaways.length;
  const dollars = Math.round(totalCents / 100);
  const sev: BriefingSeverity = totalCents >= 50_000 ? 'urgent' : totalCents >= 10_000 ? 'attention' : 'info';

  const summary =
    lang === 'es'
      ? count === 1
        ? `1 saldo pendiente por cobrar — $${dollars} en total`
        : `${count} saldos pendientes por cobrar — $${dollars} en total`
      : lang === 'pt'
      ? `${count} saldo${count !== 1 ? 's' : ''} pendente${count !== 1 ? 's' : ''} — $${dollars} no total`
      : `${count} unpaid balance${count !== 1 ? 's' : ''} pending — $${dollars} total`;

  return { id: 'collections:unpaid', category: 'collections', severity: sev, summary, supportingMetric: `$${dollars}` };
}

const OUTREACH_TYPES = new Set(['recover_customer', 'vip_outreach']);

function buildCustomerOpportunities(
  storeState: StoreStateResult,
  missions: ProactiveMission[],
  pendingQueueTasks: OperatorQueueItem[],
  lang: 'en' | 'es' | 'pt',
): BriefingItem | null {
  // Suppress during rush — operator is busy processing transactions
  if (storeState.state === 'rush_mode') return null;

  const outreachMissions = missions.filter((m) => OUTREACH_TYPES.has(m.type));
  const outreachTasks    = pendingQueueTasks.filter((t) => OUTREACH_TYPES.has(t.type));

  const N = Math.max(outreachMissions.length, outreachTasks.length);
  if (N === 0) return null;

  const sev: BriefingSeverity = N >= 2 ? 'attention' : 'info';
  const summary =
    lang === 'es'
      ? N === 1
        ? '1 cliente de alto valor disponible para contactar'
        : `${N} clientes de alto valor disponibles para contactar`
      : lang === 'pt'
      ? `${N} cliente${N !== 1 ? 's' : ''} de alto valor disponíve${N !== 1 ? 'is' : 'l'} para contato`
      : `${N} high-value customer${N !== 1 ? 's' : ''} available for outreach`;

  return { id: 'customer:outreach', category: 'customer_opportunities', severity: sev, summary, supportingMetric: `${N}` };
}

function buildContinuityItem(
  continuityItems: ContinuityItem[],
  managerQueueItems: ManagerQueueItem[],
  lang: 'en' | 'es' | 'pt',
  now: number,
): BriefingItem | null {
  const hasRepairFollowup = continuityItems.some((i) => i.type === 'repair_followup_pending');
  const staleApprovals = managerQueueItems.filter(
    (i) => i.status === 'pending' && now - i.createdAt >= 24 * 3600_000,
  ).length;

  // Combine continuity count with stale approval count for total "pending attention" signal.
  // continuityItems already includes approval_pending type if applicable,
  // so use the larger of the two to avoid double-counting.
  const total = Math.max(continuityItems.length, staleApprovals);
  if (total === 0) return null;

  const sev: BriefingSeverity = hasRepairFollowup || staleApprovals >= 2 ? 'attention' : 'info';
  const summary =
    lang === 'es'
      ? total === 1
        ? '1 flujo de trabajo pendiente de seguimiento'
        : `${total} flujos de trabajo pendientes de seguimiento`
      : lang === 'pt'
      ? `${total} fluxo${total !== 1 ? 's' : ''} aguardando acompanhamento`
      : `${total} workflow${total !== 1 ? 's' : ''} awaiting follow-up`;

  return { id: 'continuity:pending', category: 'operational_continuity', severity: sev, summary, supportingMetric: `${total}` };
}

// ── Main export ───────────────────────────────────────────

const MAX_ITEMS = 5;

export function generateDailyBriefing(input: BriefingInput): DailyBriefingResult {
  const now = input.now ?? Date.now();
  const { storeState, repairs, layaways, sales, missions, continuityItems, pendingQueueTasks, managerQueueItems, lang } = input;

  const candidates: BriefingItem[] = [];

  const salesItem = buildSalesRhythm(storeState, sales, lang, now);
  if (salesItem) candidates.push(salesItem);

  const repairItems = buildRepairItems(repairs, lang, now);
  candidates.push(...repairItems);

  const collectionItem = buildCollections(repairs, layaways, lang);
  if (collectionItem) candidates.push(collectionItem);

  const customerItem = buildCustomerOpportunities(storeState, missions, pendingQueueTasks, lang);
  if (customerItem) candidates.push(customerItem);

  const continuityItem = buildContinuityItem(continuityItems, managerQueueItems, lang, now);
  if (continuityItem) candidates.push(continuityItem);

  // Sort: urgent first, then attention, then info. Same severity → original order.
  const items = candidates
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
    .slice(0, MAX_ITEMS);

  const topPriority = items[0];

  return {
    generatedAt: now,
    tone: 'operational',
    items,
    topPriority,
    recommendedFocus: storeState.recommendedFocus,
  };
}

// ── Canonical adapter (R-INTELLIGENCE-MERGE-BRIEFING-SYSTEMS-V1) ──────────────

// Maps this file's 3-level severity to the canonical 5-level scale.
// urgent → critical (90): operator must act now
// attention → medium (50): should handle today
// info → info (10): informational only
const BRIEFING_SEV: Record<BriefingSeverity, BriefSeverity> = {
  urgent:    'critical',
  attention: 'medium',
  info:      'info',
};

// Maps this file's 5 categories to canonical BriefItemCategory values.
const BRIEFING_CAT: Record<BriefingCategory, BriefItem['category']> = {
  sales_rhythm:             'sales',
  repairs:                  'repairs',
  customer_opportunities:   'customers',
  collections:              'collections',
  operational_continuity:   'continuity',
};

/**
 * Runs generateDailyBriefing() and wraps the result in an IntelligenceBrief
 * envelope for cross-system aggregation.
 *
 * generateDailyBriefing() is unchanged — this is a parallel read path only.
 * Consumers that need the original DailyBriefingResult should call that directly.
 */
export function generateDailyBriefAsCanonical(input: BriefingInput): IntelligenceBrief {
  const result = generateDailyBriefing(input);
  const detectedAt = result.generatedAt;
  const items: BriefItem[] = result.items.map((item): BriefItem => {
    const severity = BRIEFING_SEV[item.severity];
    return {
      id: `brief:daily_briefing:${item.id}`,
      category: BRIEFING_CAT[item.category],
      severity,
      priority: severityToPriority(severity),
      title: item.summary,
      summary: item.supportingMetric,
      suggestedAction: item.suggestedAction,
      source: 'daily_briefing',
      detectedAt,
    };
  });
  const sorted = sortBriefItems(items);
  return {
    generatedAt: detectedAt,
    items: sorted,
    topPriority: sorted[0],
    sources: ['daily_briefing'],
  };
}
