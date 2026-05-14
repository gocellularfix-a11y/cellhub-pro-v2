// ============================================================
// CellHub Pro — Companion Intelligence Runtime Store
// (R-COMPANION-INTELLIGENCE-ACTIONS-LIVE-V1)
//
// Passive read-model over INTELLIGENCE_ALERT_CREATED events.
// Aggregates alerts so Companion Center can surface an actionable
// feed with priority chips and acknowledge / create-message flows.
//
// Tracks local acknowledged state (EXEC: additive, Companion Center
// only). Also dispatches to the active Intelligence engine when ack
// is called — same path as intelligenceAckReceiver, but initiated
// from the desktop UI rather than mobile bridge.
//
// Cero networking. Cero persistence. Cero scoring changes. In-memory.
// ============================================================

import { subscribe } from './companionEventBus';
import type { CompanionIntelligenceAlertPayload } from './companionTypes';
import { acknowledgeIntelligenceAlertOnActiveEngine } from '@/services/intelligence';

// ── Types ────────────────────────────────────────────────

export interface CompanionIntelligenceRuntimeItem {
  alertId: string;
  severity?: 'info' | 'warning' | 'critical' | 'opportunity';
  priority?: 'info' | 'warning' | 'critical' | 'opportunity';
  kind?: string;
  insightType?: string;
  title?: string;
  body?: string;
  source?: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  isAcknowledged: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CompanionIntelligenceRuntimeSnapshot {
  items: CompanionIntelligenceRuntimeItem[];
  unacknowledgedCount: number;
  latest: CompanionIntelligenceRuntimeItem | null;
}

type IntelligenceRuntimeListener = (snap: CompanionIntelligenceRuntimeSnapshot) => void;

// ── Module-private state ──────────────────────────────────

const alerts = new Map<string, CompanionIntelligenceRuntimeItem>();
const listeners = new Set<IntelligenceRuntimeListener>();

// ── Helpers ──────────────────────────────────────────────

function buildSnapshot(): CompanionIntelligenceRuntimeSnapshot {
  const items = Array.from(alerts.values())
    .map((i) => ({ ...i }))
    .sort((a, b) => b.createdAt - a.createdAt);
  let unacknowledgedCount = 0;
  for (const i of items) if (!i.isAcknowledged) unacknowledgedCount += 1;
  return {
    items,
    unacknowledgedCount,
    latest: items.length > 0 ? items[0] : null,
  };
}

function notify(): void {
  const snap = buildSnapshot();
  listeners.forEach((listener) => {
    try { listener(snap); } catch (err) {
      console.warn('[companion-intelligence-runtime] listener threw', err);
    }
  });
}

// ── Event subscription ────────────────────────────────────

subscribe('INTELLIGENCE_ALERT_CREATED', (event) => {
  if (event.type !== 'INTELLIGENCE_ALERT_CREATED') return;
  const p: CompanionIntelligenceAlertPayload = event.payload;
  if (!p.alertId) return;
  const now = Date.now();
  const existing = alerts.get(p.alertId);
  alerts.set(p.alertId, {
    alertId: p.alertId,
    severity: p.severity,
    priority: p.priority ?? p.severity,
    kind: p.kind,
    insightType: p.insightType,
    title: p.title,
    body: p.body,
    source: p.source,
    relatedEntityId: p.relatedEntityId,
    relatedEntityType: p.relatedEntityType,
    isAcknowledged: existing?.isAcknowledged ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  notify();
});

// ── Public API ────────────────────────────────────────────

export function getIntelligenceRuntimeSnapshot(): CompanionIntelligenceRuntimeSnapshot {
  return buildSnapshot();
}

export function subscribeIntelligenceRuntime(listener: IntelligenceRuntimeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * R-COMPANION-INTELLIGENCE-ACTIONS-LIVE-V1: acknowledge an alert from
 * the desktop UI. Marks it locally (unacknowledgedCount decrements)
 * and dispatches to the active Intelligence engine when available.
 */
export function acknowledgeIntelligenceAlert(alertId: string): void {
  const existing = alerts.get(alertId);
  if (existing?.isAcknowledged) return; // idempotent
  const now = Date.now();
  alerts.set(alertId, existing
    ? { ...existing, isAcknowledged: true, updatedAt: now }
    : { alertId, isAcknowledged: true, createdAt: now, updatedAt: now },
  );
  notify();
  try {
    acknowledgeIntelligenceAlertOnActiveEngine(alertId, 'companion-desktop');
  } catch (err) {
    console.warn('[companion-intelligence-runtime] engine ack failed', err);
  }
}

/** Dev-only: clear all items. */
export function clearIntelligenceRuntime(): void {
  if (alerts.size === 0) return;
  alerts.clear();
  notify();
}
