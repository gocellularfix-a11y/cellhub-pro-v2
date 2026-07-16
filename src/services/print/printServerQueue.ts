// ============================================================
// R-PRINT-SERVER-V1 — Primary print-server queue.
//
// The Primary is the print server for the whole CellHub LAN. Every job —
// bridged from a Secondary OR (legacy media-routed receipts) — is executed
// through ONE per-printer FIFO queue so the SAME physical printer never
// receives two jobs concurrently, while DIFFERENT printers print in
// parallel. Ordering is enforced purely by promise chaining — no timers,
// no sleeps, no polling loops.
//
// Pure module: the actual print execution is INJECTED per job (the
// dispatcher passes a closure over window.electronAPI.printRun), so this
// file has zero Electron/React dependencies and is fully unit-testable.
//
// Job registry: bounded (finished jobs beyond RETAIN_FINISHED are pruned
// oldest-first) so a long-running Primary never leaks job records.
// ============================================================

export type PrintJobState = 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled';

export interface PrintJobStatus {
  jobId: string;
  printerName: string;
  state: PrintJobState;
  /** Jobs ahead of this one on the same printer (0 when printing/terminal). */
  ahead: number;
  error?: string;
  /** Milliseconds timestamps for observability. */
  submittedAt: number;
  finishedAt?: number;
  /** Who submitted (LAN deviceId, or 'primary' for local jobs). */
  deviceId?: string;
  /** Optional label for UI/status (e.g. 'report', 'pos_receipt'). */
  documentType?: string;
}

export interface PrintExecuteResult { success: boolean; error?: string }

export interface PrintQueueSubmitInput {
  jobId: string;
  printerName: string;
  execute: () => Promise<PrintExecuteResult>;
  deviceId?: string;
  documentType?: string;
  /** Injected clock (tests). Defaults to Date.now. */
  now?: () => number;
}

interface InternalJob {
  status: PrintJobStatus;
  execute: () => Promise<PrintExecuteResult>;
  /** Resolves when the job reaches a terminal state (never rejects). */
  done: Promise<PrintJobStatus>;
  resolveDone: (s: PrintJobStatus) => void;
}

const RETAIN_FINISHED = 200;
const TERMINAL: PrintJobState[] = ['completed', 'failed', 'cancelled'];

type QueueListener = (status: PrintJobStatus) => void;

/**
 * Per-printer FIFO print queue. One instance per renderer process — export a
 * module singleton below; the class stays exported for isolated tests.
 */
export class PrintServerQueue {
  private jobs = new Map<string, InternalJob>();
  /** printerName → jobIds waiting or printing, FIFO (index 0 = active). */
  private lanes = new Map<string, string[]>();
  /** printerName → true while the lane's drain loop is running. */
  private draining = new Set<string>();
  private listeners = new Set<QueueListener>();
  /** Insertion-ordered finished jobIds for bounded pruning. */
  private finishedOrder: string[] = [];

  /** Subscribe to every job state change. Returns unsubscribe. */
  onChange(cb: QueueListener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(status: PrintJobStatus): void {
    this.listeners.forEach((cb) => { try { cb({ ...status }); } catch { /* listener errors never break the queue */ } });
  }

  /**
   * Enqueue a job. Idempotent on jobId: re-submitting a known jobId (wire
   * retry after a lost ACK) returns the EXISTING status instead of printing
   * twice — printing is never auto-duplicated.
   */
  submit(input: PrintQueueSubmitInput): PrintJobStatus {
    const existing = this.jobs.get(input.jobId);
    if (existing) return this.getStatus(input.jobId) as PrintJobStatus;

    const now = input.now ? input.now() : Date.now();
    const lane = this.lanes.get(input.printerName) || [];
    const status: PrintJobStatus = {
      jobId: input.jobId,
      printerName: input.printerName,
      state: 'queued',
      ahead: lane.length,
      submittedAt: now,
      deviceId: input.deviceId,
      documentType: input.documentType,
    };
    let resolveDone: (s: PrintJobStatus) => void = () => { /* replaced below */ };
    const done = new Promise<PrintJobStatus>((resolve) => { resolveDone = resolve; });
    this.jobs.set(input.jobId, { status, execute: input.execute, done, resolveDone });
    lane.push(input.jobId);
    this.lanes.set(input.printerName, lane);
    this.emit(status);
    this.drain(input.printerName);
    return { ...status };
  }

  /** Live status (ahead recomputed from the lane). Null for unknown jobs. */
  getStatus(jobId: string): PrintJobStatus | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (job.status.state === 'queued') {
      const lane = this.lanes.get(job.status.printerName) || [];
      const idx = lane.indexOf(jobId);
      job.status.ahead = idx > 0 ? idx : 0;
    } else {
      job.status.ahead = 0;
    }
    return { ...job.status };
  }

  /** Resolves when the job reaches a terminal state. Null for unknown jobs. */
  completion(jobId: string): Promise<PrintJobStatus> | null {
    const job = this.jobs.get(jobId);
    return job ? job.done : null;
  }

  /**
   * Cancel a job that is still WAITING. A job already printing cannot be
   * cancelled (the bytes are at the driver) — returns already_printing.
   */
  cancel(jobId: string): { ok: boolean; error?: string; status?: PrintJobStatus } {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, error: 'job_not_found' };
    if (TERMINAL.includes(job.status.state)) return { ok: false, error: 'already_finished', status: { ...job.status } };
    if (job.status.state === 'printing') return { ok: false, error: 'already_printing', status: { ...job.status } };
    const lane = this.lanes.get(job.status.printerName) || [];
    const idx = lane.indexOf(jobId);
    if (idx >= 0) lane.splice(idx, 1);
    this.finish(job, 'cancelled', undefined);
    return { ok: true, status: { ...job.status } };
  }

  /** Snapshot of every non-terminal job (Primary-side observability). */
  pending(): PrintJobStatus[] {
    const out: PrintJobStatus[] = [];
    this.lanes.forEach((lane) => {
      lane.forEach((jobId) => {
        const s = this.getStatus(jobId);
        if (s) out.push(s);
      });
    });
    return out;
  }

  private finish(job: InternalJob, state: PrintJobState, error: string | undefined): void {
    job.status.state = state;
    job.status.ahead = 0;
    job.status.error = error;
    job.status.finishedAt = Date.now();
    this.emit(job.status);
    job.resolveDone({ ...job.status });
    this.finishedOrder.push(job.status.jobId);
    // Bounded registry: prune the oldest finished jobs beyond the cap.
    while (this.finishedOrder.length > RETAIN_FINISHED) {
      const oldest = this.finishedOrder.shift();
      if (oldest) this.jobs.delete(oldest);
    }
  }

  /**
   * Drain loop for one printer lane. Strict FIFO: the head job runs to a
   * terminal state before the next starts. Different lanes drain
   * concurrently. Re-entrant-safe via the `draining` set; sequencing comes
   * from awaiting each execute() — never from timers.
   */
  private async drain(printerName: string): Promise<void> {
    if (this.draining.has(printerName)) return;
    this.draining.add(printerName);
    try {
      for (;;) {
        const lane = this.lanes.get(printerName) || [];
        const jobId = lane[0];
        if (!jobId) break;
        const job = this.jobs.get(jobId);
        if (!job || job.status.state !== 'queued') {
          // Cancelled/pruned while waiting — drop from the lane and continue.
          lane.shift();
          continue;
        }
        job.status.state = 'printing';
        job.status.ahead = 0;
        this.emit(job.status);
        let result: PrintExecuteResult;
        try {
          result = await job.execute();
        } catch (err) {
          result = { success: false, error: (err as Error)?.message || 'print_exception' };
        }
        // Remove from the lane BEFORE finishing so `ahead` for followers is right.
        const idx = lane.indexOf(jobId);
        if (idx >= 0) lane.splice(idx, 1);
        this.finish(job, result.success ? 'completed' : 'failed', result.success ? undefined : (result.error || 'print_failed'));
      }
    } finally {
      this.draining.delete(printerName);
      // A job enqueued between the last check and the finally would have seen
      // draining=true and skipped its own drain — re-check the lane here.
      const lane = this.lanes.get(printerName) || [];
      if (lane.length > 0) void this.drain(printerName);
    }
  }
}

/** Renderer-wide singleton — the Primary dispatcher and any local queue
 *  consumer share it so one physical printer has exactly ONE lane. */
export const printServerQueue = new PrintServerQueue();
