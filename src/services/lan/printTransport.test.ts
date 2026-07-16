// ============================================================
// R-PRINT-SERVER-V1.2 — normalized LAN print transport outcome tests.
//
// The duplicate-print rule under test: automatic local fallback is allowed
// EXCLUSIVELY when the transport PROVES the request was never dispatched to
// a reachable Primary (delivery:'not_sent'). Anything after dispatch began
// — timeout, socket rejection, garbled/missing response, thrown invoke
// exception — is delivery:'unknown' and must NEVER print locally.
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dispatchPrintOperation, sendSilentReceipt, submitPrintJob } from './printServerClient';
import { decidePrintRecovery } from '@/services/print/printGating';
import { stablePrinterId } from './printBridge';
// @ts-expect-error — CJS main-process module without type declarations.
import lanPairing from '../../../electron/lanPairing.js';

// ── window / localStorage / electronAPI stubs (vitest env = node) ──
const store = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

type SendOp = (opts: { primaryUrl: string; token: string; operation: LanOperation }) => Promise<LanOperationAck>;
let lanSendOperation: SendOp;

function pairAsSecondary(): void {
  store.set('cellhub:lan:connection:v1', JSON.stringify({
    role: 'secondary', primaryUrl: 'http://192.168.1.50:47615', token: 'tok', primaryName: 'Front',
  }));
}

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: typeof fakeLocalStorage }).localStorage = fakeLocalStorage;
  lanSendOperation = () => Promise.resolve({ ok: true });
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { electronAPI: unknown }).electronAPI = {
    lanGetStatus: () => Promise.resolve({ running: false }),
    lanSendOperation: (opts: { primaryUrl: string; token: string; operation: LanOperation }) => lanSendOperation(opts),
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).electronAPI;
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('dispatchPrintOperation — proven not_sent (preflight, before dispatch)', () => {
  it('missing Electron API → not_sent (request was never constructible)', async () => {
    delete (globalThis as Record<string, unknown>).electronAPI;
    const out = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out).toEqual({ ok: false, delivery: 'not_sent', error: 'not_electron' });
  });

  it('no pairing / no Primary URL → not_sent', async () => {
    // No connection record at all:
    const out = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out).toEqual({ ok: false, delivery: 'not_sent', error: 'not_paired' });
    // Paired record missing the URL:
    store.set('cellhub:lan:connection:v1', JSON.stringify({ role: 'secondary', token: 'tok' }));
    const out2 = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out2).toEqual({ ok: false, delivery: 'not_sent', error: 'not_paired' });
  });

  it('post-dispatch connection-refused/unreachable (no TCP connection) → not_sent', async () => {
    pairAsSecondary();
    lanSendOperation = () => Promise.resolve({ ok: false, error: 'unreachable' });
    const out = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out).toEqual({ ok: false, delivery: 'not_sent', error: 'unreachable' });
  });
});

describe('dispatchPrintOperation — unknown (dispatch began, outcome unproven)', () => {
  beforeEach(pairAsSecondary);

  it('timeout after dispatch began → unknown, NEVER not_sent', async () => {
    lanSendOperation = () => Promise.resolve({ ok: false, error: 'timeout' });
    const out = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out).toEqual({ ok: false, delivery: 'unknown', error: 'timeout' });
  });

  it('generic network error (e.g. socket reset AFTER bytes were sent) → unknown', async () => {
    lanSendOperation = () => Promise.resolve({ ok: false, error: 'network_error' });
    const out = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out).toEqual({ ok: false, delivery: 'unknown', error: 'network_error' });
  });

  it('unreadable / missing / garbled response → unknown', async () => {
    lanSendOperation = () => Promise.resolve({ ok: false, error: 'bad_response' });
    expect(await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {}))
      .toEqual({ ok: false, delivery: 'unknown', error: 'bad_response' });
    lanSendOperation = () => Promise.resolve(null as unknown as LanOperationAck);
    expect(await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {}))
      .toEqual({ ok: false, delivery: 'unknown', error: 'bad_response' });
    lanSendOperation = () => Promise.resolve({ ok: false } as LanOperationAck); // no error code at all
    expect((await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {}) as { delivery: string }).delivery).toBe('unknown');
  });

  it('a THROWN invoke exception after dispatch began → unknown (a throw is not proof of non-delivery)', async () => {
    lanSendOperation = () => Promise.reject(new Error('IPC channel closed'));
    const out = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out).toEqual({ ok: false, delivery: 'unknown', error: 'IPC channel closed' });
  });
});

describe('dispatchPrintOperation — delivery proven (Primary answered)', () => {
  beforeEach(pairAsSecondary);

  it('an explicit Primary rejection stays ok:true (NOT unknown, NOT not_sent)', async () => {
    lanSendOperation = () => Promise.resolve({ ok: false, error: 'no_report_printer' });
    const out = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out).toEqual({ ok: true, ack: { ok: false, error: 'no_report_printer' } });
    expect(decidePrintRecovery(out)).toBe('rejected'); // never local, never unknown
  });

  it('an accepted job is ok:true with the ack', async () => {
    lanSendOperation = () => Promise.resolve({ ok: true, jobId: 'j1', queuePosition: 2 });
    const out = await dispatchPrintOperation('LAN_PRINT_SUBMIT', {});
    expect(out.ok).toBe(true);
    expect(decidePrintRecovery(out)).toBe('printed');
  });
});

describe('decidePrintRecovery — the only path to automatic local printing is proven not_sent', () => {
  it('not_sent → fallback_local (safe: nothing was dispatched)', () => {
    expect(decidePrintRecovery({ ok: false, delivery: 'not_sent', error: 'not_paired' })).toBe('fallback_local');
    expect(decidePrintRecovery({ ok: false, delivery: 'not_sent', error: 'unreachable' })).toBe('fallback_local');
  });
  it('unknown → status_unknown (NEVER local — the Primary may have printed it)', () => {
    expect(decidePrintRecovery({ ok: false, delivery: 'unknown', error: 'timeout' })).toBe('status_unknown');
    expect(decidePrintRecovery({ ok: false, delivery: 'unknown', error: 'transport_exception' })).toBe('status_unknown');
  });
  it('an UNNORMALIZED failure shape defaults to status_unknown, never local', () => {
    expect(decidePrintRecovery({ ok: false } as { ok: false })).toBe('status_unknown');
    expect(decidePrintRecovery({ ok: false, error: 'mystery' })).toBe('status_unknown');
  });
  it('explicit Primary rejection → rejected (shown to the user, no local print)', () => {
    expect(decidePrintRecovery({ ok: true, ack: { ok: false, error: 'printer_not_found' } })).toBe('rejected');
  });
});

describe('jobId retention across outcomes', () => {
  beforeEach(pairAsSecondary);

  const receipt = { receiptType: 'pos_receipt', html: '<p>r</p>', copies: 1 };

  it('silent receipt: the SAME caller jobId rides the wire for unknown outcomes (dedup-able retry)', async () => {
    const sent: string[] = [];
    lanSendOperation = (opts) => {
      sent.push(String((opts.operation.payload.print as { printJobId?: string })?.printJobId || ''));
      return Promise.resolve({ ok: false, error: 'timeout' });
    };
    const out1 = await sendSilentReceipt(receipt, 'pj-fixed-1');
    expect(out1).toMatchObject({ ok: false, delivery: 'unknown' });
    // The deliberate retry decision reuses the SAME id → Primary queue dedups.
    await sendSilentReceipt(receipt, 'pj-fixed-1');
    expect(sent).toEqual(['pj-fixed-1', 'pj-fixed-1']);
  });

  it('modal submit: the caller-created jobId is on the wire and preserved for unknown outcomes', async () => {
    const sent: string[] = [];
    lanSendOperation = (opts) => {
      sent.push(String((opts.operation.payload.printSubmit as { jobId?: string })?.jobId || ''));
      return Promise.reject(new Error('socket hang up')); // thrown AFTER dispatch began
    };
    const out = await submitPrintJob({
      receiptType: 'report', html: '<h1>R</h1>', copies: 1,
      printerId: stablePrinterId('Canon'), printerName: 'Canon', jobId: 'pj-keep-9',
    });
    expect(out).toMatchObject({ ok: false, delivery: 'unknown' });
    expect(decidePrintRecovery(out)).toBe('status_unknown'); // never auto-local
    expect(sent).toEqual(['pj-keep-9']);
  });

  it('submit validation failure (nothing built) → not_sent', async () => {
    const out = await submitPrintJob({
      receiptType: 'report', html: '<h1>R</h1>', copies: 1,
      printerId: '', jobId: 'x',
    });
    expect(out).toEqual({ ok: false, delivery: 'not_sent', error: 'no_printer_selected' });
  });
});

// ── R-2.1.4-FINAL-REBUILD: the REAL electron main error mapping ────────
// Direct tests against electron/lanPairing.js — not a mock. 'unreachable'
// may ONLY come from connection-ESTABLISHMENT failures (no request could
// have reached the Primary). Everything else stays a generic ambiguous code.
describe('lanPairing.classifyOperationTransportError — real main-process mapping', () => {
  it('connection-establishment failures (handshake never completed) → unreachable', () => {
    for (const code of ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']) {
      expect(lanPairing.classifyOperationTransportError(code)).toBe('unreachable');
    }
  });

  it('post-dispatch socket errors are NEVER unreachable — generic network_error (→ delivery unknown)', () => {
    for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED', 'ERR_STREAM_DESTROYED', 'EAI_AGAIN', undefined, null, '']) {
      expect(lanPairing.classifyOperationTransportError(code)).toBe('network_error');
    }
  });

  it('the renderer transport maps the real main codes onto the outcome contract coherently', async () => {
    pairAsSecondary();
    // Real main code for a refused connection → proven not_sent:
    lanSendOperation = () => Promise.resolve({ ok: false, error: lanPairing.classifyOperationTransportError('ECONNREFUSED') });
    expect(await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {}))
      .toEqual({ ok: false, delivery: 'not_sent', error: 'unreachable' });
    // Real main code for a post-dispatch reset → unknown (never local):
    lanSendOperation = () => Promise.resolve({ ok: false, error: lanPairing.classifyOperationTransportError('ECONNRESET') });
    const out = await dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {});
    expect(out).toEqual({ ok: false, delivery: 'unknown', error: 'network_error' });
    expect(decidePrintRecovery(out)).toBe('status_unknown');
  });
});
