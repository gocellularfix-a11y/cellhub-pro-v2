// ============================================================
// R-PRINT-SERVER-V1.1 — MAIN-PROCESS print queue tests.
//
// electron/printQueue.js is the single serialization boundary for every
// call that reaches a printer driver: Primary-local printRun jobs and
// Secondary LAN jobs share the SAME per-printer FIFO lane. These tests
// exercise the real CJS module (same import pattern as printPages.js).
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — CJS main-process module without type declarations.
import printQueue from '../../../electron/printQueue.js';

/** Manually-resolvable executor so tests control print timing exactly. */
function gates() {
  const pending: Array<{ payload: Record<string, unknown>; release: (r: { success: boolean; error?: string }) => void }> = [];
  const execute = (payload: Record<string, unknown>) =>
    new Promise<{ success: boolean; error?: string }>((resolve) => {
      pending.push({ payload, release: resolve });
    });
  return { pending, execute };
}

const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });

beforeEach(() => { printQueue._reset(); });

describe('main queue — local Primary + LAN Secondary share ONE lane per printer', () => {
  it('a local printRun job and a Secondary LAN job on the SAME printer are strictly FIFO', async () => {
    const g = gates();
    printQueue.init({ execute: g.execute });
    // Local Primary job via the legacy printRun contract (submitAndWait):
    const localDone = printQueue.submitAndWait({ html: '<p>local report</p>', deviceName: 'Canon', origin: 'primary-local' });
    await tick();
    // Secondary LAN job via the queue IPC contract, same physical printer:
    const lan = printQueue.submitJob({
      jobId: 'lan-1',
      payload: { html: '<p>secondary report</p>', deviceName: 'Canon' },
      metadata: { deviceId: 'PC-secondary-A', documentType: 'report', origin: 'lan-secondary' },
    });
    expect(lan).toMatchObject({ success: true, state: 'queued', ahead: 1 }); // waits behind the local job
    await tick();
    expect(g.pending.length).toBe(1); // Canon is executing ONLY the local job
    g.pending[0].release({ success: true });
    const local = await localDone;
    expect(local).toMatchObject({ success: true });
    await tick();
    expect(g.pending.length).toBe(2); // now (and only now) the LAN job executes
    expect(g.pending[1].payload.html).toBe('<p>secondary report</p>');
    g.pending[1].release({ success: true });
    await tick();
    expect(printQueue.status({ jobId: 'lan-1', deviceId: 'PC-secondary-A' }).jobStatus.state).toBe('completed');
  });

  it('local and LAN jobs on DIFFERENT printers execute concurrently', async () => {
    const g = gates();
    printQueue.init({ execute: g.execute });
    const localDone = printQueue.submitAndWait({ html: '<p>report</p>', deviceName: 'Canon' });
    printQueue.submitJob({ jobId: 'lan-r', payload: { html: '<p>receipt</p>', deviceName: 'POS-80C' }, metadata: { deviceId: 'PC-B' } });
    await tick();
    // BOTH physical printers are executing at the same time.
    expect(g.pending.map((p) => p.payload.deviceName).sort()).toEqual(['Canon', 'POS-80C']);
    g.pending.forEach((p) => p.release({ success: true }));
    await expect(localDone).resolves.toMatchObject({ success: true });
  });

  it('every legacy printRun call passes through the queue (serializes behind an active job)', async () => {
    const g = gates();
    printQueue.init({ execute: g.execute });
    const first = printQueue.submitAndWait({ html: 'a', deviceName: 'Canon' });
    const second = printQueue.submitAndWait({ html: 'b', deviceName: 'Canon' });
    await tick();
    expect(g.pending.length).toBe(1); // second printRun is QUEUED, not concurrent
    expect(printQueue.pending().length).toBe(2);
    g.pending[0].release({ success: true });
    await tick();
    expect(g.pending.length).toBe(2);
    g.pending[1].release({ success: false, error: 'offline' });
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(second).resolves.toMatchObject({ success: false, error: 'offline' });
  });

  it('queue state lives in MAIN — jobs submitted with no renderer listeners still finish (remount-safe)', async () => {
    // No subscribers/listeners of any kind exist here — the queue itself
    // drives jobs to terminal state; a renderer reload merely re-polls.
    printQueue.init({ execute: () => Promise.resolve({ success: true }) });
    printQueue.submitJob({ jobId: 'r1', payload: { html: 'x', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    await tick();
    expect(printQueue.status({ jobId: 'r1', deviceId: 'PC-A' }).jobStatus.state).toBe('completed');
  });
});

describe('main queue — idempotency + failure isolation + cancel', () => {
  it('a duplicate jobId never prints twice (submitJob AND submitAndWait)', async () => {
    let executions = 0;
    printQueue.init({ execute: () => { executions += 1; return Promise.resolve({ success: true }); } });
    printQueue.submitJob({ jobId: 'J', payload: { html: 'x', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    const dup = printQueue.submitJob({ jobId: 'J', payload: { html: 'x', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    expect(dup).toMatchObject({ success: true, duplicate: true });
    await tick();
    const viaRun = await printQueue.submitAndWait({ jobId: 'J', html: 'x', deviceName: 'Canon' });
    expect(viaRun).toMatchObject({ success: true }); // awaited the SAME job
    expect(executions).toBe(1);
  });

  it('a failing job does not block the next job on the same printer', async () => {
    const g = gates();
    printQueue.init({ execute: g.execute });
    printQueue.submitJob({ jobId: 'bad', payload: { html: 'x', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    printQueue.submitJob({ jobId: 'good', payload: { html: 'y', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    await tick();
    g.pending[0].release({ success: false, error: 'printer_jam' });
    await tick();
    expect(printQueue.status({ jobId: 'bad', deviceId: 'PC-A' }).jobStatus).toMatchObject({ state: 'failed', error: 'printer_jam' });
    expect(g.pending.length).toBe(2);
    g.pending[1].release({ success: true });
    await tick();
    expect(printQueue.status({ jobId: 'good', deviceId: 'PC-A' }).jobStatus.state).toBe('completed');
  });

  it('a WAITING job can be cancelled; followers move up', async () => {
    const g = gates();
    printQueue.init({ execute: g.execute });
    printQueue.submitJob({ jobId: 'A', payload: { html: 'a', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    printQueue.submitJob({ jobId: 'B', payload: { html: 'b', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    printQueue.submitJob({ jobId: 'C', payload: { html: 'c', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    await tick();
    expect(printQueue.cancelJob({ jobId: 'B', deviceId: 'PC-A' })).toMatchObject({ success: true, jobStatus: { state: 'cancelled' } });
    expect(printQueue.status({ jobId: 'C', deviceId: 'PC-A' }).jobStatus).toMatchObject({ state: 'queued', ahead: 1 });
    g.pending[0].release({ success: true });
    await tick();
    expect(g.pending[1].payload.html).toBe('c'); // B never executed
    g.pending[1].release({ success: true });
    await tick();
  });

  it('a PRINTING job is never falsely reported as cancelled', async () => {
    const g = gates();
    printQueue.init({ execute: g.execute });
    printQueue.submitJob({ jobId: 'A', payload: { html: 'a', deviceName: 'Canon' }, metadata: { deviceId: 'PC-A' } });
    await tick();
    const res = printQueue.cancelJob({ jobId: 'A', deviceId: 'PC-A' });
    expect(res).toMatchObject({ success: false, error: 'already_printing' });
    expect(res.jobStatus.state).toBe('printing'); // truthful state, not 'cancelled'
    g.pending[0].release({ success: true });
    await tick();
    expect(printQueue.status({ jobId: 'A', deviceId: 'PC-A' }).jobStatus.state).toBe('completed');
  });
});

describe('main queue — job ownership (a Secondary can never see another device\'s job)', () => {
  it('Secondary A cannot QUERY Secondary B\'s job — generic job_not_found', async () => {
    printQueue.init({ execute: () => Promise.resolve({ success: true }) });
    printQueue.submitJob({ jobId: 'b-job', payload: { html: 'x', deviceName: 'Canon' }, metadata: { deviceId: 'PC-B' } });
    // A knows the jobId (stolen/guessed) but is NOT the owner:
    expect(printQueue.status({ jobId: 'b-job', deviceId: 'PC-A' })).toEqual({ success: false, error: 'job_not_found' });
    // …indistinguishable from a truly unknown job:
    expect(printQueue.status({ jobId: 'ghost', deviceId: 'PC-A' })).toEqual({ success: false, error: 'job_not_found' });
    // The real owner still sees it:
    await tick();
    expect(printQueue.status({ jobId: 'b-job', deviceId: 'PC-B' }).success).toBe(true);
  });

  it('Secondary A cannot CANCEL Secondary B\'s waiting job', async () => {
    const g = gates();
    printQueue.init({ execute: g.execute });
    printQueue.submitJob({ jobId: 'head', payload: { html: 'h', deviceName: 'Canon' }, metadata: { deviceId: 'PC-B' } });
    printQueue.submitJob({ jobId: 'b-wait', payload: { html: 'w', deviceName: 'Canon' }, metadata: { deviceId: 'PC-B' } });
    await tick();
    expect(printQueue.cancelJob({ jobId: 'b-wait', deviceId: 'PC-A' })).toEqual({ success: false, error: 'job_not_found' });
    // Still queued for its real owner:
    expect(printQueue.status({ jobId: 'b-wait', deviceId: 'PC-B' }).jobStatus.state).toBe('queued');
    g.pending[0].release({ success: true });
    await tick();
    g.pending[1].release({ success: true });
    await tick();
  });

  it('local Primary jobs are owned by a per-boot internal id a LAN payload cannot guess', async () => {
    printQueue.init({ execute: () => Promise.resolve({ success: true }) });
    const done = printQueue.submitAndWait({ jobId: 'local-x', html: 'x', deviceName: 'Canon' });
    // A hostile Secondary trying the obvious literal owner strings fails:
    for (const spoof of ['primary-local', '', 'undefined']) {
      expect(printQueue.status({ jobId: 'local-x', deviceId: spoof })).toEqual({ success: false, error: 'job_not_found' });
    }
    expect(printQueue.localDeviceId).toMatch(/^primary-local-[0-9a-f]{16}$/);
    await done;
  });
});

describe('main queue — legacy printRun contract preserved', () => {
  it('returns {success, error, printedPages} exactly as callers expect', async () => {
    printQueue.init({ execute: () => Promise.resolve({ success: true, printedPages: 3 }) });
    await expect(printQueue.submitAndWait({ html: 'x', deviceName: 'Canon' }))
      .resolves.toEqual({ success: true, error: null, printedPages: 3 });
    printQueue.init({ execute: () => Promise.resolve({ success: false, error: 'Print job failed' }) });
    await expect(printQueue.submitAndWait({ html: 'x', deviceName: 'POS-80C' }))
      .resolves.toMatchObject({ success: false, error: 'Print job failed' });
  });

  it('queue fields (jobId/deviceId/documentType/origin) are STRIPPED before the physical executor', async () => {
    let seen: Record<string, unknown> | null = null;
    printQueue.init({ execute: (p: Record<string, unknown>) => { seen = p; return Promise.resolve({ success: true }); } });
    await printQueue.submitAndWait({
      html: '<p>x</p>', deviceName: 'Canon', copies: 2,
      jobId: 'j1', deviceId: 'PC-A', documentType: 'report', origin: 'lan-legacy-receipt',
    });
    expect(seen).toEqual({ html: '<p>x</p>', deviceName: 'Canon', copies: 2 });
  });

  it('a missing deviceName fails cleanly without touching the executor', async () => {
    let executed = 0;
    printQueue.init({ execute: () => { executed += 1; return Promise.resolve({ success: true }); } });
    await expect(printQueue.submitAndWait({ html: 'x' })).resolves.toMatchObject({ success: false, error: 'bad_payload' });
    expect(executed).toBe(0);
  });
});
