// ============================================================
// CellHub Pro — Companion Bridge Adapter (R-COMPANION-BRIDGE-WIRE-V1)
//
// One-way OUTBOUND mirror: translates local companionEventBus events
// (APPROVAL_CREATED / APPROVAL_APPROVED / APPROVAL_DENIED /
// INTELLIGENCE_ALERT_CREATED) into bridge SDK calls so the Companion
// mobile app can passively observe what happens on the desktop.
//
// NO mobile-driven mutations. NO inbound bridge listeners. NO touching
// of approvalGuard / AlertEngine / useApprovalGate / receivers /
// emitters / store. Receivers stay shells.
//
// Singleton guards:
//   - start() is idempotent. Calling it while already started is a no-op.
//   - stop() is safe. Calling it while idle is a no-op.
//   - Exactly one event-bus subscription exists at any time, regardless
//     of how many times CompanionCenter remounts.
//
// PII policy: IDs only. Customer names / phone numbers / transaction
// refs / message bodies / note bodies NEVER cross the wire.
// Money: cents on the wire (CellHub Pro canonical).
// ============================================================

import { subscribeAll, emit as emitToBus } from './companionEventBus';
import { createPosBridgeClient } from './sdk/posBridgeClient';
import type { PosBridgeClient, PosBridgeStatus } from './sdk/posBridgeClient';
import {
  initApprovalEmitter,
  approvalEmitter,
} from './sdk/approvalEmitter';
import {
  initIntelligenceEmitter,
  intelligenceEmitter,
} from './sdk/intelligenceEmitter';
import {
  initMessageEmitter,
  messageEmitter,
} from './sdk/messageEmitter';
import { EVENTS as SDK_EVENTS } from './sdk/events';
import type {
  ApprovalPriority,
  ApprovalType,
  AlertSeverity,
  NewMessagePayload,
  StoreSnapshotPayload,
} from './sdk/payloads';
import type {
  CompanionApprovalPayload,
  CompanionEvent,
  CompanionIntelligenceAlertPayload,
  CompanionOpCategory,
} from './companionTypes';
// R-COMPANION-INTELLIGENCE-ACK-INBOUND-V1 — funnel bridge dismissals
// through the inbox + receiver path so the dispatch + audit semantics
// match the existing dev-panel "Process pending" flow.
import { submitAction } from './companionActionInbox';
import { processIntelligenceAck } from './receivers/intelligenceAckReceiver';
// R-COMPANION-REMOTE-APPROVAL-RESOLUTION-V1 Phase 2B — gateway dispatch.
// Bridge responses funnel through inbox (audit trail) + gateway (resolution).
// validateRemoteApprovalActor runs inside the useApprovalGate resolver before
// the pending prompter promise resolves — the guard never sees an unvalidated
// remote response. Financial mutations only proceed when caller gets approved:true.
import { processApprovalAction } from './receivers/approvalActionReceiver';
import { dispatchRemoteApprovalResponse } from './remoteApprovalGateway';

// ── Public types ──────────────────────────────────────────

export interface BridgeAdapterStartArgs {
  bridgeUrl: string;
  storeId: string;
  deviceId: string;
  authToken: string;
  /** Name lookup — injected so the adapter never imports the store. */
  getEmployeeName: (employeeId: string) => string;
  /** Short location string for ApprovalRequestPayload.storeLocation. */
  getStoreLocation: () => string;
}

// ── Module-private singleton state ────────────────────────

type LifecycleState = 'idle' | 'starting' | 'started' | 'stopping';

let lifecycle: LifecycleState = 'idle';
let client: PosBridgeClient | null = null;
let busUnsubscribe: (() => void) | null = null;
let statusUnsubscribe: (() => void) | null = null;
let intelligenceDismissUnsubscribe: (() => void) | null = null;
let approvalResponseUnsubscribe: (() => void) | null = null;
let messageUnsubscribe: (() => void) | null = null;
let lastStatus: PosBridgeStatus = 'idle';

// R-COMPANION-BRIDGE-DEDUP-V1 — in-memory processed-event cache. Prevents
// the same local event (re-emitted by a flaky producer, queue drain on
// reconnect, or two consumers both calling _drainCompanionEvent) from
// being translated to bridge twice. FIFO eviction at DEDUP_CAP; cleared
// on stopCompanionBridgeAdapter so a fresh start has a clean slate.
const DEDUP_CAP = 500;
const processedEventKeys = new Set<string>();
const processedEventOrder: string[] = [];

/** Derive a stable dedup key. CompanionEvent envelope has no top-level
 *  id, so we combine event.type with the payload's natural identifier
 *  (approvalId / alertId / messageId / statusId). Returns null when no
 *  id is available — those events bypass dedup (current scope: never). */
function eventDedupKey(event: CompanionEvent): string | null {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return null;
  let id: unknown;
  switch (event.type) {
    case 'APPROVAL_CREATED':
    case 'APPROVAL_APPROVED':
    case 'APPROVAL_DENIED':
    case 'APPROVAL_UPDATED':
      id = (p as { approvalId?: unknown }).approvalId;
      break;
    case 'INTELLIGENCE_ALERT_CREATED':
      id = (p as { alertId?: unknown }).alertId;
      break;
    case 'MESSAGE_SENT':
    case 'MESSAGE_RECEIVED':
    case 'MESSAGE_READ':
      id = (p as { messageId?: unknown }).messageId;
      break;
    case 'STORE_OPENED':
    case 'STORE_CLOSED':
    case 'STORE_STATUS_UPDATED':
      id = (p as { statusId?: unknown }).statusId;
      break;
    default:
      return null;
  }
  if (typeof id !== 'string' || id.length === 0) return null;
  return `${event.type}:${id}`;
}

function markEventProcessed(key: string): void {
  if (processedEventKeys.has(key)) return;
  processedEventKeys.add(key);
  processedEventOrder.push(key);
  while (processedEventOrder.length > DEDUP_CAP) {
    const oldest = processedEventOrder.shift();
    if (oldest !== undefined) processedEventKeys.delete(oldest);
  }
}

function resetProcessedEventCache(): void {
  processedEventKeys.clear();
  processedEventOrder.length = 0;
}

// ── ActionType mapping (CellHub Pro → bridge) ─────────────

function mapActionType(actionType: string | undefined): ApprovalType {
  switch (actionType) {
    case 'CANCEL_LAYAWAY':        return 'layaway_cancellation';
    case 'CANCEL_REPAIR':         return 'repair_cancellation';
    case 'CANCEL_UNLOCK':         return 'unlock_cancellation';
    case 'CANCEL_SPECIAL_ORDER':  return 'special_order_cancellation';
    case 'PRICE_OVERRIDE':        return 'price_override';
    case 'DISCOUNT_OVERRIDE':     return 'discount';
    case 'REFUND':                return 'refund';
    default:
      console.warn(`[companion-bridge-adapter] unknown actionType "${actionType ?? ''}" — defaulting to 'discount'`);
      return 'discount';
  }
}

function mapSeverity(severity: string | undefined): AlertSeverity {
  if (severity === 'critical' || severity === 'warning' || severity === 'info') return severity;
  // 'opportunity' (CellHub Pro AlertEngine extension) → downgrade to 'info'.
  return 'info';
}

// R-COMPANION-APPROVALS-LIVE-V1: human reason derived from actionType for bridge payload.
function reasonFromActionType(actionType: string | undefined): string {
  switch (actionType) {
    case 'CANCEL_LAYAWAY':        return 'Layaway cancellation requested';
    case 'CANCEL_REPAIR':         return 'Repair cancellation requested';
    case 'CANCEL_UNLOCK':         return 'Unlock cancellation requested';
    case 'CANCEL_SPECIAL_ORDER':  return 'Special order cancellation requested';
    case 'PRICE_OVERRIDE':        return 'Price override requested';
    case 'DISCOUNT_OVERRIDE':     return 'Discount override requested';
    case 'REFUND':                return 'Refund requested';
    default:                      return 'Approval requested';
  }
}

// ── Event translation handlers ────────────────────────────

function handleEvent(event: CompanionEvent): void {
  // Adapter ignores events when not yet authed; bridge SDK will buffer
  // its own offline queue but the emit guard inside each emitter also
  // checks socket.connected, so a quick double-guard here is cheap.
  if (!client) return;
  if (client.getStatus() !== 'connected') return;

  // R-COMPANION-BRIDGE-DEDUP-V1 — drop duplicates BEFORE translation so
  // the SDK never sees the same logical event twice. Events with no
  // derivable id bypass dedup and proceed to translation.
  const dedupKey = eventDedupKey(event);
  if (dedupKey) {
    if (processedEventKeys.has(dedupKey)) {
      console.info(`[companion-bridge-adapter] duplicate event skipped key=${dedupKey}`);
      return;
    }
    markEventProcessed(dedupKey);
  }

  try {
    switch (event.type) {
      case 'APPROVAL_CREATED': {
        const p = event.payload as CompanionApprovalPayload;
        const priority: ApprovalPriority = 'medium';
        const employeeId = p.requestedByEmployeeId ?? '';
        const employeeName = currentArgs?.getEmployeeName(employeeId) ?? '';
        const storeLocation = currentArgs?.getStoreLocation() ?? '';
        approvalEmitter.created({
          id: p.approvalId,
          type: mapActionType(p.actionType),
          priority,
          employeeId,
          employeeName,                  // ID lookup only; no customer PII
          storeLocation,
          reason: p.reason || reasonFromActionType(p.actionType),
          affectedAmount: p.affectedAmount ?? 0,
          requestedAt: new Date(event.createdAt).toISOString(),
          expiresAt: new Date(event.createdAt + 10 * 60 * 1000).toISOString(),
        });
        console.info(
          `[companion-bridge-adapter] APPROVAL_CREATED → bridge id=${p.approvalId} type=${p.actionType ?? '<unknown>'}`,
        );
        return;
      }

      case 'APPROVAL_APPROVED':
      case 'APPROVAL_DENIED': {
        // Bridge SDK does not emit terminal-status outbound from POS —
        // responses flow mobile → bridge → POS. Log locally for dogfood
        // traceability so audit panels can pair local + bridge ids later.
        const p = event.payload as CompanionApprovalPayload;
        console.info(
          `[companion-bridge-adapter] ${event.type} (local) id=${p.approvalId} by=${p.approvedByEmployeeId ?? ''} reason=${p.reason ?? ''}`,
        );
        return;
      }

      case 'INTELLIGENCE_ALERT_CREATED': {
        const p = event.payload as CompanionIntelligenceAlertPayload;
        intelligenceEmitter.push({
          severity: mapSeverity(p.severity),
          category: p.insightType ?? 'operations',
          title: p.title || p.kind || 'Store Alert',
          recommendation: p.body || '',
          suggestedAction: 'view_details',
          suggestedActionLabel: 'View',
        });
        console.info(
          `[companion-bridge-adapter] INTELLIGENCE_ALERT_CREATED → bridge alertId=${p.alertId} severity=${p.severity ?? '<unset>'}`,
        );
        return;
      }

      // All other event types are out of scope this round.
      default:
        return;
    }
  } catch (err) {
    // Never throw out of the bus listener — would poison sibling handlers.
    console.warn('[companion-bridge-adapter] translation failed', event.type, err);
  }
}

// ── Lifecycle ─────────────────────────────────────────────

let currentArgs: BridgeAdapterStartArgs | null = null;

/**
 * Start the adapter. Idempotent:
 *   - If already started, this is a no-op (returns).
 *   - If currently starting/stopping (mid-transition), no-op too.
 *   - On first call, creates the PosBridgeClient and registers a single
 *     companionEventBus subscription.
 */
export function startCompanionBridgeAdapter(args: BridgeAdapterStartArgs): void {
  if (lifecycle !== 'idle') {
    console.info(`[companion-bridge-adapter] start() called while ${lifecycle} — no-op`);
    return;
  }
  lifecycle = 'starting';
  currentArgs = args;

  try {
    client = createPosBridgeClient({
      bridgeUrl: args.bridgeUrl,
      storeId: args.storeId,
      deviceId: args.deviceId,
      authToken: args.authToken,
    });
    initApprovalEmitter(client);
    initIntelligenceEmitter(client.getSocket(), client.getStoreId());
    initMessageEmitter(client.getSocket(), args.storeId, '', '');

    // R-COMPANION-MESSAGING-SIMPLE-V1 — inbound: bridge routes
    // message:new from mobile to the store room; listen and feed the
    // local companion event bus so CompanionCenter chat panel updates.
    if (messageUnsubscribe) {
      try { messageUnsubscribe(); } catch { /* isolate */ }
      messageUnsubscribe = null;
    }
    messageUnsubscribe = messageEmitter.onNewMessage((p) => {
      const preview = p.content.length > 80 ? `${p.content.slice(0, 77)}…` : p.content;
      emitToBus({
        type: 'MESSAGE_RECEIVED',
        category: 'messaging',
        payload: {
          messageId: p.id,
          fromEmployeeId: p.senderId,
          senderRole: p.senderRole === 'manager' ? 'manager' : undefined,
          channel: 'internal',
          direction: 'inbound',
          preview,
          body: p.content,
        },
        createdAt: Date.now(),
      });
      console.info(
        `[companion-bridge-adapter] inbound MESSAGE_NEW from=${p.senderId} id=${p.id}`,
      );
    });

    statusUnsubscribe = client.onStatus((s) => {
      lastStatus = s;
      console.info(`[companion-bridge-adapter] status → ${s}`);
    });

    // Singleton subscription: there can be exactly one active subscriber
    // even if start() is called from multiple consumers — busUnsubscribe
    // is replaced atomically and the previous handle (if any) is dropped.
    if (busUnsubscribe) {
      try { busUnsubscribe(); } catch { /* isolate */ }
      busUnsubscribe = null;
    }
    busUnsubscribe = subscribeAll(handleEvent);

    // R-COMPANION-INTELLIGENCE-ACK-INBOUND-V1 — inbound intelligence
    // dismissal listener. Each Companion-side dismissal becomes ONE inbox
    // action; processIntelligenceAck fires the receiver chain which
    // dispatches to the active IntelligenceEngine. Singleton-safe: any
    // prior subscription is cleared first.
    if (intelligenceDismissUnsubscribe) {
      try { intelligenceDismissUnsubscribe(); } catch { /* isolate */ }
      intelligenceDismissUnsubscribe = null;
    }
    intelligenceDismissUnsubscribe = intelligenceEmitter.onDismissed((payload) => {
      const alertId = payload?.alertId;
      if (!alertId || typeof alertId !== 'string') {
        console.warn('[companion-bridge-adapter] INTELLIGENCE_DISMISSED dropped — missing alertId');
        return;
      }
      console.info(
        `[companion-bridge-adapter] inbound INTELLIGENCE_DISMISSED alertId=${alertId} by=${payload.dismissedBy ?? '<unknown>'}`,
      );
      try {
        const submitted = submitAction({
          type: 'acknowledge_intelligence_alert',
          payload: {
            alertId,
            acknowledgedByEmployeeId: payload.dismissedBy,
          },
        });
        processIntelligenceAck(submitted.actionId);
      } catch (err) {
        console.warn('[companion-bridge-adapter] inbound dispatch failed', err);
      }
    });

    // R-COMPANION-REMOTE-APPROVAL-AUTHORITY-V1 Phase 1 — observe-only.
    // Bridge SDK approvalEmitter.onResponse already dedups by requestId
    // for 60s, so duplicate broadcasts (multi-manager, reconnect replay)
    // do not double-invoke this callback. Singleton-safe: any prior
    // subscription is cleared first.
    //
    // CRITICAL — this callback must NEVER:
    //   - call approvalGuard.requestApproval / resolve any pending gate
    //   - mutate any approval / store / money / inventory state
    //   - bypass the local PIN modal
    // It only LOGS and submits to the inbox + existing shell receiver.
    if (approvalResponseUnsubscribe) {
      try { approvalResponseUnsubscribe(); } catch { /* isolate */ }
      approvalResponseUnsubscribe = null;
    }
    approvalResponseUnsubscribe = approvalEmitter.onResponse((payload) => {
      const requestId = payload?.requestId;
      const action    = payload?.action;
      if (!requestId || typeof requestId !== 'string') {
        console.warn('[companion-bridge-adapter] APPROVAL response dropped — missing requestId');
        return;
      }
      if (action !== 'approve' && action !== 'deny' && action !== 'request_explanation') {
        console.warn(
          `[companion-bridge-adapter] APPROVAL response dropped — invalid action="${String(action)}" requestId=${requestId}`,
        );
        return;
      }
      // Log: IDs + action only. No managerName, no managerNote body, no
      // customer PII. Note is acknowledged as "present/absent" only.
      console.info(
        `[companion-bridge-adapter] inbound APPROVAL_${action.toUpperCase()} (OBSERVE-ONLY) requestId=${requestId} managerId=${payload.managerId ?? '<unknown>'} note=${payload.managerNote ? 'present' : 'absent'}`,
      );
      try {
        // request_explanation has no matching inbox type today; log + drop.
        // approve/deny route through the existing receiver shell, which
        // normalises + marks handled and explicitly does NOT call
        // approvalGuard. See receivers/approvalActionReceiver.ts header.
        if (action === 'approve') {
          const submitted = submitAction({
            type: 'approve_request',
            payload: {
              approvalId: requestId,
              approvedByEmployeeId: payload.managerId,
              reason: payload.managerNote,
            },
          });
          processApprovalAction(submitted.actionId);
          // Update companionApprovalRuntime + CompanionCenter immediately.
          emitToBus({
            type: 'APPROVAL_APPROVED',
            category: 'approvals',
            payload: { approvalId: requestId, approvedByEmployeeId: payload.managerId },
            createdAt: Date.now(),
          });
          // R-COMPANION-REMOTE-APPROVAL-RESOLUTION-V1 Phase 2B — dispatch to
          // the gateway so the waiting useApprovalGate resolver can validate
          // and resolve the pending prompter promise. No-op when no gate is
          // waiting (expired, already resolved locally, unknown id).
          const dispatched = dispatchRemoteApprovalResponse({
            approvalId: requestId,
            action: 'approve',
            managerId: payload.managerId ?? '',
            source: 'companion_remote',
            receivedAt: Date.now(),
            managerNote: payload.managerNote,
          });
          console.info(
            `[companion-bridge-adapter] gateway approve dispatch requestId=${requestId} result=${dispatched}`,
          );
        } else if (action === 'deny') {
          const submitted = submitAction({
            type: 'deny_request',
            payload: {
              approvalId: requestId,
              deniedByEmployeeId: payload.managerId,
              reason: payload.managerNote,
            },
          });
          processApprovalAction(submitted.actionId);
          emitToBus({
            type: 'APPROVAL_DENIED',
            category: 'approvals',
            payload: { approvalId: requestId, reason: payload.managerNote },
            createdAt: Date.now(),
          });
          // Phase 2B — dispatch deny to gateway.
          const dispatched = dispatchRemoteApprovalResponse({
            approvalId: requestId,
            action: 'deny',
            managerId: payload.managerId ?? '',
            source: 'companion_remote',
            receivedAt: Date.now(),
            managerNote: payload.managerNote,
          });
          console.info(
            `[companion-bridge-adapter] gateway deny dispatch requestId=${requestId} result=${dispatched}`,
          );
        } else {
          // request_explanation — log only; no inbox shape, no gateway dispatch.
          console.info(
            `[companion-bridge-adapter] inbound APPROVAL_EXPLANATION_REQUESTED (not routed) requestId=${requestId}`,
          );
        }
      } catch (err) {
        console.warn('[companion-bridge-adapter] inbound approval dispatch failed', err);
      }
    });

    lifecycle = 'started';
  } catch (err) {
    console.warn('[companion-bridge-adapter] start failed — rolling back', err);
    // Best-effort rollback so a partial start doesn't leak listeners.
    try { statusUnsubscribe?.(); } catch { /* isolate */ }
    try { busUnsubscribe?.(); } catch { /* isolate */ }
    try { intelligenceDismissUnsubscribe?.(); } catch { /* isolate */ }
    try { messageUnsubscribe?.(); } catch { /* isolate */ }
    try { approvalResponseUnsubscribe?.(); } catch { /* isolate */ }
    try { client?.disconnect(); } catch { /* isolate */ }
    statusUnsubscribe = null;
    busUnsubscribe = null;
    intelligenceDismissUnsubscribe = null;
    messageUnsubscribe = null;
    approvalResponseUnsubscribe = null;
    client = null;
    currentArgs = null;
    lastStatus = 'idle';
    lifecycle = 'idle';
  }
}

/**
 * Stop the adapter. Safe:
 *   - No-op when already idle.
 *   - Unsubscribes the bus listener BEFORE tearing down the client so a
 *     final in-flight event can't trip on a half-torn-down socket.
 */
export function stopCompanionBridgeAdapter(): void {
  if (lifecycle === 'idle' || lifecycle === 'stopping') {
    return;
  }
  lifecycle = 'stopping';

  // Bus first — no more outbound translations after this point.
  if (busUnsubscribe) {
    try { busUnsubscribe(); } catch { /* isolate */ }
    busUnsubscribe = null;
  }

  // Inbound intelligence dismissal listener.
  if (intelligenceDismissUnsubscribe) {
    try { intelligenceDismissUnsubscribe(); } catch { /* isolate */ }
    intelligenceDismissUnsubscribe = null;
  }

  // Inbound message listener (R-COMPANION-MESSAGING-SIMPLE-V1).
  if (messageUnsubscribe) {
    try { messageUnsubscribe(); } catch { /* isolate */ }
    messageUnsubscribe = null;
  }

  // Inbound approval response listener (observe-only — Phase 1).
  if (approvalResponseUnsubscribe) {
    try { approvalResponseUnsubscribe(); } catch { /* isolate */ }
    approvalResponseUnsubscribe = null;
  }

  // Status listener.
  if (statusUnsubscribe) {
    try { statusUnsubscribe(); } catch { /* isolate */ }
    statusUnsubscribe = null;
  }

  // Bridge transport.
  if (client) {
    try { client.disconnect(); } catch { /* isolate */ }
    client = null;
  }

  currentArgs = null;
  lastStatus = 'idle';
  lifecycle = 'idle';
  // R-COMPANION-BRIDGE-DEDUP-V1 — clear dedup cache so a fresh start has
  // a clean slate (operator may legitimately re-emit an old event id).
  resetProcessedEventCache();
  console.info('[companion-bridge-adapter] stopped');
}

/** Current PosBridgeStatus. Returns 'idle' when stopped. */
export function getBridgeAdapterStatus(): PosBridgeStatus {
  return lastStatus;
}

/** True when the adapter is fully started (bus subscribed, client owned). */
export function isCompanionBridgeAdapterStarted(): boolean {
  return lifecycle === 'started';
}

/**
 * R-COMPANION-MESSAGING-SIMPLE-V1 — send a message from the desktop POS
 * to the mobile Companion via the bridge. Emits message:new to the store
 * room AND fires MESSAGE_SENT on the local bus so CompanionCenter reflects
 * the outbound message immediately.
 *
 * Returns true when the emit was attempted (socket connected), false otherwise.
 * Caller is responsible for showing a toast if false.
 */
export function sendCompanionMessage(
  content: string,
  senderId: string,
  senderName: string,
  opCategory?: CompanionOpCategory,
): boolean {
  if (!client || client.getStatus() !== 'connected' || !currentArgs) return false;
  const socket = client.getSocket();
  const msgId = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload: NewMessagePayload = {
    id: msgId,
    threadId: 'store-general',
    storeId: currentArgs.storeId,
    senderId,
    senderName,
    senderRole: 'employee',
    content,
    timestamp: new Date().toISOString(),
  };
  socket.emit(SDK_EVENTS.MESSAGE_NEW, payload);
  // Reflect outbound on local bus so the runtime + CompanionCenter update.
  const preview = content.length > 80 ? `${content.slice(0, 77)}…` : content;
  emitToBus({
    type: 'MESSAGE_SENT',
    category: 'messaging',
    payload: {
      messageId: msgId,
      fromEmployeeId: senderId,
      senderName,
      senderType: 'desktop',
      channel: 'internal',
      direction: 'outbound',
      conversationId: 'store-general',
      category: opCategory,
      preview,
      body: content,
      text: content,
    },
    createdAt: Date.now(),
  });
  console.info(
    `[companion-bridge-adapter] outbound MESSAGE_NEW id=${msgId} from=${senderId} cat=${opCategory ?? 'operations'}`,
  );
  return true;
}

/**
 * R-COMPANION-MOBILE-DASHBOARD-REAL-DATA-V1 — push a live store snapshot
 * to the mobile Companion dashboard. Emits dashboard:stats_updated directly
 * to the bridge socket (same pattern as sendCompanionMessage).
 *
 * Returns true when the emit was attempted (socket connected), false otherwise.
 * CompanionCenter calls this in a useEffect whenever store data changes.
 */
export function emitStoreSnapshot(payload: StoreSnapshotPayload): boolean {
  if (!client || client.getStatus() !== 'connected' || !currentArgs) return false;
  const socket = client.getSocket();
  socket.emit(SDK_EVENTS.DASHBOARD_STATS_UPDATED, payload);
  console.info(
    `[companion-bridge-adapter] outbound DASHBOARD_STATS_UPDATED storeId=${payload.storeId} revenueCents=${payload.todayRevenueCents} sales=${payload.todaySalesCount}`,
  );
  return true;
}

/**
 * Internal: forward a single CompanionEvent through the adapter without
 * re-routing through the bus. Used by companionMockBridge.setConnectionState
 * to drain queued events on connect → avoids losing events that were
 * emitted while disconnected. Safe to call when adapter is not started —
 * becomes a no-op via handleEvent's client guard.
 */
export function _drainCompanionEvent(event: CompanionEvent): void {
  handleEvent(event);
}
