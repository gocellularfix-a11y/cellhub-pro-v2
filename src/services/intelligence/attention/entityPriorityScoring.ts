// R-INTELLIGENCE-WHO-NEEDS-ATTENTION-RIGHT-NOW-V1
// Pure deterministic per-entity urgency scoring. No I/O, no side effects.
// All impure reads (engine, execution history, queue, pipeline) live in
// entityPriorityEngine.ts.
//
// Thresholds deliberately share the same semantic values used elsewhere
// (staleRepairScanner: 3d pickup, dailyBriefing: 5d delayed) but are
// defined locally — those files do not export their constants.

import { isDoneRepairStatus, normalizeRepairStatus } from '@/utils/repairStatus';
import type {
  AttentionItem,
  AttentionUrgency,
  AttentionSignalType,
  AttentionAction,
} from './entityPriorityTypes';

type Lang3 = 'en' | 'es' | 'pt';

const DAY_MS = 86_400_000;
const STALE_PICKUP_MS    = 3  * DAY_MS;
const DELAYED_REPAIR_MS  = 5  * DAY_MS;
const ABANDONED_LAY_MS   = 14 * DAY_MS;
const VIP_INACTIVE_DAYS  = 30;

// ── Shared helpers ────────────────────────────────────────────

export function toMs(val: unknown): number {
  if (!val) return 0;
  try {
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().getTime();
    }
    const t = new Date(val as string | Date).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

export function urgencyFromScore(score: number): AttentionUrgency {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// ── Duck types ────────────────────────────────────────────────
// Minimal shapes — avoids importing @/store/types in a pure scoring file.
// Real Repair/Layaway/ManagerQueueItem objects satisfy these structurally.

interface RepairLike {
  id: string;
  status: unknown;
  balance?: number;
  completedAt?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
  customerName?: string;
}

interface LayawayLike {
  id: string;
  status?: string;
  balance?: number;
  customerName?: string;
  updatedAt?: unknown;
  createdAt?: unknown;
}

interface ApprovalLike {
  id: string;
  status: string;
  severity: string;
  title: string;
  createdAt: number;
}

// ── Repair scoring ────────────────────────────────────────────
// Detects: stale pickup (ready + completedAt > 3d), delayed active repair
// (not done + updatedAt > 5d), unpaid completed repair (done + balance > 0).
// Returns the highest-priority signal only (one item per repair).

export function scoreRepairForAttention(
  repair: RepairLike,
  lang: Lang3,
  now: number,
): AttentionItem | null {
  const status = normalizeRepairStatus(repair.status);
  const isDone = isDoneRepairStatus(repair.status);
  const signals: AttentionSignalType[] = [];
  let score = 0;
  let reason = '';
  let action = '';
  let actions: AttentionAction[] | undefined;

  const openAction: AttentionAction = {
    label: lang === 'es' ? 'Ver reparación' : lang === 'pt' ? 'Ver reparo' : 'Open repair',
    actionType: 'open_repair',
    payload: { repairId: repair.id },
  };

  if (status === 'ready') {
    const ts = toMs(repair.completedAt) || toMs(repair.updatedAt);
    if (ts > 0 && now - ts >= STALE_PICKUP_MS) {
      const days = Math.floor((now - ts) / DAY_MS);
      signals.push('stale_pickup');
      score = Math.min(60 + days * 5, 90);
      reason =
        lang === 'es' ? `Reparación lista ${days}d sin recoger`
        : lang === 'pt' ? `Reparo pronto há ${days}d sem retirada`
        : `Ready repair not picked up for ${days}d`;
      action =
        lang === 'es' ? 'Notificar al cliente hoy'
        : lang === 'pt' ? 'Notificar o cliente hoje'
        : 'Notify customer today';
      actions = [openAction];
    }
  } else if (!isDone) {
    const ts = toMs(repair.updatedAt) || toMs(repair.createdAt);
    if (ts > 0 && now - ts >= DELAYED_REPAIR_MS) {
      const days = Math.floor((now - ts) / DAY_MS);
      signals.push('delayed_repair');
      score = Math.min(50 + days * 4, 85);
      reason =
        lang === 'es' ? `Reparación activa sin actualizar en ${days}d`
        : lang === 'pt' ? `Reparo ativo sem atualização há ${days}d`
        : `Active repair stalled for ${days}d`;
      action =
        lang === 'es' ? 'Actualizar estado o contactar al cliente'
        : lang === 'pt' ? 'Atualizar status ou contatar cliente'
        : 'Update status or contact customer';
      actions = [openAction];
    }
  } else if (isDone && (repair.balance ?? 0) > 0) {
    const dollars = Math.round((repair.balance ?? 0) / 100);
    signals.push('unpaid_repair');
    score = Math.min(40 + dollars, 80);
    reason =
      lang === 'es' ? `Reparación entregada con saldo de $${dollars}`
      : lang === 'pt' ? `Reparo entregue com saldo de $${dollars}`
      : `Completed repair with $${dollars} unpaid balance`;
    action =
      lang === 'es' ? 'Cobrar el saldo pendiente'
      : lang === 'pt' ? 'Cobrar saldo pendente'
      : 'Collect outstanding balance';
    actions = [openAction];
  }

  if (signals.length === 0) return null;

  return {
    id: `attn:repair:${repair.id}:${signals[0]}`,
    entityType: 'repair',
    entityId: repair.id,
    entityName: repair.customerName as string | undefined,
    reason,
    urgency: urgencyFromScore(score),
    urgencyScore: score,
    confidence: 'high',
    estimatedValueCents: (repair.balance ?? 0) > 0 ? repair.balance : undefined,
    recommendedAction: action,
    sourceSignals: signals,
    actions,
  };
}

// ── Layaway scoring ───────────────────────────────────────────
// Detects: abandoned layaway (active status + no activity > 14d).

const LAYAWAY_TERMINAL = new Set(['completed', 'cancelled', 'forfeited']);

export function scoreLayawayForAttention(
  layaway: LayawayLike,
  lang: Lang3,
  now: number,
): AttentionItem | null {
  if (LAYAWAY_TERMINAL.has(layaway.status ?? '')) return null;
  const ts = toMs(layaway.updatedAt) || toMs(layaway.createdAt);
  if (!ts || now - ts < ABANDONED_LAY_MS) return null;

  const days = Math.floor((now - ts) / DAY_MS);
  const score = Math.min(45 + days * 2, 80);
  const reason =
    lang === 'es' ? `Apartado sin actividad en ${days}d`
    : lang === 'pt' ? `Consignação sem atividade há ${days}d`
    : `Layaway inactive for ${days}d`;
  const action =
    lang === 'es' ? 'Contactar al cliente para retomar el apartado'
    : lang === 'pt' ? 'Contatar cliente para retomar consignação'
    : 'Contact customer to resume layaway';

  return {
    id: `attn:layaway:${layaway.id}:abandoned_layaway`,
    entityType: 'layaway',
    entityId: layaway.id,
    entityName: layaway.customerName,
    reason,
    urgency: urgencyFromScore(score),
    urgencyScore: score,
    confidence: 'medium',
    estimatedValueCents: (layaway.balance ?? 0) > 0 ? layaway.balance : undefined,
    recommendedAction: action,
    sourceSignals: ['abandoned_layaway'],
    actions: [
      {
        label: lang === 'es' ? 'Ver apartado' : lang === 'pt' ? 'Ver consignação' : 'Open layaway',
        actionType: 'open_layaway',
        payload: { layawayId: layaway.id },
      },
    ],
  };
}

// ── Deal scoring ──────────────────────────────────────────────
// Accepts a pre-computed score from closeTodayRanker.scoreDealsForCloseToday.
// Maps the ranker's 0–170 scale to the 40–90 attention range.
// Only includes deals scoring >= 50 on the ranker's scale.

export function scoreDealForAttention(
  dealScore: number,
  deal: {
    id: string;
    customerName?: string;
    customerId?: string;
    proposedPriceCents?: number;
    stage: string;
  },
  lang: Lang3,
): AttentionItem | null {
  if (dealScore < 50) return null;
  // Clamp ranker score (50–170) into attention range (40–90).
  const score = Math.min(Math.round(40 + ((dealScore - 50) / 120) * 50), 90);
  const reason =
    lang === 'es' ? `Deal "${deal.stage}" — listo para cerrar`
    : lang === 'pt' ? `Deal "${deal.stage}" — pronto para fechar`
    : `Deal in "${deal.stage}" — ready to close`;
  const action =
    lang === 'es' ? 'Hacer seguimiento para cerrar hoy'
    : lang === 'pt' ? 'Fazer acompanhamento para fechar hoje'
    : 'Follow up to close today';

  const acts: AttentionAction[] = [];
  if (deal.customerId) {
    acts.push({
      label: lang === 'es' ? 'Ver cliente' : lang === 'pt' ? 'Ver cliente' : 'Open customer',
      actionType: 'open_customer',
      payload: { customerId: deal.customerId },
    });
  }

  return {
    id: `attn:deal:${deal.id}:hot_deal`,
    entityType: 'deal',
    entityId: deal.id,
    entityName: deal.customerName,
    reason,
    urgency: urgencyFromScore(score),
    urgencyScore: score,
    confidence: dealScore >= 80 ? 'high' : 'medium',
    estimatedValueCents: deal.proposedPriceCents,
    recommendedAction: action,
    sourceSignals: ['hot_deal'],
    actions: acts.length > 0 ? acts : undefined,
  };
}

// ── Approval scoring ──────────────────────────────────────────
// Detects: critical severity pending, high severity pending, or any
// pending item stale > 24h.

export function scoreApprovalForAttention(
  item: ApprovalLike,
  lang: Lang3,
  now: number,
): AttentionItem | null {
  if (item.status !== 'pending') return null;

  const ageMs = now - item.createdAt;
  let score = 0;
  let signal: AttentionSignalType;

  if (item.severity === 'critical') {
    score = 90;
    signal = 'critical_approval';
  } else if (item.severity === 'high') {
    score = 75;
    signal = 'stale_approval';
  } else if (ageMs >= DAY_MS) {
    score = 60;
    signal = 'stale_approval';
  } else {
    return null;
  }

  const reason =
    lang === 'es' ? `Aprobación pendiente: ${item.title}`
    : lang === 'pt' ? `Aprovação pendente: ${item.title}`
    : `Pending approval: ${item.title}`;
  const action =
    lang === 'es' ? 'Revisar y resolver'
    : lang === 'pt' ? 'Revisar e resolver'
    : 'Review and resolve';

  return {
    id: `attn:approval:${item.id}:${signal}`,
    entityType: 'approval',
    entityId: item.id,
    reason,
    urgency: urgencyFromScore(score),
    urgencyScore: score,
    confidence: 'high',
    recommendedAction: action,
    sourceSignals: [signal],
    actions: [
      {
        label: lang === 'es' ? 'Abrir cola' : lang === 'pt' ? 'Abrir fila' : 'Open queue',
        actionType: 'query',
        payload: { intent: 'manager_queue' },
      },
    ],
  };
}

// ── VIP inactive customer scoring ─────────────────────────────
// Caller builds VipCandidate from engine.getCustomerScores() + getCustomerHistory().
// Only platinum/gold tier qualifies. Minimum 30 days inactive.

export interface VipCandidate {
  customerId: string;
  customerName: string;
  tier: string;
  daysSinceLastVisit: number;
  grossRevenueCents: number;
}

export function scoreVipForAttention(
  c: VipCandidate,
  lang: Lang3,
): AttentionItem | null {
  if (c.tier !== 'platinum' && c.tier !== 'gold') return null;
  if (c.daysSinceLastVisit < VIP_INACTIVE_DAYS) return null;

  const score = Math.min(
    55 + Math.floor((c.daysSinceLastVisit - VIP_INACTIVE_DAYS) / 15) * 5,
    80,
  );
  const label =
    c.tier === 'platinum'
      ? 'VIP'
      : (lang === 'es' ? 'leal' : lang === 'pt' ? 'fiel' : 'Loyal');
  const reason =
    lang === 'es' ? `Cliente ${label} sin visita en ${c.daysSinceLastVisit}d`
    : lang === 'pt' ? `Cliente ${label} sem visita há ${c.daysSinceLastVisit}d`
    : `${label} customer inactive for ${c.daysSinceLastVisit}d`;
  const action =
    lang === 'es' ? 'Contactar con oferta personalizada'
    : lang === 'pt' ? 'Contatar com oferta personalizada'
    : 'Reach out with a personalized offer';

  return {
    id: `attn:customer:${c.customerId}:vip_inactive`,
    entityType: 'customer',
    entityId: c.customerId,
    entityName: c.customerName,
    reason,
    urgency: urgencyFromScore(score),
    urgencyScore: score,
    confidence: 'medium',
    estimatedValueCents: c.grossRevenueCents > 0 ? c.grossRevenueCents : undefined,
    recommendedAction: action,
    sourceSignals: ['vip_inactive'],
    actions: [
      {
        label: lang === 'es' ? 'Ver cliente' : lang === 'pt' ? 'Ver cliente' : 'Open profile',
        actionType: 'open_customer',
        payload: { customerId: c.customerId },
      },
      {
        label: lang === 'es' ? 'Enviar mensaje' : lang === 'pt' ? 'Enviar mensagem' : 'Send message',
        actionType: 'whatsapp',
        payload: { customerId: c.customerId },
      },
    ],
  };
}
