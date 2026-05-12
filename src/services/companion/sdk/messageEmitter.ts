/**
 * CellHub Desktop POS — Message Emitter
 *
 * Socket-injected; share posBridgeClient.getSocket() across all three emitters.
 *
 * Integration points:
 *   - Employee types message to manager → messageEmitter.send(...)
 *   - Employee marks thread read → messageEmitter.markRead(...)
 *   - Listen for manager replies → messageEmitter.onNewMessage(callback)
 *   - Listen for manager read-receipts → messageEmitter.onMessageRead(callback)
 *   - Listen for thread metadata changes → messageEmitter.onThreadUpdated(callback)
 */

import type { Socket } from 'socket.io-client';
import { EVENTS } from './events';
import type { NewMessagePayload, MessageReadPayload } from './payloads';
import { v4 as uuid } from 'uuid';

let _socket: Socket | null = null;
let _storeId = '';
let _employeeId = '';
let _employeeName = '';

export function initMessageEmitter(
  socket: Socket,
  storeId: string,
  employeeId: string,
  employeeName: string
): void {
  _socket = socket;
  _storeId = storeId;
  _employeeId = employeeId;
  _employeeName = employeeName;
}

// THREAD_UPDATED has no formal payload type in payloads.ts; the bridge forwards
// whatever the originator emits. Minimum invariant: { id } identifies the thread.
type ThreadUpdatedPayload = { id: string } & Record<string, unknown>;

export const messageEmitter = {
  send(threadId: string, content: string): void {
    if (!_socket?.connected) return;
    const payload: NewMessagePayload = {
      id: uuid(),
      threadId,
      storeId: _storeId,
      senderId: _employeeId,
      senderName: _employeeName,
      senderRole: 'employee',
      content,
      timestamp: new Date().toISOString(),
    };
    _socket.emit(EVENTS.MESSAGE_NEW, payload);
  },

  markRead(threadId: string): void {
    if (!_socket?.connected) return;
    const payload: MessageReadPayload = {
      threadId,
      storeId: _storeId,
      readBy: _employeeId,
      readAt: new Date().toISOString(),
    };
    _socket.emit(EVENTS.MESSAGE_READ, payload);
  },

  onNewMessage(callback: (payload: NewMessagePayload) => void): () => void {
    if (!_socket) return () => {};
    _socket.on(EVENTS.MESSAGE_NEW, callback);
    return () => _socket?.off(EVENTS.MESSAGE_NEW, callback);
  },

  onMessageRead(callback: (payload: MessageReadPayload) => void): () => void {
    if (!_socket) return () => {};
    _socket.on(EVENTS.MESSAGE_READ, callback);
    return () => _socket?.off(EVENTS.MESSAGE_READ, callback);
  },

  onThreadUpdated(callback: (payload: ThreadUpdatedPayload) => void): () => void {
    if (!_socket) return () => {};
    _socket.on(EVENTS.THREAD_UPDATED, callback);
    return () => _socket?.off(EVENTS.THREAD_UPDATED, callback);
  },
};
