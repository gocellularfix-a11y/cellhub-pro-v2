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
import { buildLanPrintSubmit, buildLanPrintJob } from './printBridge';
import type { LanPrintSubmitInput, LanPrintJobInput } from './printBridge';
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

// ── R-PRINT-SERVER-V1.2: normalized transport outcome contract ──────
// A raw ack/exception does NOT say whether the request reached the Primary.
// EVERY LAN print operation dispatches through dispatchPrintOperation, which
// normalizes the outcome into an explicit, testable three-way contract:
//
//   { ok: true, ack }                       — the Primary's HTTP response was
//       received. ack.ok may still be false (an EXPLICIT Primary rejection,
//       e.g. printer_not_found / no_report_printer) — delivery is proven.
//   { ok: false, delivery: 'not_sent' }     — the transport can PROVE the
//       request was never dispatched to a reachable Primary (preflight
//       failure, no pairing, missing Electron API, URL construction failure,
//       TCP connection refused/host unreachable — no connection was ever
//       established). ONLY this outcome permits automatic local fallback.
//   { ok: false, delivery: 'unknown' }      — the request MAY have reached
//       the Primary (timeout, socket reset after dispatch began, unreadable/
//       missing response, dispatcher timeout, any unproven error). This
//       outcome must NEVER automatically print locally — duplicate risk.
//
// Proof model: preflight failures return not_sent BEFORE the invoke starts
// (dispatchStarted=false). Once the invoke begins, only error codes that
// prove no connection was established ('bad_url' — request never built;
// 'unreachable' — ECONNREFUSED/EHOSTUNREACH, the TCP handshake failed, so
// no bytes carried the operation) map to not_sent. Every other post-dispatch
// error — including the generic 'network_error' (e.g. ECONNRESET, which can
// occur AFTER the request was transmitted), 'timeout', 'bad_response', a
// null/garbled ack, or a thrown invoke exception — is 'unknown'.

export type LanDispatchOutcome =
  | { ok: true; ack: LanOperationAck }
  | { ok: false; delivery: 'not_sent'; error: string }
  | { ok: false; delivery: 'unknown'; error: string };

/** Post-dispatch transport error codes (from electron main's HTTP client)
 *  that PROVE the connection was never established → nothing was sent. */
const PROVEN_NOT_SENT = new Set(['bad_url', 'unreachable']);
/** Transport-level codes surfaced in the ack body by main's HTTP client —
 *  the outcome is unproven (the request may have been transmitted). */
const TRANSPORT_UNKNOWN = new Set(['timeout', 'network_error', 'bad_response']);

export async function dispatchPrintOperation(
  type: LanOperation['type'],
  payload: LanOperation['payload'],
): Promise<LanDispatchOutcome> {
  // Preflight — provably nothing has been dispatched yet.
  if (!isElectron() || !window.electronAPI?.lanSendOperation) {
    return { ok: false, delivery: 'not_sent', error: 'not_electron' };
  }
  const conn = getConnection();
  if (conn.role !== 'secondary' || !conn.primaryUrl || !conn.token) {
    return { ok: false, delivery: 'not_sent', error: 'not_paired' };
  }
  const operation: LanOperation = {
    operationId: `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    payload,
    deviceId: conn.deviceId,
    createdAt: Date.now(),
  };
  let dispatchStarted = false;
  try {
    dispatchStarted = true;
    const ack = await window.electronAPI.lanSendOperation({ primaryUrl: conn.primaryUrl, token: conn.token, operation });
    if (!ack || typeof ack !== 'object') return { ok: false, delivery: 'unknown', error: 'bad_response' };
    if (!ack.ok) {
      const err = String(ack.error || '');
      if (PROVEN_NOT_SENT.has(err)) return { ok: false, delivery: 'not_sent', error: err };
      if (TRANSPORT_UNKNOWN.has(err) || !err) return { ok: false, delivery: 'unknown', error: err || 'bad_response' };
      // Any other error code came FROM the Primary's own response body —
      // delivery is proven; surface it as an explicit app-level rejection.
      return { ok: true, ack };
    }
    return { ok: true, ack };
  } catch (err) {
    // A thrown exception is NOT proof that nothing crossed the LAN — the
    // invoke may have failed after the request was transmitted. Only a
    // throw BEFORE dispatch began could be not_sent.
    if (!dispatchStarted) return { ok: false, delivery: 'not_sent', error: 'dispatch_setup_failed' };
    return { ok: false, delivery: 'unknown', error: (err as Error)?.message || 'transport_exception' };
  }
}

/** Legacy ack adapter for internal polling paths (printer list / status /
 *  cancel), where an unknown-vs-not_sent distinction only means "retry". */
async function sendOp(type: LanOperation['type'], payload: LanOperation['payload']): Promise<LanOperationAck> {
  const outcome = await dispatchPrintOperation(type, payload);
  if (outcome.ok) return outcome.ack;
  return { ok: false, error: outcome.error };
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
 *  ACK (jobId + queue position) — NOT with print completion.
 *  R-PRINT-SERVER-V1.2: returns the NORMALIZED transport outcome so the
 *  caller can distinguish a proven-undelivered submit (safe local fallback)
 *  from an unknown one (never duplicate). The caller-supplied jobId is
 *  created BEFORE dispatch and retained across every outcome — a retry
 *  decision reuses it, and the Primary queue dedups by it. */
export async function submitPrintJob(input: LanPrintSubmitInput): Promise<LanDispatchOutcome> {
  const built = buildLanPrintSubmit(input);
  // Validation failure = provably nothing dispatched.
  if (!built.ok) return { ok: false, delivery: 'not_sent', error: built.error };
  return dispatchPrintOperation('LAN_PRINT_SUBMIT', { printSubmit: built.job as unknown as LanPrintSubmitPayload });
}

/** R-PRINT-SERVER-V1.2: silent receipt bridge (media-routed on the Primary,
 *  no picker) through the SAME normalized transport. The caller supplies the
 *  jobId (wire printJobId) BEFORE dispatch; the Primary's main-process queue
 *  dedups on it, so a deliberate retry of an unknown outcome can never
 *  double-print. */
export async function sendSilentReceipt(
  input: LanPrintJobInput,
  jobId: string,
): Promise<LanDispatchOutcome> {
  const built = buildLanPrintJob(input);
  if (!built.ok) return { ok: false, delivery: 'not_sent', error: built.error };
  return dispatchPrintOperation('LAN_PRINT_RECEIPT_REQUEST', {
    print: {
      ...built.job,
      printJobId: jobId,
      timestamp: Date.now(),
    } as unknown as LanPrintReceiptPayload,
  });
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
