// ============================================================
// CellHub Intelligence — Proactive Missions
// R-INTELLIGENCE-PROACTIVE-MISSIONS-V1
//
// Deterministic, local, silent recommendations. No automation,
// no auto-queuing, no popups. Operator acts; system suggests.
//
// Returns up to 3 top-scored missions per analysis run.
// Filtered out: score < 45, already in pending queue,
//               dismissed < 24h, missing phone for outreach.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { OperatorQueueItem, OperatorTaskType, UrgencyLevel } from '../operatorQueue/operatorQueue';
import { isDoneRepairStatus } from '@/utils/repairStatus';
import {
  scoreRecoverCustomer,
  scoreVipOutreach,
  scoreRepairFollowUp,
  scoreRepairEscalate,
} from '../operatorQueue/priorityScoring';

// ── Types ─────────────────────────────────────────────────────

export type MissionType =
  | 'recover_customer'
  | 'vip_outreach'
  | 'repair_follow_up'
  | 'repair_escalate';

export interface ProactiveMission {
  id: string;             // stable: "type:entityId"
  type: MissionType;
  title: string;
  summary: string;
  reason: string;
  priorityScore: number;
  urgencyLevel: UrgencyLevel;
  suggestedAction: string;
  suggestedMessage?: string;
  relatedEntityId?: string;
  customerName?: string;
  phone?: string;
}

// ── Dismissed mission persistence ─────────────────────────────

const DISMISSED_KEY = 'cellhub:intelligence:dismissedMissions:v1';
const DISMISS_TTL   = 24 * 60 * 60 * 1000;   // 24h — hide window
const CLEAN_TTL     = 7  * 24 * 60 * 60 * 1000; // 7d — auto-purge

export function readDismissedMissions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch { return {}; }
}

export function dismissMission(id: string): void {
  const all = readDismissedMissions();
  all[id] = Date.now();
  const now = Date.now();
  const cleaned: Record<string, number> = {};
  for (const [k, ts] of Object.entries(all)) {
    if (now - ts < CLEAN_TTL) cleaned[k] = ts;
  }
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(cleaned)); } catch { /* quota */ }
}

// ── WA message helpers ────────────────────────────────────────

function msgRecover(n: string, lang: 'en' | 'es' | 'pt'): string {
  if (lang === 'es') return `¡Hola ${n}! Te extrañamos en Go Cellular. ¿Cómo estás? Tenemos nuevos planes y ofertas que podrían interesarte. 😊`;
  if (lang === 'pt') return `Olá ${n}! Sentimos sua falta na Go Cellular. Temos novos planos e ofertas que podem te interessar. 😊`;
  return `Hi ${n}! We miss you at Go Cellular. We have new plans and offers you might be interested in. 😊`;
}

function msgVip(n: string, lang: 'en' | 'es' | 'pt'): string {
  if (lang === 'es') return `¡Hola ${n}! Queremos agradecerte por ser uno de nuestros mejores clientes en Go Cellular. Tenemos algo especial para ti. 🌟`;
  if (lang === 'pt') return `Olá ${n}! Queremos agradecer por ser um dos nossos melhores clientes na Go Cellular. Temos algo especial para você. 🌟`;
  return `Hi ${n}! We want to thank you for being one of our best customers at Go Cellular. We have something special for you. 🌟`;
}

function msgFollowUp(n: string, device: string, lang: 'en' | 'es' | 'pt'): string {
  if (lang === 'es') return `Hola ${n}! Te contactamos de Go Cellular para darte una actualización sobre tu ${device}. Nuestro técnico está en ello y te avisamos cuando esté listo. ¡Gracias por tu paciencia! 🔧`;
  if (lang === 'pt') return `Olá ${n}! Entramos em contato da Go Cellular sobre seu ${device}. Nosso técnico está trabalhando nisso e te avisaremos quando estiver pronto. Obrigado! 🔧`;
  return `Hi ${n}! This is Go Cellular with an update on your ${device}. Our tech is working on it and we'll notify you when it's ready. Thanks for your patience! 🔧`;
}

function msgEscalate(n: string, device: string, lang: 'en' | 'es' | 'pt'): string {
  if (lang === 'es') return `Hola ${n}, pedimos disculpa por la demora en la reparación de tu ${device} en Go Cellular. Lo estamos priorizando ahora mismo. Gracias por tu comprensión. 🙏`;
  if (lang === 'pt') return `Olá ${n}, pedimos desculpas pelo atraso no reparo do seu ${device} na Go Cellular. Estamos priorizando agora. Obrigado pela compreensão. 🙏`;
  return `Hi ${n}, we apologize for the delay on your ${device} repair at Go Cellular. We are prioritizing it right now. Thank you for your understanding. 🙏`;
}

// ── Mission builders ──────────────────────────────────────────

const MIN_SCORE        = 45;
const MIN_INACTIVE_DAYS = 30;
const MIN_FOLLOW_DAYS   = 3;
const MIN_ESCALATE_DAYS = 7;

function buildRecover(
  engine: IntelligenceEngine,
  isBlocked: (id: string) => boolean,
  excludeCustomerIds: Set<string>,
  lang: 'en' | 'es' | 'pt',
  now: number,
): ProactiveMission | null {
  let best: { m: ProactiveMission; score: number } | null = null;

  for (const cs of engine.getCustomerScores()) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h || !h.lastVisit || !h.customer.phone) continue;

    const days = Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000));
    if (days < MIN_INACTIVE_DAYS) continue;

    const entityId = cs.customerId;
    if (excludeCustomerIds.has(entityId)) continue;
    if (isBlocked(`recover_customer:${entityId}`)) continue;

    const { priorityScore, urgencyLevel, impactReason } = scoreRecoverCustomer({
      daysInactive: days,
      grossRevenueCents: h.grossRevenue,
      visitCount: h.visitCount,
    });
    if (priorityScore < MIN_SCORE) continue;

    if (!best || priorityScore > best.score) {
      const firstName = h.customer.name.split(' ')[0] || h.customer.name;
      best = {
        score: priorityScore,
        m: {
          id: `recover_customer:${entityId}`,
          type: 'recover_customer',
          title: lang === 'es' ? `Reconectar: ${h.customer.name}`
            : lang === 'pt' ? `Reconectar: ${h.customer.name}`
            : `Re-engage: ${h.customer.name}`,
          summary: impactReason,
          reason: impactReason,
          priorityScore,
          urgencyLevel,
          suggestedAction: lang === 'es' ? 'Contactar' : lang === 'pt' ? 'Contatar' : 'Contact',
          suggestedMessage: msgRecover(firstName, lang),
          relatedEntityId: entityId,
          customerName: h.customer.name,
          phone: h.customer.phone,
        },
      };
    }
  }

  return best?.m ?? null;
}

function buildVip(
  engine: IntelligenceEngine,
  isBlocked: (id: string) => boolean,
  excludeCustomerIds: Set<string>,
  lang: 'en' | 'es' | 'pt',
  now: number,
): ProactiveMission | null {
  const sorted = engine.getCustomerScores().slice().sort((a, b) => b.score - a.score);

  for (const cs of sorted.slice(0, 20)) {
    const h = engine.getCustomerHistory(cs.customerId);
    if (!h || !h.customer.phone) continue;

    const entityId = cs.customerId;
    if (excludeCustomerIds.has(entityId)) continue;
    if (isBlocked(`vip_outreach:${entityId}`)) continue;

    const daysSinceLast = h.lastVisit
      ? Math.max(0, Math.floor((now - h.lastVisit.getTime()) / 86400000))
      : 999;

    const { priorityScore, urgencyLevel, impactReason } = scoreVipOutreach({
      grossRevenueCents: h.grossRevenue,
      visitCount: h.visitCount,
      daysSinceLastVisit: daysSinceLast,
    });
    if (priorityScore < MIN_SCORE) continue;

    const firstName = h.customer.name.split(' ')[0] || h.customer.name;
    return {
      id: `vip_outreach:${entityId}`,
      type: 'vip_outreach',
      title: `VIP: ${h.customer.name}`,
      summary: impactReason,
      reason: impactReason,
      priorityScore,
      urgencyLevel,
      suggestedAction: lang === 'es' ? 'Mensaje VIP' : lang === 'pt' ? 'Mensagem VIP' : 'VIP message',
      suggestedMessage: msgVip(firstName, lang),
      relatedEntityId: entityId,
      customerName: h.customer.name,
      phone: h.customer.phone,
    };
  }

  return null;
}

function buildFollowUp(
  engine: IntelligenceEngine,
  isBlocked: (id: string) => boolean,
  lang: 'en' | 'es' | 'pt',
  now: number,
): ProactiveMission | null {
  const active = engine.getRepairs().filter((r) => !isDoneRepairStatus(r.status));
  let best: { m: ProactiveMission; score: number } | null = null;

  for (const repair of active) {
    const entityId = repair.id;
    if (isBlocked(`repair_follow_up:${entityId}`)) continue;

    const days = Math.max(0, Math.floor((now - new Date(repair.createdAt as string).getTime()) / 86400000));
    if (days < MIN_FOLLOW_DAYS) continue;

    const repairValueCents = (repair as any).estimatedCost || (repair as any).price || 0;
    const { priorityScore, urgencyLevel, impactReason } = scoreRepairFollowUp({ daysInRepair: days, repairValueCents });
    if (priorityScore < MIN_SCORE) continue;

    if (!best || priorityScore > best.score) {
      const device = repair.device || repair.issue || 'device';
      const firstName = repair.customerName.split(' ')[0] || repair.customerName;
      best = {
        score: priorityScore,
        m: {
          id: `repair_follow_up:${entityId}`,
          type: 'repair_follow_up',
          title: lang === 'es' ? `Seguimiento: ${repair.customerName}`
            : lang === 'pt' ? `Acompanhar: ${repair.customerName}`
            : `Follow-up: ${repair.customerName}`,
          summary: impactReason,
          reason: impactReason,
          priorityScore,
          urgencyLevel,
          suggestedAction: lang === 'es' ? 'Dar seguimiento' : lang === 'pt' ? 'Acompanhar' : 'Follow up',
          suggestedMessage: repair.customerPhone ? msgFollowUp(firstName, device, lang) : undefined,
          relatedEntityId: entityId,
          customerName: repair.customerName,
          phone: repair.customerPhone || undefined,
        },
      };
    }
  }

  return best?.m ?? null;
}

function buildEscalate(
  engine: IntelligenceEngine,
  isBlocked: (id: string) => boolean,
  excludeRepairIds: Set<string>,
  lang: 'en' | 'es' | 'pt',
  now: number,
): ProactiveMission | null {
  const active = engine.getRepairs().filter((r) => !isDoneRepairStatus(r.status));
  let best: { m: ProactiveMission; score: number } | null = null;

  for (const repair of active) {
    const entityId = repair.id;
    if (excludeRepairIds.has(entityId)) continue;
    if (isBlocked(`repair_escalate:${entityId}`)) continue;

    const days = Math.max(0, Math.floor((now - new Date(repair.createdAt as string).getTime()) / 86400000));
    if (days < MIN_ESCALATE_DAYS) continue;

    const repairValueCents = (repair as any).estimatedCost || (repair as any).price || 0;
    const { priorityScore, urgencyLevel, impactReason } = scoreRepairEscalate({ daysInRepair: days, repairValueCents });
    if (priorityScore < MIN_SCORE) continue;

    if (!best || priorityScore > best.score) {
      const device = repair.device || repair.issue || 'device';
      const firstName = repair.customerName.split(' ')[0] || repair.customerName;
      best = {
        score: priorityScore,
        m: {
          id: `repair_escalate:${entityId}`,
          type: 'repair_escalate',
          title: lang === 'es' ? `Escalar: ${repair.customerName}`
            : lang === 'pt' ? `Escalar: ${repair.customerName}`
            : `Escalate: ${repair.customerName}`,
          summary: impactReason,
          reason: impactReason,
          priorityScore,
          urgencyLevel,
          suggestedAction: lang === 'es' ? 'Escalar ahora' : lang === 'pt' ? 'Escalar agora' : 'Escalate now',
          suggestedMessage: repair.customerPhone ? msgEscalate(firstName, device, lang) : undefined,
          relatedEntityId: entityId,
          customerName: repair.customerName,
          phone: repair.customerPhone || undefined,
        },
      };
    }
  }

  return best?.m ?? null;
}

// ── Main export ───────────────────────────────────────────────

export function generateProactiveMissions(
  engine: IntelligenceEngine,
  pendingQueueItems: OperatorQueueItem[],
  dismissedIds: Record<string, number>,
  lang: 'en' | 'es' | 'pt',
  now = Date.now(),
): ProactiveMission[] {
  // Blocked = same type:entityId already in pending queue.
  const blocked = new Set(
    pendingQueueItems
      .filter((i) => i.relatedEntityId)
      .map((i) => `${i.type}:${i.relatedEntityId}`),
  );

  // Recently dismissed = within 24h window.
  const dismissed = new Set(
    Object.entries(dismissedIds)
      .filter(([, ts]) => now - ts < DISMISS_TTL)
      .map(([id]) => id),
  );

  const isBlocked = (id: string) => blocked.has(id) || dismissed.has(id);

  const usedCustomerIds = new Set<string>();
  const usedRepairIds   = new Set<string>();
  const candidates: ProactiveMission[] = [];

  const recover = buildRecover(engine, isBlocked, usedCustomerIds, lang, now);
  if (recover) {
    candidates.push(recover);
    if (recover.relatedEntityId) usedCustomerIds.add(recover.relatedEntityId);
  }

  const vip = buildVip(engine, isBlocked, usedCustomerIds, lang, now);
  if (vip) {
    candidates.push(vip);
    if (vip.relatedEntityId) usedCustomerIds.add(vip.relatedEntityId);
  }

  const followUp = buildFollowUp(engine, isBlocked, lang, now);
  if (followUp) {
    candidates.push(followUp);
    if (followUp.relatedEntityId) usedRepairIds.add(followUp.relatedEntityId);
  }

  const escalate = buildEscalate(engine, isBlocked, usedRepairIds, lang, now);
  if (escalate) candidates.push(escalate);

  return candidates
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3);
}
