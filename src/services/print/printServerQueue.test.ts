// ============================================================
// R-PRINT-SERVER-V1 — print-server queue unit tests.
// FIFO ordering per printer, cross-printer concurrency, same-printer
// serialization, cancel semantics, jobId idempotency, failure isolation.
// ============================================================
import { describe, it, expect } from 'vitest';
import { PrintServerQueue } from './printServerQueue';

/** Manually-resolvable executor so tests control print timing exactly. */
function gate() {
  let release: (r: { success: boolean; error?: string }) => void = () => {};
  const promise = new Promise<{ success: boolean; error?: string }>((res) => { release = res; });
  let started = false;
  const execute = () => { started = true; return promise; };
  return { execute, release: (ok = true, error?: string) => release({ success: ok, error }), get started() { return started; } };
}

const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });

describe('PrintServerQueue — FIFO per printer', () => {
  it('runs jobs on the SAME printer strictly one at a time, in order', async () => {
    const q = new PrintServerQueue();
    const a = gate(); const b = gate(); const c = gate();
    q.submit({ jobId: 'A', printerName: 'Canon', execute: a.execute });
    q.submit({ jobId: 'B', printerName: 'Canon', execute: b.execute });
    q.submit({ jobId: 'C', printerName: 'Canon', execute: c.execute });
    await tick();
    expect(a.started).toBe(true);
    expect(b.started).toBe(false);            // NEVER two jobs on one printer
    expect(q.getStatus('A')?.state).toBe('printing');
    expect(q.getStatus('B')).toMatchObject({ state: 'queued', ahead: 1 });
    expect(q.getStatus('C')).toMatchObject({ state: 'queued', ahead: 2 });

    a.release(true);
    await tick();
    expect(q.getStatus('A')?.state).toBe('completed');
    expect(b.started).toBe(true);
    expect(c.started).toBe(false);
    expect(q.getStatus('C')).toMatchObject({ state: 'queued', ahead: 1 });

    b.release(true);
    await tick();
    c.release(true);
    await tick();
    expect(q.getStatus('C')?.state).toBe('completed');
  });

  it('runs jobs on DIFFERENT printers concurrently', async () => {
    const q = new PrintServerQueue();
    const canon = gate(); const pos = gate();
    q.submit({ jobId: 'R1', printerName: 'Canon', execute: canon.execute });
    q.submit({ jobId: 'T1', printerName: 'POS-80C', execute: pos.execute });
    await tick();
    // Both physical printers are printing at the same time.
    expect(canon.started).toBe(true);
    expect(pos.started).toBe(true);
    canon.release(true); pos.release(true);
    await tick();
    expect(q.getStatus('R1')?.state).toBe('completed');
    expect(q.getStatus('T1')?.state).toBe('completed');
  });

  it('a FAILED job does not block the next job on the same printer', async () => {
    const q = new PrintServerQueue();
    const a = gate(); const b = gate();
    q.submit({ jobId: 'A', printerName: 'Canon', execute: a.execute });
    q.submit({ jobId: 'B', printerName: 'Canon', execute: b.execute });
    await tick();
    a.release(false, 'printer_jam');
    await tick();
    expect(q.getStatus('A')).toMatchObject({ state: 'failed', error: 'printer_jam' });
    expect(b.started).toBe(true);
    b.release(true);
    await tick();
    expect(q.getStatus('B')?.state).toBe('completed');
  });

  it('an executor that THROWS is a clean failure, not a stuck lane', async () => {
    const q = new PrintServerQueue();
    q.submit({ jobId: 'X', printerName: 'Canon', execute: () => { throw new Error('boom'); } });
    const b = gate();
    q.submit({ jobId: 'Y', printerName: 'Canon', execute: b.execute });
    await tick();
    expect(q.getStatus('X')).toMatchObject({ state: 'failed', error: 'boom' });
    expect(b.started).toBe(true);
    b.release(true);
    await tick();
    expect(q.getStatus('Y')?.state).toBe('completed');
  });
});

describe('PrintServerQueue — cancel', () => {
  it('cancels a QUEUED job; followers move up', async () => {
    const q = new PrintServerQueue();
    const a = gate(); const c = gate();
    q.submit({ jobId: 'A', printerName: 'Canon', execute: a.execute });
    q.submit({ jobId: 'B', printerName: 'Canon', execute: () => Promise.resolve({ success: true }) });
    q.submit({ jobId: 'C', printerName: 'Canon', execute: c.execute });
    await tick();
    const res = q.cancel('B');
    expect(res.ok).toBe(true);
    expect(q.getStatus('B')?.state).toBe('cancelled');
    expect(q.getStatus('C')).toMatchObject({ state: 'queued', ahead: 1 });
    a.release(true);
    await tick();
    // B was cancelled → C prints right after A.
    expect(c.started).toBe(true);
    c.release(true);
    await tick();
    expect(q.getStatus('C')?.state).toBe('completed');
  });

  it('cannot cancel a job that is already PRINTING', async () => {
    const q = new PrintServerQueue();
    const a = gate();
    q.submit({ jobId: 'A', printerName: 'Canon', execute: a.execute });
    await tick();
    const res = q.cancel('A');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('already_printing');
    a.release(true);
    await tick();
  });

  it('unknown job → job_not_found', () => {
    const q = new PrintServerQueue();
    expect(q.cancel('nope')).toMatchObject({ ok: false, error: 'job_not_found' });
    expect(q.getStatus('nope')).toBeNull();
  });
});

describe('PrintServerQueue — idempotency + completion', () => {
  it('re-submitting the SAME jobId never prints twice (wire-retry safe)', async () => {
    const q = new PrintServerQueue();
    let executions = 0;
    const exec = () => { executions += 1; return Promise.resolve({ success: true }); };
    q.submit({ jobId: 'J', printerName: 'Canon', execute: exec });
    q.submit({ jobId: 'J', printerName: 'Canon', execute: exec });
    await tick();
    q.submit({ jobId: 'J', printerName: 'Canon', execute: exec }); // even after completion
    await tick();
    expect(executions).toBe(1);
    expect(q.getStatus('J')?.state).toBe('completed');
  });

  it('completion() resolves with the terminal status', async () => {
    const q = new PrintServerQueue();
    const a = gate();
    q.submit({ jobId: 'A', printerName: 'Canon', execute: a.execute });
    const done = q.completion('A');
    expect(done).not.toBeNull();
    a.release(false, 'offline');
    const status = await done!;
    expect(status).toMatchObject({ jobId: 'A', state: 'failed', error: 'offline' });
  });

  it('onChange emits queued → printing → terminal transitions', async () => {
    const q = new PrintServerQueue();
    const seen: string[] = [];
    q.onChange((s) => { seen.push(`${s.jobId}:${s.state}`); });
    const a = gate();
    q.submit({ jobId: 'A', printerName: 'Canon', execute: a.execute });
    await tick();
    a.release(true);
    await tick();
    expect(seen).toEqual(['A:queued', 'A:printing', 'A:completed']);
  });
});
