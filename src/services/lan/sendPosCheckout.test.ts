import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Sale } from '@/store/types';
import { sendPosCheckout } from './lanService';

// sendPosCheckout needs Electron + a paired Secondary connection. Stub both
// (vitest runs in `node`, so window/localStorage are absent by default).
let captured: { operationId?: string } | null = null;

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
  localStorage.setItem('cellhub:lan:connection:v1', JSON.stringify({
    role: 'secondary', primaryUrl: 'http://192.168.1.5:47615', token: 'tok',
  }));
  captured = null;
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      lanGetStatus: () => ({ running: true }),
      lanSendOperation: async (req: { operation: { operationId: string } }) => {
        captured = req.operation;
        return { ok: true, saleId: 's1' };
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

const sampleSale = (): Sale => ({ id: 'sale-1', items: [{ id: 'i', category: 'accessory', price: 100, qty: 1 }] } as unknown as Sale);

describe('sendPosCheckout operationId (R-LAN-POS-CHECKOUT-FORWARDING-FIX-2)', () => {
  it('uses the caller-provided operationId (retry stability)', async () => {
    const ack = await sendPosCheckout(sampleSale(), 'op-FIXED');
    expect(ack.ok).toBe(true);
    expect(captured?.operationId).toBe('op-FIXED');
  });

  it('generates an operationId when none is provided', async () => {
    await sendPosCheckout(sampleSale());
    expect(captured?.operationId).toBeTruthy();
    expect(captured?.operationId).not.toBe('op-FIXED');
  });

  it('reuses the same operationId across two retry calls', async () => {
    await sendPosCheckout(sampleSale(), 'op-RETRY');
    const first = captured?.operationId;
    await sendPosCheckout(sampleSale(), 'op-RETRY');
    expect(first).toBe('op-RETRY');
    expect(captured?.operationId).toBe('op-RETRY');
  });
});
