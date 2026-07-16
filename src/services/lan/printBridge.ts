// ============================================================
// R-2.1.4-CLOSEOUT — canonical LAN print-bridge contract.
//
// ROOT CAUSE FIXED: the bridged Secondary→Primary print payload carried only
// { receiptType, html, copies, pageSize }, silently dropping pageRanges,
// margins, scale and landscape — so a Custom Range job forwarded from a
// Secondary printed the COMPLETE document on the Primary. Both directions of
// the contract now live here (single source): the Secondary serializes the
// full validated print job, the Primary defensively re-validates it and maps
// it onto the same `printRun` IPC payload a direct print uses — which routes
// ranged jobs through the canonical electron/printPages.js pipeline. There is
// deliberately NO second selected-page implementation.
//
// FAILURE CONTRACT: a bridged job whose pageRanges fail validation is
// REJECTED (`bad_page_ranges`) — it is never stripped down to an implicit
// "print all pages".
//
// R-2.1.4-LAN-PRINT: the Primary routes a bridged job to a printer by the
// job's MEDIA TYPE (derived from pageSize), using the store's existing
// printer→media assignments (settings.printerMediaTypes) — never the blind
// detectedPrinters[0]. A Letter report is NEVER sent to a receipt printer:
// with no explicit report-printer assignment the job is rejected with a
// clear error, keeping the Secondary's Print button available for retry.
//
// R-PRINT-SERVER-V1: the Primary is now a full PRINT SERVER. A Secondary's
// print modal shows the PRIMARY's printers and submits ONE complete job
// (LAN_PRINT_SUBMIT) naming an explicit printer; the Primary validates it,
// enqueues it on that printer's FIFO lane (printServerQueue) and ACKs
// { jobId, queuePosition } immediately — status flows back via
// LAN_PRINT_STATUS_REQUEST polling. The media-routed path above stays as
// the SILENT receipt bridge (no picker) and as backward compatibility.
// ============================================================
import { classifyMediaFromMicrons } from '@/services/print/printMediaGuard';
import type { PrinterMediaType } from '@/services/print/printMediaGuard';

/** 0-based inclusive page ranges — the same shape the printRun IPC uses. */
export interface ZeroBasedRange { from: number; to: number }

const MAX_RANGE_ENTRIES = 50;
const MAX_COPIES = 10;

/**
 * Strict shape validation for ranges crossing the LAN (both when building
 * the operation on the Secondary and when receiving it on the Primary).
 * Returns null when the input is not a valid non-empty range list.
 */
export function sanitizeZeroBasedRanges(input: unknown): ZeroBasedRange[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RANGE_ENTRIES) return null;
  const out: ZeroBasedRange[] = [];
  for (const r of input) {
    const from = Number((r as { from?: unknown })?.from);
    const to = Number((r as { to?: unknown })?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from < 0 || to < from) return null;
    out.push({ from, to });
  }
  return out;
}

export interface LanPrintJobInput {
  receiptType?: string;
  html: string;
  copies?: number;
  pageSize?: { width: number; height: number }; // microns
  pageRanges?: ZeroBasedRange[];                // 0-based, pre-validated by the modal
  margins?: { top: number; bottom: number; left: number; right: number }; // inches
  scaleFactor?: number;
  landscape?: boolean;
}

export interface LanPrintJob {
  receiptType: string;
  html: string;
  copies: number;
  pageSize?: { width: number; height: number };
  pageRanges?: ZeroBasedRange[];
  margins?: { top: number; bottom: number; left: number; right: number };
  scaleFactor?: number;
  landscape?: boolean;
}

/**
 * Secondary side: build the wire payload for LAN_PRINT_RECEIPT_REQUEST.
 * Invalid page ranges are BLOCKED here (before anything crosses the LAN).
 */
export function buildLanPrintJob(input: LanPrintJobInput): { ok: true; job: LanPrintJob } | { ok: false; error: string } {
  const html = String(input.html || '');
  if (!html) return { ok: false, error: 'bad_payload' };
  const job: LanPrintJob = {
    receiptType: String(input.receiptType || 'receipt').slice(0, 40),
    html,
    copies: Math.max(1, Math.min(MAX_COPIES, Math.round(input.copies || 1))),
  };
  if (input.pageSize) job.pageSize = { width: Number(input.pageSize.width), height: Number(input.pageSize.height) };
  if (input.pageRanges !== undefined) {
    const ranges = sanitizeZeroBasedRanges(input.pageRanges);
    if (!ranges) return { ok: false, error: 'bad_page_ranges' };
    job.pageRanges = ranges;
  }
  if (input.margins) {
    job.margins = {
      top: Math.max(0, Number(input.margins.top) || 0),
      bottom: Math.max(0, Number(input.margins.bottom) || 0),
      left: Math.max(0, Number(input.margins.left) || 0),
      right: Math.max(0, Number(input.margins.right) || 0),
    };
  }
  if (input.scaleFactor !== undefined) {
    const s = Math.round(Number(input.scaleFactor));
    if (Number.isFinite(s) && s >= 10 && s <= 200) job.scaleFactor = s;
  }
  if (input.landscape !== undefined) job.landscape = !!input.landscape;
  return { ok: true, job };
}

export interface BridgedPrintRunPayload {
  html: string;
  deviceName: string;
  copies: number;
  pageSize?: { width: number; height: number };
  pageRanges?: ZeroBasedRange[];
  margins?: { top: number; bottom: number; left: number; right: number };
  scaleFactor?: number;
  landscape?: boolean;
}

/**
 * Primary side: map a received LAN print payload onto the printRun IPC
 * payload — the SAME contract a direct print uses, so ranged jobs flow
 * through the canonical selected-page pipeline in the main process.
 * Defensive: a present-but-invalid pageRanges REJECTS the job (never a
 * silent full-document print).
 */
export function buildBridgedPrintRunPayload(
  print: unknown,
  deviceName: string,
): { ok: true; payload: BridgedPrintRunPayload } | { ok: false; error: string } {
  const p = print as Partial<LanPrintJob> | null | undefined;
  const html = p && String(p.html || '');
  if (!p || !html) return { ok: false, error: 'bad_payload' };
  if (!deviceName) return { ok: false, error: 'no_printer' };
  const payload: BridgedPrintRunPayload = {
    html,
    deviceName,
    copies: Math.max(1, Math.min(MAX_COPIES, Math.round(Number(p.copies) || 1))),
  };
  if (p.pageSize && Number.isFinite(Number(p.pageSize.width)) && Number.isFinite(Number(p.pageSize.height))) {
    payload.pageSize = { width: Number(p.pageSize.width), height: Number(p.pageSize.height) };
  }
  if (p.pageRanges !== undefined) {
    const ranges = sanitizeZeroBasedRanges(p.pageRanges);
    if (!ranges) return { ok: false, error: 'bad_page_ranges' };
    payload.pageRanges = ranges;
  }
  if (p.margins) {
    payload.margins = {
      top: Math.max(0, Number(p.margins.top) || 0),
      bottom: Math.max(0, Number(p.margins.bottom) || 0),
      left: Math.max(0, Number(p.margins.left) || 0),
      right: Math.max(0, Number(p.margins.right) || 0),
    };
  }
  if (p.scaleFactor !== undefined) {
    const s = Math.round(Number(p.scaleFactor));
    if (Number.isFinite(s) && s >= 10 && s <= 200) payload.scaleFactor = s;
  }
  if (p.landscape !== undefined) payload.landscape = !!p.landscape;
  return { ok: true, payload };
}

// ── R-2.1.4-LAN-PRINT: Primary printer routing by media type ──

/** Receipt-class media that may safely keep the existing default-printer
 *  fallback when no explicit assignment exists. Sheet media (letter) never
 *  falls back — a report must be sent to a report printer or rejected. */
const RECEIPT_CLASS_MEDIA: PrinterMediaType[] = ['80mm', '4x6', 'label', 'cr80'];

export interface BridgePrinterResolution {
  ok: boolean;
  printer?: string;
  error?: string;                               // set when !ok
  media: PrinterMediaType | 'unknown';
  viaDefaultFallback?: boolean;                 // receipt routed to default printer
}

/**
 * Resolve which Primary printer prints a bridged job, by the job's MEDIA
 * TYPE (from pageSize) against the store's printer→media assignments.
 *   1. A printer explicitly assigned to the job's media wins (all media).
 *   2. Sheet media (letter/legal/a4) with NO assignment → reject
 *      ('no_report_printer'); never fall back to the default printer, which
 *      could be the receipt printer.
 *   3. Receipt-class media with no assignment → the Primary's default/
 *      selected printer (detectedPrinters[0]) — preserves the existing
 *      receipt bridge for shops that haven't set printer media types yet.
 *   4. Unknown media → reject ('unclassified_media').
 * Pure — the dispatcher passes settings.printerMediaTypes + detectedPrinters.
 */
export function resolveBridgePrinter(
  pageSizeMicrons: { width: number; height: number } | undefined | null,
  mediaMap: Record<string, string> | undefined | null,
  detectedPrinters: string[] | undefined | null,
): BridgePrinterResolution {
  const media = classifyMediaFromMicrons(pageSizeMicrons || undefined);
  const map = (mediaMap && typeof mediaMap === 'object') ? mediaMap : {};
  const printers = Array.isArray(detectedPrinters) ? detectedPrinters : [];

  if (media === 'unknown') return { ok: false, media, error: 'unclassified_media' };

  // 1. Explicit media assignment wins for every media type.
  const assigned = Object.keys(map).find((name) => map[name] === media);
  if (assigned) return { ok: true, printer: assigned, media };

  // 2. Sheet media with no assignment → never default-fallback (that printer
  //    could be a receipt printer). Require an explicit report-printer.
  if (!RECEIPT_CLASS_MEDIA.includes(media)) {
    return { ok: false, media, error: 'no_report_printer' };
  }

  // 3. Receipt-class media, no assignment → existing default-printer route.
  if (printers[0]) return { ok: true, printer: printers[0], media, viaDefaultFallback: true };
  return { ok: false, media, error: 'no_receipt_printer' };
}

// ── R-PRINT-SERVER-V1: explicit-printer print-server contract ──

/** One printer as advertised by the Primary to its Secondaries. */
export interface LanPrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
  /** Best-effort offline hint from the OS status flags (UI only — never
   *  blocks a submit; many drivers report 0 regardless). */
  offline: boolean;
  /** Media type assigned in Settings → Hardware on the Primary ('' = unset). */
  media: PrinterMediaType | '';
}

/** Serialize the Primary's printer scan + media map for the wire. */
export function buildPrinterInventory(
  printers: Array<{ name: string; displayName?: string; isDefault: boolean; status: number }> | undefined | null,
  mediaMap: Record<string, string> | undefined | null,
): LanPrinterInfo[] {
  const map = (mediaMap && typeof mediaMap === 'object') ? mediaMap : {};
  return (Array.isArray(printers) ? printers : []).map((p): LanPrinterInfo => ({
    name: String(p.name || ''),
    displayName: String(p.displayName || p.name || ''),
    isDefault: !!p.isDefault,
    // Windows PRINTER_STATUS_OFFLINE = 0x80; other bits vary per driver.
    offline: (Number(p.status) & 0x80) !== 0,
    media: (map[String(p.name || '')] as PrinterMediaType | undefined) || '',
  })).filter((p) => p.name);
}

/** Full print-server job: everything the modal decided, plus the explicit
 *  target printer. Same option shapes as LanPrintJob (single contract). */
export interface LanPrintSubmitInput extends LanPrintJobInput {
  printerName: string;
  jobId: string;
  documentType?: string;
}

export interface LanPrintSubmitJob extends LanPrintJob {
  printerName: string;
  jobId: string;
  documentType: string;
}

/**
 * Secondary side: build + validate the LAN_PRINT_SUBMIT wire payload.
 * Reuses buildLanPrintJob for every shared field (ranges blocked here,
 * before anything crosses the LAN).
 */
export function buildLanPrintSubmit(input: LanPrintSubmitInput): { ok: true; job: LanPrintSubmitJob } | { ok: false; error: string } {
  const printerName = String(input.printerName || '').trim();
  if (!printerName) return { ok: false, error: 'no_printer_selected' };
  const jobId = String(input.jobId || '').trim();
  if (!jobId) return { ok: false, error: 'bad_job_id' };
  const base = buildLanPrintJob(input);
  if (!base.ok) return base;
  return {
    ok: true,
    job: {
      ...base.job,
      printerName: printerName.slice(0, 200),
      jobId: jobId.slice(0, 80),
      documentType: String(input.documentType || input.receiptType || 'document').slice(0, 40),
    },
  };
}

/**
 * Primary side: defensively re-validate a received LAN_PRINT_SUBMIT payload
 * and resolve it against the Primary's CURRENT printer list. The named
 * printer must exist on the Primary — a Secondary can never route a job to
 * an arbitrary device string. Returns the printRun payload (canonical
 * pipeline) plus the validated job identity.
 */
export function buildPrintServerRunPayload(
  print: unknown,
  availablePrinters: string[] | undefined | null,
): { ok: true; jobId: string; printerName: string; documentType: string; payload: BridgedPrintRunPayload } | { ok: false; error: string; jobId?: string } {
  const p = print as Partial<LanPrintSubmitJob> | null | undefined;
  const jobId = p ? String(p.jobId || '').trim() : '';
  if (!p || !jobId) return { ok: false, error: 'bad_job_id' };
  const printerName = String(p.printerName || '').trim();
  if (!printerName) return { ok: false, error: 'no_printer_selected', jobId };
  const names = Array.isArray(availablePrinters) ? availablePrinters : [];
  if (!names.includes(printerName)) return { ok: false, error: 'printer_not_found', jobId };
  const built = buildBridgedPrintRunPayload(p, printerName);
  if (!built.ok) return { ok: false, error: built.error, jobId };
  return {
    ok: true,
    jobId,
    printerName,
    documentType: String(p.documentType || p.receiptType || 'document').slice(0, 40),
    payload: built.payload,
  };
}
