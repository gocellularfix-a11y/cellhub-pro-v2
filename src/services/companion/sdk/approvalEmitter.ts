/**
 * CellHub Desktop POS — Approval Emitter
 *
 * Now socket-injected: shares the connection owned by posBridgeClient.
 * Drop this file alongside posBridgeClient and call from approval handlers.
 *
 * Integration:
 *   const client = createPosBridgeClient({...});
 *   initApprovalEmitter(client);
 *   approvalEmitter.created(...)
 *   approvalEmitter.expired(...)
 *   approvalEmitter.onResponse(callback)
 */

import { EVENTS } from './events';
import type {
  ApprovalRequestPayload,
  ApprovalResponsePayload,
  ApprovalExpiredPayload,
} from './payloads';
import type { PosBridgeClient } from './posBridgeClient';

let _client: PosBridgeClient | null = null;

// Inbound response dedup: key = `${event}:${requestId}` → lastSeenAt (ms).
// Protects against duplicate broadcasts (multi-manager scenarios, network
// retries, socket replays) firing the consumer callback more than once.
const DEDUP_WINDOW_MS = 60_000;
const seenResponses = new Map<string, number>();

function pruneSeen(now: number): void {
  for (const [k, t] of seenResponses) {
    if (now - t > DEDUP_WINDOW_MS) seenResponses.delete(k);
  }
}

function isDuplicate(event: string, requestId: string): boolean {
  const now = Date.now();
  pruneSeen(now);
  const key = `${event}:${requestId}`;
  const last = seenResponses.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return true;
  seenResponses.set(key, now);
  return false;
}

function requireClient(): PosBridgeClient {
  if (!_client) {
    throw new Error('ApprovalEmitter: not initialized. Call initApprovalEmitter(client) first.');
  }
  return _client;
}

export function initApprovalEmitter(client: PosBridgeClient): void {
  _client = client;
}

export const approvalEmitter = {
  /**
   * Call when an employee triggers an action requiring manager approval.
   * Caller is responsible for supplying a stable `id` (used for bridge dedup).
   */
  created(payload: Omit<ApprovalRequestPayload, 'storeId'>): void {
    const client = requireClient();
    const socket = client.getSocket();
    if (!socket.connected) return;
    socket.emit(EVENTS.APPROVAL_CREATED, { ...payload, storeId: client.getStoreId() });
  },

  /**
   * Notify all parties that an approval request has timed out on the POS side.
   */
  expired(requestId: string): void {
    const client = requireClient();
    const socket = client.getSocket();
    if (!socket.connected) return;
    const p: ApprovalExpiredPayload = {
      requestId,
      storeId: client.getStoreId(),
      expiredAt: new Date().toISOString(),
    };
    socket.emit(EVENTS.APPROVAL_EXPIRED, p);
  },

  /**
   * Register a callback for manager responses. Deduped by requestId within a
   * 60s window so duplicate broadcasts do not cause double-callback invocation.
   */
  onResponse(callback: (payload: ApprovalResponsePayload) => void): () => void {
    const client = requireClient();
    const socket = client.getSocket();

    const dedupedHandler = (event: string) => (p: ApprovalResponsePayload) => {
      if (!p || typeof p.requestId !== 'string') return;
      if (isDuplicate(event, p.requestId)) return;
      callback(p);
    };

    const onApproved = dedupedHandler(EVENTS.APPROVAL_APPROVED);
    const onDenied   = dedupedHandler(EVENTS.APPROVAL_DENIED);
    const onExplain  = dedupedHandler(EVENTS.APPROVAL_EXPLANATION_REQUESTED);

    socket.on(EVENTS.APPROVAL_APPROVED, onApproved);
    socket.on(EVENTS.APPROVAL_DENIED, onDenied);
    socket.on(EVENTS.APPROVAL_EXPLANATION_REQUESTED, onExplain);

    return () => {
      socket.off(EVENTS.APPROVAL_APPROVED, onApproved);
      socket.off(EVENTS.APPROVAL_DENIED, onDenied);
      socket.off(EVENTS.APPROVAL_EXPLANATION_REQUESTED, onExplain);
    };
  },
};
