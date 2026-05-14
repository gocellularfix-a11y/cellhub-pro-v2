/**
 * R-BRIDGE-V5 — Shared POS Bridge Client
 *
 * Single socket.io-client transport for POS-side integrations. Owns one
 * socket connection, re-authenticates on every reconnect, exposes a clean
 * status/reject lifecycle so feature emitters (approval/message/intelligence)
 * can share one auth context.
 *
 * Drop this file into the external CellHub POS codebase; combine with
 * approvalEmitter / messageEmitter / intelligenceEmitter for full coverage.
 */

import { io, Socket } from 'socket.io-client';
import { EVENTS } from './events';
import type { RegisterPayload, RejectedPayload } from './payloads';

export type PosBridgeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'rejected';

export interface PosBridgeClientConfig {
  bridgeUrl: string;
  storeId: string;
  deviceId: string;
  authToken: string;
}

export interface PosBridgeClient {
  getSocket(): Socket;
  getStoreId(): string;
  getStatus(): PosBridgeStatus;
  onStatus(listener: (status: PosBridgeStatus) => void): () => void;
  onReject(listener: (reason: string) => void): () => void;
  disconnect(): void;
}

const RECONNECT_DELAY_MS     = 1_000;
const RECONNECT_DELAY_MAX_MS = 30_000;

export function createPosBridgeClient(config: PosBridgeClientConfig): PosBridgeClient {
  let status: PosBridgeStatus = 'idle';
  const statusListeners = new Set<(s: PosBridgeStatus) => void>();
  const rejectListeners = new Set<(reason: string) => void>();
  let disposed = false;

  function setStatus(next: PosBridgeStatus): void {
    if (status === next) return;
    status = next;
    for (const l of statusListeners) {
      try { l(next); } catch { /* isolate listener errors */ }
    }
  }

  setStatus('connecting');

  const socket: Socket = io(config.bridgeUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: RECONNECT_DELAY_MS,
    reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
  });

  const register: RegisterPayload = {
    role: 'pos',
    storeId: config.storeId,
    deviceId: config.deviceId,
    authToken: config.authToken,
  };

  socket.on('connect', () => {
    // Re-authenticate on every transport connect — covers both initial connect
    // and reconnect_attempt → reconnect cycles.
    socket.emit(EVENTS.AUTH_REGISTER, register);
  });

  socket.on(EVENTS.AUTH_REGISTERED, () => {
    setStatus('connected');
  });

  socket.on(EVENTS.AUTH_REJECTED, (payload: RejectedPayload) => {
    setStatus('rejected');
    const reason = payload?.reason ?? 'unknown';
    for (const l of rejectListeners) {
      try { l(reason); } catch { /* isolate listener errors */ }
    }
  });

  socket.on('reconnect_attempt', () => {
    if (disposed) return;
    setStatus('reconnecting');
  });

  // R-COMPANION-CORE-STABILIZATION-DIAG-V1 — surface the disconnect /
  // connect_error reason so silent drops become diagnosable. Socket.IO
  // passes `reason: string` to the disconnect handler ('transport close',
  // 'ping timeout', 'io server disconnect', 'parse error', etc.) and an
  // Error to connect_error. Before this, every drop logged only
  // "status → disconnected" with no cause.
  socket.on('disconnect', (reason: string) => {
    if (disposed) return;
    console.info(`[posBridgeClient] disconnect — reason=${reason}`);
    setStatus('disconnected');
  });

  socket.on('connect_error', (err: Error) => {
    if (disposed) return;
    console.info(`[posBridgeClient] connect_error — ${err?.message ?? 'unknown'}`);
    setStatus('disconnected');
  });

  return {
    getSocket: () => socket,
    getStoreId: () => config.storeId,
    getStatus: () => status,
    onStatus(listener) {
      statusListeners.add(listener);
      // Fire once with current status so callers don't miss an already-reached state.
      try { listener(status); } catch { /* isolate */ }
      return () => { statusListeners.delete(listener); };
    },
    onReject(listener) {
      rejectListeners.add(listener);
      return () => { rejectListeners.delete(listener); };
    },
    disconnect() {
      disposed = true;
      statusListeners.clear();
      rejectListeners.clear();
      socket.removeAllListeners();
      socket.disconnect();
      status = 'idle';
    },
  };
}
