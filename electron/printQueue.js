// ============================================================
// CellHub Pro — Main-process print queue (R-PRINT-SERVER-V1.1)
//
// THE single serialization boundary for every call that reaches a Windows
// printer driver. Each physical printer (deviceName) owns exactly one FIFO
// lane; the same printer never executes two jobs concurrently, different
// printers execute in parallel. EVERY print path funnels through here:
//
//   Primary local modal / silent prints  → ipc print:run        → submitAndWait
//   Secondary LAN_PRINT_SUBMIT           → dispatcher           → print:queue-submit
//   Legacy LAN_PRINT_RECEIPT_REQUEST     → dispatcher           → print:run (w/ jobId)
//
// Sequencing is pure promise chaining — no timers, no sleeps, no polling.
// The queue lives in MAIN, so a renderer reload/remount never destroys an
// active queue or lets two callers race a printer.
//
// This module owns queueing/state/ownership ONLY. Physical printing remains
// the injected canonical executor (main.js executePrintRun → printPages.js)
// — there is deliberately NO second print engine here.
//
// Job ownership: every job stores the submitting deviceId. status()/cancel()
// require the caller's deviceId to match; on mismatch OR unknown job they
// return the SAME generic 'job_not_found' — a Secondary can never learn
// that (let alone cancel) another device's job exists. Local Primary jobs
// are owned by a per-boot random internal id (localDeviceId) so a LAN
// payload cannot spoof ownership of local jobs.
// ============================================================
const crypto = require('crypto');

const RETAIN_FINISHED = 200;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** Per-boot internal owner id for Primary-local jobs (not guessable). */
const localDeviceId = 'primary-local-' + crypto.randomBytes(8).toString('hex');

let executor = null; // (payload) => Promise<{success, error, printedPages?}>

/** jobId → { status, payload, execute-result, done promise } */
let jobs = new Map();
/** deviceName → [jobId,...] FIFO (index 0 = active/next). */
let lanes = new Map();
/** deviceNames currently draining. */
let draining = new Set();
/** Insertion-ordered finished jobIds for bounded pruning. */
let finishedOrder = [];

function init(opts) {
  if (opts && typeof opts.execute === 'function') executor = opts.execute;
}

/** Test hook — resets all queue state (never used in production). */
function _reset() {
  jobs = new Map(); lanes = new Map(); draining = new Set(); finishedOrder = [];
}

function publicStatus(job) {
  const s = job.status;
  let ahead = 0;
  if (s.state === 'queued') {
    const lane = lanes.get(s.deviceName) || [];
    const idx = lane.indexOf(s.jobId);
    ahead = idx > 0 ? idx : 0;
  }
  return {
    jobId: s.jobId,
    deviceName: s.deviceName,
    state: s.state,
    ahead,
    error: s.error,
    printedPages: s.printedPages,
    documentType: s.documentType,
    origin: s.origin,
  };
}

function finish(job, state, error, printedPages) {
  job.status.state = state;
  job.status.error = error;
  job.status.printedPages = printedPages;
  job.status.finishedAt = Date.now();
  job.resolveDone(publicStatus(job));
  finishedOrder.push(job.status.jobId);
  while (finishedOrder.length > RETAIN_FINISHED) {
    const oldest = finishedOrder.shift();
    if (oldest) jobs.delete(oldest);
  }
}

async function drain(deviceName) {
  if (draining.has(deviceName)) return;
  draining.add(deviceName);
  try {
    for (;;) {
      const lane = lanes.get(deviceName) || [];
      const jobId = lane[0];
      if (!jobId) break;
      const job = jobs.get(jobId);
      if (!job || job.status.state !== 'queued') {
        lane.shift(); // cancelled/pruned while waiting
        continue;
      }
      job.status.state = 'printing';
      let result;
      try {
        result = await (executor ? executor(job.payload) : Promise.resolve({ success: false, error: 'no_executor' }));
      } catch (err) {
        result = { success: false, error: (err && err.message) || 'print_exception' };
      }
      const idx = lane.indexOf(jobId);
      if (idx >= 0) lane.splice(idx, 1);
      const ok = !!(result && result.success);
      finish(job, ok ? 'completed' : 'failed', ok ? undefined : ((result && result.error) || 'print_failed'), result && result.printedPages);
    }
  } finally {
    draining.delete(deviceName);
    const lane = lanes.get(deviceName) || [];
    if (lane.length > 0) drain(deviceName);
  }
}

/**
 * Enqueue a job. Idempotent on jobId: re-submitting a known jobId (wire
 * retry after a lost ACK) returns the EXISTING job instead of printing
 * twice. Returns the immediate queue receipt.
 */
function submitJob(req) {
  const jobId = req && String(req.jobId || '');
  const payload = req && req.payload;
  const deviceName = payload && String(payload.deviceName || '');
  if (!jobId) return { success: false, error: 'bad_job_id' };
  if (!payload || !deviceName) return { success: false, error: 'bad_payload' };

  const existing = jobs.get(jobId);
  if (existing) {
    const s = publicStatus(existing);
    return { success: true, jobId, state: s.state, ahead: s.ahead, duplicate: true };
  }

  const meta = (req && req.metadata) || {};
  const lane = lanes.get(deviceName) || [];
  const status = {
    jobId,
    deviceName,
    state: 'queued',
    error: undefined,
    printedPages: undefined,
    submittedAt: Date.now(),
    finishedAt: undefined,
    deviceId: String(meta.deviceId || localDeviceId),
    documentType: String(meta.documentType || 'document'),
    origin: String(meta.origin || 'unknown'),
  };
  let resolveDone = () => {};
  const done = new Promise((resolve) => { resolveDone = resolve; });
  jobs.set(jobId, { status, payload, done, resolveDone });
  lane.push(jobId);
  lanes.set(deviceName, lane);
  const receipt = { success: true, jobId, state: 'queued', ahead: lane.length - 1 };
  drain(deviceName);
  return receipt;
}

/** Ownership-checked live status. Unknown job OR foreign deviceId → the
 *  SAME generic job_not_found (never reveal another device's job). */
function status(req) {
  const jobId = req && String(req.jobId || '');
  const deviceId = req && String(req.deviceId || '');
  const job = jobId ? jobs.get(jobId) : null;
  if (!job || !deviceId || job.status.deviceId !== deviceId) {
    return { success: false, error: 'job_not_found' };
  }
  return { success: true, jobStatus: publicStatus(job) };
}

/** Ownership-checked cancel. Only WAITING jobs cancel; a job already at the
 *  driver ('printing') is never falsely reported as cancelled. */
function cancelJob(req) {
  const jobId = req && String(req.jobId || '');
  const deviceId = req && String(req.deviceId || '');
  const job = jobId ? jobs.get(jobId) : null;
  if (!job || !deviceId || job.status.deviceId !== deviceId) {
    return { success: false, error: 'job_not_found' };
  }
  if (TERMINAL.has(job.status.state)) {
    return { success: false, error: 'already_finished', jobStatus: publicStatus(job) };
  }
  if (job.status.state === 'printing') {
    return { success: false, error: 'already_printing', jobStatus: publicStatus(job) };
  }
  const lane = lanes.get(job.status.deviceName) || [];
  const idx = lane.indexOf(jobId);
  if (idx >= 0) lane.splice(idx, 1);
  finish(job, 'cancelled', undefined, undefined);
  return { success: true, jobStatus: publicStatus(job) };
}

/** Terminal-state promise for a job (ownership-free, main-internal). */
function completion(jobId) {
  const job = jobs.get(String(jobId || ''));
  return job ? job.done : null;
}

/**
 * Legacy print:run contract: enqueue + await completion + return the exact
 * {success, error, printedPages} shape existing callers expect. The payload
 * may carry queue fields (jobId, deviceId, documentType, origin) — they are
 * STRIPPED before the payload reaches the physical executor. A duplicate
 * jobId awaits the existing job's result instead of printing twice.
 */
async function submitAndWait(rawPayload) {
  const p = rawPayload || {};
  const jobId = String(p.jobId || '') || ('local-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex'));
  const { jobId: _j, deviceId: _d, documentType: _t, origin: _o, ...payload } = p;
  const receipt = submitJob({
    jobId,
    payload,
    metadata: {
      deviceId: String(p.deviceId || '') || localDeviceId,
      documentType: String(p.documentType || 'document'),
      origin: String(p.origin || 'primary-local'),
    },
  });
  if (!receipt.success) return { success: false, error: receipt.error };
  const done = completion(jobId);
  const final = done ? await done : null;
  if (!final) return { success: false, error: 'job_lost' };
  if (final.state === 'completed') return { success: true, error: null, printedPages: final.printedPages };
  if (final.state === 'cancelled') return { success: false, error: 'cancelled' };
  return { success: false, error: final.error || 'print_failed', printedPages: final.printedPages };
}

/** Non-terminal jobs snapshot (observability/tests). */
function pending() {
  const out = [];
  lanes.forEach((lane) => {
    lane.forEach((jobId) => {
      const job = jobs.get(jobId);
      if (job) out.push(publicStatus(job));
    });
  });
  return out;
}

module.exports = {
  init,
  submitJob,
  status,
  cancelJob,
  completion,
  submitAndWait,
  pending,
  localDeviceId,
  _reset,
};
