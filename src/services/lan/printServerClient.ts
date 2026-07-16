// ============================================================
// R-PRINT-SERVER-V1 — Secondary-side print-server client.
//
// When a Primary exists, a Secondary behaves like a workstation on a network
// print server: its print modal lists the PRIMARY's printers, the user picks
// one, and ONE complete job is submitted (LAN_PRINT_SUBMIT). The Primary
// queues + executes it; this client polls LAN_PRINT_STATUS_REQUEST until the
// job reaches a terminal state and emits progress events for the toast layer.
//
// Printer discovery cache: refreshed on connect/reconnect (mirror state
// transitions), on manual refresh (modal button), and on modal open. Cached
// in localStorage so the picker paints instantly on the next open.
//
// Transport: the existing authenticated /operation channel (Bearer token +
// same-LAN gate in electron main). No new HTTP surface.
// ============================================================
import { getConnection, isElectron } from './lanService';
import type { LanPrinterInfo } from './printBridge';
import { buildLanPrintSubmit } from './printBridge';
import type { LanPrintSubmitInput } from './printBridge';
import { subscribeMirror, getMirrorStatus } from './lanMirror';

const CACHE_KEY = 'cellhub:lan:primaryPrinters:v1';
const STATUS_POLL_MS = 1000;      // client-side status poll (NOT the queue — the
                                  // Primary queue itself is purely promise-chained)
const TRACK_TIMEOUT_MS = 180000;  // stop polling a job after 3 min (job "lost")

export interface PrimaryPrinterCache {
  printers: LanPrinterInfo[];
  primaryName: string;
  fetchedAt: number;
}

// ── Discovery cache (module state + localStorage + pub/sub) ──

let _cache: PrimaryPrinterCache | null = null;
let _fetching: Promise<{ ok: boolean; error?: string; cache?: PrimaryPrinterCache }> | null = null;
const _subs = new Set<(c: PrimaryPrinterCache | null) => void>();

function loadStoredCache(): PrimaryPrinterCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrimaryPrinterCache;
    if (!Array.isArray(parsed.printers)) return null;
    return parsed;
  } catch { return null; }
}

function storeCache(c: PrimaryPrinterCache): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function getPrimaryPrinterCache(): PrimaryPrinterCache | null {
  if (!_cache) _cache = loadStoredCache();
  return _cache;
}

export function clearPrimaryPrinterCache(): void {
  _cache = null;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  _subs.forEach((cb) => { try { cb(null); } catch { /* ignore */ } });
}

/** Subscribe to printer-cache changes. Fires immediately with the current
 *  cache. Returns unsubscribe. */
export function subscribePrimaryPrinters(cb: (c: PrimaryPrinterCache | null) => void): () => void {
  _subs.add(cb);
  try { cb(getPrimaryPrinterCache()); } catch { /* ignore */ }
  return () => { _subs.delete(cb); };
}

function announce(c: PrimaryPrinterCache): void {
  _cache = c;
  storeCache(c);
  _subs.forEach((cb) => { try { cb(c); } catch { /* ignore */ } });
}

function sendOp(type: LanOperation['type'], payload: LanOperation['payload']): Promise<LanOperationAck> {
  if (!isElectron() || !window.electronAPI?.lanSendOperation) return Promise.resolve({ ok: false, error: 'not_electron' });
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) return Promise.resolve({ ok: false, error: 'not_paired' });
  const operation: LanOperation = {
    operationId: `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    payload,
    deviceId: conn.deviceId,
    createdAt: Date.now(),
  };
  return window.electronAPI.lanSendOperation({ primaryUrl: conn.primaryUrl, token: conn.token, operation });
}

/**
 * Fetch the Primary's printer inventory. Coalesces concurrent calls into one
 * wire request. Updates + announces the cache on success; on failure the last
 * good cache is kept (the UI may still submit — the Primary re-validates).
 */
export function fetchPrimaryPrinters(): Promise<{ ok: boolean; error?: string; cache?: PrimaryPrinterCache }> {
  if (_fetching) return _fetching;
  _fetching = (async () => {
    try {
      const ack = await sendOp('LAN_PRINTER_LIST_REQUEST', {});
      if (!ack.ok || !Array.isArray(ack.printers)) {
        return { ok: false, error: ack.error || 'printer_list_failed' };
      }
      const cache: PrimaryPrinterCache = {
        printers: ack.printers as LanPrinterInfo[],
        primaryName: String(ack.primaryName || getConnection().primaryName || 'Primary'),
        fetchedAt: Date.now(),
      };
      announce(cache);
      return { ok: true, cache };
    } finally {
      _fetching = null;
    }
  })();
  return _fetching;
}

// ── Auto-refresh on connect / reconnect ──────────────────────

let _watcherStarted = false;
let _lastConnState: string | null = null;

/** Start the mirror watcher that refreshes the printer cache whenever the
 *  Secondary (re)connects to its Primary. Idempotent; call from a globally
 *  mounted component. Returns a stop fn. */
export function startPrinterCacheWatcher(): () => void {
  if (_watcherStarted) return () => { /* already running */ };
  _watcherStarted = true;
  const unsub = subscribeMirror((s) => {
    const state = s.connState;
    const cameOnline = (state === 'connected' || state === 'reconnected') && _lastConnState !== 'connected' && _lastConnState !== 'reconnected';
    _lastConnState = state;
    if (!s.active) return;
    if (cameOnline && getConnection().role === 'secondary') {
      void fetchPrimaryPrinters();
    }
  });
  return () => { _watcherStarted = false; unsub(); };
}

// ── Job submit + tracking ────────────────────────────────────

export interface PrintJobProgress {
  jobId: string;
  state: 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled' | 'lost';
  ahead: number;
  error?: string;
}

export function generatePrintJobId(): string {
  return `pj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Submit one complete print job to the Primary. Resolves with the enqueue
 *  ACK (jobId + queue position) — NOT with print completion. */
export async function submitPrintJob(input: LanPrintSubmitInput): Promise<LanOperationAck> {
  const built = buildLanPrintSubmit(input);
  if (!built.ok) return { ok: false, error: built.error };
  return sendOp('LAN_PRINT_SUBMIT', { printSubmit: built.job as unknown as LanPrintSubmitPayload });
}

/** Ask the Primary for one job's live status. */
export async function fetchJobStatus(jobId: string): Promise<LanOperationAck> {
  return sendOp('LAN_PRINT_STATUS_REQUEST', { jobRef: { jobId } });
}

/** Cancel a still-queued job on the Primary. */
export async function cancelPrintJob(jobId: string): Promise<LanOperationAck> {
  return sendOp('LAN_PRINT_CANCEL_REQUEST', { jobRef: { jobId } });
}

/**
 * Poll the job until it reaches a terminal state, invoking onProgress on
 * every STATE TRANSITION (queued position changes included). Resolves with
 * the final progress. Poll errors are tolerated (the Primary may be busy);
 * a job unseen for TRACK_TIMEOUT_MS resolves as 'lost'.
 */
export function trackPrintJob(
  jobId: string,
  onProgress?: (p: PrintJobProgress) => void,
): Promise<PrintJobProgress> {
  const startedAt = Date.now();
  let lastSig = '';
  return new Promise<PrintJobProgress>((resolve) => {
    const emit = (p: PrintJobProgress): void => {
      const sig = `${p.state}:${p.ahead}`;
      if (sig !== lastSig) {
        lastSig = sig;
        try { onProgress?.(p); } catch { /* ignore */ }
      }
    };
    const poll = async (): Promise<void> => {
      if (Date.now() - startedAt > TRACK_TIMEOUT_MS) {
        const lost: PrintJobProgress = { jobId, state: 'lost', ahead: 0, error: 'status_timeout' };
        emit(lost);
        resolve(lost);
        return;
      }
      let ack: LanOperationAck | null = null;
      try { ack = await fetchJobStatus(jobId); } catch { ack = null; }
      const js = ack && ack.ok ? ack.jobStatus : null;
      if (js) {
        const p: PrintJobProgress = {
          jobId,
          state: js.state,
          ahead: Number(js.ahead) || 0,
          error: js.error,
        };
        emit(p);
        if (js.state === 'completed' || js.state === 'failed' || js.state === 'cancelled') {
          resolve(p);
          return;
        }
      } else if (ack && !ack.ok && ack.error === 'job_not_found') {
        // Primary restarted / job pruned — report as lost, never hang.
        const lost: PrintJobProgress = { jobId, state: 'lost', ahead: 0, error: 'job_not_found' };
        emit(lost);
        resolve(lost);
        return;
      }
      window.setTimeout(() => { void poll(); }, STATUS_POLL_MS);
    };
    void poll();
  });
}
