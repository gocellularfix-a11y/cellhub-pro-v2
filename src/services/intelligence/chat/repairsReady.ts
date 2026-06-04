// ============================================================
// CellHub Intelligence — Repairs Ready for Pickup
// R-INTELLIGENCE-REPAIR-PICKUP-DETAILS-V1
//
// Upgrades the "repairs ready for pickup" answer from a bare count to an
// actionable, detailed list: up to 5 repair rows (customer · device · issue ·
// ticket · ready-age · balance) each with an executable "Open Repair" button
// and a WhatsApp pickup-reminder button when a phone exists.
//
// Reuses the EXISTING action payload system (open_repair / whatsapp_url) and
// the existing repair-open path — no new architecture. Deterministic: pure
// reads + integer (cents) math. NO LLM, NO randomness.
// ============================================================

import type { IntelligenceEngine } from '../IntelligenceEngine';
import type { Repair } from '@/store/types';
import { tChat, COP, type Lang3, type ChatResponse, type ChatActionUI } from './handlers';

const MAX_ROWS = 5;
const MAX_ACTIONS = 10; // up to 5 repairs × (Open + WhatsApp)

// ── Helpers (mirror whoNeedsAttentionToday for consistency) ──
function tsOf(d: unknown): number | null {
  if (!d) return null;
  if (typeof d === 'string') { const n = new Date(d).getTime(); return Number.isFinite(n) ? n : null; }
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'object' && d !== null) {
    const obj = d as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') { try { return obj.toDate().getTime(); } catch { return null; } }
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return null;
}

function statusKey(s: unknown): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '_');
}

function daysBetween(aMs: number, bMs: number): number {
  if (!aMs || !bMs) return 0;
  return Math.max(0, Math.floor((bMs - aMs) / 86400000));
}

/** Ready-for-pickup = done, awaiting customer collection. */
function isReadyForPickup(status: unknown): boolean {
  const s = statusKey(status);
  return s === 'ready' || s === 'complete' || s === 'completed';
}

/**
 * R-INTELLIGENCE-REPAIR-PICKUP-DETAILS-V1
 *
 * Detailed, actionable pickup list. Header count is derived from the SAME
 * filtered set that produces the rows, so the number and the list always agree.
 */
export function handleRepairsReady(engine: IntelligenceEngine, lang: Lang3, nowMs: number = Date.now()): ChatResponse {
  const t = tChat(lang);

  const ready: Repair[] = (engine.getRepairs() || []).filter((r) => isReadyForPickup(r.status));

  if (ready.length === 0) {
    return { kind: 'answer', text: t('chat.repairsReady.empty') };
  }

  // Oldest-ready first (longest-waiting pickups are the most urgent).
  const withAge = ready.map((r) => {
    const readyAtMs = tsOf((r as { completedAt?: unknown }).completedAt) || tsOf(r.updatedAt) || tsOf(r.createdAt);
    return { r, readyAtMs, days: readyAtMs ? daysBetween(readyAtMs, nowMs) : 0 };
  });
  withAge.sort((a, b) => {
    const at = a.readyAtMs ?? Number.MAX_SAFE_INTEGER;
    const bt = b.readyAtMs ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0;
  });

  const shown = withAge.slice(0, MAX_ROWS);

  const lines: string[] = [t('chat.repairsReady.header', ready.length), ''];

  for (let i = 0; i < shown.length; i++) {
    const { r, readyAtMs, days } = shown[i];
    const device = [r.device, (r as { deviceModel?: string }).deviceModel].filter(Boolean).join(' ').trim() || '—';
    const ticket = `#${r.id.slice(-6).toUpperCase()}`;
    const balance = Math.max(0, r.balance || 0);
    const readyInfo = !readyAtMs ? '' : (days <= 0 ? t('chat.repairsReady.readyToday') : t('chat.repairsReady.readyDaysAgo', days));
    const balanceInfo = balance > 0 ? t('chat.repairsReady.balanceDue', COP(balance)) : t('chat.repairsReady.paid');

    lines.push(`${i + 1}. ${r.customerName || '—'} — ${device}`);
    lines.push(`   ${(r.issue || '').trim() || '—'} · ${t('chat.repairsReady.ticketLabel')} ${ticket}`);
    lines.push(`   ${[readyInfo, balanceInfo].filter(Boolean).join(' · ')}`);
  }

  if (ready.length > shown.length) {
    lines.push('');
    lines.push(t('chat.repairsReady.showingTopN', shown.length, ready.length));
  }

  lines.push('');
  lines.push(`💡 ${t('chat.repairsReady.actionV2')}`);

  // ── Executable actions per repair (reuse existing open_repair / whatsapp_url) ──
  const actions: ChatActionUI[] = [];
  for (const { r } of shown) {
    if (actions.length >= MAX_ACTIONS) break;
    const firstName = (r.customerName || '').trim().split(' ')[0] || t('chat.repairsReady.thisRepair');
    // Open Repair — only when a real id exists (always true for a stored repair,
    // but guarded per the no-blank-modal rule).
    if (r.id) {
      actions.push({
        id: `rr-open-${r.id}`,
        label: firstName,
        payload: { type: 'review', entityId: r.id, executable: true, executionTarget: 'open_repair' },
      });
    }
    // WhatsApp pickup reminder — only when a phone exists. customMessage drives a
    // proper pickup text via the existing whatsapp_url flow (no executor change).
    if (r.customerPhone && actions.length < MAX_ACTIONS) {
      actions.push({
        id: `rr-wa-${r.id}`,
        label: firstName,
        actionType: 'whatsapp',
        payload: {
          type: 'whatsapp',
          customerName: r.customerName,
          customerId: r.customerId,
          customerPhone: r.customerPhone,
          customMessage: t('chat.repairsReady.waMessage', firstName),
          executable: true,
          executionTarget: 'whatsapp_url',
        },
      });
    }
  }

  const top = shown[0].r;
  return {
    kind: 'answer',
    text: lines.join('\n'),
    ...(actions.length > 0 ? { actions: actions.slice(0, MAX_ACTIONS) } : {}),
    ...(top.id ? { establishesContext: { type: 'repair' as const, value: top.id } } : {}),
  };
}
