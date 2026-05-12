/**
 * CellHub Desktop POS — Intelligence Emitter
 * Integration points:
 *   - Intelligence engine creates alert → intelligenceEmitter.push(...)
 *   - Listen for manager dismissals → intelligenceEmitter.onDismissed(callback)
 */

import type { Socket } from 'socket.io-client';
import { EVENTS } from './events';
import type { IntelligenceAlertPayload, IntelligenceDismissedPayload } from './payloads';
import { v4 as uuid } from 'uuid';

let _socket: Socket | null = null;
let _storeId = '';

export function initIntelligenceEmitter(socket: Socket, storeId: string): void {
  _socket = socket;
  _storeId = storeId;
}

export const intelligenceEmitter = {
  push(alert: Omit<IntelligenceAlertPayload, 'id' | 'storeId' | 'timestamp'>): void {
    if (!_socket?.connected) return;
    const payload: IntelligenceAlertPayload = {
      ...alert,
      id: uuid(),
      storeId: _storeId,
      timestamp: new Date().toISOString(),
    };
    _socket.emit(EVENTS.INTELLIGENCE_ALERT, payload);
  },

  onDismissed(callback: (payload: IntelligenceDismissedPayload) => void): () => void {
    if (!_socket) return () => {};
    _socket.on(EVENTS.INTELLIGENCE_DISMISSED, callback);
    return () => _socket?.off(EVENTS.INTELLIGENCE_DISMISSED, callback);
  },

  // Convenience helpers for common alert types
  pushSalesWarning(metric: string, percentDrop: number): void {
    this.push({
      severity: 'warning',
      category: 'sales',
      title: `Sales pace down ${percentDrop}%`,
      recommendation: `${metric} is tracking below average. Consider a targeted promotion.`,
      suggestedAction: 'approve_promotion',
      suggestedActionLabel: 'Approve Flash Deal',
      affectedMetric: metric,
      affectedValue: -percentDrop,
    });
  },

  pushDeadStockAlert(itemCount: number, totalValue: number): void {
    this.push({
      severity: 'critical',
      category: 'inventory',
      title: `Dead stock: ${itemCount} items, $${totalValue.toFixed(2)} tied up`,
      recommendation: `${itemCount} items have not moved in 60+ days. Consider clearance or wholesale.`,
      suggestedAction: 'view_details',
      suggestedActionLabel: 'View Items',
      affectedMetric: 'dead_stock_value',
      affectedValue: totalValue,
    });
  },
};
